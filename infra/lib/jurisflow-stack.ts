import * as cdk from 'aws-cdk-lib';
import { type Construct } from 'constructs';
import { WebApp } from './constructs/web';
import { Api } from './constructs/api';
import { Database } from './constructs/database';
import { Vpc } from './constructs/vpc';
import { Storage } from './constructs/storage';
import { Worker } from './constructs/worker';
import { IngestionWorker } from './constructs/ingestion-worker';
import { QueueMetrics } from './constructs/queue-metrics';

export class JurisflowAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const { vpc, workerEgressSubnets } = new Vpc(this, 'Vpc');

    const { databaseUrl } = new Database(this, 'Database', {
      vpc,
    });

    const { bucket: documentsBucket } = new Storage(this, 'Storage');

    const api = new Api(this, 'Api', {
      databaseUrl,
      vpc,
      documentsBucket,
    });
    const { apiUrl } = api;

    const worker = new Worker(this, 'Worker', {
      vpc,
      apiUrl,
      // Multi-IP: subnets de egress dedicadas (1 NAT/IP cada) p/ as replicas 2-4.
      egressSubnets: workerEgressSubnets,
    });
    // Ordena o deploy: o serviço ECS do worker só é atualizado DEPOIS de o serviço
    // da API estabilizar (novas tasks saudáveis). Como a migração (0031) roda no
    // boot da API antes do health check passar, isso garante que o worker novo (C=5,
    // que envia o claim_token) só sobe quando a API nova já tem a coluna e o fence.
    // Sem isto, o CloudFormation poderia atualizar os dois em paralelo/ordem
    // arbitraria e um worker concorrente bateria numa API velha sem fence.
    worker.node.addDependency(api.service);

    // Worker da fila de ingestao (scan/import): processo dedicado, multi-replica,
    // que drena a fila duravel no Postgres (claim+lease, SKIP LOCKED). Substitui o
    // fire-and-forget — sem SPOF, ECS reinicia em crash, escala pela profundidade
    // da fila (Fase 3). Le/escreve no bucket de documentos via IAM role.
    const ingestionWorker = new IngestionWorker(this, 'IngestionWorker', {
      vpc,
      databaseUrl,
      documentsBucket,
    });

    // Autoscaling pela profundidade da fila (nao por CPU) + alarme de fila travada
    // / workers mortos -> Slack. A metrica vem do EMF emitido pelo worker.
    new QueueMetrics(this, 'QueueMetrics', {
      scalableTarget: ingestionWorker.scalableTarget,
    });

    const { webAppUrl } = new WebApp(this, 'WebApp', { apiUrl });

    new cdk.CfnOutput(this, 'WebAppUrl', {
      value: webAppUrl,
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: apiUrl,
    });
  }
}
