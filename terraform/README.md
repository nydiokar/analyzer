# Terraform (optional — not the current deploy path)

This provisions the backend on **GCP Cloud Run**, with secrets in Secret
Manager and the image in Artifact Registry. It does **not** provision
Postgres or Redis — `variables.tf`'s `secret_env_vars` assumes
`DATABASE_URL` and `REDIS_PASSWORD` already exist as secrets, sourced from a
Cloud SQL instance and a Memorystore instance you'd create separately.

**This is not what the server currently runs.** The current deploy is a
self-hosted Docker Compose stack (app + Postgres + Redis as containers) — see
`deployment/README.md`. That path is free (aside from server cost) and keeps
everything on hardware you control.

## Why this exists anyway

Kept in the repo in case a move to GCP is ever revisited. Terraform CLI
itself is free and open-source, but everything it provisions here — Cloud
Run, Secret Manager, Artifact Registry, Cloud SQL, Memorystore, a GCS state
bucket — is billed GCP infrastructure. There's no local/free way to run this
specific config; Cloud Run has no local emulator that matches production
behavior closely enough to be worth it.

## What it would cost / require, if used

- A GCP project with billing enabled
- A GCS bucket for Terraform state (`gsutil mb` + versioning, see comment in
  `main.tf`)
- Cloud SQL (Postgres) and Memorystore (Redis) instances — **not created by
  this config**, provisioned separately, then their connection secrets added
  to Secret Manager under the names listed in `secret_env_vars`
- Artifact Registry repo with the built image pushed to it (immutable tag,
  never `latest` — see the validation in `variables.tf`)
- Ongoing Cloud Run cost: `min_instances = 1` is required (BullMQ workers run
  outside request scope and would be killed by scale-to-zero), so this is
  never a $0 idle service — you're paying for at least one warm instance
  continuously

## If this path is ever picked back up

1. Provision Cloud SQL + Memorystore by hand or extend `main.tf` to do it
2. Create the GCS state bucket, update `bucket` in the `backend "gcs"` block
3. Push secrets to Secret Manager under the names in `secret_env_vars`
4. Build and push the image to Artifact Registry with an immutable tag
5. `terraform init && terraform plan && terraform apply`
6. Run the migration job once: `gcloud run jobs execute sova-backend-migrate --region <region> --wait`

Not attempted in this pass — the physical/self-hosted server is the actual
target, so this stays parked rather than half-built.
