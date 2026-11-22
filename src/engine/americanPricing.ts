import { DayCountConvention, ExerciseStyle, Greeks } from '../types/options';
import { bsmGreeks, bsmPrice, BSMInput, intrinsicValue, normCDF, solveImpliedVolatility } from './blackScholes';

// 5-point Gauss-Legendre abscissas and weights on [0, 1] for Drezner-Wesolowsky (1990) bivariate normal CDF
const GL_X = [0.04691008, 0.23076534, 0.5, 0.76923466, 0.95308992];
const GL_W = [0.11846344, 0.23931434, 0.28444444, 0.23931434, 0.11846344];

/**
 * Standard Bivariate Normal CDF M(a, b; rho) = P(X <= a, Y <= b)
 * using Drezner & Wesolowsky (1990) Gauss-Legendre quadrature.
 */
export function bivariateNormCDF(a: number, b: number, rho: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    if (a === -Infinity || b === -Infinity) return 0;
    if (a === Infinity) return normCDF(b);
    if (b === Infinity) return normCDF(a);
    return 0;
  }

  const r = Math.max(-0.999999, Math.min(0.999999, rho));
  if (Math.abs(r) < 1e-10) {
    return normCDF(a) * normCDF(b);
  }

  // Transform to upper-tail convention h = -a, k = -b
  const h = -a;
  const k = -b;
  const hk = h * k;
  let bvn = 0;

  if (Math.abs(r) < 0.925) {
    const hs = (h * h + k * k) / 2;
    const asr = Math.asin(r);
    for (let i = 0; i < GL_X.length; i++) {
      const sn = Math.sin(asr * GL_X[i]);
      bvn += GL_W[i] * Math.exp((sn * hk - hs) / (1 - sn * sn));
    }
    bvn = (bvn * asr) / (2 * Math.PI) + normCDF(-h) * normCDF(-k);
    return Math.min(1, Math.max(0, bvn));
  }

  // High |rho| branch
  if (r < 0) {
    const kNeg = -k;
    const hkNeg = -hk;
    return Math.min(1, Math.max(0, normCDF(-h) - bivariateNormCDFHighRho(h, kNeg, -r, hkNeg)));
  }

  return Math.min(1, Math.max(0, bivariateNormCDFHighRho(h, k, r, hk)));
}

function bivariateNormCDFHighRho(h: number, k: number, r: number, hk: number): number {
  const ass = (1 - r) * (1 + r);
  let aVal = Math.sqrt(ass);
  const bs = (h - k) * (h - k);
  const c = (4 - hk) / 8;
  const d = (12 - hk) / 16;
  const asr = -(bs / ass + hk) / 2;

  let bvn = 0;
  if (asr > -100) {
    bvn =
      aVal *
      Math.exp(asr) *
      (1 - c * (bs - ass) * (1 - (d * bs) / 5) / 3 + (c * d * ass * ass) / 5);
  }

  if (-hk < 100) {
    const bVal = Math.sqrt(bs);
    bvn -=
      Math.exp(-hk / 2) *
      Math.sqrt(2 * Math.PI) *
      normCDF(-bVal / aVal) *
      bVal *
      (1 - c * bs * (1 - (d * bs) / 5) / 3);
  }

  aVal = aVal / 2;
  for (let i = 0; i < GL_X.length; i++) {
    const xs = (aVal * GL_X[i]) ** 2;
    const rs = Math.sqrt(1 - xs);
    const asr2 = -(bs / xs + hk) / 2;
    if (asr2 > -100) {
      bvn +=
        aVal *
        GL_W[i] *
        Math.exp(asr2) *
        (Math.exp((-hk * (1 - rs)) / (2 * (1 + rs))) / rs - (1 + c * xs * (1 + d * xs)));
    }
  }

  bvn = -bvn / (2 * Math.PI) + normCDF(-Math.max(h, k));
  return bvn;
}

/**
 * Cox-Ross-Rubinstein (CRR) Binomial Tree pricer for American options.
 * Used as reference benchmark in tests and numerical fallback for extreme edge cases.
 */
