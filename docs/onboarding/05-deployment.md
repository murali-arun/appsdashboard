# 05 — Deployment

How code gets from your MacBook to production. Read this once, carefully. It's the same story for 8 of the 11 projects.

---

## The single mental model (VPS projects)

```
git push main
    │
    ▼
GitHub Actions runs (.github/workflows/deploy.yml)
    │
    ├── Run tests (pytest / vitest / build)
    ├── Optional: security scan (bandit, pip-audit)
    │
    ▼
SSH into the VPS with VPS_SSH_KEY
    │
    ├── SCP: copy repo files to /opt/<project>/
    ├── docker compose down || true       (stop old containers)
    ├── docker compose build              (build fresh images)
    ├── docker compose up -d              (start new containers)
    └── docker compose logs --tail 50     (verify healthy)
    │
    ▼
Nginx Proxy Manager (running in its own container on the VPS)
    │
    ├── Sees the container on the npm_default network
    ├── Terminates SSL (Let's Encrypt cert)
    └── Routes traffic: https://<subdomain>/ → container:<port>
    │
    ▼
User's browser hits https://<subdomain>/
```

**Every VPS-deployed project follows this exact flow.** The only variations are:
- What tests run
- Which containers get built
- What env vars/secrets are needed

---

## The VPS itself

- Single VPS. Docker + Docker Compose is the entire runtime.
- All containers connect to the **`npm_default`** external Docker network.
- All projects live under `/opt/<project-name>/`.
- Nginx Proxy Manager (NPM) admin UI is at `https://<vps>:81` — that's where you add/edit routes.
- SSL is Let's Encrypt via NPM — auto-renews if you set it up right the first time.

### Convention: every container in every `docker-compose.yml`

```yaml
services:
  my-service:
    container_name: my-project-service   # UNIQUE across the entire VPS
    restart: unless-stopped              # Survives VPS reboot
    networks:
      - npm_default
    volumes:
      - my-project-data:/data            # Named volume, never bind-mount ephemeral paths
    environment:
      - FOO=${FOO}                       # From .env at deploy time

networks:
  npm_default:
    external: true

volumes:
  my-project-data:
```

**Rules** (from `CLAUDE.md`):
- `container_name` must be unique across the whole VPS. Don't name two containers `backend`.
- Use `restart: unless-stopped` on every service.
- Use **named volumes** for persistent data, never bind-mount to `/tmp` or similar.
- **Never expose container ports directly to the internet.** NPM proxies everything.

---

## Anatomy of a deploy workflow

Look at `financialEngine/.github/workflows/deploy.yml` as the reference. Every VPS project's workflow follows this shape:

```yaml
on:
  push:
    branches: [main]
  workflow_dispatch:   # manual trigger from GitHub UI

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pip install -r requirements.txt
      - run: pytest -q
      - run: bandit -r app/
      - run: pip-audit

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: SSH validation (retry 6x)
        # waits until VPS is reachable
      - name: SCP files to VPS
        # rsync/scp repo → /opt/<project>/
      - name: Deploy
        # ssh vps 'cd /opt/<project> && docker compose down || true && docker compose build && docker compose up -d'
      - name: Verify
        # ssh vps 'docker compose logs --tail 50 <service>'
```

The **SSH validation with retry** is important — VPS might be briefly unreachable during the deploy of another project. Don't remove it.

---

## Secrets — how they flow

All secrets live in one of two places:

1. **GitHub repository secrets** (`Settings → Secrets and variables → Actions`)
   - Used at CI time to authenticate to the VPS and to write `.env` files
   - Never leave GitHub
2. **The VPS `/opt/<project>/.env` file**
   - Written by the deploy workflow from GitHub secrets
   - Read at container startup

You should never copy secret values onto your laptop except when running the project locally. For local dev, get values from the password manager (see `02-access-checklist.md`).

### Adding a new secret to a project

1. Add it to `.env.example` with a placeholder value (and a comment describing what it is)
2. `gh secret set FOO --repo <org>/<project>` (or via UI)
3. Update `deploy.yml` to write `FOO=${{ secrets.FOO }}` into the `.env` on the VPS
4. Reference it in your code via `os.getenv("FOO")` (Python) or `process.env.FOO` (Node)

---

## Kicking off a deploy

```bash
git push origin main
```

That's the trigger. Watch it:

```bash
gh run watch --repo <org>/<project>
# or:
gh run list --repo <org>/<project> --limit 5
```

