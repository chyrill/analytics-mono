terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      version               = "~> 5.80"
      configuration_aliases = [aws.us_east_1]
    }
  }
}

variable "stage" {
  type = string
}

variable "service_name" {
  type    = string
  default = "harvest-analytics"
}

variable "domain_name" {
  type        = string
  description = "Custom domain for the web dashboard (e.g. analytics.zenith.clinic)"
  default     = ""
}

variable "hosted_zone_id" {
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
