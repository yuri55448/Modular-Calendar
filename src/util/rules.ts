import type { Moment } from "moment";
import { moment } from "obsidian";

/**
 * 日期規則引擎：把「名稱 日期規則」裡的日期規則編譯成「某一天符不符合」的判斷。
 *
 * 規則一律要「有範圍」——必須指定年份（YYYY 或 YYYY~YYYY），或是本身就是指定日期／指定次數，
 * 不接受會無限延續下去的寫法（例如 M/L、W/1E、2026/1/10,7D/N 都會被拒絕）。
 *
 * 符號：「,」分開｜「;」換一組（年份重新開始）｜「.」隔開多個值（1.3＝第 1、3）｜「/」連續（M/D）｜「~」範圍
 * 星期：W 後面接 1~7（1＝週一…7＝週日）再以 E 結尾｜L＝最後一天｜N＝次數
 */
export interface RuleSpan { start: string; end: string; }
export interface DateRule {
  test(date: Moment, anchor?: string): boolean;
  /** 規則涵蓋的最早與最晚日期（YYYY-MM-DD），用來列舉所有符合的日子 */
  span: RuleSpan | null;
}

interface Ymd { y: number; m: number; d: number; wd: number; }
const ymd = (m: Moment): Ymd => ({ y: m.year(), m: m.month() + 1, d: m.date(), wd: ((m.day() + 6) % 7) + 1 }); // wd：1＝週一…7＝週日
const dayNum = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const isLast = (x: Ymd) => x.d === daysIn(x.y, x.m);
const iso = (y: number, m: number, d: number) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const num = (s: string) => Number(s);

type Pred = (x: Ymd, anchor?: string) => boolean;
interface Ctx { years: [number, number] | null; }
interface Item { pred: Pred; /** 本身就有範圍（不靠年份） */ self?: boolean; span?: RuleSpan; error?: string; }
type Made = Item | { year: [number, number] } | { interval: (start: Ymd) => Item };

const inYears = (ctx: Ctx, y: number) => !ctx.years || (y >= ctx.years[0] && y <= ctx.years[1]);
/** 每週的規則才有「從添加當天起往後」 */
const afterAnchor = (x: Ymd, anchor?: string) => !anchor || iso(x.y, x.m, x.d) >= anchor;
const mmdd = (m: number, d: number) => m * 100 + d;
const list = (s: string): number[] => {
  const out: number[] = [];
  for (const part of s.split(/[,.]/)) {
    const r = /^(\d+)~(\d+)$/.exec(part);
    if (r) for (let i = num(r[1]); i <= num(r[2]); i++) out.push(i); else if (/^\d+$/.test(part)) out.push(num(part));
  }
  return out;
};
const yearSpan = (ctx: Ctx): RuleSpan | undefined => ctx.years ? { start: iso(ctx.years[0], 1, 1), end: iso(ctx.years[1], 12, 31) } : undefined;

function addUnits(s: Ymd, n: number, unit: string, times: number): string {
  if (unit === "D" || unit === "W") { const dt = new Date(Date.UTC(s.y, s.m - 1, s.d + n * (unit === "W" ? 7 : 1) * times)); return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()); }
  if (unit === "M") { const t = s.y * 12 + (s.m - 1) + n * times; return iso(Math.floor(t / 12), (t % 12) + 1, s.d); }
  return iso(s.y + n * times, s.m, s.d);
}

function interval(start: Ymd, ns: number[], unit: string, count: number | null, limit: [number, number] | null): Pred {
  const one = (n: number): Pred => (x) => {
    let idx: number;
    if (unit === "D" || unit === "W") {
      const step = unit === "W" ? n * 7 : n;
      const diff = dayNum(x.y, x.m, x.d) - dayNum(start.y, start.m, start.d);
      if (diff < 0 || diff % step !== 0) return false;
      idx = diff / step;
    } else if (unit === "M") {
      const diff = (x.y * 12 + x.m) - (start.y * 12 + start.m);
      if (diff < 0 || diff % n !== 0 || x.d !== start.d) return false;
      idx = diff / n;
    } else {
      const diff = x.y - start.y;
      if (diff < 0 || diff % n !== 0 || x.m !== start.m || x.d !== start.d) return false;
      idx = diff / n;
    }
    return count === null || idx < count;
  };
  const preds = ns.map(one);
  return (x) => (!limit || (x.y >= limit[0] && x.y <= limit[1])) && preds.some((p) => p(x));
}

