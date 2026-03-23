'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import type { KeyboardEvent } from 'react'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { Button } from '@/components/ui/button'
import { useNavigateToPanel } from '@/lib/navigation'

// ── Types ──────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface OptionItem {
  label: string
  description?: string
}

interface OptionsBlock {
  question?: string
  multiSelect?: boolean
  options: OptionItem[]
}

type Phase = 'questioning' | 'requirements' | 'tech-stack' | 'tasks' | 'complete'

const PHASE_LABELS: Record<Phase, string> = {
  questioning: 'Questioning',
  requirements: 'Requirements',
  'tech-stack': 'Tech Stack',
  tasks: 'Tasks',
  complete: 'Complete',
}

const PHASES: Phase[] = ['questioning', 'requirements', 'tech-stack', 'tasks', 'complete']

// ── Helpers ────────────────────────────────────────────────────────

function detectPhase(messages: ChatMessage[]): Phase {
  const allContent = messages
    .filter((m) => m.role === 'assistant')
    .map((m) => m.content.toLowerCase())
    .join(' ')

  if (allContent.includes('"type": "planning_complete"') || allContent.includes('"type":"planning_complete"')) return 'complete'
  if (allContent.includes('### phase 4') || allContent.includes('task breakdown') || allContent.includes('task #')) return 'tasks'
  if (allContent.includes('### phase 3') || allContent.includes('tech stack')) return 'tech-stack'
  if (allContent.includes('### phase 2') || allContent.includes('requirements')) return 'requirements'
  return 'questioning'
}

function extractPlanningResult(messages: ChatMessage[]): Record<string, unknown> | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'assistant') continue
    const jsonMatch = msg.content.match(/```(?:json)?\s*(\{[\s\S]*?"type"\s*:\s*"planning_complete"[\s\S]*?\})\s*```/)
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[1]) as Record<string, unknown> } catch { /* continue */ }
    }
    const rawMatch = msg.content.match(/(\{[\s\S]*?"type"\s*:\s*"planning_complete"[\s\S]*\})/)
    if (rawMatch) {
      try { return JSON.parse(rawMatch[1]) as Record<string, unknown> } catch { /* continue */ }
    }
  }
  return null
}

/**
 * Parse a message into { text, options } by extracting ```options blocks.
 */
function parseMessageContent(content: string): { text: string; options: OptionsBlock | null } {
  const optionsRegex = /```options\s*([\s\S]*?)```/
  const match = content.match(optionsRegex)
  if (!match) return { text: content, options: null }

  const text = content.replace(optionsRegex, '').trim()
  try {
    const parsed = JSON.parse(match[1].trim()) as OptionsBlock
    if (Array.isArray(parsed.options) && parsed.options.length > 0) {
      return { text, options: parsed }
    }
  } catch {
    // malformed JSON — ignore options block
  }
  return { text: content, options: null }
}

// ── Sub-components ─────────────────────────────────────────────────

function EmptyState({ projectName }: { projectName?: string }): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center">
      <div className="text-4xl mb-4">🏗️</div>
      <h3 className="text-lg font-medium text-foreground mb-2">Planning Wizard</h3>
      <p className="text-sm text-muted-foreground max-w-md">
        {projectName
          ? `Adding to "${projectName}". Describe what you want to add or change.`
          : "Describe what you want to build. The planner will ask questions to refine your idea, then generate requirements, tech stack decisions, and actionable tasks."}
      </p>
    </div>
  )
}

