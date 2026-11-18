import { App, TFile } from "obsidian";
import { CalendarSettings } from "../core/settings";
import { RepeatSpec, normalizeSpec } from "../util/repeat";
import { ItemType } from "./custom-items";
import { ensureFileAt, findExisting } from "./vault-util";

/** 自訂事項/任務的表單模板：把表單的設定（類型、重複、時刻、次數、註釋、標題）存起來，之後一鍵套用 */
export interface ItemTemplate {
  name: string;
  type: ItemType;
  note: string;
  /** 長期事項在檔案裡放哪個標題底下 */
  heading: string;
  /** 重複設定；開始日期不存（套用時換成表單目前的日期） */
  repeat: Omit<RepeatSpec, "start">;
}

export const TEMPLATE_FILE = "自訂事項模板.md";
const LINE_RE = /^\s*[-*+]\s+(.+?)\s*%%tpl:(\{.*\})%%\s*$/;

/** 模板檔案的路徑（設定的位置，預設根目錄） */
export function templatePath(s: CalendarSettings): string {
  const dir = s.customItems.templatesFolder.trim().replace(/^\/+|\/+$/g, "");
  return dir ? `${dir}/${TEMPLATE_FILE}` : TEMPLATE_FILE;
}

export function formatTemplateLine(t: ItemTemplate): string {
  const json = JSON.stringify({ v: 1, type: t.type, note: t.note, heading: t.heading, repeat: t.repeat }).replace(/%/g, "\\u0025");
  return `- ${t.name} %%tpl:${json}%%`;
}

export function parseTemplateLine(line: string): ItemTemplate | null {
  const m = LINE_RE.exec(line);
  if (!m) return null;
  try {
    const raw = JSON.parse(m[2]);
    const { start: _start, ...repeat } = normalizeSpec(raw.repeat, "2000-01-01");
    return { name: m[1].trim(), type: raw.type === "item" ? "item" : "task", note: typeof raw.note === "string" ? raw.note : "", heading: typeof raw.heading === "string" ? raw.heading : "", repeat };
  } catch { return null; }
}

/** 從文字解析所有模板（每行一個；也接受 JSON 陣列，方便從別處複製過來） */
export function parseTemplates(text: string): ItemTemplate[] {
  const out: ItemTemplate[] = [];
  const t = text.trim();
  if (t.startsWith("[")) {
    try {
      for (const raw of JSON.parse(t)) {
        const { start: _s, ...repeat } = normalizeSpec(raw?.repeat, "2000-01-01");
        if (typeof raw?.name === "string" && raw.name.trim()) out.push({ name: raw.name.trim(), type: raw.type === "item" ? "item" : "task", note: String(raw.note ?? ""), heading: String(raw.heading ?? ""), repeat });
      }
      return out;
    } catch { /* 不是 JSON，照一般文字處理 */ }
  }
  for (const line of text.split("\n")) { const p = parseTemplateLine(line); if (p) out.push(p); }
  return out;
}

/** 把模板套到表單：開始日期換成表單目前的日期 */
export function applyTemplate(t: ItemTemplate, start: string): { type: ItemType; note: string; heading: string; repeat: RepeatSpec } {
  return { type: t.type, note: t.note, heading: t.heading, repeat: { ...JSON.parse(JSON.stringify(t.repeat)), start } };
}

/** 從目前表單的內容做成模板（不含開始日期） */
export function makeTemplate(name: string, d: { type: ItemType; note: string; heading: string; repeat: RepeatSpec }): ItemTemplate {
  const { start: _start, ...repeat } = JSON.parse(JSON.stringify(d.repeat));
  return { name: name.trim(), type: d.type, note: d.note, heading: d.heading, repeat };
}

async function readAt(app: App, path: string): Promise<string | null> {
  const found = findExisting(app, path);
  const f = found ? (app.vault.getAbstractFileByPath(found) as TFile) : null;
  return f ? await app.vault.read(f) : null;
}

export async function listTemplates(app: App, s: CalendarSettings): Promise<ItemTemplate[]> {
  const text = await readAt(app, templatePath(s));
  return text === null ? [] : parseTemplates(text);
}

async function writeAll(app: App, path: string, list: ItemTemplate[]) {
  const file = await ensureFileAt(app, path);
  await app.vault.modify(file, list.map(formatTemplateLine).join("\n") + (list.length ? "\n" : ""));
}

/** 儲存（同名就覆蓋）；回傳是新增還是覆蓋 */
export async function saveTemplate(app: App, s: CalendarSettings, t: ItemTemplate): Promise<"added" | "updated"> {
  const all = await listTemplates(app, s);
  const i = all.findIndex((x) => x.name === t.name);
  if (i >= 0) all[i] = t; else all.push(t);
  await writeAll(app, templatePath(s), all);
  return i >= 0 ? "updated" : "added";
}

export async function deleteTemplate(app: App, s: CalendarSettings, name: string) {
  const all = (await listTemplates(app, s)).filter((x) => x.name !== name);
  await writeAll(app, templatePath(s), all);
}

/** 導出：把目前所有模板寫到指定的檔案（md，可以分享給別人或備份）；回傳匯出了幾個 */
export async function exportTemplates(app: App, s: CalendarSettings, path: string): Promise<number> {
  const all = await listTemplates(app, s);
  const p = path.trim().toLowerCase().endsWith(".md") ? path.trim() : `${path.trim()}.md`;
  await writeAll(app, p, all);
  return all.length;
}

/** 導入：讀指定檔案裡的模板，同名的更新、新的加入；回傳新增與更新的數量，檔案不存在回傳 null */
export async function importTemplates(app: App, s: CalendarSettings, path: string): Promise<{ added: number; updated: number } | null> {
  const p = path.trim().toLowerCase().endsWith(".md") || path.trim().endsWith(".json") ? path.trim() : `${path.trim()}.md`;
  const text = await readAt(app, p);
  if (text === null) return null;
  const incoming = parseTemplates(text);
  const all = await listTemplates(app, s);
  let added = 0, updated = 0;
  for (const t of incoming) {
    const i = all.findIndex((x) => x.name === t.name);
    if (i >= 0) { all[i] = t; updated++; } else { all.push(t); added++; }
  }
  await writeAll(app, templatePath(s), all);
  return { added, updated };
}
