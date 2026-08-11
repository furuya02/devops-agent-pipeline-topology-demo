// service-a: API Gateway から呼ばれる受け口。
// - inventory を Lambda 直接呼び出し（サービス間の同期呼び出し）
// - SQS へイベント送信（サービス間の非同期イベント）
// の2種類の依存を意図的に持たせている。
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { newOrderId, log } = require('@demo/shared');

const lambdaClient = new LambdaClient({});
const sqsClient = new SQSClient({});

exports.handler = async (event) => {
  const body = JSON.parse(event.body ?? '{}');
  const sku = body.sku ?? 'sku-001';
  const quantity = body.quantity ?? 1;
  const orderId = newOrderId();

  // 同期呼び出し: order-api -> inventory
  const invoked = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: process.env.INVENTORY_FUNCTION_NAME,
      Payload: JSON.stringify({ sku, quantity }),
    })
  );
  const inventory = JSON.parse(Buffer.from(invoked.Payload).toString());

  if (!inventory.available) {
    log('order rejected', { orderId, sku, stock: inventory.stock });
    return { statusCode: 409, body: JSON.stringify({ orderId, reason: 'out of stock' }) };
  }

  // 非同期イベント: order-api -> SQS -> notification
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: process.env.ORDER_EVENTS_QUEUE_URL,
      MessageBody: JSON.stringify({ orderId, sku, quantity }),
    })
  );

  log('order accepted', { orderId, sku, quantity });
  return { statusCode: 202, body: JSON.stringify({ orderId, sku, quantity }) };
};
