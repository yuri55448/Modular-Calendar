import { moment } from "obsidian";

const WEEK = ["一", "二", "三", "四", "五", "六", "日"];

/**
 * 小月曆（點一下日期就選取）：‹ › 切換月份，今天與目前選取的日期會標出來。
 * onPick 收到 YYYY-MM-DD；呼叫端自己決定要不要關掉。
 */
export function renderMiniCalendar(host: HTMLElement, o: { value: string; onPick: (iso: string) => void }) {
  const parsed = moment(o.value, "YYYY-MM-DD", true);
  let cur = (parsed.isValid() ? parsed : moment()).clone().startOf("month");
  const draw = () => {
    host.empty();
    const today = moment().format("YYYY-MM-DD");
    const head = host.createDiv({ cls: "dcal-mc-head" });
    head.createEl("button", { cls: "dcal-mc-nav", text: "‹", attr: { title: "上個月" } }).onclick = () => { cur = cur.clone().subtract(1, "months"); draw(); };
    head.createSpan({ cls: "dcal-mc-title", text: cur.format("YYYY 年 M 月") });
    head.createEl("button", { cls: "dcal-mc-nav", text: "›", attr: { title: "下個月" } }).onclick = () => { cur = cur.clone().add(1, "months"); draw(); };
    const grid = host.createDiv({ cls: "dcal-mc-grid" });
    for (const w of WEEK) grid.createSpan({ cls: "dcal-mc-wd", text: w });
    const lead = (cur.day() + 6) % 7;                       // 星期一開頭
    for (let i = 0; i < lead; i++) grid.createSpan({ cls: "dcal-mc-blank" });
    for (let d = 1; d <= cur.daysInMonth(); d++) {
      const iso = cur.clone().date(d).format("YYYY-MM-DD");
      const cls = `dcal-mc-day${iso === today ? " is-today" : ""}${iso === o.value ? " is-sel" : ""}`;
      grid.createEl("button", { cls, text: String(d), attr: { "data-date": iso } }).onclick = () => { o.value = iso; o.onPick(iso); draw(); };
    }
  };
  draw();
}
