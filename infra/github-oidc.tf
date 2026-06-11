# ── GitHub Actions OIDC Deploy Role ───────────────────────────────────────────
# Allows the GitHub Actions workflow to authenticate via OIDC (no static keys).
# The OIDC provider already exists in the account; we reference it as a data source.

data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "github_actions_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      # Scope to main branch of the analytics-mono repo
      values = ["repo:chyrill/analytics-mono:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = "${var.service_name}-github-deploy-${var.stage}"
  assume_role_policy = data.aws_iam_policy_document.github_actions_assume.json

  tags = {
    Service = var.service_name
    Stage   = var.stage
  }
}

# AdministratorAccess is required: the workflow runs `terraform apply`
# which creates/updates IAM roles, Lambda functions, VPC, RDS, CloudFront etc.
resource "aws_iam_role_policy_attachment" "github_deploy_admin" {
  role       = aws_iam_role.github_deploy.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

output "github_deploy_role_arn" {
  description = "ARN to set as AWS_DEPLOY_ROLE_ARN secret in GitHub Actions"
  value       = aws_iam_role.github_deploy.arn
}
