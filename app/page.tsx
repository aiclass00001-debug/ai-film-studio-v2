'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ProjectBible } from '@/lib/types'

type Model = {
  id: string; label?: string; description?: string; modality: 'image'|'video'|'text'|string
  constraints?: { sizes?: string[]; minPixels?: number; maxPixels?: number; resolutions?: string[]; aspectRatios?: string[]; minSeconds?: number; maxSeconds?: number; allowedSeconds?: number[]; audio?: boolean; maxReferences?: number }
  pricing?: { unit?: string; from?: number; to?: number }
}
type GeneratedImage = { url?: string; b64_json?: string; revised_prompt?: string }
type CharacterAsset = { id: string; url: string; prompt: string; master?: boolean }
type ConceptAsset = { id: string; url: string; prompt: string }
type VideoJob = { id: string; status: string; model?: string; content?: string; price_reserved?: number; price_charged?: number; error?: unknown }

const demoIdea = '未來台北屋頂夜市，一名女性 Cyberpunk 塔羅師替陌生旅人占卜。潮濕夜晚、霓虹燈、電影感，做成 30 秒神秘預告片。'

async function jsonFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, init)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const details = data?.details || data?.detail || data?.message || ''
    throw new Error(`${data?.error || `Request failed (${res.status})`}${details ? ` — ${String(details).slice(0, 900)}` : ''}`)
  }
  return data
}

function inferModality(raw: any): string {
  const explicit = raw?.modality || raw?.type || raw?.category
  if (typeof explicit === 'string') return explicit.toLowerCase()
  const hay = `${raw?.id || ''} ${raw?.name || ''} ${raw?.label || ''}`.toLowerCase()
  if (/seedream|image|flux|imagen|nano.?banana/.test(hay)) return 'image'
  if (/seedance|video|veo|kling|sora|hailuo|wan/.test(hay)) return 'video'
  return 'text'
}

function normalizeModelsPayload(data: any): Model[] {
  const source = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : []
  return source.map((m: any) => ({
    ...m,
    id: String(m?.id || m?.model || m?.name || ''),
    label: m?.label || m?.display_name || m?.name,
    modality: inferModality(m),
    constraints: m?.constraints || m?.capabilities || {},
  })).filter((m: Model) => Boolean(m.id))
}

function modelLabel(m: Model) { return `${m.label || m.id} · ${m.id}` }
function firstAllowed<T>(items: T[] | undefined, fallback: T): T { return items?.[0] ?? fallback }

