import { NextRequest, NextResponse } from 'next/server'
import { appleTokenFetch } from '@/lib/appletoken'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')?.trim()
    if (id) {
      const data = await appleTokenFetch(`/assets/${encodeURIComponent(id)}`)
      return NextResponse.json(data)
    }
    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit') || 100), 1), 100)
    const type = req.nextUrl.searchParams.get('type')?.trim()
    const status = req.nextUrl.searchParams.get('status')?.trim()
    const query = new URLSearchParams({ limit: String(limit) })
    if (type) query.set('type', type)
    if (status) query.set('status', status)
    const data = await appleTokenFetch(`/assets?${query.toString()}`)
    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json({ error: 'AppleToken asset request failed', details: message(error) }, { status: 502 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body?.source || typeof body.source !== 'string') {
      return NextResponse.json({ error: 'source is required' }, { status: 400 })
    }
    const payload: Record<string, string> = { source: body.source }
    if (body.name) payload.name = String(body.name)
    if (body.type) payload.type = String(body.type)
    const data = await appleTokenFetch('/assets', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    return NextResponse.json(data, { status: 202 })
  } catch (error) {
    return NextResponse.json({ error: 'AppleToken asset upload failed', details: message(error) }, { status: 502 })
  }
}
