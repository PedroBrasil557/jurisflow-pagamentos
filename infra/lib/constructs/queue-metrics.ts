import { Duration } from 'aws-cdk-lib';
import { AdjustmentType } from 'aws-cdk-lib/aws-applicationautoscaling';
import {
  Alarm,
  ComparisonOperator,
  Metric,
  TreatMissingData,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import type { ScalableTaskCount } from 'aws-cdk-lib/aws-ecs';
import { Code, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { LambdaSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';
import { env } from '../config/env';
import { getEnvName } from '../utils/getEnvName';

interface Props {
  // Alvo de escala do IngestionWorker (exposto pelo construct). A politica de
  // escala por profundidade de fila e anexada aqui (onde a metrica e definida).
  scalableTarget: ScalableTaskCount;
}

// Namespace/dimensao tem que casar com o EMF emitido pelo worker
// (processes.ingestion.metrics.ts). O worker faz console.log do EMF; o CloudWatch
// Logs extrai estas metricas automaticamente — sem SDK nem PutMetricData no worker.
const METRICS_NAMESPACE = 'Jurisflow/Ingestion';

// Handler inline (Node 20, fetch global — sem dependencia, sem bundle/esbuild).
// Recebe o evento do alarme via SNS e posta no Slack (chat.postMessage). So
// notifica nas TRANSICOES de estado (o proprio alarme deduplica), entao nao spamma.
const SLACK_NOTIFIER_CODE = `
exports.handler = async (event) => {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_ALERT_CHANNEL;
  if (!token) { console.error('SLACK_BOT_TOKEN ausente — alerta nao enviado'); return; }
  for (const record of (event.Records || [])) {
    let msg;
    try { msg = JSON.parse(record.Sns.Message); }
    catch { msg = { AlarmName: 'alarme', NewStateValue: '', NewStateReason: record.Sns.Message }; }
    const state = msg.NewStateValue || '';
    const emoji = state === 'ALARM' ? ':rotating_light:' : state === 'OK' ? ':white_check_mark:' : ':warning:';
    const text = emoji + ' *' + (msg.AlarmName || 'alarme') + '* — ' + state + ' · ' + (msg.NewStateReason || '');
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ channel, text }),
    });
    const body = await res.json().catch(() => ({ ok: false, error: 'resposta nao-json' }));
    if (!body.ok) console.error('Slack recusou a mensagem', body.error);
  }
};
`;

// Observabilidade + autoscaling da fila de ingestao (Fase 3). Escala o worker pela
// PROFUNDIDADE DA FILA (nao por CPU — o worker fica ocioso em CPU esperando a IA) e
// alarma quando a fila trava (job mais antigo > 15min) ou quando TODOS os workers
// morrem (a metrica some => treatMissingData: BREACHING). O alarme avisa no Slack.
export class QueueMetrics extends Construct {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const { scalableTarget } = props;

    const dimensionsMap = { Environment: env.envName };

    // Backlog que precisa de worker (mesmo predicado do claim). Maximum: com
    // multiplas replicas emitindo o mesmo valor, pega o pior backlog observado.
    const queueDepth = new Metric({
      namespace: METRICS_NAMESPACE,
      metricName: 'QueueDepth',
      dimensionsMap,
      statistic: 'Maximum',
      period: Duration.minutes(1),
    });

    // Ha quanto tempo o job mais antigo espera. Cresce quando os workers nao drenam.
    const oldestAge = new Metric({
      namespace: METRICS_NAMESPACE,
      metricName: 'OldestQueuedAgeSeconds',
      dimensionsMap,
      statistic: 'Maximum',
      period: Duration.minutes(1),
    });

    // Step scaling pela fila. Thresholds em valor absoluto (MAX do worker e
    // pequeno, ~6): previsivel e sem divisao por capacidade. Escala in quando
    // esvazia (respeitando o minCapacity do alvo).
    scalableTarget.scaleOnMetric('QueueDepthScaling', {
      metric: queueDepth,
      adjustmentType: AdjustmentType.CHANGE_IN_CAPACITY,
      cooldown: Duration.seconds(60),
      scalingSteps: [
        { upper: 1, change: -1 },
        { lower: 3, change: +1 },
        { lower: 10, change: +2 },
        { lower: 20, change: +3 },
      ],
    });

    // Topico de alertas + notificador Slack (Lambda inline, fora da VPC: precisa
    // de internet para o slack.com e nao toca o banco).
    const alertTopic = new Topic(this, 'AlertTopic', {
      topicName: getEnvName('jurisflow-ingestion-alerts'),
    });

    const slackNotifier = new LambdaFunction(this, 'SlackNotifier', {
      functionName: getEnvName('jurisflow-ingestion-slack-notifier'),
      runtime: Runtime.NODEJS_20_X,
      handler: 'index.handler',
      timeout: Duration.seconds(10),
      code: Code.fromInline(SLACK_NOTIFIER_CODE),
      environment: {
        SLACK_BOT_TOKEN: env.slackBotToken,
        SLACK_ALERT_CHANNEL: process.env.SLACK_ALERT_CHANNEL ?? '#alertas',
      },
    });

    alertTopic.addSubscription(new LambdaSubscription(slackNotifier));

    // Fila travada OU todos os workers mortos. treatMissingData BREACHING: se o
    // worker para de emitir (todos mortos), a ausencia da metrica ja dispara —
    // 3 datapoints (~3min) evita alarme por blip. 15min cobre o backoff legitimo
    // de retry (teto de 10min) sem falso-positivo.
    const stuckAlarm = new Alarm(this, 'QueueStuckAlarm', {
      alarmName: getEnvName('jurisflow-ingestion-queue-stuck'),
      alarmDescription:
        'Fila de ingestao travada (job mais antigo > 15min) ou todos os workers mortos (metrica ausente).',
      metric: oldestAge,
      threshold: 900,
      evaluationPeriods: 3,
      datapointsToAlarm: 3,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.BREACHING,
    });

    stuckAlarm.addAlarmAction(new SnsAction(alertTopic));
    // Notifica tambem a recuperacao (ALARM -> OK), para fechar o ciclo no Slack.
    stuckAlarm.addOkAction(new SnsAction(alertTopic));
  }
}
