import { App, Modal, Notice, moment } from "obsidian";
import { renderMiniCalendar } from "./mini-calendar";
import type { Moment } from "moment";
import type ModularCalendarPlugin from "../main";
import { CustomItem, ItemType, copyCustomItem, createCustomItem, deleteCustomItem, editCustomItem, listCustomItems, moveCustomItem, relocateCustomItem, storageRoot, writeToDiaries } from "../notes/custom-items";
import { ItemTemplate, applyTemplate, listTemplates, makeTemplate, saveTemplate } from "../notes/item-templates";
import { askCreate } from "./modals";
import { RepeatKind, RepeatSpec, UNIT_LABEL, defaultSpec, summarize, validateSpec } from "./repeat";

const WD_LABEL = ["一", "二", "三", "四", "五", "六", "日"];

/**
 * 建立／編輯自訂事項／任務（表單）：類型、存放（長期／當日）、重複（不重複／每天／每週／每月／每年／自定義）、策略（必做類／打卡類）、
 * 每 N 個單位、週幾、每月日期（可複選）、月倒數、時刻、點位次數、每 N 個單位的次數（按次／不限）、結束方式（一直重複／截止日期／N 個週期後結束）。
 * 長期＝存在設定指定的位置；當日＝寫進事項/任務日記（重複的就寫進每個符合日期的那一篇）。
 */
export class CustomItemModal extends Modal {
  spec: RepeatSpec;
  type: ItemType = "task";
  /** 存放：long＝長期（存在設定指定的位置）；day＝當日（寫進事項/任務日記）。不能叫 scope——Obsidian 的 Modal 本身就有 scope 屬性 */
  storeScope: "long" | "day" = "long";
  private dyn!: HTMLElement;
  nameInput!: HTMLInputElement; typeSel!: HTMLSelectElement; scopeSel!: HTMLSelectElement; repSel!: HTMLSelectElement;
  noteInput!: HTMLInputElement; headInput!: HTMLInputElement; diaryHead!: HTMLInputElement; errBox!: HTMLElement; okBtn!: HTMLElement;
  pathInput!: HTMLInputElement; pathPick!: HTMLSelectElement; longBox!: HTMLElement; dayBox!: HTMLElement;
  tplSel!: HTMLSelectElement; templates: ItemTemplate[] = [];

  constructor(app: App, private plugin: ModularCalendarPlugin, private o: { date: Moment; item?: CustomItem; onDone?: () => void }) {
    super(app);
    this.spec = o.item ? JSON.parse(JSON.stringify(o.item.repeat)) : defaultSpec(o.date.format("YYYY-MM-DD"));
    if (o.item) this.type = o.item.type;
  }

  /** 是哪一個「重複」選項：不重複／每天／每週／每月／每年；跟這幾個預設不同（例如每 8 個月）就是自定義 */
  preset(): "once" | RepeatKind | "custom" {
    const sp = this.spec;
    if (sp.kind === "once") return "once";
    return sp.every === 1 && (sp.kind !== "month" || (sp.monthDays.length <= 1 && sp.fromEnd.length === 0)) && (sp.kind !== "week" || sp.weekdays.length <= 1) ? sp.kind : "custom";
  }