export function crrAmericanPrice(input: BSMInput, steps = 150): number {
  const { S, K, T, r, q = 0, sigma, type } = input;
  if (type === 'Stock') return Math.max(0, S);
  if (S <= 0 || K <= 0) return intrinsicValue(type, Math.max(0, S), Math.max(0, K));
  if (T <= 1e-6 || sigma <= 1e-6) return intrinsicValue(type, S, K);

  const n = Math.max(10, steps);
  const dt = T / n;
  const u = Math.exp(sigma * Math.sqrt(dt));
  const d = 1 / u;
  const growth = Math.exp((r - q) * dt);
  const p = (growth - d) / (u - d);

  if (!Number.isFinite(p) || p <= 0 || p >= 1) {
    return Math.max(intrinsicValue(type, S, K), bsmPrice(input));
  }

  const disc = Math.exp(-r * dt);
  const values = new Float64Array(n + 1);

  for (let i = 0; i <= n; i++) {
    const spotNode = S * Math.pow(u, n - i) * Math.pow(d, i);
    values[i] = intrinsicValue(type, spotNode, K);
  }

  for (let step = n - 1; step >= 0; step--) {
    for (let i = 0; i <= step; i++) {
      const hold = disc * (p * values[i] + (1 - p) * values[i + 1]);
      const spotNode = S * Math.pow(u, step - i) * Math.pow(d, i);
      const exercise = intrinsicValue(type, spotNode, K);
      values[i] = hold > exercise ? hold : exercise;
    }
  }

  return Math.max(0, values[0]);
}

function safePowTerm(ratio: number, power: number, prob: number): number {
  if (prob <= 1e-15) return 0;
  const logVal = power * Math.log(ratio);
  if (logVal > 600) return 0; // Guard against 0 * Inf in far-tail regions
  if (logVal < -600) return 0;
  return Math.exp(logVal) * prob;
}

function bs02Phi(
  S: number,
  T: number,
  gamma: number,
  H: number,
  I: number,
  r: number,
  b: number,
  sigma: number
): number {
  const sigma2 = sigma * sigma;
  const sqrtT = Math.sqrt(T);
  const lambda = -r + gamma * b + 0.5 * gamma * (gamma - 1) * sigma2;
  const kappa = (2 * b) / sigma2 + (2 * gamma - 1);
  const d = -(Math.log(S / H) + (b + (gamma - 0.5) * sigma2) * T) / (sigma * sqrtT);
  const dI = d - (2 * Math.log(I / S)) / (sigma * sqrtT);

  const pref = Math.exp(lambda * T) * Math.pow(S, gamma);
  const term1 = normCDF(d);
  const term2 = safePowTerm(I / S, kappa, normCDF(dI));
  return pref * (term1 - term2);
}

function bs02Psi(
  S: number,
  T: number,
  gamma: number,
  H: number,
  I2: number,
  I1: number,
  t1: number,
  r: number,
  b: number,
  sigma: number
): number {
  const sigma2 = sigma * sigma;
  const sqrtT = Math.sqrt(T);
  const sqrtT1 = Math.sqrt(t1);
  const driftT1 = (b + (gamma - 0.5) * sigma2) * t1;
  const driftT = (b + (gamma - 0.5) * sigma2) * T;

  const e1 = (Math.log(S / I1) + driftT1) / (sigma * sqrtT1);
  const e2 = (Math.log((I2 * I2) / (S * I1)) + driftT1) / (sigma * sqrtT1);
  const e3 = (Math.log(S / I1) - driftT1) / (sigma * sqrtT1);
  const e4 = (Math.log((I2 * I2) / (S * I1)) - driftT1) / (sigma * sqrtT1);

  const f1 = (Math.log(S / H) + driftT) / (sigma * sqrtT);
  const f2 = (Math.log((I2 * I2) / (S * H)) + driftT) / (sigma * sqrtT);
  const f3 = (Math.log((I1 * I1) / (S * H)) + driftT) / (sigma * sqrtT);
  const f4 = (Math.log((S * I1 * I1) / (H * I2 * I2)) + driftT) / (sigma * sqrtT);

  const rho = Math.sqrt(t1 / T);
  const lambda = -r + gamma * b + 0.5 * gamma * (gamma - 1) * sigma2;
  const kappa = (2 * b) / sigma2 + (2 * gamma - 1);

  const m1 = bivariateNormCDF(-e1, -f1, rho);
  const m2 = safePowTerm(I2 / S, kappa, bivariateNormCDF(-e2, -f2, rho));
  const m3 = safePowTerm(I1 / S, kappa, bivariateNormCDF(-e3, -f3, -rho));
  const m4 = safePowTerm(I1 / I2, kappa, bivariateNormCDF(-e4, -f4, -rho));

  return Math.exp(lambda * T) * Math.pow(S, gamma) * (m1 - m2 - m3 + m4);
}

