import type { Moment } from "moment";
import { CalendarSettings, SEASON_PRESETS, SeasonDef } from "../core/settings";

/** 解析自訂季節文字：每行「起月-迄月 名稱」，例如 "3-9 夏季"、"12-2冬季"、"1 春季" */
export function parseSeasonText(text: string): SeasonDef[] {
  const out: SeasonDef[] = [];
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^(\d{1,2})\s*(?:[-~–—到至]\s*(\d{1,2}))?\s*(.+)$/);
    if (!m) continue;
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : start;
    if (start < 1 || start > 12 || end < 1 || end > 12) continue;
    out.push({ name: m[3].trim(), start, end });
  }
  return out;
}

export function getSeasons(s: CalendarSettings): SeasonDef[] {
  if (s.seasonPreset === "custom") return parseSeasonText(s.seasonCustom);
  return (SEASON_PRESETS[s.seasonPreset] ?? SEASON_PRESETS.standard).seasons;
}

/** month: 1–12；沒有任何季節涵蓋該月則回傳 null（而不是空字串，讓呼叫端可以分辨「沒有季節」與「季節名稱剛好是空字串」） */
export function seasonOf(month: number, s: CalendarSettings): SeasonDef | null {
  for (const d of getSeasons(s)) {
    const hit = d.start <= d.end ? month >= d.start && month <= d.end : month >= d.start || month <= d.end;
    if (hit) return d;
  }
  return null;
}

export const QUARTER_CN = ["一", "二", "三", "四"];
const CN = QUARTER_CN;

export function quarterInfo(date: Moment, startMonth: number) {
  const since = (date.month() + 1 - startMonth + 12) % 12;
  const index = Math.floor(since / 3);
  const start = date.clone().startOf("month").subtract(since % 3, "months");
  return { index: index + 1, label: `第${CN[index]}季度`, start };
}

export function weekStartOf(date: Moment, weekStart: number): Moment {
  return date.clone().startOf("day").subtract((date.day() - weekStart + 7) % 7, "days");
}

/**
 * 週數規則：週一起算 = ISO 8601（含該週週四的年度）；
 * 其他起始日 = 含 1/1 的那週為第 1 週（以該週最後一天所在年度為準）。
 */
export function weekInfo(date: Moment, weekStart: number) {
  const start = weekStartOf(date, weekStart);
  const anchor = start.clone().add(weekStart === 1 ? 3 : 6, "days");
  return { start, year: anchor.year(), week: Math.ceil(anchor.dayOfYear() / 7) };
}
