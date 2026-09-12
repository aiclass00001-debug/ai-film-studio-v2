'use client'

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react'
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
type VideoJob = { id?: string; status: string; model?: string; content?: string; price_reserved?: number; price_charged?: number; error?: unknown; quote_id?: string }
type Take = VideoJob & { takeId: string; shotId: string; createdAt: number }
type AssetType = 'image'|'video'|'audio'
type CloudAsset = { id: string; object?: string; type: AssetType; name?: string; status: 'processing'|'active'|'failed'|string; bytes?: number; mime?: string; reference?: string; created_at?: number; activated_at?: number|null }
type LocalRef = { id: string; kind: 'text'|'url'; name: string; text?: string; url?: string; type?: AssetType }
type LibraryFilter = 'all'|'image'|'video'|'audio'|'text'
type Workspace = 'project'|'cast'|'world'|'shots'|'output'
type IdentityLocks = { face:boolean; hair:boolean; age:boolean; costume:boolean; body:boolean }

const demoIdea = '未來台北屋頂夜市，一名女性 Cyberpunk 塔羅師替陌生旅人占卜。潮濕夜晚、霓虹燈、電影感，做成 30 秒神秘預告片。'
const LOCAL_REF_KEY = 'aifs-v05-local-refs'
const PROJECT_STATE_KEY = 'aifs-v05-project-state'
const SAFE_PROXY_BYTES = 3 * 1024 * 1024
const PREVIEW_DB = 'aifs-v05-reference-previews'
const PREVIEW_STORE = 'previews'

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
function makeMention(name: string) {
  const clean = name.replace(/\.[a-z0-9]+$/i,'').replace(/[^a-zA-Z0-9\u4e00-\u9fff]+/g,' ').trim().split(/\s+/).slice(0,4).join('')
  return `@${clean || 'Reference'}`
}
function makeSeconds(m?:Model) {
  const min=m?.constraints?.minSeconds??4, max=Math.min(m?.constraints?.maxSeconds??10,15)
  const a:number[]=[]; for(let i=min;i<=max;i++) a.push(i); return a
}
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
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error)
  })
  db.close()
}
async function readPreview(id: string) {
  if (typeof indexedDB === 'undefined') return undefined
  const db = await openPreviewDb()
  const value = await new Promise<string | undefined>((resolve, reject) => {
    const req = db.transaction(PREVIEW_STORE, 'readonly').objectStore(PREVIEW_STORE).get(id)
    req.onsuccess = () => resolve(req.result as string | undefined); req.onerror = () => reject(req.error)
  })
  db.close(); return value
}

