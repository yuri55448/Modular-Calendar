import type { Moment } from "moment";
import { moment } from "obsidian";
import { ActionModule, CellModule, DateRange, DayContext, FIXED_SLOTS, FixedSlot, Provider, SlotName } from "./types";
import { CalendarSettings } from "./settings";

/** fixed：各固定插槽裡啟用的模塊；rows：日期下方資訊區的每一列（已濾掉關閉的模塊與空列） */
export interface ActiveLayout {
  fixed: Record<FixedSlot, CellModule[]>;
  rows: CellModule[][];
}

export class Registry {
  providers = new Map<string, Provider>();
  cells = new Map<string, CellModule>();
  actions = new Map<string, ActionModule>();

  registerProvider(p: Provider) { this.providers.set(p.id, p); }
  registerCell(c: CellModule) { this.cells.set(c.id, c); }
  registerAction(a: ActionModule) { this.actions.set(a.id, a); }

  /** 依設定解析出實際啟用、且有排進插槽的模塊 */
  activeLayout(s: CalendarSettings): ActiveLayout {
    const resolve = (ids: string[]) => ids
      .filter((id) => !s.disabledModules.includes(id))
      .map((id) => this.cells.get(id))
      .filter((m): m is CellModule => !!m);
    const fixed = {} as Record<FixedSlot, CellModule[]>;
    for (const slot of FIXED_SLOTS) fixed[slot] = resolve(s.layout[slot] ?? []);
    const rows = (s.infoRows ?? []).map(resolve).filter((r) => r.length > 0);
    return { fixed, rows };
  }

  /** 只載入「有啟用模塊需要」的 Provider（extra：模塊以外的功能，如週統計，額外需要的 Provider） */
  requiredProviders(layout: ActiveLayout, extra: string[] = []): Provider[] {
    const ids = new Set<string>(extra);
    for (const m of [...FIXED_SLOTS.flatMap((slot) => layout.fixed[slot]), ...layout.rows.flat()]) m.requires.forEach((r) => ids.add(r));
    return [...ids].map((id) => this.providers.get(id)).filter((p): p is Provider => !!p);
  }

  async loadProviders(layout: ActiveLayout, range: DateRange, extra: string[] = []) {
    await Promise.all(
      this.requiredProviders(layout, extra).map((p) => p.load(range).catch((e) => console.warn(`[dcal] provider ${p.id} failed`, e)))
    );
  }

  buildContext(date: Moment, month: Moment, providers: Provider[], slot: (n: SlotName) => HTMLElement): DayContext {
    const data: Record<string, any> = {};
    for (const p of providers) data[p.id] = p.get(date);
    return {
      date,
      isToday: date.isSame(moment(), "day"),
      isOutsideMonth: !date.isSame(month, "month"),
      data,
      slot,
    };
  }
}
