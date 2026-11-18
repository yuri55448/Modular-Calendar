import type { Moment } from "moment";
import { CalendarSettings } from "../core/settings";
import type { HolidayData } from "../providers/holiday";
import { matchCustomBadges, parseCustomBadges, resolveBadges } from "../util/badges";
import { resolveColor, toBackground } from "../util/color";

type BadgeCfg = CalendarSettings["restWorkBadge"];

/**
 * 當天命中的所有徽章（標準休／班＋自訂日期規則），已依優先序排好——第一個就是最優先的。
 * 標籤跟「休」「班」同名的自訂徽章，視為下載下來的休假／補班的一部分：一樣是紅色（休）／橘色（班）、
 * 一樣用「休」「班」那一組的顏色與底色設定，而且跟下載的假日同一天時只會顯示一個，不會重複。
 */
export function resolveDayBadges(cfg: BadgeCfg, h: HolidayData | null, date: Moment) {
  const hits = matchCustomBadges(parseCustomBadges(cfg.customSaved), date);
  const customRest = hits.some((x) => x.label === cfg.restLabel);
  const customWork = hits.some((x) => x.label === cfg.workLabel);
  const others = hits.filter((x) => x.label !== cfg.restLabel && x.label !== cfg.workLabel);
  const rest = { label: cfg.restLabel, color: "", kind: "rest" as const };
  const work = { label: cfg.workLabel, color: "", kind: "work" as const };
  const standard =
    h?.isRest && h.name ? rest
    : h?.isMakeupWork ? work
    : customRest ? rest
    : customWork ? work
    : null;
  return resolveBadges({ standard, custom: others, priority: cfg.priority, customColor: () => "" });
}

/**
 * 當天「整格底色」該用哪個徽章：依 bgPriority（可在設定拖曳排序）挑第一個命中的；
 * 月曆與年歷都用這一個函式，所以休／班／自訂徽章在兩邊顯示的底色一致。沒有命中任何徽章回傳 null。
 */
export function dayBackground(cfg: BadgeCfg, h: HolidayData | null, date: Moment): { label: string; source: string; css: string } | null {
  const badges = resolveDayBadges(cfg, h, date);
  if (!badges.length) return null;
  const rank = (label: string) => { const i = cfg.bgPriority.indexOf(label); return i === -1 ? Infinity : i; };
  const winner = [...badges].sort((a, b) => rank(a.label) - rank(b.label))[0];
  const bc = cfg.badgeColors[winner.label];
  const css = bc ? toBackground(resolveColor(bc.bgColor).value, bc.bgOpacity) : "";
  return { label: winner.label, source: winner.source, css };
}
