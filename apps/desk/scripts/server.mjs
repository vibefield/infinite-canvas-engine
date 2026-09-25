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
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`PORT ${server.address().port}\n`);
});
