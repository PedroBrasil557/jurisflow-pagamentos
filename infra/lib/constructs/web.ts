import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { RemovalPolicy, aws_cloudfront, aws_cloudfront_origins } from 'aws-cdk-lib';
import {
  CachePolicy,
  type DistributionProps,
  S3OriginAccessControl,
} from 'aws-cdk-lib/aws-cloudfront';
import path from 'path';
import { getEnvName } from '../utils/getEnvName';
// import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
// import { env } from '../config/env';

export class WebApp extends Construct {
  readonly webAppUrl: string;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const appPath = path.join(__dirname, '../../../web/dist');

    const webBucket = new s3.Bucket(this, 'WebAppBucket', {
      bucketName: getEnvName('jurisflow-web-bucket'),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const originAccessControl = new S3OriginAccessControl(this, 'OriginAccessControl');

    // const certificate = Certificate.fromCertificateArn(
    //   this,
    //   'WebCertificate',
    //   env.domainCertificateArn,
    // );

    const defaultBehavior = {
      origin: aws_cloudfront_origins.S3BucketOrigin.withOriginAccessControl(webBucket, {
        originAccessControl,
      }),
      viewerProtocolPolicy: aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: CachePolicy.CACHING_OPTIMIZED,
    };

    const noCacheBehavior = {
      origin: aws_cloudfront_origins.S3BucketOrigin.withOriginAccessControl(webBucket, {
        originAccessControl,
      }),
      viewerProtocolPolicy: aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: CachePolicy.CACHING_DISABLED,
    };

    const cloudFrontConfig: DistributionProps = {
      // domainNames: env.webDomainNames,
      // certificate,
      defaultRootObject: 'index.html',
      defaultBehavior,
      additionalBehaviors: {
        'index.html': noCacheBehavior,
      },
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
    };

    const cloudFrontDistribution = new aws_cloudfront.Distribution(
      this,
      'CFDistribution',
      cloudFrontConfig,
    );

    new BucketDeployment(this, 'S3Deployment', {
      sources: [Source.asset(appPath)],
      destinationBucket: webBucket,
      distribution: cloudFrontDistribution,
      distributionPaths: ['/*'],
      memoryLimit: 1024,
    });

    this.webAppUrl = cloudFrontDistribution.domainName;
  }
}
