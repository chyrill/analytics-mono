# ── Look up existing VPC ───────────────────────────────────────────────────────

data "aws_vpc" "main" {
  id = var.vpc_id
}

# ── EIP + NAT Gateway ─────────────────────────────────────────────────────────
# Placed in the existing public subnet so private subnets can reach the internet
# (needed for Lambda egress to Zoho, Saleor, etc.)

# Use an existing EIP to avoid hitting account limits (create one only if no allocation_id provided)
resource "aws_eip" "nat" {
  count  = var.nat_eip_allocation_id == "" ? 1 : 0
  domain = "vpc"

  tags = {
    Name    = "${var.service_name}-${var.stage}-nat-eip"
    Stage   = var.stage
    Service = var.service_name
  }
}

data "aws_eip" "nat" {
  count = var.nat_eip_allocation_id != "" ? 1 : 0
  id    = var.nat_eip_allocation_id
}

locals {
  nat_eip_allocation_id = var.nat_eip_allocation_id != "" ? data.aws_eip.nat[0].id : aws_eip.nat[0].id
}

resource "aws_nat_gateway" "main" {
  allocation_id = local.nat_eip_allocation_id
  subnet_id     = var.public_subnet_id

  tags = {
    Name    = "${var.service_name}-${var.stage}-nat"
    Stage   = var.stage
    Service = var.service_name
  }
}

# ── Private Subnets ────────────────────────────────────────────────────────────

resource "aws_subnet" "private_a" {
  vpc_id                  = data.aws_vpc.main.id
  cidr_block              = var.subnet_cidr_az_a
  availability_zone       = "ap-southeast-2a"
  map_public_ip_on_launch = false

  tags = {
    Name    = "${var.service_name}-${var.stage}-private-a"
    Stage   = var.stage
    Service = var.service_name
  }
}

resource "aws_subnet" "private_b" {
  vpc_id                  = data.aws_vpc.main.id
  cidr_block              = var.subnet_cidr_az_b
  availability_zone       = "ap-southeast-2b"
  map_public_ip_on_launch = false

  tags = {
    Name    = "${var.service_name}-${var.stage}-private-b"
    Stage   = var.stage
    Service = var.service_name
  }
}

# ── Private Route Table ────────────────────────────────────────────────────────

resource "aws_route_table" "private" {
  vpc_id = data.aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }

  tags = {
    Name    = "${var.service_name}-${var.stage}-private-rt"
    Stage   = var.stage
    Service = var.service_name
  }
}

resource "aws_route_table_association" "private_a" {
  subnet_id      = aws_subnet.private_a.id
  route_table_id = aws_route_table.private.id
}

resource "aws_route_table_association" "private_b" {
  subnet_id      = aws_subnet.private_b.id
  route_table_id = aws_route_table.private.id
}

# ── Analytics Lambda Security Group ───────────────────────────────────────────

resource "aws_security_group" "analytics_lambda" {
  name        = "${var.service_name}-${var.stage}-lambda-sg"
  description = "Analytics Lambda functions - controls egress to RDS and internet"
  vpc_id      = data.aws_vpc.main.id

  # Egress: PostgreSQL within the VPC (analytics RDS + doc-app RDS)
  egress {
    description = "PostgreSQL within VPC"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.main.cidr_block]
  }

  # Egress: HTTPS for external APIs (Zoho CRM, Saleor GraphQL, AWS services)
  egress {
    description = "HTTPS to internet"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "${var.service_name}-${var.stage}-lambda-sg"
    Stage   = var.stage
    Service = var.service_name
  }
}

# ── Allow analytics Lambda → doc-app production RDS ───────────────────────────
# Adds an ingress rule to the existing "postgresqlDB" security group (sg-0b4a38ab820931d00)
# so the analytics Lambda can query myproddb for the doc-app sync.

resource "aws_vpc_security_group_ingress_rule" "docapp_rds_from_analytics" {
  security_group_id            = var.docapp_rds_security_group_id
  referenced_security_group_id = aws_security_group.analytics_lambda.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "Analytics ${var.stage} Lambda to doc-app RDS"

  tags = {
    Stage   = var.stage
    Service = var.service_name
  }
}
