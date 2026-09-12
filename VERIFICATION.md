# AI Film Studio V0.4 — Verification

Checked before packaging:

- `node scripts/check.mjs` — PASS
- TypeScript/TSX syntax transpile — PASS (13 source files)
- TypeScript semantic check with temporary external-module stubs — PASS
- Client secret scan — PASS (no Groq / AppleToken server keys referenced from `app/page.tsx`)
- AppleToken Assets proxy route present — PASS
- Reference-guided video (`input_references`) present — PASS
- Multi-media Reference Library + selected reference flow present — PASS
- Browser local reference persistence (text/URL) present — PASS
- IndexedDB media-preview cache present — PASS

## Full Next.js production build

A full `npm install && npm run build` could not be completed in this execution environment because the npm registry request timed out. The source was instead parser-checked and semantic-type-checked locally. After uploading to GitHub/Vercel, Vercel should run the authoritative production build with real Next/React packages.

## Upload limit note

AppleToken Assets accepts supported files up to 20 MB, but Vercel serverless request-body limits can be lower. V0.4 conservatively limits direct uploads through this proxy to 3 MB per file. Use `+ URL` for larger audio/video references until direct storage upload is added.
