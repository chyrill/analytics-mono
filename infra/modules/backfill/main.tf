# ── IAM Role for Backfill Lambda ──────────────────────────────────────────────

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "backfill" {
  name               = "${var.service_name}-backfill-${var.stage}-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json

  tags = {
    Stage   = var.stage
    Service = var.service_name
  }
}

resource "aws_iam_role_policy_attachment" "backfill_basic" {
  role       = aws_iam_role.backfill.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "backfill_vpc" {
  role       = aws_iam_role.backfill.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# ── CloudWatch Log Group ───────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "backfill" {
  name              = "/aws/lambda/${var.service_name}-backfill-${var.stage}"
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

# ── Backfill Lambda ─────────────────────────────────────────────────────────────
# Recomputes supply_tracking_history from db_treatment_plans + saleor order
# data. NOT invoked automatically by CI — this is a heavier, on-demand
# recompute, invoked manually:
#   aws lambda invoke --function-name <function_name> --payload '{}' \
#     --cli-binary-format raw-in-base64-out /tmp/result.json
# Must be in the VPC to reach the RDS instance.

resource "aws_lambda_function" "backfill" {
  function_name = "${var.service_name}-backfill-${var.stage}"
  description   = "Recomputes supply_tracking_history — invoked manually/on-demand, not on every deploy"
  role          = aws_iam_role.backfill.arn
  runtime       = var.lambda_runtime
  handler       = "index.handler"
  timeout       = 900 # full historical recompute across all patients — max Lambda timeout
  memory_size   = 1024

  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  vpc_config {
    subnet_ids         = var.vpc_subnet_ids
    security_group_ids = var.vpc_security_group_ids
  }

  environment {
    variables = {
      DATABASE_URL = var.database_url
      NODE_ENV     = "production"
    }
  }

  depends_on = [aws_cloudwatch_log_group.backfill]

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = { Stage = var.stage, Service = var.service_name }
}
