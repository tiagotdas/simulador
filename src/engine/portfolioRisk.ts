import {
  Greeks,
  Leg,
  MarkedPosition,
  MarketDataResponse,
  PortfolioStressRow,
  PortfolioSummary,
  SavedStrategy,
} from '../types/options';
import { resolveDynamicDte } from './calendar';
import { evaluateCoreMarginProxy } from './marginCore';
import { evaluateLegValue, evaluatePortfolioGreeks, getActiveLegs } from './payoff';

export const BENCHMARK_TICKER = 'BOVA11';
export const DEFAULT_BENCHMARK_SPOT = 126.4;

/**
 * Typical 1Y Betas vs. IBOV / BOVA11 for liquid B3 tickers (user-editable per position).
 */
export const DEFAULT_B3_BETAS: Record<string, number> = {
  BOVA11: 1.0,
  PETR4: 1.15,
  VALE3: 1.05,
  ITUB4: 0.92,
  BBAS3: 1.02,
  BBDC4: 1.12,
  WEGE3: 0.78,
  MGLU3: 1.85,
};

export function getDefaultBetaForTicker(ticker: string): number {
  return DEFAULT_B3_BETAS[ticker.trim().toUpperCase()] ?? 1.0;
}

/**
 * Updates each leg's DTE dynamically relative to `referenceDate` using its `expirationDate`.
 */
export function refreshLegsDynamicDte(legs: Leg[], referenceDate = new Date()): Leg[] {
  return legs.map((leg) => {
    if (leg.type === 'Stock') return leg;
    return {
      ...leg,
      daysToMaturity: resolveDynamicDte(leg.expirationDate, leg.daysToMaturity, referenceDate),
    };
  });
}

/**
 * Marks a single open SavedStrategy to market using live/cached chain prices when available
 * or theoretical American/BSM valuation with dynamically decayed DTE.
 */
