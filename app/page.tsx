'use client'

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectBible } from '@/lib/types'

type Model = {
  id: string
  label?: string
  description?: string
  modality: 'image'|'video'|'text'|string
  constraints?: {
    sizes?: string[]
    resolutions?: string[]
    aspectRatios?: string[]
    minSeconds?: number
    maxSeconds?: number
    allowedSeconds?: number[]
    audio?: boolean
    maxReferences?: number
  }
  pricing?: { unit?: string; from?: number; to?: number }
}

type GeneratedImage = { url?: string; b64_json?: string; revised_prompt?: string }
type CharacterAsset = { id: string; url: string; prompt: string; master?: boolean }
type ConceptAsset = { id: string; url: string; prompt: string }
type VideoJob = { id: string; status: string; model?: string; content?: string; price_reserved?: number; price_charged?: number; error?: unknown; quote_id?: string }
type AssetType = 'image'|'video'|'audio'
type CloudAsset = { id: string; object?: string; type: AssetType; name?: string; status: 'processing'|'active'|'failed'|string; bytes?: number; mime?: string; reference?: string; created_at?: number; activated_at?: number|null }
type LocalRef = { id: string; kind: 'text'|'url'; name: string; text?: string; url?: string; type?: AssetType }

type LibraryFilter = 'all'|'image'|'video'|'audio'|'text'

const demoIdea = '未來台北屋頂夜市，一名女性 Cyberpunk 塔羅師替陌生旅人占卜。潮濕夜晚、霓虹燈、電影感，做成 30 秒神秘預告片。'
const LOCAL_REF_KEY = 'aifs-v04-local-refs'
const SAFE_PROXY_BYTES = 3 * 1024 * 1024

async function jsonFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, init)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const details = data?.details || data?.detail || data?.message || ''
    throw new Error(`${data?.error || `Request failed (${res.status})`}${details ? ` — ${String(details).slice(0, 1200)}` : ''}`)
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
function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)) }
function fileType(file: File): AssetType | null {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return null
}
function fileToDataUri(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error || new Error('Could not read file'))
    reader.readAsDataURL(file)
  })
}
function bytesLabel(bytes?: number) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
function roleFor(type: AssetType) { return type === 'image' ? 'reference_image' : type === 'video' ? 'reference_video' : 'reference_audio' }
function makeId(prefix: string) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }

