import { Duration } from 'aws-cdk-lib';
import { Schedule } from 'aws-cdk-lib/aws-applicationautoscaling';
import { SecurityGroup, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import {
  Cluster,
  ContainerImage,
  FargateService,
  FargateTaskDefinition,
  LogDriver,
} from 'aws-cdk-lib/aws-ecs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import path from 'path';
import { env } from '../config/env';
import { getEnvName } from '../utils/getEnvName';

interface Props {
  vpc: Vpc;
  databaseUrl: string;
  documentsBucket: s3.Bucket;
}

// Baseline de replicas. >= 2 em prod elimina o SPOF: o claim usa FOR UPDATE SKIP
// LOCKED, entao varias replicas processam a fila com seguranca (cada job e de uma
// so). Se uma replica morre, as outras seguem drenando — sem depender de humano.
const MIN_CAPACITY = env.isProd ? 2 : 1;
// Teto de escala (Fase 3 ajusta o desiredCount entre MIN e MAX pela profundidade
// da fila). O gargalo real e o provider de IA (rate-limit/custo): cada task roda
// INGESTION_CONCURRENCY jobs, entao MAX * CONCURRENCY = pico de extracoes simultaneas.
const MAX_CAPACITY = env.isProd ? 6 : 2;

// Worker dedicado da fila de ingestao (scan/import) — Fargate. Mesma imagem da API
// (`bun run worker`), processo separado: isola o trabalho pesado (PDF/IA) do
// event-loop que atende requisicoes. Roda em subnet privada com egress por NAT
// (precisa do S3, do Postgres e da API da Anthropic). Multi-replica por design.
export class IngestionWorker extends Construct {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const { vpc, databaseUrl, documentsBucket } = props;

    const cluster = new Cluster(this, 'Cluster', {
      clusterName: getEnvName('jurisflow-ingestion-cluster'),
      vpc,
    });

    const securityGroup = new SecurityGroup(this, 'SecurityGroup', {
      securityGroupName: getEnvName('jurisflow-ingestion-security-group'),
      vpc,
      allowAllOutbound: true,
    });

    const taskDefinition = new FargateTaskDefinition(this, 'IngestionTaskDef', {
      // PDF (pdf-lib) carrega o documento inteiro em memoria; lotes grandes pesam.
      // Memoria folgada evita OOM (que viraria crash-loop). IA e rede, nao CPU.
      cpu: env.isProd ? 1024 : 512,
      memoryLimitMiB: env.isProd ? 2048 : 1024,
    });

    // Le PDFs e grava os splits no bucket — via IAM role (S3_ACCESS_KEY/SECRET
    // vazios fazem o SDK usar as credenciais da task), igual a API em producao.
    documentsBucket.grantReadWrite(taskDefinition.taskRole);

    // Mesma imagem da API: o codigo do worker ja esta nela (`bun run worker`).
    const imagePath = path.join(__dirname, '../../../api');
    const image = ContainerImage.fromAsset(imagePath);

    taskDefinition.addContainer('IngestionContainer', {
      containerName: getEnvName('jurisflow-ingestion-container'),
      image,
      command: ['bun', 'run', 'worker'],
      environment: {
        ENVIRONMENT: env.envName,
        DATABASE_URL: databaseUrl,
        // Pool baixo por replica: MAX_CAPACITY * DB_POOL_MAX + API nao pode
        // estourar o max_connections do RDS ao escalar (ver nota no stack).
        DB_POOL_MAX: '5',
        // O worker nao usa auth, mas carrega o mesmo env.ts da API (z.min(32)).
        // Em prod o secret existe; mantido igual a API por consistencia.
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? '',
        // S3 por IAM role (sem chave estatica) — espelha a config de prod da API.
        S3_ENDPOINT: 'https://s3.us-east-1.amazonaws.com',
        S3_PUBLIC_URL: 'https://s3.us-east-1.amazonaws.com',
        S3_ACCESS_KEY: '',
        S3_SECRET_KEY: '',
        S3_REGION: 'us-east-1',
        S3_FORCE_PATH_STYLE: 'false',
        S3_PROCESS_DOCUMENTS_BUCKET: documentsBucket.bucketName,
        // Extracao de IA roda AQUI (movida da API). Sem a chave, o worker boota
        // mas a extracao falha — o segredo vem do GitHub Actions em prod.
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
        ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8',
        INTERNAL_API_TOKEN: env.internalApiToken,
        INGESTION_POLL_MS: env.isProd ? '3000' : '5000',
        // Backpressure real: limite de jobs simultaneos por replica (o gargalo e
        // o rate-limit/custo da IA). Baixo de proposito.
        INGESTION_CONCURRENCY: '2',
      },
      logging: LogDriver.awsLogs({
        streamPrefix: getEnvName('jurisflow-ingestion'),
        logRetention: RetentionDays.TWO_WEEKS,
      }),
    });

    const service = new FargateService(this, 'IngestionService', {
      serviceName: getEnvName('jurisflow-ingestion-service'),
      cluster,
      taskDefinition,
      desiredCount: MIN_CAPACITY,
      assignPublicIp: false,
      securityGroups: [securityGroup],
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      },
      // Se a task crasha repetidamente, o ECS ja a reinicia sozinho. minHealthy
      // 0 em dev evita travar deploy com 1 replica; 100% em prod mantem cobertura.
      minHealthyPercent: env.isProd ? 100 : 0,
    });

    // Alvo de escala (MIN..MAX). A Fase 3 anexa o target-tracking pela
    // profundidade da fila (metrica custom), nao por CPU — o worker fica ocioso
    // em CPU enquanto espera a IA, entao CPU nao reflete a carga real.
    const scalableTarget = service.autoScaleTaskCount({
      minCapacity: MIN_CAPACITY,
      maxCapacity: MAX_CAPACITY,
    });

    // Exposto para a Fase 3 (queue-metrics) anexar a politica de escala.
    this.scalableTarget = scalableTarget;

    // Fora de prod: desliga a noite (paridade de custo com a API, que tambem
    // escala a 0). A fila e duravel — jobs enfileirados de madrugada drenam de
    // manha quando o worker volta; nada se perde.
    if (!env.isProd) {
      scalableTarget.scaleOnSchedule('ScaleDownNight', {
        schedule: Schedule.cron({ hour: '4', minute: '0' }),
        minCapacity: 0,
        maxCapacity: 0,
      });

      scalableTarget.scaleOnSchedule('ScaleUpMorning', {
        schedule: Schedule.cron({ hour: '10', minute: '0' }),
        minCapacity: MIN_CAPACITY,
        maxCapacity: MAX_CAPACITY,
      });
    }
  }

  // Alvo de escala do servico — a Fase 3 (queue-metrics) anexa aqui a politica
  // target-tracking baseada na profundidade da fila.
  readonly scalableTarget: ReturnType<FargateService['autoScaleTaskCount']>;
}
