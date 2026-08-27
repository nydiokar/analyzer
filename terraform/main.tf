terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # Remote state. Create the bucket with versioning enabled before init:
  #   gsutil mb -l europe-west1 gs://YOUR_TF_STATE_BUCKET
  #   gsutil versioning set on gs://YOUR_TF_STATE_BUCKET
  backend "gcs" {
    bucket = "YOUR_TF_STATE_BUCKET"
    prefix = "sova/backend"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  image = "${var.region}-docker.pkg.dev/${var.project_id}/${var.repository_id}/backend:${var.image_tag}"

  # V8 old-space ceiling derived from the container limit so the two move
  # together. The ceiling exists to make V8 abort with a JS heap error before
  # the kernel OOM-kills the container, which would leave no diagnostic.
  heap_mib     = floor(var.container_memory_mib * var.heap_fraction)
  node_options = "--max-old-space-size=${local.heap_mib}"
}

# --- Runtime identity -----------------------------------------------------
# Dedicated least-privilege account rather than the default compute SA.

resource "google_service_account" "backend" {
  account_id   = var.service_name
  display_name = "Sova Intel backend runtime"
}

# Read access to each configured secret, granted per-secret rather than
# project-wide.
resource "google_secret_manager_secret_iam_member" "backend_accessor" {
  for_each = toset(var.secret_env_vars)

  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.backend.email}"
}

# --- Service --------------------------------------------------------------

resource "google_cloud_run_v2_service" "backend" {
  name     = var.service_name
  location = var.region

  # Public edge; authentication is handled in-app by JWT and API keys.
  ingress = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.backend.email

    # BullMQ workers run outside request scope, so instances must stay warm.
    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    # Ceiling for long-running analysis requests.
    timeout = "900s"

    max_instance_request_concurrency = 80

    dynamic "vpc_access" {
      for_each = var.vpc_connector == null ? [] : [var.vpc_connector]
      content {
        connector = vpc_access.value
        egress    = "PRIVATE_RANGES_ONLY"
      }
    }

    containers {
      image = local.image

      resources {
        limits = {
          cpu    = var.container_cpu
          memory = "${var.container_memory_mib}Mi"
        }

        # CPU must stay allocated between requests or queue processors are
        # throttled to near-zero and stall mid-job.
        cpu_idle          = false
        startup_cpu_boost = true
      }

      ports {
        name           = "http1"
        container_port = 3001
      }

      env {
        name  = "NODE_OPTIONS"
        value = local.node_options
      }

      dynamic "env" {
        for_each = var.plain_env_vars
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = toset(var.secret_env_vars)
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }

      # Nest bootstraps Prisma, Redis, and queue registration before listening,
      # so the startup budget is deliberately generous: 30 * 10s.
      startup_probe {
        initial_delay_seconds = 15
        period_seconds        = 10
        timeout_seconds       = 5
        failure_threshold     = 30

        tcp_socket {
          port = 3001
        }
      }

      liveness_probe {
        initial_delay_seconds = 60
        period_seconds        = 30
        timeout_seconds       = 5
        failure_threshold     = 3

        http_get {
          path = "/api/v1/health"
          port = 3001
        }
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  depends_on = [google_secret_manager_secret_iam_member.backend_accessor]
}

# --- Migrations -----------------------------------------------------------
# Run as a one-off job, never on service startup: with min_instances >= 1 and
# autoscaling, concurrent instances would race the same migration.
#
#   gcloud run jobs execute sova-migrate --region <region> --wait

resource "google_cloud_run_v2_job" "migrate" {
  name     = "${var.service_name}-migrate"
  location = var.region

  template {
    template {
      service_account = google_service_account.backend.email
      max_retries     = 0
      timeout         = "1800s"

      dynamic "vpc_access" {
        for_each = var.vpc_connector == null ? [] : [var.vpc_connector]
        content {
          connector = vpc_access.value
          egress    = "PRIVATE_RANGES_ONLY"
        }
      }

      containers {
        image = local.image

        # The prisma CLI is a devDependency and is pruned from the runtime
        # image, so the migration engine is invoked through @prisma/client's
        # bundled CLI entrypoint instead.
        command = ["node"]
        args    = ["node_modules/prisma/build/index.js", "migrate", "deploy"]

        resources {
          limits = {
            cpu    = "1"
            memory = "2Gi"
          }
        }

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = "DATABASE_URL"
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [google_secret_manager_secret_iam_member.backend_accessor]
}

# --- Outputs --------------------------------------------------------------

output "service_url" {
  value       = google_cloud_run_v2_service.backend.uri
  description = "Public URL of the backend service."
}

output "runtime_service_account" {
  value       = google_service_account.backend.email
  description = "Grant this account access to Cloud SQL, Memorystore, and any new secrets."
}

output "node_options" {
  value       = local.node_options
  description = "Heap ceiling derived from container_memory_mib * heap_fraction."
}