export function markStrategyToMarket(
  strategy: SavedStrategy,
  options: {
    marketCache?: Record<string, MarketDataResponse>;
    spotOverrides?: Record<string, number>;
    benchmarkSpot?: number;
    referenceDate?: Date;
  } = {}
): MarkedPosition {
  const {
    marketCache = {},
    spotOverrides = {},
    benchmarkSpot = DEFAULT_BENCHMARK_SPOT,
    referenceDate = new Date(),
  } = options;

  const sym = strategy.ticker.trim().toUpperCase();
  const cachedChain = marketCache[sym];
  const currentSpot =
    spotOverrides[sym] ??
    cachedChain?.spotPrice ??
    strategy.marketParams.spotPrice ??
    strategy.spotAtSave;

  const refreshedLegs = refreshLegsDynamicDte(strategy.legs, referenceDate);
  const active = getActiveLegs(refreshedLegs);
  const updatedMarketParams = { ...strategy.marketParams, spotPrice: currentSpot };

  let unrealizedPnl = 0;
  let matchedChainLegs = 0;
  let optionLegsCount = 0;

  for (const leg of active) {
    const dir = leg.action === 'Buy' ? 1 : -1;
    let markPrice: number;

    if (leg.type === 'Stock') {
      markPrice = currentSpot;
    } else {
      optionLegsCount += 1;
      const chainMatch = cachedChain?.chain.find(
        (o) =>
          (leg.ticker && o.ticker.toUpperCase() === leg.ticker.toUpperCase()) ||
          (o.type === leg.type &&
            Math.abs(o.strike - leg.strike) < 0.01 &&
            o.expirationDate === leg.expirationDate)
      );

      if (chainMatch && (chainMatch.bid > 0 || chainMatch.ask > 0 || chainMatch.last > 0)) {
        markPrice =
          chainMatch.bid > 0 && chainMatch.ask > 0
            ? (chainMatch.bid + chainMatch.ask) / 2
            : chainMatch.last || chainMatch.bid || chainMatch.ask;
        matchedChainLegs += 1;
      } else {
        markPrice = evaluateLegValue(leg, currentSpot, 0, 0, updatedMarketParams);
      }
    }

    unrealizedPnl += dir * (markPrice - leg.price) * leg.quantity;
  }

  const mtmSource: 'chain' | 'theoretical' =
    optionLegsCount > 0 && matchedChainLegs === optionLegsCount ? 'chain' : 'theoretical';

  const realizedAdjustmentsPnl = (strategy.adjustments ?? []).reduce(
    (sum, adj) => sum + adj.realizedCashflow,
    0
  );

  const greeks = evaluatePortfolioGreeks(active, currentSpot, 0, 0, updatedMarketParams);
  const notionalDelta = greeks.delta * currentSpot;

  const beta = strategy.betaToIbov ?? getDefaultBetaForTicker(sym);
  const betaWeightedDeltaBRL = notionalDelta * beta;
  const safeBench = Math.max(1, benchmarkSpot);
  const betaWeightedDeltaShares = betaWeightedDeltaBRL / safeBench;

  const netCost = active.reduce(
    (sum, l) => sum + (l.action === 'Buy' ? 1 : -1) * l.quantity * l.price,
    0
  );
  const margin = evaluateCoreMarginProxy(active, updatedMarketParams, netCost);

  const optDtes = active.filter((l) => l.type !== 'Stock').map((l) => l.daysToMaturity);
  const nearestDte = optDtes.length > 0 ? Math.min(...optDtes) : 0;
  const expired = optDtes.length > 0 && optDtes.every((d) => d <= 0);

  return {
    strategy,
    currentSpot: Number(currentSpot.toFixed(2)),
    mtmSource,
    unrealizedPnl: Number(unrealizedPnl.toFixed(2)),
    realizedAdjustmentsPnl: Number(realizedAdjustmentsPnl.toFixed(2)),
    totalPnl: Number((unrealizedPnl + realizedAdjustmentsPnl).toFixed(2)),
    greeks,
    notionalDelta: Number(notionalDelta.toFixed(2)),
    betaWeightedDeltaShares: Number(betaWeightedDeltaShares.toFixed(2)),
    betaWeightedDeltaBRL: Number(betaWeightedDeltaBRL.toFixed(2)),
    estimatedMargin: margin.totalCapitalRequired,
    nearestDte,
    expired,
  };
}

/**
 * Aggregates multi-asset portfolio risk, Beta-Weighted Delta (vs. BOVA11),
 * realized/unrealized PnL, and consolidated IBOV shock stress scenarios.
 */
