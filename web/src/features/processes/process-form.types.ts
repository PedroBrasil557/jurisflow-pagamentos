export type ProcessFormMode = 'create' | 'edit'

export type BinaryChoice = '' | 'sim' | 'nao'
export type TernaryChoice = '' | 'sim' | 'nao' | 'nao_sei'
export type MaritalStatusValue =
  | ''
  | 'solteiro'
  | 'casado'
  | 'separado_judicialmente'
  | 'divorciado'
  | 'viuvo'
export type OwnerTypeValue =
  | ''
  | 'primeiro_proprietario_uma_pessoa'
  | 'primeiro_proprietario_duas_pessoas'
  | 'segundo_proprietario_ou_superior'

export type SelectOption = {
  label: string
  value: string
}

export type PlatformUserOption = {
  id: string
  label: string
  cpf: string
}

export type ProcessFormValues = {
  fullName: string
  birthDate: string
  nationality: string
  maritalStatus: MaritalStatusValue
  profession: string
  ownerType: OwnerTypeValue
  cpf: string
  rg: string
  cadunico: BinaryChoice
  propertyPaidOff: TernaryChoice
  deliveredMoreThanTenYears: BinaryChoice
  purchaseAgreementLessThanTenYears: BinaryChoice
  state: string
  city: string
  district: string
  housingComplex: string
  street: string
  number: string
  complement: string
  zipcode: string
  email: string
  whatsapp: string
  witness1Id: string
  witness2Id: string
  observation: string
}

export type ProcessDraftRecord = {
  code: string
  status: string
  values: ProcessFormValues
}
