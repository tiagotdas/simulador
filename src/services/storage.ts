import { CostConfig, ExerciseStyle, Leg, MarketParams, SavedStrategy } from '../types/options';
import { inferDefaultB3ExerciseStyle } from '../engine/blackScholes';
import { resolveDynamicDte } from '../engine/calendar';
import { getDefaultBetaForTicker } from '../engine/portfolioRisk';

const DRAFT_KEY = 'simulador_opcoes_b3_draft_v2';
const PORTFOLIO_KEY = 'simulador_opcoes_b3_portfolio_v2';

export interface WorkspaceDraft {
  ticker: string;
  strategyId: string;
  marketParams: MarketParams;
  costConfig: CostConfig;
  legs: Leg[];
}

function migrateLeg(leg: Leg, underlying: string): Leg {
  const exerciseStyle =
    leg.exerciseStyle ??
    (leg.type === 'Stock' ? undefined : inferDefaultB3ExerciseStyle(leg.type, underlying));
  const daysToMaturity =
    leg.type === 'Stock'
      ? leg.daysToMaturity
      : Math.max(1, resolveDynamicDte(leg.expirationDate, leg.daysToMaturity));

  return {
    ...leg,
    exerciseStyle,
    daysToMaturity,
  };
}

function migrateSavedStrategy(raw: SavedStrategy): SavedStrategy {
  const ticker = String(raw.ticker || 'PETR4').toUpperCase();
  return {
    ...raw,
    ticker,
    marketParams: {
      spotPrice: raw.marketParams?.spotPrice ?? raw.spotAtSave ?? 37.8,
      riskFreeRate: raw.marketParams?.riskFreeRate ?? 0.1425,
      dividendYield: raw.marketParams?.dividendYield ?? 0,
      borrowRate: raw.marketParams?.borrowRate ?? 0.005,
      dayCountConvention: raw.marketParams?.dayCountConvention ?? 'du252',
      popDriftMode: raw.marketParams?.popDriftMode ?? 'risk-neutral',
    },
    legs: Array.isArray(raw.legs) ? raw.legs.map((l) => migrateLeg(l, ticker)) : [],
    adjustments: Array.isArray(raw.adjustments) ? raw.adjustments : [],
    betaToIbov: raw.betaToIbov ?? getDefaultBetaForTicker(ticker),
  };
}

export function loadDraft(): WorkspaceDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkspaceDraft;
    if (!parsed || !Array.isArray(parsed.legs)) return null;
    const ticker = String(parsed.ticker || 'PETR4').toUpperCase();
    return {
      ...parsed,
      ticker,
      marketParams: {
        spotPrice: parsed.marketParams?.spotPrice ?? 37.8,
        riskFreeRate: parsed.marketParams?.riskFreeRate ?? 0.1425,
        dividendYield: parsed.marketParams?.dividendYield ?? 0,
        borrowRate: parsed.marketParams?.borrowRate ?? 0.005,
        dayCountConvention: parsed.marketParams?.dayCountConvention ?? 'du252',
        popDriftMode: parsed.marketParams?.popDriftMode ?? 'risk-neutral',
      },
      legs: parsed.legs.map((l) => migrateLeg(l, ticker)),
    };
  } catch {
    return null;
  }
}

export function saveDraft(draft: WorkspaceDraft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Ignore quota errors in private mode
  }
}

export function loadSavedStrategies(): SavedStrategy[] {
  try {
    const raw = localStorage.getItem(PORTFOLIO_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as SavedStrategy[]).map(migrateSavedStrategy);
  } catch {
    return [];
  }
}

export function persistSavedStrategies(items: SavedStrategy[]): void {
  try {
    localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage quota errors
  }
}

