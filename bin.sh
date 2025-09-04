#!/bin/bash
echo ""
echo "==========================================================================="
echo "  ⚠️  Heads Up: A Brand-New Era Begins with v3.x!                              "
echo "---------------------------------------------------------------------------"
echo "  🚨 v3.x is NOT compatible with v2.x or any earlier versions.              "
echo "     Carefully read the migration guide before proceeding:                 "
echo "     https://github.com/aws-samples/bedrock-chat/blob/v3/docs/migration/V2_TO_V3.md"
echo ""
echo "  ❗ This upgrade is significant. To prevent DATA LOSS (especially custom bots),"
echo "     follow the steps outlined in the guide step-by-step.                 "
echo ""
echo "  ✅ This script is safe ONLY IF you're:                                    "
echo "     - A new user starting with v3.x                                       "
echo "     - Or already upgraded to v3.x                                         "
echo ""
echo "  📌 Otherwise, STOP now and read the migration guide above first!         "
echo "---------------------------------------------------------------------------"
echo "  🌟 Let's begin your v3.x journey — the future awaits!                    "
echo "==========================================================================="
echo ""

while true; do
    read -p "Are you ready to explore the world of v3.x? (y/N): " answer
    case ${answer:0:1} in
        y|Y )
            echo "Buckle up! Starting deployment for v3.x..."
            break
            ;;
        n|N )
            echo "Whoa, hold on! This script is only for v3.x users. Please refer to the migration guide if you're coming from an older version."
            exit 1
            ;;
        * )
            echo "Let's keep it simple. Please enter y or n."
            ;;
    esac
done


# Default parameters
ALLOW_SELF_REGISTER="true"
ENABLE_LAMBDA_SNAPSTART="false"
IPV4_RANGES=""
IPV6_RANGES=""
DISABLE_IPV6="false"
ALLOWED_SIGN_UP_EMAIL_DOMAINS=""
BEDROCK_REGION="us-east-1"
CDK_JSON_OVERRIDE="{}"
REPO_URL="https://github.com/aws-samples/bedrock-chat.git"
VERSION="v3"

# VPC parameters
ENABLE_PRIVATE_VPC="false"
VPC_CIDR=""
EXISTING_VPC_ID=""
EXISTING_PRIVATE_SUBNET_IDS=""
PRIVATE_DOMAIN_NAME=""

# Entra ID parameters
ENTRA_ID_TENANT_ID=""
ENTRA_ID_CLIENT_ID=""
ENTRA_ID_FEDERATION_METADATA_URL=""

# Validation functions
validate_cidr() {
    local cidr=$1
    if [[ -z "$cidr" ]]; then
        return 0  # Empty is valid (will use default)
    fi
    
    # Basic CIDR validation regex
    if [[ ! $cidr =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$ ]]; then
        echo "Error: Invalid CIDR format: $cidr"
        echo "Expected format: x.x.x.x/y (e.g., 10.0.0.0/16)"
        return 1
    fi
    
    # Extract IP and prefix
    local ip=${cidr%/*}
    local prefix=${cidr#*/}
    
    # Validate prefix length
    if [[ $prefix -lt 16 || $prefix -gt 28 ]]; then
        echo "Error: CIDR prefix must be between /16 and /28, got /$prefix"
        return 1
    fi
    
    # Validate IP octets
    IFS='.' read -ra octets <<< "$ip"
    for octet in "${octets[@]}"; do
        if [[ $octet -lt 0 || $octet -gt 255 ]]; then
            echo "Error: Invalid IP octet: $octet"
            return 1
        fi
    done
    
    return 0
}

validate_vpc_id() {
    local vpc_id=$1
    if [[ -z "$vpc_id" ]]; then
        return 0  # Empty is valid
    fi
    
    if [[ ! $vpc_id =~ ^vpc-[0-9a-f]{8,17}$ ]]; then
        echo "Error: Invalid VPC ID format: $vpc_id"
        echo "Expected format: vpc-xxxxxxxxx"
        return 1
    fi
    
    return 0
}

