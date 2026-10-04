#!/usr/bin/env bash
# デモ環境にリクエストを流し、ログ・トレース・メトリクスを発生させる。
# DevOps Agent が参照するログ・トレースを作るために実行する。
#
# 使い方: ./scripts/invoke-demo.sh <エンドポイントURL> [回数]
set -euo pipefail

ENDPOINT="${1:?エンドポイントURL（cdk deploy の OrdersEndpoint 出力）を指定してください}"
COUNT="${2:-20}"

for i in $(seq 1 "${COUNT}"); do
  # sku-002 は在庫0なので 409 になる。正常系と異常系の両方を発生させる。
  if [ $((i % 5)) -eq 0 ]; then
    SKU="sku-002"
  else
    SKU="sku-001"
  fi

  curl -s -o /dev/null -w "%{http_code} ${SKU}\n" \
    -X POST "${ENDPOINT}" \
    -H 'Content-Type: application/json' \
    -d "{\"sku\":\"${SKU}\",\"quantity\":1}"
done
