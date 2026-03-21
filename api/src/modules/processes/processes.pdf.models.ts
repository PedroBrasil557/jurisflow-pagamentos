export type ProcessPdfAttorneyProfile = {
  contractDescription: string
  contractName: string
  contractWhatsApp: string
  cpf: string
  email: string
  officeAddress: string
  procurationDescription: string
  procurationName: string
}

export type ProcessPdfRendererKey =
  | 'KIT_ADJUDICACAO_BASE'
  | 'KIT_ADJUDICACAO_CONJUGE_BASE'

export type ProcessPdfModelDefinition = {
  description: string
  key: string
  label: string
  rendererKey: ProcessPdfRendererKey
  attorneyProfile: ProcessPdfAttorneyProfile
}

const defaultAttorneyProfile: ProcessPdfAttorneyProfile = {
  contractDescription:
    'brasileiro, casado, advogado inscrito na OAB/SC nº 72.670 e economista no Corecon/SC nº 2.901',
  contractName: 'Gean Iamarque Izidio de Lima',
  contractWhatsApp: '(48) 99865-2656',
  cpf: '551.600.855-72',
  email: 'geanizidio@gmail.com',
  officeAddress:
    'Av. Mauro Ramos, 1409, Sala 902, Centro, Florianopolis/SC, CEP 88020-303',
  procurationDescription:
    'brasileiro, casado, advogado e economista, inscrito na OAB/SC sob nº 72.670 e no Corecon/SC sob nº 2.901',
  procurationName: 'Gean Iamarque Izidio de Lima',
}

export const processPdfModels = [
  {
    key: 'KIT_ADJUDICACAO_BROMELIA_01',
    label: 'Kit adjudicacao Bromelia 01',
    description: 'Gera o modelo padrao de adjudicacao MCMV.',
    rendererKey: 'KIT_ADJUDICACAO_BASE',
    attorneyProfile: defaultAttorneyProfile,
  },
  {
    key: 'KIT_ADJUDICACAO_BROMELIA_06',
    label: 'Kit adjudicacao Bromelia 06',
    description: 'Gera o modelo padrao de adjudicacao MCMV.',
    rendererKey: 'KIT_ADJUDICACAO_BASE',
    attorneyProfile: defaultAttorneyProfile,
  },
] as const satisfies readonly ProcessPdfModelDefinition[]

export type ProcessPdfModelKey = (typeof processPdfModels)[number]['key']

export const processPdfModelKeys = processPdfModels.map(
  (model) => model.key,
) as [ProcessPdfModelKey, ...ProcessPdfModelKey[]]

export const cancellationPdfModel = {
  key: 'MODELO_CANCELAMENTO_BASE',
  label: 'Modelo de cancelamento',
  description: 'Documento padrao de cancelamento do processo.',
} as const

export function getProcessPdfModelByKey(key: string) {
  return processPdfModels.find((model) => model.key === key) ?? null
}
