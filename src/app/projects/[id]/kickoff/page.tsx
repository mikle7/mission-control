'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

const FIELD_CONFIGS = [
  {
    key: 'repoPath',
    label: 'Repository Path',
    hint: 'Where agents can find the code (e.g. /home/node/.openclaw/workspace/my-project)',
    placeholder: '/home/node/.openclaw/workspace/my-project',
    multiline: false,
  },
  {
    key: 'techStack',
    label: 'Tech Stack',
    hint: 'Languages, frameworks, key dependencies',
    placeholder: 'Next.js 15, TypeScript, Tailwind, Supabase, Expo SDK 54',
    multiline: false,
  },
  {
    key: 'apiEndpoints',
    label: 'API Endpoints & Services',
    hint: 'URLs, ports, auth methods agents will need to call',
    placeholder: 'Launch Control: http://192.168.1.32:4000 (x-api-key: mca_xxx)\nGateway: http://192.168.1.32:18789 (Bearer token)',
    multiline: true,
  },
  {
    key: 'agentConventions',
    label: 'Agent Conventions',
    hint: 'Rules agents must follow: naming, commit format, branch strategy, etc.',
    placeholder: '- Always commit with git before reporting task complete\n- Include commit hash in resolution\n- Use port 4000 for Launch Control (never 8000)\n- npm run typecheck must pass before submitting',
    multiline: true,
  },
  {
    key: 'knownGotchas',
    label: 'Known Gotchas ⚠️',
    hint: 'Things that will trip agents up — discovered the hard way',
    placeholder: '- ~/project-name does NOT exist in agent sandbox; use full path\n- ElevenLabs quota exhausted; use OpenAI tts-1\n- Never use port 8000 (deleted service)',
    multiline: true,
  },
  {
    key: 'acceptanceCriteria',
    label: 'Project Success Criteria',
    hint: 'What does "done" look like for this project overall?',
    placeholder: 'App runs end-to-end in Expo Go on iOS. tsc exits 0. All API calls reach gateway.',
    multiline: true,
  },
  {
    key: 'outOfScope',
    label: 'Out of Scope',
    hint: 'What agents should NOT work on unless explicitly asked',
    placeholder: '- No native modules (Expo Managed only)\n- No bare/ejecting\n- No hardcoded API keys in source',
    multiline: false,
  },
]

