import { NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth'
import { PLANNER_SYSTEM_PROMPT } from '@/lib/planning-prompt'
import { logger } from '@/lib/logger'

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://host.docker.internal:18789'
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || ''
const MODEL = 'anthropic/claude-sonnet-4-6'

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await request.json()
    const messages: Array<{ role: string; content: string }> = body?.messages
    const projectContext: string | undefined = body?.projectContext
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'messages array is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const payload = {
      model: MODEL,
      messages: [
        { role: 'system', content: projectContext ? PLANNER_SYSTEM_PROMPT + '\n\n## Existing Project Context\nThe user is adding to an existing project. Skip the full project kickoff (tech stack, requirements phases). Focus on understanding what they want to add/change, ask clarifying questions, then break it into implementable tasks.\n\n' + projectContext : PLANNER_SYSTEM_PROMPT },
        ...messages,
      ],
      max_tokens: 8192,
      stream: true,
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (GATEWAY_TOKEN) {
      headers['Authorization'] = `Bearer ${GATEWAY_TOKEN}`
    }

    const upstream = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => 'unknown error')
      logger.error({ status: upstream.status, body: errText }, 'Planning chat gateway error')
      return new Response(JSON.stringify({ error: 'Gateway error', detail: errText }), {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Stream through the SSE response
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error) {
    logger.error({ err: error }, 'Planning chat error')
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
