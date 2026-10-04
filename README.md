# devops-agent-pipeline-topology-demo

A minimal demo environment for finding out what you need to connect before AWS DevOps Agent generates its managed memories **Understanding Pipeline Topology** (`understanding-pipeline-topology`) and **Understanding Code Dependencies** (`understanding-dependencies`).

The official documentation does not state when these two are generated. This demo is used to add connections to an Agent Space step by step and check whether each one appears.

It focuses on the two skills added after GA: **Understanding Code Dependencies** and **Understanding Pipeline Topology**.

## What this demo provides

The stack deliberately covers both code dependencies and a deployment pipeline.

| What we want to observe | Implementation in this demo |
|---|---|
| Synchronous service-to-service calls | `order-api` invokes `inventory` directly via Lambda |
| Asynchronous events between services | `order-api` → SQS → `notification` |
| Shared packages | `@demo/shared` is a Lambda Layer referenced by all three services |
| Data stores | `notification` writes to DynamoDB |
| Observability | X-Ray tracing and an error alarm on each Lambda |
| Pipelines and environment promotion | GitHub Actions deploys dev, then prod |

## Architecture

```
                                    ┌──────────────┐
                              sync  │  inventory   │
                        ┌──────────>│   (Lambda)   │
                        │           └──────────────┘
┌─────────────┐   ┌─────┴───────┐
│ API Gateway │──>│  order-api  │
│ POST /orders│   │   (Lambda)  │
└─────────────┘   └─────┬───────┘
                        │           ┌──────────────┐   ┌──────────────┐
                        └──────────>│ SQS          │──>│ notification │──> DynamoDB
                                async│ order-events │   │   (Lambda)   │
                                    └──────────────┘   └──────────────┘

Shared package: @demo/shared (Lambda Layer) referenced by order-api / inventory / notification
Environments: dev and prod, deployed from the same stack definition
```

## Prerequisites

- Node.js 22 or later
- pnpm
- AWS CLI with credentials configured
- CDK bootstrap completed in the target account

## Setup

### (1) Clone the repository

```bash
git clone https://github.com/furuya02/devops-agent-pipeline-topology-demo.git
cd devops-agent-pipeline-topology-demo
```

### (2) Install dependencies

```bash
cd cdk
pnpm install
```

### (3) Bootstrap CDK (first time only)

```bash
pnpm exec cdk bootstrap
```

### (4) Deploy

Switch environments with `-c env=`.

```bash
# dev
pnpm exec cdk deploy -c env=dev

# prod
pnpm exec cdk deploy -c env=prod
```

Set `CDK_DEFAULT_REGION` to change the region (defaults to `ap-northeast-1`).

The deployment prints the following outputs.

```
Outputs:
DevopsAgentPipelineTopologyDemo-dev.OrdersEndpoint = https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/dev/orders
DevopsAgentPipelineTopologyDemo-dev.OrdersTableName = devops-agent-pipeline-topology-demo-dev-orders
DevopsAgentPipelineTopologyDemo-dev.OrderEventsQueueUrl = https://sqs.ap-northeast-1.amazonaws.com/<account-id>/devops-agent-pipeline-topology-demo-dev-order-events
```

`OrdersEndpoint` is used in the verification steps below.

## Verification

### (1) Send a request

```bash
curl -X POST "<OrdersEndpoint>" \
  -H 'Content-Type: application/json' \
  -d '{"sku":"sku-001","quantity":1}'
```

If stock is available, it returns `202`.

```json
{"orderId":"ord-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx","sku":"sku-001","quantity":1}
```

`sku-002` has zero stock, so it returns `409`.

```bash
curl -X POST "<OrdersEndpoint>" \
  -H 'Content-Type: application/json' \
  -d '{"sku":"sku-002","quantity":1}'
```

### (2) Check the DynamoDB record

`notification` consumes the SQS message and writes to DynamoDB.

```bash
aws dynamodb scan \
  --table-name devops-agent-pipeline-topology-demo-dev-orders \
  --query 'Items[].{orderId:orderId.S,sku:sku.S,notifiedAt:notifiedAt.S}'
```

### (3) Generate traffic

Generate some traffic so that DevOps Agent has logs, traces, and metrics to work with.

```bash
./scripts/invoke-demo.sh "<OrdersEndpoint>" 20
```

Every fifth request hits the out-of-stock path, so both success and failure cases are recorded.

## Connecting to AWS DevOps Agent

1. Create an Agent Space in the AWS DevOps Agent console
2. Connect the AWS account this demo is deployed to
3. Connect this repository through the GitHub integration
4. Connect the GitHub Actions pipeline
5. Confirm the environment appears on the Topology page
6. On the Memories tab of the Knowledge page, check whether `understanding-dependencies` / `understanding-pipeline-topology` memories have been generated
7. On the Topology page, check whether the Pipeline view is available in the Show menu (it appears only after pipeline topology has been generated)

Update timing, per the [official documentation](https://docs.aws.amazon.com/devopsagent/latest/userguide/about-aws-devops-agent-devops-agent-memories.html):

- Agent Space Understanding: regenerated when connected code repositories, deployment pipelines, or observability integrations change, and refreshed at most once every 3 days for active Agent Spaces (refresh pauses if there are no investigations for 6 days)
- Pipeline Topology / Code Dependencies: generation conditions and timing are not documented

To see results sooner, use the **Regenerate** button on the Topology page, or ask the agent in chat. The **Download** menu on the Topology page exports the current view as PNG / JSON / Mermaid.

## Cost

**The demo environment itself uses only usage-based resources, so it costs almost nothing when idle.**

| Resource | Billing |
|---|---|
| Lambda / API Gateway / SQS / DynamoDB | Usage-based only (DynamoDB is on-demand) |
| CloudWatch Logs | Retention set to one week |
| CloudWatch alarms | 3 alarms (standard-resolution alarms have a free tier of 10 per month) |
| X-Ray | Usage-based on recorded traces |

AWS DevOps Agent itself is billed at **$0.0083 per agent-second (about $29.88 per hour)** ([pricing page](https://aws.amazon.com/devops-agent/pricing/)). There is no fixed charge for keeping an Agent Space, but investigations are billed when they run.

Check the current spend with:

```bash
./scripts/check-cost.sh
```

## Cleanup

Always clean up after verification.

```bash
./scripts/cleanup.sh
```

Or delete each environment individually.

```bash
cd cdk
pnpm exec cdk destroy -c env=prod
pnpm exec cdk destroy -c env=dev
```

Keeping the Agent Space incurs no fixed cost, but delete it from the DevOps Agent console if you no longer need it.

## Using GitHub Actions

`.github/workflows/deploy.yml` assumes a role via OIDC. It requires:

- An IAM role for GitHub Actions with an OIDC trust relationship
- A repository secret named `AWS_DEPLOY_ROLE_ARN`
- Repository environments named `dev` and `prod`

## Directory layout

```
.
├── cdk/                  CDK (TypeScript)
│   ├── bin/app.ts
│   └── lib/demo-stack.ts
├── services/
│   ├── order-api/        API Gateway entry point
│   ├── inventory/        Stock check (invoked synchronously)
│   └── notification/     SQS consumer
├── layer/                Shared package @demo/shared
├── scripts/
│   ├── invoke-demo.sh    Generates traffic for learning
│   ├── check-cost.sh     Checks current spend
│   └── cleanup.sh        Tears down the environment
└── .github/workflows/
    └── deploy.yml        dev → prod promotion
```
