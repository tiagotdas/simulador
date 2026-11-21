export function formatBRL(value: number, showSign = false): string {
  const safe = Number.isFinite(value) ? value : 0;
  const formatted = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(safe));

  if (safe < -0.005) return `-${formatted}`;
  if (showSign && safe > 0.005) return `+${formatted}`;
  return formatted;
}

export function formatBRLCompact(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const abs = Math.abs(safe);
  const sign = safe < -0.005 ? '-' : safe > 0.005 ? '+' : '';
  if (abs >= 1_000_000) return `${sign}R$ ${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${sign}R$ ${(abs / 1_000).toFixed(1)}k`;
  return `${sign}R$ ${abs.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function formatNumberBR(value: number, decimals = 2): string {
  const safe = Number.isFinite(value) ? value : 0;
  return safe.toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatPct(value: number, decimals = 1, showSign = false): string {
  const safe = Number.isFinite(value) ? value : 0;
  const sign = showSign && safe > 0 ? '+' : '';
  return `${sign}${safe.toFixed(decimals)}%`;
}
