import { MarketDataResponse, MarketOption, MarketParams } from '../types/options';
import { greeksOption, priceOption } from '../engine/americanPricing';
import { getContinuousMarketRates, inferDefaultB3ExerciseStyle } from '../engine/blackScholes';
import {
  generateB3OptionTicker,
  getTimeToMaturityYears,
  getUpcomingB3Expiries,
} from '../engine/calendar';
import { roundToB3Strike } from '../engine/strategies';

const PRESET_TICKERS: Record<string, { spot: number; baseIv: number; hv: number; borrow: number }> = {
  PETR4: { spot: 37.8, baseIv: 0.31, hv: 0.28, borrow: 0.005 },
  VALE3: { spot: 61.5, baseIv: 0.29, hv: 0.265, borrow: 0.004 },
  BOVA11: { spot: 126.4, baseIv: 0.19, hv: 0.175, borrow: 0.003 },
  BBAS3: { spot: 28.4, baseIv: 0.26, hv: 0.235, borrow: 0.004 },
  ITUB4: { spot: 34.2, baseIv: 0.24, hv: 0.215, borrow: 0.003 },
  BBDC4: { spot: 14.9, baseIv: 0.32, hv: 0.29, borrow: 0.006 },
  WEGE3: { spot: 53.6, baseIv: 0.28, hv: 0.255, borrow: 0.004 },
  MGLU3: { spot: 11.2, baseIv: 0.62, hv: 0.56, borrow: 0.025 },
};

export const POPULAR_B3_TICKERS = Object.keys(PRESET_TICKERS);

export function getPresetSpotForTicker(ticker: string): number | undefined {
  return PRESET_TICKERS[ticker.trim().toUpperCase()]?.spot;
}

/**
 * Generates a realistic B3 Option Chain with volatility smile/skew, term structure,
 * ANBIMA B3 monthly expiries, American Calls / European Puts, and realistic Bid/Ask spreads.
 */
export function generateRealisticB3Chain(
  tickerInput: string,
  marketParams?: Partial<MarketParams>
): MarketDataResponse {
  const ticker = (tickerInput || 'PETR4').trim().toUpperCase();
  const preset = PRESET_TICKERS[ticker] || { spot: 35.0, baseIv: 0.34, hv: 0.31, borrow: 0.005 };
  const spotPrice =
    marketParams?.spotPrice && marketParams.spotPrice > 0 && !PRESET_TICKERS[ticker]
      ? marketParams.spotPrice
      : preset.spot;

  const effectiveParams: MarketParams = {
    spotPrice,
    riskFreeRate: marketParams?.riskFreeRate ?? 0.1425,
    dividendYield: marketParams?.dividendYield ?? 0,
    borrowRate: marketParams?.borrowRate ?? preset.borrow,
    dayCountConvention: marketParams?.dayCountConvention ?? 'du252',
  };
  const { rCont, qCont } = getContinuousMarketRates(effectiveParams);

  const expiries = getUpcomingB3Expiries(3);
  const strikeStep = spotPrice < 15 ? 0.5 : spotPrice < 60 ? 1.0 : 2.0;
  const centerStrike = roundToB3Strike(spotPrice);

  const strikes: number[] = [];
  for (let i = -8; i <= 8; i++) {
    const k = Number((centerStrike + i * strikeStep).toFixed(2));
    if (k > 0.5) strikes.push(k);
  }

  const chain: MarketOption[] = [];

  expiries.forEach((exp, expIdx) => {
    const T = getTimeToMaturityYears(
      exp.calendarDays,
      effectiveParams.dayCountConvention,
      exp.date
    );
    // Gentle contango term structure across front -> mid -> far month
    const termAdj = expIdx * 0.012;

    for (const strike of strikes) {
      const moneyness = (strike - spotPrice) / spotPrice;
      // Realistic B3 equity volatility skew (higher IV on downside puts, flatter in far expiries)
      const skewSlope = 0.34 / Math.sqrt(1 + expIdx * 0.45);
      const smile = Math.max(
        0.12,
        preset.baseIv + termAdj - skewSlope * moneyness + 0.65 * moneyness * moneyness
      );

      for (const type of ['Call', 'Put'] as const) {
        const exerciseStyle = inferDefaultB3ExerciseStyle(type, ticker);
        const theo = priceOption({
          S: spotPrice,
          K: strike,
          T,
          r: rCont,
          q: qCont,
          sigma: smile,
          type,
          exerciseStyle,
        });
        const spreadHalf = Math.max(
          0.01,
          Math.min(0.12, theo * (Math.abs(moneyness) > 0.12 ? 0.06 : 0.02))
        );
        const bid = Number(Math.max(0.01, theo - spreadHalf).toFixed(2));
        const ask = Number(Math.max(bid + 0.01, theo + spreadHalf).toFixed(2));
        const last = Number(((bid + ask) / 2).toFixed(2));
        const greeks = greeksOption(
          {
            S: spotPrice,
            K: strike,
            T,
            r: rCont,
            q: qCont,
            sigma: smile,
            type,
            exerciseStyle,
          },
          effectiveParams.dayCountConvention
        );

        const atmFactor = Math.exp(-Math.pow(moneyness / 0.08, 2));
        const expiryDecay = Math.pow(0.6, expIdx);
        const volume = Math.round((150 + atmFactor * 48000) * expiryDecay);
        const openInterest = Math.round((600 + atmFactor * 120000) * expiryDecay);

        chain.push({
          ticker: generateB3OptionTicker(ticker, type, exp.date, strike),
          type,
          exerciseStyle,
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
  });

  return {
    baseAsset: ticker,
    spotPrice,
    timestamp: new Date().toISOString(),
    source: 'mock',
    chain,
    historicalVolatility: preset.hv,
    diagnostics: 'Modo Simulação Offline (grade teórica calibrada para convenção B3 du/252)',
  };
}
