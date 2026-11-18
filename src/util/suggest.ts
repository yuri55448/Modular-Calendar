import { AbstractInputSuggest, App, TFile, TFolder } from "obsidian";

function fill(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input"));
}

const TEMPLATEISH = /template|模板|範本|样板/i;

/** 點輸入框就列出 vault 內的 .md 檔（路徑含「模板」的排前面）；可點選，也可自行輸入 */
export class FileSuggest extends AbstractInputSuggest<TFile> {
  constructor(private vaultApp: App, private input: HTMLInputElement, private candidates?: () => TFile[]) { super(vaultApp, input); }

  getSuggestions(query: string): TFile[] {
    const q = query.toLowerCase().trim();
    const rank = (f: TFile) => (TEMPLATEISH.test(f.path) ? 0 : 1);
    return (this.candidates ? this.candidates() : this.vaultApp.vault.getMarkdownFiles())
      .filter((f) => !q || f.path.toLowerCase().includes(q))
      .sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path))
      .slice(0, 60);
  }

  renderSuggestion(f: TFile, el: HTMLElement) {
    el.createDiv({ text: f.basename });
    if (f.parent && f.parent.path !== "/") el.createDiv({ cls: "dcal-sugg-path", text: f.parent.path });
  }

  selectSuggestion(f: TFile) {
    fill(this.input, f.path);
    this.close();
  }
}

/** 資料夾欄位用：列出現有資料夾 */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
  constructor(private vaultApp: App, private input: HTMLInputElement) { super(vaultApp, input); }

  getSuggestions(query: string): TFolder[] {
    const q = query.toLowerCase().trim();
    return this.vaultApp.vault
      .getAllLoadedFiles()
      .filter((f): f is TFolder => f instanceof TFolder && f.path !== "/" && (!q || f.path.toLowerCase().includes(q)))
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, 60);
  }

  renderSuggestion(f: TFolder, el: HTMLElement) { el.setText(f.path); }

  selectSuggestion(f: TFolder) {
    fill(this.input, f.path);
    this.close();
  }
}
