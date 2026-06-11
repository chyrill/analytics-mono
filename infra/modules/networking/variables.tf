variable "vpc_id" {
  type        = string
  description = "Existing VPC ID to deploy analytics resources into"
}

variable "public_subnet_id" {
  type        = string
  description = "An existing public subnet ID in the VPC — used to place the NAT gateway"
}

variable "subnet_cidr_az_a" {
  type        = string
  description = "CIDR for the new private subnet in ap-southeast-2a (must not overlap existing subnets)"
}

variable "subnet_cidr_az_b" {
  type        = string
  description = "CIDR for the new private subnet in ap-southeast-2b (must not overlap existing subnets)"
}

variable "docapp_rds_security_group_id" {
  type        = string
  description = "Security group ID of the doc-app production RDS (postgresqlDB) — an ingress rule will be added to allow analytics Lambda access"
}

variable "service_name" {
  type    = string
  default = "harvest-analytics"
}

variable "stage" {
  type = string
}
