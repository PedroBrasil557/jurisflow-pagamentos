import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import { env } from '../config/env';
import { getEnvName } from '../utils/getEnvName';

export class Storage extends Construct {
  readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.bucket = new s3.Bucket(this, 'DocumentsBucket', {
      bucketName: getEnvName('jurisflow-documents'),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
      cors: [
        {
          allowedOrigins: env.webDomainNames.map((d) => `https://${d}`),
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedHeaders: ['*'],
          exposedHeaders: ['Content-Disposition'],
          maxAge: 3600,
        },
      ],
    });

    new CfnOutput(scope, 'DocumentsBucketName', {
      value: this.bucket.bucketName,
    });
  }
}
