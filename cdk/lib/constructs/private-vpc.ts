import { CfnOutput } from "aws-cdk-lib";
import {
  IVpc,
  ISubnet,
  Vpc,
  Subnet,
  SubnetType,
  SubnetConfiguration,
  IpAddresses,
} from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

export interface PrivateVpcProps {
  /**
   * CIDR block for the VPC. Only used when creating a new VPC.
   * @default "10.0.0.0/16"
   */
  readonly vpcCidr?: string;

  /**
   * Existing VPC ID to use instead of creating a new VPC.
   * If provided, the construct will import the existing VPC.
   */
  readonly existingVpcId?: string;

  /**
   * Existing private subnet IDs to use with the existing VPC.
   * Required when existingVpcId is provided.
   */
  readonly existingPrivateSubnetIds?: string[];

  /**
   * Enable DNS hostnames in the VPC.
   * @default true
   */
  readonly enableDnsHostnames?: boolean;

  /**
   * Enable DNS support in the VPC.
   * @default true
   */
  readonly enableDnsSupport?: boolean;
}

/**
 * Construct for creating or importing a private VPC infrastructure
 * for air-gapped deployment of Bedrock Chat application.
 */
export class PrivateVpc extends Construct {
  /**
   * The VPC instance (either created or imported)
   */
  readonly vpc: IVpc;

  /**
   * Private subnets for deploying Lambda functions and other resources
   */
  readonly privateSubnets: ISubnet[];

  constructor(scope: Construct, id: string, props: PrivateVpcProps = {}) {
    super(scope, id);

    const {
      vpcCidr = "10.0.0.0/16",
      existingVpcId,
      existingPrivateSubnetIds,
      enableDnsHostnames = true,
      enableDnsSupport = true,
    } = props;

    if (existingVpcId) {
      // Import existing VPC
      if (!existingPrivateSubnetIds || existingPrivateSubnetIds.length === 0) {
        throw new Error(
          "existingPrivateSubnetIds must be provided when using existingVpcId"
        );
      }

      this.vpc = Vpc.fromLookup(this, "ImportedVpc", {
        vpcId: existingVpcId,
      });

      // Import existing private subnets
      this.privateSubnets = existingPrivateSubnetIds.map((subnetId, index) => {
        const existingSubnet = this.vpc.privateSubnets.find(subnet => subnet.subnetId === subnetId);
        return existingSubnet || Subnet.fromSubnetId(this, `ImportedPrivateSubnet${index}`, subnetId);
      });

      if (this.privateSubnets.length < 2) {
        throw new Error(
          "At least 2 private subnets are required for high availability"
        );
      }
    } else {
      // Create new VPC with private subnets only
      const subnetConfiguration: SubnetConfiguration[] = [
        {
          name: "Private",
          subnetType: SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ];

      this.vpc = new Vpc(this, "PrivateVpc", {
        ipAddresses: IpAddresses.cidr(vpcCidr),
        maxAzs: 3, // Deploy across 3 AZs for high availability
        subnetConfiguration,
        enableDnsHostnames,
        enableDnsSupport,
        // No Internet Gateway or NAT Gateway for air-gapped deployment
        natGateways: 0,
      });

      this.privateSubnets = this.vpc.isolatedSubnets.slice(0, 3); // Limit to 3 subnets to avoid token issues

      if (this.privateSubnets.length < 2) {
        throw new Error(
          "Failed to create sufficient private subnets. At least 2 AZs are required."
        );
      }
    }

    // Output VPC information
    new CfnOutput(this, "VpcId", {
      value: this.vpc.vpcId,
      description: "VPC ID for the private deployment",
    });

    new CfnOutput(this, "PrivateSubnetIds", {
      value: this.privateSubnets.length > 0 ? this.privateSubnets.map(subnet => subnet.subnetId).join(",") : "none",
      description: "Private subnet IDs",
    });

    new CfnOutput(this, "VpcCidr", {
      value: this.vpc.vpcCidrBlock,
      description: "VPC CIDR block",
    });
  }
}