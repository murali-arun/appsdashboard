# Welcome — Onboarding Guide

Hi! You're taking over Arun's personal projects portfolio — 11 active projects, all deployed to one VPS (plus mobile app stores and Shopify). This folder is your handbook. It's written to be read top-to-bottom in your first week, then used as a reference forever after.

## Who this is for

You. A mid-level engineer with a MacBook, comfortable with git and web dev, new to this stack. By the end of Week 1 you should be able to:

- Run any project locally on your Mac
- Push a small fix and watch it deploy to production
- SSH into the VPS and read logs
- Know who to ask (or where to look) when something breaks

By the end of Month 1 you should be able to develop, ship, and operate any project independently.

## Reading order

Do them in this order — each doc assumes you've read the ones before it.

| # | Doc | What it covers | Time |
|---|-----|----------------|------|
| 1 | [`01-macbook-setup.md`](01-macbook-setup.md) | Install every tool you need on your Mac | 1–2 hrs |
| 2 | [`02-access-checklist.md`](02-access-checklist.md) | Every credential/account Arun needs to give you. Work through this WITH him | 1 hr |
| 3 | [`03-projects.md`](03-projects.md) | Fact sheet for all 11 projects — stack, run command, deploy target, live URL | Reference |
| 4 | [`04-local-development.md`](04-local-development.md) | How to clone, run, and hack on each project type | Reference |
| 5 | [`05-deployment.md`](05-deployment.md) | The deploy pipeline: VPS, mobile, Shopify, blog | Read once carefully |
| 6 | [`06-conventions.md`](06-conventions.md) | Code style, git flow, logging, secrets rules | Read once |
| 7 | [`07-operations.md`](07-operations.md) | Runbook: view logs, restart services, rollback, add a domain | Reference |
| 8 | [`08-troubleshooting.md`](08-troubleshooting.md) | Common issues + fixes | Reference |

## The one-paragraph overview

Every deployable project follows the **same** deploy pattern: push to `main` → GitHub Actions runs tests → SSH into the VPS → `docker compose pull && up -d`. Nginx Proxy Manager (running on the VPS) handles SSL and routes traffic to the right container. Mobile apps (`chess-mobile`, `keystone` mobile) use EAS Build to ship to TestFlight / Play Store. The blog (`bloggingTemplate`) is Hugo, deployed via FTP to Hostinger. Shopify theme (`shopify-theme-v3`) pushes via Shopify CLI. That's the whole picture.

## The absolute rules (read `06-conventions.md` for the rest)

1. **Never `git push` directly.** Use `/safe-push` — it runs tests, security checks, watches CI, and smoke-tests the live site. This has saved production more than once.
2. **Never commit `.env` files.** Every project has a `.env.example` you copy and fill in locally.
3. **Never edit VPS files by hand.** All changes go through git → CI → deploy. If you SSH in to fix something urgently, the next deploy will overwrite it. Fix it in git first.
4. **Ask before destructive ops on shared infra.** VPS operations, DNS changes, and anything touching Shopify's live theme — confirm with Arun the first ~10 times.

## When you're stuck

1. Search this docs folder (⌘F is your friend).
2. Read the project's own `README.md` and `PRD.md`.
3. Check `08-troubleshooting.md`.
4. Look at recent commits — `git log --oneline -20` often shows what changed last.
5. Ask Arun. No question is too small in the first month.

Welcome aboard.
