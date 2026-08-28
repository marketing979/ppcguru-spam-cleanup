import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { analyze, loadConfig, toCsv } from "./core.js";
import { createStore } from "./store.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = loadConfig(path.join(root, "config", "default.json"));
const publicDir = path.join(root, "public");
const port = Number(process.env.PORT || 4310);
const store = createStore(root);
let connectionProcess = null;

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "x-content-type-options": "nosniff" });
  res.end(body);
}

async function body(req) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 5_000_000) throw new Error("Payload too large");
  }
  return JSON.parse(data || "{}");
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/analyze") {
      const input = await body(req);
      const report = await analyze(input.urls || "", config, {
        checkHttp: Boolean(input.checkHttp),
        allowlist: input.allowlist || [],
        legitimateUrls: input.legitimateUrls || []
      });
      return send(res, 200, JSON.stringify(report));
    }
    if (req.method === "POST" && req.url === "/api/export.csv") {
      const input = await body(req);
      return send(res, 200, toCsv(input.items || []), "text/csv; charset=utf-8");
    }
    if (req.method === "GET" && req.url === "/api/registry") return send(res, 200, JSON.stringify(store.read()));
    if (req.method === "GET" && req.url === "/api/gsc/status") {
      const file = path.join(root, "data", "gsc-connection.json");
      const status = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { status: "not-connected", message: "Connect the dedicated Google account." };
      return send(res, 200, JSON.stringify(status));
    }
    if (req.method === "POST" && req.url === "/api/gsc/connect") {
      if (!connectionProcess || connectionProcess.exitCode !== null) {
        connectionProcess = spawn(process.execPath, [path.join(root, "src", "gsc-connect.js")], { cwd: root, detached: true, stdio: "ignore", windowsHide: true });
        connectionProcess.unref();
      }
      return send(res, 202, JSON.stringify({ status: "connecting" }));
    }
    if (req.method === "POST" && req.url === "/api/queue/import") {
      const input = await body(req);
      const requests = [
        ...(input.prefixes?.suggestions || []).map((p) => ({ type: "prefix", value: new URL(p.prefix, config.siteOrigin).toString(), evidenceCount: p.count })),
        ...(input.prefixes?.exactUrls || []).map((value) => ({ type: "exact", value, evidenceCount: 1 }))
      ];
      return send(res, 200, JSON.stringify(store.importRequests(requests)));
    }
    if (req.method === "POST" && /^\/api\/requests\/[^/]+\/(approve|reject)$/.test(req.url)) {
      const [, , , id, action] = req.url.split("/");
      const approved = action === "approve";
      return send(res, 200, JSON.stringify(store.update(id, { approved, status: approved ? "approved" : "rejected" })));
    }
    const requested = req.url === "/" ? "index.html" : req.url.slice(1);
    if (!/^[a-zA-Z0-9._-]+$/.test(requested)) return send(res, 404, "Not found", "text/plain");
    const file = path.join(publicDir, requested);
    if (!fs.existsSync(file)) return send(res, 404, "Not found", "text/plain");
    const type = requested.endsWith(".css") ? "text/css" : requested.endsWith(".js") ? "text/javascript" : "text/html";
    return send(res, 200, fs.readFileSync(file), `${type}; charset=utf-8`);
  } catch (error) {
    return send(res, 400, JSON.stringify({ error: error.message }));
  }
});

server.listen(port, "127.0.0.1", () => console.log(`PPC Guru Spam Cleanup running at http://127.0.0.1:${port}`));
