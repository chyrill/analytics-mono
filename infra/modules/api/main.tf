# ── IAM Role for API Lambdas ───────────────────────────────────────────────────

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api" {
  name               = "${var.service_name}-api-${var.stage}-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json

  tags = {
    Stage   = var.stage
    Service = var.service_name
  }
}

resource "aws_iam_role_policy_attachment" "api_basic" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "api_vpc" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# ── CloudWatch Log Groups ──────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "ingest" {
  name              = "/aws/lambda/${var.service_name}-api-ingest-${var.stage}"
  retention_in_days = 30

  tags = { Stage = var.stage, Service = var.service_name }
}

resource "aws_cloudwatch_log_group" "customers" {
  name              = "/aws/lambda/${var.service_name}-api-customers-${var.stage}"
  retention_in_days = 30

  tags = { Stage = var.stage, Service = var.service_name }
}

resource "aws_cloudwatch_log_group" "sync" {
  name              = "/aws/lambda/${var.service_name}-api-sync-${var.stage}"
  retention_in_days = 30

  tags = { Stage = var.stage, Service = var.service_name }
}

resource "aws_cloudwatch_log_group" "auth" {
  name              = "/aws/lambda/${var.service_name}-api-auth-${var.stage}"
  retention_in_days = 30

  tags = { Stage = var.stage, Service = var.service_name }
}

resource "aws_cloudwatch_log_group" "users" {
  name              = "/aws/lambda/${var.service_name}-api-users-${var.stage}"
  retention_in_days = 30

  tags = { Stage = var.stage, Service = var.service_name }
}

resource "aws_cloudwatch_log_group" "roles" {
  name              = "/aws/lambda/${var.service_name}-api-roles-${var.stage}"
  retention_in_days = 30

  tags = { Stage = var.stage, Service = var.service_name }
}

resource "aws_cloudwatch_log_group" "health" {
  name              = "/aws/lambda/${var.service_name}-api-health-${var.stage}"
  retention_in_days = 30

  tags = { Stage = var.stage, Service = var.service_name }
}

# ── Placeholder zip (CI deploys real code via update-function-code) ────────────

data "archive_file" "placeholder" {
  type        = "zip"
  output_path = "${path.module}/placeholder.zip"
  source {
    content  = "exports.handler = async () => ({ statusCode: 200, body: 'placeholder' });"
    filename = "index.js"
  }
}

# ── Lambda Functions ───────────────────────────────────────────────────────────

locals {
  common_env = {
    DATABASE_URL = var.database_url
    NODE_ENV     = "production"
    JWT_SECRET   = var.jwt_secret
  }
}

resource "aws_lambda_function" "ingest" {
  function_name = "${var.service_name}-api-ingest-${var.stage}"
  role          = aws_iam_role.api.arn
  runtime       = var.lambda_runtime
  handler       = "ingest.handler"
  timeout       = 30
  memory_size   = 256

  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  vpc_config {
    subnet_ids         = var.vpc_subnet_ids
    security_group_ids = var.vpc_security_group_ids
  }

  environment {
    variables = local.common_env
  }

  depends_on = [aws_cloudwatch_log_group.ingest]

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = { Stage = var.stage, Service = var.service_name }
}

resource "aws_lambda_function" "customers" {
  function_name = "${var.service_name}-api-customers-${var.stage}"
  role          = aws_iam_role.api.arn
  runtime       = var.lambda_runtime
  handler       = "customers.handler"
  timeout       = 30
  memory_size   = 256

  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  vpc_config {
    subnet_ids         = var.vpc_subnet_ids
    security_group_ids = var.vpc_security_group_ids
  }

  environment {
    variables = local.common_env
  }

  depends_on = [aws_cloudwatch_log_group.customers]

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = { Stage = var.stage, Service = var.service_name }
}

resource "aws_lambda_function" "sync" {
  function_name = "${var.service_name}-api-sync-${var.stage}"
  role          = aws_iam_role.api.arn
  runtime       = var.lambda_runtime
  handler       = "sync.handler"
  timeout       = 30
  memory_size   = 256

  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  vpc_config {
    subnet_ids         = var.vpc_subnet_ids
    security_group_ids = var.vpc_security_group_ids
  }

  environment {
    variables = merge(local.common_env, { STAGE = var.stage })
  }

  depends_on = [aws_cloudwatch_log_group.sync]

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = { Stage = var.stage, Service = var.service_name }
}