function bjerksundStensland2002Call(
  S: number,
  K: number,
  T: number,
  r: number,
  b: number,
  sigma: number
): number {
  const euro = bsmPrice({ S, K, T, r, q: r - b, sigma, type: 'Call' });
  // Early exercise is never optimal for a Call when cost-of-carry b >= r (i.e. q <= 0)
  if (b >= r - 1e-9) {
    return euro;
  }

  const sigma2 = sigma * sigma;
  const term = b / sigma2 - 0.5;
  const discRoot = term * term + (2 * r) / sigma2;
  if (discRoot < 0) return Math.max(euro, intrinsicValue('Call', S, K));

  const beta = 0.5 - b / sigma2 + Math.sqrt(discRoot);
  if (beta <= 1 + 1e-8) {
    return Math.max(euro, crrAmericanPrice({ S, K, T, r, q: r - b, sigma, type: 'Call' }, 100));
  }

  const BInfinity = (beta / (beta - 1)) * K;
  const B0 = Math.max(K, (r / (r - b)) * K);
  if (BInfinity <= B0 + 1e-8) {
    return Math.max(euro, intrinsicValue('Call', S, K));
  }

  const t1 = 0.5 * (Math.sqrt(5) - 1) * T;
  const remT = T - t1;
  const h1 = -((b * remT + 2 * sigma * Math.sqrt(remT)) * K * K) / ((BInfinity - B0) * B0);
  const h2 = -((b * T + 2 * sigma * Math.sqrt(T)) * K * K) / ((BInfinity - B0) * B0);

  const I1 = B0 + (BInfinity - B0) * (1 - Math.exp(h1));
  const I2 = B0 + (BInfinity - B0) * (1 - Math.exp(h2));

  if (S >= I2) {
    return Math.max(euro, S - K);
  }

  const alpha1 = (I1 - K) * Math.pow(I1, -beta);
  const alpha2 = (I2 - K) * Math.pow(I2, -beta);

  const val =
    alpha2 * Math.pow(S, beta) -
    alpha2 * bs02Phi(S, t1, beta, I2, I2, r, b, sigma) +
    bs02Phi(S, t1, 1, I2, I2, r, b, sigma) -
    bs02Phi(S, t1, 1, I1, I2, r, b, sigma) -
    K * bs02Phi(S, t1, 0, I2, I2, r, b, sigma) +
    K * bs02Phi(S, t1, 0, I1, I2, r, b, sigma) +
    alpha1 * bs02Phi(S, t1, beta, I1, I2, r, b, sigma) -
    alpha1 * bs02Psi(S, T, beta, I1, I2, I1, t1, r, b, sigma) +
    bs02Psi(S, T, 1, I1, I2, I1, t1, r, b, sigma) -
    bs02Psi(S, T, 1, K, I2, I1, t1, r, b, sigma) -
    K * bs02Psi(S, T, 0, I1, I2, I1, t1, r, b, sigma) +
    K * bs02Psi(S, T, 0, K, I2, I1, t1, r, b, sigma);

  if (!Number.isFinite(val)) {
    return crrAmericanPrice({ S, K, T, r, q: r - b, sigma, type: 'Call' }, 100);
  }

  return Math.max(euro, intrinsicValue('Call', S, K), val);
}

/**
 * Closed-form Bjerksund-Stensland (2002) American option pricer.
 * Uses Put-Call transformation P_Am(S, K, T, r, b, sigma) = C_Am(K, S, T, r - b, -b, sigma).
 */
export function bjerksundStensland2002(input: BSMInput): number {
  const { S, K, T, r, q = 0, sigma, type } = input;
  if (type === 'Stock') return Math.max(0, S);
  if (S <= 0 || K <= 0) return intrinsicValue(type, Math.max(0, S), Math.max(0, K));
  if (T <= 1e-6 || sigma <= 1e-6) return intrinsicValue(type, S, K);

  const b = r - q;
  if (type === 'Call') {
    return bjerksundStensland2002Call(S, K, T, r, b, sigma);
  }

  // Put-Call symmetry for American puts
  const euroPut = bsmPrice(input);
  const transformed = bjerksundStensland2002Call(K, S, T, r - b, -b, sigma);
  return Math.max(euroPut, intrinsicValue('Put', S, K), transformed);
}

export interface OptionPricingInput extends BSMInput {
  exerciseStyle?: ExerciseStyle;
}

/**
 * Unified option pricing entry point dispatching to European BSM or American Bjerksund-Stensland (2002).
 */
export function priceOption(input: OptionPricingInput): number {
  const { exerciseStyle = 'European', type, q = 0 } = input;
  if (type === 'Stock') return Math.max(0, input.S);
  if (exerciseStyle === 'American') {
    // Fast path: American Call with q <= 0 equals European Call
    if (type === 'Call' && q <= 1e-9) {
      return bsmPrice(input);
    }
    return bjerksundStensland2002(input);
  }
  return bsmPrice(input);
}

