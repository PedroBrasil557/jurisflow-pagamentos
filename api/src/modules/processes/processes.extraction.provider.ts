import Anthropic from '@anthropic-ai/sdk'
import { ServiceError } from '../../shared/errors/service-error'
import type {
  DocumentExtractionProvider,
  ExtractionInputFile,
  RawExtraction,
} from './processes.extraction.types'

const SYSTEM = `Voce e um extrator de dados de documentos brasileiros para um sistema juridico.
Leia os arquivos (podem conter RG, CNH, comprovante de residencia, contratos). Extraia os dados do TITULAR a partir do RG ou CNH e o ENDERECO a partir do comprovante de residencia (conta de luz/agua).
Regras: NUNCA invente dados; se um campo nao estiver legivel, deixe-o de fora e liste em camposNaoEncontrados. Datas sempre em ISO yyyy-mm-dd. Atencao ao modelo novo de RG, onde o numero do topo pode ser o proprio CPF (o RG verdadeiro vem em outra linha). Sempre chame a ferramenta registrar_titular.`

const extractionTool: Anthropic.Tool = {
  name: 'registrar_titular',
  description:
    'Registra os dados extraidos do dossie (RG/CNH do titular e comprovante de residencia) para preencher o cadastro do processo.',
  input_schema: {
    type: 'object',
    properties: {
      documentosDetectados: {
        type: 'array',
        description: 'Tipos de documento identificados nos arquivos.',
        items: {
          type: 'string',
          enum: [
            'RG',
            'CNH',
            'COMPROVANTE_RESIDENCIA',
            'CONTRATO',
            'PROCURACAO',
            'DECLARACAO',
            'OUTRO',
          ],
        },
      },
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
      },
      camposNaoEncontrados: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['titular'],
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
          max_tokens: 4000,
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
                  text: 'Extraia os dados do titular e o endereco deste dossie.',
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

      const toolUse = message.content.find((block) => block.type === 'tool_use')
      if (!toolUse || toolUse.type !== 'tool_use') {
        throw new ServiceError(500, 'Resposta de extracao invalida.')
      }

      return toolUse.input as RawExtraction
    },
  }
}
