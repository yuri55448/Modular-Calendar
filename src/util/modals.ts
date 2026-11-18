import { App, Modal } from "obsidian";

/** 建立筆記前的提示：可只做確認，也可同時輸入名稱。取消回傳 null */
export function askCreate(
  app: App,
  o: { title: string; message?: string; askName?: boolean; placeholder?: string; okText?: string; choices?: { label: string; options: string[] } }
): Promise<{ name: string; choice: string } | null> {
  return new Promise((resolve) => {
    let done = false;
    class CreateModal extends Modal {
      onOpen() {
        this.titleEl.setText(o.title);
        if (o.message) this.contentEl.createEl("p", { text: o.message });
        let input: HTMLInputElement | null = null;
        if (o.askName) {
          input = this.contentEl.createEl("input", { cls: "dcal-namefield", type: "text", placeholder: o.placeholder ?? "日記名稱" });
          input.focus();
        }
        let select: HTMLSelectElement | null = null;
        if (o.choices && o.choices.options.length) {
          this.contentEl.createEl("div", { text: o.choices.label });
          select = this.contentEl.createEl("select", { cls: "dcal-namefield" }) as HTMLSelectElement;
          for (const opt of o.choices.options) select.createEl("option", { text: opt, attr: { value: opt } });
          select.value = o.choices.options[0];
        }
        const submit = () => { done = true; resolve({ name: input ? input.value.trim() : "", choice: select?.value ?? "" }); this.close(); };
        if (input) input.onkeydown = (e) => { if (e.key === "Enter" && !e.isComposing) submit(); };
        const bar = this.contentEl.createDiv({ cls: "dcal-modal-bar" });
        bar.createEl("button", { text: "取消" }).onclick = () => this.close();
        bar.createEl("button", { text: o.okText ?? "建立", cls: "mod-cta" }).onclick = submit;
      }
      onClose() {
        this.contentEl.empty();
        if (!done) resolve(null);
      }
    }
    new CreateModal(app).open();
  });
}

import type { Moment } from "moment";
import { CalendarSettings } from "../core/settings";
import { PeriodKind, PERIOD_LABEL } from "../core/types";
import { periodName } from "../notes/periodic";

/** 雙擊建立日記前的確認彈窗（僅在設定啟用時呼叫） */
export async function confirmCreate(app: App, kind: PeriodKind, date: Moment, s: CalendarSettings): Promise<boolean> {
  const name = periodName(kind, date, s);
  const r = await askCreate(app, { title: `建立${PERIOD_LABEL[kind]}？`, message: `尚未建立：${name}`, okText: "建立" });
  return r !== null;
}
