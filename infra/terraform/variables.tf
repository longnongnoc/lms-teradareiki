variable "aws_region" {
  type    = string
  default = "ap-northeast-1"
}

variable "project" {
  type    = string
  default = "terada-lms"
}

variable "domain_name" {
  type    = string
  default = "terada-lms.launch-mate.com"
}

variable "hosted_zone_name" {
  type    = string
  default = "launch-mate.com"
}

variable "instance_type" {
  type    = string
  default = "t3.small"
}

variable "root_volume_gb" {
  type    = number
  default = 30
}

variable "alert_email" {
  type        = string
  description = "Receives CloudWatch alarm mail and is used as the ACME contact."
}

variable "repo_url" {
  type    = string
  default = "https://github.com/longnongnoc/lms-teradareiki.git"
}

variable "deploy_ref" {
  type    = string
  default = "develop"
}

variable "lms_image" {
  type    = string
  default = "ghcr.io/longnongnoc/terada-lms:v2.65.0"
}

variable "backup_retention_days" {
  type    = number
  default = 30
}

variable "snapshot_retention" {
  type    = number
  default = 7
}