export default function ProjectKickoffPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.id as string

  const [project, setProject] = useState<{ id: number; name: string; context_doc: string | null } | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [contextDoc, setContextDoc] = useState('')
  const [editingDoc, setEditingDoc] = useState(false)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState('')
  const [tab, setTab] = useState<'wizard' | 'doc'>('wizard')

  useEffect(() => {
    fetch(`/api/projects/${projectId}/spec`, {
      headers: { 'x-api-key': '' },
    })
      .then(r => r.json())
      .then(d => {
        setProject(d.project)
        setContextDoc(d.project?.context_doc || '')
        setEditingDoc(!d.project?.context_doc)
      })
  }, [projectId])

  const runKickoff = async () => {
    setRunning(true)
    setMessage('')
    try {
      const res = await fetch(`/api/projects/${projectId}/kickoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (data.project?.context_doc) {
        setContextDoc(data.project.context_doc)
        setProject(p => p ? { ...p, context_doc: data.project.context_doc } : p)
        setTab('doc')
        setMessage('✅ Context document generated! Review and edit below, then save.')
      }
    } catch (e: any) {
      setMessage('❌ Failed: ' + e.message)
    } finally {
      setRunning(false)
    }
  }

  const saveDoc = async () => {
    setSaving(true)
    setMessage('')
    try {
      const res = await fetch(`/api/projects/${projectId}/spec`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context_doc: contextDoc }),
      })
      const data = await res.json()
      if (data.project) {
        setProject(p => p ? { ...p, context_doc: contextDoc } : p)
        setMessage('✅ Context document saved. Agents will receive this on every task.')
      }
    } catch (e: any) {
      setMessage('❌ Save failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  if (!project) return (
    <div style={styles.loading}>Loading project...</div>
  )

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button onClick={() => router.back()} style={styles.backBtn}>← Back</button>
        <div>
          <h1 style={styles.title}>🚀 Project Kickoff</h1>
          <p style={styles.subtitle}>{project.name}</p>
        </div>
        {project.context_doc && (
          <span style={styles.badge}>Context doc active ✓</span>
        )}
      </div>

      <div style={styles.explainer}>
        <strong>Why this matters:</strong> Without a context document, agents start every task with zero knowledge of your repo path, API endpoints, or constraints — causing failures, wrong ports, and wasted credits. This document is automatically injected into every agent prompt.
      </div>

      {/* Tabs */}
      <div style={styles.tabs}>
        <button
          style={{ ...styles.tab, ...(tab === 'wizard' ? styles.tabActive : {}) }}
          onClick={() => setTab('wizard')}
        >
          📋 Setup Wizard
        </button>
        <button
          style={{ ...styles.tab, ...(tab === 'doc' ? styles.tabActive : {}) }}
          onClick={() => setTab('doc')}
        >
          📄 Context Document {project.context_doc ? '✓' : '(empty)'}
        </button>
      </div>

      {tab === 'wizard' && (
        <div style={styles.section}>
          <p style={styles.sectionHint}>
            Fill in what you know. Leave blank what you don't — you can edit the document directly after generation.
          </p>
          {FIELD_CONFIGS.map(f => (
            <div key={f.key} style={styles.field}>
              <label style={styles.label}>{f.label}</label>
              <span style={styles.hint}>{f.hint}</span>
              {f.multiline ? (
                <textarea
                  style={styles.textarea}
                  value={form[f.key] || ''}
                  onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  rows={4}
                />
              ) : (
                <input
                  style={styles.input}
                  value={form[f.key] || ''}
                  onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                />
              )}
            </div>
          ))}
          <button
            style={{ ...styles.btn, ...(running ? styles.btnDisabled : {}) }}
            onClick={runKickoff}
            disabled={running}
          >
            {running ? 'Generating...' : '⚡ Generate Context Document'}
          </button>
        </div>
      )}

      {tab === 'doc' && (
        <div style={styles.section}>
          <p style={styles.sectionHint}>
            This document is injected verbatim into every agent task prompt for this project. Keep it accurate and concise.
          </p>
          <textarea
            style={{ ...styles.textarea, minHeight: '400px', fontFamily: 'monospace', fontSize: 13 }}
            value={contextDoc}
            onChange={e => setContextDoc(e.target.value)}
            placeholder="# Project Context: My Project&#10;&#10;## Repository&#10;/home/node/.openclaw/workspace/my-project&#10;&#10;## Tech Stack&#10;..."
          />
          <button
            style={{ ...styles.btn, ...(saving ? styles.btnDisabled : {}) }}
            onClick={saveDoc}
            disabled={saving}
          >
            {saving ? 'Saving...' : '💾 Save Context Document'}
          </button>
        </div>
      )}

      {message && (
        <div style={styles.message}>{message}</div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 800, margin: '0 auto', padding: '24px 20px', color: '#f9fafb', fontFamily: 'system-ui, sans-serif' },
  loading: { padding: 40, textAlign: 'center', color: '#9ca3af' },
  header: { display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 20 },
  backBtn: { background: 'none', border: '1px solid #374151', borderRadius: 8, color: '#9ca3af', cursor: 'pointer', padding: '6px 14px', fontSize: 13 },
  title: { margin: 0, fontSize: 24, fontWeight: 700, color: '#f9fafb' },
  subtitle: { margin: '4px 0 0', color: '#9ca3af', fontSize: 14 },
  badge: { marginLeft: 'auto', background: '#065f46', color: '#6ee7b7', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' },
  explainer: { background: '#1f2937', border: '1px solid #374151', borderRadius: 10, padding: '14px 18px', marginBottom: 20, fontSize: 14, color: '#d1d5db', lineHeight: 1.6 },
  tabs: { display: 'flex', gap: 8, marginBottom: 20 },
  tab: { background: '#1f2937', border: '1px solid #374151', borderRadius: 8, color: '#9ca3af', cursor: 'pointer', padding: '8px 18px', fontSize: 14, fontWeight: 500 },
  tabActive: { background: '#0c4a6e', border: '1px solid #0284c7', color: '#7dd3fc' },
  section: { display: 'flex', flexDirection: 'column', gap: 16 },
  sectionHint: { margin: 0, color: '#9ca3af', fontSize: 13 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { color: '#e5e7eb', fontSize: 13, fontWeight: 600 },
  hint: { color: '#6b7280', fontSize: 11 },
  input: { background: '#111827', border: '1px solid #374151', borderRadius: 8, color: '#f9fafb', fontSize: 13, padding: '10px 12px' },
  textarea: { background: '#111827', border: '1px solid #374151', borderRadius: 8, color: '#f9fafb', fontSize: 13, padding: '10px 12px', resize: 'vertical', width: '100%', boxSizing: 'border-box' },
  btn: { background: '#0ea5e9', border: 'none', borderRadius: 10, color: '#fff', cursor: 'pointer', fontSize: 15, fontWeight: 700, padding: '13px 24px', alignSelf: 'flex-start' },
  btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  message: { marginTop: 16, background: '#1f2937', border: '1px solid #374151', borderRadius: 8, padding: '12px 16px', fontSize: 14, color: '#d1d5db' },
}
