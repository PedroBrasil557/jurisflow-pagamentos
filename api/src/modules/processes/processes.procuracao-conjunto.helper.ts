import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { ServiceError } from '../../shared/errors/service-error'

// O modelo SO extrai (nao julga, nao casa o conjunto). O match e a decisao sao
// 100% deterministicos em codigo (matchConjuntoInAddress / decide...). NAO
// passamos temperature (removido no Opus 4.x -> HTTP 400) nem strict (causa
// timeout de gramatica) — igual ao extrator do contrato Caixa.
const SYSTEM = `Voce extrai dados de uma PROCURACAO (instrumento em que o OUTORGANTE concede poderes a um advogado, o OUTORGADO).

Sua tarefa: identificar o(s) OUTORGANTE(S) — quem CONCEDE a procuracao (o cliente, a parte representada/autora), NUNCA o advogado/outorgado — e o ENDERECO DE RESIDENCIA do outorgante.

Regras:
1. Registre apenas o que estiver LITERALMENTE escrito no documento. Nunca invente nem deduza.
2. OUTORGANTE = quem outorga/concede os poderes (o cliente). OUTORGADO = o advogado que recebe os poderes. NUNCA confunda: ignore os dados do advogado.
3. endereco = o endereco de residencia do OUTORGANTE, COMPLETO e EXATAMENTE como escrito, INCLUINDO o nome do residencial/conjunto/condominio se mencionado.
4. cidade = a cidade do endereco do outorgante.
5. Se um campo nao aparecer, use null.
6. Em trecho_fonte, copie um pedaco curto do texto onde voce leu o endereco.`

const extractionSchema = z.object({
  outorgante: z.string().trim().nullable().optional(),
  cpf_outorgante: z.string().trim().nullable().optional(),
  segundo_outorgante: z.string().trim().nullable().optional(),
  cpf_segundo: z.string().trim().nullable().optional(),
  endereco: z.string().trim().nullable().optional(),
  cidade: z.string().trim().nullable().optional(),
  trecho_fonte: z.string().trim().nullable().optional(),
})

const nullableString = { type: ['string', 'null'] } as const

const extractionTool = {
  name: 'registrar_outorgante_procuracao',
  description:
    'Registra o(s) outorgante(s) e o endereco de residencia extraidos da procuracao.',
  input_schema: {
    type: 'object',
    properties: {
      outorgante: {
        ...nullableString,
        description:
          'Nome completo do OUTORGANTE principal (o cliente que concede a procuracao), como escrito, ou null. NUNCA o advogado.',
      },
      cpf_outorgante: {
        ...nullableString,
        description: 'CPF do outorgante (digitos ou formatado), ou null.',
      },
      segundo_outorgante: {
        ...nullableString,
        description:
          'Nome do segundo outorgante (conjuge/co-autor), se houver, ou null.',
      },
      cpf_segundo: {
        ...nullableString,
        description: 'CPF do segundo outorgante, ou null.',
      },
      endereco: {
        ...nullableString,
        description:
          'Endereco de residencia do outorgante, COMPLETO e como escrito, incluindo o residencial/conjunto/condominio se mencionado. Ou null.',
      },
      cidade: {
        ...nullableString,
        description: 'Cidade do endereco do outorgante, ou null.',
      },
      trecho_fonte: {
        ...nullableString,
        description: 'Trecho curto do documento onde o endereco aparece.',
      },
    },
    required: ['outorgante', 'endereco'],
  },
} satisfies Anthropic.Tool

export type ProcuracaoOutorgante = { nome: string | null; cpf: string | null }

export type ProcuracaoExtraction = {
  outorgantes: ProcuracaoOutorgante[]
  endereco: string | null
  cidade: string | null
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

export async function extractProcuracaoConjunto(input: {
  apiKey: string
  model: string
  base64: string
  mediaType: string
}): Promise<ProcuracaoExtraction> {
  const client = new Anthropic({ apiKey: input.apiKey })

  const message = await client.messages.create({
    model: input.model,
    max_tokens: 2000,
    system: SYSTEM,
    tools: [extractionTool],
    tool_choice: { type: 'tool', name: 'registrar_outorgante_procuracao' },
    messages: [
      {
        role: 'user',
        content: [
          buildSourceBlock(input.base64, input.mediaType),
          {
            type: 'text',
            text: 'Extraia o(s) outorgante(s) e o endereco de residencia desta procuracao. Ignore o advogado (outorgado).',
          },
        ],
      },
    ],
  })

  const toolUse = message.content.find((block) => block.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new ServiceError(503, 'Resposta do modelo sem dados estruturados.')
  }

  // Valida ANTES de qualquer uso (sem strict, o modelo pode fugir do schema).
  const parsed = extractionSchema.safeParse(toolUse.input)
  if (!parsed.success) {
    throw new ServiceError(503, 'Saida do modelo fora do schema esperado.')
  }

  const outorgantes: ProcuracaoOutorgante[] = []
  if (parsed.data.outorgante) {
    outorgantes.push({
      nome: parsed.data.outorgante,
      cpf: parsed.data.cpf_outorgante ?? null,
    })
  }
  if (parsed.data.segundo_outorgante) {
    outorgantes.push({
      nome: parsed.data.segundo_outorgante,
      cpf: parsed.data.cpf_segundo ?? null,
    })
  }

  return {
    outorgantes,
    endereco: parsed.data.endereco ?? null,
    cidade: parsed.data.cidade ?? null,
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
