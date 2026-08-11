// service-b: order-api から同期呼び出しされる在庫確認サービス。
// 在庫データはコード内に固定で持つ（検証用の最小実装）。
const { log } = require('@demo/shared');

const STOCK = {
  'sku-001': 10,
  'sku-002': 0,
};

exports.handler = async (event) => {
  const sku = event.sku ?? 'sku-001';
  const quantity = event.quantity ?? 1;
  const stock = STOCK[sku] ?? 5;

  log('inventory checked', { sku, stock, quantity });
  return { sku, stock, available: stock >= quantity };
};