export function evaluateConsolidatedPortfolio(
  strategies: SavedStrategy[],
  options: {
    marketCache?: Record<string, MarketDataResponse>;
    spotOverrides?: Record<string, number>;
    benchmarkSpot?: number;
    referenceDate?: Date;
  } = {}
): PortfolioSummary {
  const benchmarkSpot =
    options.spotOverrides?.[BENCHMARK_TICKER] ??
    options.marketCache?.[BENCHMARK_TICKER]?.spotPrice ??
    options.benchmarkSpot ??
    DEFAULT_BENCHMARK_SPOT;

  const openStrategies = strategies.filter((s) => s.status === 'Em Aberto');
  const closedStrategies = strategies.filter((s) => s.status === 'Encerrada');
  const studyStrategies = strategies.filter((s) => s.status === 'Estudo');

  const positions = openStrategies.map((s) =>
    markStrategyToMarket(s, { ...options, benchmarkSpot })
  );

  const totalGreeks: Greeks = {
    delta: 0,
    gamma: 0,
    theta: 0,
    vega: 0,
    rho: 0,
    vanna: 0,
    volga: 0,
    charm: 0,
  };

  let totalUnrealizedPnl = 0;
  let totalAdjustmentsPnl = 0;
  let totalEstimatedMargin = 0;
  let totalNotionalDelta = 0;
  let totalBetaWeightedDeltaShares = 0;
  let totalBetaWeightedDeltaBRL = 0;

  for (const pos of positions) {
    totalUnrealizedPnl += pos.unrealizedPnl;
    totalAdjustmentsPnl += pos.realizedAdjustmentsPnl;
    totalEstimatedMargin += pos.estimatedMargin;
    totalNotionalDelta += pos.notionalDelta;
    totalBetaWeightedDeltaShares += pos.betaWeightedDeltaShares;
    totalBetaWeightedDeltaBRL += pos.betaWeightedDeltaBRL;

    totalGreeks.delta += pos.greeks.delta;
    totalGreeks.gamma += pos.greeks.gamma;
    totalGreeks.theta += pos.greeks.theta;
    totalGreeks.vega += pos.greeks.vega;
    totalGreeks.rho += pos.greeks.rho;
    totalGreeks.vanna = (totalGreeks.vanna ?? 0) + (pos.greeks.vanna ?? 0);
    totalGreeks.volga = (totalGreeks.volga ?? 0) + (pos.greeks.volga ?? 0);
    totalGreeks.charm = (totalGreeks.charm ?? 0) + (pos.greeks.charm ?? 0);
  }

  let totalRealizedPnl = 0;
  for (const closed of closedStrategies) {
    const adjSum = (closed.adjustments ?? []).reduce((s, a) => s + a.realizedCashflow, 0);
    totalRealizedPnl += (closed.exitPnl ?? 0) + adjSum;
  }

  // Consolidated IBOV stress scenarios (-10%, -5%, 0%, +5%, +10%) using full re-pricing per asset via Beta
  const ibovShocks = [-10, -5, 5, 10];
  const stressScenarios: PortfolioStressRow[] = ibovShocks.map((ibovShockPct) => {
    let projectedTotalPnl = 0;
    for (const pos of positions) {
      const beta = pos.strategy.betaToIbov ?? getDefaultBetaForTicker(pos.strategy.ticker);
      const assetShock = (ibovShockPct / 100) * beta;
      const shockedSpot = Math.max(0.01, pos.currentSpot * (1 + assetShock));
      const refreshedLegs = refreshLegsDynamicDte(pos.strategy.legs, options.referenceDate);
      const active = getActiveLegs(refreshedLegs);
      const mp = { ...pos.strategy.marketParams, spotPrice: shockedSpot };

      let posPnl = pos.realizedAdjustmentsPnl;
      for (const leg of active) {
        const dir = leg.action === 'Buy' ? 1 : -1;
        const val = evaluateLegValue(leg, shockedSpot, 0, 0, mp);
        posPnl += dir * (val - leg.price) * leg.quantity;
      }
      projectedTotalPnl += posPnl;
    }

    const baseOpenPnl = totalUnrealizedPnl + totalAdjustmentsPnl;
    return {
      ibovShockPct,
      estimatedPnlDelta: Number((projectedTotalPnl - baseOpenPnl).toFixed(2)),
      projectedTotalPnl: Number(projectedTotalPnl.toFixed(2)),
    };
  });

  return {
    benchmarkTicker: BENCHMARK_TICKER,
    benchmarkSpot: Number(benchmarkSpot.toFixed(2)),
    openCount: openStrategies.length,
    closedCount: closedStrategies.length,
    studyCount: studyStrategies.length,
    totalUnrealizedPnl: Number(totalUnrealizedPnl.toFixed(2)),
    totalRealizedPnl: Number(totalRealizedPnl.toFixed(2)),
    totalAdjustmentsPnl: Number(totalAdjustmentsPnl.toFixed(2)),
    netPortfolioPnl: Number((totalUnrealizedPnl + totalAdjustmentsPnl + totalRealizedPnl).toFixed(2)),
    totalEstimatedMargin: Number(totalEstimatedMargin.toFixed(2)),
    totalGreeks,
    totalNotionalDelta: Number(totalNotionalDelta.toFixed(2)),
    totalBetaWeightedDeltaShares: Number(totalBetaWeightedDeltaShares.toFixed(2)),
    totalBetaWeightedDeltaBRL: Number(totalBetaWeightedDeltaBRL.toFixed(2)),
    positions,
    stressScenarios,
  };
}