  onOpen() {
    const s = this.plugin.settings;
    const t = this.o.item;
    const el = this.contentEl;
    el.addClass("dcal-form");
    this.modalEl.addClass("dcal-resizable");
    this.titleEl.setText(t ? "編輯自訂事項/任務" : "建立自訂事項/任務");
    const text = (label: string, value: string, placeholder = "", parent: HTMLElement = el) => {
      parent.createEl("div", { cls: "dcal-form-label", text: label });
      const input = parent.createEl("input", { cls: "dcal-namefield", type: "text", attr: { placeholder } }) as HTMLInputElement;
      input.value = value;
      return input;
    };
    // 模板：套用之前存的設定，或把目前的設定存成模板
    el.createEl("div", { cls: "dcal-form-label", text: "模板" });
    const tplRow = el.createDiv({ cls: "dcal-form-row" });
    this.tplSel = tplRow.createEl("select", { cls: "dcal-namefield" }) as HTMLSelectElement;
    this.tplSel.createEl("option", { text: "（不使用模板）", attr: { value: "" } });
    this.tplSel.onchange = () => { const tpl = this.templates.find((x) => x.name === this.tplSel.value); if (tpl) this.applyTpl(tpl); };
    tplRow.createEl("button", { text: "儲存為模板" }).onclick = () => { void this.saveAsTemplate(); };
    void this.loadTemplates();
    this.nameInput = text("名稱", t?.name ?? "", "例如：繳房租");

    // 類型、存放
    el.createEl("div", { cls: "dcal-form-label", text: "類型" });
    const typeSel = el.createEl("select", { cls: "dcal-namefield" }) as HTMLSelectElement;
    typeSel.createEl("option", { text: "任務（可以勾選完成）", attr: { value: "task" } });
    typeSel.createEl("option", { text: "事項（只顯示在月曆上，不用勾選）", attr: { value: "item" } });
    typeSel.value = this.type;
    typeSel.onchange = () => { this.type = typeSel.value as ItemType; this.renderDynamic(); };
    this.typeSel = typeSel;

    el.createEl("div", { cls: "dcal-form-label", text: "存放" });
    const scopeSel = el.createEl("select", { cls: "dcal-namefield" }) as HTMLSelectElement;
    scopeSel.createEl("option", { text: "長期（存在設定指定的位置，之後可以在「查看自訂事項/任務」管理）", attr: { value: "long" } });
    scopeSel.createEl("option", { text: "當日（寫進事項/任務日記；重複的寫進每個符合日期的那一篇）", attr: { value: "day" } });
    scopeSel.value = this.storeScope;
    if (t) scopeSel.disabled = true;
    scopeSel.onchange = () => { this.storeScope = scopeSel.value as "long" | "day"; this.syncScopeFields(); };
    this.scopeSel = scopeSel;

    el.createEl("div", { cls: "dcal-form-label", text: "重複" });
    const rep = el.createEl("select", { cls: "dcal-namefield" }) as HTMLSelectElement;
    for (const [v, l] of [["once", "不重複"], ["day", "每天"], ["week", "每週"], ["month", "每月"], ["year", "每年"], ["custom", "自定義…"]]) rep.createEl("option", { text: l, attr: { value: v } });
    rep.value = this.preset();
    rep.onchange = () => {
      const v = rep.value;
      if (v === "once") this.spec.kind = "once";
      else if (v === "custom") { if (this.spec.kind === "once") this.spec.kind = "month"; }
      else { this.spec.kind = v as RepeatKind; this.spec.every = 1; }
      this.renderDynamic(v === "custom");
    };
    this.repSel = rep;

    this.dyn = el.createDiv({ cls: "dcal-form-dyn" });
    this.renderDynamic();

    this.noteInput = text("註釋（選填，只是方便之後查看用途）", t?.note ?? "");
    this.longBox = el.createDiv({ cls: "dcal-form-long" });
    this.pathInput = text("儲存位置（md 檔案或資料夾；留空＝依設定的存放方式）", t ? t.file.path : "", "例如 2026/10（資料夾，用檔名格式建檔）或 事項/本月.md", this.longBox);
    this.pathPick = this.longBox.createEl("select", { cls: "dcal-namefield" }) as HTMLSelectElement;
    this.pathPick.createEl("option", { text: "（從已有的位置挑選）", attr: { value: "" } });
    for (const p of [storageRoot(s), ...s.customItems.extraPaths]) this.pathPick.createEl("option", { text: p, attr: { value: p } });
    this.pathPick.onchange = () => { if (this.pathPick.value) this.pathInput.value = this.pathPick.value; };
    this.headInput = text("放在檔案裡的哪個標題底下（選填，例如 # 每週；沒有這個標題會自動建立）", t?.heading ?? "", "# 標題 或 ## 標題", this.longBox);
    this.dayBox = el.createDiv({ cls: "dcal-form-day" });
    this.diaryHead = text("在事項/任務日記的哪個標題底下（當日）", s.taskAdd.headings[0] ?? "", "## 待辦事項", this.dayBox);
    this.syncScopeFields();

    this.errBox = el.createDiv({ cls: "dcal-hint is-warn" });
    const btns = el.createDiv({ cls: "dcal-modal-btns" });
    const ok = btns.createEl("button", { text: t ? "儲存" : "建立", cls: "mod-cta" });
    btns.createEl("button", { text: "取消" }).onclick = () => this.close();
    ok.onclick = () => { void this.submit(); };
    this.okBtn = ok;
  }

