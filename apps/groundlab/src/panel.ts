// The tweak panel: a declarative schema of rows bound to the lab's params,
// rendered as an island (chrome material, hairline, the text ramp). Nothing
// here knows what a parameter means — main.ts supplies getters and setters.

export type Row =
  | { kind: "range"; label: string; min: number; max: number; step: number; get: () => number; set: (v: number) => void; unit?: string }
  | { kind: "select"; label: string; options: readonly string[]; get: () => string; set: (v: string) => void }
  | { kind: "toggle"; label: string; get: () => boolean; set: (v: boolean) => void }
  | { kind: "color"; label: string; alpha: boolean; get: () => readonly number[]; set: (v: number[]) => void }
  | { kind: "actions"; items: { label: string; run: () => void }[] }
  | { kind: "note"; get: () => string };

export interface Section { title: string; rows: Row[]; open?: boolean }

const hex = (c: readonly number[]) => `#${c.slice(0, 3).map((v) => Math.round(Math.min(Math.max(v, 0), 1) * 255).toString(16).padStart(2, "0")).join("")}`;
const unhex = (h: string) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255);
const fmt = (v: number, step: number) => (step >= 1 ? String(Math.round(v)) : v.toFixed(Math.min(3, Math.max(0, -Math.floor(Math.log10(step))))));

export function mountPanel(root: HTMLElement, sections: Section[], onChange: () => void): { refresh: () => void; toggle: () => void; readonly open: boolean } {
  const refreshers: (() => void)[] = [];
  const el = (tag: string, cls?: string, text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const changed = () => { onChange(); for (const r of refreshers) r(); };

  for (const sec of sections) {
    const details = el("details", "p-section") as HTMLDetailsElement;
    details.open = sec.open ?? false;
    details.appendChild(el("summary", "p-title", sec.title));
    for (const row of sec.rows) {
      const line = el("div", `p-row p-${row.kind}`);
      if (row.kind === "range") {
        line.appendChild(el("label", "p-label", row.label));
        const num = el("input", "p-num") as HTMLInputElement; num.type = "number"; num.step = String(row.step); num.min = String(row.min); num.max = String(row.max);
        const slider = el("input", "p-slider") as HTMLInputElement; slider.type = "range"; slider.step = String(row.step); slider.min = String(row.min); slider.max = String(row.max);
        const unit = el("span", "p-unit", row.unit ?? "");
        const sync = () => { const v = row.get(); num.value = fmt(v, row.step); slider.value = String(v); };
        const apply = (v: number) => { if (Number.isFinite(v)) { row.set(v); changed(); } };
        slider.addEventListener("input", () => apply(Number(slider.value)));
        num.addEventListener("change", () => apply(Number(num.value)));
        line.append(num, unit, slider); refreshers.push(sync); sync();
      } else if (row.kind === "select") {
        line.appendChild(el("label", "p-label", row.label));
        const sel = el("select", "p-select") as HTMLSelectElement;
        for (const o of row.options) { const opt = el("option", undefined, o) as HTMLOptionElement; opt.value = o; sel.appendChild(opt); }
        sel.addEventListener("change", () => { row.set(sel.value); changed(); });
        const sync = () => { sel.value = row.get(); };
        line.appendChild(sel); refreshers.push(sync); sync();
      } else if (row.kind === "toggle") {
        const lab = el("label", "p-label p-check");
        const box = el("input") as HTMLInputElement; box.type = "checkbox";
        box.addEventListener("change", () => { row.set(box.checked); changed(); });
        lab.append(box, document.createTextNode(row.label));
        const sync = () => { box.checked = row.get(); };
        line.appendChild(lab); refreshers.push(sync); sync();
      } else if (row.kind === "color") {
        line.appendChild(el("label", "p-label", row.label));
        const pick = el("input", "p-color") as HTMLInputElement; pick.type = "color";
        const alpha = el("input", "p-num") as HTMLInputElement; alpha.type = "number"; alpha.min = "0"; alpha.max = "1"; alpha.step = "0.01";
        const apply = () => { const rgb = unhex(pick.value); row.set(row.alpha ? [...rgb, Number(alpha.value)] : rgb); changed(); };
        pick.addEventListener("input", apply); alpha.addEventListener("change", apply);
        const sync = () => { const c = row.get(); pick.value = hex(c); alpha.value = (c[3] ?? 1).toFixed(2); alpha.hidden = !row.alpha; };
        line.append(pick, alpha); refreshers.push(sync); sync();
      } else if (row.kind === "actions") {
        for (const a of row.items) { const b = el("button", "p-btn", a.label) as HTMLButtonElement; b.type = "button"; b.addEventListener("click", () => { a.run(); changed(); }); line.appendChild(b); }
      } else {
        const note = el("div", "p-note"); const sync = () => { note.textContent = row.get(); note.hidden = !note.textContent; };
        line.appendChild(note); refreshers.push(sync); sync();
      }
      details.appendChild(line);
    }
    root.appendChild(details);
  }
  return {
    refresh: () => { for (const r of refreshers) r(); },
    toggle: () => { root.hidden = !root.hidden; },
    get open() { return !root.hidden; },
  };
}