validate_subnet_ids() {
    local subnet_ids=$1
    if [[ -z "$subnet_ids" ]]; then
        return 0  # Empty is valid
    fi
    
    IFS=',' read -ra subnets <<< "$subnet_ids"
    for subnet in "${subnets[@]}"; do
        subnet=$(echo "$subnet" | xargs)  # Trim whitespace
        if [[ ! $subnet =~ ^subnet-[0-9a-f]{8,17}$ ]]; then
            echo "Error: Invalid subnet ID format: $subnet"
            echo "Expected format: subnet-xxxxxxxxx"
            return 1
        fi
    done
    
    return 0
}

validate_domain_name() {
    local domain=$1
    if [[ -z "$domain" ]]; then
        return 0  # Empty is valid (will use default)
    fi
    
    # Basic domain name validation
    if [[ ! $domain =~ ^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$ ]]; then
        echo "Error: Invalid domain name format: $domain"
        echo "Expected format: valid.domain.name"
        return 1
    fi
    
    return 0
}

validate_entra_id_params() {
    local tenant_id=$1
    local client_id=$2
    local metadata_url=$3
    
    # If any Entra ID parameter is provided, all required ones must be provided
    if [[ -n "$tenant_id" || -n "$client_id" || -n "$metadata_url" ]]; then
        if [[ -z "$tenant_id" ]]; then
            echo "Error: --entra-id-tenant-id is required when using Entra ID integration"
            return 1
        fi
        
        if [[ -z "$client_id" ]]; then
            echo "Error: --entra-id-client-id is required when using Entra ID integration"
            return 1
        fi
        
        # Validate tenant ID format (UUID)
        if [[ ! $tenant_id =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
            echo "Error: Invalid Entra ID tenant ID format: $tenant_id"
            echo "Expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            return 1
        fi
        
        # Validate client ID format (UUID)
        if [[ ! $client_id =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
            echo "Error: Invalid Entra ID client ID format: $client_id"
            echo "Expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            return 1
        fi
        
        # Validate metadata URL if provided
        if [[ -n "$metadata_url" && ! $metadata_url =~ ^https:// ]]; then
            echo "Error: Entra ID federation metadata URL must use HTTPS"
            return 1
        fi
    fi
    
    return 0
}

validate_vpc_compatibility() {
    local enable_private_vpc=$1
    local existing_vpc_id=$2
    local existing_subnet_ids=$3
    local vpc_cidr=$4
    
    if [[ "$enable_private_vpc" == "true" ]]; then
        # If using existing VPC, subnet IDs are required
        if [[ -n "$existing_vpc_id" && -z "$existing_subnet_ids" ]]; then
            echo "Error: --existing-private-subnet-ids is required when using --existing-vpc-id"
            return 1
        fi
        
        # If providing subnet IDs, VPC ID is required
        if [[ -n "$existing_subnet_ids" && -z "$existing_vpc_id" ]]; then
            echo "Error: --existing-vpc-id is required when using --existing-private-subnet-ids"
            return 1
        fi
        
        # If using existing VPC, don't allow VPC CIDR
        if [[ -n "$existing_vpc_id" && -n "$vpc_cidr" ]]; then
            echo "Error: --vpc-cidr cannot be used with --existing-vpc-id (existing VPC already has a CIDR)"
            return 1
        fi
        
        # Validate that at least 2 subnet IDs are provided for high availability
        if [[ -n "$existing_subnet_ids" ]]; then
            IFS=',' read -ra subnets <<< "$existing_subnet_ids"
            if [[ ${#subnets[@]} -lt 2 ]]; then
                echo "Error: At least 2 private subnet IDs are required for high availability"
                return 1
            fi
        fi
    else
        # If private VPC is not enabled, VPC-related parameters should not be used
        if [[ -n "$existing_vpc_id" || -n "$existing_subnet_ids" || -n "$vpc_cidr" ]]; then
            echo "Error: VPC parameters (--existing-vpc-id, --existing-private-subnet-ids, --vpc-cidr) can only be used with --enable-private-vpc"
            return 1
        fi
    fi
    
    return 0
}

# Parse command-line arguments for customization
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --disable-self-register) ALLOW_SELF_REGISTER="false" ;;
        --enable-lambda-snapstart) ENABLE_LAMBDA_SNAPSTART="true" ;;
        --disable-ipv6) DISABLE_IPV6="true" ;;
        --ipv4-ranges) IPV4_RANGES="$2"; shift ;;
        --ipv6-ranges) IPV6_RANGES="$2"; shift ;;
        --bedrock-region) BEDROCK_REGION="$2"; shift ;;
        --allowed-signup-email-domains) ALLOWED_SIGN_UP_EMAIL_DOMAINS="$2"; shift ;;
        --cdk-json-override) CDK_JSON_OVERRIDE="$2"; shift ;;
        --repo-url) REPO_URL="$2"; shift ;;
        --version) VERSION="$2"; shift ;;
        # VPC parameters
        --enable-private-vpc) ENABLE_PRIVATE_VPC="true" ;;
        --vpc-cidr) VPC_CIDR="$2"; shift ;;
        --existing-vpc-id) EXISTING_VPC_ID="$2"; shift ;;
        --existing-private-subnet-ids) EXISTING_PRIVATE_SUBNET_IDS="$2"; shift ;;
        --private-domain-name) PRIVATE_DOMAIN_NAME="$2"; shift ;;
        # Entra ID parameters
        --entra-id-tenant-id) ENTRA_ID_TENANT_ID="$2"; shift ;;
        --entra-id-client-id) ENTRA_ID_CLIENT_ID="$2"; shift ;;
        --entra-id-federation-metadata-url) ENTRA_ID_FEDERATION_METADATA_URL="$2"; shift ;;
        --help) 
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "General Options:"
            echo "  --disable-self-register                    Disable self-registration"
            echo "  --enable-lambda-snapstart                  Enable Lambda SnapStart"
            echo "  --disable-ipv6                            Disable IPv6 support"
            echo "  --ipv4-ranges RANGES                      Comma-separated IPv4 CIDR ranges"
            echo "  --ipv6-ranges RANGES                      Comma-separated IPv6 CIDR ranges"
            echo "  --bedrock-region REGION                   AWS region for Bedrock (default: us-east-1)"
            echo "  --allowed-signup-email-domains DOMAINS   Comma-separated email domains for signup"
            echo ""
            echo "VPC Options (for private deployment):"
            echo "  --enable-private-vpc                      Enable private VPC deployment"
            echo "  --vpc-cidr CIDR                          CIDR block for new VPC (default: 10.0.0.0/16)"
            echo "  --existing-vpc-id VPC_ID                 Use existing VPC ID"
            echo "  --existing-private-subnet-ids SUBNET_IDS Comma-separated private subnet IDs"
            echo "  --private-domain-name DOMAIN             Private domain name (default: bedrock-chat.internal)"
            echo ""
            echo "Entra ID Options:"
            echo "  --entra-id-tenant-id TENANT_ID           Entra ID tenant ID"
            echo "  --entra-id-client-id CLIENT_ID           Entra ID client ID"
            echo "  --entra-id-federation-metadata-url URL   Entra ID SAML metadata URL"
            echo ""
            echo "Advanced Options:"
            echo "  --cdk-json-override JSON                  JSON override for CDK context"
            echo "  --repo-url URL                           Repository URL"
            echo "  --version VERSION                        Version to deploy"
            echo "  --help                                   Show this help message"
            exit 0
            ;;
        *) echo "Unknown parameter: $1. Use --help for usage information."; exit 1 ;;
    esac
    shift