  private syncScopeFields() {
    if (!this.longBox) return;
    const long = this.storeScope === "long";
    this.longBox.toggleClass("dcal-hidden", !long);
    this.dayBox.toggleClass("dcal-hidden", long);
  }

  /** 依「重複」「類型」重畫下面會變動的欄位；forceCustom＝使用者剛選了「自定義」，要顯示單位選單 */
  renderDynamic(forceCustom = false) {
    if (!this.dyn) return;
    const sp = this.spec;
    const d = this.dyn;
    d.empty();
    const custom = forceCustom || this.preset() === "custom";
    let sumEl: HTMLElement | null = null;
    const refresh = () => sumEl?.setText(`摘要：${summarize(sp)}`);
    const row = (label: string) => { d.createEl("div", { cls: "dcal-form-label", text: label }); return d.createDiv({ cls: "dcal-form-row" }); };
    const input = (parent: HTMLElement, value: string, onInput: (v: string) => void, attr: Record<string, string> = {}, cls = "") => {
      const i = parent.createEl("input", { cls, type: "text", attr }) as HTMLInputElement;
      i.value = value; i.oninput = () => { onInput(i.value.trim()); refresh(); };
      return i;
    };
    const toggle = (parent: HTMLElement, label: string, on: boolean, flip: () => void) => {
      const b = parent.createEl("button", { cls: on ? "dcal-chipbtn is-on" : "dcal-chipbtn", text: label });
      let state = on;
      b.onclick = () => { flip(); state = !state; b.toggleClass("is-on", state); refresh(); };
      return b;
    };
    const flipIn = (arr: number[], n: number) => { const i = arr.indexOf(n); if (i >= 0) arr.splice(i, 1); else arr.push(n); arr.sort((a, b) => a - b); };

    // 日期欄位：可以直接輸入，也可以點快速按鈕（今天、明天、下週…、‹ › 前後一天）或展開小月曆點選
    const dateField = (parent: HTMLElement, value: string, onChange: (v: string) => void) => {
      const box = parent.createDiv({ cls: "dcal-datefield" });
      const line = box.createDiv({ cls: "dcal-form-row" });
      const field = line.createEl("input", { type: "text", attr: { placeholder: "YYYY-MM-DD" } }) as HTMLInputElement;
      field.value = value;
      const cal = box.createDiv({ cls: "dcal-mc dcal-hidden" });
      let calOpen = false;
      const drawCal = () => renderMiniCalendar(cal, { value: field.value.trim(), onPick: (iso) => set(iso) });
      const set = (v: string) => { field.value = v; onChange(v); refresh(); if (calOpen) drawCal(); };
      field.oninput = () => { onChange(field.value.trim()); refresh(); };
      const base = () => { const m = moment(field.value.trim(), "YYYY-MM-DD", true); return m.isValid() ? m : moment(); };
      const chips = box.createDiv({ cls: "dcal-form-row" });
      const chip = (label: string, title: string, fn: () => any) => { chips.createEl("button", { cls: "dcal-chipbtn", text: label, attr: { title } }).onclick = () => set(fn().format("YYYY-MM-DD")); };
      chip("‹", "前一天", () => base().subtract(1, "days"));
      chip("›", "後一天", () => base().add(1, "days"));
      chip("今天", "今天", () => moment());
      chip("明天", "明天", () => moment().add(1, "days"));
      chip("下週", "7 天後", () => moment().add(7, "days"));
      chip("下個月", "一個月後", () => moment().add(1, "months"));
      chip("月底", "這個月的最後一天", () => base().endOf("month"));
      chips.createEl("button", { cls: "dcal-chipbtn", text: "📅", attr: { title: "用小月曆選" } }).onclick = () => { calOpen = !calOpen; cal.toggleClass("dcal-hidden", !calOpen); if (calOpen) drawCal(); };
      return field;
    };

    // 時刻欄位：常用時間一點就加入／移除，也可以用時間選擇器加入任意時間，或直接輸入（逗號分開）
    const timeField = (parent: HTMLElement) => {
      const box = parent.createDiv({ cls: "dcal-timefield" });
      const field = box.createEl("input", { type: "text", attr: { placeholder: "HH:mm" } }) as HTMLInputElement;
      field.value = sp.times.join(", ");
      const btns: Record<string, HTMLElement> = {};
      const sync = () => { field.value = sp.times.join(", "); for (const [t, b] of Object.entries(btns)) b.toggleClass("is-on", sp.times.includes(t)); };
      field.oninput = () => { sp.times = field.value.split(/[,，\s]+/).filter(Boolean); for (const [t, b] of Object.entries(btns)) b.toggleClass("is-on", sp.times.includes(t)); refresh(); };
      const chips = box.createDiv({ cls: "dcal-form-row" });
      for (const t of ["06:00", "08:00", "09:00", "12:00", "14:00", "18:00", "20:00", "22:00"]) {
        const b = chips.createEl("button", { cls: sp.times.includes(t) ? "dcal-chipbtn is-on" : "dcal-chipbtn", text: t });
        btns[t] = b;
        b.onclick = () => { const i = sp.times.indexOf(t); if (i >= 0) sp.times.splice(i, 1); else sp.times.push(t); sp.times.sort(); sync(); refresh(); };
      }
      const pick = chips.createEl("input", { type: "time" }) as HTMLInputElement;
      chips.createEl("button", { cls: "dcal-chipbtn", text: "加入" }).onclick = () => {
        const v = pick.value;
        if (/^([01]\d|2[0-3]):[0-5]\d$/.test(v) && !sp.times.includes(v)) { sp.times.push(v); sp.times.sort(); sync(); refresh(); }
      };
      chips.createEl("button", { cls: "dcal-chipbtn", text: "清除" }).onclick = () => { sp.times = []; sync(); refresh(); };
      return field;
    };

    if (sp.kind === "once") {
      dateField(row("日期"), sp.start, (v) => { sp.start = v; });
    } else {
      if (this.type === "task") {
        const r = row("策略");
        const must = r.createEl("button", { cls: sp.strategy === "must" ? "dcal-segbtn is-on" : "dcal-segbtn", text: "必做類" });
        const check = r.createEl("button", { cls: sp.strategy === "checkin" ? "dcal-segbtn is-on" : "dcal-segbtn", text: "打卡類" });
        must.onclick = () => { sp.strategy = "must"; must.addClass("is-on"); check.removeClass("is-on"); refresh(); };
        check.onclick = () => { sp.strategy = "checkin"; check.addClass("is-on"); must.removeClass("is-on"); refresh(); };
        d.createEl("div", { cls: "dcal-form-help", text: "必做類：錯過後不會自動跳過，會一直留在清單裡等你補做；打卡類：錯過就略過。" });
      }
      const ev = row("每");
      input(ev, String(sp.every), (v) => { sp.every = Number(v) || 1; }, { type: "number", min: "1" }, "dcal-narrow");
      if (custom) {
        const unit = ev.createEl("select") as HTMLSelectElement;
        for (const k of ["day", "week", "month", "year"] as const) unit.createEl("option", { text: UNIT_LABEL[k], attr: { value: k } });
        unit.value = sp.kind;
        unit.onchange = () => { sp.kind = unit.value as RepeatKind; this.renderDynamic(true); };
      } else ev.createSpan({ text: UNIT_LABEL[sp.kind as Exclude<RepeatKind, "once">] });
      if (sp.kind === "week") {
        const w = row("週幾");
        WD_LABEL.forEach((l, i) => toggle(w, l, sp.weekdays.includes(i + 1), () => flipIn(sp.weekdays, i + 1)));
      }
      if (sp.kind === "month") {
        const md = row("每月日期");
        md.addClass("dcal-daygrid");
        for (let n = 1; n <= 31; n++) toggle(md, String(n), sp.monthDays.includes(n), () => flipIn(sp.monthDays, n));
        const fe = row("月倒數（倒數第幾天）");
        for (let n = 1; n <= 7; n++) toggle(fe, n === 1 ? "最後一天" : `倒數 ${n}`, sp.fromEnd.includes(n), () => flipIn(sp.fromEnd, n));
      }
      dateField(row("開始日期"), sp.start, (v) => { sp.start = v; });
    }
    timeField(row("時刻（選填，可以多個；點常用時間、用時間選擇器加入，或直接輸入，用逗號分開）"));
    const pd = row("點位次數（每個時刻要完成幾次）");
    input(pd, String(sp.perDay), (v) => { sp.perDay = Number(v) || 1; }, { type: "number", min: "1" }, "dcal-narrow");
    if (sp.kind !== "once") {
      const pc = row(`每 ${sp.every} ${UNIT_LABEL[sp.kind as Exclude<RepeatKind, "once">]} 的次數`);
      const count = pc.createEl("button", { cls: sp.period.mode === "count" ? "dcal-segbtn is-on" : "dcal-segbtn", text: "按次" });
      const unl = pc.createEl("button", { cls: sp.period.mode === "unlimited" ? "dcal-segbtn is-on" : "dcal-segbtn", text: "不限" });
      input(pc, String(sp.period.n), (v) => { sp.period.n = Number(v) || 1; }, { type: "number", min: "1" }, "dcal-narrow");
      count.onclick = () => { sp.period.mode = "count"; count.addClass("is-on"); unl.removeClass("is-on"); refresh(); };
      unl.onclick = () => { sp.period.mode = "unlimited"; unl.addClass("is-on"); count.removeClass("is-on"); refresh(); };
      const en = row("結束方式");
      const mode = en.createEl("select") as HTMLSelectElement;
      for (const [v, l] of [["forever", "一直重複"], ["date", "截止日期"], ["cycles", "N 個週期後結束"]]) mode.createEl("option", { text: l, attr: { value: v } });
      mode.value = sp.end.mode;
      mode.onchange = () => {
        const v = mode.value as RepeatSpec["end"]["mode"];
        sp.end = v === "forever" ? { mode: "forever" } : v === "date" ? { mode: "date", date: sp.end.date ?? sp.start } : { mode: "cycles", cycles: sp.end.cycles ?? 1 };
        this.renderDynamic(custom);
      };
      if (sp.end.mode === "date") dateField(en, sp.end.date ?? "", (v) => { sp.end = { mode: "date", date: v }; });
      if (sp.end.mode === "cycles") input(en, String(sp.end.cycles ?? 1), (v) => { sp.end = { mode: "cycles", cycles: Number(v) || 1 }; }, { type: "number", min: "1" }, "dcal-narrow");
    }
    sumEl = d.createEl("div", { cls: "dcal-form-summary", text: `摘要：${summarize(sp)}` });
  }

