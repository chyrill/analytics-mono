# Derive the VPC ID from the first provided subnet
data "aws_subnet" "primary" {
  id = var.vpc_subnet_ids[0]
}

# ── RDS Security Group ─────────────────────────────────────────────────────────
# Allows inbound PostgreSQL only from the Lambda security groups

resource "aws_security_group" "rds" {
  name        = "${var.service_name}-${var.stage}-rds-sg"
  description = "Analytics RDS PostgreSQL - inbound from Lambda only"
  vpc_id      = data.aws_subnet.primary.vpc_id

  ingress {
    description     = "PostgreSQL from Lambda"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = var.lambda_security_group_ids
  }

  # Admin access for DBeaver/psql via SSM port-forwarding through the existing
  # "worker-instance" EC2 (sg-0cfddf7d948d266d8), which is already registered
  # with SSM Session Manager. No inbound SSH/internet exposure required.
  ingress {
    description     = "PostgreSQL from worker-instance (SSM tunnel for admin DB access)"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = ["sg-0cfddf7d948d266d8"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "${var.service_name}-${var.stage}-rds-sg"
    Stage   = var.stage
    Service = var.service_name
  }
}

# ── DB Subnet Group ────────────────────────────────────────────────────────────

resource "aws_db_subnet_group" "analytics" {
  name       = "${var.service_name}-${var.stage}-subnet-group"
  subnet_ids = var.vpc_subnet_ids

  tags = {
    Name    = "${var.service_name}-${var.stage}-subnet-group"
    Stage   = var.stage
    Service = var.service_name
  }
}

# ── RDS PostgreSQL Instance ────────────────────────────────────────────────────

resource "aws_db_instance" "analytics" {
  identifier     = "${var.service_name}-${var.stage}"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.instance_class

  allocated_storage = var.allocated_storage
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = var.db_name
  username = var.db_username
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.analytics.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  # Backups — daily, 7-day retention, window in off-peak AEST hours
  backup_retention_period = 7
  backup_window           = "17:00-18:00" # 03:00–04:00 AEST
  maintenance_window      = "sun:18:00-sun:19:00"

  auto_minor_version_upgrade = true
  deletion_protection        = true
  skip_final_snapshot        = false
  final_snapshot_identifier  = "${var.service_name}-${var.stage}-final-snapshot"

  tags = {
    Name    = "${var.service_name}-${var.stage}"
    Stage   = var.stage
    Service = var.service_name
  }
}
