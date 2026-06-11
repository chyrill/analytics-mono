output "bucket_name" {
  value = aws_s3_bucket.web.id
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.web.id
}

output "cloudfront_url" {
  value = "https://${aws_cloudfront_distribution.web.domain_name}"
}

output "web_url" {
  value = var.create_custom_domain ? "https://${var.domain_name}" : "https://${aws_cloudfront_distribution.web.domain_name}"
}

output "cloudfront_hostname" {
  description = "CNAME target for the custom domain (add as CNAME at your DNS provider)"
  value       = aws_cloudfront_distribution.web.domain_name
}

output "cert_validation_cname" {
  description = "Add this CNAME at your DNS provider to validate the ACM certificate"
  value = var.create_custom_domain ? {
    name  = tolist(aws_acm_certificate.web[0].domain_validation_options)[0].resource_record_name
    type  = tolist(aws_acm_certificate.web[0].domain_validation_options)[0].resource_record_type
    value = tolist(aws_acm_certificate.web[0].domain_validation_options)[0].resource_record_value
  } : null
}
