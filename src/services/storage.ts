import { CostConfig, Leg, MarketParams, SavedStrategy } from '../types/options';

const DRAFT_KEY = 'simulador_opcoes_b3_draft_v2';
const PORTFOLIO_KEY = 'simulador_opcoes_b3_portfolio_v2';

export interface WorkspaceDraft {
  ticker: string;
  strategyId: string;
  marketParams: MarketParams;
  costConfig: CostConfig;
  legs: Leg[];
}

export function loadDraft(): WorkspaceDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkspaceDraft;
    if (!parsed || !Array.isArray(parsed.legs)) return null;
    return parsed;
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
    return Array.isArray(parsed) ? parsed : [];
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

interface SharedPayload {
  t: string; // ticker
  s: number; // spot
  r: number; // riskFreeRate
  q: number; // dividendYield
  l: {
    tk?: string;
    ty: Leg['type'];
    ac: Leg['action'];
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
    l: legs.map((leg) => ({
      tk: leg.ticker,
      ty: leg.type,
      ac: leg.action,
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

    const legs: Leg[] = payload.l.map((item, idx) => ({
      id: `shared-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      ticker: item.tk,
      type: item.ty,
      action: item.ac,
      strike: Number(item.k) || 0,
      quantity: Number(item.qt) || 100,
      price: Number(item.p) || 0,
      expirationDate: item.ex || '',
      daysToMaturity: Math.max(1, Number(item.dt) || 21),
      impliedVolatility: Number(item.iv) || 0.35,
      enabled: item.en !== false,
    }));

    return {
      ticker: String(payload.t || 'PETR4').toUpperCase(),
      marketParams: {
        spotPrice: Number(payload.s) || 37.8,
        riskFreeRate: Number(payload.r) || 0.1425,
        dividendYield: Number(payload.q) || 0,
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
  const headers = ['Ticker', 'Operacao', 'Tipo', 'Strike', 'Vencimento', 'DTE', 'Quantidade', 'Premio', 'IV%', 'Ativa'];
  const rows = legs.map((l) => [
    l.ticker || ticker,
    l.action === 'Buy' ? 'COMPRA' : 'VENDA',
    l.type,
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
