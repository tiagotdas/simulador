import { DayCountConvention } from '../types/options';

/**
 * Fixed Brazilian national B3/ANBIMA holidays (MM-DD).
 * Note: Consciência Negra (11-20) became a national holiday in 2024.
 */
const FIXED_BR_HOLIDAYS = [
  '01-01', // Confraternização Universal
  '04-21', // Tiradentes
  '05-01', // Dia do Trabalho
  '09-07', // Independência
  '10-12', // Nossa Sra. Aparecida
  '11-02', // Finados
  '11-15', // Proclamação da República
  '11-20', // Consciência Negra (nacional a partir de 2024)
  '12-25', // Natal
];

const CALL_SERIES_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
const PUT_SERIES_LETTERS = ['M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X'];

const holidayCacheByYear = new Map<number, Set<string>>();

/**
 * Computes Easter Sunday for a given Gregorian year (Meeus/Jones/Butcher algorithm).
 */
export function getEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day, 12, 0, 0);
}

/**
 * Returns the full set of B3/ANBIMA national holidays (fixed + movable) for a given year as ISO strings.
 */
export function getB3HolidaysForYear(year: number): Set<string> {
  const cached = holidayCacheByYear.get(year);
  if (cached) return cached;

  const set = new Set<string>();
  for (const mmdd of FIXED_BR_HOLIDAYS) {
    if (mmdd === '11-20' && year < 2024) continue;
    set.add(`${year}-${mmdd}`);
  }

  // Movable ANBIMA/B3 national holidays derived from Easter Sunday
  const easter = getEasterSunday(year);
  set.add(toIsoDateString(addDaysToDate(easter, -48))); // Segunda de Carnaval
  set.add(toIsoDateString(addDaysToDate(easter, -47))); // Terça de Carnaval
  set.add(toIsoDateString(addDaysToDate(easter, -2)));  // Sexta-Feira Santa
  set.add(toIsoDateString(addDaysToDate(easter, 60)));  // Corpus Christi

  holidayCacheByYear.set(year, set);
  return set;
}

export function isB3BusinessDay(date: Date): boolean {
  const dow = date.getDay();
  if (dow === 0 || dow === 6) return false;
  const iso = toIsoDateString(date);
  return !getB3HolidaysForYear(date.getFullYear()).has(iso);
}

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

export function isValidIsoDate(dateStr?: string): boolean {
  if (!dateStr) return false;
  return /^\d{4}-\d{2}-\d{2}/.test(dateStr.trim());
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
 * If the 3rd Friday is a B3/ANBIMA holiday, rolls back to the previous business day (B3 rule).
 */
export function getThirdFriday(year: number, monthIndex0: number): Date {
  const firstDay = new Date(year, monthIndex0, 1, 12, 0, 0);
  const firstWeekday = firstDay.getDay(); // 0=Sun..5=Fri
  const daysToFirstFriday = (5 - firstWeekday + 7) % 7;
  const thirdFridayDay = 1 + daysToFirstFriday + 14;
  let expiry = new Date(year, monthIndex0, thirdFridayDay, 12, 0, 0);
  while (!isB3BusinessDay(expiry)) {
    expiry = addDaysToDate(expiry, -1);
  }
  return expiry;
}

/**
 * Returns upcoming B3 monthly expiration ISO dates starting from `fromDate`.
 */
export function getUpcomingB3Expiries(
  count = 4,
  fromDate = new Date()
): { date: string; calendarDays: number; businessDays: number }[] {
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

/**
 * Counts exact B3/ANBIMA business days in the half-open interval (start, end].
 */
export function countBusinessDays(start: Date, end: Date): number {
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12, 0, 0);
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 12, 0, 0);
  if (e <= s) return 0;

  let count = 0;
  const cursor = new Date(s);
  cursor.setDate(cursor.getDate() + 1);
  while (cursor <= e) {
    if (isB3BusinessDay(cursor)) {
      count += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

/**
 * Linear fallback approximation when no explicit expirationDate is available.
 */
export function calendarToBusinessDays(calendarDays: number, expirationDate?: string): number {
  if (calendarDays <= 0) return 0;
  if (isValidIsoDate(expirationDate)) {
    const expiry = parseIsoDateLocal(expirationDate!);
    const start = addDaysToDate(expiry, -Math.round(calendarDays));
    const du = countBusinessDays(start, expiry);
    return Math.max(1, du);
  }
  return Math.max(1, Math.round(calendarDays * (252 / 365)));
}

/**
 * Computes remaining calendar days from `referenceDate` to `expirationDate`.
 * Returns 0 if already expired; falls back to `fallbackDte` if no valid date is provided.
 */
export function resolveDynamicDte(
  expirationDate: string | undefined,
  fallbackDte: number,
  referenceDate = new Date()
): number {
  if (!isValidIsoDate(expirationDate)) {
    return Math.max(0, Math.round(fallbackDte));
  }
  const ref = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
    12,
    0,
    0
  );
  const exp = parseIsoDateLocal(expirationDate!);
  const diff = Math.round((exp.getTime() - ref.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

/**
 * Computes time to maturity in years following B3 `du/252` (using exact ANBIMA calendar when
 * `expirationDate` is available) or `dc/365`.
 */
export function getTimeToMaturityYears(
  calendarDays: number,
  convention: DayCountConvention,
  expirationDate?: string
): number {
  if (calendarDays <= 0) return 0;
  if (convention === 'du252') {
    const du = calendarToBusinessDays(calendarDays, expirationDate);
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
