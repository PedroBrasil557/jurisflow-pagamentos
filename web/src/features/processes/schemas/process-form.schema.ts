import { z } from 'zod'
import { isValidCpf, normalizeCpf } from '@/features/auth/utils/cpf'

const binaryChoiceValues = ['', 'sim', 'nao'] as const
const ternaryChoiceValues = ['', 'sim', 'nao', 'nao_sei'] as const
const maritalStatusValues = [
  '',
  'solteiro',
  'casado',
  'separado_judicialmente',
  'divorciado',
  'viuvo',
] as const
const ownerTypeValues = [
  '',
  'titular_contrato_caixa',
  'nao_titular_contrato_caixa',
] as const

function requiredText(message: string, maxLength = 255) {
  return z
    .string()
    .trim()
    .min(1, { message })
    .max(maxLength, { message: 'Valor muito longo.' })
}

function optionalText(maxLength = 255) {
  return z.string().trim().max(maxLength, { message: 'Valor muito longo.' })
}

const birthDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Informe uma data de nascimento valida.',
  })

const cpfSchema = z
  .string()
  .trim()
  .min(1, { message: 'Informe um CPF.' })
  .refine((value) => isValidCpf(normalizeCpf(value)), {
    message: 'Informe um CPF valido.',
  })

const optionalEmailSchema = z
  .string()
  .trim()
  .max(255, { message: 'E-mail muito longo.' })
  .refine(
    (value) => value === '' || z.email().safeParse(value.toLowerCase()).success,
    {
      message: 'Informe um e-mail valido.',
    },
  )

export const processFormSchema = z
  .object({
    fullName: requiredText('Informe o nome completo.', 150),
    birthDate: birthDateSchema,
    nationality: requiredText('Informe a nacionalidade.', 80),
    maritalStatus: z.enum(maritalStatusValues),
    profession: optionalText(120),
    ownerType: z.enum(ownerTypeValues).refine((value) => value !== '', {
      message: 'Selecione o tipo de proprietario.',
    }),
    cpf: cpfSchema,
    rg: requiredText('Informe o RG.', 40),
    cadunico: z.enum(binaryChoiceValues),
    propertyPaidOff: z.enum(ternaryChoiceValues),
    state: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/, {
        message: 'Informe uma UF valida.',
      }),
    city: requiredText('Informe a cidade.', 120),
    district: requiredText('Informe o bairro.', 120),
    housingComplex: requiredText('Informe o conjunto ou residencial.', 160),
    street: requiredText('Informe o logradouro.', 255),
    number: optionalText(40),
    complement: optionalText(255),
    zipcode: z
      .string()
      .trim()
      .min(1, { message: 'Informe o CEP.' })
      .max(20, { message: 'CEP invalido.' }),
    email: optionalEmailSchema,
    whatsapp: optionalText(30),
    spouseContractSigned: z.enum(binaryChoiceValues),
    spouseFullName: optionalText(150),
    spouseBirthDate: optionalText(),
    spouseNationality: optionalText(80),
    spouseMaritalStatus: z.enum(maritalStatusValues),
    spouseProfession: optionalText(120),
    spouseCpf: optionalText(14),
    spouseRg: optionalText(40),
    spouseCadunico: z.enum(binaryChoiceValues),
    spouseSameAddress: z.enum(binaryChoiceValues),
    spouseState: optionalText(2),
    spouseCity: optionalText(120),
    spouseDistrict: optionalText(120),
    spouseHousingComplex: optionalText(160),
    spouseStreet: optionalText(255),
    spouseNumber: optionalText(40),
    spouseComplement: optionalText(255),
    spouseZipcode: optionalText(20),
    witness1Id: optionalText(),
    witness2Id: optionalText(),
    observation: optionalText(500),
  })
  .superRefine((data, ctx) => {
    if (data.spouseContractSigned === 'sim') {
      if (!data.spouseFullName?.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['spouseFullName'],
          message: 'Informe o nome completo do conjuge.',
        })
      }

      if (
        !data.spouseBirthDate?.trim() ||
        !/^\d{4}-\d{2}-\d{2}$/.test(data.spouseBirthDate)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['spouseBirthDate'],
          message: 'Informe a data de nascimento do conjuge.',
        })
      }

      if (!data.spouseCpf?.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['spouseCpf'],
          message: 'Informe o CPF do conjuge.',
        })
      } else if (!isValidCpf(normalizeCpf(data.spouseCpf))) {
        ctx.addIssue({
          code: 'custom',
          path: ['spouseCpf'],
          message: 'Informe um CPF valido.',
        })
      }

      if (!data.spouseRg?.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['spouseRg'],
          message: 'Informe o RG do conjuge.',
        })
      }

      if (
        !data.spouseState?.trim() ||
        !/^[A-Za-z]{2}$/.test(data.spouseState)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['spouseState'],
          message: 'Informe a UF do conjuge.',
        })
      }

      if (!data.spouseCity?.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['spouseCity'],
          message: 'Informe a cidade do conjuge.',
        })
      }

      if (!data.spouseDistrict?.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['spouseDistrict'],
          message: 'Informe o bairro do conjuge.',
        })
      }

      if (!data.spouseHousingComplex?.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['spouseHousingComplex'],
          message: 'Informe o conjunto ou residencial do conjuge.',
        })
      }

      if (!data.spouseStreet?.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['spouseStreet'],
          message: 'Informe o logradouro do conjuge.',
        })
      }

      if (!data.spouseZipcode?.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['spouseZipcode'],
          message: 'Informe o CEP do conjuge.',
        })
      }
    }
  })
