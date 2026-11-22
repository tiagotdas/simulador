import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Briefcase,
  Camera,
  Grid,
  Share2,
  Target,
  TrendingUp,
} from 'lucide-react';
import {
  ActionType,
  CostConfig,
  Leg,
  MarketDataResponse,
  MarketOption,
  MarketParams,
  OptionType,
  SavedStrategy,
  SimulationParams,
  StrategyAdjustment,
  StrategyTemplate,
  TradeStatus,
} from './types/options';
import { priceOption } from './engine/americanPricing';
import { getContinuousMarketRates, inferDefaultB3ExerciseStyle } from './engine/blackScholes';
import {
  generateB3OptionTicker,
  getTimeToMaturityYears,
  getUpcomingB3Expiries,
} from './engine/calendar';
import { getActiveLegs } from './engine/payoff';
import { getDefaultBetaForTicker, refreshLegsDynamicDte } from './engine/portfolioRisk';
import { calculateStrategyMetrics } from './engine/riskMetrics';
import {
  generateLegId,
  instantiateStrategy,
  roundToB3Strike,
  STRATEGIES,
} from './engine/strategies';
import { fetchMarketChain, getCachedMarketSnapshot } from './services/marketData';
import { generateRealisticB3Chain } from './services/mockMarketData';
import {
  decodeStrategyFromUrl,
  encodeStrategyToUrl,
  exportElementToPng,
  loadDraft,
  loadSavedStrategies,
  persistSavedStrategies,
  saveDraft,
} from './services/storage';
import { TopBar } from './components/layout/TopBar';
import { PayoffChart } from './components/chart/PayoffChart';
import { ScenarioMatrix } from './components/chart/ScenarioMatrix';
import { LegsTable } from './components/builder/LegsTable';
import { OptionChainTable } from './components/chain/OptionChainTable';
import { VolatilityPanel } from './components/volatility/VolatilityPanel';
import { PortfolioView } from './components/portfolio/PortfolioView';
import { RiskPanel } from './components/risk/RiskPanel';
import { StrategyExplorerModal } from './components/builder/StrategyExplorerModal';
import { OrderTicketModal } from './components/risk/OrderTicketModal';
import { PortfolioDrawer } from './components/portfolio/PortfolioDrawer';
import { ToastContainer, ToastItem } from './components/common/ToastContainer';

type WorkspaceTab = 'payoff' | 'chain' | 'matrix' | 'volatility' | 'portfolio';

const DEFAULT_MARKET_PARAMS: MarketParams = {
  spotPrice: 37.8,
  riskFreeRate: 0.1425,
  dividendYield: 0,
  borrowRate: 0.005,
  dayCountConvention: 'du252',
  popDriftMode: 'risk-neutral',
};

const DEFAULT_COST_CONFIG: CostConfig = {
  includeCosts: false,
  brokeragePerLeg: 0,
  b3FeeRate: 0.000695,
  stockFeeRate: 0.0003,
  includeExitCosts: true,
  exerciseFeeRate: 0.0003,
  exerciseBrokeragePerLeg: 0,
  includeIR: false,
  isDayTrade: false,
  accumulatedLossOffset: 0,
};

function getInitialWorkspace() {
  const fromUrl = decodeStrategyFromUrl();
  if (fromUrl) {
    const mp: MarketParams = { ...DEFAULT_MARKET_PARAMS, ...fromUrl.marketParams };
    const chain = generateRealisticB3Chain(fromUrl.ticker, mp);
    return {
      ticker: fromUrl.ticker,
      strategyId: 'custom',
      marketParams: mp,
      costConfig: DEFAULT_COST_CONFIG,
      legs: fromUrl.legs,
      marketData: chain,
      selectedExpiry: chain.chain[0]?.expirationDate || '',
    };
  }

  const draft = loadDraft();
  if (draft && draft.legs.length > 0) {
    const chain = generateRealisticB3Chain(draft.ticker, draft.marketParams);
    return {
      ticker: draft.ticker,
      strategyId: draft.strategyId || 'custom',
      marketParams: { ...DEFAULT_MARKET_PARAMS, ...draft.marketParams },
      costConfig: { ...DEFAULT_COST_CONFIG, ...draft.costConfig },
      legs: draft.legs,
      marketData: chain,
      selectedExpiry: chain.chain[0]?.expirationDate || '',
    };
  }

  const initialChain = generateRealisticB3Chain('PETR4', DEFAULT_MARKET_PARAMS);
  const initialExpiry = initialChain.chain[0]?.expirationDate || '';
  const defaultTemplate = STRATEGIES.find((s) => s.id === 'bull-call-spread') || STRATEGIES[0];
  const initialParams: MarketParams = {
    ...DEFAULT_MARKET_PARAMS,
    spotPrice: initialChain.spotPrice,
  };
  const initialLegs = instantiateStrategy(
    defaultTemplate,
    'PETR4',
    initialParams,
    initialChain,
    initialExpiry
  );

  return {
    ticker: 'PETR4',
    strategyId: defaultTemplate.id,
    marketParams: initialParams,
    costConfig: DEFAULT_COST_CONFIG,
    legs: initialLegs,
    marketData: initialChain,
    selectedExpiry: initialExpiry,
  };
}

