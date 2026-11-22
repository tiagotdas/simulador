import {
  CostConfig,
  IvShockMode,
  Leg,
  MarketOption,
  MarketParams,
  RiskAlert,
  StrategyMetrics,
} from '../types/options';
import { getContinuousMarketRates, probabilitySpotAbove } from './blackScholes';
import { getTimeToMaturityYears } from './calendar';
import { evaluateCoreMarginProxy } from './marginCore';
import {
  calculateCostBreakdown,
  calculateOperationalCosts,
  evaluatePortfolioGreeks,
  evaluateStrategyPnl,
  getActiveLegs,
  getNearestDte,
  isMultiExpiryStrategy,
} from './payoff';

/**
 * Estimates conservative B3 margin / collateral requirement via the 2D Stress CORE Proxy.
 */
export function estimateB3Margin(
  legs: Leg[],
  marketParamsOrSpot: MarketParams | number,
  netCost: number
): number {
  const mp: MarketParams =
    typeof marketParamsOrSpot === 'number'
      ? {
          spotPrice: marketParamsOrSpot,
          riskFreeRate: 0.1425,
          dividendYield: 0,
          borrowRate: 0.005,
          dayCountConvention: 'du252',
        }
      : marketParamsOrSpot;
  return evaluateCoreMarginProxy(legs, mp, netCost).totalCapitalRequired;
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
  effectiveCarryYield: number
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
    (l) =>
      l.type === 'Call' &&
      l.action === 'Sell' &&
      (l.exerciseStyle ?? 'American') === 'American' &&
      l.strike < spotPrice * 0.99 &&
      effectiveCarryYield > 0.01
  );
  if (earlyExerciseCalls.length > 0) {
    alerts.push({
      id: 'early-exercise',
      severity: 'warning',
      title: 'Risco de Exercício Antecipado (Call Americana)',
      description:
        'Calls americanas vendidas ITM podem sofrer exercício antecipado quando há custo de carregamento/proventos não ajustados relevante.',
    });
  }

  if (isMultiExpiry) {
    alerts.push({
      id: 'multi-expiry',
      severity: 'info',
      title: 'Estrutura Multi-Vencimento (Calendário/Diagonal)',
      description:
        'Payoff e métricas são projetados no vencimento mais curto, precificando as pernas longas pelo motor B3 (BSM/Americano).',
    });
  }

  return alerts;
}

/**
 * Resolves the best IV to evaluate spot probability at a given threshold:
 * prefers nearest-expiry market chain skew interpolation if available,
 * otherwise uses quantity-weighted IV of nearest-expiry strategy legs.
 */
function resolveIvAtThreshold(
  threshold: number,
  nearestLegs: Leg[],
  fallbackIv: number,
  ivShiftPercent: number,
  nearestExpiryDate: string | undefined,
  marketChain?: MarketOption[]
): number {
  let baseIv = fallbackIv;

  if (marketChain && marketChain.length > 0 && nearestExpiryDate) {
    const sameExp = marketChain
      .filter((o) => o.expirationDate === nearestExpiryDate && o.impliedVolatility > 0)
      .sort((a, b) => Math.abs(a.strike - threshold) - Math.abs(b.strike - threshold));
    if (sameExp.length > 0) {
      baseIv = sameExp[0].impliedVolatility;
    }
  } else if (nearestLegs.length > 0) {
    const closest = nearestLegs.reduce((best, curr) =>
      Math.abs(curr.strike - threshold) < Math.abs(best.strike - threshold) ? curr : best
    );
    if (closest.impliedVolatility > 0) {
      baseIv = closest.impliedVolatility;
    }
  }

  return Math.max(0.01, baseIv + ivShiftPercent / 100);
}

/**
 * Computes exact analytical risk metrics, Breakevens, calibrated Probability of Profit (PoP),
 * Return on Risk (RoR), 2D Stress CORE Proxy Margin, complete B3 costs, and 1st/2nd order Greeks.
 */
