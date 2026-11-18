/** 貼在錨點下方的輕量浮層；點浮層外面會關閉 */
export function openPopover(anchor: HTMLElement, build: (pop: HTMLElement, close: () => void) => void) {
  const doc = anchor.ownerDocument;
  const pop = doc.body.createDiv({ cls: "dcal-popover" });

  const onDown = (e: Event) => {
    if (!pop.contains(e.target as Node)) close();
  };
  function close() {
    pop.remove();
    doc.removeEventListener("mousedown", onDown, true);
  }

  build(pop, close);

  const r = anchor.getBoundingClientRect();
  pop.style.top = `${r.bottom + 4}px`;
  const maxLeft = (doc.defaultView?.innerWidth ?? 800) - pop.offsetWidth - 8;
  pop.style.left = `${Math.max(8, Math.min(r.left, maxLeft))}px`;

  setTimeout(() => doc.addEventListener("mousedown", onDown, true), 0);
}