const D = "(\\d{1,2})";
const Y = "(\\d{4})";
const SEP = "(?=[,\\s;]|$)";
const NEED_YEAR = "沒有指定年份，缺少起點";

interface Tok { re: RegExp; make: (m: RegExpExecArray, ctx: Ctx) => Made; }

const TOKENS: Tok[] = [
  // 年份／年份區間（後面不能緊接 /，否則是 YYYY/M/D）
  { re: new RegExp(`^${Y}(?:~${Y})?${SEP}`), make: (m) => ({ year: [num(m[1]), num(m[2] ?? m[1])] as [number, number] }) },
  // YYYY/M/D/W/xE：從該日起，僅該年每週星期幾
  { re: new RegExp(`^${Y}/${D}/${D}/W/([\\d,.~]+)E${SEP}`), make: (m) => {
      const start = { y: num(m[1]), m: num(m[2]), d: num(m[3]) }; const wds = list(m[4]);
      return { self: true, span: { start: iso(start.y, start.m, start.d), end: iso(start.y, 12, 31) },
        pred: (x) => x.y === start.y && dayNum(x.y, x.m, x.d) >= dayNum(start.y, start.m, start.d) && wds.includes(x.wd) };
    } },
  // YYYY/M/D~YYYY/M/D
  { re: new RegExp(`^${Y}/${D}/${D}~${Y}/${D}/${D}${SEP}`), make: (m) => {
      const a = dayNum(num(m[1]), num(m[2]), num(m[3])), b = dayNum(num(m[4]), num(m[5]), num(m[6]));
      return { self: true, span: { start: iso(num(m[1]), num(m[2]), num(m[3])), end: iso(num(m[4]), num(m[5]), num(m[6])) },
        pred: (x) => { const n = dayNum(x.y, x.m, x.d); return n >= a && n <= b; } };
    } },
  // 單獨的循環間隔 n.nU/cN、nU/N（接在前一個完整日期後面）
  { re: new RegExp(`^(\\d+(?:\\.\\d+)*)([DWMY])/(\\d*)N${SEP}`), make: (m, ctx) => ({ interval: (start: Ymd) => {
      const ns = list(m[1]); const count = m[3] ? num(m[3]) : null;
      if (count === null && !ctx.years) return { pred: () => false, error: "無限次循環必須指定年份或年份範圍（例如 2026~2027, …），或改成指定次數（例如 /10N）" };
      const last = count === null ? ctx.years![1] : null;
      const end = count !== null ? addUnits(start, Math.max(...ns), m[2], count - 1) : iso(last!, 12, 31);
      return { self: true, span: { start: iso(start.y, start.m, start.d), end }, pred: interval(start, ns, m[2], count, ctx.years) };
    } }) },
  // M/D/nU/cN 與 M/D/n/c 與 M/D/n（必須先有年份，從年份的 M/D 起算）
  { re: new RegExp(`^${D}/${D}/(\\d{1,3})([DWMY])?(?:/(?:(\\d+)N?|N))?${SEP}`), make: (m, ctx) => {
      if (!ctx.years) return { pred: () => false, error: `「${m[0].trim()}」${NEED_YEAR}（請寫成 2026, ${m[0].trim()}）` };
      const start: Ymd = { y: ctx.years[0], m: num(m[1]), d: num(m[2]), wd: 0 };
      const n = num(m[3]); const unit = m[4] ?? "D"; const count = m[5] ? num(m[5]) : null;
      const end = count !== null ? addUnits(start, n, unit, count - 1) : iso(ctx.years[1], 12, 31);
      return { self: true, span: { start: iso(start.y, start.m, start.d), end }, pred: interval(start, [n], unit, count, count === null ? ctx.years : null) };
    } },
  // YYYY/M/L/cN、YYYY/M/d/cN：從該年 1 月起，每月最後一天（或每月 d 日），共 c 次
  { re: new RegExp(`^${Y}/M/(L|\\d{1,2})/(\\d+)N${SEP}`), make: (m) => {
      const y0 = num(m[1]); const c = num(m[3]); const day = m[2] === "L" ? null : num(m[2]);
      const lastIdx = y0 * 12 + c - 1;
      return { self: true, span: { start: iso(y0, 1, 1), end: iso(Math.floor(lastIdx / 12), (lastIdx % 12) + 1, daysIn(Math.floor(lastIdx / 12), (lastIdx % 12) + 1)) },
        pred: (x) => { const idx = (x.y * 12 + x.m - 1) - y0 * 12; return idx >= 0 && idx < c && (day === null ? isLast(x) : x.d === day); } };
    } },
  // M/D/L：每月 D 日與最後一天
  { re: new RegExp(`^M/${D}/L${SEP}`), make: (m, ctx) => { const d = num(m[1]); return { pred: (x) => inYears(ctx, x.y) && (x.d === d || isLast(x)), span: yearSpan(ctx) }; } },
  // M/L：每月最後一天
  { re: new RegExp(`^M/L${SEP}`), make: (_m, ctx) => ({ pred: (x) => inYears(ctx, x.y) && isLast(x), span: yearSpan(ctx) }) },
  // 每月第幾個星期幾：[M/]n.nW/n.nE
  { re: new RegExp(`^(?:M/)?([\\d.]+)W/([\\d.]+)E${SEP}`), make: (m, ctx) => {
      const weeks = list(m[1]); const wds = list(m[2]);
      return { pred: (x) => inYears(ctx, x.y) && weeks.includes(Math.floor((x.d - 1) / 7) + 1) && wds.includes(x.wd), span: yearSpan(ctx) };
    } },
  // 每週：W/list E（從添加當天起往後）
  { re: new RegExp(`^W/([\\d,.~]+)E${SEP}`), make: (m, ctx) => { const wds = list(m[1]); return { pred: (x, a) => inYears(ctx, x.y) && afterAnchor(x, a) && wds.includes(x.wd), span: yearSpan(ctx) }; } },
  // YYYY/M/D
  { re: new RegExp(`^${Y}/${D}/${D}${SEP}`), make: (m) => { const [y, mo, d] = [num(m[1]), num(m[2]), num(m[3])]; return { self: true, span: { start: iso(y, mo, d), end: iso(y, mo, d) }, pred: (x) => x.y === y && x.m === mo && x.d === d }; } },
  // M/D/YYYY（月/日/年）
  { re: new RegExp(`^${D}/${D}/${Y}${SEP}`), make: (m) => {
      let mo = num(m[1]), d = num(m[2]); if (mo > 12 && d <= 12) [mo, d] = [d, mo];
      const y = num(m[3]); return { self: true, span: { start: iso(y, mo, d), end: iso(y, mo, d) }, pred: (x) => x.y === y && x.m === mo && x.d === d };
    } },
  // M/D~M/D
  { re: new RegExp(`^${D}/${D}~${D}/${D}${SEP}`), make: (m, ctx) => {
      const a = mmdd(num(m[1]), num(m[2])), b = mmdd(num(m[3]), num(m[4]));
      return { span: yearSpan(ctx), pred: (x) => { if (!inYears(ctx, x.y)) return false; const v = mmdd(x.m, x.d); return a <= b ? v >= a && v <= b : v >= a || v <= b; } };
    } },
  // M/D
  { re: new RegExp(`^${D}/${D}${SEP}`), make: (m, ctx) => { const mo = num(m[1]), d = num(m[2]); return { span: yearSpan(ctx), pred: (x) => inYears(ctx, x.y) && x.m === mo && x.d === d }; } },
  // D~D
  { re: new RegExp(`^${D}~${D}${SEP}`), make: (m, ctx) => { const a = num(m[1]), b = num(m[2]); return { span: yearSpan(ctx), pred: (x) => inYears(ctx, x.y) && x.d >= a && x.d <= b }; } },
  // D
  { re: new RegExp(`^${D}${SEP}`), make: (m, ctx) => { const d = num(m[1]); return { span: yearSpan(ctx), pred: (x) => inYears(ctx, x.y) && x.d === d }; } },
];

