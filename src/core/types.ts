import type { Moment } from "moment";

export type PeriodKind = "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "taskDiary";
export const PERIOD_KINDS: PeriodKind[] = ["daily", "weekly", "monthly", "quarterly", "yearly", "taskDiary"];
export const PERIOD_LABEL: Record<PeriodKind, string> = {
  daily: "日記", weekly: "週記", monthly: "月記", quarterly: "季記", yearly: "年記", taskDiary: "事項/任務日記",
};

/**
 * background 整格底層｜tl 左上（公曆日期）｜tc 上方中間｜tr 右上（休／班）
 * info：日期下方的資訊區，由「多列」組成（settings.infoRows），每一列可以放一個或多個模塊
 * bl 左下｜br 右下｜bottom 底部整條
 */
export type SlotName = "background" | "tl" | "tc" | "tr" | "info" | "bl" | "br" | "bottom";
export const SLOT_NAMES: SlotName[] = ["background", "tl", "tc", "tr", "info", "bl", "br", "bottom"];
export type FixedSlot = Exclude<SlotName, "info">;
/** 有固定位置、由 settings.layout 決定順序的插槽（info 另外用 infoRows 管理） */
export const FIXED_SLOTS: FixedSlot[] = ["background", "tl", "tc", "tr", "bl", "br", "bottom"];

export interface DateRange { start: Moment; end: Moment; }

export interface CreateOpts {
  /** undefined = 用設定的模板；"" = 空白；其他 = 指定模板路徑 */
  template?: string;
  /** 日記名稱（對應檔名格式裡的 {{name}}） */
  name?: string;
  /** 使用「新增日記」的命名規則（可與既有日記並存） */
  extra?: boolean;
  /** 即使當天已有筆記也建立新的 */
  forceNew?: boolean;
}

export interface DayContext {
  date: Moment;
  isToday: boolean;
  isOutsideMonth: boolean;
  /** 各 Provider 的資料，以 provider id 為 key */
  data: Record<string, any>;
  /** 取得（必要時建立）指定插槽的元素，讓模塊可以決定要畫在哪一列 */
  slot(name: SlotName): HTMLElement;
}

/** 資料來源：只負責「某天有什麼資料」，不管怎麼畫 */
export interface Provider {
  id: string;
  name: string;
  /** 依顯示範圍批次預載（可含網路或讀檔）；get() 之後必須是同步且便宜的 */
  load(range: DateRange): Promise<void>;
  get(date: Moment): unknown;
}

/** 格內模塊：決定資料怎麼畫進某個插槽 */
export interface CellModule {
  id: string;
  name: string;
  slot: SlotName;
  requires: string[];
  /**
   * 回傳 true = 插槽已被填滿，後面的模塊不再執行（先到先得）。
   * 回傳 false / undefined = 繼續交給下一個模塊（可疊加）。
   */
  render(ctx: DayContext, el: HTMLElement): boolean | void;
}

/** 視圖提供給 Action 模塊的操作介面（名稱刻意避開 Obsidian View 的內建方法） */
export interface ActionHost {
  selectDate(date: Moment): void;
  openNote(kind: PeriodKind, date: Moment, opts?: CreateOpts, fromDblClick?: boolean): Promise<void>;
  openMenu(evt: MouseEvent, date: Moment): void;
}

export interface ActionModule {
  id: string;
  name: string;
  trigger: "click" | "dblclick" | "contextmenu";
  run(ctx: DayContext, evt: MouseEvent, host: ActionHost): void | Promise<void>;
}
