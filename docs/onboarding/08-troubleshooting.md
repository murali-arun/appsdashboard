# 08 — Troubleshooting

The specific problems that will hit you, and how to fix them fast. Organized by symptom.

---

## `git push` fails

### "Permission denied (publickey)"
Your SSH key isn't set up with GitHub.

```bash
ssh -T git@github.com
```

If this doesn't say "Hi <you>!", your key is missing. Re-check `01-macbook-setup.md` — you need the public key on GitHub AND the private key loaded into your agent.

### "Updates were rejected"
Someone else pushed to `main`. `git pull --rebase origin main` and try again. If there are conflicts, resolve them locally.

### `/safe-push` blocks
Read what it says. Common blocks:
- Tests fail → fix them
- `bandit` HIGH severity → fix or explicitly acknowledge
- Uncommitted files → commit or stash
- Not on a feature branch → create one

---

## CI is red

### Tests fail in CI but pass locally
Nine times out of ten, one of:

- **Env var missing in CI**. Check `.env.example` and confirm every var has a corresponding GitHub secret.
- **Python version mismatch**. `python3.12` vs `python3.11`. Check `setup-python` step.
- **Node version mismatch**. `node@20` vs `node@18`. Check `setup-node` step.
- **DB state differs**. Local dev DB has data; CI spins up empty. Add a fixture or seed.
- **Time zone / locale**. Tests that assume UTC or `en_US.UTF-8` may fail on a different runner.

### `pip-audit` flags a CVE
Check the severity. If it's a transitive dep of something you don't use directly, you can pin the fixed version:

```
# in requirements.txt
cryptography>=42.0.4   # CVE-XXXX-YYYY
```

Then `pip install -r requirements.txt && pip freeze > requirements.txt`.

### `bandit` flags something
Read the finding. If it's a false positive (e.g. `assert` in test code), add `# nosec` inline. If it's real, fix it.

### `npm run build` fails
Usually a TS type error or missing env var (`VITE_*`). Reproduce locally: `npm ci && npm run build`. Vite errors are very readable.

---

## Deploy fails at SSH step

### "Host key verification failed" or "Permission denied"
The `VPS_SSH_KEY` secret is wrong, expired, or the VPS's `authorized_keys` was cleared. Fix:

1. `ssh vps` from your Mac — does that work? If not, your local key is bad too — regenerate.
2. If yours works but CI's doesn't: check that `VPS_SSH_KEY` in GitHub secrets matches a public key in `~/.ssh/authorized_keys` on the VPS.
3. If the passphrase is set: `VPS_SSH_PASSPHRASE` secret must be set too.

### SSH validation timeout
CI retries 6 times. If it still fails, the VPS is probably down.

```bash
ssh vps 'uptime'
```

If unreachable, log into the VPS host provider's control panel and check.

---

## Container won't start

### `docker compose up -d` succeeds but `docker ps` shows it exited

Read the logs — that's where the crash is:

```bash
ssh vps 'cd /opt/<project> && docker compose logs --tail 200 <service>'
```

Common causes:
- **Missing env var** (Python: `KeyError` on startup; Node: `undefined is not a function`)
- **Can't reach the DB** — DB container isn't running or `DATABASE_URL` points wrong
- **Port already in use** — another container has the same `container_name` or is bound to the same host port
- **Volume mount issue** — the mounted path doesn't exist or is unwritable

### "Network npm_default not found"
The Nginx Proxy Manager network is missing.

```bash
ssh vps 'docker network create npm_default'
```

Then `docker compose up -d` again.

### Container is up but returns 502 through NPM
NPM can reach the container's IP but the container isn't serving on the expected port. Check:

- App is listening on `0.0.0.0`, not `127.0.0.1` (inside a container, `127.0.0.1` is only the container itself)
- `docker-compose.yml` doesn't need `ports:` mapping (NPM connects via Docker network)
- NPM's Forward Port matches the app's actual port

---

## Nginx Proxy Manager

### "Bad Gateway" on all sites
NPM is dead. Restart it:

```bash
ssh vps 'cd /opt/nginx-proxy-manager && docker compose restart'
# or if it's not in /opt:
ssh vps 'docker ps -a | grep npm' # find the container
ssh vps 'docker restart <container_name>'
```

### Websocket connection fails (chess, obsidian)
NPM proxy host → Edit → **Enable Websockets Support** must be ON. Save and reload.

### SSL renewal failed
NPM → Hosts → Proxy Hosts → click the host → SSL tab → "Force Renew". If it fails with a Let's Encrypt rate limit, wait — LE limits are 5 certs/week per domain.

---

## Database

### Migration errors (`financialEngine`, others using Alembic)

**"Target database is not up to date"** — someone applied a migration on prod that isn't in your branch:

```bash
alembic upgrade head       # locally
git pull origin main       # sync latest migration files
```