const UNBOUNDED = (tok: string) => `「${tok}」沒有指定年份，會無限延續下去；請加上年份（例如 2026, ${tok}）、年份範圍（例如 2026~2027, ${tok}），或改成指定日期／指定次數`;

/** 「2026, 5/20~2027, 5/22」這種跨年區間，整理成 2026/5/20~2027/5/22 */
const normalize = (s: string) => s.replace(/(\d{4})\s*,\s*(\d{1,2}\/\d{1,2})\s*~\s*(\d{4})\s*,\s*(\d{1,2}\/\d{1,2})/g, "$1/$2~$3/$4");

/** 編譯規則；任何一段看不懂或沒有範圍就回傳 error（並指出是哪一段） */
export function compileRule(specIn: string): { rule: DateRule | null; error: string | null } {
  const preds: Pred[] = [];
  const spans: RuleSpan[] = [];
  let ctx: Ctx = { years: null };
  let lastExact: { y: number; m: number; d: number; wd: number } | null = null;
  const src = normalize(specIn.trim());
  if (!src) return { rule: null, error: "沒有填寫日期規則" };
  let pos = 0;
  while (pos < src.length) {
    const ch = src[pos];
    if (ch === ";") { ctx = { years: null }; lastExact = null; pos++; continue; }
    if (/[,\s，]/.test(ch)) { pos++; continue; }
    const rest = src.slice(pos);
    let matched = false;
    for (const tok of TOKENS) {
      const m = tok.re.exec(rest);
      if (!m) continue;
      const out = tok.make(m, ctx);
      const text = m[0].replace(/[,\s;]$/, "");
      if ("year" in out) { ctx = { years: out.year }; lastExact = null; }
      else if ("interval" in out) {
        if (!lastExact) return { rule: null, error: `「${text}」前面需要先寫一個完整日期（YYYY/M/D）當起點` };
        const item = out.interval(lastExact);
        if (item.error) return { rule: null, error: item.error };
        preds.pop(); spans.pop();             // 把前面單純的「那一天」換成循環規則
        preds.push(item.pred); if (item.span) spans.push(item.span);
        lastExact = null;
      } else {
        if (out.error) return { rule: null, error: out.error };
        if (!out.self && !ctx.years) return { rule: null, error: UNBOUNDED(text) };
        preds.push(out.pred);
        const sp = out.span ?? yearSpan(ctx); if (sp) spans.push(sp);
        const full = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text);
        lastExact = full ? { y: num(full[1]), m: num(full[2]), d: num(full[3]), wd: 0 } : null;
      }
      pos += text.length;
      matched = true;
      break;
    }
    if (!matched) {
      const bad = rest.split(/[,\s;]/)[0];
      if (/^\d{4}\/M\//.test(rest)) return { rule: null, error: `「${bad}」會無限延續下去；請寫成 ${bad.slice(0, 4)}, ${bad.slice(5)}、${bad.slice(0, 4)}~${Number(bad.slice(0, 4)) + 1}, ${bad.slice(5)}，或加上次數（例如 ${bad}/10N）` };
      return { rule: null, error: `看不懂「${bad}」` };
    }
  }
  if (!preds.length) return { rule: null, error: "沒有可用的日期" };
  const span = spans.length ? { start: spans.map((s) => s.start).sort()[0], end: spans.map((s) => s.end).sort().slice(-1)[0] } : null;
  return { rule: { span, test: (date, anchor) => { const x = ymd(date); return preds.some((p) => p(x, anchor)); } }, error: null };
}

