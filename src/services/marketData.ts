import { MarketDataResponse, MarketOption, MarketParams } from '../types/options';
import { bsmGreeks, solveImpliedVolatility } from '../engine/blackScholes';
import { getTimeToMaturityYears } from '../engine/calendar';
import { generateRealisticB3Chain } from './mockMarketData';

const DEFAULT_GAS_URL =
  'https://script.google.com/macros/s/AKfycbx7kyTKXaQtVYg0WzgzMow9s3elbyDq4Su6TSirn3l3Ppn3_T4xIODahwC9Rt9zWpNJtA/exec';

export const GAS_ENDPOINT =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_MARKET_API_URL ||
  DEFAULT_GAS_URL;

interface CacheEntry {
  data: MarketDataResponse;
  fetchedAt: number;
}

const CACHE_TTL_MS = 180_000; // 3 minutes
const memoryCache = new Map<string, CacheEntry>();

function normalizeOption(
  raw: Record<string, unknown>,
  spotPrice: number,
  marketParams: MarketParams
): MarketOption | null {
  const typeRaw = String(raw.type || '').toLowerCase();
  const type: 'Call' | 'Put' | null =
    typeRaw === 'call' || typeRaw === 'c'
      ? 'Call'
      : typeRaw === 'put' || typeRaw === 'p'
      ? 'Put'
      : null;

  const strike = Number(raw.strike);
  if (!type || !Number.isFinite(strike) || strike <= 0) return null;

  const daysToMaturity = Math.max(1, Number(raw.daysToMaturity) || 21);
  const expirationDate = String(raw.expirationDate || '');
  const bid = Math.max(0, Number(raw.bid) || 0);
  const ask = Math.max(0, Number(raw.ask) || 0);
  const last = Math.max(0, Number(raw.last) || (bid > 0 && ask > 0 ? (bid + ask) / 2 : bid || ask));

  let iv = Number(raw.impliedVolatility);
  if (!Number.isFinite(iv) || iv <= 0) {
    const T = getTimeToMaturityYears(daysToMaturity, marketParams.dayCountConvention);
    const refPrice = bid > 0 && ask > 0 ? (bid + ask) / 2 : last;
    const solved =
      refPrice > 0
        ? solveImpliedVolatility({
            marketPrice: refPrice,
            S: spotPrice,
            K: strike,
            T,
            r: marketParams.riskFreeRate,
            q: marketParams.dividendYield,
            type,
          })
        : null;
    iv = solved ?? 0.35;
  } else if (iv > 5) {
    // Normalize percentage values (e.g. 35 instead of 0.35)
    iv = iv / 100;
  }

  const T = getTimeToMaturityYears(daysToMaturity, marketParams.dayCountConvention);
  const greeks = bsmGreeks(
    {
      S: spotPrice,
      K: strike,
      T,
      r: marketParams.riskFreeRate,
      q: marketParams.dividendYield,
      sigma: iv,
      type,
    },
    marketParams.dayCountConvention
  );

  return {
    ticker: String(raw.ticker || `${type[0]}${strike.toFixed(0)}`),
    type,
    strike,
    expirationDate,
    daysToMaturity,
    bid,
    ask,
    last,
    impliedVolatility: iv,
    volume: raw.volume !== undefined ? Number(raw.volume) : undefined,
    openInterest: raw.openInterest !== undefined ? Number(raw.openInterest) : undefined,
    ...greeks,
  };
}

export interface FetchMarketResult {
  data: MarketDataResponse;
  fromCache: boolean;
  fallbackUsed: boolean;
  errorMessage?: string;
}

/**
 * Fetches live option chain from the configured GAS gateway with timeout, AbortController,
 * schema validation, and optional graceful fallback to realistic offline B3 chain.
 */
export async function fetchMarketChain(
  tickerInput: string,
  marketParams: MarketParams,
  options?: { forceRefresh?: boolean; signal?: AbortSignal; allowFallback?: boolean }
): Promise<FetchMarketResult> {
  const ticker = tickerInput.trim().toUpperCase();
  if (!ticker) {
    throw new Error('Informe um ticker válido da B3 (ex.: PETR4).');
  }

  const cached = memoryCache.get(ticker);
  if (!options?.forceRefresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { data: cached.data, fromCache: true, fallbackUsed: cached.data.source === 'mock' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12_000);

  if (options?.signal) {
    options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(`${GAS_ENDPOINT}?ticker=${encodeURIComponent(ticker)}`, {
      method: 'GET',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Gateway retornou HTTP ${response.status}`);
    }

    const json = await response.json();
    if (json?.status !== 'success' || !json?.data || !Array.isArray(json.data.chain)) {
      throw new Error(json?.message || 'Gateway não retornou uma grade de opções válida.');
    }

    const spotPrice = Number(json.data.spotPrice);
    if (!Number.isFinite(spotPrice) || spotPrice <= 0) {
      throw new Error('Preço Spot inválido recebido do gateway.');
    }

    const normalizedChain = (json.data.chain as Record<string, unknown>[])
      .map((item) => normalizeOption(item, spotPrice, marketParams))
      .filter((o): o is MarketOption => o !== null);

    if (normalizedChain.length === 0) {
      throw new Error(`Nenhuma opção líquida encontrada para ${ticker}.`);
    }

    const result: MarketDataResponse = {
      baseAsset: String(json.data.baseAsset || ticker).toUpperCase(),
      spotPrice,
      timestamp: json.data.timestamp || new Date().toISOString(),
      source: 'gas',
      chain: normalizedChain,
      diagnostics: json.data.diagnostics,
    };

    memoryCache.set(ticker, { data: result, fetchedAt: Date.now() });
    return { data: result, fromCache: false, fallbackUsed: false };
  } catch (err) {
    const message =
      err instanceof DOMException && err.name === 'AbortError'
        ? 'Tempo limite excedido ao consultar o Gateway GAS (12s).'
        : err instanceof Error
        ? err.message
        : 'Falha de comunicação com o Gateway GAS.';

    if (options?.allowFallback) {
      const mockData = generateRealisticB3Chain(ticker, marketParams);
      return {
        data: mockData,
        fromCache: false,
        fallbackUsed: true,
        errorMessage: message,
      };
    }

    throw new Error(message);
  } finally {
    clearTimeout(timeoutId);
  }
}

export function clearMarketCache(ticker?: string): void {
  if (ticker) memoryCache.delete(ticker.toUpperCase());
  else memoryCache.clear();
}
