// THE RIGS' FETCHES (K-H): on a loaded host a local fetch is dropped now and then ("Failed to fetch") or the rigs' static server
// (scripts/server.mjs) answers a transient 5xx — each is retried with backoff (100 ms, doubling, six tries) before it fails. A 404 is
// the file's ABSENCE and final at once (the server says 404 for that alone). The rig page and the parity page fetch through here;
// the product's own fetches are not the rigs' to change.

export async function fetchRetry(url: string, init?: RequestInit, tries = 6): Promise<Response> {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, init);
      if (res.ok || res.status === 404 || i >= tries - 1) return res;
    } catch (e) {
      if (i >= tries - 1) throw e;
    }
    await new Promise((r) => setTimeout(r, 100 * 2 ** i));
  }
}

export async function bytesOf(url: string): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetchRetry(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function jsonOf<T>(url: string): Promise<T> {
  const res = await fetchRetry(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}
