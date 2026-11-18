export function segmented<T extends string>(
  host: HTMLElement,
  opts: { value: T; label: string }[],
  current: T,
  onChange: (v: T) => void
): HTMLElement {
  const wrap = host.createDiv({ cls: "dcal-seg" });
  for (const o of opts) {
    const b = wrap.createEl("button", { cls: "dcal-seg-btn", text: o.label });
    if (o.value === current) b.addClass("is-active");
    b.onclick = () => onChange(o.value);
  }
  return wrap;
}
