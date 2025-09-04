import { CfnOutput } from "aws-cdk-lib";
import { IVpc } from "aws-cdk-lib/aws-ec2";
import { IApplicationLoadBalancer } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import {
  PrivateHostedZone,
  IPrivateHostedZone,
  ARecord,
  RecordTarget,
} from "aws-cdk-lib/aws-route53";
import { LoadBalancerTarget } from "aws-cdk-lib/aws-route53-targets";
import { Construct } from "constructs";

export interface PrivateDnsProps {
  /**
   * The VPC where the private hosted zone will be associated
   */
  readonly vpc: IVpc;

  /**
   * The domain name for the private hosted zone
   * @default "bedrock-chat.internal"
   */
  readonly domainName?: string;

  /**
   * Optional existing private hosted zone ID to use instead of creating a new one
   */
  readonly existingHostedZoneId?: string;

  /**
   * Application Load Balancer for creating DNS records
   */
  readonly loadBalancer?: IApplicationLoadBalancer;
}

/**
 * Construct for creating private DNS infrastructure including Route53 private hosted zone
 * and DNS records for internal service discovery in air-gapped VPC deployment.
 */
export class PrivateDns extends Construct {
  /**
   * The private hosted zone for internal service discovery
   */
  readonly privateHostedZone: IPrivateHostedZone;

  /**
   * The domain name used for the private hosted zone
   */
  readonly domainName: string;

  /**
   * DNS record for the frontend application (app.domain.internal)
   */
  readonly appRecord?: ARecord;

  /**
   * DNS record for the API endpoints (api.domain.internal)
   */
  readonly apiRecord?: ARecord;

  constructor(scope: Construct, id: string, props: PrivateDnsProps) {
    super(scope, id);

    const { vpc, domainName = "bedrock-chat.internal", existingHostedZoneId, loadBalancer } = props;

    this.domainName = domainName;

    if (existingHostedZoneId) {
      // Use existing private hosted zone
      this.privateHostedZone = PrivateHostedZone.fromPrivateHostedZoneId(
        this,
        "ExistingPrivateHostedZone",
        existingHostedZoneId
      );
    } else {
      // Create new private hosted zone
      this.privateHostedZone = new PrivateHostedZone(this, "PrivateHostedZone", {
        zoneName: domainName,
        vpc,
        comment: `Private hosted zone for Bedrock Chat application - ${domainName}`,
      });

      // Output the hosted zone ID for reference
      new CfnOutput(this, "PrivateHostedZoneId", {
        value: this.privateHostedZone.hostedZoneId,
        description: "Private hosted zone ID for internal service discovery",
      });
    }

    // Create DNS records for ALB endpoints if load balancer is provided
    if (loadBalancer) {
      // Create A record for frontend application (app.domain.internal)
      this.appRecord = new ARecord(this, "AppRecord", {
        zone: this.privateHostedZone,
        recordName: `app.${domainName}`,
        target: RecordTarget.fromAlias(new LoadBalancerTarget(loadBalancer)),
        comment: "DNS record for frontend application access",
      });

      // Create A record for API endpoints (api.domain.internal)
      this.apiRecord = new ARecord(this, "ApiRecord", {
        zone: this.privateHostedZone,
        recordName: `api.${domainName}`,
        target: RecordTarget.fromAlias(new LoadBalancerTarget(loadBalancer)),
        comment: "DNS record for API endpoints access",
      });

      // Output DNS record names
      new CfnOutput(this, "AppDnsName", {
        value: `app.${domainName}`,
        description: "DNS name for frontend application access",
      });

      new CfnOutput(this, "ApiDnsName", {
        value: `api.${domainName}`,
        description: "DNS name for API endpoints access",
      });
    }

    // Output the domain name for reference
    new CfnOutput(this, "PrivateDomainName", {
      value: domainName,
      description: "Private domain name for internal service discovery",
    });

    // Output the hosted zone name servers (for troubleshooting)
    new CfnOutput(this, "PrivateHostedZoneNameServers", {
      value: this.privateHostedZone.hostedZoneNameServers?.join(",") || "N/A",
      description: "Name servers for the private hosted zone",
    });
  }

  /**
   * Create additional A records for custom services
   * @param recordName The name of the DNS record (without domain)
   * @param target The target for the A record
   * @param comment Optional comment for the record
   * @returns The created A record
   */
  public createARecord(
    recordName: string,
    target: RecordTarget,
    comment?: string
  ): ARecord {
    return new ARecord(this, `${recordName}Record`, {
      zone: this.privateHostedZone,
      recordName: `${recordName}.${this.domainName}`,
      target,
      comment: comment || `DNS record for ${recordName}`,
    });
  }

  /**
   * Get the full DNS name for a service
   * @param serviceName The service name (e.g., "app", "api")
   * @returns The full DNS name (e.g., "app.bedrock-chat.internal")
   */
  public getServiceDnsName(serviceName: string): string {
    return `${serviceName}.${this.domainName}`;
  }
}