done

# Validate parameters
echo "Validating parameters..."

# Validate VPC CIDR
if ! validate_cidr "$VPC_CIDR"; then
    exit 1
fi

# Validate VPC ID
if ! validate_vpc_id "$EXISTING_VPC_ID"; then
    exit 1
fi

# Validate subnet IDs
if ! validate_subnet_ids "$EXISTING_PRIVATE_SUBNET_IDS"; then
    exit 1
fi

# Validate domain name
if ! validate_domain_name "$PRIVATE_DOMAIN_NAME"; then
    exit 1
fi

# Validate Entra ID parameters
if ! validate_entra_id_params "$ENTRA_ID_TENANT_ID" "$ENTRA_ID_CLIENT_ID" "$ENTRA_ID_FEDERATION_METADATA_URL"; then
    exit 1
fi

# Validate VPC parameter compatibility
if ! validate_vpc_compatibility "$ENABLE_PRIVATE_VPC" "$EXISTING_VPC_ID" "$EXISTING_PRIVATE_SUBNET_IDS" "$VPC_CIDR"; then
    exit 1
fi

# Set default values for private VPC mode
if [[ "$ENABLE_PRIVATE_VPC" == "true" ]]; then
    if [[ -z "$VPC_CIDR" && -z "$EXISTING_VPC_ID" ]]; then
        VPC_CIDR="10.0.0.0/16"
        echo "Using default VPC CIDR: $VPC_CIDR"
    fi
    
    if [[ -z "$PRIVATE_DOMAIN_NAME" ]]; then
        PRIVATE_DOMAIN_NAME="bedrock-chat.internal"
        echo "Using default private domain: $PRIVATE_DOMAIN_NAME"
    fi
