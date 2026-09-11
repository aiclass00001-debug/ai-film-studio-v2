export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function probe(url: string, key: string | undefined) {
  if (!key) return { configured: false, ok: false, status: 'MISSING_KEY' }
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' })
    const text = await res.text()
    return { configured: true, ok: res.ok, status: res.status, detail: res.ok ? undefined : text.slice(0, 220) }
  } catch (e: any) {
    return { configured: true, ok: false, status: 'NETWORK_ERROR', detail: e?.message || String(e) }
  }
}

export async function GET() {
  const groq = await probe('https://api.groq.com/openai/v1/models', process.env.GROQ_API_KEY)
  const appletoken = await probe('https://appletoken.app/v1/models', process.env.APPLETOKEN_API_KEY)
  return Response.json({
    app: { version: '0.3.0', runtime: 'vercel-nextjs' },
    groq: { ...groq, configuredModel: process.env.GROQ_MODEL || 'AUTO' },
    appletoken,
  })
}
