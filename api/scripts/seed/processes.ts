import { eq } from 'drizzle-orm'
import {
  process,
  processHistory,
} from '../../src/modules/processes/processes.schema'
import type { ProcessStatus } from '../../src/modules/processes/processes.status'
import { db } from '../../src/shared/db'
import type { SeededUser } from './users'

type ProcessSeedInput = {
  code: string
  createdByCpf: string
  housingComplexId: string
  housingComplexName: string
  fullName: string
  cpf: string
  birthDate: string
  status: ProcessStatus
  attorneyCpf?: string
  documentationAssigneeCpf?: string
  legalProcessNumber?: string
  causeValue?: string
  protocolDate?: string
  cancellationReason?: string
}

const seedProcesses: ProcessSeedInput[] = [
  // EM_DOCUMENTACAO — 5
  {
    code: 'SEED-001',
    createdByCpf: '71428793860', // Mariana
    housingComplexId: 'hc_jardim_das_flores',
    housingComplexName: 'Residencial Jardim das Flores',
    fullName: 'Joaquim Pereira da Silva',
    cpf: '18476935200',
    birthDate: '1975-03-12',
    status: 'EM_DOCUMENTACAO',
    documentationAssigneeCpf: '23154285997', // Joao
  },
  {
    code: 'SEED-002',
    createdByCpf: '71428793860', // Mariana
    housingComplexId: 'hc_jardim_das_flores',
    housingComplexName: 'Residencial Jardim das Flores',
    fullName: 'Ana Rita Monteiro',
    cpf: '27429058558',
    birthDate: '1982-07-28',
    status: 'EM_DOCUMENTACAO',
  },
  {
    code: 'SEED-003',
    createdByCpf: '39053344705', // Paula
    housingComplexId: 'hc_morada_do_sol',
    housingComplexName: 'Morada do Sol',
    fullName: 'Pedro Henrique Souza',
    cpf: '52099841845',
    birthDate: '1988-11-05',
    status: 'EM_DOCUMENTACAO',
  },
  {
    code: 'SEED-004',
    createdByCpf: '84521530664', // Rafael
    housingComplexId: 'hc_vila_nova',
    housingComplexName: 'Conjunto Vila Nova',
    fullName: 'Carla Fernandes Rocha',
    cpf: '33295177864',
    birthDate: '1991-01-22',
    status: 'EM_DOCUMENTACAO',
    documentationAssigneeCpf: '96703451206', // Ana
  },
  {
    code: 'SEED-005',
    createdByCpf: '71428793860', // Mariana
    housingComplexId: 'hc_bosque_verde',
    housingComplexName: 'Residencial Bosque Verde',
    fullName: 'Ricardo Almeida Nunes',
    cpf: '41663597898',
    birthDate: '1979-09-14',
    status: 'EM_DOCUMENTACAO',
  },

  // DOCUMENTACAO_PRONTA — 3
  {
    code: 'SEED-006',
    createdByCpf: '39053344705', // Paula
    housingComplexId: 'hc_morada_do_sol',
    housingComplexName: 'Morada do Sol',
    fullName: 'Luciana Silva Campos',
    cpf: '60594731801',
    birthDate: '1986-04-30',
    status: 'DOCUMENTACAO_PRONTA',
  },
  {
    code: 'SEED-007',
    createdByCpf: '84521530664', // Rafael
    housingComplexId: 'hc_alvorada',
    housingComplexName: 'Conjunto Alvorada',
    fullName: 'Eduardo Martins Lima',
    cpf: '79823140669',
    birthDate: '1980-12-03',
    status: 'DOCUMENTACAO_PRONTA',
  },
  {
    code: 'SEED-008',
    createdByCpf: '71428793860', // Mariana
    housingComplexId: 'hc_vila_nova',
    housingComplexName: 'Conjunto Vila Nova',
    fullName: 'Beatriz Cardoso Moreira',
    cpf: '85634219051',
    birthDate: '1993-06-18',
    status: 'DOCUMENTACAO_PRONTA',
    documentationAssigneeCpf: '96703451206', // Ana
  },

  // EM_PROCESSO — 4
  {
    code: 'SEED-009',
    createdByCpf: '71428793860', // Mariana
    housingComplexId: 'hc_jardim_das_flores',
    housingComplexName: 'Residencial Jardim das Flores',
    fullName: 'Sandro Gomes de Oliveira',
    cpf: '12948365791',
    birthDate: '1972-02-09',
    status: 'EM_PROCESSO',
    attorneyCpf: '11144477735', // Carlos
    legalProcessNumber: '1001234-56.2025.8.26.0100',
    causeValue: '250000.00',
    protocolDate: '2025-08-15',
  },
  {
    code: 'SEED-010',
    createdByCpf: '84521530664', // Rafael
    housingComplexId: 'hc_vila_nova',
    housingComplexName: 'Conjunto Vila Nova',
    fullName: 'Marta Ribeiro Carvalho',
    cpf: '94071568267',
    birthDate: '1984-10-11',
    status: 'EM_PROCESSO',
    attorneyCpf: '11144477735', // Carlos
    legalProcessNumber: '1002345-67.2025.8.19.0001',
    causeValue: '185000.00',
    protocolDate: '2025-09-01',
  },
  {
    code: 'SEED-011',
    createdByCpf: '39053344705', // Paula
    housingComplexId: 'hc_morada_do_sol',
    housingComplexName: 'Morada do Sol',
    fullName: 'Daniel Correa Tavares',
    cpf: '30825647126',
    birthDate: '1977-05-25',
    status: 'EM_PROCESSO',
    attorneyCpf: '52998224725', // Beatriz
    legalProcessNumber: '2003456-78.2025.8.13.0024',
    causeValue: '220000.00',
    protocolDate: '2025-09-12',
  },
  {
    code: 'SEED-012',
    createdByCpf: '84521530664', // Rafael
    housingComplexId: 'hc_alvorada',
    housingComplexName: 'Conjunto Alvorada',
    fullName: 'Patricia Lima Azevedo',
    cpf: '57298013432',
    birthDate: '1989-08-07',
    status: 'EM_PROCESSO',
    attorneyCpf: '52998224725', // Beatriz
    legalProcessNumber: '3004567-89.2025.8.06.0001',
    causeValue: '170000.00',
    protocolDate: '2025-10-05',
  },

  // FINALIZADO — 3
  {
    code: 'SEED-013',
    createdByCpf: '71428793860', // Mariana
    housingComplexId: 'hc_jardim_das_flores',
    housingComplexName: 'Residencial Jardim das Flores',
    fullName: 'Roberto Nunes Ferreira',
    cpf: '68523091424',
    birthDate: '1969-11-17',
    status: 'FINALIZADO',
    attorneyCpf: '11144477735', // Carlos
    legalProcessNumber: '4005678-90.2024.8.26.0100',
    causeValue: '195000.00',
    protocolDate: '2024-11-20',
  },
  {
    code: 'SEED-014',
    createdByCpf: '84521530664', // Rafael
    housingComplexId: 'hc_vila_nova',
    housingComplexName: 'Conjunto Vila Nova',
    fullName: 'Leticia Sampaio Barros',
    cpf: '77312908594',
    birthDate: '1983-03-04',
    status: 'FINALIZADO',
    attorneyCpf: '52998224725', // Beatriz
    legalProcessNumber: '5006789-01.2024.8.19.0001',
    causeValue: '210000.00',
    protocolDate: '2025-01-09',
  },
  {
    code: 'SEED-015',
    createdByCpf: '39053344705', // Paula
    housingComplexId: 'hc_morada_do_sol',
    housingComplexName: 'Morada do Sol',
    fullName: 'Andre Luiz Batista',
    cpf: '86145732008',
    birthDate: '1976-06-30',
    status: 'FINALIZADO',
    attorneyCpf: '52998224725', // Beatriz
    legalProcessNumber: '6007890-12.2024.8.13.0024',
    causeValue: '240000.00',
    protocolDate: '2025-02-14',
  },

  // CANCELADO — 3
  {
    code: 'SEED-016',
    createdByCpf: '71428793860', // Mariana
    housingComplexId: 'hc_jardim_das_flores',
    housingComplexName: 'Residencial Jardim das Flores',
    fullName: 'Vanessa Alves Teixeira',
    cpf: '94568731291',
    birthDate: '1990-01-28',
    status: 'CANCELADO',
  },
  {
    code: 'SEED-017',
    createdByCpf: '84521530664', // Rafael
    housingComplexId: 'hc_alvorada',
    housingComplexName: 'Conjunto Alvorada',
    fullName: 'Thiago Ramos Peixoto',
    cpf: '24973156043',
    birthDate: '1985-07-21',
    status: 'CANCELADO',
    cancellationReason: 'Cliente desistiu do processo por mudanca de cidade.',
  },
  {
    code: 'SEED-018',
    createdByCpf: '39053344705', // Paula
    housingComplexId: 'hc_morada_do_sol',
    housingComplexName: 'Morada do Sol',
    fullName: 'Camila Mendes Oliveira',
    cpf: '35719420606',
    birthDate: '1992-10-12',
    status: 'CANCELADO',
    attorneyCpf: '11144477735', // Carlos
    legalProcessNumber: '7008901-23.2024.8.13.0024',
    causeValue: '155000.00',
    protocolDate: '2024-08-02',
    cancellationReason: 'Documentacao recusada apos analise juridica.',
  },
]

