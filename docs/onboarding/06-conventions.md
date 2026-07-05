# 06 — Conventions

The rules of the road. Most are enforced by the repo `CLAUDE.md`. Read this once and internalize.

---

## Git

- `main` is production. Every push triggers CI/CD. Treat it accordingly.
- Never push directly to `main` without going through CI. In practice this means: push a branch first, verify the deploy would work, then merge — OR use `/safe-push` which does this loop safely.
- **Branch names**: `feat/…`, `fix/…`, `chore/…`, `docs/…`. Kebab-case, short.
- **Commit messages**: imperative mood, ≤72 chars subject. Body optional but appreciated.
  - ✅ `fix: prevent double-count of debt payments in cashflow`
  - ✅ `feat: add streak view to keystone habit page`
  - ❌ `fixed a bug` / `updates` / `wip`
- Small commits are better than large ones. If a PR has 40 files changed, split it.
- Rebase or merge — team preference is rebase for clean history, merge for feature branches you collaborated on. When in doubt, ask.
- **Lock files** (`package-lock.json`, `poetry.lock`, etc.) are committed. Always.
- **Never commit `.env` files.** Every `.env` variable must have a documented placeholder in `.env.example`.

---

## The `/safe-push` mandate

From `CLAUDE.md`: **Always use `/safe-push` before any `git push`. No exceptions.**

Why: `/safe-push` runs tests, security scans, pushes, watches CI, and smoke-tests the live site. Plain `git push` has caused prod incidents. This is a non-negotiable rule Arun has enforced repeatedly.

If you're not using Claude Code, the equivalent manual checklist:

1. `pytest -q` (or `npm test` / `npm run build`) — pass locally
2. `bandit -r <src>` and `pip-audit` for Python — no highs
3. `git push origin <branch>`
4. Open the PR; wait for CI green
5. Merge to `main`
6. `gh run watch` — verify deploy succeeds
7. `curl https://<live-url>/health` or hit the page in a browser

Automate this loop; don't skip steps.

---

## Code style — Python

From `CLAUDE.md`:
- **Python 3.11+** (3.12 is now default), FastAPI or LangChain
- **`pydantic-settings`** for config. Never hardcode secrets.
- **Alembic** for all DB migrations. Never mutate schema by hand.
- **`pytest`**, prefer integration tests over mocked unit tests
- **Black** formatting, **isort** imports
- **No bare `except:`.** Always catch a specific exception type.

```python
# ❌ bad
try:
    do_thing()
except:
    logger.error("failed")

# ✅ good
try:
    do_thing()
except SpecificError as e:
    logger.error("failed", extra={"error": str(e)})
    raise
```

### Logging

Every production feature MUST emit structured logs. Rules:

- Use Python's `logging` module. **Never `print` in production code.**
- Levels:
  - `DEBUG` — trace data (usually off in prod)
  - `INFO` — state transitions ("user logged in", "job started")
  - `WARNING` — recoverable issues ("retry succeeded on attempt 3")
  - `ERROR` — failures (unhandled exceptions, contract violations)
- Include `request_id` on every log line handling an HTTP request. See `financialEngine` for the pattern.
- Log start AND end of expensive ops (DB queries, external calls, file parsing).
- **Never log secrets, passwords, or PII.** Ever.

```python
import logging
logger = logging.getLogger(__name__)

logger.info(
    "importing transactions",
    extra={"request_id": req_id, "count": len(rows)},
)
```

If you need to add or fix logging, invoke the `/log` skill (it's tuned for this codebase's structured logging pattern).

---

## Code style — JavaScript / TypeScript

From `CLAUDE.md`:
- **Node 18+** (20 is default now), Vite build tool
- **React + TypeScript preferred** for new features
- **Tailwind CSS** for styling — no CSS-in-JS, no separate stylesheets except for global tokens
- **No `console.log` left in committed code.** Use a proper logger or delete before committing.
- **`npm run build` must succeed** before any deployment PR is merged.

### Formatting

Prettier + ESLint are configured per repo. Set your editor to format on save.

### Component architecture (gymSite)

`gymSite` uses Atomic Design: `atoms/`, `molecules/`, `organisms/`, `templates/`, `pages/`. Don't put a page-level component in `atoms/`, or vice versa. Read `README.md` before adding components.

