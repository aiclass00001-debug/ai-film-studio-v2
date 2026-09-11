const BASE = 'https://appletoken.app/v1'

function apiKey() {
  const value = process.env.APPLETOKEN_API_KEY?.trim()
  if (!value) throw new Error('APPLETOKEN_API_KEY is missing in Vercel Environment Variables.')
  return value
}

export async function appleTokenRawFetch(path: string, init: RequestInit = {}) {
  return fetch(`${BASE}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  })
}

export async function appleTokenFetch(path: string, init: RequestInit = {}) {
  const res = await appleTokenRawFetch(path, init)
  const contentType = res.headers.get('content-type') || ''
  const text = await res.text()
  let body: any = text
  if (contentType.includes('application/json')) {
    try { body = JSON.parse(text) } catch { body = { raw: text } }
  }
  if (!res.ok) {
    const upstream = typeof body === 'string' ? body : body?.error?.message || body?.error || body?.message || JSON.stringify(body)
    throw new Error(`AppleToken API failed (${res.status}): ${String(upstream).slice(0, 800)}`)
  }
  return body
}
