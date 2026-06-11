output "function_name" {
  description = "Migration Lambda function name — used by CI to invoke after each deploy"
  value       = aws_lambda_function.migration.function_name
}

output "function_arn" {
  value = aws_lambda_function.migration.arn
}
