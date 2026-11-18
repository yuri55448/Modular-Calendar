import { ensureFolders, findExisting } from "./vault-util";
import { App, Notice, TFile, moment, normalizePath } from "obsidian";
import type { Moment } from "moment";
import { CalendarSettings } from "../core/settings";
import { CreateOpts, PeriodKind } from "../core/types";
import { quarterInfo, weekInfo } from "../util/calendar";
import { renderFormat, sanitizeName } from "../util/format";
import { pathFormat } from "./keys";
import { noteIndex } from "./index";

export type { CreateOpts };

/** 該期間的第一天 */
export function periodStart(kind: PeriodKind, date: Moment, s: CalendarSettings): Moment {
  switch (kind) {
    case "weekly": return weekInfo(date, s.weekStart).start;
    case "monthly": return date.clone().startOf("month");
    case "quarterly": return quarterInfo(date, s.quarterStartMonth).start;
    case "yearly": return date.clone().startOf("year");
    default: return date.clone().startOf("day");
  }
}

function tokensFor(kind: PeriodKind, date: Moment, s: CalendarSettings): Record<string, string> {
  if (kind === "weekly") {
    const w = weekInfo(date, s.weekStart);
    return { weekYear: String(w.year), week: String(w.week).padStart(2, "0") };
  }
  if (kind === "quarterly") {
    const q = quarterInfo(date, s.quarterStartMonth);
    return { quarter: String(q.index), quarterYear: String(q.start.year()) };
  }
  return {};
}

const cleanSeg = (seg: string) => seg.replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");

/**
 * 依設定算出相對路徑（不含根資料夾與副檔名）。
 * 日記的「時／分／秒」使用建立當下的時間；其餘期間用該期間的第一天。
 */
export function relPath(
  kind: PeriodKind, date: Moment, s: CalendarSettings, o: { name?: string; extra?: boolean } = {}
): string {
  let at = periodStart(kind, date, s);
  if (kind === "daily") {
    const now = moment();
    at = date.clone().set({ hour: now.hour(), minute: now.minute(), second: now.second(), millisecond: now.millisecond() });
  }
  const vars = { ...tokensFor(kind, date, s), name: sanitizeName(o.name ?? "") };
  return renderFormat(pathFormat(kind, s, o.extra), at, vars).split("/").map(cleanSeg).filter(Boolean).join("/");
}

/** 顯示用名稱（檔名部分） */
export function periodName(kind: PeriodKind, date: Moment, s: CalendarSettings, o: { name?: string; extra?: boolean } = {}): string {
  const parts = relPath(kind, date, s, o).split("/");
  return parts[parts.length - 1] ?? "";
}

export function periodPath(kind: PeriodKind, date: Moment, s: CalendarSettings, o: { name?: string; extra?: boolean } = {}): string {
  const root = s.periodic[kind].folder.trim().replace(/^\/+|\/+$/g, "");
  return normalizePath(`${root ? root + "/" : ""}${relPath(kind, date, s, o)}.md`);
}

/** 該期間所有筆記（依建立時間早→晚） */
export function periodFiles(_app: App, kind: PeriodKind, date: Moment, _s: CalendarSettings): TFile[] {
  return noteIndex().files(kind, date);
}
/** 該期間的第一篇筆記 */
export function periodFile(app: App, kind: PeriodKind, date: Moment, s: CalendarSettings): TFile | null {
  return periodFiles(app, kind, date, s)[0] ?? null;
}

/** 模板候選：vault 內所有 .md（含「模板」字樣的排前面） */
export function templateFiles(app: App): TFile[] {
  const rank = (x: TFile) => (/template|模板|範本/i.test(x.path) ? 0 : 1);
  return [...app.vault.getMarkdownFiles()].sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
}

async function ensureFolder(app: App, filePath: string) {
  const dir = filePath.substring(0, filePath.lastIndexOf("/"));
  if (dir) await ensureFolders(app, dir);
}

/** 依路徑找模板：接受 "Templates/Daily"、"Templates/Daily.md"，找不到再退回連結解析（僅檔名也行） */
export function resolveTemplate(app: App, path: string): TFile | null {
  const raw = path.trim();
  if (!raw) return null;
  const withExt = normalizePath(raw.toLowerCase().endsWith(".md") ? raw : raw + ".md");
  const f = app.vault.getAbstractFileByPath(withExt);
  if (f instanceof TFile) return f;
  return app.metadataCache.getFirstLinkpathDest(raw.replace(/\.md$/i, ""), "");
}

