import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const db = getDatabase()
  const project = db.prepare('SELECT id, name, context_doc FROM projects WHERE id = ?').get(Number(id))
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ project })
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id } = await params
  const body = await request.json()
  const { context_doc } = body

  const db = getDatabase()
  db.prepare(
    'UPDATE projects SET context_doc = ?, updated_at = unixepoch() WHERE id = ?'
  ).run(context_doc ?? null, Number(id))

  const project = db.prepare('SELECT id, name, context_doc FROM projects WHERE id = ?').get(Number(id))
  return NextResponse.json({ project })
}
