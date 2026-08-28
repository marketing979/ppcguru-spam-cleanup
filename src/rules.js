import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "./store.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const approved = createStore(root).read().requests.filter((r) => r.approved);
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exact = approved.filter((r) => r.type === "exact").map((r) => escape(new URL(r.value).pathname));
const prefixes = approved.filter((r) => r.type === "prefix").map((r) => escape(new URL(r.value).pathname));
const lines = ["# Generated from explicitly approved requests only.", ...exact.map((p) => `location = ${p} { return 410; }`), ...prefixes.map((p) => `location ^~ ${p} { return 410; }`)];
const out = path.join(root, "data", "approved-nginx-410.conf");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${lines.join("\n")}\n`);
console.log(JSON.stringify({ output: out, exact: exact.length, prefixes: prefixes.length }, null, 2));
