import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { launchGscBrowser } from "./browser.js";
import { createStore } from "./store.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const removalsUrl = "https://search.google.com/search-console/removals?resource_id=sc-domain%3Appcguru.ca";
const command = process.argv[2];
const execute = process.argv.includes("--execute");
const limitArg = process.argv.find((v) => v.startsWith("--limit="));
const limit = Math.min(Number(limitArg?.split("=")[1] || 20), 100);

async function login() {
  const context = await launchGscBrowser(root, false);
  const page = context.pages()[0] || await context.newPage();
  await page.goto(removalsUrl);
  console.log("Sign in to the dedicated Google account and confirm the PPC Guru Removals page is visible.");
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  await prompt.question("Press Enter here when login is complete...");
  prompt.close(); await context.close();
}

async function clickAny(page, role, names) {
  for (const name of names) {
    const locator = page.getByRole(role, { name, exact: false });
    if (await locator.count()) { await locator.first().click(); return; }
  }
  throw new Error(`Could not find ${role}: ${names.join(" / ")}`);
}

async function submitOne(page, request) {
  await page.goto(removalsUrl, { waitUntil: "domcontentloaded" });
  await clickAny(page, "button", ["New request"]);
  const dialog = page.getByRole("dialog").last();
  const textbox = dialog.getByRole("textbox").first();
  await textbox.fill(request.value);
  if (request.type === "prefix") {
    const prefix = dialog.getByText(/all URLs with this prefix|remove all URLs/i).last();
    await prefix.click();
  } else {
    const exact = dialog.getByText(/this URL only|remove this URL only/i).last();
    if (await exact.count()) await exact.click();
  }
  await clickAny(dialog, "button", ["Next"]);
  await clickAny(page.getByRole("dialog").last(), "button", ["Submit request", "Submit"]);
  await page.waitForTimeout(1200);
}

async function run() {
  const store = createStore(root);
  const queue = store.read().requests.filter((r) => r.approved && !["submitted", "processing"].includes(r.status)).slice(0, limit);
  if (!execute) {
    console.log(JSON.stringify({ mode: "dry-run", eligible: queue.length, requests: queue.map(({ id, type, value }) => ({ id, type, value })) }, null, 2));
    return;
  }
  if (!queue.length) throw new Error("No approved pending requests. Import and approve requests first.");
  if (process.env.GSC_EXECUTION_CONFIRMATION !== "PPGURU_APPROVED") throw new Error("Set GSC_EXECUTION_CONFIRMATION=PPGURU_APPROVED for live execution.");
  const context = await launchGscBrowser(root, false);
  const page = context.pages()[0] || await context.newPage();
  for (const request of queue) {
    store.update(request.id, { status: "processing" });
    try {
      await submitOne(page, request);
      store.update(request.id, { status: "submitted", submittedAt: new Date().toISOString() });
    } catch (error) {
      const shot = path.join(root, "data", `failure-${request.id}.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      store.update(request.id, { status: "failed", error: error.message, screenshot: shot });
      break;
    }
  }
  await context.close();
}

if (command === "login") await login();
else if (command === "run") await run();
else { console.log("Use: gsc-worker.js login | run [--execute] [--limit=20]"); process.exit(1); }
