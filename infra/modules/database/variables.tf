variable "stage" {
  type = string
}

variable "service_name" {
  type    = string
  default = "harvest-analytics"
}

variable "vpc_subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs for the RDS subnet group"
}

variable "lambda_security_group_ids" {
  type        = list(string)
  description = "Security group IDs assigned to Lambda functions — allowed inbound to RDS"
}

variable "db_username" {
  type    = string
  default = "analytics"
}

variable "db_name" {
  type    = string
  default = "analytics"
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "instance_class" {
  type    = string
  default = "db.t3.micro"
}

variable "allocated_storage" {
  type    = number
  default = 20
}
