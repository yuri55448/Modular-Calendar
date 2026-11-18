import { ItemView, Menu, TFile, WorkspaceLeaf, debounce, moment } from "obsidian";
import type { Moment } from "moment";
import type ModularCalendarPlugin from "../main";
import { ActionHost, CreateOpts, FIXED_SLOTS, PERIOD_KINDS, PERIOD_LABEL, PeriodKind, Provider } from "../core/types";
import { ActiveLayout } from "../core/registry";
import { DEFAULT_HEIGHTS, HeightPlace, HeightView, UiState, cellHeightOf, setCellHeight } from "../core/settings";
import { getSeasons, quarterInfo, seasonOf, weekInfo } from "../util/calendar";
import { altDateText } from "../util/altdate";
import { dayBackground } from "../cells/day-badges";
import { dayTooltip } from "../cells/day-tooltip";
import { titleWeekday, weekdayLabels } from "../util/weekday";
import { openFile, periodFiles, periodName, resolveTemplate, templateFiles } from "../notes/periodic";
import { TaskEntry } from "../notes/query";
import { toggleTask } from "../notes/tasks";
import { openPopover } from "../util/popover";
import { segmented } from "../util/ui";
import { NotePickerModal, TemplatePicker } from "../util/template-picker";
import { askCreate } from "../util/modals";
import { CustomItemManagerModal, CustomItemModal } from "../util/custom-item-ui";
import type { CustomItem, DayEntry } from "../notes/custom-items";
import { AddBadgeModal } from "../util/badge-ui";
import { pickTaskTarget } from "../util/task-target-ui";

const MAX_MENU_NOTES = 5;
import { applyStyleVars } from "../util/fonts";
import { resolveColor } from "../util/color";
import { ViewDeps, renderPanel } from "./panel";
import { renderTimeline } from "./timeline";
import { renderWeekStats } from "./week-stats";
import { type NotesProvider, notesFor, taskNotesFor } from "../providers/notes";
import type { HolidayProvider } from "../providers/holiday";

export const VIEW_TYPE_MONTH = "dcal-month-view";

export class MonthView extends ItemView implements ActionHost {
  private selected: Moment = moment().startOf("day");
  private rendering = false;
  private dirty = false;
  private headHost!: HTMLElement;
  private panelHost: HTMLElement | null = null;
  private refreshSoon = debounce(() => this.refreshCalendar(), 400, true);

  constructor(leaf: WorkspaceLeaf, private plugin: ModularCalendarPlugin) { super(leaf); }

  getViewType() { return VIEW_TYPE_MONTH; }
  getDisplayText() { return "模塊化月曆"; }
  getIcon() { return "calendar-days"; }

  async onOpen() {
    this.registerEvent(this.app.vault.on("create", () => { this.plugin.noteIndex.markDirty(); this.refreshSoon(); }));
    this.registerEvent(this.app.vault.on("delete", () => { this.plugin.noteIndex.markDirty(); this.refreshSoon(); }));
    this.registerEvent(this.app.vault.on("rename", () => { this.plugin.noteIndex.markDirty(); this.refreshSoon(); }));
    this.registerEvent(this.app.metadataCache.on("changed", (file: TFile) => { if (this.isTracked(file.path)) this.refreshSoon(); }));
    await this.refreshCalendar();
  }

  /** 外部（例如設定頁按下「保存應用」）要求月曆直接跳到某一天；名稱避開 Obsidian View 的內建方法 */
  async goToDate(date: Moment) {
    this.selected = this.clampToStart(date.clone().startOf("day"));
    await this.refreshCalendar();
  }

  // ───────── ActionHost（給 ActionModule 用；名稱刻意避開 Obsidian View 的內建方法）─────────
  selectDate(date: Moment) {
    const monthChanged = !date.isSame(this.selected, "month");
    this.selected = date.clone().startOf("day");
    if (monthChanged) { void this.refreshCalendar(); return; }
    // 同月：原地更新，避免重建格子（否則雙擊會失效）
    this.contentEl.querySelectorAll(".dcal-cell[data-selected]").forEach((el) => el.removeAttribute("data-selected"));
    this.contentEl
      .querySelector(`.dcal-cell[data-date="${this.selected.format("YYYY-MM-DD")}"]`)
      ?.setAttribute("data-selected", "true");
    this.renderHeader();
    void this.renderPanelArea();
  }
  async openNote(kind: PeriodKind, date: Moment, opts?: CreateOpts, fromDblClick = false) {
    if (fromDblClick && this.plugin.settings.naming.confirmDblClick) {
      const { confirmCreate } = await import("../util/modals");
      const yes = await confirmCreate(this.app, kind, date, this.plugin.settings);
      if (!yes) return;
    }
    await this.plugin.openPeriod(kind, date, this.newTab(), opts);
  }
  openMenu(evt: MouseEvent, date: Moment) {
    this.periodMenu(evt, PERIOD_KINDS.filter((k) => k !== "taskDiary").map((kind) => ({ kind, date })), date);
  }

  // ───────── 內部工具 ─────────
  /** 只有期間筆記資料夾內的檔案變動才需要重繪 */
  private isTracked(path: string) {
    return PERIOD_KINDS.some((k) => {
      const f = this.plugin.settings.periodic[k].folder;
      return !f || path.startsWith(f + "/");
    });
  }

