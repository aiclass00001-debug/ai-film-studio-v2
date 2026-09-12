# AI Film Studio V0.5 — Shot Workspace

V0.5 changes the product from a linear wizard into a **project-first / reference-first / shot-centric** AI filmmaking workspace.

## Core workflow

```text
PROJECT BRIEF
  ↓ Groq Director
PROJECT BIBLE
  ↓
CAST / IDENTITY LOCK
  ↓
WORLD / ENVIRONMENT MASTER
  ↓
SHOT WORKSPACE
  ├─ shot-specific references
  ├─ @Reference readability cues
  ├─ storyboard keyframe
  ├─ quote
  ├─ video variants / takes
  └─ hero take select
  ↓
OUTPUT / HERO REVIEW
```

## V0.5 UX changes

- New navigation: **PROJECT / CAST / WORLD / SHOTS / OUTPUT**
- Persistent right-side **Project References** library
- Reference context switches between **PROJECT** and the active **SHOT**
- Project references are copied to all shots when a Project Bible is created
- Per-shot Reference Set
- Drag-and-drop multi-file reference upload
- Image / video / audio / text note / public URL references
- `@Reference` readability cues in shot prompts
- Character **Identity Lock** toggles: face / hair / age / costume / body
- Visual six-shot board with generated storyboard keyframes
- Shot page contains video generation directly; there is no separate Video step
- Sticky Higgsfield-style bottom composer
- Quote → Generate → Take variants → **Select Hero**
- Output page shows missing Hero Takes and total charged amount reported by jobs
- Browser autosave for Project Bible, references, identity settings, generated concept URLs, shot prompt overrides, takes and hero selections

## Server providers

### Groq
Used only as the Prompt Director.

Environment variables:

```env
GROQ_API_KEY=...
GROQ_MODEL=llama-3.3-70b-versatile
```

`GROQ_MODEL` is optional. The server checks the live Groq model catalog and falls back to an available preferred model.

### AppleToken
Used for model catalog, images, Assets, quotes and video jobs.

```env
APPLETOKEN_API_KEY=...
```

Keys must be configured in **Vercel → Project → Settings → Environment Variables**. Do not put keys in GitHub.

## Recommended Vercel deployment

Keep the existing Vercel project so the existing keys remain available.

1. Create a GitHub branch such as `v05-shot-workspace`.
2. Upload the contents of this folder to that branch.
3. Open a Pull Request.
4. Let Vercel build a Preview Deployment.
5. Test Groq, model catalog, Reference Library, keyframe generation, Quote and video submission.
6. Merge into `main` only after the Preview passes.

## Reference Library behavior

- **PROJECT context** is used in Project / Cast / World / Output workspaces.
- **SHOT context** is used in Shot Workspace and is unique per shot.
- Master Character and Environment Master are auto references for every shot.
- The `@` button adds a human-readable reference name to the prompt; actual media is still sent through `input_references`.
- AppleToken cloud Assets are queried through the server proxy.
- Local text notes and external URLs are stored in browser localStorage.
- Uploaded preview thumbnails are cached in IndexedDB.

## Upload note

AppleToken may support larger Assets, but this app currently proxies uploads through a Vercel route. For reliability the UI limits the direct-upload workflow to about **3 MB per file**. Use a public media URL for larger reference video/audio until a direct object-storage upload path is added.

## Commands

```bash
npm install
npm run check
npm run typecheck
npm run build
npm run dev
```

## Current deliberate limitations

- No Supabase / R2 yet; Project state is browser-local.
- No collaborative accounts.
- No NLE timeline; the product is deliberately shot-centric instead of recreating Premiere.
- Storyboard keyframes use production prompts and continuity text. Reference-guided image generation depends on the selected image model/API capabilities.
- No automatic final-frame extraction from a completed video yet. Hero Take is implemented; final-frame-to-next-shot is reserved for the next continuity pass.
- AppleToken generation requires the AppleToken account to have API submission permission enabled.

See `VERIFICATION.md` for the pre-delivery checks performed on this package.
