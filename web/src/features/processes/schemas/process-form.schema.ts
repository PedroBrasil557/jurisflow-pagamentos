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
  'primeiro_proprietario_uma_pessoa',
  'primeiro_proprietario_duas_pessoas',
  'segundo_proprietario_ou_superior',
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
    deliveredMoreThanTenYears: z.enum(binaryChoiceValues),
    purchaseAgreementLessThanTenYears: z.enum(binaryChoiceValues),
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
    witness1Id: z.string().trim().min(1, {
      message: 'Selecione a testemunha 1.',
    }),
    witness2Id: z.string().trim().min(1, {
      message: 'Selecione a testemunha 2.',
    }),
    observation: optionalText(500),
  })
  .superRefine((data, ctx) => {
    if (
      data.deliveredMoreThanTenYears === 'sim' &&
      data.purchaseAgreementLessThanTenYears !== 'sim' &&
      data.purchaseAgreementLessThanTenYears !== 'nao'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['purchaseAgreementLessThanTenYears'],
        message:
          'Informe se o contrato de compra e venda foi celebrado ha menos de 10 anos.',
      })
    }

    if (
      data.witness1Id &&
      data.witness2Id &&
      data.witness1Id === data.witness2Id
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['witness2Id'],
        message: 'As testemunhas devem ser diferentes.',
      })
    }
  })
