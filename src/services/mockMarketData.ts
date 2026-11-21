import { MarketDataResponse, MarketOption, MarketParams } from '../types/options';
import { bsmGreeks, bsmPrice } from '../engine/blackScholes';
import {
  generateB3OptionTicker,
  getTimeToMaturityYears,
  getUpcomingB3Expiries,
} from '../engine/calendar';
import { roundToB3Strike } from '../engine/strategies';

const PRESET_TICKERS: Record<string, { spot: number; baseIv: number; dy: number }> = {
  PETR4: { spot: 37.8, baseIv: 0.31, dy: 0.12 },
  VALE3: { spot: 61.5, baseIv: 0.29, dy: 0.08 },
  BOVA11: { spot: 126.4, baseIv: 0.19, dy: 0.0 },
  BBAS3: { spot: 28.4, baseIv: 0.26, dy: 0.09 },
  ITUB4: { spot: 34.2, baseIv: 0.24, dy: 0.07 },
  BBDC4: { spot: 14.9, baseIv: 0.32, dy: 0.06 },
  WEGE3: { spot: 53.6, baseIv: 0.28, dy: 0.02 },
  MGLU3: { spot: 11.2, baseIv: 0.62, dy: 0.0 },
};

export const POPULAR_B3_TICKERS = Object.keys(PRESET_TICKERS);

/**
 * Generates a realistic B3 Option Chain with volatility smile/skew, B3 monthly expiries,
 * and realistic Bid/Ask spreads for instant offline simulation or GAS fallback.
 */
export function generateRealisticB3Chain(
  tickerInput: string,
  marketParams?: Partial<MarketParams>
): MarketDataResponse {
  const ticker = (tickerInput || 'PETR4').trim().toUpperCase();
  const preset = PRESET_TICKERS[ticker] || { spot: 35.0, baseIv: 0.34, dy: 0.05 };
  const spotPrice = marketParams?.spotPrice && marketParams.spotPrice > 0 && !PRESET_TICKERS[ticker]
    ? marketParams.spotPrice
    : preset.spot;
  const r = marketParams?.riskFreeRate ?? 0.1425;
  const q = marketParams?.dividendYield ?? preset.dy;
  const convention = marketParams?.dayCountConvention ?? 'du252';

  const expiries = getUpcomingB3Expiries(3);
  const strikeStep = spotPrice < 15 ? 0.5 : spotPrice < 60 ? 1.0 : 2.0;
  const centerStrike = roundToB3Strike(spotPrice);

  const strikes: number[] = [];
  for (let i = -8; i <= 8; i++) {
    const k = Number((centerStrike + i * strikeStep).toFixed(2));
    if (k > 0.5) strikes.push(k);
  }

  const chain: MarketOption[] = [];

  for (const exp of expiries) {
    const T = getTimeToMaturityYears(exp.calendarDays, convention);
    const termAdj = exp.calendarDays > 45 ? -0.015 : 0;

    for (const strike of strikes) {
      const moneyness = (strike - spotPrice) / spotPrice;
      // Realistic B3 equity volatility skew (higher IV on downside puts)
      const smile = Math.max(0.12, preset.baseIv + termAdj - 0.32 * moneyness + 0.65 * moneyness * moneyness);

      for (const type of ['Call', 'Put'] as const) {
        const theo = bsmPrice({ S: spotPrice, K: strike, T, r, q, sigma: smile, type });
        const spreadHalf = Math.max(0.01, Math.min(0.12, theo * (Math.abs(moneyness) > 0.12 ? 0.06 : 0.02)));
        const bid = Number(Math.max(0.01, theo - spreadHalf).toFixed(2));
        const ask = Number(Math.max(bid + 0.01, theo + spreadHalf).toFixed(2));
        const last = Number(((bid + ask) / 2).toFixed(2));
        const greeks = bsmGreeks({ S: spotPrice, K: strike, T, r, q, sigma: smile, type }, convention);

        // Liquidity concentrates near ATM
        const atmFactor = Math.exp(-Math.pow(moneyness / 0.08, 2));
        const volume = Math.round(150 + atmFactor * 48000);
        const openInterest = Math.round(600 + atmFactor * 120000);

        chain.push({
          ticker: generateB3OptionTicker(ticker, type, exp.date, strike),
          type,
          strike,
          expirationDate: exp.date,
          daysToMaturity: exp.calendarDays,
          bid,
          ask,
          last,
          impliedVolatility: Number(smile.toFixed(4)),
          volume,
          openInterest,
          ...greeks,
        });
      }
    }
  }

  return {
    baseAsset: ticker,
    spotPrice,
    timestamp: new Date().toISOString(),
    source: 'mock',
    chain,
    diagnostics: 'Modo Simulação Offline (grade teórica calibrada para convenção B3)',
  };
}
