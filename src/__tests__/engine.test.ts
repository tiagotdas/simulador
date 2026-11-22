import { describe, expect, it } from 'vitest';
import {
  bjerksundStensland2002,
  crrAmericanPrice,
  greeksOption,
  solveOptionImpliedVolatility,
} from '../engine/americanPricing';
import {
  bsmGreeks,
  bsmPrice,
  normCDF,
  probabilitySpotAbove,
  solveImpliedVolatility,
  toContinuousRate,
} from '../engine/blackScholes';
import {
  formatDateBR,
  generateB3OptionTicker,
  getB3HolidaysForYear,
  getThirdFriday,
  getTimeToMaturityYears,
  parseIsoDateLocal,
  resolveDynamicDte,
  toIsoDateString,
} from '../engine/calendar';
import { evaluateCoreMarginProxy } from '../engine/marginCore';
import {
  applyCostsAndIR,
  calculateExitOrExerciseCosts,
  calculatePayoffSeries,
  calculateScenarioMatrix,
} from '../engine/payoff';
import { evaluateConsolidatedPortfolio, markStrategyToMarket } from '../engine/portfolioRisk';
import { calculateStrategyMetrics } from '../engine/riskMetrics';
import { instantiateStrategy, STRATEGIES } from '../engine/strategies';
import {
  buildTermStructure,
  buildVolatilitySkew,
  calculateVolatilitySummary,
} from '../engine/volatility';
import { generateRealisticB3Chain } from '../services/mockMarketData';
import { parsePortfolioJson } from '../services/storage';
import { CostConfig, Leg, MarketParams, SavedStrategy } from '../types/options';

const BASE_MARKET: MarketParams = {
  spotPrice: 40,
  riskFreeRate: 0.1425,
  dividendYield: 0,
  borrowRate: 0.005,
  dayCountConvention: 'du252',
  popDriftMode: 'risk-neutral',
};

const NO_COSTS: CostConfig = {
  includeCosts: false,
  brokeragePerLeg: 0,
  b3FeeRate: 0.000695,
  stockFeeRate: 0.0003,
  includeExitCosts: false,
  exerciseFeeRate: 0.0003,
  exerciseBrokeragePerLeg: 0,
  includeIR: false,
  isDayTrade: false,
  accumulatedLossOffset: 0,
};

