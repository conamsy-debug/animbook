# Railway deployment — AnimBook

Step-by-step to push AnimBook from `https://github.com/Echad-Group/animbook` to Railway. Two services (API + Web), one Postgres (Neon — already provisioned), one Redis (Upstash — already provisioned). Mobile + TV shells are served from the same Web origin at `/mobile` and `/tv`.

**Why Railway over Render?** Railway works in regions where Render is blocked, has a simpler one-platform model (one account, many services), auto-detects Node via Nixpacks, and gives you $5 of credits on the Hobby plan to run the whole stack.

---

## Prerequisites

- GitHub repo `Echad-Group/animbook` with code pushed to `main` ✅ (done above)
- Domain `animbook.com` registered and managed in Cloudflare ✅
- Railway account — Hobby plan ($5/month, includes $5 of credits)
- Stripe live keys optional (Phase 15). Sentry DSN optional.

---

## 1. Create the Railway account

1. Open **https://railway.app**.
2. Click **Login** → **Login with GitHub** — Railway will request access to your repos. Grant access to **Echad-Group** org and the **animbook** repo specifically.
3. Railway auto-creates a personal workspace. Click the workspace dropdown (top-left) → **Create New** → **Team** → name it `Echad-Group` → invite yourself.
4. Add a payment method (Settings → Billing → Add Card). Hobby plan = $5/month with $5 of usage credits. Free trial sometimes available for new accounts.

**Pricing reality check:** A simple Express API + Next.js Web service on Railway's Hobby plan runs about $3–5/month combined. With $5 of credits, the first month is effectively free.

---

## 2. Create the project

