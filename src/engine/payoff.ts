import {
  CostConfig,
  Greeks,
  Leg,
  MarketParams,
  PayoffPoint,
  ScenarioMatrixData,
  SimulationParams,
} from '../types/options';
import { bsmGreeks, bsmPrice, intrinsicValue } from './blackScholes';
import { addDaysToDate, formatShortDateBR, getTimeToMaturityYears, toIsoDateString } from './calendar';

export function getActiveLegs(legs: Leg[]): Leg[] {
  return legs.filter((l) => l.enabled && l.quantity > 0);
}

export function getNearestDte(legs: Leg[]): number {
  const activeOptions = getActiveLegs(legs).filter((l) => l.type !== 'Stock');
  if (activeOptions.length === 0) return 30;
  return Math.max(1, Math.min(...activeOptions.map((l) => Math.max(0, l.daysToMaturity))));
}

export function isMultiExpiryStrategy(legs: Leg[]): boolean {
  const activeOptions = getActiveLegs(legs).filter((l) => l.type !== 'Stock');
  if (activeOptions.length <= 1) return false;
  const uniqueDates = new Set(activeOptions.map((l) => l.expirationDate || String(l.daysToMaturity)));
  return uniqueDates.size > 1;
}

/**
 * Estimates total entry operational costs on B3 (brokerage + emoluments/registration fees).
 */
export function calculateOperationalCosts(legs: Leg[], costConfig: CostConfig): number {
  if (!costConfig.includeCosts) return 0;
  const active = getActiveLegs(legs);
  if (active.length === 0) return 0;

  return active.reduce((acc, leg) => {
    const notional = Math.abs(leg.quantity * leg.price);
    const feeRate = leg.type === 'Stock' ? costConfig.stockFeeRate : costConfig.b3FeeRate;
    const b3Fee = notional * feeRate;
    return acc + costConfig.brokeragePerLeg + b3Fee;
  }, 0);
}

export function applyCostsAndIR(
  grossPnl: number,
  operationalCosts: number,
  costConfig: CostConfig
): number {
  if (!costConfig.includeCosts) return grossPnl;
  const afterFees = grossPnl - operationalCosts;
  if (costConfig.includeIR && afterFees > 0) {
    const irRate = costConfig.isDayTrade ? 0.2 : 0.15;
    return afterFees * (1 - irRate);
  }
  return afterFees;
}

/**
 * Computes the theoretical or expiry value of a single leg at a given underlying price and elapsed days.
 */
export function evaluateLegValue(
  leg: Leg,
  spot: number,
  daysElapsed: number,
  ivShiftPercent: number,
  marketParams: MarketParams
): number {
  if (leg.type === 'Stock') return Math.max(0, spot);

  const remainingDays = Math.max(0, leg.daysToMaturity - daysElapsed);
  if (remainingDays <= 0) {
    return intrinsicValue(leg.type, spot, leg.strike);
  }

  const T = getTimeToMaturityYears(remainingDays, marketParams.dayCountConvention);
  const baseIv = leg.impliedVolatility > 0 ? leg.impliedVolatility : 0.35;
  const adjustedIv = Math.max(0.01, baseIv + ivShiftPercent / 100);

  return bsmPrice({
    S: spot,
    K: leg.strike,
    T,
    r: marketParams.riskFreeRate,
    q: marketParams.dividendYield,
    sigma: adjustedIv,
    type: leg.type,
  });
}

/**
 * Evaluates total strategy PnL at a specific underlying spot and elapsed days.
 */
export function evaluateStrategyPnl(
  legs: Leg[],
  spot: number,
  daysElapsed: number,
  ivShiftPercent: number,
  marketParams: MarketParams,
  costConfig: CostConfig
): number {
  const active = getActiveLegs(legs);
  if (active.length === 0) return 0;

  let grossPnl = 0;
  for (const leg of active) {
    const legVal = evaluateLegValue(leg, spot, daysElapsed, ivShiftPercent, marketParams);
    const direction = leg.action === 'Buy' ? 1 : -1;
    grossPnl += direction * (legVal - leg.price) * leg.quantity;
  }

  const opCosts = calculateOperationalCosts(active, costConfig);
  return applyCostsAndIR(grossPnl, opCosts, costConfig);
}

/**
 * Evaluates aggregate portfolio Greeks at any target spot / daysElapsed / IV shift.
 */
export function evaluatePortfolioGreeks(
  legs: Leg[],
  spot: number,
  daysElapsed: number,
  ivShiftPercent: number,
  marketParams: MarketParams
): Greeks {
  const active = getActiveLegs(legs);
  const total: Greeks = { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };

  for (const leg of active) {
    const direction = leg.action === 'Buy' ? 1 : -1;
    const remainingDays = Math.max(0, leg.daysToMaturity - daysElapsed);
    const T = getTimeToMaturityYears(remainingDays, marketParams.dayCountConvention);
    const baseIv = leg.impliedVolatility > 0 ? leg.impliedVolatility : 0.35;
    const adjustedIv = Math.max(0.01, baseIv + ivShiftPercent / 100);

    const g = bsmGreeks(
      {
        S: spot,
        K: leg.strike,
        T,
        r: marketParams.riskFreeRate,
        q: marketParams.dividendYield,
        sigma: adjustedIv,
        type: leg.type,
      },
      marketParams.dayCountConvention
    );

    total.delta += g.delta * leg.quantity * direction;
    total.gamma += g.gamma * leg.quantity * direction;
    total.theta += g.theta * leg.quantity * direction;
    total.vega += g.vega * leg.quantity * direction;
    total.rho += g.rho * leg.quantity * direction;
  }

  return total;
}

