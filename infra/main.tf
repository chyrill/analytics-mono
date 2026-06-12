locals {
  # Construct the RDS connection URL from database module outputs
  db_url = "postgresql://${var.db_username}:${var.db_password}@${module.database.endpoint}/${var.db_name}?sslmode=require"
}

module "networking" {
  source = "./modules/networking"

  vpc_id                       = var.vpc_id
  public_subnet_id             = var.public_subnet_id
  subnet_cidr_az_a             = var.subnet_cidr_az_a
  subnet_cidr_az_b             = var.subnet_cidr_az_b
  nat_eip_allocation_id        = var.nat_eip_allocation_id
  docapp_rds_security_group_id = var.docapp_rds_security_group_id
  service_name                 = var.service_name
  stage                        = var.stage
}

module "database" {
  source = "./modules/database"

  stage                     = var.stage
  service_name              = var.service_name
  vpc_subnet_ids            = module.networking.subnet_ids
  lambda_security_group_ids = [module.networking.lambda_sg_id]
  db_username               = var.db_username
  db_name                   = var.db_name
  db_password               = var.db_password

  depends_on = [module.networking]
}

module "migration" {
  source = "./modules/migration"

  stage                  = var.stage
  service_name           = var.service_name
  lambda_runtime         = var.lambda_runtime
  vpc_subnet_ids         = module.networking.subnet_ids
  vpc_security_group_ids = [module.networking.lambda_sg_id]
  database_url           = local.db_url

  depends_on = [module.database]
}

module "api" {
  source = "./modules/api"

  stage                  = var.stage
  service_name           = var.service_name
  lambda_runtime         = var.lambda_runtime
  vpc_subnet_ids         = module.networking.subnet_ids
  vpc_security_group_ids = [module.networking.lambda_sg_id]
  database_url           = local.db_url
  api_domain_name        = var.api_domain_name
  hosted_zone_id         = var.hosted_zone_id
  create_custom_domain   = var.create_custom_domain
  create_route53_records = var.create_route53_records
  allowed_origins        = var.allowed_origins
  jwt_secret             = var.jwt_secret

  depends_on = [module.database]
}

module "workers" {
  source = "./modules/workers"

  stage                  = var.stage
  service_name           = var.service_name
  lambda_runtime         = var.lambda_runtime
  vpc_subnet_ids         = module.networking.subnet_ids
  vpc_security_group_ids = [module.networking.lambda_sg_id]
  database_url           = local.db_url
  zoho_client_id         = var.zoho_client_id
  zoho_client_secret     = var.zoho_client_secret
  zoho_refresh_token     = var.zoho_refresh_token
  saleor_api_token       = var.saleor_api_token
  saleor_api_url         = var.saleor_api_url
  docapp_database_url    = var.docapp_database_url
  saleor_schedule        = var.saleor_schedule
  zoho_schedule          = var.zoho_schedule
  docapp_schedule        = var.docapp_schedule

  depends_on = [module.database]
}

module "frontend" {
  count  = var.enable_frontend ? 1 : 0
  source = "./modules/frontend"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  stage                  = var.stage
  service_name           = var.service_name
  domain_name            = var.web_domain_name
  hosted_zone_id         = var.hosted_zone_id
  create_custom_domain   = var.create_custom_domain
  create_route53_records = var.create_route53_records
}
