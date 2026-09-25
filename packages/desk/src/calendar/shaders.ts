// Assemble the calendar pass's shader parts from raw text — the browser with `?raw` imports, a Node host
// with readFileSync; byte-identical either way. The notebook's module comes along: the pad is the
// notebook's paper and cloth under the same colour chain.

import type { ShaderPart } from "../engine/shader";

export interface CalendarShaders {
  readonly modules: readonly ShaderPart[];   // mat, notebook, calendar
  readonly entry: ShaderPart;                // calendar-pass
  readonly composite: ShaderPart;            // the notebook's composite (a resolved layer, premultiplied)
}

export interface CalendarShaderText {
  readonly mat: string;
  readonly notebook: string;
  readonly calendar: string;
  readonly pass: string;
  readonly composite: string;
}

export const CALENDAR_SHADER_FILES: Record<keyof CalendarShaderText, string> = {
  mat: "mat/mat.wgsl",
  notebook: "notebook/notebook.wgsl",
  calendar: "calendar/calendar.wgsl",
  pass: "calendar/calendar-pass.wgsl",
  composite: "notebook/notebook-composite.wgsl",
};

export function calendarShaders(t: CalendarShaderText): CalendarShaders {
  const part = (label: string, text: string): ShaderPart => ({ label, text });
  return {
    modules: [part("mat/mat.wgsl", t.mat), part("notebook/notebook.wgsl", t.notebook), part("calendar/calendar.wgsl", t.calendar)],
    entry: part("calendar/calendar-pass.wgsl", t.pass),
    composite: part("notebook/notebook-composite.wgsl", t.composite),
  };
}
