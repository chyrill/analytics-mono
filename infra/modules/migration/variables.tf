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