  private async loadTemplates() {
    this.templates = await listTemplates(this.app, this.plugin.settings);
    for (const tpl of this.templates) this.tplSel.createEl("option", { text: tpl.name, attr: { value: tpl.name } });
  }

  /** 把模板的內容填進表單（開始日期維持表單目前的日期） */
  applyTpl(tpl: ItemTemplate) {
    const d = applyTemplate(tpl, this.spec.start);
    this.type = d.type; this.typeSel.value = d.type;
    this.spec = d.repeat;
    this.repSel.value = this.preset();
    this.noteInput.value = d.note;
    this.headInput.value = d.heading;
    this.renderDynamic();
  }

  /** 把目前表單的設定存成模板（同名覆蓋） */
  async saveAsTemplate() {
    const r = await askCreate(this.app, { title: "儲存為模板", askName: true, placeholder: "模板名稱", okText: "儲存" });
    if (!r || !r.name) return;
    const tpl = makeTemplate(r.name, { type: this.type, note: this.noteInput.value.trim(), heading: this.headInput.value.trim(), repeat: this.spec });
    const res = await saveTemplate(this.app, this.plugin.settings, tpl);
    if (res === "added") { this.templates.push(tpl); this.tplSel.createEl("option", { text: tpl.name, attr: { value: tpl.name } }); }
    else this.templates = this.templates.map((x) => (x.name === tpl.name ? tpl : x));
    this.tplSel.value = tpl.name;
    new Notice(`已${res === "added" ? "儲存" : "更新"}模板「${tpl.name}」`);
  }

