# ── IAM Role for Sync Worker Lambdas ──────────────────────────────────────────

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "workers" {
  name               = "${var.service_name}-workers-${var.stage}-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json

  tags = {
    Stage   = var.stage
    Service = var.service_name
  }
}

resource "aws_iam_role_policy_attachment" "workers_basic" {
  role       = aws_iam_role.workers.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "workers_vpc" {
  role       = aws_iam_role.workers.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# ── Worker definitions ─────────────────────────────────────────────────────────
# key = Terraform resource name, handler_name = Lambda function suffix + filename

locals {
  workers = {
    saleor = {
      handler_name = "saleor"
      schedule     = var.saleor_schedule
      description  = "Sync Saleor orders and customers into analytics DB"
      timeout      = 900
      memory       = 512
    }
    zoho = {
      handler_name = "zoho"
      schedule     = var.zoho_schedule
      description  = "Sync Zoho CRM contacts and deals into analytics DB"
      timeout      = 900
      memory       = 512
    }
    docapp = {
      handler_name = "doc-app"
      schedule     = var.docapp_schedule
      description  = "Sync DocApp patient data into analytics DB"
      timeout      = 900
      memory       = 512
    }
  }
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

# ── CloudWatch Log Groups ──────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "worker" {
  for_each = local.workers

  name              = "/aws/lambda/${var.service_name}-sync-${each.value.handler_name}-${var.stage}"
  retention_in_days = 30

  tags = { Stage = var.stage, Service = var.service_name }
}

# ── Lambda Functions ───────────────────────────────────────────────────────────

resource "aws_lambda_function" "worker" {
  for_each = local.workers

  function_name = "${var.service_name}-sync-${each.value.handler_name}-${var.stage}"
  description   = each.value.description
  role          = aws_iam_role.workers.arn
  runtime       = var.lambda_runtime
  handler       = "${each.value.handler_name}.handler"
  timeout       = each.value.timeout
  memory_size   = each.value.memory

  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  vpc_config {
    subnet_ids         = var.vpc_subnet_ids
    security_group_ids = var.vpc_security_group_ids
  }

  environment {
    variables = {
      DATABASE_URL        = var.database_url
      ZOHO_CLIENT_ID      = var.zoho_client_id
      ZOHO_CLIENT_SECRET  = var.zoho_client_secret
      ZOHO_REFRESH_TOKEN  = var.zoho_refresh_token
      SALEOR_API_TOKEN    = var.saleor_api_token
      SALEOR_API_URL      = var.saleor_api_url
      DOCAPP_DATABASE_URL = var.docapp_database_url
      NODE_ENV            = "production"
    }
  }

  depends_on = [aws_cloudwatch_log_group.worker]

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = { Stage = var.stage, Service = var.service_name }
}

# ── EventBridge Schedules ──────────────────────────────────────────────────────

resource "aws_cloudwatch_event_rule" "worker" {
  for_each = local.workers

  name                = "${var.service_name}-sync-${each.value.handler_name}-${var.stage}"
  description         = "Trigger for ${each.value.description}"
  schedule_expression = each.value.schedule
  state               = "ENABLED"

  tags = { Stage = var.stage, Service = var.service_name }
}

resource "aws_cloudwatch_event_target" "worker" {
  for_each = local.workers

  rule      = aws_cloudwatch_event_rule.worker[each.key].name
  target_id = "${var.service_name}-sync-${each.value.handler_name}-${var.stage}"
  arn       = aws_lambda_function.worker[each.key].arn
}

resource "aws_lambda_permission" "worker_eventbridge" {
  for_each = local.workers

  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.worker[each.key].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.worker[each.key].arn
}
