import type { ProcessFormValues, SelectOption } from './process-form.types'

export type HousingComplexAddressDefaults = {
  district: string
  city: string
  state: string
  zipcode: string
}

type HousingComplexAddressEntry = {
  aliases: readonly string[]
  defaults: HousingComplexAddressDefaults
}

function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
}

const housingComplexAddressEntries = [
  {
    aliases: ['CONDOMINIO RESIDENCIAL PONTO VERDE'],
    defaults: {
      district: 'AVIARIO',
      city: 'FEIRA DE SANTANA',
      state: 'BA',
      zipcode: '44095-300',
    },
  },
  {
    aliases: ['CONDOMINIO RESIDENCIAL RESERVA DO PARQUE'],
    defaults: {
      district: 'AVIARIO',
      city: 'FEIRA DE SANTANA',
      state: 'BA',
      zipcode: '44095-300',
    },
  },
  {
    aliases: ['RESIDENCIAL ZILDA ARNS', 'CONDOMINIO RESIDENCIAL ZILDA ARNS'],
    defaults: {
      district: 'CAJUEIRO',
      city: 'SANTO ANTONIO DE JESUS',
      state: 'BA',
      zipcode: '44430-000',
    },
  },
  {
    aliases: ['RESIDENCIAL VILA VIVA', 'CONDOMINIO RESIDENCIAL VILA VIVA'],
    defaults: {
      district: 'CAJUEIRO',
      city: 'SANTO ANTONIO DE JESUS',
      state: 'BA',
      zipcode: '44570-330',
    },
  },
  {
    aliases: [
      'RESIDENCIAL SANTO ANTONIO DE JESUS III',
      'CONDOMINIO RESIDENCIAL SANTO ANTONIO DE JESUS III',
    ],
    defaults: {
      district: 'CAJUEIRO',
      city: 'SANTO ANTONIO DE JESUS',
      state: 'BA',
      zipcode: '44570-330',
    },
  },
] satisfies readonly HousingComplexAddressEntry[]

export function getHousingComplexDefaults(
  name: string,
): HousingComplexAddressDefaults | undefined {
  const normalized = normalizeText(name)
  return housingComplexAddressEntries.find((entry) =>
    entry.aliases.some((alias) => normalizeText(alias) === normalized),
  )?.defaults
}

export const maritalStatusOptions = [
  { value: '', label: 'Selecione...' },
  { value: 'solteiro', label: 'Solteiro(a)' },
  { value: 'casado', label: 'Casado(a)' },
  { value: 'separado_judicialmente', label: 'Separado(a) judicialmente' },
  { value: 'divorciado', label: 'Divorciado(a)' },
  { value: 'viuvo', label: 'Viuvo(a)' },
] satisfies readonly SelectOption[]

export const ownerTypeOptions = [
  { value: '', label: 'Selecione...' },
  {
    value: 'titular_contrato_caixa',
    label: 'Titular contrato caixa',
  },
  {
    value: 'nao_titular_contrato_caixa',
    label: 'Nao titular contrato caixa',
  },
] satisfies readonly SelectOption[]

export const yesNoOptions = [
  { value: '', label: 'Selecione...' },
  { value: 'sim', label: 'Sim' },
  { value: 'nao', label: 'Nao' },
] satisfies readonly SelectOption[]

export const yesNoUnknownOptions = [
  { value: '', label: 'Selecione...' },
  { value: 'sim', label: 'Sim' },
  { value: 'nao', label: 'Nao' },
  { value: 'nao_sei', label: 'Nao sei' },
] satisfies readonly SelectOption[]

export const brazilStateOptions = [
  { value: '', label: 'Selecione...' },
  { value: 'AC', label: 'AC' },
  { value: 'AL', label: 'AL' },
  { value: 'AP', label: 'AP' },
  { value: 'AM', label: 'AM' },
  { value: 'BA', label: 'BA' },
  { value: 'CE', label: 'CE' },
  { value: 'DF', label: 'DF' },
  { value: 'ES', label: 'ES' },
  { value: 'GO', label: 'GO' },
  { value: 'MA', label: 'MA' },
  { value: 'MT', label: 'MT' },
  { value: 'MS', label: 'MS' },
  { value: 'MG', label: 'MG' },
  { value: 'PA', label: 'PA' },
  { value: 'PB', label: 'PB' },
  { value: 'PR', label: 'PR' },
  { value: 'PE', label: 'PE' },
  { value: 'PI', label: 'PI' },
  { value: 'RJ', label: 'RJ' },
  { value: 'RN', label: 'RN' },
  { value: 'RS', label: 'RS' },
  { value: 'RO', label: 'RO' },
  { value: 'RR', label: 'RR' },
  { value: 'SC', label: 'SC' },
  { value: 'SP', label: 'SP' },
  { value: 'SE', label: 'SE' },
  { value: 'TO', label: 'TO' },
] satisfies readonly SelectOption[]

export const emptyProcessFormValues: ProcessFormValues = {
  fullName: '',
  birthDate: '',
  nationality: 'Brasileira',
  maritalStatus: '',
  profession: '',
  ownerType: '',
  cpf: '',
  rg: '',
  cadunico: '',
  propertyPaidOff: '',
  state: '',
  city: '',
  district: '',
  housingComplex: '',
  street: '',
  number: '',
  complement: '',
  zipcode: '',
  email: '',
  whatsapp: '',
  spouseContractSigned: '',
  spouseFullName: '',
  spouseBirthDate: '',
  spouseNationality: 'BRASILEIRA',
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
  witness1Id: '',
  witness2Id: '',
  observation: '',
}