export default function App() {
  const initial = useMemo(() => getInitialWorkspace(), []);

  const [ticker, setTicker] = useState<string>(initial.ticker);
  const [strategyId, setStrategyId] = useState<string>(initial.strategyId);
  const [marketParams, setMarketParams] = useState<MarketParams>(initial.marketParams);
  const [costConfig, setCostConfig] = useState<CostConfig>(initial.costConfig);
  const [legs, setLegs] = useState<Leg[]>(initial.legs);
  const [undoStack, setUndoStack] = useState<Leg[][]>([]);

  const [marketData, setMarketData] = useState<MarketDataResponse | null>(initial.marketData);
  const [selectedExpiry, setSelectedExpiry] = useState<string>(initial.selectedExpiry);
  const [isFetchingMarket, setIsFetchingMarket] = useState<boolean>(false);

  const [simParams, setSimParams] = useState<SimulationParams>({
    targetSpot: initial.marketParams.spotPrice,
    daysElapsed: 0,
    ivShiftPercent: 0,
    ivShockMode: 'parallel',
  });

  const [activeTab, setActiveTab] = useState<WorkspaceTab>('payoff');
  const [isExplorerOpen, setIsExplorerOpen] = useState(false);
  const [isOrderTicketOpen, setIsOrderTicketOpen] = useState(false);
  const [isPortfolioOpen, setIsPortfolioOpen] = useState(false);
  const [isExportingPng, setIsExportingPng] = useState(false);

  const [savedStrategies, setSavedStrategies] = useState<SavedStrategy[]>(() =>
    loadSavedStrategies()
  );
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const workspaceCaptureRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const addToast = useCallback((message: string, type: ToastItem['type'] = 'info') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev.slice(-3), { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  // Auto-save workspace draft
  useEffect(() => {
    saveDraft({
      ticker,
      strategyId,
      marketParams,
      costConfig,
      legs,
    });
  }, [ticker, strategyId, marketParams, costConfig, legs]);

  // Keep simulation targetSpot aligned when spotPrice changes
  useEffect(() => {
    setSimParams((prev) => ({ ...prev, targetSpot: marketParams.spotPrice }));
  }, [marketParams.spotPrice]);

  const pushUndo = useCallback((currentLegs: Leg[]) => {
    setUndoStack((prev) => [...prev.slice(-14), currentLegs]);
  }, []);

  const handleUndo = () => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setLegs(last);
      return prev.slice(0, -1);
    });
    addToast('Última alteração desfeita.', 'info');
  };

  const handleSyncMarket = async (tickerOverride?: string, forceRefresh = false) => {
    const sym = (tickerOverride ?? ticker).trim().toUpperCase();
    if (!sym) {
      addToast('Digite um código de ativo da B3 (ex.: PETR4).', 'error');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsFetchingMarket(true);
    try {
      const result = await fetchMarketChain(sym, marketParams, {
        forceRefresh,
        signal: controller.signal,
        allowFallback: true,
      });

      setMarketData(result.data);
      setMarketParams((prev) => ({ ...prev, spotPrice: result.data.spotPrice }));

      const dates = Array.from(new Set(result.data.chain.map((o) => o.expirationDate))).sort();
      if (dates.length > 0) setSelectedExpiry(dates[0]);

      if (result.fallbackUsed) {
        addToast(
          `Gateway GAS indisponível (${result.errorMessage || 'erro'}). Grade teórica B3 carregada para ${sym}.`,
          'info'
        );
      } else {
        addToast(
          `Cotações B3 sincronizadas para ${sym} (Spot R$ ${result.data.spotPrice.toFixed(2)})${
            result.fromCache ? ' [cache]' : ''
          }.`,
          'success'
        );
      }
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Erro ao sincronizar cotações.',
        'error'
      );
    } finally {
      setIsFetchingMarket(false);
    }
  };

  const handleSelectStrategy = (template: StrategyTemplate) => {
    pushUndo(legs);
    setStrategyId(template.id);
    const builtLegs = instantiateStrategy(
      template,
      ticker,
      marketParams,
      marketData,
      selectedExpiry
    );
    setLegs(builtLegs);
    setSimParams((prev) => ({
      ...prev,
      targetSpot: marketParams.spotPrice,
      daysElapsed: 0,
      ivShiftPercent: 0,
    }));
    addToast(`Estratégia "${template.name}" montada para ${ticker}.`, 'success');
  };

  const handleAddOptionFromChain = (option: MarketOption, action: ActionType) => {
    pushUndo(legs);
    setStrategyId('custom');
    const chosenPrice =
      action === 'Buy'
        ? option.ask > 0
          ? option.ask
          : option.last || option.bid
        : option.bid > 0
        ? option.bid
        : option.last || option.ask;

    const newLeg: Leg = {
      id: generateLegId(),
      ticker: option.ticker,
      type: option.type,
      action,
      exerciseStyle:
        option.exerciseStyle ?? inferDefaultB3ExerciseStyle(option.type, ticker),
      strike: option.strike,
      quantity: 100,
      price: Number(Math.max(0.01, chosenPrice).toFixed(2)),
      expirationDate: option.expirationDate,
      daysToMaturity: option.daysToMaturity,
      impliedVolatility: option.impliedVolatility,
      enabled: true,
      bid: option.bid,
      ask: option.ask,
      last: option.last,
      delta: option.delta,
      gamma: option.gamma,
      theta: option.theta,
      vega: option.vega,
      rho: option.rho,
    };

    setLegs((prev) => [...prev, newLeg]);
    addToast(
      `${action === 'Buy' ? 'Compra' : 'Venda'} de ${option.ticker} @ R$ ${newLeg.price.toFixed(2)} adicionada.`,
      'success'
    );
  };

  const handleAddManualLeg = (type: OptionType) => {
    pushUndo(legs);
    setStrategyId('custom');
    const fallbackExp = getUpcomingB3Expiries(1)[0];
    const expiry = selectedExpiry || fallbackExp.date;
    const dte =
      marketData?.chain.find((o) => o.expirationDate === expiry)?.daysToMaturity ||
      fallbackExp.calendarDays;
    const strike =
      type === 'Stock' ? marketParams.spotPrice : roundToB3Strike(marketParams.spotPrice);
    const iv = type === 'Stock' ? 0 : 0.34;
    const exerciseStyle =
      type === 'Stock' ? undefined : inferDefaultB3ExerciseStyle(type, ticker);
    const T = getTimeToMaturityYears(dte, marketParams.dayCountConvention, expiry);
    const { rCont, qCont } = getContinuousMarketRates(marketParams);

    const price =
      type === 'Stock'
        ? marketParams.spotPrice
        : Math.max(
            0.05,
            priceOption({
              S: marketParams.spotPrice,
              K: strike,
              T,
              r: rCont,
              q: qCont,
              sigma: iv,
              type,
              exerciseStyle,
            })
          );

    const newLeg: Leg = {
      id: generateLegId(),
      ticker:
        type === 'Stock'
          ? ticker.toUpperCase()
          : generateB3OptionTicker(ticker, type, expiry, strike),
      type,
      action: 'Buy',
      exerciseStyle,
      strike: Number(strike.toFixed(2)),
      quantity: 100,
      price: Number(price.toFixed(2)),
      expirationDate: expiry,
      daysToMaturity: dte,
      impliedVolatility: iv,
      enabled: true,
    };

    setLegs((prev) => [...prev, newLeg]);
  };

  const handleUpdateLeg = (id: string, patch: Partial<Leg>) => {
    setLegs((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const handleDuplicateLeg = (id: string) => {
    const source = legs.find((l) => l.id === id);
    if (!source) return;
    pushUndo(legs);
    setLegs((prev) => [...prev, { ...source, id: generateLegId() }]);
  };

  const handleRemoveLeg = (id: string) => {
    pushUndo(legs);
    setLegs((prev) => prev.filter((l) => l.id !== id));
  };

  const handleClearLegs = () => {
    pushUndo(legs);
    setStrategyId('custom');
    setLegs([]);
    addToast('Estrutura limpa. Use "Desfazer" se precisar recuperar.', 'info');
  };

  const metrics = useMemo(
    () =>
      calculateStrategyMetrics(
        legs,
        marketParams,
        costConfig,
        simParams.ivShiftPercent,
        simParams.daysElapsed,
        simParams.ivShockMode ?? 'parallel',
        marketData?.chain
      ),
    [
      legs,
      marketParams,
      costConfig,
      simParams.ivShiftPercent,
      simParams.daysElapsed,
      simParams.ivShockMode,
      marketData?.chain,
    ]
  );

  const marketCacheMap = useMemo(() => {
    const map = getCachedMarketSnapshot();
    if (marketData) {
      map[marketData.baseAsset.toUpperCase()] = marketData;
    }
    return map;
  }, [marketData]);

  const activeStrategyTemplate = useMemo(
    () => STRATEGIES.find((s) => s.id === strategyId),
    [strategyId]
  );

  const activeStrategyName = activeStrategyTemplate?.name || 'Montagem Customizada';
  const activeLegsCount = useMemo(() => getActiveLegs(legs).length, [legs]);
  const openPositionsCount = useMemo(
    () => savedStrategies.filter((s) => s.status === 'Em Aberto').length,
    [savedStrategies]
  );

  const handleCopyShareLink = async () => {
    try {
      const url = encodeStrategyToUrl(ticker, marketParams, legs);
      await navigator.clipboard.writeText(url);
      addToast('Link compartilhável da estratégia copiado!', 'success');
    } catch {
      addToast('Não foi possível copiar o link.', 'error');
    }
  };

  const handleExportPng = async () => {
    if (!workspaceCaptureRef.current) return;
    setIsExportingPng(true);
    try {
      await exportElementToPng(
        workspaceCaptureRef.current,
        `tearsheet-${ticker.toLowerCase()}-${Date.now()}.png`
      );
      addToast('Tearsheet PNG exportado com sucesso.', 'success');
    } catch {
      addToast('Erro ao gerar imagem PNG.', 'error');
    } finally {
      setIsExportingPng(false);
    }
  };

  const handleSaveToPortfolio = (name: string, status: TradeStatus, notes: string) => {
    const now = new Date().toISOString();
    const sym = ticker.toUpperCase();
    const record: SavedStrategy = {
      id: generateLegId(),
      name,
      ticker: sym,
      strategyTemplateName: activeStrategyName,
      status,
      notes,
      createdAt: now,
      updatedAt: now,
      spotAtSave: marketParams.spotPrice,
      marketParams: { ...marketParams },
      legs: legs.map((l) => ({ ...l })),
      adjustments: [],
      betaToIbov: getDefaultBetaForTicker(sym),
    };

    const next = [record, ...savedStrategies];
    setSavedStrategies(next);
    persistSavedStrategies(next);
    addToast(`Operação "${name}" salva na Carteira/Diário.`, 'success');
  };

  const handleLoadSavedStrategy = (item: SavedStrategy) => {
    pushUndo(legs);
    const refreshedLegs = refreshLegsDynamicDte(item.legs);
    setTicker(item.ticker);
    setMarketParams({ ...DEFAULT_MARKET_PARAMS, ...item.marketParams });
    setLegs(refreshedLegs);
    setStrategyId('custom');
    setMarketData(generateRealisticB3Chain(item.ticker, item.marketParams));
    setActiveTab('payoff');
    addToast(`Operação "${item.name}" carregada (DTE atualizado para hoje).`, 'success');
  };

  const handleUpdateSavedStatus = (id: string, status: TradeStatus, exitPnl?: number) => {
    const now = new Date().toISOString();
    const next = savedStrategies.map((s) =>
      s.id === id
        ? {
            ...s,
            status,
            updatedAt: now,
            ...(status === 'Encerrada'
              ? { exitPnl: exitPnl ?? s.exitPnl ?? 0, closedAt: now }
              : {}),
          }
        : s
    );
    setSavedStrategies(next);
    persistSavedStrategies(next);
    if (status === 'Encerrada') {
      addToast('Operação encerrada e resultado registrado na Carteira.', 'success');
    }
  };

  const handleAddAdjustment = (id: string, adjustment: StrategyAdjustment) => {
    const next = savedStrategies.map((s) =>
      s.id === id
        ? {
            ...s,
            adjustments: [...(s.adjustments ?? []), adjustment],
            updatedAt: new Date().toISOString(),
          }
        : s
    );
    setSavedStrategies(next);
    persistSavedStrategies(next);
    addToast('Rolagem/ajuste registrado na operação.', 'success');
  };

  const handleUpdateBeta = (id: string, beta: number) => {
    const next = savedStrategies.map((s) => (s.id === id ? { ...s, betaToIbov: beta } : s));
    setSavedStrategies(next);
    persistSavedStrategies(next);
  };

  const handleDeleteSaved = (id: string) => {
    const next = savedStrategies.filter((s) => s.id !== id);
    setSavedStrategies(next);
    persistSavedStrategies(next);
    addToast('Registro removido do Diário.', 'info');
  };

  const handleImportStrategies = (imported: SavedStrategy[]) => {
    const existingIds = new Set(savedStrategies.map((s) => s.id));
    const merged = [
      ...imported.filter((s) => !existingIds.has(s.id)),
      ...savedStrategies,
    ];
    setSavedStrategies(merged);
    persistSavedStrategies(merged);
    addToast(`${imported.length} registro(s) importado(s) para a Carteira.`, 'success');
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col">
      <ToastContainer
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />

      <TopBar
        ticker={ticker}
        onTickerChange={setTicker}
        onSyncMarket={handleSyncMarket}
        isFetching={isFetchingMarket}
        marketData={marketData}
        marketParams={marketParams}
        onMarketParamsChange={(patch) => setMarketParams((prev) => ({ ...prev, ...patch }))}
        activeStrategyName={activeStrategyName}
        onOpenStrategyExplorer={() => setIsExplorerOpen(true)}
        onOpenOrderTicket={() => setIsOrderTicketOpen(true)}
        onOpenPortfolio={() => setIsPortfolioOpen(true)}
        savedCount={savedStrategies.length}
        activeLegsCount={activeLegsCount}
      />

      {/* Main Terminal Workspace */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-5 space-y-4">
        {/* Workspace Navigation Tabs & Utility Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav
            aria-label="Visualizações do terminal"
            className="inline-flex flex-wrap bg-[#0f1623] border border-slate-800 rounded-xl p-1 gap-1"
          >
            <button
              type="button"
              id="tab-payoff"
              onClick={() => setActiveTab('payoff')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'payoff'
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <TrendingUp size={14} />
              <span>Payoff</span>
            </button>
            <button
              type="button"
              id="tab-chain"
              onClick={() => setActiveTab('chain')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'chain'
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <Target size={14} />
              <span>Option Chain</span>
            </button>
            <button
              type="button"
              id="tab-matrix"
              onClick={() => setActiveTab('matrix')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'matrix'
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <Grid size={14} />
              <span>Matriz</span>
            </button>
            <button
              type="button"
              id="tab-volatility"
              onClick={() => setActiveTab('volatility')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'volatility'
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <Activity size={14} />
              <span>Volatilidade</span>
            </button>
            <button
              type="button"
              id="tab-portfolio"
              onClick={() => setActiveTab('portfolio')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === 'portfolio'
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              <Briefcase size={14} />
              <span>Carteira</span>
              {openPositionsCount > 0 && (
                <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[10px]">
                  {openPositionsCount}
                </span>
              )}
            </button>
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyShareLink}
              disabled={activeLegsCount === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0f1623] hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-300 hover:text-white transition-colors disabled:opacity-40"
            >
              <Share2 size={13} />
              <span className="hidden sm:inline">Compartilhar Link</span>
            </button>
            <button
              type="button"
              onClick={handleExportPng}
              disabled={activeLegsCount === 0 || isExportingPng}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0f1623] hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-300 hover:text-white transition-colors disabled:opacity-40"
            >
              <Camera size={13} />
              <span>{isExportingPng ? 'Gerando...' : 'Exportar PNG'}</span>
            </button>
          </div>
        </div>

        {/* 12-Column Responsive Layout */}
        <div
          ref={workspaceCaptureRef}
          className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start"
        >
          {/* Primary Workspace (8 cols, or full 12 cols on Portfolio view) */}
          <div
            className={`${
              activeTab === 'portfolio' ? 'xl:col-span-12' : 'xl:col-span-8'
            } space-y-5 min-w-0`}
          >
            {activeTab === 'payoff' && (
              <PayoffChart
                legs={legs}
                marketParams={marketParams}
                simParams={simParams}
                onSimParamsChange={(patch) => setSimParams((prev) => ({ ...prev, ...patch }))}
                costConfig={costConfig}
                breakevens={metrics.breakevens}
              />
            )}

            {activeTab === 'chain' && (
              <OptionChainTable
                marketData={marketData}
                spotPrice={marketParams.spotPrice}
                selectedExpiry={selectedExpiry}
                onSelectExpiry={setSelectedExpiry}
                onAddOptionLeg={handleAddOptionFromChain}
                isFetching={isFetchingMarket}
              />
            )}

            {activeTab === 'matrix' && (
              <ScenarioMatrix
                legs={legs}
                marketParams={marketParams}
                costConfig={costConfig}
                ivShiftPercent={simParams.ivShiftPercent}
                ivShockMode={simParams.ivShockMode}
                capitalBase={metrics.estimatedMargin}
              />
            )}

            {activeTab === 'volatility' && (
              <VolatilityPanel
                marketData={marketData}
                spotPrice={marketParams.spotPrice}
                selectedExpiry={selectedExpiry}
                onSelectExpiry={setSelectedExpiry}
                legs={legs}
              />
            )}

            {activeTab === 'portfolio' && (
              <PortfolioView
                strategies={savedStrategies}
                marketCache={marketCacheMap}
                activeTicker={ticker}
                activeSpotPrice={marketParams.spotPrice}
                onLoadStrategy={handleLoadSavedStrategy}
                onUpdateStatus={handleUpdateSavedStatus}
                onAddAdjustment={handleAddAdjustment}
                onUpdateBeta={handleUpdateBeta}
                onDeleteStrategy={handleDeleteSaved}
                onImportStrategies={handleImportStrategies}
                onOpenSaveDrawer={() => setIsPortfolioOpen(true)}
              />
            )}

            {/* Legs Builder is always accessible below non-portfolio primary views */}
            {activeTab !== 'portfolio' && (
              <LegsTable
                legs={legs}
                ticker={ticker}
                marketParams={marketParams}
                onAddManualLeg={handleAddManualLeg}
                onUpdateLeg={handleUpdateLeg}
                onDuplicateLeg={handleDuplicateLeg}
                onRemoveLeg={handleRemoveLeg}
                onClearLegs={handleClearLegs}
                canUndo={undoStack.length > 0}
                onUndo={handleUndo}
              />
            )}
          </div>

          {/* Persistent Risk & Greeks Sidebar (4 cols) */}
          {activeTab !== 'portfolio' && (
            <div className="xl:col-span-4 min-w-0">
              <RiskPanel
                metrics={metrics}
                spotPrice={marketParams.spotPrice}
                costConfig={costConfig}
                onCostConfigChange={(patch) => setCostConfig((prev) => ({ ...prev, ...patch }))}
                strategyTemplate={activeStrategyTemplate}
              />
            </div>
          )}
        </div>
      </main>

      {/* Compliance Footer */}
      <footer className="border-t border-slate-800/80 mt-6 py-4 px-4 sm:px-6 text-center text-[11px] text-slate-400">
        Terminal de Opções B3 — Simulador analítico quantitativo de apoio operacional. Não constitui recomendação de investimento.
        Estimativas de margem por cenários (Proxy CORE B3), emolumentos/exercício e tributação devem ser confirmadas na corretora antes da execução.
      </footer>

      {/* Modals & Drawers */}
      <StrategyExplorerModal
        isOpen={isExplorerOpen}
        onClose={() => setIsExplorerOpen(false)}
        selectedId={strategyId}
        onSelectStrategy={handleSelectStrategy}
      />

      <OrderTicketModal
        isOpen={isOrderTicketOpen}
        onClose={() => setIsOrderTicketOpen(false)}
        ticker={ticker}
        strategyName={activeStrategyName}
        legs={legs}
        marketParams={marketParams}
        metrics={metrics}
        onCopyShareLink={handleCopyShareLink}
        onSaveToJournal={() => setIsPortfolioOpen(true)}
      />

      <PortfolioDrawer
        isOpen={isPortfolioOpen}
        onClose={() => setIsPortfolioOpen(false)}
        strategies={savedStrategies}
        currentTicker={ticker}
        currentStrategyName={activeStrategyName}
        hasActiveLegs={activeLegsCount > 0}
        onSaveCurrent={handleSaveToPortfolio}
        onLoadStrategy={handleLoadSavedStrategy}
        onUpdateStatus={(id, status) => handleUpdateSavedStatus(id, status)}
        onDeleteStrategy={handleDeleteSaved}
      />
    </div>
  );
}