  /** 月曆是不是在主編輯區（新分頁）；年歷、年時間軸、本年只有在這裡才提供 */
  /** 週曆「今日顯示」模式下最左邊那一天；null＝今天 */
  private weekFrom: Moment | null = null;

  private inMain() { return this.leaf.getRoot() === this.app.workspace.rootSplit; }
  /** 開啟／建立筆記要不要開在新分頁（設定「開啟／建立筆記時」，預設新分頁） */
  private newTab() { return this.plugin.settings.openIn === "tab"; }
  /** 實際生效的顯示模式：年歷與年時間軸只在新分頁開啟的月曆提供，側邊欄的月曆自動退回月曆／時間軸 */
  private effectiveMode(): UiState["mode"] {
    const m = this.plugin.settings.ui.mode;
    if (this.inMain()) return m;
    return m === "year" ? "month" : m === "yearTimeline" ? "timeline" : m;
  }

  private viewDeps(): ViewDeps {
    const plugin = this.plugin;
    return {
      app: this.app,
      settings: this.plugin.settings,
      save: () => this.plugin.saveSettings(),
      open: (file: TFile, line?: number) => { void openFile(this.app, file, { newTab: this.newTab(), line }); },
      toggleTask: (t: TaskEntry) => toggleTask(this.app, t, moment()),
      addTask: (date: Moment, text: string, heading?: string) => this.plugin.addTask(date, text, { heading }),
      inMain: this.inMain(),
      get hasTasks() { return plugin.hasTasksPlugin(); },
      editTask: (t: TaskEntry) => this.plugin.editTaskWithTasks(t.file, t.line),
      toggleCustom: (e: DayEntry) => this.plugin.toggleCustomEntry(e),
      editCustom: (c: CustomItem) => new CustomItemModal(this.app, this.plugin, { date: this.selected, item: c, onDone: () => { void this.refreshCalendar(); } }).open(),
      rerender: () => { void this.refreshCalendar(); },
    };
  }

  /**
   * 右鍵選單。已存在 → 開啟；不存在 → 依設定的模板建立（標題會註明模板或空白），
   * 並提供「建立空白」「選擇模板建立…」，日記另有「創建新日記」（可與既有日記並存，需先在設定啟用）。
   */
  /** 右鍵選單裡「任務」那一組：建立／開啟事項/任務日記、以任務模板建立、新增任務（有裝 Tasks 外掛時另有 Tasks 樣式） */
  private taskMenuBlock(date: Moment): { title: string; icon: string; fn: () => void }[] {
    const s = this.plugin.settings;
    const block: { title: string; icon: string; fn: () => void }[] = [];
    const existing = periodFiles(this.app, "taskDiary", date, s)[0];
    if (existing) {
      block.push({ title: `開啟事項/任務日記：${existing.basename}`, icon: "check-square", fn: () => { void openFile(this.app, existing, { newTab: this.newTab() }); } });
    } else {
      block.push({ title: `建立事項/任務日記：${periodName("taskDiary", date, s)}`, icon: "file-plus", fn: () => { void this.plugin.createTaskDiary(date, this.newTab()); } });
      const tpls = this.plugin.taskTemplateFiles();
      if (tpls.length) {
        block.push({
          title: "以任務模板建立事項/任務日記…", icon: "layout-template",
          fn: () => new TemplatePicker(this.app, tpls, (f) => { void this.plugin.createTaskDiary(date, this.newTab(), f.path, false); }).open(),
        });
      }
    }
    const headings = s.taskAdd.headings;
    const choices = headings.length > 1 ? { label: "加到哪個標題底下", options: headings } : undefined;
    const ask = (tasksStyle: boolean) => async () => {
      const r = await askCreate(this.app, { title: `新增任務到 ${date.format("M/D")}`, askName: true, placeholder: "任務內容", okText: "新增", choices });
      if (!r || !r.name) return;
      await this.plugin.addTask(date, r.name, { tasksStyle, heading: r.choice || undefined });
      await this.refreshCalendar();
    };
    block.push({ title: "新增任務…", icon: "plus-circle", fn: () => { void ask(false)(); } });
    // 「新增任務（Tasks 樣式）」＝執行 Tasks 外掛的「Tasks: Create or edit task」命令：先在目標筆記的標題底下留好位置，
    // 再叫出 Tasks 自己的建立／編輯面板；沒裝 Tasks 外掛就顯示需要安裝（不能點）
    if (this.plugin.hasTasksPlugin()) {
      block.push({
        title: "新增任務（Tasks 樣式）…", icon: "calendar-check",
        // 先選存放位置／模板／標題（都可以略過），再叫出 Tasks 的「Create or edit task」面板
        fn: () => { void (async () => {
          const target = await pickTaskTarget(this.app, this.plugin, date);
          if (!target) return;
          await this.plugin.openTasksPanel(date, undefined, target);
          await this.refreshCalendar();
        })(); },
      });
    } else {
      block.push({ title: "新增任務（Tasks 樣式）— 需要安裝 Tasks 插件", icon: "calendar-check", disabled: true } as any);
    }
    // 自訂事項／任務：用表單建立（重複、時刻、次數、結束方式…），長期存在設定指定的位置，或當日寫進事項/任務日記
    block.push({ title: "建立自訂事項/任務…", icon: "repeat", fn: () => { setTimeout(() => new CustomItemModal(this.app, this.plugin, { date, onDone: () => { void this.refreshCalendar(); } }).open(), 0); } });
    block.push({ title: "查看自訂事項/任務…", icon: "list-checks", fn: () => { setTimeout(() => new CustomItemManagerModal(this.app, this.plugin, date, () => { void this.refreshCalendar(); }).open(), 0); } });
    block.push({ title: "新分頁開啟 查看自訂事項/任務", icon: "external-link", fn: () => { void this.plugin.openItemsTab(); } });
    return block;
  }

