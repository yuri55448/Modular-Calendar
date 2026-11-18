import { HolidayEntry } from "../core/settings";

/** Nager.Date 支援的部分國家／地區（沒有資料的會在下載失敗時提示） */
export const NAGER_COUNTRIES: [string, string][] = [
  ["JP", "日本"], ["KR", "韓國"], ["SG", "新加坡"], ["MY", "馬來西亞"], ["TH", "泰國"], ["VN", "越南"],
  ["PH", "菲律賓"], ["ID", "印尼"], ["IN", "印度"], ["HK", "香港"], ["MO", "澳門"],
  ["US", "美國"], ["CA", "加拿大"], ["MX", "墨西哥"], ["BR", "巴西"], ["AR", "阿根廷"],
  ["GB", "英國"], ["IE", "愛爾蘭"], ["FR", "法國"], ["DE", "德國"], ["IT", "義大利"], ["ES", "西班牙"],
  ["PT", "葡萄牙"], ["NL", "荷蘭"], ["BE", "比利時"], ["CH", "瑞士"], ["AT", "奧地利"], ["SE", "瑞典"],
  ["NO", "挪威"], ["DK", "丹麥"], ["FI", "芬蘭"], ["PL", "波蘭"], ["CZ", "捷克"], ["GR", "希臘"],
  ["TR", "土耳其"], ["AU", "澳洲"], ["NZ", "紐西蘭"], ["ZA", "南非"], ["AE", "阿聯酋"], ["IL", "以色列"],
];

export function sourceUrl(source: string, country: string, year: number): string | null {
  switch (source) {
    case "tw": return `https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${year}.json`;
    case "cn": return `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`;
    case "jp": return `https://date.nager.at/api/v3/publicholidays/${year}/JP`;
    case "us": return `https://date.nager.at/api/v3/publicholidays/${year}/US`;
    case "other": return `https://date.nager.at/api/v3/publicholidays/${year}/${country}`;
    case "custom": return null; // 純自訂：不下載，只用使用者匯入的 JSON
    default: return null;
  }
}

export const HOLIDAY_SOURCE_LABEL: Record<string, string> = {
  none: "不使用", tw: "台灣", jp: "日本", us: "美國", cn: "中國", custom: "自訂義（不下載）", other: "其他國家",
};

const p2 = (n: number) => String(n).padStart(2, "0");

/** 接受 YYYYMMDD、YYYY-MM-DD、YYYY/M/D、ISO 時間字串；回傳 YYYY-MM-DD 或 null */
export function normalizeDate(raw: string): string | null {
  const m = /^(\d{4})[-/.]?(\d{1,2})[-/.]?(\d{1,2})/.exec(raw.trim());
  if (!m) return null;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${m[1]}-${p2(mo)}-${p2(d)}`;
}

/**
 * 把各種節慶 JSON 統一成 HolidayEntry[]。支援：
 *  1. 陣列：[{date, name|localName|title|description, isRest|isHoliday|isOffDay, isMakeupWork}]（含台灣行事曆、Nager.Date）
 *  2. 物件含 days / holidays 陣列（如 holiday-cn 的 {days:[{name,date,isOffDay}]}）
 *  3. 對照表：{"2026-10-10": "國慶日"} 或 {"2026-10-10": {name, isRest}}
 */
export function normalizeHolidayJson(json: any): HolidayEntry[] {
  let list: any[] | null = null;
  if (Array.isArray(json)) list = json;
  else if (json && Array.isArray(json.days)) list = json.days;
  else if (json && Array.isArray(json.holidays)) list = json.holidays;
  else if (json && typeof json === "object") {
    list = Object.entries(json).map(([date, v]) => (typeof v === "string" ? { date, name: v } : { date, ...(v as object) }));
  }
  if (!list) throw new Error("無法辨識的 JSON 結構");

  const out: HolidayEntry[] = [];
  for (const it of list) {
    if (!it || typeof it !== "object") continue;
    const date = normalizeDate(String(it.date ?? it.Date ?? it.day ?? ""));
    if (!date) continue;
    const name = String(it.name ?? it.localName ?? it.title ?? it.description ?? it.summary ?? "").trim();
    const weekend = [0, 6].includes(new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))).getDay());
    let isRest = true;
    let makeup = false;
    if (typeof it.isOffDay === "boolean") { isRest = it.isOffDay; makeup = !it.isOffDay; }
    else if (typeof it.isHoliday === "boolean") { isRest = it.isHoliday; makeup = !it.isHoliday && weekend; }
    else if (typeof it.isRest === "boolean") isRest = it.isRest;
    if (typeof it.isMakeupWork === "boolean") makeup = it.isMakeupWork;
    out.push({ date, name, isRest, isMakeupWork: makeup });
  }
  if (!out.length) throw new Error("找不到任何有效的日期資料（每筆需要 date 欄位）");
  return out;
}