async function renderTemplate(
  app: App, s: CalendarSettings, kind: PeriodKind, date: Moment, vars: Record<string, string>, tpl: TFile
): Promise<string> {
  const start = periodStart(kind, date, s);
  const title = vars.name ? `${periodName(kind, date, s)}` : periodName(kind, date, s);
  const all = { ...tokensFor(kind, date, s), ...vars };
  let text = await app.vault.read(tpl);
  text = text.replace(/{{\s*date(?::([^}]+))?\s*}}/g, (_m, fmt?: string) => (fmt ? start.format(fmt.trim()) : start.format("YYYY-MM-DD")));
  text = text.replace(/{{\s*title\s*}}/g, title);
  text = text.replace(/{{\s*(\w+)\s*}}/g, (m, k: string) => all[k] ?? m);
  return text;
}

/** 交給 Templater 處理 <% %> 語法（沒裝 Templater 就提示並原樣保留） */
async function runTemplater(app: App, file: TFile, content: string) {
  if (!content.includes("<%")) return;
  const t = (app as any).plugins?.plugins?.["templater-obsidian"]?.templater;
  if (!t?.overwrite_file_commands) {
    new Notice("模板含有 Templater 語法，但找不到 Templater 外掛，已原樣寫入");
    return;
  }
  try {
    await t.overwrite_file_commands(file);
  } catch (e) {
    console.warn("[dcal] Templater failed", e);
    new Notice("Templater 處理失敗：" + (e as Error).message);
  }
}

/** 在指定路徑建立（或取得已存在的）筆記；有模板就套用模板（{{date}}、{{title}}…，Templater 語法也會處理） */
export async function createNoteAt(app: App, s: CalendarSettings, path: string, date: Moment, tpl: TFile | null): Promise<TFile> {
  const p = normalizePath(path.trim().toLowerCase().endsWith(".md") ? path.trim() : `${path.trim()}.md`);
  const existing = findExisting(app, p);
  const hit = existing ? app.vault.getAbstractFileByPath(existing) : null;
  if (hit instanceof TFile) return hit;
  await ensureFolder(app, p);
  const content = tpl ? await renderTemplate(app, s, "taskDiary", date, {}, tpl) : "";
  const file = await app.vault.create(p, content);
  if (tpl && s.templates.templater) await runTemplater(app, file, content);
  return file;
}

export async function openFile(app: App, file: TFile, opts: { newTab?: boolean; line?: number } = {}) {
  const leaf = app.workspace.getLeaf(opts.newTab ? "tab" : false);
  await leaf.openFile(file, opts.line !== undefined ? { eState: { line: opts.line } } : undefined);
}

function uniquePath(app: App, path: string): string {
  if (!app.vault.getAbstractFileByPath(path)) return path;
  const base = path.replace(/\.md$/i, "");
  for (let n = 2; ; n++) {
    const p = `${base} (${n}).md`;
    if (!app.vault.getAbstractFileByPath(p)) return p;
  }
}

/** 取得該期間的（第一篇）筆記；不存在或 forceNew 時依模板建立（不開啟） */
export async function createPeriod(
  app: App, s: CalendarSettings, kind: PeriodKind, date: Moment,
  vars: Record<string, string>, opts: CreateOpts = {}
): Promise<TFile> {
  // extra：即使當天已有筆記，也視為要另外建立一篇（用來支援「創建新日記」，可與既有日記並存）
  if (!opts.forceNew && !opts.extra) {
    const ex = periodFile(app, kind, date, s);
    if (ex) return ex;
  }
  const tplPath = opts.template === undefined ? s.periodic[kind].template : opts.template;
  const tpl = resolveTemplate(app, tplPath);
  let name = opts.name ?? "";
  if (!name && kind === "daily" && s.naming.nameMode === "template" && tpl) name = tpl.basename;

  const path = uniquePath(app, periodPath(kind, date, s, { name, extra: opts.extra }));
  await ensureFolder(app, path);
  const content = tpl ? await renderTemplate(app, s, kind, date, { ...vars, name }, tpl) : "";
  const file = await app.vault.create(path, content);
  noteIndex().markDirty();
  if (tpl && s.templates.templater) await runTemplater(app, file, content);
  return file;
}