describe('Black-Scholes-Merton & 2nd-Order Greeks Engine', () => {
  it('satisfies Put-Call Parity: C - P = S*e^(-qT) - K*e^(-rT)', () => {
    const S = 40;
    const K = 42;
    const T = 0.25;
    const r = 0.1425;
    const q = 0.06;
    const sigma = 0.35;

    const call = bsmPrice({ S, K, T, r, q, sigma, type: 'Call' });
    const put = bsmPrice({ S, K, T, r, q, sigma, type: 'Put' });
    const rhs = S * Math.exp(-q * T) - K * Math.exp(-r * T);

    expect(call - put).toBeCloseTo(rhs, 5);
  });

  it('converts B3 effective annual DI/Selic rate to continuous ln(1+r) accurately', () => {
    const effective = 0.1425;
    const rCont = toContinuousRate(effective);
    const T = 21 / 252;
    expect(rCont).toBeCloseTo(Math.log(1.1425), 8);
    expect(Math.exp(-rCont * T)).toBeCloseTo(Math.pow(1 + effective, -T), 8);
  });

  it('handles edge cases safely without NaN or Infinity', () => {
    expect(bsmPrice({ S: 40, K: 35, T: 0, r: 0.14, sigma: 0.3, type: 'Call' })).toBe(5);
    expect(bsmPrice({ S: 40, K: 45, T: 0, r: 0.14, sigma: 0.3, type: 'Put' })).toBe(5);
    expect(bsmPrice({ S: 0, K: 40, T: 0.5, r: 0.14, sigma: 0.3, type: 'Put' })).toBe(40);
    const g = bsmGreeks({ S: 40, K: 40, T: 0, r: 0.14, sigma: 0, type: 'Call' });
    expect(Number.isFinite(g.delta)).toBe(true);
    expect(Number.isFinite(g.gamma)).toBe(true);
    expect(Number.isFinite(g.theta)).toBe(true);
    expect(Number.isFinite(g.vanna!)).toBe(true);
    expect(Number.isFinite(g.volga!)).toBe(true);
    expect(Number.isFinite(g.charm!)).toBe(true);
  });

  it('recovers Implied Volatility accurately (round-trip < 1e-4)', () => {
    const S = 38.5;
    const K = 40;
    const T = 30 / 252;
    const r = toContinuousRate(0.1425);
    const q = 0.08;
    const targetIv = 0.42;

    const marketPrice = bsmPrice({ S, K, T, r, q, sigma: targetIv, type: 'Call' });
    const solved = solveImpliedVolatility({ marketPrice, S, K, T, r, q, type: 'Call' });

    expect(solved).not.toBeNull();
    expect(solved!).toBeCloseTo(targetIv, 4);
  });

  it('matches analytical 2nd-order Greeks (Vanna, Volga, Charm) against numerical finite differences', () => {
    const input = { S: 40, K: 42, T: 42 / 252, r: 0.133, q: 0.02, sigma: 0.35, type: 'Call' as const };
    const g = bsmGreeks(input, 'du252');

    // Finite-difference Vanna: dDelta / d(+1pp sigma)
    const hSig = 0.0005;
    const dUp = bsmGreeks({ ...input, sigma: input.sigma + hSig }, 'du252').delta;
    const dDn = bsmGreeks({ ...input, sigma: input.sigma - hSig }, 'du252').delta;
    const numVanna = ((dUp - dDn) / (2 * hSig)) / 100;
    expect(g.vanna!).toBeCloseTo(numVanna, 4);

    // Finite-difference Volga: dVega(1pp) / d(+1pp sigma)
    const vUp = bsmGreeks({ ...input, sigma: input.sigma + hSig }, 'du252').vega;
    const vDn = bsmGreeks({ ...input, sigma: input.sigma - hSig }, 'du252').vega;
    const numVolga = ((vUp - vDn) / (2 * hSig)) / 100;
    expect(g.volga!).toBeCloseTo(numVolga, 4);

    // Finite-difference Charm: (Delta(T - dt) - Delta(T)) per 1 business day
    const dt = 1 / 2520;
    const dFuture = bsmGreeks({ ...input, T: input.T - dt }, 'du252').delta;
    const dPast = bsmGreeks({ ...input, T: input.T + dt }, 'du252').delta;
    const numCharm = ((dFuture - dPast) / (2 * dt)) / 252;
    expect(g.charm!).toBeCloseTo(numCharm, 4);
    expect(normCDF(0)).toBeCloseTo(0.5, 5);
    expect(probabilitySpotAbove(40, 40, input.T, input.r, 0, 0.3, true)).toBeLessThan(0.5);
  });
});

