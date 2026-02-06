import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as apigatewayv2 from '@aws-cdk/aws-apigatewayv2-alpha';
import { Construct } from 'constructs';

export interface MonitoringStackProps extends cdk.StackProps {
  webSocketApi: apigatewayv2.WebSocketApi;
  connectHandlerName: string;
  transcriptHandlerName: string;
  alertEmail: string;
}

export class MonitoringStack extends cdk.Stack {
  public readonly dashboardUrl: string;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    // SNS Topic for Alarms
    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      displayName: 'DevAssist WebSocket Alarms',
      topicName: 'devassist-websocket-alarms'
    });

    alarmTopic.addSubscription(new subscriptions.EmailSubscription(props.alertEmail));

    // CloudWatch Dashboard
    const dashboard = new cloudwatch.Dashboard(this, 'DevAssistDashboard', {
      dashboardName: 'DevAssist-WebSocket-Monitoring'
    });

    // === API Gateway Metrics ===

    const connectionCountMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: 'ConnectCount',
      dimensionsMap: {
        ApiId: props.webSocketApi.apiId
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(1)
    });

    const messageCountMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: 'MessageCount',
      dimensionsMap: {
        ApiId: props.webSocketApi.apiId
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(1)
    });

    const errorRateMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: 'ExecutionError',
      dimensionsMap: {
        ApiId: props.webSocketApi.apiId
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5)
    });

    const integrationLatencyMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: 'IntegrationLatency',
      dimensionsMap: {
        ApiId: props.webSocketApi.apiId
      },
      statistic: 'Average',
      period: cdk.Duration.minutes(1)
    });

    // === Lambda Metrics ===

    const transcriptDurationMetric = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Duration',
      dimensionsMap: {
        FunctionName: props.transcriptHandlerName
      },
      statistic: 'Average',
      period: cdk.Duration.minutes(1)
    });

    const transcriptErrorMetric = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Errors',
      dimensionsMap: {
        FunctionName: props.transcriptHandlerName
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5)
    });

    const transcriptThrottleMetric = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'Throttles',
      dimensionsMap: {
        FunctionName: props.transcriptHandlerName
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5)
    });

    const connectConcurrencyMetric = new cloudwatch.Metric({
      namespace: 'AWS/Lambda',
      metricName: 'ConcurrentExecutions',
      dimensionsMap: {
        FunctionName: props.connectHandlerName
      },
      statistic: 'Maximum',
      period: cdk.Duration.minutes(1)
    });

    // === Dashboard Widgets ===

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'WebSocket Connections',
        left: [connectionCountMetric],
        width: 12,
        height: 6
      }),
      new cloudwatch.GraphWidget({
        title: 'Message Throughput',
        left: [messageCountMetric],
        width: 12,
        height: 6
      })
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Integration Latency (ms)',
        left: [integrationLatencyMetric],
        width: 12,
        height: 6
      }),
      new cloudwatch.GraphWidget({
        title: 'Transcript Handler Duration (ms)',
        left: [transcriptDurationMetric],
        width: 12,
        height: 6
      })
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Error Rate',
        left: [errorRateMetric, transcriptErrorMetric],
        width: 12,
        height: 6
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Concurrency',
        left: [connectConcurrencyMetric],
        width: 12,
        height: 6
      })
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Throttles',
        left: [transcriptThrottleMetric],
        width: 24,
        height: 6
      })
    );

    // === Alarms ===

    // High Error Rate Alarm
    const errorAlarm = errorRateMetric.createAlarm(this, 'HighErrorRate', {
      threshold: 10,
      evaluationPeriods: 2,
      alarmDescription: 'WebSocket error rate is too high (>10 errors in 10 minutes)',
      alarmName: 'DevAssist-HighErrorRate',
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    errorAlarm.addAlarmAction(new cw_actions.SnsAction(alarmTopic));

    // Lambda Throttling Alarm
    const throttleAlarm = transcriptThrottleMetric.createAlarm(this, 'LambdaThrottling', {
      threshold: 5,
      evaluationPeriods: 1,
      alarmDescription: 'Transcript Lambda is being throttled (need more concurrency)',
      alarmName: 'DevAssist-LambdaThrottling',
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    throttleAlarm.addAlarmAction(new cw_actions.SnsAction(alarmTopic));

    // High Latency Alarm (AI processing taking too long)
    const latencyAlarm = transcriptDurationMetric.createAlarm(this, 'HighLatency', {
      threshold: 5000, // 5 seconds
      evaluationPeriods: 3,
      alarmDescription: 'Transcript handler latency is too high (>5s for 3 periods)',
      alarmName: 'DevAssist-HighLatency',
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    latencyAlarm.addAlarmAction(new cw_actions.SnsAction(alarmTopic));

    // Lambda Error Alarm
    const lambdaErrorAlarm = transcriptErrorMetric.createAlarm(this, 'LambdaErrors', {
      threshold: 5,
      evaluationPeriods: 2,
      alarmDescription: 'Transcript handler is generating errors',
      alarmName: 'DevAssist-LambdaErrors',
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    lambdaErrorAlarm.addAlarmAction(new cw_actions.SnsAction(alarmTopic));

    this.dashboardUrl = `https://console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${dashboard.dashboardName}`;

    // Outputs
    new cdk.CfnOutput(this, 'DashboardURL', {
      value: this.dashboardUrl,
      description: 'CloudWatch Dashboard URL'
    });

    new cdk.CfnOutput(this, 'AlarmTopicArn', {
      value: alarmTopic.topicArn,
      description: 'SNS Topic ARN for alarms',
      exportName: 'DevAssist-AlarmTopicArn'
    });

    // X-Ray tracing is already enabled via Lambda.Tracing.ACTIVE in websocket-stack.ts
    // Traces will automatically appear in X-Ray console
  }
}
