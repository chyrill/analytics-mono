terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }

  # Backend is configured at init time via -backend-config flags:
  # bucket = "harvest-infra"
  # key    = "analytics-mono/production/terraform.tfstate"
  # region = "ap-southeast-2"
  backend "s3" {}
}

provider "aws" {
  region = var.aws_region
}

# Required for CloudFront ACM certificates (must be in us-east-1)
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}
