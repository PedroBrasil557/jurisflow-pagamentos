import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { ServiceError } from '../../shared/errors/service-error'
import type {
  DocumentExtractionProvider,
  ExtractionInputFile,
  RawExtraction,
  RawExtractionResult,
} from './processes.extraction.types'

// Validacao da saida do modelo (camada cliente). O input_schema da ferramenta ja
// guia o formato (e com strict, a API o garante), mas castar `as RawExtraction`
// nao checa nada em runtime. Aqui toleramos falhas por campo: um valor com tipo
// errado vira undefined/NaN e e descartado pelos guards do normalizer, preservando
// extracao parcial — em vez de propagar lixo ou abortar tudo.
const optionalString = z.string().optional().catch(undefined)
const optionalNumber = z.number().optional().catch(undefined)

// Pessoa (parte de documento): outorgante, comprador, vendedor.
const rawPersonSchema = z
  .object({
    nome: optionalString,
    cpf: optionalString,
    rg: optionalString,
    nascimento: optionalString,
  })
  .catch({})

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
  conjuge: z
    .object({
      fullName: optionalString,
      cpf: optionalString,
      birthDate: optionalString,
      confianca: optionalNumber,
    })
    .optional()
    .catch(undefined),
  outorgantes: z.array(rawPersonSchema).optional().catch(undefined),
  compraVenda: z
    .object({
      vendedores: z.array(rawPersonSchema).optional().catch(undefined),
      compradores: z.array(rawPersonSchema).optional().catch(undefined),
      dataAssinatura: optionalString,
    })
    .optional()
    .catch(undefined),
  termoCompradores: z.array(rawPersonSchema).optional().catch(undefined),
  procuracaoEndereco: optionalString,
  procuracaoCidade: optionalString,
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
Tarefa 2 — Classifique CADA pagina do PDF em um dos tipos abaixo e devolva em "paginas" (numero da pagina 1-based + tipo). Classifique pela ESTRUTURA e pelas PARTES do documento (quem e o vendedor, quem outorga, qual o objeto), NUNCA por uma palavra isolada:
- rg_cpf_cnh: documento de identidade do TITULAR (RG, CPF ou CNH). Inclui o modelo novo CIN ("REPUBLICA FEDERATIVA DO BRASIL / GOVERNO FEDERAL", com QR code e "Registro Geral - CPF / Personal Number") — nesse modelo o numero do topo pode ser o proprio CPF.
- rg_cpf_cnh_conjuge: o mesmo documento de identidade, mas do CONJUGE (esposo(a)/companheiro(a)) do titular. Use apenas quando houver indicacao clara de que e do conjuge; na duvida, classifique como rg_cpf_cnh.
- comprovante_endereco: conta de consumo que prova residencia — energia (ex.: Neoenergia/Coelba, "DANFE ... ENERGIA ELETRICA") ou agua/esgoto (ex.: SAAE, "CONTA DE CONSUMO DE AGUA/ESGOTO"). Pode estar em nome de terceiro/co-morador (ex.: co-titular do imovel), nao necessariamente do titular.
- termo_entrega_recebimento_imovel: documento da CAIXA que comprova a entrega/titularidade do imovel no programa habitacional. O titulo comeca com "TERMO DE RECEBIMENTO DE IMOVEL" (variacoes reais: "– PAR E PMCMV", "– PMCMV – FAIXA 1", "– PMCMV – RECURSOS FAR") e ha o logo CAIXA ECONOMICA FEDERAL. A parte VENDEDORA (rotulada VENDEDOR, ou VENDEDOR/CEDENTE/DOADOR, ou VENDEDOR/CREDOR FIDUCIARIO) e uma INSTITUICAO: "FUNDO DE ARRENDAMENTO RESIDENCIAL - FAR", representada pela Caixa Economica Federal. ATENCAO: o corpo deste termo cita "INSTRUMENTO PARTICULAR DE VENDA E COMPRA", "COMPRA DE IMOVEL", "DOACAO COM ENCARGO", "ALIENACAO FIDUCIARIA" e "MINHA CASA MINHA VIDA" — essas expressoes NAO o transformam em contrato_compra_venda. Se o vendedor e a FAR/Caixa, e SEMPRE termo_entrega_recebimento_imovel.
- termo_quitacao: documento da CAIXA que comprova a QUITACAO do financiamento do imovel (titulo com "QUITACAO"/"TERMO DE QUITACAO"). Prova alternativa do vinculo do imovel com a Caixa (quando nao ha o termo de entrega).
- contrato_compra_venda: contrato de compra e venda do imovel entre PARTICULARES, em que o VENDEDOR e uma PESSOA FISICA (identificada por CPF) — tipicamente uma revenda do imovel ja regularizado. NAO tem o titulo "TERMO DE RECEBIMENTO DE IMOVEL" e o vendedor NAO e a FAR/Caixa. Pode mencionar PMCMV/Caixa/alienacao fiduciaria apenas como historico do imovel — isso, sozinho, nao o torna termo_entrega.
- procuracao_advogado: procuracao para o advogado. Titulo "PROCURACAO AD JUDICIA ET EXTRA", com OUTORGANTE (cliente) e OUTORGADO (advogado) e uma secao PODERES. Outorga PODERES de representacao — nao define remuneracao.
- contrato_honorarios_advocaticios: "CONTRATO DE PRESTACAO DE SERVICOS ADVOCATICIOS", com CONTRATANTE (cliente) e CONTRATADO (advogado) e clausulas de HONORARIOS (regime de exito, sucumbencia). ATENCAO: tem a palavra "CONTRATO" mas o objeto e servico juridico — NAO confundir com contrato_compra_venda, que transmite o imovel.
- declaracao_hipossuficiencia: "DECLARACAO DE HIPOSSUFICIENCIA E ISENCAO DE IRPF", com "declaro sob as penas da lei" e pedido de Justica Gratuita.
- certidao_casamento: certidao de casamento.
- certidao_obito: certidao de obito.
- nao_identificado: pagina que NAO corresponde a nenhum tipo acima. NAO force um tipo so para encaixar — se a pagina nao e claramente um dos tipos, use nao_identificado. Essas paginas serao tratadas por anexo manual; nunca sao anexadas automaticamente.

