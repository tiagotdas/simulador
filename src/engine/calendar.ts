import { DayCountConvention } from '../types/options';

/**
 * Fixed Brazilian national holidays (month 1-12, day 1-31) for B3 business-day approximation.
 */
const FIXED_BR_HOLIDAYS = new Set([
  '01-01', // Confraternização Universal
  '04-21', // Tiradentes
  '05-01', // Dia do Trabalho
  '09-07', // Independência
  '10-12', // Nossa Sra. Aparecida
  '11-02', // Finados
  '11-15', // Proclamação da República
  '11-20', // Consciência Negra
  '12-25', // Natal
]);

const CALL_SERIES_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
const PUT_SERIES_LETTERS = ['M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X'];

/**
 * Safely parses an ISO date string ("YYYY-MM-DD" or full ISO) in local timezone,
 * preventing the UTC-3 off-by-one bug in Brazil.
 */
export function parseIsoDateLocal(dateStr: string): Date {
  if (!dateStr) return new Date();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr.trim());
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    return new Date(year, month, day, 12, 0, 0);
  }
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function toIsoDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDateBR(dateStr: string): string {
  const d = parseIsoDateLocal(dateStr);
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatShortDateBR(dateStr: string): string {
  const d = parseIsoDateLocal(dateStr);
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
  });
}

/**
 * Returns the 3rd Friday of a given month/year (standard B3 monthly options expiry).
 */
export function getThirdFriday(year: number, monthIndex0: number): Date {
  const firstDay = new Date(year, monthIndex0, 1, 12, 0, 0);
  const firstWeekday = firstDay.getDay(); // 0=Sun..5=Fri
  const daysToFirstFriday = (5 - firstWeekday + 7) % 7;
  const thirdFridayDay = 1 + daysToFirstFriday + 14;
  return new Date(year, monthIndex0, thirdFridayDay, 12, 0, 0);
}

/**
 * Returns upcoming B3 monthly expiration ISO dates starting from `fromDate`.
 */
export function getUpcomingB3Expiries(count = 4, fromDate = new Date()): { date: string; calendarDays: number; businessDays: number }[] {
  const today = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate(), 12, 0, 0);
  const results: { date: string; calendarDays: number; businessDays: number }[] = [];
  let year = today.getFullYear();
  let month = today.getMonth();

  while (results.length < count) {
    const expiry = getThirdFriday(year, month);
    const diffCal = Math.round((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffCal >= 3) {
      results.push({
        date: toIsoDateString(expiry),
        calendarDays: diffCal,
        businessDays: Math.max(1, countBusinessDays(today, expiry)),
      });
    }
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return results;
}

export function countBusinessDays(start: Date, end: Date): number {
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12, 0, 0);
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 12, 0, 0);
  if (e <= s) return 0;

  let count = 0;
  const cursor = new Date(s);
  cursor.setDate(cursor.getDate() + 1);
  while (cursor <= e) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) {
      const key = `${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
      if (!FIXED_BR_HOLIDAYS.has(key)) {
        count += 1;
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

export function calendarToBusinessDays(calendarDays: number): number {
  if (calendarDays <= 0) return 0;
  return Math.max(1, Math.round(calendarDays * (252 / 365)));
}

export function getTimeToMaturityYears(calendarDays: number, convention: DayCountConvention): number {
  if (calendarDays <= 0) return 0;
  if (convention === 'du252') {
    const du = calendarToBusinessDays(calendarDays);
    return du / 252;
  }
  return calendarDays / 365;
}

export function addDaysToDate(baseDate: Date, days: number): Date {
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 12, 0, 0);
  d.setDate(d.getDate() + Math.round(days));
  return d;
}

/**
 * Generates a standard B3 option ticker code (e.g., PETRK380 for PETR4 Nov Call 38.00).
 */
export function generateB3OptionTicker(
  underlying: string,
  type: 'Call' | 'Put',
  expirationDate: string,
  strike: number
): string {
  const root = underlying.replace(/[0-9]+$/, '').toUpperCase().slice(0, 4) || 'ATIV';
  const date = parseIsoDateLocal(expirationDate);
  const monthIdx = date.getMonth();
  const seriesLetter = type === 'Call' ? CALL_SERIES_LETTERS[monthIdx] : PUT_SERIES_LETTERS[monthIdx];
  const strikeCode = Math.round(strike * 10);
  return `${root}${seriesLetter}${strikeCode}`;
}
