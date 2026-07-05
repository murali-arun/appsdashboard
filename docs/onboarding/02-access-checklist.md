# 02 — Access Checklist

Everything Arun needs to grant you before you can do real work. **Do this as one sitting with him**, screen-sharing — going one-by-one over Slack takes days.

The checklist is split into three sections:
1. **Must-have Day 1** — you can't do anything without these
2. **Needed by end of Week 1** — for the projects you'll touch first
3. **Needed eventually** — grant when you first touch the relevant project

Each row: what it is → what it unlocks → how to test it works.

---

## Section 1 — Must-have Day 1

| Item | What it unlocks | How to verify |
|------|-----------------|---------------|
| ☐ GitHub account added to Arun's org / repos (or added as collaborator on each repo) | Clone, pull, push all 11 repos | `gh repo list <arun-handle>` shows all repos |
| ☐ SSH public key added to VPS `~/.ssh/authorized_keys` | Deploy, debug, view logs on prod | `ssh vps 'hostname'` returns without password |
| ☐ SSH public key added to your GitHub account | Push commits over SSH | `ssh -T git@github.com` returns "Hi <you>!" |
| ☐ VPS IP address / hostname | You need this in `~/.ssh/config` | Included in SSH test above |
| ☐ VPS username | Same | Same |
| ☐ Access to the shared password manager (1Password / Bitwarden vault) | Every other secret below lives here | You can open the "Arun Projects" vault |
| ☐ Slack / preferred comms channel with Arun | For questions | Message received |

---

## Section 2 — Needed by End of Week 1

### GitHub Actions Secrets

Every project has GitHub Actions secrets configured at the **repo** level. You don't need copies of them on your laptop — but you need to be able to **read/edit** them via the GitHub UI or `gh secret`. Verify:

```bash
gh secret list --repo <arun-handle>/financialEngine
```

If that lists secrets (names only, not values), you have access. If it errors, Arun needs to bump you to admin on the repo.

Key repo secrets that exist across projects (Arun doesn't need to give you the values — they live in GitHub — but you should know they exist):

- `VPS_HOST`, `VPS_USERNAME`, `VPS_SSH_KEY`, `VPS_PORT`, `VPS_SSH_PASSPHRASE`, `DEPLOY_PATH` — the deploy SSH credentials
- `LITELLM_API_KEY`, `LITELLM_BASE_URL`, `LITELLM_MODEL` — LLM proxy
- `DATABASE_URL` — shared Postgres
- Project-specific secrets (Firebase, Shopify, Hostinger, Expo) — listed below

### LiteLLM (LLM Proxy)

Arun runs his own LiteLLM proxy that fronts multiple LLM providers. Projects that use LLMs (`personal-agent`, `gymSite`, `webgpu-chess-replay`, `keystone`) call this proxy, not OpenAI/Anthropic directly.

| Item | Purpose |
|------|---------|
| ☐ LiteLLM base URL | e.g. `https://llm.<domain>` |
| ☐ LiteLLM API key | Your personal key so Arun can see your usage separately |
| ☐ List of available models | Ask Arun which model each project uses |

Store all three in the password manager, plus your local `.env` files.

### Database access (shared Postgres)

Some projects share a Postgres instance on the VPS.

| Item | Purpose |
|------|---------|
| ☐ Postgres host + port | Usually the VPS IP, port 5432 (may be firewalled — SSH tunnel required) |
| ☐ Your DB user + password | Read/write to your dev copies |
| ☐ SSH tunnel command | e.g. `ssh -L 5432:localhost:5432 vps` — required if Postgres isn't publicly exposed (it shouldn't be) |
| ☐ Database backup location | So you know where snapshots live |

### Nginx Proxy Manager (NPM) admin

NPM is the reverse proxy that handles SSL and routes traffic to containers.

| Item | Purpose |
|------|---------|
| ☐ NPM admin URL (usually `https://<vps>:81`) | Add new subdomains, view SSL status |
| ☐ NPM admin login | Your own account, not Arun's |

### Domain registrar

For adding new subdomains and managing DNS.

| Item | Purpose |
|------|---------|
| ☐ Which registrar (Namecheap / Cloudflare / GoDaddy) | Where DNS lives |
| ☐ Login credentials or delegated access | Add A records for new services |

