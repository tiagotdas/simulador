import React, { useMemo, useState } from 'react';
import { BookOpen, Search, X } from 'lucide-react';
import { RiskProfile, StrategyCategory, StrategyTemplate } from '../../types/options';
import { STRATEGIES } from '../../engine/strategies';

interface StrategyExplorerModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedId: string;
  onSelectStrategy: (template: StrategyTemplate) => void;
}

const CATEGORY_LABELS: Record<StrategyCategory | 'ALL', string> = {
  ALL: 'Todas (45)',
  Bullish: 'Alta (Bullish)',
  Bearish: 'Baixa (Bearish)',
  Volatility: 'Volatilidade',
  Income: 'Renda (Theta)',
  Hedge: 'Proteção / Hedge',
};

/**
 * Computes a tiny deterministic SVG polyline preview of the strategy payoff shape.
 */
function StrategySparkline({ template }: { template: StrategyTemplate }) {
  const spot = 100;
  const pts: { x: number; y: number }[] = [];
  const xs = [75, 85, 90, 92, 95, 96, 97, 100, 103, 104, 105, 106, 108, 110, 115, 125];

  for (const s of xs) {
    let val = 0;
    for (const leg of template.legSpecs) {
      const k = spot * leg.moneyness;
      const intrinsic =
        leg.type === 'Stock'
          ? s - spot
          : leg.type === 'Call'
          ? Math.max(0, s - k) - Math.max(0, spot - k) * 0.7 - 2.5
          : Math.max(0, k - s) - Math.max(0, k - spot) * 0.7 - 2.5;
      const dir = leg.action === 'Buy' ? 1 : -1;
      val += dir * intrinsic * (leg.quantity / 100);
    }
    pts.push({ x: s, y: val });
  }

  const minY = Math.min(...pts.map((p) => p.y), -1);
  const maxY = Math.max(...pts.map((p) => p.y), 1);
  const rangeY = Math.max(maxY - minY, 1);

  const w = 84;
  const h = 30;
  const zeroY = h - ((0 - minY) / rangeY) * (h - 6) - 3;

  const polyline = pts
    .map((p) => {
      const px = ((p.x - 75) / 50) * (w - 4) + 2;
      const py = h - ((p.y - minY) / rangeY) * (h - 6) - 3;
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0" aria-hidden="true">
      <line x1={0} y1={zeroY} x2={w} y2={zeroY} stroke="#334155" strokeDasharray="2 2" strokeWidth={1} />
      <polyline
        fill="none"
        stroke={template.riskProfile === 'Ilimitado' ? '#fb7185' : '#38bdf8'}
        strokeWidth={1.8}
        points={polyline}
      />
    </svg>
  );
}

export const StrategyExplorerModal: React.FC<StrategyExplorerModalProps> = ({
  isOpen,
  onClose,
  selectedId,
  onSelectStrategy,
}) => {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<StrategyCategory | 'ALL'>('ALL');
  const [riskFilter, setRiskFilter] = useState<RiskProfile | 'ALL'>('ALL');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return STRATEGIES.filter((s) => {
      if (category !== 'ALL' && s.category !== category) return false;
      if (riskFilter !== 'ALL' && s.riskProfile !== riskFilter) return false;
      if (q) {
        const hay = `${s.name} ${s.description} ${s.details.thesis} ${s.category}`.toLowerCase();
        return hay.includes(q);
      }
      return true;
    });
  }, [query, category, riskFilter]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="strategy-explorer-title"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="bg-[#0f1623] border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <BookOpen size={18} className="text-sky-400" />
            <div>
              <h2 id="strategy-explorer-title" className="text-base font-bold text-slate-100">
                Catálogo de Estratégias de Opções (45 Modelos)
              </h2>
              <p className="text-xs text-slate-400">
                Strikes e prêmios são calibrados automaticamente na grade sincronizada ou via Black-Scholes
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar catálogo"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X size={18} />
          </button>
        </div>

        {/* Search & Filters */}
        <div className="px-5 py-3.5 bg-[#0b101b] border-b border-slate-800 space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar estratégia (ex.: Iron Condor, Trava de Alta, Collar, Borboleta)..."
                className="w-full bg-[#090d16] border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:border-sky-500"
              />
            </div>

            <div className="inline-flex rounded-lg bg-[#090d16] border border-slate-800 p-0.5 text-xs">
              {(['ALL', 'Definido', 'Ilimitado'] as const).map((rf) => (
                <button
                  key={rf}
                  type="button"
                  onClick={() => setRiskFilter(rf)}
                  className={`px-2.5 py-1.5 rounded-md font-semibold transition-colors ${
                    riskFilter === rf ? 'bg-slate-800 text-sky-300' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {rf === 'ALL' ? 'Todo Risco' : `Risco ${rf}`}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(CATEGORY_LABELS) as (StrategyCategory | 'ALL')[]).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                  category === cat
                    ? 'bg-sky-500/20 border-sky-500/50 text-sky-200'
                    : 'bg-[#090d16] border-slate-800 text-slate-300 hover:border-slate-600'
                }`}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>
        </div>

        {/* Grid */}
        <div className="p-5 overflow-y-auto terminal-scroll grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((strat) => {
            const isSelected = strat.id === selectedId;
            return (
              <button
                key={strat.id}
                type="button"
                onClick={() => {
                  onSelectStrategy(strat);
                  onClose();
                }}
                className={`text-left p-3.5 rounded-xl border transition-all flex items-start justify-between gap-3 ${
                  isSelected
                    ? 'bg-sky-500/10 border-sky-500/60'
                    : 'bg-[#0b101b] border-slate-800 hover:border-slate-600 hover:bg-slate-900/80'
                }`}
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-mono text-slate-400">#{strat.code}</span>
                    <span className="text-xs font-bold text-slate-100">{strat.name}</span>
                  </div>
                  <p className="text-xs text-slate-400 line-clamp-2">{strat.description}</p>
                  <div className="flex items-center gap-1.5 pt-0.5 flex-wrap">
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-semibold">
                      {strat.complexity}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        strat.riskProfile === 'Definido'
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-rose-500/15 text-rose-300'
                      }`}
                    >
                      Risco {strat.riskProfile}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">
                      {strat.legSpecs.length} {strat.legSpecs.length === 1 ? 'perna' : 'pernas'}
                    </span>
                  </div>
                </div>
                <div className="pt-1">
                  <StrategySparkline template={strat} />
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-full py-12 text-center text-sm text-slate-400">
              Nenhuma estratégia encontrada para o filtro informado.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
