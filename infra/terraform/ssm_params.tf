resource "random_password" "db_root" {
  length  = 24
  special = false
}

resource "random_password" "admin" {
  length  = 24
  special = false
}

resource "aws_ssm_parameter" "db_root_password" {
  name  = "/${var.project}/db_root_password"
  type  = "SecureString"
  value = random_password.db_root.result
}

resource "aws_ssm_parameter" "admin_password" {
  name  = "/${var.project}/admin_password"
  type  = "SecureString"
  value = random_password.admin.result
}
