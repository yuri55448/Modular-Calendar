import { MarkCfg } from "../core/settings";
import { resolveColor } from "./color";

export const MAX_DOTS = 5;

/**
 * 圓形／方形／菱形／X 型都用純 CSS 畫出固定大小的形狀（不用 Unicode 符號），
 * 確保四種樣式視覺大小一致；只有「自訂符號」會真的顯示使用者輸入的字元。
 */
function mark(parent: HTMLElement, cfg: MarkCfg, hollow: boolean) {
  const isGlyph = cfg.shape === "custom";
  const el = parent.createSpan({ cls: `dcal-mark dcal-mark-${cfg.shape}`, text: isGlyph ? cfg.custom || "●" : "" });
  if (hollow) el.addClass("is-hollow");
}

/** 每個圓點（含間距）大約佔的寬度，用來估計「這個格子放得下幾點」 */
const DOT_SLOT_PX = 11;
/** 格子左右留白，扣掉之後才是真正能放圓點的寬度 */
const CELL_PADDING_PX = 14;

/**
 * 決定這一格該畫成圓點還是數字：
 *  - 本來就設定成數字模式 → 數字
 *  - 圓點數量超過設定的 maxDots → 改顯示數字（不再只畫 N 點加個「+」）
 *  - 開啟「根據格子大小自動轉換」：格子太窄放不下這麼多點 → 數字（cellWidth 未知時不判斷）
 */
export function shouldShowNumber(count: number, cfg: MarkCfg, cellWidth?: number): boolean {
  if (cfg.mode === "number") return true;
  const max = Number.isFinite(cfg.maxDots) && cfg.maxDots > 0 ? cfg.maxDots : MAX_DOTS;
  if (count > max) return true;
  if (cfg.autoSize && cellWidth && cellWidth > 0) {
    const capacity = Math.max(1, Math.floor((cellWidth - CELL_PADDING_PX) / DOT_SLOT_PX));
    if (count > capacity) return true;
  }
  return false;
}

/** 畫一排圓點，或在超過上限／格子太小時改畫數字；met[i] === false 的圓點畫成空心 */
export function renderMarks(row: HTMLElement, o: { count: number; met?: boolean[]; cfg: MarkCfg }) {
  const { cfg } = o;
  row.style.setProperty("--dcal-mark-color", resolveColor(cfg.color).value || "var(--interactive-accent)");
  const cell = row.closest(".dcal-cell") as HTMLElement | null;
  const cellWidth = cell?.clientWidth || cell?.offsetWidth;
  if (shouldShowNumber(o.count, cfg, cellWidth)) {
    // 「數字旁也顯示一個圓點」：不管是一開始就設成數字、超過 maxDots、或因格子太窄自動轉成數字，都一視同仁
    if (cfg.beside) mark(row, cfg, false);
    row.createSpan({ cls: "dcal-marknum", text: String(o.count) });
    return;
  }
  for (let i = 0; i < o.count; i++) mark(row, cfg, o.met ? o.met[i] === false : false);
}

/**
 * 自訂圓點樣式的驗證：必須恰好是一個標準 Unicode 字元（可為 emoji 序列），
 * 且不能是未指派、私用區、控制字元或孤立代理碼。回傳錯誤訊息，或 null 表示通過。
 */
export function validateGlyph(input: string): string | null {
  const s = input.trim();
  if (!s) return "請輸入一個符號";
  const Seg = (Intl as any).Segmenter;
  const graphemes: string[] = Seg ? [...new Seg(undefined, { granularity: "grapheme" }).segment(s)].map((x: any) => x.segment) : Array.from(s);
  if (graphemes.length !== 1) return "只能輸入單一個字元／符號";
  for (const ch of Array.from(s)) {
    if (/[\p{Cn}\p{Co}\p{Cc}\p{Cs}]/u.test(ch)) {
      return `「${ch}」不是標準 Unicode 字元（未指派、私用區或控制字元）`;
    }
  }
  return null;
}
