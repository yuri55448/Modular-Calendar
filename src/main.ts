import { Notice, Plugin, TFile, WorkspaceLeaf, moment } from "obsidian";
import type { Moment } from "moment";
import { Registry } from "./core/registry";
import { CalendarSettings, ensureModulePlaced, mergeSettings } from "./core/settings";
import { CreateOpts, PeriodKind } from "./core/types";
import { LunarProvider } from "./providers/lunar";
import { HolidayProvider } from "./providers/holiday";
import { NotesProvider } from "./providers/notes";
import { CustomItemsProvider } from "./providers/customitems";
import { DayEntry, doneKey, setOccurrenceDone } from "./notes/custom-items";
import { createBuiltinCells } from "./cells/builtin";
import { MonthView, VIEW_TYPE_MONTH } from "./views/month";
import { CalendarSettingTab } from "./settings-tab";
import { createPeriod, openFile } from "./notes/periodic";
import { appendTask, hasTasksPlugin, insertBlankTaskLine, insertLineUnderHeading, toggleTaskLine } from "./notes/tasks";
import { ItemsView, VIEW_TYPE_ITEMS } from "./views/items";
import { createNoteAt, periodName, resolveTemplate } from "./notes/periodic";
import { filesUnder } from "./notes/custom-entries";
import { TemplatePicker } from "./util/template-picker";
import { initIndex, NoteIndex } from "./notes/index";
import { injectFonts } from "./util/fonts";

/** 新增任務前選的存放位置 */
export interface TaskTarget {
  where: "diary" | "location" | "custom";
  /** location／custom 的路徑 */
  path?: string;
  /** 建立新檔案時套用的模板路徑；"" ＝不用模板；undefined ＝用預設 */
  template?: string;
  /** 加在哪個標題底下；"" ＝加在最後 */
  heading: string;
}

export const STANDARD_CELL_IDS = ["solar-day"];
/** v0.3（尚未有 knownModules 欄位）就已存在的模塊；升級時視為「使用者已經看過」，不會被新版的「新模塊預設關閉」邏輯誤關 */
const LEGACY_V03_MODULES = ["solar-day", "lunar-day", "festival", "solar-term", "holiday-name", "rest-work-badge", "holiday-bg", "note-dot"];

export default class ModularCalendarPlugin extends Plugin {
  /** 月曆格子裡被點開「還有 N 筆記錄」的日期（只在這次開啟期間記住） */
  expandedDays = new Set<string>();

  settings!: CalendarSettings;
  registry = new Registry();
  noteIndex!: NoteIndex;