fi

echo "Parameter validation completed successfully."

# Debug: Show parameter values being passed to CloudFormation
if [[ "$ENABLE_PRIVATE_VPC" == "true" ]]; then
    echo ""
    echo "Debug: Private VPC parameters being passed to CloudFormation:"
    echo "  EnablePrivateVpc: $ENABLE_PRIVATE_VPC"
    echo "  VpcCidr: $VPC_CIDR"
    echo "  ExistingVpcId: $EXISTING_VPC_ID"
    echo "  ExistingPrivateSubnetIds: $EXISTING_PRIVATE_SUBNET_IDS"
    echo "  PrivateDomainName: $PRIVATE_DOMAIN_NAME"
    echo ""
fi

# Validate the template
aws cloudformation validate-template --template-body file://deploy.yml  > /dev/null 2>&1
if [[ $? -ne 0 ]]; then
    echo "Template validation failed"
    exit 1
fi

StackName="CodeBuildForDeploy"

# Deploy the CloudFormation stack
aws cloudformation deploy \
  --stack-name $StackName \
  --template-file deploy.yml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    AllowSelfRegister=$ALLOW_SELF_REGISTER \
    EnableLambdaSnapStart=$ENABLE_LAMBDA_SNAPSTART \
    DisableIpv6=$DISABLE_IPV6 \
    Ipv4Ranges="$IPV4_RANGES" \
    Ipv6Ranges="$IPV6_RANGES" \
    AllowedSignUpEmailDomains="$ALLOWED_SIGN_UP_EMAIL_DOMAINS" \
    BedrockRegion="$BEDROCK_REGION" \
    CdkJsonOverride="$CDK_JSON_OVERRIDE" \
    RepoUrl="$REPO_URL" \
    Version="$VERSION" \
    EnablePrivateVpc="$ENABLE_PRIVATE_VPC" \
    VpcCidr="$VPC_CIDR" \
    ExistingVpcId="$EXISTING_VPC_ID" \
    ExistingPrivateSubnetIds="$EXISTING_PRIVATE_SUBNET_IDS" \
    PrivateDomainName="$PRIVATE_DOMAIN_NAME" \
    EntraIdTenantId="$ENTRA_ID_TENANT_ID" \
    EntraIdClientId="$ENTRA_ID_CLIENT_ID" \
    EntraIdFederationMetadataUrl="$ENTRA_ID_FEDERATION_METADATA_URL"

# Debug: Show the actual parameters passed to CloudFormation
if [[ "$ENABLE_PRIVATE_VPC" == "true" ]]; then
    echo "Debug: Verifying CloudFormation stack parameters..."
    aws cloudformation describe-stacks --stack-name $StackName --query 'Stacks[0].Parameters[?ParameterKey==`EnablePrivateVpc`]' --output table 2>/dev/null || echo "Could not retrieve stack parameters"
fi

echo "Waiting for the stack creation to complete..."
echo "NOTE: this stack contains CodeBuild project which will be used for cdk deploy."
spin='-\|/'
i=0
while true; do
    status=$(aws cloudformation describe-stacks --stack-name $StackName --query 'Stacks[0].StackStatus' --output text 2>/dev/null)
    if [[ "$status" == "CREATE_COMPLETE" || "$status" == "UPDATE_COMPLETE" || "$status" == "DELETE_COMPLETE" ]]; then
        break
    elif [[ "$status" == "ROLLBACK_COMPLETE" || "$status" == "DELETE_FAILED" || "$status" == "CREATE_FAILED" ]]; then
        echo "Stack creation failed with status: $status"
        exit 1
    fi
    printf "\r${spin:i++%${#spin}:1}"
    sleep 1
