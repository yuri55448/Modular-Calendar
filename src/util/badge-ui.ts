import { App, Modal, Notice } from "obsidian";
import type { Moment } from "moment";
import type ModularCalendarPlugin from "../main";
import { addDateToBadge, parseCustomBadges, removeDateFromBadges } from "./badges";

const NONE = "__none";

/** 右鍵「新增自訂徽章」：在某一天加上自訂徽章——可以選已有的標籤，或另外新建；同時會寫進設定裡「休／班／自訂徽章」的自訂徽章文字 */
export class AddBadgeModal extends Modal {
  constructor(app: App, private plugin: ModularCalendarPlugin, private date: Moment, private onDone?: () => void) { super(app); }

  onOpen() {
    const rw = this.plugin.settings.restWorkBadge;
    const el = this.contentEl;
    this.titleEl.setText(`新增自訂徽章：${this.date.format("YYYY/M/D")}`);
    // 「休」「班」也可以選：加進去的日子會跟下載的休假／補班合在一起，顯示成一樣的顏色
    const existing = [...new Set([...parseCustomBadges(rw.customSaved).map((d) => d.label), rw.restLabel, rw.workLabel])];
    el.createEl("div", { text: existing.length ? "選擇已有的徽章，或下面另外新建" : "還沒有自訂徽章，請在下面輸入新的徽章名稱" });
    const pick = el.createEl("select", { cls: "dcal-namefield" }) as HTMLSelectElement;
    pick.createEl("option", { text: "（新建徽章）", attr: { value: "" } });
    for (const l of existing) pick.createEl("option", { text: l, attr: { value: l } });
    pick.createEl("option", { text: "無（取消這一天的自訂徽章）", attr: { value: NONE } });
    pick.value = existing[0] ?? "";
    el.createEl("div", { text: "新徽章名稱（選了已有的徽章就不用填）" });
    const fresh = el.createEl("input", { cls: "dcal-namefield", type: "text", attr: { placeholder: "例如：紀念日" } }) as HTMLInputElement;
    const btns = el.createDiv({ cls: "dcal-modal-btns" });
    const ok = btns.createEl("button", { text: "加入", cls: "mod-cta" });
    btns.createEl("button", { text: "取消" }).onclick = () => this.close();
    ok.onclick = async () => {
      if (pick.value === NONE) {
        const r = await cancelBadgesOnDay(this.plugin, this.date);
        new Notice(r.message);
        this.close();
        this.onDone?.();
        return;
      }
      const label = (pick.value || fresh.value).trim();
      if (!label) { new Notice("請選擇或輸入徽章名稱"); return; }
      await addBadgeToDay(this.plugin, label, this.date);
      new Notice(`已把「${label}」加到 ${this.date.format("YYYY/M/D")}`);
      this.close();
      this.onDone?.();
    };
  }
}

/** 把某一天加進某個自訂徽章（已保存應用的文字與草稿都一起更新），並立刻套用 */
export async function addBadgeToDay(plugin: ModularCalendarPlugin, label: string, date: Moment) {
  const rw = plugin.settings.restWorkBadge;
  const wasSynced = rw.custom === rw.customSaved;
  rw.customSaved = addDateToBadge(rw.customSaved, label, date);
  rw.custom = wasSynced ? rw.customSaved : addDateToBadge(rw.custom, label, date);   // 使用者正在改的草稿也跟著加，但不蓋掉他的其他修改
  if (!rw.badgeColors[label]) rw.badgeColors[label] = { color: "", opacity: 100, bgColor: "", bgOpacity: 20 };
  if (!rw.bgPriority.includes(label)) rw.bgPriority.push(label);
  await plugin.saveAndRefresh();
}

/** 取消某一天的自訂徽章（已保存應用的文字與草稿都一起處理）；下載的假日（休／班）本身不在這裡取消 */
export async function cancelBadgesOnDay(plugin: ModularCalendarPlugin, date: Moment): Promise<{ changed: boolean; still: string[]; message: string }> {
  const rw = plugin.settings.restWorkBadge;
  const wasSynced = rw.custom === rw.customSaved;
  const saved = removeDateFromBadges(rw.customSaved, date);
  const draft = wasSynced ? saved : removeDateFromBadges(rw.custom, date);
  rw.customSaved = saved.text;
  rw.custom = wasSynced ? saved.text : draft.text;
  if (saved.changed || draft.changed) await plugin.saveAndRefresh();
  const label = date.format("YYYY/M/D");
  if (saved.still.length) return { changed: saved.changed, still: saved.still, message: `${label} 的「${saved.still.join("、")}」是由重複或區間規則產生的，無法在這裡取消，請到設定的自訂徽章修改那一行規則` };
  return { changed: saved.changed, still: [], message: saved.changed ? `已取消 ${label} 的自訂徽章` : `${label} 沒有可以取消的自訂徽章（下載的休假／補班不能在這裡取消）` };
}
