import { Construct } from "constructs";
import { CfnOutput, Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  IBucket,
} from "aws-cdk-lib/aws-s3";
import {
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ApplicationTargetGroup,
  IApplicationLoadBalancer,
  IApplicationTargetGroup,
  ListenerAction,
  Protocol,
  TargetType,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { LambdaTarget } from "aws-cdk-lib/aws-elasticloadbalancingv2-targets";
import { NodejsBuild } from "deploy-time-build";
import { Auth } from "./auth";
import { Idp } from "../utils/identity-provider";
import { NagSuppressions } from "cdk-nag";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { IFunction } from "aws-cdk-lib/aws-lambda";

export interface PrivateFrontendProps {
  readonly vpc: ec2.IVpc;
  readonly certificate?: acm.ICertificate;
  readonly privateDomainName?: string;
  readonly privateHostedZoneId?: string;
  readonly accessLogBucket?: IBucket;
  readonly enableSelfSignedCertificate?: boolean;
  readonly certificateArn?: string;
}

export class PrivateFrontend extends Construct {
  readonly loadBalancer: IApplicationLoadBalancer;
  readonly assetBucket: Bucket;
  readonly apiTargetGroup: IApplicationTargetGroup;
  readonly frontendTargetGroup: IApplicationTargetGroup;
  private readonly certificate?: acm.ICertificate;
  private readonly hostedZone?: route53.IHostedZone;
  private readonly privateDomainName?: string;

  constructor(scope: Construct, id: string, props: PrivateFrontendProps) {
    super(scope, id);

    this.privateDomainName = props.privateDomainName;

    // Create S3 bucket for static assets
    const assetBucket = new Bucket(this, "AssetBucket", {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      serverAccessLogsBucket: props.accessLogBucket,
      serverAccessLogsPrefix: "AssetBucket",
    });

    // Set up certificate and hosted zone
    this.certificate = this.setupCertificate(props);
    
    if (props.privateDomainName && props.privateHostedZoneId) {
      this.hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'PrivateHostedZone', {
        hostedZoneId: props.privateHostedZoneId,
        zoneName: props.privateDomainName,
      });
    }

    // Create security group for ALB with comprehensive rules
    const albSecurityGroup = this.createALBSecurityGroup(props.vpc);

    // Create internal Application Load Balancer
    const loadBalancer = new ApplicationLoadBalancer(this, 'PrivateALB', {
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      internetFacing: false,
      securityGroup: albSecurityGroup,
      deletionProtection: false,
    });

    // Create target group for API Lambda functions
    const apiTargetGroup = new ApplicationTargetGroup(this, 'ApiTargetGroup', {
      vpc: props.vpc,
      targetType: TargetType.LAMBDA,
      healthCheck: {
        enabled: true,
        path: '/health',
        healthyHttpCodes: '200',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    // Create target group for frontend static content (placeholder for S3 integration)
    const frontendTargetGroup = new ApplicationTargetGroup(this, 'FrontendTargetGroup', {
      vpc: props.vpc,
      targetType: TargetType.LAMBDA,
      healthCheck: {
        enabled: true,
        path: '/health',
        healthyHttpCodes: '200',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    // Create listeners with SSL/TLS configuration
    this.createSecureListeners(loadBalancer, frontendTargetGroup, apiTargetGroup);

    // Create DNS records if private domain is configured
    if (this.privateDomainName && this.hostedZone) {
      // Create A record for app subdomain
      new route53.ARecord(this, 'AppAliasRecord', {
        zone: this.hostedZone,
        target: route53.RecordTarget.fromAlias(
          new targets.LoadBalancerTarget(loadBalancer)
        ),
        recordName: `app.${this.privateDomainName}`,
      });

      // Create A record for API subdomain
      new route53.ARecord(this, 'ApiAliasRecord', {
        zone: this.hostedZone,
        target: route53.RecordTarget.fromAlias(
          new targets.LoadBalancerTarget(loadBalancer)
        ),
        recordName: `api.${this.privateDomainName}`,
      });
    }

    // Apply CDK NAG suppressions
    NagSuppressions.addResourceSuppressions(loadBalancer, [
      {
        id: "AwsPrototyping-ELBv2ALBLoggingEnabled",
        reason: "Access logging is optional for private ALB in air-gapped environment",
      },
    ]);

    NagSuppressions.addResourceSuppressions(albSecurityGroup, [
      {
        id: "AwsPrototyping-EC2RestrictedInbound",
        reason: "Security group allows inbound traffic from VPC CIDR for private ALB",
      },
      {
        id: "AwsPrototyping-EC2RestrictedSSH",
        reason: "SSH is not used for ALB security group",
      },
    ]);

    // Add suppressions for certificate if created
    if (this.certificate) {
      NagSuppressions.addResourceSuppressions(this.certificate, [
        {
          id: "AwsPrototyping-ACMCertificateTransparencyLoggingEnabled",
          reason: "Certificate transparency logging may not be required for private certificates",
        },
      ]);
    }

    this.loadBalancer = loadBalancer;
    this.assetBucket = assetBucket;
    this.apiTargetGroup = apiTargetGroup;
    this.frontendTargetGroup = frontendTargetGroup;

    // Output ALB DNS name and endpoints
    new CfnOutput(this, 'PrivateALBDnsName', {
      value: loadBalancer.loadBalancerDnsName,
      description: 'DNS name of the private Application Load Balancer',
    });

    if (this.privateDomainName) {
      const protocol = this.certificate ? 'https' : 'http';
      const frontendPort = this.certificate ? '' : ':80';
      const apiPort = this.certificate ? ':8443' : ':8080';

      new CfnOutput(this, 'PrivateAppUrl', {
        value: `${protocol}://app.${this.privateDomainName}${frontendPort}`,
        description: 'Private URL for the frontend application',
      });

      new CfnOutput(this, 'PrivateApiUrl', {
        value: `${protocol}://api.${this.privateDomainName}${apiPort}`,
        description: 'Private URL for the API',
      });
    }

    if (this.certificate) {
      new CfnOutput(this, 'PrivateCertificateArn', {
        value: this.certificate.certificateArn,
        description: 'ARN of the private certificate',
      });
    }
  }

  /**
   * Create security group for ALB with comprehensive HTTP/HTTPS rules
   */
  private createALBSecurityGroup(vpc: ec2.IVpc): ec2.SecurityGroup {
    const albSecurityGroup = new ec2.SecurityGroup(this, 'ALBSecurityGroup', {
      vpc: vpc,
      description: 'Security group for private ALB with HTTP/HTTPS access',
      allowAllOutbound: false,
    });

    // Allow HTTPS traffic from VPC CIDR for frontend (port 443)
    albSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(443),
      'Allow HTTPS traffic for frontend application'
    );

    // Allow HTTPS traffic from VPC CIDR for API (port 8443)
    albSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(8443),
      'Allow HTTPS traffic for API endpoints'
    );

    // Allow HTTP traffic as fallback (port 80 and 8080)
    albSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(80),
      'Allow HTTP traffic for frontend application (fallback)'
    );

    albSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(8080),
      'Allow HTTP traffic for API endpoints (fallback)'
    );

    // Allow HTTP traffic for health checks (ALB to targets)
    albSecurityGroup.addEgressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(80),
      'Allow HTTP traffic for health checks to Lambda targets'
    );

    // Allow HTTPS traffic to Lambda functions
    albSecurityGroup.addEgressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(443),
      'Allow HTTPS traffic to Lambda functions'
    );

    // Allow outbound traffic to VPC endpoints for AWS services
    albSecurityGroup.addEgressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(443),
      'Allow HTTPS traffic to VPC endpoints'
    );

    return albSecurityGroup;
  }

  /**
   * Create secure HTTPS listeners with SSL/TLS termination
   */
  private createSecureListeners(
    loadBalancer: ApplicationLoadBalancer,
    frontendTargetGroup: ApplicationTargetGroup,
    apiTargetGroup: ApplicationTargetGroup
  ): void {
    if (this.certificate) {
      // Create HTTPS listener for frontend (port 443) with SSL/TLS termination
      const frontendListener = loadBalancer.addListener('FrontendListener', {
        port: 443,
        protocol: ApplicationProtocol.HTTPS,
        certificates: [this.certificate],
        defaultAction: ListenerAction.forward([frontendTargetGroup]),
      });

      // Create HTTPS listener for API (port 8443) with SSL/TLS termination
      const apiListener = loadBalancer.addListener('ApiListener', {
        port: 8443,
        protocol: ApplicationProtocol.HTTPS,
        certificates: [this.certificate],
        defaultAction: ListenerAction.forward([apiTargetGroup]),
      });

      // Apply security policy for SSL/TLS
      frontendListener.node.addDependency(this.certificate);
      apiListener.node.addDependency(this.certificate);
    } else {
      // Fallback to HTTP listeners if no certificate is available
      console.warn('No SSL certificate provided. Creating HTTP listeners instead of HTTPS.');
      
      const frontendListener = loadBalancer.addListener('FrontendListener', {
        port: 80,
        protocol: ApplicationProtocol.HTTP,
        defaultAction: ListenerAction.forward([frontendTargetGroup]),
      });

      const apiListener = loadBalancer.addListener('ApiListener', {
        port: 8080,
        protocol: ApplicationProtocol.HTTP,
        defaultAction: ListenerAction.forward([apiTargetGroup]),
      });
    }
  }

  /**
   * Set up SSL/TLS certificate for the ALB
   */
  private setupCertificate(props: PrivateFrontendProps): acm.ICertificate | undefined {
    // If certificate ARN is provided, import it
    if (props.certificateArn) {
      return acm.Certificate.fromCertificateArn(this, 'ImportedCertificate', props.certificateArn);
    }

    // If certificate object is provided, use it
    if (props.certificate) {
      return props.certificate;
    }

    // If private domain and hosted zone are provided, create DNS-validated certificate
    if (props.privateDomainName && props.privateHostedZoneId) {
      const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'TempHostedZone', {
        hostedZoneId: props.privateHostedZoneId,
        zoneName: props.privateDomainName,
      });

      return new acm.Certificate(this, 'PrivateCertificate', {
        domainName: `*.${props.privateDomainName}`,
        subjectAlternativeNames: [props.privateDomainName],
        validation: acm.CertificateValidation.fromDns(hostedZone),
      });
    }

    // If self-signed certificate is enabled, create one
    if (props.enableSelfSignedCertificate && props.privateDomainName) {
      // Note: AWS ACM doesn't support self-signed certificates directly
      // This would typically require a custom resource or external certificate import
      // For now, we'll create a DNS-validated certificate with a warning
      console.warn('Self-signed certificates require manual import to ACM. Creating DNS-validated certificate instead.');
      
      // Create a certificate without hosted zone validation (will require manual validation)
      return new acm.Certificate(this, 'SelfSignedCertificate', {
        domainName: `*.${props.privateDomainName}`,
        subjectAlternativeNames: [props.privateDomainName],
        validation: acm.CertificateValidation.fromEmail(),
      });
    }

    // No certificate configuration provided
    return undefined;
  }

  /**
   * Add Lambda function as target to the API target group
   */
  addApiTarget(lambdaFunction: IFunction): void {
    this.apiTargetGroup.addTarget(new LambdaTarget(lambdaFunction));
  }

  /**
   * Add Lambda function as target to the frontend target group
   */
  addFrontendTarget(lambdaFunction: IFunction): void {
    this.frontendTargetGroup.addTarget(new LambdaTarget(lambdaFunction));
  }

  /**
   * Get the origin URL for the private frontend
   */
  getOrigin(): string {
    const protocol = this.certificate ? 'https' : 'http';
    const port = this.certificate ? '' : ':80';
    
    if (this.privateDomainName) {
      return `${protocol}://app.${this.privateDomainName}${port}`;
    }
    return `${protocol}://${this.loadBalancer.loadBalancerDnsName}${port}`;
  }

  /**
   * Get the API endpoint URL
   */
  getApiEndpoint(): string {
    const protocol = this.certificate ? 'https' : 'http';
    const port = this.certificate ? ':8443' : ':8080';
    
    if (this.privateDomainName) {
      return `${protocol}://api.${this.privateDomainName}${port}`;
    }
    return `${protocol}://${this.loadBalancer.loadBalancerDnsName}${port}`;
  }

  /**
   * Build the Vite frontend application for private deployment
   */
  buildViteApp({
    backendApiEndpoint,
    webSocketApiEndpoint,
    userPoolDomainPrefix,
    auth,
    idp,
  }: {
    backendApiEndpoint: string;
    webSocketApiEndpoint: string;
    userPoolDomainPrefix: string;
    auth: Auth;
    idp: Idp;
  }) {
    const region = Stack.of(auth.userPool).region;
    const cognitoDomain = `${userPoolDomainPrefix}.auth.${region}.amazoncognito.com/`;
    const buildEnvProps = (() => {
      const defaultProps = {
        VITE_APP_API_ENDPOINT: backendApiEndpoint,
        VITE_APP_WS_ENDPOINT: webSocketApiEndpoint,
        VITE_APP_USER_POOL_ID: auth.userPool.userPoolId,
        VITE_APP_USER_POOL_CLIENT_ID: auth.client.userPoolClientId,
        VITE_APP_REGION: region,
        VITE_APP_USE_STREAMING: "true",
      };

      if (!idp.isExist()) return defaultProps;

      const oAuthProps = {
        VITE_APP_REDIRECT_SIGNIN_URL: this.getOrigin(),
        VITE_APP_REDIRECT_SIGNOUT_URL: this.getOrigin(),
        VITE_APP_COGNITO_DOMAIN: cognitoDomain,
        VITE_APP_SOCIAL_PROVIDERS: idp.getSocialProviders(),
        VITE_APP_CUSTOM_PROVIDER_ENABLED: idp
          .checkCustomProviderEnabled()
          .toString(),
        VITE_APP_CUSTOM_PROVIDER_NAME: idp.getCustomProviderName(),
      };
      return { ...defaultProps, ...oAuthProps };
    })();

    new NodejsBuild(this, "ReactBuild", {
      assets: [
        {
          path: "../frontend",
          exclude: [
            "node_modules",
            "dist",
            "dev-dist",
            ".env",
            ".env.local",
            "../cdk/**/*",
            "../backend/**/*",
            "../example/**/*",
            "../docs/**/*",
            "../.github/**/*",
          ],
          commands: ["npm ci"],
        },
      ],
      buildCommands: ["npm run build"],
      buildEnvironment: buildEnvProps,
      destinationBucket: this.assetBucket,
      outputSourceDirectory: "dist",
    });

    if (idp.isExist()) {
      new CfnOutput(this, "CognitoDomain", { value: cognitoDomain });
      new CfnOutput(this, "SocialProviders", {
        value: idp.getSocialProviders(),
      });
    }
  }
}