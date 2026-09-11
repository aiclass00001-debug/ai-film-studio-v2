import { appleTokenFetch } from '@/lib/appletoken'
export async function POST(req: Request) {
  try {
    const { id } = await req.json()
    if (!id) return Response.json({ error: 'id is required' }, { status: 400 })
    return Response.json(await appleTokenFetch(`/videos/${encodeURIComponent(id)}`))
  } catch (e: any) { return Response.json({ error: e.message }, { status: 500 }) }
}
