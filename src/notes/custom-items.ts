import { App, TFile, moment } from "obsidian";
import type { Moment } from "moment";
import { CalendarSettings } from "../core/settings";
import { RepeatSpec, normalizeSpec, occurrences, occursOn, summarize } from "../util/repeat";
import { filesUnder } from "./custom-entries";
import { ensureFileAt } from "./vault-util";
import { insertLineUnderHeading } from "./tasks";

/** item＝事項（只顯示在月曆上）；task＝任務（可以勾選完成） */
export type ItemType = "item" | "task";

export interface CustomItemData { id: string; name: string; type: ItemType; note: string; repeat: RepeatSpec; }
export interface CustomItem extends CustomItemData {
  file: TFile; line: number;
  /** 在檔案裡位於哪個標題底下 */
  heading: string;
  /** 完成記錄（寫在筆記裡那條事項下面的縮排任務行）：key＝編號|日期|時刻 → 已完成次數 */
  log: Record<string, number>;
}

/** 完成記錄行：縮排的任務行 `  - [x] 2026-11-10 09:00 (2/2)`；[x]＝這一次完成，(1/2)＝已完成次數／需要次數 */
const LOG_RE = /^\s+[-*+]\s*\[(.)\]\s*(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?(?:\s*\((\d+)\/(\d+)\))?\s*$/;

const LINE_RE = /^\s*[-*+]\s*\[.\]\s*(.*?)\s*(?:〔[^〕]*〕)?\s*%%ci:(\{.*\})%%\s*$/;

/** 新的編號（時間＋亂數） */
export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** 一行的格式：`- [ ] 名稱 〔摘要〕 %%ci:{json}%%`——摘要只是給人看的，真正的設定在 json 裡（% 會被轉義，不會弄斷註解） */
export function formatItemLine(d: CustomItemData): string {
  const json = JSON.stringify({ v: 1, id: d.id, type: d.type, note: d.note, repeat: d.repeat }).replace(/%/g, "\\u0025");
  return `- [ ] ${d.name} 〔${summarize(d.repeat)}〕 %%ci:${json}%%`;
}

export function parseItemLine(line: string): CustomItemData | null {
  const m = LINE_RE.exec(line);
  if (!m || !m[1]) return null;
  try {
    const raw = JSON.parse(m[2]);
    if (!raw?.id) return null;
    return { id: String(raw.id), name: m[1], type: raw.type === "task" ? "task" : "item", note: typeof raw.note === "string" ? raw.note : "", repeat: normalizeSpec(raw.repeat, moment().format("YYYY-MM-DD")) };
  } catch { return null; }
}

// ───────── 存放位置 ─────────

/** 長期事項／任務的存放根資料夾（沒設定就用預設） */
export const storageRoot = (s: CalendarSettings) => (s.customItems.storage.root.trim().replace(/^\/+|\/+$/g, "") || "Tasks List");

/** 依設定的存放方式（根資料夾／依年或年月建子資料夾／檔名格式）算出某一天建立的長期事項要放哪個檔案 */
export function storagePath(s: CalendarSettings, date: Moment): string {
  const st = s.customItems.storage;
  const parts = [storageRoot(s)];
  if (st.sub === "year") parts.push(date.format("YYYY"));
  else if (st.sub === "yearMonth") parts.push(date.format("YYYY"), date.format("MM"));
  const name = date.format(st.fileFormat.trim() || "[Tasks List]").replace(/[\\/:*?"<>|]/g, "-");
  return `${parts.join("/")}/${name}.md`;
}

/** 建立時指定的存放位置：md 檔案就直接用；資料夾就用「檔名格式」算出的檔名放進去；空白＝依設定的存放方式 */
export function resolveTarget(s: CalendarSettings, at: Moment, target?: string): string {
  const t = (target ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!t) return storagePath(s, at);
  if (t.toLowerCase().endsWith(".md")) return t;
  const name = at.format(s.customItems.storage.fileFormat.trim() || "[Tasks List]").replace(/[\\/:*?"<>|]/g, "-");
  return `${t}/${name}.md`;
}

/** 自訂的位置不在根資料夾底下時，記到「額外讀取的位置」，這樣之後才讀得到 */
export function registerPath(s: CalendarSettings, filePath: string) {
  const lc = filePath.toLowerCase();
  const roots = [storageRoot(s), ...s.customItems.extraPaths].map((p) => p.replace(/^\/+|\/+$/g, "").toLowerCase());
  if (roots.some((r) => r && (lc === r || lc === `${r}.md` || lc.startsWith(r + "/")))) return;
  s.customItems.extraPaths = [...s.customItems.extraPaths, filePath];
}

// ───────── 讀寫 ─────────

/** 讀出存放根資料夾底下所有長期事項／任務（依檔案路徑、行號排序） */
export async function listCustomItems(app: App, s: CalendarSettings): Promise<CustomItem[]> {
  const out: CustomItem[] = [];
  for (const file of filesUnder(app, [storageRoot(s), ...s.customItems.extraPaths])) {
    const lines = (await app.vault.cachedRead(file)).split("\n");
    let heading = "";
    lines.forEach((l, i) => {
      if (/^#{1,6}\s/.test(l)) heading = l.trim();
      const d = parseItemLine(l);
      if (!d) return;
      const log: Record<string, number> = {};
      for (let j = i + 1; j < lines.length; j++) {
        const m = LOG_RE.exec(lines[j]);
        if (!m) break;
        const need = d.repeat.perDay;
        log[doneKey(d.id, m[2], m[3] ?? null)] = m[4] !== undefined ? Number(m[4]) : m[1].toLowerCase() === "x" ? need : 0;
      }
      out.push({ ...d, file, line: i, heading, log });
    });
  }
  return out;
}

/** 新增一個長期事項／任務（放進依設定算出來的檔案；heading＝檔案裡的哪個標題底下，沒有就自動建立） */
export async function createCustomItem(app: App, s: CalendarSettings, d: Omit<CustomItemData, "id"> & { id?: string }, heading = "", at: Moment = moment(), target?: string): Promise<CustomItem> {
  const data: CustomItemData = { ...d, id: d.id ?? newId() };
  const line = formatItemLine(data);
  // 新檔案直接帶著內容建立（不要「先建空檔再改」，剛建好的檔案立刻修改在真實的 Obsidian 裡有可能失敗）
  const file = await ensureFileAt(app, resolveTarget(s, at, target), insertLineUnderHeading("", heading, line));
  registerPath(s, file.path);
  if (!(await app.vault.read(file)).includes(`"id":"${data.id}"`)) await app.vault.process(file, (t) => insertLineUnderHeading(t, heading, line));
  return { ...data, file, line: -1, heading, log: {} };
}

function locate(lines: string[], id: string): number {
  return lines.findIndex((l) => parseItemLine(l)?.id === id);
}

export async function editCustomItem(app: App, it: CustomItem, next: Omit<CustomItemData, "id">, heading?: string) {
  await app.vault.process(it.file, (t) => {
    const lines = t.split("\n");
    const i = locate(lines, it.id);
    if (i < 0) return t;
    const line = formatItemLine({ ...next, id: it.id });
    if (heading === undefined || heading.trim() === it.heading) { lines[i] = line; return lines.join("\n"); }
    const logBlock = lines.slice(i + 1, i + 1 + logLength(lines, i));
    lines.splice(i, 1 + logBlock.length);
    const moved = insertLineUnderHeading(lines.join("\n"), heading, line);
    if (!logBlock.length) return moved;
    const ml = moved.split("\n"); const at = locate(ml, it.id); ml.splice(at + 1, 0, ...logBlock); return ml.join("\n");
  });
}
/** 搬到另一個位置（md 檔案或資料夾）：從原檔案拿掉、寫進新位置（編號不變） */
export async function relocateCustomItem(app: App, s: CalendarSettings, it: CustomItem, target: string, at: Moment = moment()): Promise<CustomItem> {
  await deleteCustomItem(app, it);
  return createCustomItem(app, s, { id: it.id, name: it.name, type: it.type, note: it.note, repeat: it.repeat }, it.heading, at, target);
}
/** 這條事項下面連續的完成記錄行有幾行 */
function logLength(lines: string[], i: number): number {
  let n = 0;
  while (i + 1 + n < lines.length && LOG_RE.test(lines[i + 1 + n])) n++;
  return n;
}

export async function deleteCustomItem(app: App, it: CustomItem) {
  await app.vault.process(it.file, (t) => { const lines = t.split("\n"); const i = locate(lines, it.id); if (i >= 0) lines.splice(i, 1 + logLength(lines, i)); return lines.join("\n"); });
}
export async function copyCustomItem(app: App, it: CustomItem) {
  await app.vault.process(it.file, (t) => {
    const lines = t.split("\n"); const i = locate(lines, it.id);
    // 插在原本那條「連同它的完成記錄」後面，不然複製出來的會把原本的完成記錄搶走
    if (i >= 0) lines.splice(i + 1 + logLength(lines, i), 0, formatItemLine({ id: newId(), name: it.name, type: it.type, note: it.note, repeat: it.repeat }));
    return lines.join("\n");
  });
}
/** 往上（-1）或往下（+1）移一個位置：跟同一個檔案裡相鄰的事項／任務互換行（真的改動檔案裡的順序） */
export async function moveCustomItem(app: App, it: CustomItem, dir: -1 | 1) {
  await app.vault.process(it.file, (t) => {
    const lines = t.split("\n"); const i = locate(lines, it.id); if (i < 0) return t;
    let j = i + dir;
    while (j >= 0 && j < lines.length && !parseItemLine(lines[j])) j += dir;
    if (j < 0 || j >= lines.length) return t;
    // 事項連同它下面的完成記錄一起搬動
    const a = Math.min(i, j), b = Math.max(i, j);
    const aBlock = lines.slice(a, a + 1 + logLength(lines, a));
    const bBlock = lines.slice(b, b + 1 + logLength(lines, b));
    lines.splice(a, b + bBlock.length - a, ...bBlock, ...lines.slice(a + aBlock.length, b), ...aBlock);
    return lines.join("\n");
  });
}

// ───────── 完成記錄 ─────────

const logKey = (dateISO: string, time: string | null) => (time ? `${dateISO} ${time}` : dateISO);
const logKeyOf = (line: string) => { const m = LOG_RE.exec(line); return m ? logKey(m[2], m[3] ?? null) : null; };

/**
 * 把「某一天（某個時刻）完成了幾次」寫進筆記：在事項下面用縮排的任務行記錄，例如 `  - [x] 2026-11-10 09:00 (2/2)`，
 * 次數歸零就拿掉那一行。只發生一次、不重複的任務，全部時刻都完成時連事項本身的框也一起勾成 [x]（取消就改回 [ ]）。
 */
export async function setOccurrenceDone(app: App, it: CustomItem, dateISO: string, time: string | null, count: number) {
  const need = it.repeat.perDay;
  await app.vault.process(it.file, (t) => {
    const lines = t.split("\n");
    const i = locate(lines, it.id);
    if (i < 0) return t;
    const n = logLength(lines, i);
    const block = lines.slice(i + 1, i + 1 + n);
    const key = logKey(dateISO, time);
    const at = block.findIndex((l) => logKeyOf(l) === key);
    const fresh = count <= 0 ? null : `  - [${count >= need ? "x" : " "}] ${key}${need > 1 ? ` (${count}/${need})` : ""}`;
    if (at >= 0) { if (fresh) block[at] = fresh; else block.splice(at, 1); } else if (fresh) block.push(fresh);
    block.sort((a, b) => (logKeyOf(a) ?? "").localeCompare(logKeyOf(b) ?? ""));
    if (it.repeat.kind === "once") {
      const times = it.repeat.times.length ? it.repeat.times : [null];
      const all = times.every((tm) => { const l = block.find((b) => logKeyOf(b) === logKey(it.repeat.start, tm)); return !!l && /\[[xX]\]/.test(l); });
      lines[i] = lines[i].replace(/^(\s*[-*+]\s*)\[.\]/, `$1[${all ? "x" : " "}]`);
    }
    lines.splice(i + 1, n, ...block);
    return lines.join("\n");
  });
}

// ───────── 某一天的內容 ─────────

export interface DayEntry {
  id: string; name: string; time: string | null; type: ItemType; note: string;
  /** 已完成次數／需要次數（點位次數） */
  done: number; need: number; strategy: "must" | "checkin";
  dateISO: string; item: CustomItem;
}
/** 「當日」建立的事項／任務寫進事項/任務日記時附上的隱藏註解，月曆靠它認出這些行並顯示在當天的格子裡 */
export const DAY_MARK = "%%cd%%";

export const doneKey = (id: string, dateISO: string, time: string | null) => `${id}|${dateISO}|${time ?? ""}`;

/** 某一天要出現的事項／任務（每個時刻一筆） */
export function entriesOn(items: CustomItem[], date: Moment, done: Record<string, number>): DayEntry[] {
  const dateISO = date.format("YYYY-MM-DD");
  const out: DayEntry[] = [];
  for (const it of items) {
    if (!occursOn(it.repeat, date)) continue;
    for (const time of it.repeat.times.length ? it.repeat.times : [null]) {
      out.push({ id: it.id, name: it.name, time, type: it.type, note: it.note, done: it.log[doneKey(it.id, dateISO, time)] ?? done[doneKey(it.id, dateISO, time)] ?? 0, need: it.repeat.perDay, strategy: it.repeat.strategy, dateISO, item: it });
    }
  }
  return out.sort((a, b) => (a.time ?? "").localeCompare(b.time ?? "") || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/** 必做類任務：過去（今天之前、最多往前 lookback 天）還沒完成的，會一直留在清單裡等你補做 */
export function overdueEntries(items: CustomItem[], today: Moment, done: Record<string, number>, lookback = 90): DayEntry[] {
  const out: DayEntry[] = [];
  const from = today.clone().subtract(lookback, "days");
  for (const it of items) {
    if (it.type !== "task" || it.repeat.strategy !== "must") continue;
    for (const iso of occurrences(it.repeat, from.format("YYYY-MM-DD"), today.clone().subtract(1, "days").format("YYYY-MM-DD"), 200)) {
      for (const time of it.repeat.times.length ? it.repeat.times : [null]) {
        const d = it.log[doneKey(it.id, iso, time)] ?? done[doneKey(it.id, iso, time)] ?? 0;
        if (d < it.repeat.perDay) out.push({ id: it.id, name: it.name, time, type: it.type, note: it.note, done: d, need: it.repeat.perDay, strategy: "must", dateISO: iso, item: it });
      }
    }
  }
  return out;
}

/** 「當日」：把任務寫進事項/任務日記，就像一般任務——重複的就寫進每個符合日期的那一篇（從今天起，沒有結束日期最多往後一年，最多 400 筆） */
export async function writeToDiaries(
  plugin: { app: App; settings: CalendarSettings; ensurePeriod: (kind: any, date: Moment, opts: any) => Promise<TFile>; taskTemplateFiles: () => TFile[] },
  d: Omit<CustomItemData, "id">, heading: string
): Promise<{ written: number; capped: boolean }> {
  const today = moment().format("YYYY-MM-DD");
  const horizon = moment().add(1, "years").format("YYYY-MM-DD");
  const dates = d.repeat.kind === "once" ? [d.repeat.start] : occurrences(d.repeat, today, d.repeat.end.mode === "date" && d.repeat.end.date ? d.repeat.end.date : horizon, 401);
  const capped = dates.length > 400;
  const template = plugin.taskTemplateFiles()[0]?.path;
  let written = 0;
  for (const date of dates.slice(0, 400)) {
    const file = await plugin.ensurePeriod("taskDiary", moment(date, "YYYY-MM-DD"), template === undefined ? {} : { template });
    for (const time of d.repeat.times.length ? d.repeat.times : [null]) {
      const label = time ? `${time} ${d.name}` : d.name;
      const line = d.type === "task" ? `- [ ] ${label} 📅 ${date} ${DAY_MARK}` : `- ${label} ${DAY_MARK}`;
      await plugin.app.vault.process(file, (t) => insertLineUnderHeading(t, heading, line));
      written++;
    }
  }
  return { written, capped };
}
