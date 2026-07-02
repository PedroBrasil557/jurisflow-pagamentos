import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
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

    // Recurso dimensionado para o POOL concorrente (varios contextos Chromium +
    // downloads de PDF simultaneos). Prod: 1 vCPU / 2 GB (validar RAM com PDFs
    // reais; subir para 3-4 GB se aumentar CONSULTA_CONCURRENCY).
    const taskDefinition = new FargateTaskDefinition(this, 'WorkerTaskDef', {
      cpu: env.isProd ? 1024 : 256,
      memoryLimitMiB: env.isProd ? 2048 : 512,
    });

    const imagePath = path.join(__dirname, '../../../worker');

    const image = ContainerImage.fromAsset(imagePath);

    taskDefinition.addContainer('WorkerContainer', {
      containerName: getEnvName('jurisflow-worker-container'),
      image,
      environment: {
        ENVIRONMENT: env.envName,
        API_URL: apiUrl,
        POLL_MS: '5000',
        INTERNAL_API_TOKEN: env.internalApiToken,
        // Espacamento global entre inicios de consulta (freio educado ao portal
        // da Caixa). A concorrencia so preenche as janelas ociosas de render.
        CONSULTA_MIN_INTERVAL_MS: '5000',
        // Slots concorrentes. ~5 saturam o freio de 5s (~720/h) com L~24s de render.
        // Kill-switch de rollback sem redeploy de codigo: baixar para '1'.
        CONSULTA_CONCURRENCY: '5',
      },
      logging: LogDriver.awsLogs({
        streamPrefix: getEnvName('jurisflow-worker'),
        logRetention: RetentionDays.TWO_WEEKS,
      }),
      // Liveness: o worker toca /tmp/worker-heartbeat a cada ~10s enquanto o
      // event-loop vive. Se travar (mtime > 60s), o ECS reinicia a task — mitiga
      // o SPOF do worker unico. (Crash/exit ja e reconciliado pelo desiredCount.)
      healthCheck: {
        command: [
          'CMD-SHELL',
          'test -f /tmp/worker-heartbeat && test $(( $(date +%s) - $(stat -c %Y /tmp/worker-heartbeat) )) -lt 60',
        ],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(60),
      },
    });

    // Worker UNICO por design: o espacador global de consultas vive EM MEMORIA no
    // processo (governa a taxa ao portal da Caixa). Nao escalar (desiredCount > 1)
    // sem antes migrar o pacing para estado compartilhado — senao cada task teria
    // seu proprio freio e a carga combinada excederia o limite. O claim no banco ja
    // e atomico (FOR UPDATE SKIP LOCKED) e fenceado por token, entao a correcao NAO
    // e o bloqueio aqui; a coordenacao do pacing e.
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
