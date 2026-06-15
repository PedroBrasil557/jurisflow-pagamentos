// Tipos de documento do checklist (fonte de verdade; sincronizados no DB por
// `key` em processes.checklist.service.ts). NUNCA mudar `key` — os arquivos
// referenciam o tipo por id, preservado quando se sincroniza por key.
//
// `sortOrder`: ordena os itens (em dezenas, para encaixar condicionais como o
//   conjuge entre 2 e 3 sem renumerar todos).
// `displayNumber`: numero mostrado no rotulo e no nome do arquivo (string para
//   permitir "2.1"); `null` = item obrigatorio sem numeracao (ex.: honorarios).
export const defaultProcessDocumentTypes = [
  {
    key: 'procuracao_advogado',
    label: 'Procuracao para o advogado',
    sortOrder: 10,
    displayNumber: '1',
    isRequired: true,
    allowsMultipleFiles: false,
  },
  {
    key: 'rg_cpf_cnh',
    label: 'RG/CPF/CNH',
    sortOrder: 20,
    displayNumber: '2',
    isRequired: true,
    allowsMultipleFiles: false,
  },
  {
    key: 'comprovante_endereco',
    label: 'Comprovante de endereco',
    sortOrder: 30,
    displayNumber: '3',
    isRequired: true,
    allowsMultipleFiles: false,
  },
  {
    key: 'termo_entrega_recebimento_imovel',
    label: 'Termo de entrega/recebimento do imovel pela instituicao bancaria',
    sortOrder: 40,
    displayNumber: '4',
    isRequired: true,
    allowsMultipleFiles: false,
  },
  {
    key: 'declaracao_hipossuficiencia',
    label: 'Declaracao de hipossuficiencia',
    sortOrder: 50,
    displayNumber: '5',
    isRequired: true,
    allowsMultipleFiles: false,
  },
  {
    key: 'solicitacao_caixa',
    label: 'Solicitacao Caixa',
    sortOrder: 60,
    displayNumber: '6',
    isRequired: true,
    allowsMultipleFiles: false,
  },
  {
    key: 'declaracao_quitacao',
    label: 'Declaracao de quitacao',
    sortOrder: 70,
    displayNumber: '7',
    isRequired: true,
    allowsMultipleFiles: false,
  },
  {
    key: 'requerimento_adm_caixa',
    label: 'Requerimento administrativo Caixa',
    sortOrder: 80,
    displayNumber: '8',
    isRequired: true,
    allowsMultipleFiles: false,
  },
  {
    key: 'matricula_imovel',
    label: 'Visualizacao da matricula do imovel',
    sortOrder: 90,
    displayNumber: '9',
    isRequired: true,
    allowsMultipleFiles: false,
  },
  {
    key: 'contrato_honorarios_advocaticios',
    label: 'Contrato de honorarios advocaticios',
    sortOrder: 100,
    displayNumber: null,
    isRequired: true,
    allowsMultipleFiles: false,
  },
  {
    key: 'certidao_casamento',
    label: 'Certidao de casamento',
    sortOrder: 120,
    displayNumber: '11',
    isRequired: false,
    allowsMultipleFiles: false,
  },
  {
    key: 'certidao_obito',
    label: 'Certidao de obito',
    sortOrder: 130,
    displayNumber: '12',
    isRequired: false,
    allowsMultipleFiles: false,
  },
  {
    key: 'certidao_iptu',
    label: 'Certidao de IPTU',
    sortOrder: 140,
    displayNumber: '13',
    isRequired: false,
    allowsMultipleFiles: false,
  },
  {
    key: 'outros',
    label: 'Outros',
    sortOrder: 150,
    displayNumber: '14',
    isRequired: false,
    allowsMultipleFiles: true,
  },
] as const

export const conditionalProcessDocumentTypes = [
  {
    key: 'rg_cpf_cnh_conjuge',
    label: 'RG/CPF/CNH do conjuge',
    sortOrder: 25,
    displayNumber: '2.1',
    isRequired: true,
    allowsMultipleFiles: false,
    condition: { field: 'spouseContractSigned', value: 'sim' },
  },
  {
    key: 'contrato_compra_venda',
    label: 'Contrato de compra e venda',
    sortOrder: 110,
    displayNumber: '10',
    isRequired: true,
    allowsMultipleFiles: false,
    condition: { field: 'ownerType', value: 'nao_titular_contrato_caixa' },
  },
] as const

// Numero de exibicao por key (null = sem numeracao). Usado no rotulo do
// checklist e no prefixo do nome dos arquivos.
export const documentDisplayNumberByKey = new Map<string, string | null>(
  [...defaultProcessDocumentTypes, ...conditionalProcessDocumentTypes].map(
    (type) => [type.key, type.displayNumber],
  ),
)

// Tipos cujo arquivo e anexado UMA vez no cadastro do CONJUNTO (housing_complex)
// e espelhado (somente leitura) no checklist de todos os processos do conjunto.
export const housingComplexDocumentKeys = new Set<string>([
  'solicitacao_caixa',
  'requerimento_adm_caixa',
  'matricula_imovel',
])

export function isHousingComplexDocument(key: string): boolean {
  return housingComplexDocumentKeys.has(key)
}

// Rotulo por key (para telas que listam documentos do conjunto).
export const documentLabelByKey = new Map<string, string>(
  [...defaultProcessDocumentTypes, ...conditionalProcessDocumentTypes].map(
    (type) => [type.key, type.label],
  ),
)

// Tipos do conjunto na ordem de exibicao, para a tela do cadastro do conjunto.
export const housingComplexDocumentTypes = defaultProcessDocumentTypes
  .filter((type) => housingComplexDocumentKeys.has(type.key))
  .map((type) => ({
    key: type.key,
    label: type.label,
    displayNumber: type.displayNumber,
  }))
