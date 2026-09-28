// The desk clock as the desk reads it (design-016 K8b): a THIRD-PARTY kind found by its OBJECT through the SDK's own doors — its
// kind, its tray entry, its menu act and held tools with their own glyphs, what it provides — and its world half on a fake host:
// the hands at a pinned time, the registered wake (a second clock is due at the next second, a minute clock at the next minute, a
// pinned or undrawn one never), the round pick, the chip, the marks' frame, the look. (Until K8b the only "third-party kind" test
// was object.test's, over `paperKind()` imported from the reference kinds.)
import { createWorld, type Entity, type HeldToolApi, type MenuActionApi } from "@vibecook/ice";
import { CONTAINABLE, DESK_OBJECT, defineObject, driversOf, hostOf, type KindDriverHost, type ObjectContext, objectKindOf } from "@vibecook/ice/desk";
import { DEFAULT_GRID, lampOf, PAPER_FINISH } from "@vibecook/ice/desk/kit";
import { describe, expect, it } from "vitest";
import { CLOCK, CLOCK_KIND, CLOCK_SECONDS_ACT, CLOCK_TOOLS, CLOCK_TYPE, type ClockGeometry, type ClockInstance, type ClockLocal, clockKind, clockLook, DeskClock, SECONDS_GLYPH, SHOP_TIME, timeOfDay } from "../src";

const deg = (r: number): number => (r * 180) / Math.PI;
/** 2026-09-28 10:08:42.300 UTC. */
const AT = Date.UTC(2026, 8, 28, 10, 8, 42) + 300;
const lamp = lampOf(DEFAULT_GRID.mat.plane);
const ctxOf = (e: number, props: Record<string, unknown>, extra: Partial<ObjectContext> = {}): ObjectContext => ({
  entity: e as Entity, rect: { cx: 100, cy: 80, w: CLOCK.size, h: CLOCK.size }, props, flux: { lift: 0, hover: 0, ring: 0, fade: 1 },
  look: clockLook(), theme: {} as never, lamp, view: { camX: 0, camY: 0, zoom: 1, width: 1200, height: 800, dpr: 2 }, grid: DEFAULT_GRID, dt: 0, ...extra,
});
const PROPS = { style: "classic", ring24: false, seconds: true, zone: "+00:00" };

describe("the desk clock is found by its OBJECT, through the SDK's doors alone (K8b — K-L2)", () => {
  const kind = objectKindOf(DeskClock);

  it("its kind is the clock's: a thing, its own program, a world half, a desk state; no driver and no DOM half", () => {
    expect(kind?.name).toBe(CLOCK_KIND);
    expect(kind?.stratum).toBe("things");
    expect(typeof kind?.create).toBe("function");
    expect(typeof kind?.local).toBe("function");
    expect(DeskClock.stratum).toBe("things");
    expect(DeskClock.defaultSize).toEqual({ w: CLOCK.size, h: CLOCK.size });
    // D-K8b.1: a clock's live motion is its desk state's registered wake — flux on the desk, never a driver, never a behavior
    expect(driversOf(DeskClock)).toBeUndefined();
    expect(hostOf(DeskClock)).toBeUndefined();
  });

  it("it hangs on the pegboard by its own entry, lies on the desk and goes into a mini mat by what it provides", () => {
    expect(DeskClock.tray).toMatchObject({ label: "Clock", category: "things", hang: { accessory: "hook" } });
    expect(DeskClock.provides).toEqual(expect.arrayContaining([CLOCK_TYPE, DESK_OBJECT, CONTAINABLE]));
  });

  it("its menu act and its held tools carry its OWN glyphs; it opens, and the bar's tools are its", () => {
    expect(DeskClock.menu.map((a) => a.id)).toEqual([CLOCK_SECONDS_ACT]);
    expect(DeskClock.menu[0]?.glyph).toEqual({ path: SECONDS_GLYPH });
    expect(DeskClock.openable).toBe(true);
    expect(DeskClock.heldTools.map((t) => t.id)).toEqual(["seconds", "ring24", "zone-back", "zone-ahead", "dial"]);
    for (const t of DeskClock.heldTools) expect(typeof t.glyph === "object" && t.glyph !== null && "path" in t.glyph, t.id).toBe(true);
  });

  it("its menu act flips the seconds hand of every selected clock to the first's opposite, one write each", () => {
    const writes: [number, Record<string, unknown>][] = [];
    const props: Record<number, Record<string, unknown>> = { 1: { seconds: true }, 2: { seconds: false } };
    const api = { world: createWorld(), entities: [1, 2] as Entity[], props: (e: Entity) => props[e as number] ?? {}, setProps: (e: Entity, p: Record<string, unknown>) => { writes.push([e as number, p]); return true; }, transact: () => true } as unknown as MenuActionApi;
    DeskClock.menu[0]?.run(api);
    expect(writes).toEqual([[1, { seconds: false }], [2, { seconds: false }]]);
  });

  it("its held tools set it: the seconds hand, the ring, the zone an hour either way, the next dial", () => {
    let props: Record<string, unknown> = { ...PROPS };
    const api = { props: () => props, setProps: (p: Record<string, unknown>) => { props = { ...props, ...p }; return true; } } as unknown as HeldToolApi;
    const use = (id: string) => CLOCK_TOOLS.find((t) => t.id === id)?.run?.(api);
    use("seconds"); expect(props.seconds).toBe(false);
    use("ring24"); expect(props.ring24).toBe(true);
    use("zone-ahead"); expect(props.zone).toBe("+01:00");
    use("zone-back"); use("zone-back"); expect(props.zone).toBe("-01:00");
    use("dial"); expect(props.style).toBe("station");
    use("dial"); use("dial"); expect(props.style).toBe("classic");
  });

  it("a plugin kind MAY declare drivers as a built-in does: the desk finds them by the object, a host makes them from what it lends", () => {
    const made: string[] = [];
    const Driven = defineObject({
      type: "k8b.driven-clock", kind: clockKind(),
      drivers: (h) => ({ follow: (now) => { made.push(`follow ${now} ${h.isKind(7 as Entity)}`); }, idle: () => made.length > 0 }),
    });
    const host = { world: createWorld(), isKind: (e: Entity) => e === 7, wake: () => {} } as unknown as KindDriverHost;
    const d = driversOf(Driven)?.(host);
    expect(d?.idle?.()).toBe(false);
    d?.follow(16);
    expect(made).toEqual(["follow 16 true"]);
    expect(d?.idle?.()).toBe(true);
  });
});

