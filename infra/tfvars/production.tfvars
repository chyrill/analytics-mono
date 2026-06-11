# ── Production deployment configuration ────────────────────────────────────────
# Sensitive values (db_password, zoho_*, saleor_api_token, docapp_database_url)
# are injected at deploy time via TF_VAR_ environment variables in GitHub Actions.
# Do NOT add secrets to this file.

stage        = "production"
service_name = "harvest-analytics"
aws_region   = "ap-southeast-2"

lambda_runtime = "nodejs20.x"

# ── Domains ────────────────────────────────────────────────────────────────────
# Set your actual domain names and hosted_zone_id here.
# If using external DNS (not Route53), set create_route53_records = false
# and add the CNAME records from terraform output manually.

api_domain_name = "analytics-api.zenith.clinic"
web_domain_name = "analytics.zenith.clinic"
hosted_zone_id  = "" # fill in Route53 hosted zone ID if using create_route53_records = true

create_custom_domain   = true
create_route53_records = false # set true if domain is managed in Route53

allowed_origins = "https://analytics.zenith.clinic"

enable_frontend = true

# ── Zoho integration ───────────────────────────────────────────────────────────
zoho_client_id = "" # non-sensitive, fill in or move to GitHub Variables

# ── Worker schedules ───────────────────────────────────────────────────────────
saleor_schedule = "rate(1 hour)"
zoho_schedule   = "rate(2 hours)"
docapp_schedule = "rate(1 hour)"
