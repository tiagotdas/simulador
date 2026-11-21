export type OptionType = 'Call' | 'Put' | 'Stock';
export type ActionType = 'Buy' | 'Sell';
export type DayCountConvention = 'du252' | 'dc365';
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
}

export interface Leg {
  id: string;
  ticker?: string;
  type: OptionType;
  action: ActionType;
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
}

export interface MarketParams {
  spotPrice: number;
  riskFreeRate: number; // decimal e.g. 0.1425 = 14.25%
  dividendYield: number; // decimal e.g. 0.08 = 8%
  dayCountConvention: DayCountConvention;
}

export interface CostConfig {
  includeCosts: boolean;
  brokeragePerLeg: number; // R$ per leg
  b3FeeRate: number; // decimal e.g. 0.000695 (0.0695% options B3)
  stockFeeRate: number; // decimal e.g. 0.0003 (0.03% stocks B3)
  includeIR: boolean;
  isDayTrade: boolean; // 20% day-trade vs 15% swing
}

export interface SimulationParams {
  targetSpot: number;
  daysElapsed: number; // days forward from today (0 = T+0)
  ivShiftPercent: number; // percentage points shift, e.g. -5 means -5pp IV
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

export interface StrategyMetrics {
  netCost: number; // positive = debit (outflow), negative = credit (inflow)
  operationalCosts: number; // brokerage + B3 fees
  maxProfit: number | 'Ilimitado';
  maxLoss: number | 'Ilimitado';
  breakevens: number[];
  pop: number | null; // 0 to 100 (%)
  ror: number | null; // Return on Risk (%)
  estimatedMargin: number; // Estimated B3 margin / capital required
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
}
