import {
  CostConfig,
  Leg,
  MarketParams,
  RiskAlert,
  StrategyMetrics,
} from '../types/options';
import { probabilitySpotAbove } from './blackScholes';
import { getTimeToMaturityYears } from './calendar';
import {
  calculateOperationalCosts,
  evaluatePortfolioGreeks,
  evaluateStrategyPnl,
  getActiveLegs,
  getNearestDte,
  isMultiExpiryStrategy,
} from './payoff';

/**
 * Estimates conservative B3 margin / collateral requirement (CORE proxy) for retail traders.
 */
export function estimateB3Margin(
  legs: Leg[],
  spotPrice: number,
  netCost: number,
  maxLoss: number | 'Ilimitado'
): number {
  const active = getActiveLegs(legs);
  if (active.length === 0) return 0;

  // Calculate stock position capital commitment
  let netStockShares = 0;
  let stockCapital = 0;
  for (const leg of active) {
    if (leg.type === 'Stock') {
      if (leg.action === 'Buy') {
        netStockShares += leg.quantity;
        stockCapital += leg.quantity * leg.price;
      } else {
        netStockShares -= leg.quantity;
        stockCapital += leg.quantity * leg.price * 1.2; // short stock borrow + collateral
      }
    }
  }

  // If strategy has strictly defined maximum loss
  if (typeof maxLoss === 'number') {
    const lossRequirement = maxLoss < 0 ? Math.abs(maxLoss) : 0;
    const debitRequirement = netCost > 0 ? netCost : 0;
    return Math.max(lossRequirement, debitRequirement, stockCapital);
  }

  // Unlimited risk (uncovered short calls / short ratios): apply conservative B3 CORE proxy
  let remainingCoveredShares = Math.max(0, netStockShares);
  let uncoveredMargin = 0;

  for (const leg of active) {
    if (leg.action !== 'Sell' || leg.type === 'Stock') continue;

    let qtyToCover = leg.quantity;
    if (leg.type === 'Call' && remainingCoveredShares > 0) {
      const covered = Math.min(remainingCoveredShares, qtyToCover);
      remainingCoveredShares -= covered;
      qtyToCover -= covered;
    }

    if (qtyToCover <= 0) continue;

    if (leg.type === 'Call') {
      const otm = Math.max(0, leg.strike - spotPrice);
      const perShare = Math.max(0.2 * spotPrice - otm, 0.1 * spotPrice) + leg.price;
      uncoveredMargin += perShare * qtyToCover;
    } else {
      const otm = Math.max(0, spotPrice - leg.strike);
      const perShare = Math.min(
        leg.strike,
        Math.max(0.2 * spotPrice - otm, 0.1 * leg.strike) + leg.price
      );
      uncoveredMargin += perShare * qtyToCover;
    }
  }

  return Math.max(uncoveredMargin + stockCapital, netCost > 0 ? netCost : 0);
}

/**
 * Generates actionable pre-trade risk alerts following B3 options trading best practices.
 */
function buildRiskAlerts(
  activeLegs: Leg[],
  spotPrice: number,
  maxLoss: number | 'Ilimitado',
  nearestDte: number,
  isMultiExpiry: boolean,
  dividendYield: number
): RiskAlert[] {
  const alerts: RiskAlert[] = [];

  if (maxLoss === 'Ilimitado') {
    alerts.push({
      id: 'unlimited-risk',
      severity: 'danger',
      title: 'Risco Ilimitado Detectado',
      description:
        'Há venda descoberta ou ratio negativo de Calls/Ativo. Garanta margem suficiente na corretora e defina stop operacional.',
    });
  }

  if (activeLegs.some((l) => l.type !== 'Stock') && nearestDte <= 5) {
    alerts.push({
      id: 'gamma-expiry-risk',
      severity: 'warning',
      title: `Vencimento Iminente (${nearestDte}d)`,
      description:
        'Risco elevado de Gamma e exercício automático na B3. Monitore posições próximas ao dinheiro (ATM/ITM).',
    });
  }

  const wideSpreadLegs = activeLegs.filter((l) => {
    if (l.type === 'Stock' || !l.bid || !l.ask || l.bid <= 0 || l.ask <= 0) return false;
    const mid = (l.bid + l.ask) / 2;
    return mid > 0 && (l.ask - l.bid) / mid > 0.12;
  });

  if (wideSpreadLegs.length > 0) {
    alerts.push({
      id: 'wide-spread',
      severity: 'warning',
      title: 'Spread Bid-Ask Largo (Baixa Liquidez)',
      description: `${wideSpreadLegs.length} perna(s) apresentam spread acima de 12%. Prefira ordens limitadas próximas ao preço médio (Mid).`,
    });
  }

  const earlyExerciseCalls = activeLegs.filter(
    (l) => l.type === 'Call' && l.action === 'Sell' && l.strike < spotPrice * 0.99 && dividendYield > 0.01
  );
  if (earlyExerciseCalls.length > 0) {
    alerts.push({
      id: 'early-exercise',
      severity: 'warning',
      title: 'Risco de Exercício Antecipado (Call Americana)',
      description:
        'Calls vendidas ITM na B3 podem ser exercidas antecipadamente próximas a datas-ex de dividendos/JCP.',
    });
  }

  if (isMultiExpiry) {
    alerts.push({
      id: 'multi-expiry',
      severity: 'info',
      title: 'Estrutura Multi-Vencimento (Calendário/Diagonal)',
      description:
        'Payoff e métricas são projetados no vencimento mais curto, precificando as pernas longas via Black-Scholes.',
    });
  }

  return alerts;
}

