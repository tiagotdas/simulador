import { DayCountConvention, Greeks, OptionType } from '../types/options';
import { getTimeToMaturityYears } from './calendar';

const SQRT_2PI = Math.sqrt(2 * Math.PI);

/**
 * Standard Normal Probability Density Function
 */
export function normPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/**
 * Standard Normal Cumulative Distribution Function (Abramowitz & Stegun 26.2.17)
 */
export function normCDF(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
  const k = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly =
    k *
    (0.31938153 +
      k * (-0.356563782 + k * (1.781477937 + k * (-1.821255978 + k * 1.330274429))));
  const approx = 1 - normPDF(x) * poly;
  return x >= 0 ? approx : 1 - approx;
}

export interface BSMInput {
  S: number; // Underlying spot price
  K: number; // Strike price
  T: number; // Time to maturity in years
  r: number; // Risk-free annual rate (continuous or annualized decimal)
  q?: number; // Continuous dividend yield (decimal)
  sigma: number; // Implied volatility (decimal)
  type: OptionType;
}

export function intrinsicValue(type: OptionType, S: number, K: number): number {
  if (type === 'Stock') return Math.max(0, S);
  if (type === 'Call') return Math.max(0, S - K);
  return Math.max(0, K - S);
}

/**
 * Black-Scholes-Merton theoretical option price with continuous dividend yield q.
 */
export function bsmPrice(input: BSMInput): number {
  const { S, K, T, r, q = 0, sigma, type } = input;
  if (type === 'Stock') return Math.max(0, S);
  if (S <= 0 || K <= 0) return intrinsicValue(type, Math.max(0, S), Math.max(0, K));
  if (T <= 1e-6 || sigma <= 1e-6) {
    return intrinsicValue(type, S, K);
  }

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const discR = Math.exp(-r * T);
  const discQ = Math.exp(-q * T);

  if (type === 'Call') {
    return Math.max(0, S * discQ * normCDF(d1) - K * discR * normCDF(d2));
  }
  return Math.max(0, K * discR * normCDF(-d2) - S * discQ * normCDF(-d1));
}

/**
 * Black-Scholes-Merton Greeks with dividend yield q.
 * - theta is returned per day (using 252 for du252 or 365 for dc365).
 * - vega is returned per +1 percentage point change in IV (+0.01 sigma).
 * - rho is returned per +1 percentage point change in interest rate (+0.01 r).
 */
export function bsmGreeks(
  input: BSMInput,
  convention: DayCountConvention = 'du252'
): Greeks {
  const { S, K, T, r, q = 0, sigma, type } = input;

  if (type === 'Stock') {
    return { delta: 1, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }

  if (S <= 0 || K <= 0 || T <= 1e-6 || sigma <= 1e-6) {
    const itm = type === 'Call' ? S > K : S < K;
    const atm = Math.abs(S - K) < 1e-6;
    const delta = type === 'Call' ? (itm ? 1 : atm ? 0.5 : 0) : itm ? -1 : atm ? -0.5 : 0;
    return { delta, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const pdfD1 = normPDF(d1);
  const discR = Math.exp(-r * T);
  const discQ = Math.exp(-q * T);
  const daysPerYear = convention === 'du252' ? 252 : 365;

  const gamma = (discQ * pdfD1) / (S * sigma * sqrtT);
  const vega = (S * discQ * pdfD1 * sqrtT) / 100;

  if (type === 'Call') {
    const delta = discQ * normCDF(d1);
    const thetaAnnual =
      -(S * discQ * pdfD1 * sigma) / (2 * sqrtT) -
      r * K * discR * normCDF(d2) +
      q * S * discQ * normCDF(d1);
    const rho = (K * T * discR * normCDF(d2)) / 100;
    return {
      delta,
      gamma,
      theta: thetaAnnual / daysPerYear,
      vega,
      rho,
    };
  }

  const delta = discQ * (normCDF(d1) - 1);
  const thetaAnnual =
    -(S * discQ * pdfD1 * sigma) / (2 * sqrtT) +
    r * K * discR * normCDF(-d2) -
    q * S * discQ * normCDF(-d1);
  const rho = (-K * T * discR * normCDF(-d2)) / 100;

  return {
    delta,
    gamma,
    theta: thetaAnnual / daysPerYear,
    vega,
    rho,
  };
}

/**
 * Convenience wrapper accepting calendar days to maturity and convention.
 */
export function calculateOptionGreeksFromDays(
  S: number,
  K: number,
  calendarDays: number,
  sigma: number,
  type: OptionType,
  r = 0.1425,
  q = 0,
  convention: DayCountConvention = 'du252'
): Greeks {
  const T = getTimeToMaturityYears(calendarDays, convention);
  return bsmGreeks({ S, K, T, r, q, sigma, type }, convention);
}

/**
 * Solves for Implied Volatility from a market option price using Newton-Raphson with Bisection fallback.
 */
export function solveImpliedVolatility(params: {
  marketPrice: number;
  S: number;
  K: number;
  T: number;
  r: number;
  q?: number;
  type: 'Call' | 'Put';
}): number | null {
  const { marketPrice, S, K, T, r, q = 0, type } = params;
  if (marketPrice <= 0 || S <= 0 || K <= 0 || T <= 1e-6) return null;

  const discR = Math.exp(-r * T);
  const discQ = Math.exp(-q * T);
  const lowerBound =
    type === 'Call'
      ? Math.max(0, S * discQ - K * discR)
      : Math.max(0, K * discR - S * discQ);

  if (marketPrice <= lowerBound + 1e-6) return null;

  let low = 0.005;
  let high = 4.0;
  let sigma = 0.35;

  // Newton-Raphson attempts first
  for (let i = 0; i < 25; i++) {
    const price = bsmPrice({ S, K, T, r, q, sigma, type });
    const diff = price - marketPrice;
    if (Math.abs(diff) < 1e-5) return sigma;

    if (diff > 0) high = Math.min(high, sigma);
    else low = Math.max(low, sigma);

    const sqrtT = Math.sqrt(T);
    const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
    const vegaRaw = S * discQ * normPDF(d1) * sqrtT;

    if (vegaRaw > 1e-6) {
      const next = sigma - diff / vegaRaw;
      if (next > low && next < high) {
        sigma = next;
        continue;
      }
    }
    sigma = 0.5 * (low + high);
  }

  // Bisection fallback for guaranteed convergence
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (low + high);
    const price = bsmPrice({ S, K, T, r, q, sigma: mid, type });
    if (Math.abs(price - marketPrice) < 1e-5) return mid;
    if (price > marketPrice) high = mid;
    else low = mid;
  }

  return 0.5 * (low + high);
}

/**
 * Risk-neutral log-normal probability that S_T > threshold under Black-Scholes-Merton.
 */
export function probabilitySpotAbove(
  S: number,
  threshold: number,
  T: number,
  r: number,
  q: number,
  sigma: number
): number {
  if (threshold <= 0) return 1;
  if (S <= 0) return 0;
  if (T <= 1e-6 || sigma <= 1e-6) return S > threshold ? 1 : 0;

  const sqrtT = Math.sqrt(T);
  const d2 = (Math.log(S / threshold) + (r - q - 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  return normCDF(d2);
}
