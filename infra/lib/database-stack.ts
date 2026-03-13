import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class DatabaseStack extends cdk.Stack {
  public readonly connectionsTable: dynamodb.Table;
  public readonly callEventsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // WebSocket Connections Table
    this.connectionsTable = new dynamodb.Table(this, 'ConnectionsTable', {
      tableName: 'devassist-websocket-connections',
      partitionKey: {
        name: 'connectionId',
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev - change to RETAIN for production
      pointInTimeRecovery: true
    });

    // GSI for querying by agentId
    this.connectionsTable.addGlobalSecondaryIndex({
      indexName: 'agentId-index',
      partitionKey: {
        name: 'agentId',
        type: dynamodb.AttributeType.STRING
      },
      projectionType: dynamodb.ProjectionType.ALL
    });

    // Call Events Table (webhook events from CallTools)
    this.callEventsTable = new dynamodb.Table(this, 'CallEventsTable', {
      tableName: 'devassist-call-events',
      partitionKey: {
        name: 'callId',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'event',
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: true
    });

    // Outputs
    new cdk.CfnOutput(this, 'CallEventsTableName', {
      value: this.callEventsTable.tableName,
      exportName: 'DevAssist-CallEventsTable',
      description: 'DynamoDB table for CallTools webhook events'
    });

    new cdk.CfnOutput(this, 'ConnectionsTableName', {
      value: this.connectionsTable.tableName,
      exportName: 'DevAssist-ConnectionsTable',
      description: 'DynamoDB table for WebSocket connection tracking'
    });

    new cdk.CfnOutput(this, 'ConnectionsTableArn', {
      value: this.connectionsTable.tableArn,
      exportName: 'DevAssist-ConnectionsTableArn'
    });
  }
}
