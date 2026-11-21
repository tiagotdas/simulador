import React, { useMemo, useRef, useState } from 'react';
import { Crosshair, Filter, Target } from 'lucide-react';
import { ActionType, MarketDataResponse, MarketOption } from '../../types/options';
import { calendarToBusinessDays, formatDateBR } from '../../engine/calendar';
import { formatPct } from '../../utils/format';

interface OptionChainTableProps {
  marketData: MarketDataResponse | null;
  spotPrice: number;
  selectedExpiry: string;
  onSelectExpiry: (expiry: string) => void;
  onAddOptionLeg: (option: MarketOption, action: ActionType) => void;
  isFetching: boolean;
}

export const OptionChainTable: React.FC<OptionChainTableProps> = ({
  marketData,
  spotPrice,
  selectedExpiry,
  onSelectExpiry,
  onAddOptionLeg,
  isFetching,
}) => {
  const [strikeWindowPct, setStrikeWindowPct] = useState<number>(0.2); // 0 = all
  const [onlyLiquid, setOnlyLiquid] = useState<boolean>(false);
  const atmRowRef = useRef<HTMLTableRowElement | null>(null);

  const expirations = useMemo(() => {
    if (!marketData) return [];
    const map = new Map<string, number>();
    for (const opt of marketData.chain) {
      if (!map.has(opt.expirationDate)) {
        map.set(opt.expirationDate, opt.daysToMaturity);
      }
    }
    return Array.from(map.entries())
      .map(([date, days]) => ({ date, days }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [marketData]);

  const rows = useMemo(() => {
    if (!marketData || !selectedExpiry) return [];
    const filtered = marketData.chain.filter((o) => o.expirationDate === selectedExpiry);
    const strikes = Array.from(new Set(filtered.map((o) => o.strike))).sort((a, b) => a - b);

    return strikes
      .map((strike) => {
        const call = filtered.find((o) => o.strike === strike && o.type === 'Call');
        const put = filtered.find((o) => o.strike === strike && o.type === 'Put');
        const distPct = spotPrice > 0 ? ((strike - spotPrice) / spotPrice) * 100 : 0;
        return { strike, distPct, call, put };
      })
      .filter((row) => {
        if (strikeWindowPct > 0 && Math.abs(row.distPct) > strikeWindowPct * 100) return false;
        if (onlyLiquid) {
          const callLiquid = row.call && (row.call.bid > 0 || row.call.ask > 0);
          const putLiquid = row.put && (row.put.bid > 0 || row.put.ask > 0);
          return Boolean(callLiquid || putLiquid);
        }
        return true;
      });
  }, [marketData, selectedExpiry, spotPrice, strikeWindowPct, onlyLiquid]);

  // Closest strike to spot is highlighted as ATM
  const atmStrike = useMemo(() => {
    if (rows.length === 0) return null;
    return rows.reduce((best, r) =>
      Math.abs(r.strike - spotPrice) < Math.abs(best.strike - spotPrice) ? r : best
    ).strike;
  }, [rows, spotPrice]);

  const scrollToAtm = () => {
    atmRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const hasWideSpread = (opt?: MarketOption) => {
    if (!opt || opt.bid <= 0 || opt.ask <= 0) return false;
    const mid = (opt.bid + opt.ask) / 2;
    return mid > 0 && (opt.ask - opt.bid) / mid > 0.12;
  };

  return (
    <section className="bg-[#0f1623] border border-slate-800 rounded-xl overflow-hidden flex flex-col">
      {/* Header & Controls */}
      <div className="px-4 sm:px-5 py-3.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Target size={16} className="text-sky-400" />
          <div>
            <h2 className="text-sm font-bold text-slate-100">
              Grade de Opções (Option Chain B3) — {marketData?.baseAsset || '---'}
            </h2>
            <p className="text-xs text-slate-400">
              Clique em <strong className="text-rose-300">Bid (V)</strong> para vender ou{' '}
              <strong className="text-emerald-300">Ask (C)</strong> para comprar em Calls ou Puts
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Expiry selector */}
          {expirations.length > 0 && (
            <select
              aria-label="Selecionar vencimento"
              value={selectedExpiry}
              onChange={(e) => onSelectExpiry(e.target.value)}
              className="bg-[#090d16] border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-100 outline-none focus:border-sky-500"
            >
              {expirations.map((exp) => (
                <option key={exp.date} value={exp.date}>
                  {formatDateBR(exp.date)} ({exp.days} dc / {calendarToBusinessDays(exp.days)} du)
                </option>
              ))}
            </select>
          )}

          {/* Strike Window Filter */}
          <div className="inline-flex items-center rounded-lg bg-[#090d16] border border-slate-800 p-0.5 text-xs">
            {[
              { label: '±10%', val: 0.1 },
              { label: '±20%', val: 0.2 },
              { label: 'Todos', val: 0 },
            ].map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => setStrikeWindowPct(opt.val)}
                className={`px-2 py-1 rounded-md font-medium transition-colors ${
                  strikeWindowPct === opt.val
                    ? 'bg-slate-800 text-sky-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <label className="inline-flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer px-2 py-1.5 rounded-lg bg-[#090d16] border border-slate-800">
            <Filter size={12} className="text-slate-400" />
            <input
              type="checkbox"
              checked={onlyLiquid}
              onChange={(e) => setOnlyLiquid(e.target.checked)}
              className="accent-sky-400 rounded"
            />
            <span>Líquidas</span>
          </label>

          <button
            type="button"
            onClick={scrollToAtm}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-amber-300 transition-colors"
          >
            <Crosshair size={13} />
            <span>ATM</span>
          </button>
        </div>
      </div>

      {/* T-Board Table */}
      <div className="overflow-x-auto max-h-[520px] terminal-scroll">
        {isFetching ? (
          <div className="p-8 space-y-2.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-9 bg-slate-800/60 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-400">
            Nenhuma opção disponível para os filtros atuais.
          </div>
        ) : (
          <table className="w-full text-xs font-mono tabular-nums border-collapse">
            <thead className="sticky top-0 z-20 bg-[#0b101b] border-b border-slate-700">
              <tr className="text-[11px] font-sans uppercase tracking-wider">
                <th colSpan={5} className="py-2 px-3 text-center text-emerald-300 bg-emerald-500/5 border-r border-slate-800">
                  CALLS (Opções de Compra)
                </th>
                <th className="py-2 px-3 text-center text-slate-200 bg-slate-900 border-r border-slate-800">
                  STRIKE
                </th>
                <th colSpan={5} className="py-2 px-3 text-center text-rose-300 bg-rose-500/5">
                  PUTS (Opções de Venda)
                </th>
              </tr>
              <tr className="text-[11px] text-slate-400 border-t border-slate-800/80">
                <th className="py-2 px-2 text-left hidden md:table-cell">Ticker</th>
                <th className="py-2 px-2 text-right hidden sm:table-cell">Delta</th>
                <th className="py-2 px-2 text-right hidden sm:table-cell">IV%</th>
                <th className="py-2 px-2 text-center text-rose-300">Bid (V)</th>
                <th className="py-2 px-2 text-center text-emerald-300 border-r border-slate-800">Ask (C)</th>

                <th className="py-2 px-3 text-center bg-slate-900/90 text-slate-200 border-r border-slate-800">
                  R$ / Dist.
                </th>

                <th className="py-2 px-2 text-center text-rose-300">Bid (V)</th>
                <th className="py-2 px-2 text-center text-emerald-300">Ask (C)</th>
                <th className="py-2 px-2 text-right hidden sm:table-cell">IV%</th>
                <th className="py-2 px-2 text-right hidden sm:table-cell">Delta</th>
                <th className="py-2 px-2 text-right hidden md:table-cell">Ticker</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {rows.map((row) => {
                const isAtm = row.strike === atmStrike;
                const isItmCall = row.strike < spotPrice;
                const isItmPut = row.strike > spotPrice;

                return (
                  <tr
                    key={row.strike}
                    ref={isAtm ? atmRowRef : undefined}
                    className={`transition-colors ${
                      isAtm ? 'bg-amber-500/10' : 'hover:bg-slate-800/40'
                    }`}
                  >
                    {/* CALL SIDE */}
                    <td className={`py-2 px-2 text-left text-slate-300 hidden md:table-cell ${isItmCall ? 'bg-emerald-500/[0.04]' : ''}`}>
                      <span className="inline-flex items-center gap-1">
                        {row.call?.ticker || '—'}
                        {hasWideSpread(row.call) && (
                          <span
                            title="Spread Bid-Ask largo (>12%)"
                            className="h-1.5 w-1.5 rounded-full bg-amber-400"
                          />
                        )}
                      </span>
                    </td>
                    <td className={`py-2 px-2 text-right text-slate-300 hidden sm:table-cell ${isItmCall ? 'bg-emerald-500/[0.04]' : ''}`}>
                      {row.call ? row.call.delta.toFixed(2) : '—'}
                    </td>
                    <td className={`py-2 px-2 text-right text-slate-400 hidden sm:table-cell ${isItmCall ? 'bg-emerald-500/[0.04]' : ''}`}>
                      {row.call ? `${(row.call.impliedVolatility * 100).toFixed(0)}%` : '—'}
                    </td>
                    <td className={`py-1.5 px-1.5 text-center ${isItmCall ? 'bg-emerald-500/[0.04]' : ''}`}>
                      {row.call ? (
                        <button
                          type="button"
                          onClick={() => onAddOptionLeg(row.call!, 'Sell')}
                          title={`Vender Call ${row.call.ticker} no Bid`}
                          className="w-full min-w-[54px] py-1 px-1.5 rounded bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/25 text-rose-200 font-semibold transition-colors"
                        >
                          {row.call.bid.toFixed(2)}
                        </button>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className={`py-1.5 px-1.5 text-center border-r border-slate-800 ${isItmCall ? 'bg-emerald-500/[0.04]' : ''}`}>
                      {row.call ? (
                        <button
                          type="button"
                          onClick={() => onAddOptionLeg(row.call!, 'Buy')}
                          title={`Comprar Call ${row.call.ticker} no Ask`}
                          className="w-full min-w-[54px] py-1 px-1.5 rounded bg-emerald-500/10 hover:bg-emerald-500/25 border border-emerald-500/25 text-emerald-200 font-semibold transition-colors"
                        >
                          {row.call.ask.toFixed(2)}
                        </button>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>

                    {/* STRIKE CENTER */}
                    <td
                      className={`py-1.5 px-3 text-center border-r border-slate-800 whitespace-nowrap ${
                        isAtm ? 'bg-amber-500/20 text-amber-200 font-bold' : 'bg-[#0b101b] text-slate-100 font-bold'
                      }`}
                    >
                      <div className="flex items-center justify-center gap-1.5">
                        <span>{row.strike.toFixed(2)}</span>
                        {isAtm && (
                          <span className="px-1 py-0.2 rounded bg-amber-400 text-slate-950 text-[9px] font-sans font-extrabold">
                            ATM
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] font-normal text-slate-400">
                        {formatPct(row.distPct, 1, true)}
                      </div>
                    </td>

                    {/* PUT SIDE */}
                    <td className={`py-1.5 px-1.5 text-center ${isItmPut ? 'bg-rose-500/[0.04]' : ''}`}>
                      {row.put ? (
                        <button
                          type="button"
                          onClick={() => onAddOptionLeg(row.put!, 'Sell')}
                          title={`Vender Put ${row.put.ticker} no Bid`}
                          className="w-full min-w-[54px] py-1 px-1.5 rounded bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/25 text-rose-200 font-semibold transition-colors"
                        >
                          {row.put.bid.toFixed(2)}
                        </button>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className={`py-1.5 px-1.5 text-center ${isItmPut ? 'bg-rose-500/[0.04]' : ''}`}>
                      {row.put ? (
                        <button
                          type="button"
                          onClick={() => onAddOptionLeg(row.put!, 'Buy')}
                          title={`Comprar Put ${row.put.ticker} no Ask`}
                          className="w-full min-w-[54px] py-1 px-1.5 rounded bg-emerald-500/10 hover:bg-emerald-500/25 border border-emerald-500/25 text-emerald-200 font-semibold transition-colors"
                        >
                          {row.put.ask.toFixed(2)}
                        </button>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className={`py-2 px-2 text-right text-slate-400 hidden sm:table-cell ${isItmPut ? 'bg-rose-500/[0.04]' : ''}`}>
                      {row.put ? `${(row.put.impliedVolatility * 100).toFixed(0)}%` : '—'}
                    </td>
                    <td className={`py-2 px-2 text-right text-slate-300 hidden sm:table-cell ${isItmPut ? 'bg-rose-500/[0.04]' : ''}`}>
                      {row.put ? row.put.delta.toFixed(2) : '—'}
                    </td>
                    <td className={`py-2 px-2 text-right text-slate-300 hidden md:table-cell ${isItmPut ? 'bg-rose-500/[0.04]' : ''}`}>
                      <span className="inline-flex items-center justify-end gap-1">
                        {hasWideSpread(row.put) && (
                          <span
                            title="Spread Bid-Ask largo (>12%)"
                            className="h-1.5 w-1.5 rounded-full bg-amber-400"
                          />
                        )}
                        {row.put?.ticker || '—'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
};
