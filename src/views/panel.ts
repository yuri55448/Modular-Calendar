import { App, Menu, TFile, moment } from "obsidian";
import type { Moment } from "moment";
import { CalendarSettings, UiState } from "../core/settings";
import { PERIOD_LABEL } from "../core/types";
import { TaskEntry, collectByFilter, collectTasks, datesInScope } from "../notes/query";
import { CustomItem, DayEntry, entriesOn, listCustomItems, overdueEntries } from "../notes/custom-items";
import { remainingDays, taskStatuses } from "../util/deadline";
import { resolveColor } from "../util/color";
import { TaskRow, fileDate, filterTaskRows, sortNoteRows, sortTaskRows } from "../util/sorting";
import { segmented } from "../util/ui";

export interface ViewDeps {
  app: App;
  settings: CalendarSettings;
  save: () => Promise<void>;
  open: (file: TFile, line?: number) => void;
  /** 勾選／取消勾選，回傳是否成功 */
  toggleTask: (t: TaskEntry) => Promise<boolean>;
  /** 新增任務到某天的事項/任務日記（沒有就先建立）；heading＝要加到哪個標題底下，沒給就用設定裡的第一個 */
  addTask: (date: Moment, text: string, heading?: string) => Promise<void>;
  rerender: () => void;
  /** 這份月曆是不是在主編輯區（新分頁）；年歷／年時間軸／本年只有在這裡才提供 */
  inMain: boolean;
  /** 有沒有安裝 Tasks 外掛 */
  hasTasks: boolean;
  /** 用 Tasks 外掛的「Create or edit task」面板編輯這個任務 */
  editTask: (t: TaskEntry) => Promise<void>;
  /** 勾選一次自訂事項/任務（完成次數 +1） */
  toggleCustom: (e: DayEntry) => Promise<void>;
  /** 編輯自訂事項／任務（開啟表單） */
  editCustom: (c: CustomItem) => void;
}

/** 任務上按右鍵：編輯任務（叫出 Tasks 外掛的 Create or edit task 面板）、開啟筆記 */
export function taskContextMenu(row: HTMLElement, t: TaskEntry, deps: ViewDeps) {
  row.oncontextmenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const menu = new Menu();
    if (deps.hasTasks) menu.addItem((i) => i.setTitle("編輯任務（Tasks）…").setIcon("pencil").onClick(() => { void deps.editTask(t); }));
    else menu.addItem((i) => i.setTitle("編輯任務（Tasks）— 需要安裝 Tasks 插件").setIcon("pencil").setDisabled(true));
    menu.addItem((i) => i.setTitle("開啟筆記").setIcon("file-text").onClick(() => deps.open(t.file, t.line)));
    menu.showAtMouseEvent(e);
  };
}

/**
 * 任務還沒完成、而且文字裡有日期時，在任務右邊顯示時間狀態（依 Tasks 外掛的日期邏輯）：
 * 例如「今天到期」「12 天後到期」「已逾期 3 天」「5 天後開始」；逾期用另一種顏色。勾選後會被隱藏。
 */
export function renderDeadline(row: HTMLElement, text: string, done: boolean, s: CalendarSettings) {
  const cfg = s.taskDeadline;
  if (!cfg.enabled || done) return;
  const now = moment();
  const list = taskStatuses(text, cfg.formats, { y: now.year(), m: now.month() + 1, d: now.date() }, {
    future: cfg.textFuture, today: cfg.textToday, overdue: cfg.textOverdue,
    startFuture: cfg.textStartFuture, startToday: cfg.textStartToday,
    scheduledFuture: cfg.textScheduledFuture, scheduledToday: cfg.textScheduledToday, scheduledPast: cfg.textScheduledPast,
  });
  for (const st of list) {
    const span = row.createSpan({ cls: `dcal-deadline is-${st.kind}`, text: st.text });
    if (st.overdue) span.addClass("is-overdue");
    const c = resolveColor(st.overdue ? cfg.overdueColor : cfg.color).value;
    if (c) span.style.color = c;
  }
}

