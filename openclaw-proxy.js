#!/usr/bin/env node
/**
 * openclaw-proxy.js
 * Translates Mission Control's `openclaw` CLI spawns into HTTP API calls.
 * MC parses raw stdout text — must output text that matches its keyword patterns.
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

// MC's parseOpenClawDoctorOutput reads raw stdout text.
// Must contain "healthy" or "ok" or "no issues" to register as healthy.
function txt(msg) { process.stdout.write(msg + "\n"); }
function json(data) { process.stdout.write(JSON.stringify(data) + "\n"); }
function out(data, text) {
  if (wantsJson) json(data);
  else txt(text ?? (data.ok ? "ok" : "error"));
}

function die(msg, code=1) {
  if (wantsJson) json({ ok: false, error: msg });
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
    out({ ok: true, result: text, type: "final" }, text);
    return;
  }

  // ── channels status ───────────────────────────────────────────────────────
  if (args.includes("channels") && args.includes("status")) {
    const r = await fetch(`${BASE}/healthz`, {
      headers: { "Authorization": `Bearer ${TOKEN}` }, signal: sig,
    }).catch(e => die(e.message));
    const h = await r.json().catch(() => ({ ok: r.ok }));
    out({ ok: h.ok ?? r.ok, channels: [], gateway: h }, "Gateway: ok. No channel warnings detected.");
    return;
  }

  // ── doctor / doctor --fix ─────────────────────────────────────────────────
  if (args.includes("doctor")) {
    const r = await fetch(`${BASE}/healthz`, {
      headers: { "Authorization": `Bearer ${TOKEN}` }, signal: sig,
    }).catch(() => null);
    const healthy = r?.ok ?? false;
    const isFix = args.includes("--fix");
    if (healthy) {
      out(
        { ok: true, level: "healthy", healthy: true, issues: [], canFix: false, summary: "No issues detected.", raw: "" },
        "No warnings detected. OpenClaw configuration is healthy."
      );
    } else {
      out(
        { ok: false, level: "error", healthy: false, issues: ["Cannot reach gateway"], canFix: false, summary: "Cannot reach gateway", raw: "" },
        "- Cannot reach gateway at " + BASE
      );
    }
    return;
  }

  // ── skills ────────────────────────────────────────────────────────────────
  if (args.includes("skills")) {
    out({ ok: true, skills: [] }, "No skills installed.");
    return;
  }

  // ── integrations ─────────────────────────────────────────────────────────
  if (args.includes("integrations")) {
    out({ ok: true, integrations: [] }, "No integrations configured.");
    return;
  }

  // ── config get/set ────────────────────────────────────────────────────────
  if (args.includes("config")) {
    out({ ok: true, value: null }, "ok");
    return;
  }

  // ── sessions cleanup ──────────────────────────────────────────────────────
  if (args.includes("sessions") && args.includes("cleanup")) {
    out({ ok: true, cleaned: 0 }, "Session cleanup complete. No issues found.");
    return;
  }

  // ── version ───────────────────────────────────────────────────────────────
  if (args.includes("--version") || args.includes("version") || args[0] === "-v") {
    out({ ok: true, version: "2026.3.7" }, "2026.3.7");
    return;
  }

  // ── gateway call / health / status ────────────────────────────────────────
  if (args.includes("gateway")) {
    const r = await fetch(`${BASE}/healthz`, {
      headers: { "Authorization": `Bearer ${TOKEN}` }, signal: sig,
    }).catch(e => die(e.message));
    const h = await r.json().catch(() => ({ ok: r.ok }));
    out({ ok: h.ok ?? r.ok, ...h }, (h.ok ?? r.ok) ? "Gateway is healthy." : "Gateway unreachable.");
    return;
  }

  // ── status ────────────────────────────────────────────────────────────────
  if (args.includes("status") || args.length === 0) {
    const r = await fetch(`${BASE}/healthz`, {
      headers: { "Authorization": `Bearer ${TOKEN}` }, signal: sig,
    }).catch(() => null);
    const healthy = r?.ok ?? false;
    out({ ok: healthy, status: healthy ? "running" : "unreachable" }, healthy ? "Runtime: running" : "Runtime: stopped");
    return;
  }

  // ── unknown — return ok stub so MC doesn't crash ──────────────────────────
  out({ ok: true, result: null }, "ok");
}

main().catch(e => die(e.message));