describe('American Option Pricing (Bjerksund-Stensland 2002 vs CRR 150-step)', () => {
  it('prices American Call with high carry yield >= European Call and matches CRR within R$ 0.03', () => {
    const cases = [
      { S: 45, K: 40, T: 0.5, r: 0.10, q: 0.12, sigma: 0.30, type: 'Call' as const },
      { S: 40, K: 40, T: 0.25, r: 0.13, q: 0.08, sigma: 0.35, type: 'Call' as const },
      { S: 36, K: 40, T: 0.5, r: 0.133, q: 0.0, sigma: 0.30, type: 'Put' as const },
      { S: 40, K: 42, T: 0.25, r: 0.133, q: 0.01, sigma: 0.35, type: 'Put' as const },
    ];

    for (const c of cases) {
      const euro = bsmPrice(c);
      const bs02 = bjerksundStensland2002(c);
      const crr = crrAmericanPrice(c, 150);

      expect(bs02).toBeGreaterThanOrEqual(euro - 1e-6);
      expect(Math.abs(bs02 - crr)).toBeLessThan(0.03);
    }
  });

  it('recovers Implied Volatility for American Put and produces finite American Greeks', () => {
    const params = {
      S: 38,
      K: 42,
      T: 63 / 252,
      r: toContinuousRate(0.1425),
      q: 0.005,
      sigma: 0.38,
      type: 'Put' as const,
      exerciseStyle: 'American' as const,
    };
    const amPrice = bjerksundStensland2002(params);
    const solvedIv = solveOptionImpliedVolatility({
      marketPrice: amPrice,
      S: params.S,
      K: params.K,
      T: params.T,
      r: params.r,
      q: params.q,
      type: 'Put',
      exerciseStyle: 'American',
    });

    expect(solvedIv).not.toBeNull();
    expect(solvedIv!).toBeCloseTo(0.38, 3);

    const g = greeksOption(params, 'du252');
    expect(g.delta).toBeLessThan(0);
    expect(g.gamma).toBeGreaterThan(0);
    expect(g.vega).toBeGreaterThan(0);
    expect(Number.isFinite(g.vanna!)).toBe(true);
  });
});

describe('B3 / ANBIMA Calendar & Dynamic DTE', () => {
  it('includes movable ANBIMA holidays (Carnaval, Good Friday, Corpus Christi)', () => {
    const h2025 = getB3HolidaysForYear(2025);
    expect(h2025.has('2025-03-03')).toBe(true); // Carnaval Seg
    expect(h2025.has('2025-03-04')).toBe(true); // Carnaval Ter
    expect(h2025.has('2025-04-18')).toBe(true); // Sexta-Feira Santa
    expect(h2025.has('2025-06-19')).toBe(true); // Corpus Christi

    const h2026 = getB3HolidaysForYear(2026);
    expect(h2026.has('2026-04-03')).toBe(true); // Sexta-Feira Santa 2026
    expect(h2026.has('2026-06-04')).toBe(true); // Corpus Christi 2026
  });

  it('rolls back 3rd Friday expiry to previous business day when it lands on a B3 holiday', () => {
    // April 2025: 3rd Friday is 2025-04-18 (Good Friday) -> B3 expiry is 2025-04-17
    const apr2025Expiry = getThirdFriday(2025, 3);
    expect(toIsoDateString(apr2025Expiry)).toBe('2025-04-17');
  });

  it('parses ISO dates locally, computes dynamic DTE, and generates B3 series tickers', () => {
    const d = parseIsoDateLocal('2026-12-18');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(11);
    expect(d.getDate()).toBe(18);
    expect(formatDateBR('2026-12-18')).toBe('18/12/2026');

    const dynDte = resolveDynamicDte('2026-12-18', 30, parseIsoDateLocal('2026-12-08'));
    expect(dynDte).toBe(10);
    expect(resolveDynamicDte('2026-11-01', 30, parseIsoDateLocal('2026-12-08'))).toBe(0);

    expect(generateB3OptionTicker('PETR4', 'Call', '2026-11-20', 38.0)).toBe('PETRK380');
    expect(generateB3OptionTicker('PETR4', 'Put', '2026-11-20', 36.5)).toBe('PETRW365');
    expect(generateB3OptionTicker('VALE3', 'Call', '2026-01-16', 60.0)).toBe('VALEA600');
  });

  it('uses real ANBIMA business day count in getTimeToMaturityYears when expirationDate is provided', () => {
    // 2025-04-14 (Mon) to 2025-04-22 (Tue): 8 calendar days, excluding Good Friday (18) & Tiradentes (21) -> 4 business days
    const T = getTimeToMaturityYears(8, 'du252', '2025-04-22');
    expect(T).toBeCloseTo(4 / 252, 6);
  });
});

