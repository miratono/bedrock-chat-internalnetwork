# Private VPC Deployment Best Practices

This guide provides best practices for deploying and operating Bedrock Chat in private VPC mode, covering security, performance, cost optimization, and operational excellence.

## Table of Contents

- [Security Best Practices](#security-best-practices)
- [Performance Optimization](#performance-optimization)
- [Cost Optimization](#cost-optimization)
- [Network Design](#network-design)
- [Monitoring and Observability](#monitoring-and-observability)
- [Disaster Recovery](#disaster-recovery)
- [Operational Excellence](#operational-excellence)

## Security Best Practices

### Network Isolation

**Principle of Least Privilege:**
```typescript
// Example: Restrictive security group for VPC endpoints
const endpointSecurityGroup = new SecurityGroup(this, 'EndpointSG', {
  vpc: vpc,
  description: 'Security group for VPC endpoints',
  allowAllOutbound: false, // Explicit outbound rules only
});

// Allow HTTPS only from application subnets
endpointSecurityGroup.addIngressRule(
  Peer.ipv4('10.0.1.0/24'), // Private subnet 1
  Port.tcp(443),
  'HTTPS from private subnet 1'
);
```

**Security Group Segmentation:**
- Separate security groups for each component (ALB, Lambda, VPC endpoints)
- No overly permissive rules (avoid 0.0.0.0/0)
- Regular security group audits

**VPC Endpoint Policies:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "aws:PrincipalVpc": "vpc-12345678"
        }
      }
    }
  ]
}
```

### Access Control

**Multi-Factor Authentication:**
- Enable MFA for all administrative access
- Use temporary credentials for deployment
- Implement break-glass procedures

**IAM Role Separation:**
```typescript
// Separate roles for different functions
const lambdaRole = new Role(this, 'LambdaExecutionRole', {
  assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
  managedPolicies: [
    ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole')
  ],
});

// Add only required permissions
lambdaRole.addToPolicy(new PolicyStatement({
  effect: Effect.ALLOW,
  actions: ['bedrock:InvokeModel'],
  resources: ['*'],
}));
```

**Certificate Management:**
- Use AWS Certificate Manager for SSL certificates
- Implement certificate rotation procedures
- Monitor certificate expiration

### Data Protection

**Encryption in Transit:**
- TLS 1.2+ for all communications
- End-to-end encryption between components
- VPC endpoint encryption enabled

**Encryption at Rest:**
- Enable DynamoDB encryption
- S3 bucket encryption with KMS
- CloudWatch Logs encryption

**Data Classification:**
- Classify data based on sensitivity
- Implement appropriate retention policies
- Regular data access audits

## Performance Optimization

### Lambda Function Optimization

**Connection Pooling:**
```python
import boto3
from botocore.config import Config
import functools

# Global client with connection pooling
@functools.lru_cache(maxsize=1)
def get_bedrock_client():
    config = Config(
        max_pool_connections=50,
        retries={
            'max_attempts': 3,
            'mode': 'adaptive'
        }
    )
    return boto3.client('bedrock-runtime', config=config)

def lambda_handler(event, context):
    client = get_bedrock_client()
    # Use client for requests
```

**Memory and Timeout Optimization:**
```typescript
new Function(this, 'ChatFunction', {
  runtime: Runtime.PYTHON_3_11,
  memorySize: 1024, // Optimize based on profiling
  timeout: Duration.minutes(5), // Account for VPC cold starts
  reservedConcurrentExecutions: 100, // Control ENI usage
});
```

**Provisioned Concurrency for Critical Functions:**
```typescript
const version = chatFunction.currentVersion;
new Alias(this, 'ProdAlias', {
  aliasName: 'prod',
  version,
  provisionedConcurrencyConfig: {
    provisionedConcurrentExecutions: 10,
  },
});
```

### VPC Endpoint Optimization

**Multi-AZ Deployment:**
```typescript
// Deploy endpoints across multiple AZs
const vpcEndpoint = new InterfaceVpcEndpoint(this, 'BedrockEndpoint', {
  vpc: vpc,
  service: InterfaceVpcEndpointAwsService.BEDROCK_RUNTIME,
  subnets: {
    subnetType: SubnetType.PRIVATE_WITH_EGRESS,
  },
  privateDnsEnabled: true,
});
```

**Endpoint Monitoring:**
- Monitor endpoint connection metrics
- Set up CloudWatch alarms for endpoint failures
- Implement health checks

### Application Load Balancer Optimization

**Target Group Configuration:**
```typescript
const targetGroup = new ApplicationTargetGroup(this, 'ApiTargetGroup', {
  targetType: TargetType.LAMBDA,
  targets: [new LambdaTarget(apiFunction)],
  healthCheck: {
    enabled: true,
    path: '/health',
    interval: Duration.seconds(30),
    timeout: Duration.seconds(10),
    healthyThresholdCount: 2,
    unhealthyThresholdCount: 5,
  },
});
```

**Connection Settings:**
- Enable connection draining
- Optimize idle timeout settings
- Configure appropriate deregistration delay

## Cost Optimization

### VPC Endpoint Cost Management

**Endpoint Consolidation:**
- Use shared endpoints where possible
- Evaluate endpoint usage patterns
- Remove unused endpoints

**Gateway vs Interface Endpoints:**
```typescript
// Use Gateway endpoint for S3 (no hourly charges)
const s3GatewayEndpoint = new GatewayVpcEndpoint(this, 'S3Gateway', {
  vpc: vpc,
  service: GatewayVpcEndpointAwsService.S3,
});

// Use Interface endpoints only when necessary
const bedrockEndpoint = new InterfaceVpcEndpoint(this, 'BedrockEndpoint', {
  vpc: vpc,
  service: InterfaceVpcEndpointAwsService.BEDROCK_RUNTIME,
  // Only in required subnets
  subnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
});
```

**Cost Monitoring:**
```typescript
// Set up cost alerts
new Alarm(this, 'VpcEndpointCostAlarm', {
  metric: new Metric({
    namespace: 'AWS/Billing',
    metricName: 'EstimatedCharges',
    dimensionsMap: {
      ServiceName: 'Amazon VPC',
    },
  }),
  threshold: 500, // Monthly cost threshold
  evaluationPeriods: 1,
});
```

### Lambda Cost Optimization

**Right-sizing Functions:**
- Profile memory usage and optimize
- Use AWS Lambda Power Tuning tool
- Monitor cost per invocation

**Concurrency Management:**
```typescript
// Set reserved concurrency to control costs
new Function(this, 'ChatFunction', {
  reservedConcurrentExecutions: 50, // Prevent runaway costs
  // ... other props
});
```

### Infrastructure Cost Optimization

**Resource Tagging:**
```typescript
// Tag all resources for cost allocation
Tags.of(this).add('Environment', 'production');
Tags.of(this).add('Application', 'bedrock-chat');
Tags.of(this).add('CostCenter', 'engineering');
```

**Automated Cost Reports:**
- Set up AWS Cost Explorer reports
- Implement cost anomaly detection
- Regular cost optimization reviews

## Network Design

### Subnet Design

**Multi-AZ Architecture:**
```typescript
const vpc = new Vpc(this, 'PrivateVpc', {
  cidr: '10.0.0.0/16',
  maxAzs: 3,
  subnetConfiguration: [
    {
      name: 'Private',
      subnetType: SubnetType.PRIVATE_ISOLATED,
      cidrMask: 24,
    },
  ],
  enableDnsHostnames: true,
  enableDnsSupport: true,
});
```

**CIDR Planning:**
- Plan for future growth
- Avoid overlapping with on-premises networks
- Reserve space for additional subnets

### Route Table Design

**Explicit Routing:**
```typescript
// Create explicit route tables
const privateRouteTable = new RouteTable(this, 'PrivateRouteTable', {
  vpc: vpc,
});

// Associate with private subnets
vpc.privateSubnets.forEach((subnet, index) => {
  new SubnetRouteTableAssociation(this, `PrivateRTAssoc${index}`, {
    subnet: subnet,
    routeTable: privateRouteTable,
  });
});
```

### DNS Design

**Private Hosted Zone:**
```typescript
const privateZone = new PrivateHostedZone(this, 'PrivateZone', {
  zoneName: 'bedrock-chat.internal',
  vpc: vpc,
});

// Create DNS records for services
new ARecord(this, 'AppRecord', {
  zone: privateZone,
  recordName: 'app',
  target: RecordTarget.fromAlias(new LoadBalancerTarget(alb)),
});
```

## Monitoring and Observability

### CloudWatch Metrics

**Custom Metrics:**
```python
import boto3

cloudwatch = boto3.client('cloudwatch')

def put_custom_metric(metric_name, value, unit='Count'):
    cloudwatch.put_metric_data(
        Namespace='BedrockChat/PrivateVPC',
        MetricData=[
            {
                'MetricName': metric_name,
                'Value': value,
                'Unit': unit,
                'Dimensions': [
                    {
                        'Name': 'Environment',
                        'Value': 'production'
                    }
                ]
            }
        ]
    )
```

**Key Metrics to Monitor:**
- VPC endpoint connection count
- Lambda function duration and errors
- ALB response times and error rates
- ENI creation/deletion times

### Logging Strategy

**Centralized Logging:**
```typescript
// Enable VPC Flow Logs
new FlowLog(this, 'VpcFlowLog', {
  resourceType: FlowLogResourceType.fromVpc(vpc),
  destination: FlowLogDestination.toCloudWatchLogs(logGroup),
});

// Lambda function logging
new Function(this, 'ChatFunction', {
  logRetention: RetentionDays.ONE_MONTH,
  // ... other props
});
```

**Log Analysis:**
```sql
-- CloudWatch Insights query for VPC endpoint issues
fields @timestamp, @message
| filter @message like /VPC endpoint/
| stats count() by bin(5m)
| sort @timestamp desc
```

### Alerting

**Critical Alerts:**
```typescript
// VPC endpoint failure alert
new Alarm(this, 'VpcEndpointFailure', {
  metric: vpcEndpoint.metricConnectionAttempts(),
  threshold: 10,
  evaluationPeriods: 2,
  treatMissingData: TreatMissingData.BREACHING,
});

// Lambda error rate alert
new Alarm(this, 'LambdaErrorRate', {
  metric: lambdaFunction.metricErrors({
    period: Duration.minutes(5),
  }),
  threshold: 5,
  evaluationPeriods: 2,
});
```

## Disaster Recovery

### Backup Strategy

**Configuration Backup:**
- Version control all infrastructure code
- Regular configuration snapshots
- Document manual configuration steps

**Data Backup:**
```typescript
// DynamoDB point-in-time recovery
new Table(this, 'ConversationTable', {
  pointInTimeRecovery: true,
  // ... other props
});
```

### Multi-Region Considerations

**Cross-Region Replication:**
- Consider DynamoDB Global Tables for multi-region
- S3 cross-region replication for assets
- Route53 health checks for failover

**Regional Failover:**
```typescript
// Health check for primary region
new HealthCheck(this, 'PrimaryRegionHealthCheck', {
  type: HealthCheckType.HTTPS,
  resourcePath: '/health',
  fqdn: 'app.bedrock-chat.internal',
});
```

### Recovery Procedures

**Automated Recovery:**
- Auto Scaling for Lambda concurrency
- ALB health checks for automatic failover
- CloudWatch alarms for automated responses

**Manual Recovery Procedures:**
1. Document step-by-step recovery procedures
2. Regular disaster recovery testing
3. Maintain emergency contact information

## Operational Excellence

### Deployment Practices

**Infrastructure as Code:**
```typescript
// Use CDK for all infrastructure
// Version control all code
// Implement proper testing

// Example: Environment-specific configurations
const config = {
  dev: {
    enableRagReplicas: false,
    lambdaConcurrency: 10,
  },
  prod: {
    enableRagReplicas: true,
    lambdaConcurrency: 100,
  },
};
```

**CI/CD Pipeline:**
- Automated testing for infrastructure changes
- Staged deployments (dev → staging → prod)
- Rollback procedures

### Change Management

**Change Control Process:**
1. Document all changes
2. Peer review for infrastructure changes
3. Testing in non-production environments
4. Scheduled maintenance windows

**Version Control:**
- Tag all releases
- Maintain changelog
- Document breaking changes

### Documentation

**Architecture Documentation:**
- Network diagrams
- Security architecture
- Data flow diagrams

**Operational Runbooks:**
- Deployment procedures
- Troubleshooting guides
- Emergency procedures

### Training and Knowledge Transfer

**Team Training:**
- AWS VPC concepts
- Private networking best practices
- Troubleshooting procedures

**Knowledge Management:**
- Maintain internal wiki
- Regular knowledge sharing sessions
- Document lessons learned

## Compliance and Governance

### Compliance Requirements

**Data Residency:**
- Ensure data remains in required regions
- Document data flows
- Implement data classification

**Audit Requirements:**
```typescript
// Enable CloudTrail for API logging
new Trail(this, 'AuditTrail', {
  bucket: auditBucket,
  includeGlobalServiceEvents: true,
  isMultiRegionTrail: true,
});
```

### Governance Framework

**Resource Tagging Strategy:**
```typescript
// Consistent tagging across all resources
const tags = {
  Environment: 'production',
  Application: 'bedrock-chat',
  Owner: 'platform-team',
  CostCenter: 'engineering',
  Compliance: 'required',
};

Object.entries(tags).forEach(([key, value]) => {
  Tags.of(this).add(key, value);
});
```

**Policy Enforcement:**
- Service Control Policies (SCPs)
- Config Rules for compliance
- Regular compliance audits

## Performance Benchmarking

### Baseline Metrics

**Establish Baselines:**
- Lambda function response times
- VPC endpoint latency
- ALB response times
- End-to-end user experience

**Performance Testing:**
```bash
# Load testing script example
for i in {1..100}; do
  curl -w "@curl-format.txt" -s -o /dev/null \
    https://api.bedrock-chat.internal/health
done
```

### Continuous Optimization

**Regular Performance Reviews:**
- Monthly performance analysis
- Identify optimization opportunities
- Implement performance improvements

**Capacity Planning:**
- Monitor growth trends
- Plan for peak usage
- Scale resources proactively

This comprehensive best practices guide should be regularly updated based on operational experience and AWS service updates.