export default function Home() {
  const [idea, setIdea] = useState(demoIdea)
  const [bible, setBible] = useState<ProjectBible | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [activeStage, setActiveStage] = useState('idea')
  const [activeShot, setActiveShot] = useState(0)

  const [models, setModels] = useState<Model[]>([])
  const imageModels = useMemo(() => models.filter(m => m.modality === 'image'), [models])
  const videoModels = useMemo(() => models.filter(m => m.modality === 'video'), [models])
  const [imageModel, setImageModel] = useState('')
  const [videoModel, setVideoModel] = useState('')
  const [imageSize, setImageSize] = useState('1024x1024')
  const [resolution, setResolution] = useState('720p')
  const [seconds, setSeconds] = useState(5)
  const [aspectRatio, setAspectRatio] = useState('16:9')
  const [audio, setAudio] = useState(true)
  const [modelsError, setModelsError] = useState('')
  const [health, setHealth] = useState<any>(null)

  const [characterAssets, setCharacterAssets] = useState<CharacterAsset[]>([])
  const [conceptAssets, setConceptAssets] = useState<ConceptAsset[]>([])
  const [generatingCharacter, setGeneratingCharacter] = useState(false)
  const [generatingConcept, setGeneratingConcept] = useState(false)
  const [quote, setQuote] = useState<any>(null)
  const [videoJob, setVideoJob] = useState<VideoJob | null>(null)
  const [videoBusy, setVideoBusy] = useState(false)

  const shot = useMemo(() => bible?.shots?.[activeShot], [bible, activeShot])
  const masterCharacter = characterAssets.find(a => a.master)
  const activeImageModel = imageModels.find(m => m.id === imageModel)
  const activeVideoModel = videoModels.find(m => m.id === videoModel)

  useEffect(() => {
    jsonFetch('/api/health').then(setHealth).catch(() => setHealth(null))
    jsonFetch('/api/appletoken/models').then(data => {
      const list: Model[] = normalizeModelsPayload(data)
      setModels(list)
      const im = list.find(m => m.modality === 'image')
      const vm = list.find(m => m.modality === 'video')
      if (im) { setImageModel(im.id); setImageSize(firstAllowed(im.constraints?.sizes, '1024x1024')) }
      if (vm) {
        setVideoModel(vm.id)
        setResolution(firstAllowed(vm.constraints?.resolutions, '720p'))
        setAspectRatio(firstAllowed(vm.constraints?.aspectRatios, '16:9'))
        setSeconds(vm.constraints?.allowedSeconds?.[0] ?? vm.constraints?.minSeconds ?? 5)
        setAudio(vm.constraints?.audio !== false)
      }
    }).catch(e => setModelsError(e.message))
  }, [])

  useEffect(() => {
    if (!activeImageModel) return
    setImageSize(firstAllowed(activeImageModel.constraints?.sizes, '1024x1024'))
  }, [imageModel])

  useEffect(() => {
    if (!activeVideoModel) return
    setResolution(firstAllowed(activeVideoModel.constraints?.resolutions, '720p'))
    setAspectRatio(firstAllowed(activeVideoModel.constraints?.aspectRatios, '16:9'))
    setSeconds(activeVideoModel.constraints?.allowedSeconds?.[0] ?? activeVideoModel.constraints?.minSeconds ?? 5)
    setAudio(activeVideoModel.constraints?.audio !== false)
    setQuote(null)
  }, [videoModel])

  async function develop() {
    setLoading(true); setError(''); setNotice('')
    try {
      const data = await jsonFetch('/api/prompt', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ idea }) })
      setBible(data.bible); setActiveShot(0); setActiveStage('character'); setCharacterAssets([]); setConceptAssets([]); setVideoJob(null); setQuote(null)
    } catch (e:any) { setError(e.message) } finally { setLoading(false) }
  }

  async function generateImage(prompt: string) {
    if (!imageModel) throw new Error('No AppleToken image model is available for this key.')
    const base:any = { model: imageModel, prompt, response_format:'url' }
    if (imageSize) base.size = imageSize
    const q = await jsonFetch('/api/appletoken/quote', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(base) })
    setNotice(`Image quote: $${Number(q.price ?? 0).toFixed(4)} USD`)
    const data = await jsonFetch('/api/appletoken/image', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(base) })
    const item: GeneratedImage | undefined = data?.data?.[0]
    if (!item?.url && !item?.b64_json) throw new Error('AppleToken returned no image data.')
    return { data, url: item.url || `data:image/png;base64,${item.b64_json}` }
  }

  async function generateCharacterSet() {
    if (!bible) return
    setGeneratingCharacter(true); setError(''); setNotice('Generating 4 character explorations…')
    try {
      const variants = ['hero portrait, 3/4 view', 'full body production design', 'cinematic close-up identity study', 'costume and silhouette exploration']
      const results: CharacterAsset[] = []
      for (let i=0;i<variants.length;i++) {
        const prompt = `${bible.character.characterPrompt}. ${variants[i]}. ${bible.project.visualStyle}. Maintain the exact same character identity, facial proportions, hairstyle, wardrobe language and color palette. Clean cinematic concept art, no text, no watermark.`
        const out = await generateImage(prompt)
        results.push({ id:`char-${Date.now()}-${i}`, url:out.url, prompt })
      }
      setCharacterAssets(results); setNotice('4 character concepts completed. Select MASTER CHARACTER.')
    } catch(e:any){ setError(e.message) } finally { setGeneratingCharacter(false) }
  }

  async function generateConcept() {
    if (!bible) return
    setGeneratingConcept(true); setError(''); setNotice('Generating environment concept…')
    try {
      const prompt = `${bible.environment.environmentPrompt}. ${bible.project.visualStyle}. Production concept art, ${bible.cinematography.cameraLanguage}, ${bible.cinematography.lightingLanguage}, no characters in foreground, no text, no watermark.`
      const out = await generateImage(prompt)
      setConceptAssets(prev => [{ id:`concept-${Date.now()}`, url:out.url, prompt }, ...prev])
      setNotice('Environment concept completed.')
    } catch(e:any){ setError(e.message) } finally { setGeneratingConcept(false) }
  }

  function setMaster(id: string) { setCharacterAssets(prev => prev.map(a => ({...a, master:a.id===id}))); setNotice('MASTER CHARACTER locked for reference-guided video.') }

  function videoPayload() {
    if (!shot || !videoModel) throw new Error('Select a shot and a video model first.')
    const body:any = { model:videoModel, prompt:shot.videoPrompt, seconds:Number(seconds), resolution, aspect_ratio:aspectRatio, generate_audio:audio }
    const refs:any[] = []
    if (masterCharacter?.url) refs.push({ type:'image', url:masterCharacter.url })
    if (conceptAssets[0]?.url) refs.push({ type:'image', url:conceptAssets[0].url })
    if (refs.length) body.input_references = refs
    return body
  }

  async function getQuote() {
    setVideoBusy(true); setError('')
    try { const q = await jsonFetch('/api/appletoken/quote', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(videoPayload())}); setQuote(q); setNotice('Quote validated. No credit charged.') }
    catch(e:any){ setError(e.message) } finally { setVideoBusy(false) }
  }

  async function generateVideo() {
    setVideoBusy(true); setError('')
    try {
      const payload = videoPayload()
      const q = quote?.quote_id ? quote : await jsonFetch('/api/appletoken/quote', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      setQuote(q)
      const submitBody = q?.quote_id ? { quote_id:q.quote_id, confirm:true } : payload
      const job = await jsonFetch('/api/appletoken/video', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(submitBody)})
      setVideoJob(job)
      setNotice(job?.status==='needs_confirmation' ? 'AppleToken returned a confirmation slip; confirm again to submit.' : `Video submitted: ${job.id || job.quote_id || 'request accepted'}`)
    } catch(e:any){ setError(e.message) } finally { setVideoBusy(false) }
  }

  async function confirmVideoSlip() {
    const quoteId = (videoJob as any)?.quote_id || quote?.quote_id
    if (!quoteId) return
    setVideoBusy(true); setError('')
    try {
      const job = await jsonFetch('/api/appletoken/video', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quote_id:quoteId,confirm:true})})
      setVideoJob(job); setNotice(`Video submitted: ${job.id || quoteId}`)
    } catch(e:any){ setError(e.message) } finally { setVideoBusy(false) }
  }

  async function pollVideo() {
    if (!videoJob?.id) return
    setVideoBusy(true); setError('')
    try { const job = await jsonFetch('/api/appletoken/video-status', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:videoJob.id})}); setVideoJob(job); setNotice(`Video status: ${job.status}`) }
    catch(e:any){ setError(e.message) } finally { setVideoBusy(false) }
  }

  const stages = [ ['idea','01 / IDEA'], ['character','02 / CHARACTER'], ['concept','03 / CONCEPT'], ['storyboard','04 / STORYBOARD'], ['video','05 / VIDEO'] ]

  return <main className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brandDot"/>AI FILM STUDIO</div><div className="version">V0.3 · VERCEL BUILD</div>
      <nav>{stages.map(([id,label]) => <button key={id} className={`nav ${activeStage===id?'active':''}`} onClick={()=>setActiveStage(id)}>{label}</button>)}</nav>
      <div className="sideCard"><small>PIPELINE</small><strong>Groq → AppleToken</strong><span>Project Bible · Character Lock · Concept · Reference Video</span></div>
    </aside>

    <section className="content">
      <header className="topbar"><div><div className="eyebrow">AI PRE-PRODUCTION / GENERATIVE FILM</div><h1>{bible?.project.title || 'Idea → Film'}</h1></div><div className="status"><span/>{models.length ? `${models.length} MODELS` : 'V0.3 READY'}</div></header>
      <div className="connectionBar">
        <span className={health?.groq?.ok ? 'conn ok' : 'conn bad'}>GROQ {health?.groq?.ok ? 'READY' : health?.groq?.configured ? 'CHECK' : 'KEY MISSING'}</span>
        <span className={health?.appletoken?.ok ? 'conn ok' : 'conn bad'}>APPLETOKEN {health?.appletoken?.ok ? 'READY' : health?.appletoken?.configured ? 'CHECK' : 'KEY MISSING'}</span>
        {health?.groq?.configuredModel && <span className="conn">MODEL {health.groq.configuredModel}</span>}
      </div>
      {modelsError && <div className="warning">AppleToken catalog unavailable: {modelsError}. Character / Concept / Video generation stays disabled until APPLETOKEN_API_KEY is valid.</div>}
      {error && <div className="error">{error}</div>}{notice && <div className="notice">{notice}</div>}

      {activeStage==='idea' && <>
        <section className="heroGrid"><div className="panel ideaPanel"><div className="panelTitle"><span>01</span> FILM IDEA</div><textarea value={idea} onChange={e=>setIdea(e.target.value)}/><div className="toolbar"><div className="chips"><span>PROJECT BIBLE</span><span>CHARACTER DNA</span><span>6 SHOTS</span></div><button className="primary" onClick={develop} disabled={loading||!idea.trim()}>{loading?'DIRECTING…':'DEVELOP WITH GROQ →'}</button></div></div><div className="panel monitor"><div className="scanline"/><div className="monitorLabel">PROMPT DIRECTOR</div><div className="monitorCore">AI</div><div className="monitorText">STRUCTURED OUTPUT<br/>IDENTITY · WORLD · CAMERA · SHOTS</div></div></section>
        {bible && <Bible bible={bible}/>} {!bible && <section className="emptyState"><div className="cross">+</div><h2>Start from one sentence.</h2><p>Groq 將概念拆成角色 DNA、環境、攝影語言與可直接進生成管線的 Shot prompts。</p></section>}
      </>}

      {activeStage==='character' && <Stage title="Character Lab" kicker="02 / IDENTITY LOCK" disabled={!bible}>
        <div className="controlBar"><select value={imageModel} onChange={e=>setImageModel(e.target.value)}>{imageModels.map(m=><option key={m.id} value={m.id}>{modelLabel(m)}</option>)}</select><select value={imageSize} onChange={e=>setImageSize(e.target.value)}>{(activeImageModel?.constraints?.sizes?.length?activeImageModel.constraints.sizes:['1024x1024']).map(s=><option key={s}>{s}</option>)}</select><button className="primary" onClick={generateCharacterSet} disabled={generatingCharacter||!bible||!imageModel}>{generatingCharacter?'GENERATING…':'GENERATE ×4'}</button></div>
        {bible && <div className="promptBox"><small>CHARACTER DNA / MASTER PROMPT</small><p>{bible.character.characterPrompt}</p></div>}
        <div className="imageGrid">{characterAssets.map(a=><article className={`assetCard ${a.master?'master':''}`} key={a.id}><div className="imageFrame"><img src={a.url} alt="character concept"/></div><div className="assetFoot"><span>{a.master?'MASTER CHARACTER':'CHARACTER CONCEPT'}</span><button onClick={()=>setMaster(a.id)}>{a.master?'LOCKED ✓':'SET MASTER'}</button></div></article>)}</div>
      </Stage>}

      {activeStage==='concept' && <Stage title="Concept Lab" kicker="03 / WORLD BUILDING" disabled={!bible}>
        <div className="controlBar"><select value={imageModel} onChange={e=>setImageModel(e.target.value)}>{imageModels.map(m=><option key={m.id} value={m.id}>{modelLabel(m)}</option>)}</select><select value={imageSize} onChange={e=>setImageSize(e.target.value)}>{(activeImageModel?.constraints?.sizes?.length?activeImageModel.constraints.sizes:['1024x1024']).map(s=><option key={s}>{s}</option>)}</select><button className="primary" onClick={generateConcept} disabled={generatingConcept||!bible||!imageModel}>{generatingConcept?'GENERATING…':'GENERATE ENVIRONMENT'}</button></div>
        {bible && <div className="promptBox"><small>ENVIRONMENT PROMPT</small><p>{bible.environment.environmentPrompt}</p></div>}
        <div className="imageGrid conceptGrid">{conceptAssets.map(a=><article className="assetCard" key={a.id}><div className="imageFrame wideImage"><img src={a.url} alt="environment concept"/></div><div className="assetFoot"><span>ENVIRONMENT MASTER</span></div></article>)}</div>
      </Stage>}

      {activeStage==='storyboard' && <Stage title="Storyboard" kicker="04 / SHOT DESIGN" disabled={!bible}>
        {bible && <section className="storyboard"><div className="shotRail">{bible.shots.map((s,i)=><button key={s.id} onClick={()=>setActiveShot(i)} className={`shotTab ${i===activeShot?'active':''}`}><b>{String(i+1).padStart(2,'0')}</b><span>{s.title}</span><small>{s.duration}s</small></button>)}</div>{shot&&<ShotDetail shot={shot} activeShot={activeShot}/>}</section>}
      </Stage>}

      {activeStage==='video' && <Stage title="Video Studio" kicker="05 / REFERENCE-GUIDED GENERATION" disabled={!bible}>
        <div className="videoLayout"><div><div className="controlGrid"><label>MODEL<select value={videoModel} onChange={e=>setVideoModel(e.target.value)}>{videoModels.map(m=><option key={m.id} value={m.id}>{modelLabel(m)}</option>)}</select></label><label>RESOLUTION<select value={resolution} onChange={e=>setResolution(e.target.value)}>{(activeVideoModel?.constraints?.resolutions||['720p']).map(v=><option key={v}>{v}</option>)}</select></label><label>ASPECT<select value={aspectRatio} onChange={e=>setAspectRatio(e.target.value)}>{(activeVideoModel?.constraints?.aspectRatios||['16:9','9:16','1:1','4:3','3:4','21:9']).map(v=><option key={v}>{v}</option>)}</select></label><label>SECONDS<select value={seconds} onChange={e=>setSeconds(Number(e.target.value))}>{(activeVideoModel?.constraints?.allowedSeconds || makeSeconds(activeVideoModel)).map(v=><option key={v} value={v}>{v}s</option>)}</select></label></div>
          <label className="audioToggle"><input type="checkbox" checked={audio} disabled={activeVideoModel?.constraints?.audio===false} onChange={e=>setAudio(e.target.checked)}/> GENERATE AUDIO</label>
          <div className="referenceStrip"><RefChip title="MASTER CHARACTER" ready={!!masterCharacter} image={masterCharacter?.url}/><RefChip title="ENVIRONMENT" ready={!!conceptAssets[0]} image={conceptAssets[0]?.url}/></div>
          {shot && <div className="promptBox accent"><small>SHOT {String(activeShot+1).padStart(2,'0')} / VIDEO PROMPT</small><p>{shot.videoPrompt}</p></div>}
          <div className="actions"><button onClick={getQuote} disabled={videoBusy||!shot||!videoModel}>QUOTE</button><button className="primary" onClick={generateVideo} disabled={videoBusy||!shot||!videoModel}>GENERATE VIDEO →</button></div>
        </div><aside className="jobPanel"><small>JOB CONTROL</small>{quote?<div className="price"><span>QUOTE</span><b>${Number(quote.price??0).toFixed(4)}</b><em>{quote.estimated?'estimated':'validated'}</em></div>:<p className="muted">Quote before generation. AppleToken validates model constraints without charging.</p>}{videoJob&&<div className="job"><b>{videoJob.id || (videoJob as any).quote_id || 'confirmation slip'}</b><span className={`jobStatus ${videoJob.status}`}>{videoJob.status}</span>{videoJob.price_charged!=null&&<span>${videoJob.price_charged}</span>}{videoJob.status==='needs_confirmation'?<button onClick={confirmVideoSlip} disabled={videoBusy}>CONFIRM & SUBMIT</button>:<button onClick={pollVideo} disabled={videoBusy||!videoJob.id}>REFRESH STATUS</button>}{videoJob.status==='completed'&&videoJob.id&&<video controls src={`/api/appletoken/video-content?id=${encodeURIComponent(videoJob.id)}`}/>}</div>}</aside></div>
      </Stage>}
    </section>
  </main>
}