  private periodMenu(evt: MouseEvent, items: { kind: PeriodKind; date: Moment }[], taskDate?: Moment) {
    evt.preventDefault();
    evt.stopPropagation();
    const s = this.plugin.settings;
    type Entry = { title: string; icon: string; disabled?: boolean; fn?: () => void };
    const go = (kind: PeriodKind, date: Moment, opts?: CreateOpts) => () => { void this.plugin.openPeriod(kind, date, this.newTab(), opts); };

    const blocks: Entry[][] = [];
    for (const it of items) {
      const label = PERIOD_LABEL[it.kind];
      const name = periodName(it.kind, it.date, s);
      const matches = periodFiles(this.app, it.kind, it.date, s);
      const existing = matches[0];
      const block: Entry[] = [];
      if (matches.length === 1) {
        block.push({ title: `開啟${label}：${matches[0].basename}`, icon: "file-text", fn: go(it.kind, it.date) });
      } else if (matches.length > 1 && matches.length <= MAX_MENU_NOTES) {
        for (const f of matches) {
          const ff = f;
          block.push({ title: `開啟：${ff.basename}`, icon: "file-text", fn: () => { void openFile(this.app, ff, { newTab: this.newTab() }); } });
        }
      } else if (matches.length > MAX_MENU_NOTES) {
        block.push({
          title: `開啟${label}…（共 ${matches.length} 篇）`,
          icon: "search",
          fn: () => new NotePickerModal(this.app, matches, (f) => { void openFile(this.app, f, { newTab: this.newTab() }); }).open(),
        });
      }

      if (!existing || (it.kind === "daily" && s.naming.extraEnabled)) {
        const tplPath = s.periodic[it.kind].template.trim();
        const tpl = tplPath ? resolveTemplate(this.app, tplPath) : null;
        const extra = !!existing; // 已有筆記時，這裡走的是「創建新日記」路線
        const baseTitle = extra
          ? `創建新日記（依設定的命名規則）`
          : `建立${label}：${name}${tpl ? `（模板：${tpl.basename}）` : "（空白）"}`;
        block.push({ title: baseTitle, icon: "file-plus", fn: go(it.kind, it.date, extra ? { extra: true } : undefined) });

        if (items.length <= 2 || it.kind === "daily") {
          if (tpl) block.push({ title: `建立空白${label}（不用模板）`, icon: "file", fn: go(it.kind, it.date, { template: "", extra }) });
          else if (tplPath) block.push({ title: `找不到模板：${tplPath}`, icon: "alert-triangle", disabled: true });
          block.push({
            title: `選擇模板建立${label}…`,
            icon: "layout-template",
            fn: () => new TemplatePicker(this.app, templateFiles(this.app), (f) => go(it.kind, it.date, { template: f.path, extra })()).open(),
          });
        }
      }
      if (block.length) blocks.push(block);
    }

    if (taskDate) {
      blocks.push(this.taskMenuBlock(taskDate));
      blocks.push([{ title: "新增自訂徽章…", icon: "tag", fn: () => new AddBadgeModal(this.app, this.plugin, taskDate, () => { void this.refreshCalendar(); }).open() }]);
    }

    const menu = new Menu();
    blocks.forEach((b, i) => {
      if (i > 0 && (b.length > 1 || blocks[i - 1].length > 1)) menu.addSeparator();
      for (const e of b) {
        menu.addItem((mi) => {
          mi.setTitle(e.title).setIcon(e.icon);
          if (e.disabled) mi.setDisabled(true);
          else if (e.fn) mi.onClick(e.fn);
        });
      }
    });
    menu.showAtMouseEvent(evt);
  }

  /** 設定裡「起始年月日」若為自訂義，瀏覽不能比這天更早 */
  private clampToStart(d: Moment): Moment {
    const sd = this.plugin.settings.startDate;
    if (sd.mode !== "custom") return d;
    const min = moment(sd.date, "YYYY-MM-DD");
    return min.isValid() && d.isBefore(min, "month") ? min.clone().startOf("month") : d;
  }

  private shift(n: number, unit: "year" | "month" | "week" | "day") {
    if (unit === "day") { this.selected = this.clampToStart(this.selected.clone().add(n, "days")); void this.refreshCalendar(); return; }
    if (unit === "week") {
      if (this.plugin.settings.weekView.display === "today") {
        // 今日顯示：整個七天視窗往前／往後移，選取日跟著移到視窗最左邊那天
        const from = (this.weekFrom ?? moment().startOf("day")).clone().add(7 * n, "days");
        this.weekFrom = from;
        this.selected = this.clampToStart(from.clone());
      } else {
        this.selected = this.clampToStart(this.selected.clone().add(7 * n, "days"));
      }
      void this.refreshCalendar();
      return;
    }
    this.selected = this.clampToStart(this.selected.clone().add(n, unit));
    void this.refreshCalendar();
  }

  private jump(year?: number, month?: number) {
    const d = this.selected.clone();
    if (year !== undefined) d.year(year);
    if (month !== undefined) d.month(month);
    this.selected = this.clampToStart(d);
    void this.refreshCalendar();
  }

