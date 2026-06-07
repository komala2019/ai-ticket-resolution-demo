# AI Ticket Auto-Resolution — Demo

An interactive, self-contained demo of the AI Ticket Auto-Resolution concept:
an AI support layer that classifies incoming issues by confidence and either
resolves them, drafts a response for a CS rep, or escalates to engineering —
all with a human-in-the-loop control model.

> **No backend required.** This demo runs entirely on bundled sample data, so
> it can be hosted as a static site and shared with anyone. (If you point it at
> a live `/api/ticket-resolution/` backend, it will use real data automatically.)

## What's inside

- **Customer view** — a conversational assistant that diagnoses and resolves issues.
- **CS console** — approval queue, ticket detail, knowledge base manager, analytics.
- **README & Architecture** — in-app documentation pages.
- Dark-mode aware; works on desktop and mobile widths.

## Run locally

```bash
npm install
npm start
# open http://localhost:4200
```

## Build a static bundle

```bash
npm install
npm run build
# output lands in ./dist
```

## Share it (pick one)

### Option A — Netlify Drop (fastest, no account, no git)
1. Run `npm run build` to produce `./dist`.
2. Go to https://app.netlify.com/drop
3. Drag the **`dist`** folder onto the page.
4. You get an instant public URL to share. Done.

### Option B — GitHub + Netlify (continuous, a stable link)
1. Push this folder to a new GitHub repo (see below).
2. In Netlify: **Add new site → Import from Git → pick the repo.**
3. Netlify reads `netlify.toml` (build command, publish dir, Node 18) and deploys.
4. Every push redeploys automatically.

```bash
git init
git add .
git commit -m "AI Ticket Auto-Resolution demo"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

### Option C — any static host
The `dist` folder is plain static files. Host it on Vercel, GitHub Pages,
Azure Static Web Apps, S3, etc. Ensure unknown routes fall back to
`index.html` (the included `_redirects` / `netlify.toml` handle this on Netlify).

## Notes

- Built with Angular 15. Node 18 is recommended for building.
- This is a standalone copy — it has **no dependency** on any Milestone
  internal package or private registry.
