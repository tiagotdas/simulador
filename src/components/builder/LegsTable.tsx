import React from 'react';
import {
  Copy,
  Layers,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { ActionType, Leg, MarketParams, OptionType } from '../../types/options';
import { bsmGreeks } from '../../engine/blackScholes';
import { getTimeToMaturityYears } from '../../engine/calendar';
import { formatBRL } from '../../utils/format';

interface LegsTableProps {
  legs: Leg[];
  ticker: string;
  marketParams: MarketParams;
  onAddManualLeg: (type: OptionType) => void;
  onUpdateLeg: (id: string, patch: Partial<Leg>) => void;
  onDuplicateLeg: (id: string) => void;
  onRemoveLeg: (id: string) => void;
  onClearLegs: () => void;
  canUndo: boolean;
  onUndo: () => void;
}

export const LegsTable: React.FC<LegsTableProps> = ({
  legs,
  ticker,
  marketParams,
  onAddManualLeg,
  onUpdateLeg,
  onDuplicateLeg,
  onRemoveLeg,
  onClearLegs,
  canUndo,
  onUndo,
}) => {
  const computeUnitDelta = (leg: Leg): number => {
    if (leg.type === 'Stock') return 1;
    const T = getTimeToMaturityYears(leg.daysToMaturity, marketParams.dayCountConvention);
    const g = bsmGreeks(
      {
        S: marketParams.spotPrice,
        K: leg.strike,
        T,
        r: marketParams.riskFreeRate,
        q: marketParams.dividendYield,
        sigma: leg.impliedVolatility > 0 ? leg.impliedVolatility : 0.35,
        type: leg.type,
      },
      marketParams.dayCountConvention
    );
    return g.delta;
  };

  return (
    <section className="bg-[#0f1623] border border-slate-800 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-5 py-3.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Layers size={16} className="text-sky-400" />
          <h2 className="text-sm font-bold text-slate-100">
            Estrutura da Operação ({legs.filter((l) => l.enabled).length}/{legs.length} pernas)
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            id="btn-add-call"
            onClick={() => onAddManualLeg('Call')}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-semibold transition-colors"
          >
            <Plus size={13} />
            <span>Call</span>
          </button>
          <button
            type="button"
            id="btn-add-put"
            onClick={() => onAddManualLeg('Put')}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-semibold transition-colors"
          >
            <Plus size={13} />
            <span>Put</span>
          </button>
          <button
            type="button"
            id="btn-add-stock"
            onClick={() => onAddManualLeg('Stock')}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-300 text-xs font-semibold transition-colors"
          >
            <Plus size={13} />
            <span>Ação ({ticker})</span>
          </button>

          {canUndo && (
            <button
              type="button"
              onClick={onUndo}
              title="Desfazer última alteração"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors ml-1"
            >
              <RotateCcw size={13} />
              <span className="hidden sm:inline">Desfazer</span>
            </button>
          )}

          {legs.length > 0 && (
            <button
              type="button"
              onClick={onClearLegs}
              title="Limpar todas as pernas"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-rose-950/60 border border-slate-700 hover:border-rose-500/40 text-slate-300 hover:text-rose-300 text-xs font-semibold transition-colors"
            >
              <Trash2 size={13} />
              <span className="hidden sm:inline">Limpar</span>
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto terminal-scroll">
        {legs.length === 0 ? (
          <div className="py-12 px-6 text-center space-y-2">
            <p className="text-sm font-semibold text-slate-300">
              Nenhuma perna ativa na montagem atual
            </p>
            <p className="text-xs text-slate-400">
              Use os botões <strong className="text-slate-200">+ Call / + Put / + Ação</strong> acima, clique em Bid/Ask na{' '}
              <strong className="text-slate-200">Option Chain</strong> ou escolha um dos 45 modelos de estratégia.
            </p>
          </div>
        ) : (
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-[#0b101b] border-b border-slate-800 text-slate-400 font-semibold">
                <th className="py-2.5 pl-4 pr-2 w-8 text-center" title="Ativar/desativar perna">
                  On
                </th>
                <th className="py-2.5 px-2">Lado</th>
                <th className="py-2.5 px-2">Tipo</th>
                <th className="py-2.5 px-2">Código B3</th>
                <th className="py-2.5 px-2 text-right">Strike</th>
                <th className="py-2.5 px-2 text-center">DTE (d)</th>
                <th className="py-2.5 px-2 text-center">Qtd. (Lotes)</th>
                <th className="py-2.5 px-2 text-right">Prêmio (R$)</th>
                <th className="py-2.5 px-2 text-center">IV %</th>
                <th className="py-2.5 px-2 text-right">Δ Unit.</th>
                <th className="py-2.5 px-2 text-right">Financ.</th>
                <th className="py-2.5 pl-2 pr-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {legs.map((leg) => {
                const unitDelta = computeUnitDelta(leg);
                const legCashflow = (leg.action === 'Buy' ? -1 : 1) * leg.quantity * leg.price;
                const midPrice =
                  leg.bid && leg.ask && leg.bid > 0 && leg.ask > 0
                    ? Number(((leg.bid + leg.ask) / 2).toFixed(2))
                    : null;

                return (
                  <tr
                    key={leg.id}
                    className={`transition-colors ${
                      leg.enabled
                        ? 'hover:bg-slate-800/35'
                        : 'opacity-45 bg-slate-950/40'
                    }`}
                  >
                    {/* Enable Checkbox */}
                    <td className="py-2.5 pl-4 pr-2 text-center">
                      <input
                        type="checkbox"
                        checked={leg.enabled}
                        onChange={(e) => onUpdateLeg(leg.id, { enabled: e.target.checked })}
                        aria-label={`Ativar perna ${leg.ticker || leg.type}`}
                        className="accent-sky-400 rounded cursor-pointer"
                      />
                    </td>

                    {/* Buy/Sell Toggle */}
                    <td className="py-2.5 px-2">
                      <button
                        type="button"
                        onClick={() => {
                          const nextAction: ActionType = leg.action === 'Buy' ? 'Sell' : 'Buy';
                          const nextPrice =
                            nextAction === 'Buy' && leg.ask && leg.ask > 0
                              ? leg.ask
                              : nextAction === 'Sell' && leg.bid && leg.bid > 0
                              ? leg.bid
                              : leg.price;
                          onUpdateLeg(leg.id, { action: nextAction, price: nextPrice });
                        }}
                        className={`px-2.5 py-1 rounded-md font-bold text-[11px] w-[72px] text-center transition-colors border ${
                          leg.action === 'Buy'
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35 hover:bg-emerald-500/25'
                            : 'bg-rose-500/15 text-rose-300 border-rose-500/35 hover:bg-rose-500/25'
                        }`}
                      >
                        {leg.action === 'Buy' ? 'COMPRA' : 'VENDA'}
                      </button>
                    </td>

                    {/* Type Selector */}
                    <td className="py-2.5 px-2">
                      <select
                        value={leg.type}
                        aria-label="Tipo do instrumento"
                        onChange={(e) => {
                          const newType = e.target.value as OptionType;
                          onUpdateLeg(leg.id, {
                            type: newType,
                            ...(newType === 'Stock'
                              ? {
                                  ticker: ticker.toUpperCase(),
                                  strike: marketParams.spotPrice,
                                  price: marketParams.spotPrice,
                                  impliedVolatility: 0,
                                }
                              : {}),
                          });
                        }}
                        className="bg-[#090d16] border border-slate-700 rounded-md px-2 py-1 text-xs font-semibold text-slate-100 outline-none"
                      >
                        <option value="Call">Call</option>
                        <option value="Put">Put</option>
                        <option value="Stock">Ação</option>
                      </select>
                    </td>

                    {/* Ticker */}
                    <td className="py-2.5 px-2">
                      <input
                        type="text"
                        value={leg.ticker || ''}
                        aria-label="Código B3"
                        onChange={(e) =>
                          onUpdateLeg(leg.id, { ticker: e.target.value.toUpperCase() })
                        }
                        placeholder="PETRK380"
                        className="bg-[#090d16] border border-slate-700/80 rounded-md px-2 py-1 font-mono font-semibold text-slate-200 w-24 uppercase outline-none focus:border-sky-500"
                      />
                    </td>

                    {/* Strike */}
                    <td className="py-2.5 px-2 text-right">
                      {leg.type === 'Stock' ? (
                        <span className="font-mono text-slate-500 px-2">À vista</span>
                      ) : (
                        <input
                          type="number"
                          step="0.25"
                          min="0.01"
                          value={leg.strike}
                          aria-label="Strike"
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v) && v > 0) onUpdateLeg(leg.id, { strike: v });
                          }}
                          className="bg-[#090d16] border border-slate-700/80 rounded-md px-2 py-1 font-mono font-bold text-sky-300 w-20 text-right tabular-nums no-spinner outline-none focus:border-sky-500"
                        />
                      )}
                    </td>

                    {/* DTE */}
                    <td className="py-2.5 px-2 text-center">
                      {leg.type === 'Stock' ? (
                        <span className="font-mono text-slate-500">—</span>
                      ) : (
                        <input
                          type="number"
                          min="1"
                          max="730"
                          value={leg.daysToMaturity}
                          aria-label="Dias até o vencimento"
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            if (!isNaN(v) && v >= 1) onUpdateLeg(leg.id, { daysToMaturity: v });
                          }}
                          className="bg-[#090d16] border border-slate-700/80 rounded-md px-1.5 py-1 font-mono text-slate-200 w-14 text-center tabular-nums no-spinner outline-none focus:border-sky-500"
                        />
                      )}
                    </td>

                    {/* Quantity with B3 100-lot quick steppers */}
                    <td className="py-2.5 px-2">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateLeg(leg.id, { quantity: Math.max(100, leg.quantity - 100) })
                          }
                          aria-label="Diminuir 100 lotes"
                          className="h-6 w-6 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs flex items-center justify-center"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min="1"
                          step="100"
                          value={leg.quantity}
                          aria-label="Quantidade"
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            onUpdateLeg(leg.id, { quantity: isNaN(v) ? 0 : Math.max(0, v) });
                          }}
                          className="bg-[#090d16] border border-slate-700/80 rounded-md px-1.5 py-1 font-mono font-bold text-slate-100 w-16 text-center tabular-nums no-spinner outline-none focus:border-sky-500"
                        />
                        <button
                          type="button"
                          onClick={() => onUpdateLeg(leg.id, { quantity: leg.quantity + 100 })}
                          aria-label="Aumentar 100 lotes"
                          className="h-6 w-6 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs flex items-center justify-center"
                        >
                          +
                        </button>
                      </div>
                    </td>

                    {/* Price + Bid/Mid/Ask shortcuts */}
                    <td className="py-2.5 px-2 text-right">
                      <div className="flex flex-col items-end gap-1">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={leg.price}
                          aria-label="Prêmio em reais"
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            onUpdateLeg(leg.id, { price: isNaN(v) ? 0 : Math.max(0, v) });
                          }}
                          className="bg-[#090d16] border border-slate-700/80 rounded-md px-2 py-1 font-mono font-bold text-slate-100 w-20 text-right tabular-nums no-spinner outline-none focus:border-sky-500"
                        />
                        {leg.bid !== undefined && leg.ask !== undefined && leg.bid > 0 && leg.ask > 0 && (
                          <div className="flex items-center gap-1 text-[10px] font-mono">
                            <button
                              type="button"
                              onClick={() => onUpdateLeg(leg.id, { price: leg.bid! })}
                              className="text-slate-400 hover:text-emerald-300"
                              title={`Usar Bid (${leg.bid.toFixed(2)})`}
                            >
                              B:{leg.bid.toFixed(2)}
                            </button>
                            {midPrice && (
                              <button
                                type="button"
                                onClick={() => onUpdateLeg(leg.id, { price: midPrice })}
                                className="text-sky-400 hover:text-sky-300"
                                title={`Usar Mid (${midPrice.toFixed(2)})`}
                              >
                                M:{midPrice.toFixed(2)}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onUpdateLeg(leg.id, { price: leg.ask! })}
                              className="text-slate-400 hover:text-rose-300"
                              title={`Usar Ask (${leg.ask.toFixed(2)})`}
                            >
                              A:{leg.ask.toFixed(2)}
                            </button>
                          </div>
                        )}
                      </div>
                    </td>

                    {/* IV% */}
                    <td className="py-2.5 px-2 text-center">
                      {leg.type === 'Stock' ? (
                        <span className="font-mono text-slate-500">—</span>
                      ) : (
                        <input
                          type="number"
                          step="1"
                          min="1"
                          max="300"
                          value={Number((leg.impliedVolatility * 100).toFixed(1))}
                          aria-label="Volatilidade Implícita em %"
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v) && v > 0) {
                              onUpdateLeg(leg.id, { impliedVolatility: v / 100 });
                            }
                          }}
                          className="bg-[#090d16] border border-slate-700/80 rounded-md px-1.5 py-1 font-mono text-slate-200 w-16 text-center tabular-nums no-spinner outline-none focus:border-sky-500"
                        />
                      )}
                    </td>

                    {/* Unit Delta */}
                    <td className="py-2.5 px-2 text-right font-mono text-slate-300 tabular-nums">
                      {unitDelta.toFixed(2)}
                    </td>

                    {/* Leg Cashflow */}
                    <td
                      className={`py-2.5 px-2 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                        legCashflow >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {formatBRL(legCashflow, true)}
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 pl-2 pr-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onDuplicateLeg(leg.id)}
                          title="Duplicar perna"
                          aria-label="Duplicar perna"
                          className="p-1.5 rounded-md text-slate-400 hover:text-sky-300 hover:bg-slate-800 transition-colors"
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveLeg(leg.id)}
                          title="Remover perna"
                          aria-label="Remover perna"
                          className="p-1.5 rounded-md text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
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