  private openYearPicker(anchor: HTMLElement) {
    let base = this.selected.year() - 4;
    openPopover(anchor, (pop, close) => {
      const draw = () => {
        pop.empty();
        const bar = pop.createDiv({ cls: "dcal-pop-bar" });
        bar.createEl("button", { text: "‹" }).onclick = () => { base -= 12; draw(); };
        bar.createSpan({ text: `${base} – ${base + 11}` });
        bar.createEl("button", { text: "›" }).onclick = () => { base += 12; draw(); };
        const grid = pop.createDiv({ cls: "dcal-pop-grid" });
        for (let y = base; y < base + 12; y++) {
          const b = grid.createEl("button", { text: String(y) });
          if (y === this.selected.year()) b.addClass("is-active");
          b.onclick = () => { close(); this.jump(y); };
        }
        const sd = this.plugin.settings.startDate;
        const minYear = sd.mode === "custom" ? Number(sd.date.slice(0, 4)) || 1 : 1;
        const input = pop.createEl("input", { type: "number", placeholder: "輸入年份，Enter 前往" });
        input.onkeydown = (e) => {
          if (e.key !== "Enter" || e.isComposing) return;
          const y = Number(input.value);
          if (y >= minYear && y <= 9999) { close(); this.jump(y); }
        };
      };
      draw();
    });
  }

  private openMonthPicker(anchor: HTMLElement) {
    openPopover(anchor, (pop, close) => {
      const grid = pop.createDiv({ cls: "dcal-pop-grid" });
      for (let m = 0; m < 12; m++) {
        const b = grid.createEl("button", { text: `${m + 1} 月` });
        if (m === this.selected.month()) b.addClass("is-active");
        b.onclick = () => { close(); this.jump(undefined, m); };
      }
    });
  }

  /** 一年可能有多個同名季節（如南半球「夏季」出現兩次），列出所有符合的季節可切換到 */
  private openSeasonPicker(anchor: HTMLElement) {
    const s = this.plugin.settings;
    const cur = this.selected.month() + 1;
    const all = getSeasons(s);
    // 同名季節可能出現多次（例如南半球「夏季」橫跨兩段），保留第一次出現的定義供跳轉
    const byName = new Map<string, typeof all[number]>();
    for (const d of all) if (!byName.has(d.name)) byName.set(d.name, d);
    openPopover(anchor, (pop, close) => {
      const grid = pop.createDiv({ cls: "dcal-pop-grid dcal-pop-grid-wide" });
      for (const [name, def] of byName) {
        const b = grid.createEl("button", { text: name });
        if (name === seasonOf(cur, s)?.name) b.addClass("is-active");
        b.onclick = () => { close(); this.jump(undefined, def.start - 1); };
      }
    });
  }

  private openQuarterPicker(anchor: HTMLElement) {
    const s = this.plugin.settings;
    openPopover(anchor, (pop, close) => {
      const grid = pop.createDiv({ cls: "dcal-pop-grid" });
      for (let i = 0; i < 4; i++) {
        const startMonth = ((s.quarterStartMonth - 1 + i * 3) % 12) + 1;
        const b = grid.createEl("button", { text: `第${["一", "二", "三", "四"][i]}季度` });
        if (quarterInfo(this.selected, s.quarterStartMonth).index === i + 1) b.addClass("is-active");
        b.onclick = () => { close(); this.jump(undefined, startMonth - 1); };
      }
    });
  }

  // ───────── 繪製 ─────────
  async refreshCalendar() {
    if (this.rendering) { this.dirty = true; return; }
    this.rendering = true;
    try {
      do {
        this.dirty = false;
        try {
          await this.renderAll();
        } catch (e) {
          console.error("[dcal] render failed", e);
          this.showError(e);
        }
      } while (this.dirty);
    } finally {
      this.rendering = false;
    }
  }