If Cloudflare, prefer being added as a user to the account rather than sharing a password.

---

## Section 3 — Needed Eventually (grant when you first touch these)

### Mobile (chess-mobile, keystone mobile)

Only needed when you start touching the mobile apps. Apple in particular is a multi-day process on their side — request early.

| Item | For | Notes |
|------|-----|-------|
| ☐ Expo account added to the Expo org | Both mobile apps | Arun invites you as "developer" |
| ☐ `EXPO_TOKEN` (personal access token) | CI builds | Generate at expo.dev/settings/access-tokens |
| ☐ Apple Developer account access | iOS TestFlight publishing | Arun adds you as "App Manager" in App Store Connect |
| ☐ `APPLE_TEAM_ID` | iOS builds | Visible in developer.apple.com/account |
| ☐ App Store Connect API key (P8 file + key ID) | Auto-submit to TestFlight | Generate at appstoreconnect.apple.com/access/api |
| ☐ Google Play Console access | Android publishing | Add you at play.google.com/console |

### Shopify (shopify-theme-v3)

| Item | For | Notes |
|------|-----|-------|
| ☐ Shopify Partner account access OR staff account on the store | Preview themes, push changes | Ask Arun which route to use |
| ☐ Store URL (`your-store.myshopify.com`) | `shopify theme dev --store <URL>` | |
| ☐ Theme access token (`SHOPIFY_CLI_THEME_TOKEN`) | CI deploy | Generate from Shopify admin → Apps → Theme Access |

### Hostinger (bloggingTemplate)

| Item | For | Notes |
|------|-----|-------|
| ☐ Hostinger login (optional) | Manual FTP debugging | GitHub Actions handles routine deploys |
| ☐ FTP host / user / password | Diagnosing failed deploys | Already in GitHub Actions secrets as `HOSTINGER_FTP_*` |

### Firebase (keystone)

| Item | For | Notes |
|------|-----|-------|
| ☐ Firebase project access | Push notifications, auth | Arun adds you as "Editor" in Firebase console |
| ☐ Firebase service account JSON | Local dev + prod | Downloaded from Firebase console; never commit |

### Obsidian sync (obsidianRemote)

| Item | For | Notes |
|------|-----|-------|
| ☐ CouchDB admin user/password | Debugging sync issues | Only if you'll be touching this — mostly runs untouched |

---

## Section 4 — Things NOT to give you

For your safety and Arun's — do NOT accept these unless you specifically need them:

- Arun's personal Google / Apple ID passwords
- Arun's personal 1Password vault (as opposed to the shared "Arun Projects" vault)
- Root VPS password (SSH key is enough; sudo is scoped)
- Domain registrar owner-level login (delegated user access is safer)

If any of these get shared, it's a mistake — flag it and rotate.

---

## Section 5 — What Arun does on his side (for his reference)

Arun, here's the actual checklist you'll work through when granting access:

1. **GitHub**: For each of the 11 repos, `Settings → Collaborators → Add people → <her-github-handle>` with **Admin** role. Or add her to your org if you have one.
2. **VPS**: `ssh vps` → paste her public key into `~/.ssh/authorized_keys` → `chmod 600 ~/.ssh/authorized_keys`.
3. **Password manager**: Share the "Arun Projects" vault with her account.
4. **LiteLLM**: Create a new key for her in the LiteLLM admin UI; share URL + key + model list.
5. **Nginx Proxy Manager**: Log into NPM at `:81` → Users → Add user (email + password, admin role).
6. **Postgres**: `sudo -u postgres createuser --interactive <her-user>` → grant needed DB privileges.
7. **Expo**: expo.dev → your org → Members → Invite (developer role).
8. **Apple**: appstoreconnect.apple.com → Users → Add user → App Manager role on the relevant apps.
9. **Google Play**: play.google.com/console → Users and permissions → Invite (Admin or Release manager).
10. **Shopify**: Shopify admin → Settings → Users → Add staff → give theme access.
11. **Firebase**: console.firebase.google.com → project settings → Users → Add member (Editor).
12. **Domain registrar**: Add her as a delegated user (Cloudflare/Namecheap both support this).
13. **Cloudflare** (if applicable): Add her as an org member with appropriate role.

Do this in one Zoom call — it takes ~1 hour, saves days of async back-and-forth.
