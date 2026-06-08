#!/usr/bin/env bash
# ── LocalStack init script ────────────────────────────────────────────────────
# Runs automatically inside LocalStack when it reaches ready state.
# Mounted at: /etc/localstack/init/ready.d/init.sh
#
# Purpose: Create S3 bucket (validates static deploy pipeline before touching prod).
#          Lambda smoke-test setup is optional — see comments below.
#
# Does NOT set up: API Gateway, EventBridge Scheduler, RDS.
#   → Use the Lambda dev server (pnpm dev in apps/api) for API route testing.
#   → Use pnpm run:zoho / run:saleor / run:doc-app for ETL testing locally.

set -euo pipefail

STAGE="local"
REGION="ap-southeast-2"
ACCOUNT_ID="000000000000"
BUCKET="harvest-analytics-${STAGE}"

echo ">> [localstack-init] starting"

# ── S3 static hosting bucket ─────────────────────────────────────────────────
echo ">> Creating S3 bucket: ${BUCKET}"
awslocal s3 mb "s3://${BUCKET}" --region "${REGION}" 2>/dev/null || echo "  (already exists)"

awslocal s3 website "s3://${BUCKET}" \
  --index-document index.html \
  --error-document 404/index.html 2>/dev/null || true

awslocal s3api put-bucket-policy \
  --bucket "${BUCKET}" \
  --policy '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::'"${BUCKET}"'/*"
    }]
  }' 2>/dev/null || true

echo "  s3://${BUCKET} ready"
echo "  Validate pipeline with: aws s3 sync apps/web/out/ s3://${BUCKET}/ --endpoint-url http://localhost:4566"

# ── Optional: Lambda smoke test setup ────────────────────────────────────────
# Uncomment after running `pnpm build` to load compiled handlers into LocalStack.
# This is for CI smoke tests only — local dev uses the dev HTTP wrapper instead.

# echo ">> Creating IAM role for Lambda"
# awslocal iam create-role \
#   --role-name analytics-lambda-role \
#   --assume-role-policy-document \
#     '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
#   2>/dev/null || true
#
# DB_URL="postgresql://analytics:analytics@host.docker.internal:5433/analytics"
# ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/analytics-lambda-role"
#
# for HANDLER in customers ingest; do
#   SRC="/tmp/apps/api/dist/handlers/${HANDLER}.js"
#   ZIP="/tmp/analytics-api-${HANDLER}.zip"
#   if [[ -f "${SRC}" ]]; then
#     zip -j "${ZIP}" "${SRC}"
#     awslocal lambda create-function \
#       --function-name "analytics-api-${HANDLER}-${STAGE}" \
#       --runtime nodejs20.x \
#       --handler "handlers/${HANDLER}.handler" \
#       --role "${ROLE_ARN}" \
#       --zip-file "fileb://${ZIP}" \
#       --environment "Variables={DATABASE_URL=${DB_URL}}" \
#       --region "${REGION}" 2>/dev/null || \
#     awslocal lambda update-function-code \
#       --function-name "analytics-api-${HANDLER}-${STAGE}" \
#       --zip-file "fileb://${ZIP}" \
#       --region "${REGION}"
#     echo "  lambda: analytics-api-${HANDLER}"
#   fi
# done

echo ">> [localstack-init] done"
echo "   S3: http://localhost:4566/${BUCKET}/"
echo "   Health: http://localhost:4566/_localstack/health"