  private async renderAll() {
    const s = this.plugin.settings;
    const reg = this.plugin.registry;
    const layout = reg.activeLayout(s);
    const mode = this.effectiveMode();
    // 滑鼠移到日期數字上要列出「當天全部內容」，所以這幾個資料來源不論模塊有沒有開啟都會載入
    const extra = ["notes", "lunar", "holiday", "customitems"];
    let cursor = this.selected.clone().startOf("month");
    let gridStart: Moment;
    if (mode === "day") {
      gridStart = this.selected.clone().startOf("day");
      cursor = gridStart.clone().startOf("month");
    } else if (mode === "week") {
      gridStart = s.weekView.display === "today"
        ? (this.weekFrom ?? moment()).clone().startOf("day")
        : weekInfo(this.selected, s.weekStart).start;
      cursor = gridStart.clone().startOf("month");
    } else {
      const offset = (cursor.day() - s.weekStart + 7) % 7;
      gridStart = cursor.clone().subtract(offset, "days");
    }
    if (mode === "month") {
      await reg.loadProviders(layout, { start: gridStart, end: gridStart.clone().add(41, "days") }, extra);
    } else if (mode === "week") {
      await reg.loadProviders(layout, { start: gridStart, end: gridStart.clone().add(6, "days") }, extra);
    } else if (mode === "day") {
      await reg.loadProviders(layout, { start: gridStart, end: gridStart.clone() }, extra);
    } else if (mode === "year") {
      const y0 = this.selected.clone().startOf("year");
      await reg.loadProviders(layout, { start: y0, end: y0.clone().endOf("year") }, ["notes", "holiday"]);
    }
    const providers = reg.requiredProviders(layout, extra);

    const root = this.contentEl;
    const top = root.scrollTop;
    root.empty();
    root.addClass("dcal-root");
    root.style.setProperty("--dcal-panel-rows", String(s.panelRows || 5));
    root.toggleClass("dcal-panel-auto", s.panelRows === 0 && mode !== "year");   // 0＝一次顯示列數自動：清單吃滿月曆下面剩下的高度
    root.style.setProperty("--dcal-cell-height", `${cellHeightOf(s, this.place(), mode === "day" ? "day" : mode === "week" ? "week" : "month")}px`);
    root.toggleClass("dcal-mode-week", mode === "week");
    root.toggleClass("dcal-mode-day", mode === "day");
    // 這個變數設在長駐的 contentEl 上（不像格子內容每次 render 都會重建），所以切回「跟隨主題」時
    // 一定要明確移除，不然舊的自訂顏色會一直留在 inline style 上
    const selColor = resolveColor(s.selectedColor).value;
    if (selColor) root.style.setProperty("--dcal-selected-color", selColor);
    else root.style.removeProperty("--dcal-selected-color");
    const wkColor = resolveColor(s.weekendColor).value;
    if (wkColor) root.style.setProperty("--dcal-weekend-color", wkColor);
    else root.style.removeProperty("--dcal-weekend-color");
    applyStyleVars(root, s);

    this.headHost = root.createDiv({ cls: "dcal-head" });
    this.renderHeader();

    if (mode === "timeline" || mode === "yearTimeline") {
      this.panelHost = null;
      await renderTimeline(root.createDiv({ cls: "dcal-body" }), this.viewDeps(), this.selected, mode === "yearTimeline" ? "year" : "month");
    } else if (mode === "year") {
      this.renderYearGrid(root);
      if (s.panelEnabled) {
        this.panelHost = root.createDiv({ cls: "dcal-panel-host" });
        void this.renderPanelArea();
      } else {
        this.panelHost = null;
      }
    } else {
      const rows = await this.renderGrid(root, layout, providers, gridStart, cursor, mode === "week" || mode === "day", mode === "day");
      this.renderResizer(root, rows);
      if (s.panelEnabled) {
        this.panelHost = root.createDiv({ cls: "dcal-panel-host" });
        void this.renderPanelArea();
      } else {
        this.panelHost = null;
      }
    }
    root.scrollTop = top;
  }

  /** 年歷：12 個迷你月曆（3×4）。點日期＝選取那天並回到月曆；點月份標題＝跳到那個月；右鍵日期＝跟月曆一樣的選單 */
  private renderYearGrid(parent: HTMLElement) {
    const s = this.plugin.settings;
    const reg = this.plugin.registry;
    const notes = reg.providers.get("notes") as NotesProvider | undefined;
    const hol = reg.providers.get("holiday") as HolidayProvider | undefined;
    const labels = weekdayLabels(s);
    const today = moment();
    const year0 = this.selected.clone().startOf("year");
    const wrap = parent.createDiv({ cls: "dcal-year" });
    const goMonth = (d: Moment) => { this.selected = d.clone(); s.ui.mode = "month"; void this.plugin.saveSettings(); void this.refreshCalendar(); };
    for (let m = 0; m < 12; m++) {
      const first = year0.clone().add(m, "months");
      const box = wrap.createDiv({ cls: "dcal-ymonth" });
      box.createDiv({ cls: "dcal-ymonth-title", text: `${m + 1}月` }).onclick = () => goMonth(first);
      const grid = box.createDiv({ cls: "dcal-ygrid" });
      for (let i = 0; i < 7; i++) {
        const wd = (s.weekStart + i) % 7;
        grid.createDiv({ cls: "dcal-yweekday", text: labels[wd], attr: { "data-weekday": String(wd) } });
      }
      const offset = (first.day() - s.weekStart + 7) % 7;
      for (let i = 0; i < offset; i++) grid.createDiv({ cls: "dcal-yblank" });
      for (let d = 1; d <= first.daysInMonth(); d++) {
        const date = first.clone().add(d - 1, "days");
        const cell = grid.createDiv({ cls: "dcal-ycell", text: String(d), attr: { "data-date": date.format("YYYY-MM-DD"), "data-weekday": String(date.day()) } });
        if (date.isSame(today, "day")) cell.setAttr("data-today", "true");
        if (date.isSame(this.selected, "day")) cell.setAttr("data-selected", "true");
        const h = hol?.get(date);
        // 年歷的底色跟月曆用同一套：休（跟下載的節慶／假日連動）、班、自訂徽章，依各自設定的顏色與底色優先順序
        const win = dayBackground(s.restWorkBadge, h ?? null, date);
        if (win) {
          cell.setAttr("title", win.label);
          if (win.css) cell.style.setProperty("background", win.css);
          else if (win.source === "standard-rest") cell.addClass("is-rest");
          else if (win.source === "standard-work") cell.addClass("is-work");
        }
        const info = notes?.get(date);
        if (info && notesFor(info, s.noteMarks.diary).length) cell.createSpan({ cls: "dcal-ydot" });
        if (info && taskNotesFor(info, s.noteMarks.task).some((i) => i.task.total > i.task.done)) cell.addClass("has-pending");
        cell.onclick = () => goMonth(date);
        cell.oncontextmenu = (e) => this.openMenu(e, date);
      }
    }
  }

