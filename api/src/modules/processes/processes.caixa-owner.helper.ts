import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { ServiceError } from '../../shared/errors/service-error'
import type { CaixaBuyer } from './processes.caixa-owner.compare'

// O modelo SO extrai (nao julga, nao compara). A decisao e 100% deterministica
// em codigo (compareCaixaOwner). NAO passamos temperature (removido no Opus 4.x
// -> HTTP 400) nem strict (causa timeout de gramatica), seguindo a extracao.
const SYSTEM = `Voce extrai dados de um termo da Caixa Economica Federal (termo de entrega/recebimento do imovel pela instituicao bancaria, ou declaracao de quitacao).

Sua UNICA tarefa e localizar o(s) COMPRADOR(es)/beneficiario(s) do imovel e registrar o nome e o CPF EXATAMENTE como aparecem no documento.

Regras:
1. Registre apenas o que estiver LITERALMENTE escrito no documento. Nunca invente nem deduza dados ausentes.
2. Se o CPF do comprador NAO aparecer no documento, use null no campo cpf.
3. Pode haver mais de um comprador (ex.: casal) — registre todos.
4. Nao classifique, nao decida e nao opine: apenas extraia nome e CPF.
5. Em trechoFonte, copie um pedaco curto do texto onde voce leu o nome/CPF.`

const buyerSchema = z.object({
  nome: z.string().trim().min(1),
  cpf: z.string().trim().nullable().optional(),
  trechoFonte: z.string().trim().optional(),
})

const extractionSchema = z.object({
  compradores: z.array(buyerSchema),
})

const extractionTool = {
  name: 'registrar_compradores',
  description:
    'Registra o(s) comprador(es)/beneficiario(s) do imovel extraido(s) do termo da Caixa.',
  input_schema: {
    type: 'object',
    properties: {
      compradores: {
        type: 'array',
        description: 'Compradores/beneficiarios encontrados no termo.',
        items: {
          type: 'object',
          properties: {
            nome: {
              type: 'string',
              description:
                'Nome completo do comprador, como escrito no documento.',
            },
            cpf: {
              type: ['string', 'null'],
              description:
                'CPF do comprador (digitos ou formatado), ou null se ausente.',
            },
            trechoFonte: {
              type: 'string',
              description: 'Trecho curto do documento onde o nome/CPF aparece.',
            },
          },
          required: ['nome'],
        },
      },
    },
    required: ['compradores'],
  },
} satisfies Anthropic.Tool

export type CaixaOwnerExtraction = {
  compradores: CaixaBuyer[]
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
    tool_choice: { type: 'tool', name: 'registrar_compradores' },
    messages: [
      {
        role: 'user',
        content: [
          buildSourceBlock(input.base64, input.mediaType),
          {
            type: 'text',
            text: 'Extraia o(s) comprador(es) deste termo da Caixa.',
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
    compradores: parsed.data.compradores.map((b) => ({
      nome: b.nome,
      cpf: b.cpf ?? null,
      trechoFonte: b.trechoFonte,
    })),
    model: message.model,
    usage: message.usage
      ? {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        }
      : null,
  }
}
