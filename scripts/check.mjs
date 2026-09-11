import fs from 'node:fs'
const required=[
  'app/page.tsx','app/api/prompt/route.ts','app/api/health/route.ts',
  'app/api/appletoken/models/route.ts','app/api/appletoken/image/route.ts',
  'app/api/appletoken/quote/route.ts','app/api/appletoken/video/route.ts',
  'app/api/appletoken/video-status/route.ts','app/api/appletoken/video-content/route.ts',
  'lib/appletoken.ts','lib/types.ts'
]
for(const f of required){ if(!fs.existsSync(f)) throw new Error(`Missing ${f}`) }
const files=required.map(f=>[f,fs.readFileSync(f,'utf8')])
const client=fs.readFileSync('app/page.tsx','utf8')
if(/process\.env\.(GROQ_API_KEY|APPLETOKEN_API_KEY)/.test(client)) throw new Error('Server secret referenced from client source')
for(const [f,s] of files){
  if (/from ['\"]openai['\"]|from ['\"]@supabase\/supabase-js['\"]/.test(s)) throw new Error(`Removed dependency still imported in ${f}`)
}
if(!client.includes("'/api/appletoken/quote'")) throw new Error('Quote-before-generate flow missing')
if(!client.includes('input_references')) throw new Error('Reference-guided video flow missing')
if(!client.includes('SET MASTER')) throw new Error('Master character flow missing')
if(!client.includes("'/api/health'")) throw new Error('Connection diagnostics missing')
const prompt=fs.readFileSync('app/api/prompt/route.ts','utf8')
if(!prompt.includes('/models') || !prompt.includes('MODEL_PRIORITY')) throw new Error('Groq live-model fallback missing')
console.log('AI Film Studio V0.3 source checks: PASS')