export default function Home() {
  const [idea, setIdea] = useState(demoIdea)
  const [bible, setBible] = useState<ProjectBible | null>(null)
  const [workspace, setWorkspace] = useState<Workspace>('project')
  const [activeShot, setActiveShot] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

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
  const [identityLocks, setIdentityLocks] = useState<IdentityLocks>({face:true,hair:true,age:true,costume:true,body:true})
  const [generatingCharacter, setGeneratingCharacter] = useState(false)
  const [generatingConcept, setGeneratingConcept] = useState(false)
  const [generatingKeyframe, setGeneratingKeyframe] = useState(false)
  const [shotKeyframes, setShotKeyframes] = useState<Record<string,string>>({})
  const [shotPromptOverrides, setShotPromptOverrides] = useState<Record<string,string>>({})

  const [projectRefIds, setProjectRefIds] = useState<string[]>([])
  const [shotRefIds, setShotRefIds] = useState<Record<string,string[]>>({})
  const [cloudAssets, setCloudAssets] = useState<CloudAsset[]>([])
  const [localRefs, setLocalRefs] = useState<LocalRef[]>([])
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

  const [quote, setQuote] = useState<any>(null)
  const [videoBusy, setVideoBusy] = useState(false)
  const [takesByShot, setTakesByShot] = useState<Record<string,Take[]>>({})
  const [selectedTakeId, setSelectedTakeId] = useState('')
  const [heroTakeByShot, setHeroTakeByShot] = useState<Record<string,string>>({})

  const shot = useMemo(() => bible?.shots?.[activeShot], [bible, activeShot])
  const masterCharacter = characterAssets.find(a => a.master)
  const activeImageModel = imageModels.find(m => m.id === imageModel)
  const activeVideoModel = videoModels.find(m => m.id === videoModel)
  const referenceScope = workspace === 'shots' && shot ? shot.id : 'project'
  const currentRefIds = referenceScope === 'project' ? projectRefIds : (shotRefIds[referenceScope] || [])
  const selectedCloudAssets = useMemo(() => cloudAssets.filter(a => currentRefIds.includes(a.id) && a.status === 'active'), [cloudAssets, currentRefIds])
  const selectedLocalRefs = useMemo(() => localRefs.filter(a => currentRefIds.includes(a.id)), [localRefs, currentRefIds])
  const selectedTextRefs = selectedLocalRefs.filter(r => r.kind === 'text')
  const selectedUrlRefs = selectedLocalRefs.filter(r => r.kind === 'url' && r.url && r.type)
  const autoRefCount = (masterCharacter ? 1 : 0) + (conceptAssets[0] ? 1 : 0)
  const totalReferenceCount = selectedCloudAssets.length + selectedUrlRefs.length + autoRefCount
  const maxReferences = activeVideoModel?.constraints?.maxReferences
  const currentTakes = shot ? (takesByShot[shot.id] || []) : []
  const activeTake = currentTakes.find(t => t.takeId === selectedTakeId) || currentTakes[0]
  const heroTake = shot ? currentTakes.find(t => t.takeId === heroTakeByShot[shot.id]) : undefined
  const keyframeCount = Object.keys(shotKeyframes).length
  const heroCount = Object.keys(heroTakeByShot).length

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LOCAL_REF_KEY); if (saved) setLocalRefs(JSON.parse(saved))
      const project = localStorage.getItem(PROJECT_STATE_KEY)
      if (project) {
        const p = JSON.parse(project)
        if (p.idea) setIdea(p.idea)
        if (p.bible) setBible(p.bible)
        if (p.projectRefIds) setProjectRefIds(p.projectRefIds)
        if (p.shotRefIds) setShotRefIds(p.shotRefIds)
        if (p.characterAssets) setCharacterAssets(p.characterAssets)
        if (p.conceptAssets) setConceptAssets(p.conceptAssets)
        if (p.shotKeyframes) setShotKeyframes(p.shotKeyframes)
        if (p.shotPromptOverrides) setShotPromptOverrides(p.shotPromptOverrides)
        if (p.identityLocks) setIdentityLocks(p.identityLocks)
        if (p.takesByShot) setTakesByShot(p.takesByShot)
        if (p.heroTakeByShot) setHeroTakeByShot(p.heroTakeByShot)
      }
    } catch {}
    jsonFetch('/api/health').then(setHealth).catch(() => setHealth(null))
    jsonFetch('/api/appletoken/models').then(data => {
      const list: Model[] = normalizeModelsPayload(data); setModels(list)
      const im = list.find(m => m.modality === 'image'); const vm = list.find(m => m.modality === 'video')
      if (im) { setImageModel(im.id); setImageSize(firstAllowed(im.constraints?.sizes, '1024x1024')) }
      if (vm) {
        setVideoModel(vm.id); setResolution(firstAllowed(vm.constraints?.resolutions, '720p'))
        setAspectRatio(firstAllowed(vm.constraints?.aspectRatios, '16:9'))
        setSeconds(vm.constraints?.allowedSeconds?.[0] ?? vm.constraints?.minSeconds ?? 5); setAudio(vm.constraints?.audio !== false)
      }
    }).catch(e => setModelsError(e.message))
    refreshLibrary()
  }, [])

  useEffect(() => { try { localStorage.setItem(LOCAL_REF_KEY, JSON.stringify(localRefs)) } catch {} }, [localRefs])
  useEffect(() => {
    try { localStorage.setItem(PROJECT_STATE_KEY, JSON.stringify({idea,bible,projectRefIds,shotRefIds,characterAssets,conceptAssets,shotKeyframes,shotPromptOverrides,identityLocks,takesByShot,heroTakeByShot})) } catch {}
  }, [idea,bible,projectRefIds,shotRefIds,characterAssets,conceptAssets,shotKeyframes,shotPromptOverrides,identityLocks,takesByShot,heroTakeByShot])
  useEffect(() => { if (activeImageModel) setImageSize(firstAllowed(activeImageModel.constraints?.sizes, '1024x1024')) }, [imageModel])
  useEffect(() => {
    if (!activeVideoModel) return
    setResolution(firstAllowed(activeVideoModel.constraints?.resolutions, '720p'))
    setAspectRatio(firstAllowed(activeVideoModel.constraints?.aspectRatios, '16:9'))
    setSeconds(activeVideoModel.constraints?.allowedSeconds?.[0] ?? activeVideoModel.constraints?.minSeconds ?? 5)
    setAudio(activeVideoModel.constraints?.audio !== false); setQuote(null)
  }, [videoModel])
  useEffect(() => { setQuote(null); setSelectedTakeId('') }, [activeShot])

  async function refreshLibrary() {
    setLibraryError('')
    try {
      const data = await jsonFetch('/api/appletoken/assets?limit=100')
      const assets: CloudAsset[] = Array.isArray(data?.data) ? data.data : []
      setCloudAssets(assets)
      const pairs = await Promise.all(assets.map(async a => [a.id, await readPreview(a.id)] as const))
      setAssetPreviews(prev => ({...prev, ...Object.fromEntries(pairs.filter(([,v]) => Boolean(v)) as Array<readonly [string,string]>) }))
    } catch (e:any) { setLibraryError(e.message) }
  }

  function currentTextNotes() {
    return selectedTextRefs.map(r => r.text).filter(Boolean).join('\n')
  }
  function identityInstruction() {
    const locked = Object.entries(identityLocks).filter(([,v])=>v).map(([k])=>k)
    return locked.length ? `IDENTITY LOCK: preserve exact ${locked.join(', ')} from the master character reference.` : ''
  }
  function baseShotPrompt() {
    if (!shot) return ''
    return shotPromptOverrides[shot.id] ?? shot.videoPrompt
  }
  function currentPrompt() {
    if (!shot) return ''
    const base = baseShotPrompt()
    const notes = selectedTextRefs.map(r => `- ${r.name}: ${r.text}`).join('\n')
    return [base, identityInstruction(), notes ? `REFERENCE NOTES / CONTINUITY:\n${notes}` : ''].filter(Boolean).join('\n\n')
  }
  function updateCurrentPrompt(value:string) {
    if (!shot) return
    setShotPromptOverrides(prev => ({...prev,[shot.id]:value})); setQuote(null)
  }
  function insertMention(value:string) {
    if (!shot) { setNotice(`${value} is selected in the project reference context.`); return }
    const current = shotPromptOverrides[shot.id] ?? shot.videoPrompt
    if (!current.includes(value)) setShotPromptOverrides(prev => ({...prev,[shot.id]:`${current.trim()} ${value}`.trim()}))
  }

  async function develop() {
    setLoading(true); setError(''); setNotice('')
    try {
      const refs = localRefs.filter(r => projectRefIds.includes(r.id) && r.kind === 'text')
      const notes = refs.map(r => r.text).filter(Boolean).join('\n')
      const expandedIdea = notes ? `${idea}\n\nREFERENCE NOTES:\n${notes}` : idea
      const data = await jsonFetch('/api/prompt', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ idea: expandedIdea }) })
      setBible(data.bible); setActiveShot(0); setWorkspace('cast'); setCharacterAssets([]); setConceptAssets([]); setShotKeyframes({}); setShotPromptOverrides({}); setTakesByShot({}); setHeroTakeByShot({}); setQuote(null)
      const initial:Record<string,string[]> = {}; data.bible.shots.forEach((s:any)=>{ initial[s.id] = [...projectRefIds] }); setShotRefIds(initial)
      setNotice('Project Bible created. Project references were copied to all six shots.')
    } catch (e:any) { setError(e.message) } finally { setLoading(false) }
  }

  async function generateImage(prompt: string) {
    if (!imageModel) throw new Error('No AppleToken image model is available for this key.')
    const base:any = { model: imageModel, prompt, response_format:'url' }; if (imageSize) base.size = imageSize
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
      const notes = localRefs.filter(r=>projectRefIds.includes(r.id)&&r.kind==='text').map(r=>r.text).filter(Boolean).join('. ')
      const results: CharacterAsset[] = []
      for (let i=0;i<variants.length;i++) {
        const prompt = `${bible.character.characterPrompt}. ${variants[i]}. ${bible.project.visualStyle}. ${identityInstruction()} ${notes ? `Production notes: ${notes}.` : ''} Clean cinematic concept art, no text, no watermark.`
        const out = await generateImage(prompt); results.push({ id:makeId('char'), url:out.url, prompt })
      }
      setCharacterAssets(results); setNotice('4 character concepts completed. Select one and LOCK IDENTITY.')
    } catch(e:any){ setError(e.message) } finally { setGeneratingCharacter(false) }
  }

  async function generateConcept() {
    if (!bible) return
    setGeneratingConcept(true); setError(''); setNotice('Generating environment concept…')
    try {
      const notes = localRefs.filter(r=>projectRefIds.includes(r.id)&&r.kind==='text').map(r=>r.text).filter(Boolean).join('. ')
      const prompt = `${bible.environment.environmentPrompt}. ${bible.project.visualStyle}. Production concept art, ${bible.cinematography.cameraLanguage}, ${bible.cinematography.lightingLanguage}. ${notes ? `Production notes: ${notes}.` : ''} no characters in foreground, no text, no watermark.`
      const out = await generateImage(prompt); setConceptAssets(prev => [{ id:makeId('concept'), url:out.url, prompt }, ...prev]); setNotice('Environment Master completed.')
    } catch(e:any){ setError(e.message) } finally { setGeneratingConcept(false) }
  }

  async function generateKeyframe() {
    if (!bible || !shot) return
    setGeneratingKeyframe(true); setError(''); setNotice(`Generating storyboard keyframe for ${shot.title}…`)
    try {
      const notes = currentTextNotes()
      const prompt = `${shot.imagePrompt}. CHARACTER CONTINUITY: ${bible.character.characterPrompt}. WORLD CONTINUITY: ${bible.environment.environmentPrompt}. ${identityInstruction()} ${notes ? `Notes: ${notes}.` : ''} Cinematic storyboard keyframe, no typography, no watermark.`
      const out = await generateImage(prompt); setShotKeyframes(prev=>({...prev,[shot.id]:out.url})); setNotice(`${shot.title} keyframe completed.`)
    } catch(e:any){ setError(e.message) } finally { setGeneratingKeyframe(false) }
  }

  function setMaster(id: string) {
    setCharacterAssets(prev => prev.map(a => ({...a, master:a.id===id}))); setNotice('Identity locked. Master Character will be automatically referenced in every video shot.')
  }

  function selectedReferences() {
    const refs:any[] = []
    if (masterCharacter?.url) refs.push({ type:'image', url:masterCharacter.url, role:'reference_image' })
    if (conceptAssets[0]?.url) refs.push({ type:'image', url:conceptAssets[0].url, role:'reference_image' })
    for (const a of selectedCloudAssets) if (a.reference) refs.push({ type:a.type, url:a.reference, role:roleFor(a.type) })
    for (const a of selectedUrlRefs) if (a.url && a.type) refs.push({ type:a.type, url:a.url, role:roleFor(a.type) })
    return refs
  }
  function videoPayload(forQuote = false) {
    if (!shot || !videoModel) throw new Error('Select a shot and a video model first.')
    const refs = selectedReferences(); if (maxReferences && refs.length > maxReferences) throw new Error(`This model allows ${maxReferences} references. You selected ${refs.length}.`)
    const hasVideoReference = refs.some(r => r.type === 'video')
    const body:any = { model:videoModel, prompt:currentPrompt(), seconds:forQuote ? Number(seconds) : (hasVideoReference ? -1 : Number(seconds)), resolution, aspect_ratio:aspectRatio, generate_audio:audio }
    if (refs.length) body.input_references = refs
    return body
  }
  async function getQuote() {
    setVideoBusy(true); setError('')
    try { const q = await jsonFetch('/api/appletoken/quote', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(videoPayload(true))}); setQuote(q); setNotice('Quote validated. No credit charged.') }
    catch(e:any){ setError(e.message) } finally { setVideoBusy(false) }
  }
  function upsertTake(shotId:string, job:VideoJob, takeId?:string) {
    const id = takeId || job.id || job.quote_id || makeId('take')
    setTakesByShot(prev => {
      const list = prev[shotId] || []; const exists = list.find(t=>t.takeId===id)
      const item:Take = {...(exists||{}),...job,takeId:id,shotId,createdAt:exists?.createdAt||Date.now()}
      return {...prev,[shotId]:[item,...list.filter(t=>t.takeId!==id)]}
    }); setSelectedTakeId(id); return id
  }
  async function generateVideo() {
    if (!shot) return
    setVideoBusy(true); setError('')
    try {
      const refs = selectedReferences(); const hasVideoReference = refs.some(r => r.type === 'video'); const quotePayload = videoPayload(true)
      const q = quote?.quote_id ? quote : await jsonFetch('/api/appletoken/quote', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(quotePayload)}); setQuote(q)
      const submitBody = hasVideoReference ? videoPayload(false) : (q?.quote_id ? { quote_id:q.quote_id, confirm:true } : videoPayload(false))
      const job = await jsonFetch('/api/appletoken/video', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(submitBody)})
      upsertTake(shot.id,job); setNotice(job?.status==='needs_confirmation' ? 'Confirmation required before submission.' : `Take submitted: ${job.id || job.quote_id || 'accepted'}`)
    } catch(e:any){ setError(e.message) } finally { setVideoBusy(false) }
  }
  async function confirmActiveTake() {
    if (!shot || !activeTake) return
    const quoteId = activeTake.quote_id || quote?.quote_id; if (!quoteId) return
    setVideoBusy(true); setError('')
    try { const job = await jsonFetch('/api/appletoken/video', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quote_id:quoteId,confirm:true})}); upsertTake(shot.id,job,activeTake.takeId); setNotice(`Take submitted: ${job.id || quoteId}`) }
    catch(e:any){ setError(e.message) } finally { setVideoBusy(false) }
  }
  async function pollActiveTake() {
    if (!shot || !activeTake?.id) return
    setVideoBusy(true); setError('')
    try { const job = await jsonFetch('/api/appletoken/video-status', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:activeTake.id})}); upsertTake(shot.id,job,activeTake.takeId); setNotice(`Take status: ${job.status}`) }
    catch(e:any){ setError(e.message) } finally { setVideoBusy(false) }
  }
  function markHero(takeId:string) { if (!shot) return; setHeroTakeByShot(prev=>({...prev,[shot.id]:takeId})); setNotice(`HERO TAKE selected for ${shot.title}.`) }

  async function pollAsset(id: string) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const asset: CloudAsset = await jsonFetch(`/api/appletoken/assets?id=${encodeURIComponent(id)}`); setCloudAssets(prev => [asset, ...prev.filter(a => a.id !== asset.id)])
      if (asset.status === 'active' || asset.status === 'failed') return asset; await sleep(2500)
    }
    return null
  }
  async function uploadFileList(files:File[]) {
    if (!files.length) return
    setLibraryBusy(true); setLibraryError(''); setNotice(`Uploading ${files.length} reference file(s)…`)
    try {
      for (const file of files) {
        const type = fileType(file); if (!type) throw new Error(`${file.name}: unsupported file type.`)
        if (file.size > SAFE_PROXY_BYTES) throw new Error(`${file.name}: ${(file.size/1024/1024).toFixed(1)} MB is too large for the Vercel proxy-safe upload path. Use + URL or compress it below 3 MB.`)
        const source = await fileToDataUri(file)
        const asset: CloudAsset = await jsonFetch('/api/appletoken/assets', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ source, name:file.name, type }) })
        await savePreview(asset.id, source).catch(() => undefined); setAssetPreviews(prev => ({...prev, [asset.id]:source})); setCloudAssets(prev => [asset, ...prev.filter(a => a.id !== asset.id)])
        const ready = asset.status === 'active' ? asset : await pollAsset(asset.id); if (ready?.status === 'active') toggleReference(ready.id,true)
      }
      await refreshLibrary(); setNotice('Reference upload completed and added to the current context.')
    } catch (e:any) { setLibraryError(e.message) } finally { setLibraryBusy(false) }
  }
  async function uploadFiles(event: ChangeEvent<HTMLInputElement>) { const files=Array.from(event.target.files||[]) as File[]; event.target.value=''; await uploadFileList(files) }
  async function dropFiles(event:DragEvent<HTMLDivElement>) { event.preventDefault(); await uploadFileList(Array.from(event.dataTransfer.files||[]) as File[]) }
  function saveLocalReference() {
    if (!draftRefValue.trim()) return
    let item:LocalRef
    if (addMode === 'text') item = { id:makeId('text'), kind:'text', name:draftRefName.trim() || 'Production note', text:draftRefValue.trim() }
    else item = { id:makeId('url'), kind:'url', name:draftRefName.trim() || 'External reference', url:draftRefValue.trim(), type:draftRefType }
    setLocalRefs(prev => [item,...prev]); setTimeout(()=>toggleReference(item.id,true),0); setDraftRefName(''); setDraftRefValue(''); setAddMode('none')
  }
  function setCurrentRefs(next:string[]) {
    if (referenceScope === 'project') setProjectRefIds(next)
    else setShotRefIds(prev=>({...prev,[referenceScope]:next}))
  }
  function toggleReference(id:string, forceOn=false) {
    const current = referenceScope === 'project' ? projectRefIds : (shotRefIds[referenceScope]||[])
    const next = forceOn ? (current.includes(id)?current:[...current,id]) : (current.includes(id)?current.filter(v=>v!==id):[...current,id])
    setCurrentRefs(next); setQuote(null)
  }
  function removeLocalRef(id: string) {
    setLocalRefs(prev => prev.filter(r => r.id !== id)); setProjectRefIds(prev=>prev.filter(v=>v!==id)); setShotRefIds(prev=>Object.fromEntries(Object.entries(prev).map(([k,v])=>[k,v.filter(x=>x!==id)])))
  }
  function copyProjectRefsToCurrentShot() {
    if (!shot) return; setShotRefIds(prev=>({...prev,[shot.id]:Array.from(new Set([...(prev[shot.id]||[]),...projectRefIds]))})); setNotice('Project references copied to current shot.')
  }
  function applyProjectRefsToAllShots() {
    if (!bible) return
    setShotRefIds(prev=>Object.fromEntries(bible.shots.map(s=>[s.id,Array.from(new Set([...(prev[s.id]||[]),...projectRefIds]))]))); setNotice('Project references copied to all shots.')
  }
  function resetProject() {
    if (!confirm('Start a new project? Current browser project state will be cleared.')) return
    setBible(null); setIdea(demoIdea); setWorkspace('project'); setActiveShot(0); setCharacterAssets([]); setConceptAssets([]); setShotKeyframes({}); setShotPromptOverrides({}); setProjectRefIds([]); setShotRefIds({}); setTakesByShot({}); setHeroTakeByShot({}); setQuote(null); setNotice('New project ready.')
  }

  const filteredCloudAssets = cloudAssets.filter(a => (libraryFilter === 'all' || a.type === libraryFilter) && (!librarySearch.trim() || `${a.name || ''} ${a.type}`.toLowerCase().includes(librarySearch.toLowerCase())))
  const filteredLocalRefs = localRefs.filter(a => {
    const type = a.kind === 'text' ? 'text' : a.type
    return (libraryFilter === 'all' || type === libraryFilter) && (!librarySearch.trim() || `${a.name} ${a.text || ''} ${a.url || ''}`.toLowerCase().includes(librarySearch.toLowerCase()))
  })
  const navItems:Array<[Workspace,string,string,string]> = [
    ['project','01','PROJECT','Brief & bible'],['cast','02','CAST','Identity lock'],['world','03','WORLD','Environment'],['shots','04','SHOTS','Storyboard + takes'],['output','05','OUTPUT','Hero selects']
  ]
  const scopeLabel = referenceScope === 'project' ? 'PROJECT' : `SHOT ${String(activeShot+1).padStart(2,'0')}`
  const completedTakes = Object.values(takesByShot).flat().filter(t=>t.status==='completed')
  const totalCharged = Object.values(takesByShot).flat().reduce((sum,t)=>sum+Number(t.price_charged||0),0)

  return <main className="studioShell">
    <aside className="leftSidebar">
      <div className="brandBlock"><div className="brand"><span className="brandDot"/>AI FILM STUDIO</div><div className="version">V0.5 · SHOT WORKSPACE</div></div>
      <nav className="stageNav">{navItems.map(([id,no,label,sub])=><button key={id} className={`nav ${workspace===id?'active':''}`} onClick={()=>setWorkspace(id)}><b>{no}</b><span><strong>{label}</strong><small>{sub}</small></span></button>)}</nav>
      <div className="projectMini"><small>PROJECT STATUS</small><strong>{bible?.project.title || 'Untitled'}</strong><span>{masterCharacter?'CAST ✓':'CAST —'} · {conceptAssets[0]?'WORLD ✓':'WORLD —'}</span><span>{keyframeCount}/{bible?.shots.length||6} KEYFRAMES · {heroCount}/{bible?.shots.length||6} HERO</span><button onClick={resetProject}>＋ NEW PROJECT</button></div>
    </aside>

    <section className="workspace">
      <header className="topbar">
        <div><div className="eyebrow">AI PRE-PRODUCTION / SHOT-CENTRIC FILMMAKING</div><h1>{bible?.project.title || 'Bring your story to life'}</h1></div>
        <div className="topMeta"><span className="modelCount"><i/>{models.length ? `${models.length} MODELS` : 'CATALOG'}</span></div>
      </header>
      <div className="connectionBar"><span className={health?.groq?.ok?'conn ok':'conn bad'}>GROQ {health?.groq?.ok?'READY':health?.groq?.configured?'CHECK':'KEY MISSING'}</span><span className={health?.appletoken?.ok?'conn ok':'conn bad'}>APPLETOKEN {health?.appletoken?.ok?'READY':health?.appletoken?.configured?'CHECK':'KEY MISSING'}</span>{health?.groq?.configuredModel&&<span className="conn">DIRECTOR {health.groq.configuredModel}</span>}<span className="conn">REFS {totalReferenceCount}{maxReferences?` / ${maxReferences}`:''}</span></div>
      {modelsError&&<div className="warning">AppleToken catalog unavailable: {modelsError}</div>}{error&&<div className="error">{error}</div>}{notice&&<div className="notice">{notice}</div>}

      {workspace==='project' && <ProjectWorkspace bible={bible} idea={idea} setIdea={setIdea} loading={loading} develop={develop} selectedCloud={selectedCloudAssets} selectedLocal={selectedLocalRefs} toggleReference={toggleReference} openUpload={()=>fileInput.current?.click()} masterReady={Boolean(masterCharacter)} worldReady={Boolean(conceptAssets[0])} keyframes={keyframeCount} heroes={heroCount}/>} 

      {workspace==='cast' && <Stage title="Cast / Identity Lock" kicker="02 / CHARACTER SYSTEM" disabled={!bible} description="先決定角色，再鎖住真正需要一致的特徵。Master Character 會自動加入每個 Shot；鎖定規則會寫進影片 prompt。">
        <div className="castLayout">
          <section className="identityPanel"><small>IDENTITY LOCK</small><h3>{bible?.character.name}</h3><p>{bible?.character.appearance}</p><div className="lockGrid">{(Object.keys(identityLocks) as Array<keyof IdentityLocks>).map(k=><label key={k} className={identityLocks[k]?'lockChip active':'lockChip'}><input type="checkbox" checked={identityLocks[k]} onChange={e=>setIdentityLocks(prev=>({...prev,[k]:e.target.checked}))}/><span>🔒 {k.toUpperCase()}</span></label>)}</div><div className="promptBox"><small>CHARACTER DNA</small><p>{bible?.character.characterPrompt}</p></div></section>
          <section><div className="toolDock"><select value={imageModel} onChange={e=>setImageModel(e.target.value)}>{imageModels.map(m=><option key={m.id} value={m.id}>{modelLabel(m)}</option>)}</select><select value={imageSize} onChange={e=>setImageSize(e.target.value)}>{(activeImageModel?.constraints?.sizes?.length?activeImageModel.constraints.sizes:['1024x1024']).map(s=><option key={s}>{s}</option>)}</select><button className="primary" onClick={generateCharacterSet} disabled={generatingCharacter||!imageModel}>{generatingCharacter?'GENERATING…':'GENERATE ×4'}</button></div><div className="imageGrid">{characterAssets.map(a=><article className={`assetCard ${a.master?'master':''}`} key={a.id}><div className="imageFrame"><img src={a.url} alt="character concept"/></div><div className="assetFoot"><span>{a.master?'IDENTITY LOCKED':'CHARACTER CONCEPT'}</span><button onClick={()=>setMaster(a.id)}>{a.master?'LOCKED ✓':'LOCK IDENTITY'}</button></div></article>)}</div>{!characterAssets.length&&<div className="emptyState compact"><h3>No character explorations yet.</h3><p>Generate four directions, then lock the strongest identity.</p></div>}</section>
        </div>
      </Stage>}

      {workspace==='world' && <Stage title="World / Environment Master" kicker="03 / WORLD SYSTEM" disabled={!bible} description="建立一張世界觀錨點，再用右側 Reference Library 補建築、材質、道具、品牌、光線與聲音。">
        <div className="toolDock"><select value={imageModel} onChange={e=>setImageModel(e.target.value)}>{imageModels.map(m=><option key={m.id} value={m.id}>{modelLabel(m)}</option>)}</select><select value={imageSize} onChange={e=>setImageSize(e.target.value)}>{(activeImageModel?.constraints?.sizes?.length?activeImageModel.constraints.sizes:['1024x1024']).map(s=><option key={s}>{s}</option>)}</select><button className="primary" onClick={generateConcept} disabled={generatingConcept||!imageModel}>{generatingConcept?'GENERATING…':'GENERATE ENVIRONMENT'}</button></div>
        {bible&&<div className="worldBrief"><article><small>LOCATION</small><h3>{bible.environment.location}</h3><p>{bible.environment.architecture}</p></article><article><small>LIGHTING</small><h3>{bible.environment.weather}</h3><p>{bible.environment.lighting}</p></article></div>}
        <div className="imageGrid conceptGrid">{conceptAssets.map((a,i)=><article className={`assetCard ${i===0?'master':''}`} key={a.id}><div className="imageFrame wideImage"><img src={a.url} alt="environment concept"/></div><div className="assetFoot"><span>{i===0?'ENVIRONMENT MASTER':'WORLD VARIATION'}</span></div></article>)}</div>
      </Stage>}

      {workspace==='shots' && <Stage title="Shot Workspace" kicker="04 / STORYBOARD → TAKE" disabled={!bible} description="選 Shot、整理 references、生成 keyframe、直接做影片 variants。每個 Shot 有自己的 Reference Set 與 Prompt override，不再另外跳到 Video 頁。">
        {bible&&<>
          <div className="shotBoard">{bible.shots.map((s,i)=>{const kf=shotKeyframes[s.id], hero=heroTakeByShot[s.id], count=(takesByShot[s.id]||[]).length; return <button key={s.id} onClick={()=>setActiveShot(i)} className={`shotCard ${i===activeShot?'active':''}`}><div className="shotThumb">{kf?<img src={kf} alt="shot keyframe"/>:<span>{String(i+1).padStart(2,'0')}</span>}{hero&&<b className="heroBadge">HERO</b>}</div><div><strong>{s.title}</strong><span>{s.lens} · {s.duration}s · {count} takes</span></div></button>})}</div>
          {shot&&<div className="shotWorkbench">
            <section className="shotMain"><div className="shotTitleRow"><div><small>SHOT {String(activeShot+1).padStart(2,'0')}</small><h2>{shot.title}</h2></div><div className="shotMetaPills"><span>{shot.framing}</span><span>{shot.lens}</span><span>{shot.duration}s</span></div></div><p className="actionLine">{shot.action}</p>
              <div className="keyframeStage">{shotKeyframes[shot.id]?<img src={shotKeyframes[shot.id]} alt="storyboard keyframe"/>:<div><b>NO KEYFRAME</b><span>先產一張視覺分鏡，再做 motion variants。</span></div>}<button onClick={generateKeyframe} disabled={generatingKeyframe||!imageModel}>{generatingKeyframe?'GENERATING…':'GENERATE KEYFRAME'}</button></div>
              <div className="shotContinuity"><span><b>CAMERA</b>{shot.cameraMotion}</span><span><b>AUTO REFERENCES</b>{masterCharacter?'Master Character':'No Master'} · {conceptAssets[0]?'Environment':'No Environment'}</span><span><b>SHOT REFERENCES</b>{currentRefIds.length}</span></div>
            </section>
            <aside className="takePanel"><div className="takeHeader"><small>VARIANTS / TAKES</small><span>{currentTakes.length}</span></div>{currentTakes.length?currentTakes.map((t,i)=><button key={t.takeId} className={`takeCard ${activeTake?.takeId===t.takeId?'active':''} ${heroTakeByShot[shot.id]===t.takeId?'hero':''}`} onClick={()=>setSelectedTakeId(t.takeId)}><b>TAKE {String(currentTakes.length-i).padStart(2,'0')}</b><span className={`jobStatus ${t.status}`}>{t.status}</span>{t.price_charged!=null&&<small>${Number(t.price_charged).toFixed(3)}</small>}{heroTakeByShot[shot.id]===t.takeId&&<em>★ HERO</em>}</button>):<div className="takeEmpty">No variants yet.<br/>Use the composer below.</div>}
              {activeTake&&<div className="takeControls">{activeTake.status==='needs_confirmation'?<button onClick={confirmActiveTake} disabled={videoBusy}>CONFIRM & SUBMIT</button>:<button onClick={pollActiveTake} disabled={videoBusy||!activeTake.id}>REFRESH STATUS</button>}{activeTake.status==='completed'&&<button className="heroSelect" onClick={()=>markHero(activeTake.takeId)}>★ SELECT HERO</button>}</div>}
              {activeTake?.status==='completed'&&activeTake.id&&<video className="takePreview" controls src={`/api/appletoken/video-content?id=${encodeURIComponent(activeTake.id)}`}/>}</aside>
          </div>}
          {shot&&<div className="bottomComposer">
            <div className="composerScope"><span>SHOT {String(activeShot+1).padStart(2,'0')}</span><button onClick={copyProjectRefsToCurrentShot}>＋ PROJECT REFS</button><button onClick={applyProjectRefsToAllShots}>APPLY PROJECT REFS → ALL SHOTS</button></div>
            <SelectedReferenceRow cloud={selectedCloudAssets} local={selectedLocalRefs} onRemove={id=>toggleReference(id)} master={masterCharacter?.url} environment={conceptAssets[0]?.url} onMention={insertMention}/>
            <textarea value={baseShotPrompt()} onChange={e=>updateCurrentPrompt(e.target.value)} placeholder="Describe this shot. Use @references as readable cues; selected media on the right are sent as actual input_references."/>
            <div className="composerBar"><div className="composerControls"><button onClick={()=>fileInput.current?.click()}>＋</button><button onClick={()=>setAddMode('text')}>@ NOTE</button><select value={videoModel} onChange={e=>setVideoModel(e.target.value)}>{videoModels.map(m=><option key={m.id} value={m.id}>{m.label||m.id}</option>)}</select><select value={aspectRatio} onChange={e=>setAspectRatio(e.target.value)}>{(activeVideoModel?.constraints?.aspectRatios||['16:9','9:16','1:1','4:3','3:4','21:9']).map(v=><option key={v}>{v}</option>)}</select><select value={resolution} onChange={e=>setResolution(e.target.value)}>{(activeVideoModel?.constraints?.resolutions||['720p']).map(v=><option key={v}>{v}</option>)}</select><select value={seconds} onChange={e=>setSeconds(Number(e.target.value))}>{(activeVideoModel?.constraints?.allowedSeconds||makeSeconds(activeVideoModel)).map(v=><option key={v} value={v}>{v}s</option>)}</select><label><input type="checkbox" checked={audio} disabled={activeVideoModel?.constraints?.audio===false} onChange={e=>setAudio(e.target.checked)}/> AUDIO</label></div><div className="composerActions"><button className="quoteButton" onClick={getQuote} disabled={videoBusy||!videoModel}>QUOTE {quote?.price!=null?`$${Number(quote.price).toFixed(3)}`:''}</button><button className="generateButton" onClick={generateVideo} disabled={videoBusy||!videoModel}>{videoBusy?'WORKING…':'GENERATE'}</button></div></div>
          </div>}
        </>}
      </Stage>}

      {workspace==='output' && <Stage title="Output / Hero Selects" kicker="05 / REVIEW" disabled={!bible} description="只看選中的 Hero Take，檢查整支片是否有 continuity 缺口。沒有 Hero 的 Shot 會直接標示出來。">
        {bible&&<><div className="outputStats"><article><small>SHOTS</small><b>{bible.shots.length}</b></article><article><small>KEYFRAMES</small><b>{keyframeCount}</b></article><article><small>COMPLETED TAKES</small><b>{completedTakes.length}</b></article><article><small>HERO SELECTS</small><b>{heroCount}</b></article><article><small>CHARGED</small><b>${totalCharged.toFixed(2)}</b></article></div><div className="heroGrid">{bible.shots.map((s,i)=>{const hero=(takesByShot[s.id]||[]).find(t=>t.takeId===heroTakeByShot[s.id]);return <article className={`heroOutput ${hero?'ready':''}`} key={s.id}><div className="heroOutputHead"><span>SHOT {String(i+1).padStart(2,'0')}</span><b>{s.title}</b></div>{hero?.id?<video controls src={`/api/appletoken/video-content?id=${encodeURIComponent(hero.id)}`}/>:<div className="missingHero">NO HERO TAKE</div>}<button onClick={()=>{setActiveShot(i);setWorkspace('shots')}}>{hero?'OPEN SHOT':'FINISH SHOT →'}</button></article>})}</div></>}
      </Stage>}
    </section>

    <aside className="libraryPanel" onDragOver={e=>e.preventDefault()} onDrop={dropFiles}>
      <div className="libraryHeader"><div><small>PROJECT REFERENCES</small><h2>Reference Library</h2></div><button className="iconButton" onClick={refreshLibrary} title="Refresh library">↻</button></div>
      <div className="scopeBadge"><span>CURRENT CONTEXT</span><b>{scopeLabel}</b></div>
      <p className="libraryIntro">拖入多張圖片、影片或音訊；按 <b>USE</b> 只加入目前 Project / Shot，按 <b>@</b> 把可讀名稱插入 Shot prompt。</p>
      <div className="libraryActions"><button onClick={()=>fileInput.current?.click()} disabled={libraryBusy}>＋ UPLOAD</button><button onClick={()=>setAddMode(addMode==='text'?'none':'text')}>＋ TEXT</button><button onClick={()=>setAddMode(addMode==='url'?'none':'url')}>＋ URL</button></div>
      <input ref={fileInput} className="hiddenInput" type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/mp4" onChange={uploadFiles}/>
      <div className="uploadHint">DROP FILES HERE · 多選上傳 · proxy-safe 建議 ≤ 3 MB/檔；大型媒體用 URL。</div>
      {addMode!=='none'&&<div className="addReferenceBox"><input value={draftRefName} onChange={e=>setDraftRefName(e.target.value)} placeholder={addMode==='text'?'筆記名稱，例如：角色禁忌':'Reference 名稱'}/>{addMode==='url'&&<select value={draftRefType} onChange={e=>setDraftRefType(e.target.value as AssetType)}><option value="image">Image URL</option><option value="video">Video URL</option><option value="audio">Audio URL</option></select>}<textarea value={draftRefValue} onChange={e=>setDraftRefValue(e.target.value)} placeholder={addMode==='text'?'角色設定、品牌規範、台詞、鏡頭限制、continuity notes…':'https://… public media URL'}/><div><button onClick={()=>setAddMode('none')}>CANCEL</button><button className="primary" onClick={saveLocalReference}>ADD</button></div></div>}
      <div className="librarySearch"><input value={librarySearch} onChange={e=>setLibrarySearch(e.target.value)} placeholder="Search references…"/></div>
      <div className="libraryTabs">{(['all','image','video','audio','text'] as LibraryFilter[]).map(t=><button key={t} className={libraryFilter===t?'active':''} onClick={()=>setLibraryFilter(t)}>{t==='text'?'NOTES':t.toUpperCase()}</button>)}</div>
      {libraryBusy&&<div className="libraryMessage">Uploading / activating assets…</div>}{libraryError&&<div className="libraryError">{libraryError}</div>}
      {(masterCharacter||conceptAssets[0])&&<div className="sessionAssets"><small>AUTO REFERENCES</small>{masterCharacter&&<SessionOutputCard label={`@${bible?.character.name||'MasterCharacter'}`} image={masterCharacter.url}/>} {conceptAssets[0]&&<SessionOutputCard label="@Environment" image={conceptAssets[0].url}/>}</div>}
      <div className="assetList">{filteredCloudAssets.map(asset=><LibraryAssetCard key={asset.id} asset={asset} preview={assetPreviews[asset.id]} selected={currentRefIds.includes(asset.id)} onToggle={()=>toggleReference(asset.id)} onMention={()=>insertMention(makeMention(asset.name||asset.id))}/>) }{filteredLocalRefs.map(asset=><LocalRefCard key={asset.id} asset={asset} selected={currentRefIds.includes(asset.id)} onToggle={()=>toggleReference(asset.id)} onMention={()=>insertMention(makeMention(asset.name))} onDelete={()=>removeLocalRef(asset.id)}/>) }{!filteredCloudAssets.length&&!filteredLocalRefs.length&&<div className="emptyLibrary"><b>No references yet</b><span>Drop media here, paste a URL, or add a production note.</span></div>}</div>
      <div className="libraryFooter"><span>{currentRefIds.length} in {scopeLabel}</span><span>{cloudAssets.length} cloud assets</span></div>
    </aside>
  </main>
}

