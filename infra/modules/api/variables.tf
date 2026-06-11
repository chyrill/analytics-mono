variable "stage" {
  type = string
}

variable "service_name" {
  type    = string
  default = "harvest-analytics"
}

variable "lambda_runtime" {
  type    = string
  default = "nodejs20.x"
}

variable "vpc_subnet_ids" {
  type = list(string)
}

variable "vpc_security_group_ids" {
  type = list(string)
}

variable "database_url" {
  type      = string
  sensitive = true
}

variable "api_domain_name" {
  type    = string
  default = ""
}

variable "hosted_zone_id" {
  type    = string
  default = ""
}

variable "allowed_origins" {
  type    = string
  default = ""
}

variable "create_custom_domain" {
  type    = bool
  default = true
}

variable "create_route53_records" {
  type    = bool
  default = false
}