/** 讓任務前面的 ☐／☑ 可以點擊切換（原地更新，不必等整體重繪）；勾選後「剩下 N 天」也跟著隱藏 */
export function bindTaskCheck(check: HTMLElement, row: HTMLElement, t: { done: boolean }, toggle: () => Promise<boolean>) {
  check.addClass("dcal-check");
  check.setText(t.done ? "☑" : "☐");
  row.toggleClass("is-done", t.done);
  row.querySelectorAll(".dcal-deadline").forEach((e) => (e as HTMLElement).toggleClass("dcal-hidden", t.done));
  check.onclick = async (e) => {
    e.stopPropagation();
    if (!(await toggle())) return;
    t.done = !t.done;
    check.setText(t.done ? "☑" : "☐");
    row.toggleClass("is-done", t.done);
    row.querySelectorAll(".dcal-deadline").forEach((e) => (e as HTMLElement).toggleClass("dcal-hidden", t.done));
  };
}

/** 新增任務輸入框：Enter 送出、Esc 取消；輸入法選字中的 Enter 不會誤送出。設了多個標題時，旁邊多一個下拉選單選要加到哪個標題底下 */
export function addTaskInput(
  parent: HTMLElement, placeholder: string,
  onSubmit: (text: string, heading?: string) => Promise<void> | void, onCancel?: () => void,
  headings: string[] = []
): HTMLInputElement {
  let select: HTMLSelectElement | null = null;
  if (headings.length > 1) {
    select = parent.createEl("select", { cls: "dcal-addtask-heading" }) as HTMLSelectElement;
    for (const h of headings) select.createEl("option", { text: h, attr: { value: h } });
    select.value = headings[0];
  }
  const input = parent.createEl("input", { cls: "dcal-addtask", type: "text", placeholder });
  input.onkeydown = async (e) => {
    if (e.isComposing) return;
    if (e.key === "Escape") { onCancel?.(); return; }
    if (e.key !== "Enter") return;
    const v = input.value.trim();
    if (!v) return;
    input.value = "";
    await onSubmit(v, select?.value);
  };
  return input;
}

