#!/usr/bin/env node
import '../lib/utils/loadEnvFile';
import * as cdk from 'aws-cdk-lib';
import { JurisflowAppStack } from '../lib/jurisflow-stack';
import { getEnvName } from '../lib/utils/getEnvName';

const app = new cdk.App({});

new JurisflowAppStack(app, getEnvName('JurisflowAppStack', true), {
  env: {
    account: 'PLACEHOLDER', // TODO: preencher com AWS Account ID
    region: 'us-east-1',
  },
});
