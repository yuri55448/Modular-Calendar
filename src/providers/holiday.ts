import type { Moment } from "moment";
import { Notice, requestUrl } from "obsidian";
import { CalendarSettings, HolidayEntry } from "../core/settings";
import { DateRange, Provider } from "../core/types";
import { normalizeHolidayJson, sourceUrl } from "./holiday-data";

export interface HolidayData {
  name: string;          // 假日名稱（一般週末為空字串）
  isRest: boolean;       // 放假
  isMakeupWork: boolean; // 補班
}

/** 節慶／假日：可切換來源（台灣、中國、各國 Nager.Date），並疊加使用者導入的 JSON */
export class HolidayProvider implements Provider {
  id = "holiday";
  name = "節慶／假日";
  private byDate = new Map<string, HolidayEntry>();
  private failed = new Set<string>();

  constructor(private getSettings: () => CalendarSettings, private persist: () => Promise<void>) {}

  /** 設定改變（換來源／清快取）後呼叫，讓失敗過的來源可以重試 */
  reset() { this.failed.clear(); }

  async load(range: DateRange) {
    const s = this.getSettings();
    this.byDate.clear();
    const src = s.holiday.source;
    if (src !== "none" && src !== "custom") {
      for (let y = range.start.year(); y <= range.end.year(); y++) {
        const key = `${src}:${src === "other" ? s.holiday.country : "-"}:${y}`;
        let list = s.cache.holiday[key];
        if (!list && !this.failed.has(key)) {
          const url = sourceUrl(src, s.holiday.country, y);
          try {
            if (!url) throw new Error("no url");
            const res = await requestUrl({ url });
            list = normalizeHolidayJson(res.json);
            s.cache.holiday[key] = list;
            s.cache.holidayMeta = s.cache.holidayMeta ?? {};
            s.cache.holidayMeta[key] = Date.now();
            await this.persist();
          } catch (e) {
            this.failed.add(key);
            console.warn(`[dcal] 節慶資料下載失敗 ${key}`, e);
            new Notice(`節慶資料下載失敗（${key}）。可到設定改用其他來源，或導入自己的 JSON。`);
          }
        }
        for (const e of list ?? []) this.byDate.set(e.date, e);
      }
    }
    for (const e of Object.values(s.holiday.custom)) this.byDate.set(e.date, e);
  }

  get(date: Moment): HolidayData | null {
    const e = this.byDate.get(date.format("YYYY-MM-DD"));
    return e ? { name: e.name, isRest: e.isRest, isMakeupWork: e.isMakeupWork } : null;
  }
}
