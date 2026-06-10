import * as cdk from 'aws-cdk-lib';
import { type Construct } from 'constructs';
import { WebApp } from './constructs/web';
import { Api } from './constructs/api';
import { Database } from './constructs/database';
import { Vpc } from './constructs/vpc';
import { Storage } from './constructs/storage';
import { Worker } from './constructs/worker';

export class JurisflowAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const { vpc } = new Vpc(this, 'Vpc');

    const { databaseUrl } = new Database(this, 'Database', {
      vpc,
    });

    const { bucket: documentsBucket } = new Storage(this, 'Storage');

    const { apiUrl } = new Api(this, 'Api', {
      databaseUrl,
      vpc,
      documentsBucket,
    });

    new Worker(this, 'Worker', {
      vpc,
      apiUrl,
    });

    const { webAppUrl } = new WebApp(this, 'WebApp', { apiUrl });

    new cdk.CfnOutput(this, 'WebAppUrl', {
      value: webAppUrl,
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: apiUrl,
    });
  }
}
