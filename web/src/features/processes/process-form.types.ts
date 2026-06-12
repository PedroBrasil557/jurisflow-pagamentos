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
  | 'titular_contrato_caixa'
  | 'conjuge_titular_contrato_caixa'
  | 'nao_titular_contrato_caixa'

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
  spouseContractSigned: BinaryChoice
  spouseFullName: string
  spouseBirthDate: string
  spouseNationality: string
  spouseMaritalStatus: MaritalStatusValue
  spouseProfession: string
  spouseCpf: string
  spouseRg: string
  spouseCadunico: BinaryChoice
  spouseSameAddress: BinaryChoice
  spouseState: string
  spouseCity: string
  spouseDistrict: string
  spouseHousingComplex: string
  spouseStreet: string
  spouseNumber: string
  spouseComplement: string
  spouseZipcode: string
  witness1Id: string
  witness2Id: string
  observation: string
}

export type ProcessDraftRecord = {
  code: string
  status: string
  values: ProcessFormValues
}
