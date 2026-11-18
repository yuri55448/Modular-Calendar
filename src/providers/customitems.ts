import type { Moment } from "moment";
import { App } from "obsidian";
import { CalendarSettings } from "../core/settings";
import { DateRange, Provider } from "../core/types";
import { CustomItem, DayEntry, entriesOn, listCustomItems } from "../notes/custom-items";

/** 自訂事項／任務：載入時讀出存放資料夾裡所有長期事項，get(date) 回傳當天符合重複設定的內容 */
export class CustomItemsProvider implements Provider {
  id = "customitems";
  name = "自訂事項／任務";
  private items: CustomItem[] = [];

  constructor(private app: App, private getSettings: () => CalendarSettings) {}

  async load(_range: DateRange) { this.items = await listCustomItems(this.app, this.getSettings()); }
  all(): CustomItem[] { return this.items; }
  get(date: Moment): DayEntry[] { return entriesOn(this.items, date, this.getSettings().customItems.done); }
}
