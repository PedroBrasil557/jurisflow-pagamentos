import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import {
  BucketDeployment,
  CacheControl as DeploymentCacheControl,
  Source,
} from 'aws-cdk-lib/aws-s3-deployment';
import {
  Duration,
  Fn,
  RemovalPolicy,
  aws_cloudfront,
  aws_cloudfront_origins,
} from 'aws-cdk-lib';
import {
  AllowedMethods,
  CachePolicy,
  CachedMethods,
  type DistributionProps,
  FunctionCode,
  FunctionEventType,
  OriginRequestPolicy,
  S3OriginAccessControl,
} from 'aws-cdk-lib/aws-cloudfront';
import path from 'path';
import { getEnvName } from '../utils/getEnvName';
// import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
// import { env } from '../config/env';

interface Props {
  apiUrl: string;
}

export class WebApp extends Construct {
  readonly webAppUrl: string;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const appPath = path.join(__dirname, '../../../web/dist');
    const appAssetsPath = path.join(appPath, 'assets');

    const webBucket = new s3.Bucket(this, 'WebAppBucket', {
      bucketName: getEnvName('jurisflow-web-bucket'),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const originAccessControl = new S3OriginAccessControl(this, 'OriginAccessControl');
    const spaRewriteFunction = new aws_cloudfront.Function(
      this,
      'SpaRewriteFunction',
      {
        code: FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return request;
  }

  if (uri.startsWith('/api') || uri.includes('.')) {
    return request;
  }

  request.uri = '/index.html';
  return request;
}
        `),
      },
    );

    const webOrigin = aws_cloudfront_origins.S3BucketOrigin.withOriginAccessControl(
      webBucket,
      {
        originAccessControl,
      },
    );
    const apiOriginDomainName = Fn.select(2, Fn.split('/', props.apiUrl));
    const apiOrigin = new aws_cloudfront_origins.HttpOrigin(apiOriginDomainName, {
      protocolPolicy: aws_cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    });

    // const certificate = Certificate.fromCertificateArn(
    //   this,
    //   'WebCertificate',
    //   env.domainCertificateArn,
    // );

    const defaultBehavior = {
      origin: webOrigin,
      viewerProtocolPolicy: aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: CachePolicy.CACHING_DISABLED,
      functionAssociations: [
        {
          function: spaRewriteFunction,
          eventType: FunctionEventType.VIEWER_REQUEST,
        },
      ],
    };

    const assetBehavior = {
      origin: webOrigin,
      viewerProtocolPolicy: aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: CachePolicy.CACHING_OPTIMIZED,
    };

    const apiBehavior = {
      origin: apiOrigin,
      viewerProtocolPolicy: aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: AllowedMethods.ALLOW_ALL,
      cachedMethods: CachedMethods.CACHE_GET_HEAD_OPTIONS,
      cachePolicy: CachePolicy.CACHING_DISABLED,
      originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    };

    const cloudFrontConfig: DistributionProps = {
      // domainNames: env.webDomainNames,
      // certificate,
      defaultRootObject: 'index.html',
      defaultBehavior,
      additionalBehaviors: {
        'assets/*': assetBehavior,
        api: apiBehavior,
        'api/*': apiBehavior,
      },
    };

    const cloudFrontDistribution = new aws_cloudfront.Distribution(
      this,
      'CFDistribution',
      cloudFrontConfig,
    );

    new BucketDeployment(this, 'S3RootDeployment', {
      sources: [
        Source.asset(appPath, {
          exclude: ['assets/*'],
        }),
      ],
      destinationBucket: webBucket,
      distribution: cloudFrontDistribution,
      distributionPaths: ['/*'],
      cacheControl: [
        DeploymentCacheControl.noStore(),
        DeploymentCacheControl.noCache(),
        DeploymentCacheControl.mustRevalidate(),
        DeploymentCacheControl.maxAge(Duration.seconds(0)),
      ],
      memoryLimit: 1024,
      prune: false,
    });

    new BucketDeployment(this, 'S3AssetsDeployment', {
      sources: [Source.asset(appAssetsPath)],
      destinationBucket: webBucket,
      destinationKeyPrefix: 'assets',
      distribution: cloudFrontDistribution,
      distributionPaths: ['/assets/*'],
      cacheControl: [
        DeploymentCacheControl.setPublic(),
        DeploymentCacheControl.immutable(),
        DeploymentCacheControl.maxAge(Duration.days(365)),
      ],
      memoryLimit: 1024,
      prune: false,
    });

    this.webAppUrl = cloudFrontDistribution.domainName;
  }
}
