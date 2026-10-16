data "aws_ssm_parameter" "al2023_ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

resource "aws_instance" "lms" {
  ami                    = data.aws_ssm_parameter.al2023_ami.value
  instance_type          = var.instance_type
  subnet_id              = sort(data.aws_subnets.default.ids)[0]
  vpc_security_group_ids = [aws_security_group.lms.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    domain                     = var.domain_name
    aws_region                 = var.aws_region
    backup_bucket              = aws_s3_bucket.backup.bucket
    lms_image                  = var.lms_image
    ssm_db_root_password_param = aws_ssm_parameter.db_root_password.name
    ssm_admin_password_param   = aws_ssm_parameter.admin_password.name
    repo_url                   = var.repo_url
    deploy_ref                 = var.deploy_ref
    acme_email                 = var.alert_email
  })

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = var.root_volume_gb
    encrypted   = true
  }

  tags = {
    Name     = var.project
    Snapshot = "true"
  }

  volume_tags = {
    Name     = var.project
    Snapshot = "true"
  }

  lifecycle {
    ignore_changes = [ami, user_data]
  }
}

resource "aws_eip" "lms" {
  domain = "vpc"

  tags = {
    Name = var.project
  }
}

resource "aws_eip_association" "lms" {
  instance_id   = aws_instance.lms.id
  allocation_id = aws_eip.lms.id
}
