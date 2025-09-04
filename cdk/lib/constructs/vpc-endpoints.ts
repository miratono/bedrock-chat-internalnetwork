import { CfnOutput } from "aws-cdk-lib";
import {
  IVpc,
  ISubnet,
  SecurityGroup,
  Port,
  Peer,
  InterfaceVpcEndpoint,
  InterfaceVpcEndpointAwsService,
  GatewayVpcEndpoint,
  GatewayVpcEndpointAwsService,
  SubnetType,
} from "aws-cdk-lib/aws-ec2";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import {
  PolicyDocument,
  PolicyStatement,
  Effect,
} from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface VpcEndpointsProps {
  /**
   * The VPC where VPC endpoints will be created
   */
  readonly vpc: IVpc;

  /**
   * AWS region for Bedrock services
   */
  readonly bedrockRegion: string;

  /**
   * Whether to enable private DNS for VPC endpoints
   * @default true
   */
  readonly enablePrivateDns?: boolean;
}

/**
 * Construct for creating VPC endpoints for all AWS services
 * required by the Bedrock Chat application in air-gapped deployment.
 */
export class VpcEndpoints extends Construct {
  /**
   * The VPC where VPC endpoints are created
   */
  readonly vpc: IVpc;

  /**
   * Security group for VPC endpoints allowing HTTPS traffic from private subnets
   */
  readonly endpointSecurityGroup: SecurityGroup;

  /**
   * Map of interface VPC endpoints by service name
   */
  readonly interfaceEndpoints: Map<string, InterfaceVpcEndpoint>;

  /**
   * S3 Gateway VPC endpoint for cost optimization
   */
  readonly s3GatewayEndpoint: GatewayVpcEndpoint;

  constructor(scope: Construct, id: string, props: VpcEndpointsProps) {
    super(scope, id);

    const { vpc, bedrockRegion, enablePrivateDns = true } = props;
    
    this.vpc = vpc;

    // Create security group for VPC endpoints
    this.endpointSecurityGroup = new SecurityGroup(this, "VpcEndpointSecurityGroup", {
      vpc,
      description: "Security group for VPC endpoints - allows HTTPS from private subnets",
      allowAllOutbound: false,
    });

    // Allow HTTPS traffic from VPC CIDR
    this.endpointSecurityGroup.addIngressRule(
      Peer.ipv4(vpc.vpcCidrBlock),
      Port.tcp(443),
      "Allow HTTPS from VPC"
    );

    this.interfaceEndpoints = new Map();

    // Define interface VPC endpoints for AWS services
    const interfaceServices = [
      { name: "bedrock-runtime", service: InterfaceVpcEndpointAwsService.BEDROCK_RUNTIME },
      { name: "bedrock-agent", service: InterfaceVpcEndpointAwsService.BEDROCK_AGENT },
      { name: "dynamodb", service: InterfaceVpcEndpointAwsService.DYNAMODB },
      { name: "lambda", service: InterfaceVpcEndpointAwsService.LAMBDA },
      { name: "execute-api", service: InterfaceVpcEndpointAwsService.APIGATEWAY },
      { name: "cloudformation", service: InterfaceVpcEndpointAwsService.CLOUDFORMATION },
      { name: "codebuild", service: InterfaceVpcEndpointAwsService.CODEBUILD },
      { name: "events", service: InterfaceVpcEndpointAwsService.EVENTBRIDGE },
      { name: "states", service: InterfaceVpcEndpointAwsService.STEP_FUNCTIONS },
      { name: "athena", service: InterfaceVpcEndpointAwsService.ATHENA },
      { name: "glue", service: InterfaceVpcEndpointAwsService.GLUE },
      { name: "secretsmanager", service: InterfaceVpcEndpointAwsService.SECRETS_MANAGER },
      { name: "sts", service: InterfaceVpcEndpointAwsService.STS },
      { name: "logs", service: InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS },
      { name: "monitoring", service: InterfaceVpcEndpointAwsService.CLOUDWATCH_MONITORING },
    ];

    // Create interface VPC endpoints
    interfaceServices.forEach(({ name, service }) => {
      const endpoint = new InterfaceVpcEndpoint(this, `${name}Endpoint`, {
        vpc,
        service,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
        securityGroups: [this.endpointSecurityGroup],
        privateDnsEnabled: enablePrivateDns,
      });

      this.interfaceEndpoints.set(name, endpoint);

      // Output endpoint DNS names
      new CfnOutput(this, `${name}EndpointDns`, {
        value: endpoint.vpcEndpointDnsEntries.length > 0 ? endpoint.vpcEndpointDnsEntries[0] : "N/A",
        description: `DNS entries for ${name} VPC endpoint`,
      });

      // Output private DNS status
      new CfnOutput(this, `${name}EndpointPrivateDns`, {
        value: enablePrivateDns.toString(),
        description: `Private DNS enabled status for ${name} VPC endpoint`,
      });
    });

    // Create S3 Gateway VPC endpoint for cost optimization
    this.s3GatewayEndpoint = new GatewayVpcEndpoint(this, "S3GatewayEndpoint", {
      vpc,
      service: GatewayVpcEndpointAwsService.S3,
      // Gateway endpoints are automatically added to route tables of all subnets
    });

    // Create Cognito IDP endpoint using custom service name
    const cognitoIdpEndpoint = new InterfaceVpcEndpoint(this, "CognitoIdpEndpoint", {
      vpc,
      service: {
        name: `com.amazonaws.${bedrockRegion}.cognito-idp`,
        port: 443,
      },
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [this.endpointSecurityGroup],
      privateDnsEnabled: enablePrivateDns,
    });

    this.interfaceEndpoints.set("cognito-idp", cognitoIdpEndpoint);

    new CfnOutput(this, "CognitoIdpEndpointDns", {
      value: cognitoIdpEndpoint.vpcEndpointDnsEntries.length > 0 ? cognitoIdpEndpoint.vpcEndpointDnsEntries[0] : "N/A",
      description: "DNS entries for Cognito IDP VPC endpoint",
    });

    new CfnOutput(this, "CognitoIdpEndpointPrivateDns", {
      value: enablePrivateDns.toString(),
      description: "Private DNS enabled status for Cognito IDP VPC endpoint",
    });

    // Create OpenSearch Serverless endpoint using custom service name
    try {
      const aossEndpoint = new InterfaceVpcEndpoint(this, "AossEndpoint", {
        vpc,
        service: {
          name: `com.amazonaws.${bedrockRegion}.aoss`,
          port: 443,
        },
        subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
        securityGroups: [this.endpointSecurityGroup],
        privateDnsEnabled: enablePrivateDns,
      });

      this.interfaceEndpoints.set("aoss", aossEndpoint);

      new CfnOutput(this, "AossEndpointDns", {
        value: aossEndpoint.vpcEndpointDnsEntries.length > 0 ? aossEndpoint.vpcEndpointDnsEntries[0] : "N/A",
        description: "DNS entries for OpenSearch Serverless VPC endpoint",
      });

      new CfnOutput(this, "AossEndpointPrivateDns", {
        value: enablePrivateDns.toString(),
        description: "Private DNS enabled status for OpenSearch Serverless VPC endpoint",
      });
    } catch (error) {
      // OpenSearch Serverless VPC endpoint may not be available in all regions
      console.warn(`OpenSearch Serverless VPC endpoint not available in region ${bedrockRegion}`);
    }

    // Output S3 Gateway endpoint information
    new CfnOutput(this, "S3GatewayEndpointId", {
      value: this.s3GatewayEndpoint.vpcEndpointId,
      description: "S3 Gateway VPC endpoint ID",
    });

    new CfnOutput(this, "VpcEndpointSecurityGroupId", {
      value: this.endpointSecurityGroup.securityGroupId,
      description: "Security group ID for VPC endpoints",
    });

    // Output summary of all VPC endpoints for verification
    new CfnOutput(this, "VpcEndpointsSummary", {
      value: Array.from(this.interfaceEndpoints.keys()).join(",") || "none",
      description: "List of all created interface VPC endpoints",
    });
  }



