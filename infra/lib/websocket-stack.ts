import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from '@aws-cdk/aws-apigatewayv2-alpha';
import * as integrations from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export interface WebSocketStackProps extends cdk.StackProps {
  connectionsTable: dynamodb.Table;
  rdsConnectionString: string;
  anthropicApiKey: string;
  backendApiKey: string;
}

export class WebSocketStack extends cdk.Stack {
  public readonly webSocketApi: apigatewayv2.WebSocketApi;
  public readonly webSocketUrl: string;

  constructor(scope: Construct, id: string, props: WebSocketStackProps) {
    super(scope, id, props);

    // Shared Lambda environment variables
    const sharedEnv = {
      CONNECTIONS_TABLE: props.connectionsTable.tableName,
      DATABASE_URL: props.rdsConnectionString,
      ANTHROPIC_API_KEY: props.anthropicApiKey,
      BACKEND_API_KEY: props.backendApiKey,
      CLAUDE_HAIKU_MODEL: 'claude-3-5-haiku-20241022',  // Fixed: Haiku 3.5 is the latest
      CLAUDE_SONNET_MODEL: 'claude-sonnet-4-5-20250929',  // Sonnet 4.5 is correct
      AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1'
    };

    // ============================================================================
    // VPC Configuration for RDS Access
    // ============================================================================

    // Lookup existing VPC where RDS database is running
    const vpc = ec2.Vpc.fromLookup(this, 'RdsVpc', {
      vpcId: 'vpc-059fe4065ccc95a67'
    });

    // Import the private subnets we created
    const privateSubnet1a = ec2.Subnet.fromSubnetId(this, 'PrivateSubnet1a', 'subnet-0a927d442cacaa034');
    const privateSubnet1b = ec2.Subnet.fromSubnetId(this, 'PrivateSubnet1b', 'subnet-0f7dad7c982457924');
    const privateSubnet1c = ec2.Subnet.fromSubnetId(this, 'PrivateSubnet1c', 'subnet-053c8588b4ba9b13c');

    // Security Group for Lambda functions
    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc,
      description: 'Security group for Lambda functions accessing RDS',
      allowAllOutbound: true  // Allow Lambda to connect to RDS and external APIs
    });

    // Lookup RDS security group and allow inbound from Lambda
    const rdsSecurityGroup = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      'RdsSecurityGroup',
      'sg-0c836ac7757980973'
    );

    // Allow Lambda to connect to RDS on PostgreSQL port
    rdsSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow Lambda functions to connect to RDS'
    );

    // Lambda: $connect handler
    const connectHandler = new nodejs.NodejsFunction(this, 'ConnectHandler', {
      entry: 'lib/lambda/connect/index.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: sharedEnv,
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*']
      }
    });

    // Provisioned concurrency for $connect
    const connectVersion = connectHandler.currentVersion;
    const connectAlias = new lambda.Alias(this, 'ConnectHandlerLive', {
      aliasName: 'live',
      version: connectVersion,
      provisionedConcurrentExecutions: 2
    });

    // Lambda: $disconnect handler
    const disconnectHandler = new nodejs.NodejsFunction(this, 'DisconnectHandler', {
      entry: 'lib/lambda/disconnect/index.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: sharedEnv,
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*']
      }
    });

    // Lambda: $default handler
    const defaultHandler = new nodejs.NodejsFunction(this, 'DefaultHandler', {
      entry: 'lib/lambda/default/index.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      environment: sharedEnv,
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*']
      }
    });

    // Lambda: Start Conversation
    const startConversationHandler = new nodejs.NodejsFunction(this, 'StartConversationHandler', {
      entry: 'lib/lambda/start-conversation/index.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      environment: sharedEnv,
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
      vpc,
      vpcSubnets: {
        subnets: [privateSubnet1a, privateSubnet1b, privateSubnet1c]
      },
      securityGroups: [lambdaSecurityGroup],
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*']
      }
    });

    // Lambda: Transcript Handler (CRITICAL - AI Processing)
    const transcriptHandler = new nodejs.NodejsFunction(this, 'TranscriptHandler', {
      entry: 'lib/lambda/transcript/index.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(60),
      memorySize: 1024,
      environment: sharedEnv,
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
      vpc,
      vpcSubnets: {
        subnets: [privateSubnet1a, privateSubnet1b, privateSubnet1c]
      },
      securityGroups: [lambdaSecurityGroup],
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
        nodeModules: ['@anthropic-ai/sdk', 'pg']
      }
    });

    // Provisioned concurrency for transcript handler
    const transcriptVersion = transcriptHandler.currentVersion;
    const transcriptAlias = new lambda.Alias(this, 'TranscriptHandlerLive', {
      aliasName: 'live',
      version: transcriptVersion,
      provisionedConcurrentExecutions: 5
    });

    // Lambda: End Conversation
    const endConversationHandler = new nodejs.NodejsFunction(this, 'EndConversationHandler', {
      entry: 'lib/lambda/end-conversation/index.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: sharedEnv,
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
      vpc,
      vpcSubnets: {
        subnets: [privateSubnet1a, privateSubnet1b, privateSubnet1c]
      },
      securityGroups: [lambdaSecurityGroup],
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*']
      }
    });

    // Lambda: Intelligence Handler (Conversation Analysis)
    const intelligenceHandler = new nodejs.NodejsFunction(this, 'IntelligenceHandler', {
      entry: 'lib/lambda/intelligence/index.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: sharedEnv,
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_WEEK,
      vpc,
      vpcSubnets: {
        subnets: [privateSubnet1a, privateSubnet1b, privateSubnet1c]
      },
      securityGroups: [lambdaSecurityGroup],
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
        nodeModules: ['@anthropic-ai/sdk', 'pg']
      }
    });

    // Provisioned concurrency for intelligence handler (1 instance for quick response)
    const intelligenceVersion = intelligenceHandler.currentVersion;
    const intelligenceAlias = new lambda.Alias(this, 'IntelligenceHandlerLive', {
      aliasName: 'live',
      version: intelligenceVersion,
      provisionedConcurrentExecutions: 1
    });

    // Grant DynamoDB permissions
    props.connectionsTable.grantReadWriteData(connectHandler);
    props.connectionsTable.grantReadWriteData(disconnectHandler);
    props.connectionsTable.grantReadWriteData(startConversationHandler);  // Fixed: needs UpdateItem permission
    props.connectionsTable.grantReadData(transcriptHandler);
    props.connectionsTable.grantReadWriteData(endConversationHandler);
    props.connectionsTable.grantReadData(intelligenceHandler);
    props.connectionsTable.grantReadData(defaultHandler);

    // Grant RDS access via IAM (if RDS supports IAM auth)
    const rdsPolicy = new iam.PolicyStatement({
      actions: ['rds-db:connect'],
      resources: ['*']
    });
    [startConversationHandler, transcriptHandler, endConversationHandler, intelligenceHandler].forEach(fn => {
      fn.addToRolePolicy(rdsPolicy);
    });

    // API Gateway WebSocket API
    this.webSocketApi = new apigatewayv2.WebSocketApi(this, 'DevAssistWebSocketApi', {
      apiName: 'devassist-websocket-api',
      description: 'Real-time AI coaching WebSocket API',
      connectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration('ConnectIntegration', connectAlias)
      },
      disconnectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration('DisconnectIntegration', disconnectHandler)
      },
      defaultRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration('DefaultIntegration', defaultHandler)
      }
    });

    // Custom Routes
    this.webSocketApi.addRoute('startConversation', {
      integration: new integrations.WebSocketLambdaIntegration('StartConvIntegration', startConversationHandler)
    });

    this.webSocketApi.addRoute('transcript', {
      integration: new integrations.WebSocketLambdaIntegration('TranscriptIntegration', transcriptAlias)
    });

    this.webSocketApi.addRoute('endConversation', {
      integration: new integrations.WebSocketLambdaIntegration('EndConvIntegration', endConversationHandler)
    });

    this.webSocketApi.addRoute('getIntelligence', {
      integration: new integrations.WebSocketLambdaIntegration('IntelligenceIntegration', intelligenceAlias)
    });

    // Stage
    const stage = new apigatewayv2.WebSocketStage(this, 'ProductionStage', {
      webSocketApi: this.webSocketApi,
      stageName: 'production',
      autoDeploy: true,
      throttle: {
        rateLimit: 10000,
        burstLimit: 5000
      }
    });

    this.webSocketUrl = stage.url;

    // Grant Lambda permission to post to connections
    const postToConnectionPolicy = new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [
        `arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApi.apiId}/*/*/*`
      ]
    });

    [transcriptHandler, transcriptAlias, endConversationHandler, defaultHandler, startConversationHandler, intelligenceHandler, intelligenceAlias].forEach(fn => {
      fn.addToRolePolicy(postToConnectionPolicy);
    });

    // Outputs
    new cdk.CfnOutput(this, 'WebSocketURL', {
      value: this.webSocketUrl,
      description: 'WebSocket API Gateway URL',
      exportName: 'DevAssist-WebSocketURL'
    });

    new cdk.CfnOutput(this, 'WebSocketApiId', {
      value: this.webSocketApi.apiId,
      exportName: 'DevAssist-WebSocketApiId'
    });

    new cdk.CfnOutput(this, 'ConnectHandlerName', {
      value: connectHandler.functionName,
      exportName: 'DevAssist-ConnectHandlerName'
    });

    new cdk.CfnOutput(this, 'TranscriptHandlerName', {
      value: transcriptHandler.functionName,
      exportName: 'DevAssist-TranscriptHandlerName'
    });

    new cdk.CfnOutput(this, 'IntelligenceHandlerName', {
      value: intelligenceHandler.functionName,
      exportName: 'DevAssist-IntelligenceHandlerName'
    });
  }
}
