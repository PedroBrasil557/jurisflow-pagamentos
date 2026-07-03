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

    // Recurso dimensionado para o POOL concorrente do degrau 5 (~55 contextos
    // Chromium + downloads de PDF simultaneos). Prod: 4 vCPU / 8 GB — ~55 contextos
    // com bloqueio de recursos (BLOCK_RESOURCES) ficam em ~5 GB; a folga cobre os
    // buffers de PDF. Reduzir CONSULTA_CONCURRENCY tambem reduz a necessidade de RAM.
    const taskDefinition = new FargateTaskDefinition(this, 'WorkerTaskDef', {
      cpu: env.isProd ? 4096 : 256,
      memoryLimitMiB: env.isProd ? 8192 : 512,
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
        // Degrau 5 (~5.000/h): espacamento BASE de 720ms. O freio (breaker) so
        // DESACELERA a partir daqui; nunca acelera abaixo deste valor. Kill-switch
        // de rollback sem redeploy de codigo: subir para '5000' (volta a ~720/h).
        CONSULTA_MIN_INTERVAL_MS: '720',
        // Slots concorrentes p/ preencher as janelas de render ~35s a 720ms (~C=L/S).
        // Kill-switch: baixar para '5' (ou '1' single-flight).
        CONSULTA_CONCURRENCY: '55',
        // Rampa de partida (0 -> 55 abas em ~2min): o freio acumula sinais durante a
        // subida e pode pausar/travar o piso antes de saturar. '0' desliga.
        SLOW_START_MS: '120000',
        // Freio de seguranca (so desacelera; pausa/trava piso ~1.500/h se o portal
        // reclamar). Manter '1' — desligar so p/ debug.
        BREAKER_ENABLED: '1',
        // Aborta imagens/fontes/analytics por consulta (menos requisicoes ao portal
        // + menos memoria por contexto). Obrigatorio nesta concorrencia.
        BLOCK_RESOURCES: '1',
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

    // Worker UNICO por design: o espacador global E o freio vivem EM MEMORIA no
    // processo (governam a taxa ao portal da Caixa). Nao escalar (desiredCount > 1)
    // sem antes migrar o pacing para estado compartilhado — senao cada task teria
    // seu proprio freio e a carga combinada excederia o limite. O claim no banco ja
    // e atomico (FOR UPDATE SKIP LOCKED) e fenceado por token, entao a correcao NAO
    // e o bloqueio aqui; a coordenacao do pacing e.
    //
    // Evolucao p/ multi-IP (so se a partida de 1 IP no degrau 5 PROVAR que o teto e
    // per-IP): exigiria (a) N NAT gateways/EIPs (hoje natGateways:1 = 1 IP de saida)
    // com uma task por AZ, e (b) pacing+freio DISTRIBUIDOS (token-bucket em Postgres:
    // portal_rate_gate.next_allowed_at + eventos de saude por janela). Nota: com
    // pacing GLOBAL, multi-IP nao adiciona vazao (mesma carga total, so espalhada);
    // so ajuda com pacing POR-IP, que e driblar o rate-limit per-IP do portal.
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