  /**
   * Get the DNS name for a specific VPC endpoint service
   * @param serviceName The service name (e.g., "bedrock-runtime", "dynamodb")
   * @returns The DNS name for the VPC endpoint or undefined if not found
   */
  public getEndpointDnsName(serviceName: string): string | undefined {
    const endpoint = this.interfaceEndpoints.get(serviceName);
    if (endpoint && endpoint.vpcEndpointDnsEntries.length > 0) {
      return endpoint.vpcEndpointDnsEntries[0];
    }
    return undefined;
  }

  /**
   * Get all VPC endpoint DNS names for verification
   * @returns Map of service names to their DNS names
   */
  public getAllEndpointDnsNames(): Map<string, string> {
    const dnsNames = new Map<string, string>();
    
    this.interfaceEndpoints.forEach((endpoint, serviceName) => {
      if (endpoint.vpcEndpointDnsEntries.length > 0) {
        dnsNames.set(serviceName, endpoint.vpcEndpointDnsEntries[0]);
      }
    });

    return dnsNames;
  }

  /**
   * Verify that all required VPC endpoints are created
   * @returns Array of missing VPC endpoint service names
   */
  public verifyRequiredEndpoints(): string[] {
    const requiredServices = [
      "bedrock-runtime",
      "bedrock-agent", 
      "dynamodb",
      "lambda",
      "execute-api",
      "cloudformation",
      "codebuild",
      "events",
      "states",
      "athena",
      "glue",
      "secretsmanager",
      "sts",
      "logs",
      "monitoring",
      "cognito-idp",
    ];

    const missingServices: string[] = [];
    
    requiredServices.forEach(service => {
      if (!this.interfaceEndpoints.has(service)) {
        missingServices.push(service);
      }
    });

    return missingServices;
  }

  /**
   * Get environment variables for Lambda functions to use VPC endpoints
   * @returns Object with environment variables for AWS SDK configuration
   */
  public getLambdaEnvironmentVariables(): Record<string, string> {
    const envVars: Record<string, string> = {};

    // Set endpoint URLs for AWS services that support custom endpoints
    const endpointMappings = {
      "bedrock-runtime": "BEDROCK_RUNTIME_ENDPOINT_URL",
      "bedrock-agent": "BEDROCK_AGENT_ENDPOINT_URL", 
      "dynamodb": "DYNAMODB_ENDPOINT_URL",
      "lambda": "LAMBDA_ENDPOINT_URL",
      "secretsmanager": "SECRETS_MANAGER_ENDPOINT_URL",
      "sts": "STS_ENDPOINT_URL",
      "logs": "CLOUDWATCH_LOGS_ENDPOINT_URL",
      "monitoring": "CLOUDWATCH_ENDPOINT_URL",
    };

    Object.entries(endpointMappings).forEach(([serviceName, envVarName]) => {
      const dnsName = this.getEndpointDnsName(serviceName);
      if (dnsName) {
        envVars[envVarName] = `https://${dnsName}`;
      }
    });

    return envVars;
  }
}