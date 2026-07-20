output "api_endpoint" {
  description = "API Gateway default endpoint URL"
  value       = module.api.api_endpoint
}

output "api_url" {
  description = "Public API URL (custom domain if enabled, otherwise API Gateway default)"
  value       = module.api.api_url
}

output "migration_function_name" {
  description = "Name of the migration Lambda function"
  value       = module.migration.function_name
}

output "backfill_function_name" {
  description = "Name of the backfill Lambda function — invoke manually to (re)compute supply_tracking_history"
  value       = module.backfill.function_name
}

output "web_bucket" {
  description = "S3 bucket name for the web dashboard"
  value       = var.enable_frontend ? module.frontend[0].bucket_name : ""
}

output "web_cloudfront_id" {
  description = "CloudFront distribution ID for the web dashboard"
  value       = var.enable_frontend ? module.frontend[0].cloudfront_distribution_id : ""
}

output "web_url" {
  description = "Public URL of the web dashboard"
  value       = var.enable_frontend ? module.frontend[0].web_url : ""
}

output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint (host:port)"
  value       = module.database.endpoint
  sensitive   = true
}

# ── DNS records to configure at external DNS provider ─────────────────────────

output "api_cert_validation_cname" {
  description = "CNAME to add at your DNS provider to validate the API ACM certificate"
  value       = module.api.cert_validation_cname
}

output "api_gateway_hostname" {
  description = "CNAME target for the API custom domain"
  value       = module.api.api_gateway_hostname
}

output "web_cert_validation_cname" {
  description = "CNAME to add at your DNS provider to validate the frontend ACM certificate"
  value       = var.enable_frontend ? module.frontend[0].cert_validation_cname : null
}

output "web_cloudfront_hostname" {
  description = "CNAME target for the frontend custom domain"
  value       = var.enable_frontend ? module.frontend[0].cloudfront_hostname : null
}
