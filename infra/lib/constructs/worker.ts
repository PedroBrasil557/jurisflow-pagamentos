import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import {
  type ISubnet,
  SecurityGroup,
  type SubnetSelection,
  SubnetType,
  Vpc,
} from 'aws-cdk-lib/aws-ec2';
import {
  Cluster,
  ContainerImage,
  FargateService,
  FargateTaskDefinition,
  LogDriver,
} from 'aws-cdk-lib/aws-ecs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import path from 'path';
import { env } from '../config/env';
import { getEnvName } from '../utils/getEnvName';

interface Props {
  vpc: Vpc;
  // URL publica da API (API Gateway). O worker chama os endpoints internos
  // (/api/internal/caixa-quitacao/*), protegidos por token de servico.
  apiUrl: string;
  // Subnets de egress dedicadas (1 NAT/EIP proprio cada) para as replicas 2..N.
  // Vazio fora de prod -> so a replica 1 (topologia barata de dev).
  egressSubnets: ISubnet[];
}

// Worker RPA (Fargate): consulta o termo de quitacao no portal da Caixa via
// Playwright headless e reporta o resultado a API.
//
// TOPOLOGIA MULTI-IP (1 task = 1 IP de saida): N replicas independentes, cada uma
// um FargateService de desiredCount 1 pinado numa subnet cujo route table aponta
// para um NAT proprio. O espacador global e o freio (PortalBreaker) EM MEMORIA de
// cada processo governam o IP daquele processo — e por isso que a topologia
// funciona sem pacing distribuido. Invariantes:
// - NUNCA desiredCount > 1 em nenhum service (2 tasks atras do mesmo NAT dobram a
//   taxa daquele IP e disparam o rate-limit do portal).
// - NUNCA mais de uma subnet no vpcSubnets das replicas 2..N (a task poderia ser
//   recriada na outra subnet e trocar de IP/NAT de forma nao deterministica).
// - minHealthy 0 / maxHealthy 100: o default (50/200) roda task velha e nova em
//   paralelo atras do MESMO NAT durante cada rolling deploy.
// O claim das filas ja e atomico (FOR UPDATE SKIP LOCKED) e fenceado por
// claim_token, entao N replicas nunca reivindicam/sobrescrevem o mesmo job.
//
// Taxa por IP: CONSULTA_MIN_INTERVAL_MS=2400 (~1.500/h) e a taxa PROVADA
// sustentavel em prod (2026-07-04): a 720ms (~5.400/h) o portal reagiu em ~45min
// com rajada de "indisponivel" e o freio travou o piso 2400ms. Nao voltar a 720.
export class Worker extends Construct {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const { vpc, apiUrl, egressSubnets } = props;

    const cluster = new Cluster(this, 'Cluster', {
      clusterName: getEnvName('jurisflow-worker-cluster'),
      vpc,
    });

    const securityGroup = new SecurityGroup(this, 'SecurityGroup', {
      securityGroupName: getEnvName('jurisflow-worker-security-group'),
      vpc,
      allowAllOutbound: true,
    });

    const imagePath = path.join(__dirname, '../../../worker');

    // UMA imagem (um build Docker) compartilhada por todos os task defs.
    const image = ContainerImage.fromAsset(imagePath);

    // LogGroup UNICO para todas as replicas: o Logs Insights consulta um alvo so.
    // Cada replica se distingue pelo streamPrefix e pelo campo "worker" da
    // telemetria. (O log group antigo, auto-criado por logRetention, fica retido
    // com o historico — nada e apagado.)
    const logGroup = new LogGroup(this, 'WorkerLogGroup', {
      logGroupName: getEnvName('jurisflow-worker-logs'),
      retention: RetentionDays.TWO_WEEKS,
    });

    type Replica = {
      suffix: string;
      workerId: string;
      vpcSubnets: SubnetSelection;
      serviceName: string;
    };

    const replicas: Replica[] = [
      // Replica 1 PRESERVA os logical IDs (WorkerTaskDef/WorkerService) e o
      // serviceName do worker original -> update in-place (mudar o serviceName
      // forcaria replacement do service). Sai pelo NAT pre-existente da VPC.
      {
        suffix: '',
        workerId: 'ip1',
        vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
        serviceName: getEnvName('jurisflow-worker-service'),
      },
      ...egressSubnets.map((subnet, i) => ({
        suffix: `Ip${i + 2}`,
        workerId: `ip${i + 2}`,
        vpcSubnets: { subnets: [subnet] },
        serviceName: getEnvName(`jurisflow-worker-service-ip${i + 2}`),
      })),
    ];

    for (const replica of replicas) {
      // 1 vCPU / 2 GB por replica: C=8 contextos Chromium com BLOCK_RESOURCES fica
      // bem abaixo de 2 GB (medido: 55 contextos ~ 5 GB). O in-flight real a
      // 2400ms e ~L/S ~ 2,5 (L~6s), entao 8 slots ja cobrem a cauda de latencia.
      const taskDefinition = new FargateTaskDefinition(
        this,
        `WorkerTaskDef${replica.suffix}`,
        {
          cpu: env.isProd ? 1024 : 256,
          memoryLimitMiB: env.isProd ? 2048 : 512,
        },
      );

      taskDefinition.addContainer('WorkerContainer', {
        containerName: getEnvName('jurisflow-worker-container'),
        image,
        environment: {
          ENVIRONMENT: env.envName,
          API_URL: apiUrl,
          POLL_MS: '5000',
          INTERNAL_API_TOKEN: env.internalApiToken,
          // Taxa sustentavel POR IP (~1.500/h) — ver comentario da classe.
          // Kill-switch sem redeploy de codigo: subir para '5000' (~720/h).
          CONSULTA_MIN_INTERVAL_MS: '2400',
          // Slots concorrentes p/ preencher as janelas de render a 2400ms.
          // Kill-switch: baixar para '1' (single-flight).
          CONSULTA_CONCURRENCY: '8',
          // Rampa de partida (0 -> 8 abas em ~2min): o freio acumula sinais
          // durante a subida e pode pausar antes de saturar. '0' desliga.
          SLOW_START_MS: '120000',
          // Freio de seguranca (so desacelera; pausa/trava piso se o portal
          // reclamar). Manter '1' — desligar so p/ debug.
          BREAKER_ENABLED: '1',
          // Aborta imagens/media/fontes/analytics por consulta.
          BLOCK_RESOURCES: '1',
          // Identidade da replica na telemetria e nos logs de boot — insumo da
          // analise per-IP no Logs Insights (limite do portal e per-IP ou global?).
          WORKER_ID: replica.workerId,
        },
        logging: LogDriver.awsLogs({
          logGroup,
          streamPrefix: getEnvName(`jurisflow-worker-${replica.workerId}`),
        }),
        // Liveness: o worker toca /tmp/worker-heartbeat a cada ~10s enquanto o
        // event-loop vive. Se travar (mtime > 60s), o ECS reinicia a task.
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

      new FargateService(this, `WorkerService${replica.suffix}`, {
        serviceName: replica.serviceName,
        cluster,
        taskDefinition,
        desiredCount: 1,
        minHealthyPercent: 0,
        maxHealthyPercent: 100,
        assignPublicIp: false,
        securityGroups: [securityGroup],
        vpcSubnets: replica.vpcSubnets,
      });
    }
  }
}
