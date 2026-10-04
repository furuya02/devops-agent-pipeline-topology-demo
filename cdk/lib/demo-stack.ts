import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

const PROJECT = 'devops-agent-pipeline-topology-demo';

export interface DemoStackProps extends cdk.StackProps {
  readonly envName: string;
}

export class DemoStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DemoStackProps) {
    super(scope, id, props);

    const prefix = `${PROJECT}-${props.envName}`;

    // 3サービスが共通で参照する共有パッケージ
    const sharedLayer = new lambda.LayerVersion(this, 'SharedLayer', {
      layerVersionName: `${prefix}-shared`,
      code: lambda.Code.fromAsset(path.join(__dirname, '../../layer')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_22_X],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const ordersTable = new dynamodb.Table(this, 'OrdersTable', {
      tableName: `${prefix}-orders`,
      partitionKey: { name: 'orderId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const orderEvents = new sqs.Queue(this, 'OrderEvents', {
      queueName: `${prefix}-order-events`,
      visibilityTimeout: cdk.Duration.seconds(60),
    });

    // Lambda + ロググループ + エラーアラームをまとめて作る。
    // アラームを付けるのは、Agent Space Understanding のリファレンスファイルが
    // 「各コンポーネントに紐づくアラーム」を記述するため、その生成結果を確認する目的。
    const createFunction = (
      id: string,
      name: string,
      environment: Record<string, string> = {}
    ): lambda.Function => {
      const logGroup = new logs.LogGroup(this, `${id}LogGroup`, {
        logGroupName: `/aws/lambda/${prefix}-${name}`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      const fn = new lambda.Function(this, id, {
        functionName: `${prefix}-${name}`,
        runtime: lambda.Runtime.NODEJS_22_X,
        handler: 'index.handler',
        code: lambda.Code.fromAsset(path.join(__dirname, '../../services', name)),
        layers: [sharedLayer],
        tracing: lambda.Tracing.ACTIVE,
        timeout: cdk.Duration.seconds(30),
        environment: { ENV_NAME: props.envName, ...environment },
        logGroup,
      });

      new cloudwatch.Alarm(this, `${id}ErrorAlarm`, {
        alarmName: `${prefix}-${name}-errors`,
        metric: fn.metricErrors({ period: cdk.Duration.minutes(5) }),
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      return fn;
    };

    const inventory = createFunction('InventoryFunction', 'inventory');

    const notification = createFunction('NotificationFunction', 'notification', {
      ORDERS_TABLE_NAME: ordersTable.tableName,
    });
    ordersTable.grantWriteData(notification);
    notification.addEventSource(new SqsEventSource(orderEvents));

    const orderApi = createFunction('OrderApiFunction', 'order-api', {
      INVENTORY_FUNCTION_NAME: inventory.functionName,
      ORDER_EVENTS_QUEUE_URL: orderEvents.queueUrl,
    });
    inventory.grantInvoke(orderApi);
    orderEvents.grantSendMessages(orderApi);

    const api = new apigateway.RestApi(this, 'Api', {
      restApiName: `${prefix}-api`,
      deployOptions: {
        stageName: props.envName,
        tracingEnabled: true,
      },
    });
    api.root.addResource('orders').addMethod('POST', new apigateway.LambdaIntegration(orderApi));

    // Agent Space がリソースをまとめて識別できるようにタグを付ける
    cdk.Tags.of(this).add('project', PROJECT);
    cdk.Tags.of(this).add('environment', props.envName);

    new cdk.CfnOutput(this, 'OrdersEndpoint', { value: `${api.url}orders` });
    new cdk.CfnOutput(this, 'OrdersTableName', { value: ordersTable.tableName });
    new cdk.CfnOutput(this, 'OrderEventsQueueUrl', { value: orderEvents.queueUrl });
  }
}
