import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
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
    });

    new CfnOutput(scope, 'DocumentsBucketName', {
      value: this.bucket.bucketName,
    });
  }
}
