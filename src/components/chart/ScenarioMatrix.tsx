import React, { useMemo, useState } from 'react';
import { Grid } from 'lucide-react';
import { CostConfig, Leg, MarketParams } from '../../types/options';
import { calculateScenarioMatrix, getActiveLegs } from '../../engine/payoff';
import { formatBRLCompact, formatPct } from '../../utils/format';

interface ScenarioMatrixProps {
  legs: Leg[];
  marketParams: MarketParams;
  costConfig: CostConfig;
  ivShiftPercent: number;
  capitalBase: number;
}

export const ScenarioMatrix: React.FC<ScenarioMatrixProps> = ({
  legs,
  marketParams,
  costConfig,
  ivShiftPercent,
  capitalBase,
}) => {
  const [displayMode, setDisplayMode] = useState<'brl' | 'roi'>('brl');
  const [rangePct, setRangePct] = useState<number>(0.15);

  const activeLegs = useMemo(() => getActiveLegs(legs), [legs]);

  const matrix = useMemo(
    () =>
      calculateScenarioMatrix(
        activeLegs,
        marketParams,
        costConfig,
        ivShiftPercent,
        capitalBase,
        rangePct
      ),
    [activeLegs, marketParams, costConfig, ivShiftPercent, capitalBase, rangePct]
  );

  const getCellStyle = (pnl: number) => {
    const scale = Math.max(Math.abs(matrix.maxPnl), Math.abs(matrix.minPnl), 1);
    const intensity = Math.min(1, Math.abs(pnl) / scale);

    if (Math.abs(pnl) < 0.5) {
      return { backgroundColor: 'rgba(51, 65, 85, 0.35)', color: '#e2e8f0' };
    }
    if (pnl > 0) {
      const alpha = 0.14 + intensity * 0.52;
      return {
        backgroundColor: `rgba(16, 185, 129, ${alpha.toFixed(2)})`,
        color: intensity > 0.45 ? '#ecfdf5' : '#6ee7b7',
      };
    }
    const alpha = 0.14 + intensity * 0.52;
    return {
      backgroundColor: `rgba(244, 63, 94, ${alpha.toFixed(2)})`,
      color: intensity > 0.45 ? '#fff1f2' : '#fda4af',
    };
  };

  if (activeLegs.length === 0) {
    return (
      <div className="bg-[#0f1623] border border-slate-800 rounded-xl p-10 text-center">
        <p className="text-sm font-semibold text-slate-300">
          Nenhuma posição ativa para projetar a matriz Preço × Tempo.
        </p>
      </div>
    );
  }

  return (
    <section className="bg-[#0f1623] border border-slate-800 rounded-xl overflow-hidden">
      <div className="px-4 sm:px-5 py-3.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Grid size={16} className="text-sky-400" />
          <div>
            <h2 className="text-sm font-bold text-slate-100">Matriz de Cenários (Preço × Data)</h2>
            <p className="text-xs text-slate-400">
              Projeção Black-Scholes do PnL ao longo do tempo até o vencimento mais curto
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg bg-[#090d16] border border-slate-800 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setDisplayMode('brl')}
              className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
                displayMode === 'brl' ? 'bg-slate-800 text-sky-300' : 'text-slate-400 hover:text-white'
              }`}
            >
              R$
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode('roi')}
              className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
                displayMode === 'roi' ? 'bg-slate-800 text-sky-300' : 'text-slate-400 hover:text-white'
              }`}
            >
              % Margem
            </button>
          </div>

          <div className="inline-flex rounded-lg bg-[#090d16] border border-slate-800 p-0.5 text-xs">
            {[0.1, 0.15, 0.25].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRangePct(r)}
                className={`px-2 py-1 rounded-md font-mono font-medium transition-colors ${
                  rangePct === r ? 'bg-slate-800 text-sky-300' : 'text-slate-400 hover:text-white'
                }`}
              >
                ±{Math.round(r * 100)}%
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto terminal-scroll">
        <table className="w-full text-xs border-collapse font-mono tabular-nums">
          <thead>
            <tr className="bg-[#0b101b] border-b border-slate-800 text-slate-300">
              <th className="py-2.5 px-3 text-left font-sans font-semibold sticky left-0 bg-[#0b101b] z-10 border-r border-slate-800">
                Preço Ativo
              </th>
              {matrix.dates.map((d) => (
                <th key={d.daysElapsed} className="py-2.5 px-3 text-center font-sans font-semibold min-w-[96px]">
                  <div>{d.label}</div>
                  <div className="text-[11px] font-mono text-slate-400 font-normal">
                    {d.dteRemaining}d
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {matrix.rows.map((row) => {
              const isSpotRow = Math.abs(row.spotChangePct) < 0.05;
              return (
                <tr
                  key={row.spot}
                  className={isSpotRow ? 'ring-1 ring-inset ring-amber-400/70' : ''}
                >
                  <td
                    className={`py-2 px-3 sticky left-0 z-10 border-r border-slate-800 whitespace-nowrap ${
                      isSpotRow ? 'bg-amber-500/15 text-amber-300 font-bold' : 'bg-[#0f1623] text-slate-200'
                    }`}
                  >
                    <span>R$ {row.spot.toFixed(2)}</span>
                    <span
                      className={`ml-2 text-[11px] ${
                        row.spotChangePct > 0
                          ? 'text-emerald-400'
                          : row.spotChangePct < 0
                          ? 'text-rose-400'
                          : 'text-amber-300'
                      }`}
                    >
                      {formatPct(row.spotChangePct, 0, true)}
                    </span>
                  </td>
                  {row.cells.map((cell) => (
                    <td
                      key={`${row.spot}-${cell.daysElapsed}`}
                      style={getCellStyle(cell.pnl)}
                      className="py-2 px-2.5 text-center font-semibold border-r border-slate-900/40 whitespace-nowrap"
                    >
                      {displayMode === 'roi' && cell.roiPct !== null
                        ? formatPct(cell.roiPct, 1, true)
                        : formatBRLCompact(cell.pnl)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};
