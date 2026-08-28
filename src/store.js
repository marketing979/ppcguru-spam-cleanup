import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function createStore(root) {
  const dataDir = path.join(root, "data");
  const file = path.join(dataDir, "registry.json");
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ version: 1, requests: [], events: [] }, null, 2));
  const read = () => JSON.parse(fs.readFileSync(file, "utf8"));
  const write = (data) => {
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`);
    fs.renameSync(temporary, file);
  };
  return {
    read,
    importRequests(requests) {
      const data = read();
      const known = new Set(data.requests.map((r) => `${r.type}:${r.value}`));
      for (const request of requests) {
        const key = `${request.type}:${request.value}`;
        if (known.has(key)) continue;
        data.requests.push({ id: crypto.randomUUID(), ...request, approved: false, status: "pending-review", createdAt: new Date().toISOString() });
        known.add(key);
      }
      write(data); return data;
    },
    update(id, patch) {
      const data = read();
      const request = data.requests.find((r) => r.id === id);
      if (!request) throw new Error("Request not found");
      Object.assign(request, patch, { updatedAt: new Date().toISOString() });
      data.events.push({ id: crypto.randomUUID(), requestId: id, at: new Date().toISOString(), patch });
      write(data); return request;
    }
  };
}