export function calculateStrategyMetrics(
  legs: Leg[],
  marketParams: MarketParams,
  costConfig: CostConfig,
  ivShiftPercent = 0,
  daysElapsed = 0,
  ivShockMode: IvShockMode = 'parallel',
  marketChain?: MarketOption[]
): StrategyMetrics {
  const active = getActiveLegs(legs);
  const nearestDte = getNearestDte(active);
  const multiExpiry = isMultiExpiryStrategy(active);

  if (active.length === 0) {
    return {
      netCost: 0,
      operationalCosts: 0,
      costBreakdown: { entryCosts: 0, estimatedExitOrExerciseCosts: 0, irrfInformative: 0 },
      maxProfit: 0,
      maxLoss: 0,
      breakevens: [],
      pop: null,
      ror: null,
      estimatedMargin: 0,
      marginBreakdown: {
        initialCashRequired: 0,
        coreMarginRequired: 0,
        totalCapitalRequired: 0,
        bindingScenario: null,
        scenariosEvaluated: 0,
      },
      notionalDelta: 0,
      greeks: { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, vanna: 0, volga: 0, charm: 0 },
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
  const costBreakdown = calculateCostBreakdown(
    active,
    marketParams,
    costConfig,
    ivShiftPercent,
    ivShockMode
  );

  // Build exact evaluation domain covering 0, all strikes, and asymptotic upper bound
  const strikes = active
    .filter((l) => l.type !== 'Stock' && l.strike > 0)
    .map((l) => l.strike);
  const maxRef = Math.max(marketParams.spotPrice, ...strikes, 10);
  const upperBound = maxRef * 4;

  const sampleSet = new Set<number>([0, marketParams.spotPrice, upperBound]);
  for (const k of strikes) sampleSet.add(k);

  const denseSteps = 300;
  for (let i = 1; i < denseSteps; i++) {
    sampleSet.add((upperBound * i) / denseSteps);
  }

  const sortedSpots = Array.from(sampleSet).sort((a, b) => a - b);
  const evaluated = sortedSpots.map((spot) => ({
    spot,
    pnl: evaluateStrategyPnl(
      active,
      spot,
      nearestDte,
      ivShiftPercent,
      marketParams,
      costConfig,
      ivShockMode
    ),
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
      const t = -p0.pnl / (p1.pnl - p0.pnl);
      const cross = p0.spot + t * (p1.spot - p0.spot);
      breakevens.push(Number(cross.toFixed(2)));
    }
  }

  // Deduplicate close breakevens (within R$ 0.05)
  const uniqueBreakevens: number[] = [];
  for (const be of breakevens.sort((a, b) => a - b)) {
    if (
      uniqueBreakevens.length === 0 ||
      Math.abs(be - uniqueBreakevens[uniqueBreakevens.length - 1]) > 0.05
    ) {
      uniqueBreakevens.push(be);
    }
  }

  // Calibrated Probability of Profit (PoP): uses ONLY nearest-expiry IV (plus skew lookup when available)
  const optionLegs = active.filter((l) => l.type !== 'Stock');
  const nearestOptions = optionLegs.filter((l) => Math.max(1, l.daysToMaturity) === nearestDte);
  const ivSourceLegs = nearestOptions.length > 0 ? nearestOptions : optionLegs;
  const nearestExpiryDate = ivSourceLegs[0]?.expirationDate;

  const totalQty = ivSourceLegs.reduce((sum, l) => sum + l.quantity, 0);
  const fallbackIv =
    totalQty > 0
      ? ivSourceLegs.reduce((sum, l) => sum + (l.impliedVolatility || 0.35) * l.quantity, 0) /
        totalQty
      : 0.35;

  const T = getTimeToMaturityYears(
    nearestDte,
    marketParams.dayCountConvention,
    nearestExpiryDate
  );
  const { rCont, qCont } = getContinuousMarketRates(marketParams);
  const zeroDrift = marketParams.popDriftMode === 'zero';

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
      costConfig,
      ivShockMode
    );

    if (testPnl > 0) {
      const pAboveLow =
        low <= 0
          ? 1
          : probabilitySpotAbove(
              marketParams.spotPrice,
              low,
              T,
              rCont,
              qCont,
              resolveIvAtThreshold(
                low,
                ivSourceLegs,
                fallbackIv,
                ivShiftPercent,
                nearestExpiryDate,
                marketChain
              ),
              zeroDrift
            );
      const pAboveHigh =
        high === Infinity
          ? 0
          : probabilitySpotAbove(
              marketParams.spotPrice,
              high,
              T,
              rCont,
              qCont,
              resolveIvAtThreshold(
                high,
                ivSourceLegs,
                fallbackIv,
                ivShiftPercent,
                nearestExpiryDate,
                marketChain
              ),
              zeroDrift
            );
      popProb += Math.max(0, pAboveLow - pAboveHigh);
    }
  }

  const pop = Number((Math.min(1, Math.max(0, popProb)) * 100).toFixed(1));

  // 2D Closeout Stress Proxy CORE Margin
  const marginBreakdown = evaluateCoreMarginProxy(active, marketParams, netCost);
  const estimatedMargin = marginBreakdown.totalCapitalRequired;

  // Return on Risk (RoR): MaxProfit / Capital at Risk (or CORE Margin)
  let ror: number | null = null;
  if (typeof maxProfit === 'number' && maxProfit > 0) {
    const riskDenom =
      typeof maxLoss === 'number' && maxLoss < 0
        ? Math.min(Math.abs(maxLoss), Math.max(estimatedMargin, Math.abs(maxLoss)))
        : estimatedMargin;
    if (riskDenom > 0) {
      ror = Number(((maxProfit / riskDenom) * 100).toFixed(1));
    }
  }

  const greeks = evaluatePortfolioGreeks(
    active,
    marketParams.spotPrice,
    daysElapsed,
    ivShiftPercent,
    marketParams,
    ivShockMode
  );
  const notionalDelta = Number((greeks.delta * marketParams.spotPrice).toFixed(2));

  const alerts = buildRiskAlerts(
    active,
    marketParams.spotPrice,
    maxLoss,
    nearestDte,
    multiExpiry,
    marketParams.dividendYield + (marketParams.borrowRate ?? 0)
  );

  return {
    netCost: Number(netCost.toFixed(2)),
    operationalCosts: Number(operationalCosts.toFixed(2)),
    costBreakdown,
    maxProfit,
    maxLoss,
    breakevens: uniqueBreakevens,
    pop,
    ror,
    estimatedMargin,
    marginBreakdown,
    notionalDelta,
    greeks,
    alerts,
    isMultiExpiry: multiExpiry,
    nearestDte,
  };
}
