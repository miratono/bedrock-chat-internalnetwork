# Private VPC Quick Reference Guide

This quick reference provides common deployment scenarios, troubleshooting commands, and configuration examples for Bedrock Chat private VPC deployment.

## Quick Deployment Commands

### New VPC Deployment
```bash
# Basic private VPC deployment
./bin.sh --enable-private-vpc

# Custom CIDR and domain
./bin.sh --enable-private-vpc \
  --vpc-cidr "172.16.0.0/16" \
  --private-domain-name "chat.company.internal"

# With Entra ID integration
./bin.sh --enable-private-vpc \
  --vpc-cidr "10.0.0.0/16" \
  --private-domain-name "bedrock-chat.internal" \
  --entra-id-tenant-id "your-tenant-id" \
  --entra-id-client-id "your-client-id"
```

### Existing VPC Deployment
```bash
# Use existing VPC and subnets
./bin.sh --enable-private-vpc \
  --existing-vpc-id "vpc-12345678" \
  --existing-private-subnet-ids "subnet-12345678,subnet-87654321,subnet-11223344" \
  --private-domain-name "bedrock-chat.internal"
```

## Common Configuration Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `--enable-private-vpc` | Enable private VPC mode | Required flag |
| `--vpc-cidr` | CIDR for new VPC | `10.0.0.0/16` |
| `--existing-vpc-id` | Existing VPC ID | `vpc-12345678` |
| `--existing-private-subnet-ids` | Existing subnet IDs | `subnet-123,subnet-456` |
| `--private-domain-name` | Private domain name | `chat.company.internal` |
| `--entra-id-tenant-id` | Entra ID tenant | `tenant-uuid` |
| `--entra-id-client-id` | Entra ID client | `client-uuid` |

## Accessing Your Private Deployment

### URLs
After deployment, you'll get these URLs:
- **Frontend**: `https://app.your-domain.internal` (default: `https://app.bedrock-chat.internal`)
- **API**: `https://api.your-domain.internal:8443` (default: `https://api.bedrock-chat.internal:8443`)

### Getting URLs from Deployment
The `bin.sh` script now shows both URLs:
```
=== Private VPC Deployment URLs ===
Private Frontend URL: https://app.bedrock-chat.internal
Private API URL: https://api.bedrock-chat.internal:8443
ALB DNS Name (for debugging): internal-BedrockChat-ALB-123456789.us-east-1.elb.amazonaws.com
```

### Manual URL Retrieval
```bash
# Get private frontend URL
aws cloudformation describe-stacks \
  --stack-name BedrockChatStack \
  --query 'Stacks[0].Outputs[?OutputKey==`PrivateFrontendURL`].OutputValue' \
  --output text

# Get private API URL
aws cloudformation describe-stacks \
  --stack-name BedrockChatStack \
  --query 'Stacks[0].Outputs[?OutputKey==`PrivateApiURL`].OutputValue' \
  --output text
```

## Quick Diagnostics

### Check Deployment Status
```bash
# CloudFormation stack status
aws cloudformation describe-stacks --stack-name BedrockChatStack

# Get stack outputs
aws cloudformation describe-stacks \
  --stack-name BedrockChatStack \
  --query 'Stacks[0].Outputs'
```

### Test Connectivity
```bash
# DNS resolution
nslookup app.bedrock-chat.internal
nslookup api.bedrock-chat.internal

# Application health check
curl -k https://app.bedrock-chat.internal/health

# VPC endpoint status
aws ec2 describe-vpc-endpoints \
  --filters "Name=vpc-id,Values=vpc-12345678"
```

### Check Lambda Functions
```bash
# List Lambda functions
aws lambda list-functions \
  --query 'Functions[?contains(FunctionName, `bedrock-chat`)]'

# Check function configuration
aws lambda get-function-configuration \
  --function-name bedrock-chat-api

# View recent logs
aws logs tail /aws/lambda/bedrock-chat-api --follow
```

## Common Issues and Quick Fixes

### Issue: Cannot access application
```bash
# Check ALB status
aws elbv2 describe-load-balancers \
  --names bedrock-chat-private-alb

# Check target health
aws elbv2 describe-target-health \
  --target-group-arn arn:aws:elasticloadbalancing:...
```

### Issue: Lambda timeouts
```bash
# Increase timeout
aws lambda update-function-configuration \
  --function-name bedrock-chat-api \
  --timeout 300

# Check ENI status
aws ec2 describe-network-interfaces \
  --filters "Name=description,Values=*lambda*"
```

### Issue: VPC endpoint connectivity
```bash
# Check endpoint status
aws ec2 describe-vpc-endpoints \
  --vpc-endpoint-ids vpce-12345678

# Test endpoint connectivity
aws bedrock-runtime list-foundation-models \
  --region us-east-1
```

## Security Group Quick Reference

### VPC Endpoint Security Group
```bash
# Allow HTTPS from private subnets
aws ec2 authorize-security-group-ingress \
  --group-id sg-endpoint-12345678 \
  --protocol tcp \
  --port 443 \
  --cidr 10.0.0.0/16
```

