#!/usr/bin/env node
/**
 * openclaw-proxy.js
 * Translates Mission Control's `openclaw` CLI spawns into HTTP API calls.
 */

const args = process.argv.slice(2);
const TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "";
const HOST  = process.env.OPENCLAW_GATEWAY_HOST  || "host-gateway";
const PORT  = process.env.OPENCLAW_GATEWAY_PORT  || "18789";
const BASE  = `http://${HOST}:${PORT}`;
const wantsJson = args.includes("--json");

function parseArgs(args) {
  const r = { params: {}, timeout: 30000 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--params"  && args[i+1]) { r.params  = JSON.parse(args[++i]); }
    if (args[i] === "--timeout" && args[i+1]) { r.timeout = parseInt(args[++i]);   }
  }
  return r;
}

function out(data) {
  if (wantsJson) process.stdout.write(JSON.stringify(data) + "\n");
  else process.stdout.write(String(data.result ?? data.ok ?? JSON.stringify(data)) + "\n");
}

function die(msg, code=1) {
  if (wantsJson) process.stdout.write(JSON.stringify({ ok: false, error: msg }) + "\n");
  else process.stderr.write("Error: " + msg + "\n");
  process.exit(code);
}

async function main() {
  const { params, timeout } = parseArgs(args);
  const sig = AbortSignal.timeout(timeout);

  // ── gateway call agent ────────────────────────────────────────────────────
  if (args.includes("gateway") && args.includes("call") && args.includes("agent")) {
    const { message, agentId, sessionKey, idempotencyKey } = params;
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${TOKEN}`,
    };
    if (agentId)    headers["x-openclaw-agent-id"]    = agentId;
    if (sessionKey) headers["x-openclaw-session-key"] = sessionKey;

    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST", headers,
      body: JSON.stringify({
        messages: [{ role: "user", content: message || "" }],
        stream: false, user: idempotencyKey,
      }),
      signal: sig,
    }).catch(e => die(e.message));

    if (!res.ok) die(`HTTP ${res.status}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    out({ ok: true, result: text, type: "final" });
    return;
  }

  // ── channels status ───────────────────────────────────────────────────────
  if (args.includes("channels") && args.includes("status")) {
    const r = await fetch(`${BASE}/healthz`, {
      headers: { "Authorization": `Bearer ${TOKEN}` }, signal: sig,
    }).catch(e => die(e.message));
    const h = await r.json().catch(() => ({ ok: r.ok }));
    out({ ok: h.ok ?? r.ok, channels: [], gateway: h });
    return;
  }

  // ── doctor / doctor --fix ─────────────────────────────────────────────────
  if (args.includes("doctor")) {
    const r = await fetch(`${BASE}/healthz`, {
      headers: { "Authorization": `Bearer ${TOKEN}` }, signal: sig,
    }).catch(() => null);
    const healthy = r?.ok ?? false;
    const checks = [
      { name: "gateway_reachable", ok: healthy, message: healthy ? "Gateway reachable" : "Cannot reach gateway" },
      { name: "auth_token",        ok: !!TOKEN,  message: TOKEN ? "Auth token present" : "No auth token" },
    ];
    const allOk = checks.every(c => c.ok);
    out({ ok: allOk, checks, fixed: args.includes("--fix") ? [] : undefined });
    return;
  }

  // ── skills list / install / status ───────────────────────────────────────
  if (args.includes("skills")) {
    out({ ok: true, skills: [] });
    return;
  }

  // ── integrations ─────────────────────────────────────────────────────────
  if (args.includes("integrations")) {
    out({ ok: true, integrations: [] });
    return;
  }

  // ── config get/set ────────────────────────────────────────────────────────
  if (args.includes("config")) {
    out({ ok: true, value: null });
    return;
  }

  // ── gateway call / health / status / anything else ────────────────────────
  if (args.includes("gateway")) {
    const r = await fetch(`${BASE}/healthz`, {
      headers: { "Authorization": `Bearer ${TOKEN}` }, signal: sig,
    }).catch(e => die(e.message));
    const h = await r.json().catch(() => ({ ok: r.ok }));
    out({ ok: h.ok ?? r.ok, ...h });
    return;
  }

  // ── version ───────────────────────────────────────────────────────────────
  if (args.includes("--version") || args.includes("version") || args[0] === "-v") {
    out({ ok: true, version: "2026.3.7", result: "2026.3.7" });
    return;
  }

  // ── status ────────────────────────────────────────────────────────────────
  if (args.includes("status") || args.length === 0) {
    const r = await fetch(`${BASE}/healthz`, {
      headers: { "Authorization": `Bearer ${TOKEN}` }, signal: sig,
    }).catch(() => null);
    const healthy = r?.ok ?? false;
    out({ ok: healthy, status: healthy ? "running" : "unreachable" });
    return;
  }

  // ── unknown — return ok stub so MC doesn't crash ──────────────────────────
  out({ ok: true, result: null, _note: `proxy stub: openclaw ${args.join(" ")}` });
}

main().catch(e => die(e.message));