function ProjectWorkspace({bible,idea,setIdea,loading,develop,selectedCloud,selectedLocal,toggleReference,openUpload,masterReady,worldReady,keyframes,heroes}:{bible:ProjectBible|null;idea:string;setIdea:(v:string)=>void;loading:boolean;develop:()=>void;selectedCloud:CloudAsset[];selectedLocal:LocalRef[];toggleReference:(id:string)=>void;openUpload:()=>void;masterReady:boolean;worldReady:boolean;keyframes:number;heroes:number}) {
  return <>{!bible?<><section className="welcomeBlock"><div className="welcomeCopy"><span>01 / NEW PROJECT</span><h2>從一句話建立整個製片專案</h2><p>把 Brief、Reference 與文字規範先集中在 Project Context；Groq 只負責拆成可執行的 Character / World / Shot Bible。</p></div><div className="skillPills"><button onClick={()=>setIdea('電影級長鏡頭：'+idea)}>電影級長鏡頭</button><button onClick={()=>setIdea('角色一致性優先：'+idea)}>角色一致性</button><button onClick={()=>setIdea('建築視覺化電影預視：'+idea)}>建築預視</button><button onClick={()=>setIdea('30秒商業廣告：'+idea)}>商業廣告</button></div></section><section className="composerPanel"><SelectedReferenceRow cloud={selectedCloud} local={selectedLocal} onRemove={toggleReference}/><textarea className="heroPrompt" value={idea} onChange={e=>setIdea(e.target.value)} placeholder="描述故事、角色、場景、鏡頭或貼上劇本…"/><div className="composerFooter"><div className="composerTools"><button onClick={openUpload}>＋ Reference</button><span>Project Bible</span><span>Character DNA</span><span>6 Shots</span></div><button className="generateButton" onClick={develop} disabled={loading||!idea.trim()}>{loading?'DIRECTING…':'CREATE PROJECT →'}</button></div></section></>:<><div className="projectHero"><div><span>PROJECT BIBLE</span><h2>{bible.project.title}</h2><p>{bible.project.logline}</p><div className="meta"><span>{bible.project.genre}</span><span>{bible.project.visualStyle}</span><span>{bible.project.aspectRatio}</span></div></div><div className="projectProgress"><Progress label="CAST" done={masterReady}/><Progress label="WORLD" done={worldReady}/><Progress label="KEYFRAMES" value={`${keyframes}/${bible.shots.length}`} done={keyframes===bible.shots.length}/><Progress label="HERO TAKES" value={`${heroes}/${bible.shots.length}`} done={heroes===bible.shots.length}/></div></div><div className="projectCards"><article><small>CHARACTER</small><h3>{bible.character.name}</h3><p>{bible.character.appearance}</p><p>{bible.character.costume}</p></article><article><small>WORLD</small><h3>{bible.environment.location}</h3><p>{bible.environment.architecture}</p><p>{bible.environment.lighting}</p></article><article><small>CAMERA LANGUAGE</small><h3>{bible.cinematography.lenses.join(' · ')}</h3><p>{bible.cinematography.cameraLanguage}</p><p>{bible.cinematography.lightingLanguage}</p></article></div></>}</>
}
function Progress({label,done,value}:{label:string;done:boolean;value?:string}) { return <div className={done?'progressItem done':'progressItem'}><i/ ><span>{label}</span><b>{value|| (done?'READY':'PENDING')}</b></div> }
function Stage({title,kicker,disabled,description,children}:{title:string;kicker:string;disabled:boolean;description:string;children:React.ReactNode}) { return <section><div className="sectionHead"><div><span>{kicker}</span><h2>{title}</h2><p>{description}</p></div>{disabled&&<div className="tag">CREATE PROJECT FIRST</div>}</div>{disabled?<section className="emptyState"><h2>Project Bible required.</h2><p>回到 PROJECT，先建立 production bible。</p></section>:children}</section> }
function SelectedReferenceRow({cloud,local,onRemove,master,environment,onMention}:{cloud:CloudAsset[];local:LocalRef[];onRemove:(id:string)=>void;master?:string;environment?:string;onMention?:(value:string)=>void}) {
  const any=cloud.length||local.length||master||environment; if(!any)return <div className="selectedRefs empty">＋ 從右側 Reference Library 選取素材</div>
  return <div className="selectedRefs">{master&&<button type="button" className="referenceToken auto" onClick={()=>onMention?.('@MasterCharacter')}>@MasterCharacter</button>}{environment&&<button type="button" className="referenceToken auto" onClick={()=>onMention?.('@Environment')}>@Environment</button>}{cloud.map(a=><button key={a.id} onClick={()=>onRemove(a.id)} className="referenceToken">{makeMention(a.name||a.id)} ×</button>)}{local.map(a=><button key={a.id} onClick={()=>onRemove(a.id)} className="referenceToken">{makeMention(a.name)} ×</button>)}</div>
}
function LibraryAssetCard({asset,preview,selected,onToggle,onMention}:{asset:CloudAsset;preview?:string;selected:boolean;onToggle:()=>void;onMention:()=>void}) { return <article className={`libraryAsset ${selected?'selected':''}`}><div className={`assetThumb ${asset.type}`}>{preview&&asset.type==='image'?<img src={preview} alt="asset preview"/>:preview&&asset.type==='video'?<video src={preview} muted/>:<span>{asset.type==='image'?'IMG':asset.type==='video'?'VID':'AUD'}</span>}</div><div className="assetInfo"><strong>{asset.name||asset.id}</strong><span>{asset.type.toUpperCase()} · {bytesLabel(asset.bytes)}</span><small className={`assetStatus ${asset.status}`}>{asset.status}</small></div><div className="assetButtons"><button className="mentionButton" disabled={!selected} onClick={onMention}>@</button><button className="useButton" disabled={asset.status!=='active'} onClick={onToggle}>{selected?'USED ✓':'USE'}</button></div></article> }
function SessionOutputCard({label,image}:{label:string;image:string}) { return <article className="libraryAsset session"><div className="assetThumb image"><img src={image} alt={label}/></div><div className="assetInfo"><strong>{label}</strong><span>AUTO · ALL SHOTS</span><small className="assetStatus active">IDENTITY / WORLD</small></div><span className="autoBadge">AUTO</span></article> }
function LocalRefCard({asset,selected,onToggle,onMention,onDelete}:{asset:LocalRef;selected:boolean;onToggle:()=>void;onMention:()=>void;onDelete:()=>void}) { return <article className={`libraryAsset ${selected?'selected':''}`}><div className={`assetThumb ${asset.kind==='text'?'text':asset.type}`}>{asset.kind==='url'&&asset.type==='image'&&asset.url?<img src={asset.url} alt="url reference"/>:<span>{asset.kind==='text'?'TXT':asset.type?.slice(0,3).toUpperCase()}</span>}</div><div className="assetInfo"><strong>{asset.name}</strong><span>{asset.kind==='text'?'PRODUCTION NOTE':`${asset.type?.toUpperCase()} URL`}</span><small>{asset.kind==='text'?(asset.text||'').slice(0,48):(asset.url||'').slice(0,48)}</small></div><div className="assetButtons"><button className="mentionButton" disabled={!selected} onClick={onMention}>@</button><button className="useButton" onClick={onToggle}>{selected?'USED ✓':'USE'}</button><button className="deleteButton" onClick={onDelete}>×</button></div></article> }
