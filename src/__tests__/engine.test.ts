import { describe, expect, it } from 'vitest';
import {
  bsmGreeks,
  bsmPrice,
  normCDF,
  probabilitySpotAbove,
  solveImpliedVolatility,
} from '../engine/blackScholes';
import {
  formatDateBR,
  generateB3OptionTicker,
  getTimeToMaturityYears,
  parseIsoDateLocal,
} from '../engine/calendar';
import { calculatePayoffSeries, calculateScenarioMatrix } from '../engine/payoff';
import { calculateStrategyMetrics } from '../engine/riskMetrics';
import { instantiateStrategy, STRATEGIES } from '../engine/strategies';
import { CostConfig, Leg, MarketParams } from '../types/options';

const BASE_MARKET: MarketParams = {
  spotPrice: 40,
  riskFreeRate: 0.1425,
  dividendYield: 0.05,
  dayCountConvention: 'du252',
};

const NO_COSTS: CostConfig = {
  includeCosts: false,
  brokeragePerLeg: 0,
  b3FeeRate: 0.000695,
  stockFeeRate: 0.0003,
  includeIR: false,
  isDayTrade: false,
};

describe('Black-Scholes-Merton Engine', () => {
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

  it('handles edge cases safely without NaN or Infinity', () => {
    expect(bsmPrice({ S: 40, K: 35, T: 0, r: 0.14, sigma: 0.3, type: 'Call' })).toBe(5);
    expect(bsmPrice({ S: 40, K: 45, T: 0, r: 0.14, sigma: 0.3, type: 'Put' })).toBe(5);
    expect(bsmPrice({ S: 0, K: 40, T: 0.5, r: 0.14, sigma: 0.3, type: 'Put' })).toBe(40);
    const g = bsmGreeks({ S: 40, K: 40, T: 0, r: 0.14, sigma: 0, type: 'Call' });
    expect(Number.isFinite(g.delta)).toBe(true);
    expect(Number.isFinite(g.gamma)).toBe(true);
    expect(Number.isFinite(g.theta)).toBe(true);
  });

  it('recovers Implied Volatility accurately (round-trip < 1e-4)', () => {
    const S = 38.5;
    const K = 40;
    const T = 30 / 252;
    const r = 0.1425;
    const q = 0.08;
    const targetIv = 0.42;

    const marketPrice = bsmPrice({ S, K, T, r, q, sigma: targetIv, type: 'Call' });
    const solved = solveImpliedVolatility({ marketPrice, S, K, T, r, q, type: 'Call' });

    expect(solved).not.toBeNull();
    expect(solved!).toBeCloseTo(targetIv, 4);
  });

  it('computes consistent Greeks signs for Calls and Puts', () => {
    const T = getTimeToMaturityYears(30, 'du252');
    const callG = bsmGreeks({ S: 40, K: 40, T, r: 0.14, q: 0, sigma: 0.3, type: 'Call' });
    const putG = bsmGreeks({ S: 40, K: 40, T, r: 0.14, q: 0, sigma: 0.3, type: 'Put' });

    expect(callG.delta).toBeGreaterThan(0.5);
    expect(putG.delta).toBeLessThan(0);
    expect(callG.delta - putG.delta).toBeCloseTo(1, 5);
    expect(callG.gamma).toBeCloseTo(putG.gamma, 5);
    expect(callG.vega).toBeCloseTo(putG.vega, 5);
    expect(callG.theta).toBeLessThan(0);
    expect(normCDF(0)).toBeCloseTo(0.5, 5);
    expect(probabilitySpotAbove(40, 40, T, 0.14, 0, 0.3)).toBeGreaterThan(0.45);
  });
});

describe('B3 Calendar & Ticker Utilities', () => {
  it('parses ISO dates in local timezone without UTC-3 off-by-one shift', () => {
    const d = parseIsoDateLocal('2026-12-18');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(11);
    expect(d.getDate()).toBe(18);
    expect(formatDateBR('2026-12-18')).toBe('18/12/2026');
  });

  it('generates standard B3 series tickers (Call A-L, Put M-X)', () => {
    expect(generateB3OptionTicker('PETR4', 'Call', '2026-11-20', 38.0)).toBe('PETRK380');
    expect(generateB3OptionTicker('PETR4', 'Put', '2026-11-20', 36.5)).toBe('PETRW365');
    expect(generateB3OptionTicker('VALE3', 'Call', '2026-01-16', 60.0)).toBe('VALEA600');
  });
});

