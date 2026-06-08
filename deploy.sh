#!/usr/bin/env bash
# ── analytics-mono deploy script ──────────────────────────────────────────────
set -euo pipefail

STAGE="${1:-prod}"
REGION="${AWS_REGION:-ap-southeast-2}"
S3_BUCKET="${AWS_S3_BUCKET:-harvest-analytics-${STAGE}}"

echo "==> Building all packages"
pnpm build

# ── API Lambdas ────────────────────────────────────────────────────────────────
echo "==> Deploying API Lambda functions"
for HANDLER in customers ingest; do
  ZIP="/tmp/analytics-api-${HANDLER}.zip"
  zip -j "${ZIP}" "apps/api/dist/handlers/${HANDLER}.js"
  aws lambda update-function-code \
    --function-name "harvest-analytics-api-${HANDLER}-${STAGE}" \
    --zip-file "fileb://${ZIP}" \
    --region "${REGION}"
  echo "  deployed: analytics-api-${HANDLER}"
done

# ── Sync Lambdas ───────────────────────────────────────────────────────────────
echo "==> Deploying Sync Lambda functions"
for HANDLER in zoho saleor doc-app; do
  ZIP="/tmp/analytics-sync-${HANDLER}.zip"
  zip -j "${ZIP}" "apps/sync/dist/handlers/${HANDLER}.js"
  aws lambda update-function-code \
    --function-name "harvest-analytics-sync-${HANDLER}-${STAGE}" \
    --zip-file "fileb://${ZIP}" \
    --region "${REGION}"
  echo "  deployed: analytics-sync-${HANDLER}"
done

# ── Static Web to S3 ───────────────────────────────────────────────────────────
echo "==> Syncing static web to s3://${S3_BUCKET}/"
aws s3 sync apps/web/out/ "s3://${S3_BUCKET}/" \
  --delete \
  --cache-control "public, max-age=31536000, immutable" \
  --exclude "*.html"

# HTML files should not be cached aggressively
aws s3 sync apps/web/out/ "s3://${S3_BUCKET}/" \
  --exclude "*" \
  --include "*.html" \
  --cache-control "public, max-age=0, must-revalidate"

if [[ -n "${CF_DISTRIBUTION_ID:-}" ]]; then
  echo "==> Invalidating CloudFront distribution ${CF_DISTRIBUTION_ID}"
  aws cloudfront create-invalidation \
    --distribution-id "${CF_DISTRIBUTION_ID}" \
    --paths "/*"
fi

echo "==> Deploy complete (stage: ${STAGE})"
