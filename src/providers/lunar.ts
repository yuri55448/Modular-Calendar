import type { Moment } from "moment";
import { Lunar } from "lunar-javascript";
import { DateRange, Provider } from "../core/types";
import { t } from "../util/s2t";
import { japaneseEra, rokuyo } from "../util/japan";

export interface LunarData {
  dayText: string;     // 初一、十五…
  monthText: string;   // 正月、臘月…（初一時顯示用）
  isFirst: boolean;
  term: string;        // 節氣（當天不是節氣則為空字串）
  festivals: string[]; // 農曆節日
  rokuyo: string;       // 日本傳統六曜吉凶（先勝／友引／先負／仏滅／大安／赤口）
}

/** 標題用：丙午馬年 / 七月 / 十五；選日本節慶來源時改成令和年號＋西元月日 */
export function lunarHeader(date: Moment, japanMode = false) {
  if (japanMode) return { year: japaneseEra(date), month: `${date.month() + 1}月`, day: `${date.date()}日` };
  try {
    const l = Lunar.fromDate(date.toDate());
    return {
      year: t(l.getYearInGanZhi() + l.getYearShengXiao()) + "年",
      month: t(l.getMonthInChinese()) + "月",
      day: t(l.getDayInChinese()),
    };
  } catch (e) {
    console.warn("[dcal] 農曆標題計算失敗", e);
    return { year: "", month: "", day: "" };
  }
}

export class LunarProvider implements Provider {
  id = "lunar";
  name = "農曆與節氣";
  private cache = new Map<string, LunarData>();

  async load(_range: DateRange) { /* 純計算，不需預載 */ }

  get(date: Moment): LunarData {
    const key = date.format("YYYY-MM-DD");
    const hit = this.cache.get(key);
    if (hit) return hit;
    const l = Lunar.fromDate(date.toDate());
    const data: LunarData = {
      dayText: t(l.getDayInChinese()),
      monthText: t(l.getMonthInChinese()) + "月",
      isFirst: l.getDay() === 1,
      term: t(l.getJieQi() || ""),
      festivals: (l.getFestivals() as string[]).map(t),
      rokuyo: rokuyo(l.getMonth(), l.getDay()),
    };
    this.cache.set(key, data);
    return data;
  }
}
