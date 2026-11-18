import type { Moment } from "moment";

/**
 * 重複設定（自訂事項／任務共用的日期規則，取代原本的文字規則寫法）：
 *  重複：不重複／每天／每週／每月／每年（自定義＝每 N 個單位）｜每月日期（可複選）｜月倒數｜週幾｜時刻｜
 *  點位次數（每個時刻要完成幾次）｜每 N 個單位的次數（按次／不限）｜策略（必做／打卡）｜結束方式
 */
export type RepeatKind = "once" | "day" | "week" | "month" | "year";
export interface RepeatSpec {
  kind: RepeatKind;
  /** 每 N 個單位（天／週／月／年） */
  every: number;
  /** 開始日期 YYYY-MM-DD，也是「每 N 個單位」的計算起點 */
  start: string;
  /** 每週：星期幾（1＝週一…7＝週日）；沒選＝開始日期那天的星期 */
  weekdays: number[];
  /** 每月：每月幾日（1–31）；沒選日期也沒選月倒數＝開始日期那天 */
  monthDays: number[];
  /** 每月：月倒數（1＝最後一天、2＝倒數第二天…） */
  fromEnd: number[];
  /** 時刻 HH:mm（可多個）；空＝不指定時刻 */
  times: string[];
  /** 點位次數：每個時刻（沒指定時刻就是每一天）要完成幾次 */
  perDay: number;
  /** 每個單位週期內的次數：按次（n 次）或不限 */
  period: { mode: "count" | "unlimited"; n: number };
  /** must＝必做類（錯過不會自動跳過，等著補做）｜checkin＝打卡類（錯過就略過） */
  strategy: "must" | "checkin";
  end: { mode: "forever" | "date" | "cycles"; date?: string; cycles?: number };
}

export const UNIT_LABEL: Record<Exclude<RepeatKind, "once">, string> = { day: "天", week: "週", month: "月", year: "年" };
const WD = ["", "一", "二", "三", "四", "五", "六", "日"];

export function defaultSpec(start: string): RepeatSpec {
  return { kind: "once", every: 1, start, weekdays: [], monthDays: [], fromEnd: [], times: [], perDay: 1, period: { mode: "unlimited", n: 1 }, strategy: "must", end: { mode: "forever" } };
}

const dayNum = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const parse = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return { y, m, d }; };
const wdOf = (y: number, m: number, d: number) => ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;   // 1＝週一…7＝週日
const mondayNum = (y: number, m: number, d: number) => dayNum(y, m, d) - (wdOf(y, m, d) - 1);

/** 這一天是不是符合規則（含開始日期、結束方式）；不判斷「次數」 */
export function occursOn(spec: RepeatSpec, date: Moment): boolean {
  return occursOnYmd(spec, date.year(), date.month() + 1, date.date());
}

export function occursOnYmd(spec: RepeatSpec, y: number, m: number, d: number): boolean {
  const s = parse(spec.start);
  const here = dayNum(y, m, d);
  const first = dayNum(s.y, s.m, s.d);
  if (here < first) return false;
  if (spec.kind === "once") return here === first;
  if (spec.end.mode === "date" && spec.end.date) { const e = parse(spec.end.date); if (here > dayNum(e.y, e.m, e.d)) return false; }
  const every = Math.max(1, Math.floor(spec.every) || 1);
  let diff: number;
  switch (spec.kind) {
    case "day": diff = here - first; break;
    case "week": diff = Math.floor((mondayNum(y, m, d) - mondayNum(s.y, s.m, s.d)) / 7); break;
    case "month": diff = (y * 12 + m) - (s.y * 12 + s.m); break;
    default: diff = y - s.y;
  }
  if (diff % every !== 0) return false;
  if (spec.end.mode === "cycles" && spec.end.cycles !== undefined && Math.floor(diff / every) >= spec.end.cycles) return false;
  switch (spec.kind) {
    case "day": return true;
    case "week": return (spec.weekdays.length ? spec.weekdays : [wdOf(s.y, s.m, s.d)]).includes(wdOf(y, m, d));
    case "month": {
      if (!spec.monthDays.length && !spec.fromEnd.length) return d === s.d;
      return spec.monthDays.includes(d) || spec.fromEnd.some((k) => d === daysIn(y, m) - (k - 1));
    }
    default: return m === s.m && d === s.d;
  }
}

