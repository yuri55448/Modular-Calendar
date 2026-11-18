import type { Moment } from "moment";

/**
 * 檔名／資料夾格式：以 Moment 語法為基礎，並加上
 *   [文字] 或 "文字"  → 原樣輸出、不當作格式
 *   {{name}} {{week}} {{weekYear}} {{quarter}} {{quarterYear}} → 插入值
 * 其餘非格式字元（- _ / . 空白 及中文）也是原樣輸出；「/」代表資料夾分隔。
 */
type Tok = { t: "lit" | "mom" | "var"; v: string };

const RE =
  /\[([^\]]*)\]|"([^"]*)"|\{\{\s*(\w+)\s*\}\}|(YYYY|YY|MMMM|MMM|MM|M|Do|DDDD|DDD|DD|D|dddd|ddd|dd|d|E|e|GGGG|gggg|GG|gg|WW|W|ww|w|HH|H|hh|h|kk|k|mm|m|ss|s|SSS|SS|S|A|a|ZZ|Z|X|x|Q)/g;

export function tokenize(fmt: string): Tok[] {
  const out: Tok[] = [];
  const lit = (s: string) => { if (s) out.push({ t: "lit", v: s }); };
  const re = new RegExp(RE.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt))) {
    lit(fmt.slice(last, m.index));
    if (m[1] !== undefined) lit(m[1]);
    else if (m[2] !== undefined) lit(m[2]);
    else if (m[3] !== undefined) out.push({ t: "var", v: m[3] });
    else out.push({ t: "mom", v: m[4] });
    last = m.index + m[0].length;
  }
  lit(fmt.slice(last));
  return out;
}

/** 檔名不允許的字元換成空白 */
export function sanitizeName(s: string): string {
  return s.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim();
}

export function renderFormat(fmt: string, at: Moment, vars: Record<string, string> = {}): string {
  let f = "";
  for (const t of tokenize(fmt)) {
    if (t.t === "mom") f += t.v;
    else {
      const text = (t.t === "lit" ? t.v : vars[t.v] ?? "").replace(/\]/g, "");
      if (text) f += `[${text}]`;
    }
  }
  return f ? at.format(f) : "";
}

// ── 反向：從路徑解析出日期欄位（用來辨識某篇筆記屬於哪一天／週／月…）──
export interface Matcher { re: RegExp; fields: string[]; }
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

const NUM: Record<string, [string, string]> = {
  YYYY: ["y", "(\\d{4})"], YY: ["y2", "(\\d{2})"], MM: ["m", "(\\d{2})"], M: ["m", "(\\d{1,2})"],
  DD: ["d", "(\\d{2})"], D: ["d", "(\\d{1,2})"], Do: ["d", "(\\d{1,2})(?:st|nd|rd|th|日)?"],
  GGGG: ["wy", "(\\d{4})"], gggg: ["wy", "(\\d{4})"], GG: ["wy2", "(\\d{2})"], gg: ["wy2", "(\\d{2})"],
  WW: ["w", "(\\d{2})"], ww: ["w", "(\\d{2})"], W: ["w", "(\\d{1,2})"], w: ["w", "(\\d{1,2})"], Q: ["q", "(\\d)"],
};
const VARS: Record<string, [string, string]> = {
  weekYear: ["wy", "(\\d{4})"], week: ["w", "(\\d{1,2})"], quarterYear: ["qy", "(\\d{4})"], quarter: ["q", "(\\d)"],
};
const GENERIC_NUM = new Set(["HH", "H", "hh", "h", "kk", "k", "mm", "m", "ss", "s"]);
const GENERIC_LONG = new Set(["SSS", "SS", "S", "X", "x", "DDDD", "DDD"]);

/**
 * 寬鬆版：在格式本身之後，允許再接一個「分隔符＋任意內容」（例如編號、備註文字），
 * 用來讓「2026-01-01」也能辨識出「2026-01-01 1.md」「2026-01-01 早上.md」等同一天的其他筆記，
 * 不需要另外設定「新日記的命名規則」才能被日記圓點等功能算進同一天。
 */
