import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { ServiceError } from '../../shared/errors/service-error'

// O modelo SO extrai (nao julga, nao compara). A decisao e 100% deterministica
// em codigo (compareCaixaOwner). NAO passamos temperature (removido no Opus 4.x
// -> HTTP 400) nem strict (causa timeout de gramatica), seguindo a extracao.
const SYSTEM = `Voce extrai dados de um termo da Caixa Economica Federal (termo de entrega/recebimento do imovel pela instituicao bancaria, ou declaracao de quitacao).

Sua UNICA tarefa e identificar, no documento, o TITULAR do contrato (comprador/beneficiario principal do imovel) e, se houver, o seu CONJUGE (co-comprador/companheiro(a)), e registrar nome e CPF de cada um EXATAMENTE como aparecem.

Regras:
1. Registre apenas o que estiver LITERALMENTE escrito no documento. Nunca invente nem deduza dados ausentes.
2. Se algum campo (titular, cpf_titular, conjuge, cpf_conjuge) NAO aparecer no documento, use null.
3. titular = a pessoa principal do contrato. conjuge = o(a) companheiro(a) co-titular, quando houver.
4. Nao classifique, nao decida e nao opine: apenas extraia os nomes e CPFs.
5. Em trecho_fonte, copie um pedaco curto do texto onde voce leu os dados.`

const extractionSchema = z.object({
  titular: z.string().trim().nullable().optional(),
  cpf_titular: z.string().trim().nullable().optional(),
  conjuge: z.string().trim().nullable().optional(),
  cpf_conjuge: z.string().trim().nullable().optional(),
  trecho_fonte: z.string().trim().nullable().optional(),
})

const nullableString = {
  type: ['string', 'null'],
} as const

const extractionTool = {
  name: 'registrar_titular_contrato',
  description:
    'Registra o titular e o conjuge (co-titular) extraidos do termo da Caixa.',
  input_schema: {
    type: 'object',
    properties: {
      titular: {
        ...nullableString,
        description:
          'Nome completo do titular (comprador principal), como escrito, ou null.',
      },
      cpf_titular: {
        ...nullableString,
        description: 'CPF do titular (digitos ou formatado), ou null.',
      },
      conjuge: {
        ...nullableString,
        description:
          'Nome completo do conjuge/co-titular, como escrito, ou null se nao houver.',
      },
      cpf_conjuge: {
        ...nullableString,
        description: 'CPF do conjuge (digitos ou formatado), ou null.',
      },
      trecho_fonte: {
        ...nullableString,
        description: 'Trecho curto do documento onde os dados aparecem.',
      },
    },
    required: ['titular', 'cpf_titular', 'conjuge', 'cpf_conjuge'],
  },
} satisfies Anthropic.Tool

export type CaixaOwnerExtraction = {
  titular: string | null
  cpfTitular: string | null
  conjuge: string | null
  cpfConjuge: string | null
  trechoFonte: string | null
  model: string
  usage: { inputTokens: number; outputTokens: number } | null
}

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

function buildSourceBlock(
  base64: string,
  mediaType: string,
): Anthropic.ContentBlockParam {
  if (mediaType === 'application/pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: base64 },
    }
  }
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: mediaType as ImageMediaType,
      data: base64,
    },
  }
}

export async function extractCaixaOwner(input: {
  apiKey: string
  model: string
  base64: string
  mediaType: string
}): Promise<CaixaOwnerExtraction> {
  const client = new Anthropic({ apiKey: input.apiKey })

  const message = await client.messages.create({
    model: input.model,
    max_tokens: 2000,
    system: SYSTEM,
    tools: [extractionTool],
    tool_choice: { type: 'tool', name: 'registrar_titular_contrato' },
    messages: [
      {
        role: 'user',
        content: [
          buildSourceBlock(input.base64, input.mediaType),
          {
            type: 'text',
            text: 'Extraia o titular e o conjuge (se houver) deste termo da Caixa.',
          },
        ],
      },
    ],
  })

  const toolUse = message.content.find((block) => block.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new ServiceError(503, 'Resposta do modelo sem dados estruturados.')
  }

  // Valida a saida ANTES de qualquer uso (sem strict, o modelo pode fugir do
  // schema). Falha de schema -> erro: a decisao nunca roda sobre lixo.
  const parsed = extractionSchema.safeParse(toolUse.input)
  if (!parsed.success) {
    throw new ServiceError(503, 'Saida do modelo fora do schema esperado.')
  }

  return {
    titular: parsed.data.titular ?? null,
    cpfTitular: parsed.data.cpf_titular ?? null,
    conjuge: parsed.data.conjuge ?? null,
    cpfConjuge: parsed.data.cpf_conjuge ?? null,
    trechoFonte: parsed.data.trecho_fonte ?? null,
    model: message.model,
    usage: message.usage
      ? {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        }
      : null,
  }
}