describe("the desk clock's world half", () => {
  it("a PINNED time stands its hands there (a still's) and the desk never waits on it", () => {
    let wall = AT;
    const k = clockKind({ now: () => wall });
    const local = k.local?.({ pass: () => undefined }) as ClockLocal;
    const c = ctxOf(1, PROPS, { local, asset: { at: Date.UTC(2026, 8, 28, 10, 8, 42) } });
    const R = k.record(k.resolve(c), c) as ClockInstance;
    expect(deg(R.hands.hour)).toBeCloseTo(304.35, 6);
    expect(deg(R.hands.minute)).toBeCloseTo(52.2, 6);
    expect(deg(R.hands.second)).toBeCloseTo(252, 6);
    expect(local.shown(1 as Entity)).toMatchObject({ pinned: true, tod: 10 * 3600 + 8 * 60 + 42 });
    expect(local.waiting()).toBe(0);
    expect(local.due(5000)).toBe(Number.POSITIVE_INFINITY);
    wall += 10_000;
    expect(local.tick(5000)).toBe(false);
  });

  it("THE REGISTERED WAKE: a seconds clock is due at the next second, turns there (restless once), and is due again a second on", () => {
    let wall = AT;   // 300 ms into the second
    const k = clockKind({ now: () => wall });
    const local = k.local?.({ pass: () => undefined }) as ClockLocal;
    const draw = (): ClockInstance => { const c = ctxOf(1, PROPS, { local }); return k.record(k.resolve(c), c) as ClockInstance; };
    expect(deg(draw().hands.second)).toBeCloseTo(252, 6);
    expect(local.waiting()).toBe(1);
    const now = 1000;   // the frame clock
    expect(local.due(now)).toBeCloseTo(now + 700 - 4, 6);   // the wall's next second, a hair early
    wall += 500;
    expect(local.tick(now + 500)).toBe(false);   // nothing moved: no frame
    wall += 195;   // 5 ms before the boundary: not yet
    expect(local.tick(now + 695)).toBe(false);
    wall += 1;   // 4 ms before it — the wake's own time: the key has turned
    expect(local.tick(now + 696)).toBe(true);
    expect(local.waiting()).toBe(0);   // the restless build remakes every drawn clock…
    expect(deg(draw().hands.second)).toBeCloseTo(258, 6);   // …which shows the next second
    expect(local.due(now + 696)).toBeCloseTo(now + 696 + 1000, 6);   // and waits a second on
  });

  it("a minute clock (no seconds hand) is due at the next minute; a clock not drawn at a move is waited on no more", () => {
    let wall = AT;
    const k = clockKind({ now: () => wall });
    const local = k.local?.({ pass: () => undefined }) as ClockLocal;
    const c = ctxOf(1, { ...PROPS, seconds: false }, { local });
    const R = k.record(k.resolve(c), c) as ClockInstance;
    expect(deg(R.hands.minute)).toBeCloseTo(48, 6);
    expect(local.due(0)).toBeCloseTo(17_700 - 4, 6);   // 10:08:42.300 → 10:09:00
    wall += 17_700;
    expect(local.tick(0)).toBe(true);
    // not recorded again (culled): nothing to wait on — a desk with no clock drawn takes no frame for clocks
    expect(local.due(0)).toBe(Number.POSITIVE_INFINITY);
    local.saw(2 as Entity, 60_000, 0);
    local.forget?.(2 as Entity);
    expect(local.waiting()).toBe(0);
  });

  it("with no desk state at all (a specimen on the pegboard) it shows the shop's 10:10:30", () => {
    const k = clockKind();
    const c = ctxOf(1, PROPS);
    const R = k.record(k.resolve(c), c) as ClockInstance;
    expect(R.hands).toEqual(clockKind({ now: () => 0 }).record(k.resolve(c), ctxOf(1, PROPS, { asset: { at: Date.UTC(2026, 0, 1, 10, 10, 30) } })).hands);
    expect(timeOfDay(Date.UTC(2026, 0, 1, 10, 10, 30), "+00:00")).toBe(SHOP_TIME);
  });

  it("a zone moves the hour: +09:00 shows 19:08:42 for 10:08:42 UTC", () => {
    const k = clockKind();
    const c = ctxOf(1, { ...PROPS, zone: "+09:00" }, { asset: { at: AT } });
    expect(deg((k.record(k.resolve(c), c) as ClockInstance).hands.hour)).toBeCloseTo(((19 % 12) + 8.7 / 60) * 30, 6);
  });

  it("PICKED BY ITS ROUND FACE: inside the case is the clock, the rect's corner is not", () => {
    const k = clockKind();
    const G = k.resolve(ctxOf(1, PROPS)) as ClockGeometry;
    expect(k.hit(G, 100, 80)).toBe("content");
    expect(k.hit(G, 100 + 74, 80)).toBe("content");
    expect(k.hit(G, 100 + 70, 80 + 70)).toBeNull();   // in the rect (±75), off the round case (r = 99)
    expect(k.hit(G, 100 + 76, 80)).toBeNull();
  });

  it("its chip is a disc of its dial in the paper finish, its marks go round the round case, a lifted case is bigger", () => {
    const k = clockKind();
    const c = ctxOf(1, { ...PROPS, style: "graphite" });
    const G = k.resolve(c) as ClockGeometry;
    const chip = k.chip?.(G, c);
    expect(chip).toMatchObject({ finish: PAPER_FINISH, cx: 100, cy: 80, hx: 75, hy: 75, radius: 75, angle: 0, colour: clockLook().styles.graphite.dial });
    expect(k.frame?.(G)).toEqual({ cx: 100, cy: 80, hx: 75, hy: 75, angle: 0, r: 75 });
    const held = k.resolve(ctxOf(1, PROPS, { flux: { lift: 1, hover: 0, ring: 0, fade: 1 } })) as ClockGeometry;
    expect(held.radius).toBeGreaterThan(G.radius);
    expect(held.lift).toBe(CLOCK.lift.height);
  });

  it("its look is its own palette's unless the host's names the clocks", () => {
    const k = clockKind();
    const own = k.theme?.({ canvasBg: { token: "x", css: "#000" }, select: { token: "y", css: "#fff" } }, "light");
    expect(own).toEqual(clockLook());
    const red = { token: "t", css: "#ff0000" };
    const dial = { dial: red, grain: 0, ink: red, case: red, metal: 0, hands: red, second: red, lume: red, glow: 0 };
    const theirs = k.theme?.({ canvasBg: red, select: red, clocks: { classic: dial, station: dial, graphite: dial } } as never, "dark");
    expect(theirs?.styles.classic.dial).toEqual([1, 0, 0]);
  });
});
