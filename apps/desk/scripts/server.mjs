// Static file server with COOP/COEP so the page is crossOriginIsolated
// (performance.now() at ~5us instead of 100us coarsening).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = process.argv[2] ?? process.cwd();
const PORT = Number(process.argv[3] ?? 0);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wgsl": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".ttf": "font/ttf",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let path = normalize(decodeURIComponent(url.pathname));
    if (path.endsWith("/")) path += "index.html";
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-embedder-policy": "require-corp",
      "cross-origin-resource-policy": "same-origin",
    });
    res.end(body);
  } catch (e) {
    // 404 is a file's ABSENCE, and only that; anything else (a loaded host's EMFILE, a read that failed) is a 500 the rigs' fetches retry (K-H)
    const absent = e?.code === "ENOENT" || e?.code === "ENOTDIR" || e?.message === "not a file";
    res.writeHead(absent ? 404 : 500, { "content-type": "text/plain" }).end(absent ? "not found" : `error ${e?.code ?? e}`);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`PORT ${server.address().port}\n`);
});
