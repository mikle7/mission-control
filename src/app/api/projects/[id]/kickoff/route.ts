import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'

function generateContextDoc(data: {
  projectName: string
  description: string
  repoPath: string
  techStack: string
  apiEndpoints: string
  agentConventions: string
  knownGotchas: string
  acceptanceCriteria: string
  outOfScope: string
}): string {
  const now = new Date().toISOString().split('T')[0]
  const section = (title: string, content: string) =>
    content.trim() ? `## ${title}\n${content.trim()}\n` : ''

  return `# Project Context: ${data.projectName}
> Generated ${now} via Project Kickoff Wizard

## Overview
${data.description || 'No description provided.'}

${section('Repository Path', data.repoPath ? `\`${data.repoPath}\`` : '')}
${section('Tech Stack', data.techStack)}
${section('API Endpoints & Services', data.apiEndpoints)}
${section('Agent Conventions', data.agentConventions)}
${section('Known Gotchas ⚠️', data.knownGotchas)}
${section('Project Success Criteria', data.acceptanceCriteria)}
${section('Out of Scope', data.outOfScope)}
---
*Update this document as the project evolves. Injected into every agent task prompt.*
`.replace(/\n{3,}/g, '\n\n')
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const body = await request.json()
  const db = getDatabase()

  const project = db.prepare('SELECT id, name, description FROM projects WHERE id = ?').get(Number(id)) as any
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const context_doc = generateContextDoc({
    projectName: project.name,
    description: body.description || project.description || '',
    repoPath: body.repoPath || '',
    techStack: body.techStack || '',
    apiEndpoints: body.apiEndpoints || '',
    agentConventions: body.agentConventions || '',
    knownGotchas: body.knownGotchas || '',
    acceptanceCriteria: body.acceptanceCriteria || '',
    outOfScope: body.outOfScope || '',
  })

  db.prepare(
    'UPDATE projects SET context_doc = ?, updated_at = unixepoch() WHERE id = ?'
  ).run(context_doc, Number(id))

  return NextResponse.json({ project: { id: project.id, name: project.name, context_doc } })
}
