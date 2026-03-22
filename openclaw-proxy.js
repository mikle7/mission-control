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

  // gateway call agent
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

  // channels status
  if (args.includes("channels") && args.includes("status")) {
    const r = await fetch(`${BASE}/healthz`, {
      headers: { "Authorization": `Bearer ${TOKEN}` }, signal: sig,
    }).catch(e => die(e.message));
    const h = await r.json().catch(() => ({ ok: r.ok }));
    out({ ok: h.ok ?? r.ok, channels: [], gateway: h });
    return;
  }

  // gateway call / health / status / anything else
  if (args.includes("gateway")) {
    const r = await fetch(`${BASE}/healthz`, {
      headers: { "Authorization": `Bearer ${TOKEN}` }, signal: sig,
    }).catch(e => die(e.message));
    const h = await r.json().catch(() => ({ ok: r.ok }));
    out({ ok: h.ok ?? r.ok, ...h });
    return;
  }

  die("unsupported: openclaw " + args.join(" "));
}

main().catch(e => die(e.message));
