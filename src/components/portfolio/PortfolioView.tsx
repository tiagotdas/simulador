import React, { useMemo, useRef, useState } from 'react';
import {
  Activity,
  Briefcase,
  CheckCircle2,
  Download,
  FolderOpen,
  PlusCircle,
  Shield,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  MarketDataResponse,
  SavedStrategy,
  StrategyAdjustment,
  TradeStatus,
} from '../../types/options';
import {
  BENCHMARK_TICKER,
  DEFAULT_BENCHMARK_SPOT,
  evaluateConsolidatedPortfolio,
  getDefaultBetaForTicker,
} from '../../engine/portfolioRisk';
import { generateLegId } from '../../engine/strategies';
import { exportPortfolioToJson, parsePortfolioJson } from '../../services/storage';
import { formatBRL, formatPct } from '../../utils/format';

interface PortfolioViewProps {
  strategies: SavedStrategy[];
  marketCache: Record<string, MarketDataResponse>;
  activeTicker: string;
  activeSpotPrice: number;
  onLoadStrategy: (item: SavedStrategy) => void;
  onUpdateStatus: (id: string, status: TradeStatus, exitPnl?: number) => void;
  onAddAdjustment: (id: string, adjustment: StrategyAdjustment) => void;
  onUpdateBeta: (id: string, beta: number) => void;
  onDeleteStrategy: (id: string) => void;
  onImportStrategies: (items: SavedStrategy[]) => void;
  onOpenSaveDrawer: () => void;
}

