#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { DemoStack } from '../lib/demo-stack';

const app = new cdk.App();

// -c env=dev / -c env=prod で環境を切り替える（既定は dev）
const envName = app.node.tryGetContext('env') ?? 'dev';

new DemoStack(app, `DevopsAgentLearnedSkillsDemo-${envName}`, {
  envName,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1',
  },
});