/** 列出規則涵蓋範圍內所有符合的日期（YYYY-MM-DD）；範圍太大（超過約 20 年）時只取前面的部分 */
export function ruleDates(rule: DateRule, anchor?: string, cap = 7400): string[] {
  if (!rule.span) return [];
  const out: string[] = [];
  let d = moment(rule.span.start, "YYYY-MM-DD");
  const end = moment(rule.span.end, "YYYY-MM-DD");
  for (let i = 0; i < cap && !d.isAfter(end, "day"); i++) {
    if (rule.test(d, anchor)) out.push(d.format("YYYY-MM-DD"));
    d = d.clone().add(1, "days");
  }
  return out;
}

/** 「名稱 規則」：名稱可用 "" 包起來（中間可以有空白）；否則名稱是第一段 */
export function parseRuleLine(line: string): { name: string; spec: string } | null {
  const t = line.trim().replace(/^[-*+]\s+(?:\[.\]\s+)?/, "");
  if (!t) return null;
  const q = /^"([^"]+)"\s+(.+)$/.exec(t) ?? /^“([^”]+)”\s+(.+)$/.exec(t);
  if (q) return { name: q[1], spec: q[2].trim() };
  const m = /^(\S+)\s+(.+)$/.exec(t);
  return m ? { name: m[1], spec: m[2].trim() } : null;
}

