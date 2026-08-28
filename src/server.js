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
const workerToken = process.env.WORKER_TOKEN || "";
const hostedMode = process.env.HOSTED_MODE === "1";
const workerStatusFile = path.join(root, "data", "worker-status.json");

function workerAuthorized(req) {
  return Boolean(workerToken) && (req.headers.authorization === `Bearer ${workerToken}` || req.headers["x-worker-token"] === workerToken);
}

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
    if (req.method === "GET" && req.url === "/api/health") return send(res, 200, JSON.stringify({ ok: true, service: "ppcguru-spam-cleanup" }));
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
    if (req.url.startsWith("/api/worker/") && !workerAuthorized(req)) return send(res, 401, JSON.stringify({ error: "Unauthorized worker" }));
    if (req.method === "GET" && req.url === "/api/worker/next") {
      const requests = store.read().requests.filter((r) => r.approved && !["submitted", "processing"].includes(r.status));
      return send(res, 200, JSON.stringify({ requests }));
    }
    if (req.method === "POST" && req.url === "/api/worker/heartbeat") {
      const input = await body(req);
      const status = {
        status: input.status || "connecting",
        message: input.message || "Windows GSC worker is online.",
        checkedAt: new Date().toISOString()
      };
      fs.mkdirSync(path.dirname(workerStatusFile), { recursive: true });
      fs.writeFileSync(workerStatusFile, `${JSON.stringify(status, null, 2)}\n`);
      return send(res, 200, JSON.stringify(status));
    }
    if (req.method === "POST" && /^\/api\/worker\/requests\/[^/]+\/status$/.test(req.url)) {
      const id = req.url.split("/")[4];
      const input = await body(req);
      const allowed = ["processing", "submitted", "failed"];
      if (!allowed.includes(input.status)) return send(res, 400, JSON.stringify({ error: "Invalid status" }));
      return send(res, 200, JSON.stringify(store.update(id, { status: input.status, error: input.error || "", submittedAt: input.status === "submitted" ? new Date().toISOString() : undefined })));
    }
    if (req.method === "GET" && req.url === "/api/gsc/status") {
      if (hostedMode) {
        const status = fs.existsSync(workerStatusFile)
          ? JSON.parse(fs.readFileSync(workerStatusFile, "utf8"))
          : { status: "not-connected", message: "Start connect-gsc.ps1 on the Windows worker." };
        const age = status.checkedAt ? Date.now() - Date.parse(status.checkedAt) : Infinity;
        if (age > 120_000) return send(res, 200, JSON.stringify({ status: "not-connected", message: "Windows GSC worker is offline. Start connect-gsc.ps1." }));
        return send(res, 200, JSON.stringify(status));
      }
      const file = path.join(root, "data", "gsc-connection.json");
      const status = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { status: "not-connected", message: "Connect the dedicated Google account." };
      return send(res, 200, JSON.stringify(status));
    }
    if (req.method === "POST" && req.url === "/api/gsc/connect") {
      if (hostedMode) return send(res, 409, JSON.stringify({ error: "GSC runs on the Windows worker. Start connect-gsc.ps1 on that computer." }));
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

const host = process.env.HOST || "0.0.0.0";
server.listen(port, host, () => console.log(`PPC Guru Spam Cleanup listening on ${host}:${port}`));
