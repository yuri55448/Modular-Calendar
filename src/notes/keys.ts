import { moment } from "obsidian";
import type { Moment } from "moment";
import { CalendarSettings } from "../core/settings";
import { PeriodKind } from "../core/types";
import { quarterInfo, weekInfo } from "../util/calendar";
import { compileMatcher } from "../util/format";

/** 子資料夾格式 ＋「/」＋ 檔名格式（整段當作一個格式處理，「/」即資料夾分隔） */
export function pathFormat(kind: PeriodKind, s: CalendarSettings, extra = false): string {
  const cfg = s.periodic[kind];
  const name = extra && kind === "daily" ? s.naming.extraFormat : cfg.format;
  return [cfg.subfolder, name].map((x) => x.trim()).filter(Boolean).join("/");
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** 每個期間的唯一鍵：用來把筆記對應到日期 */
export function periodKey(kind: PeriodKind, date: Moment, s: CalendarSettings): string {
  switch (kind) {
    case "weekly": { const w = weekInfo(date, s.weekStart); return `${w.year}-W${w.week}`; }
    case "monthly": return date.format("YYYY-MM");
    case "quarterly": { const q = quarterInfo(date, s.quarterStartMonth); return `${q.start.year()}-Q${q.index}`; }
    case "yearly": return date.format("YYYY");
    default: return date.format("YYYY-MM-DD");
  }
}

/** 由路徑解析出的欄位算出期間鍵；資訊不足回傳 null */
export function keyFromFields(kind: PeriodKind, f: Record<string, number>, s: CalendarSettings): string | null {
  const year = f.y ?? (f.y2 !== undefined ? 2000 + f.y2 : undefined);
  switch (kind) {
    case "daily": case "taskDiary":
      return year !== undefined && f.m !== undefined && f.d !== undefined ? `${year}-${p2(f.m)}-${p2(f.d)}` : null;
    case "weekly": {
      if (f.w !== undefined) {
        const wy = f.wy ?? (f.wy2 !== undefined ? 2000 + f.wy2 : year);
        if (wy !== undefined) return `${wy}-W${f.w}`;
      }
      if (year !== undefined && f.m !== undefined && f.d !== undefined) return periodKey("weekly", moment([year, f.m - 1, f.d]), s);
      return null;
    }
    case "monthly":
      return year !== undefined && f.m !== undefined ? `${year}-${p2(f.m)}` : null;
    case "quarterly": {
      if (f.q !== undefined) {
        const qy = f.qy ?? year;
        if (qy !== undefined) return `${qy}-Q${f.q}`;
      }
      if (year !== undefined && f.m !== undefined) return periodKey("quarterly", moment([year, f.m - 1, 1]), s);
      return null;
    }
    case "yearly":
      return year !== undefined ? String(year) : null;
    default:
      return year !== undefined ? String(year) : null;
  }
}

/** 檢查格式是否含有足以辨識日期的欄位；有問題回傳說明 */
export function formatProblem(kind: PeriodKind, fullFormat: string): string | null {
  const f = new Set(compileMatcher(fullFormat).fields);
  const yr = f.has("y") || f.has("y2");
  const isDaily = kind === "daily" || kind === "taskDiary";
  const ok =
    isDaily ? yr && f.has("m") && f.has("d")
    : kind === "weekly" ? f.has("w") || (yr && f.has("m") && f.has("d"))
    : kind === "monthly" ? yr && f.has("m")
    : kind === "quarterly" ? f.has("q") || (yr && f.has("m"))
    : yr;
  if (ok) return null;
  const need =
    isDaily ? "年、月、日（YYYY、MM、DD）"
    : kind === "weekly" ? "週數（{{week}} 或 WW），或年月日"
    : kind === "monthly" ? "年與月（YYYY、MM）"
    : kind === "quarterly" ? "季度（{{quarter}} 或 Q），或年與月"
    : "年（YYYY）";
  return `格式缺少${need}，插件將無法辨識這個檔案屬於哪個期間`;
}
