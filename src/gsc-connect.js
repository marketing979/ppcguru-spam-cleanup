import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchGscBrowser } from "./browser.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const statusFile = path.join(root, "data", "gsc-connection.json");
const removalsUrl = "https://search.google.com/search-console/removals?resource_id=sc-domain%3Appcguru.ca";
const save = (value) => fs.writeFileSync(statusFile, `${JSON.stringify({ ...value, checkedAt: new Date().toISOString() }, null, 2)}\n`);

let context;
try {
  save({ status: "connecting", message: "Complete Google sign-in in the opened browser." });
  context = await launchGscBrowser(root, false);
  let page = context.pages()[0] || await context.newPage();
  await page.goto(removalsUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  while (true) {
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
  await context?.close().catch(() => {});
}
