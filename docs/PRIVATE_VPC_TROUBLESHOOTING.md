# Private VPC Troubleshooting Guide

This guide provides solutions for common issues encountered when deploying and operating Bedrock Chat in private VPC mode.

## Table of Contents

- [VPC Endpoint Connectivity Issues](#vpc-endpoint-connectivity-issues)
- [DNS Resolution Problems](#dns-resolution-problems)
- [Lambda Function Issues](#lambda-function-issues)
- [Application Load Balancer Issues](#application-load-balancer-issues)
- [Authentication Problems](#authentication-problems)
- [Performance Issues](#performance-issues)
- [Deployment Failures](#deployment-failures)
- [Monitoring and Diagnostics](#monitoring-and-diagnostics)

## VPC Endpoint Connectivity Issues

### Issue: Lambda functions cannot connect to AWS services

**Symptoms:**
- Lambda function timeouts
- Connection refused errors
- SSL/TLS handshake failures

**Diagnosis:**
```bash
# Check VPC endpoint status
aws ec2 describe-vpc-endpoints --vpc-endpoint-ids vpce-12345678

# Check security group rules
aws ec2 describe-security-groups --group-ids sg-12345678
```

**Solutions:**

1. **Verify VPC Endpoint Status:**
   - Ensure all endpoints are in "Available" state
   - Check endpoint policy allows required actions
   - Verify endpoint is in correct subnets

2. **Security Group Configuration:**
   ```bash
   # Allow HTTPS traffic from Lambda security group
   aws ec2 authorize-security-group-ingress \
     --group-id sg-endpoint-12345678 \
     --protocol tcp \
     --port 443 \
     --source-group sg-lambda-12345678
   ```

3. **Route Table Verification:**
   - Ensure private subnets have routes to VPC endpoints
   - Check route table associations

### Issue: S3 Gateway Endpoint Not Working

**Symptoms:**
- S3 operations failing from Lambda
- "No route to host" errors for S3

**Solutions:**

1. **Check Route Table:**
   ```bash
   # Verify S3 gateway endpoint route exists
   aws ec2 describe-route-tables --route-table-ids rtb-12345678
   ```

2. **Update Route Table:**
   - Ensure S3 gateway endpoint is associated with private subnet route tables
   - Route should show destination as S3 prefix list

3. **IAM Permissions:**
   - Verify Lambda execution role has S3 permissions
   - Check VPC endpoint policy allows S3 actions

## DNS Resolution Problems

### Issue: Private domain names not resolving

**Symptoms:**
- "Name or service not known" errors
- Cannot access application via private domain
- VPC endpoint DNS not resolving

**Diagnosis:**
```bash
# Test DNS resolution from within VPC
nslookup app.bedrock-chat.internal
nslookup bedrock-runtime.us-east-1.amazonaws.com

# Check private hosted zone
aws route53 list-hosted-zones
aws route53 list-resource-record-sets --hosted-zone-id Z12345678
```

**Solutions:**

1. **Private Hosted Zone Configuration:**
   ```bash
   # Verify hosted zone is associated with VPC
   aws route53 get-hosted-zone --id Z12345678
   
   # Associate hosted zone with VPC if missing
   aws route53 associate-vpc-with-hosted-zone \
     --hosted-zone-id Z12345678 \
     --vpc VPCRegion=us-east-1,VPCId=vpc-12345678
   ```

2. **VPC DNS Settings:**
   ```bash
   # Enable DNS hostnames and resolution
   aws ec2 modify-vpc-attribute --vpc-id vpc-12345678 --enable-dns-hostnames
   aws ec2 modify-vpc-attribute --vpc-id vpc-12345678 --enable-dns-support
   ```

3. **VPC Endpoint Private DNS:**
   - Ensure private DNS is enabled for interface endpoints
   - Check endpoint DNS names in VPC console

### Issue: External DNS interference

**Symptoms:**
- AWS service calls going to public endpoints
- Intermittent connectivity issues

**Solutions:**

1. **Disable Public DNS:**
   - Configure Lambda functions to use VPC DNS only
   - Set custom DNS servers if needed

2. **DNS Caching:**
   - Implement DNS caching in Lambda functions
   - Use connection pooling with DNS caching

## Lambda Function Issues

### Issue: Lambda functions timing out in VPC

**Symptoms:**
- Function timeouts (30 seconds or configured timeout)
- Cold start issues
- ENI creation delays

**Solutions:**

1. **Increase Timeout:**
   ```typescript
   // In CDK construct
   new Function(this, 'MyFunction', {
     timeout: Duration.minutes(5), // Increase from default
     // ... other props
   });
   ```

2. **Provisioned Concurrency:**
   ```typescript
   // Add provisioned concurrency for critical functions
   const version = fn.currentVersion;
   new Alias(this, 'ProdAlias', {
     aliasName: 'prod',
     version,
     provisionedConcurrencyConfig: {
       provisionedConcurrentExecutions: 10,
     },
   });
   ```

3. **Connection Pooling:**
   ```python
   # In Lambda function code
   import boto3
   from botocore.config import Config
   
   # Configure connection pooling
   config = Config(
       max_pool_connections=50,
       retries={'max_attempts': 3}
   )
   
   # Reuse client across invocations
   bedrock_client = boto3.client('bedrock-runtime', config=config)
   ```

### Issue: ENI limits exceeded

**Symptoms:**
- "ENI limit exceeded" errors
- Lambda functions failing to start

**Solutions:**

1. **Request ENI Limit Increase:**
   - Submit AWS support case for ENI limit increase
   - Monitor ENI usage in VPC console

2. **Optimize Lambda Concurrency:**
   ```typescript
   // Set reserved concurrency to control ENI usage
   new Function(this, 'MyFunction', {
     reservedConcurrentExecutions: 100,
     // ... other props
   });
   ```

## Deployment Issues

### Issue: Getting CloudFront URL instead of private URL

**Symptoms:**
- Deployment shows CloudFront URL instead of private frontend URL
- `bin.sh` script shows public URL even with `--enable-private-vpc`
- Missing Private API URL in script output
- Script shows "No private VPC outputs found in logs"

**Root Cause:**
The most common cause is that the private VPC deployment wasn't actually enabled during the CDK deployment, even though the `--enable-private-vpc` flag was used.

**Diagnosis Steps:**

1. **Run the diagnostic script:**
   ```bash
   ./check-private-vpc.sh
   ```

2. **Check CloudFormation parameters:**
   ```bash
   # Verify EnablePrivateVpc parameter was set to true
   aws cloudformation describe-stacks \
     --stack-name CodeBuildForDeploy \
     --query 'Stacks[0].Parameters[?ParameterKey==`EnablePrivateVpc`]'
   ```

3. **Check if private VPC resources exist:**
   ```bash
   # Look for VPCs created by the stack
   aws ec2 describe-vpcs \
     --filters "Name=tag:aws:cloudformation:stack-name,Values=*BedrockChat*" \
     --query 'Vpcs[*].{VpcId:VpcId,CidrBlock:CidrBlock}'
   
   # Look for ALBs
   aws elbv2 describe-load-balancers \
     --query 'LoadBalancers[?contains(LoadBalancerName, `BedrockChat`)].{Name:LoadBalancerName,Scheme:Scheme}'
   ```

**Solutions:**

1. **Redeploy with explicit private VPC configuration:**
   ```bash
   # Clean redeploy with private VPC
   ./bin.sh --enable-private-vpc \
     --private-domain-name "bedrock-chat.internal" \
     --vpc-cidr "10.0.0.0/16"
   ```

2. **Verify the deployment script debug output:**
   The updated script now shows debug information:
   ```
   Debug: Private VPC parameters being passed to CloudFormation:
     EnablePrivateVpc: true
     VpcCidr: 10.0.0.0/16
     PrivateDomainName: bedrock-chat.internal
   ```

3. **Expected Output for Private VPC:**
   ```
   === Private VPC Deployment URLs ===
   Private Frontend URL: https://app.bedrock-chat.internal
   Private API URL: https://api.bedrock-chat.internal:8443
   ALB DNS Name (for debugging): internal-BedrockChat-ALB-123456789.us-east-1.elb.amazonaws.com
   ```

4. **Manual Output Check (if deployment succeeded):**
   ```bash
   # Get private frontend URL directly
   aws cloudformation describe-stacks \
     --stack-name BedrockChatStack \
     --query 'Stacks[0].Outputs[?OutputKey==`PrivateFrontendURL`].OutputValue' \
     --output text
   
   # Get private API URL directly
   aws cloudformation describe-stacks \
     --stack-name BedrockChatStack \
     --query 'Stacks[0].Outputs[?OutputKey==`PrivateApiURL`].OutputValue' \
     --output text
   ```

**If the issue persists:**
- The deployment likely created a public CloudFront deployment instead of private VPC
- You'll need to destroy the stack and redeploy with correct parameters
- Use `./check-private-vpc.sh` to verify the deployment type before proceeding

## Application Load Balancer Issues

### Issue: Cannot access ALB from private network

**Symptoms:**
- Connection timeouts to ALB
- "No route to host" errors

**Solutions:**

1. **Security Group Rules:**
   ```bash
   # Allow HTTPS traffic from your network
   aws ec2 authorize-security-group-ingress \
     --group-id sg-alb-12345678 \
     --protocol tcp \
     --port 443 \
     --cidr 10.0.0.0/8
   ```

2. **Network ACLs:**
   - Check subnet NACLs allow traffic
   - Ensure both inbound and outbound rules are configured

3. **Route Tables:**
   - Verify routing from your network to ALB subnets
   - Check VPN/Direct Connect routing

### Issue: ALB health checks failing

**Symptoms:**
- Targets showing as unhealthy
- 502/503 errors from ALB

**Solutions:**

1. **Health Check Configuration:**
   ```typescript
   // Adjust health check settings
   targetGroup.configureHealthCheck({
     path: '/health',
     intervalSecs: 30,
     timeoutSecs: 10,
     healthyThresholdCount: 2,
     unhealthyThresholdCount: 5,
   });
   ```

2. **Lambda Function Health:**
   - Ensure Lambda functions are responding to health checks
   - Check Lambda function logs for errors

## Authentication Problems

### Issue: Cognito authentication failing

**Symptoms:**
- Login redirects not working
- Token validation errors
- CORS issues

**Solutions:**

1. **Cognito VPC Endpoint:**
   - Verify Cognito VPC endpoint is working
   - Check security group allows Lambda to Cognito endpoint

2. **Redirect URIs:**
   ```bash
   # Update Cognito app client with private domain
   aws cognito-idp update-user-pool-client \
     --user-pool-id us-east-1_XXXXXXXXX \
     --client-id XXXXXXXXXXXXXXXXXXXXXXXXXX \
     --callback-urls "https://app.bedrock-chat.internal/oauth2/idpresponse"
   ```

### Issue: Entra ID federation not working

**Symptoms:**
- SAML/OIDC errors
- Metadata exchange failures
- User attribute mapping issues

**Solutions:**

1. **Metadata Configuration:**
   - Ensure Entra ID metadata is accessible
   - Update federation metadata URL if needed

2. **Network Connectivity:**
   - Verify connectivity to Entra ID endpoints
   - Check if additional VPC endpoints needed

3. **Attribute Mapping:**
   ```bash
   # Update identity provider attribute mapping
   aws cognito-idp update-identity-provider \
     --user-pool-id us-east-1_XXXXXXXXX \
     --provider-name EntraID \
     --attribute-mapping email=http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress
   ```

## Performance Issues

### Issue: Slow response times

**Symptoms:**
- High latency for API calls
- Slow page load times
- Timeout errors

**Solutions:**

1. **VPC Endpoint Optimization:**
   - Use multiple AZ endpoints for high availability
   - Monitor endpoint performance metrics

2. **Lambda Optimization:**
   ```python
   # Connection pooling and caching
   import functools
   import boto3
   
   @functools.lru_cache(maxsize=1)
   def get_bedrock_client():
       return boto3.client('bedrock-runtime')
   ```

3. **ALB Configuration:**
   - Enable connection draining
   - Optimize target group settings
   - Use appropriate instance types for targets

### Issue: High Lambda cold start times

**Solutions:**

1. **Provisioned Concurrency:**
   - Enable for frequently used functions
   - Monitor concurrency metrics

2. **Function Optimization:**
   - Minimize package size
   - Use Lambda layers for common dependencies
   - Optimize initialization code

## Deployment Failures

### Issue: CDK deployment fails

**Symptoms:**
- Stack creation/update failures
- Resource creation timeouts
- Dependency errors

**Solutions:**

1. **Check CloudFormation Events:**
   ```bash
   aws cloudformation describe-stack-events --stack-name BedrockChatStack
   ```

2. **Resource Limits:**
   - Check AWS service limits
   - Request limit increases if needed

3. **IAM Permissions:**
   - Ensure deployment role has required permissions
   - Check VPC endpoint policies

### Issue: VPC endpoint creation fails

**Solutions:**

1. **Service Availability:**
   - Verify service supports VPC endpoints in your region
   - Check service-specific requirements

2. **Subnet Configuration:**
   - Ensure subnets are in different AZs
   - Check subnet CIDR blocks don't conflict

## Monitoring and Diagnostics

### CloudWatch Metrics to Monitor

1. **VPC Endpoint Metrics:**
   - `AWS/VPC/VpcEndpoint` namespace
   - Connection count and data transfer

2. **Lambda Metrics:**
   - Duration, errors, throttles
   - ENI creation time

3. **ALB Metrics:**
   - Target response time
   - HTTP error rates
   - Active connections

### Diagnostic Commands

```bash
# Check VPC endpoint status
aws ec2 describe-vpc-endpoints --filters "Name=vpc-id,Values=vpc-12345678"

# Test connectivity from Lambda
aws lambda invoke --function-name test-connectivity response.json

# Check DNS resolution
dig @169.254.169.253 bedrock-runtime.us-east-1.amazonaws.com

# Monitor CloudWatch logs
aws logs tail /aws/lambda/function-name --follow
```

### Useful CloudWatch Log Insights Queries

```sql
-- Lambda function errors
fields @timestamp, @message
| filter @message like /ERROR/
| sort @timestamp desc
| limit 100

-- VPC endpoint connection issues
fields @timestamp, @message
| filter @message like /connection/
| stats count() by bin(5m)
```

## Best Practices for Prevention

1. **Infrastructure as Code:**
   - Use CDK/CloudFormation for consistent deployments
   - Version control all configuration

2. **Monitoring:**
   - Set up CloudWatch alarms for key metrics
   - Implement health checks for all components

3. **Testing:**
   - Test deployments in non-production environments
   - Validate connectivity after changes

4. **Documentation:**
   - Document network architecture
   - Maintain runbooks for common issues

5. **Security:**
   - Regular security group audits
   - Principle of least privilege for all resources

## Getting Help

If you continue to experience issues:

1. **AWS Support:**
   - Open support case with detailed error messages
   - Include CloudFormation stack events and CloudWatch logs

2. **Community:**
   - Check GitHub issues for similar problems
   - Post detailed issue description with logs

3. **AWS Documentation:**
   - VPC Endpoints User Guide
   - Lambda VPC Configuration Guide
   - Application Load Balancer User Guide