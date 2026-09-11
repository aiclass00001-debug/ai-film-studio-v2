import { appleTokenFetch } from '@/lib/appletoken'
export async function POST(req: Request) {
  try {
    const body = await req.json()
    return Response.json(await appleTokenFetch('/quote', { method: 'POST', body: JSON.stringify(body) }))
  } catch (e: any) { return Response.json({ error: e.message }, { status: 500 }) }
}
