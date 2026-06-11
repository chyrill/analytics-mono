output "function_names" {
  description = "Map of worker key to Lambda function name"
  value = {
    for k, v in local.workers :
    k => aws_lambda_function.worker[k].function_name
  }
}

output "schedule_rule_arns" {
  description = "Map of worker key to EventBridge rule ARN"
  value = {
    for k, v in local.workers :
    k => aws_cloudwatch_event_rule.worker[k].arn
  }
}
