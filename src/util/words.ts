/**
 * 字數統計：略過 YAML 前言。中文／日文（漢字、假名）／韓文每個字算 1；
 * 英文與數字以「連續字母數字」為一個詞算 1；標點符號、空白、emoji 等不計入。
 * 用 for..of（依 code point 迭代，不受代理對／UTF-16 影響）逐字判斷，
 * 也涵蓋輔助平面的罕用漢字（如 U+20000 以上的擴展區）。
 */
const CJK_RANGES: [number, number][] = [
  [0x3040, 0x30ff], // 平假名／片假名
  [0x3130, 0x318f], // 諺文相容字母
  [0x3400, 0x4dbf], // CJK 擴展 A
  [0x4e00, 0x9fff], // CJK 統一表意文字
  [0xac00, 0xd7a3], // 諺文音節
  [0xf900, 0xfaff], // CJK 相容表意文字
  [0xff66, 0xff9f], // 半形片假名
  [0x20000, 0x2fa1f], // CJK 擴展 B–F（輔助平面，罕用漢字）
];

function isCJK(codePoint: number): boolean {
  return CJK_RANGES.some(([a, b]) => codePoint >= a && codePoint <= b);
}

export function countWords(text: string): number {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  let count = 0;
  let inWordRun = false;
  for (const ch of body) {
    const cp = ch.codePointAt(0) as number;
    if (isCJK(cp)) { count++; inWordRun = false; continue; }
    if (/[\p{L}\p{N}]/u.test(ch)) { if (!inWordRun) count++; inWordRun = true; continue; }
    inWordRun = false;
  }
  return count;
}
