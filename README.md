# AI Film Studio V0.3

Production-oriented AI pre-production web app:

**Idea → Groq Prompt Director → Character DNA → Concept Art → Storyboard → AppleToken Video**

## Why V0.3

This build removes the unused OpenAI SDK and Supabase SDK completely. Groq and AppleToken are called through server-side `fetch`, so there is no Zod/OpenAI peer dependency conflict and no API secret is sent to the browser.

V0.3 also adds a `/api/health` diagnostic and Groq live-model discovery. If `GROQ_MODEL` is missing or no longer available, the Prompt Director checks the current Groq `/models` list and chooses a live production model automatically.

## Vercel environment variables

Add these in **Vercel → Project → Settings → Environment Variables**:

```env
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.3-70b-versatile
APPLETOKEN_API_KEY=at_live_...
```

`GROQ_MODEL` is optional. The app can auto-select from Groq's current live model catalog.

Enable the variables for **Production + Preview**.

## Deploy

1. Upload this folder to a new GitHub repository, or replace the contents of the old repo.
2. Import the repository in Vercel.
3. Application Preset: **Next.js**.
4. Root Directory: `./`.
5. Add environment variables above.
6. Deploy.

No Supabase variables are required in V0.3.

## Built-in diagnostics

After deployment the UI shows:

- `GROQ READY` when the key can read Groq's model catalog.
- `APPLETOKEN READY` when the key can read AppleToken's model catalog.
- `KEY MISSING` when an environment variable was not configured.
- `CHECK` when a key exists but the upstream API rejected it or could not be reached.

You can also open `/api/health` to see non-secret diagnostic status.

## Local development

```bash
npm install
cp .env.example .env.local
npm run typecheck
npm run check
npm run build
npm run dev
```

## Security

- `GROQ_API_KEY` is used only in server API routes.
- `APPLETOKEN_API_KEY` is used only in server API routes.
- Never prefix these keys with `NEXT_PUBLIC_`.
- Never commit `.env.local`.