resource "aws_lambda_function" "auth" {
  function_name = "${var.service_name}-api-auth-${var.stage}"
  role          = aws_iam_role.api.arn
  runtime       = var.lambda_runtime
  handler       = "auth.handler"
  timeout       = 30
  memory_size   = 256

  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  vpc_config {
    subnet_ids         = var.vpc_subnet_ids
    security_group_ids = var.vpc_security_group_ids
  }

  environment {
    variables = local.common_env
  }

  depends_on = [aws_cloudwatch_log_group.auth]

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = { Stage = var.stage, Service = var.service_name }
}

resource "aws_lambda_function" "users" {
  function_name = "${var.service_name}-api-users-${var.stage}"
  role          = aws_iam_role.api.arn
  runtime       = var.lambda_runtime
  handler       = "users.handler"
  timeout       = 30
  memory_size   = 256

  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  vpc_config {
    subnet_ids         = var.vpc_subnet_ids
    security_group_ids = var.vpc_security_group_ids
  }

  environment {
    variables = local.common_env
  }

  depends_on = [aws_cloudwatch_log_group.users]

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = { Stage = var.stage, Service = var.service_name }
}

resource "aws_lambda_function" "roles" {
  function_name = "${var.service_name}-api-roles-${var.stage}"
  role          = aws_iam_role.api.arn
  runtime       = var.lambda_runtime
  handler       = "roles.handler"
  timeout       = 30
  memory_size   = 256

  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  vpc_config {
    subnet_ids         = var.vpc_subnet_ids
    security_group_ids = var.vpc_security_group_ids
  }

  environment {
    variables = local.common_env
  }

  depends_on = [aws_cloudwatch_log_group.roles]

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = { Stage = var.stage, Service = var.service_name }
}

resource "aws_lambda_function" "health" {
  function_name = "${var.service_name}-api-health-${var.stage}"
  role          = aws_iam_role.api.arn
  runtime       = var.lambda_runtime
  handler       = "health.handler"
  timeout       = 60
  memory_size   = 512

  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  vpc_config {
    subnet_ids         = var.vpc_subnet_ids
    security_group_ids = var.vpc_security_group_ids
  }

  environment {
    variables = local.common_env
  }

  depends_on = [aws_cloudwatch_log_group.health]

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = { Stage = var.stage, Service = var.service_name }
}

# ── Allow sync Lambda to invoke worker Lambdas ────────────────────────────────

data "aws_iam_policy_document" "sync_invoke_workers" {
  statement {
    effect    = "Allow"
    actions   = ["lambda:InvokeFunction"]
    resources = [
      "arn:aws:lambda:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:function:${var.service_name}-sync-*-${var.stage}",
    ]
  }
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

resource "aws_iam_role_policy" "sync_invoke_workers" {
  name   = "sync-invoke-workers"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.sync_invoke_workers.json
}

# ── Lambda permissions for API Gateway ────────────────────────────────────────

resource "aws_lambda_permission" "ingest" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ingest.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.analytics.execution_arn}/*/*"
}

resource "aws_lambda_permission" "customers" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.customers.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.analytics.execution_arn}/*/*"
}

resource "aws_lambda_permission" "sync" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sync.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.analytics.execution_arn}/*/*"
}

resource "aws_lambda_permission" "auth" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.auth.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.analytics.execution_arn}/*/*"
}

resource "aws_lambda_permission" "users" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.users.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.analytics.execution_arn}/*/*"
}

resource "aws_lambda_permission" "roles" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.roles.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.analytics.execution_arn}/*/*"
}