/** 月曆下方清單：當日／本週／本月（新分頁另有本年）的日記、筆記或任務；一次顯示 panelRows 列，超過用滾輪捲動 */
export async function renderPanel(host: HTMLElement, deps: ViewDeps, selected: Moment) {
  const { app, settings: s } = deps;
  if (!s.panelEnabled) { host.empty(); return; }
  const ui = s.ui;
  const scope: UiState["scope"] = ui.scope === "year" && !deps.inMain ? "month" : ui.scope;
  host.empty();
  const panel = host.createDiv({ cls: "dcal-panel" });
  const bar = panel.createDiv({ cls: "dcal-panel-bar" });
  const redraw = () => { void renderPanel(host, deps, selected); };

  const scopes: { value: UiState["scope"]; label: string }[] = [{ value: "day", label: "當日" }, { value: "week", label: "本週" }, { value: "month", label: "本月" }];
  if (deps.inMain) scopes.push({ value: "year", label: "本年" });
  segmented<UiState["scope"]>(bar, scopes, scope, (v) => { ui.scope = v; void deps.save(); redraw(); });
  segmented<UiState["content"]>(
    bar,
    [{ value: "notes", label: "日記" }, { value: "extra", label: "筆記" }, { value: "tasks", label: "任務" }],
    ui.content,
    (v) => { ui.content = v; void deps.save(); redraw(); }
  );

  if (ui.content === "tasks") {
    // 篩選與排序列放在「新增任務」輸入框上面：文字篩選＋來源＋排序
    const fbar = panel.createDiv({ cls: "dcal-task-tools" });
    const ftext = fbar.createEl("input", { cls: "dcal-task-filter", type: "text", attr: { placeholder: "篩選：任務名稱、日期、檔名（例如 2026-10-17、Tasks）…" } }) as HTMLInputElement;
    ftext.value = ui.taskFilter;
    const fsrc = fbar.createEl("select", { attr: { title: "來源" } }) as HTMLSelectElement;
    for (const [v, l] of [["all", "全部任務"], ["normal", "一般任務"], ["custom", "自訂事項/任務"]]) fsrc.createEl("option", { text: l, attr: { value: v } });
    fsrc.value = ui.taskSource;
    const fsort = fbar.createEl("select", { attr: { title: "排序" } }) as HTMLSelectElement;
    for (const [v, l] of [["none", "排序：預設"], ["nameAsc", "名稱 A 到 Z"], ["nameDesc", "名稱 Z 到 A"], ["dateAsc", "時間 小到大"], ["dateDesc", "時間 大到小"],
      ["remainAsc", "剩餘時間 小到大"], ["remainDesc", "剩餘時間 大到小"], ["nameTimeAsc", "名稱時間 A 到 Z"], ["nameTimeDesc", "名稱時間 Z 到 A"]]) fsort.createEl("option", { text: l, attr: { value: v } });
    fsort.value = ui.taskSort;
    fsrc.onchange = () => { ui.taskSource = fsrc.value as UiState["taskSource"]; void deps.save(); redraw(); };
    fsort.onchange = () => { ui.taskSort = fsort.value as UiState["taskSort"]; void deps.save(); redraw(); };
    ftext.onchange = () => { ui.taskFilter = ftext.value; void deps.save(); redraw(); };

    const wrap = panel.createDiv({ cls: "dcal-addtask-row" });
    addTaskInput(
      wrap,
      `＋ 新增任務到 ${selected.format("M/D")} 的${s.taskAdd.target === "taskDiary" ? "事項/任務日記" : "日記"}（Enter 送出）`,
      async (v, heading) => { await deps.addTask(selected, v, heading); deps.rerender(); },
      undefined,
      s.taskAdd.headings
    );
  }

  const list = panel.createDiv({ cls: "dcal-panel-list" });
  const entries = collectByFilter(app, s, selected, scope, ui.content);

  if (ui.content === "notes" || ui.content === "extra") {
    const sortBar = panel.querySelector(".dcal-panel-bar") as HTMLElement;
    const sel = sortBar.createEl("select", { cls: "dcal-panel-sort", attr: { title: "排序" } }) as HTMLSelectElement;
    for (const [v, l] of [["none", "排序：預設"], ["nameAsc", "名稱 A 到 Z"], ["nameDesc", "名稱 Z 到 A"], ["dateAsc", "時間 小到大"], ["dateDesc", "時間 大到小"]]) sel.createEl("option", { text: l, attr: { value: v } });
    sel.value = ui.notesSort;
    sel.onchange = () => { ui.notesSort = sel.value as UiState["notesSort"]; void deps.save(); redraw(); };
    const sorted = sortNoteRows(entries.map((e) => ({ e, name: e.file.basename, date: fileDate(e.file.basename, e.date.format("YYYY-MM-DD")) })), ui.notesSort).map((x) => x.e);
    if (!entries.length) list.createDiv({ cls: "dcal-empty", text: ui.content === "notes" ? "這段期間還沒有日記" : "這段期間沒有讀到額外來源的筆記（請到設定的「額外來源」確認路徑與日期屬性）" });
    for (const e of sorted) {
      const row = list.createDiv({ cls: "dcal-item" });
      row.createSpan({ cls: "dcal-item-tag", text: e.kind === "daily" ? e.date.format("M/D") : PERIOD_LABEL[e.kind] });
      row.createSpan({ cls: "dcal-item-title", text: e.file.basename });
      row.onclick = () => deps.open(e.file);
    }
    return;
  }

  const tasks = await collectTasks(app, entries);
  // 自訂事項/任務（用表單建立、存在「長期」位置的）：範圍內每一天符合重複設定的各列一筆（每個時刻一筆）；
  // 必做類任務過去還沒完成的會一直留著等補做。勾選次數記在設定裡（以「任務＋日期＋時刻」為單位）。
  const items = (await listCustomItems(app, s)).filter((i) => i.type === "task");
  const days = datesInScope(s, selected, scope);
  const inScope = new Set(days.map((d) => d.format("YYYY-MM-DD")));
  const customRows: DayEntry[] = [];
  for (const d of days) customRows.push(...entriesOn(items, d, s.customItems.done));
  const todayM = moment().startOf("day");
  customRows.push(...overdueEntries(items, todayM, s.customItems.done).filter((e) => !inScope.has(e.dateISO)));
  const now = moment();
  const daysLeft = (text: string) => remainingDays(text, s.taskDeadline.formats, { y: now.year(), m: now.month() + 1, d: now.date() });
  const label = (e: DayEntry) => (e.time ? `${e.time} ${e.name}` : e.name);
  type Row = TaskRow & { kind: "task"; t: TaskEntry } | TaskRow & { kind: "custom"; c: DayEntry };
  const rows: Row[] = [
    ...tasks.map((t): Row => ({ kind: "task", t, text: t.text, fileName: t.file.basename, filePath: t.file.path, date: fileDate(t.file.basename, t.date.format("YYYY-MM-DD")), custom: false, days: daysLeft(t.text) })),
    ...customRows.map((c): Row => ({ kind: "custom", c, text: label(c), fileName: c.item.file.basename, filePath: c.item.file.path, date: c.dateISO, custom: true, days: null })),
  ];
  const isDone = (r: Row) => (r.kind === "task" ? r.t.done : r.c.done >= r.c.need);
  // 沒指定排序時：沒完成的在前面（跟原本一樣）
  const base = ui.taskSort === "none" ? [...rows].sort((a, b) => Number(isDone(a)) - Number(isDone(b))) : rows;
  const shownRows = sortTaskRows(filterTaskRows(base, ui.taskFilter, ui.taskSource), ui.taskSort);
  if (!shownRows.length) list.createDiv({ cls: "dcal-empty", text: rows.length ? "沒有符合篩選條件的任務" : "這段期間沒有任務" });
  for (const r of shownRows) {
    if (r.kind === "task") {
      const t = r.t;
      const row = list.createDiv({ cls: "dcal-item" });
      const check = row.createSpan();
      row.createSpan({ cls: "dcal-item-title", text: t.text.replace(/%%.*?%%/g, "").trim() || "(空白任務)" });
      renderDeadline(row, t.text, t.done, s);
      row.createSpan({ cls: "dcal-item-tag", text: t.file.basename });
      bindTaskCheck(check, row, t, () => deps.toggleTask(t));
      row.onclick = () => deps.open(t.file, t.line);
      taskContextMenu(row, t, deps);
    } else {
      const c = r.c;
      const done = c.done >= c.need;
      const row = list.createDiv({ cls: done ? "dcal-item dcal-item-custom is-done" : "dcal-item dcal-item-custom" });
      const check = row.createSpan({ cls: "dcal-check", text: done ? "☑" : "☐" });
      check.onclick = (ev) => { ev.stopPropagation(); void deps.toggleCustom(c).then(redraw); };
      row.createSpan({ cls: "dcal-item-title", text: c.need > 1 ? `${label(c)} (${c.done}/${c.need})` : label(c) });
      row.createSpan({ cls: "dcal-item-tag", text: c.dateISO < todayM.format("YYYY-MM-DD") ? `補做 ${moment(c.dateISO).format("M/D")}` : `自訂事項/任務 ${moment(c.dateISO).format("M/D")}` });
      row.onclick = () => deps.open(c.item.file);
      row.oncontextmenu = (e: MouseEvent) => {
        e.preventDefault(); e.stopPropagation();
        const menu = new Menu();
        menu.addItem((i) => i.setTitle("編輯自訂事項/任務…").setIcon("pencil").onClick(() => deps.editCustom(c.item)));
        menu.addItem((i) => i.setTitle("開啟筆記").setIcon("file-text").onClick(() => deps.open(c.item.file)));
        menu.showAtMouseEvent(e);
      };
    }
  }
}
