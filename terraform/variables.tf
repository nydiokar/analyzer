variable "project_id" {
  type        = string
  description = "GCP project ID."
}

variable "region" {
  type        = string
  description = "Region for Cloud Run, Artifact Registry, and the VPC connector."
  default     = "europe-west1"
}

variable "image_tag" {
  type        = string
  description = "Image tag to deploy. Use an immutable version tag, never 'latest' — Terraform cannot detect a change when the tag is unchanged, producing deploys that silently do nothing."

  validation {
    condition     = var.image_tag != "latest"
    error_message = "Refusing 'latest'. Use an immutable tag such as v1 or a commit SHA."
  }
}

variable "service_name" {
  type        = string
  description = "Cloud Run service name."
  default     = "sova-backend"
}

variable "repository_id" {
  type        = string
  description = "Artifact Registry repository holding the backend image."
  default     = "sova"
}

# --- Capacity -------------------------------------------------------------
# The V8 old-space ceiling is derived from container_memory below rather than
# baked into the image, so the two cannot drift apart. See locals.node_options.

variable "container_memory_mib" {
  type        = number
  description = "Container memory limit in MiB. Cloud Run requires >= 4 CPU for 8Gi."
  default     = 8192
}

variable "container_cpu" {
  type        = string
  description = "vCPU allocation."
  default     = "4"
}

variable "heap_fraction" {
  type        = number
  description = "Fraction of container memory given to the V8 old-space heap. The remainder covers new-space, native allocations (sharp, bcrypt, better-sqlite3), off-heap Buffers, and the runtime itself. Treat as a starting point to be tuned against observed utilization, not a measured value."
  default     = 0.75
}

variable "min_instances" {
  type        = number
  description = "Minimum instances. Must be >= 1: scale-to-zero terminates in-flight BullMQ jobs."
  default     = 1

  validation {
    condition     = var.min_instances >= 1
    error_message = "min_instances must be at least 1 or background queue workers will be killed."
  }
}

variable "max_instances" {
  type        = number
  description = "Maximum instances."
  default     = 3
}

# --- Configuration --------------------------------------------------------

variable "secret_env_vars" {
  type        = list(string)
  description = "Env vars sourced from Secret Manager. Each name must match an existing secret ID. Create the secrets before applying; this config grants access but does not create them or hold their values, keeping plaintext out of Terraform state."

  default = [
    "DATABASE_URL",
    "REDIS_PASSWORD",
    "HELIUS_API_KEY",
    "JWT_SECRET",
  ]
}

variable "plain_env_vars" {
  type        = map(string)
  description = "Non-secret configuration passed as plain env vars. Never put credentials here — these are readable in Terraform state and in the Cloud Run console."

  default = {
    NODE_ENV = "production"
  }
}

variable "vpc_connector" {
  type        = string
  description = "Serverless VPC Access connector ID, required to reach Cloud SQL and Memorystore on private IPs. Null disables VPC egress."
  default     = null
}
