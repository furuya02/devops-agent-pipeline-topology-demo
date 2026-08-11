// service-c: SQS のイベントを受けて DynamoDB へ記録する。
// order-api とは SQS を挟んだ非同期依存になっている。
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { log } = require('@demo/shared');

const dynamodb = new DynamoDBClient({});

exports.handler = async (event) => {
  for (const record of event.Records) {
    const order = JSON.parse(record.body);

    await dynamodb.send(
      new PutItemCommand({
        TableName: process.env.ORDERS_TABLE_NAME,
        Item: {
          orderId: { S: order.orderId },
          sku: { S: order.sku ?? 'unknown' },
          quantity: { N: String(order.quantity ?? 1) },
          notifiedAt: { S: new Date().toISOString() },
        },
      })
    );

    log('order notified', { orderId: order.orderId });
  }
};