describe('Analytical Risk Metrics, Complete Costs & 2D CORE Proxy Margin', () => {
  it('computes exact MaxProfit, MaxLoss, Breakeven and CORE margin for Bull Call Spread', () => {
    const legs: Leg[] = [
      {
        id: '1',
        type: 'Call',
        action: 'Buy',
        exerciseStyle: 'American',
        strike: 40,
        quantity: 100,
        price: 2.5,
        expirationDate: '2026-12-18',
        daysToMaturity: 30,
        impliedVolatility: 0.35,
        enabled: true,
      },
      {
        id: '2',
        type: 'Call',
        action: 'Sell',
        exerciseStyle: 'American',
        strike: 44,
        quantity: 100,
        price: 1.0,
        expirationDate: '2026-12-18',
        daysToMaturity: 30,
        impliedVolatility: 0.35,
        enabled: true,
      },
    ];

    const metrics = calculateStrategyMetrics(legs, BASE_MARKET, NO_COSTS);
    expect(metrics.netCost).toBeCloseTo(150, 2);
    expect(metrics.maxLoss).toBeCloseTo(-150, 1);
    expect(metrics.maxProfit).toBeCloseTo(250, 1);
    expect(metrics.breakevens).toEqual([41.5]);
    expect(metrics.marginBreakdown?.initialCashRequired).toBeCloseTo(150, 2);
    expect(metrics.marginBreakdown?.coreMarginRequired).toBe(0);
    expect(metrics.estimatedMargin).toBeCloseTo(150, 2);
  });

  it('captures portfolio offset in CORE Proxy (Iron Condor margin << Naked Strangle margin)', () => {
    const condor = STRATEGIES.find((s) => s.id === 'iron-condor')!;
    const strangle = STRATEGIES.find((s) => s.id === 'short-strangle')!;
    const chain = generateRealisticB3Chain('PETR4', BASE_MARKET);
    const exp = chain.chain[0].expirationDate;

    const condorLegs = instantiateStrategy(condor, 'PETR4', BASE_MARKET, chain, exp);
    const strangleLegs = instantiateStrategy(strangle, 'PETR4', BASE_MARKET, chain, exp);

    const condorMetrics = calculateStrategyMetrics(condorLegs, BASE_MARKET, NO_COSTS);
    const strangleMetrics = calculateStrategyMetrics(strangleLegs, BASE_MARKET, NO_COSTS);

    expect(condorMetrics.estimatedMargin).toBeLessThan(strangleMetrics.estimatedMargin);
    expect(strangleMetrics.marginBreakdown?.bindingScenario).not.toBeNull();
    expect(strangleMetrics.marginBreakdown?.scenariosEvaluated).toBeGreaterThanOrEqual(36);
  });

  it('charges B3 exercise fees on notional (strike * qty) ONLY when ITM at expiry and offsets IR losses', () => {
    const leg: Leg = {
      id: '1',
      type: 'Call',
      action: 'Buy',
      strike: 40,
      quantity: 100,
      price: 2.0,
      expirationDate: '2026-12-18',
      daysToMaturity: 30,
      impliedVolatility: 0.35,
      enabled: true,
    };
    const cfg: CostConfig = {
      ...NO_COSTS,
      includeCosts: true,
      includeExitCosts: true,
      exerciseFeeRate: 0.001, // 0.1% for clear test math -> 40 * 100 * 0.001 = R$ 4.00
      exerciseBrokeragePerLeg: 10,
      includeIR: true,
      isDayTrade: false,
      accumulatedLossOffset: 300,
    };

    // OTM at expiry -> 0 exercise cost
    expect(calculateExitOrExerciseCosts([leg], 38, 30, 0, BASE_MARKET, cfg)).toBe(0);
    // ITM at expiry -> brokerage (10) + notional * rate (4) = 14
    expect(calculateExitOrExerciseCosts([leg], 45, 30, 0, BASE_MARKET, cfg)).toBeCloseTo(14, 2);

    // IR offset: gross 500 - 20 fees = 480; offset 300 -> taxable 180 -> 15% IR = 27 -> net 453
    expect(applyCostsAndIR(500, 20, cfg)).toBeCloseTo(453, 2);
  });

  it('instantiates multi-expiry Calendar and PMCC Diagonal templates across 2 distinct expiries', () => {
    expect(STRATEGIES.length).toBe(50);
    const chain = generateRealisticB3Chain('PETR4', BASE_MARKET);
    const firstExp = chain.chain[0].expirationDate;

    const cal = STRATEGIES.find((s) => s.id === 'call-calendar-spread')!;
    const calLegs = instantiateStrategy(cal, 'PETR4', BASE_MARKET, chain, firstExp);
    expect(calLegs.length).toBe(2);
    expect(calLegs[0].expirationDate).not.toBe(calLegs[1].expirationDate);

    const calMetrics = calculateStrategyMetrics(calLegs, BASE_MARKET, NO_COSTS);
    expect(calMetrics.isMultiExpiry).toBe(true);
    expect(calMetrics.alerts.some((a) => a.id === 'multi-expiry')).toBe(true);

    const pmcc = STRATEGIES.find((s) => s.id === 'pmcc-diagonal-bull')!;
    const pmccLegs = instantiateStrategy(pmcc, 'PETR4', BASE_MARKET, chain, firstExp);
    expect(pmccLegs[0].expirationDate).not.toBe(pmccLegs[1].expirationDate);
    expect(pmccLegs[0].strike).toBeLessThan(pmccLegs[1].strike);
  });

  it('injects exact strike points into PayoffSeries and builds Scenario Matrix', () => {
    const collar = STRATEGIES.find((s) => s.id === 'collar-fence')!;
    const legs = instantiateStrategy(collar, 'PETR4', BASE_MARKET, null, '2026-12-18');
    expect(legs.some((l) => l.type === 'Stock' && l.action === 'Buy')).toBe(true);

    const series = calculatePayoffSeries(
      legs,
      BASE_MARKET,
      { targetSpot: 40, daysElapsed: 0, ivShiftPercent: 0, ivShockMode: 'skew-aware' },
      NO_COSTS
    );
    const optionStrikes = legs.filter((l) => l.type !== 'Stock').map((l) => l.strike);
    for (const strike of optionStrikes) {
      expect(series.points.some((pt) => Math.abs(pt.price - strike) < 0.01)).toBe(true);
    }

    const matrix = calculateScenarioMatrix(legs, BASE_MARKET, NO_COSTS, 0, 1000);
    expect(matrix.rows.length).toBe(11);
    expect(matrix.dates.length).toBeGreaterThanOrEqual(2);
  });

  it('gives realistic CORE stress margin for Naked Short Put (well below 100% cash-secured notional)', () => {
    const shortPut: Leg[] = [
      {
        id: 'sp1',
        type: 'Put',
        action: 'Sell',
        exerciseStyle: 'European',
        strike: 38,
        quantity: 100,
        price: 1.2,
        expirationDate: '2026-12-18',
        daysToMaturity: 30,
        impliedVolatility: 0.30,
        enabled: true,
      },
    ];
    const mb = evaluateCoreMarginProxy(shortPut, BASE_MARKET, -120);
    expect(mb.coreMarginRequired).toBeGreaterThan(400);
    expect(mb.coreMarginRequired).toBeLessThan(1800); // Well below R$ 3,680 cash-secured
    expect(mb.bindingScenario?.spotShockPct).toBeLessThan(0);
  });
});

