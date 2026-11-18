import type { Moment } from "moment";
import { TFile } from "obsidian";
import { CalendarSettings } from "../core/settings";
import { CellModule } from "../core/types";
import { DayEntry } from "../notes/custom-items";
import { sortNames } from "../notes/custom-entries";
import { DayNotes, notesFor, taskNotesFor } from "../providers/notes";
import { resolveColor } from "../util/color";

/** 一行要顯示的內容 */
export interface DayLine {
  /** item／ctask＝長期的自訂事項／任務；ditem／dtask＝「當日」建立的；task＝一般任務；note＝筆記名稱 */
  kind: "item" | "ctask" | "ditem" | "dtask" | "task" | "note";
  text: string;
  done?: boolean;
  file?: TFile; line?: number;
  entry?: DayEntry;
}

export interface DayItemsEnv {
  getS: () => CalendarSettings;
  open: (file: TFile, line?: number) => void;
  /** 勾選一次自訂事項/任務（完成次數 +1，達到需要次數後再點會歸零） */
  toggleEntry: (e: DayEntry) => Promise<void>;
  /** 勾選／取消勾選筆記裡的某一行任務（「當日」建立的任務） */
  toggleLine: (file: TFile, line: number) => Promise<void>;
  /** 目前被展開的日期（YYYY-MM-DD） */
  expanded: Set<string>;
  refresh: () => void;
}

/** 每一行名稱大約佔的高度（px），以及格子裡要留給日期數字等其他內容的高度 */
const LINE_PX = 13;
const RESERVED_PX = 28;

/**
 * 依「月曆內容」的勾選，算出某一天要列出的所有內容（順序：事項→自訂事項/任務→事項/任務日記／日記裡的任務→筆記名稱）。
 * 事項依設定排序（預設 A 到 Z）；自訂事項/任務依時刻與名稱。
 */
export function dayLines(s: CalendarSettings, data: Record<string, any>): DayLine[] {
  const out: DayLine[] = [];
  const show = s.dayItems.show;
  const entries = (data["customitems"] as DayEntry[] | undefined) ?? [];
  const info = data["notes"] as DayNotes | null | undefined;
  if (show.items) {
    const label = (e: DayEntry) => (e.time ? `${e.time} ${e.name}` : e.name);
    // 事項：長期的與「當日」建立的放在一起，依設定排序（預設 A 到 Z）
    const items: DayLine[] = entries.filter((e) => e.type === "item").map((e) => ({ kind: "item" as const, text: label(e), entry: e }));
    for (const it of info?.pool ?? []) for (const m of it.marks) if (!m.task) items.push({ kind: "ditem", text: m.text, file: it.file, line: m.line });
    const cmp = (a: DayLine, b: DayLine) => a.text.localeCompare(b.text, undefined, { numeric: true, sensitivity: "base" });
    if (s.customItems.sort === "az") items.sort(cmp); else if (s.customItems.sort === "za") items.sort((a, b) => cmp(b, a));
    out.push(...items);
    for (const e of entries.filter((x) => x.type === "task")) out.push({ kind: "ctask", text: label(e), done: e.done >= e.need, entry: e });
    for (const it of info?.pool ?? []) for (const m of it.marks) if (m.task && (s.dayItems.showDone || !m.done)) out.push({ kind: "dtask", text: m.text, done: m.done, file: it.file, line: m.line });
  }
  if (info && show.tasks) {
    for (const it of taskNotesFor(info, s.noteMarks.task)) {
      for (const t of it.tasks) if (s.dayItems.showDone || !t.done) out.push({ kind: "task", text: t.text || "(空白任務)", done: t.done, file: it.file, line: t.line });
    }
  }
  if (info && show.notes) {
    for (const it of notesFor(info, s.noteMarks.diary)) out.push({ kind: "note", text: it.file.basename, file: it.file });
  }
  return out;
}

const PREFIX: Record<DayLine["kind"], string> = { item: "• ", ditem: "• ", ctask: "", dtask: "", task: "", note: "📄 " };

/**
 * 每日內容：依「月曆內容」按鈕勾選的種類，把當天的事項、任務、筆記名稱一行一行列出來。
 * 超過最多筆數（預設依格子大小自動）時，最後一行變成「還有 N 筆記錄」，點一下展開全部、再點收起；日曆（單日）檢視一律全部展開。
 */
export function dayItemsModule(env: DayItemsEnv): CellModule {
  return {
    id: "day-items", name: "每日內容（事項／任務／筆記）", slot: "info", requires: ["customitems", "notes"],
    render(ctx, el) {
      const s = env.getS();
      const lines = dayLines(s, ctx.data);
      if (!lines.length) return;
      const cell = el.closest(".dcal-cell") as HTMLElement | null;
      const singleDay = !!el.closest(".dcal-mode-day");
      const iso = (ctx.date as Moment).format("YYYY-MM-DD");
      const auto = Math.max(1, Math.floor(((cell?.clientHeight || s.heights.side.month) - RESERVED_PX) / LINE_PX));
      const cap = singleDay ? Infinity : s.dayItems.max > 0 ? s.dayItems.max : auto;
      const expanded = singleDay || env.expanded.has(iso);
      const box = el.createDiv({ cls: "dcal-dlist" });
      const c = resolveColor(s.customItems.color).value;
      const draw = (l: DayLine) => {
        const row = box.createDiv({ cls: `dcal-dline dcal-dline-${l.kind}${l.done ? " is-done" : ""}`, attr: { title: l.entry?.note ? `${l.text}\n${l.entry.note}` : l.text } });
        if (l.kind === "ctask" && l.entry) {
          const e = l.entry;
          const check = row.createSpan({ cls: "dcal-dline-check", text: l.done ? "☑ " : "☐ " });
          check.onclick = (ev) => { ev.stopPropagation(); void env.toggleEntry(e).then(env.refresh); };
          row.createSpan({ text: e.need > 1 ? `${l.text} (${e.done}/${e.need})` : l.text });
        } else if (l.kind === "dtask" && l.file) {
          const file = l.file, line = l.line as number;
          const check = row.createSpan({ cls: "dcal-dline-check", text: l.done ? "☑ " : "☐ " });
          check.onclick = (ev) => { ev.stopPropagation(); void env.toggleLine(file, line).then(env.refresh); };
          row.createSpan({ text: l.text });
        } else if (l.kind === "task") {
          row.createSpan({ text: l.done ? "☑ " : "☐ " });
          row.createSpan({ text: l.text });
        } else {
          row.createSpan({ text: PREFIX[l.kind] + l.text });
        }
        if (c && (l.kind === "item" || l.kind === "ditem")) row.style.color = c;
        if (l.file) row.onclick = (ev) => { ev.stopPropagation(); env.open(l.file as TFile, l.line); };
      };
      if (expanded || lines.length <= cap) {
        lines.forEach(draw);
        if (!singleDay && expanded && lines.length > cap) {
          const less = box.createDiv({ cls: "dcal-dline dcal-dline-more", text: "收起" });
          less.onclick = (ev) => { ev.stopPropagation(); env.expanded.delete(iso); env.refresh(); };
        }
        return;
      }
      lines.slice(0, Math.max(1, cap - 1)).forEach(draw);
      const hidden = lines.length - Math.max(1, cap - 1);
      const more = box.createDiv({ cls: "dcal-dline dcal-dline-more", text: `還有 ${hidden} 筆記錄` });
      more.onclick = (ev) => { ev.stopPropagation(); env.expanded.add(iso); env.refresh(); };
    },
  };
}