  /** 「月曆內容」：勾選每天格子裡要顯示的內容（筆記名稱、任務、自訂事項／任務），可複選；超過最多筆數會顯示「還有 N 筆記錄」 */
  private openContentPicker(anchor: HTMLElement) {
    const s = this.plugin.settings;
    const apply = async () => {
      // 有勾選任何一項就自動開啟「每日內容」模塊，全部取消就關閉
      const any = s.dayItems.show.notes || s.dayItems.show.tasks || s.dayItems.show.items;
      s.disabledModules = s.disabledModules.filter((x) => x !== "day-items");
      if (!any) s.disabledModules.push("day-items");
      await this.plugin.saveAndRefresh();
    };
    openPopover(anchor, (pop, close) => {
      pop.createEl("div", { cls: "dcal-pop-title", text: "月曆內容（可複選）" });
      const box = (label: string, get: () => boolean, set: (v: boolean) => void) => {
        const row = pop.createEl("label", { cls: "dcal-pop-row" });
        const cb = row.createEl("input", { type: "checkbox" }) as HTMLInputElement;
        (cb as any).checked = get();
        row.createSpan({ text: ` ${label}` });
        cb.onchange = () => { set(!!(cb as any).checked); void apply(); };
      };
      box("自訂事項／任務", () => s.dayItems.show.items, (v) => { s.dayItems.show.items = v; });
      box("任務（日記與事項/任務日記裡的）", () => s.dayItems.show.tasks, (v) => { s.dayItems.show.tasks = v; });
      box("筆記名稱", () => s.dayItems.show.notes, (v) => { s.dayItems.show.notes = v; });
      box("已完成的任務也列出", () => s.dayItems.showDone, (v) => { s.dayItems.showDone = v; });
      pop.createEl("div", { cls: "dcal-pop-help", text: "最多顯示幾筆（0＝依格子大小自動）；超過會顯示「還有 N 筆記錄」，點一下展開、再點收起" });
      const max = pop.createEl("input", { type: "text", attr: { placeholder: "0" } }) as HTMLInputElement;
      max.value = String(s.dayItems.max);
      max.onchange = () => { const n = Math.floor(Number(max.value)); if (n >= 0 && n <= 99) { s.dayItems.max = n; void apply(); } };
      void close;
    });
  }

  /** 出錯時把錯誤直接顯示在畫面上，而不是留一片空白 */
  private showError(e: unknown) {
    const root = this.contentEl;
    root.empty();
    root.addClass("dcal-root");
    root.createDiv({ cls: "dcal-error-title", text: "月曆渲染失敗（請把下面這段貼給我）" });
    const err = e as Error;
    root.createEl("pre", { cls: "dcal-error", text: `${err?.name ?? "Error"}: ${err?.message ?? String(e)}\n${err?.stack ?? ""}` });
  }

  private async renderPanelArea() {
    if (this.panelHost) await renderPanel(this.panelHost, this.viewDeps(), this.selected);
  }

  /** 月曆與清單之間的橫線：上下拖曳調整每格高度，雙擊還原 */
  /** 這份月曆放在哪裡：新分頁（main）或側邊欄（side）——格子高度各自獨立記住 */
  private place(): HeightPlace { return this.inMain() ? "main" : "side"; }

