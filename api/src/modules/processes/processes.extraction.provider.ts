import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { ServiceError } from '../../shared/errors/service-error'
import type {
  DocumentExtractionProvider,
  ExtractionInputFile,
  RawExtraction,
} from './processes.extraction.types'

// Validacao da saida do modelo (camada cliente). O input_schema da ferramenta ja
// guia o formato (e com strict, a API o garante), mas castar `as RawExtraction`
// nao checa nada em runtime. Aqui toleramos falhas por campo: um valor com tipo
// errado vira undefined/NaN e e descartado pelos guards do normalizer, preservando
// extracao parcial — em vez de propagar lixo ou abortar tudo.
const optionalString = z.string().optional().catch(undefined)
const optionalNumber = z.number().optional().catch(undefined)

const rawExtractionSchema = z.object({
  titular: z
    .object({
      fullName: optionalString,
      birthDate: optionalString,
      cpf: optionalString,
      rg: optionalString,
      filiacaoPai: optionalString,
      filiacaoMae: optionalString,
      naturalidade: optionalString,
      orgaoExpedidor: optionalString,
      dataExpedicao: optionalString,
      confianca: optionalNumber,
    })
    .optional()
    .catch(undefined),
  endereco: z
    .object({
      street: optionalString,
      number: optionalString,
      complement: optionalString,
      district: optionalString,
      city: optionalString,
      state: optionalString,
      zipcode: optionalString,
      origem: optionalString,
      confianca: optionalNumber,
    })
    .optional()
    .catch(undefined),
  camposNaoEncontrados: z.array(z.string()).optional().catch(undefined),
  paginas: z
    .array(
      z.object({
        pagina: z.number().catch(Number.NaN),
        tipo: z.string().catch(''),
      }),
    )
    .optional()
    .catch(undefined),
}) satisfies z.ZodType<RawExtraction>

function parseRawExtraction(input: unknown): RawExtraction {
  const parsed = rawExtractionSchema.safeParse(input)
  if (!parsed.success) {
    console.error('Extracao: saida do modelo fora do schema esperado', {
      issues: parsed.error.issues,
    })
    throw new ServiceError(
      503,
      'A extracao retornou dados em formato inesperado. Tente novamente.',
    )
  }
  return parsed.data
}

const SYSTEM = `Voce e um extrator de dados de documentos brasileiros para um sistema juridico.
O arquivo enviado e um PDF unico que reune VARIOS documentos do titular, um apos o outro.

Tarefa 1 — Extraia os dados do TITULAR a partir do RG ou CNH e o ENDERECO a partir do comprovante de residencia (conta de luz/agua).
Tarefa 2 — Classifique CADA pagina do PDF em um dos tipos abaixo e devolva em "paginas" (numero da pagina 1-based + tipo):
- procuracao_advogado: procuracao para o advogado.
- rg_cpf_cnh: RG, CPF ou CNH (documento de identidade do TITULAR).
- comprovante_endereco: comprovante de residencia/endereco (conta de luz, agua, etc.).
- termo_entrega_recebimento_imovel: termo de entrega/recebimento do imovel pela instituicao bancaria (Caixa).
- declaracao_hipossuficiencia: declaracao de hipossuficiencia.
- contrato_honorarios_advocaticios: contrato de honorarios advocaticios.
- contrato_compra_venda: contrato de compra e venda do imovel.
- rg_cpf_cnh_conjuge: RG, CPF ou CNH do CONJUGE (companheiro(a)/esposo(a) do titular). Use apenas quando houver indicacao clara de que o documento e do conjuge; na duvida, classifique como rg_cpf_cnh.
- certidao_casamento: certidao de casamento.
- certidao_obito: certidao de obito.
- outro: qualquer pagina que nao se encaixe nos tipos acima.

Regras: NUNCA invente dados; se um campo nao estiver legivel, deixe-o de fora e liste em camposNaoEncontrados. Datas sempre em ISO yyyy-mm-dd. Atencao ao modelo novo de RG, onde o numero do topo pode ser o proprio CPF (o RG verdadeiro vem em outra linha). Classifique TODAS as paginas, sem pular nenhuma. Sempre chame a ferramenta registrar_titular.`

