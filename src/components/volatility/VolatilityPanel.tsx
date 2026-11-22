import React, { useMemo } from 'react';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, Info, Layers, TrendingUp } from 'lucide-react';
import { Leg, MarketDataResponse } from '../../types/options';
import { calendarToBusinessDays, formatDateBR } from '../../engine/calendar';
import { getActiveLegs } from '../../engine/payoff';
import {
  buildTermStructure,
  buildVolatilitySkew,
  calculateVolatilitySummary,
} from '../../engine/volatility';
import { formatBRL } from '../../utils/format';

interface VolatilityPanelProps {
  marketData: MarketDataResponse | null;
  spotPrice: number;
  selectedExpiry: string;
  onSelectExpiry: (expiry: string) => void;
  legs: Leg[];
}

export const VolatilityPanel: React.FC<VolatilityPanelProps> = ({
  marketData,
  spotPrice,
  selectedExpiry,
  onSelectExpiry,
  legs,
}) => {
  const expirations = useMemo(() => {
    if (!marketData) return [];
    const map = new Map<string, number>();
    for (const opt of marketData.chain) {
      if (!map.has(opt.expirationDate)) {
        map.set(opt.expirationDate, opt.daysToMaturity);
      }
    }
    return Array.from(map.entries())
      .map(([date, days]) => ({ date, days }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [marketData]);

  const effectiveExpiry = selectedExpiry || expirations[0]?.date || '';

  const skewData = useMemo(
    () => buildVolatilitySkew(marketData, effectiveExpiry, spotPrice),
    [marketData, effectiveExpiry, spotPrice]
  );

  const termData = useMemo(
    () => buildTermStructure(marketData, spotPrice),
    [marketData, spotPrice]
  );

  const summary = useMemo(
    () => calculateVolatilitySummary(marketData, effectiveExpiry, spotPrice),
    [marketData, effectiveExpiry, spotPrice]
  );

  const activeStrikes = useMemo(() => {
    const active = getActiveLegs(legs).filter((l) => l.type !== 'Stock' && l.strike > 0);
    return Array.from(new Set(active.map((l) => l.strike)));
  }, [legs]);

  if (!marketData || marketData.chain.length === 0) {
    return (
      <section className="bg-[#0f1623] border border-slate-800 rounded-xl p-10 text-center space-y-2">
        <p className="text-sm font-semibold text-slate-300">
          Sincronize um ativo para analisar o Skew e a Estrutura a Termo de Volatilidade.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      {/* Header + Diagnostics Strip */}
      <div className="bg-[#0f1623] border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity size={16} className="text-sky-400" />
            <div>
              <h2 className="text-sm font-bold text-slate-100">
                Superfície & Regime de Volatilidade — {marketData.baseAsset}
              </h2>
              <p className="text-xs text-slate-400">
                Skew por strike (Smile), Estrutura a Termo ATM e diagnóstico de prêmio de volatilidade
              </p>
            </div>
          </div>

          {expirations.length > 0 && (
            <select
              aria-label="Vencimento para curva de Skew"
              value={effectiveExpiry}
              onChange={(e) => onSelectExpiry(e.target.value)}
              className="bg-[#090d16] border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-100 outline-none focus:border-sky-500"
            >
              {expirations.map((exp) => (
                <option key={exp.date} value={exp.date}>
                  {formatDateBR(exp.date)} ({exp.days} dc /{' '}
                  {calendarToBusinessDays(exp.days, exp.date)} du)
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Volatility KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 divide-y lg:divide-y-0 divide-x divide-slate-800/80 bg-[#0b101b]">
          <div className="px-4 py-3">
            <div className="text-[11px] font-medium text-slate-400">IV ATM (Venc.)</div>
            <div className="mt-1 text-base font-mono font-bold text-sky-300 tabular-nums">
              {summary.atmIv !== null ? `${summary.atmIv.toFixed(1)}%` : '—'}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
              HV Ref: {summary.hvReference !== null ? `${summary.hvReference.toFixed(1)}%` : '—'}
            </div>
          </div>

          <div className="px-4 py-3">
            <div
              className="text-[11px] font-medium text-slate-400"
              title="Diferença de IV entre Put 25Δ e Call 25Δ. Valores positivos indicam proteção de queda mais cara."
            >
              Skew 25Δ (Put − Call)
            </div>
            <div
              className={`mt-1 text-base font-mono font-bold tabular-nums ${
                (summary.skew25Delta ?? 0) > 0 ? 'text-rose-300' : 'text-emerald-300'
              }`}
            >
              {summary.skew25Delta !== null
                ? `${summary.skew25Delta > 0 ? '+' : ''}${summary.skew25Delta.toFixed(1)} pp`
                : '—'}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {(summary.skew25Delta ?? 0) > 2
                ? 'Demanda por hedge (Put cara)'
                : (summary.skew25Delta ?? 0) < -1
                ? 'Call skew (alta forte)'
                : 'Skew equilibrado'}
            </div>
          </div>

          <div className="px-4 py-3">
            <div
              className="text-[11px] font-medium text-slate-400"
              title="Curvatura do smile: média das asas 25Δ menos IV ATM"
            >
              Curvatura (Butterfly 25Δ)
            </div>
            <div className="mt-1 text-base font-mono font-bold text-slate-100 tabular-nums">
              {summary.butterfly25Delta !== null
                ? `${summary.butterfly25Delta > 0 ? '+' : ''}${summary.butterfly25Delta.toFixed(1)} pp`
                : '—'}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {(summary.butterfly25Delta ?? 0) > 1 ? 'Caudas gordas (asas caras)' : 'Curvatura suave'}
            </div>
          </div>

          <div className="px-4 py-3">
            <div className="text-[11px] font-medium text-slate-400">Estrutura a Termo</div>
            <div
              className={`mt-1 text-base font-bold ${
                summary.termRegime === 'Contango'
                  ? 'text-emerald-400'
                  : summary.termRegime === 'Backwardation'
                  ? 'text-amber-300'
                  : 'text-slate-200'
              }`}
            >
              {summary.termRegime}
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-0.5">
              {summary.termSlopePp !== null
                ? `Inclinação: ${summary.termSlopePp > 0 ? '+' : ''}${summary.termSlopePp.toFixed(1)} pp`
                : '1 vencimento'}
            </div>
          </div>

          <div className="px-4 py-3">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[11px] font-medium text-slate-400">IV Rank / Pct</span>
              <span
                title={
                  summary.isEstimatedHistory
                    ? 'Faixa de referência calibrada (conecte um feed histórico para IV Rank real de 52 semanas)'
                    : 'Calculado sobre histórico real de IV'
                }
                className={`px-1.5 py-0.2 rounded text-[9px] font-semibold ${
                  summary.isEstimatedHistory
                    ? 'bg-amber-500/15 text-amber-300'
                    : 'bg-emerald-500/15 text-emerald-300'
                }`}
              >
                {summary.isEstimatedHistory ? 'Ref.' : 'Hist.'}
              </span>
            </div>
            <div className="mt-1 text-base font-mono font-bold text-cyan-300 tabular-nums">
              {summary.ivRank !== null ? `${summary.ivRank.toFixed(0)}%` : '—'}
              <span className="text-xs text-slate-400 font-normal ml-1.5">
                / {summary.ivPercentile !== null ? `${summary.ivPercentile.toFixed(0)}%` : '—'}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {summary.atmIv && summary.hvReference
                ? `VRP: ${(summary.atmIv - summary.hvReference >= 0 ? '+' : '') + (summary.atmIv - summary.hvReference).toFixed(1)} pp`
                : 'Sem histórico'}
            </div>
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Volatility Skew Chart */}
        <div className="lg:col-span-7 bg-[#0f1623] border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp size={15} className="text-sky-400" />
              <h3 className="text-xs font-bold text-slate-100">
                Curva de Skew (IV % × Strike)
              </h3>
            </div>
            <div className="flex items-center gap-3 text-[11px]">
              <span className="inline-flex items-center gap-1.5 text-emerald-300">
                <span className="h-2 w-2 rounded-full bg-emerald-400" /> Calls
              </span>
              <span className="inline-flex items-center gap-1.5 text-rose-300">
                <span className="h-2 w-2 rounded-full bg-rose-400" /> Puts
              </span>
            </div>
          </div>

          <div className="p-3 h-[280px]">
            {skewData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">
                Sem dados de IV suficientes para este vencimento.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={skewData} margin={{ top: 14, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis
                    dataKey="strike"
                    type="number"
                    domain={['dataMin', 'dataMax']}
                    stroke="#64748b"
                    tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                    tickFormatter={(v: number) => `R$ ${v.toFixed(1)}`}
                  />
                  <YAxis
                    stroke="#64748b"
                    tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                    tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                    domain={['auto', 'auto']}
                    width={48}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const pt = payload[0].payload;
                      return (
                        <div className="bg-[#0b111e] border border-slate-700 rounded-xl px-3 py-2 shadow-2xl text-xs space-y-1 font-mono">
                          <div className="text-slate-200 font-bold border-b border-slate-800 pb-1">
                            Strike {formatBRL(pt.strike)} ({pt.moneynessPct > 0 ? '+' : ''}
                            {pt.moneynessPct}%)
                          </div>
                          {pt.callIv !== null && (
                            <div className="flex justify-between gap-4 text-emerald-300">
                              <span>IV Call (Δ {pt.callDelta?.toFixed(2)})</span>
                              <span className="font-bold">{pt.callIv.toFixed(1)}%</span>
                            </div>
                          )}
                          {pt.putIv !== null && (
                            <div className="flex justify-between gap-4 text-rose-300">
                              <span>IV Put (Δ {pt.putDelta?.toFixed(2)})</span>
                              <span className="font-bold">{pt.putIv.toFixed(1)}%</span>
                            </div>
                          )}
                        </div>
                      );
                    }}
                  />
                  <ReferenceLine
                    x={spotPrice}
                    stroke="#fbbf24"
                    strokeDasharray="4 4"
                    label={{
                      value: 'SPOT',
                      fill: '#fbbf24',
                      fontSize: 10,
                      fontWeight: 700,
                      position: 'insideTopRight',
                    }}
                  />
                  {activeStrikes.map((k) => (
                    <ReferenceLine
                      key={`leg-k-${k}`}
                      x={k}
                      stroke="#38bdf8"
                      strokeDasharray="2 3"
                      strokeOpacity={0.55}
                    />
                  ))}
                  <Line
                    type="monotone"
                    dataKey="callIv"
                    name="IV Call"
                    stroke="#34d399"
                    strokeWidth={2}
                    dot={{ r: 2.5, fill: '#34d399' }}
                    connectNulls
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="putIv"
                    name="IV Put"
                    stroke="#fb7185"
                    strokeWidth={2}
                    strokeDasharray="4 2"
                    dot={{ r: 2.5, fill: '#fb7185' }}
                    connectNulls
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Term Structure Chart */}
        <div className="lg:col-span-5 bg-[#0f1623] border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers size={15} className="text-sky-400" />
              <h3 className="text-xs font-bold text-slate-100">
                Estrutura a Termo (IV ATM × Venc.)
              </h3>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              {termData.length} vencimento(s)
            </span>
          </div>

          <div className="p-3 h-[280px]">
            {termData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">
                Sem vencimentos suficientes.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={termData} margin={{ top: 14, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis
                    dataKey="label"
                    stroke="#64748b"
                    tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                  />
                  <YAxis
                    stroke="#64748b"
                    tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                    tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                    domain={['auto', 'auto']}
                    width={46}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload || payload.length === 0) return null;
                      const pt = payload[0].payload;
                      return (
                        <div className="bg-[#0b111e] border border-slate-700 rounded-xl px-3 py-2 shadow-2xl text-xs space-y-1 font-mono">
                          <div className="text-slate-200 font-bold">
                            {formatDateBR(pt.expirationDate)}
                          </div>
                          <div className="text-slate-400">
                            {pt.businessDays} du / {pt.calendarDays} dc
                          </div>
                          <div className="text-sky-300 font-bold">IV ATM: {pt.atmIv.toFixed(1)}%</div>
                        </div>
                      );
                    }}
                  />
                  {summary.hvReference !== null && (
                    <ReferenceLine
                      y={summary.hvReference}
                      stroke="#94a3b8"
                      strokeDasharray="4 4"
                      label={{
                        value: `HV ${summary.hvReference.toFixed(0)}%`,
                        fill: '#94a3b8',
                        fontSize: 10,
                        position: 'insideBottomRight',
                      }}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="atmIv"
                    name="IV ATM"
                    stroke="#38bdf8"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: '#38bdf8', stroke: '#0f1623', strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Contextual Reading Tip */}
      <div className="bg-[#0b101b] border border-slate-800/90 rounded-xl px-4 py-3 flex items-start gap-2.5 text-xs text-slate-300">
        <Info size={15} className="text-sky-400 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          As linhas verticais tracejadas azuis no gráfico de Skew indicam os strikes ativos da sua estrutura atual.
          Em regime de <strong className="text-emerald-300">Contango</strong>, vencimentos curtos têm IV menor que os longos;
          em <strong className="text-amber-300">Backwardation</strong> (eventos/balanços), a ponta curta precifica estresse imediato — cenário típico para avaliar Calendários ou vendas curtas travadas.
        </p>
      </div>
    </section>
  );
};
