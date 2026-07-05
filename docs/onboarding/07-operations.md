# 07 — Operations Runbook

Day-to-day and emergency procedures. Keep this open in a tab.

Every command assumes you've set up `~/.ssh/config` with a `Host vps` block (see `01-macbook-setup.md`).

---

## SSH into the VPS

```bash
ssh vps
```

Once in, you're at `~` for the deploy user. Everything project-related is under `/opt/`.

```bash
cd /opt          # ls to see all project dirs
cd /opt/financialEngine
ls -la
```

---

## View running containers

```bash
ssh vps 'docker ps'
```

You want to see all your projects + `nginx-proxy-manager` + `postgres` (or however DB is deployed) all with STATUS = `Up (healthy)`.

Also useful:

```bash
ssh vps 'docker ps -a'   # includes stopped containers
ssh vps 'docker stats --no-stream'   # live CPU/RAM per container
```

---

## View container logs

```bash
ssh vps 'docker logs --tail 100 -f <container_name>'
```

Or, from the project directory:

```bash
ssh vps 'cd /opt/<project> && docker compose logs --tail 100 -f <service>'
```

The `-f` follows (tails). Ctrl-C to exit.

For structured Python logs, pipe through `jq`:

```bash
ssh vps 'docker logs --tail 500 <container>' | jq -c 'select(.level=="ERROR")'
```

---

## Restart a service

```bash
ssh vps 'cd /opt/<project> && docker compose restart <service>'
```

Or restart everything in that project:

```bash
ssh vps 'cd /opt/<project> && docker compose restart'
```

Full down + up (rebuilds if you use `--build`):

```bash
ssh vps 'cd /opt/<project> && docker compose down && docker compose up -d'
```

**⚠️ Never `docker compose down -v`** — the `-v` deletes named volumes → data loss.

---

## Deploy manually (skip CI)

Sometimes you need to redeploy without a code change (e.g. after rotating a secret in `.env`):

```bash
ssh vps 'cd /opt/<project> && docker compose pull && docker compose up -d'
```

Or trigger the workflow manually via GitHub UI or CLI:

```bash
gh workflow run deploy.yml --repo <org>/<project>
```

---

## Rollback

**Fast rollback on the VPS** (temporary — the next `main` push will re-apply the bad code):

```bash
ssh vps
cd /opt/<project>
git log --oneline -10                    # find the last good commit
git checkout <good-sha>
docker compose down && docker compose up -d --build
```

**Proper rollback via git** (permanent):

```bash
# on your Mac:
cd <project>
git revert <bad-sha>
# then /safe-push
```

Always follow the fast rollback with a proper git revert. Otherwise the next CI deploy re-breaks prod.

---

## Check disk space

The VPS fills up over time — Docker images, logs, DB WAL, Obsidian sync data.

```bash
ssh vps 'df -h'                          # overall disk
ssh vps 'du -sh /opt/* | sort -h'        # per project
ssh vps 'docker system df'               # docker overhead
```

If Docker is bloated:

```bash
ssh vps 'docker system prune -f'         # removes stopped containers, dangling images
ssh vps 'docker image prune -a -f'       # removes ALL unused images (aggressive)
```

Never `docker volume prune` unless you know exactly what you're removing.

---

## Check CPU / RAM

```bash
ssh vps 'htop'                           # interactive (q to quit)
ssh vps 'free -h'                        # RAM snapshot
ssh vps 'docker stats --no-stream'       # per-container
```

If a container is thrashing memory, invoke the `/memory` skill (or its checklist) on that project.

---

## SSL certificates

NPM handles Let's Encrypt renewals automatically. To check:

1. Log into NPM at `https://<vps>:81`
2. Hosts → Proxy Hosts → each host shows SSL status
3. If a cert is expiring or failed to renew: click the host → SSL tab → "Force renew"

If Let's Encrypt is rate-limiting you (5 certs/week per domain), wait or use a wildcard.

---

## Adding a new subdomain

