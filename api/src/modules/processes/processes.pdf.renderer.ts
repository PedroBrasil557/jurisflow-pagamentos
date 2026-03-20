import { readFile } from 'node:fs/promises'
import { createReport } from 'docx-templates'
import { PDFDocument } from 'pdf-lib'
import { convertDocxToPdf } from './processes.pdf.libreoffice'
import type { ProcessPdfAttorneyProfile } from './processes.pdf.models'

export type ProcessPdfRenderData = {
  attorney: ProcessPdfAttorneyProfile
  generatedAtLabel: string
  locationLabel: string
  party: {
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

function getTemplate() {
  if (!templatePromise) {
    templatePromise = readFile(
      new URL('./templates/kit-adjudicacao-base.docx', import.meta.url),
    )
  }
  return templatePromise
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