function PhaseIndicator({ phase }: { phase: Phase }): React.ReactElement {
  const phaseIdx = PHASES.indexOf(phase)
  return (
    <div className="flex items-center gap-1">
      {PHASES.map((p, i) => {
        const isActive = p === phase
        const isDone = i < phaseIdx
        return (
          <div key={p} className="flex items-center gap-1">
            {i > 0 ? <div className={`w-4 h-px ${isDone ? 'bg-emerald-500' : 'bg-border'}`} /> : null}
            <div
              className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
                  : isDone
                    ? 'bg-emerald-500/10 text-emerald-500/70'
                    : 'bg-secondary text-muted-foreground'
              }`}
            >
              {PHASE_LABELS[p]}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function OptionButtons({
  block,
  onSelect,
  disabled,
}: {
  block: OptionsBlock
  onSelect: (value: string) => void
  disabled: boolean
}): React.ReactElement {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const handleSingleClick = useCallback(
    (label: string) => {
      if (!disabled) onSelect(label)
    },
    [disabled, onSelect]
  )

  const toggleMulti = useCallback((label: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }, [])

  const confirmMulti = useCallback(() => {
    if (selected.size > 0 && !disabled) {
      onSelect(Array.from(selected).join(', '))
    }
  }, [selected, disabled, onSelect])

  if (block.multiSelect) {
    return (
      <div className="mt-3 space-y-2">
        <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
          {block.options.map((opt) => {
            const isChecked = selected.has(opt.label)
            return (
              <button
                key={opt.label}
                type="button"
                disabled={disabled}
                onClick={() => toggleMulti(opt.label)}
                className={`text-left px-3 py-2.5 rounded-lg border transition-colors disabled:opacity-40 ${
                  isChecked
                    ? 'border-emerald-500/50 bg-emerald-500/10'
                    : 'border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 hover:border-zinc-600'
                }`}
              >
                <div className="flex items-start gap-2">
                  <div
                    className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${
                      isChecked ? 'bg-emerald-500 border-emerald-500' : 'border-zinc-600'
                    }`}
                  >
                    {isChecked ? (
                      <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M2 6l3 3 5-5" />
                      </svg>
                    ) : null}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground">{opt.label}</div>
                    {opt.description ? (
                      <div className="text-xs text-muted-foreground mt-0.5">{opt.description}</div>
                    ) : null}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
        {selected.size > 0 ? (
          <Button
            onClick={confirmMulti}
            disabled={disabled}
            className="bg-emerald-600 hover:bg-emerald-500 text-white"
            size="sm"
          >
            Confirm ({selected.size} selected)
          </Button>
        ) : null}
      </div>
    )
  }

  // Single-select: clickable cards
  return (
    <div className="mt-3 grid gap-2 grid-cols-1 sm:grid-cols-2">
      {block.options.map((opt) => (
        <button
          key={opt.label}
          type="button"
          disabled={disabled}
          onClick={() => handleSingleClick(opt.label)}
          className="text-left px-3 py-2.5 rounded-lg border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 hover:border-zinc-600 transition-colors disabled:opacity-40"
        >
          <div className="text-sm font-medium text-foreground">{opt.label}</div>
          {opt.description ? (
            <div className="text-xs text-muted-foreground mt-0.5">{opt.description}</div>
          ) : null}
        </button>
      ))}
    </div>
  )
}

function MessageBubble({
  msg,
  isLast,
  onOptionSelect,
  isStreaming,
}: {
  msg: ChatMessage
  isLast: boolean
  onOptionSelect: (value: string) => void
  isStreaming: boolean
}): React.ReactElement {
  const { text, options } = msg.role === 'assistant' ? parseMessageContent(msg.content) : { text: msg.content, options: null }

  // Only show options on the last assistant message and when not streaming
  const showOptions = options != null && isLast && !isStreaming

  return (
    <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] md:max-w-[75%] rounded-lg px-4 py-3 ${
          msg.role === 'user'
            ? 'bg-emerald-600/20 text-foreground'
            : 'bg-secondary text-foreground'
        }`}
      >
        {msg.role === 'assistant' ? (
          <div className="prose-sm">
            <MarkdownRenderer content={text || '...'} />
          </div>
        ) : (
          <p className="text-sm whitespace-pre-wrap">{text}</p>
        )}
        {showOptions ? (
          <OptionButtons block={options} onSelect={onOptionSelect} disabled={isStreaming} />
        ) : null}
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────

export function PlanningWizardPanel(): React.ReactElement {
  const [projects, setProjects] = useState<Array<{id: number; name: string; context_doc: string | null}>>([])
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createResult, setCreateResult] = useState<{ projectId: number; taskIds: number[] } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const navigateToPanel = useNavigateToPanel()

  useEffect(() => { fetch('/api/projects').then(r => r.json()).then(data => { if (data?.projects) setProjects(data.projects) }).catch(() => {}) }, [])

  const selectedProject = projects.find(p => p.id === selectedProjectId) ?? null
  const phase = detectPhase(messages)
  const planningResult = phase === 'complete' ? extractPlanningResult(messages) : null

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
  }, [input])

  const sendMessage = useCallback(async (overrideText?: string) => {
    const trimmed = (overrideText ?? input).trim()
    if (!trimmed || isStreaming) return

    setError(null)
    const userMessage: ChatMessage = { role: 'user', content: trimmed }
    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    if (!overrideText) setInput('')
    setIsStreaming(true)

    try {
      const res = await fetch('/api/planning/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
          ...(selectedProject?.context_doc ? { projectContext: selectedProject.context_doc } : {}),
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }))
        throw new Error(err.error || err.detail || `HTTP ${res.status}`)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response stream')

      const decoder = new TextDecoder()
      let assistantContent = ''
      let buffer = ''

      setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmedLine = line.trim()
          if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue
          const data = trimmedLine.slice(6)
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)
            const delta = parsed?.choices?.[0]?.delta?.content
            if (typeof delta === 'string') {
              assistantContent += delta
              setMessages((prev) => {
                const updated = [...prev]
                updated[updated.length - 1] = { role: 'assistant', content: assistantContent }
                return updated
              })
            }
          } catch {
            // skip
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setError(msg)
      setMessages((prev) => {
        if (prev.length > 0 && prev[prev.length - 1].role === 'assistant' && !prev[prev.length - 1].content) {
          return prev.slice(0, -1)
        }
        return prev
      })
    } finally {
      setIsStreaming(false)
    }
  }, [input, isStreaming, messages])

  const handleOptionSelect = useCallback(
    (value: string) => {
      sendMessage(value)
    },
    [sendMessage]
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessage()
      }
    },
    [sendMessage]
  )

  const handleCreateProject = useCallback(async () => {
    if (!planningResult || isCreating) return
    setIsCreating(true)
    setError(null)

    try {
      const res = await fetch('/api/planning/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planningResult, projectId: selectedProjectId }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }))
        throw new Error(err.error || `HTTP ${res.status}`)
      }

      const result = await res.json()
      setCreateResult(result)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setError(msg)
    } finally {
      setIsCreating(false)
    }
  }, [planningResult, isCreating])

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-4rem)]">
      {/* Header + Phase */}
      <div className="flex-shrink-0 border-b border-border bg-card px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-foreground">Plan a Project</h2>
          {messages.length === 0 && projects.length > 0 ? (
            <select
              value={selectedProjectId ?? ""}
              onChange={(e) => setSelectedProjectId(e.target.value ? Number(e.target.value) : null)}
              className="ml-3 bg-secondary text-foreground text-xs rounded px-2 py-1 border border-border"
            >
              <option value="">New Project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          ) : null}
          {createResult != null ? (
            <Button variant="ghost" size="sm" onClick={() => navigateToPanel('tasks')}>
              View Tasks →
            </Button>
          ) : null}
        </div>
        <PhaseIndicator phase={phase} />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 ? <EmptyState projectName={selectedProject?.name} /> : null}

        {messages.map((msg, i) => (
          <MessageBubble
            key={i}
            msg={msg}
            isLast={i === messages.length - 1}
            onOptionSelect={handleOptionSelect}
            isStreaming={isStreaming}
          />
        ))}

        {isStreaming ? (
          <div className="flex justify-start">
            <div className="text-xs text-muted-foreground animate-pulse">Thinking...</div>
          </div>
        ) : null}

        <div ref={messagesEndRef} />
      </div>

      {/* Success Banner */}
      {createResult != null ? (
        <div className="flex-shrink-0 mx-4 mb-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <div className="flex items-center gap-2">
            <span className="text-emerald-400">✅</span>
            <span className="text-sm text-emerald-300">
              Created project with {createResult.taskIds.length} tasks.{' '}
              <button
                onClick={() => navigateToPanel('tasks')}
                className="underline hover:text-emerald-200"
              >
                View Task Board
              </button>
            </span>
          </div>
        </div>
      ) : null}

      {/* Planning Complete Action */}
      {planningResult != null && createResult == null ? (
        <div className="flex-shrink-0 mx-4 mb-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <div className="flex items-center justify-between">
            <span className="text-sm text-emerald-300">
              📋 Planning complete! Ready to create project and tasks.
            </span>
            <Button
              onClick={handleCreateProject}
              disabled={isCreating}
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
              size="sm"
            >
              {isCreating ? 'Creating...' : 'Create Project & Tasks'}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Error */}
      {error != null ? (
        <div className="flex-shrink-0 mx-4 mb-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      ) : null}

      {/* Input — always visible */}
      <div className="flex-shrink-0 border-t border-border bg-card p-4">
        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={messages.length === 0 ? (selectedProject ? 'Describe what you want to add or change...' : 'Describe what you want to build...') : 'Type your response...'}
            rows={1}
            disabled={isStreaming}
            className="flex-1 bg-secondary text-foreground placeholder-muted-foreground rounded-lg px-4 py-2.5 text-sm resize-none border border-border focus:outline-none focus:ring-1 focus:ring-emerald-500/50 disabled:opacity-50"
          />
          <Button
            onClick={() => sendMessage()}
            disabled={isStreaming || !input.trim()}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 self-end"
            size="sm"
          >
            {isStreaming ? '...' : 'Send'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">
          Enter to send · Shift+Enter for newline
        </p>
      </div>
    </div>
  )
}