  private busy = false;

  async submit(): Promise<boolean> {
    if (this.busy) return false;      // 已經在儲存了，避免連點造成重複建立
    const s = this.plugin.settings;
    const t = this.o.item;
    const n = this.nameInput.value.trim();
    if (!n) { this.errBox.setText("請輸入名稱"); return false; }
    const err = validateSpec(this.spec);
    if (err) { this.errBox.setText(`⚠ ${err}`); return false; }
    this.errBox.setText("");
    const data = { name: n, type: this.type, note: this.noteInput.value.trim(), repeat: this.spec };
    this.busy = true;
    try {
      let extra = "";
      if (t) {
        await editCustomItem(this.app, t, data, this.headInput.value.trim());
        const target = this.pathInput.value.trim();
        if (target && target.toLowerCase() !== t.file.path.toLowerCase()) await relocateCustomItem(this.app, s, { ...t, ...data }, target, this.o.date);
      }
      else if (this.storeScope === "long") await createCustomItem(this.app, s, data, this.headInput.value.trim(), this.o.date, this.pathInput.value.trim());
      else {
        const r = await writeToDiaries(this.plugin as any, data, this.diaryHead.value.trim());
        extra = `，已寫進 ${r.written} 筆事項/任務日記${r.capped ? "（日期太多，只寫了前 400 天）" : ""}`;
      }
      this.plugin.ensureItemsVisible();        // 建立之後要看得到：自動打開「每日內容」並勾選自訂事項/任務
      await this.plugin.saveSettings();
      new Notice(`${t ? "已儲存" : "已建立"}自訂${this.type === "task" ? "任務" : "事項"}${extra}`);
      this.close();                            // 寫入成功就先關掉視窗，月曆重新整理的錯誤不該卡住它
      try { await this.plugin.refreshViews(); } catch { /* 月曆之後會自己重新整理 */ }
      this.o.onDone?.();
      return true;
    } catch (e) {
      const msg = `儲存失敗：${(e as Error).message}`;
      this.errBox.setText(msg);
      new Notice(msg);                         // 表單很長時錯誤訊息可能在畫面外，另外用通知顯示
      return false;
    } finally { this.busy = false; }
  }
}

