import fs from 'node:fs'
const required=[
  'app/page.tsx','app/api/prompt/route.ts','app/api/health/route.ts',
  'app/api/appletoken/models/route.ts','app/api/appletoken/image/route.ts',
  'app/api/appletoken/quote/route.ts','app/api/appletoken/video/route.ts',
  'app/api/appletoken/video-status/route.ts','app/api/appletoken/video-content/route.ts',
  'app/api/appletoken/assets/route.ts','lib/appletoken.ts','lib/types.ts'
]
for(const f of required){ if(!fs.existsSync(f)) throw new Error(`Missing ${f}`) }
const files=required.map(f=>[f,fs.readFileSync(f,'utf8')])
const client=fs.readFileSync('app/page.tsx','utf8')
if(/process\.env\.(GROQ_API_KEY|APPLETOKEN_API_KEY)/.test(client)) throw new Error('Server secret referenced from client source')
for(const [f,s] of files){
  if (/from ['\"]openai['\"]|from ['\"]@supabase\/supabase-js['\"]/.test(s)) throw new Error(`Removed dependency still imported in ${f}`)
}
for (const token of ["'/api/appletoken/quote'", 'input_references', 'SET MASTER', "'/api/health'", "'/api/appletoken/assets'", 'Reference Library', 'selectedRefIds']) {
  if(!client.includes(token)) throw new Error(`Expected V0.4 workflow token missing: ${token}`)
}
const assets=fs.readFileSync('app/api/appletoken/assets/route.ts','utf8')
if(!assets.includes("appleTokenFetch('/assets'") || !assets.includes('/assets/${encodeURIComponent(id)}')) throw new Error('AppleToken asset proxy incomplete')
const prompt=fs.readFileSync('app/api/prompt/route.ts','utf8')
if(!prompt.includes('/models') || !prompt.includes('MODEL_PRIORITY')) throw new Error('Groq live-model fallback missing')
console.log('AI Film Studio V0.4 source checks: PASS')
