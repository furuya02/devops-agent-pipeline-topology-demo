#!/usr/bin/env bash
# DevOps Agent の課金額を Cost Explorer で確認する（読み取りのみ）。
# 検証中は毎日実行して、想定外の課金が発生していないかを確認する。
#
# 使い方: ./scripts/check-cost.sh [開始日 YYYY-MM-DD] [終了日 YYYY-MM-DD]
set -euo pipefail

START="${1:-$(date -v-7d +%Y-%m-%d 2>/dev/null || date -d '7 days ago' +%Y-%m-%d)}"
END="${2:-$(date +%Y-%m-%d)}"

echo "期間: ${START} 〜 ${END}"

aws ce get-cost-and-usage \
  --time-period "Start=${START},End=${END}" \
  --granularity DAILY \
  --metrics UnblendedCost \
  --group-by Type=DIMENSION,Key=SERVICE \
  --query 'ResultsByTime[].{Date:TimePeriod.Start,Costs:Groups[?Metrics.UnblendedCost.Amount!=`0`].{Service:Keys[0],Amount:Metrics.UnblendedCost.Amount}}' \
  --output json