### Lambda Security Group
```bash
# Allow outbound HTTPS to VPC endpoints
aws ec2 authorize-security-group-egress \
  --group-id sg-lambda-12345678 \
  --protocol tcp \
  --port 443 \
  --cidr 10.0.0.0/16
```

### ALB Security Group
```bash
# Allow HTTPS from corporate network
aws ec2 authorize-security-group-ingress \
  --group-id sg-alb-12345678 \
  --protocol tcp \
  --port 443 \
  --cidr 192.168.0.0/16
```

## Monitoring Commands

### CloudWatch Metrics
```bash
# VPC endpoint metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/VPC \
  --metric-name PacketsDropped \
  --dimensions Name=VpcEndpointId,Value=vpce-12345678 \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-01T01:00:00Z \
  --period 300 \
  --statistics Sum

# Lambda metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=bedrock-chat-api \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-01T01:00:00Z \
  --period 300 \
  --statistics Average
```

### Log Analysis
```bash
# Search Lambda logs for errors
aws logs filter-log-events \
  --log-group-name /aws/lambda/bedrock-chat-api \
  --filter-pattern "ERROR"

# VPC Flow Logs
aws logs filter-log-events \
  --log-group-name /aws/vpc/flowlogs \
  --filter-pattern "REJECT"
```

## Performance Optimization

### Lambda Optimization
```bash
# Enable provisioned concurrency
aws lambda put-provisioned-concurrency-config \
  --function-name bedrock-chat-api \
  --qualifier $LATEST \
  --provisioned-concurrency-config ProvisionedConcurrencyConfig=10

# Update memory allocation
aws lambda update-function-configuration \
  --function-name bedrock-chat-api \
  --memory-size 1024
```

### Connection Pooling Example
```python
# Lambda function optimization
import boto3
from botocore.config import Config
import functools

@functools.lru_cache(maxsize=1)
def get_bedrock_client():
    config = Config(
        max_pool_connections=50,
        retries={'max_attempts': 3, 'mode': 'adaptive'}
    )
    return boto3.client('bedrock-runtime', config=config)
```

## Cost Monitoring

### VPC Endpoint Costs
```bash
# Get cost and usage data
aws ce get-cost-and-usage \
  --time-period Start=2024-01-01,End=2024-01-31 \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --group-by Type=DIMENSION,Key=SERVICE
```

### Resource Tagging for Cost Allocation
```bash
# Tag VPC endpoints
aws ec2 create-tags \
  --resources vpce-12345678 \
  --tags Key=CostCenter,Value=Engineering Key=Environment,Value=Production
```

## Backup and Recovery

### Configuration Backup
```bash
# Export VPC configuration
aws ec2 describe-vpcs --vpc-ids vpc-12345678 > vpc-config.json

# Export security groups
aws ec2 describe-security-groups \
  --filters "Name=vpc-id,Values=vpc-12345678" > security-groups.json

# Export route tables
aws ec2 describe-route-tables \
  --filters "Name=vpc-id,Values=vpc-12345678" > route-tables.json
```

### DynamoDB Backup
```bash
# Create on-demand backup
aws dynamodb create-backup \
  --table-name bedrock-chat-conversations \
  --backup-name "bedrock-chat-backup-$(date +%Y%m%d)"
```

## Cleanup Commands

### Remove Deployment
```bash
# Destroy CDK stack
npx cdk destroy --all

# Or via CloudFormation
aws cloudformation delete-stack --stack-name BedrockChatStack
```

### Clean Up Resources
```bash
# Delete VPC endpoints (if not managed by CloudFormation)
aws ec2 delete-vpc-endpoint --vpc-endpoint-id vpce-12345678

# Delete security groups
aws ec2 delete-security-group --group-id sg-12345678
```

## Environment-Specific Configurations

### Development Environment
```bash
./bin.sh --enable-private-vpc \
  --vpc-cidr "10.1.0.0/16" \
  --private-domain-name "dev.bedrock-chat.internal" \
  --cdk-json-override '{
    "context": {
      "enableRagReplicas": false,
      "enableBotStoreReplicas": false
    }
  }'
```

### Production Environment
```bash
./bin.sh --enable-private-vpc \
  --vpc-cidr "10.0.0.0/16" \
  --private-domain-name "bedrock-chat.internal" \
  --cdk-json-override '{
    "context": {
      "enableRagReplicas": true,
      "enableBotStoreReplicas": true,
      "enableLambdaSnapStart": true
    }
  }'
```

## Emergency Procedures

### Scale Up During High Load
```bash
# Increase Lambda concurrency
aws lambda put-reserved-concurrency-config \
  --function-name bedrock-chat-api \
  --reserved-concurrent-executions 200

# Add provisioned concurrency
aws lambda put-provisioned-concurrency-config \
  --function-name bedrock-chat-api \
  --qualifier $LATEST \
  --provisioned-concurrency-config ProvisionedConcurrencyConfig=50
```

### Emergency Access
```bash
# Create temporary bastion host
aws ec2 run-instances \
  --image-id ami-12345678 \
  --instance-type t3.micro \
  --subnet-id subnet-12345678 \
  --security-group-ids sg-bastion-12345678 \
  --key-name my-key-pair
```

This quick reference should be kept updated with your specific deployment details and commonly used commands.