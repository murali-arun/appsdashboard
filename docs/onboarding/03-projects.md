# 03 — The 11 Projects

A fact sheet for every project. Use this as a lookup table — when you're about to work on something, come here first.

Each entry is deliberately short. For deeper spec, read the project's own `README.md`, `PRD.md`, and `CLAUDE.md`.

---

## Quick reference

| # | Project | Stack | Deploy | Live URL |
|---|---------|-------|--------|----------|
| 1 | [`financialEngine`](#1-financialengine) | FastAPI + React + Postgres | VPS/Docker | *ask Arun* |
| 2 | [`personal-assistant`](#2-personal-assistant) | FastAPI + Jinja2 | VPS/Docker | *ask Arun* |
| 3 | [`personal-agent`](#3-personal-agent) | Python + LangChain (CLI) | VPS/Docker | (no web UI) |
| 4 | [`gymSite`](#4-gymsite) | React + Vite + Express + Postgres | VPS/Docker | *ask Arun* |
| 5 | [`appsdashboard`](#5-appsdashboard) | Vite + vanilla JS | VPS/Nginx | *ask Arun* |
| 6 | [`webgpu-chess-replay`](#6-webgpu-chess-replay) | React + Express + Postgres + WebSocket | VPS/Docker + Hostinger | https://chess.anmious.cloud |
| 7 | [`bloggingTemplate`](#7-bloggingtemplate) | Hugo + Python converters | Hostinger via FTP | *ask Arun* |
| 8 | [`keystone`](#8-keystone) | FastAPI + Expo mobile | VPS/Docker + EAS | *ask Arun* |
| 9 | [`chess-mobile`](#9-chess-mobile) | React Native + Expo | EAS Build → TestFlight / Play | (mobile only) |
| 10 | [`shopify-theme-v3`](#10-shopify-theme-v3) | Shopify Liquid | Shopify CLI | (Shopify store) |
| 11 | [`obsidianRemote`](#11-obsidianremote) | CouchDB | VPS/Docker | *ask Arun* |

---

## 1. financialEngine

**Purpose** — Personal finance planner: smart debt planning, transaction tracking, cashflow analysis.

**Stack**
- Backend: FastAPI (Python 3.12), SQLAlchemy, Alembic, Postgres
- Frontend: **two UIs** — Jinja2 templates at `/planner` (production) AND a separate React + Vite SPA (secondary). ⚠️ Identify which UI the user is looking at before editing CSS. See memory: financialEngine has two UIs.
- Tests: `pytest`
- Extras: bandit + pip-audit run in CI

**Run locally**
```bash
cd financialEngine
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload   # backend on :8000
# optional React frontend:
cd frontend && npm install && npm run dev   # on :5173
```

**Env vars** (see `.env.example`)
- `APP_PORT`, `DATABASE_URL`, `FRONTEND_ORIGINS`, `PAGE_SECRET`, `POSTGRES_*`

**Deploy** — Push to `main` → GitHub Actions → SSH to VPS → `docker compose up -d`. Backend on `:8000`, frontend on `:8081`.

**Gotchas**
- Strict income pattern matching in `cashflow.py`
- Recurring aliases architecture — read `PRD.md` before touching
- Explicit method-level imports (don't reorganize imports carelessly)
- Financial data stays local — no third-party analytics
- Before designing any financial calc feature, run `/finance-review` (see conventions doc)

---

## 2. personal-assistant

**Purpose** — Minimal FastAPI personal assistant. Small surface area, healthy testing baseline.

**Stack** — FastAPI (Python 3.12), Jinja2, Postgres, pytest.

**Run locally**
```bash
cd personal-assistant
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

**Env vars** — `DB_URL`, `APP_ENV`, `SECRET_KEY`, `GIT_SHA`, `APP_VERSION`.

**Deploy** — Same VPS/Docker pattern as financialEngine.

---

## 3. personal-agent

**Purpose** — LangChain-based agent with read-only tools for the VPS and GitHub. **CLI only, no HTTP surface.**

**Stack** — Python 3.11, LangChain, LiteLLM client.

**Run locally**
```bash
cd personal-agent
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python agent.py
```

**Env vars** — `LITELLM_BASE_URL`, `LITELLM_API_KEY`, `LITELLM_MODEL`, `GITHUB_TOKEN`, `GITHUB_OWNER`, `VPS_HOST`, `VPS_USER`, `VPS_KEY_PATH`, `COMPOSE_DIR`.

**Deploy** — Runs on VPS. CI writes `.env` from GitHub secrets at deploy time.

**Gotchas** — Only syntax check in CI (no proper tests yet).

---

## 4. gymSite

**Purpose** — AI Gym Tracker with coach personalities. Frontend + backend + LLM integration.

**Stack**
- Frontend: React 18 + TypeScript, Vite, Tailwind, Three.js
- Backend: Node 20, Express
- DB: Postgres
- Architecture: Atomic Design (atoms/molecules/organisms). Read `README.md` before adding components.

**Run locally**
```bash
cd gymSite
npm install
npm run dev   # frontend on :5173

# separate terminal:
cd gymSite/backend
npm install
npm run dev   # backend on :3002
```

**Env vars**
- Frontend: `VITE_API_URL`
- Backend: `PORT`, `NODE_ENV`, `API_SECRET`, `LITELLM_*`

**Deploy** — VPS/Docker. Frontend on `:8080`, backend on `:3002`.

---

## 5. appsdashboard

**Purpose** — Landing page linking to Arun's apps. Minimal Vite + vanilla JS.

**Run locally**
```bash
cd appsdashboard && npm install && npm run dev   # on :5173
```

**Env vars** — None.

**Deploy** — Nginx + Docker on VPS at `/opt/appsdashboard`. GitHub Actions auto-generates `nginx.conf` and `docker-compose.yml` on the VPS.

---

## 6. webgpu-chess-replay

**Purpose** — Chess replay + multiplayer with Stockfish WASM. Terminal-style UI.

**Stack**
- Frontend: React + TypeScript, Vite, chess.js
- Backend: Node/Express + WebSocket
- DB: Postgres, JWT auth

**Run locally**
```bash
cd webgpu-chess-replay
npm install
npm run dev:full   # runs frontend (5173) + backend (3010) concurrently
```

**Env vars (backend)** — `DB_URL`, `JWT_SECRET`, `LITELLM_KEY`, `LITELLM_URL`, `LITELLM_MODEL`.

**Deploy** — VPS/Docker AND Hostinger (via `deploy-hostinger.yml`). Live at https://chess.anmious.cloud.

**Gotchas**
- Multiplayer state is **in-memory only**. If you scale beyond one container, add Redis first.
- Stockfish WASM files are large — cached separately via `upload-models.yml`.

---

## 7. bloggingTemplate

**Purpose** — Hugo blog with DOCX/LaTeX-to-post automation. Push a `.docx`, GitHub Actions converts to Markdown + Hugo post.

**Stack** — Hugo (extended), Python converters (pandoc under the hood).

**Run locally**
```bash
cd bloggingTemplate
hugo server   # on :1313
```

**Env vars** — None (config lives in `config.yaml`).

**Deploy** — GitHub Actions builds Hugo → SCP to Hostinger via FTP. Uses `HOSTINGER_FTP_*` secrets.

**Gotchas**
- **Status filtering** (draft vs published) must happen in `themes/hugo-mag/layouts/partials/header.html` **before** `.Paginate` — Hugo limitation. Don't move it.
- DOCX/LaTeX auto-convert on push (via `docx-to-post.yml` / `tex-to-post.yml`).

---

## 8. keystone

**Purpose** — Couples habit tracker + scheduler. Push notifications via Firebase, scheduling via APScheduler. Has a backend (VPS) AND a mobile app (Expo).

**Stack**
- Backend: FastAPI, SQLite/Postgres, Firebase, APScheduler
- Mobile: React Native (Expo)
- Stage P (PWA pilot) is the current build target per PRD.

**Run locally — backend**
```bash
cd keystone/backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload
```

**Run locally — mobile** — See `04-local-development.md` (Expo section).

**Env vars (backend)** — `DATABASE_URL`, `FIREBASE_CREDENTIALS_PATH`, `PAIR_CODE_TTL_MINUTES`, `NUDGE_COOLDOWN_SECONDS`.

**Deploy**
- Backend: VPS/Docker at `/opt/keystone/backend` (workflow: `deploy-backend.yml`)
- Mobile: EAS Build → iOS **auto-submits to TestFlight** on prod builds. Android via `build-apk.yml`.

**Gotchas**
- Firebase credentials mounted as a **Docker secret**, not an env file.
- iOS prod builds auto-submit to TestFlight — don't tag `production` unless you mean it.

---

## 9. chess-mobile

**Purpose** — Standalone React Native chess app (separate from `webgpu-chess-replay`).

**Stack** — React Native, Expo 56, TypeScript, EAS Build.

**Run locally**
```bash
cd chess-mobile
npm install
expo start
# then in the Expo dev menu: press 'i' for iOS sim, 'a' for Android
# or: expo run:ios  /  expo run:android
```

**Env vars for CI** — `EXPO_TOKEN`, `ASC_API_KEY_CONTENT`, `ASC_API_KEY_ID`, `APPLE_TEAM_ID`.

**Deploy** — `build.yml` runs EAS Build. iOS prod auto-submits to TestFlight.

**Gotchas**
- App Store Connect API key is a P8 file — stored in secrets as base64 content.
- Android build uses `--no-wait` (fires and forgets; check EAS dashboard).

---

## 10. shopify-theme-v3

**Purpose** — Custom Shopify theme ("Luxe"). Modern design with Playfair Display + Inter.

**Stack** — Shopify Liquid + CSS.

**Run locally**
```bash
cd shopify-theme-v3
shopify theme dev --store <your-store>.myshopify.com
```

**Env vars for CI** — `SHOPIFY_STORE`, `SHOPIFY_CLI_THEME_TOKEN`.

**Deploy** — `deploy-theme.yml` uses Shopify CLI to find/create theme, then push. Deploys as **unpublished** — Arun manually promotes.

**Gotchas**
- **50 MB upload limit** per theme (don't check in big images).
- Logo has auto-invert CSS filter (dark/light backgrounds).
- `aggregateRating` JSON-LD only renders if Shopify metafields are populated.

---

## 11. obsidianRemote

**Purpose** — Self-hosted CouchDB for Obsidian LiveSync plugin. Sync Arun's Obsidian vault across devices.

**Stack** — CouchDB in Docker, NPM handles proxy.

**Run locally** — Not applicable. VPS-only.

**Env vars** — `COUCHDB_USER`, `COUCHDB_PASSWORD`.

**Deploy** — `docker compose pull && up -d` on VPS. Data at `/opt/obsidianRemote/couchdb/data`.

**Gotchas**
- **Websockets MUST be enabled** in the NPM proxy host or sync silently fails.
- Backup `/opt/obsidianRemote/couchdb/data` — losing it loses the vault sync history.

---

## Excluded from your scope

These live in the same workspace but are **not** part of your handoff:

- `PythonDSA` (learning repo)
- `pythonTutorial` (learning repo)
- `trivalleyvastrams` (community project, separate context)
- `hugo-xmag` (upstream theme, not deployed)
- `couple-outfit-configurator` (paused)
- `BudgetAIWebsite` (deprecated)

Don't touch these unless Arun specifically asks.
