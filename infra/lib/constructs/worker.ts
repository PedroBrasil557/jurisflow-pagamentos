import { Construct } from 'constructs';
import { SecurityGroup, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import {
  Cluster,
  ContainerImage,
  FargateService,
  FargateTaskDefinition,
  LogDriver,
} from 'aws-cdk-lib/aws-ecs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import path from 'path';
import { env } from '../config/env';
import { getEnvName } from '../utils/getEnvName';

interface Props {
  vpc: Vpc;
  // URL publica da API (API Gateway). O worker chama os endpoints internos
  // (/api/internal/caixa-quitacao/*), protegidos por token de servico.
  apiUrl: string;
}

// Worker RPA (Fargate): consulta o termo de quitacao no portal da Caixa via
// Playwright headless e reporta o resultado a API. Roda em subnet privada com
// egress por NAT (acessa o site da Caixa + a API publica).
export class Worker extends Construct {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const { vpc, apiUrl } = props;

    const cluster = new Cluster(this, 'Cluster', {
      clusterName: getEnvName('jurisflow-worker-cluster'),
      vpc,
    });

    const securityGroup = new SecurityGroup(this, 'SecurityGroup', {
      securityGroupName: getEnvName('jurisflow-worker-security-group'),
      vpc,
      allowAllOutbound: true,
    });

    const taskDefinition = new FargateTaskDefinition(this, 'WorkerTaskDef', {
      cpu: env.isProd ? 512 : 256,
      memoryLimitMiB: env.isProd ? 1024 : 512,
    });

    const imagePath = path.join(__dirname, '../../../worker');

    const image = ContainerImage.fromAsset(imagePath);

    taskDefinition.addContainer('WorkerContainer', {
      containerName: getEnvName('jurisflow-worker-container'),
      image,
      environment: {
        ENVIRONMENT: env.envName,
        API_URL: apiUrl,
        POLL_MS: env.isProd ? '10000' : '5000',
        INTERNAL_API_TOKEN: process.env.INTERNAL_API_TOKEN ?? '',
      },
      logging: LogDriver.awsLogs({
        streamPrefix: getEnvName('jurisflow-worker'),
        logRetention: RetentionDays.TWO_WEEKS,
      }),
    });

    // Worker unico: o claim no banco NAO usa FOR UPDATE SKIP LOCKED. Para escalar
    // (desiredCount > 1), ajustar o claim antes de aumentar a contagem.
    new FargateService(this, 'WorkerService', {
      serviceName: getEnvName('jurisflow-worker-service'),
      cluster,
      taskDefinition,
      desiredCount: 1,
      assignPublicIp: false,
      securityGroups: [securityGroup],
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      },
    });
  }
}