type SortMode = "file" | "nameAsc" | "nameDesc" | "typeFirst" | "pathAsc" | "pathDesc";
type FilterField = "all" | "name" | "note" | "type" | "fileName" | "path" | "repeat";

/** 篩選與排序（純函式，方便測試） */
export function filterSortItems(items: CustomItem[], o: { text: string; field: FilterField; sort: SortMode }): CustomItem[] {
  const q = o.text.trim().toLowerCase();
  const typeName = (i: CustomItem) => (i.type === "task" ? "任務" : "事項");
  const pick = (i: CustomItem): string[] => ({
    all: [i.name, i.note, typeName(i), i.file.name, i.file.path, summarize(i.repeat), i.heading], name: [i.name], note: [i.note], type: [typeName(i)],
    fileName: [i.file.name], path: [i.file.path], repeat: [summarize(i.repeat)],
  }[o.field]);
  const out = q ? items.filter((i) => pick(i).some((x) => x.toLowerCase().includes(q))) : [...items];
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  if (o.sort === "nameAsc") out.sort((a, b) => cmp(a.name, b.name));
  else if (o.sort === "nameDesc") out.sort((a, b) => cmp(b.name, a.name));
  else if (o.sort === "typeFirst") out.sort((a, b) => cmp(typeName(a), typeName(b)) || cmp(a.name, b.name));
  else if (o.sort === "pathAsc") out.sort((a, b) => cmp(a.file.path, b.file.path));
  else if (o.sort === "pathDesc") out.sort((a, b) => cmp(b.file.path, a.file.path));
  return out;
}

/**
 * 查看自訂事項/任務：列出全部長期事項／任務，可篩選、排序、編輯、複製、刪除、上下移動（檔案順序、沒篩選時）。
 * 不綁定視窗——跳出視窗（CustomItemManagerModal）與新分頁（ItemsView）共用同一份。
 */
export class CustomItemManager {
  private filterText = "";
  private filterField: FilterField = "all";
  private sort: SortMode = "file";
  private host!: HTMLElement;
  constructor(private app: App, private plugin: ModularCalendarPlugin, private date: Moment, private onDone?: () => void) {}

