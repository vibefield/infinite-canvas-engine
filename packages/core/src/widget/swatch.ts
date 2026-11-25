/** A swatch a host shows (petitions I61, I62): a CSS colour as a word, at most 64 characters — the kind's own; nothing here parses it. */
export const isSwatch = (s: unknown): s is string => typeof s === "string" && s.length > 0 && s.length <= 64;
