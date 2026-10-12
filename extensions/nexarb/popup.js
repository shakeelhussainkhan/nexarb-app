// NexArb Deal Check — popup logic.
// The extension NEVER reads Amazon session cookies or credentials. It only
// extracts the ASIN from the tab URL and calls YOUR NexArb API with YOUR
// personal API key (stored in chrome.storage.local, this device only).

const DEFAULT_BASE = "https://app.nexarb.io";

const $ = (id) => document.getElementById(id);

function asinFromUrl(url) {
  const patterns = [
    /\/dp\/([A-Z0-9]{10})(?:[/?#]|$)/i,
    /\/gp\/product\/([A-Z0-9]{10})(?:[/?#]|$)/i,
    /\/gp\/aw\/d\/([A-Z0-9]{10})(?:[/?#]|$)/i,
    /[?&]asin=([A-Z0-9]{10})(?:[&#]|$)/i,
  ];
  for (const re of patterns) {
    const m = String(url || "").match(re);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

async function getSettings() {
  const s = await chrome.storage.local.get(["nexarbBase", "nexarbKey"]);
  return {
    base: (s.nexarbBase || DEFAULT_BASE).replace(/\/+$/, ""),
    key: s.nexarbKey || "",
  };
}

function showSettings() {
  $("settings-view").hidden = false;
  $("analysis-view").hidden = true;
}

function showAnalysis() {
  $("settings-view").hidden = true;
  $("analysis-view").hidden = false;
}

function setLoading(on) {
  $("loading").hidden = !on;
  $("results").hidden = on;
  $("error").hidden = true;
}

function showError(msg) {
  $("loading").hidden = true;
  $("results").hidden = true;
  const e = $("error");
  e.textContent = msg;
  e.hidden = false;
}

function badgeClass(state) {
  const s = String(state || "").toUpperCase();
  if (s === "BUY") return "badge buy";
  if (s === "SKIP") return "badge skip";
  if (s === "UNKNOWN") return "badge unknown";
  if (s === "SELLABLE") return "badge sellable";
  if (s === "BLOCKED") return "badge blocked";
  if (s === "APPROVAL_REQUIRED") return "badge approval";
  return "badge";
}

function setBadge(el, text, state) {
  el.textContent = text;
  el.className = badgeClass(state);
}

const fmt$ = (n) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? "—"
    : "$" + Number(n).toFixed(2);
const fmtPct = (n) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? "—"
    : (Number(n) * 100).toFixed(1) + "%";

async function check(base, key, asin, buyPrice) {
  const body = { asin };
  if (buyPrice !== undefined) body.buyPrice = buyPrice;
  const res = await fetch(base + "/api/extension/check", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-NexArb-Key": key },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
  return data;
}

function renderScout(data) {
  $("scout-block").hidden = false;
  $("full-block").hidden = true;
  $("r-price").textContent = fmt$(data.sellPrice);
  setBadge($("r-elig"), data.eligibility.state.replace(/_/g, " "), data.eligibility.state);
  const v = data.velocity || {};
  $("r-velo").textContent =
    v.estMonthlySales > 0
      ? "~" + v.estMonthlySales + "/mo (" + v.confidence + ")"
      : "unknown";
  $("r-maxbuy").textContent = fmt$(data.scout && data.scout.maxBuyPrice);
  $("r-scout-note").textContent = (data.scout && data.scout.note) || "";
}

function renderFull(data) {
  $("scout-block").hidden = true;
  $("full-block").hidden = false;
  $("r-price").textContent = fmt$(data.sellPrice);
  setBadge($("r-elig"), data.eligibility.state.replace(/_/g, " "), data.eligibility.state);
  setBadge($("r-verdict"), data.verdict, data.verdict);
  const p = $("r-profit");
  p.textContent =
    (data.netProfit >= 0 ? "+" : "−") + "$" + Math.abs(Number(data.netProfit) || 0).toFixed(2) + " /unit";
  p.style.color = data.netProfit >= 0 ? "#065f46" : "#991b1b";
  $("r-margin").textContent = fmtPct(data.marginPct);
}

async function runAnalysis(buyPrice) {
  const { base, key } = await getSettings();
  if (!key) { showSettings(); return; }
  setLoading(true);
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = (tab && tab.url) || "";
    const asin = asinFromUrl(url);
    if (!asin) {
      $("loading").hidden = true;
      $("not-amazon").hidden = false;
      return;
    }
    $("not-amazon").hidden = true;

    // Ask the content script for the product title (best-effort).
    let title = null;
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: "NEXARB_GET_PRODUCT" });
      if (resp && resp.title) title = resp.title;
    } catch { /* content script not ready — non-fatal */ }
    $("p-title").textContent = title || "Amazon product";
    $("p-asin").textContent = asin;

    const data = await check(base, key, asin, buyPrice);
    $("results").hidden = false;
    $("loading").hidden = true;
    if (data.mode === "full") renderFull(data);
    else renderScout(data);
  } catch (e) {
    showError(e && e.message ? e.message : "Something went wrong.");
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const { base, key } = await getSettings();
  $("api-base").value = base;
  if (!key) {
    showSettings();
  } else {
    showAnalysis();
    runAnalysis(undefined);
  }

  $("save-settings").addEventListener("click", async () => {
    const b = $("api-base").value.trim().replace(/\/+$/, "") || DEFAULT_BASE;
    const k = $("api-key").value.trim();
    const err = $("settings-error");
    if (!k.startsWith("nxr_")) {
      err.textContent = "That doesn't look like a NexArb key (it starts with nxr_).";
      err.hidden = false;
      return;
    }
    err.hidden = true;
    // Verify the key with a cheap call before saving.
    try {
      const res = await fetch(b + "/api/extension/check", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-NexArb-Key": k },
        body: JSON.stringify({ asin: "B0CXYZ1234" }),
      });
      // 400 = key accepted, ASIN rejected. 401 = bad key.
      if (res.status === 401) throw new Error("Key rejected — check it and try again.");
    } catch (e) {
      err.textContent = e && e.message ? e.message : "Could not reach " + b;
      err.hidden = false;
      return;
    }
    await chrome.storage.local.set({ nexarbBase: b, nexarbKey: k });
    showAnalysis();
    runAnalysis(undefined);
  });

  $("open-settings").addEventListener("click", () => showSettings());
  $("rescan").addEventListener("click", () => {
    showAnalysis();
    runAnalysis(undefined);
  });
  $("analyze").addEventListener("click", async () => {
    const v = parseFloat($("buy-price").value);
    if (!(v > 0)) {
      showError("Enter your buy price first.");
      return;
    }
    showAnalysis();
    await runAnalysis(v);
  });
});
