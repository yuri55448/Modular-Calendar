import type { Moment } from "moment";
import { App, TFile } from "obsidian";
import { CalendarSettings, MarkCfg } from "../core/settings";
import { DateRange, Provider } from "../core/types";
import { periodFiles } from "../notes/periodic";
import { scanExtraSources } from "../notes/extra-sources";
import { DAY_MARK } from "../notes/custom-items";
import { isTaskDone } from "../notes/tasks";

export interface TaskStat { total: number; done: number; }

/** diary＝日記；extra＝額外來源（YAML 日期）；taskDiary＝事項/任務日記；path＝只有圓點設定的「讀取路徑」讀到的筆記 */
export type PoolSource = "diary" | "extra" | "taskDiary" | "path";
export interface TaskLine { text: string; done: boolean; line: number; /** 這條是「當日」建立的自訂事項/任務（行尾有 %%cd%% 註解）：月曆另外顯示，不算一般任務 */ custom: boolean; }
/** 「當日」建立的自訂事項／任務（寫在事項/任務日記裡，行尾附 %%cd%%） */
export interface DayMark { text: string; task: boolean; done: boolean; line: number; }
export interface PoolItem { file: TFile; source: PoolSource; task: TaskStat | null; /** 這篇裡每一條任務（給月曆格子顯示任務名稱用） */ tasks: TaskLine[]; /** 這篇裡「當日」建立的自訂事項／任務 */ marks: DayMark[]; }

/** 某一天所有可能算進圓點的筆記（每篇都附上任務清單的完成狀況）；日記圓點／任務圓點各自依自己的設定從裡面挑 */
export interface DayNotes { pool: PoolItem[]; }

const under = (path: string, roots: string[]) => roots.some((p) => {
  const r = p.trim().replace(/^\/+|\/+$/g, "");
  return !!r && (path === r || path === `${r}.md` || path.startsWith(r + "/"));
});

/**
 * 日記圓點要算哪些筆記：設定了「讀取路徑」就只算那些路徑底下的；沒設定＝預設的日記與額外來源
 */
export function notesFor(info: DayNotes, cfg: MarkCfg): PoolItem[] {
  return cfg.paths.length
    ? info.pool.filter((i) => under(i.file.path, cfg.paths))
    : info.pool.filter((i) => i.source === "diary" || i.source === "extra");
}

/** 任務清單圓點要算哪些有任務清單的筆記：設定了「讀取路徑」就只算那些路徑底下的；沒設定＝預設的日記、額外來源與事項/任務日記 */
export function taskNotesFor(info: DayNotes, cfg: MarkCfg): (PoolItem & { task: TaskStat })[] {
  const items = cfg.paths.length ? info.pool.filter((i) => under(i.file.path, cfg.paths)) : info.pool.filter((i) => i.source !== "path");
  return items.filter((i): i is PoolItem & { task: TaskStat } => !!i.task);
}

/** 每天有哪些筆記、各篇任務清單的完成狀況 */
export class NotesProvider implements Provider {
  id = "notes";
  name = "日記統計";
  private data = new Map<string, DayNotes>();

  constructor(private app: App, private getSettings: () => CalendarSettings) {}

  private lines = new Map<string, { mtime: number; tasks: TaskLine[]; marks: DayMark[] }>();

  /** 這篇的每一條任務與「當日」自訂事項：metadataCache 的 listItems 記錄清單項目的行號與任務框字元，文字再從內容取（依修改時間快取） */
  private async fileLines(f: TFile): Promise<{ tasks: TaskLine[]; marks: DayMark[] }> {
    const items = this.app.metadataCache.getFileCache(f)?.listItems ?? [];
    if (!items.length) return { tasks: [], marks: [] };
    const mtime = f.stat?.mtime ?? 0;
    const hit = this.lines.get(f.path);
    if (hit && hit.mtime === mtime) return hit;
    const text = (await this.app.vault.cachedRead(f)).split("\n");
    const tasks: TaskLine[] = [];
    const marks: DayMark[] = [];
    for (const li of items) {
      const line = li.position.start.line;
      const raw = text[line] ?? "";
      const custom = raw.includes(DAY_MARK);
      const clean = raw.replace(/^\s*(?:[-*+]|\d+\.)\s*(?:\[.\]\s*)?/, "").replace(/%%.*?%%/g, "").trim();
      if (li.task !== undefined) tasks.push({ line, done: isTaskDone(li.task as string), text: clean, custom });
      if (custom) marks.push({ line, task: li.task !== undefined, done: li.task !== undefined && isTaskDone(li.task as string), text: clean.replace(/\s*📅\s*\d{4}-\d{2}-\d{2}/u, "").trim() });
    }
    const info = { mtime, tasks, marks };
    this.lines.set(f.path, info);
    return info;
  }

  async load(range: DateRange) {
    const s = this.getSettings();
    const extra = scanExtraSources(this.app, s);
    // 圓點自己設定的「讀取路徑」：這些檔案不一定符合日記檔名，所以用額外來源設定裡的 YAML 日期屬性判斷屬於哪一天
    const dotPaths = [...s.noteMarks.diary.paths, ...s.noteMarks.task.paths];
    const pathMap = dotPaths.length ? scanExtraSources(this.app, s, { paths: dotPaths, force: true }) : new Map<string, TFile[]>();
    this.data.clear();
    for (let d = range.start.clone(); !d.isAfter(range.end, "day"); d = d.add(1, "days")) {
      const key = d.format("YYYY-MM-DD");
      const pool: PoolItem[] = [];
      const seen = new Set<string>();
      const pending: [TFile, PoolSource][] = [];
      const add = (files: TFile[], source: PoolSource) => { for (const file of files) if (!seen.has(file.path)) { seen.add(file.path); pending.push([file, source]); } };
      add(periodFiles(this.app, "daily", d, s), "diary");
      add(periodFiles(this.app, "taskDiary", d, s), "taskDiary");
      add(extra.get(key) ?? [], "extra");
      add(pathMap.get(key) ?? [], "path");
      for (const [file, source] of pending) {
        const { tasks, marks } = await this.fileLines(file);
        // 「當日」建立的自訂任務在月曆另外顯示，不算進一般任務的圓點與數量
        const plain = tasks.filter((t) => !t.custom);
        pool.push({ file, source, tasks: plain, marks, task: plain.length ? { total: plain.length, done: plain.filter((t) => t.done).length } : null });
      }
      if (pool.length) this.data.set(key, { pool });
    }
  }

  get(date: Moment): DayNotes | null {
    return this.data.get(date.format("YYYY-MM-DD")) ?? null;
  }
}
