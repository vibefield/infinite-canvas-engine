// A test's "this exists": the value, or a thrown error naming the site — in place
// of the non-null assertion the gate forbids (a `!` continues with undefined; this stops).
export function must<T>(v: T | null | undefined, what = "a value"): T {
  if (v === null || v === undefined) throw new Error(`expected ${what}`);
  return v;
}
