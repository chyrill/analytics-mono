#!/usr/bin/env bash
# Run terraform apply locally using values from the root .env file.
# Usage: bash infra/apply.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found."
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
export TF_VAR_docapp_database_url="$(_env DOCAPP_DATABASE_URL)"
export TF_VAR_db_password="$(_env ANALYTICS_DB_PASSWORD)"
export TF_VAR_jwt_secret="$(_env JWT_SECRET)"

[[ -z "${TF_VAR_db_password}" ]] && { echo "ERROR: ANALYTICS_DB_PASSWORD not set in $ENV_FILE"; exit 1; }
[[ -z "${TF_VAR_jwt_secret}" ]] && { echo "ERROR: JWT_SECRET not set in $ENV_FILE"; exit 1; }

echo "==> Initialising Terraform (backend: s3://harvest-infra/analytics-mono/production/)"
cd "$SCRIPT_DIR"

terraform init \
  -backend-config="bucket=harvest-infra" \
  -backend-config="key=analytics-mono/production/terraform.tfstate" \
  -backend-config="region=ap-southeast-2" \
  -reconfigure

echo ""
# ── Phase 1: apply everything except frontend (completes in ~5 min, within credential TTL) ──
# ── Phase 2: apply frontend separately after ACM cert DNS CNAME is validated ──
PHASE="${PHASE:-1}"

if [[ "$PHASE" == "1" ]]; then
  echo "==> Phase 1: applying networking, database, api, workers, migration"
  terraform apply \
    -var-file="tfvars/production.tfvars" \
    -target=module.networking \
    -target=module.database \
    -target=module.api \
    -target=module.workers \
    -target=module.migration \
    -auto-approve
  echo ""
  echo "Phase 1 complete!"
  echo "Next: add DNS CNAME for ACM cert, then run: PHASE=2 bash infra/apply.sh"
else
  echo "==> Phase 2: applying frontend (CloudFront + cert validation)"
  terraform apply \
    -var-file="tfvars/production.tfvars" \
    -target=module.frontend \
    -auto-approve
  echo ""
  echo "Apply complete!"
fi
