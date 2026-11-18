import type { Moment } from "moment";

/** 日本年號（只收錄近代幾個，涵蓋絕大多數使用情境；更早的年代就不轉換，直接顯示西元年） */
const ERAS: { name: string; start: string }[] = [
  { name: "令和", start: "2019-05-01" },
  { name: "平成", start: "1989-01-08" },
  { name: "昭和", start: "1926-12-25" },
];

/** 西元年轉日本年號，例如 2026 年 → 令和8年；查無對應年號時回傳西元年原樣 */
export function japaneseEra(date: Moment): string {
  const iso = date.format("YYYY-MM-DD");
  for (const era of ERAS) {
    if (iso >= era.start) {
      const startYear = Number(era.start.slice(0, 4));
      const n = date.year() - startYear + 1;
      return `${era.name}${n === 1 ? "元" : n}年`;
    }
  }
  return `${date.year()}年`;
}

const ROKUYO = ["先勝", "友引", "先負", "仏滅", "大安", "赤口"];

/** 傳統「六曜」吉凶：(農曆月+農曆日) mod 6，對照固定順序的六個名稱 */
export function rokuyo(lunarMonth: number, lunarDay: number): string {
  const idx = ((Math.abs(lunarMonth) + lunarDay) % 6 + 6) % 6;
  return ROKUYO[idx];
}