const PREVIEW_DB = 'aifs-v04-reference-previews'
const PREVIEW_STORE = 'previews'
function openPreviewDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(PREVIEW_DB, 1)
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(PREVIEW_STORE)) req.result.createObjectStore(PREVIEW_STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function savePreview(id: string, source: string) {
  if (typeof indexedDB === 'undefined') return
  const db = await openPreviewDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PREVIEW_STORE, 'readwrite')
    tx.objectStore(PREVIEW_STORE).put(source, id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}
async function readPreview(id: string) {
  if (typeof indexedDB === 'undefined') return undefined
  const db = await openPreviewDb()
  const value = await new Promise<string | undefined>((resolve, reject) => {
    const req = db.transaction(PREVIEW_STORE, 'readonly').objectStore(PREVIEW_STORE).get(id)
    req.onsuccess = () => resolve(req.result as string | undefined)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return value
}

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

  const [cloudAssets, setCloudAssets] = useState<CloudAsset[]>([])
  const [localRefs, setLocalRefs] = useState<LocalRef[]>([])
  const [selectedRefIds, setSelectedRefIds] = useState<string[]>([])
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('all')
  const [librarySearch, setLibrarySearch] = useState('')
  const [libraryBusy, setLibraryBusy] = useState(false)
  const [libraryError, setLibraryError] = useState('')
  const [assetPreviews, setAssetPreviews] = useState<Record<string,string>>({})
  const [addMode, setAddMode] = useState<'none'|'text'|'url'>('none')
  const [draftRefName, setDraftRefName] = useState('')
  const [draftRefValue, setDraftRefValue] = useState('')
  const [draftRefType, setDraftRefType] = useState<AssetType>('image')
  const fileInput = useRef<HTMLInputElement | null>(null)

  const shot = useMemo(() => bible?.shots?.[activeShot], [bible, activeShot])
  const masterCharacter = characterAssets.find(a => a.master)
  const activeImageModel = imageModels.find(m => m.id === imageModel)
  const activeVideoModel = videoModels.find(m => m.id === videoModel)
  const selectedCloudAssets = useMemo(() => cloudAssets.filter(a => selectedRefIds.includes(a.id) && a.status === 'active'), [cloudAssets, selectedRefIds])
  const selectedLocalRefs = useMemo(() => localRefs.filter(a => selectedRefIds.includes(a.id)), [localRefs, selectedRefIds])
  const selectedTextRefs = selectedLocalRefs.filter(r => r.kind === 'text')
  const selectedUrlRefs = selectedLocalRefs.filter(r => r.kind === 'url' && r.url && r.type)
  const autoRefCount = (masterCharacter ? 1 : 0) + (conceptAssets[0] ? 1 : 0)
  const totalReferenceCount = selectedCloudAssets.length + selectedUrlRefs.length + autoRefCount
  const maxReferences = activeVideoModel?.constraints?.maxReferences

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LOCAL_REF_KEY)
      if (saved) setLocalRefs(JSON.parse(saved))
    } catch {}
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
    refreshLibrary()
  }, [])

  useEffect(() => {
    try { localStorage.setItem(LOCAL_REF_KEY, JSON.stringify(localRefs)) } catch {}
  }, [localRefs])

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

  async function refreshLibrary() {
    setLibraryError('')
    try {
      const data = await jsonFetch('/api/appletoken/assets?limit=100')
      const assets: CloudAsset[] = Array.isArray(data?.data) ? data.data : []
      setCloudAssets(assets)
      const pairs = await Promise.all(assets.map(async a => [a.id, await readPreview(a.id)] as const))
      setAssetPreviews(prev => ({...prev, ...Object.fromEntries(pairs.filter(([,v]) => Boolean(v)) as Array<readonly [string,string]>) }))
    } catch (e: any) {
      setLibraryError(e.message)
    }
  }

  async function develop() {
    setLoading(true); setError(''); setNotice('')
    try {
      const notes = selectedTextRefs.map(r => r.text).filter(Boolean).join('\n')
      const expandedIdea = notes ? `${idea}\n\nREFERENCE NOTES:\n${notes}` : idea
      const data = await jsonFetch('/api/prompt', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ idea: expandedIdea }) })
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
        results.push({ id:makeId('char'), url:out.url, prompt })
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
      setConceptAssets(prev => [{ id:makeId('concept'), url:out.url, prompt }, ...prev])
      setNotice('Environment concept completed.')
    } catch(e:any){ setError(e.message) } finally { setGeneratingConcept(false) }
  }

  function setMaster(id: string) {
    setCharacterAssets(prev => prev.map(a => ({...a, master:a.id===id})))
    setNotice('MASTER CHARACTER locked. It will be added automatically to video references.')
  }

  function selectedReferences() {
    const refs:any[] = []
    if (masterCharacter?.url) refs.push({ type:'image', url:masterCharacter.url, role:'reference_image' })
    if (conceptAssets[0]?.url) refs.push({ type:'image', url:conceptAssets[0].url, role:'reference_image' })
    for (const a of selectedCloudAssets) {
      if (!a.reference) continue
      refs.push({ type:a.type, url:a.reference, role:roleFor(a.type) })
    }
    for (const a of selectedUrlRefs) {
      if (!a.url || !a.type) continue
      refs.push({ type:a.type, url:a.url, role:roleFor(a.type) })
    }
    return refs
  }

  function expandedVideoPrompt() {
    if (!shot) return ''
    const notes = selectedTextRefs.map(r => `- ${r.name}: ${r.text}`).join('\n')
    if (!notes) return shot.videoPrompt
    return `${shot.videoPrompt}\n\nREFERENCE NOTES / CONTINUITY:\n${notes}`
  }

  function videoPayload(forQuote = false) {
    if (!shot || !videoModel) throw new Error('Select a shot and a video model first.')
    const refs = selectedReferences()
    if (maxReferences && refs.length > maxReferences) throw new Error(`This model allows ${maxReferences} references. You selected ${refs.length}.`)
    const hasVideoReference = refs.some(r => r.type === 'video')
    const body:any = {
      model:videoModel,
      prompt:expandedVideoPrompt(),
      seconds:forQuote ? Number(seconds) : (hasVideoReference ? -1 : Number(seconds)),
      resolution,
      aspect_ratio:aspectRatio,
      generate_audio:audio,
    }
    if (refs.length) body.input_references = refs
    return body
  }

  async function getQuote() {
    setVideoBusy(true); setError('')
    try {
      const q = await jsonFetch('/api/appletoken/quote', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(videoPayload(true))})
      setQuote(q); setNotice('Quote validated. No credit charged.')
    } catch(e:any){ setError(e.message) } finally { setVideoBusy(false) }
  }

  async function generateVideo() {
    setVideoBusy(true); setError('')
    try {
      const refs = selectedReferences()
      const hasVideoReference = refs.some(r => r.type === 'video')
      const quotePayload = videoPayload(true)
      const q = quote?.quote_id ? quote : await jsonFetch('/api/appletoken/quote', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(quotePayload)})
      setQuote(q)
      const submitBody = hasVideoReference ? videoPayload(false) : (q?.quote_id ? { quote_id:q.quote_id, confirm:true } : videoPayload(false))
      const job = await jsonFetch('/api/appletoken/video', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(submitBody)})
      setVideoJob(job)
      setNotice(job?.status==='needs_confirmation' ? 'AppleToken returned a confirmation slip; confirm again to submit.' : `Video submitted: ${job.id || job.quote_id || 'request accepted'}`)
    } catch(e:any){ setError(e.message) } finally { setVideoBusy(false) }
  }

  async function confirmVideoSlip() {
    const quoteId = videoJob?.quote_id || quote?.quote_id
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
    try {
      const job = await jsonFetch('/api/appletoken/video-status', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:videoJob.id})})
      setVideoJob(job); setNotice(`Video status: ${job.status}`)
    } catch(e:any){ setError(e.message) } finally { setVideoBusy(false) }
  }

  async function pollAsset(id: string) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const asset: CloudAsset = await jsonFetch(`/api/appletoken/assets?id=${encodeURIComponent(id)}`)
      setCloudAssets(prev => [asset, ...prev.filter(a => a.id !== asset.id)])
      if (asset.status === 'active' || asset.status === 'failed') return asset
      await sleep(2500)
    }
    return null
  }

  async function uploadFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    setLibraryBusy(true); setLibraryError(''); setNotice(`Uploading ${files.length} reference file(s)…`)
    try {
      for (const file of files) {
        const type = fileType(file)
        if (!type) throw new Error(`${file.name}: unsupported file type.`)
        if (file.size > SAFE_PROXY_BYTES) throw new Error(`${file.name}: ${(file.size/1024/1024).toFixed(1)} MB is too large for the Vercel proxy-safe upload path. Use + URL for large media, or compress it below 3 MB.`)
        const source = await fileToDataUri(file)
        const asset: CloudAsset = await jsonFetch('/api/appletoken/assets', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ source, name:file.name, type }) })
        await savePreview(asset.id, source).catch(() => undefined)
        setAssetPreviews(prev => ({...prev, [asset.id]:source}))
        setCloudAssets(prev => [asset, ...prev.filter(a => a.id !== asset.id)])
        const ready = asset.status === 'active' ? asset : await pollAsset(asset.id)
        if (ready?.status === 'active') setSelectedRefIds(prev => prev.includes(ready.id) ? prev : [...prev, ready.id])
      }
      await refreshLibrary()
      setNotice('Reference upload completed. Active assets are selected for the current shot.')
    } catch (e:any) {
      setLibraryError(e.message)
    } finally {
      setLibraryBusy(false)
    }
  }

  function saveLocalReference() {
    if (!draftRefValue.trim()) return
    if (addMode === 'text') {
      const item: LocalRef = { id:makeId('text'), kind:'text', name:draftRefName.trim() || 'Production note', text:draftRefValue.trim() }
      setLocalRefs(prev => [item, ...prev]); setSelectedRefIds(prev => [...prev, item.id])
    } else if (addMode === 'url') {
      const item: LocalRef = { id:makeId('url'), kind:'url', name:draftRefName.trim() || 'External reference', url:draftRefValue.trim(), type:draftRefType }
      setLocalRefs(prev => [item, ...prev]); setSelectedRefIds(prev => [...prev, item.id])
    }
    setDraftRefName(''); setDraftRefValue(''); setAddMode('none')
  }

  function toggleReference(id: string) {
    setSelectedRefIds(prev => prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id])
    setQuote(null)
  }

  function removeLocalRef(id: string) {
    setLocalRefs(prev => prev.filter(r => r.id !== id))
    setSelectedRefIds(prev => prev.filter(v => v !== id))
  }

  const stages = [
    ['idea','01','IDEA','Project brief'],
    ['character','02','CHARACTER','Identity lock'],
    ['concept','03','CONCEPT','World building'],
    ['storyboard','04','STORYBOARD','Shot design'],
    ['video','05','VIDEO','Generate'],
  ]

  const filteredCloudAssets = cloudAssets.filter(a => {
    const matchesType = libraryFilter === 'all' || a.type === libraryFilter
    const matchesSearch = !librarySearch.trim() || `${a.name || ''} ${a.type}`.toLowerCase().includes(librarySearch.toLowerCase())
    return matchesType && matchesSearch
  })
  const filteredLocalRefs = localRefs.filter(a => {
    const type = a.kind === 'text' ? 'text' : a.type
    const matchesType = libraryFilter === 'all' || type === libraryFilter
    const matchesSearch = !librarySearch.trim() || `${a.name} ${a.text || ''} ${a.url || ''}`.toLowerCase().includes(librarySearch.toLowerCase())
    return matchesType && matchesSearch
  })

  return <main className="studioShell">
    <aside className="leftSidebar">
      <div className="brandBlock"><div className="brand"><span className="brandDot"/>AI FILM STUDIO</div><div className="version">V0.4 · REFERENCE WORKSPACE</div></div>
      <nav className="stageNav">{stages.map(([id,no,label,sub]) => <button key={id} className={`nav ${activeStage===id?'active':''}`} onClick={()=>setActiveStage(id)}><b>{no}</b><span><strong>{label}</strong><small>{sub}</small></span></button>)}</nav>
      <div className="sideCard"><small>WORKFLOW</small><strong>Prompt → Assets → Film</strong><span>Groq Director + AppleToken persistent reference library.</span></div>
    </aside>

    <section className="workspace">
      <header className="topbar">
        <div><div className="eyebrow">AI PRE-PRODUCTION / GENERATIVE FILM</div><h1>{bible?.project.title || 'Bring your story to life'}</h1></div>
        <div className="topMeta"><span className="modelCount"><i/>{models.length ? `${models.length} MODELS` : 'CATALOG'}</span></div>
      </header>

      <div className="connectionBar">
        <span className={health?.groq?.ok ? 'conn ok' : 'conn bad'}>GROQ {health?.groq?.ok ? 'READY' : health?.groq?.configured ? 'CHECK' : 'KEY MISSING'}</span>
        <span className={health?.appletoken?.ok ? 'conn ok' : 'conn bad'}>APPLETOKEN {health?.appletoken?.ok ? 'READY' : health?.appletoken?.configured ? 'CHECK' : 'KEY MISSING'}</span>
        {health?.groq?.configuredModel && <span className="conn">DIRECTOR {health.groq.configuredModel}</span>}
        <span className="conn">REFS {totalReferenceCount}{maxReferences ? ` / ${maxReferences}` : ''}</span>
      </div>
      {modelsError && <div className="warning">AppleToken catalog unavailable: {modelsError}</div>}
      {error && <div className="error">{error}</div>}{notice && <div className="notice">{notice}</div>}

      {activeStage==='idea' && <>
        <section className="welcomeBlock">
          <div className="welcomeCopy"><span>01 / DIRECTOR BRIEF</span><h2>今天想創作什麼？</h2><p>先用一句話描述故事；右側 Reference Library 可加入角色、場景、聲音、影片與文字資料。被選取的文字會送進 Groq，媒體會保留給後續生成。</p></div>
          <div className="skillPills"><button onClick={()=>setIdea('電影級長鏡頭：'+idea)}>電影級長鏡頭</button><button onClick={()=>setIdea('角色一致性優先：'+idea)}>角色一致性</button><button onClick={()=>setIdea('建築視覺化電影預視：'+idea)}>建築預視</button><button onClick={()=>setIdea('30秒商業廣告：'+idea)}>商業廣告</button></div>
        </section>
        <section className="composerPanel">
          <SelectedReferenceRow cloud={selectedCloudAssets} local={selectedLocalRefs} onRemove={toggleReference}/>
          <textarea className="heroPrompt" value={idea} onChange={e=>setIdea(e.target.value)} placeholder="描述故事、角色、場景、鏡頭或直接貼上劇本…"/>
          <div className="composerFooter"><div className="composerTools"><button onClick={()=>fileInput.current?.click()}>＋ Reference</button><span>Groq Director</span><span>Project Bible</span><span>6 Shots</span></div><button className="generateButton" onClick={develop} disabled={loading||!idea.trim()}>{loading?'DIRECTING…':'DEVELOP →'}</button></div>
        </section>
        {bible ? <Bible bible={bible}/> : <section className="guideGrid"><GuideCard no="01" title="Add references" text="從右側上傳圖片、音訊、影片或建立文字製作筆記。"/><GuideCard no="02" title="Build the bible" text="Groq 將 Brief 結構化成角色 DNA、世界觀、攝影語言與 Shot list。"/><GuideCard no="03" title="Generate" text="角色與場景鎖定後，引用同一批 Assets 進入 Reference-guided video。"/></section>}
      </>}

      {activeStage==='character' && <Stage title="Character Lab" kicker="02 / IDENTITY LOCK" disabled={!bible} description="先探索 4 個角色方向，再選一張鎖定為 Master Character。Master 會自動加入每個影片 Shot 的 references；右側資料庫則可再補服裝、髮型、產品或人物參考。">
        <div className="toolDock"><select value={imageModel} onChange={e=>setImageModel(e.target.value)}>{imageModels.map(m=><option key={m.id} value={m.id}>{modelLabel(m)}</option>)}</select><select value={imageSize} onChange={e=>setImageSize(e.target.value)}>{(activeImageModel?.constraints?.sizes?.length?activeImageModel.constraints.sizes:['1024x1024']).map(s=><option key={s}>{s}</option>)}</select><button className="primary" onClick={generateCharacterSet} disabled={generatingCharacter||!bible||!imageModel}>{generatingCharacter?'GENERATING…':'GENERATE ×4'}</button></div>
        {bible && <div className="promptBox"><small>CHARACTER DNA / MASTER PROMPT</small><p>{bible.character.characterPrompt}</p></div>}
        <div className="imageGrid">{characterAssets.map(a=><article className={`assetCard ${a.master?'master':''}`} key={a.id}><div className="imageFrame"><img src={a.url} alt="character concept"/></div><div className="assetFoot"><span>{a.master?'MASTER CHARACTER':'CHARACTER CONCEPT'}</span><button onClick={()=>setMaster(a.id)}>{a.master?'LOCKED ✓':'SET MASTER'}</button></div></article>)}</div>
      </Stage>}

      {activeStage==='concept' && <Stage title="Concept Lab" kicker="03 / WORLD BUILDING" disabled={!bible} description="建立 Environment Master，作為後續 Storyboard 與影片的世界觀錨點。右側 Library 可疊加建築、材質、燈光、產品與 style references。">
        <div className="toolDock"><select value={imageModel} onChange={e=>setImageModel(e.target.value)}>{imageModels.map(m=><option key={m.id} value={m.id}>{modelLabel(m)}</option>)}</select><select value={imageSize} onChange={e=>setImageSize(e.target.value)}>{(activeImageModel?.constraints?.sizes?.length?activeImageModel.constraints.sizes:['1024x1024']).map(s=><option key={s}>{s}</option>)}</select><button className="primary" onClick={generateConcept} disabled={generatingConcept||!bible||!imageModel}>{generatingConcept?'GENERATING…':'GENERATE ENVIRONMENT'}</button></div>
        {bible && <div className="promptBox"><small>ENVIRONMENT PROMPT</small><p>{bible.environment.environmentPrompt}</p></div>}
        <div className="imageGrid conceptGrid">{conceptAssets.map(a=><article className="assetCard" key={a.id}><div className="imageFrame wideImage"><img src={a.url} alt="environment concept"/></div><div className="assetFoot"><span>ENVIRONMENT MASTER</span></div></article>)}</div>
      </Stage>}

      {activeStage==='storyboard' && <Stage title="Storyboard" kicker="04 / SHOT DESIGN" disabled={!bible} description="每個 Shot 都保留 Image Prompt 與 Video Prompt。右側選取的文字 Notes 會在影片階段自動附加成 continuity instructions。">
        {bible && <section className="storyboard"><div className="shotRail">{bible.shots.map((s,i)=><button key={s.id} onClick={()=>setActiveShot(i)} className={`shotTab ${i===activeShot?'active':''}`}><b>{String(i+1).padStart(2,'0')}</b><span>{s.title}</span><small>{s.duration}s</small></button>)}</div>{shot&&<ShotDetail shot={shot} activeShot={activeShot}/>}</section>}
      </Stage>}

      {activeStage==='video' && <Stage title="Video Studio" kicker="05 / REFERENCE-GUIDED GENERATION" disabled={!bible} description="像 Higgsfield / 即夢的生成工作台：Prompt 在中央，模型與畫幅集中在下方，素材從右側 Library 選取。先 Quote，再 Generate。">
        <div className="videoWorkbench">
          <div className="videoComposer">
            <SelectedReferenceRow cloud={selectedCloudAssets} local={selectedLocalRefs} onRemove={toggleReference} master={masterCharacter?.url} environment={conceptAssets[0]?.url}/>
            <textarea className="videoPrompt" value={expandedVideoPrompt()} readOnly />
            <div className="videoControlRow">
              <select value={videoModel} onChange={e=>setVideoModel(e.target.value)}>{videoModels.map(m=><option key={m.id} value={m.id}>{modelLabel(m)}</option>)}</select>
              <select value={aspectRatio} onChange={e=>setAspectRatio(e.target.value)}>{(activeVideoModel?.constraints?.aspectRatios||['16:9','9:16','1:1','4:3','3:4','21:9']).map(v=><option key={v}>{v}</option>)}</select>
              <select value={resolution} onChange={e=>setResolution(e.target.value)}>{(activeVideoModel?.constraints?.resolutions||['720p']).map(v=><option key={v}>{v}</option>)}</select>
              <select value={seconds} onChange={e=>setSeconds(Number(e.target.value))}>{(activeVideoModel?.constraints?.allowedSeconds || makeSeconds(activeVideoModel)).map(v=><option key={v} value={v}>{v}s</option>)}</select>
              <label className="audioMini"><input type="checkbox" checked={audio} disabled={activeVideoModel?.constraints?.audio===false} onChange={e=>setAudio(e.target.checked)}/> Audio</label>
              <button className="quoteButton" onClick={getQuote} disabled={videoBusy||!shot||!videoModel}>QUOTE</button>
              <button className="generateButton" onClick={generateVideo} disabled={videoBusy||!shot||!videoModel}>GENERATE</button>
            </div>
          </div>
          <aside className="jobPanel"><small>JOB CONTROL</small>{quote?<div className="price"><span>QUOTE</span><b>${Number(quote.price??0).toFixed(4)}</b><em>{quote.estimated?'estimated':'validated'}</em></div>:<p className="muted">先 Quote 驗證參數與 references，不扣款。使用影片 reference 時，實際輸出長度由輸入影片決定。</p>}{videoJob&&<div className="job"><b>{videoJob.id || videoJob.quote_id || 'confirmation slip'}</b><span className={`jobStatus ${videoJob.status}`}>{videoJob.status}</span>{videoJob.price_charged!=null&&<span>${videoJob.price_charged}</span>}{videoJob.status==='needs_confirmation'?<button onClick={confirmVideoSlip} disabled={videoBusy}>CONFIRM & SUBMIT</button>:<button onClick={pollVideo} disabled={videoBusy||!videoJob.id}>REFRESH STATUS</button>}{videoJob.status==='completed'&&videoJob.id&&<video controls src={`/api/appletoken/video-content?id=${encodeURIComponent(videoJob.id)}`}/>}</div>}</aside>
        </div>
      </Stage>}
    </section>

    <aside className="libraryPanel">
      <div className="libraryHeader"><div><small>PROJECT DATABASE</small><h2>Reference Library</h2></div><button className="iconButton" onClick={refreshLibrary} title="Refresh library">↻</button></div>
      <p className="libraryIntro">AppleToken Assets 會跨生成重複使用；文字與外部 URL 暫存在此瀏覽器。點 <b>USE</b> 就會加入目前 Shot。</p>
      <div className="libraryActions"><button onClick={()=>fileInput.current?.click()} disabled={libraryBusy}>＋ UPLOAD</button><button onClick={()=>setAddMode(addMode==='text'?'none':'text')}>＋ TEXT</button><button onClick={()=>setAddMode(addMode==='url'?'none':'url')}>＋ URL</button></div>
      <input ref={fileInput} className="hiddenInput" type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/mp4" onChange={uploadFiles}/>
      <div className="uploadHint">多選上傳 · Vercel proxy 建議 ≤ 3 MB/檔；較大影片/音訊請用公開 URL。AppleToken 原生 Asset 上限為 20 MB。</div>

      {addMode !== 'none' && <div className="addReferenceBox"><input value={draftRefName} onChange={e=>setDraftRefName(e.target.value)} placeholder={addMode==='text'?'筆記名稱，例如：角色禁忌':'Reference 名稱'}/>{addMode==='url'&&<select value={draftRefType} onChange={e=>setDraftRefType(e.target.value as AssetType)}><option value="image">Image URL</option><option value="video">Video URL</option><option value="audio">Audio URL</option></select>}<textarea value={draftRefValue} onChange={e=>setDraftRefValue(e.target.value)} placeholder={addMode==='text'?'輸入角色設定、品牌規範、台詞、鏡頭限制或 continuity notes…':'https://… 需為可匿名直接存取的媒體檔案 URL'}/><div><button onClick={()=>setAddMode('none')}>CANCEL</button><button className="primary" onClick={saveLocalReference}>ADD TO LIBRARY</button></div></div>}

      <div className="librarySearch"><input value={librarySearch} onChange={e=>setLibrarySearch(e.target.value)} placeholder="Search assets…"/></div>
      <div className="libraryTabs">{(['all','image','video','audio','text'] as LibraryFilter[]).map(t=><button key={t} className={libraryFilter===t?'active':''} onClick={()=>setLibraryFilter(t)}>{t.toUpperCase()}</button>)}</div>
      {libraryBusy && <div className="libraryMessage">Uploading / activating assets…</div>}
      {libraryError && <div className="libraryError">{libraryError}</div>}

      {(masterCharacter || conceptAssets[0]) && <div className="sessionAssets"><small>SESSION OUTPUTS · AUTO REFERENCES</small>{masterCharacter&&<SessionOutputCard label="MASTER CHARACTER" image={masterCharacter.url}/>} {conceptAssets[0]&&<SessionOutputCard label="ENVIRONMENT" image={conceptAssets[0].url}/>}</div>}
      <div className="assetList">
        {filteredCloudAssets.map(asset => <LibraryAssetCard key={asset.id} asset={asset} preview={assetPreviews[asset.id]} selected={selectedRefIds.includes(asset.id)} onToggle={()=>toggleReference(asset.id)}/>) }
        {filteredLocalRefs.map(asset => <LocalRefCard key={asset.id} asset={asset} selected={selectedRefIds.includes(asset.id)} onToggle={()=>toggleReference(asset.id)} onDelete={()=>removeLocalRef(asset.id)}/>) }
        {!filteredCloudAssets.length && !filteredLocalRefs.length && <div className="emptyLibrary"><b>No references yet</b><span>Upload media, paste a URL, or add a production note.</span></div>}
      </div>
      <div className="libraryFooter"><span>{selectedRefIds.length} selected</span><span>{cloudAssets.length} cloud assets</span></div>
    </aside>
  </main>
}

