import { appleTokenFetch } from '@/lib/appletoken'
export const dynamic = 'force-dynamic'
export async function GET() {
  try { return Response.json(await appleTokenFetch('/models')) }
  catch (e: any) { return Response.json({ error: e.message }, { status: 500 }) }
}