/**
 * Builds an adaptive price grid that includes exact strikes and spot price
 * so option payoff kinks are rendered with mathematical precision.
 */
export function buildPriceGrid(
  legs: Leg[],
  spotPrice: number,
  rangePercent = 0.25,
  steps = 120
): { prices: number[]; minPrice: number; maxPrice: number; strikeSet: Set<number> } {
  const safeSpot = Math.max(1, spotPrice);
  const active = getActiveLegs(legs);
  const strikes = active.filter((l) => l.type !== 'Stock' && l.strike > 0).map((l) => l.strike);

  let minPrice = Math.max(0.01, safeSpot * (1 - rangePercent));
  let maxPrice = safeSpot * (1 + rangePercent);

  if (strikes.length > 0) {
    const minStrike = Math.min(...strikes);
    const maxStrike = Math.max(...strikes);
    minPrice = Math.max(0.01, Math.min(minPrice, minStrike * 0.88));
    maxPrice = Math.max(maxPrice, maxStrike * 1.12);
  }

  const strikeSet = new Set(strikes.map((s) => Number(s.toFixed(2))));
  const pointSet = new Set<number>();
  const step = (maxPrice - minPrice) / steps;

  for (let i = 0; i <= steps; i++) {
    pointSet.add(Number((minPrice + i * step).toFixed(4)));
  }

  pointSet.add(Number(safeSpot.toFixed(4)));
  for (const s of strikes) {
    if (s >= minPrice && s <= maxPrice) {
      pointSet.add(Number(s.toFixed(4)));
    }
  }

  const prices = Array.from(pointSet).sort((a, b) => a - b);
  return { prices, minPrice, maxPrice, strikeSet };
}

/**
 * Generates the dual payoff series: Expiration (at nearest expiry) and Theoretical (T+N).
 */
export function calculatePayoffSeries(
  legs: Leg[],
  marketParams: MarketParams,
  simParams: SimulationParams,
  costConfig: CostConfig,
  rangePercent = 0.25
): { points: PayoffPoint[]; minPrice: number; maxPrice: number } {
  const { prices, minPrice, maxPrice, strikeSet } = buildPriceGrid(
    legs,
    marketParams.spotPrice,
    rangePercent
  );
  const nearestDte = getNearestDte(legs);
  const clampedDays = Math.min(Math.max(0, simParams.daysElapsed), nearestDte);

  const points: PayoffPoint[] = prices.map((price) => ({
    price,
    expiryPnl: Number(
      evaluateStrategyPnl(legs, price, nearestDte, simParams.ivShiftPercent, marketParams, costConfig).toFixed(2)
    ),
    theoreticalPnl: Number(
      evaluateStrategyPnl(legs, price, clampedDays, simParams.ivShiftPercent, marketParams, costConfig).toFixed(2)
    ),
    isStrike: strikeSet.has(Number(price.toFixed(2))),
  }));

  return { points, minPrice, maxPrice };
}

/**
 * Builds the 2D Price x Time Scenario Matrix (Heatmap) for Trader PF analysis.
 */
export function calculateScenarioMatrix(
  legs: Leg[],
  marketParams: MarketParams,
  costConfig: CostConfig,
  ivShiftPercent: number,
  capitalBase: number,
  rangePercent = 0.2
): ScenarioMatrixData {
  const nearestDte = getNearestDte(legs);
  const today = new Date();

  // 6 time slices from T+0 to Expiry
  const rawSteps = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const seenDays = new Set<number>();
  const dates: { daysElapsed: number; label: string; dteRemaining: number }[] = [];

  for (const frac of rawSteps) {
    const d = Math.round(nearestDte * frac);
    if (!seenDays.has(d)) {
      seenDays.add(d);
      const dt = addDaysToDate(today, d);
      const label =
        d === 0
          ? 'Hoje'
          : d === nearestDte
          ? `Venc. (${formatShortDateBR(toIsoDateString(dt))})`
          : formatShortDateBR(toIsoDateString(dt));
      dates.push({
        daysElapsed: d,
        label,
        dteRemaining: Math.max(0, nearestDte - d),
      });
    }
  }

  // 11 spot rows from +rangePercent down to -rangePercent
  const rowCount = 11;
  const rows: ScenarioMatrixData['rows'] = [];
  let minPnl = Infinity;
  let maxPnl = -Infinity;

  for (let i = 0; i < rowCount; i++) {
    const pct = rangePercent - (i * (2 * rangePercent)) / (rowCount - 1);
    const spot = Math.max(0.01, Number((marketParams.spotPrice * (1 + pct)).toFixed(2)));
    const cells = dates.map((d) => {
      const pnl = Number(
        evaluateStrategyPnl(legs, spot, d.daysElapsed, ivShiftPercent, marketParams, costConfig).toFixed(2)
      );
      if (pnl < minPnl) minPnl = pnl;
      if (pnl > maxPnl) maxPnl = pnl;
      const roiPct = capitalBase > 0 ? Number(((pnl / capitalBase) * 100).toFixed(1)) : null;
      return {
        spot,
        spotChangePct: Number((pct * 100).toFixed(1)),
        daysElapsed: d.daysElapsed,
        pnl,
        roiPct,
      };
    });

    rows.push({
      spot,
      spotChangePct: Number((pct * 100).toFixed(1)),
      cells,
    });
  }

  return {
    dates,
    rows,
    minPnl: Number.isFinite(minPnl) ? minPnl : 0,
    maxPnl: Number.isFinite(maxPnl) ? maxPnl : 0,
  };
}