const extractionTool: Anthropic.Tool = {
  name: 'registrar_titular',
  description:
    'Registra os dados extraidos do dossie (RG/CNH do titular e comprovante de residencia) para preencher o cadastro do processo.',
  // strict: a API passa a garantir que o input obedece o input_schema (suportado
  // em Opus 4.8 / Sonnet 4.6 / Haiku 4.5 — o modelo padrao e claude-opus-4-8).
  // Exige additionalProperties: false em todos os objetos. A camada Zod acima
  // continua sendo a rede de seguranca para modelos sem suporte a strict.
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      titular: {
        type: 'object',
        properties: {
          fullName: { type: 'string' },
          birthDate: { type: 'string', description: 'ISO yyyy-mm-dd' },
          cpf: { type: 'string' },
          rg: { type: 'string' },
          filiacaoPai: { type: 'string' },
          filiacaoMae: { type: 'string' },
          naturalidade: { type: 'string' },
          orgaoExpedidor: { type: 'string' },
          dataExpedicao: { type: 'string', description: 'ISO yyyy-mm-dd' },
          confianca: {
            type: 'number',
            description:
              '0 a 1 — confianca na leitura do documento de identidade',
          },
        },
        additionalProperties: false,
      },
      endereco: {
        type: 'object',
        properties: {
          street: { type: 'string' },
          number: { type: 'string' },
          complement: { type: 'string' },
          district: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string', description: 'UF (2 letras)' },
          zipcode: { type: 'string' },
          origem: { type: 'string' },
          confianca: { type: 'number' },
        },
        additionalProperties: false,
      },
      camposNaoEncontrados: {
        type: 'array',
        items: { type: 'string' },
      },
      paginas: {
        type: 'array',
        description:
          'Classificacao de TODAS as paginas do PDF (1-based) por tipo de documento.',
        items: {
          type: 'object',
          properties: {
            pagina: {
              type: 'number',
              description: 'Numero da pagina (1-based).',
            },
            tipo: {
              type: 'string',
              enum: [
                'procuracao_advogado',
                'rg_cpf_cnh',
                'comprovante_endereco',
                'termo_entrega_recebimento_imovel',
                'declaracao_hipossuficiencia',
                'contrato_honorarios_advocaticios',
                'contrato_compra_venda',
                'rg_cpf_cnh_conjuge',
                'certidao_casamento',
                'certidao_obito',
                'outro',
              ],
            },
          },
          required: ['pagina', 'tipo'],
          additionalProperties: false,
        },
      },
    },
    required: ['titular'],
    additionalProperties: false,
  },
}

export function createAnthropicVisionProvider(
  apiKey: string,
  model: string,
): DocumentExtractionProvider {
  const client = new Anthropic({ apiKey })

  return {
    name: 'anthropic-vision',
    async extract(files: ExtractionInputFile[]): Promise<RawExtraction> {
      const documentBlocks: Anthropic.ContentBlockParam[] = files.map((file) =>
        file.kind === 'pdf'
          ? {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: file.base64,
              },
            }
          : {
              type: 'image',
              source: {
                type: 'base64',
                media_type: file.mediaType as
                  | 'image/jpeg'
                  | 'image/png'
                  | 'image/webp',
                data: file.base64,
              },
            },
      )

      let message: Anthropic.Message
      try {
        message = await client.messages.create({
          model,
          max_tokens: 8000,
          system: SYSTEM,
          tools: [extractionTool],
          tool_choice: { type: 'tool', name: 'registrar_titular' },
          messages: [
            {
              role: 'user',
              content: [
                ...documentBlocks,
                {
                  type: 'text',
                  text: 'Extraia os dados do titular e o endereco, e classifique cada pagina deste dossie por tipo de documento.',
                },
              ],
            },
          ],
        })
      } catch (error) {
        // Nao logamos o conteudo do documento — apenas o erro.
        console.error('Falha na extracao via Anthropic', {
          error: String(error),
        })
        throw new ServiceError(
          503,
          'Nao foi possivel contatar o servico de extracao. Verifique a conexao e a chave de API.',
        )
      }

      // Resposta truncada: a classificacao de paginas pode vir incompleta.
      if (message.stop_reason === 'max_tokens') {
        throw new ServiceError(
          422,
          'O documento e grande demais para processar de uma vez. Reduza o numero de paginas do PDF e tente novamente.',
        )
      }

      const toolUse = message.content.find((block) => block.type === 'tool_use')
      if (!toolUse || toolUse.type !== 'tool_use') {
        throw new ServiceError(500, 'Resposta de extracao invalida.')
      }

      return parseRawExtraction(toolUse.input)
    },
  }
}