1. **Registrar**: log into the domain registrar (Cloudflare / Namecheap / …). Add an A record: `<sub>.yourdomain.com` → `<VPS_IP>`. TTL 300.
2. **NPM**: at `https://<vps>:81` → Hosts → Proxy Hosts → Add Proxy Host
   - Domain Names: `<sub>.yourdomain.com`
   - Scheme: `http`
   - Forward Hostname/IP: the container name (Docker DNS resolves it)
   - Forward Port: the container's internal port
   - Enable **Block Common Exploits**
   - Enable **Websockets Support** if the service needs them (e.g. `webgpu-chess-replay`, `obsidianRemote`)
   - **SSL tab**: request new Let's Encrypt cert, agree to terms, "Force SSL", enable HTTP/2
3. Test: `curl -I https://<sub>.yourdomain.com` — expect `200` or `301`.

---

## Database backups

For each Postgres DB (per project or shared):

```bash
ssh vps 'docker exec <postgres_container> pg_dump -U <user> -d <db> | gzip > /backups/<db>-$(date +%F).sql.gz'
```

**Check with Arun**: is there already a cron / systemd timer doing this? If so, where do backups live and how far back? If not, we need to set one up — this is a P0.

Recommended: nightly `pg_dump` + weekly rsync of `/backups` to another location.

### Restore

```bash
gunzip -c /backups/<db>-YYYY-MM-DD.sql.gz | ssh vps 'docker exec -i <postgres_container> psql -U <user> -d <db>'
```

Practice this in a sandbox DB before you ever need it for real.

---

## Health checks

Most FastAPI projects expose `/health` (or should). Check them all:

```bash
for svc in financialengine.<domain> keystone.<domain> personalassistant.<domain>; do
  echo "$svc:"
  curl -sf "https://$svc/health" || echo "  DOWN"
done
```

Save this as a script — run it after every deploy and once a day as a habit.

For `/version` endpoints (from the `/version` skill):

```bash
curl -s https://<svc>/version | jq .
```

Shows the currently deployed version — quick sanity check that the deploy actually shipped.

---

## Docker network

Everything runs on `npm_default`. If a container can't reach another (or NPM can't route to it), check:

```bash
ssh vps 'docker network inspect npm_default | jq ".[] .Containers | keys"'
```

Expect all your service container names to be listed. If one is missing, its `docker-compose.yml` is missing the `networks:` block or it's on the wrong network.

If the network itself is missing:

```bash
ssh vps 'docker network create npm_default'
```

Then restart the affected containers.

---

## What to do when prod is down

1. **Stay calm**. Most outages are 5–15 minute fixes.
2. `curl -I https://<url>` — is the server responding at all? (Reach NPM at least.)
3. `ssh vps 'docker ps' | grep <project>` — is the container running?
4. If not running: `ssh vps 'cd /opt/<project> && docker compose logs --tail 200'` — read the crash reason
5. If the container is running but returning 5xx: read the app logs (same command, but `<service>` name), look for the exception
6. If you can identify a recent bad deploy: **rollback** (see above)
7. If you can't figure it out in 15 minutes: message Arun. Don't spiral solo.

Always add a post-mortem note (in a doc / comment / commit message) so the same failure is easier to diagnose next time.

---

## Emergency contacts

- **Arun**: (Slack / email — you have this)
- **Hostinger support**: for blog/Hostinger-hosted issues, contact via Hostinger dashboard
- **Cloudflare / registrar support**: DNS / SSL edge issues
- **Apple Developer / Google Play support**: mobile-store issues

---

## The rule you'll break once and then never again

**Do NOT `docker compose down -v`.**

The `-v` flag deletes the named volumes. On a Postgres container, that means the entire database. On CouchDB, the entire Obsidian sync history. On any DB service, all data.

If you need to blow away containers and images but keep data: `docker compose down` (no `-v`), then `docker image prune`.

If you need to blow away data too: think again. Then ask Arun. Then, if approved, use `-v`.