  async onload() {
    const raw = await this.loadData();
    this.settings = mergeSettings(raw);
    const isFirstRun = !raw;

    this.noteIndex = initIndex(this.app, () => this.settings);

    // Provider
    this.registry.registerProvider(new LunarProvider());
    this.registry.registerProvider(new HolidayProvider(() => this.settings, () => this.saveSettings()));
    this.registry.registerProvider(new NotesProvider(this.app, () => this.settings));
    this.registry.registerProvider(new CustomItemsProvider(this.app, () => this.settings));

    // Cell 模塊
    const cells = createBuiltinCells(() => this.settings, {
      getS: () => this.settings,
      open: (file, line) => { void openFile(this.app, file, { newTab: this.settings.openIn === "tab", line }); },
      toggleEntry: (e) => this.toggleCustomEntry(e),
      toggleLine: (file, line) => this.toggleNoteTask(file, line),
      expanded: this.expandedDays,
      refresh: () => { void this.refreshViews(); },
    });
    cells.forEach((c) => { this.registry.registerCell(c); ensureModulePlaced(this.settings, c.id, c.slot); });

    // 第一次啟動：預設為「標準月曆」（只留公曆日期），其餘全部關閉
    if (isFirstRun) {
      this.settings.disabledModules = cells.map((c) => c.id).filter((id) => !STANDARD_CELL_IDS.includes(id));
    }
    // 把新版新增的模塊，對「已經用過本外掛」的人也視為關閉，避免升級後畫面突然多出東西
    const known = new Set(this.settings.knownModules);
    if (!isFirstRun && !raw.knownModules) LEGACY_V03_MODULES.forEach((id) => known.add(id));
    for (const c of cells) {
      if (!known.has(c.id)) {
        if (!isFirstRun) this.settings.disabledModules.push(c.id);
        known.add(c.id);
      }
    }
    this.settings.knownModules = [...known];
    if (!isFirstRun || this.settings.disabledModules.length) await this.saveSettings();

    // Action 模塊
    this.registry.registerAction({
      id: "select-day", name: "單擊：選取日期", trigger: "click",
      run: (ctx, _e, host) => host.selectDate(ctx.date),
    });
    this.registry.registerAction({
      id: "open-daily", name: "雙擊：開啟／建立日記", trigger: "dblclick",
      run: (ctx, _e, host) => host.openNote("daily", ctx.date, undefined, true),
    });
    this.registry.registerAction({
      id: "cell-menu", name: "右鍵：建立日／週／月／季／年記", trigger: "contextmenu",
      run: (ctx, e, host) => host.openMenu(e, ctx.date),
    });

    this.registerView(VIEW_TYPE_MONTH, (leaf: WorkspaceLeaf) => new MonthView(leaf, this));
    this.registerView(VIEW_TYPE_ITEMS, (leaf) => new ItemsView(leaf, this));
    this.addRibbonIcon("calendar-days", "開啟模塊化月曆", () => this.activateView());
    this.addCommand({ id: "open-calendar", name: "開啟月曆", callback: () => this.activateView() });
    this.addCommand({ id: "open-custom-items-tab", name: "在新分頁開啟「自訂事項/任務」", callback: () => this.openItemsTab() });
    this.addCommand({ id: "open-calendar-new-tab", name: "在新分頁開啟一份月曆", callback: () => this.activateView(true) });
    const cmds: [PeriodKind, string][] = [
      ["daily", "今日日記"], ["weekly", "本週週記"], ["monthly", "本月月記"], ["quarterly", "本季季記"], ["yearly", "今年年記"],
    ];
    for (const [kind, label] of cmds) {
      this.addCommand({ id: `open-${kind}`, name: `開啟／建立${label}`, callback: () => this.openPeriod(kind, moment()) });
    }
    this.addSettingTab(new CalendarSettingTab(this.app, this));
    injectFonts(this.app, this.settings);
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_MONTH);
  }

  async saveSettings() {
    await this.saveData(this.settings);
    injectFonts(this.app, this.settings);
  }

  async refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_MONTH)) {
      if (leaf.view instanceof MonthView) await leaf.view.refreshCalendar();
    }
  }

  /** 讓所有已開啟的月曆直接跳到指定日期（起始年月日「保存應用」後使用） */
  async jumpViewsTo(date: Moment) {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_MONTH)) {
      if (leaf.view instanceof MonthView) await leaf.view.goToDate(date);
    }
  }

  async saveAndRefresh() {
    await this.saveSettings();
    await this.refreshViews();
  }

  /** 勾選一次自訂任務：完成次數 +1（寫進筆記裡那條任務下面的完成記錄）；已經完成（達到需要次數）再點一次就歸零 */
  async toggleCustomEntry(e: DayEntry) {
    const next = e.done >= e.need ? 0 : e.done + 1;
    await setOccurrenceDone(this.app, e.item, e.dateISO, e.time, next);
    // 舊版記在設定裡的完成次數一併清掉，避免跟筆記裡的記錄不一致
    delete this.settings.customItems.done[doneKey(e.id, e.dateISO, e.time)];
    await this.saveSettings();
  }

  /** 勾選／取消勾選筆記裡的某一行任務（月曆格子裡「當日」建立的任務用） */
  async toggleNoteTask(file: TFile, line: number) {
    await toggleTaskLine(this.app, file, line, moment());
    this.noteIndex.markDirty();
  }

  /** 建立自訂事項/任務之後要看得到：打開「每日內容」模塊並勾選「自訂事項/任務」 */
  ensureItemsVisible() {
    this.settings.dayItems.show.items = true;
    this.settings.disabledModules = this.settings.disabledModules.filter((x) => x !== "day-items");
  }

  /** 在新分頁開啟「查看自訂事項/任務」 */
  async openItemsTab() {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_ITEMS, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  /** 點月曆工具列的齒輪圖示，直接開啟 Obsidian 設定並跳到這個外掛的分頁 */
  openSettings() {
    const anyApp = this.app as any;
    try {
      anyApp.setting?.open?.();
      anyApp.setting?.openTabById?.(this.manifest.id);
    } catch (e) {
      console.warn("[dcal] 無法自動開啟設定頁，請手動從 Obsidian 設定 → 社群外掛 找到「模塊化月曆」", e);
    }
  }

  /** newTab=true：Ctrl+P／工具列的「+」用，永遠在新分頁開一份獨立的月曆，不去找現有的那份 */
  async activateView(newTab = false) {
    if (newTab) {
      const leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_MONTH, active: true });
      this.app.workspace.revealLeaf(leaf);
      return;
    }
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_MONTH)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE_MONTH, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  /** 模板變數：日記會帶入農曆／節氣／假日（沒有資料時為空字串，不會留下 {{...}}） */
  private async buildVars(kind: PeriodKind, date: Moment): Promise<Record<string, string>> {
    if (kind !== "daily") return {};
    const vars: Record<string, string> = { lunar: "", solarTerm: "", holiday: "" };
    const lunar = this.registry.providers.get("lunar");
    const hol = this.registry.providers.get("holiday");
    await hol?.load({ start: date, end: date }).catch(() => {});
    const l = lunar?.get(date) as any;
    const h = hol?.get(date) as any;
    if (l) { vars.lunar = l.isFirst ? l.monthText : l.dayText; vars.solarTerm = l.term; }
    if (h) vars.holiday = h.name;
    return vars;
  }

  /** 取得某期間的筆記，不存在就依模板建立（不開啟） */
  async ensurePeriod(kind: PeriodKind, date: Moment, opts: CreateOpts = {}) {
    return createPeriod(this.app, this.settings, kind, date, await this.buildVars(kind, date), opts);
  }

  /** 開啟或建立某期間的筆記。opts.template：undefined=用設定的模板、""=空白、路徑=指定模板 */
  async openPeriod(kind: PeriodKind, date: Moment, newTab?: boolean, opts: CreateOpts = {}) {
    // 沒有特別指定時，看設定「開啟／建立筆記時」（預設在新分頁開啟）
    const openInTab = newTab ?? this.settings.openIn === "tab";
    if (kind === "daily" && this.settings.naming.nameMode === "prompt" && opts.name === undefined && !opts.extra) {
      const { askCreate } = await import("./util/modals");
      const r = await askCreate(this.app, { title: "建立日記", askName: true, placeholder: "日記名稱（可留空）" });
      if (!r) return;
      opts = { ...opts, name: r.name };
    }
    const file = await this.ensurePeriod(kind, date, opts);
    await openFile(this.app, file, { newTab: openInTab });
    await this.refreshViews();
  }

  /** 有沒有安裝 Tasks 外掛 */
  hasTasksPlugin() { return hasTasksPlugin(this.app); }

  /**
   * 設定裡「任務模板」列出的檔案：每一項可以是單一模板檔，也可以是資料夾（資料夾裡所有 .md 都當作模板）。
   * 找不到的路徑自動略過；多個模板時，建立事項/任務日記前會跳出挑選器。
   */
  taskTemplateFiles() {
    const out: import("obsidian").TFile[] = [];
    const seen = new Set<string>();
    const push = (f: import("obsidian").TFile | null) => { if (f && !seen.has(f.path)) { seen.add(f.path); out.push(f); } };
    for (const p of this.settings.taskTemplates) {
      const inFolder = filesUnder(this.app, [p]);
      if (inFolder.length) inFolder.forEach(push); else push(resolveTemplate(this.app, p));
    }
    return out;
  }

  /**
   * 建立（或開啟）某天的事項/任務日記。模板：呼叫端有指定就用指定的；否則看設定的「任務模板」——
   * 只有一個就直接用，有多個且 askWhich 為 true 時跳出挑選器讓使用者選；都沒設就用事項/任務日記自己的模板設定。
   */
  async createTaskDiary(date: Moment, newTab?: boolean, template?: string, askWhich = true) {
    if (template === undefined) {
      const files = this.taskTemplateFiles();
      if (files.length > 1 && askWhich && !this.noteIndex.files("taskDiary", date).length) {
        new TemplatePicker(this.app, files, (f) => { void this.createTaskDiary(date, newTab, f.path, false); }).open();
        return;
      }
      if (files.length >= 1) template = files[0].path;
    }
    await this.openPeriod("taskDiary", date, newTab, template === undefined ? {} : { template });
  }

  /**
   * 新增任務到某一天的筆記：預設是該日的「事項/任務日記」（沒有就先建立），可在設定改成一般日記；
   * 設定了標題（例如「## 待辦」）就加在標題底下現有任務的最後一條之後，任務會依序遞增往下加。
   * tasksStyle=true（且有安裝 Tasks 外掛）時會用 Tasks 樣式附上 📅 到期日。
   */
  async addTask(date: Moment, text: string, opts: { tasksStyle?: boolean; heading?: string } = {}) {
    const s = this.settings;
    const file = await this.resolveTaskFile(date);
    const tasksStyle = (opts.tasksStyle ?? s.taskAdd.tasksStyle) && this.hasTasksPlugin();
    await appendTask(this.app, file, text, { heading: opts.heading ?? s.taskAdd.headings[0] ?? "", tasksStyle, date });
    this.noteIndex.markDirty();
  }

  /**
   * 任務要寫進哪個檔案（沒有就建立）：
   *  diary＝當日的事項/任務日記（或設定裡改成的一般日記）；location＝設定裡挑的位置（檔案，或資料夾＝裡面「日期＋事項/任務日記檔名」那一篇）；
   *  custom＝自訂義的路徑（例如 2026/10 → 2026/10.md）。target.template 是建立新檔案時要套用的模板（"" ＝不用模板）。
   */
  async resolveTaskFile(date: Moment, target?: TaskTarget): Promise<TFile> {
    const s = this.settings;
    const tplPath = target?.template !== undefined ? target.template : undefined;
    const defaultTpl = this.taskTemplateFiles()[0]?.path;
    if (!target || target.where === "diary") {
      const kind = s.taskAdd.target === "taskDiary" ? "taskDiary" : "daily";
      const template = kind === "taskDiary" ? (tplPath ?? defaultTpl) : undefined;
      return this.ensurePeriod(kind, date, template === undefined ? {} : { template });
    }
    const raw = (target.path ?? "").trim();
    const path = target.where === "location" && !raw.toLowerCase().endsWith(".md")
      ? `${raw.replace(/\/+$/, "")}/${periodName("taskDiary", date, s)}.md`
      : raw;
    const tpl = (tplPath === undefined ? defaultTpl : tplPath) ? resolveTemplate(this.app, (tplPath === undefined ? defaultTpl : tplPath) as string) : null;
    return createNoteAt(this.app, s, path, date, tpl);
  }

  /** 把 Tasks 外掛的「Create or edit task」命令執行在某個檔案的某一行（舊版 Tasks 沒有 API 時用）：等編輯器準備好、放好游標再執行 */
  private async runTasksCommandAt(file: TFile, line: number): Promise<boolean> {
    const s = this.settings;
    const anyApp = this.app as any;
    const cmdId = "obsidian-tasks-plugin:edit-task";
    if (!anyApp.commands?.executeCommandById) { new Notice("找不到 Tasks 的「Create or edit task」命令"); return false; }
    const leaf = this.app.workspace.getLeaf(s.openIn === "tab" ? "tab" : false);
    await leaf.openFile(file);
    anyApp.workspace.setActiveLeaf?.(leaf, { focus: true });
    // 檔案剛開啟時編輯器還沒準備好，命令會因為「沒有作用中的編輯器」被忽略——等編輯器出現再執行
    let editor: any = null;
    for (let i = 0; i < 30 && !editor; i++) {
      editor = anyApp.workspace.activeEditor?.editor ?? (leaf.view as any)?.editor ?? null;
      if (!editor) await new Promise((r) => setTimeout(r, 50));
    }
    if (!editor) { new Notice("編輯器還沒準備好，請在已開啟的筆記裡手動執行 Tasks: Create or edit task"); return false; }
    editor.setCursor?.({ line, ch: 0 });
    editor.focus?.();
    anyApp.commands.executeCommandById(cmdId);
    return true;
  }

  /**
   * 「新增任務（Tasks 樣式）」：叫出 Tasks 外掛的「Create or edit task」面板，按下確定後把任務加進指定的檔案（預設是該日的事項/任務日記）、
   * 指定標題底下。優先用 Tasks 外掛提供的 API（apiV1.createTaskLineModal）——它只負責跳出面板並把輸入的任務行交回來，
   * 所以取消的話什麼檔案都不會建立；沒有這個 API 的舊版本才退回「先開檔案、游標放好、再執行命令」。
   */
  async openTasksPanel(date: Moment, heading?: string, target?: TaskTarget) {
    const s = this.settings;
    const anyApp = this.app as any;
    if (!this.hasTasksPlugin()) { new Notice("需要安裝 Tasks 插件"); return; }
    const h = target?.heading ?? heading ?? s.taskAdd.headings[0] ?? "";

    const api = anyApp.plugins?.plugins?.["obsidian-tasks-plugin"]?.apiV1;
    if (typeof api?.createTaskLineModal === "function") {
      const line: string = await api.createTaskLineModal();
      if (!line || !line.trim()) return;                    // 在面板按了取消
      const file = await this.resolveTaskFile(date, target);
      await this.app.vault.process(file, (d) => insertLineUnderHeading(d, h, line.trim().replace(/\n+/g, " ")));
      this.noteIndex.markDirty();
      await this.refreshViews();
      new Notice(`已新增任務到 ${file.basename}`);
      return;
    }

    // 舊版 Tasks：沒有 API，只能在「目前開著的筆記」的游標處執行命令
    const file = await this.resolveTaskFile(date, target);
    const line = await insertBlankTaskLine(this.app, file, h);
    await this.runTasksCommandAt(file, line);
  }

  /**
   * 編輯一個已經存在的任務：叫出 Tasks 外掛的「Create or edit task」面板（API 的 editTaskLineModal），
   * 按確定後把那一行換成編輯後的結果；沒有 API 的舊版本就開啟檔案、游標放在那一行再執行命令。
   */
  async editTaskWithTasks(file: TFile, line: number) {
    if (!this.hasTasksPlugin()) { new Notice("需要安裝 Tasks 插件"); return; }
    const anyApp = this.app as any;
    const lines = (await this.app.vault.read(file)).split("\n");
    const current = lines[line] ?? "";
    if (!/^\s*(?:[-*+]|\d+\.)\s*\[.\]/.test(current)) { new Notice("找不到這個任務，可能已被修改"); return; }
    const api = anyApp.plugins?.plugins?.["obsidian-tasks-plugin"]?.apiV1;
    if (typeof api?.editTaskLineModal === "function") {
      const edited: string = await api.editTaskLineModal(current);
      if (!edited || edited === current) return;            // 取消，或沒有任何修改
      await this.app.vault.process(file, (d) => {
        const ls = d.split("\n");
        const at = ls[line] === current ? line : ls.indexOf(current);
        if (at < 0) return d;
        ls.splice(at, 1, ...edited.split("\n"));
        return ls.join("\n");
      });
      this.noteIndex.markDirty();
      await this.refreshViews();
      return;
    }
    await this.runTasksCommandAt(file, line);
  }
}
