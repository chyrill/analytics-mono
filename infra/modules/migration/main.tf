# ── IAM Role for Migration Lambda ─────────────────────────────────────────────

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "migration" {
  name               = "${var.service_name}-migration-${var.stage}-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json

  tags = {
    Stage   = var.stage
    Service = var.service_name
  }
}

resource "aws_iam_role_policy_attachment" "migration_basic" {
  role       = aws_iam_role.migration.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "migration_vpc" {
  role       = aws_iam_role.migration.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# ── CloudWatch Log Group ───────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "migration" {
  name              = "/aws/lambda/${var.service_name}-migration-${var.stage}"
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

# ── Migration Lambda ───────────────────────────────────────────────────────────
# Invoked by CI after each deploy to apply any new Drizzle migrations.
# Must be in the VPC to reach the RDS instance.
# Bundled with: index.js (handler) + migrations/ (SQL files + meta journal).

resource "aws_lambda_function" "migration" {
  function_name = "${var.service_name}-migration-${var.stage}"
  description   = "Runs Drizzle ORM migrations against the analytics RDS on each deploy"
  role          = aws_iam_role.migration.arn
  runtime       = var.lambda_runtime
  handler       = "index.handler"
  timeout       = 300 # migrations can be slow on a cold start
  memory_size   = 256

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

  depends_on = [aws_cloudwatch_log_group.migration]

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = { Stage = var.stage, Service = var.service_name }
}
