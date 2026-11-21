import React, { useState } from 'react';
import {
  Activity,
  BookOpen,
  Briefcase,
  ChevronDown,
  ClipboardList,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { MarketDataResponse, MarketParams } from '../../types/options';
import { POPULAR_B3_TICKERS } from '../../services/mockMarketData';

interface TopBarProps {
  ticker: string;
  onTickerChange: (val: string) => void;
  onSyncMarket: (tickerOverride?: string, forceRefresh?: boolean) => void;
  isFetching: boolean;
  marketData: MarketDataResponse | null;
  marketParams: MarketParams;
  onMarketParamsChange: (patch: Partial<MarketParams>) => void;
  activeStrategyName: string;
  onOpenStrategyExplorer: () => void;
  onOpenOrderTicket: () => void;
  onOpenPortfolio: () => void;
  savedCount: number;
  activeLegsCount: number;
}

export const TopBar: React.FC<TopBarProps> = ({
  ticker,
  onTickerChange,
  onSyncMarket,
  isFetching,
  marketData,
  marketParams,
  onMarketParamsChange,
  activeStrategyName,
  onOpenStrategyExplorer,
  onOpenOrderTicket,
  onOpenPortfolio,
  savedCount,
  activeLegsCount,
}) => {
  const [showParams, setShowParams] = useState(false);

  const lastUpdateTime = marketData?.timestamp
    ? new Date(marketData.timestamp).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  const isLiveGas = marketData?.source === 'gas';

  return (
    <header className="sticky top-0 z-40 bg-[#090d16]/95 backdrop-blur-md border-b border-slate-800/90">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex flex-col gap-3">
        {/* Main Row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Brand + Data Status */}
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center shrink-0">
              <Activity className="text-sky-400" size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold tracking-tight text-slate-50 leading-none">
                  Terminal de Opções B3
                </h1>
                <span
                  title={marketData?.diagnostics || 'Fonte de cotações'}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${
                    isLiveGas
                      ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                      : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                  }`}
                >
                  {isLiveGas ? <Wifi size={11} /> : <WifiOff size={11} />}
                  {isLiveGas
                    ? `GAS B3${lastUpdateTime ? ` • ${lastUpdateTime}` : ''}`
                    : 'Simulação Offline'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 hidden sm:block">
                Payoff BSM ({marketParams.dayCountConvention === 'du252' ? 'du/252' : 'dc/365'}) •
                Selic {(marketParams.riskFreeRate * 100).toFixed(2)}% • DY{' '}
                {(marketParams.dividendYield * 100).toFixed(1)}%
              </p>
            </div>
          </div>

          {/* Ticker Sync + Editable Spot */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Ticker Input & Sync */}
            <div className="flex items-center bg-[#0f1623] border border-slate-700/80 rounded-lg p-1">
              <label htmlFor="ticker-input" className="sr-only">
                Código do ativo na B3
              </label>
              <input
                id="ticker-input"
                type="text"
                value={ticker}
                onChange={(e) => onTickerChange(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSyncMarket(ticker, true);
                }}
                placeholder="PETR4"
                maxLength={8}
                className="bg-transparent text-slate-100 font-mono font-bold text-sm uppercase w-20 px-2 py-1 outline-none placeholder:text-slate-500"
              />
              <button
                type="button"
                id="btn-sync-market"
                onClick={() => onSyncMarket(ticker, true)}
                disabled={isFetching}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors disabled:opacity-60"
              >
                {isFetching ? (
                  <RefreshCw size={13} className="animate-spin" />
                ) : (
                  <Search size={13} />
                )}
                <span>{isFetching ? 'Buscando...' : 'Sincronizar'}</span>
              </button>
            </div>

            {/* Editable Spot Price */}
            <div className="flex items-center gap-1.5 bg-[#0f1623] border border-slate-700/80 rounded-lg px-2.5 py-1.5">
              <label htmlFor="spot-input" className="text-[11px] font-semibold text-slate-400 uppercase">
                Spot R$
              </label>
              <input
                id="spot-input"
                type="number"
                step="0.01"
                min="0.01"
                value={marketParams.spotPrice}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val) && val > 0) {
                    onMarketParamsChange({ spotPrice: val });
                  }
                }}
                className="bg-transparent text-amber-300 font-mono font-bold text-sm w-16 text-right outline-none tabular-nums no-spinner"
              />
            </div>

            {/* Parameters Toggle */}
            <div className="relative">
              <button
                type="button"
                id="btn-market-params"
                onClick={() => setShowParams((v) => !v)}
                aria-expanded={showParams}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                  showParams
                    ? 'bg-slate-800 border-sky-500/50 text-sky-300'
                    : 'bg-[#0f1623] border-slate-700/80 text-slate-200 hover:bg-slate-800'
                }`}
              >
                <SlidersHorizontal size={14} />
                <span className="hidden md:inline">BSM</span>
                <ChevronDown size={13} />
              </button>

              {showParams && (
                <div className="absolute right-0 mt-2 w-72 rounded-xl bg-[#0f1623] border border-slate-700 shadow-2xl p-4 z-50 space-y-3.5">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="text-xs font-bold text-slate-200">Parâmetros B3 / Black-Scholes</span>
                    <button
                      type="button"
                      onClick={() => setShowParams(false)}
                      className="text-xs text-slate-400 hover:text-white"
                    >
                      Fechar
                    </button>
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="selic-input" className="text-xs text-slate-300 flex justify-between">
                      <span>Taxa Selic / DI (% a.a.)</span>
                      <span className="font-mono text-sky-400">
                        {(marketParams.riskFreeRate * 100).toFixed(2)}%
                      </span>
                    </label>
                    <input
                      id="selic-input"
                      type="number"
                      step="0.25"
                      min="0"
                      max="50"
                      value={Number((marketParams.riskFreeRate * 100).toFixed(2))}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v) && v >= 0) onMarketParamsChange({ riskFreeRate: v / 100 });
                      }}
                      className="w-full bg-[#090d16] border border-slate-700 rounded-lg px-3 py-1.5 text-sm font-mono text-white"
                    />
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="dy-input" className="text-xs text-slate-300 flex justify-between">
                      <span>Dividend Yield Estimado (% a.a.)</span>
                      <span className="font-mono text-sky-400">
                        {(marketParams.dividendYield * 100).toFixed(1)}%
                      </span>
                    </label>
                    <input
                      id="dy-input"
                      type="number"
                      step="0.5"
                      min="0"
                      max="40"
                      value={Number((marketParams.dividendYield * 100).toFixed(2))}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v) && v >= 0) onMarketParamsChange({ dividendYield: v / 100 });
                      }}
                      className="w-full bg-[#090d16] border border-slate-700 rounded-lg px-3 py-1.5 text-sm font-mono text-white"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-xs text-slate-300 block">Base de Contagem</span>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => onMarketParamsChange({ dayCountConvention: 'du252' })}
                        className={`py-1.5 px-2 rounded-lg text-xs font-semibold border transition-colors ${
                          marketParams.dayCountConvention === 'du252'
                            ? 'bg-sky-600/20 border-sky-500 text-sky-300'
                            : 'bg-[#090d16] border-slate-700 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        B3 (du/252)
                      </button>
                      <button
                        type="button"
                        onClick={() => onMarketParamsChange({ dayCountConvention: 'dc365' })}
                        className={`py-1.5 px-2 rounded-lg text-xs font-semibold border transition-colors ${
                          marketParams.dayCountConvention === 'dc365'
                            ? 'bg-sky-600/20 border-sky-500 text-sky-300'
                            : 'bg-[#090d16] border-slate-700 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Corridos (dc/365)
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Primary Operational Actions */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              id="btn-open-strategies"
              onClick={onOpenStrategyExplorer}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0f1623] hover:bg-slate-800 border border-slate-700/80 text-xs font-semibold text-slate-100 transition-colors"
            >
              <BookOpen size={14} className="text-sky-400" />
              <span className="max-w-[140px] truncate">{activeStrategyName}</span>
            </button>

            <button
              type="button"
              id="btn-open-portfolio"
              onClick={onOpenPortfolio}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0f1623] hover:bg-slate-800 border border-slate-700/80 text-xs font-semibold text-slate-200 transition-colors"
            >
              <Briefcase size={14} className="text-slate-300" />
              <span className="hidden sm:inline">Diário</span>
              {savedCount > 0 && (
                <span className="px-1.5 py-0.2 rounded bg-slate-800 text-sky-300 font-mono text-[11px]">
                  {savedCount}
                </span>
              )}
            </button>

            <button
              type="button"
              id="btn-open-order-ticket"
              onClick={onOpenOrderTicket}
              disabled={activeLegsCount === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ClipboardList size={14} />
              <span>Boleta B3</span>
            </button>
          </div>
        </div>

        {/* Quick Tickers Bar */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 terminal-scroll">
          <span className="text-[11px] font-medium text-slate-400 mr-1 shrink-0">Ativos líquidos:</span>
          {POPULAR_B3_TICKERS.map((sym) => {
            const active = sym === ticker.toUpperCase();
            return (
              <button
                key={sym}
                type="button"
                onClick={() => {
                  onTickerChange(sym);
                  onSyncMarket(sym, false);
                }}
                className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold transition-colors shrink-0 ${
                  active
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                    : 'bg-slate-900 text-slate-300 border border-slate-800 hover:border-slate-600 hover:text-white'
                }`}
              >
                {sym}
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
};
