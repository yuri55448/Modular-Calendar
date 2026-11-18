import { App, Notice, TFile } from "obsidian";
import type { Moment } from "moment";
import { TaskEntry } from "./query";

const TASK_RE = /^(\s*(?:[-*+]|\d+\.)\s*\[)(.)(\]\s*)([\s\S]*)$/;
const TASK_LINE_RE = /^\s*(?:[-*+]|\d+\.)\s*\[.\]/;
const HEADING_RE = /^#{1,6}\s/;

/** 任務框裡的字元代表的狀態（相容 Tasks 外掛的自訂狀態）：x／X 完成、- 取消都算「不用再做」；空白、/ 進行中則還沒完成 */
export function isTaskDone(statusChar: string): boolean {
  return statusChar === "x" || statusChar === "X" || statusChar === "-";
}

/** 是否安裝並啟用了 Tasks 外掛 */
export function hasTasksPlugin(app: App): boolean {
  return !!(app as any).plugins?.plugins?.["obsidian-tasks-plugin"];
}

/** 勾選／取消勾選：直接改筆記內容（vault.process 為原子操作）。回傳是否成功。
 *  整行含有 Tasks 外掛的日期表情符號（📅 ⏳ 🛫 ➕ ✅）時，勾選會順便補上 ✅ 完成日期、取消勾選會移除，跟 Tasks 外掛行為一致。 */
export async function toggleTask(app: App, t: TaskEntry, today?: Moment): Promise<boolean> {
  let done = false;
  await app.vault.process(t.file, (data) => {
    const lines = data.split("\n");
    const matches = (i: number) => {
      const m = TASK_RE.exec(lines[i] ?? "");
      return !!m && m[4].trim() === t.text;
    };
    // 行號可能因編輯而位移：先試原行號，再用內容找
    let idx = t.line;
    if (!matches(idx)) idx = lines.findIndex((_l, i) => matches(i));
    if (idx < 0) return data;
    const m = TASK_RE.exec(lines[idx]) as RegExpExecArray;
    const completing = !isTaskDone(m[2]);
    let body = m[4];
    const tasksStyle = /[📅⏳🛫➕✅]/u.test(body);
    if (tasksStyle) {
      body = body.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/u, "");
      if (completing && today) body = `${body.trimEnd()} ✅ ${today.format("YYYY-MM-DD")}`;
    }
    lines[idx] = `${m[1]}${completing ? "x" : " "}${m[3]}${body}`;
    done = true;
    return lines.join("\n");
  });
  if (!done) new Notice("找不到這個任務，可能已被修改");
  return done;
}

/** 依行號勾選／取消勾選（不比對文字；整行含有 Tasks 的日期符號時一樣補上／移除 ✅ 完成日期） */
export async function toggleTaskLine(app: App, file: TFile, line: number, today?: Moment): Promise<boolean> {
  let done = false;
  await app.vault.process(file, (data) => {
    const lines = data.split("\n");
    const m = TASK_RE.exec(lines[line] ?? "");
    if (!m) return data;
    const completing = !isTaskDone(m[2]);
    let body = m[4];
    if (/[📅⏳🛫➕✅]/u.test(body)) {
      body = body.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/u, "");
      if (completing && today) body = `${body.trimEnd()} ✅ ${today.format("YYYY-MM-DD")}`;
    }
    lines[line] = `${m[1]}${completing ? "x" : " "}${m[3]}${body}`;
    done = true;
    return lines.join("\n");
  });
  return done;
}

/** 組出要寫進筆記的任務行；tasksStyle 時用 Tasks 外掛的樣式（📅 到期日） */
export function formatTaskLine(text: string, opts: { tasksStyle?: boolean; date?: Moment } = {}): string {
  const base = `- [ ] ${text}`;
  if (opts.tasksStyle && opts.date && !/📅/u.test(text)) return `${base} 📅 ${opts.date.format("YYYY-MM-DD")}`;
  return base;
}

/**
 * 在文字裡的某個標題底下加一行（接在該標題底下現有任務清單的最後一條後面；標題底下還沒有任務就加在標題正下方；
 * 找不到這個標題就在最後補上標題再加）；沒指定標題＝加在最後。回傳新的全文。
 */
export function insertLineUnderHeading(data: string, heading: string, line: string): string {
  const h = heading.trim();
  if (!h) {
    const base = data === "" || data.endsWith("\n") ? data : data + "\n";
    return `${base}${line}\n`;
  }
  const lines = data.split("\n");
  const at = lines.findIndex((l) => l.trim() === h);
  if (at < 0) {
    const base = data === "" || data.endsWith("\n") ? data : data + "\n";
    return `${base}${base === "" ? "" : "\n"}${h}\n${line}\n`;
  }
  let end = lines.length; // 這個標題底下的區段結束位置（下一個標題，或檔尾）
  for (let i = at + 1; i < lines.length; i++) if (HEADING_RE.test(lines[i])) { end = i; break; }
  let insertAt = at + 1;
  for (let i = at + 1; i < end; i++) if (TASK_LINE_RE.test(lines[i])) insertAt = i + 1;
  lines.splice(insertAt, 0, line);
  return lines.join("\n");
}

/**
 * 把任務加進筆記：
 *  - 沒設標題：加在檔案最後
 *  - 有設標題（例如 "## 待辦"）：加在該標題底下現有任務清單的最後一條之後（任務會依序遞增往下加）；
 *    標題底下還沒有任務就加在標題正下方；整份筆記找不到這個標題就在檔案最後補上標題再加任務
 */
export async function appendTask(app: App, file: TFile, text: string, opts: { heading?: string; tasksStyle?: boolean; date?: Moment } = {}) {
  const line = formatTaskLine(text, opts);
  await app.vault.process(file, (data) => insertLineUnderHeading(data, opts.heading ?? "", line));
}

/**
 * 先在某個標題底下（沒標題就檔案最後）插入一個空白行，回傳該行行號；
 * 給「Tasks 面板」用——把游標放在這一行再叫出 Tasks 的建立／編輯指令，新任務就會落在對的位置。
 */
export async function insertBlankTaskLine(app: App, file: TFile, heading: string): Promise<number> {
  let index = 0;
  await app.vault.process(file, (data) => {
    const lines = data.split("\n");
    const h = heading.trim();
    if (!h) {
      if (lines[lines.length - 1] === "") lines.pop();
      index = lines.length;
      lines.push("", "");
      return lines.join("\n");
    }
    let at = lines.findIndex((l) => l.trim() === h);
    if (at < 0) {
      if (lines[lines.length - 1] === "") lines.pop();
      lines.push("", h);
      at = lines.length - 1;
    }
    let end = lines.length;
    for (let i = at + 1; i < lines.length; i++) if (HEADING_RE.test(lines[i])) { end = i; break; }
    let insertAt = at + 1;
    for (let i = at + 1; i < end; i++) if (TASK_LINE_RE.test(lines[i])) insertAt = i + 1;
    lines.splice(insertAt, 0, "");
    index = insertAt;
    return lines.join("\n");
  });
  return index;
}
