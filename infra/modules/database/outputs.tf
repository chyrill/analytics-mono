output "endpoint" {
  description = "RDS instance endpoint (host:port) — use as DATABASE_URL host"
  value       = aws_db_instance.analytics.endpoint
  sensitive   = true
}

output "address" {
  description = "RDS hostname only (without port)"
  value       = aws_db_instance.analytics.address
  sensitive   = true
}

output "port" {
  value = aws_db_instance.analytics.port
}

output "db_name" {
  value = aws_db_instance.analytics.db_name
}

output "instance_id" {
  value = aws_db_instance.analytics.identifier
}