type UsersIndex = Map<string, SeededUser>

function buildUsersIndex(users: SeededUser[]): UsersIndex {
  const map = new Map<string, SeededUser>()
  for (const entry of users) {
    map.set(entry.cpf, entry)
  }
  return map
}

function buildProcessRecord(
  input: ProcessSeedInput,
  users: UsersIndex,
): typeof process.$inferInsert {
  const creator = users.get(input.createdByCpf)
  if (!creator) {
    throw new Error(`Criador nao encontrado para CPF ${input.createdByCpf}.`)
  }

  const attorney = input.attorneyCpf ? users.get(input.attorneyCpf) : null
  const assignee = input.documentationAssigneeCpf
    ? users.get(input.documentationAssigneeCpf)
    : null

  const baseCreatedAt = new Date()
  baseCreatedAt.setMonth(baseCreatedAt.getMonth() - 2)

  const documentationReadyAt =
    input.status === 'DOCUMENTACAO_PRONTA' ||
    input.status === 'EM_PROCESSO' ||
    input.status === 'FINALIZADO'
      ? new Date(baseCreatedAt.getTime() + 2 * 24 * 60 * 60 * 1000)
      : null

  const startedAt =
    input.status === 'EM_PROCESSO' || input.status === 'FINALIZADO'
      ? new Date(baseCreatedAt.getTime() + 5 * 24 * 60 * 60 * 1000)
      : null

  const finalizedAt =
    input.status === 'FINALIZADO'
      ? new Date(baseCreatedAt.getTime() + 30 * 24 * 60 * 60 * 1000)
      : null

  const cancelledAt =
    input.status === 'CANCELADO'
      ? new Date(baseCreatedAt.getTime() + 10 * 24 * 60 * 60 * 1000)
      : null

  const upperHousingName = input.housingComplexName.toUpperCase()

  return {
    id: `process_${input.code.toLowerCase().replace(/-/g, '_')}`,
    code: input.code,
    status: input.status,
    fullName: input.fullName.toUpperCase(),
    birthDate: input.birthDate,
    nationality: 'BRASILEIRA',
    maritalStatus: 'solteiro',
    profession: 'AUTONOMO',
    ownerType: 'titular_contrato_caixa',
    cpf: input.cpf,
    rg: '12.345.678-9',
    cadunico: 'sim',
    propertyPaidOff: 'sim',
    deliveredMoreThanTenYears: 'sim',
    purchaseAgreementLessThanTenYears: null,
    state: upperHousingName.includes('SAO PAULO')
      ? 'SP'
      : upperHousingName.includes('RIO DE JANEIRO')
        ? 'RJ'
        : upperHousingName.includes('BELO HORIZONTE')
          ? 'MG'
          : upperHousingName.includes('PORTO ALEGRE')
            ? 'RS'
            : 'CE',
    city:
      input.housingComplexId === 'hc_jardim_das_flores'
        ? 'SAO PAULO'
        : input.housingComplexId === 'hc_vila_nova'
          ? 'RIO DE JANEIRO'
          : input.housingComplexId === 'hc_morada_do_sol'
            ? 'BELO HORIZONTE'
            : input.housingComplexId === 'hc_bosque_verde'
              ? 'PORTO ALEGRE'
              : 'FORTALEZA',
    district: upperHousingName,
    housingComplex: upperHousingName,
    street: 'RUA DAS ACACIAS',
    number: '100',
    complement: '',
    zipcode: '00000-000',
    email: '',
    whatsapp: '',
    spouseContractSigned: 'nao',
    spouseFullName: '',
    spouseBirthDate: null,
    spouseNationality: '',
    spouseMaritalStatus: '',
    spouseProfession: '',
    spouseCpf: '',
    spouseRg: '',
    spouseCadunico: '',
    spouseSameAddress: '',
    spouseState: '',
    spouseCity: '',
    spouseDistrict: '',
    spouseHousingComplex: '',
    spouseStreet: '',
    spouseNumber: '',
    spouseComplement: '',
    spouseZipcode: '',
    witness1Id: null,
    witness2Id: null,
    observation: 'PROCESSO CRIADO VIA SEED DE TESTES.',
    createdByUserId: creator.id,
    assignedAttorneyId: attorney?.id ?? null,
    legalProcessNumber: input.legalProcessNumber ?? null,
    causeValue: input.causeValue ?? null,
    protocolDate: input.protocolDate ?? null,
    documentationReadyAt,
    startedAt,
    finalizedAt,
    cancelledAt,
    cancellationReason: input.cancellationReason ?? null,
    housingComplexId: input.housingComplexId,
    documentationAssigneeId: assignee?.id ?? null,
    createdAt: baseCreatedAt,
    updatedAt: baseCreatedAt,
  }
}

