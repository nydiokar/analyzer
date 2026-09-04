# Deployment

This is the single canonical deployment doc. If another file in this repo
says something different about how to deploy, this file wins — flag the
other one for a fix.

Production is a single Docker Compose stack: **app + Postgres + Redis**.
GitHub Actions builds the app image once from the repo's `Dockerfile`, pushes
it to GHCR, and the VPS only pulls the selected image. No Node/pnpm/PM2 on the
host — only Docker. The dashboard (`dashboard/`) is a separate deploy entirely, on
Vercel — see "Frontend (Vercel) — connecting it to this backend" below.

## Choose a production deployment mode

| Mode | After the one-time setup |
|---|---|
| Initial server setup | Configure `.env`, authenticate Docker to GHCR if required, then deploy the first full SHA with `deploy.sh`. |
| Automatic | GitHub Actions publishes the SHA; the server timer detects the successful `main` workflow and deploys it. No per-release server command. |
| Manual | GitHub Actions publishes the SHA; an operator runs `deploy.sh <full-git-sha>` when intentionally releasing or rolling back. |

All three modes use the same immutable image and the same migration, Compose,
health-check, and rollback logic. None runs `docker compose build` on the
server.

## Quick Start (new server, from scratch)

```bash
git clone <repo-url> analyzer
cd analyzer
cp .env.example .env
# Fill in .env — see "Required .env values" below
# If the GHCR package is private, log in once: sudo docker login ghcr.io
./deployment/scripts/deploy.sh <40-character-git-sha>
```

The deploy script brings up Postgres and Redis, waits for both to report
healthy, runs Prisma migrations from the selected image, then starts the app.
`docker compose` shows all three long-running containers (`migrate` runs once
and exits 0); the app is on `http://127.0.0.1:3001`.

## Deploy an image

```bash
./deployment/scripts/deploy.sh <40-character-git-sha>
```

The script pulls the exact SHA-tagged image, runs migrations from that same
image, starts the stack, and verifies backend health. It never selects
`latest` implicitly. Set `APP_IMAGE_REPO` when deploying a different GHCR
package.

## Required `.env` values

No default — `docker compose up` will fail or silently misconfigure the app
without these:

| Variable | Purpose |
|---|---|
| `HELIUS_API_KEY` | Solana chain data provider |
| `JWT_SECRET` | Auth token signing |
| `PASSWORD_PEPPER` | Password hashing |
| `POSTGRES_USER` | Postgres container + app DB connection |
| `POSTGRES_PASSWORD` | Postgres container + app DB connection |
| `POSTGRES_DB` | Postgres container + app DB connection |
| `REDIS_PASSWORD` | Redis container + BullMQ connection |
| `FRONTEND_URL` | CORS allowlist — see Vercel section below |

`.env.example` in the repo root does not yet list the Postgres/memory
variables below — add these manually if they're missing:

```
POSTGRES_USER=sova_app
POSTGRES_PASSWORD=<strong-random-value>
POSTGRES_DB=sova_analyzer
REDIS_PASSWORD=<strong-random-value>
FRONTEND_URL=https://your-dashboard.vercel.app

# Optional — resource limits, see "Memory & CPU limits" below
BACKEND_MEMORY_MB=4096
BACKEND_HEAP_MB=3072
BACKEND_CPUS=2.0
```

`DATABASE_URL`, `REDIS_HOST`, and `REDIS_PORT` are set automatically by
`docker-compose.yml` (containers reach Postgres/Redis by service name on the
Docker network) — do not set these in `.env`, they're overridden.

## Memory & CPU limits

Set directly in `docker-compose.yml` via env vars, no orchestrator needed:

- `BACKEND_MEMORY_MB` (default 4096) — hard container memory limit (`mem_limit`)
- `BACKEND_HEAP_MB` (default 3072) — V8 `--max-old-space-size`, passed as `NODE_OPTIONS`
- `BACKEND_CPUS` (default 2.0) — CPU allocation

