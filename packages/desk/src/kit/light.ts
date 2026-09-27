// The desk's ONE LAMP and its light, as a kind reads them (design-016 §5): the lamp over a desk point (`lampOf` — the
// projector's position in world units, what every object's shadow is cast away from), the Sun's light that a pass
// falls back to (`DAY_LIGHT`), and the sRGB → linear step a kind's colours take on their way to the GPU. The
// definitions are the mat's (mat/lamp.ts, mat/night.ts); this is the door a kind names them through.

export { type Lamp, lampOf } from "../mat/lamp";
export { DAY_LIGHT, linear, type MatLight } from "../mat/night";
export type { ProjectorSpec, Quat, Vec3 } from "../mat/projector";
