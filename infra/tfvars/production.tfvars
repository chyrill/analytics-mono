# ── Production deployment configuration ────────────────────────────────────────
# Sensitive values (db_password, zoho_*, saleor_api_token, docapp_database_url)
# are injected at deploy time via TF_VAR_ environment variables in GitHub Actions.
# Do NOT add secrets to this file.

stage        = "production"
service_name = "harvest-analytics"
aws_region   = "ap-southeast-2"

lambda_runtime = "nodejs20.x"

# ── Networking ────────────────────────────────────────────────────────────────
# Default VPC — where myproddb production RDS lives
vpc_id           = "vpc-0377aacc56a5ecd18"
public_subnet_id = "subnet-04a83ee804d50d8e1" # ap-southeast-2a public subnet for NAT GW
subnet_cidr_az_a = "172.31.48.0/24"           # new analytics private subnet — ap-southeast-2a
subnet_cidr_az_b = "172.31.49.0/24"           # new analytics private subnet — ap-southeast-2b

# postgresqlDB SG on myproddb — analytics Lambda ingress rule will be added here
docapp_rds_security_group_id = "sg-0b4a38ab820931d00"

# ── Domains ────────────────────────────────────────────────────────────────────
# Set your actual domain names and hosted_zone_id here.
# If using external DNS (not Route53), set create_route53_records = false
# and add the CNAME records from terraform output manually.

api_domain_name = "analytics-api.simdoar.net"
web_domain_name = "analytics.simdoar.net"
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
