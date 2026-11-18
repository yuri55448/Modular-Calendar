import type { Moment } from "moment";
import { CalendarSettings } from "../core/settings";
import type { HolidayData } from "../providers/holiday";
import type { LunarData } from "../providers/lunar";
import { DayNotes } from "../providers/notes";
import type { DayEntry } from "../notes/custom-items";
import { titleWeekday } from "../util/weekday";
import { resolveDayBadges } from "./day-badges";

/**
 * 滑鼠移到日期數字上時顯示的完整內容：不管格子放不放得下、也不管對應的模塊有沒有開啟，
 * 當天的農曆、節氣、節日、假日、休／班／自訂徽章、自訂事項、日記與任務數量都會列出來。
 */
export function dayTooltip(s: CalendarSettings, data: Record<string, any>, date: Moment): string {
  const lines: string[] = [`${date.format("YYYY-MM-DD")} ${titleWeekday(s, date)}`];
  const lunar = data["lunar"] as LunarData | undefined;
  if (lunar) {
    lines.push(`農曆：${lunar.isFirst ? lunar.monthText : ""}${lunar.dayText}${lunar.term ? `（${lunar.term}）` : ""}`);
    if (lunar.festivals.length) lines.push(`節日：${lunar.festivals.join("、")}`);
    if (s.holiday.source === "jp" && lunar.rokuyo) lines.push(`六曜：${lunar.rokuyo}`);
  }
  const hol = (data["holiday"] ?? null) as HolidayData | null;
  if (hol?.name) lines.push(`假日：${hol.name}${hol.isRest ? "（休）" : hol.isMakeupWork ? "（補班）" : ""}`);
  const badges = resolveDayBadges(s.restWorkBadge, hol, date);
  if (badges.length) lines.push(`徽章：${badges.map((b) => b.label).join("、")}`);
  const entries = data["customitems"] as DayEntry[] | undefined;
  if (entries?.length) {
    const label = (e: DayEntry) => (e.time ? `${e.time} ${e.name}` : e.name);
    const items = entries.filter((e) => e.type === "item").map(label);
    const tasks = entries.filter((e) => e.type === "task").map((e) => `${e.done >= e.need ? "☑" : "☐"} ${label(e)}`);
    if (items.length) lines.push(`自訂事項：${items.join("、")}`);
    if (tasks.length) lines.push(`自訂任務：${tasks.join("、")}`);
  }
  const notes = data["notes"] as DayNotes | null | undefined;
  const dayMarks = (notes?.pool ?? []).flatMap((i) => i.marks);
  if (dayMarks.length) lines.push(`當日事項/任務：${dayMarks.map((m) => `${m.task ? (m.done ? "☑ " : "☐ ") : ""}${m.text}`).join("、")}`);
  if (notes?.pool.length) {
    lines.push(`筆記：${notes.pool.map((i) => i.file.basename).join("、")}`);
    const pending = notes.pool.reduce((n, i) => n + (i.task ? i.task.total - i.task.done : 0), 0);
    if (pending) lines.push(`未完成任務：${pending} 項`);
  }
  return lines.join("\n");
}
