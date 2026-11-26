// THE HAND'S FACES in a browser (petition I59 — the desk's pen; the `HAND_FACES` service, kit/hand-faces.ts): the baked
// `ice-hand/1` atlases the APP ships (apps/desk: assets/hand/<face>.hand.json and .hand.bin), by URL, as host/ink.ts takes the
// fonts by URL. A face is fetched ONCE, lazily, on its first ask — both files, read by the kit's tolerant reader
// (`readHandAtlas`) — and until it lands `face()` answers undefined and `loading()` true (a sheet waits blank); `version()` bumps
// when it lands, or when it is found missing or malformed (said once on the console — its sheets keep their raster road), and
// `onVersion` tells the desk, which wakes (`deskLayer({ hand })` subscribes, as it does `text`'s).

import { type HandAtlas, readHandAtlas } from "../kit/hand-atlas";
import type { HandFaces } from "../kit/hand-faces";

/** A face's two files, by URL: the atlas's json and its RG8 texels. */
export interface HandFaceFiles {
  readonly json: string;
  readonly bin: string;
}

export interface HandFacesOptions {
  /** The faces by name (`PEN_FACES`'s names: `caveat`, `caveat-bold`, `kalam`). */
  readonly faces: Readonly<Record<string, HandFaceFiles>>;
  /** How a file is fetched (the window's `fetch` unless a host hands another). */
  readonly fetch?: (url: string) => Promise<{ readonly ok: boolean; readonly status: number; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> }>;
}

export interface HandFacesLender extends HandFaces {
  /** Tell `fn` whenever a face lands or is found missing (the desk wakes: `deskLayer({ hand })` subscribes). Returns an unsubscribe. */
  onVersion(fn: () => void): () => void;
  /** Is the face lent here and neither landed nor failed — from before its first ask until its files are read (a sheet waits blank)? */
  loading(name: string): boolean;
  /** Fetch a face (once): resolves whether it landed. `face()` asks for this itself. */
  load(name: string): Promise<boolean>;
  /** Has the face landed? */
  ready(name: string): boolean;
  /** Why a face did not land (a fetch's status, the reader's error), or undefined. */
  failed(name: string): string | undefined;
}

/** The desk's faces by URL — `handFaces({ faces: { caveat: { json, bin }, … } })` — fetched on their first ask. */
export function handFaces(opts: HandFacesOptions): HandFacesLender {
  const get = opts.fetch ?? ((url: string) => fetch(url));
  const loads = new Map<string, Promise<boolean>>();
  const landed = new Map<string, HandAtlas>();
  const errors = new Map<string, string>();
  const listeners = new Set<() => void>();
  let version = 0;
  const bump = (): void => {
    version += 1;
    for (const fn of [...listeners]) fn();
  };

  const fetchFace = async (name: string, files: HandFaceFiles): Promise<HandAtlas | string> => {
    const [j, b] = await Promise.all([get(files.json), get(files.bin)]);
    if (!j.ok) return `its json answered ${j.status}`;
    if (!b.ok) return `its bin answered ${b.status}`;
    const read = readHandAtlas(await j.json(), new Uint8Array(await b.arrayBuffer()));
    return "error" in read ? read.error : read;
  };

  const load = (name: string): Promise<boolean> => {
    let p = loads.get(name);
    if (p !== undefined) return p;
    const files = opts.faces[name];
    p = (files === undefined ? Promise.resolve<HandAtlas | string>("the desk lends no such face") : fetchFace(name, files))
      .catch((e: unknown) => (e instanceof Error ? e.message : String(e)))
      .then((got) => {
        if (typeof got === "string") {
          errors.set(name, got);
          if (files !== undefined) console.error(`[ice] desk: the hand's face "${name}" did not load — ${got}; its sheets keep their raster`);
        } else landed.set(name, got);
        bump();   // every run built from the face is built again — with it, or honestly without it
        return typeof got !== "string";
      });
    loads.set(name, p);
    return p;
  };

  return {
    face(name) {
      const a = landed.get(name);
      if (a === undefined && !loads.has(name)) void load(name);
      return a;
    },
    version: () => version,
    onVersion(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    load,
    loading: (name) => Object.hasOwn(opts.faces, name) && !landed.has(name) && !errors.has(name),
    ready: (name) => landed.has(name),
    failed: (name) => errors.get(name),
  };
}
