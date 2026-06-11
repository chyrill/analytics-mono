#!/usr/bin/env bash
# Run terraform plan locally using values from the root .env file.
# Usage: bash infra/plan.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Copy .env.example to .env and fill in values."
  exit 1
fi

echo "==> Loading variables from $ENV_FILE"

# AWS credentials — export session credentials so Terraform's Go SDK can find them
export AWS_DEFAULT_REGION="ap-southeast-2"
eval "$(AWS_SDK_LOAD_CONFIG=1 AWS_PROFILE="${AWS_PROFILE:-default}" aws configure export-credentials --format env)"

# Source .env (skip comments and blank lines)
set -o allexport
# shellcheck disable=SC1090
source <(grep -v '^\s*#' "$ENV_FILE" | grep -v '^\s*$')
set +o allexport

# ── Map .env vars → TF_VAR_ ───────────────────────────────────────────────────
export TF_VAR_zoho_client_id="${ZOHO_CLIENT_ID:-}"
export TF_VAR_zoho_client_secret="${ZOHO_CLIENT_SECRET:-}"
export TF_VAR_zoho_refresh_token="${ZOHO_REFRESH_TOKEN:-}"
export TF_VAR_saleor_api_token="${SALEOR_API_TOKEN:-}"
export TF_VAR_docapp_database_url="${DOCAPP_DATABASE_URL:-}"

# db_password: analytics RDS doesn't exist yet — use a placeholder for plan
# Replace with a real password before first apply
export TF_VAR_db_password="${ANALYTICS_DB_PASSWORD:-plan-placeholder-change-before-apply}"

echo "==> Initialising Terraform (backend: s3://harvest-infra/analytics-mono/production/)"
cd "$SCRIPT_DIR"

terraform init \
  -backend-config="bucket=harvest-infra" \
  -backend-config="key=analytics-mono/production/terraform.tfstate" \
  -backend-config="region=ap-southeast-2" \
  -reconfigure

echo ""
echo "==> Running terraform plan"
terraform plan \
  -var-file="tfvars/production.tfvars" \
  -out="$SCRIPT_DIR/tfplan.out"

echo ""
echo "Plan saved to infra/tfplan.out"
echo "To apply: cd infra && terraform apply tfplan.out"
