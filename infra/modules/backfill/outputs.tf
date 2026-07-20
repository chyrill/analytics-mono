output "function_name" {
  description = "Backfill Lambda function name — invoke manually to (re)compute supply_tracking_history"
  value       = aws_lambda_function.backfill.function_name
}

output "function_arn" {
  value = aws_lambda_function.backfill.arn
}
