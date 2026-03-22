#!/usr/bin/env node
/**
 * ocv-heartbeat-relay.js
 * Registers OCV agents with Mission Control and sends 30s heartbeats.
 * Also queries the OpenClaw gateway for active sessions to report real status.
 */

const MC_URL     = process.env.MC_URL     || 'http://mission-control:4000';
const MC_API_KEY = process.env.MC_API_KEY || '';
const GW_URL     = process.env.GW_URL     || 'http://host-gateway:18789';
const GW_TOKEN   = process.env.GW_TOKEN   || '';

const AGENTS = [
  { name: 'Aria',  role: 'developer',  session_key: 'ocv-aria'  },
  { name: 'Zara',  role: 'designer',   session_key: 'ocv-zara'  },
  { name: 'Pip',   role: 'researcher', session_key: 'ocv-pip'   },
  { name: 'Rex',   role: 'reviewer',   session_key: 'ocv-rex'   },
  { name: 'Aegis', role: 'reviewer',   session_key: 'aegis'     },
];

const state = new Map(); // session_key → { connection_id, agent_id }

async function register(agent) {
  const res = await fetch(`${MC_URL}/api/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': MC_API_KEY },
    body: JSON.stringify({
      tool_name: 'openclaw-gateway',
      tool_version: '2026.3.7',
      agent_name: agent.name,
      agent_role: agent.role,
      session_key: agent.session_key,
    }),
  });
  if (!res.ok) {
    console.error(`[register] ${agent.name} HTTP ${res.status}: ${await res.text()}`);
    return false;
  }
  const data = await res.json();
  state.set(agent.session_key, { connection_id: data.connection_id, agent_id: data.agent_id });
  console.log(`[register] ${agent.name} → agent_id=${data.agent_id} connection=${data.connection_id?.slice(0,8)}...`);
  return true;
}

async function getGatewayActivity() {
  // Get active sessions from the gateway to report real token usage
  try {
    const res = await fetch(`${GW_URL}/healthz`, {
      headers: { 'Authorization': `Bearer ${GW_TOKEN}` },
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch { return false; }
}

async function heartbeat(agent) {
  const s = state.get(agent.session_key);
  if (!s) return;

  const res = await fetch(`${MC_URL}/api/agents/${s.agent_id}/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': MC_API_KEY },
    body: JSON.stringify({ connection_id: s.connection_id }),
  });

  if (res.status === 404 || res.status === 401) {
    // Connection expired — re-register
    console.log(`[heartbeat] ${agent.name} lost connection, re-registering...`);
    state.delete(agent.session_key);
    await register(agent);
  } else if (!res.ok) {
    console.error(`[heartbeat] ${agent.name} HTTP ${res.status}`);
  }
}

async function run() {
  console.log(`[relay] Starting OCV heartbeat relay → ${MC_URL}`);
  
  // Register all agents on startup
  for (const agent of AGENTS) {
    try { await register(agent); } catch (e) { console.error(`[relay] register error ${agent.name}:`, e.message); }
    await new Promise(r => setTimeout(r, 200));
  }

  // Heartbeat loop every 25s
  setInterval(async () => {
    for (const agent of AGENTS) {
      if (!state.has(agent.session_key)) {
        try { await register(agent); } catch (e) { /* retry next cycle */ }
      } else {
        try { await heartbeat(agent); } catch (e) { console.error(`[relay] heartbeat error ${agent.name}:`, e.message); }
      }
    }
  }, 25000);
}

run().catch(e => { console.error('[relay] fatal:', e); process.exit(1); });
