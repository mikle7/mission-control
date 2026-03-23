import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { eventBus } from '@/lib/event-bus'

interface PlanningTask {
  title: string
  description: string
  priority: string
  tags: string[]
  complexity: string
  requirements?: string[]
  depends_on?: string[]
}

interface PlanningResult {
  project: {
    name: string
    description: string
    core_value?: string
    tech_stack?: Record<string, unknown>
    constraints?: string[]
    out_of_scope?: string[]
  }
  context_doc?: string
  requirements?: Array<{
    id: string
    category: string
    description: string
    priority: string
    version: string
  }>
  tasks: PlanningTask[]
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function normalizePrefix(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
}

function normalizePriority(p: string): 'low' | 'medium' | 'high' | 'urgent' {
  const lower = (p || '').toLowerCase()
  if (lower === 'critical' || lower === 'urgent') return 'urgent'
  if (lower === 'high') return 'high'
  if (lower === 'low') return 'low'
  return 'medium'
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await request.json()
    const planningResult: PlanningResult = body?.planningResult
    const existingProjectId: number | undefined = body?.projectId
    if (!planningResult?.project?.name || !Array.isArray(planningResult.tasks)) {
      return NextResponse.json(
        { error: 'Invalid planning result: requires project.name and tasks array' },
        { status: 400 }
      )
    }

    const db = getDatabase()
    const workspaceId = auth.user.workspace_id
    const actor = auth.user.display_name || auth.user.username || 'planner'

    const slug = slugify(planningResult.project.name)
    const ticketPrefix = normalizePrefix(planningResult.project.name.slice(0, 5))

    if (!slug || !ticketPrefix) {
      return NextResponse.json({ error: 'Invalid project name for slug/prefix generation' }, { status: 400 })
    }

    const description = planningResult.project.description || ''
    const contextDoc = planningResult.context_doc || ''

    // Check for existing slug/prefix conflicts
    const existing = db.prepare(`
      SELECT id FROM projects
      WHERE workspace_id = ? AND (slug = ? OR ticket_prefix = ?)
      LIMIT 1
    `).get(workspaceId, slug, ticketPrefix) as { id: number } | undefined

    let projectId: number

    if (existingProjectId) {
      // Use the explicitly provided project ID
      projectId = existingProjectId
      if (contextDoc) {
        db.prepare(
          'UPDATE projects SET context_doc = ?, updated_at = unixepoch() WHERE id = ? AND workspace_id = ?'
        ).run(contextDoc, projectId, workspaceId)
      }
    } else if (existing) {
      // Update existing project with context_doc
      projectId = existing.id
      if (contextDoc) {
        db.prepare(
          'UPDATE projects SET context_doc = ?, updated_at = unixepoch() WHERE id = ? AND workspace_id = ?'
        ).run(contextDoc, projectId, workspaceId)
      }
    } else {
      // Create project with context_doc
      const result = db.prepare(`
        INSERT INTO projects (workspace_id, name, slug, description, ticket_prefix, context_doc, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'active', unixepoch(), unixepoch())
      `).run(workspaceId, planningResult.project.name, slug, description, ticketPrefix, contextDoc || null)
      projectId = Number(result.lastInsertRowid)
    }

    // Create tasks in a transaction
    const taskIds: number[] = []
    const now = Math.floor(Date.now() / 1000)

    const createTasks = db.transaction(() => {
      for (const task of planningResult.tasks) {
        // Increment ticket counter
        db.prepare(`
          UPDATE projects SET ticket_counter = ticket_counter + 1, updated_at = unixepoch()
          WHERE id = ? AND workspace_id = ?
        `).run(projectId, workspaceId)

        const row = db.prepare(`
          SELECT ticket_counter FROM projects WHERE id = ? AND workspace_id = ?
        `).get(projectId, workspaceId) as { ticket_counter: number }

        const metadata: Record<string, unknown> = {}
        if (task.complexity) metadata.complexity = task.complexity
        if (task.requirements) metadata.requirements = task.requirements
        if (task.depends_on) metadata.depends_on = task.depends_on

        const result = db.prepare(`
          INSERT INTO tasks (
            title, description, status, priority, project_id, project_ticket_no,
            assigned_to, created_by, created_at, updated_at,
            tags, metadata, workspace_id
          ) VALUES (?, ?, 'inbox', ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
        `).run(
          task.title,
          task.description,
          normalizePriority(task.priority),
          projectId,
          row.ticket_counter,
          actor,
          now,
          now,
          JSON.stringify(task.tags || []),
          JSON.stringify(metadata),
          workspaceId
        )
        taskIds.push(Number(result.lastInsertRowid))
      }
    })

    createTasks()

    // Broadcast events for each created task
    for (const taskId of taskIds) {
      eventBus.broadcast('task.created', { id: taskId, workspace_id: workspaceId })
    }

    logger.info(
      { projectId, taskCount: taskIds.length, actor },
      'Planning wizard created project and tasks'
    )

    return NextResponse.json({ projectId, taskIds })
  } catch (error) {
    logger.error({ err: error }, 'Planning create error')
    return NextResponse.json({ error: 'Failed to create project and tasks' }, { status: 500 })
  }
}
