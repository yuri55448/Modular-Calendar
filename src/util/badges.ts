import type { Moment } from "moment";
import { DateRule, compileRule, parseRuleLine } from "./rules";

export interface CustomBadgeDef { label: string; rule: DateRule; order: number; }
export interface ResolvedBadge { label: string; color: string; source: "custom" | "standard-rest" | "standard-work"; }

/**
 * 解析自訂徽章文字，每行「標籤 日期規則」（標籤可用 "" 包起來）。日期規則的所有寫法見 util/rules.ts 的說明，
 * 常用的三種：
 *   A 1/1, 10/10                          每年的 1/1 與 10/10
 *   B 2026, 1/1, 10/10, 2027, 2/1, 11/11  年份後面的月日只算那一年，遇到下一個年份才換
 *   C 1, 10                               每月 1 日與 10 日；F 2026,10,11 ＝僅 2026 年每月 10、11 日
 * order 為該行在文字中的順序（0 最前），用來決定「自訂義優先」時同天多個自訂徽章之間的先後。
 * 看不懂的行會被略過，並收集在 errors 裡讓設定頁提示。
 */
export function parseCustomBadgesDetailed(text: string): { defs: CustomBadgeDef[]; errors: { line: string; message: string }[] } {
  const defs: CustomBadgeDef[] = [];
  const errors: { line: string; message: string }[] = [];
  let order = 0;
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    const parsed = parseRuleLine(raw);
    if (!parsed) { errors.push({ line: raw.trim(), message: "格式應為「標籤 日期規則」" }); continue; }
    const { rule, error } = compileRule(parsed.spec);
    if (!rule) { errors.push({ line: raw.trim(), message: error ?? "看不懂" }); continue; }
    defs.push({ label: parsed.name, rule, order: order++ });
  }
  return { defs, errors };
}

export function parseCustomBadges(text: string): CustomBadgeDef[] {
  return parseCustomBadgesDetailed(text).defs;
}

/** 某天命中的自訂徽章（依文字順序），一天可能同時命中好幾個 */
export function matchCustomBadges(defs: CustomBadgeDef[], date: Moment): CustomBadgeDef[] {
  return defs.filter((d) => d.rule.test(date));
}

/**
 * 合併標準（休／班）與自訂徽章，依「自訂優先」或「標準優先」排序。
 * 回傳陣列的順序即畫面由左到右的顯示順序（最左＝最優先）。
 */
export function resolveBadges(
  o: {
    standard: { label: string; color: string; kind: "rest" | "work" } | null;
    custom: CustomBadgeDef[];
    priority: "custom" | "standard";
    customColor: (label: string) => string;
  }
): ResolvedBadge[] {
  const customBadges: ResolvedBadge[] = o.custom.map((d) => ({ label: d.label, color: o.customColor(d.label), source: "custom" as const }));
  const std: ResolvedBadge[] = o.standard
    ? [{ label: o.standard.label, color: o.standard.color, source: o.standard.kind === "rest" ? "standard-rest" : "standard-work" }]
    : [];
  return o.priority === "custom" ? [...customBadges, ...std] : [...std, ...customBadges];
}

/** 標籤含空白時用 "" 包起來，才不會被切成兩段 */
export const quoteLabel = (label: string) => (/\s/.test(label) ? `"${label}"` : label);

/**
 * 在自訂徽章文字裡加上某一天：已經有同名標籤的那一行就把日期（YYYY/M/D）接在後面，沒有就新增一行。
 * 回傳新的全文；那一天已經包含在該標籤的規則裡就不重複加。
 */
export function addDateToBadge(text: string, label: string, date: Moment): string {
  const token = date.format("YYYY/M/D");
  const lines = text.split("\n");
  const i = lines.findIndex((l) => parseRuleLine(l)?.name === label);
  if (i < 0) {
    const base = text.trim() === "" ? "" : text.replace(/\s+$/, "") + "\n";
    return `${base}${quoteLabel(label)} ${token}`;
  }
  const parsed = parseRuleLine(lines[i])!;
  const { rule } = compileRule(parsed.spec);
  if (rule?.test(date)) return text;
  lines[i] = `${lines[i].replace(/\s+$/, "")}, ${token}`;
  return lines.join("\n");
}

/**
 * 取消某一天的自訂徽章：把「指定那一天」的日期（YYYY/M/D 或 M/D/YYYY）從各行拿掉，只剩年份而沒有日期的行整行刪除。
 * 如果那一天還是被別的規則（區間、每月、每週…）涵蓋，沒辦法在不動到規則的情況下取消，會列在 still 讓呼叫端提醒使用者去設定修改。
 */
export function removeDateFromBadges(text: string, date: Moment): { text: string; changed: boolean; still: string[] } {
  const y = date.year(), m = date.month() + 1, d = date.date();
  const same = (tok: string) => {
    const a = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(tok);
    if (a) return +a[1] === y && +a[2] === m && +a[3] === d;
    const b = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(tok);
    return !!b && +b[3] === y && +b[1] === m && +b[2] === d;
  };
  const re = /(^|[,，;\s])(\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{4})(?=[,，;\s]|$)/g;
  const out: string[] = [];
  const still: string[] = [];
  let changed = false;
  for (const raw of text.split("\n")) {
    const parsed = parseRuleLine(raw);
    if (!parsed) { out.push(raw); continue; }
    let spec = parsed.spec.replace(re, (all, sep: string, tok: string) => (same(tok) ? ((changed = true), sep === " " ? " " : "") : all));
    spec = spec.replace(/[,，]\s*[,，]+/g, ",").replace(/^[,，;\s]+|[,，;\s]+$/g, "").trim();
    const { rule } = spec ? compileRule(spec) : { rule: null };
    if (!rule) { if (spec !== parsed.spec) changed = true; continue; }      // 拿掉日期後什麼都不剩（或只剩年份）→ 整行刪除
    if (rule.test(date)) still.push(parsed.name);
    out.push(`${quoteLabel(parsed.name)} ${spec}`);
  }
  return { text: out.join("\n"), changed, still: [...new Set(still)] };
}
