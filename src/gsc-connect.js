import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { findChromium } from "./browser.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const statusFile = path.join(root, "data", "gsc-connection.json");
const removalsUrl = "https://search.google.com/search-console/removals?resource_id=sc-domain%3Appcguru.ca";
const save = (value) => fs.writeFileSync(statusFile, `${JSON.stringify({ ...value, checkedAt: new Date().toISOString() }, null, 2)}\n`);

let browser;
try {
  save({ status: "connecting", message: "Complete Google sign-in in the opened browser." });
  const profile = path.join(root, "data", "gsc-browser-profile");
  fs.mkdirSync(profile, { recursive: true });
  const portFile = path.join(profile, "DevToolsActivePort");
  if (fs.existsSync(portFile)) fs.rmSync(portFile);
  const chrome = spawn(findChromium(), ["--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", removalsUrl], { detached: true, stdio: "ignore" });
  chrome.unref();
  let debugPort;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (chrome.exitCode !== null) throw new Error(`Chrome exited before enabling its connection port (exit code ${chrome.exitCode}).`);
    if (fs.existsSync(portFile)) {
      debugPort = Number(fs.readFileSync(portFile, "utf8").split(/\r?\n/)[0]);
      if (debugPort) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!debugPort) throw new Error("Chrome opened, but did not publish a connection port. Check Chrome enterprise policy RemoteDebuggingAllowed.");
  for (let attempt = 0; attempt < 20; attempt++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`); break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 500)); }
  }
  if (!browser) throw new Error(`Chrome published port ${debugPort}, but the connector could not attach.`);
  let context;
  for (let attempt = 0; attempt < 20; attempt++) {
    context = browser.contexts()[0];
    if (context) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!context) throw new Error("Chrome connected without an available browser context.");
  let page = context.pages().find((p) => p.url().includes("search.google.com")) || context.pages()[0];
  if (!page) {
    page = await context.newPage();
    await page.goto(removalsUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  }
  while (browser.isConnected()) {
    page = context.pages().find((p) => p.url().includes("search.google.com")) || context.pages()[0] || page;
    if (!page || page.isClosed()) {
      save({ status: "connecting", message: "Open the PPC Guru Search Console Removals page in the dedicated Chrome window." });
      await new Promise((resolve) => setTimeout(resolve, 3000));
      continue;
    }
    const current = page.url();
    const onSearchConsole = current.startsWith("https://search.google.com/search-console/");
    const hasNewRequest = onSearchConsole && await page.getByRole("button", { name: /new request/i }).count().catch(() => 0);
    if (hasNewRequest) save({ status: "connected", message: "PPC Guru Search Console removals access verified." });
    else save({ status: "connecting", message: onSearchConsole ? "Waiting for PPC Guru property access." : "Complete Google sign-in in the opened browser." });
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
} catch (error) {
  save({ status: "error", message: error.message });
} finally {
  await browser?.close().catch(() => {});
}
