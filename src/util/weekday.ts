import type { Moment } from "moment";
import { CalendarSettings } from "../core/settings";

/** 星期表頭文字；索引 0=週日…6=週六，跟 Moment 的 .day() 一致 */
const STYLES: Record<CalendarSettings["weekdayStyle"], string[]> = {
  zh: ["日", "一", "二", "三", "四", "五", "六"],
  en3: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  en2: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
  en1: ["S", "M", "T", "W", "T", "F", "S"],
  ja: ["日", "月", "火", "水", "木", "金", "土"],
};

/** 節慶／假日來源選「日本」時，星期表頭自動改成日文（月火水木金土日），不受手動選的樣式影響 */
export function effectiveWeekdayStyle(s: CalendarSettings): CalendarSettings["weekdayStyle"] {
  return s.holiday.source === "jp" ? "ja" : s.weekdayStyle;
}

export function weekdayLabels(s: CalendarSettings): string[] {
  return STYLES[effectiveWeekdayStyle(s)] ?? STYLES.zh;
}

/** 標題旁顯示的星期幾文字：日文用「X曜日」，英文風格用完整英文名稱，中文用「週X」 */
export function titleWeekday(s: CalendarSettings, date: Moment): string {
  const style = effectiveWeekdayStyle(s);
  if (style === "ja") return `${STYLES.ja[date.day()]}曜日`;
  if (style.startsWith("en")) return date.format("dddd");
  return `週${STYLES.zh[date.day()]}`;
}