function Stage({title,kicker,disabled,children}:{title:string;kicker:string;disabled:boolean;children:React.ReactNode}) { return <section><div className="sectionHead"><div><span>{kicker}</span><h2>{title}</h2></div>{disabled&&<div className="tag">CREATE PROJECT FIRST</div>}</div>{disabled?<section className="emptyState"><h2>Project Bible required.</h2><p>回到 IDEA，先讓 Prompt Director 建立 production bible。</p></section>:children}</section> }
function Bible({bible}:{bible:ProjectBible}) { return <><div className="sectionHead"><div><span>OUTPUT</span><h2>Project Bible</h2></div><div className="tag">{bible.project.aspectRatio}</div></div><section className="bibleGrid"><article className="card wide"><small>PROJECT</small><h3>{bible.project.title}</h3><p>{bible.project.logline}</p><div className="meta"><span>{bible.project.genre}</span><span>{bible.project.visualStyle}</span></div></article><article className="card"><small>CHARACTER</small><h3>{bible.character.name}</h3><p>{bible.character.appearance}</p><p className="muted">{bible.character.costume}</p></article><article className="card"><small>WORLD</small><h3>{bible.environment.location}</h3><p>{bible.environment.architecture}</p><p className="muted">{bible.environment.lighting}</p></article><article className="card"><small>CAMERA</small><h3>{bible.cinematography.lenses.join(' · ')}</h3><p>{bible.cinematography.cameraLanguage}</p></article></section></> }
function ShotDetail({shot,activeShot}:{shot:ProjectBible['shots'][number];activeShot:number}) { return <div className="shotDetail"><div className="shotHeader"><div><small>SHOT {String(activeShot+1).padStart(2,'0')}</small><h3>{shot.title}</h3></div><div className="tag">{shot.lens} · {shot.duration}s</div></div><div className="shotStats"><span><b>FRAMING</b>{shot.framing}</span><span><b>MOTION</b>{shot.cameraMotion}</span><span><b>ACTION</b>{shot.action}</span></div><div className="promptBox"><small>IMAGE PROMPT</small><p>{shot.imagePrompt}</p></div><div className="promptBox accent"><small>VIDEO PROMPT</small><p>{shot.videoPrompt}</p></div></div> }
function RefChip({title,ready,image}:{title:string;ready:boolean;image?:string}) { return <div className={`refChip ${ready?'ready':''}`}>{image?<img src={image} alt="reference"/>:<div className="refEmpty">+</div>}<span>{title}</span><b>{ready?'READY':'MISSING'}</b></div> }
function makeSeconds(m?:Model) { const min=m?.constraints?.minSeconds??4, max=Math.min(m?.constraints?.maxSeconds??10,15); const a=[]; for(let i=min;i<=max;i++) a.push(i); return a }
