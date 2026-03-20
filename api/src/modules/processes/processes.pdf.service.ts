import { inArray } from 'drizzle-orm'
import { db } from '../../shared/db'
import {
  buildProcessGeneratedDocumentObjectKey,
  createStorageObjectDownloadUrl,
  deleteStorageObject,
  storageBuckets,
  uploadStorageObject,
} from '../../shared/storage/s3'
import type { AppBindings } from '../../shared/types/app'
import { normalizeCpf } from '../../shared/utils/cpf'
import { user } from '../auth/auth.schema'
import { ProcessServiceError } from './processes.errors'
import { createProcessHistoryEntry } from './processes.history.service'
import {
  getProcessPdfModelByKey,
  type ProcessPdfModelKey,
  processPdfModels,
} from './processes.pdf.models'
import {
  type ProcessPdfRenderData,
  renderKitAdjudicacaoPdf,
} from './processes.pdf.renderer'
import { processGeneratedDocument } from './processes.schema'
import { getProcessOrThrow } from './processes.service'

type ProcessActor = NonNullable<AppBindings['Variables']['user']>

const processMaritalStatusLabels = {
  solteiro: 'SOLTEIRO(A)',
  casado: 'CASADO(A)',
  separado_judicialmente: 'SEPARADO(A) JUDICIALMENTE',
  divorciado: 'DIVORCIADO(A)',
  viuvo: 'VIUVO(A)',
} as const

function formatCpf(value: string) {
  const normalized = normalizeCpf(value)

  if (normalized.length !== 11) {
    return value
  }

  return normalized.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
  }).format(value)
}

function toDocumentValue(value: string | null | undefined) {
  const normalized = value?.trim()

  if (!normalized) {
    return ''
  }

  return normalized
}

function toUppercaseDocumentValue(value: string | null | undefined) {
  return toDocumentValue(value).toLocaleUpperCase('pt-BR')
}

function buildProcessAddress(input: {
  complement: string
  district: string
  housingComplex: string
  number: string
  street: string
}) {
  return [
    input.street,
    input.number ? `NUMERO ${input.number}` : '',
    input.complement,
    input.district,
    input.housingComplex,
  ]
    .map((value) => value.trim())
    .filter(Boolean)
    .join(', ')
}

function buildPdfFileName(input: { modelKey: string; processCode: string }) {
  return `${input.processCode}-${input.modelKey}.pdf`
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '')
}

async function getProcessPdfData(processId: string) {
  const currentProcess = await getProcessOrThrow(processId)
  const witnessIds = [currentProcess.witness1Id, currentProcess.witness2Id]

  const rawWitnesses = await db
    .select({
      id: user.id,
      name: user.name,
      cpf: user.username,
    })
    .from(user)
    .where(inArray(user.id, witnessIds))

  const witnesses = rawWitnesses.map((w) => ({
    ...w,
    cpf: w.cpf ?? '',
  }))

  if (witnesses.length !== 2) {
    throw new ProcessServiceError(
      409,
      'Nao foi possivel localizar as testemunhas deste processo.',
    )
  }

  const witnessById = new Map(witnesses.map((witness) => [witness.id, witness]))
  const witness1 = witnessById.get(currentProcess.witness1Id)
  const witness2 = witnessById.get(currentProcess.witness2Id)

  if (!witness1 || !witness2) {
    throw new ProcessServiceError(
      409,
      'Nao foi possivel localizar as testemunhas deste processo.',
    )
  }

  return {
    currentProcess,
    witnesses: [witness1, witness2] as const,
  }
}