describe('Volatility Analytics & Consolidated Portfolio Risk', () => {
  it('extracts Volatility Skew (positive 25d skew) and Contango Term Structure', () => {
    const chain = generateRealisticB3Chain('PETR4', BASE_MARKET);
    const exp = chain.chain[0].expirationDate;
    const skew = buildVolatilitySkew(chain, exp, chain.spotPrice);
    const term = buildTermStructure(chain, chain.spotPrice);
    const summary = calculateVolatilitySummary(chain, exp, chain.spotPrice);

    expect(skew.length).toBeGreaterThan(5);
    expect(term.length).toBe(3);
    expect(summary.atmIv).not.toBeNull();
    expect(summary.skew25Delta!).toBeGreaterThan(0); // Equity downside puts more expensive
    expect(summary.termRegime).toBe('Contango');
  });

  it('marks open strategies to market, aggregates adjustments/realized PnL and Beta-Weighted Delta', () => {
    const chain = generateRealisticB3Chain('PETR4', BASE_MARKET);
    const openStrat: SavedStrategy = {
      id: 's1',
      name: 'PETR4 Call Spread',
      ticker: 'PETR4',
      strategyTemplateName: 'Bull Call',
      status: 'Em Aberto',
      notes: '',
      createdAt: '2026-11-01T12:00:00Z',
      updatedAt: '2026-11-01T12:00:00Z',
      spotAtSave: 37.8,
      marketParams: { ...BASE_MARKET, spotPrice: 37.8 },
      legs: [
        {
          id: 'l1',
          type: 'Stock',
          action: 'Buy',
          strike: 37.8,
          quantity: 100,
          price: 37.8,
          expirationDate: chain.chain[0].expirationDate,
          daysToMaturity: 20,
          impliedVolatility: 0,
          enabled: true,
        },
      ],
      adjustments: [{ id: 'a1', date: '2026-11-10T12:00:00Z', description: 'Rolagem', realizedCashflow: 120 }],
      betaToIbov: 1.2,
    };

    const closedStrat: SavedStrategy = {
      ...openStrat,
      id: 's2',
      name: 'VALE3 Encerrada',
      ticker: 'VALE3',
      status: 'Encerrada',
      exitPnl: 350,
      adjustments: [],
    };

    const marked = markStrategyToMarket(openStrat, {
      spotOverrides: { PETR4: 40.0 },
      benchmarkSpot: 125.0,
    });
    expect(marked.unrealizedPnl).toBeCloseTo(220, 2); // (40 - 37.8) * 100
    expect(marked.realizedAdjustmentsPnl).toBe(120);
    // Beta-weighted delta: 100 * 40 * 1.2 = R$ 4800 / 125 = 38.4 BOVA11 shares
    expect(marked.betaWeightedDeltaShares).toBeCloseTo(38.4, 1);

    const portfolio = evaluateConsolidatedPortfolio([openStrat, closedStrat], {
      spotOverrides: { PETR4: 40.0 },
      benchmarkSpot: 125.0,
    });
    expect(portfolio.openCount).toBe(1);
    expect(portfolio.closedCount).toBe(1);
    expect(portfolio.totalUnrealizedPnl).toBeCloseTo(220, 2);
    expect(portfolio.totalRealizedPnl).toBeCloseTo(350, 2);
    expect(portfolio.netPortfolioPnl).toBeCloseTo(690, 2); // 220 + 120 + 350
    expect(portfolio.stressScenarios.length).toBe(4);
  });

  it('parses and migrates legacy portfolio JSON backups gracefully', () => {
    const legacyJson = JSON.stringify([
      {
        id: 'old-1',
        name: 'Operação Antiga',
        ticker: 'PETR4',
        strategyTemplateName: 'Long Call',
        status: 'Estudo',
        notes: '',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        spotAtSave: 37.8,
        marketParams: { spotPrice: 37.8, riskFreeRate: 0.1425, dividendYield: 0, dayCountConvention: 'du252' },
        legs: [
          {
            id: 'leg-1',
            type: 'Call',
            action: 'Buy',
            strike: 38,
            quantity: 100,
            price: 1.5,
            expirationDate: '2026-12-18',
            daysToMaturity: 25,
            impliedVolatility: 0.32,
            enabled: true,
          },
        ],
      },
    ]);
    const migrated = parsePortfolioJson(legacyJson);
    expect(migrated.length).toBe(1);
    expect(migrated[0].marketParams.borrowRate).toBe(0.005);
    expect(migrated[0].legs[0].exerciseStyle).toBe('American');
    expect(migrated[0].betaToIbov).toBe(1.15);
  });
});
