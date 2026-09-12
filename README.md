# AI Film Studio V0.4 — Reference Workspace

V0.4 redesigns the studio around a Higgsfield / Jimeng-inspired production workspace while keeping the original pipeline:

`Idea → Groq Project Bible → Character → Concept → Storyboard → AppleToken Video`

## New in V0.4

- Persistent **right-side Reference Library** backed by AppleToken Assets for image/video/audio.
- Multi-file upload with asset activation polling.
- Local **Text Notes** and direct **Media URL** references, persisted in browser localStorage.
- Reference selection chips that flow into the current video shot.
- Text notes are injected into the Groq brief and video continuity prompt.
- Video composer reorganized into prompt + model / aspect / resolution / duration controls.
- Stage explanations and workflow guidance.
- AppleToken reference roles: `reference_image`, `reference_video`, `reference_audio`.
- Model `maxReferences` guard when the catalog provides it.

## Vercel environment variables

```env
GROQ_API_KEY=...
GROQ_MODEL=llama-3.3-70b-versatile
APPLETOKEN_API_KEY=...
```

Apply them to both **Production** and **Preview**, then redeploy.

## Reference upload note

AppleToken Assets accepts media up to 20 MB, but the Vercel serverless proxy can impose a smaller request-body limit. V0.4 therefore uses a conservative 3 MB direct-upload guard. For larger audio/video references, use **+ URL** with an anonymously accessible direct media URL. A future V0.5 can add Supabase Storage / direct-upload infrastructure for large files.

## Commands

```bash
npm install
npm run typecheck
npm run check
npm run build
npm run dev
```
