import type { ProjectBible } from '@/lib/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const GROQ_BASE = 'https://api.groq.com/openai/v1'
const MODEL_PRIORITY = [
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'llama-3.1-8b-instant',
]

const directorSystem = `You are an expert AI film director, concept artist, cinematographer, production designer and prompt engineer.
Turn the user's rough film idea into a production-ready project bible for AI image and video generation.
Prioritize character identity continuity, production design continuity, cinematic blocking, camera logic and reference-friendly prompts.
Do not imitate copyrighted characters or living artists.
Write all generation prompts in English because they will be sent to image/video models. Project titles and descriptive fields may follow the user's language.
Return ONLY one valid JSON object, with no markdown fences and no commentary.
The object MUST have exactly these top-level keys: project, character, environment, cinematography, shots.
Create exactly 6 shots.
Schema:
{
  "project": {"title":"string","logline":"string","genre":"string","visualStyle":"string","aspectRatio":"16:9"},
  "character": {"name":"string","role":"string","appearance":"string","costume":"string","personality":"string","characterPrompt":"English production prompt"},
  "environment": {"location":"string","architecture":"string","lighting":"string","weather":"string","environmentPrompt":"English production prompt"},
  "cinematography": {"lenses":["35mm","50mm"],"cameraLanguage":"string","lightingLanguage":"string","colorPalette":["string"]},
  "shots": [
    {"id":"shot-01","title":"string","duration":5,"framing":"string","lens":"35mm","cameraMotion":"string","action":"string","imagePrompt":"English production prompt","videoPrompt":"English production prompt"}
  ]
}`

type GroqModel = { id?: string; active?: boolean }

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}
function num(value: unknown, fallback = 5): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}
function strings(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.map(v => String(v).trim()).filter(Boolean) : fallback
}

function normalizeBible(raw: any): ProjectBible {
  const shotsRaw = Array.isArray(raw?.shots) ? raw.shots.slice(0, 6) : []
  while (shotsRaw.length < 6) shotsRaw.push({})
  return {
    project: {
      title: text(raw?.project?.title, 'Untitled Film'),
      logline: text(raw?.project?.logline, 'A cinematic short film concept.'),
      genre: text(raw?.project?.genre, 'Cinematic'),
      visualStyle: text(raw?.project?.visualStyle, 'cinematic realism'),
      aspectRatio: text(raw?.project?.aspectRatio, '16:9'),
    },
    character: {
      name: text(raw?.character?.name, 'Protagonist'),
      role: text(raw?.character?.role, 'Main character'),
      appearance: text(raw?.character?.appearance, 'Distinctive cinematic protagonist'),
      costume: text(raw?.character?.costume, 'Production-ready wardrobe'),
      personality: text(raw?.character?.personality, 'Focused and enigmatic'),
      characterPrompt: text(raw?.character?.characterPrompt, 'cinematic character design, consistent facial identity, full production wardrobe, neutral studio reference, high detail'),
    },
    environment: {
      location: text(raw?.environment?.location, 'Cinematic location'),
      architecture: text(raw?.environment?.architecture, 'Detailed production environment'),
      lighting: text(raw?.environment?.lighting, 'motivated cinematic lighting'),
      weather: text(raw?.environment?.weather, 'atmospheric'),
      environmentPrompt: text(raw?.environment?.environmentPrompt, 'cinematic environment concept art, production design, detailed architecture, atmospheric lighting, no text, no watermark'),
    },
    cinematography: {
      lenses: strings(raw?.cinematography?.lenses, ['35mm', '50mm', '85mm']),
      cameraLanguage: text(raw?.cinematography?.cameraLanguage, 'controlled cinematic camera movement'),
      lightingLanguage: text(raw?.cinematography?.lightingLanguage, 'motivated practical lighting with dimensional contrast'),
      colorPalette: strings(raw?.cinematography?.colorPalette, ['cyan', 'magenta', 'warm tungsten']),
    },
    shots: shotsRaw.map((s: any, i: number) => ({
      id: text(s?.id, `shot-${String(i + 1).padStart(2, '0')}`),
      title: text(s?.title, `Shot ${i + 1}`),
      duration: num(s?.duration, 5),
      framing: text(s?.framing, 'medium shot'),
      lens: text(s?.lens, i === 0 ? '24mm' : '50mm'),
      cameraMotion: text(s?.cameraMotion, 'slow controlled dolly'),
      action: text(s?.action, 'cinematic character action'),
      imagePrompt: text(s?.imagePrompt, 'cinematic storyboard keyframe, consistent character and environment, production lighting, no text, no watermark'),
      videoPrompt: text(s?.videoPrompt, 'cinematic controlled motion, preserve character identity and wardrobe, physically plausible movement, stable environment continuity'),
    })),
  }
}

