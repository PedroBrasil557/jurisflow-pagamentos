import {
  InstanceClass,
  InstanceSize,
  InstanceType,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  Vpc,
} from 'aws-cdk-lib/aws-ec2';
import {
  Credentials,
  DatabaseInstance,
  DatabaseInstanceEngine,
  PostgresEngineVersion,
} from 'aws-cdk-lib/aws-rds';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { getEnvName } from '../utils/getEnvName';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { env } from '../config/env';

interface Props {
  vpc: Vpc;
}

export class Database extends Construct {
  readonly databaseUrl: string;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const { vpc } = props;

    const engine = DatabaseInstanceEngine.postgres({ version: PostgresEngineVersion.VER_17 });
    const instanceType = env.isProd
      ? InstanceType.of(InstanceClass.T4G, InstanceSize.SMALL)
      : InstanceType.of(InstanceClass.T4G, InstanceSize.MICRO);
    const port = 5432;
    const username = 'postgres';
    const databaseName = 'jurisflow';

    const masterUserSecret = new Secret(this, 'DBSecret', {
      secretName: getEnvName('jurisflow-db-user-secret'),
      description: 'Database credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username }),
        generateStringKey: 'password',
        passwordLength: 16,
        excludePunctuation: true,
      },
    });

    const securityGroup = new SecurityGroup(this, 'Database-SG', {
      securityGroupName: getEnvName('jurisflow-database-security-group'),
      vpc,
    });

    securityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(port),
      `Allow port ${port} for database connection`,
    );

    const database = new DatabaseInstance(this, 'Database', {
      databaseName,
      vpc,
      instanceType,
      engine,
      port,
      securityGroups: [securityGroup],
      credentials: Credentials.fromSecret(masterUserSecret),
      backupRetention: Duration.days(7),
      deleteAutomatedBackups: true,
      removalPolicy: RemovalPolicy.DESTROY,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      publiclyAccessible: true,
      enablePerformanceInsights: true,
      monitoringInterval: Duration.minutes(1),
    });

    const dbEndpoint = database.dbInstanceEndpointAddress;

    const password = masterUserSecret.secretValueFromJson('password').unsafeUnwrap();

    this.databaseUrl = `postgresql://${username}:${password}@${dbEndpoint}:${port}/${databaseName}`;
  }
}
