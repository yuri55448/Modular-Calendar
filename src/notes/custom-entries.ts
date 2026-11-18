import { App, TFile } from "obsidian";

/** 路徑可以是 md 檔案或資料夾；回傳底下所有符合的 md 檔案（依路徑排序，結果穩定） */
export function filesUnder(app: App, paths: string[]): TFile[] {
  const wanted = paths.map((p) => p.trim().replace(/^\/+|\/+$/g, "")).filter(Boolean);
  if (!wanted.length) return [];
  const lc = wanted.map((p) => p.toLowerCase());
  // 不分大小寫比對（Windows／macOS 的檔案系統本來就不分，「Tasks List」跟「Tasks list」是同一個資料夾）
  return app.vault.getMarkdownFiles()
    .filter((f) => { const fp = f.path.toLowerCase(); return lc.some((p) => fp === p || fp === `${p}.md` || fp.startsWith(p + "/")); })
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** 依設定的排序方式排名稱（預設 A 到 Z） */
export function sortNames(names: string[], mode: "az" | "za" | "file"): string[] {
  if (mode === "file") return names;
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  return [...names].sort((a, b) => (mode === "az" ? cmp(a, b) : cmp(b, a)));
}