resource "aws_lambda_permission" "health" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.health.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.analytics.execution_arn}/*/*"
}

# ── HTTP API Gateway ───────────────────────────────────────────────────────────

resource "aws_apigatewayv2_api" "analytics" {
  name          = "${var.service_name}-${var.stage}"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = var.allowed_origins != "" ? split(",", var.allowed_origins) : ["*"]
    allow_methods = ["GET", "POST", "PATCH", "OPTIONS"]
    allow_headers = ["Content-Type", "Authorization"]
    max_age       = 300
  }

  tags = { Stage = var.stage, Service = var.service_name }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.analytics.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.apigw.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      sourceIp       = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      responseLength = "$context.responseLength"
    })
  }

  tags = { Stage = var.stage, Service = var.service_name }
}

resource "aws_cloudwatch_log_group" "apigw" {
  name              = "/aws/apigateway/${var.service_name}-${var.stage}"
  retention_in_days = 30

  tags = { Stage = var.stage, Service = var.service_name }
}

# ── Integrations & Routes ──────────────────────────────────────────────────────

resource "aws_apigatewayv2_integration" "ingest" {
  api_id                 = aws_apigatewayv2_api.analytics.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.ingest.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "ingest" {
  api_id    = aws_apigatewayv2_api.analytics.id
  route_key = "POST /ingest"
  target    = "integrations/${aws_apigatewayv2_integration.ingest.id}"
}

resource "aws_apigatewayv2_integration" "customers" {
  api_id                 = aws_apigatewayv2_api.analytics.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.customers.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "customers" {
  api_id    = aws_apigatewayv2_api.analytics.id
  route_key = "GET /customers"
  target    = "integrations/${aws_apigatewayv2_integration.customers.id}"
}

resource "aws_apigatewayv2_integration" "sync" {
  api_id                 = aws_apigatewayv2_api.analytics.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.sync.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "sync_checkpoints" {
  api_id    = aws_apigatewayv2_api.analytics.id
  route_key = "GET /sync/checkpoints"
  target    = "integrations/${aws_apigatewayv2_integration.sync.id}"
}

resource "aws_apigatewayv2_route" "sync_jobs" {
  api_id    = aws_apigatewayv2_api.analytics.id
  route_key = "GET /sync/jobs/{jobId}"
  target    = "integrations/${aws_apigatewayv2_integration.sync.id}"
}

resource "aws_apigatewayv2_route" "sync_trigger" {
  api_id    = aws_apigatewayv2_api.analytics.id
  route_key = "POST /sync/{source}"
  target    = "integrations/${aws_apigatewayv2_integration.sync.id}"
}

# ── Auth routes ────────────────────────────────────────────────────────────────

resource "aws_apigatewayv2_integration" "auth" {
  api_id                 = aws_apigatewayv2_api.analytics.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.auth.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "auth_login" {
  api_id    = aws_apigatewayv2_api.analytics.id
  route_key = "POST /auth/login"
  target    = "integrations/${aws_apigatewayv2_integration.auth.id}"
}

resource "aws_apigatewayv2_route" "auth_me" {
  api_id    = aws_apigatewayv2_api.analytics.id
  route_key = "GET /auth/me"
  target    = "integrations/${aws_apigatewayv2_integration.auth.id}"
}

resource "aws_apigatewayv2_route" "auth_change_password" {
  api_id    = aws_apigatewayv2_api.analytics.id
  route_key = "POST /auth/change-password"
  target    = "integrations/${aws_apigatewayv2_integration.auth.id}"
}

# ── User management routes ─────────────────────────────────────────────────────

resource "aws_apigatewayv2_integration" "users" {
  api_id                 = aws_apigatewayv2_api.analytics.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.users.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "users_list" {
  api_id    = aws_apigatewayv2_api.analytics.id
  route_key = "GET /users"
  target    = "integrations/${aws_apigatewayv2_integration.users.id}"
}

resource "aws_apigatewayv2_route" "users_create" {
  api_id    = aws_apigatewayv2_api.analytics.id
  route_key = "POST /users"
  target    = "integrations/${aws_apigatewayv2_integration.users.id}"
}

resource "aws_apigatewayv2_route" "users_update" {
  api_id    = aws_apigatewayv2_api.analytics.id
  route_key = "PATCH /users/{id}"
  target    = "integrations/${aws_apigatewayv2_integration.users.id}"
}

resource "aws_apigatewayv2_route" "users_deactivate" {
  api_id    = aws_apigatewayv2_api.analytics.id
  route_key = "PATCH /users/{id}/deactivate"
  target    = "integrations/${aws_apigatewayv2_integration.users.id}"
}

resource "aws_apigatewayv2_route" "users_reset_password" {
  api_id    = aws_apigatewayv2_api.analytics.id
  route_key = "POST /users/{id}/reset-password"
  target    = "integrations/${aws_apigatewayv2_integration.users.id}"
}

# ── Roles routes ───────────────────────────────────────────────────────────────

resource "aws_apigatewayv2_integration" "roles" {
  api_id                 = aws_apigatewayv2_api.analytics.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.roles.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "roles_pages" {
  api_id    = aws_apigatewayv2_api.analytics.id
  route_key = "GET /roles/pages"
  target    = "integrations/${aws_apigatewayv2_integration.roles.id}"
}

resource "aws_apigatewayv2_route" "roles_list" {
  api_id    = aws_apigatewayv2_api.analytics.id
  route_key = "GET /roles"
  target    = "integrations/${aws_apigatewayv2_integration.roles.id}"
}

resource "aws_apigatewayv2_route" "roles_create" {
  api_id    = aws_apigatewayv2_api.analytics.id
  route_key = "POST /roles"
  target    = "integrations/${aws_apigatewayv2_integration.roles.id}"
}

# ── Health routes ──────────────────────────────────────────────────────────────

resource "aws_apigatewayv2_integration" "health" {
  api_id                 = aws_apigatewayv2_api.analytics.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.health.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "health_data" {
  api_id    = aws_apigatewayv2_api.analytics.id
  route_key = "GET /health-data"
  target    = "integrations/${aws_apigatewayv2_integration.health.id}"
}

resource "aws_apigatewayv2_route" "health_data_export" {
  api_id    = aws_apigatewayv2_api.analytics.id
  route_key = "GET /health-data/export"
  target    = "integrations/${aws_apigatewayv2_integration.health.id}"
}

resource "aws_apigatewayv2_route" "health_detail" {
  api_id    = aws_apigatewayv2_api.analytics.id
  route_key = "GET /health-detail"
  target    = "integrations/${aws_apigatewayv2_integration.health.id}"
}

resource "aws_apigatewayv2_route" "health_notes_list" {
  api_id    = aws_apigatewayv2_api.analytics.id
  route_key = "GET /health-notes"
  target    = "integrations/${aws_apigatewayv2_integration.health.id}"
}

resource "aws_apigatewayv2_route" "health_notes_create" {
  api_id    = aws_apigatewayv2_api.analytics.id
  route_key = "POST /health-notes"
  target    = "integrations/${aws_apigatewayv2_integration.health.id}"
}

resource "aws_apigatewayv2_route" "health_notes_delete" {
  api_id    = aws_apigatewayv2_api.analytics.id
  route_key = "DELETE /health-notes"
  target    = "integrations/${aws_apigatewayv2_integration.health.id}"
}

# ── Custom Domain (optional) ───────────────────────────────────────────────────

resource "aws_acm_certificate" "api" {
  count             = var.create_custom_domain ? 1 : 0
  domain_name       = var.api_domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = { Stage = var.stage, Service = var.service_name }
}

resource "aws_route53_record" "api_cert_validation" {
  count   = var.create_custom_domain && var.create_route53_records ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = tolist(aws_acm_certificate.api[0].domain_validation_options)[0].resource_record_name
  type    = tolist(aws_acm_certificate.api[0].domain_validation_options)[0].resource_record_type
  records = [tolist(aws_acm_certificate.api[0].domain_validation_options)[0].resource_record_value]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "api" {
  count           = var.create_custom_domain && var.create_route53_records ? 1 : 0
  certificate_arn = aws_acm_certificate.api[0].arn
  validation_record_fqdns = [
    aws_route53_record.api_cert_validation[0].fqdn
  ]
}

resource "aws_apigatewayv2_domain_name" "custom" {
  count       = var.create_custom_domain ? 1 : 0
  domain_name = var.api_domain_name

  domain_name_configuration {
    certificate_arn = aws_acm_certificate.api[0].arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }

  tags = { Stage = var.stage, Service = var.service_name }
}

resource "aws_apigatewayv2_api_mapping" "custom" {
  count       = var.create_custom_domain ? 1 : 0
  api_id      = aws_apigatewayv2_api.analytics.id
  domain_name = aws_apigatewayv2_domain_name.custom[0].id
  stage       = aws_apigatewayv2_stage.default.id
}

resource "aws_route53_record" "api" {
  count   = var.create_custom_domain && var.create_route53_records ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = var.api_domain_name
  type    = "A"

  alias {
    name                   = aws_apigatewayv2_domain_name.custom[0].domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.custom[0].domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}