Keep `BACKEND_HEAP_MB` below `BACKEND_MEMORY_MB` (roughly 75%, same ratio as
`terraform/variables.tf`'s `heap_fraction`) — the gap covers native
allocations (sharp, bcrypt, better-sqlite3) and off-heap buffers, so V8 hits
its own heap ceiling and logs a diagnostic before the kernel OOM-kills the
container.

This replaces PM2's `max_memory_restart` for anything running in this
Docker stack. `ecosystem.config.js` / `ecosystem.backend.config.js` still
apply only to the Telegram bot and analysis bot, which remain on PM2 — see
"What's not containerized yet" below.

## Frontend (Vercel) — connecting it to this backend

The dashboard deploys independently on Vercel (git push → auto-deploy),
unrelated to this Docker stack. Two env vars link the two sides:

- **Backend `.env`: `FRONTEND_URL`** — comma-separated list of allowed
  origins for CORS (`src/main.ts`). Without this set, the backend falls
  back to allowing all origins with a warning logged at boot — fine for
  local dev, not for production. Set it to your Vercel domain(s), e.g.
  `https://app.sova-intel.com,https://sova-intel.vercel.app`.
- **Vercel project env: `NEXT_PUBLIC_API_URL`** — where the dashboard sends
  API requests. Point it at wherever this backend is actually reachable:
  - Directly at the server: `http://<server-ip>:3001` (fine for testing,
    not for production — no TLS)
  - Through Nginx once set up (see below): `https://api.sova-intel.com`

Set both together — a `FRONTEND_URL` update on the backend and a
`NEXT_PUBLIC_API_URL` update on Vercel are two separate deploys on two
separate platforms; neither side detects the other changed.

## Nginx / TLS (optional, public-facing deploys)

Fronts whatever is listening on `127.0.0.1:3001` — true whether the app
runs bare or in the `app` container, since Compose publishes that port to
the host loopback either way.

```bash
sudo bash deployment/scripts/03-nginx.sh --domain api.sova-intel.com --http-only
sudo certbot --nginx -d api.sova-intel.com
sudo bash deployment/scripts/03-nginx.sh --domain api.sova-intel.com --enable-tls
```

Validate:

```bash
curl -i https://api.sova-intel.com/api/v1/health
```

Then update Vercel's `NEXT_PUBLIC_API_URL` to `https://api.sova-intel.com`.

## Observability (optional)

Prometheus + Grafana run separately:

```bash
cd ops/observability
docker compose --env-file ../../.env up -d
```

They scrape the app at `127.0.0.1:3001/api/v1/metrics`. See
`ops/observability/BACKEND_MEMORY_RUNBOOK.md` for dashboard details.

Grafana: `http://127.0.0.1:3000` (SSH tunnel from a desktop:
`ssh -L 3000:127.0.0.1:3000 <user>@<server_ip>`)

Reset admin password:
```bash
docker exec -it sova-grafana grafana cli admin reset-admin-password 'NEW_STRONG_PASSWORD'
```

## Baseline health check (existing server)

```bash
APP_IMAGE="$(docker inspect --format '{{.Config.Image}}' sova-backend)" docker compose ps
curl -fsS http://127.0.0.1:3001/api/v1/health
```

## Production maintenance scripts

Database and Redis maintenance commands run through the Docker `admin` profile
and use the same environment and network as the app:

```bash
pnpm user:manage list
pnpm apikey:manage --help
pnpm clear:queues
```

For a new maintenance script, use the generic runner:

```bash
pnpm admin:run scripts/my-maintenance-script.ts --help
```

The admin profile uses the currently running backend image, so it does not
build or export a second application image:

```bash
APP_IMAGE="$(docker inspect --format '{{.Config.Image}}' sova-backend)" \
  docker compose --profile admin run --rm admin scripts/manage-users.ts list
```

The admin container starts only for the command and is removed automatically;
it is excluded from normal `docker compose up` startup.

## Rollback

```bash
./deployment/scripts/deploy.sh <previous-40-character-git-sha>
```

The previous image remains in GHCR and is deployable without rebuilding source
on the VPS. Prisma migrations are forward-only by design — a schema rollback
needs a new down-migration, not an image swap.

- **Nginx**: restore backup from `/etc/nginx/nginx.conf.bak.<timestamp>`,
  then `sudo nginx -t && sudo systemctl reload nginx`
- **Observability**: `bash deployment/scripts/04-observability.sh down`

## Automatic deployment without SSH

GitHub-hosted runners do not need SSH access to the server. Install the
pull-based systemd units from `deployment/systemd/` on the server. The checked
in unit is configured for `/home/cifran/dev/analyzer`; edit its `ROOT_DIR` if
the production checkout uses a different path.
The unit runs locally under systemd so it can use the existing Docker daemon;
GitHub still has no access to the server.

Example one-time server configuration:

```bash
sudo install -m 0644 deployment/systemd/analyzer-deploy.service /etc/systemd/system/
sudo install -m 0644 deployment/systemd/analyzer-deploy.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now analyzer-deploy.timer
```

If the GHCR package is private, authenticate the server's Docker daemon once:

```bash
sudo docker login ghcr.io --username <github-username>
```

Use a token with only `read:packages`; Docker stores the credential locally.
If the GitHub repository is private, additionally create
`/etc/analyzer-deploy.env` with a read-only Actions API token:

```bash
GITHUB_TOKEN=<read-only-github-actions-api-token>
```

The timer polls every two minutes,
deploys only the latest successful
`main` workflow SHA, and records it under `/var/lib/analyzer-deploy/current-sha`.
The publish job uses the built-in `GITHUB_TOKEN` with only `contents: read` and
`packages: write`; it has no SSH or server credentials.

## Automated-deploy gates (CI / LLM-driven deploys)

1. Do not run `docker compose up` before `.env` has all required keys filled.
2. Do not enable TLS nginx config before certificate files exist.
3. Run post-change health checks after every phase.
4. Abort on first failed gate; do not continue in degraded state.

Minimal verification set:
- `APP_IMAGE="$(docker inspect --format '{{.Config.Image}}' sova-backend)" docker compose ps` shows `postgres`, `redis`, `app` all healthy/running
  (`migrate` exits 0 and is not expected to stay running)
- `curl -fsS http://127.0.0.1:3001/api/v1/health`
- `curl -fsS https://api.sova-intel.com/api/v1/health` (if public)
- `curl -fsS http://127.0.0.1:9090/-/healthy` (if observability is up)

Drift checks:
- pinned image versions must stay explicit (no `latest` as the app deployment
  identity; `postgres:16` / `redis:latest` are the
  local base images and are fine as-is)
- nginx config must preserve rate limit zone + websocket proxy headers
- `docker-compose.yml` service names (`app`, `postgres`, `redis`, `migrate`)
  must not be renamed without updating this file

## What's not containerized yet

- **Telegram bot** (`sova-tg-bot`) and **analysis bot** (`wallet-analyzer`)
  — still run via PM2 (`ecosystem.config.js`). The same image could run
  them with a different entrypoint later if wanted.
- **Remote VM provisioning** — `terraform/` provisions a *Cloud Run*
  service (GCP-managed, no server to SSH into), which doesn't fit a
  self-hosted/physical-server target. Kept in the repo as an optional path
  for a possible future GCP move; not part of this server's deploy flow.
  See `terraform/README.md` for what it would actually cost and require.

## Superseded

The old 4-phase bootstrap (`deployment/scripts/01-bootstrap.sh` +
`02-deploy.sh` — host Node/pnpm/PM2 install, manual `docker run` for
Postgres, manual `.env` round-trip between scripts) and the separate
`deployment/RUNBOOK.md` / `deployment/LLM_GUIDANCE.md` files are superseded
by this document and `deployment/scripts/deploy.sh`. The old scripts are kept
for reference but are not needed on a fresh server.
