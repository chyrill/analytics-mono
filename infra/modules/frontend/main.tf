terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      version               = "~> 5.80"
      configuration_aliases = [aws.us_east_1]
    }
  }
}

# ── S3 Bucket ──────────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "web" {
  bucket = "${var.service_name}-${var.stage}-web"

  tags = { Stage = var.stage, Service = var.service_name }
}

resource "aws_s3_bucket_versioning" "web" {
  bucket = aws_s3_bucket.web.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ── CloudFront Origin Access Control ──────────────────────────────────────────

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.service_name}-${var.stage}-oac"
  description                       = "OAC for ${var.service_name} ${var.stage} web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = data.aws_iam_policy_document.s3_cloudfront.json
}

data "aws_iam_policy_document" "s3_cloudfront" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.web.arn]
    }
  }
}

# ── ACM Certificate (must be in us-east-1 for CloudFront) ─────────────────────

resource "aws_acm_certificate" "web" {
  count             = var.create_custom_domain ? 1 : 0
  provider          = aws.us_east_1
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = { Stage = var.stage, Service = var.service_name }
}

resource "aws_route53_record" "cert_validation" {
  count   = var.create_custom_domain && var.create_route53_records ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = tolist(aws_acm_certificate.web[0].domain_validation_options)[0].resource_record_name
  type    = tolist(aws_acm_certificate.web[0].domain_validation_options)[0].resource_record_type
  records = [tolist(aws_acm_certificate.web[0].domain_validation_options)[0].resource_record_value]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "web" {
  count           = var.create_custom_domain && var.create_route53_records ? 1 : 0
  provider        = aws.us_east_1
  certificate_arn = aws_acm_certificate.web[0].arn
  validation_record_fqdns = [
    aws_route53_record.cert_validation[0].fqdn
  ]
}

# ── CloudFront Function — SPA path rewriting ───────────────────────────────────

resource "aws_cloudfront_function" "spa_router" {
  name    = "${var.service_name}-${var.stage}-spa-router"
  runtime = "cloudfront-js-2.0"
  comment = "Rewrite non-asset paths to /index.html for SPA routing"
  publish = true

  code = <<-EOF
    function handler(event) {
      var request = event.request;
      var uri = request.uri;
      // Pass through requests with a file extension
      if (uri.match(/\.[a-zA-Z0-9]+$/)) {
        return request;
      }
      // Rewrite all other paths to /index.html
      request.uri = '/index.html';
      return request;
    }
  EOF
}

# ── CloudFront Distribution ────────────────────────────────────────────────────

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = "PriceClass_All"
  aliases             = var.create_custom_domain ? [var.domain_name] : []

  origin {
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_id                = "s3-${aws_s3_bucket.web.id}"
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  # Default behavior — HTML files, no long-term cache
  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-${aws_s3_bucket.web.id}"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # CachingDisabled

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_router.arn
    }
  }

  # Ordered behavior — static assets with long cache
  ordered_cache_behavior {
    path_pattern           = "/assets/*"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-${aws_s3_bucket.web.id}"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6" # CachingOptimized (1 year)
  }

  viewer_certificate {
    cloudfront_default_certificate = var.create_custom_domain ? false : true
    acm_certificate_arn            = var.create_custom_domain ? aws_acm_certificate.web[0].arn : null
    ssl_support_method             = var.create_custom_domain ? "sni-only" : null
    minimum_protocol_version       = var.create_custom_domain ? "TLSv1.2_2021" : null
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  tags = { Stage = var.stage, Service = var.service_name }
}

# ── Route53 alias record ───────────────────────────────────────────────────────

resource "aws_route53_record" "web" {
  count   = var.create_custom_domain && var.create_route53_records ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}
