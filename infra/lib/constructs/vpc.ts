import { Construct } from 'constructs';
import { getEnvName } from '../utils/getEnvName';
import { Vpc as VpcConstruct } from 'aws-cdk-lib/aws-ec2';

export class Vpc extends Construct {
  readonly vpc: VpcConstruct;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.vpc = new VpcConstruct(this, 'JurisflowVpc', {
      vpcName: getEnvName('jurisflow-vpc'),
      restrictDefaultSecurityGroup: false,
      availabilityZones: ['us-east-1a', 'us-east-1b'],
      natGateways: 1,
    });
  }
}
