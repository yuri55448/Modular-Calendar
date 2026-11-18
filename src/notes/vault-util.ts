import { App, TFile } from "obsidian";

/** Windows／macOS 的檔案系統不分大小寫，但 Obsidian 的路徑索引分——「Tasks List」跟已經存在的「Tasks list」會被當成不同路徑，建立時就噴「Folder already exists」 */
const isAlreadyExists = (e: unknown) => /already exists/i.test(String((e as Error)?.message ?? e));

/** 不分大小寫找檔案或資料夾，回傳實際存在的路徑（大小寫以磁碟上的為準）；找不到回傳 null */
export function findExisting(app: App, path: string): string | null {
  const hit = app.vault.getAbstractFileByPath(path);
  if (hit) return (hit as { path: string }).path;
  const want = path.toLowerCase();
  const all: { path: string }[] = app.vault.getAllLoadedFiles?.() ?? [];
  return all.find((f) => f.path.toLowerCase() === want)?.path ?? null;
}

/** 逐層建立資料夾；已經存在（含大小寫不同）就沿用磁碟上的名稱。回傳實際的資料夾路徑 */
export async function ensureFolders(app: App, dir: string): Promise<string> {
  let cur = "";
  for (const seg of dir.split("/").filter(Boolean)) {
    const next = cur ? `${cur}/${seg}` : seg;
    const found = findExisting(app, next);
    if (found) { cur = found; continue; }
    try { await app.vault.createFolder(next); cur = next; }
    catch (e) {
      if (!isAlreadyExists(e)) throw e;
      cur = findExisting(app, next) ?? next;
    }
  }
  return cur;
}

/** 取得檔案，沒有就建立（資料夾一併建立）；已經存在（含大小寫不同）就直接用 */
export async function ensureFileAt(app: App, path: string, content = ""): Promise<TFile> {
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? await ensureFolders(app, path.slice(0, slash)) : "";
  const full = dir ? `${dir}/${path.slice(slash + 1)}` : path;
  const found = findExisting(app, full);
  if (found) return app.vault.getAbstractFileByPath(found) as TFile;
  try { return await app.vault.create(full, content); }
  catch (e) {
    if (!isAlreadyExists(e)) throw e;
    const again = findExisting(app, full);
    if (again) return app.vault.getAbstractFileByPath(again) as TFile;
    throw e;
  }
}
