import { App, TFile } from "obsidian";
import type { Moment } from "moment";
import { CalendarSettings } from "../core/settings";
import { PERIOD_KINDS, PeriodKind } from "../core/types";
import { compileMatcher, compileMatcherLenient, parseWith } from "../util/format";
import { keyFromFields, pathFormat, periodKey } from "./keys";

/**
 * 筆記索引：依「子資料夾＋檔名格式」把 vault 內的檔案對應到日期／週／月／季／年。
 * 因此檔名可含時間、名稱等不固定內容，同一天也能有多篇日記。
 */
export class NoteIndex {
  private dirty = true;
  private maps = new Map<PeriodKind, Map<string, TFile[]>>();

  constructor(private app: App, private getSettings: () => CalendarSettings) {}

  markDirty() { this.dirty = true; }

  private build() {
    const s = this.getSettings();
    this.maps.clear();
    const files = this.app.vault.getMarkdownFiles();
    // 事項/任務日記（預設檔名 YYYY-MM-DD [Tasks]，跟日記放同一個資料夾）要先處理，被它認領的檔案不再算進一般日記，
    // 不然「2026-01-01 Tasks」會被日記的寬鬆比對當成同一天的另一篇日記，造成日記圓點多算一篇
    const taskClaimed = new Set<string>();
    const order: PeriodKind[] = ["taskDiary", ...PERIOD_KINDS.filter((k) => k !== "taskDiary")];
    for (const kind of order) {
      const map = new Map<string, TFile[]>();
      const fmts = [pathFormat(kind, s)];
      if (kind === "daily" && s.naming.extraFormat.trim()) fmts.push(pathFormat(kind, s, true));
      const matchers = fmts.map(compileMatcher);
      // 日記：另外加一個寬鬆版當作最後備援，讓「2026-01-01 1」「2026-01-01 早上」這類手動命名的檔案
      // 也能被判斷成同一天，不需要額外設定「新日記的命名規則」
      if (kind === "daily") matchers.push(compileMatcherLenient(pathFormat(kind, s)));
      const root = s.periodic[kind].folder.trim().replace(/^\/+|\/+$/g, "");
      const prefix = root ? root + "/" : "";
      for (const f of files) {
        if (prefix && !f.path.startsWith(prefix)) continue;
        if (kind !== "taskDiary" && taskClaimed.has(f.path)) continue;
        const rel = f.path.slice(prefix.length).replace(/\.md$/i, "");
        for (const m of matchers) {
          const fields = parseWith(m, rel);
          const key = fields ? keyFromFields(kind, fields, s) : null;
          if (!key) continue;
          const arr = map.get(key);
          if (arr) arr.push(f); else map.set(key, [f]);
          if (kind === "taskDiary") taskClaimed.add(f.path);
          break;
        }
      }
      for (const arr of map.values()) arr.sort((a, b) => (a.stat?.ctime ?? 0) - (b.stat?.ctime ?? 0) || a.path.localeCompare(b.path));
      this.maps.set(kind, map);
    }
    this.dirty = false;
  }

  /** 該期間的所有筆記，依建立時間由早到晚 */
  files(kind: PeriodKind, date: Moment): TFile[] {
    if (this.dirty) this.build();
    return this.maps.get(kind)?.get(periodKey(kind, date, this.getSettings())) ?? [];
  }
}

let INDEX: NoteIndex | null = null;
export function initIndex(app: App, getSettings: () => CalendarSettings) { INDEX = new NoteIndex(app, getSettings); return INDEX; }
export function noteIndex(): NoteIndex {
  if (!INDEX) throw new Error("NoteIndex not initialised");
  return INDEX;
}