  async render(host: HTMLElement = this.host) {
    this.host = host;
    const el = host;
    el.empty();
    const items = await listCustomItems(this.app, this.plugin.settings);
    const bar = el.createDiv({ cls: "dcal-cat-bar" });
    const fsel = bar.createEl("select") as HTMLSelectElement;
    for (const [v, l] of [["all", "篩選：全部欄位"], ["name", "名稱"], ["note", "註釋"], ["type", "類型"], ["fileName", "文件名"], ["path", "文件路徑"], ["repeat", "重複"]]) fsel.createEl("option", { text: l, attr: { value: v } });
    fsel.value = this.filterField;
    const input = bar.createEl("input", { type: "text", attr: { placeholder: "輸入關鍵字篩選…" } }) as HTMLInputElement;
    input.value = this.filterText;
    const ssel = bar.createEl("select") as HTMLSelectElement;
    for (const [v, l] of [["file", "排序：檔案順序"], ["nameAsc", "名稱 A 到 Z"], ["nameDesc", "名稱 Z 到 A"], ["typeFirst", "類型（任務、事項）"], ["pathAsc", "路徑 A 到 Z"], ["pathDesc", "路徑 Z 到 A"]]) ssel.createEl("option", { text: l, attr: { value: v } });
    ssel.value = this.sort;
    bar.createEl("button", { text: "新增", cls: "mod-cta" }).onclick = () => new CustomItemModal(this.app, this.plugin, { date: this.date, onDone: () => { void this.after(); } }).open();
    bar.createEl("button", { text: "重新整理" }).onclick = () => { void this.render(); };
    const list = el.createDiv({ cls: "dcal-ct-list" });
    const draw = () => this.drawRows(list, items);
    fsel.onchange = () => { this.filterField = fsel.value as FilterField; draw(); };
    input.oninput = () => { this.filterText = input.value; draw(); };
    ssel.onchange = () => { this.sort = ssel.value as SortMode; draw(); };
    draw();
  }

  private async after() { this.onDone?.(); await this.render(); }

  private drawRows(list: HTMLElement, items: CustomItem[]) {
    list.empty();
    const shown = filterSortItems(items, { text: this.filterText, field: this.filterField, sort: this.sort });
    if (!shown.length) list.createDiv({ cls: "dcal-empty", text: items.length ? "沒有符合篩選條件的內容" : "還沒有長期的自訂事項/任務。在月曆日期上按右鍵 →「建立自訂事項/任務」" });
    const reorderable = this.sort === "file" && !this.filterText;
    for (const it of shown) {
      const row = list.createDiv({ cls: "dcal-ct-row" });
      const info = row.createDiv({ cls: "dcal-ct-info" });
      const head = info.createDiv({ cls: "dcal-ct-name", text: it.name });
      head.createSpan({ cls: "dcal-ct-type", text: it.type === "task" ? "任務" : "事項" });
      info.createDiv({ cls: "dcal-ct-spec", text: summarize(it.repeat) });
      if (it.note) info.createDiv({ cls: "dcal-ct-note", text: `註釋：${it.note}` });
      info.createDiv({ cls: "dcal-ct-file", text: `${it.file.path}${it.heading ? `　${it.heading}` : ""}` });
      const acts = row.createDiv({ cls: "dcal-ct-acts" });
      const btn = (label: string, title: string, fn: () => Promise<void> | void) => { const b = acts.createEl("button", { text: label, attr: { title } }); b.onclick = async () => { await fn(); }; };
      if (reorderable) {
        btn("↑", "往上移（會改動檔案裡的順序）", async () => { await moveCustomItem(this.app, it, -1); await this.after(); });
        btn("↓", "往下移（會改動檔案裡的順序）", async () => { await moveCustomItem(this.app, it, 1); await this.after(); });
      }
      btn("編輯", "編輯", () => { new CustomItemModal(this.app, this.plugin, { date: this.date, item: it, onDone: () => { void this.after(); } }).open(); });
      btn("複製", "複製一份", async () => { await copyCustomItem(this.app, it); await this.after(); });
      btn("刪除", "刪除", async () => { await deleteCustomItem(this.app, it); await this.after(); });
    }
  }
}

/** 跳出視窗版 */
export class CustomItemManagerModal extends Modal {
  mgr: CustomItemManager;
  constructor(app: App, plugin: ModularCalendarPlugin, date: Moment, onDone?: () => void) { super(app); this.mgr = new CustomItemManager(app, plugin, date, onDone); }
  onOpen() { this.modalEl.addClass("dcal-resizable"); this.titleEl.setText("自訂事項/任務"); void this.mgr.render(this.contentEl); }
}