export function compileMatcherLenient(fmt: string): Matcher {
  const strict = compileMatcher(fmt);
  const src = strict.re.source.replace(/\$$/, "(?:[ _.-].*)?$");
  return { re: new RegExp(src), fields: strict.fields };
}

export function compileMatcher(fmt: string): Matcher {
  const fields: string[] = [];
  let src = "";
  for (const t of tokenize(fmt)) {
    if (t.t === "lit") { src += esc(t.v); continue; }
    const hit = t.t === "var" ? VARS[t.v] : NUM[t.v];
    if (hit) { fields.push(hit[0]); src += hit[1]; continue; }
    if (t.t === "var") src += "[^/]*?";
    else if (GENERIC_NUM.has(t.v)) src += "\\d{1,2}";
    else if (GENERIC_LONG.has(t.v)) src += "\\d+";
    else if (t.v === "Z" || t.v === "ZZ") src += "[+-]\\d{2}:?\\d{2}";
    else src += "[^/]+?";
  }
  return { re: new RegExp(`^${src}$`), fields };
}

export function parseWith(m: Matcher, path: string): Record<string, number> | null {
  const r = m.re.exec(path);
  if (!r) return null;
  const out: Record<string, number> = {};
  m.fields.forEach((f, i) => { if (out[f] === undefined) out[f] = Number(r[i + 1]); });
  return out;
}

// ── 設定頁的說明文件（示例由目前時間即時算出）──
export const TOKEN_DOCS: { group: string; items: [string, string][] }[] = [
  { group: "年", items: [["YYYY", "四位數年"], ["YY", "兩位數年"]] },
  { group: "月", items: [["MM", "月（補零）"], ["M", "月"], ["MMMM", "月份全名"], ["MMM", "月份簡稱"]] },
  { group: "日", items: [["DD", "日（補零）"], ["D", "日"], ["Do", "日（序數）"], ["DDDD", "一年中的第幾天（補零）"], ["DDD", "一年中的第幾天"]] },
  { group: "星期幾", items: [["dddd", "星期全名"], ["ddd", "星期簡稱"], ["dd", "星期最短"], ["d", "星期數字（0=週日）"], ["E", "ISO 星期數字（1=週一）"]] },
  { group: "時", items: [["HH", "24 小時制（補零）"], ["H", "24 小時制"], ["hh", "12 小時制（補零）"], ["h", "12 小時制"], ["A", "上午／下午（大寫）"], ["a", "上午／下午（小寫）"]] },
  { group: "分", items: [["mm", "分（補零）"], ["m", "分"]] },
  { group: "秒", items: [["ss", "秒（補零）"], ["s", "秒"], ["SSS", "毫秒"]] },
  { group: "週／季", items: [["WW", "ISO 週數（補零）"], ["W", "ISO 週數"], ["GGGG", "ISO 週年"], ["ww", "本地週數（補零）"], ["Q", "季度（日曆季）"]] },
  { group: "其他", items: [["ZZ", "時區"], ["X", "Unix 秒"]] },
];
export const VAR_DOCS: [string, string][] = [
  ["{{name}}", "日記名稱（建立時輸入，或取自模板檔名，見「日記命名」）"],
  ["{{weekYear}}", "週記用：這一週所屬的年"],
  ["{{week}}", "週記用：週數（補零成兩位）"],
  ["{{quarterYear}}", "季記用：這一季所屬的年"],
  ["{{quarter}}", "季記用：第幾季（1–4，依「季度起始月」）"],
];
export const FORMAT_EXAMPLES: string[] = [
  "YYYY-MM-DD", "YYYYMMDD", "YYYY年MM月DD日", "YYYY-MM-DD dddd", "YYYY-MM-DD_ddd",
  "YYYY-MM-DD HH-mm-ss", "YYYY-MM-DD_HH.mm.ss", "MM-DD ddd", "YYYY/MM/DD", 'YYYY-MM-DD" "{{name}}',
  "YYYY-MM-DD [週]E", 'YYYY-MM-DD" at "HH:mm', "{{weekYear}}-[W]{{week}}", "{{quarterYear}}-[Q]{{quarter}}",
];