function buildProcessPdfRenderData(input: {
  generatedAt: Date
  modelKey: ProcessPdfModelKey
  processId: string
  processRecord: Awaited<ReturnType<typeof getProcessOrThrow>>
  witnesses: readonly [
    { cpf: string; id: string; name: string },
    { cpf: string; id: string; name: string },
  ]
}) {
  const model = getProcessPdfModelByKey(input.modelKey)

  if (!model) {
    throw new ProcessServiceError(404, 'Modelo de PDF nao encontrado.')
  }

  const locationLabel =
    `${input.processRecord.city}/${input.processRecord.state}`.toLocaleUpperCase(
      'pt-BR',
    )
  const partyData = {
    address: toUppercaseDocumentValue(
      buildProcessAddress({
        street: input.processRecord.street,
        number: input.processRecord.number,
        complement: input.processRecord.complement,
        district: input.processRecord.district,
        housingComplex: input.processRecord.housingComplex,
      }),
    ),
    cityState: locationLabel,
    cpf: formatCpf(input.processRecord.cpf),
    email: toDocumentValue(input.processRecord.email).toLocaleLowerCase(
      'pt-BR',
    ),
    fullName: input.processRecord.fullName.toLocaleUpperCase('pt-BR'),
    maritalStatus:
      processMaritalStatusLabels[
        input.processRecord
          .maritalStatus as keyof typeof processMaritalStatusLabels
      ] ?? input.processRecord.maritalStatus.toLocaleUpperCase('pt-BR'),
    nationality: toUppercaseDocumentValue(input.processRecord.nationality),
    profession: toUppercaseDocumentValue(input.processRecord.profession),
    rg: toUppercaseDocumentValue(input.processRecord.rg),
    whatsapp: toDocumentValue(input.processRecord.whatsapp),
    zipcode: toUppercaseDocumentValue(input.processRecord.zipcode),
  }

  const renderData: ProcessPdfRenderData = {
    attorney: model.attorneyProfile,
    generatedAtLabel: formatDate(input.generatedAt),
    locationLabel,
    party: partyData,
    witnesses: [
      {
        name: input.witnesses[0].name.toUpperCase(),
        cpf: formatCpf(input.witnesses[0].cpf),
      },
      {
        name: input.witnesses[1].name.toUpperCase(),
        cpf: formatCpf(input.witnesses[1].cpf),
      },
    ],
  }

  return {
    model,
    renderData,
    dataSnapshot: {
      generatedAt: input.generatedAt.toISOString(),
      locationLabel,
      model: {
        key: model.key,
        label: model.label,
      },
      party: renderData.party,
      process: {
        code: input.processRecord.code,
        id: input.processId,
        status: input.processRecord.status,
      },
      witnesses: renderData.witnesses,
    } satisfies Record<string, unknown>,
  }
}

function renderPdfForModel(input: {
  data: ProcessPdfRenderData
  modelKey: ProcessPdfModelKey
}) {
  const model = getProcessPdfModelByKey(input.modelKey)

  if (!model) {
    throw new ProcessServiceError(404, 'Modelo de PDF nao encontrado.')
  }

  switch (model.rendererKey) {
    case 'KIT_ADJUDICACAO_BASE':
      return renderKitAdjudicacaoPdf(input.data)
  }
}

export async function listProcessPdfModels(processId: string) {
  await getProcessOrThrow(processId)

  return {
    items: processPdfModels.map((model) => ({
      key: model.key,
      label: model.label,
      description: model.description,
    })),
  }
}

export async function generateProcessPdf(input: {
  actor: ProcessActor
  modelKey: ProcessPdfModelKey
  processId: string
}) {
  const generatedAt = new Date()
  const { currentProcess, witnesses } = await getProcessPdfData(input.processId)
  const { model, renderData, dataSnapshot } = buildProcessPdfRenderData({
    generatedAt,
    modelKey: input.modelKey,
    processId: input.processId,
    processRecord: currentProcess,
    witnesses,
  })
  const { bytes, pageCount } = await renderPdfForModel({
    data: renderData,
    modelKey: model.key,
  })
  const generatedDocumentId = crypto.randomUUID()
  const bucketName = storageBuckets.processDocuments
  const fileName = buildPdfFileName({
    processCode: currentProcess.code,
    modelKey: model.key,
  })
  const objectKey = buildProcessGeneratedDocumentObjectKey({
    documentId: generatedDocumentId,
    fileName,
    modelKey: model.key,
    processId: input.processId,
  })

  await uploadStorageObject({
    body: bytes,
    bucketName,
    contentType: 'application/pdf',
    objectKey,
  })

  try {
    await db.transaction(async (tx) => {
      await tx.insert(processGeneratedDocument).values({
        id: generatedDocumentId,
        processId: input.processId,
        modelKey: model.key,
        modelLabel: model.label,
        bucketName,
        objectKey,
        fileName,
        mimeType: 'application/pdf',
        sizeInBytes: bytes.byteLength,
        pageCount,
        dataSnapshot,
        generatedByUserId: input.actor.id,
        generatedAt,
      })

      await createProcessHistoryEntry({
        processId: input.processId,
        actorUserId: input.actor.id,
        eventType: 'PDF_GENERATED',
        notes: `PDF gerado com o modelo ${model.label}.`,
        executor: tx,
      })
    })
  } catch (error) {
    await deleteStorageObject({
      bucketName,
      objectKey,
    }).catch(() => undefined)

    throw error
  }

  const downloadUrl = await createStorageObjectDownloadUrl({
    bucketName,
    objectKey,
  })

  return {
    document: {
      id: generatedDocumentId,
      fileName,
      modelKey: model.key,
      modelLabel: model.label,
      pageCount,
      sizeInBytes: bytes.byteLength,
      generatedAt: generatedAt.toISOString(),
      downloadUrl,
    },
    message: 'PDF gerado com sucesso.',
  }
}