function buildHistoryEntries(
  processRecord: typeof process.$inferInsert,
  input: ProcessSeedInput,
  users: UsersIndex,
): (typeof processHistory.$inferInsert)[] {
  const creator = users.get(input.createdByCpf)
  if (!creator) return []

  const entries: (typeof processHistory.$inferInsert)[] = []

  const creationTime = processRecord.createdAt as Date

  entries.push({
    id: `history_${processRecord.id}_created`,
    processId: processRecord.id as string,
    actorUserId: creator.id,
    eventType: 'CREATED',
    toStatus: 'CADASTRADO',
    notes: 'Processo criado.',
    createdAt: creationTime,
  })

  const transitions: {
    from: ProcessStatus
    to: ProcessStatus
    offsetDays: number
    eventType: 'STATUS_CHANGED' | 'CANCELLED'
    notes: string
    actorCpf?: string
  }[] = []

  if (
    input.status === 'DOCUMENTACAO_PRONTA' ||
    input.status === 'EM_PROCESSO' ||
    input.status === 'FINALIZADO'
  ) {
    transitions.push({
      from: 'CADASTRADO',
      to: 'EM_DOCUMENTACAO',
      offsetDays: 1,
      eventType: 'STATUS_CHANGED',
      notes: 'Processo em documentacao.',
    })
    transitions.push({
      from: 'EM_DOCUMENTACAO',
      to: 'DOCUMENTACAO_PRONTA',
      offsetDays: 2,
      eventType: 'STATUS_CHANGED',
      notes: 'Documentacao pronta.',
    })
  } else if (input.status === 'EM_DOCUMENTACAO') {
    transitions.push({
      from: 'CADASTRADO',
      to: 'EM_DOCUMENTACAO',
      offsetDays: 1,
      eventType: 'STATUS_CHANGED',
      notes: 'Processo em documentacao.',
    })
  } else if (input.status === 'CANCELADO') {
    transitions.push({
      from: 'CADASTRADO',
      to: 'EM_DOCUMENTACAO',
      offsetDays: 1,
      eventType: 'STATUS_CHANGED',
      notes: 'Processo em documentacao.',
    })
  }

  if (input.status === 'EM_PROCESSO' || input.status === 'FINALIZADO') {
    transitions.push({
      from: 'DOCUMENTACAO_PRONTA',
      to: 'EM_PROCESSO',
      offsetDays: 5,
      eventType: 'STATUS_CHANGED',
      notes: 'Processo juridico iniciado.',
      actorCpf: input.attorneyCpf,
    })
  }

  if (input.status === 'FINALIZADO') {
    transitions.push({
      from: 'EM_PROCESSO',
      to: 'FINALIZADO',
      offsetDays: 30,
      eventType: 'STATUS_CHANGED',
      notes: 'Processo finalizado.',
      actorCpf: input.attorneyCpf,
    })
  }

  if (input.status === 'CANCELADO') {
    transitions.push({
      from: 'EM_DOCUMENTACAO',
      to: 'CANCELADO',
      offsetDays: 10,
      eventType: 'CANCELLED',
      notes: input.cancellationReason ?? 'Processo cancelado.',
      actorCpf: input.attorneyCpf,
    })
  }

  for (const [index, transition] of transitions.entries()) {
    const actor = transition.actorCpf
      ? (users.get(transition.actorCpf) ?? creator)
      : creator
    entries.push({
      id: `history_${processRecord.id}_t${index + 1}`,
      processId: processRecord.id as string,
      actorUserId: actor.id,
      eventType: transition.eventType,
      fromStatus: transition.from,
      toStatus: transition.to,
      notes: transition.notes,
      createdAt: new Date(
        creationTime.getTime() + transition.offsetDays * 24 * 60 * 60 * 1000,
      ),
    })
  }

  if (input.documentationAssigneeCpf) {
    const assignee = users.get(input.documentationAssigneeCpf)
    if (assignee) {
      entries.push({
        id: `history_${processRecord.id}_assignee_set`,
        processId: processRecord.id as string,
        actorUserId:
          users.get('12345678909')?.id ?? // admin
          creator.id,
        eventType: 'DOCUMENTATION_ASSIGNEE_SET',
        notes: `Responsavel pela documentacao designado: ${assignee.name}.`,
        createdAt: new Date(creationTime.getTime() + 3 * 24 * 60 * 60 * 1000),
      })
    }
  }

  return entries
}

export async function seedPlatformProcesses(users: SeededUser[]) {
  const usersIndex = buildUsersIndex(users)

  for (const input of seedProcesses) {
    const existing = await db
      .select({ id: process.id })
      .from(process)
      .where(eq(process.code, input.code))
      .limit(1)

    if (existing.length > 0) {
      continue
    }

    const record = buildProcessRecord(input, usersIndex)
    await db.insert(process).values(record)

    const history = buildHistoryEntries(record, input, usersIndex)
    if (history.length > 0) {
      await db.insert(processHistory).values(history)
    }
  }
}

export function summarizeProcesses() {
  const byStatus: Record<string, number> = {}
  for (const entry of seedProcesses) {
    byStatus[entry.status] = (byStatus[entry.status] ?? 0) + 1
  }
  return byStatus
}