/** from～to（含）之間所有符合的日期 YYYY-MM-DD；最多 cap 個 */
export function occurrences(spec: RepeatSpec, from: string, to: string, cap = 800): string[] {
  const out: string[] = [];
  const a = parse(from < spec.start ? spec.start : from);
  const b = parse(spec.end.mode === "date" && spec.end.date && spec.end.date < to ? spec.end.date : to);
  const last = dayNum(b.y, b.m, b.d);
  for (let n = dayNum(a.y, a.m, a.d); n <= last && out.length < cap; n++) {
    const dt = new Date(n * 86400000);
    const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate();
    if (occursOnYmd(spec, y, m, d)) out.push(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return out;
}

/** 設定有沒有問題；沒問題回傳 null */
export function validateSpec(spec: RepeatSpec): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spec.start)) return "開始日期格式不正確（YYYY-MM-DD）";
  if (spec.kind !== "once") {
    if (!(spec.every >= 1 && Number.isInteger(spec.every))) return "「每 N」必須是 1 以上的整數";
    if (spec.end.mode === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(spec.end.date ?? "")) return "截止日期格式不正確（YYYY-MM-DD）";
    if (spec.end.mode === "date" && (spec.end.date as string) < spec.start) return "截止日期不能早於開始日期";
    if (spec.end.mode === "cycles" && !((spec.end.cycles ?? 0) >= 1)) return "週期數必須是 1 以上的整數";
  }
  if (spec.times.some((t) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) return "時刻格式必須是 HH:mm（例如 09:00、18:30）";
  if (!(spec.perDay >= 1 && Number.isInteger(spec.perDay))) return "點位次數必須是 1 以上的整數";
  return null;
}

/** 一行文字摘要，例如「每 8 月 20 日 · 2026-10-20 起 · 必做」 */
export function summarize(spec: RepeatSpec): string {
  const parts: string[] = [];
  const s = parse(spec.start);
  if (spec.kind === "once") parts.push(`僅 ${spec.start}`);
  else {
    const n = spec.every > 1 ? `每 ${spec.every} ` : "每";
    const u = UNIT_LABEL[spec.kind];
    if (spec.kind === "day") parts.push(spec.every > 1 ? `每 ${spec.every} 天` : "每天");
    else if (spec.kind === "week") parts.push(`${n}週${(spec.weekdays.length ? spec.weekdays : [wdOf(s.y, s.m, s.d)]).slice().sort().map((w) => WD[w]).join("、")}`);
    else if (spec.kind === "month") {
      const days = [...spec.monthDays].sort((a, b) => a - b).map((d) => `${d} 日`);
      const ends = [...spec.fromEnd].sort((a, b) => a - b).map((k) => (k === 1 ? "最後一天" : `倒數第 ${k} 天`));
      const list = [...days, ...ends];
      parts.push(`${n}${u} ${list.length ? list.join("、") : `${s.d} 日`}`);
    } else parts.push(`${n}${u} ${s.m}/${s.d}`);
    parts.push(`${spec.start} 起`);
  }
  if (spec.times.length) parts.push(spec.times.join(" / "));
  if (spec.perDay > 1) parts.push(`每次 ${spec.perDay} 回`);
  if (spec.kind !== "once") {
    if (spec.period.mode === "count") parts.push(`每${spec.every > 1 ? ` ${spec.every} ` : ""}${UNIT_LABEL[spec.kind]} ${spec.period.n} 次`);
    parts.push(spec.strategy === "must" ? "必做" : "打卡");
    if (spec.end.mode === "date" && spec.end.date) parts.push(`到 ${spec.end.date} 止`);
    if (spec.end.mode === "cycles") parts.push(`共 ${spec.end.cycles} 個週期`);
  }
  return parts.join(" · ");
}

/** 從（可能不完整或被改壞的）JSON 還原成合法的設定 */
export function normalizeSpec(raw: any, fallbackStart: string): RepeatSpec {
  const d = defaultSpec(typeof raw?.start === "string" ? raw.start : fallbackStart);
  const ints = (a: any, lo: number, hi: number) => (Array.isArray(a) ? [...new Set(a.map(Number).filter((n) => Number.isInteger(n) && n >= lo && n <= hi))].sort((x, y) => x - y) : []);
  const kind: RepeatKind = ["once", "day", "week", "month", "year"].includes(raw?.kind) ? raw.kind : "once";
  return {
    kind, start: d.start, every: Math.max(1, Math.floor(Number(raw?.every)) || 1),
    weekdays: ints(raw?.weekdays, 1, 7), monthDays: ints(raw?.monthDays, 1, 31), fromEnd: ints(raw?.fromEnd, 1, 31),
    times: Array.isArray(raw?.times) ? raw.times.filter((t: any) => typeof t === "string") : [],
    perDay: Math.max(1, Math.floor(Number(raw?.perDay)) || 1),
    period: { mode: raw?.period?.mode === "count" ? "count" : "unlimited", n: Math.max(1, Math.floor(Number(raw?.period?.n)) || 1) },
    strategy: raw?.strategy === "checkin" ? "checkin" : "must",
    end: raw?.end?.mode === "date" ? { mode: "date", date: String(raw.end.date) } : raw?.end?.mode === "cycles" ? { mode: "cycles", cycles: Math.max(1, Math.floor(Number(raw.end.cycles)) || 1) } : { mode: "forever" },
  };
}
