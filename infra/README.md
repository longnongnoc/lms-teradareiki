# Infra runbook (Frappe LMS test deployment on AWS)

One EC2 (AL2023, t3.small) in ap-northeast-1 behind an Elastic IP, with a Route53
A record, S3 backup bucket, daily EBS snapshots (DLM), CloudWatch alarms and a
read-only-plus-deploy CI IAM user. No SSH: use SSM Session Manager.

Layout:
- `terraform/bootstrap`: S3 state bucket, local state, applied once.
- `terraform/`: main stack, remote state in that bucket.

## 1. Bootstrap (once)

    cd infra/terraform/bootstrap
    terraform init
    terraform apply
    terraform output tfstate_bucket

The bucket has `prevent_destroy`. Keep the small local `terraform.tfstate` here.

## 2. Main stack

    cd infra/terraform
    cp backend.hcl.example backend.hcl        # set the bucket name
    cp terraform.tfvars.example terraform.tfvars   # set alert_email
    terraform init -backend-config=backend.hcl
    terraform plan
    terraform apply

First boot runs `user_data.sh.tftpl`, which installs Docker, writes `/opt/lms/.env`,
starts the CloudWatch agent and runs `deploy/scripts/deploy.sh <deploy_ref>`.
Log: `/var/log/lms-bootstrap.log` on the instance. `user_data` and `ami` changes are
ignored after creation, so later deploys go through SSM (CI) and not re-creation.

## 3. Outputs

`terraform output` shows instance_id, elastic_ip, domain_name, backup_bucket,
ssm_db_root_password_param, ssm_admin_password_param, tfstate_bucket,
ci_access_key_id. The CI secret: `terraform output -raw ci_secret_access_key`.

Read the admin password:

    aws ssm get-parameter --name /terada-lms/admin_password --with-decryption \
      --query Parameter.Value --output text --region ap-northeast-1

Shell on the instance: `aws ssm start-session --target <instance_id>`.

## 4. Notes

- SNS: AWS sends a confirmation mail to `alert_email`; alarms are silent until the
  link is clicked.
- CI user `terada-lms-ci`: AWS ReadOnlyAccess, SSM SendCommand to this instance,
  and access to the tfstate bucket so `terraform plan` can take the lock file.
  It cannot apply. Apply stays manual.
- Passwords are random and stored in SSM SecureString; they also live in Terraform
  state, so keep the state bucket private.
- Snapshots: DLM at 18:00 UTC (03:00 JST) for volumes tagged `Snapshot=true`.

## 5. Destroy

    cd infra/terraform
    terraform destroy

The backup bucket must be emptied first (`aws s3 rm s3://<backup_bucket> --recursive`),
and DLM snapshots already taken are not deleted by Terraform. The bootstrap bucket is
protected: remove `prevent_destroy`, empty all versions, then destroy it by hand.
