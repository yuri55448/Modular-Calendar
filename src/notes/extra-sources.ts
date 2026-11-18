import { App, TFile } from "obsidian";
import { moment } from "obsidian";
import type { Moment } from "moment";
import { CalendarSettings } from "../core/settings";

/**
 * 額外來源：掃描設定裡列出的資料夾／檔案，讀取每篇筆記 YAML 裡的日期屬性（dateKey，用 dateFormat 解析），
 * 決定它屬於哪一天。跟日記不同，這些筆記不需要符合任何檔名格式。
 */
/** 把 YAML 讀出來的值轉成 Moment。raw 可能是字串，也可能被 Obsidian 的 YAML 解析器直接轉成 Date 物件。
 * 先照使用者填的格式解析；萬一格式本身有問題（常見筆誤：用大寫 MM 當分鐘），也試著用 Obsidian 內建的寬鬆解析救看看。 */
/** 修正最常見的筆誤：時間裡的分鐘寫成大寫 MM（那是月份）、秒寫成大寫 SS（那是毫秒） */
export function fixTimeFormat(fmt: string): string {
  return fmt.replace(/([Hh]{1,2}:)MM/g, "$1mm").replace(/(:mm:)SS/g, "$1ss");
}

function parseExtraDate(raw: unknown, fmtIn: string): Moment | null {
  const fmt = fixTimeFormat(fmtIn);
  if (raw instanceof Date) { const m = moment(raw); return m.isValid() ? m : null; }
  const str = String(raw ?? "").trim();
  if (!str) return null;
  const strict = moment(str, fmt, true);
  if (strict.isValid()) return strict;
  const loose = moment(str, fmt, false);
  if (loose.isValid()) return loose;
  const auto = moment(str);
  return auto.isValid() ? auto : null;
}

export interface ExtraSourceDebug { path: string; exists: boolean; matched: number }

/** opt.paths：改用這組路徑掃描（圓點自己的「讀取路徑」用）；opt.force：即使「額外來源」沒開啟也掃描 */
export function scanExtraSources(app: App, s: CalendarSettings, opt: { paths?: string[]; force?: boolean } = {}): Map<string, TFile[]> {
  const out = new Map<string, TFile[]>();
  const rawPaths = opt.paths ?? s.extraSources.paths;
  if ((!s.extraSources.enabled && !opt.force) || !rawPaths.length) return out;
  const paths = rawPaths.map((p) => p.trim().replace(/^\/+|\/+$/g, "")).filter(Boolean);
  const key = s.extraSources.dateKey;
  const fmt = s.extraSources.dateFormat || "YYYY-MM-DD";

  for (const f of app.vault.getMarkdownFiles()) {
    const matchesPath = paths.some((p) => f.path === p || f.path === `${p}.md` || f.path.startsWith(p + "/"));
    if (!matchesPath) continue;
    const fm = app.metadataCache.getFileCache(f)?.frontmatter;
    const raw = fm?.[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const parsed = parseExtraDate(raw, fmt);
    if (!parsed) continue;
    const dayKey = parsed.format("YYYY-MM-DD");
    const arr = out.get(dayKey);
    if (arr) arr.push(f); else out.set(dayKey, [f]);
  }
  return out;
}

/** 設定頁用：每個路徑是否存在、底下各掃到幾篇符合日期屬性的筆記，方便自行檢查有沒有讀到 */
export function debugExtraSources(app: App, s: CalendarSettings): ExtraSourceDebug[] {
  const paths = s.extraSources.paths.map((p) => p.trim().replace(/^\/+|\/+$/g, "")).filter(Boolean);
  const matched = scanExtraSources(app, { ...s, extraSources: { ...s.extraSources, enabled: true } });
  const counts = new Map<string, number>();
  for (const [, files] of matched) {
    for (const f of files) {
      const hit = paths.find((p) => f.path === p || f.path.startsWith(p + "/"));
      if (hit) counts.set(hit, (counts.get(hit) ?? 0) + 1);
    }
  }
  return paths.map((p) => ({
    path: p,
    exists: !!app.vault.getAbstractFileByPath(p),
    matched: counts.get(p) ?? 0,
  }));
}
