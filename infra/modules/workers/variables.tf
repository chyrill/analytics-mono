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

variable "zoho_client_id" {
  type    = string
  default = ""
}

variable "zoho_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}

variable "zoho_refresh_token" {
  type      = string
  sensitive = true
  default   = ""
}

variable "saleor_api_token" {
  type      = string
  sensitive = true
  default   = ""
}

variable "saleor_api_url" {
  type    = string
  default = ""
}

variable "docapp_database_url" {
  type      = string
  sensitive = true
  default   = ""
}

variable "saleor_schedule" {
  type    = string
  default = "rate(1 hour)"
}

variable "zoho_schedule" {
  type    = string
  default = "rate(2 hours)"
}

variable "docapp_schedule" {
  type    = string
  default = "rate(1 hour)"
}