function extractJson(input: string): any {
  const clean = input.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(clean) } catch {}
  const first = clean.indexOf('{')
  const last = clean.lastIndexOf('}')
  if (first >= 0 && last > first) return JSON.parse(clean.slice(first, last + 1))
  throw new Error('Groq returned text that could not be parsed as JSON.')
}

async function chooseModel(apiKey: string): Promise<{ model: string; available: string[] }> {
  const configured = process.env.GROQ_MODEL?.trim()
  try {
    const res = await fetch(`${GROQ_BASE}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      const detail = await res.text()
      throw new Error(`Groq model check failed (${res.status}): ${detail.slice(0, 300)}`)
    }
    const json = await res.json()
    const available = (Array.isArray(json?.data) ? json.data : [])
      .filter((m: GroqModel) => m?.id && m.active !== false)
      .map((m: GroqModel) => String(m.id))
    if (configured && available.includes(configured)) return { model: configured, available }
    const preferred = MODEL_PRIORITY.find(id => available.includes(id))
    return { model: preferred || configured || available[0] || 'llama-3.3-70b-versatile', available }
  } catch (e) {
    if (configured) return { model: configured, available: [] }
    throw e
  }
}

async function callGroq(apiKey: string, model: string, idea: string, useJsonMode = true) {
  const body: any = {
    model,
    temperature: 0.35,
    messages: [
      { role: 'system', content: directorSystem },
      { role: 'user', content: `Develop this film idea into the required production bible:\n${idea}` },
    ],
  }
  if (useJsonMode) body.response_format = { type: 'json_object' }
  return fetch(`${GROQ_BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
}

export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => ({}))
    const idea = text(payload?.idea)
    if (!idea) return Response.json({ error: 'Film idea is required.' }, { status: 400 })

    const apiKey = process.env.GROQ_API_KEY?.trim()
    if (!apiKey) return Response.json({ error: 'GROQ_API_KEY is missing in Vercel Environment Variables.', code: 'GROQ_KEY_MISSING' }, { status: 500 })

    const { model, available } = await chooseModel(apiKey)
    let res = await callGroq(apiKey, model, idea, true)
    let detail = await res.text()

    // Some Groq-compatible models may reject response_format. Retry once without it.
    if (!res.ok && res.status === 400 && /response_format|json_object|unsupported/i.test(detail)) {
      res = await callGroq(apiKey, model, idea, false)
      detail = await res.text()
    }

    if (!res.ok) {
      return Response.json({
        error: `Groq API failed (${res.status}).`,
        details: detail.slice(0, 1200),
        model,
        availableModels: available.slice(0, 20),
      }, { status: res.status >= 400 && res.status < 600 ? res.status : 502 })
    }

    const completion = JSON.parse(detail)
    const raw = completion?.choices?.[0]?.message?.content
    if (!raw) return Response.json({ error: 'Groq returned an empty completion.', model }, { status: 502 })

    const bible = normalizeBible(extractJson(String(raw)))
    return Response.json({ bible, meta: { provider: 'groq', model } })
  } catch (error: any) {
    return Response.json({ error: error?.message || 'Prompt Director failed.', code: 'PROMPT_DIRECTOR_ERROR' }, { status: 500 })
  }
}