export function exportPortfolioToJson(items: SavedStrategy[]): void {
  const payload = {
    version: 3,
    exportedAt: new Date().toISOString(),
    strategies: items,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `carteira-opcoes-b3-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function parsePortfolioJson(rawJson: string): SavedStrategy[] {
  const parsed = JSON.parse(rawJson);
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.strategies)
    ? parsed.strategies
    : null;
  if (!list) {
    throw new Error('Formato de backup JSON inválido.');
  }
  return (list as SavedStrategy[])
    .filter((item) => item && typeof item.name === 'string' && Array.isArray(item.legs))
    .map(migrateSavedStrategy);
}

interface SharedPayload {
  t: string; // ticker
  s: number; // spot
  r: number; // riskFreeRate
  q: number; // dividendYield
  b?: number; // borrowRate
  l: {
    tk?: string;
    ty: Leg['type'];
    ac: Leg['action'];
    st?: ExerciseStyle;
    k: number;
    qt: number;
    p: number;
    ex: string;
    dt: number;
    iv: number;
    en: boolean;
  }[];
}

export function encodeStrategyToUrl(ticker: string, marketParams: MarketParams, legs: Leg[]): string {
  const payload: SharedPayload = {
    t: ticker,
    s: marketParams.spotPrice,
    r: marketParams.riskFreeRate,
    q: marketParams.dividendYield,
    b: marketParams.borrowRate ?? 0.005,
    l: legs.map((leg) => ({
      tk: leg.ticker,
      ty: leg.type,
      ac: leg.action,
      st: leg.exerciseStyle,
      k: leg.strike,
      qt: leg.quantity,
      p: leg.price,
      ex: leg.expirationDate,
      dt: leg.daysToMaturity,
      iv: leg.impliedVolatility,
      en: leg.enabled,
    })),
  };

  const json = JSON.stringify(payload);
  const encoded = btoa(unescape(encodeURIComponent(json)));
  const url = new URL(window.location.href);
  url.searchParams.set('op', encoded);
  return url.toString();
}

export function decodeStrategyFromUrl(): {
  ticker: string;
  marketParams: Partial<MarketParams>;
  legs: Leg[];
} | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('op');
    if (!raw) return null;
    const json = decodeURIComponent(escape(atob(raw)));
    const payload = JSON.parse(json) as SharedPayload;
    if (!payload || !Array.isArray(payload.l)) return null;

    const ticker = String(payload.t || 'PETR4').toUpperCase();
    const legs: Leg[] = payload.l.map((item, idx) => ({
      id: `shared-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      ticker: item.tk,
      type: item.ty,
      action: item.ac,
      exerciseStyle:
        item.st ??
        (item.ty === 'Stock' ? undefined : inferDefaultB3ExerciseStyle(item.ty, ticker)),
      strike: Number(item.k) || 0,
      quantity: Number(item.qt) || 100,
      price: Number(item.p) || 0,
      expirationDate: item.ex || '',
      daysToMaturity: Math.max(1, resolveDynamicDte(item.ex, Number(item.dt) || 21)),
      impliedVolatility: Number(item.iv) || 0.35,
      enabled: item.en !== false,
    }));

    return {
      ticker,
      marketParams: {
        spotPrice: Number(payload.s) || 37.8,
        riskFreeRate: Number(payload.r) || 0.1425,
        dividendYield: Number(payload.q) || 0,
        borrowRate: payload.b !== undefined ? Number(payload.b) : 0.005,
      },
      legs,
    };
  } catch {
    return null;
  }
}

export async function exportElementToPng(element: HTMLElement, filename: string): Promise<void> {
  const { default: html2canvas } = await import('html2canvas');
  const canvas = await html2canvas(element, {
    backgroundColor: '#090d16',
    scale: 2,
    useCORS: true,
    logging: false,
  });
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

export function exportLegsToCsv(ticker: string, legs: Leg[]): void {
  const headers = [
    'Ticker',
    'Operacao',
    'Tipo',
    'Estilo',
    'Strike',
    'Vencimento',
    'DTE',
    'Quantidade',
    'Premio',
    'IV%',
    'Ativa',
  ];
  const rows = legs.map((l) => [
    l.ticker || ticker,
    l.action === 'Buy' ? 'COMPRA' : 'VENDA',
    l.type,
    l.type === 'Stock' ? 'AVISTA' : l.exerciseStyle === 'American' ? 'AMERICANA' : 'EUROPEIA',
    l.strike.toFixed(2),
    l.expirationDate,
    String(l.daysToMaturity),
    String(l.quantity),
    l.price.toFixed(2),
    (l.impliedVolatility * 100).toFixed(1),
    l.enabled ? 'SIM' : 'NAO',
  ]);
  const csv = [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `estrategia-${ticker.toLowerCase()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
