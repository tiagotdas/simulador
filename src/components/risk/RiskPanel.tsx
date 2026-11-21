import React, { useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Info,
  Receipt,
  Shield,
  ShieldAlert,
  Zap,
} from 'lucide-react';
import {
  CostConfig,
  StrategyMetrics,
  StrategyTemplate,
} from '../../types/options';
import { formatBRL, formatPct } from '../../utils/format';

interface RiskPanelProps {
  metrics: StrategyMetrics;
  spotPrice: number;
  costConfig: CostConfig;
  onCostConfigChange: (patch: Partial<CostConfig>) => void;
  strategyTemplate?: StrategyTemplate;
}

export const RiskPanel: React.FC<RiskPanelProps> = ({
  metrics,
  spotPrice,
  costConfig,
  onCostConfigChange,
  strategyTemplate,
}) => {
  const [showCostControls, setShowCostControls] = useState(false);

  const isDebit = metrics.netCost > 0.005;
  const isCredit = metrics.netCost < -0.005;

  return (
    <aside className="space-y-4">
      {/* Primary Risk & Return Card */}
      <section className="bg-[#0f1623] border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield size={15} className="text-sky-400" />
            <h2 className="text-sm font-bold text-slate-100">Risco, Retorno & Margem</h2>
          </div>
          {metrics.pop !== null && (
            <span className="px-2 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-sky-300 font-mono text-xs font-bold">
              PoP {metrics.pop.toFixed(0)}%
            </span>
          )}
        </div>

        <div className="p-4 space-y-4">
          {/* Net Debit/Credit & Margin */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#0b101b] border border-slate-800 rounded-lg p-3">
              <div className="text-[11px] font-medium text-slate-400">
                {isDebit ? 'Débito Líquido' : isCredit ? 'Crédito Líquido' : 'Fluxo Inicial'}
              </div>
              <div
                className={`mt-1 text-base font-mono font-bold tabular-nums ${
                  isDebit ? 'text-rose-400' : isCredit ? 'text-emerald-400' : 'text-slate-200'
                }`}
              >
                {formatBRL(Math.abs(metrics.netCost))}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                {isDebit ? 'Sai do caixa' : isCredit ? 'Entra no caixa' : 'Custo zero'}
              </div>
            </div>

            <div className="bg-[#0b101b] border border-slate-800 rounded-lg p-3">
              <div className="text-[11px] font-medium text-slate-400" title="Estimativa conservadora de garantia/capital exigido na B3">
                Garantia / Capital Est.
              </div>
              <div className="mt-1 text-base font-mono font-bold text-amber-300 tabular-nums">
                {formatBRL(metrics.estimatedMargin)}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                {metrics.ror !== null ? `RoR máx: ${formatPct(metrics.ror, 1)}` : 'Proxy CORE B3'}
              </div>
            </div>
          </div>

          {/* Max Profit & Max Loss */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#0b101b] border border-slate-800 rounded-lg p-3">
              <div className="text-[11px] font-medium text-slate-400">Lucro Máximo</div>
              <div className="mt-1 text-base font-mono font-bold text-emerald-400 tabular-nums">
                {typeof metrics.maxProfit === 'number'
                  ? formatBRL(metrics.maxProfit, true)
                  : 'Ilimitado'}
              </div>
            </div>

            <div className="bg-[#0b101b] border border-slate-800 rounded-lg p-3">
              <div className="text-[11px] font-medium text-slate-400">Prejuízo Máximo</div>
              <div className="mt-1 text-base font-mono font-bold text-rose-400 tabular-nums">
                {typeof metrics.maxLoss === 'number'
                  ? formatBRL(metrics.maxLoss)
                  : 'Ilimitado'}
              </div>
            </div>
          </div>

          {/* Breakevens */}
          <div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">
              Pontos de Equilíbrio (Breakevens)
            </div>
            {metrics.breakevens.length === 0 ? (
              <p className="text-xs text-slate-400">Nenhum ponto de equilíbrio no domínio atual.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {metrics.breakevens.map((be) => {
                  const dist = spotPrice > 0 ? ((be - spotPrice) / spotPrice) * 100 : 0;
                  return (
                    <span
                      key={be}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-500/10 border border-sky-500/30 font-mono text-xs font-bold text-sky-200 tabular-nums"
                    >
                      <span>{formatBRL(be)}</span>
                      <span className="text-[11px] text-sky-400 font-normal">
                        ({formatPct(dist, 1, true)})
                      </span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Portfolio Greeks */}
          <div className="bg-[#0b101b] border border-slate-800 rounded-lg p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <Zap size={13} className="text-sky-400" />
                Gregas da Posição
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                Exposição: {formatBRL(metrics.notionalDelta, true)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 font-mono tabular-nums">
              <div>
                <div className="text-[11px] font-sans text-slate-400">Delta (Δ)</div>
                <div
                  className={`text-sm font-bold ${
                    metrics.greeks.delta >= 0 ? 'text-sky-300' : 'text-amber-300'
                  }`}
                >
                  {metrics.greeks.delta >= 0 ? '+' : ''}
                  {metrics.greeks.delta.toFixed(2)}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-sans text-slate-400">Theta (Θ / dia)</div>
                <div
                  className={`text-sm font-bold ${
                    metrics.greeks.theta >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {formatBRL(metrics.greeks.theta, true)}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-sans text-slate-400">Gamma (Γ)</div>
                <div className="text-sm font-bold text-slate-200">
                  {metrics.greeks.gamma.toFixed(3)}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-sans text-slate-400">Vega (ν / +1pp IV)</div>
                <div className="text-sm font-bold text-cyan-300">
                  {formatBRL(metrics.greeks.vega, true)}
                </div>
              </div>
            </div>
          </div>

          {/* B3 Costs & IR Collapsible */}
          <div className="border border-slate-800 rounded-lg overflow-hidden bg-[#0b101b]">
            <button
              type="button"
              onClick={() => setShowCostControls((v) => !v)}
              className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs font-semibold text-slate-200 hover:bg-slate-800/40 transition-colors"
            >
              <span className="inline-flex items-center gap-1.5">
                <Receipt size={13} className="text-slate-400" />
                Custos B3 & IR
                {costConfig.includeCosts && (
                  <span className="font-mono text-[11px] text-amber-300">
                    ({formatBRL(metrics.operationalCosts)} taxas
                    {costConfig.includeIR
                      ? ` + ${costConfig.isDayTrade ? '20%' : '15%'} IR`
                      : ''}
                    )
                  </span>
                )}
              </span>
              {showCostControls ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {showCostControls && (
              <div className="px-3.5 pb-3.5 pt-2 border-t border-slate-800 space-y-3 text-xs">
                <label className="flex items-center justify-between text-slate-300 cursor-pointer">
                  <span>Deduzir emolumentos B3 e corretagem</span>
                  <input
                    type="checkbox"
                    checked={costConfig.includeCosts}
                    onChange={(e) => onCostConfigChange({ includeCosts: e.target.checked })}
                    className="accent-sky-400 rounded"
                  />
                </label>

                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="brokerage-input" className="text-slate-400">
                    Corretagem / perna (R$)
                  </label>
                  <input
                    id="brokerage-input"
                    type="number"
                    step="0.5"
                    min="0"
                    value={costConfig.brokeragePerLeg}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      onCostConfigChange({ brokeragePerLeg: isNaN(v) ? 0 : Math.max(0, v) });
                    }}
                    className="w-20 bg-[#090d16] border border-slate-700 rounded px-2 py-1 font-mono text-right text-white"
                  />
                </div>

                <label className="flex items-center justify-between text-slate-300 cursor-pointer">
                  <span>Projetar Imposto de Renda sobre lucro</span>
                  <input
                    type="checkbox"
                    checked={costConfig.includeIR}
                    disabled={!costConfig.includeCosts}
                    onChange={(e) => onCostConfigChange({ includeIR: e.target.checked })}
                    className="accent-sky-400 rounded"
                  />
                </label>

                {costConfig.includeCosts && costConfig.includeIR && (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => onCostConfigChange({ isDayTrade: false })}
                      className={`py-1.5 rounded border text-xs font-semibold ${
                        !costConfig.isDayTrade
                          ? 'bg-sky-500/20 border-sky-500 text-sky-200'
                          : 'bg-[#090d16] border-slate-700 text-slate-400'
                      }`}
                    >
                      Swing (15%)
                    </button>
                    <button
                      type="button"
                      onClick={() => onCostConfigChange({ isDayTrade: true })}
                      className={`py-1.5 rounded border text-xs font-semibold ${
                        costConfig.isDayTrade
                          ? 'bg-sky-500/20 border-sky-500 text-sky-200'
                          : 'bg-[#090d16] border-slate-700 text-slate-400'
                      }`}
                    >
                      Day-Trade (20%)
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Pre-Trade Risk Alerts */}
      {metrics.alerts.length > 0 && (
        <section className="space-y-2" aria-label="Alertas pré-operacionais">
          {metrics.alerts.map((alert) => {
            const styles =
              alert.severity === 'danger'
                ? 'bg-rose-950/50 border-rose-500/40 text-rose-100'
                : alert.severity === 'warning'
                ? 'bg-amber-950/40 border-amber-500/40 text-amber-100'
                : 'bg-sky-950/40 border-sky-500/40 text-sky-100';

            return (
              <div key={alert.id} className={`rounded-xl border px-3.5 py-3 flex items-start gap-2.5 ${styles}`}>
                <span className="mt-0.5 shrink-0">
                  {alert.severity === 'danger' ? (
                    <ShieldAlert size={16} className="text-rose-400" />
                  ) : alert.severity === 'warning' ? (
                    <AlertTriangle size={16} className="text-amber-400" />
                  ) : (
                    <Info size={16} className="text-sky-400" />
                  )}
                </span>
                <div className="space-y-0.5">
                  <div className="text-xs font-bold">{alert.title}</div>
                  <p className="text-xs opacity-90 leading-relaxed">{alert.description}</p>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* Strategy Thesis Card */}
      {strategyTemplate && (
        <section className="bg-[#0f1623] border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
              <BookOpen size={14} className="text-sky-400" />
              {strategyTemplate.name}
            </h3>
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                strategyTemplate.riskProfile === 'Definido'
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'bg-rose-500/15 text-rose-300'
              }`}
            >
              Risco {strategyTemplate.riskProfile}
            </span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed border-l-2 border-sky-500 pl-3">
            {strategyTemplate.details.thesis}
          </p>
          <div className="grid grid-cols-1 gap-2 text-xs">
            <div className="bg-[#0b101b] rounded-lg p-2.5 border border-slate-800/80">
              <span className="text-[11px] text-slate-400 block">Cenário Ideal</span>
              <span className="text-slate-200 font-medium">{strategyTemplate.details.idealScenario}</span>
            </div>
            <div className="bg-[#0b101b] rounded-lg p-2.5 border border-slate-800/80">
              <span className="text-[11px] text-slate-400 block">Assinatura de Gregas</span>
              <span className="font-mono text-sky-300 font-semibold">{strategyTemplate.details.greeks}</span>
            </div>
          </div>
        </section>
      )}
    </aside>
  );
};
