/** 中文顏色名稱 → CSS 可用色值（英文名稱如 red/blue 本身就是合法 CSS，不需轉換） */
const ZH_COLOR: Record<string, string> = {
  "紅": "red", "紅色": "red", "橙": "orange", "橙色": "orange", "黃": "gold", "黃色": "gold",
  "綠": "green", "綠色": "green", "藍": "blue", "藍色": "blue", "靛": "indigo", "靛色": "indigo",
  "紫": "purple", "紫色": "purple", "黑": "black", "黑色": "black", "白": "white", "白色": "white",
  "灰": "gray", "灰色": "gray", "粉紅": "pink", "粉色": "pink", "粉紅色": "pink",
  "棕": "brown", "棕色": "brown", "咖啡色": "brown", "金": "gold", "金色": "gold",
  "銀": "silver", "銀色": "silver", "青": "cyan", "青色": "cyan", "藏青": "navy", "深藍": "navy",
  "橘": "orange", "橘色": "orange", "天藍": "skyblue", "天藍色": "skyblue",
};

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_RE = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*[\d.]+\s*)?\)$/i;
const HSL_RE = /^hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*(?:,\s*[\d.]+\s*)?\)$/i;
/** 常見英文 CSS 顏色關鍵字，用來給出「看起來像打錯字」的提示；不在此表也不代表一定無效（CSS 關鍵字很多） */
const KNOWN_KEYWORDS = new Set([
  "red","orange","yellow","gold","green","blue","indigo","purple","black","white","gray","grey",
  "pink","brown","silver","cyan","navy","skyblue","teal","lime","maroon","olive","aqua","magenta",
  "transparent","currentcolor","inherit","violet","salmon","coral","crimson","chocolate","khaki",
]);

/** 顏色說明文字：統一放在每個顏色欄位左側（描述）裡的提示 */
export const COLOR_HINT =
  "可輸入中文色名（例：紅色＝紅色）、英文名稱（例：red＝紅色），也可以使用 RGB 顏色值 rgb(255, 255, 255) 或是 HEX 十六進位色碼 #FFFFFF";

/**
 * 把顏色與透明度（0–100）合成一個可直接用在 background 的 CSS 值。
 * color 為空字串時回傳空字串（呼叫端應改用預設樣式，不設定這個屬性）。
 */
export function toBackground(color: string, opacityPct: number): string {
  if (!color) return "";
  // 防呆：萬一 opacity 是 undefined／NaN（例如升級時欄位漏填），color-mix() 收到非數字百分比會整條
  // background 宣告失效，視覺上就像「設定了自訂顏色也沒反應」——這裡一律收斂成一個有效數字
  const n = Number(opacityPct);
  const pct = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 100;
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

/** 把使用者輸入轉成可用的 CSS 色值；回傳 { value, error }。空字串代表「跟隨主題」，永遠合法。 */
export function resolveColor(input: string | undefined | null): { value: string; error: string | null } {
  const raw = (input ?? "").trim();
  if (!raw) return { value: "", error: null };
  const zh = ZH_COLOR[raw];
  if (zh) return { value: zh, error: null };
  if (HEX_RE.test(raw) || RGB_RE.test(raw) || HSL_RE.test(raw)) return { value: raw, error: null };
  const bare = raw.toLowerCase().replace(/\s+/g, "");
  if (KNOWN_KEYWORDS.has(bare)) return { value: bare, error: null };
  // 不在已知表內：只要是純英文字母，仍當作可能合法的 CSS 顏色關鍵字（CSS 內建顏色關鍵字有 140+ 個，不逐一列舉）
  if (/^[a-z]+$/i.test(raw)) return { value: raw.toLowerCase(), error: null };
  return { value: "", error: `無法辨識的顏色「${raw}」，可用中文色名（如 紅色）、英文名稱（如 red）、RGB(255,255,255) 或 #HEX` };
}
