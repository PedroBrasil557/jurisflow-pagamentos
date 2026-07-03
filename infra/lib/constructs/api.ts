import { Construct } from 'constructs';
import {
  InstanceClass,
  InstanceSize,
  InstanceType,
  Port,
  SecurityGroup,
  Vpc,
} from 'aws-cdk-lib/aws-ec2';
import {
  AsgCapacityProvider,
  Cluster,
  ContainerImage,
  Ec2Service,
  Ec2TaskDefinition,
  EcsOptimizedImage,
  Protocol,
  LogDriver,
  ContainerInsights,
} from 'aws-cdk-lib/aws-ecs';
import { AutoScalingGroup, WarmPool } from 'aws-cdk-lib/aws-autoscaling';
import { getEnvName } from '../utils/getEnvName';
import path from 'path';
import { env } from '../config/env';
import { ApplicationLoadBalancer } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Duration } from 'aws-cdk-lib';
import { HttpApi } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpAlbIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
// import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Schedule } from 'aws-cdk-lib/aws-applicationautoscaling';
import type * as s3 from 'aws-cdk-lib/aws-s3';

interface Props {
  vpc: Vpc;
  databaseUrl: string;
  documentsBucket: s3.Bucket;
}

const MIN_CAPACITY = env.isProd ? 2 : 1;
const MAX_CAPACITY = 4;
const WARMED_UP_CAPACITY = 1;
const MAX_WARMED_UP_CAPACITY = 2;
const CPU_THRESHOLD = 50;

export class Api extends Construct {
  readonly apiUrl: string;
  // Serviço ECS da API, exposto para permitir ordenar deploys que dependem de a
  // API estar saudável (ex.: o worker RPA, que só deve subir DEPOIS da migração —
  // que roda no boot da API, antes do health check passar).
  readonly service: Ec2Service;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const { vpc, databaseUrl, documentsBucket } = props;

    const { instanceType, createWarmPool, memoryReservationMiB, cpu } = this.getInstanceConfig();

    const cluster = new Cluster(this, 'Cluster', {
      clusterName: getEnvName('jurisflow-api-cluster'),
      vpc,
      containerInsightsV2: ContainerInsights.ENHANCED,
    });

    const ecsSecurityGroup = new SecurityGroup(this, 'SecurityGroupEcsEc2', {
      securityGroupName: getEnvName('jurisflow-api-security-group'),
      vpc,
    });

    const autoScalingGroup = new AutoScalingGroup(this, 'EcsEc2Capacity', {
      autoScalingGroupName: getEnvName('jurisflow-api-auto-scaling-group'),
      vpc,
      instanceType,
      machineImage: EcsOptimizedImage.amazonLinux2(),
      minCapacity: MIN_CAPACITY,
      maxCapacity: MAX_CAPACITY,
      desiredCapacity: MIN_CAPACITY,
      securityGroup: ecsSecurityGroup,
    });

    autoScalingGroup.protectNewInstancesFromScaleIn();

