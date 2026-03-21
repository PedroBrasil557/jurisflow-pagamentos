#!/usr/bin/env node
import '../lib/utils/loadEnvFile';
import * as cdk from 'aws-cdk-lib';
import { JurisflowAppStack } from '../lib/jurisflow-stack';
import { getEnvName } from '../lib/utils/getEnvName';

const app = new cdk.App({});

new JurisflowAppStack(app, getEnvName('JurisflowWebAppStack', true), {
  env: {
    account: '257394493214',
    region: 'us-east-1',
  },
});
