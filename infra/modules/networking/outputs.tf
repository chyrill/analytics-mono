output "subnet_ids" {
  description = "Private subnet IDs for Lambda VPC attachment and RDS subnet group"
  value       = [aws_subnet.private_a.id, aws_subnet.private_b.id]
}

output "lambda_sg_id" {
  description = "Security group ID to attach to all analytics Lambda functions"
  value       = aws_security_group.analytics_lambda.id
}

output "nat_gateway_id" {
  value = aws_nat_gateway.main.id
}

output "nat_public_ip" {
  description = "Public IP of the NAT gateway - whitelist this at external APIs if needed"
  value       = var.nat_eip_allocation_id != "" ? data.aws_eip.nat[0].public_ip : aws_eip.nat[0].public_ip
}
