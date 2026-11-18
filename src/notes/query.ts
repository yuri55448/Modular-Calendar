import { App, TFile } from "obsidian";
import type { Moment } from "moment";
import { CalendarSettings, ContentFilter, UiState } from "../core/settings";
import { PeriodKind } from "../core/types";
import { periodFiles } from "./periodic";
import { weekInfo } from "../util/calendar";
import { scanExtraSources } from "./extra-sources";
import { isTaskDone } from "./tasks";

/** diary = 日／週／月記等既有的週期筆記；extra = 額外來源讀到的筆記；taskDiary = 事項/任務日記 */
export type NoteSource = "diary" | "extra" | "taskDiary";
export interface NoteEntry { file: TFile; kind: PeriodKind; date: Moment; source: NoteSource; }
export interface TaskEntry { file: TFile; line: number; done: boolean; text: string; date: Moment; kind: PeriodKind; source: NoteSource; }

/** 範圍（當日／本週／本月）內的每一天 */
export function datesInScope(s: CalendarSettings, selected: Moment, scope: UiState["scope"]): Moment[] {
  if (scope === "day") return [selected.clone().startOf("day")];
  if (scope === "week") {
    const start = weekInfo(selected, s.weekStart).start;
    return Array.from({ length: 7 }, (_v, i) => start.clone().add(i, "days"));
  }
  if (scope === "year") {
    const start = selected.clone().startOf("year");
    const y = selected.year();
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return Array.from({ length: leap ? 366 : 365 }, (_v, i) => start.clone().add(i, "days"));
  }
  const start = selected.clone().startOf("month");
  return Array.from({ length: selected.daysInMonth() }, (_v, i) => start.clone().add(i, "days"));
}

/** 某範圍內「已存在」的週期筆記：先列該範圍的週／月記，再依日期列日記 */
export function collectNotes(app: App, s: CalendarSettings, selected: Moment, scope: UiState["scope"]): NoteEntry[] {
  const out: NoteEntry[] = [];
  const add = (kind: PeriodKind, date: Moment) => {
    for (const file of periodFiles(app, kind, date, s)) out.push({ file, kind, date: date.clone(), source: "diary" });
  };
  if (scope === "week") add("weekly", weekInfo(selected, s.weekStart).start);
  if (scope === "month") add("monthly", selected.clone().startOf("month"));
  if (scope === "year") add("yearly", selected.clone().startOf("year"));
  for (const d of datesInScope(s, selected, scope)) add("daily", d);
  return out;
}

/** 額外來源（其他路徑的 .md，靠 YAML 日期屬性歸到某一天）；已經算在日記裡的檔案不重複列 */
export function collectExtra(app: App, s: CalendarSettings, selected: Moment, scope: UiState["scope"]): NoteEntry[] {
  const map = scanExtraSources(app, s);
  const out: NoteEntry[] = [];
  for (const d of datesInScope(s, selected, scope)) {
    const diary = new Set(periodFiles(app, "daily", d, s).map((f) => f.path));
    for (const file of map.get(d.format("YYYY-MM-DD")) ?? []) {
      if (!diary.has(file.path)) out.push({ file, kind: "daily", date: d.clone(), source: "extra" });
    }
  }
  return out;
}

export function collectTaskDiaries(app: App, s: CalendarSettings, selected: Moment, scope: UiState["scope"]): NoteEntry[] {
  const out: NoteEntry[] = [];
  for (const d of datesInScope(s, selected, scope)) {
    for (const file of periodFiles(app, "taskDiary", d, s)) out.push({ file, kind: "taskDiary", date: d.clone(), source: "taskDiary" });
  }
  return out;
}

/**
 * 依篩選條件取出筆記：
 *  notes（日記）＝日／週／月記；extra（筆記）＝額外來源的 .md；
 *  tasks（任務）／all（全部）＝以上全部再加上事項/任務日記（任務清單可能在任何一種筆記裡）
 */
export function collectByFilter(app: App, s: CalendarSettings, selected: Moment, scope: UiState["scope"], filter: "all" | ContentFilter): NoteEntry[] {
  if (filter === "notes") return collectNotes(app, s, selected, scope);
  if (filter === "extra") return collectExtra(app, s, selected, scope);
  const all = [...collectNotes(app, s, selected, scope), ...collectExtra(app, s, selected, scope), ...collectTaskDiaries(app, s, selected, scope)];
  const seen = new Set<string>();
  return all.filter((e) => { const k = `${e.file.path}|${e.date.format("YYYY-MM-DD")}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** 從筆記的 metadata cache 取出 `- [ ]` 任務（不需要逐檔解析 Markdown）；相容 Tasks 外掛的自訂狀態字元 */
export async function collectTasks(app: App, entries: NoteEntry[]): Promise<TaskEntry[]> {
  const out: TaskEntry[] = [];
  for (const e of entries) {
    const items = (app.metadataCache.getFileCache(e.file)?.listItems ?? []).filter((li) => li.task !== undefined);
    if (!items.length) continue;
    const lines = (await app.vault.cachedRead(e.file)).split("\n");
    for (const li of items) {
      const line = li.position.start.line;
      const text = (lines[line] ?? "").replace(/^\s*(?:[-*+]|\d+\.)\s*\[.\]\s*/, "").trim();
      out.push({ file: e.file, line, done: isTaskDone(li.task as string), text, date: e.date, kind: e.kind, source: e.source });
    }
  }
  return out;
}