Alternatively, use `/safe-push` (mandatory per `CLAUDE.md`) — it pushes AND watches CI AND smoke-tests the live site.

### Manually re-running a deploy (no code change)

Useful if you rotated a secret and just need to redeploy with new env values:

```bash
gh workflow run deploy.yml --repo <org>/<project>
```

Or via GitHub UI: Actions → deploy.yml → Run workflow.

### Rolling back

There is no "rollback button." To roll back:

```bash
cd <project>
git revert <bad-commit-sha>
git push origin main   # via /safe-push
```

Or, faster, on the VPS directly:

```bash
ssh vps
cd /opt/<project>
git log --oneline -10     # find the good commit
git checkout <good-sha>
docker compose down && docker compose up -d --build
```

But then the **next** deploy from `main` will re-apply the bad code. So this is a stopgap — always follow up with a proper `git revert` + push.

---

## Non-VPS deployments

Three projects deploy elsewhere. Same push-to-main pattern, different target.

### Hostinger — `bloggingTemplate` and `webgpu-chess-replay`

**bloggingTemplate**: `ftp-deploy.yml` builds the Hugo site and FTPs `public/` to Hostinger.

Secrets used: `HOSTINGER_FTP_HOST`, `HOSTINGER_FTP_USER`, `HOSTINGER_FTP_PASSWORD`.

**webgpu-chess-replay**: `deploy-hostinger.yml` also FTPs a static build. Currently disabled for GitHub Pages; enabled for Hostinger.

### Shopify — `shopify-theme-v3`

`deploy-theme.yml`:
1. Shopify CLI logs in with `SHOPIFY_CLI_THEME_TOKEN`
2. Finds a theme called (something like) "CI-Preview" or creates one
3. Pushes the current repo state to it as an **unpublished theme**
4. Arun manually publishes when ready

`publish-theme.yml` is the (manual-only) workflow to promote the CI-Preview theme to live. Do NOT trigger this without approval.

### Mobile — `chess-mobile` and `keystone` mobile

`build.yml` / `mobile-build.yml`:
1. `eas-cli` logs in with `EXPO_TOKEN`
2. Builds iOS + Android in the cloud (Expo's servers, not your Mac)
3. iOS: on `production` profile, **auto-submits to TestFlight** using the ASC API key
4. Android: builds an APK; on `production` it also submits to Play Store internal track

Secrets used:
- `EXPO_TOKEN` — your Expo access token
- `APPLE_TEAM_ID` — Apple developer team
- `ASC_API_KEY_CONTENT` — base64 of the App Store Connect P8 file
- `ASC_API_KEY_ID`, `ASC_API_KEY_ISSUER_ID` — key metadata
- `GOOGLE_SERVICE_ACCOUNT_JSON` — Play Store deploy

**Iterate cautiously**: an iOS production build submitted to TestFlight is user-visible within minutes. Test on `preview` profile first.

---

## Adding a new project to the VPS

If Arun spins up a new project you need to deploy:

1. Copy `docker-compose.yml` from an existing project as a template
2. Change `container_name`, exposed ports, volumes to be unique
3. Copy `.github/workflows/deploy.yml` from an existing project
4. Update `DEPLOY_PATH` and any project-specific secrets
5. Add project-specific secrets: `gh secret set` for each
6. Create the DNS record (A record → VPS IP) at the domain registrar
7. In NPM UI (`:81`):
   - Hosts → Proxy Hosts → Add Proxy Host
   - Domain: `<subdomain>.<domain>`
   - Forward Hostname/IP: `<container_name>` (Docker DNS)
   - Forward Port: `<container's internal port>`
   - **Enable Websockets Support** if the app uses them
   - SSL tab: request a new Let's Encrypt cert
8. Push to `main` — deploy runs, container starts, NPM routes to it, SSL just works

---

## What NOT to do

- ❌ Edit code on the VPS. Next deploy overwrites it. Fix in git.
- ❌ Expose container ports directly to the internet. Always through NPM.
- ❌ Skip `/safe-push`. It exists because bare `git push` has broken prod before.
- ❌ Publish a Shopify theme from CI. Deploys unpublished; Arun promotes.
- ❌ Ship a mobile prod build without checking `eas.json` — it may auto-submit to stores.
- ❌ `docker compose down -v`. The `-v` removes named volumes → data loss.

For emergency response, see `07-operations.md`.