function Stage({title,kicker,disabled,description,children}:{title:string;kicker:string;disabled:boolean;description:string;children:React.ReactNode}) {
  return <section><div className="sectionHead"><div><span>{kicker}</span><h2>{title}</h2><p>{description}</p></div>{disabled&&<div className="tag">CREATE PROJECT FIRST</div>}</div>{disabled?<section className="emptyState"><h2>Project Bible required.</h2><p>回到 IDEA，先讓 Prompt Director 建立 production bible。</p></section>:children}</section>
}
function Bible({bible}:{bible:ProjectBible}) { return <><div className="sectionHead compact"><div><span>OUTPUT</span><h2>Project Bible</h2></div><div className="tag">{bible.project.aspectRatio}</div></div><section className="bibleGrid"><article className="card wide"><small>PROJECT</small><h3>{bible.project.title}</h3><p>{bible.project.logline}</p><div className="meta"><span>{bible.project.genre}</span><span>{bible.project.visualStyle}</span></div></article><article className="card"><small>CHARACTER</small><h3>{bible.character.name}</h3><p>{bible.character.appearance}</p><p className="muted">{bible.character.costume}</p></article><article className="card"><small>WORLD</small><h3>{bible.environment.location}</h3><p>{bible.environment.architecture}</p><p className="muted">{bible.environment.lighting}</p></article><article className="card"><small>CAMERA</small><h3>{bible.cinematography.lenses.join(' · ')}</h3><p>{bible.cinematography.cameraLanguage}</p></article></section></> }
function ShotDetail({shot,activeShot}:{shot:ProjectBible['shots'][number];activeShot:number}) { return <div className="shotDetail"><div className="shotHeader"><div><small>SHOT {String(activeShot+1).padStart(2,'0')}</small><h3>{shot.title}</h3></div><div className="tag">{shot.lens} · {shot.duration}s</div></div><div className="shotStats"><span><b>FRAMING</b>{shot.framing}</span><span><b>MOTION</b>{shot.cameraMotion}</span><span><b>ACTION</b>{shot.action}</span></div><div className="promptBox"><small>IMAGE PROMPT</small><p>{shot.imagePrompt}</p></div><div className="promptBox accent"><small>VIDEO PROMPT</small><p>{shot.videoPrompt}</p></div></div> }
function GuideCard({no,title,text}:{no:string;title:string;text:string}) { return <article className="guideCard"><b>{no}</b><h3>{title}</h3><p>{text}</p></article> }
function SelectedReferenceRow({cloud,local,onRemove,master,environment}:{cloud:CloudAsset[];local:LocalRef[];onRemove:(id:string)=>void;master?:string;environment?:string}) {
  const any = cloud.length || local.length || master || environment
  if (!any) return <div className="selectedRefs empty">＋ 從右側 Reference Library 選取圖片、影片、音訊或文字</div>
  return <div className="selectedRefs">{master&&<span className="referenceToken">MASTER CHARACTER</span>}{environment&&<span className="referenceToken">ENVIRONMENT</span>}{cloud.map(a=><button key={a.id} onClick={()=>onRemove(a.id)} className="referenceToken">{a.type.toUpperCase()} · {a.name || a.id.slice(-6)} ×</button>)}{local.map(a=><button key={a.id} onClick={()=>onRemove(a.id)} className="referenceToken">{a.kind==='text'?'NOTE':a.type?.toUpperCase()} · {a.name} ×</button>)}</div>
}
function LibraryAssetCard({asset,preview,selected,onToggle}:{asset:CloudAsset;preview?:string;selected:boolean;onToggle:()=>void}) {
  return <article className={`libraryAsset ${selected?'selected':''}`}><div className={`assetThumb ${asset.type}`}>{preview&&asset.type==='image'?<img src={preview} alt="asset preview"/>:preview&&asset.type==='video'?<video src={preview} muted/>:<span>{asset.type==='image'?'IMG':asset.type==='video'?'VID':'AUD'}</span>}</div><div className="assetInfo"><strong>{asset.name || asset.id}</strong><span>{asset.type.toUpperCase()} · {bytesLabel(asset.bytes)}</span><small className={`assetStatus ${asset.status}`}>{asset.status}</small></div><button className="useButton" disabled={asset.status!=='active'} onClick={onToggle}>{selected?'USED ✓':'USE'}</button></article>
}
function SessionOutputCard({label,image}:{label:string;image:string}) { return <article className="libraryAsset session"><div className="assetThumb image"><img src={image} alt={label}/></div><div className="assetInfo"><strong>{label}</strong><span>GENERATED THIS SESSION</span><small className="assetStatus active">AUTO USED</small></div><span className="autoBadge">AUTO</span></article> }
function LocalRefCard({asset,selected,onToggle,onDelete}:{asset:LocalRef;selected:boolean;onToggle:()=>void;onDelete:()=>void}) {
  return <article className={`libraryAsset ${selected?'selected':''}`}><div className={`assetThumb ${asset.kind==='text'?'text':asset.type}`}>{asset.kind==='url'&&asset.type==='image'&&asset.url?<img src={asset.url} alt="url reference"/>:<span>{asset.kind==='text'?'TXT':asset.type?.slice(0,3).toUpperCase()}</span>}</div><div className="assetInfo"><strong>{asset.name}</strong><span>{asset.kind==='text'?'LOCAL NOTE':`${asset.type?.toUpperCase()} URL`}</span><small>{asset.kind==='text'?(asset.text||'').slice(0,48):(asset.url||'').slice(0,48)}</small></div><div className="localActions"><button className="useButton" onClick={onToggle}>{selected?'USED ✓':'USE'}</button><button className="deleteButton" onClick={onDelete}>×</button></div></article>
}
function makeSeconds(m?:Model) { const min=m?.constraints?.minSeconds??4, max=Math.min(m?.constraints?.maxSeconds??10,15); const a:number[]=[]; for(let i=min;i<=max;i++) a.push(i); return a }
