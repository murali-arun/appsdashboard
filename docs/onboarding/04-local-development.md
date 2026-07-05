# 04 — Local Development

How to actually work on each type of project. This assumes you finished `01-macbook-setup.md` and got access from `02-access-checklist.md`.

Every project follows one of five patterns. Learn the pattern once, apply it everywhere.

---

## Pattern A — Python + FastAPI

Used by: **`financialEngine`**, **`personal-assistant`**, **`personal-agent`**, **`keystone/backend`**.

### First-time setup

```bash
cd <project>
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env    # then edit .env with real values from password manager
```

### Every time you start work

```bash
cd <project>
source .venv/bin/activate     # or: act (if you added the alias)
uvicorn app.main:app --reload
```

`--reload` watches your files and restarts on save. Server usually on `http://localhost:8000`.

### Running tests

```bash
pytest -q
```

**Rule**: prefer integration tests over mocked unit tests (from `CLAUDE.md`). If you're mocking the DB, you're probably doing it wrong here.

### Database migrations (Alembic)

`financialEngine` uses Alembic. To generate a migration after changing a model:

```bash
alembic revision --autogenerate -m "add foo column to bar"
alembic upgrade head
```

Never mutate the schema by hand. Check the migration file diff before committing — autogenerate misses things (renamed columns, custom types).

### Adding a dependency

```bash
pip install <package>
pip freeze > requirements.txt   # or manually add with a version pin
```

---

## Pattern B — React + Vite (frontend only)

Used by: **`appsdashboard`**, **`shopify-theme-v3`** (via Shopify CLI, not Vite — see Pattern E).

### First-time setup

```bash
cd <project>
npm install
cp .env.example .env    # if applicable
```

### Every time

```bash
npm run dev
```

Vite dev server usually on `http://localhost:5173` with hot module reload.

### Build test

Before pushing anything, verify the production build works:

```bash
npm run build
```

If this errors, CI will error too. Fix locally first.

---

## Pattern C — React + Vite frontend + Node/Express backend

Used by: **`gymSite`**, **`webgpu-chess-replay`**, **`financialEngine`** (when running the React UI alongside).

### First-time setup

Two npm projects, two installs:

```bash
cd <project>
npm install
cd backend    # if applicable
npm install
```

### Every time

Preferred (if the project has a `dev:full` script — `webgpu-chess-replay` does):

```bash
npm run dev:full
```

Otherwise, two terminals:

```bash
# Terminal 1
cd <project>
npm run dev

# Terminal 2
cd <project>/backend
npm run dev
```

### Env vars

Frontend uses `VITE_*` prefixed vars (Vite only exposes those to the client). Backend uses whatever it wants — usually via `dotenv`.

---

## Pattern D — Hugo static site

Used by: **`bloggingTemplate`**.

### First-time setup

Nothing — just make sure Hugo is installed and it's the **extended** build (`hugo version` shows "extended").

### Every time

```bash
cd bloggingTemplate
hugo server
```

Live at `http://localhost:1313` with automatic rebuilds on file changes.

### Writing a new post

```bash
hugo new posts/my-post-title.md
```

Then edit `content/posts/my-post-title.md`. To keep it out of production, add `draft: true` to frontmatter or put in `drafts/`.

### DOCX → post workflow

Push a `.docx` file to `content/` (or wherever the workflow watches). CI runs `docx-to-post.yml` and converts to Markdown + creates a post. Same for `.tex` files.

### Building

```bash
hugo   # generates ./public/
```

Never commit `public/` — CI builds it.

---

## Pattern E — Shopify theme

Used by: **`shopify-theme-v3`**.

### First-time setup

```bash
cd shopify-theme-v3
shopify login --store <your-store>.myshopify.com
```

### Every time

```bash
shopify theme dev --store <your-store>.myshopify.com
```

This creates an **unpublished dev theme** on the store you can preview at a URL Shopify prints. Live-reloads on file save.

### Pushing changes (dev workflow)

Push to a specific unpublished theme:

```bash
shopify theme push --theme <theme-id>
```

**Never** run `shopify theme publish` without Arun's OK. Publishing swaps the live theme. CI/CD deploys as unpublished; Arun promotes.

### Gotchas

- 50 MB upload cap per theme — large images should go to a CDN, not the theme.
- Some sections rely on Shopify **metafields** — they render empty on a fresh dev store.

---

## Pattern F — Mobile (Expo / React Native)

Used by: **`chess-mobile`**, **`keystone/mobile`** (when it exists — check the repo).

### First-time setup

```bash
cd <project>
npm install
```

You also need Xcode installed (for iOS simulator) and/or Android Studio. If neither, use the Expo Go app on your physical phone — scan the QR code that `expo start` prints.

### Every time

```bash
expo start
```

Then in the Expo CLI:
- Press `i` → open in iOS simulator
- Press `a` → open in Android emulator
- Scan QR with Expo Go app → run on physical device

### Building a production binary

Uses EAS Build (cloud):

```bash
eas build --platform ios --profile production
eas build --platform android --profile production
```

Requires `EXPO_TOKEN` if running non-interactively. Locally you just need to be logged in: `eas login`.

**iOS production builds auto-submit to TestFlight** (via `eas.json` config). Don't run production builds by accident.

### Testing on a real iPhone (before EAS)

For faster iteration on real hardware:

```bash
expo run:ios --device
```

Requires your device paired with Xcode.

---

## Pattern G — Docker Compose (running the whole stack)

Every VPS project has a `docker-compose.yml`. Sometimes you want to test the containerized version locally — e.g. before a deploy, or when debugging a "works locally, breaks in prod" issue.

```bash
cd <project>
docker compose up --build
```

To rebuild only one service:

```bash
docker compose up --build <service-name>
```

To see logs:

```bash
docker compose logs -f
```

To tear down:

```bash
docker compose down
```

The prod `docker-compose.yml` expects `npm_default` network to exist (that's the NPM reverse proxy network on the VPS). Locally that network doesn't exist — either:
1. Comment out the `networks:` block temporarily, or
2. Create the network locally: `docker network create npm_default`

---

## The workflow that ties it all together

For every task, no matter the project, use this loop:

1. **Read** — the relevant `README.md`, `PRD.md`, `CLAUDE.md`. Skim recent `git log`.
2. **Branch** — `git checkout -b feat/short-description` (or `fix/…`, `chore/…`).
3. **Run it locally** — get it working before you type any code. If you can't run it, you can't verify your change.
4. **Make the change** — smallest possible diff.
5. **Test it locally** — run tests, then click through the app in a browser to verify.
6. **Commit** — small commits, imperative mood.
7. **Push safely** — run `/safe-push` (see `06-conventions.md`). This runs tests, security checks, pushes, watches CI, and smoke-tests the deploy. Never `git push` bare.

Details on the deploy pipeline are in `05-deployment.md`.
