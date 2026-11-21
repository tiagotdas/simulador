import React, { useState } from 'react';
import { Briefcase, FolderOpen, Plus, Trash2, X } from 'lucide-react';
import { SavedStrategy, TradeStatus } from '../../types/options';
import { formatBRL } from '../../utils/format';

interface PortfolioDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  strategies: SavedStrategy[];
  currentTicker: string;
  currentStrategyName: string;
  hasActiveLegs: boolean;
  onSaveCurrent: (name: string, status: TradeStatus, notes: string) => void;
  onLoadStrategy: (item: SavedStrategy) => void;
  onUpdateStatus: (id: string, status: TradeStatus) => void;
  onDeleteStrategy: (id: string) => void;
}

const STATUS_BADGE: Record<TradeStatus, string> = {
  Estudo: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  'Em Aberto': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  Encerrada: 'bg-slate-700/60 text-slate-300 border-slate-600',
};

export const PortfolioDrawer: React.FC<PortfolioDrawerProps> = ({
  isOpen,
  onClose,
  strategies,
  currentTicker,
  currentStrategyName,
  hasActiveLegs,
  onSaveCurrent,
  onLoadStrategy,
  onUpdateStatus,
  onDeleteStrategy,
}) => {
  const [name, setName] = useState('');
  const [status, setStatus] = useState<TradeStatus>('Estudo');
  const [notes, setNotes] = useState('');

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const finalName = name.trim() || `${currentTicker} • ${currentStrategyName}`;
    onSaveCurrent(finalName, status, notes.trim());
    setName('');
    setNotes('');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="portfolio-drawer-title"
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex justify-end"
    >
      <div className="bg-[#0f1623] border-l border-slate-700 w-full max-w-md h-full flex flex-col shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Briefcase size={17} className="text-sky-400" />
            <h2 id="portfolio-drawer-title" className="text-sm font-bold text-slate-100">
              Diário & Portfólio de Operações
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar diário"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X size={18} />
          </button>
        </div>

        {/* Save Current Form */}
        <form onSubmit={handleSave} className="p-4 bg-[#0b101b] border-b border-slate-800 space-y-3">
          <div className="text-xs font-bold text-slate-200">Salvar Montagem Atual</div>
          <div className="flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`${currentTicker} • ${currentStrategyName}`}
              className="flex-1 bg-[#090d16] border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:border-sky-500"
            />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as TradeStatus)}
              aria-label="Status da operação"
              className="bg-[#090d16] border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 outline-none"
            >
              <option value="Estudo">Estudo</option>
              <option value="Em Aberto">Em Aberto</option>
              <option value="Encerrada">Encerrada</option>
            </select>
          </div>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notas de gestão (ex.: Stop no rompimento de R$ 40, encerrar com 50% do lucro)..."
            className="w-full bg-[#090d16] border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:border-sky-500 resize-none"
          />
          <button
            type="submit"
            disabled={!hasActiveLegs}
            className="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold transition-colors disabled:opacity-40"
          >
            <Plus size={14} />
            <span>Salvar no Navegador</span>
          </button>
        </form>

        {/* Saved List */}
        <div className="flex-1 overflow-y-auto terminal-scroll p-4 space-y-3">
          {strategies.length === 0 ? (
            <div className="py-12 text-center space-y-1.5">
              <p className="text-sm font-semibold text-slate-300">Nenhuma operação salva ainda</p>
              <p className="text-xs text-slate-400">
                Salve seus estudos e operações abertas para acompanhar e recarregar rapidamente.
              </p>
            </div>
          ) : (
            strategies.map((item) => {
              const netFlow = item.legs
                .filter((l) => l.enabled)
                .reduce((acc, l) => acc + (l.action === 'Buy' ? -1 : 1) * l.quantity * l.price, 0);

              return (
                <div
                  key={item.id}
                  className="bg-[#0b101b] border border-slate-800 rounded-xl p-3.5 space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-100 truncate">{item.name}</div>
                      <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                        {item.ticker} @ {formatBRL(item.spotAtSave)} • {item.legs.length} pernas •{' '}
                        {new Date(item.updatedAt).toLocaleDateString('pt-BR')}
                      </div>
                    </div>
                    <select
                      value={item.status}
                      aria-label="Alterar status"
                      onChange={(e) => onUpdateStatus(item.id, e.target.value as TradeStatus)}
                      className={`px-2 py-0.5 rounded border text-[11px] font-semibold outline-none cursor-pointer ${STATUS_BADGE[item.status]}`}
                    >
                      <option value="Estudo" className="bg-slate-900 text-slate-100">
                        Estudo
                      </option>
                      <option value="Em Aberto" className="bg-slate-900 text-slate-100">
                        Em Aberto
                      </option>
                      <option value="Encerrada" className="bg-slate-900 text-slate-100">
                        Encerrada
                      </option>
                    </select>
                  </div>

                  {item.notes && (
                    <p className="text-xs text-slate-300 bg-[#090d16] rounded-lg px-2.5 py-2 border border-slate-800/80">
                      {item.notes}
                    </p>
                  )}

                  <div className="flex items-center justify-between pt-1">
                    <span
                      className={`text-xs font-mono font-semibold ${
                        netFlow >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {netFlow >= 0 ? 'Crédito' : 'Débito'}: {formatBRL(Math.abs(netFlow))}
                    </span>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          onLoadStrategy(item);
                          onClose();
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-sky-300 transition-colors"
                      >
                        <FolderOpen size={12} />
                        <span>Abrir</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteStrategy(item.id)}
                        aria-label="Excluir operação salva"
                        className="p-1.5 rounded-md text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
