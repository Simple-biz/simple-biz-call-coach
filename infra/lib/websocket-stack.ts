import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from '@aws-cdk/aws-apigatewayv2-alpha';
import * as integrations from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Construct } from 'constructs';

export interface WebSocketStackProps extends cdk.StackProps {
  connectionsTable: dynamodb.Table;
  callEventsTable: dynamodb.Table;
  rdsConnectionString: string;
  anthropicApiKey: string;
  openaiApiKey: string;
  backendApiKey: string;
  callToolsWebhookSecret: string;
  vpcId: string;
  privateSubnetIds: string[];
  rdsSecurityGroupId: string;
}

export class WebSocketStack extends cdk.Stack {
  public readonly webSocketApi: apigatewayv2.WebSocketApi;
  public readonly webSocketUrl: string;
  public readonly connectHandlerName: string;
  public readonly transcriptHandlerName: string;

  constructor(scope: Construct, id: string, props: WebSocketStackProps) {
    super(scope, id, props);

    // Store API keys in Secrets Manager instead of plaintext env vars
    const apiKeysSecret = new secretsmanager.Secret(this, 'ApiKeysSecret', {
      secretName: 'call-coach/api-keys',
      secretObjectValue: {
        ANTHROPIC_API_KEY: cdk.SecretValue.unsafePlainText(props.anthropicApiKey),
        OPENAI_API_KEY: cdk.SecretValue.unsafePlainText(props.openaiApiKey),
        BACKEND_API_KEY: cdk.SecretValue.unsafePlainText(props.backendApiKey),
        CALLTOOLS_WEBHOOK_SECRET: cdk.SecretValue.unsafePlainText(props.callToolsWebhookSecret),
      },
    });

    // Shared Lambda environment variables
    const sharedEnv = {
      CONNECTIONS_TABLE: props.connectionsTable.tableName,
      DATABASE_URL: props.rdsConnectionString,
      API_KEYS_SECRET_ARN: apiKeysSecret.secretArn,
      CLAUDE_HAIKU_MODEL: 'claude-haiku-4-5-20251001',
      CLAUDE_SONNET_MODEL: 'claude-sonnet-4-5-20250929',
      OPENAI_MODEL: 'gpt-4.1-mini',
      ANTHROPIC_TIMEOUT_MS: '5000',
      AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1'
    };

    // ============================================================================
    // VPC Configuration for RDS Access
    // ============================================================================

    // Lookup existing VPC where RDS database is running
    const vpc = ec2.Vpc.fromLookup(this, 'RdsVpc', {
      vpcId: props.vpcId
    });

    // Import the private subnets
    const privateSubnets = props.privateSubnetIds.map((subnetId, index) =>
      ec2.Subnet.fromSubnetId(this, `PrivateSubnet${index}`, subnetId)
    );

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
      props.rdsSecurityGroupId
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
      tracing: lambda.Tracing.PASS_THROUGH,
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*']
      }
    });

    // Lambda: $disconnect handler
    const disconnectHandler = new nodejs.NodejsFunction(this, 'DisconnectHandler', {
      entry: 'lib/lambda/disconnect/index.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: sharedEnv,
      tracing: lambda.Tracing.PASS_THROUGH,
      logRetention: logs.RetentionDays.ONE_WEEK,
      vpc,
      vpcSubnets: {
        subnets: privateSubnets
      },
      securityGroups: [lambdaSecurityGroup],
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
      tracing: lambda.Tracing.PASS_THROUGH,
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
      memorySize: 256,
      environment: sharedEnv,
      tracing: lambda.Tracing.PASS_THROUGH,
      logRetention: logs.RetentionDays.ONE_WEEK,
      vpc,
      vpcSubnets: {
        subnets: privateSubnets
      },
      securityGroups: [lambdaSecurityGroup],
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*']
      }
    });

    // Lambda: Transcript Handler
    const transcriptHandler = new nodejs.NodejsFunction(this, 'TranscriptHandler', {
      entry: 'lib/lambda/transcript/index.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      environment: sharedEnv,
      tracing: lambda.Tracing.PASS_THROUGH,
      logRetention: logs.RetentionDays.ONE_WEEK,
      vpc,
      vpcSubnets: {
        subnets: privateSubnets
      },
      securityGroups: [lambdaSecurityGroup],
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*']
      }
    });

    // Lambda: End Conversation
    const endConversationHandler = new nodejs.NodejsFunction(this, 'EndConversationHandler', {
      entry: 'lib/lambda/end-conversation/index.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: sharedEnv,
      tracing: lambda.Tracing.PASS_THROUGH,
      logRetention: logs.RetentionDays.ONE_WEEK,
      vpc,
      vpcSubnets: {
        subnets: privateSubnets
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
      memorySize: 1024,
      environment: sharedEnv,
      tracing: lambda.Tracing.PASS_THROUGH,
      logRetention: logs.RetentionDays.ONE_WEEK,
      vpc,
      vpcSubnets: {
        subnets: privateSubnets
      },
      securityGroups: [lambdaSecurityGroup],
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*']
      }
    });

    // v3 live coach (ported from call-coach-hsl CCHv2-ST7): Realtime mini session tokens for the
    // extension's auto mode. The AI Gateway key lives in its OWN secret. CDK creates it with a
    // random placeholder and never sets the value, so the key is not in the CloudFormation template
    // (unlike ApiKeysSecret above). Set it once, by hand:
    //   aws secretsmanager put-secret-value --secret-id call-coach/ai-gateway --secret-string <vck_…>
    // Until then the route answers not-configured.
    const aiGatewaySecret = new secretsmanager.Secret(this, 'AiGatewaySecret', {
      secretName: 'call-coach/ai-gateway',
      description: 'Vercel AI Gateway API key for the Realtime mini live coach (v3). Value set by hand, never in the template.',
    });
    // The rollout switch: which agents get Realtime mini. '-' = nobody (SSM won't store an empty
    // String), '*' = everyone, or a comma list of agent ids. Changed at runtime, no deploy:
    //   aws ssm put-parameter --name /call-coach/realtime-agents --type String --value 'a@x,b@y' --overwrite
    // NOT created by CDK on purpose: CloudFormation would reset an owned parameter's value to the
    // template's whenever the resource definition changed, silently switching the rollout off.
    // CDK only grants read. Until the parameter exists, the Lambda treats the list as empty.
    const realtimeAgentsParam = ssm.StringParameter.fromStringParameterName(
      this, 'RealtimeAgentsParam', '/call-coach/realtime-agents',
    );
    // Outside the VPC on purpose: it needs internet egress to ai-gateway.vercel.sh and no database.
    // Explicit log group (not logRetention) so the spend alarm's metric filter has it at deploy time.
    const realtimeTokenLogs = new logs.LogGroup(this, 'RealtimeTokenLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const realtimeTokenHandler = new nodejs.NodejsFunction(this, 'RealtimeTokenHandler', {
      entry: 'lib/lambda/realtime-token/index.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        CONNECTIONS_TABLE: props.connectionsTable.tableName,
        AI_GATEWAY_SECRET_ARN: aiGatewaySecret.secretArn,
        REALTIME_MODEL: 'openai/gpt-realtime-mini',
        REALTIME_AGENTS_PARAM: realtimeAgentsParam.parameterName,
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      },
      logGroup: realtimeTokenLogs,
      bundling: { minify: true, sourceMap: true, externalModules: ['@aws-sdk/*'] },
    });
    aiGatewaySecret.grantRead(realtimeTokenHandler);
    realtimeAgentsParam.grantRead(realtimeTokenHandler);
    // Write: the per-connection token counter (shared/dynamo-client countRealtimeToken).
    props.connectionsTable.grantReadWriteData(realtimeTokenHandler);

    // Spend alarm: every issued token logs "[RealtimeToken] minted". Normal full-team volume is a
    // few dozen an hour (each call 1 token plus rare reconnects), so 150 in an hour means something
    // is minting on our credits. Its own topic: DevAssist-Monitoring depends on this stack, so its
    // AlarmTopic can't be passed in here without a dependency cycle.
    const tokensMinted = new logs.MetricFilter(this, 'RealtimeTokensMintedFilter', {
      logGroup: realtimeTokenLogs,
      filterPattern: logs.FilterPattern.literal('"[RealtimeToken] minted"'),
      metricNamespace: 'SimpleBizCallCoach',
      metricName: 'RealtimeTokensMinted',
      metricValue: '1',
      defaultValue: 0,
    });
    const realtimeAlertTopic = new sns.Topic(this, 'RealtimeSpendAlertTopic', {
      displayName: 'Simple.biz Call Coach live-coach spend alert',
    });
    realtimeAlertTopic.addSubscription(
      new subscriptions.EmailSubscription(
        process.env.REALTIME_ALERT_EMAIL || process.env.ALERT_EMAIL || 'kayserb@simple.biz',
      ),
    );
    const tokensAlarm = new cloudwatch.Alarm(this, 'RealtimeTokensMintedAlarm', {
      alarmName: 'sbcc-live-coach-tokens-minted-high',
      alarmDescription: 'More than 150 live-coach session tokens in an hour: possible abuse of AI Gateway credits. Check the RealtimeTokenLogGroup logs and set /call-coach/realtime-agents to "-" to stop.',
      metric: tokensMinted.metric({ statistic: 'Sum', period: cdk.Duration.hours(1) }),
      threshold: 150,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    tokensAlarm.addAlarmAction(new cw_actions.SnsAction(realtimeAlertTopic));

    // Grant DynamoDB permissions
    props.connectionsTable.grantReadWriteData(connectHandler);
    props.connectionsTable.grantReadWriteData(disconnectHandler);
    props.connectionsTable.grantReadWriteData(startConversationHandler);  // Fixed: needs UpdateItem permission
    props.connectionsTable.grantReadData(transcriptHandler);
    props.connectionsTable.grantReadWriteData(endConversationHandler);
    props.connectionsTable.grantReadData(intelligenceHandler);
    props.connectionsTable.grantReadData(defaultHandler);

    // Grant RDS access via IAM (scoped to specific DB)
    const rdsPolicy = new iam.PolicyStatement({
      actions: ['rds-db:connect'],
      resources: [
        `arn:aws:rds-db:${this.region}:${this.account}:dbuser:*/*`
      ]
    });
    [startConversationHandler, transcriptHandler, endConversationHandler, intelligenceHandler].forEach(fn => {
      fn.addToRolePolicy(rdsPolicy);
    });

    // API Gateway WebSocket API
    this.webSocketApi = new apigatewayv2.WebSocketApi(this, 'DevAssistWebSocketApi', {
      apiName: 'devassist-websocket-api',
      description: 'Real-time AI coaching WebSocket API',
      connectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration('ConnectIntegration', connectHandler)
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
      integration: new integrations.WebSocketLambdaIntegration('TranscriptIntegration', transcriptHandler)
    });

    this.webSocketApi.addRoute('endConversation', {
      integration: new integrations.WebSocketLambdaIntegration('EndConvIntegration', endConversationHandler)
    });

    this.webSocketApi.addRoute('getIntelligence', {
      integration: new integrations.WebSocketLambdaIntegration('IntelligenceIntegration', intelligenceHandler),
      returnResponse: true,
    });

    this.webSocketApi.addRoute('getRealtimeToken', {
      integration: new integrations.WebSocketLambdaIntegration('RealtimeTokenIntegration', realtimeTokenHandler),
      returnResponse: true,
    });

    // Stage
    const stage = new apigatewayv2.WebSocketStage(this, 'ProductionStage', {
      webSocketApi: this.webSocketApi,
      stageName: 'production',
      autoDeploy: true,
      throttle: {
        rateLimit: 100,
        burstLimit: 50
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

    [transcriptHandler, endConversationHandler, defaultHandler, startConversationHandler, intelligenceHandler].forEach(fn => {
      fn.addToRolePolicy(postToConnectionPolicy);
    });

    // ============================================================================
    // CallTools Webhook Receiver (HTTP Lambda + Function URL)
    // ============================================================================

    // Extract WebSocket domain from the API for the webhook to broadcast
    const webSocketDomain = `${this.webSocketApi.apiId}.execute-api.${this.region}.amazonaws.com`;

    const webhookHandler = new nodejs.NodejsFunction(this, 'WebhookHandler', {
      entry: 'lib/lambda/webhook/index.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      functionName: 'DevAssist-CallTools-Webhook',
      environment: {
        CONNECTIONS_TABLE: props.connectionsTable.tableName,
        CALL_EVENTS_TABLE: props.callEventsTable.tableName,
        API_KEYS_SECRET_ARN: apiKeysSecret.secretArn,
        WEBSOCKET_API_DOMAIN: webSocketDomain,
        WEBSOCKET_API_STAGE: 'production',
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      },
      tracing: lambda.Tracing.PASS_THROUGH,
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    // Grant Secrets Manager read access to all Lambdas that need API keys
    apiKeysSecret.grantRead(connectHandler);
    apiKeysSecret.grantRead(transcriptHandler);
    apiKeysSecret.grantRead(intelligenceHandler);
    apiKeysSecret.grantRead(webhookHandler);

    // Grant DynamoDB permissions
    props.callEventsTable.grantReadWriteData(webhookHandler);
    props.connectionsTable.grantReadData(webhookHandler);

    // Grant permission to post to WebSocket connections
    webhookHandler.addToRolePolicy(postToConnectionPolicy);

    // Lambda Function URL (public endpoint for CallTools to POST to)
    const webhookUrl = webhookHandler.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE, // Auth handled in Lambda via Bearer token
      cors: {
        allowedOrigins: [
          'https://calltools.io',
          'https://west-3.calltools.io',
          'https://west-4.calltools.io',
          'https://app.calltools.io',
        ],
        allowedMethods: [lambda.HttpMethod.POST],
        allowedHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Export handler names for monitoring stack
    this.connectHandlerName = connectHandler.functionName;
    this.transcriptHandlerName = transcriptHandler.functionName;

    // Outputs
    new cdk.CfnOutput(this, 'WebhookURL', {
      value: webhookUrl.url,
      description: 'CallTools Webhook URL (POST /webhook/call-events)',
      exportName: 'DevAssist-WebhookURL',
    });

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