done
echo -e "\nDone.\n"

outputs=$(aws cloudformation describe-stacks --stack-name $StackName --query 'Stacks[0].Outputs')
projectName=$(echo $outputs | jq -r '.[] | select(.OutputKey=="ProjectName").OutputValue')

if [[ -z "$projectName" ]]; then
    echo "Failed to retrieve the CodeBuild project name"
    exit 1
fi

echo "Starting CodeBuild project: $projectName..."
buildId=$(aws codebuild start-build --project-name $projectName --query 'build.id' --output text)

if [[ -z "$buildId" ]]; then
    echo "Failed to start CodeBuild project"
    exit 1
fi

echo "Waiting for the CodeBuild project to complete..."
while true; do
    buildStatus=$(aws codebuild batch-get-builds --ids $buildId --query 'builds[0].buildStatus' --output text)
    if [[ "$buildStatus" == "SUCCEEDED" || "$buildStatus" == "FAILED" || "$buildStatus" == "STOPPED" ]]; then
        break
    fi
    sleep 10
done
echo "CodeBuild project completed with status: $buildStatus"

buildDetail=$(aws codebuild batch-get-builds --ids $buildId --query 'builds[0].logs.{groupName: groupName, streamName: streamName}' --output json)

logGroupName=$(echo $buildDetail | jq -r '.groupName')
logStreamName=$(echo $buildDetail | jq -r '.streamName')

echo "Build Log Group Name: $logGroupName"
echo "Build Log Stream Name: $logStreamName"

echo "Fetch CDK deployment logs..."
logs=$(aws logs get-log-events --log-group-name $logGroupName --log-stream-name $logStreamName)

# Debug: Show all output lines for troubleshooting
if [[ "$ENABLE_PRIVATE_VPC" == "true" ]]; then
    echo "Debug: Looking for private VPC outputs in logs..."
    echo "Debug: ENABLE_PRIVATE_VPC = $ENABLE_PRIVATE_VPC"
    echo "$logs" | grep -E "(PrivateFrontendURL|PrivateApiURL|PrivateALBDnsName|enablePrivateVpc|DEBUG)" || echo "No private VPC outputs found in logs"
    
    echo ""
    echo "Debug: Checking if private VPC was actually enabled in CDK context..."
    echo "$logs" | grep -E "(enablePrivateVpc.*true|Creating private)" || echo "Private VPC context not found in logs"
fi

# Check for private VPC deployment first, then fall back to standard deployment
if [[ "$ENABLE_PRIVATE_VPC" == "true" ]]; then
    # For private VPC, look for private URLs
    frontendUrl=$(echo "$logs" | grep -o 'PrivateFrontendURL = [^"]*' | cut -d' ' -f3- | tr -d '\n,')
    privateApiUrl=$(echo "$logs" | grep -o 'PrivateApiURL = [^"]*' | cut -d' ' -f3- | tr -d '\n,')
    
    echo "=== Private VPC Deployment URLs ==="
    if [[ -n "$frontendUrl" ]]; then
        echo "Private Frontend URL: $frontendUrl"
    else
        echo "Private Frontend URL: Not found in deployment logs"
    fi
    
    if [[ -n "$privateApiUrl" ]]; then
        echo "Private API URL: $privateApiUrl"
    else
        echo "Private API URL: Not found in deployment logs"
    fi
    
    echo ""
    echo "Note: This is a private VPC deployment. Access requires:"
    echo "  - VPN connection to the VPC"
    echo "  - Direct Connect gateway"
    echo "  - Access from within the VPC (e.g., bastion host)"
    echo ""
    echo "Private domain: ${PRIVATE_DOMAIN_NAME:-bedrock-chat.internal}"
    
    # Also show ALB DNS name for debugging
    albDnsName=$(echo "$logs" | grep -o 'PrivateALBDnsName = [^"]*' | cut -d' ' -f3- | tr -d '\n,')
    if [[ -n "$albDnsName" ]]; then
        echo "ALB DNS Name (for debugging): $albDnsName"
    fi
else
    # For standard deployment, look for regular frontend URL
    frontendUrl=$(echo "$logs" | grep -o 'FrontendURL = [^"]*' | cut -d' ' -f3- | tr -d '\n,')
    echo "Frontend URL: $frontendUrl"
fi
