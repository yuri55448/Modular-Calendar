import { App, Modal } from "obsidian";
import type { Moment } from "moment";
import type ModularCalendarPlugin from "../main";
import type { TaskTarget } from "../main";

const NONE = "__none";
const CUSTOM = "__custom";

/**
 * 「新增任務（Tasks 樣式）」之前先選任務要存放在哪裡（全部都可以略過）：
 *  ① 存放位置：當日的事項/任務日記（預設）／設定裡已設定的位置／自訂義路徑（例如 2026/10、2026/11 → 2026/10.md）
 *  ② 建立新檔案時套用的模板（可選）
 *  ③ 加在哪個標題底下（例如 ## 待辦、# 本週任務；沒有就依序加在最下方）
 * 回傳 null＝取消；「略過」＝全部用預設，直接進入 Tasks 的建立任務面板。
 */
export function pickTaskTarget(app: App, plugin: ModularCalendarPlugin, date: Moment): Promise<TaskTarget | null> {
  return new Promise((resolve) => new TaskTargetModal(app, plugin, date, resolve).open());
}

class TaskTargetModal extends Modal {
  private done = false;
  constructor(app: App, private plugin: ModularCalendarPlugin, private date: Moment, private finish: (t: TaskTarget | null) => void) { super(app); }

  private settle(t: TaskTarget | null) { if (this.done) return; this.done = true; this.finish(t); this.close(); }
  onClose() { if (!this.done) { this.done = true; this.finish(null); } }

  onOpen() {
    const s = this.plugin.settings;
    const el = this.contentEl;
    this.titleEl.setText(`新增任務到 ${this.date.format("M/D")}：選擇存放位置`);

    // ① 存放位置
    el.createEl("div", { text: "存放位置" });
    const where = el.createEl("select", { cls: "dcal-namefield" }) as HTMLSelectElement;
    where.createEl("option", { text: s.taskAdd.target === "taskDiary" ? "當日的事項/任務日記（預設）" : "當日的一般日記（預設）", attr: { value: "diary" } });
    s.taskAdd.locations.forEach((p, i) => where.createEl("option", { text: `已設定位置：${p}`, attr: { value: `loc:${i}` } }));
    where.createEl("option", { text: "自訂義創建…", attr: { value: CUSTOM } });
    where.value = "diary";
    const customRow = el.createDiv({ cls: "dcal-target-custom dcal-hidden" });
    const custom = customRow.createEl("input", { cls: "dcal-namefield", type: "text", attr: { placeholder: "例如 2026/10（會建立 2026/10.md）" } }) as HTMLInputElement;
    const quick = customRow.createDiv({ cls: "dcal-quick-btns" });
    for (const d of [this.date, this.date.clone().add(1, "months")]) {
      const label = d.format("YYYY/MM");
      quick.createEl("button", { text: label }).onclick = () => { custom.value = label; };
    }
    where.onchange = () => customRow.toggleClass("dcal-hidden", where.value !== CUSTOM);

    // ② 模板
    const templates = this.plugin.taskTemplateFiles();
    let tpl: HTMLSelectElement | null = null;
    if (templates.length) {
      el.createEl("div", { text: "模板（只有在檔案還不存在、需要建立時才會套用）" });
      tpl = el.createEl("select", { cls: "dcal-namefield" }) as HTMLSelectElement;
      templates.forEach((f, i) => tpl!.createEl("option", { text: i === 0 ? `${f.path}（預設）` : f.path, attr: { value: f.path } }));
      tpl.createEl("option", { text: "（不使用模板）", attr: { value: NONE } });
      tpl.value = templates[0].path;
    }

    // ③ 標題
    el.createEl("div", { text: "加在哪個標題底下" });
    const head = el.createEl("select", { cls: "dcal-namefield" }) as HTMLSelectElement;
    for (const h of s.taskAdd.headings) head.createEl("option", { text: h, attr: { value: h } });
    head.createEl("option", { text: "（不指定，依序加在最下方）", attr: { value: NONE } });
    head.createEl("option", { text: "自訂義標題…", attr: { value: CUSTOM } });
    head.value = s.taskAdd.headings[0] ?? NONE;
    const headCustom = el.createEl("input", { cls: "dcal-namefield dcal-hidden", type: "text", attr: { placeholder: "例如 # 待辦 或 ## 本週任務（沒有這個標題會自動建立）" } }) as HTMLInputElement;
    head.onchange = () => headCustom.toggleClass("dcal-hidden", head.value !== CUSTOM);

    const read = (): TaskTarget => {
      const h = head.value === NONE ? "" : head.value === CUSTOM ? headCustom.value.trim() : head.value;
      const template = tpl ? (tpl.value === NONE ? "" : tpl.value) : undefined;
      if (where.value === "diary") return { where: "diary", template, heading: h };
      if (where.value === CUSTOM) return { where: "custom", path: custom.value.trim(), template, heading: h };
      return { where: "location", path: s.taskAdd.locations[Number(where.value.slice(4))], template, heading: h };
    };

    const btns = el.createDiv({ cls: "dcal-modal-btns" });
    btns.createEl("button", { text: "開始建立任務", cls: "mod-cta" }).onclick = () => {
      const t = read();
      if (t.where === "custom" && !t.path) { custom.addClass("is-error"); return; }
      this.settle(t);
    };
    btns.createEl("button", { text: "略過，直接建立任務" }).onclick = () => this.settle({ where: "diary", heading: s.taskAdd.headings[0] ?? "" });
    btns.createEl("button", { text: "取消" }).onclick = () => this.settle(null);
  }
}
