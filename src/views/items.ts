import { ItemView, WorkspaceLeaf, moment } from "obsidian";
import type ModularCalendarPlugin from "../main";
import { CustomItemManager } from "../util/custom-item-ui";

export const VIEW_TYPE_ITEMS = "dcal-items-view";

/** 在新分頁開啟「查看自訂事項/任務」（跟跳出視窗版是同一份內容，只是不受視窗大小限制） */
export class ItemsView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: ModularCalendarPlugin) { super(leaf); }
  getViewType() { return VIEW_TYPE_ITEMS; }
  getDisplayText() { return "自訂事項/任務"; }
  getIcon() { return "list-checks"; }
  async onOpen() {
    this.contentEl.addClass("dcal-items-view");
    await new CustomItemManager(this.app, this.plugin, moment().startOf("day")).render(this.contentEl);
  }
}
