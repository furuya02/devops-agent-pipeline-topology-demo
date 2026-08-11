#!/usr/bin/env bash
# デモ環境を削除する。検証終了後は必ず実行する。
set -euo pipefail

cd "$(dirname "$0")/../cdk"

for ENV_NAME in prod dev; do
  echo "=== destroy ${ENV_NAME} ==="
  pnpm exec cdk destroy -c env="${ENV_NAME}" --force
done

echo "デモ環境の削除が完了しました。"
echo "Agent Space は別途 DevOps Agent のコンソールから削除してください（維持しても固定費は発生しません）。"
