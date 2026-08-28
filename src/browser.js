import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

export function findChromium() {
  const candidates = [process.env.GSC_BROWSER_PATH,
    "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean);
  const executablePath = candidates.find(fs.existsSync);
  if (!executablePath) throw new Error("Chrome, Brave, or Edge was not found. Set GSC_BROWSER_PATH.");
  return executablePath;
}

export async function launchGscBrowser(root, headless = false) {
  const profile = path.join(root, "data", "gsc-browser-profile");
  fs.mkdirSync(profile, { recursive: true });
  return chromium.launchPersistentContext(profile, { executablePath: findChromium(), headless, viewport: { width: 1440, height: 950 } });
}
