output "instance_id" {
  value = aws_instance.lms.id
}

output "elastic_ip" {
  value = aws_eip.lms.public_ip
}

output "domain_name" {
  value = var.domain_name
}

output "backup_bucket" {
  value = aws_s3_bucket.backup.bucket
}

output "ssm_db_root_password_param" {
  value = aws_ssm_parameter.db_root_password.name
}

output "ssm_admin_password_param" {
  value = aws_ssm_parameter.admin_password.name
}

output "tfstate_bucket" {
  value = local.tfstate_bucket
}

output "ci_access_key_id" {
  value = aws_iam_access_key.ci.id
}

output "ci_secret_access_key" {
  value     = aws_iam_access_key.ci.secret
  sensitive = true
}
