import { App } from "obsidian";
import { BLOCKS, CalendarSettings } from "../core/settings";

export function familyCss(choice: string, s: CalendarSettings): string {
  if (choice.startsWith("imp:")) {
    const id = choice.slice(4);
    if (s.fonts.imported.some((f) => f.id === id)) return `"dcal-font-${id}", var(--font-text), sans-serif`;
    return "inherit";
  }
  if (choice === "sys" && s.fonts.systemName.trim()) {
    return `"${s.fonts.systemName.replace(/["\\]/g, "")}", var(--font-text), sans-serif`;
  }
  return "inherit"; // theme：跟隨 Obsidian
}

export function sizeCss(base: string, mode: string, px: number): string {
  if (mode === "compact") return `calc(${base} * 0.85)`;
  if (mode === "custom") return `${px}px`;
  return base;
}

/** 把各區塊的字體與大小寫成 CSS 變數 */
export function applyStyleVars(root: HTMLElement, s: CalendarSettings) {
  for (const b of BLOCKS) {
    const cfg = s.fonts.blocks[b.id];
    root.style.setProperty(`--dcal-fs-${b.id}`, sizeCss(b.base, cfg.size, cfg.px));
    root.style.setProperty(`--dcal-ff-${b.id}`, familyCss(cfg.family === "global" ? s.fonts.global : cfg.family, s));
  }
}

/** 註冊已導入的字體檔（存在外掛資料夾的 fonts/ 內） */
export function injectFonts(app: App, s: CalendarSettings) {
  if (typeof document === "undefined") return;
  const css = s.fonts.imported
    .map((f) => `@font-face{font-family:"dcal-font-${f.id}";src:url("${app.vault.adapter.getResourcePath(f.file)}");font-display:swap;}`)
    .join("\n");
  let el = document.getElementById("dcal-fontfaces") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "dcal-fontfaces";
    document.head.appendChild(el);
  }
  el.textContent = css;
}
