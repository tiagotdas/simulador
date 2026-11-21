import React, { useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { RotateCcw, TrendingUp } from 'lucide-react';
import {
  CostConfig,
  Leg,
  MarketParams,
  PayoffPoint,
  SimulationParams,
} from '../../types/options';
import {
  calculatePayoffSeries,
  evaluatePortfolioGreeks,
  evaluateStrategyPnl,
  getActiveLegs,
  getNearestDte,
} from '../../engine/payoff';
import { formatBRL, formatBRLCompact, formatPct } from '../../utils/format';

interface PayoffChartProps {
  legs: Leg[];
  marketParams: MarketParams;
  simParams: SimulationParams;
  onSimParamsChange: (patch: Partial<SimulationParams>) => void;
  costConfig: CostConfig;
  breakevens: number[];
}

export const PayoffChart: React.FC<PayoffChartProps> = ({
  legs,
  marketParams,
  simParams,
  onSimParamsChange,
  costConfig,
  breakevens,
}) => {
  const [rangePct, setRangePct] = useState<number>(0.25);
  const [showTheoretical, setShowTheoretical] = useState<boolean>(true);

  const activeLegs = useMemo(() => getActiveLegs(legs), [legs]);
  const nearestDte = useMemo(() => getNearestDte(activeLegs), [activeLegs]);

  const { points, minPrice, maxPrice } = useMemo(
    () => calculatePayoffSeries(activeLegs, marketParams, simParams, costConfig, rangePct),
    [activeLegs, marketParams, simParams, costConfig, rangePct]
  );

  // Split gradient offset for green (>= 0) vs red (< 0)
  const zeroOffset = useMemo(() => {
    if (points.length === 0) return 0.5;
    const vals = points.map((p) => p.expiryPnl);
    const dataMax = Math.max(...vals);
    const dataMin = Math.min(...vals);
    if (dataMax <= 0) return 0;
    if (dataMin >= 0) return 1;
    return dataMax / (dataMax - dataMin);
  }, [points]);

  // Exact telemetry at simulated target spot
  const targetStats = useMemo(() => {
    const expiryPnl = evaluateStrategyPnl(
      activeLegs,
      simParams.targetSpot,
      nearestDte,
      simParams.ivShiftPercent,
      marketParams,
      costConfig
    );
    const clampedDays = Math.min(Math.max(0, simParams.daysElapsed), nearestDte);
    const theoPnl = evaluateStrategyPnl(
      activeLegs,
      simParams.targetSpot,
      clampedDays,
      simParams.ivShiftPercent,
      marketParams,
      costConfig
    );
    const greeksAtTarget = evaluatePortfolioGreeks(
      activeLegs,
      simParams.targetSpot,
      clampedDays,
      simParams.ivShiftPercent,
      marketParams
    );
    const pctMove =
      marketParams.spotPrice > 0
        ? ((simParams.targetSpot - marketParams.spotPrice) / marketParams.spotPrice) * 100
        : 0;
    return { expiryPnl, theoPnl, greeksAtTarget, pctMove };
  }, [activeLegs, simParams, nearestDte, marketParams, costConfig]);

  const isModifiedSim =
    Math.abs(simParams.targetSpot - marketParams.spotPrice) > 0.01 ||
    simParams.daysElapsed > 0 ||
    simParams.ivShiftPercent !== 0;

  return (
    <section className="bg-[#0f1623] border border-slate-800 rounded-xl overflow-hidden">
      {/* Header & Controls */}
      <div className="px-4 sm:px-5 py-3.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-sky-400" />
          <h2 className="text-sm font-bold text-slate-100">Curva de Payoff & Simulação T+N</h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer select-none px-2 py-1 rounded bg-[#090d16] border border-slate-800">
            <input
              type="checkbox"
              checked={showTheoretical}
              onChange={(e) => setShowTheoretical(e.target.checked)}
              className="accent-sky-400 rounded"
            />
            <span>Curva Hoje (BSM)</span>
          </label>

          <div className="inline-flex rounded-lg bg-[#090d16] border border-slate-800 p-0.5 text-xs">
            {[0.15, 0.25, 0.4].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRangePct(r)}
                className={`px-2 py-1 rounded-md font-mono font-medium transition-colors ${
                  rangePct === r
                    ? 'bg-slate-800 text-sky-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                ±{Math.round(r * 100)}%
              </button>
            ))}
          </div>

          {isModifiedSim && (
            <button
              type="button"
              onClick={() =>
                onSimParamsChange({
                  targetSpot: marketParams.spotPrice,
                  daysElapsed: 0,
                  ivShiftPercent: 0,
                })
              }
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition-colors"
            >
              <RotateCcw size={12} />
              <span>Resetar</span>
            </button>
          )}
        </div>
      </div>

      {/* Dedicated Telemetry Strip (zero overlap with chart!) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 divide-x divide-slate-800/80 bg-[#0b101b] border-b border-slate-800">
        <div className="px-4 py-3">
          <div className="text-[11px] font-medium text-slate-400">Alvo Simulado</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-base sm:text-lg font-mono font-bold text-slate-100 tabular-nums">
              {formatBRL(simParams.targetSpot)}
            </span>
            <span
              className={`text-xs font-mono font-semibold tabular-nums ${
                targetStats.pctMove > 0.05
                  ? 'text-emerald-400'
                  : targetStats.pctMove < -0.05
                  ? 'text-rose-400'
                  : 'text-slate-400'
              }`}
            >
              {formatPct(targetStats.pctMove, 1, true)}
            </span>
          </div>
        </div>

        <div className="px-4 py-3">
          <div className="text-[11px] font-medium text-slate-400">
            PnL no Vencimento {costConfig.includeCosts ? '(Líq.)' : '(Bruto)'}
          </div>
          <div
            className={`mt-1 text-base sm:text-lg font-mono font-bold tabular-nums ${
              targetStats.expiryPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {formatBRL(targetStats.expiryPnl, true)}
          </div>
        </div>

        <div className="px-4 py-3">
          <div className="text-[11px] font-medium text-slate-400">
            PnL Teórico (T+{Math.min(simParams.daysElapsed, nearestDte)}d
            {simParams.ivShiftPercent !== 0
              ? `, IV ${simParams.ivShiftPercent > 0 ? '+' : ''}${simParams.ivShiftPercent}pp`
              : ''}
            )
          </div>
          <div
            className={`mt-1 text-base sm:text-lg font-mono font-bold tabular-nums ${
              targetStats.theoPnl >= 0 ? 'text-sky-300' : 'text-rose-300'
            }`}
          >
            {formatBRL(targetStats.theoPnl, true)}
          </div>
        </div>

        <div className="px-4 py-3">
          <div className="text-[11px] font-medium text-slate-400">Delta / Theta no Alvo</div>
          <div className="mt-1 flex items-baseline gap-3 font-mono text-sm font-semibold tabular-nums">
            <span className={targetStats.greeksAtTarget.delta >= 0 ? 'text-sky-300' : 'text-amber-300'}>
              Δ {targetStats.greeksAtTarget.delta.toFixed(1)}
            </span>
            <span className={targetStats.greeksAtTarget.theta >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              Θ {formatBRL(targetStats.greeksAtTarget.theta, true)}/d
            </span>
          </div>
        </div>
      </div>

      {/* Main Chart */}
      <div className="px-2 sm:px-4 pt-4 pb-2 h-[320px] sm:h-[360px]">
        {activeLegs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <p className="text-sm font-semibold text-slate-300">
              Adicione pernas na Option Chain ou escolha uma estratégia para plotar o Payoff
            </p>
            <p className="text-xs text-slate-400 mt-1">
              O gráfico exibe a curva linear exata de vencimento e a projeção Black-Scholes T+N.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={points} margin={{ top: 18, right: 24, left: 6, bottom: 6 }}>
              <defs>
                <linearGradient id="payoffSplitFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset={0} stopColor="#10b981" stopOpacity={0.34} />
                  <stop offset={zeroOffset} stopColor="#10b981" stopOpacity={0.05} />
                  <stop offset={zeroOffset} stopColor="#f43f5e" stopOpacity={0.05} />
                  <stop offset={1} stopColor="#f43f5e" stopOpacity={0.34} />
                </linearGradient>
                <linearGradient id="payoffSplitStroke" x1="0" y1="0" x2="0" y2="1">
                  <stop offset={0} stopColor="#34d399" />
                  <stop offset={zeroOffset} stopColor="#34d399" />
                  <stop offset={zeroOffset} stopColor="#fb7185" />
                  <stop offset={1} stopColor="#fb7185" />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />

              <XAxis
                dataKey="price"
                type="number"
                domain={[minPrice, maxPrice]}
                tickCount={8}
                stroke="#64748b"
                tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                tickFormatter={(v: number) => `R$ ${v.toFixed(2)}`}
              />

              <YAxis
                stroke="#64748b"
                tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                tickFormatter={(v: number) => formatBRLCompact(v)}
                width={72}
              />

              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const pt = payload[0].payload as PayoffPoint;
                  const diffPct =
                    marketParams.spotPrice > 0
                      ? ((pt.price - marketParams.spotPrice) / marketParams.spotPrice) * 100
                      : 0;
                  return (
                    <div className="bg-[#0b111e] border border-slate-700 rounded-xl px-3.5 py-2.5 shadow-2xl text-xs space-y-1.5">
                      <div className="flex items-center justify-between gap-4 border-b border-slate-800 pb-1">
                        <span className="text-slate-400">Preço do Ativo</span>
                        <span className="font-mono font-bold text-slate-100">
                          {formatBRL(pt.price)} ({formatPct(diffPct, 1, true)})
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-slate-300">No Vencimento</span>
                        <span
                          className={`font-mono font-bold ${
                            pt.expiryPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {formatBRL(pt.expiryPnl, true)}
                        </span>
                      </div>
                      {showTheoretical && (
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-sky-300">Teórico (T+{simParams.daysElapsed}d)</span>
                          <span
                            className={`font-mono font-bold ${
                              pt.theoreticalPnl >= 0 ? 'text-sky-300' : 'text-rose-300'
                            }`}
                          >
                            {formatBRL(pt.theoreticalPnl, true)}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                }}
              />

              <ReferenceLine y={0} stroke="#64748b" strokeWidth={1.5} />

              {/* Breakeven vertical guides */}
              {breakevens
                .filter((be) => be >= minPrice && be <= maxPrice)
                .map((be) => (
                  <ReferenceLine
                    key={`be-${be}`}
                    x={be}
                    stroke="#38bdf8"
                    strokeDasharray="2 4"
                    strokeOpacity={0.55}
                  />
                ))}

              {/* Current Spot reference line */}
              <ReferenceLine
                x={marketParams.spotPrice}
                stroke="#fbbf24"
                strokeDasharray="5 5"
                strokeWidth={1.5}
                label={{
                  value: `SPOT ${marketParams.spotPrice.toFixed(2)}`,
                  fill: '#fbbf24',
                  fontSize: 10,
                  fontWeight: 700,
                  position: 'insideTopRight',
                }}
              />

              {/* Simulated Target Spot reference line */}
              {Math.abs(simParams.targetSpot - marketParams.spotPrice) > 0.01 && (
                <ReferenceLine
                  x={simParams.targetSpot}
                  stroke="#f8fafc"
                  strokeWidth={1.5}
                  label={{
                    value: `ALVO ${simParams.targetSpot.toFixed(2)}`,
                    fill: '#f8fafc',
                    fontSize: 10,
                    fontWeight: 700,
                    position: 'top',
                  }}
                />
              )}

              {/* Expiration Payoff (piecewise linear with exact strikes!) */}
              <Area
                type="linear"
                dataKey="expiryPnl"
                stroke="url(#payoffSplitStroke)"
                strokeWidth={2.5}
                fill="url(#payoffSplitFill)"
                isAnimationActive={false}
              />

              {/* Black-Scholes Theoretical T+N Curve */}
              {showTheoretical && (
                <Line
                  type="monotone"
                  dataKey="theoreticalPnl"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  strokeDasharray="5 3"
                  dot={false}
                  isAnimationActive={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* What-If Interactive Stress Sliders */}
      <div className="px-4 sm:px-5 py-4 bg-[#0b101b] border-t border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* 1. Price Slider */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <label htmlFor="slider-spot" className="font-semibold text-slate-300">
              Preço do Ativo
            </label>
            <span className="font-mono font-bold text-slate-100 tabular-nums">
              {formatBRL(simParams.targetSpot)} ({formatPct(targetStats.pctMove, 1, true)})
            </span>
          </div>
          <input
            id="slider-spot"
            type="range"
            min={Number(minPrice.toFixed(2))}
            max={Number(maxPrice.toFixed(2))}
            step={0.05}
            value={Math.min(maxPrice, Math.max(minPrice, simParams.targetSpot))}
            onChange={(e) => onSimParamsChange({ targetSpot: parseFloat(e.target.value) })}
            className="w-full terminal-slider"
          />
          <div className="flex justify-between text-[11px] font-mono text-slate-400">
            <span>{formatBRL(minPrice)}</span>
            <span>Spot {formatBRL(marketParams.spotPrice)}</span>
            <span>{formatBRL(maxPrice)}</span>
          </div>
        </div>

        {/* 2. Time / DTE Slider */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <label htmlFor="slider-dte" className="font-semibold text-slate-300">
              Passagem do Tempo (Theta)
            </label>
            <span className="font-mono font-bold text-sky-300 tabular-nums">
              T+{Math.min(simParams.daysElapsed, nearestDte)}d (restam{' '}
              {Math.max(0, nearestDte - simParams.daysElapsed)}d)
            </span>
          </div>
          <input
            id="slider-dte"
            type="range"
            min={0}
            max={Math.max(1, nearestDte)}
            step={1}
            value={Math.min(simParams.daysElapsed, nearestDte)}
            onChange={(e) => onSimParamsChange({ daysElapsed: parseInt(e.target.value, 10) })}
            className="w-full terminal-slider"
          />
          <div className="flex justify-between text-[11px] font-mono text-slate-400">
            <span>Hoje (T+0)</span>
            <span>Meio ({Math.round(nearestDte / 2)}d)</span>
            <span>Vencimento</span>
          </div>
        </div>

        {/* 3. IV Shock Slider */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <label htmlFor="slider-iv" className="font-semibold text-slate-300">
              Choque de Volatilidade (Vega)
            </label>
            <span
              className={`font-mono font-bold tabular-nums ${
                simParams.ivShiftPercent > 0
                  ? 'text-amber-300'
                  : simParams.ivShiftPercent < 0
                  ? 'text-sky-300'
                  : 'text-slate-200'
              }`}
            >
              {simParams.ivShiftPercent > 0 ? '+' : ''}
              {simParams.ivShiftPercent} pp IV
            </span>
          </div>
          <input
            id="slider-iv"
            type="range"
            min={-20}
            max={20}
            step={1}
            value={simParams.ivShiftPercent}
            onChange={(e) => onSimParamsChange({ ivShiftPercent: parseInt(e.target.value, 10) })}
            className="w-full terminal-slider"
          />
          <div className="flex justify-between text-[11px] font-mono text-slate-400">
            <span>-20pp (IV Crush)</span>
            <span>Base (0)</span>
            <span>+20pp (Spike)</span>
          </div>
        </div>
      </div>
    </section>
  );
};
