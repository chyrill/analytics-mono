variable "aws_region" {
  type    = string
  default = "ap-southeast-2"
}

variable "stage" {
  type        = string
  description = "Deployment stage (e.g. production)"
}

variable "service_name" {
  type    = string
  default = "harvest-analytics"
}

variable "lambda_runtime" {
  type    = string
  default = "nodejs20.x"
}

# ── Networking ─────────────────────────────────────────────────────────────────

variable "vpc_id" {
  type        = string
  description = "Existing VPC ID — analytics subnets and security groups will be created inside it"
}

variable "public_subnet_id" {
  type        = string
  description = "An existing public subnet ID in the VPC — used to place the NAT gateway"
}

variable "subnet_cidr_az_a" {
  type        = string
  description = "CIDR for the new analytics private subnet in ap-southeast-2a"
  default     = "172.31.48.0/24"
}

variable "subnet_cidr_az_b" {
  type        = string
  description = "CIDR for the new analytics private subnet in ap-southeast-2b"
  default     = "172.31.49.0/24"
}

variable "docapp_rds_security_group_id" {
  type        = string
  description = "Security group ID of the doc-app production RDS (postgresqlDB) — an ingress rule will be added to allow analytics Lambda access"
}

# ── Database ───────────────────────────────────────────────────────────────────

variable "db_username" {
  type    = string
  default = "analytics"
}

variable "db_name" {
  type    = string
  default = "analytics"
}

variable "db_password" {
  type      = string
  sensitive = true
}

# ── App secrets ────────────────────────────────────────────────────────────────

variable "zoho_client_id" {
  type    = string
  default = ""
}

variable "zoho_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}

variable "zoho_refresh_token" {
  type      = string
  sensitive = true
  default   = ""
}

variable "saleor_api_token" {
  type      = string
  sensitive = true
  default   = ""
}

variable "docapp_database_url" {
  type      = string
  sensitive = true
  default   = ""
}

# ── Domains ────────────────────────────────────────────────────────────────────

variable "api_domain_name" {
  type        = string
  description = "Custom domain for the API (e.g. analytics-api.zenith.clinic)"
  default     = ""
}

variable "web_domain_name" {
  type        = string
  description = "Custom domain for the web dashboard (e.g. analytics.zenith.clinic)"
  default     = ""
}

variable "hosted_zone_id" {
  type        = string
  description = "Route53 hosted zone ID — only required when create_route53_records = true"
  default     = ""
}

variable "allowed_origins" {
  type        = string
  description = "Comma-separated allowed CORS origins for the API"
  default     = ""
}

variable "create_custom_domain" {
  type    = bool
  default = true
}

variable "create_route53_records" {
  type        = bool
  default     = false
  description = "Set to true when the domain is managed in Route53. False = output DNS records to add manually."
}

variable "enable_frontend" {
  type    = bool
  default = true
}

# ── Worker schedules ───────────────────────────────────────────────────────────

variable "saleor_schedule" {
  type    = string
  default = "rate(1 hour)"
}

variable "zoho_schedule" {
  type    = string
  default = "rate(2 hours)"
}

variable "docapp_schedule" {
  type    = string
  default = "rate(1 hour)"
}