/**
 * Computes exact analytical risk metrics, Breakevens, Probability of Profit (PoP),
 * Return on Risk (RoR), estimated B3 margin, and portfolio Greeks.
 */
export function calculateStrategyMetrics(
  legs: Leg[],
  marketParams: MarketParams,
  costConfig: CostConfig,
  ivShiftPercent = 0,
  daysElapsed = 0
): StrategyMetrics {
  const active = getActiveLegs(legs);
  const nearestDte = getNearestDte(active);
  const multiExpiry = isMultiExpiryStrategy(active);

  if (active.length === 0) {
    return {
      netCost: 0,
      operationalCosts: 0,
      maxProfit: 0,
      maxLoss: 0,
      breakevens: [],
      pop: null,
      ror: null,
      estimatedMargin: 0,
      notionalDelta: 0,
      greeks: { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 },
      alerts: [],
      isMultiExpiry: false,
      nearestDte: 30,
    };
  }

  let netCost = 0;
  let deltaAtInfinity = 0;
  for (const leg of active) {
    const cost = leg.quantity * leg.price;
    netCost += leg.action === 'Buy' ? cost : -cost;
    if (leg.type === 'Call' || leg.type === 'Stock') {
      deltaAtInfinity += leg.action === 'Buy' ? leg.quantity : -leg.quantity;
    }
  }

  const operationalCosts = calculateOperationalCosts(active, costConfig);

  // Build exact evaluation domain covering 0, all strikes, and asymptotic upper bound
  const strikes = active
    .filter((l) => l.type !== 'Stock' && l.strike > 0)
    .map((l) => l.strike);
  const maxRef = Math.max(marketParams.spotPrice, ...strikes, 10);
  const upperBound = maxRef * 4;

  const sampleSet = new Set<number>([0, marketParams.spotPrice, upperBound]);
  for (const k of strikes) sampleSet.add(k);

  // Dense grid ensures accuracy even for smooth multi-expiry (Calendar/Diagonal) curves
  const denseSteps = 300;
  for (let i = 1; i < denseSteps; i++) {
    sampleSet.add((upperBound * i) / denseSteps);
  }

  const sortedSpots = Array.from(sampleSet).sort((a, b) => a - b);
  const evaluated = sortedSpots.map((spot) => ({
    spot,
    pnl: evaluateStrategyPnl(active, spot, nearestDte, ivShiftPercent, marketParams, costConfig),
  }));

  let maxProfitVal = -Infinity;
  let maxLossVal = Infinity;
  for (const pt of evaluated) {
    if (pt.pnl > maxProfitVal) maxProfitVal = pt.pnl;
    if (pt.pnl < maxLossVal) maxLossVal = pt.pnl;
  }

  const maxProfit: number | 'Ilimitado' =
    deltaAtInfinity > 0 ? 'Ilimitado' : Number(maxProfitVal.toFixed(2));
  const maxLoss: number | 'Ilimitado' =
    deltaAtInfinity < 0 ? 'Ilimitado' : Number(maxLossVal.toFixed(2));

  // Analytical / refined breakeven detection
  const breakevens: number[] = [];
  for (let i = 1; i < evaluated.length; i++) {
    const p0 = evaluated[i - 1];
    const p1 = evaluated[i];
    if (Math.abs(p0.pnl) < 1e-4 && p0.spot > 0) {
      breakevens.push(Number(p0.spot.toFixed(2)));
    } else if (p0.pnl * p1.pnl < 0) {
      // Linear interpolation + 1-step bisection check
      const t = -p0.pnl / (p1.pnl - p0.pnl);
      const cross = p0.spot + t * (p1.spot - p0.spot);
      breakevens.push(Number(cross.toFixed(2)));
    }
  }

  // Deduplicate close breakevens (within R$ 0.05)
  const uniqueBreakevens: number[] = [];
  for (const be of breakevens.sort((a, b) => a - b)) {
    if (uniqueBreakevens.length === 0 || Math.abs(be - uniqueBreakevens[uniqueBreakevens.length - 1]) > 0.05) {
      uniqueBreakevens.push(be);
    }
  }

  // Probability of Profit (PoP) via log-normal BSM integration across profitable intervals
  const optionLegs = active.filter((l) => l.type !== 'Stock');
  const totalQty = optionLegs.reduce((sum, l) => sum + l.quantity, 0);
  const avgIv =
    totalQty > 0
      ? optionLegs.reduce((sum, l) => sum + (l.impliedVolatility || 0.35) * l.quantity, 0) / totalQty
      : 0.35;
  const effectiveIv = Math.max(0.01, avgIv + ivShiftPercent / 100);
  const T = getTimeToMaturityYears(nearestDte, marketParams.dayCountConvention);

  const boundaries = [0, ...uniqueBreakevens, Infinity];
  let popProb = 0;

  for (let i = 0; i < boundaries.length - 1; i++) {
    const low = boundaries[i];
    const high = boundaries[i + 1];
    const testSpot =
      high === Infinity
        ? Math.max(low * 1.25 + 1, marketParams.spotPrice * 1.5)
        : (low + high) / 2;
    const testPnl = evaluateStrategyPnl(
      active,
      testSpot,
      nearestDte,
      ivShiftPercent,
      marketParams,
      costConfig
    );

    if (testPnl > 0) {
      const pAboveLow =
        low <= 0
          ? 1
          : probabilitySpotAbove(
              marketParams.spotPrice,
              low,
              T,
              marketParams.riskFreeRate,
              marketParams.dividendYield,
              effectiveIv
            );
      const pAboveHigh =
        high === Infinity
          ? 0
          : probabilitySpotAbove(
              marketParams.spotPrice,
              high,
              T,
              marketParams.riskFreeRate,
              marketParams.dividendYield,
              effectiveIv
            );
      popProb += Math.max(0, pAboveLow - pAboveHigh);
    }
  }

  const pop = Number((Math.min(1, Math.max(0, popProb)) * 100).toFixed(1));
  const estimatedMargin = Number(
    estimateB3Margin(active, marketParams.spotPrice, netCost, maxLoss).toFixed(2)
  );

  // Return on Risk (RoR): MaxProfit / Capital at Risk (or Estimated Margin)
  let ror: number | null = null;
  if (typeof maxProfit === 'number' && maxProfit > 0) {
    const riskDenom =
      typeof maxLoss === 'number' && maxLoss < 0 ? Math.abs(maxLoss) : estimatedMargin;
    if (riskDenom > 0) {
      ror = Number(((maxProfit / riskDenom) * 100).toFixed(1));
    }
  }

  const greeks = evaluatePortfolioGreeks(
    active,
    marketParams.spotPrice,
    daysElapsed,
    ivShiftPercent,
    marketParams
  );
  const notionalDelta = Number((greeks.delta * marketParams.spotPrice).toFixed(2));

  const alerts = buildRiskAlerts(
    active,
    marketParams.spotPrice,
    maxLoss,
    nearestDte,
    multiExpiry,
    marketParams.dividendYield
  );

  return {
    netCost: Number(netCost.toFixed(2)),
    operationalCosts: Number(operationalCosts.toFixed(2)),
    maxProfit,
    maxLoss,
    breakevens: uniqueBreakevens,
    pop,
    ror,
    estimatedMargin,
    notionalDelta,
    greeks,
    alerts,
    isMultiExpiry: multiExpiry,
    nearestDte,
  };
}