1. Dashboard → **New Project** → **Empty Project** → name it `animbook` (or `animbook-prod`).
2. The project opens with an empty canvas. Click **+ New** → **GitHub Repo** → pick `Echad-Group/animbook`.
3. Railway auto-detects Node and starts building the repo (will fail because there's no service yet). **Stop the deployment** (right-click the service → Cancel) — we'll configure two distinct services.

---

## 3. Add the `animbook-api` service

1. Project canvas → **+ New** → **GitHub Repo** → `Echad-Group/animbook` again.
2. Railway creates a second service. Click on it to open the panel.
3. **Settings** tab:
   - **Service Name:** `animbook-api`
   - **Build command:** leave blank (Nixpacks auto-detects, but we'll override below)
   - **Start command:** `npm run start:api`
   - **Watch Paths:** `apps/api/**` *(optional — speeds up rebuilds by ignoring mobile/tv/web changes)*
4. **Variables** tab → **+ New Variable** → **Raw Editor** → paste the entire `apps/api/.env.production` file (or upload via the JSON editor).
5. **Networking** tab → click **Generate Domain** to get a free `*.up.railway.app` URL for now (we'll wire the real domain in step 6).
6. **Settings → Deploy** → set the build command:
   - Go back to **Settings** tab → scroll to **Build** section → **Custom Build Command:** `npm install --legacy-peer-deps && npm run build:api`
   - **Custom Start Command:** `npm run start:api` (replaces the earlier field — Railway uses the latest one you set)
7. The first deploy takes ~3–5 min (npm install + `prisma generate` + `tsc`). Watch the logs.
8. Once deployed, click the **Variables** tab → verify `PORT=4000` is set (Railway injects a `PORT` env var automatically — we set our app to use `process.env.PORT || 4000` so it'll pick up Railway's port).

### Health check

Railway reads `/api/health/ready` automatically if you set it. Go to **Settings → Health Check**:
- **Healthcheck Path:** `/api/health/ready`
- **Healthcheck Timeout:** `100` seconds (the first boot includes Prisma client init + DB connection)

---

## 4. Add the `animbook-web` service

1. Project canvas → **+ New** → **GitHub Repo** → `Echad-Group/animbook` again (third service).
2. Click on it → **Settings** tab:
   - **Service Name:** `animbook-web`
   - **Custom Build Command:** `npm install --legacy-peer-deps && npm run build:web`
   - **Custom Start Command:** `npm run start:web`
   - **Watch Paths:** `apps/web/**`
3. **Variables** tab → **Raw Editor** → paste the contents of `apps/web/.env.production`.
4. **Networking** tab → **Generate Domain** → note the temporary URL.
5. **Settings → Health Check** → **Healthcheck Path:** `/`

### Important: WEB_ORIGIN

Once the API service has its temporary `*.up.railway.app` URL, update the API's `WEB_ORIGIN` env var to include it:
```
WEB_ORIGIN=https://animbook.com,https://www.animbook.com,https://api.animbook.com,https://<web-temp-url>.up.railway.app,https://<api-temp-url>.up.railway.app
```

The web will call the API at the production URL (`api.animbook.com`), but the temp URL is needed during the brief window before DNS lands.

---

## 5. Wire up DNS in Cloudflare

After both services are healthy with their `*.up.railway.app` URLs:

1. Cloudflare → **DNS** for `animbook.com` → **Add Record**:
   - `animbook.com` (apex) → **CNAME** → `<web-service>.up.railway.app`
     - Cloudflare free plan doesn't allow apex CNAME flattening. Workaround: use **Cloudflare Pages** as a proxy OR set the apex to an A record pointing at Railway's load balancer IP (ask Railway support for the IP — they don't publish it). Easier: rename apex to `www.animbook.com` and use `animbook.com` → 301 redirect to `www`.
   - `www` → **CNAME** → `<web-service>.up.railway.app` *(Cloudflare orange-cloud proxy = ON)*
   - `api` → **CNAME** → `<api-service>.up.railway.app`
   - `m` → **CNAME** → `<web-service>.up.railway.app` *(mobile shell uses same origin)*
   - `tv` → **CNAME** → `<web-service>.up.railway.app` *(TV shell uses same origin)*
2. Back in Railway → `animbook-web` → **Settings → Networking → Custom Domain** → add `animbook.com` and `www.animbook.com`. Railway auto-issues Let's Encrypt certificates.
3. `animbook-api` → **Settings → Networking → Custom Domain** → add `api.animbook.com`.
4. Verify with: `dig api.animbook.com +short` (returns Railway's CNAME).

### Alternative (recommended for free plan): apex → Cloudflare redirect

If Cloudflare free doesn't flatten apex CNAMEs:
1. Set `www.animbook.com` → CNAME → web Railway URL (orange-cloud).
2. Set `animbook.com` → **A record** with placeholder IPs from Cloudflare's IP list (they support apex A records via their proxy) — OR redirect apex to `www` via Cloudflare **Rules → Redirect Rules**.
3. Set `api.animbook.com` → CNAME → api Railway URL.

The Caddyfile in the repo reflects this — if you put Caddy in front later, it can serve multiple hostnames from one upstream.

---

## 6. Smoke against prod

Once DNS lands:

```bash
# Health
curl https://api.animbook.com/api/health/ready

# Catalogue
curl -s https://api.animbook.com/api/books | jq '.total, (.items[0] | {slug, title})'

# Web
curl -I https://animbook.com
```

The API health should return:
```json
{
  "status": "ready",
  "checks": { "db": "ok", "redis": "ok" },
  "integrations": {
    "clerk": true, "bookBrain": true, "runway": true,
    "elevenlabs": true, "openai": true, "stripe": false, "cloudflare": true
  }
}
```

Total books should be **30**. The web should return a 200 with the Next.js HTML shell.

---

## 7. Auto-deploy + CI (optional)

Railway auto-deploys on every push to `main` by default (toggle in **Settings → Deploy → Trigger Deploy**).

For CI gating, restore the GitHub Actions workflow (`.github/workflows/ci.yml`) once your PAT has the `workflow` scope:
```bash
git add .github/workflows/ci.yml
git commit -m "Re-add CI workflow"
git push origin main
```

The existing workflow runs lint, typecheck, unit tests, contract smoke (Postgres + Redis service containers), and deploy-ready check. It does NOT auto-deploy to Railway — Railway's own auto-deploy is simpler.

---

## 8. Observability

- **Logs:** Railway → service → **Logs** tab (real-time tail). 7-day retention on Hobby.
- **Metrics:** service → **Metrics** tab (CPU, memory, network, request latency). Free.
- **Custom domain TLS:** auto-issued by Railway + Let's Encrypt. Auto-renews.
- **Errors:** wire Sentry (DSN not set yet) — add `SENTRY_DSN=...` to the API service's env vars, redeploy.

---

## What this gets you

- API on `https://api.animbook.com` — Express + Prisma + Redis, 188/190 endpoints green, all Tier 1/3 keys wired
- Web on `https://animbook.com` (and `www.animbook.com`) — Next.js 14, full reader/library/studio surface
- Mobile + TV shells on `/mobile` + `/tv` of the web origin (no separate service needed)
- Auto-deploy on every push to `main`
- TLS via Let's Encrypt (Railway auto-renews)
- Real-time logs + metrics
- ~$5/month total on the Hobby plan
