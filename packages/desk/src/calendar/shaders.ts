// Assemble the calendar pass's programs from the host's shader text — the browser's generated module, a Node host's files on
// disk; byte-identical either way. The pad is the notebook's paper and cloth under the same colour chain: the kit's view
// block, the mat's light and the 3D kit (kit/wgsl.ts `book`), then the calendar's own records, module and entry; its layer
// is laid by the kit's composite.

import type { ComposeOptions } from "../engine/shader";
import { layerComposite } from "../kit/layer";
import { kitWgsl, type ShaderText } from "../kit/wgsl";
import { CalPad, CalUniforms } from "./layout";

/** The calendar's own shader files (the kit's pieces come by name). */
export const CALENDAR_SHADER_FILES = { calendar: "calendar/calendar.wgsl", pass: "calendar/calendar-pass.wgsl" } as const;

export interface CalendarShaders {
  readonly program: ComposeOptions;     // the kit's view · light · book + calendar, calendar-pass
  readonly composite: ComposeOptions;   // the kit's layer composite
}

export function calendarShaders(text: ShaderText): CalendarShaders {
  const t = text(CALENDAR_SHADER_FILES);
  return {
    program: kitWgsl(["view", "light", "book"], {
      structs: [CalUniforms, CalPad],
      modules: [{ label: "calendar/calendar.wgsl", text: t.calendar }],
      entry: { label: "calendar/calendar-pass.wgsl", text: t.pass },
    }, text),
    composite: layerComposite(text),
  };
}
