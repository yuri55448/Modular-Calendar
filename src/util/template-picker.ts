import { App, FuzzySuggestModal, TFile, TFolder } from "obsidian";

/** 右鍵「選擇模板建立…」用的檔案挑選器；候選清單由設定決定（所有 .md 或指定資料夾） */
export class TemplatePicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, private candidates: TFile[], private chooseCb: (f: TFile) => void) {
    super(app);
    this.setPlaceholder("選擇要套用的模板…");
  }
  getItems(): TFile[] { return this.candidates; }
  getItemText(f: TFile) { return f.path; }
  onChooseItem(f: TFile) { this.chooseCb(f); }
}

/** 右鍵選單「開啟日記…」用：當天日記超過 5 篇時，改成跳出這個挑選器（類似 Ctrl+P 快速切換） */
export class NotePickerModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private candidates: TFile[], private chooseCb: (f: TFile) => void) {
    super(app);
    this.setPlaceholder("選擇要開啟的日記…");
  }
  getItems(): TFile[] { return this.candidates; }
  getItemText(f: TFile) { return f.basename; }
  onChooseItem(f: TFile) { this.chooseCb(f); }
}

/** 模板路徑欄位旁「切換成資料夾」用：先選一個資料夾，選好後把路徑填回輸入框，再切回檔案模式挑實際的檔案 */
export class FolderPickerModal extends FuzzySuggestModal<TFolder> {
  constructor(app: App, private chooseCb: (f: TFolder) => void) {
    super(app);
    this.setPlaceholder("選擇資料夾…");
  }
  getItems(): TFolder[] {
    return this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder && f.path !== "/");
  }
  getItemText(f: TFolder) { return f.path; }
  onChooseItem(f: TFolder) { this.chooseCb(f); }
}