export const PortfolioView: React.FC<PortfolioViewProps> = ({
  strategies,
  marketCache,
  activeTicker,
  activeSpotPrice,
  onLoadStrategy,
  onUpdateStatus,
  onAddAdjustment,
  onUpdateBeta,
  onDeleteStrategy,
  onImportStrategies,
  onOpenSaveDrawer,
}) => {
  const [benchmarkSpot, setBenchmarkSpot] = useState<number>(
    marketCache[BENCHMARK_TICKER]?.spotPrice ?? DEFAULT_BENCHMARK_SPOT
  );
  const [spotOverrides, setSpotOverrides] = useState<Record<string, number>>({});
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [adjDesc, setAdjDesc] = useState('');
  const [adjCashflow, setAdjCashflow] = useState('');
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closePnlInput, setClosePnlInput] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const mergedSpotOverrides = useMemo(() => {
    return {
      [activeTicker.toUpperCase()]: activeSpotPrice,
      ...spotOverrides,
    };
  }, [activeTicker, activeSpotPrice, spotOverrides]);

  const summary = useMemo(
    () =>
      evaluateConsolidatedPortfolio(strategies, {
        marketCache,
        spotOverrides: mergedSpotOverrides,
        benchmarkSpot,
      }),
    [strategies, marketCache, mergedSpotOverrides, benchmarkSpot]
  );

  const closedStrategies = useMemo(
    () => strategies.filter((s) => s.status === 'Encerrada'),
    [strategies]
  );

  const handleSubmitAdjustment = (id: string, e: React.FormEvent) => {
    e.preventDefault();
    const cash = parseFloat(adjCashflow);
    if (!adjDesc.trim() || isNaN(cash)) return;
    onAddAdjustment(id, {
      id: generateLegId(),
      date: new Date().toISOString(),
      description: adjDesc.trim(),
      realizedCashflow: Number(cash.toFixed(2)),
    });
    setAdjDesc('');
    setAdjCashflow('');
    setAdjustingId(null);
  };

  const handleConfirmClose = (id: string, e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(closePnlInput);
    onUpdateStatus(id, 'Encerrada', isNaN(val) ? 0 : Number(val.toFixed(2)));
    setClosingId(null);
    setClosePnlInput('');
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = parsePortfolioJson(text);
      onImportStrategies(imported);
      setImportError(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Erro ao importar JSON.');
    } finally {
      e.target.value = '';
    }
  };

  return (
    <section className="space-y-4">
      {/* Header & Actions */}
      <div className="bg-[#0f1623] border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Briefcase size={16} className="text-sky-400" />
            <div>
              <h2 className="text-sm font-bold text-slate-100">
                Carteira Consolidada & Risco Multi-Ativo (MtM)
              </h2>
              <p className="text-xs text-slate-400">
                Marcação a mercado com DTE dinâmico, rolagens realizadas e Beta-Weighted Delta vs.{' '}
                <span className="font-mono text-sky-300">{BENCHMARK_TICKER}</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 bg-[#090d16] border border-slate-700/80 rounded-lg px-2.5 py-1 text-xs">
              <span className="text-slate-400 font-semibold">{BENCHMARK_TICKER} R$</span>
              <input
                type="number"
                step="0.5"
                min="1"
                value={benchmarkSpot}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v) && v > 0) setBenchmarkSpot(v);
                }}
                aria-label="Spot de referência BOVA11"
                className="w-16 bg-transparent font-mono font-bold text-amber-300 text-right outline-none tabular-nums no-spinner"
              />
            </div>

            <button
              type="button"
              onClick={onOpenSaveDrawer}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors"
            >
              <PlusCircle size={13} />
              <span>Salvar Atual</span>
            </button>

            <button
              type="button"
              onClick={() => exportPortfolioToJson(strategies)}
              disabled={strategies.length === 0}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#090d16] hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200 disabled:opacity-40"
              title="Exportar backup JSON do Diário/Carteira"
            >
              <Download size={13} />
              <span className="hidden sm:inline">Backup JSON</span>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#090d16] hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200"
              title="Importar backup JSON"
            >
              <Upload size={13} />
              <span className="hidden sm:inline">Importar</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              onChange={handleFileImport}
              className="hidden"
            />
          </div>
        </div>

        {importError && (
          <div className="px-4 py-2 bg-rose-950/60 border-b border-rose-500/40 text-xs text-rose-200">
            {importError}
          </div>
        )}

        {/* Consolidated KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 divide-x divide-slate-800/80 bg-[#0b101b]">
          <div className="px-4 py-3">
            <div className="text-[11px] font-medium text-slate-400">
              PnL Consolidado ({summary.openCount} abertas • {summary.closedCount} encerr.)
            </div>
            <div
              className={`mt-1 text-base font-mono font-bold tabular-nums ${
                summary.netPortfolioPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {formatBRL(summary.netPortfolioPnl, true)}
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-0.5">
              Aberto: {formatBRL(summary.totalUnrealizedPnl + summary.totalAdjustmentsPnl, true)} | Real.:{' '}
              {formatBRL(summary.totalRealizedPnl, true)}
            </div>
          </div>

          <div className="px-4 py-3">
            <div className="text-[11px] font-medium text-slate-400">
              Beta-Weighted Delta ({BENCHMARK_TICKER})
            </div>
            <div
              className={`mt-1 text-base font-mono font-bold tabular-nums ${
                summary.totalBetaWeightedDeltaShares >= 0 ? 'text-sky-300' : 'text-amber-300'
              }`}
            >
              {summary.totalBetaWeightedDeltaShares >= 0 ? '+' : ''}
              {summary.totalBetaWeightedDeltaShares.toFixed(1)} cotas
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-0.5">
              Exp. IBOV: {formatBRL(summary.totalBetaWeightedDeltaBRL, true)}
            </div>
          </div>

          <div className="px-4 py-3">
            <div className="text-[11px] font-medium text-slate-400">Margem CORE Agregada</div>
            <div className="mt-1 text-base font-mono font-bold text-amber-300 tabular-nums">
              {formatBRL(summary.totalEstimatedMargin)}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Soma das estruturas em aberto
            </div>
          </div>

          <div className="px-4 py-3">
            <div className="text-[11px] font-medium text-slate-400">Theta / Vega da Carteira</div>
            <div className="mt-1 flex items-baseline gap-2.5 font-mono text-sm font-bold tabular-nums">
              <span
                className={
                  summary.totalGreeks.theta >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }
              >
                Θ {formatBRL(summary.totalGreeks.theta, true)}/d
              </span>
              <span className="text-cyan-300">
                ν {formatBRL(summary.totalGreeks.vega, true)}
              </span>
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-0.5">
              Γ {summary.totalGreeks.gamma.toFixed(2)} | Vanna {(summary.totalGreeks.vanna ?? 0).toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* Consolidated IBOV Stress Scenarios */}
      {summary.openCount > 0 && (
        <div className="bg-[#0f1623] border border-slate-800 rounded-xl p-4 space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
            <Shield size={14} className="text-sky-400" />
            <span>Estresse Consolidado da Carteira vs. Choque no IBOV (via Beta de cada ativo)</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono tabular-nums">
            {summary.stressScenarios.map((sc) => (
              <div
                key={sc.ibovShockPct}
                className="bg-[#0b101b] border border-slate-800 rounded-lg p-2.5 text-xs"
              >
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">IBOV</span>
                  <span
                    className={`font-bold ${
                      sc.ibovShockPct > 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {formatPct(sc.ibovShockPct, 0, true)}
                  </span>
                </div>
                <div
                  className={`mt-1 text-sm font-bold ${
                    sc.estimatedPnlDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {formatBRL(sc.estimatedPnlDelta, true)}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  Total proj.: {formatBRL(sc.projectedTotalPnl, true)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Open Positions Table */}
      <div className="bg-[#0f1623] border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
            <Activity size={14} className="text-emerald-400" />
            Posições Em Aberto ({summary.positions.length})
          </span>
          <span className="text-[11px] text-slate-400">
            Altere o status no Diário para &ldquo;Em Aberto&rdquo; para acompanhar aqui
          </span>
        </div>

        {summary.positions.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <p className="text-sm font-semibold text-slate-300">
              Nenhuma posição marcada como &ldquo;Em Aberto&rdquo;
            </p>
            <p className="text-xs text-slate-400">
              Salve sua estrutura atual com status <strong className="text-emerald-300">Em Aberto</strong> para ativar marcação a mercado, controle de rolagens e Beta-Weighted Delta.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto terminal-scroll">
            <table className="w-full text-xs border-collapse font-mono tabular-nums">
              <thead>
                <tr className="bg-[#0b101b] border-b border-slate-800 text-slate-400 font-sans">
                  <th className="py-2.5 px-3 text-left">Estratégia / Ativo</th>
                  <th className="py-2.5 px-2 text-right">Spot Atual</th>
                  <th className="py-2.5 px-2 text-center">Beta</th>
                  <th className="py-2.5 px-2 text-center">DTE Real</th>
                  <th className="py-2.5 px-2 text-right">PnL MtM</th>
                  <th className="py-2.5 px-2 text-right">Rolagens</th>
                  <th className="py-2.5 px-2 text-right">β-Δ ({BENCHMARK_TICKER})</th>
                  <th className="py-2.5 px-2 text-right">Margem Est.</th>
                  <th className="py-2.5 px-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {summary.positions.map((pos) => {
                  const sym = pos.strategy.ticker.toUpperCase();
                  const betaVal = pos.strategy.betaToIbov ?? getDefaultBetaForTicker(sym);
                  return (
                    <React.Fragment key={pos.strategy.id}>
                      <tr className="hover:bg-slate-800/30">
                        <td className="py-2.5 px-3 font-sans">
                          <div className="font-bold text-slate-100">{pos.strategy.name}</div>
                          <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                            <span className="font-mono text-sky-300 font-semibold">{sym}</span>
                            <span>• {pos.strategy.legs.length} pernas</span>
                            <span
                              className={`px-1.5 py-0.2 rounded text-[10px] ${
                                pos.mtmSource === 'chain'
                                  ? 'bg-emerald-500/15 text-emerald-300'
                                  : 'bg-slate-800 text-slate-300'
                              }`}
                            >
                              {pos.mtmSource === 'chain' ? 'MtM Chain' : 'MtM Teórico'}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-2 text-right">
                          <input
                            type="number"
                            step="0.05"
                            min="0.01"
                            value={pos.currentSpot}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (!isNaN(v) && v > 0) {
                                setSpotOverrides((prev) => ({ ...prev, [sym]: v }));
                              }
                            }}
                            aria-label={`Spot atual de ${sym}`}
                            className="w-20 bg-[#090d16] border border-slate-700/80 rounded px-1.5 py-1 text-right text-amber-300 font-bold outline-none focus:border-sky-500 no-spinner"
                          />
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <input
                            type="number"
                            step="0.05"
                            min="0"
                            max="4"
                            value={betaVal}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (!isNaN(v) && v >= 0) onUpdateBeta(pos.strategy.id, v);
                            }}
                            aria-label={`Beta de ${sym}`}
                            className="w-14 bg-[#090d16] border border-slate-700/80 rounded px-1 py-1 text-center text-slate-200 outline-none focus:border-sky-500 no-spinner"
                          />
                        </td>
                        <td className="py-2.5 px-2 text-center">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                              pos.expired
                                ? 'bg-rose-500/20 text-rose-300'
                                : pos.nearestDte <= 5
                                ? 'bg-amber-500/20 text-amber-300'
                                : 'bg-slate-800 text-slate-200'
                            }`}
                          >
                            {pos.expired ? 'Vencida' : `${pos.nearestDte}d`}
                          </span>
                        </td>
                        <td
                          className={`py-2.5 px-2 text-right font-bold ${
                            pos.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {formatBRL(pos.unrealizedPnl, true)}
                        </td>
                        <td
                          className={`py-2.5 px-2 text-right ${
                            pos.realizedAdjustmentsPnl > 0
                              ? 'text-emerald-300'
                              : pos.realizedAdjustmentsPnl < 0
                              ? 'text-rose-300'
                              : 'text-slate-500'
                          }`}
                        >
                          {pos.realizedAdjustmentsPnl !== 0
                            ? formatBRL(pos.realizedAdjustmentsPnl, true)
                            : '—'}
                        </td>
                        <td
                          className={`py-2.5 px-2 text-right font-semibold ${
                            pos.betaWeightedDeltaShares >= 0 ? 'text-sky-300' : 'text-amber-300'
                          }`}
                        >
                          {pos.betaWeightedDeltaShares >= 0 ? '+' : ''}
                          {pos.betaWeightedDeltaShares.toFixed(1)}
                        </td>
                        <td className="py-2.5 px-2 text-right text-amber-300">
                          {formatBRL(pos.estimatedMargin)}
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap font-sans">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onLoadStrategy(pos.strategy)}
                              title="Abrir no Simulador"
                              className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300"
                            >
                              <FolderOpen size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setAdjustingId(
                                  adjustingId === pos.strategy.id ? null : pos.strategy.id
                                );
                                setClosingId(null);
                              }}
                              title="Registrar rolagem ou ajuste"
                              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200"
                            >
                              Rolar
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setClosingId(
                                  closingId === pos.strategy.id ? null : pos.strategy.id
                                );
                                setClosePnlInput(pos.unrealizedPnl.toFixed(2));
                                setAdjustingId(null);
                              }}
                              title="Encerrar e registrar PnL realizado"
                              className="p-1.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300"
                            >
                              <CheckCircle2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Inline Adjustment / Roll Form */}
                      {adjustingId === pos.strategy.id && (
                        <tr className="bg-[#0b101b]">
                          <td colSpan={9} className="p-3 font-sans">
                            <form
                              onSubmit={(e) => handleSubmitAdjustment(pos.strategy.id, e)}
                              className="flex flex-wrap items-center gap-2 text-xs"
                            >
                              <span className="font-bold text-sky-300">Registrar Rolagem/Ajuste:</span>
                              <input
                                type="text"
                                required
                                value={adjDesc}
                                onChange={(e) => setAdjDesc(e.target.value)}
                                placeholder="Ex.: Rolagem Call vendida para mês seguinte"
                                className="flex-1 min-w-[200px] bg-[#090d16] border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-100 outline-none focus:border-sky-500"
                              />
                              <input
                                type="number"
                                step="0.01"
                                required
                                value={adjCashflow}
                                onChange={(e) => setAdjCashflow(e.target.value)}
                                placeholder="Crédito (+) / Débito (-) R$"
                                className="w-44 bg-[#090d16] border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-slate-100 outline-none focus:border-sky-500"
                              />
                              <button
                                type="submit"
                                className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold"
                              >
                                Salvar Ajuste
                              </button>
                            </form>
                            {(pos.strategy.adjustments?.length ?? 0) > 0 && (
                              <div className="mt-2 pt-2 border-t border-slate-800 space-y-1 text-[11px] text-slate-300">
                                {pos.strategy.adjustments!.map((adj) => (
                                  <div key={adj.id} className="flex justify-between font-mono">
                                    <span className="font-sans">
                                      {new Date(adj.date).toLocaleDateString('pt-BR')} — {adj.description}
                                    </span>
                                    <span
                                      className={
                                        adj.realizedCashflow >= 0
                                          ? 'text-emerald-400'
                                          : 'text-rose-400'
                                      }
                                    >
                                      {formatBRL(adj.realizedCashflow, true)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}

                      {/* Inline Close Trade Form */}
                      {closingId === pos.strategy.id && (
                        <tr className="bg-[#0b101b]">
                          <td colSpan={9} className="p-3 font-sans">
                            <form
                              onSubmit={(e) => handleConfirmClose(pos.strategy.id, e)}
                              className="flex flex-wrap items-center gap-2 text-xs"
                            >
                              <span className="font-bold text-emerald-300">
                                Encerrar operação — PnL Realizado no fechamento (R$):
                              </span>
                              <input
                                type="number"
                                step="0.01"
                                required
                                value={closePnlInput}
                                onChange={(e) => setClosePnlInput(e.target.value)}
                                className="w-36 bg-[#090d16] border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-slate-100 outline-none focus:border-emerald-500"
                              />
                              <button
                                type="submit"
                                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                              >
                                Confirmar Encerramento
                              </button>
                            </form>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Closed History Summary */}
      {closedStrategies.length > 0 && (
        <div className="bg-[#0f1623] border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between text-xs font-bold text-slate-200">
            <span>Histórico de Operações Encerradas ({closedStrategies.length})</span>
            <span
              className={`font-mono ${
                summary.totalRealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              Realizado Total: {formatBRL(summary.totalRealizedPnl, true)}
            </span>
          </div>
          <div className="divide-y divide-slate-800/70">
            {closedStrategies.map((item) => {
              const adjSum = (item.adjustments ?? []).reduce((s, a) => s + a.realizedCashflow, 0);
              const total = (item.exitPnl ?? 0) + adjSum;
              return (
                <div
                  key={item.id}
                  className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <span className="font-bold text-slate-200">{item.name}</span>
                    <span className="ml-2 font-mono text-[11px] text-slate-400">
                      {item.ticker} • Encerrada em{' '}
                      {new Date(item.closedAt ?? item.updatedAt).toLocaleDateString('pt-BR')}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`font-mono font-bold ${
                        total >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {formatBRL(total, true)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onDeleteStrategy(item.id)}
                      aria-label="Excluir operação encerrada"
                      className="p-1 rounded text-slate-500 hover:text-rose-400"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};