describe('Analytical Risk Metrics & Payoff Precision', () => {
  it('computes exact MaxProfit, MaxLoss, Breakeven and PoP for a Bull Call Spread', () => {
    const legs: Leg[] = [
      {
        id: '1',
        type: 'Call',
        action: 'Buy',
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
    expect(metrics.netCost).toBeCloseTo(150, 2); // (2.5 - 1.0) * 100
    expect(metrics.maxLoss).toBeCloseTo(-150, 1);
    expect(metrics.maxProfit).toBeCloseTo(250, 1); // (4 - 1.5) * 100
    expect(metrics.breakevens).toEqual([41.5]);
    expect(metrics.pop).not.toBeNull();
    expect(metrics.pop!).toBeGreaterThan(20);
    expect(metrics.pop!).toBeLessThan(65);
  });

  it('detects Unlimited Risk and triggers Danger Alert on Naked Short Call', () => {
    const legs: Leg[] = [
      {
        id: '1',
        type: 'Call',
        action: 'Sell',
        strike: 42,
        quantity: 100,
        price: 1.5,
        expirationDate: '2026-12-18',
        daysToMaturity: 30,
        impliedVolatility: 0.35,
        enabled: true,
      },
    ];

    const metrics = calculateStrategyMetrics(legs, BASE_MARKET, NO_COSTS);
    expect(metrics.maxLoss).toBe('Ilimitado');
    expect(metrics.maxProfit).toBeCloseTo(150, 1);
    expect(metrics.alerts.some((a) => a.id === 'unlimited-risk' && a.severity === 'danger')).toBe(true);
    expect(metrics.estimatedMargin).toBeGreaterThan(500);
  });

  it('injects exact strike points into PayoffSeries and builds Scenario Matrix', () => {
    const collar = STRATEGIES.find((s) => s.id === 'collar-fence')!;
    const legs = instantiateStrategy(collar, 'PETR4', BASE_MARKET, null, '2026-12-18');
    // Collar must include the Stock leg
    expect(legs.some((l) => l.type === 'Stock' && l.action === 'Buy')).toBe(true);

    const series = calculatePayoffSeries(
      legs,
      BASE_MARKET,
      { targetSpot: 40, daysElapsed: 0, ivShiftPercent: 0 },
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

  it('computes 2 breakevens and realistic PoP for an Iron Condor', () => {
    const condor = STRATEGIES.find((s) => s.id === 'iron-condor')!;
    const legs = instantiateStrategy(condor, 'PETR4', BASE_MARKET, null, '2026-12-18');
    const metrics = calculateStrategyMetrics(legs, BASE_MARKET, NO_COSTS);

    expect(metrics.netCost).toBeLessThan(0); // credit spread
    expect(typeof metrics.maxProfit).toBe('number');
    expect(typeof metrics.maxLoss).toBe('number');
    expect(metrics.breakevens.length).toBe(2);
    expect(metrics.breakevens[0]).toBeLessThan(BASE_MARKET.spotPrice);
    expect(metrics.breakevens[1]).toBeGreaterThan(BASE_MARKET.spotPrice);
    expect(metrics.pop!).toBeGreaterThan(30);
    expect(metrics.pop!).toBeLessThan(95);
  });

  it('detects multi-expiry Calendar Spread and applies B3 costs + IR correctly', () => {
    const calendarLegs: Leg[] = [
      {
        id: 'short-near',
        type: 'Call',
        action: 'Sell',
        strike: 40,
        quantity: 100,
        price: 1.5,
        expirationDate: '2026-12-18',
        daysToMaturity: 20,
        impliedVolatility: 0.35,
        enabled: true,
      },
      {
        id: 'long-far',
        type: 'Call',
        action: 'Buy',
        strike: 40,
        quantity: 100,
        price: 2.8,
        expirationDate: '2027-01-15',
        daysToMaturity: 50,
        impliedVolatility: 0.35,
        enabled: true,
      },
    ];

    const gross = calculateStrategyMetrics(calendarLegs, BASE_MARKET, NO_COSTS);
    expect(gross.isMultiExpiry).toBe(true);
    expect(gross.nearestDte).toBe(20);
    expect(gross.alerts.some((a) => a.id === 'multi-expiry')).toBe(true);

    const withCosts = calculateStrategyMetrics(calendarLegs, BASE_MARKET, {
      includeCosts: true,
      brokeragePerLeg: 5,
      b3FeeRate: 0.000695,
      stockFeeRate: 0.0003,
      includeIR: true,
      isDayTrade: false,
    });
    expect(withCosts.operationalCosts).toBeGreaterThan(10);
    if (typeof gross.maxProfit === 'number' && typeof withCosts.maxProfit === 'number') {
      expect(withCosts.maxProfit).toBeLessThan(gross.maxProfit);
    }
  });
});
