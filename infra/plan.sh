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

# AWS credentials — permanent key via ~/.aws/credentials (no expiry)
export AWS_DEFAULT_REGION="ap-southeast-2"

# ── Extract vars directly from .env (avoids source/allexport edge cases) ──────
_env() { grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2-; }

export TF_VAR_zoho_client_id="$(_env ZOHO_CLIENT_ID)"
export TF_VAR_zoho_client_secret="$(_env ZOHO_CLIENT_SECRET)"
export TF_VAR_zoho_refresh_token="$(_env ZOHO_REFRESH_TOKEN)"
export TF_VAR_saleor_api_token="$(_env SALEOR_API_TOKEN)"
export TF_VAR_saleor_api_url="$(_env SALEOR_API_URL)"
export TF_VAR_docapp_database_url="$(_env DOCAPP_DATABASE_URL)"
export TF_VAR_db_password="$(_env ANALYTICS_DB_PASSWORD)"
[[ -z "${TF_VAR_db_password}" ]] && TF_VAR_db_password="plan-placeholder-change-before-apply"

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