Tarefa 3 — CONJUGE: examine o termo de entrega/recebimento do imovel (Caixa). SE o termo indicar que o imovel/contrato foi adquirido/assinado TAMBEM pelo conjuge (esposo(a)/companheiro(a)) do titular, extraia em "conjuge" os dados do conjuge: nome completo, CPF e data de nascimento (ISO yyyy-mm-dd). Preencha "conjuge" APENAS quando o termo de entrega claramente incluir o conjuge como comprador/assinante (ex.: dois adquirentes, "e seu conjuge", estado civil casado com co-titularidade). Caso contrario, NAO inclua "conjuge".

Tarefa 4 — OUTORGANTES: da PROCURACAO, extraia em "outorgantes" os dados pessoais (nome, cpf, rg, nascimento) de CADA outorgante (o(s) cliente(s) que outorga(m) poderes ao advogado). Sao o(s) titular(es) do processo.

Tarefa 5 — COMPRA E VENDA: SE houver "contrato_compra_venda", extraia em "compraVenda": os "vendedores" (dados pessoais), os "compradores" (dados pessoais) e a "dataAssinatura" (ISO yyyy-mm-dd) do contrato. Se nao houver contrato de compra e venda, NAO inclua "compraVenda".

Tarefa 6 — COMPRADORES DO TERMO DA CAIXA: SE houver "termo_entrega_recebimento_imovel" ou "termo_quitacao", extraia em "termoCompradores" a lista dos compradores/beneficiarios do contrato habitacional, EM ORDEM: o primeiro item e o TITULAR do contrato (comprador/beneficiario principal), o segundo (se houver) e o CONJUGE/co-comprador. De cada um, registre nome, cpf, rg e nascimento (ISO yyyy-mm-dd) EXATAMENTE como aparecem. Registre apenas o que estiver LITERALMENTE escrito; nao invente nem deduza. Estes sao os compradores PELA Caixa (a parte vendedora e a FAR/Caixa — NAO a inclua). Se nao houver termo, NAO inclua "termoCompradores".

Tarefa 7 — ENDERECO DA PROCURACAO: SE houver "procuracao_advogado", extraia em "procuracaoEndereco" o endereco de residencia do OUTORGANTE (o cliente que concede a procuracao, NUNCA o advogado/outorgado), COMPLETO e EXATAMENTE como escrito, INCLUINDO o nome do residencial/conjunto/condominio se mencionado; e em "procuracaoCidade" a cidade desse endereco. Se nao houver procuracao ou o endereco nao aparecer, NAO inclua esses campos.

