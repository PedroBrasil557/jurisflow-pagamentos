import type { ProcessFormValues, SelectOption } from './process-form.types'

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
    value: 'primeiro_proprietario_uma_pessoa',
    label: 'Primeiro proprietario - 1 pessoa no termo do banco',
  },
  {
    value: 'primeiro_proprietario_duas_pessoas',
    label: 'Primeiro proprietario - 2 pessoas no termo do banco',
  },
  {
    value: 'segundo_proprietario_ou_superior',
    label: 'Segundo proprietario (ou superior)',
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
  deliveredMoreThanTenYears: '',
  purchaseAgreementLessThanTenYears: '',
  state: 'BA',
  city: '',
  district: '',
  housingComplex: '',
  street: '',
  number: '',
  complement: '',
  zipcode: '',
  email: '',
  whatsapp: '',
  witness1Id: '',
  witness2Id: '',
  observation: '',
}
