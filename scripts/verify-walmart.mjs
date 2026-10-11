// Offline harness for the Walmart client. Run: node scripts/verify-walmart.mjs
import {
  walmartConfigFromEnv,
  getWalmartAccessToken,
  getWalmartTokenDetail,
  checkWalmartHealth,
} from "../lib/walmart/client.ts";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

check("missing env -> null config",
  walmartConfigFromEnv({}) === null);
check("env -> config",
  (() => {
    const c = walmartConfigFromEnv({ WALMART_API_CLIENT_ID: "id", WALMART_API_CLIENT_SECRET: "s" });
    return c !== null && c.endpoint === "https://marketplace.walmartapis.com";
  })());

const okFetch = async (url, init) => {
  const u = String(url);
  if (u.endsWith("/v3/token")) {
    // Verify auth shape: Basic + grant_type + required headers.
    const h = init.headers;
    if (!String(h.Authorization).startsWith("Basic ")) return { ok: false, status: 401, text: async () => "bad auth", json: async () => ({}) };
    if (!h["WM_SVC.NAME"] || !h["WM_QOS.CORRELATION_ID"]) return { ok: false, status: 400, text: async () => "missing headers", json: async () => ({}) };
    return { ok: true, json: async () => ({ access_token: "tok123", expires_in: 900 }) };
  }
  if (u.endsWith("/v3/token/detail")) {
    if (init.headers["WM_SEC.ACCESS_TOKEN"] !== "tok123") return { ok: false, status: 401, text: async () => "bad token", json: async () => ({}) };
    return { ok: true, json: async () => ({ is_valid: true, expires_at: "2026-10-11T08:00:00Z", scopes: { Items: "full_access", Orders: "view_only" } }) };
  }
  return { ok: false, status: 404, text: async () => "", json: async () => ({}) };
};

const cfg = walmartConfigFromEnv({ WALMART_API_CLIENT_ID: "id", WALMART_API_CLIENT_SECRET: "s" });
const tok = await getWalmartAccessToken(cfg, okFetch);
check("token exchange ok", tok.accessToken === "tok123" && tok.expiresIn === 900);

const detail = await getWalmartTokenDetail(cfg, tok, okFetch);
check("token detail ok", detail.isValid === true && detail.scopes?.Items === "full_access");

const health = await checkWalmartHealth(cfg, okFetch);
check("health connected", health.connected === true && health.source === "walmart-api");

const badFetch = async () => ({ ok: false, status: 401, text: async () => "unauthorized", json: async () => ({}) });
const bad = await checkWalmartHealth(cfg, badFetch);
check("auth failure -> connected:false, never throws",
  bad.connected === false && bad.source === "error" && /401/.test(bad.reason ?? ""));

const unc = await checkWalmartHealth(null, okFetch);
check("unconfigured -> connected:false", unc.connected === false && unc.source === "unconfigured");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
