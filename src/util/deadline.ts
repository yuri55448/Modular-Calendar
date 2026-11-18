import { compileMatcher } from "./format";

export interface Deadline { y: number; m: number; d: number; days: number; }

const dayNum = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** 把設定裡的日期寫法（例如 YYYY-MM-DD、截止 YYYY/MM/DD、[due] YYYY-MM-DD）編譯成「在一段文字裡找日期」的比對器 */
export function compileDeadlineFormats(formats: string[]) {
  const out: { re: RegExp; fields: string[] }[] = [];
  for (const f of formats) {
    if (!f.trim()) continue;
    const m = compileMatcher(f.trim());
    if (!m.fields.some((x) => x === "m") || !m.fields.some((x) => x === "d")) continue; // 至少要有月與日
    out.push({ re: new RegExp(m.re.source.replace(/^\^/, "").replace(/\$$/, "")), fields: m.fields });
  }
  return out;
}

/** 在任務文字裡找第一個符合任何一種寫法的日期，算出離今天還有幾天（負數＝已逾期）；找不到回傳 null */
export function findDeadline(text: string, formats: string[], today: { y: number; m: number; d: number }): Deadline | null {
  for (const { re, fields } of compileDeadlineFormats(formats)) {
    const r = re.exec(text);
    if (!r) continue;
    const got: Record<string, number> = {};
    fields.forEach((f, i) => { if (got[f] === undefined) got[f] = Number(r[i + 1]); });
    const y = got.y ?? (got.y2 !== undefined ? 2000 + got.y2 : today.y);
    const m = got.m, d = got.d;
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m))) continue;
    return { y, m, d, days: dayNum(y, m, d) - dayNum(today.y, today.m, today.d) };
  }
  return null;
}

export interface DeadlineText { future: string; today: string; overdue: string; }

/** 「剩下 {n} 天」這類顯示文字；回傳是否逾期，方便呼叫端用不同顏色 */
export function deadlineLabel(t: DeadlineText, days: number): { text: string; overdue: boolean } {
  if (days > 0) return { text: t.future.replace("{n}", String(days)), overdue: false };
  if (days === 0) return { text: t.today, overdue: false };
  return { text: t.overdue.replace("{n}", String(-days)), overdue: true };
}

// ───────── 依 Tasks 外掛的日期邏輯顯示任務狀態 ─────────

interface Ymd { y: number; m: number; d: number; }
export interface TaskStatusTexts {
  future: string; today: string; overdue: string;
  startFuture: string; startToday: string;
  scheduledFuture: string; scheduledToday: string; scheduledPast: string;
}
export interface TaskStatus { kind: "start" | "scheduled" | "due"; days: number; text: string; overdue: boolean; }

const DATE = "(\\d{4})-(\\d{2})-(\\d{2})";
const KEYS: { kind: "due" | "scheduled" | "start"; emoji: string; word: string }[] = [
  { kind: "due", emoji: "📅", word: "due" },
  { kind: "scheduled", emoji: "⏳", word: "scheduled" },
  { kind: "start", emoji: "🛫", word: "start" },
];

/** 讀出 Tasks 外掛的日期：表情符號寫法（📅 到期、⏳ 預定、🛫 開始）與 Dataview 寫法（[due:: 日期]） */
export function parseTaskDates(text: string): Partial<Record<"due" | "scheduled" | "start", Ymd>> {
  const out: Partial<Record<"due" | "scheduled" | "start", Ymd>> = {};
  for (const k of KEYS) {
    const m = new RegExp(`${k.emoji}\\s*${DATE}`, "u").exec(text) ?? new RegExp(`\\[${k.word}::\\s*${DATE}\\s*\\]`, "i").exec(text);
    if (!m) continue;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= daysIn(y, mo)) out[k.kind] = { y, m: mo, d };
  }
  return out;
}

const diff = (a: Ymd, today: Ymd) => dayNum(a.y, a.m, a.d) - dayNum(today.y, today.m, today.d);

/**
 * 依 Tasks 外掛的邏輯算出任務目前的時間狀態（可能同時有幾個）：
 *  開始日（🛫）還沒到 → 「N 天後開始」／今天開始；到期日（📅）→「N 天後到期」「今天到期」「已逾期 N 天」；
 *  只有預定日（⏳）而沒有到期日時 → 「N 天後預定」「今天預定」「預定日已過 N 天」。
 * 任務文字裡完全沒有 Tasks 的日期符號時，才改用設定的「自訂日期寫法」，找到的日期當作到期日。
 */
export function taskStatuses(text: string, formats: string[], today: Ymd, t: TaskStatusTexts): TaskStatus[] {
  const dates = parseTaskDates(text);
  const out: TaskStatus[] = [];
  // 文字裡有任何 Tasks 的日期符號（包含建立日 ➕、完成日 ✅、取消日 ❌）就不再套用自訂日期寫法，避免把它們誤當成到期日
  const hasTasksSymbols = /[📅⏳🛫➕✅❌]/u.test(text) || /\[(?:due|scheduled|start|created|done|cancelled)::/i.test(text);
  if (!dates.due && !dates.scheduled && !dates.start && !hasTasksSymbols) {
    const g = findDeadline(text, formats, today);
    if (g) dates.due = { y: g.y, m: g.m, d: g.d };
  }
  const fill = (tpl: string, n: number) => tpl.replace("{n}", String(Math.abs(n)));
  if (dates.start) {
    const n = diff(dates.start, today);
    if (n > 0) out.push({ kind: "start", days: n, text: fill(t.startFuture, n), overdue: false });
    else if (n === 0) out.push({ kind: "start", days: 0, text: t.startToday, overdue: false });
  }
  if (dates.due) {
    const n = diff(dates.due, today);
    out.push({ kind: "due", days: n, text: n > 0 ? fill(t.future, n) : n === 0 ? t.today : fill(t.overdue, n), overdue: n < 0 });
  } else if (dates.scheduled) {
    const n = diff(dates.scheduled, today);
    out.push({ kind: "scheduled", days: n, text: n > 0 ? fill(t.scheduledFuture, n) : n === 0 ? t.scheduledToday : fill(t.scheduledPast, n), overdue: n < 0 });
  }
  return out;
}

/** 「剩餘時間」排序用：到期日離今天幾天；沒有到期日就用預定日、再沒有就用還沒到的開始日；都沒有回傳 null */
export function remainingDays(text: string, formats: string[], today: Ymd): number | null {
  const dates = parseTaskDates(text);
  if (dates.due) return diff(dates.due, today);
  if (dates.scheduled) return diff(dates.scheduled, today);
  if (dates.start) { const n = diff(dates.start, today); if (n > 0) return n; }
  return findDeadline(text, formats, today)?.days ?? null;
}