/** 設定頁／建立任務視窗顯示的規則說明 */
export const RULE_HELP = [
  '每一條都必須有「範圍」：要指定年份（YYYY 或 YYYY~YYYY），或是本身就是指定日期／指定次數；會無限延續下去的寫法（例如 M/L、2026/M/L）一律不接受，要寫成 2026, M/L 或 2026~2027, M/L 或 2026/M/L/10N。',
  '名稱可以用 "" 包起來，避免名稱中間的空白被切開，例如 "C CC" 2026/5/20~2026/5/25',
  '符號：「,」分開｜「;」換一組（年份重新開始）｜「.」隔開多個值（1.3 ＝ 第 1 和第 3）｜「/」連續（M/D）｜「~」範圍',
  '年份＋日期：YYYY, M/D ｜ YYYY~YYYY, M/D ｜ YYYY, M/D~M/D ｜ YYYY, M/D~YYYY, M/D ｜ YYYY/M/D ｜ D/M/YYYY（月/日/年，例 "12:30 FFF" 10/10/2026）',
  '每月：YYYY, D, D（僅那一年每月幾號）｜YYYY, D~D（連續幾天）｜YYYY, M/L（每月最後一天，例 DDD 2026, M/L）｜YYYY, M/10/L（每月 10 日和最後一天）｜YYYY/M/L/10N（從該年 1 月起共 10 個月）',
  '每週：YYYY, W/6E（僅那一年每週六，從添加當天起往後，例 E_E_E 2026, W/6E）｜W/1,3,5E｜W/1~5E｜YYYY/M/D/W/2E（從那天起、僅該年每週二）',
  '每月第幾個星期幾：YYYY, M/x.xW/x.xE，例 AAA 2026 M/1.3W/1.5E ＝ 僅 2026 年每月第 1、3 個的週一與週五',
  '每隔一段時間：YYYY/M/D,x(D 日／W 週／M 月／Y 年)/x(N 次)，例 BBB 2026/1/10,2M/5N ＝ 從 2026/1/10 起每隔 2 個月、共 5 次；2026, 1/10/7/12 ＝ 每隔 7 日共 12 次；2026, 1/1/1D/N ＝ 僅 2026 年每天',
].join("\n");