  private renderResizer(parent: HTMLElement, rows: number) {
    const s = this.plugin.settings;
    const modeNow = this.effectiveMode();
    const view: HeightView = modeNow === "day" ? "day" : modeNow === "week" ? "week" : "month";   // 月曆、週曆、日曆各自記住自己的格高
    const place = this.place();
    if (!s.panelEnabled) return;
    const handle = parent.createDiv({ cls: "dcal-resizer", attr: { title: "拖曳調整高度（雙擊還原）" } });
    handle.createDiv({ cls: "dcal-resizer-grip" });
    const apply = (h: number) => {
      setCellHeight(s, place, view, h);
      this.contentEl.style.setProperty("--dcal-cell-height", `${cellHeightOf(s, place, view)}px`);
    };
    let dragging = false;
    let startY = 0;
    let startH = 0;
    handle.addEventListener("pointerdown", (e: PointerEvent) => {
      dragging = true;
      startY = e.clientY;
      startH = cellHeightOf(s, place, view);
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener("pointermove", (e: PointerEvent) => {
      if (!dragging) return;
      apply(startH + (e.clientY - startY) / Math.max(rows, 1));
    });
    const end = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      try { handle.releasePointerCapture(e.pointerId); } catch { /* 已釋放 */ }
      void this.plugin.saveSettings();
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("dblclick", () => { apply(DEFAULT_HEIGHTS[view]); void this.plugin.saveSettings(); });
  }

  private navBtn(parent: HTMLElement, text: string, tip: string, fn: () => void) {
    const b = parent.createEl("button", { cls: "dcal-nav", text, attr: { "aria-label": tip } });
    b.onclick = fn;
    return b;
  }

  private renderHeader() {
    const s = this.plugin.settings;
    const sel = this.selected;
    const h = this.headHost;
    h.empty();

    // 第一列：« ‹ 2026年 9月 28日 週一 › »（或國際格式 « ‹ 28 Sep 2026 › »）
    const main = h.createDiv({ cls: "dcal-head-main" });
    this.navBtn(main, "«", "上一年", () => this.shift(-1, "year"));
    const yearly = this.effectiveMode() === "year" || this.effectiveMode() === "yearTimeline";
    const weekly = this.effectiveMode() === "week";
    const daily = this.effectiveMode() === "day";
    const unit = yearly ? "year" : daily ? "day" : weekly ? "week" : "month";
    this.navBtn(main, "‹", yearly ? "上一年" : daily ? "前一天" : weekly ? "上一週" : "上個月", () => this.shift(-1, unit));
    const title = main.createDiv({ cls: "dcal-title" });
    const mkPart = (kind: "y" | "m" | "d", text: string, tip: string) => {
      const span = title.createSpan({ cls: "dcal-title-part", text, attr: { title: tip } });
      if (kind === "y") { span.onclick = () => this.openYearPicker(span); span.oncontextmenu = (e) => this.periodMenu(e, [{ kind: "yearly", date: sel }]); }
      if (kind === "m") { span.onclick = () => this.openMonthPicker(span); span.oncontextmenu = (e) => this.periodMenu(e, [{ kind: "monthly", date: sel }]); }
      if (kind === "d") { span.oncontextmenu = (e) => this.periodMenu(e, [{ kind: "daily", date: sel }, { kind: "weekly", date: sel }], sel); }
      return span;
    };
    if (s.titleFormat === "intl") {
      mkPart("d", String(sel.date()), "右鍵建立日記／週記");
      mkPart("m", sel.format("MMM"), "點擊跳轉月份；右鍵建立月記");
      mkPart("y", String(sel.year()), "點擊跳轉年份；右鍵建立年記");
    } else {
      mkPart("y", `${sel.year()}年`, "點擊跳轉年份；右鍵建立年記");
      mkPart("m", `${sel.month() + 1}月`, "點擊跳轉月份；右鍵建立月記");
      mkPart("d", `${sel.date()}日`, "右鍵建立日記／週記");
    }
    if (s.showTitleWeekday) title.createSpan({ cls: "dcal-title-weekday", text: titleWeekday(s, sel) });
    this.navBtn(main, "›", yearly ? "下一年" : daily ? "後一天" : weekly ? "下一週" : "下個月", () => this.shift(1, unit));
    this.navBtn(main, "»", "下一年", () => this.shift(1, "year"));

    // 工具列：今天 ＋ 月曆／時間軸切換 ＋ 開新分頁
    const tools = h.createDiv({ cls: "dcal-toolbar" });
    this.navBtn(tools, "今天", "回到今天", () => { this.selected = moment().startOf("day"); this.weekFrom = null; void this.refreshCalendar(); });
    segmented<UiState["mode"]>(
      tools,
      [
        { value: "day" as const, label: "日曆" },
        { value: "week" as const, label: "週曆" },
        { value: "month" as const, label: "月曆" },
        ...(this.inMain() ? [{ value: "year" as const, label: "年歷" }] : []),
        { value: "timeline" as const, label: `${sel.month() + 1}月時間軸` },
        ...(this.inMain() ? [{ value: "yearTimeline" as const, label: "年時間軸" }] : []),
      ],
      this.effectiveMode(),
      (v) => { s.ui.mode = v; void this.plugin.saveSettings(); void this.refreshCalendar(); }
    );
    // 圖案按鈕：顯示／隱藏月曆下方的日記／筆記／任務清單（預設顯示）；跟設定裡的「下方清單」開關是同一個值
    const panelBtn = this.navBtn(tools, "▤", "顯示／隱藏月曆下方的日記／筆記／任務", () => {
      s.panelEnabled = !s.panelEnabled;
      void this.plugin.saveSettings();
      void this.refreshCalendar();
    });
    panelBtn.toggleClass("is-active", s.panelEnabled);
    this.navBtn(tools, "+", "在新分頁開啟一份月曆", () => { void this.plugin.activateView(true); });
    // 月曆內容：勾選每天格子裡要顯示哪些內容（可複選）
    const contentBtn = this.navBtn(tools, "☰", "月曆內容：選擇每天格子裡要顯示的內容", () => this.openContentPicker(contentBtn));
    this.navBtn(tools, "⚙", "開啟外掛設定", () => this.plugin.openSettings());

    // 第二列：秋季 第三季度 丙午馬年七月十五（預設關閉，可在設定開啟；點擊可切換季節／季度）
    if (s.showSeasonQuarter || s.showAltDate) {
      const info = h.createDiv({ cls: "dcal-info" });
      if (s.showSeasonQuarter) {
        const q = quarterInfo(sel, s.quarterStartMonth);
        const quarterMenu = (e: MouseEvent) => this.periodMenu(e, [{ kind: "quarterly", date: sel }]);
        const season = seasonOf(sel.month() + 1, s);
        if (season) {
          const c = info.createSpan({ cls: "dcal-chip", text: season.name, attr: { title: "點擊切換季節；右鍵建立季記" } });
          c.onclick = () => this.openSeasonPicker(c);
          c.oncontextmenu = quarterMenu;
        }
        const qc = info.createSpan({ cls: "dcal-chip", text: q.label, attr: { title: "點擊切換季度；右鍵建立季記" } });
        qc.onclick = () => this.openQuarterPicker(qc);
        qc.oncontextmenu = quarterMenu;
      }
      if (s.showAltDate) {
        const txt = altDateText(s, sel);
        if (txt) info.createSpan({ cls: "dcal-lunar-head", text: txt, attr: { title: "另一份年月日" } });
      }
    }
  }

  /** 回傳實際畫出的週數（5 或 6），拖曳調高度時用來換算 */
  private async renderGrid(parent: HTMLElement, layout: ActiveLayout, providers: Provider[], gridStart: Moment, cursor: Moment, weekMode = false, dayMode = false): Promise<number> {
    const s = this.plugin.settings;
    const reg = this.plugin.registry;
    const grid = parent.createDiv({ cls: "dcal-grid" });
    grid.toggleClass("dcal-gridlines", s.gridLines.enabled);
    grid.toggleClass("dcal-day", dayMode);
    if (s.gridLines.enabled) {
      const c = resolveColor(s.gridLines.color).value;
      grid.style.setProperty("--dcal-gridline-color", c || "var(--background-modifier-border)");
      grid.style.setProperty("--dcal-gridline-width", `${s.gridLines.width}px`);
    }
    let rowCount = 0;

    // 表頭：週 ＋ 星期（加底線強調）
    const wdLabels = weekdayLabels(s);
    grid.createDiv({ cls: "dcal-weekday dcal-weekday-wk", text: "週" });
    // 表頭從格子的第一天開始排：月曆／週數顯示的週曆是 weekStart，「今日顯示」的週曆則是今天的星期
    for (let i = 0; i < 7; i++) {
      const wd = (gridStart.day() + i) % 7;
      grid.createDiv({ cls: "dcal-weekday", text: wdLabels[wd], attr: { "data-weekday": String(wd) } });
    }

    const monthEnd = cursor.clone().endOf("month");
    const maxRows = weekMode ? 1 : 6;
    for (let r = 0; r < maxRows; r++) {
      const rowStart = gridStart.clone().add(r * 7, "days");
      if (!weekMode && r > 0 && rowStart.isAfter(monthEnd)) break;
      rowCount++;

      // 週數欄 ＋ 週統計
      const wi = weekInfo(rowStart, s.weekStart);
      const wkCol = grid.createDiv({ cls: "dcal-weekcol" });
      const wk = wkCol.createDiv({ cls: "dcal-weeknum", text: String(wi.week), attr: { title: `第 ${wi.week} 週；右鍵建立週記` } });
      wk.onclick = () => {
        s.ui.scope = "week";
        void this.plugin.saveSettings();
        let pick = rowStart.clone();
        for (let i = 0; i < 7; i++) {
          const dd = rowStart.clone().add(i, "days");
          if (dd.isSame(cursor, "month")) { pick = dd; break; }
        }
        this.selectDate(pick);
        void this.renderPanelArea();
      };
      wk.oncontextmenu = (e) => this.periodMenu(e, [{ kind: "weekly", date: rowStart }]);
      await renderWeekStats(wkCol, this.app, s, rowStart, cursor, weekMode);

      for (let c = 0; c < (dayMode ? 1 : 7); c++) {
        const date = rowStart.clone().add(c, "days");
        const slotEls: Partial<Record<string, HTMLElement>> = {};
        let infoStack: HTMLElement | null = null;
        const cell = grid.createDiv({ cls: "dcal-cell" });
        if (weekMode) cell.createSpan({ cls: "dcal-wk-label", text: wdLabels[date.day()] });
        const ctx = reg.buildContext(date, weekMode ? date : cursor, providers, (name) => {
          const hit = slotEls[name];
          if (hit) return hit;
          const el = cell.createDiv({ cls: `dcal-slot dcal-slot-${name}` });
          slotEls[name] = el;
          return el;
        });
        cell.setAttr("data-date", date.format("YYYY-MM-DD"));
        cell.setAttr("data-weekday", String(date.day()));
        if (ctx.isToday) cell.setAttr("data-today", "true");
        if (ctx.isOutsideMonth) cell.setAttr("data-outside", "true");
        if (date.isSame(this.selected, "day")) cell.setAttr("data-selected", "true");

        for (const slotName of FIXED_SLOTS) {
          for (const mod of layout.fixed[slotName]) {
            if (mod.render(ctx, ctx.slot(slotName)) === true) break;
          }
        }
        // 日期下方資訊區：每一列各自一個容器，列內的模塊由左到右排；整區放在可捲動的容器裡，內容太多時往下捲動
        for (const rowMods of layout.rows) {
          if (!infoStack) infoStack = cell.createDiv({ cls: "dcal-info-stack" });
          const rowEl = infoStack.createDiv({ cls: "dcal-info-row" });
          for (const mod of rowMods) mod.render(ctx, rowEl);
          if (!rowEl.childElementCount) rowEl.remove(); // 這列今天沒有任何內容就不佔位置
        }

        // 滑鼠移到日期數字上：列出當天全部內容（包含放不下、或模塊關閉而沒顯示的）
        ((cell.querySelector(".dcal-solar") as HTMLElement | null) ?? cell).setAttr("title", dayTooltip(s, ctx.data, date));

        for (const trigger of ["click", "dblclick", "contextmenu"] as const) {
          const acts = [...reg.actions.values()].filter((a) => a.trigger === trigger && !s.disabledModules.includes(a.id));
          if (!acts.length) continue;
          cell.addEventListener(trigger, (evt) => {
            evt.preventDefault();
            acts.forEach((a) => a.run(ctx, evt as MouseEvent, this));
          });
        }
      }
    }
    return rowCount;
  }
}
