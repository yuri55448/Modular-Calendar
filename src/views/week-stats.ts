import type { Moment } from "moment";
import { App } from "obsidian";
import { CalendarSettings } from "../core/settings";
import { periodFiles } from "../notes/periodic";
import { isTaskDone } from "../notes/tasks";
import { resolveColor } from "../util/color";
import { renderMarks } from "../util/marks";

/**
 * 這一週（rowStart 起 7 天內、屬於當月的日子）建立了多少篇日記／任務清單，畫在週數格下方。
 * 任務清單這一欄：只要這週還有沒勾選的任務，就跟當天格子一樣優先顯示成「⚠ 未完成數量」；全部完成才顯示一般圓點。
 */
export async function renderWeekStats(host: HTMLElement, app: App, s: CalendarSettings, rowStart: Moment, month: Moment, allDays = false) {
  if (!s.weekStats.enabled) return;
  let notes = 0;
  let tasks = 0;
  let pending = 0;
  for (let i = 0; i < 7; i++) {
    const d = rowStart.clone().add(i, "days");
    if (!allDays && !d.isSame(month, "month")) continue;
    for (const f of periodFiles(app, "daily", d, s)) {
      notes++;
      if (!s.weekStats.showTasks) continue;
      const items = app.metadataCache.getFileCache(f)?.listItems?.filter((li) => li.task !== undefined) ?? [];
      if (items.length) { tasks++; pending += items.filter((li) => !isTaskDone(li.task as string)).length; }
    }
  }
  if (!notes && !tasks) return;
  const row = host.createDiv({ cls: "dcal-weekstat" });
  if (notes) renderMarks(row.createDiv({ cls: "dcal-markrow" }), { count: notes, cfg: { ...s.noteMarks.diary, mode: s.weekStats.mode } });
  if (pending > 0) {
    const r = row.createDiv({ cls: "dcal-markrow dcal-pending" });
    const span = r.createSpan({ cls: "dcal-pending-mark", text: `${s.noteMarks.taskPending.symbol} ${pending}`, attr: { title: `這週還有 ${pending} 項任務沒完成` } });
    const c = resolveColor(s.noteMarks.taskPending.color).value;
    if (c) span.style.color = c;
  } else if (tasks) {
    renderMarks(row.createDiv({ cls: "dcal-markrow" }), { count: tasks, cfg: { ...s.noteMarks.task, mode: s.weekStats.mode } });
  }
}
