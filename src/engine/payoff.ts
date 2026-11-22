import {
  CostBreakdown,
  CostConfig,
  Greeks,
  IvShockMode,
  Leg,
  MarketParams,
  PayoffPoint,
  ScenarioMatrixData,
  SimulationParams,
} from '../types/options';
import { greeksOption, priceOption } from './americanPricing';
import { getContinuousMarketRates, intrinsicValue } from './blackScholes';
import {
  addDaysToDate,
  formatShortDateBR,
  getTimeToMaturityYears,
  toIsoDateString,
} from './calendar';

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
 * Computes effective IV after applying either a parallel shift or a skew/term-aware shock.
 */
export function computeAdjustedIv(
  leg: Leg,
  spot: number,
  remainingDays: number,
  ivShiftPercent: number,
  ivShockMode: IvShockMode = 'parallel'
): number {
  const baseIv = leg.impliedVolatility > 0 ? leg.impliedVolatility : 0.35;
  if (ivShiftPercent === 0) return Math.max(0.01, baseIv);

  if (ivShockMode === 'skew-aware') {
    // Shorter-dated and OTM wings react more strongly to volatility regime shifts
    const termFactor = Math.min(1.8, Math.max(0.6, Math.sqrt(30 / Math.max(5, remainingDays))));
    const moneynessDist = spot > 0 ? Math.abs(leg.strike / spot - 1) : 0;
    const wingFactor = 1 + Math.min(0.6, moneynessDist * 2.0);
    return Math.max(0.01, baseIv + (ivShiftPercent / 100) * termFactor * wingFactor);
  }

  return Math.max(0.01, baseIv + ivShiftPercent / 100);
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

/**
 * Estimates closing or B3 automatic exercise costs for a given spot and elapsed days.
 * - At expiry (remainingDays <= 0): ITM options incur exercise fees over NOTIONAL (strike * qty),
 *   matching B3's exercise fee convention. OTM options expire at zero exit cost.
 * - Prior to expiry (remainingDays > 0): closing fees apply over theoretical exit value.
 */
export function calculateExitOrExerciseCosts(
  legs: Leg[],
  spot: number,
  daysElapsed: number,
  ivShiftPercent: number,
  marketParams: MarketParams,
  costConfig: CostConfig,
  ivShockMode: IvShockMode = 'parallel'
): number {
  if (!costConfig.includeCosts || !costConfig.includeExitCosts) return 0;
  const active = getActiveLegs(legs);
  if (active.length === 0) return 0;

  const exerciseRate = costConfig.exerciseFeeRate ?? costConfig.stockFeeRate;
  const exerciseBrokerage = costConfig.exerciseBrokeragePerLeg ?? costConfig.brokeragePerLeg;

  return active.reduce((acc, leg) => {
    if (leg.type === 'Stock') {
      const exitNotional = Math.abs(leg.quantity * Math.max(0, spot));
      return acc + costConfig.brokeragePerLeg + exitNotional * costConfig.stockFeeRate;
    }

    const remainingDays = Math.max(0, leg.daysToMaturity - daysElapsed);
    if (remainingDays <= 0) {
      const isItm =
        (leg.type === 'Call' && spot > leg.strike) ||
        (leg.type === 'Put' && spot < leg.strike);
      if (!isItm) return acc; // Expires worthless -> zero exercise cost
      const exerciseNotional = Math.abs(leg.quantity * leg.strike);
      return acc + exerciseBrokerage + exerciseNotional * exerciseRate;
    }

    const exitPrice = evaluateLegValue(
      leg,
      spot,
      daysElapsed,
      ivShiftPercent,
      marketParams,
      ivShockMode
    );
    const exitNotional = Math.abs(leg.quantity * exitPrice);
    return acc + costConfig.brokeragePerLeg + exitNotional * costConfig.b3FeeRate;
  }, 0);
}

/**
 * Computes full cost breakdown (entry, estimated exit/exercise at current spot/nearest expiry, and informative IRRF).
 */
export function calculateCostBreakdown(
  legs: Leg[],
  marketParams: MarketParams,
  costConfig: CostConfig,
  ivShiftPercent = 0,
  ivShockMode: IvShockMode = 'parallel'
): CostBreakdown {
  const active = getActiveLegs(legs);
  const entryCosts = calculateOperationalCosts(active, costConfig);
  const nearestDte = getNearestDte(active);
  const estimatedExitOrExerciseCosts = calculateExitOrExerciseCosts(
    active,
    marketParams.spotPrice,
    nearestDte,
    ivShiftPercent,
    marketParams,
    costConfig,
    ivShockMode
  );

  // Informative IRRF ("dedo-duro"): 0.005% on sell turnover for Swing (or 1% on positive profit for Day-Trade)
  let irrfInformative = 0;
  if (costConfig.includeCosts && costConfig.includeIR) {
    const sellTurnover = active
      .filter((l) => l.action === 'Sell')
      .reduce((sum, l) => sum + l.quantity * l.price, 0);
    irrfInformative = costConfig.isDayTrade ? sellTurnover * 0.0001 : sellTurnover * 0.00005;
  }

  return {
    entryCosts: Number(entryCosts.toFixed(2)),
    estimatedExitOrExerciseCosts: Number(estimatedExitOrExerciseCosts.toFixed(2)),
    irrfInformative: Number(irrfInformative.toFixed(2)),
  };
}

/**
 * Applies B3 operational costs and Brazilian IR (15% Swing / 20% Day-Trade),
 * respecting accumulated prior loss offset (`accumulatedLossOffset`).
 */
export function applyCostsAndIR(
  grossPnl: number,
  totalOperationalCosts: number,
  costConfig: CostConfig
): number {
  if (!costConfig.includeCosts) return grossPnl;
  const afterFees = grossPnl - totalOperationalCosts;
  if (costConfig.includeIR && afterFees > 0) {
    const lossOffset = Math.max(0, costConfig.accumulatedLossOffset ?? 0);
    const taxableProfit = Math.max(0, afterFees - lossOffset);
    const irRate = costConfig.isDayTrade ? 0.2 : 0.15;
    return afterFees - taxableProfit * irRate;
  }
  return afterFees;
}

/**
 * Computes the theoretical or expiry value of a single leg at a given underlying price and elapsed days.
 * Uses continuous B3 rates (ln(1+r)) and dispatches to American or European pricer per leg.
 */
export function evaluateLegValue(
  leg: Leg,
  spot: number,
  daysElapsed: number,
  ivShiftPercent: number,
  marketParams: MarketParams,
  ivShockMode: IvShockMode = 'parallel'
): number {
  if (leg.type === 'Stock') return Math.max(0, spot);

  const remainingDays = Math.max(0, leg.daysToMaturity - daysElapsed);
  if (remainingDays <= 0) {
    return intrinsicValue(leg.type, spot, leg.strike);
  }

  const T = getTimeToMaturityYears(
    remainingDays,
    marketParams.dayCountConvention,
    leg.expirationDate
  );
  const adjustedIv = computeAdjustedIv(leg, spot, remainingDays, ivShiftPercent, ivShockMode);
  const { rCont, qCont } = getContinuousMarketRates(marketParams);

  return priceOption({
    S: spot,
    K: leg.strike,
    T,
    r: rCont,
    q: qCont,
    sigma: adjustedIv,
    type: leg.type,
    exerciseStyle: leg.exerciseStyle ?? 'European',
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
  costConfig: CostConfig,
  ivShockMode: IvShockMode = 'parallel'
): number {
  const active = getActiveLegs(legs);
  if (active.length === 0) return 0;

  let grossPnl = 0;
  for (const leg of active) {
    const legVal = evaluateLegValue(
      leg,
      spot,
      daysElapsed,
      ivShiftPercent,
      marketParams,
      ivShockMode
    );
    const direction = leg.action === 'Buy' ? 1 : -1;
    grossPnl += direction * (legVal - leg.price) * leg.quantity;
  }

  const entryCosts = calculateOperationalCosts(active, costConfig);
  const exitCosts = calculateExitOrExerciseCosts(
    active,
    spot,
    daysElapsed,
    ivShiftPercent,
    marketParams,
    costConfig,
    ivShockMode
  );
  return applyCostsAndIR(grossPnl, entryCosts + exitCosts, costConfig);
}

/**
 * Evaluates aggregate portfolio 1st & 2nd order Greeks at any target spot / daysElapsed / IV shift.
 */
export function evaluatePortfolioGreeks(
  legs: Leg[],
  spot: number,
  daysElapsed: number,
  ivShiftPercent: number,
  marketParams: MarketParams,
  ivShockMode: IvShockMode = 'parallel'
): Greeks {
  const active = getActiveLegs(legs);
  const total: Greeks = {
    delta: 0,
    gamma: 0,
    theta: 0,
    vega: 0,
    rho: 0,
    vanna: 0,
    volga: 0,
    charm: 0,
  };
  const { rCont, qCont } = getContinuousMarketRates(marketParams);

  for (const leg of active) {
    const direction = leg.action === 'Buy' ? 1 : -1;
    const remainingDays = Math.max(0, leg.daysToMaturity - daysElapsed);
    const T = getTimeToMaturityYears(
      remainingDays,
      marketParams.dayCountConvention,
      leg.expirationDate
    );
    const adjustedIv = computeAdjustedIv(leg, spot, remainingDays, ivShiftPercent, ivShockMode);

    const g = greeksOption(
      {
        S: spot,
        K: leg.strike,
        T,
        r: rCont,
        q: qCont,
        sigma: adjustedIv,
        type: leg.type,
        exerciseStyle: leg.exerciseStyle ?? 'European',
      },
      marketParams.dayCountConvention
    );

    const weight = leg.quantity * direction;
    total.delta += g.delta * weight;
    total.gamma += g.gamma * weight;
    total.theta += g.theta * weight;
    total.vega += g.vega * weight;
    total.rho += g.rho * weight;
    total.vanna = (total.vanna ?? 0) + (g.vanna ?? 0) * weight;
    total.volga = (total.volga ?? 0) + (g.volga ?? 0) * weight;
    total.charm = (total.charm ?? 0) + (g.charm ?? 0) * weight;
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
  const shockMode = simParams.ivShockMode ?? 'parallel';

  const points: PayoffPoint[] = prices.map((price) => ({
    price,
    expiryPnl: Number(
      evaluateStrategyPnl(
        legs,
        price,
        nearestDte,
        simParams.ivShiftPercent,
        marketParams,
        costConfig,
        shockMode
      ).toFixed(2)
    ),
    theoreticalPnl: Number(
      evaluateStrategyPnl(
        legs,
        price,
        clampedDays,
        simParams.ivShiftPercent,
        marketParams,
        costConfig,
        shockMode
      ).toFixed(2)
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
  rangePercent = 0.2,
  ivShockMode: IvShockMode = 'parallel'
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
        evaluateStrategyPnl(
          legs,
          spot,
          d.daysElapsed,
          ivShiftPercent,
          marketParams,
          costConfig,
          ivShockMode
        ).toFixed(2)
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
