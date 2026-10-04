# devops-agent-pipeline-topology-demo

AWS DevOps Agent のマネージドメモリ **Understanding Pipeline Topology**（`understanding-pipeline-topology`）と **Understanding Code Dependencies**（`understanding-dependencies`）が、何を接続すれば生成されるかを確認するための最小デモ環境です。

公式ドキュメントには、この2つの生成条件が記載されていません。このデモを使い、Agent Space への接続を段階的に増やしながら生成の有無を確認します。

## このデモが用意しているもの

依存関係とパイプラインの両方を、意図的に一通り揃えた構成になっています。

| 確認したい対象 | このデモでの実装 |
|---|---|
| サービス間の同期呼び出し | `order-api` が `inventory` を Lambda 直接呼び出し |
| サービス間の非同期イベント | `order-api` → SQS → `notification` |
| 共有パッケージ | `@demo/shared` を Lambda Layer として3サービスが参照 |
| データストア | `notification` が DynamoDB に書き込み |
| オブザーバビリティ | 各 Lambda に X-Ray トレースとエラーアラーム |
| パイプラインと環境昇格 | GitHub Actions で dev → prod の順にデプロイ |

## アーキテクチャ

```
                                    ┌──────────────┐
                              同期  │  inventory   │
                        ┌──────────>│   (Lambda)   │
                        │           └──────────────┘
┌─────────────┐   ┌─────┴───────┐
│ API Gateway │──>│  order-api  │
│ POST /orders│   │   (Lambda)  │
└─────────────┘   └─────┬───────┘
                        │           ┌──────────────┐   ┌──────────────┐
                        └──────────>│ SQS          │──>│ notification │──> DynamoDB
                              非同期│ order-events │   │   (Lambda)   │
                                    └──────────────┘   └──────────────┘

共有パッケージ: @demo/shared（Lambda Layer）を order-api / inventory / notification が参照
環境: dev / prod の2環境を同一構成でデプロイ
```

## 前提条件

- Node.js 22 以上
- pnpm
- AWS CLI（認証情報が設定済みであること）
- デプロイ先アカウントで CDK のブートストラップが済んでいること

## 構築手順

### (1) リポジトリの取得

```bash
git clone https://github.com/furuya02/devops-agent-pipeline-topology-demo.git
cd devops-agent-pipeline-topology-demo
```

### (2) 依存関係のインストール

```bash
cd cdk
pnpm install
```

### (3) CDK ブートストラップ（初回のみ）

```bash
pnpm exec cdk bootstrap
```

### (4) デプロイ

dev 環境と prod 環境を、それぞれ `-c env=` で切り替えてデプロイします。

```bash
# dev 環境
pnpm exec cdk deploy -c env=dev

# prod 環境
pnpm exec cdk deploy -c env=prod
```

リージョンを変更する場合は `CDK_DEFAULT_REGION` を設定してください（既定は `ap-northeast-1`）。

デプロイが完了すると、以下が出力されます。

```
Outputs:
DevopsAgentPipelineTopologyDemo-dev.OrdersEndpoint = https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/dev/orders
DevopsAgentPipelineTopologyDemo-dev.OrdersTableName = devops-agent-pipeline-topology-demo-dev-orders
DevopsAgentPipelineTopologyDemo-dev.OrderEventsQueueUrl = https://sqs.ap-northeast-1.amazonaws.com/<account-id>/devops-agent-pipeline-topology-demo-dev-order-events
```

`OrdersEndpoint` は次の動作確認で使用します。

## 動作確認手順

### (1) リクエストの送信

```bash
curl -X POST "<OrdersEndpoint>" \
  -H 'Content-Type: application/json' \
  -d '{"sku":"sku-001","quantity":1}'
```

在庫がある場合は `202` が返ります。

```json
{"orderId":"ord-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx","sku":"sku-001","quantity":1}
```

`sku-002` は在庫を 0 に設定しているため、`409` が返ります。

```bash
curl -X POST "<OrdersEndpoint>" \
  -H 'Content-Type: application/json' \
  -d '{"sku":"sku-002","quantity":1}'
```

### (2) DynamoDB への記録の確認

SQS 経由で `notification` が処理し、DynamoDB に記録されます。

```bash
aws dynamodb scan \
  --table-name devops-agent-pipeline-topology-demo-dev-orders \
  --query 'Items[].{orderId:orderId.S,sku:sku.S,notifiedAt:notifiedAt.S}'
```

### (3) トラフィックを流す

DevOps Agent が参照するログ・トレース・メトリクスを発生させるため、ある程度のトラフィックを流しておきます。

```bash
./scripts/invoke-demo.sh "<OrdersEndpoint>" 20
```

