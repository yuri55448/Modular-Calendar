import { UiState } from "../core/settings";

const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** 檔名裡的日期（YYYY-MM-DD、YYYY/MM/DD、YYYY.MM.DD 都可以）→ 統一成 YYYY-MM-DD；沒有就回傳 fallback */
export function fileDate(name: string, fallback = ""): string {
  const m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(name);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : fallback;
}

/** 「名稱時間」：去掉開頭的日期，剩下的（例如 12:30 XXX）就是排序／分組用的名稱，這樣不同日期但內容相同的任務會排在一起 */
export function nameTimeKey(text: string): string {
  return text.trim().replace(/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s*/, "");
}

export interface NoteRow { name: string; date: string; }
/** 下方「日記／筆記」清單排序：名稱 A→Z／Z→A、時間（檔名裡的日期）小到大／大到小；沒有日期的排最後 */
export function sortNoteRows<T extends NoteRow>(rows: T[], mode: UiState["notesSort"]): T[] {
  if (mode === "none") return rows;
  const out = [...rows];
  if (mode === "nameAsc" || mode === "nameDesc") out.sort((a, b) => (mode === "nameAsc" ? 1 : -1) * cmp(a.name, b.name));
  else out.sort((a, b) => {
    if (!a.date || !b.date) return a.date === b.date ? 0 : a.date ? -1 : 1;
    return (mode === "dateAsc" ? 1 : -1) * cmp(a.date, b.date);
  });
  return out;
}

export interface TaskRow { text: string; fileName: string; filePath: string; date: string; custom: boolean; days: number | null; }
/** 下方「任務」清單篩選：文字會比對任務名稱、檔名、路徑、日期；來源可選全部／一般任務／自訂事項/任務 */
export function filterTaskRows<T extends TaskRow>(rows: T[], text: string, source: UiState["taskSource"]): T[] {
  const q = text.trim().toLowerCase();
  return rows.filter((r) => {
    if (source === "custom" && !r.custom) return false;
    if (source === "normal" && r.custom) return false;
    return !q || [r.text, r.fileName, r.filePath, r.date].some((x) => x.toLowerCase().includes(q));
  });
}

/**
 * 下方「任務」清單排序：名稱、時間（檔名裡的日期）、剩餘時間（離到期日還有幾天，沒有日期的排最後）、
 * 名稱時間（去掉開頭日期後的文字，相同的排在一起）；各有 A→Z／小到大 與反向
 */
export function sortTaskRows<T extends TaskRow>(rows: T[], mode: UiState["taskSort"]): T[] {
  if (mode === "none") return rows;
  const dir = mode.endsWith("Desc") ? -1 : 1;
  const out = [...rows];
  const missingLast = (a: boolean, b: boolean) => (a === b ? 0 : a ? 1 : -1);   // a、b 是否「沒有值」；沒有值的永遠排最後
  out.sort((a, b) => {
    switch (mode) {
      case "nameAsc": case "nameDesc": return dir * cmp(a.text, b.text);
      case "dateAsc": case "dateDesc": return missingLast(!a.date, !b.date) || dir * cmp(a.date, b.date);
      case "remainAsc": case "remainDesc": return missingLast(a.days === null, b.days === null) || dir * ((a.days ?? 0) - (b.days ?? 0));
      case "nameTimeAsc": case "nameTimeDesc": return dir * cmp(nameTimeKey(a.text), nameTimeKey(b.text));
    }
    return 0;
  });
  return out;
}

/** 時間軸裡一天的任務依名稱排序 */
export function sortByText<T extends { text: string }>(rows: T[], mode: UiState["timelineTaskSort"]): T[] {
  if (mode === "none") return rows;
  return [...rows].sort((a, b) => (mode === "az" ? 1 : -1) * cmp(a.text, b.text));
}