---

## Code style — Hugo (bloggingTemplate)

- Content in `content/`. Draft posts go in `drafts/` OR use `draft: true` in frontmatter.
- Never commit generated `public/` — CI builds it.
- Images: extract to `static/images/`, reference with `/images/foo.png`.
- Status filtering happens in `themes/hugo-mag/layouts/partials/header.html` **before** `.Paginate`. If you change how filtering works, do it there or you'll break pagination. Hugo limitation.

---

## Secrets

- **Never in code.** Not in comments. Not in git history.
- **Local dev**: values in `.env`, which is git-ignored. Get values from the password manager.
- **Production**: values as GitHub Actions secrets. Deploy workflow writes them to `.env` on the VPS.
- **New secret?** Add the *name* (with a placeholder) to `.env.example` and add the *value* to GitHub secrets. Two places.
- **If you accidentally commit a secret**: don't just delete the commit. Rotate the secret immediately (revoke the old, generate new) AND scrub git history. Tell Arun.

---

## Environment variables

- `.env.example` in every project. Never let it drift from what the code actually reads.
- When you add a new env var:
  1. Add to `.env.example` with a placeholder AND a `#`-comment describing what it is
  2. Add to GitHub secrets for prod (`gh secret set VAR_NAME`)
  3. Update the deploy workflow to write it into `.env` on the VPS
  4. Reference in code
  5. Document in the project README
- Config uses `pydantic-settings` (Python) or a small `config.ts` (Node). Don't call `os.getenv` scattered across the codebase.

---

## Testing

- Add tests when adding a feature. Add regression tests when fixing a bug.
- Prefer integration tests over mocks (from `CLAUDE.md` — mocking the DB has burned Arun before).
- If you can't reach a feature with a test (e.g. it's a UI flow), verify manually in a browser and document what you tested in the PR.
- CI is the safety net, not the QA process. Verify locally first.

---

## Documentation

After any feature or behavior change:

- Update the project's `README.md` — what it does, how to run it
- Update the project's `PRD.md` — roadmap, scope, features. If the PRD is silent about the feature you just built, it's incomplete.
- New env var → add to `.env.example`
- New CLI command or API endpoint → document in the README
- Version bump → run `/version` (updates `CHANGELOG.json`); the `/version` endpoint returns the live changelog

The README must always reflect the **current** state of the project. Not what it was two months ago.

---

## Specialized skills (Claude Code)

Arun uses Claude Code with a set of skills. If you use Claude Code too, these auto-activate when relevant:

| Skill | When to trigger |
|-------|-----------------|
| `/ui` | React/Tailwind/Jinja2 UI work |
| `/db` | Schema, migrations, queries, indexes |
| `/api` | FastAPI routes, request/response schemas |
| `/perf` | Slow code, profiling, bundle size |
| `/memory` | Memory leaks, heap growth |
| `/log` | Adding/fixing logs |
| `/test` | Writing tests |
| `/debug` | Systematic bug diagnosis |
| `/deploy` | Docker, Compose, GitHub Actions |
| `/docs` | Updating README/PRD |
| `/safe-push` | **Mandatory before every push** |
| `/mobile` | Expo/React Native/EAS |
| `/finance-review` | **Before designing any financial calculation.** Catches gross/net confusion, double-counted debt, deferred interest traps. |
| `/web-integration-check` | After writing any new web page or API integration, before pushing |
| `/version` | After completing a feature or fix batch, before pushing |

If you're not using Claude Code, treat the skill descriptions as checklists of things to double-check yourself.

---

## Security

- All VPS services behind NPM. No container ports exposed directly to the internet.
- Secrets only via env vars / GitHub Secrets. Not committed. Not logged.
- `obsidianRemote` and any admin-facing routes need access control (Authelia / Cloudflare Access / NPM Basic Auth). Never leave admin UIs open.
- **Financial data (`financialEngine`) stays local. No third-party analytics.** This is a hard rule from `CLAUDE.md`. Don't add Sentry / PostHog / etc. to this project.
- Run `bandit` and `pip-audit` (already in CI) for Python. Run `npm audit` for Node.

---

## When in doubt

Ask. The cost of asking is low. The cost of a bad assumption on production infra can be high.
