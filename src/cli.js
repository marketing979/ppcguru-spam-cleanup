import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, loadConfig, toCsv } from "./core.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const args = process.argv.slice(2);
const command = args.shift();

function arg(name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

if (command !== "analyze" || !arg("--input")) {
  console.log("Usage: node src/cli.js analyze --input urls.txt [--allowlist allowlist.txt] [--check-http] [--out report.json]");
  process.exit(command === "analyze" ? 1 : 0);
}

const config = loadConfig(arg("--config", path.join(root, "config", "default.json")));
const input = fs.readFileSync(path.resolve(arg("--input")), "utf8");
const readLines = (file) => file && fs.existsSync(file)
  ? fs.readFileSync(file, "utf8").split(/\r?\n/).map((v) => v.trim()).filter(Boolean)
  : [];
const report = await analyze(input, config, {
  checkHttp: args.includes("--check-http"),
  allowlist: readLines(arg("--allowlist")),
  legitimateUrls: readLines(arg("--legitimate-urls"))
});
const out = path.resolve(arg("--out", "analysis-report.json"));
fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(out.replace(/\.json$/i, ".csv"), `${toCsv(report.items)}\n`);
console.log(JSON.stringify({ output: out, summary: report.summary, prefixSuggestions: report.prefixes.suggestions.length }, null, 2));
