import { readFile } from 'node:fs/promises'
import { createReport } from 'docx-templates'
import { PDFDocument } from 'pdf-lib'
import { convertDocxToPdf } from './processes.pdf.libreoffice'
import type { ProcessPdfAttorneyProfile } from './processes.pdf.models'

export type ProcessPdfPartyData = {
  address: string
  cityState: string
  cpf: string
  email: string
  fullName: string
  maritalStatus: string
  nationality: string
  profession: string
  rg: string
  whatsapp: string
  zipcode: string
}

export type ProcessPdfSpouseData = {
  address: string
  cityState: string
  cpf: string
  fullName: string
  maritalStatus: string
  nationality: string
  profession: string
  rg: string
  zipcode: string
}

export type ProcessPdfRenderData = {
  attorney: ProcessPdfAttorneyProfile
  generatedAtLabel: string
  locationLabel: string
  party: ProcessPdfPartyData
  spouse?: ProcessPdfSpouseData
  witnesses: readonly [
    {
      cpf: string
      name: string
    },
    {
      cpf: string
      name: string
    },
  ]
}

let templatePromise: Promise<Buffer> | null = null
let conjueTemplatePromise: Promise<Buffer> | null = null
let cancellationTemplatePromise: Promise<Buffer> | null = null

function getTemplate() {
  if (!templatePromise) {
    templatePromise = readFile(
      new URL('./templates/kit-adjudicacao-base.docx', import.meta.url),
    )
  }
  return templatePromise
}

function getConjugeTemplate() {
  if (!conjueTemplatePromise) {
    conjueTemplatePromise = readFile(
      new URL('./templates/kit-adjudicacao-conjuge-base.docx', import.meta.url),
    )
  }
  return conjueTemplatePromise
}

function getCancellationTemplate() {
  if (!cancellationTemplatePromise) {
    cancellationTemplatePromise = readFile(
      new URL('./templates/modelo-cancelamento-base.docx', import.meta.url),
    )
  }
  return cancellationTemplatePromise
}

export async function renderKitAdjudicacaoPdf(
  data: ProcessPdfRenderData,
): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const template = await getTemplate()

  const docxBuffer = await createReport({
    template,
    cmdDelimiter: ['{', '}'],
    failFast: true,
    data: {
      partyFullName: data.party.fullName,
      partyMaritalStatus: data.party.maritalStatus,
      partyProfession: data.party.profession,
      partyCpf: data.party.cpf,
      partyAddress: data.party.address,
      partyCityState: data.party.cityState,
      partyZipcode: data.party.zipcode,
      partyEmail: data.party.email,
      partyWhatsapp: data.party.whatsapp,
      dateLabel: `${data.locationLabel}, ${data.generatedAtLabel}`,
      witness1Name: data.witnesses[0].name,
      witness1Cpf: data.witnesses[0].cpf,
      witness2Name: data.witnesses[1].name,
      witness2Cpf: data.witnesses[1].cpf,
    },
  })

  const pdfBytes = await convertDocxToPdf(docxBuffer)

  const pdfDocument = await PDFDocument.load(pdfBytes)
  const pageCount = pdfDocument.getPageCount()

  return {
    bytes: pdfBytes,
    pageCount,
  }
}

export async function renderKitAdjudicacaoConjugePdf(
  data: ProcessPdfRenderData,
): Promise<{ bytes: Uint8Array; pageCount: number }> {
  if (!data.spouse) {
    throw new Error('Dados do conjuge sao obrigatorios para este modelo.')
  }

  const template = await getConjugeTemplate()

  const docxBuffer = await createReport({
    template,
    cmdDelimiter: ['{', '}'],
    failFast: true,
    data: {
      partyFullName: data.party.fullName,
      partyMaritalStatus: data.party.maritalStatus,
      partyNationality: data.party.nationality,
      partyProfession: data.party.profession,
      partyCpf: data.party.cpf,
      partyRg: data.party.rg,
      partyAddress: data.party.address,
      partyCityState: data.party.cityState,
      partyZipcode: data.party.zipcode,
      partyEmail: data.party.email,
      partyWhatsapp: data.party.whatsapp,
      spouseFullName: data.spouse.fullName,
      spouseMaritalStatus: data.spouse.maritalStatus,
      spouseNationality: data.spouse.nationality,
      spouseProfession: data.spouse.profession,
      spouseCpf: data.spouse.cpf,
      spouseRg: data.spouse.rg,
      spouseAddress: data.spouse.address,
      spouseCityState: data.spouse.cityState,
      spouseZipcode: data.spouse.zipcode,
      dateLabel: `${data.locationLabel}, ${data.generatedAtLabel}`,
      witness1Name: data.witnesses[0].name,
      witness1Cpf: data.witnesses[0].cpf,
      witness2Name: data.witnesses[1].name,
      witness2Cpf: data.witnesses[1].cpf,
    },
  })

  const pdfBytes = await convertDocxToPdf(docxBuffer)

  const pdfDocument = await PDFDocument.load(pdfBytes)
  const pageCount = pdfDocument.getPageCount()

  return {
    bytes: pdfBytes,
    pageCount,
  }
}

export async function renderCancellationPdf(): Promise<{
  bytes: Uint8Array
  pageCount: number
}> {
  const template = await getCancellationTemplate()

  const pdfBytes = await convertDocxToPdf(template)
  const pdfDocument = await PDFDocument.load(pdfBytes)
  const pageCount = pdfDocument.getPageCount()

  return {
    bytes: pdfBytes,
    pageCount,
  }
}
