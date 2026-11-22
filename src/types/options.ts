export type OptionType = 'Call' | 'Put' | 'Stock';
export type ActionType = 'Buy' | 'Sell';
export type ExerciseStyle = 'European' | 'American';
export type DayCountConvention = 'du252' | 'dc365';
export type PopDriftMode = 'risk-neutral' | 'zero';
export type IvShockMode = 'parallel' | 'skew-aware';
export type StrategyCategory = 'Bullish' | 'Bearish' | 'Volatility' | 'Income' | 'Hedge';
export type RiskProfile = 'Definido' | 'Ilimitado';
export type ComplexityLevel = 'Iniciante' | 'Intermediário' | 'Avançado';
export type TradeStatus = 'Estudo' | 'Em Aberto' | 'Encerrada';
export type MarketDataSource = 'gas' | 'mock';

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  vanna?: number; // dDelta / dSigma (per +1pp IV)
  volga?: number; // dVega / dSigma (per +1pp IV)
  charm?: number; // -dDelta / dTime (per day)
}

export interface Leg {
  id: string;
  ticker?: string;
  type: OptionType;
  action: ActionType;
  exerciseStyle?: ExerciseStyle;
  strike: number;
  quantity: number;
  price: number;
  expirationDate: string; // YYYY-MM-DD
  daysToMaturity: number; // calendar days
  impliedVolatility: number; // decimal e.g. 0.35 = 35%
  enabled: boolean;
  bid?: number;
  ask?: number;
  last?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  rho?: number;
}

export interface MarketOption {
  ticker: string;
  type: 'Call' | 'Put';
  exerciseStyle?: ExerciseStyle;
  strike: number;
  expirationDate: string;
  daysToMaturity: number;
  bid: number;
  ask: number;
  last: number;
  impliedVolatility: number;
  volume?: number;
  openInterest?: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho?: number;
}

export interface MarketDataResponse {
  baseAsset: string;
  spotPrice: number;
  timestamp: string;
  source: MarketDataSource;
  chain: MarketOption[];
  diagnostics?: string;
  historicalVolatility?: number;
  ivHistory?: number[];
}

export interface MarketParams {
  spotPrice: number;
  riskFreeRate: number; // effective annual rate e.g. 0.1425 = 14.25% a.a.
  dividendYield: number; // unadjusted continuous dividend yield (0 for B3 strike-adjusted stocks)
  borrowRate?: number; // BTC / stock borrow annual rate e.g. 0.005 = 0.5% a.a.
  dayCountConvention: DayCountConvention;
  popDriftMode?: PopDriftMode;
}

export interface CostConfig {
  includeCosts: boolean;
  brokeragePerLeg: number; // R$ per leg on entry
  b3FeeRate: number; // decimal e.g. 0.000695 (0.0695% options B3)
  stockFeeRate: number; // decimal e.g. 0.0003 (0.03% stocks B3)
  includeExitCosts?: boolean; // estimate closing/exercise fees
  exerciseFeeRate?: number; // decimal e.g. 0.0003 over strike * qty when ITM at expiry
  exerciseBrokeragePerLeg?: number; // R$ per exercised leg
  includeIR: boolean;
  isDayTrade: boolean; // 20% day-trade vs 15% swing
  accumulatedLossOffset?: number; // R$ accumulated prior loss to offset taxable profit
}

export interface SimulationParams {
  targetSpot: number;
  daysElapsed: number; // days forward from today (0 = T+0)
  ivShiftPercent: number; // percentage points shift, e.g. -5 means -5pp IV
  ivShockMode?: IvShockMode;
}

export interface PayoffPoint {
  price: number;
  expiryPnl: number;
  theoreticalPnl: number;
  isStrike?: boolean;
}

export interface ScenarioCell {
  spot: number;
  spotChangePct: number;
  daysElapsed: number;
  pnl: number;
  roiPct: number | null;
}

export interface ScenarioMatrixData {
  dates: { daysElapsed: number; label: string; dteRemaining: number }[];
  rows: {
    spot: number;
    spotChangePct: number;
    cells: ScenarioCell[];
  }[];
  minPnl: number;
  maxPnl: number;
}

export interface RiskAlert {
  id: string;
  severity: 'danger' | 'warning' | 'info';
  title: string;
  description: string;
}

export interface CoreStressScenario {
  spotShockPct: number;
  volShockRelPct: number;
  scenarioSpot: number;
  closeoutPnl: number;
}

