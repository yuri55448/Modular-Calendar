import { moment } from "obsidian";
import type { Moment } from "moment";
import { TaskEntry, collectByFilter, collectTasks } from "../notes/query";
import { titleWeekday } from "../util/weekday";
import { ViewDeps, addTaskInput, bindTaskCheck, renderDeadline, taskContextMenu } from "./panel";
import { segmented } from "../util/ui";
import { UiState } from "../core/settings";
import { sortByText } from "../util/sorting";

/**
 * 時間軸：每天一列，列出該日日記與其中的任務；任務可勾選、每天可直接新增任務。
 * scope="month"＝當月；scope="year"＝整年（每個月一個標題）。上方可切換「全部／日記／筆記／任務」。
 */
export async function renderTimeline(host: HTMLElement, deps: ViewDeps, selected: Moment, scope: "month" | "year" = "month") {
  const { app, settings: s } = deps;
  const bar = host.createDiv({ cls: "dcal-tl-bar" });
  segmented<UiState["timelineFilter"]>(
    bar,
    [{ value: "all", label: "全部" }, { value: "notes", label: "日記" }, { value: "extra", label: "筆記" }, { value: "tasks", label: "任務" }],
    s.ui.timelineFilter,
    (v) => { s.ui.timelineFilter = v; void deps.save(); deps.rerender(); }
  );
  const tsort = bar.createEl("select", { cls: "dcal-tl-sort", attr: { title: "任務排序" } }) as HTMLSelectElement;
  for (const [v, l] of [["none", "任務：不排序"], ["az", "任務名稱 A 到 Z"], ["za", "任務名稱 Z 到 A"]]) tsort.createEl("option", { text: l, attr: { value: v } });
  tsort.value = s.ui.timelineTaskSort;
  tsort.onchange = () => { s.ui.timelineTaskSort = tsort.value as UiState["timelineTaskSort"]; void deps.save(); deps.rerender(); };
  const wrap = host.createDiv({ cls: "dcal-timeline" });
  const filter = s.ui.timelineFilter;
  const today = moment();
  const months: Moment[] = scope === "year"
    ? Array.from({ length: 12 }, (_v, i) => selected.clone().startOf("year").add(i, "months"))
    : [selected.clone().startOf("month")];
  let anything = false;

  const makeRow = (dayText: string, wdText: string, isToday: boolean) => {
    const row = wrap.createDiv({ cls: "dcal-tl-row" });
    if (isToday) row.setAttr("data-today", "true");
    const left = row.createDiv({ cls: "dcal-tl-date" });
    left.createSpan({ cls: "dcal-tl-day", text: dayText });
    if (wdText) left.createSpan({ cls: "dcal-tl-wd", text: wdText });
    const rail = row.createDiv({ cls: "dcal-tl-rail" });
    rail.createDiv({ cls: "dcal-tl-dot" });
    return row.createDiv({ cls: "dcal-tl-body" });
  };

  for (const first of months) {
    // 日記＝日／週／月記；筆記＝額外來源讀到的 .md；任務＝以上加事項/任務日記裡的任務；全部＝都顯示
    const found = collectByFilter(app, s, first, "month", filter);
    const monthly = filter === "all" || filter === "notes" ? found.find((e) => e.kind === "monthly")?.file ?? null : null;
    const entries = found.filter((e) => e.kind !== "monthly" && e.kind !== "weekly");
    if (!entries.length && !monthly) continue;
    anything = true;

    const tasks = await collectTasks(app, entries);
    const byPath = new Map<string, TaskEntry[]>();
    for (const t of tasks) { const arr = byPath.get(t.file.path) ?? []; arr.push(t); byPath.set(t.file.path, arr); }

    if (scope === "year") wrap.createDiv({ cls: "dcal-tl-month", text: `${first.year()} 年 ${first.month() + 1} 月` });
    if (monthly) makeRow("整月", "", false).createDiv({ cls: "dcal-tl-note", text: monthly.name }).onclick = () => deps.open(monthly);

    for (const day of Array.from({ length: first.daysInMonth() }, (_v, i) => first.clone().add(i, "days"))) {
      const dayFiles = entries.filter((e) => e.date.isSame(day, "day"));
      if (!dayFiles.length) continue;
      // 「任務」篩選下，這天如果沒有任何一篇筆記含任務，整天都跳過不顯示
      const filesWithTasks = dayFiles.filter((e) => (byPath.get(e.file.path) ?? []).length > 0);
      if (filter === "tasks" && !filesWithTasks.length) continue;
      const shownFiles = filter === "tasks" ? filesWithTasks : dayFiles;

      const body = makeRow(`${day.date()} 日`, titleWeekday(s, day), day.isSame(today, "day"));
      for (const e of shownFiles) {
        const list = sortByText(byPath.get(e.file.path) ?? [], s.ui.timelineTaskSort);
        if (filter !== "tasks") {
          const noteRow = body.createDiv({ cls: "dcal-tl-note", text: e.file.name });
          noteRow.onclick = () => deps.open(e.file);
          if (e.source !== "diary") noteRow.createSpan({ cls: "dcal-tl-source", text: e.source === "taskDiary" ? "事項/任務日記" : "筆記" });
          const open = list.filter((t) => !t.done).length;
          if (list.length) body.createDiv({ cls: "dcal-tl-count", text: `${list.length - open} / ${list.length} 完成` });
        }
        if (filter === "notes" || filter === "extra") continue;
        for (const t of list) {
          const row = body.createDiv({ cls: "dcal-tl-task" });
          const check = row.createSpan();
          row.createSpan({ cls: "dcal-tl-task-text", text: t.text || "(空白任務)" });
          renderDeadline(row, t.text, t.done, s);
          bindTaskCheck(check, row, t, () => deps.toggleTask(t));
          row.onclick = () => deps.open(t.file, t.line);
          taskContextMenu(row, t, deps);
        }
      }
      if (filter === "notes" || filter === "extra") continue;

      // 就地新增任務（加到當天的事項/任務日記；沒有會自動建立）
      const add = body.createDiv({ cls: "dcal-tl-add" });
      const showLink = () => { add.empty(); add.createSpan({ cls: "dcal-tl-add-link", text: "＋ 新增任務" }).onclick = showInput; };
      const showInput = () => {
        add.empty();
        const input = addTaskInput(add, "新增任務（Enter 送出，Esc 取消）",
          async (v, heading) => { await deps.addTask(day, v, heading); deps.rerender(); }, showLink, s.taskAdd.headings);
        input.focus();
      };
      showLink();
    }
  }
  if (!anything) wrap.createDiv({ cls: "dcal-empty", text: scope === "year" ? `${selected.year()} 年還沒有符合的內容` : `${selected.month() + 1} 月還沒有符合的內容` });
  wrap.querySelector('[data-today="true"]')?.scrollIntoView({ block: "nearest" });
}