    autoScalingGroup.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: CPU_THRESHOLD,
      cooldown: Duration.seconds(30),
    });

    if (createWarmPool) {
      new WarmPool(this, 'WarmPool', {
        autoScalingGroup,
        maxGroupPreparedCapacity: MAX_WARMED_UP_CAPACITY,
        minSize: WARMED_UP_CAPACITY,
      });
    }

    const capacityProvider = new AsgCapacityProvider(this, 'AsgCapacityProvider', {
      capacityProviderName: getEnvName('jurisflow-api-capacity-provider'),
      autoScalingGroup,
      enableManagedTerminationProtection: true,
      enableManagedScaling: true,
    });

    cluster.addAsgCapacityProvider(capacityProvider);

    const taskDefinition = new Ec2TaskDefinition(this, 'ApiTaskDef');

    documentsBucket.grantReadWrite(taskDefinition.taskRole);

    const apiPort = 80;

    const imagePath = path.join(__dirname, '../../../api');

    const image = ContainerImage.fromAsset(imagePath);

    taskDefinition.addContainer('ApiContainer', {
      containerName: getEnvName('jurisflow-api-container'),
      image,
      memoryReservationMiB,
      cpu,
      portMappings: [
        {
          containerPort: apiPort,
          hostPort: apiPort,
          protocol: Protocol.TCP,
        },
      ],
      environment: {
        ENVIRONMENT: env.envName,
        DATABASE_URL: databaseUrl,
        PORT: apiPort.toString(),
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? '',
        BETTER_AUTH_URL: `https://${env.webDomainNames[0]}`,
        WEB_URL: `https://${env.webDomainNames[0]}`,
        TRUSTED_ORIGINS: `https://${env.webDomainNames[0]}`,
        S3_ENDPOINT: 'https://s3.us-east-1.amazonaws.com',
        S3_PUBLIC_URL: 'https://s3.us-east-1.amazonaws.com',
        S3_ACCESS_KEY: '',
        S3_SECRET_KEY: '',
        S3_REGION: 'us-east-1',
        S3_FORCE_PATH_STYLE: 'false',
        S3_PROCESS_DOCUMENTS_BUCKET: documentsBucket.bucketName,
        SLACK_BOT_TOKEN: env.slackBotToken,
        INTERNAL_API_TOKEN: env.internalApiToken,
        // Admin master (bypass total de permissoes). Demais admins recebem
        // titulares Caixa via perfil de permissoes.
        MASTER_ADMIN_CPFS: '00305852280',
      },
      logging: LogDriver.awsLogs({
        streamPrefix: getEnvName('jurisflow-api'),
        logRetention: RetentionDays.TWO_WEEKS,
      }),
    });

    const service = new Ec2Service(this, 'ApiService', {
      serviceName: getEnvName('jurisflow-api-service'),
      cluster,
      taskDefinition,
      desiredCount: MIN_CAPACITY,
      minHealthyPercent: env.isProd ? 100 : 0,
      maxHealthyPercent: 200,
      capacityProviderStrategies: [
        {
          capacityProvider: capacityProvider.capacityProviderName,
          weight: 1,
        },
      ],
    });
    this.service = service;

    const scalableTarget = service.autoScaleTaskCount({
      minCapacity: MIN_CAPACITY,
      maxCapacity: MAX_CAPACITY,
    });

    scalableTarget.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: CPU_THRESHOLD,
      scaleInCooldown: Duration.seconds(60),
      scaleOutCooldown: Duration.seconds(60),
    });

    this.turnOffDuringNight(autoScalingGroup);

    const loadBalancer = new ApplicationLoadBalancer(this, 'ApiLoadBalancer', {
      loadBalancerName: getEnvName('jurisflow-api-load-balancer'),
      vpc,
      securityGroup: ecsSecurityGroup,
    });

    const listener = loadBalancer.addListener('Listener', {
      port: apiPort,
    });

    listener.addTargets('ApiTargets', {
      port: apiPort,
      targets: [service],
      deregistrationDelay: env.isProd ? Duration.seconds(30) : Duration.seconds(5),
      healthCheck: {
        path: '/api/system/health',
        interval: Duration.seconds(10),
        unhealthyThresholdCount: 2,
        healthyThresholdCount: env.isProd ? 4 : 2,
        timeout: Duration.seconds(5),
      },
    });

    ecsSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      Port.tcp(apiPort),
      'Allow Load Balancer to ECS',
    );

    // const certificate = Certificate.fromCertificateArn(
    //   this,
    //   'ApiCertificate',
    //   env.domainCertificateArn,
    // );

    const httpApi = new HttpApi(this, 'HttpApi', {
      apiName: getEnvName('jurisflow-api-gateway'),
      // defaultDomainMapping: {
      //   domainName: new DomainName(this, 'ApiDomainName', {
      //     certificate,
      //     domainName: env.apiDomainName,
      //   }),
      // },
    });

    const albIntegration = new HttpAlbIntegration('AlbIntegration', listener);

    httpApi.addRoutes({
      path: '/{proxy+}',
      integration: albIntegration,
    });

    this.apiUrl = httpApi.url!;
  }

  private turnOffDuringNight(autoScalingGroup: AutoScalingGroup) {
    if (env.isProd) return;

    autoScalingGroup.scaleOnSchedule('ScaleDownNight', {
      schedule: Schedule.expression('0 4 * * *'),
      minCapacity: 0,
      maxCapacity: 0,
    });

    autoScalingGroup.scaleOnSchedule('ScaleUpMorning', {
      schedule: Schedule.expression('0 10 * * *'),
      minCapacity: MIN_CAPACITY,
      maxCapacity: MAX_CAPACITY,
    });
  }

  private getInstanceConfig() {
    if (env.isProd) {
      return {
        instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.SMALL),
        createWarmPool: false,
        memoryReservationMiB: 1700,
        cpu: 2048,
      };
    }

    return {
      instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.MICRO),
      createWarmPool: false,
      memoryReservationMiB: 700,
      cpu: 1024,
    };
  }
}
