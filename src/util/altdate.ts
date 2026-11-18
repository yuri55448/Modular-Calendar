import type { Moment } from "moment";
import { moment } from "obsidian";
import { Lunar } from "lunar-javascript";
import { CalendarSettings, Elapsed } from "../core/settings";
import { japaneseEra } from "./japan";
import { t } from "./s2t";

/** 目前選的節慶／假日來源對應的國家代碼（沒有對應國家時回傳空字串） */
export function effectiveCountry(s: CalendarSettings): string {
  switch (s.holiday.source) {
    case "tw": return "TW";
    case "jp": return "JP";
    case "cn": return "CN";
    case "us": return "US";
    case "other": return s.holiday.country;
    default: return "";
  }
}

/** 該國自己的紀年（只收錄有官方／通行紀年的國家）；沒有就回傳 null——此時「國家的年曆」不顯示 */
export function nationalYear(country: string, date: Moment): string | null {
  const y = date.year();
  if (country === "JP") return japaneseEra(date);
  if (country === "TW") return y >= 1912 ? `中華民國${y - 1911}年` : null;
  if (country === "TH") return `佛曆${y + 543}年`;
  return null;
}

/** 加上「已經過了多少年月日」；月份超過 12 會進位到年 */
export function addElapsed(date: Moment, e: Elapsed): Moment {
  return date.clone().add(e.y, "years").add(e.m, "months").add(e.d, "days");
}

/** 從 start 起算到 date 經過的 年／月／日（再加上 offset）；date 比 start 早就回傳 null */
export function elapsedSince(start: Moment, date: Moment, offset: Elapsed): Elapsed | null {
  if (date.isBefore(start, "day")) return null;
  const years = date.diff(start, "years");
  const afterY = start.clone().add(years, "years");
  const months = date.diff(afterY, "months");
  const afterM = afterY.clone().add(months, "months");
  const days = date.diff(afterM, "days");
  const totalMonths = months + offset.m;
  return { y: years + offset.y + Math.floor(totalMonths / 12), m: totalMonths % 12, d: days + offset.d };
}

/** 標題第二列「另一份年月日」要顯示的文字；回傳空字串代表不顯示 */
export function altDateText(s: CalendarSettings, date: Moment): string {
  const alt = s.altDate;
  const country = effectiveCountry(s);
  if (alt.mode === "custom") {
    const start = moment(alt.startDate, "YYYY-MM-DD");
    if (!start.isValid()) return "";
    const e = elapsedSince(start, date, alt.elapsed);
    return e ? `${alt.name}${e.y}年${e.m}月${e.d}日` : "";
  }
  if (alt.mode === "national") {
    const y = nationalYear(country, date);
    return y ? `${y}${date.month() + 1}月${date.date()}日` : "";
  }
  // 國家的農曆年月日
  try {
    const l = Lunar.fromDate(date.toDate());
    if (country === "JP") return `旧暦${Math.abs(l.getMonth())}月${l.getDay()}日`;
    return t(l.getYearInGanZhi() + l.getYearShengXiao()) + "年" + t(l.getMonthInChinese()) + "月" + t(l.getDayInChinese());
  } catch { return ""; }
}
