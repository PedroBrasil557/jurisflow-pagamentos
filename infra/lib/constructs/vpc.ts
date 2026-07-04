import { Construct } from 'constructs';
import { getEnvName } from '../utils/getEnvName';
import {
  CfnEIP,
  CfnNatGateway,
  CfnVPCCidrBlock,
  type ISubnet,
  PrivateSubnet,
  Vpc as VpcConstruct,
} from 'aws-cdk-lib/aws-ec2';
import { env } from '../config/env';

export class Vpc extends Construct {
  readonly vpc: VpcConstruct;
  // Subnets de egress dedicadas ao worker multi-IP: cada uma tem route table e
  // NAT/EIP proprios, entao o IP de saida de quem roda nela e deterministico.
  // Vazio fora de prod (dev fica com a topologia barata de 1 NAT).
  readonly workerEgressSubnets: ISubnet[] = [];

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.vpc = new VpcConstruct(this, 'JurisflowVpc', {
      vpcName: getEnvName('jurisflow-vpc'),
      restrictDefaultSecurityGroup: false,
      availabilityZones: ['us-east-1a', 'us-east-1b'],
      natGateways: 1,
    });

    if (!env.isProd) {
      return;
    }

    // Multi-IP do worker de quitacao: o 10.0.0.0/16 primario esta 100% consumido
    // pelas 4 subnets /18 originais, entao as subnets novas vivem num CIDR
    // SECUNDARIO associado a VPC. Tudo abaixo e ADITIVO — nenhum recurso existente
    // (subnets com RDS/API/ingestao dentro) muda de logical ID ou de CIDR. O
    // roteamento interno para 10.1.x.x e automatico (rota "local" da VPC cobre
    // todos os CIDRs associados).
    const secondaryCidr = new CfnVPCCidrBlock(this, 'WorkerEgressCidr', {
      vpcId: this.vpc.vpcId,
      cidrBlock: '10.1.0.0/16',
    });

    const publicSubnetByAz = new Map(
      this.vpc.publicSubnets.map((subnet) => [subnet.availabilityZone, subnet]),
    );

    // 1 subnet = 1 NAT = 1 EIP = 1 IP de saida (replicas 2-4 do worker; a replica 1
    // sai pelo NAT pre-existente da VPC). O par NAT/subnet fica sempre na MESMA AZ
    // (sem custo nem acoplamento cross-AZ); alternar AZs so espalha o risco.
    const egressDefs = [
      { name: 'WorkerEgress2', cidr: '10.1.0.0/24', az: 'us-east-1a' },
      { name: 'WorkerEgress3', cidr: '10.1.1.0/24', az: 'us-east-1b' },
      { name: 'WorkerEgress4', cidr: '10.1.2.0/24', az: 'us-east-1a' },
    ];

    for (const def of egressDefs) {
      const eip = new CfnEIP(this, `${def.name}Eip`, {
        domain: 'vpc',
        tags: [{ key: 'Name', value: getEnvName(def.name.toLowerCase()) }],
      });

      const publicSubnet = publicSubnetByAz.get(def.az);
      if (!publicSubnet) {
        throw new Error(`Sem subnet publica na AZ ${def.az} para o NAT`);
      }

      // O NAT vive na subnet PUBLICA existente da mesma AZ (varios NATs por subnet
      // publica e permitido). allocationId exige attrAllocationId — eip.ref
      // devolve o IP em string e falha no deploy.
      const nat = new CfnNatGateway(this, `${def.name}Nat`, {
        subnetId: publicSubnet.subnetId,
        allocationId: eip.attrAllocationId,
        tags: [{ key: 'Name', value: getEnvName(def.name.toLowerCase()) }],
      });

      const subnet = new PrivateSubnet(this, `${def.name}Subnet`, {
        vpcId: this.vpc.vpcId,
        cidrBlock: def.cidr,
        availabilityZone: def.az,
        mapPublicIpOnLaunch: false,
      });
      // A subnet so pode ser criada DEPOIS de o CIDR secundario associar — sem a
      // dependencia explicita o create falha de forma intermitente
      // (InvalidSubnet.Range).
      subnet.node.addDependency(secondaryCidr);
      // Route table propria (criada pelo PrivateSubnet) com default route para o
      // NAT dedicado desta subnet.
      subnet.addDefaultNatRoute(nat.ref);

      this.workerEgressSubnets.push(subnet);
    }
  }
}
