/** Servidor local mínimo para pré-visualizar a pasta site/ em http://localhost:5173 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = "site";
const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
const port = Number(process.env.PORT ?? 5173);
createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "") || "index.html";
  if (rel.startsWith("..")) return void res.writeHead(400).end();
  try {
    const body = await readFile(join(root, rel));
    res.writeHead(200, { "content-type": types[extname(rel)] ?? "application/octet-stream", "cache-control": "no-cache" }).end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, () => console.log(`Página em http://localhost:${port}  (Ctrl+C para parar)`));
