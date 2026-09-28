import { eq } from 'drizzle-orm'
import { DEFAULT_USER_PERMISSIONS } from '../../src/modules/permissions/permissions.defaults'
import {
  permissionProfile,
  profileHousingComplex,
} from '../../src/modules/permissions/permissions.schema'
import type {
  ProcessScope,
  ProfilePermissions,
} from '../../src/modules/permissions/permissions.types'
import { db } from '../../src/shared/db'

export type CustomProfileSeed = {
  id: string
  name: string
  description: string
  processScope: ProcessScope
  permissions: ProfilePermissions
  housingComplexIds?: string[]
}

export const customProfilesSeed: CustomProfileSeed[] = [
  {
    id: 'profile_agente_documentacao',
    name: 'Agente de Documentacao',
    description:
      'Organiza a documentacao dos processos em conjuntos vinculados ao perfil.',
    processScope: 'housing_complex',
    permissions: {
      process: {
        ...DEFAULT_USER_PERMISSIONS.process,
        create: false,
        editOwn: false,
        cancelOwn: false,
        uploadChecklist: true,
        deleteChecklistFile: true,
        markDocumentationReady: true,
        viewBatch: true,
        uploadBatch: false,
      },
      sections: {
        dashboard: true,
        checklist: true,
        documentation: true,
        legalData: false,
        history: true,
        batch: true,
      },
      titularCaixa: DEFAULT_USER_PERMISSIONS.titularCaixa,
      cadastros: DEFAULT_USER_PERMISSIONS.cadastros,
      financeiro: DEFAULT_USER_PERMISSIONS.financeiro,
    },
  },
  {
    id: 'profile_supervisor_lote',
    name: 'Supervisor de Lote',
    description: 'Gerencia o envio de arquivos em lote nos conjuntos vinculados.',
    processScope: 'housing_complex',
    permissions: {
      process: {
        create: false,
        viewOwn: true,
        editOwn: false,
        editAny: false,
        startLegal: false,
        editLegal: false,
        finalize: false,
        cancelOwn: false,
        cancelAny: false,
        markDocumentationReady: false,
        uploadChecklist: false,
        deleteChecklistFile: false,
        viewBatch: true,
        uploadBatch: true,
        deleteBatch: true,
        generatePdf: false,
      },
      sections: {
        dashboard: true,
        checklist: false,
        documentation: false,
        legalData: false,
        history: true,
        batch: true,
      },
      titularCaixa: DEFAULT_USER_PERMISSIONS.titularCaixa,
      cadastros: DEFAULT_USER_PERMISSIONS.cadastros,
      financeiro: DEFAULT_USER_PERMISSIONS.financeiro,
    },
  },
  {
    id: 'profile_visualizador_total',
    name: 'Visualizador Total',
    description:
      'Acesso somente leitura a todos os processos e historico da plataforma.',
    processScope: 'all',
    permissions: {
      process: {
        create: false,
        viewOwn: true,
        editOwn: false,
        editAny: false,
        startLegal: false,
        editLegal: false,
        finalize: false,
        cancelOwn: false,
        cancelAny: false,
        markDocumentationReady: false,
        uploadChecklist: false,
        deleteChecklistFile: false,
        viewBatch: true,
        uploadBatch: false,
        deleteBatch: false,
        generatePdf: true,
      },
      sections: {
        dashboard: true,
        checklist: true,
        documentation: true,
        legalData: true,
        history: true,
        batch: true,
      },
      // Somente leitura tambem em titulares Caixa: ve a tela, sem acoes.
      titularCaixa: {
        view: true,
        export: false,
        import: false,
        reconsultar: false,
      },
      cadastros: DEFAULT_USER_PERMISSIONS.cadastros,
      financeiro: DEFAULT_USER_PERMISSIONS.financeiro,
    },
  },
]

export async function seedCustomProfiles(options: {
  housingComplexIdsByProfileName: Record<string, string[]>
}) {
  for (const profile of customProfilesSeed) {
    const [existing] = await db
      .select({ id: permissionProfile.id })
      .from(permissionProfile)
      .where(eq(permissionProfile.id, profile.id))
      .limit(1)

    if (!existing) {
      await db.insert(permissionProfile).values({
        id: profile.id,
        name: profile.name,
        description: profile.description,
        isSystem: false,
        processScope: profile.processScope,
        permissions: profile.permissions,
      })
    }

    const linkedHcIds = options.housingComplexIdsByProfileName[profile.name] ?? []
    if (linkedHcIds.length === 0) {
      continue
    }

    for (const hcId of linkedHcIds) {
      await db
        .insert(profileHousingComplex)
        .values({
          profileId: profile.id,
          housingComplexId: hcId,
        })
        .onConflictDoNothing()
    }
  }
}