**"Can't locate revision X"** — a migration file was deleted or you branched off before it was merged. `alembic heads` shows your current tip; compare with the deployed one.

**Autogenerate creates a huge diff you didn't ask for** — usually because your local schema is out of sync. `alembic upgrade head` first, then re-autogenerate.

### Connection refused locally
DB isn't running. If using Docker locally:

```bash
docker compose up -d postgres
```

Or check `DATABASE_URL` — `localhost:5432` vs `postgres:5432` depending on where your app runs.

### VPS Postgres won't accept remote connections
Postgres is (correctly) firewalled. Use an SSH tunnel:

```bash
ssh -L 5432:localhost:5432 vps
# then in another terminal, connect to localhost:5432
```

---

## Mobile builds

### `eas build` fails with "Not authenticated"
```bash
eas login
```

Or in CI, `EXPO_TOKEN` secret is expired. Regenerate at expo.dev/settings/access-tokens.

### iOS build fails: "Provisioning profile doesn't include the currently selected device"
You're trying `expo run:ios --device` on a device that isn't in the provisioning profile. Either use the simulator (`expo run:ios` no `--device`) or add the device via Apple Developer portal.

### iOS build succeeds but doesn't upload to TestFlight
- Check `eas.json` — `submit.production.ios` must be configured
- `ASC_API_KEY_CONTENT`, `ASC_API_KEY_ID`, `ASC_API_KEY_ISSUER_ID` all set in GitHub secrets
- The API key hasn't expired (Apple keys expire after ~1 year)

### Android build blows past its timeout
`build.yml` uses `--no-wait` for Android by design. Check the EAS dashboard for the build result: expo.dev.

### Simulator won't launch
```bash
xcrun simctl list
xcrun simctl boot "iPhone 15"
```

Or open Xcode → Window → Devices and Simulators → make sure one is available.

---

## Shopify

### `shopify theme dev` fails to authenticate
```bash
shopify logout
shopify login --store <your-store>.myshopify.com
```

### CI deploy fails: "theme not found"
The workflow creates the theme on first run. If someone deleted it, re-run — it should auto-create.

### "50 MB upload limit exceeded"
You have too-large assets in the theme. Move images to Shopify's CDN or an external CDN and reference by URL.

### Metafield-driven blocks are empty
`aggregateRating`, product-specific badges, etc. render from Shopify metafields. On a fresh dev store, those metafields don't exist → empty. Populate them in Shopify admin or accept that dev previews will be sparse.

---

## Hugo (bloggingTemplate)

### `hugo server` errors "template not found"
You're missing files from the theme submodule. Try:

```bash
git submodule update --init --recursive
```

### Draft posts show up on the live site
Check the frontmatter has `draft: true`. Also check the pagination filter in `themes/hugo-mag/layouts/partials/header.html` — it must filter drafts BEFORE `.Paginate` (Hugo limitation, see `03-projects.md` gotchas).

### FTP deploy fails
`HOSTINGER_FTP_*` secrets. Also, Hostinger occasionally rotates SFTP credentials — check your Hostinger dashboard.

---

## Docker

### "No space left on device"
```bash
ssh vps 'df -h'
ssh vps 'docker system df'
ssh vps 'docker system prune -f'
ssh vps 'docker image prune -a -f'
```

Never `docker volume prune` without checking what's about to disappear.

### Container exits with code 137
OOM-killed. Give it more memory (host has more), or fix the memory leak. Use `/memory` skill checklist.

### Container exits with code 139
Segfault. Almost always a native module compiled for the wrong architecture. Rebuild the image on the target platform: `docker compose build --no-cache <service>`.

### `docker compose build` is slow
Layers aren't cached. Reorder your Dockerfile: `COPY package.json .` and `npm install` **before** `COPY . .` — so source changes don't invalidate the dependency install layer.

---

## macOS-specific

### "xcrun: error: invalid active developer path"
Reinstall command-line tools:

```bash
xcode-select --install
```

### `brew install` errors on Apple Silicon
Homebrew lives at `/opt/homebrew` on Apple Silicon vs `/usr/local` on Intel. Make sure `/opt/homebrew/bin` is on your PATH:

```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
```

Add that to `~/.zshrc`.

### Docker Desktop uses 100% of my Mac
Check Docker Desktop → Settings → Resources → limit CPU/RAM. Also, close containers you're not using: `docker compose down` in the project.

---

## When none of this helps

1. **Read the actual error output.** Don't skim — read every line. The answer is usually in there.
2. **Search the exact error string.** Copy-paste into Google or GitHub Issues. Include the tool version.
3. **Check `git log --oneline -20`** — did someone recently change something related?
4. **`grep -r "<thing>"`** the repo for the failing string / symbol.
5. **Ask Arun** with:
   - What you were doing
   - What you expected
   - What actually happened (error output pasted)
   - What you've already tried

A well-formed question gets a fast answer. A vague "it's broken" gets a slow one.
