import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "./store.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [command, file] = process.argv.slice(2);
if (command !== "import" || !file) {
  console.log("Usage: node src/queue.js import analysis-report.json"); process.exit(1);
}
const report = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
const requests = [
  ...report.prefixes.suggestions.map((p) => ({ type: "prefix", value: new URL(p.prefix, report.siteOrigin).toString(), evidenceCount: p.count })),
  ...report.prefixes.exactUrls.map((value) => ({ type: "exact", value, evidenceCount: 1 }))
];
const data = createStore(root).importRequests(requests);
console.log(JSON.stringify({ importedCandidates: requests.length, registryTotal: data.requests.length, approvalRequired: true }, null, 2));
