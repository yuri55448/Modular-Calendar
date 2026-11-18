import { CellModule } from "../core/types";
import { CalendarSettings } from "../core/settings";
import type { LunarData } from "../providers/lunar";
import type { HolidayData } from "../providers/holiday";
import { DayNotes, notesFor, taskNotesFor } from "../providers/notes";
import { renderMarks } from "../util/marks";
import { resolveColor, toBackground } from "../util/color";
import { dayBackground, resolveDayBadges } from "./day-badges";
import { DayItemsEnv, dayItemsModule } from "./day-items";

/** 假日名稱與農曆節日／節氣重複時（例如「中秋節」vs「中秋節」），只顯示假日名稱 */
function dup(holidayName: string, text: string) {
  return !!holidayName && (holidayName.includes(text) || text.includes(holidayName));
}
const holidayOf = (data: Record<string, any>) => data["holiday"] as HolidayData | null;
const holidayNameOf = (data: Record<string, any>) => {
  const h = holidayOf(data);
  return h && !h.isMakeupWork ? h.name : "";
};
const cssColor = (raw: string) => resolveColor(raw).value || "";
/** 自訂文字裡用逗號「,」「，」或斜線「/」分隔多段，各自換行顯示 */

export function createBuiltinCells(getS: () => CalendarSettings, env?: DayItemsEnv): CellModule[] {
  const solarDay: CellModule = {
    id: "solar-day", name: "公曆日期", slot: "tl", requires: [],
    render(ctx, el) {
      const span = el.createSpan({ cls: "dcal-solar", text: String(ctx.date.date()) });
      if (ctx.isToday) {
        const bg = cssColor(getS().todayColor);
        if (bg) span.style.setProperty("--dcal-today-num-bg", bg);
      }
      return true;
    },
  };

  const lunarDay: CellModule = {
    id: "lunar-day", name: "農曆日期", slot: "info", requires: ["lunar"],
    render(ctx, el) {
      const d = ctx.data["lunar"] as LunarData | undefined;
      if (d) el.createSpan({ cls: "dcal-lunar", text: d.isFirst ? d.monthText : d.dayText });
    },
  };

  const festival: CellModule = {
    id: "festival", name: "農曆節日", slot: "info", requires: ["lunar"],
    render(ctx, el) {
      const d = ctx.data["lunar"] as LunarData | undefined;
      const h = holidayNameOf(ctx.data);
      const f = d?.festivals.find((x) => !dup(h, x));
      if (f) el.createSpan({ cls: "dcal-tag dcal-festival", text: f });
    },
  };

  const solarTerm: CellModule = {
    id: "solar-term", name: "農曆節氣", slot: "info", requires: ["lunar"],
    render(ctx, el) {
      const d = ctx.data["lunar"] as LunarData | undefined;
      if (!d) return;
      // 節慶／假日來源選日本時，這裡改顯示日本傳統「六曜」吉凶，取代中文農曆節氣（兩者都是「當天的曆法小標籤」）
      const text = getS().holiday.source === "jp" ? d.rokuyo : d.term;
      if (text && !dup(holidayNameOf(ctx.data), text)) el.createSpan({ cls: "dcal-tag dcal-term", text });
    },
  };

  const holidayName: CellModule = {
    id: "holiday-name", name: "假日名稱", slot: "info", requires: ["holiday"],
    render(ctx, el) {
      const h = holidayNameOf(ctx.data);
      if (!h) return;
      const span = el.createSpan({ cls: "dcal-tag dcal-holiday-name", text: h, attr: { title: h } });
      // 名稱太長時依格子寬度自動換行（預設開啟）；關閉時維持單行、超出的部分會被截掉
      if (getS().holidayNameWrap) span.addClass("dcal-wrap");
    },
  };

  /** 休／班／自訂徽章：合併標準假日資料與自訂日期規則，依優先序排序，最左邊最優先 */
  const restWorkBadge: CellModule = {
    id: "rest-work-badge", name: "休／班／自訂徽章", slot: "tr", requires: ["holiday"],
    render(ctx, el) {
      const cfg = getS().restWorkBadge;
      const badges = resolveDayBadges(cfg, holidayOf(ctx.data), ctx.date);
      if (!badges.length) return false;
      // 「邊框上」要相對於整個格子定位才能真的騎在格子的上邊框；el（tr 插槽）本身只是格子裡一個小角落的
      // 定位容器，拿它當參照系會讓徽章跑到那個小角落裡面，而不是沿著格子的邊。所以這裡改掛到格子本身底下。
      const cell = el.closest(".dcal-cell") as HTMLElement | null;
      const host = cfg.position === "border" && cell ? cell : el;
      const wrap = host.createDiv({ cls: `dcal-badges dcal-badges-${cfg.position} dcal-badges-align-${cfg.align}` });
      for (const b of badges) {
        const span = wrap.createSpan({ cls: `dcal-badge dcal-badge-${b.source}`, text: b.label });
        const bc = cfg.badgeColors[b.label];
        const bg = bc ? toBackground(cssColor(bc.color), bc.opacity) : "";
        if (bg) span.style.setProperty("background", bg);
      }
      return true;
    },
  };

  /**
   * 假日底色：跟「休／班／自訂徽章」用同一套規則判斷當天命中哪些徽章，再依 bgPriority（可在設定拖曳排序）
   * 決定要用哪一個的底色——跟畫面上徽章本身的「左到右優先序」是分開的兩件事，因為底色只能選一個。
   */
  const holidayBg: CellModule = {
    id: "holiday-bg", name: "假日底色", slot: "background", requires: ["holiday"],
    render(ctx, el) {
      const cell = el.closest(".dcal-cell");
      if (!cell) return false;
      const win = dayBackground(getS().restWorkBadge, holidayOf(ctx.data), ctx.date);
      if (!win) return false;
      if (win.source === "standard-rest") cell.setAttribute("data-holiday", "true");
      if (win.source === "standard-work") cell.setAttribute("data-makeup", "true");
      cell.setAttribute("data-badge-bg", win.label);
      if (win.css) (cell as HTMLElement).style.setProperty("--dcal-holiday-bg-custom", win.css);
      else (cell as HTMLElement).style.removeProperty("--dcal-holiday-bg-custom");
      return false;
    },
  };

  const noteDot: CellModule = {
    id: "note-dot", name: "日記圓點", slot: "info", requires: ["notes"],
    render(ctx, el) {
      const info = ctx.data["notes"] as DayNotes | null;
      if (!info) return;
      const count = notesFor(info, getS().noteMarks.diary).length;
      if (count) renderMarks(el.createDiv({ cls: "dcal-markrow" }), { count, cfg: getS().noteMarks.diary });
    },
  };

  /**
   * 任務清單圓點：當天筆記裡還有沒勾選的任務時，顯示「自訂符號＋未完成數量」（預設紅色 ⚠ 1），
   * 全部都勾選完成就變回一般的圓點樣式（點數＝有任務清單的筆記篇數）
   */
  const taskDot: CellModule = {
    id: "task-dot", name: "任務清單圓點", slot: "info", requires: ["notes"],
    render(ctx, el) {
      const info = ctx.data["notes"] as DayNotes | null;
      if (!info) return;
      const s = getS();
      const withTasks = taskNotesFor(info, s.noteMarks.task);
      if (!withTasks.length) return;
      const pending = withTasks.reduce((n, i) => n + (i.task.total - i.task.done), 0);
      if (pending > 0) {
        const row = el.createDiv({ cls: "dcal-markrow dcal-pending" });
        const c = cssColor(s.noteMarks.taskPending.color);
        const span = row.createSpan({ cls: "dcal-pending-mark", text: `${s.noteMarks.taskPending.symbol} ${pending}`, attr: { title: `${pending} 項任務還沒完成` } });
        if (c) span.style.color = c;
        return;
      }
      renderMarks(el.createDiv({ cls: "dcal-markrow" }), { count: withTasks.length, cfg: s.noteMarks.task });
    },
  };

  return [solarDay, lunarDay, festival, solarTerm, holidayName, restWorkBadge, holidayBg, ...(env ? [dayItemsModule(env)] : []), noteDot, taskDot];
}
