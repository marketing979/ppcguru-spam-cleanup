const $ = (id) => document.getElementById(id);
let report = null;

$("analyze").addEventListener("click", async () => {
  const button = $("analyze");
  button.disabled = true;
  button.textContent = "Analyzing…";
  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ urls: $("urls").value, checkHttp: $("http").checked })
    });
    if (!response.ok) throw new Error((await response.json()).error || "Analysis failed");
    report = await response.json();
    render(report);
  } catch (error) { alert(error.message); }
  finally { button.disabled = false; button.textContent = "Analyze URLs"; }
});

function render(data) {
  const labels = [["total", "Total"], ["ready-for-approval", "Ready"], ["manual-review", "Review"], ["protected", "Protected"]];
  $("cards").innerHTML = labels.map(([key, label]) => `<div class="card"><span>${label}</span><strong>${data.summary[key] || 0}</strong></div>`).join("");
  $("prefixes").innerHTML = data.prefixes.suggestions.length
    ? data.prefixes.suggestions.map((p) => `<div class="prefix"><code>${esc(p.prefix)}</code><span>${p.count} URLs · approval required</span></div>`).join("")
    : `<p class="note">No safe prefix groups found. Exact URLs remain in the review queue.</p>`;
  $("rows").innerHTML = data.items.map((item) => `<tr><td>${esc(item.url || item.input)}</td><td>${item.score}</td><td><span class="pill ${item.decision}">${item.decision}</span></td><td>${esc(item.reasons.join("; "))}</td></tr>`).join("");
  $("results").hidden = false;
}

$("export").addEventListener("click", async () => {
  if (!report) return;
  const response = await fetch("/api/export.csv", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: report.items }) });
  const blob = await response.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "ppcguru-spam-review.csv";
  link.click();
  URL.revokeObjectURL(link.href);
});

function esc(value) { const div = document.createElement("div"); div.textContent = value; return div.innerHTML; }

$("queue").addEventListener("click", async () => {
  if (!report) return;
  await fetch("/api/queue/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(report) });
  await loadRegistry();
});
$("refresh").addEventListener("click", loadRegistry);
async function loadRegistry() {
  const data = await (await fetch("/api/registry")).json();
  $("registry").innerHTML = data.requests.map((r) => `<tr><td>${esc(r.value)}</td><td>${r.type}</td><td>${r.status}</td><td>${r.status === "pending-review" ? `<button data-approve="${r.id}">Approve</button> <button class="secondary" data-reject="${r.id}">Reject</button>` : "—"}</td></tr>`).join("") || `<tr><td colspan="4" class="note">No requests queued.</td></tr>`;
  document.querySelectorAll("[data-approve]").forEach((b) => b.onclick = () => decide(b.dataset.approve, "approve"));
  document.querySelectorAll("[data-reject]").forEach((b) => b.onclick = () => decide(b.dataset.reject, "reject"));
}
async function decide(id, action) { await fetch(`/api/requests/${id}/${action}`, { method: "POST" }); await loadRegistry(); }
loadRegistry();

$("connect-gsc").addEventListener("click", async () => {
  $("connect-gsc").disabled = true;
  const response = await fetch("/api/gsc/connect", { method: "POST" });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    $("gsc-message").textContent = result.error || "Could not start the GSC worker.";
  }
  await refreshGsc();
});
async function refreshGsc() {
  try {
    const state = await (await fetch("/api/gsc/status")).json();
    const connected = state.status === "connected";
    $("gsc-title").textContent = connected ? "Connected to ppcguru.ca" : state.status === "connecting" ? "Waiting for Google sign-in…" : "Not connected";
    $("gsc-message").textContent = state.message;
    document.querySelector(".connection").classList.toggle("connected", connected);
    $("connect-gsc").textContent = connected ? "Reconnect" : "Connect GSC";
    $("connect-gsc").disabled = false;
  } catch { $("gsc-message").textContent = "Connection status unavailable."; }
}
refreshGsc();
setInterval(refreshGsc, 4000);
