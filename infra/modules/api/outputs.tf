output "api_endpoint" {
  description = "API Gateway default invoke URL"
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "api_url" {
  description = "Public API URL — custom domain if enabled, otherwise API Gateway default"
  value       = var.create_custom_domain ? "https://${var.api_domain_name}" : aws_apigatewayv2_stage.default.invoke_url
}

output "ingest_function_name" {
  value = aws_lambda_function.ingest.function_name
}

output "customers_function_name" {
  value = aws_lambda_function.customers.function_name
}

output "cert_validation_cname" {
  description = "Add this CNAME at your DNS provider to validate the API ACM certificate"
  value = var.create_custom_domain ? {
    name  = tolist(aws_acm_certificate.api[0].domain_validation_options)[0].resource_record_name
    type  = tolist(aws_acm_certificate.api[0].domain_validation_options)[0].resource_record_type
    value = tolist(aws_acm_certificate.api[0].domain_validation_options)[0].resource_record_value
  } : null
}

output "api_gateway_hostname" {
  description = "CNAME target for the API custom domain"
  value       = var.create_custom_domain ? aws_apigatewayv2_domain_name.custom[0].domain_name_configuration[0].target_domain_name : aws_apigatewayv2_stage.default.invoke_url
}
