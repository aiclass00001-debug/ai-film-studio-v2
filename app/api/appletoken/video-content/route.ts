import { appleTokenRawFetch } from '@/lib/appletoken'
export const dynamic = 'force-dynamic'
export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return Response.json({ error: 'id is required' }, { status: 400 })
    const upstream = await appleTokenRawFetch(`/videos/${encodeURIComponent(id)}/content`)
    return new Response(upstream.body, { status: upstream.status, headers: { 'Content-Type': upstream.headers.get('content-type') || 'video/mp4', 'Cache-Control':'no-store' } })
  } catch (e:any) { return Response.json({ error:e.message }, {status:500}) }
}