export interface MarginBreakdown {
  initialCashRequired: number;
  coreMarginRequired: number;
  totalCapitalRequired: number;
  bindingScenario: CoreStressScenario | null;
  scenariosEvaluated: number;
}

export interface CostBreakdown {
  entryCosts: number;
  estimatedExitOrExerciseCosts: number;
  irrfInformative: number;
}

export interface StrategyMetrics {
  netCost: number; // positive = debit (outflow), negative = credit (inflow)
  operationalCosts: number; // entry brokerage + B3 fees
  costBreakdown?: CostBreakdown;
  maxProfit: number | 'Ilimitado';
  maxLoss: number | 'Ilimitado';
  breakevens: number[];
  pop: number | null; // 0 to 100 (%)
  ror: number | null; // Return on Risk (%)
  estimatedMargin: number; // Total capital/margin commitment (CORE proxy)
  marginBreakdown?: MarginBreakdown;
  notionalDelta: number; // Delta * Spot in R$
  greeks: Greeks;
  alerts: RiskAlert[];
  isMultiExpiry: boolean;
  nearestDte: number;
}

export interface StrategyLegSpec {
  type: OptionType;
  action: ActionType;
  moneyness: number; // multiplier over spot, e.g. 1.0 = ATM, 1.05 = +5%
  quantity: number;
  expiryOffsetMonths?: number; // 0 = nearest expiry, 1 = next expiry
}

export interface StrategyTemplate {
  id: string;
  code: number;
  name: string;
  category: StrategyCategory;
  riskProfile: RiskProfile;
  complexity: ComplexityLevel;
  description: string;
  details: {
    thesis: string;
    mechanics: string;
    idealScenario: string;
    greeks: string;
  };
  legSpecs: StrategyLegSpec[];
}

export interface StrategyAdjustment {
  id: string;
  date: string; // ISO
  description: string;
  realizedCashflow: number; // positive = credit, negative = debit
}

export interface SavedStrategy {
  id: string;
  name: string;
  ticker: string;
  strategyTemplateName: string;
  status: TradeStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
  spotAtSave: number;
  marketParams: MarketParams;
  legs: Leg[];
  exitPnl?: number;
  closedAt?: string;
  adjustments?: StrategyAdjustment[];
  betaToIbov?: number;
}

export interface VolatilitySkewPoint {
  strike: number;
  moneynessPct: number;
  callIv: number | null;
  putIv: number | null;
  callDelta: number | null;
  putDelta: number | null;
}

export interface TermStructurePoint {
  expirationDate: string;
  label: string;
  calendarDays: number;
  businessDays: number;
  atmIv: number; // percentage e.g. 31.5
}

export interface VolatilitySummary {
  atmIv: number | null; // %
  skew25Delta: number | null; // Put 25d IV - Call 25d IV (pp)
  butterfly25Delta: number | null; // 0.5*(Put25d + Call25d) - ATM IV (pp)
  termRegime: 'Contango' | 'Backwardation' | 'Flat' | 'Indisponível';
  termSlopePp: number | null; // far ATM IV - near ATM IV (pp)
  hvReference: number | null; // %
  ivRank: number | null; // 0-100
  ivPercentile: number | null; // 0-100
  isEstimatedHistory: boolean;
}

export interface MarkedPosition {
  strategy: SavedStrategy;
  currentSpot: number;
  mtmSource: 'chain' | 'theoretical';
  unrealizedPnl: number;
  realizedAdjustmentsPnl: number;
  totalPnl: number;
  greeks: Greeks;
  notionalDelta: number;
  betaWeightedDeltaShares: number; // equivalent BOVA11 shares
  betaWeightedDeltaBRL: number;
  estimatedMargin: number;
  nearestDte: number;
  expired: boolean;
}

export interface PortfolioStressRow {
  ibovShockPct: number;
  estimatedPnlDelta: number;
  projectedTotalPnl: number;
}

export interface PortfolioSummary {
  benchmarkTicker: string;
  benchmarkSpot: number;
  openCount: number;
  closedCount: number;
  studyCount: number;
  totalUnrealizedPnl: number;
  totalRealizedPnl: number;
  totalAdjustmentsPnl: number;
  netPortfolioPnl: number;
  totalEstimatedMargin: number;
  totalGreeks: Greeks;
  totalNotionalDelta: number;
  totalBetaWeightedDeltaShares: number;
  totalBetaWeightedDeltaBRL: number;
  positions: MarkedPosition[];
  stressScenarios: PortfolioStressRow[];
}