5回に1回は在庫切れ（409）になるため、正常系と異常系の両方が記録されます。

## DevOps Agent との連携

1. AWS DevOps Agent のコンソールで Agent Space を作成します
2. このデモをデプロイした AWS アカウントを接続します
3. このリポジトリを GitHub 連携で接続します
4. GitHub Actions のパイプラインを接続します
5. Topology ページで環境が表示されることを確認します
6. Knowledge ページの Memories タブで、`understanding-dependencies` / `understanding-pipeline-topology` のメモリが生成されているかを確認します
7. Topology ページの Show メニューで、Pipeline ビューが選べるかを確認します（pipeline topology が生成された場合のみ表示されます）

メモリの更新タイミングは以下のとおりです（[公式ドキュメント](https://docs.aws.amazon.com/devopsagent/latest/userguide/about-aws-devops-agent-devops-agent-memories.html)）。

- Agent Space Understanding: 接続したコードリポジトリ・デプロイパイプライン・オブザーバビリティ統合が変わったときに再生成。アクティブな Agent Space では最短3日ごとに定期更新（過去6日間に調査が1件もない場合は自動停止）
- Pipeline Topology / Code Dependencies: 生成条件・更新タイミングは公式ドキュメントに記載なし

すぐに確認したい場合は、Topology ページの **Regenerate** ボタン、またはチャットで更新を依頼します。Topology ページの **Download** メニューから、表示中のビューを PNG / JSON / Mermaid で書き出せます。

## コストについて

**このデモ環境自体は従量課金のリソースのみで構成しており、リクエストを送らなければ料金はほとんど発生しません。**

| リソース | 課金 |
|---|---|
| Lambda / API Gateway / SQS / DynamoDB | 従量課金のみ（DynamoDB はオンデマンド） |
| CloudWatch Logs | 保持期間を1週間に設定 |
| CloudWatch アラーム | 3個（標準解像度アラームは月10個まで無料利用枠あり） |
| X-Ray | トレース記録分の従量課金 |

一方、**AWS DevOps Agent 自体は $0.0083 / agent-second（約 $29.88/時間）の従量課金**です（[料金ページ](https://aws.amazon.com/devops-agent/pricing/)）。Agent Space を維持するだけの固定費はかかりませんが、調査が自動実行されると課金されます。

課金状況は以下で確認できます。

```bash
./scripts/check-cost.sh
```

## クリーンアップ

検証が終わったら、必ず削除してください。

```bash
./scripts/cleanup.sh
```

個別に削除する場合は以下のとおりです。

```bash
cd cdk
pnpm exec cdk destroy -c env=prod
pnpm exec cdk destroy -c env=dev
```

Agent Space は維持しても固定費は発生しませんが、不要であれば DevOps Agent のコンソールから削除してください。

## GitHub Actions を使う場合

`.github/workflows/deploy.yml` は OIDC でロールを引き受ける構成です。以下の準備が必要です。

- GitHub Actions 用の IAM ロール（OIDC 信頼関係つき）を作成する
- リポジトリの Secrets に `AWS_DEPLOY_ROLE_ARN` を登録する
- リポジトリの Environments に `dev` と `prod` を作成する

ロールは `scripts/github-oidc-role.yaml` で作成します。immutable subject が有効なリポジトリでは `sub` が `repo:<owner>@<ownerId>/<repo>@<repoId>:...` になるため、テンプレートには数値 ID を2つ渡します。

```bash
OWNER_ID=$(gh api users/<owner> --jq .id)
REPO_ID=$(gh api repos/<owner>/devops-agent-pipeline-topology-demo --jq .id)

aws cloudformation deploy \
  --template-file scripts/github-oidc-role.yaml \
  --stack-name devops-agent-pipeline-topology-demo-github-oidc \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides GitHubOrg=<owner> GitHubOwnerId=${OWNER_ID} RepositoryId=${REPO_ID} CreateOIDCProvider=true
```

アカウントに `token.actions.githubusercontent.com` のプロバイダーが既にある場合は `CreateOIDCProvider=false` にします。

## ディレクトリ構成

```
.
├── cdk/                  CDK（TypeScript）
│   ├── bin/app.ts
│   └── lib/demo-stack.ts
├── services/
│   ├── order-api/        API Gateway の受け口
│   ├── inventory/        在庫確認（同期呼び出しされる）
│   └── notification/     SQS コンシューマー
├── layer/                共有パッケージ @demo/shared
├── scripts/
│   ├── invoke-demo.sh    学習用のトラフィック生成
│   ├── check-cost.sh     課金状況の確認
│   └── cleanup.sh        環境削除
└── .github/workflows/
    └── deploy.yml        dev → prod の環境昇格
```