Regras: NUNCA invente dados; se um campo nao estiver legivel, deixe-o de fora e liste em camposNaoEncontrados. Datas sempre em ISO yyyy-mm-dd. Atencao ao modelo novo de RG, onde o numero do topo pode ser o proprio CPF (o RG verdadeiro vem em outra linha). Classifique TODAS as paginas, sem pular nenhuma. Sempre chame a ferramenta registrar_titular.`

const extractionTool: Anthropic.Tool = {
  name: 'registrar_titular',
  description:
    'Registra os dados extraidos do dossie (RG/CNH do titular e comprovante de residencia) para preencher o cadastro do processo.',
  // NOTA: nao usar `strict: true` aqui. Com este schema (array `paginas` + enum de
  // 11 tipos + objetos aninhados), a compilacao da gramatica de decodificacao
  // restrita da Anthropic estoura o tempo limite ("Grammar compilation timed out",
  // HTTP 400) e a extracao falha por completo. A validacao de saida fica a cargo da
  // camada Zod (parseRawExtraction), que ja tolera campos fora do formato.
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
      conjuge: {
        type: 'object',
        description:
          'Dados do CONJUGE, extraidos do termo de entrega/recebimento (Caixa) APENAS quando o termo indica que o contrato foi assinado tambem pelo conjuge.',
        properties: {
          fullName: { type: 'string', description: 'Nome completo do conjuge' },
          cpf: { type: 'string', description: 'CPF do conjuge' },
          birthDate: {
            type: 'string',
            description: 'Data de nascimento do conjuge, ISO yyyy-mm-dd',
          },
          confianca: { type: 'number' },
        },
        additionalProperties: false,
      },
      outorgantes: {
        type: 'array',
        description:
          'Outorgante(s) da PROCURACAO = titular(es) do processo. Dados pessoais de cada um.',
        items: {
          type: 'object',
          properties: {
            nome: { type: 'string' },
            cpf: { type: 'string' },
            rg: { type: 'string' },
            nascimento: { type: 'string', description: 'ISO yyyy-mm-dd' },
          },
          additionalProperties: false,
        },
      },
      compraVenda: {
        type: 'object',
        description:
          'Partes do CONTRATO DE COMPRA E VENDA particular (quando houver).',
        properties: {
          vendedores: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                nome: { type: 'string' },
                cpf: { type: 'string' },
                rg: { type: 'string' },
                nascimento: { type: 'string', description: 'ISO yyyy-mm-dd' },
              },
              additionalProperties: false,
            },
          },
          compradores: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                nome: { type: 'string' },
                cpf: { type: 'string' },
                rg: { type: 'string' },
                nascimento: { type: 'string', description: 'ISO yyyy-mm-dd' },
              },
              additionalProperties: false,
            },
          },
          dataAssinatura: {
            type: 'string',
            description: 'Data de assinatura do contrato, ISO yyyy-mm-dd',
          },
        },
        additionalProperties: false,
      },
      termoCompradores: {
        type: 'array',
        description:
          'Compradores do TERMO da Caixa (entrega/quitacao), EM ORDEM: [0]=titular do contrato, [1]=conjuge/co-comprador. NAO inclua a parte vendedora (FAR/Caixa).',
        items: {
          type: 'object',
          properties: {
            nome: { type: 'string' },
            cpf: { type: 'string' },
            rg: { type: 'string' },
            nascimento: { type: 'string', description: 'ISO yyyy-mm-dd' },
          },
          additionalProperties: false,
        },
      },
      procuracaoEndereco: {
        type: 'string',
        description:
          'Endereco de residencia do OUTORGANTE na procuracao, COMPLETO e como escrito, incluindo o residencial/conjunto/condominio se mencionado. NUNCA o endereco do advogado.',
      },
      procuracaoCidade: {
        type: 'string',
        description: 'Cidade do endereco do outorgante na procuracao.',
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
                'termo_quitacao',
                'declaracao_hipossuficiencia',
                'contrato_honorarios_advocaticios',
                'contrato_compra_venda',
                'rg_cpf_cnh_conjuge',
                'certidao_casamento',
                'certidao_obito',
                'nao_identificado',
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
    async extract(files: ExtractionInputFile[]): Promise<RawExtractionResult> {
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
                  text: 'Extraia os dados do titular e o endereco, classifique cada pagina deste dossie por tipo de documento, e (se o termo de entrega da Caixa indicar contrato assinado com o conjuge) extraia os dados do conjuge.',
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

      return {
        raw: parseRawExtraction(toolUse.input),
        // Modelo RESOLVIDO (message.model), nao o alias do request.
        model: message.model,
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        },
      }
    },
  }
}
