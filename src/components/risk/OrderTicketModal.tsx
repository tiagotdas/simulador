import React, { useState } from 'react';
import {
  Check,
  ClipboardList,
  Copy,
  Download,
  Share2,
  X,
} from 'lucide-react';
import { Leg, MarketParams, StrategyMetrics } from '../../types/options';
import { formatDateBR } from '../../engine/calendar';
import { getActiveLegs } from '../../engine/payoff';
import { formatBRL } from '../../utils/format';
import { exportLegsToCsv } from '../../services/storage';

interface OrderTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  ticker: string;
  strategyName: string;
  legs: Leg[];
  marketParams: MarketParams;
  metrics: StrategyMetrics;
  onCopyShareLink: () => void;
  onSaveToJournal: () => void;
}

export const OrderTicketModal: React.FC<OrderTicketModalProps> = ({
  isOpen,
  onClose,
  ticker,
  strategyName,
  legs,
  marketParams,
  metrics,
  onCopyShareLink,
  onSaveToJournal,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const activeLegs = getActiveLegs(legs);

  // Estimate spread slippage cost if bid/ask exist
  const estimatedSpreadCost = activeLegs.reduce((sum, l) => {
    if (l.type !== 'Stock' && l.bid && l.ask && l.bid > 0 && l.ask > 0) {
      return sum + ((l.ask - l.bid) / 2) * l.quantity;
    }
    return sum;
  }, 0);

  const mb = metrics.marginBreakdown;
  const cb = metrics.costBreakdown;

  const buildOrderText = () => {
    const lines = [
      `BOLETA DE EXECUÇÃO B3 — ${ticker.toUpperCase()} (${strategyName})`,
      `Spot Ref.: ${formatBRL(marketParams.spotPrice)} | Selic: ${(marketParams.riskFreeRate * 100).toFixed(2)}% | BTC: ${((marketParams.borrowRate ?? 0) * 100).toFixed(2)}%`,
      `--------------------------------------------------`,
      ...activeLegs.map((l) => {
        const side = l.action === 'Buy' ? 'COMPRA' : 'VENDA ';
        const code = l.ticker || `${ticker}${l.type[0]}${Math.round(l.strike * 10)}`;
        const styleTag = l.type === 'Stock' ? '' : l.exerciseStyle === 'American' ? ' [AM]' : ' [EU]';
        const exp = l.type === 'Stock' ? 'À VISTA' : `Venc. ${formatDateBR(l.expirationDate)}`;
        const strikeTxt = l.type === 'Stock' ? '' : ` | Strike R$ ${l.strike.toFixed(2)}`;
        return `${side} ${String(l.quantity).padStart(4, ' ')} ${code.padEnd(10, ' ')}${styleTag} @ R$ ${l.price.toFixed(2)}${strikeTxt} (${exp})`;
      }),
      `--------------------------------------------------`,
      `Fluxo Líquido: ${metrics.netCost >= 0 ? 'DÉBITO' : 'CRÉDITO'} ${formatBRL(Math.abs(metrics.netCost))}`,
      `Capital/Margem CORE Est.: ${formatBRL(metrics.estimatedMargin)}${
        mb?.bindingScenario && mb.coreMarginRequired > 0
          ? ` (Cenário: Spot ${mb.bindingScenario.spotShockPct > 0 ? '+' : ''}${mb.bindingScenario.spotShockPct}%, IV ${mb.bindingScenario.volShockRelPct > 0 ? '+' : ''}${mb.bindingScenario.volShockRelPct}%)`
          : ''
      }`,
      `Lucro Máx: ${
        typeof metrics.maxProfit === 'number' ? formatBRL(metrics.maxProfit) : 'Ilimitado'
      } | Risco Máx: ${
        typeof metrics.maxLoss === 'number' ? formatBRL(metrics.maxLoss) : 'Ilimitado'
      }`,
      cb && (cb.entryCosts > 0 || cb.estimatedExitOrExerciseCosts > 0)
        ? `Taxas Est.: Entrada ${formatBRL(cb.entryCosts)} | Saída/Exerc. ${formatBRL(cb.estimatedExitOrExerciseCosts)}`
        : '',
      metrics.breakevens.length > 0
        ? `Breakevens: ${metrics.breakevens.map((b) => formatBRL(b)).join(' / ')}`
        : '',
    ].filter(Boolean);

    return lines.join('\n');
  };

  const handleCopyTicket = async () => {
    try {
      await navigator.clipboard.writeText(buildOrderText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard fallback ignored
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-ticket-title"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="bg-[#0f1623] border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ClipboardList size={18} className="text-emerald-400" />
            <div>
              <h2 id="order-ticket-title" className="text-base font-bold text-slate-100">
                Boleta Operacional B3 — {ticker.toUpperCase()}
              </h2>
              <p className="text-xs text-slate-400">
                Confira códigos de série, estilo (AM/EU), lotes e preços limite antes de enviar no Home Broker / Profit
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar boleta"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto terminal-scroll space-y-4">
          {/* Legs Summary Table */}
          <div className="border border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-xs font-mono tabular-nums">
              <thead className="bg-[#0b101b] text-slate-400 font-sans border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3 text-left">Lado</th>
                  <th className="py-2.5 px-3 text-left">Código B3</th>
                  <th className="py-2.5 px-3 text-right">Strike</th>
                  <th className="py-2.5 px-3 text-right">Qtd.</th>
                  <th className="py-2.5 px-3 text-right">Preço Limite</th>
                  <th className="py-2.5 px-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {activeLegs.map((l) => {
                  const total = (l.action === 'Buy' ? -1 : 1) * l.quantity * l.price;
                  return (
                    <tr key={l.id} className="bg-[#0f1623]">
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded font-sans font-bold text-[11px] ${
                            l.action === 'Buy'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : 'bg-rose-500/15 text-rose-300'
                          }`}
                        >
                          {l.action === 'Buy' ? 'COMPRA' : 'VENDA'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-bold text-slate-100">
                        <span>{l.ticker || `${ticker} ${l.type}`}</span>
                        {l.type !== 'Stock' && (
                          <span className="ml-1.5 px-1 py-0.2 rounded bg-slate-800 text-slate-300 text-[10px]">
                            {l.exerciseStyle === 'American' ? 'AM' : 'EU'}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-300">
                        {l.type === 'Stock' ? 'À vista' : formatBRL(l.strike)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-100">{l.quantity}</td>
                      <td className="py-2.5 px-3 text-right text-sky-300 font-bold">
                        {formatBRL(l.price)}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-bold ${
                          total >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {formatBRL(total, true)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Financial Execution Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="bg-[#0b101b] border border-slate-800 rounded-lg p-3">
              <div className="text-slate-400 text-[11px]">
                {metrics.netCost >= 0 ? 'Débito Líquido' : 'Crédito Líquido'}
              </div>
              <div
                className={`mt-1 font-mono font-bold text-sm ${
                  metrics.netCost >= 0 ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                {formatBRL(Math.abs(metrics.netCost))}
              </div>
            </div>
            <div className="bg-[#0b101b] border border-slate-800 rounded-lg p-3">
              <div className="text-slate-400 text-[11px]">Margem CORE Est.</div>
              <div className="mt-1 font-mono font-bold text-sm text-amber-300">
                {formatBRL(metrics.estimatedMargin)}
              </div>
            </div>
            <div className="bg-[#0b101b] border border-slate-800 rounded-lg p-3">
              <div className="text-slate-400 text-[11px]">Slippage Est. (Mid)</div>
              <div className="mt-1 font-mono font-bold text-sm text-slate-200">
                {formatBRL(estimatedSpreadCost)}
              </div>
            </div>
            <div className="bg-[#0b101b] border border-slate-800 rounded-lg p-3">
              <div className="text-slate-400 text-[11px]">Taxas Ent. + Saída/Ex.</div>
              <div className="mt-1 font-mono font-bold text-sm text-slate-200">
                {formatBRL(
                  (cb?.entryCosts ?? metrics.operationalCosts) +
                    (cb?.estimatedExitOrExerciseCosts ?? 0)
                )}
              </div>
            </div>
          </div>

          {/* Raw Text Preview */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-semibold text-slate-400 uppercase">
              Resumo pronto para copiar
            </span>
            <pre className="bg-[#090d16] border border-slate-800 rounded-xl p-3.5 text-[11px] font-mono text-slate-200 overflow-x-auto leading-relaxed">
              {buildOrderText()}
            </pre>
          </div>

          <p className="text-[11px] text-slate-400 leading-relaxed">
            Aviso: ferramenta de análise quantitativa. Verifique liquidez real no livro de ofertas, margem oficial no sistema CORE da B3 e custos da sua corretora antes de operar.
          </p>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 bg-[#0b101b] border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onCopyShareLink}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition-colors"
            >
              <Share2 size={13} />
              <span>Link</span>
            </button>
            <button
              type="button"
              onClick={() => exportLegsToCsv(ticker, activeLegs)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition-colors"
            >
              <Download size={13} />
              <span>CSV</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onSaveToJournal();
                onClose();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/40 text-xs font-semibold text-sky-200 transition-colors"
            >
              <span>Salvar no Diário</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleCopyTicket}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? 'Boleta Copiada!' : 'Copiar Boleta'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
