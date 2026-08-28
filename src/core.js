import fs from "node:fs";

export function loadConfig(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

export function parseUrlLines(text) {
  const values = [];
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const first = line.split(/[,\t;]/)[0].trim().replace(/^['"]|['"]$/g, "");
    if (/^(url|address|page)$/i.test(first)) continue;
    values.push(first);
  }
  return [...new Set(values)];
}

export function normalizeUrl(value, siteOrigin) {
  try {
    const origin = new URL(siteOrigin);
    const url = new URL(value, origin);
    if (url.hostname.toLowerCase() !== origin.hostname.toLowerCase()) {
      return { valid: false, input: value, reason: "outside-site" };
    }
    url.hash = "";
    url.hostname = origin.hostname.toLowerCase();
    url.protocol = origin.protocol;
    url.pathname = url.pathname.replace(/\/{2,}/g, "/");
    const normalized = url.toString();
    return { valid: true, input: value, url: normalized, path: url.pathname, query: url.search };
  } catch {
    return { valid: false, input: value, reason: "invalid-url" };
  }
}

function startsWithProtectedPath(path, protectedPrefix) {
  if (protectedPrefix === "/") return path === "/";
  return path === protectedPrefix || path.startsWith(`${protectedPrefix}/`);
}

export function classifyUrl(item, config, context = {}) {
  if (!item.valid) return { ...item, score: 0, decision: "invalid", reasons: [item.reason] };

  const lower = decodeURIComponent(item.path).toLowerCase();
  const reasons = [];
  let score = 0;
  const protectedMatch = config.protectedPrefixes.find((p) => startsWithProtectedPath(lower, p.toLowerCase()));
  const allowlisted = (context.allowlist || []).some((entry) => item.url === entry || item.path === entry);
  const sitemapKnown = (context.legitimateUrls || []).includes(item.url);

  const terms = config.suspiciousTerms.filter((term) => lower.includes(term.toLowerCase()));
  if (terms.length) {
    score += Math.min(40 + (terms.length - 1) * 5, 55);
    reasons.push(`suspicious term: ${terms.join(", ")}`);
  }

  const pattern = config.knownSpamPathPatterns.find((source) => new RegExp(source, "i").test(lower));
  if (pattern) {
    score += 30;
    reasons.push("known spam path pattern");
  }

  if (context.hackStartDate && context.discoveredAt && new Date(context.discoveredAt) >= new Date(context.hackStartDate)) {
    score += 10;
    reasons.push("discovered during/after incident");
  }

  if (context.httpStatus === 404 || context.httpStatus === 410) {
    score += 20;
    reasons.push(`permanently unavailable (${context.httpStatus})`);
  } else if (context.httpStatus >= 200 && context.httpStatus < 400) {
    reasons.push(`still live (${context.httpStatus})`);
  }

  if (!sitemapKnown) {
    score += 10;
    reasons.push("not in legitimate URL list");
  }

  if (protectedMatch || allowlisted || sitemapKnown) {
    return {
      ...item,
      score: 0,
      decision: "protected",
      reasons: [protectedMatch ? `protected prefix: ${protectedMatch}` : "explicitly allowlisted"]
    };
  }

  const confirmedGone = context.httpStatus === 404 || context.httpStatus === 410;
  const decision = score >= config.minimumAutoScore && confirmedGone ? "ready-for-approval" : "manual-review";
  return { ...item, score: Math.min(score, 100), decision, reasons };
}

export async function checkHttp(url, timeoutMs = 10000, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response = await fetchImpl(url, { method: "HEAD", redirect: "manual", signal: controller.signal });
    if (response.status === 405 || response.status === 501) {
      response = await fetchImpl(url, { method: "GET", redirect: "manual", signal: controller.signal });
    }
    return { status: response.status, location: response.headers.get("location") || "" };
  } catch (error) {
    return { status: 0, error: error.name === "AbortError" ? "timeout" : error.message };
  } finally {
    clearTimeout(timer);
  }
}

function prefixCandidates(path) {
  const candidates = new Set();
  const segments = path.split("/").filter(Boolean);
  if (segments.length > 1) candidates.add(`/${segments[0]}/`);
  const leaf = segments.at(-1) || "";
  const tokenMatch = leaf.match(/^(.+[-_])[^-_]+$/);
  if (tokenMatch && tokenMatch[1].length >= 5) {
    const parent = segments.length > 1 ? `/${segments.slice(0, -1).join("/")}/` : "/";
    candidates.add(`${parent}${tokenMatch[1]}`);
  }
  return [...candidates].filter((prefix) => prefix !== "/" && prefix.length >= 4);
}

export function suggestPrefixes(items, config) {
  const ready = items.filter((item) => item.decision === "ready-for-approval");
  const groups = new Map();
  for (const item of ready) {
    for (const prefix of prefixCandidates(item.path)) {
      if (config.protectedPrefixes.some((p) => startsWithProtectedPath(prefix, p))) continue;
      if (!groups.has(prefix)) groups.set(prefix, []);
      groups.get(prefix).push(item.url);
    }
  }
  const ranked = [...groups.entries()]
    .filter(([, urls]) => urls.length >= config.minimumPrefixSize)
    .map(([prefix, urls]) => ({ prefix, count: urls.length, urls: [...new Set(urls)] }))
    .sort((a, b) => b.count - a.count || b.prefix.length - a.prefix.length);

  const claimed = new Set();
  const suggestions = [];
  for (const group of ranked) {
    const unclaimed = group.urls.filter((url) => !claimed.has(url));
    if (unclaimed.length < config.minimumPrefixSize) continue;
    suggestions.push({ prefix: group.prefix, count: unclaimed.length, urls: unclaimed, requiresHumanApproval: true });
    unclaimed.forEach((url) => claimed.add(url));
  }
  return {
    suggestions,
    exactUrls: ready.filter((item) => !claimed.has(item.url)).map((item) => item.url)
  };
}

export async function analyze(text, config, options = {}) {
  const rawUrls = parseUrlLines(text);
  const normalized = rawUrls.map((url) => normalizeUrl(url, config.siteOrigin));
  const checked = [];
  for (const item of normalized) {
    let http = { status: options.statuses?.[item.url] || null };
    if (options.checkHttp && item.valid) http = await checkHttp(item.url, config.requestTimeoutMs, options.fetchImpl);
    checked.push(classifyUrl(item, config, {
      allowlist: options.allowlist || [],
      legitimateUrls: options.legitimateUrls || [],
      httpStatus: http.status,
      hackStartDate: options.hackStartDate,
      discoveredAt: options.discoveredAt
    }));
  }
  const prefixes = suggestPrefixes(checked, config);
  return {
    generatedAt: new Date().toISOString(),
    siteOrigin: config.siteOrigin,
    summary: checked.reduce((acc, item) => {
      acc.total += 1;
      acc[item.decision] = (acc[item.decision] || 0) + 1;
      return acc;
    }, { total: 0 }),
    prefixes,
    items: checked
  };
}

export function toCsv(items) {
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const headers = ["url", "path", "score", "decision", "reasons"];
  return [headers.join(","), ...items.map((item) => [
    item.url || item.input, item.path || "", item.score, item.decision, item.reasons.join("; ")
  ].map(escape).join(","))].join("\n");
}