/**
 * Unified Greeks computation for both European (analytical BSM) and American options
 * (centered finite differences on Bjerksund-Stensland 2002 when early exercise premium applies).
 */
export function greeksOption(
  input: OptionPricingInput,
  convention: DayCountConvention = 'du252'
): Greeks {
  const { S, K, T, r, q = 0, sigma, type, exerciseStyle = 'European' } = input;

  if (type === 'Stock') {
    return { delta: 1, gamma: 0, theta: 0, vega: 0, rho: 0, vanna: 0, volga: 0, charm: 0 };
  }

  // Analytical European BSM path (also exact for American Call with q <= 0)
  if (exerciseStyle !== 'American' || (type === 'Call' && q <= 1e-9)) {
    return bsmGreeks(input, convention);
  }

  if (S <= 0 || K <= 0 || T <= 1e-6 || sigma <= 1e-6) {
    return bsmGreeks(input, convention);
  }

  const daysPerYear = convention === 'du252' ? 252 : 365;
  const dS = Math.max(0.01, S * 0.0025);
  const dSigma = 0.0025;
  const dR = 0.0005;
  const dT = Math.min(T * 0.25, 1 / daysPerYear);

  const p0 = bjerksundStensland2002(input);
  const pUp = bjerksundStensland2002({ ...input, S: S + dS });
  const pDn = bjerksundStensland2002({ ...input, S: Math.max(1e-4, S - dS) });

  const delta = (pUp - pDn) / (2 * dS);
  const gamma = Math.max(0, (pUp - 2 * p0 + pDn) / (dS * dS));

  const pVolUp = bjerksundStensland2002({ ...input, sigma: sigma + dSigma });
  const pVolDn = bjerksundStensland2002({ ...input, sigma: Math.max(0.005, sigma - dSigma) });
  const vegaRaw = (pVolUp - pVolDn) / (2 * dSigma);
  const vega = vegaRaw / 100;
  const volga = ((pVolUp - 2 * p0 + pVolDn) / (dSigma * dSigma)) / 10000;

  const pNextDay = bjerksundStensland2002({ ...input, T: Math.max(0, T - dT) });
  const theta = (pNextDay - p0) / (dT * daysPerYear);

  const pRUp = bjerksundStensland2002({ ...input, r: r + dR });
  const pRDn = bjerksundStensland2002({ ...input, r: r - dR });
  const rho = (pRUp - pRDn) / (2 * dR * 100);

  // Cross-derivatives for Vanna & Charm
  const deltaVolUp =
    (bjerksundStensland2002({ ...input, S: S + dS, sigma: sigma + dSigma }) -
      bjerksundStensland2002({ ...input, S: Math.max(1e-4, S - dS), sigma: sigma + dSigma })) /
    (2 * dS);
  const deltaVolDn =
    (bjerksundStensland2002({ ...input, S: S + dS, sigma: Math.max(0.005, sigma - dSigma) }) -
      bjerksundStensland2002({
        ...input,
        S: Math.max(1e-4, S - dS),
        sigma: Math.max(0.005, sigma - dSigma),
      })) /
    (2 * dS);
  const vanna = (deltaVolUp - deltaVolDn) / (2 * dSigma * 100);

  const deltaNextDay =
    (bjerksundStensland2002({ ...input, S: S + dS, T: Math.max(0, T - dT) }) -
      bjerksundStensland2002({ ...input, S: Math.max(1e-4, S - dS), T: Math.max(0, T - dT) })) /
    (2 * dS);
  const charm = (deltaNextDay - delta) / (dT * daysPerYear);

  return { delta, gamma, theta, vega, rho, vanna, volga, charm };
}

/**
 * Solves implied volatility respecting exercise style (European or American).
 */
export function solveOptionImpliedVolatility(params: {
  marketPrice: number;
  S: number;
  K: number;
  T: number;
  r: number;
  q?: number;
  type: 'Call' | 'Put';
  exerciseStyle?: ExerciseStyle;
}): number | null {
  const { exerciseStyle = 'European', S, K, T, r, q = 0, type } = params;
  if (exerciseStyle === 'American' && !(type === 'Call' && q <= 1e-9)) {
    return solveImpliedVolatility({
      ...params,
      priceFn: (sigma) => bjerksundStensland2002({ S, K, T, r, q, sigma, type }),
    });
  }
  return solveImpliedVolatility(params);
}
