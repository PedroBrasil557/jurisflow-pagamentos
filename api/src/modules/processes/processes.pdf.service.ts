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
import { assertProcessAction } from '../permissions/permissions.service'
import type { ResolvedPermissions } from '../permissions/permissions.types'
import { getProcessContextOrThrow } from './processes.access'
import { ProcessServiceError } from './processes.errors'
import { createProcessHistoryEntry } from './processes.history.service'
import {
  cancellationPdfModel,
  getProcessPdfModelByKey,
  type ProcessPdfModelKey,
  processPdfModels,
} from './processes.pdf.models'
import {
  type ProcessPdfRenderData,
  renderCancellationPdf,
  renderKitAdjudicacaoConjugePdf,
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

  const witnessIds = [
    currentProcess.witness1Id,
    currentProcess.witness2Id,
  ].filter((id): id is string => id !== null)

  const emptyWitness = { id: '', name: '', cpf: '' }

  if (witnessIds.length === 0) {
    return {
      currentProcess,
      witnesses: [emptyWitness, emptyWitness] as const,
    }
  }

  const rawWitnesses = await db
    .select({
      id: user.id,
      name: user.name,
      cpf: user.username,
    })
    .from(user)
    .where(inArray(user.id, witnessIds))

  const witnessById = new Map(
    rawWitnesses.map((w) => [w.id, { ...w, cpf: w.cpf ?? '' }]),
  )
  const witness1 = currentProcess.witness1Id
    ? (witnessById.get(currentProcess.witness1Id) ?? emptyWitness)
    : emptyWitness
  const witness2 = currentProcess.witness2Id
    ? (witnessById.get(currentProcess.witness2Id) ?? emptyWitness)
    : emptyWitness

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

  const hasSpouse = input.processRecord.spouseContractSigned === 'sim'

  const spouseData = hasSpouse
    ? {
        fullName: toUppercaseDocumentValue(input.processRecord.spouseFullName),
        maritalStatus:
          processMaritalStatusLabels[
            input.processRecord
              .spouseMaritalStatus as keyof typeof processMaritalStatusLabels
          ] ??
          toUppercaseDocumentValue(input.processRecord.spouseMaritalStatus),
        nationality: toUppercaseDocumentValue(
          input.processRecord.spouseNationality,
        ),
        profession: toUppercaseDocumentValue(
          input.processRecord.spouseProfession,
        ),
        cpf: formatCpf(input.processRecord.spouseCpf ?? ''),
        rg: toUppercaseDocumentValue(input.processRecord.spouseRg),
        address:
          input.processRecord.spouseSameAddress === 'sim'
            ? partyData.address
            : toUppercaseDocumentValue(
                buildProcessAddress({
                  street: input.processRecord.spouseStreet ?? '',
                  number: input.processRecord.spouseNumber ?? '',
                  complement: input.processRecord.spouseComplement ?? '',
                  district: input.processRecord.spouseDistrict ?? '',
                  housingComplex:
                    input.processRecord.spouseHousingComplex ?? '',
                }),
              ),
        cityState:
          input.processRecord.spouseSameAddress === 'sim'
            ? locationLabel
            : `${input.processRecord.spouseCity ?? ''}/${input.processRecord.spouseState ?? ''}`.toLocaleUpperCase(
                'pt-BR',
              ),
        zipcode: toUppercaseDocumentValue(
          input.processRecord.spouseSameAddress === 'sim'
            ? input.processRecord.zipcode
            : input.processRecord.spouseZipcode,
        ),
      }
    : undefined

  const resolvedRendererKey = hasSpouse
    ? 'KIT_ADJUDICACAO_CONJUGE_BASE'
    : model.rendererKey

  const renderData: ProcessPdfRenderData = {
    attorney: model.attorneyProfile,
    generatedAtLabel: formatDate(input.generatedAt),
    locationLabel,
    party: partyData,
    spouse: spouseData,
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
    resolvedRendererKey,
    dataSnapshot: {
      generatedAt: input.generatedAt.toISOString(),
      locationLabel,
      model: {
        key: model.key,
        label: model.label,
      },
      party: renderData.party,
      spouse: renderData.spouse,
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
  rendererKey: string
}) {
  switch (input.rendererKey) {
    case 'KIT_ADJUDICACAO_BASE':
      return renderKitAdjudicacaoPdf(input.data)
    case 'KIT_ADJUDICACAO_CONJUGE_BASE':
      return renderKitAdjudicacaoConjugePdf(input.data)
    default:
      throw new ProcessServiceError(404, 'Modelo de PDF nao encontrado.')
  }
}

export async function listProcessPdfModels(
  processId: string,
  userId: string,
  perms: ResolvedPermissions,
) {
  const { process: currentProcess, relationship } =
    await getProcessContextOrThrow({
      processId,
      userId,
      perms,
    })
  assertProcessAction(perms, relationship, 'generatePdf')

  if (currentProcess.status === 'CANCELADO') {
    return {
      items: [
        {
          key: cancellationPdfModel.key,
          label: cancellationPdfModel.label,
          description: cancellationPdfModel.description,
        },
      ],
    }
  }

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
  modelKey: string
  processId: string
  perms: ResolvedPermissions
}) {
  const generatedAt = new Date()
  const { process: currentProcess, relationship } =
    await getProcessContextOrThrow({
      processId: input.processId,
      userId: input.actor.id,
      perms: input.perms,
    })
  assertProcessAction(input.perms, relationship, 'generatePdf')

  // Handle cancellation PDF (static template)
  if (
    input.modelKey === cancellationPdfModel.key &&
    currentProcess.status === 'CANCELADO'
  ) {
    return generateCancellationPdf({
      actor: input.actor,
      processId: input.processId,
      processCode: currentProcess.code,
      generatedAt,
    })
  }

  const { witnesses } = await getProcessPdfData(input.processId)
  const { model, renderData, resolvedRendererKey, dataSnapshot } =
    buildProcessPdfRenderData({
      generatedAt,
      modelKey: input.modelKey as ProcessPdfModelKey,
      processId: input.processId,
      processRecord: currentProcess,
      witnesses,
    })
  const { bytes, pageCount } = await renderPdfForModel({
    data: renderData,
    rendererKey: resolvedRendererKey,
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

async function generateCancellationPdf(input: {
  actor: ProcessActor
  processId: string
  processCode: string
  generatedAt: Date
}) {
  const { bytes, pageCount } = await renderCancellationPdf()
  const generatedDocumentId = crypto.randomUUID()
  const bucketName = storageBuckets.processDocuments
  const fileName = buildPdfFileName({
    processCode: input.processCode,
    modelKey: cancellationPdfModel.key,
  })
  const objectKey = buildProcessGeneratedDocumentObjectKey({
    documentId: generatedDocumentId,
    fileName,
    modelKey: cancellationPdfModel.key,
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
        modelKey: cancellationPdfModel.key,
        modelLabel: cancellationPdfModel.label,
        bucketName,
        objectKey,
        fileName,
        mimeType: 'application/pdf',
        sizeInBytes: bytes.byteLength,
        pageCount,
        dataSnapshot: {
          generatedAt: input.generatedAt.toISOString(),
          model: {
            key: cancellationPdfModel.key,
            label: cancellationPdfModel.label,
          },
          process: {
            code: input.processCode,
            id: input.processId,
            status: 'CANCELADO',
          },
        },
        generatedByUserId: input.actor.id,
        generatedAt: input.generatedAt,
      })

      await createProcessHistoryEntry({
        processId: input.processId,
        actorUserId: input.actor.id,
        eventType: 'PDF_GENERATED',
        notes: `PDF gerado com o modelo ${cancellationPdfModel.label}.`,
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
      modelKey: cancellationPdfModel.key,
      modelLabel: cancellationPdfModel.label,
      pageCount,
      sizeInBytes: bytes.byteLength,
      generatedAt: input.generatedAt.toISOString(),
      downloadUrl,
    },
    message: 'PDF de cancelamento gerado com sucesso.',
  }
}
