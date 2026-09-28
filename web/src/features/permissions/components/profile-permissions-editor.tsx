import {
  Eye,
  FilePlus,
  FileSpreadsheet,
  Files,
  FileText,
  Gavel,
  Landmark,
  Layers,
  UserCog,
  XCircle,
} from 'lucide-react'
import { Checkbox } from '#/components/ui/checkbox'
import { Label } from '#/components/ui/label'
import type { ProfilePermissions } from '../services/permissions.service'

type PermissionSection = keyof ProfilePermissions

type PermissionItem = {
  key:
    | keyof ProfilePermissions['process']
    | keyof ProfilePermissions['sections']
    | keyof ProfilePermissions['titularCaixa']
    | keyof ProfilePermissions['cadastros']
    | keyof ProfilePermissions['financeiro']
  section: PermissionSection
  label: string
  description?: string
}

type PermissionGroup = {
  label: string
  icon: React.ComponentType<{ className?: string }>
  items: PermissionItem[]
}

const permissionGroups: PermissionGroup[] = [
  {
    label: 'Processos',
    icon: FilePlus,
    items: [
      { key: 'create', section: 'process', label: 'Criar processo' },
      {
        key: 'editOwn',
        section: 'process',
        label: 'Editar processos proprios',
      },
      {
        key: 'editAny',
        section: 'process',
        label: 'Editar qualquer processo visivel',
      },
    ],
  },
  {
    label: 'Workflow juridico',
    icon: Gavel,
    items: [
      {
        key: 'startLegal',
        section: 'process',
        label: 'Iniciar processo juridico',
      },
      { key: 'editLegal', section: 'process', label: 'Editar dados juridicos' },
      { key: 'finalize', section: 'process', label: 'Finalizar processo' },
    ],
  },
  {
    label: 'Cancelamento',
    icon: XCircle,
    items: [
      {
        key: 'cancelOwn',
        section: 'process',
        label: 'Cancelar processos proprios',
      },
      {
        key: 'cancelAny',
        section: 'process',
        label: 'Cancelar qualquer processo visivel',
      },
    ],
  },
  {
    label: 'Lote de documentos',
    icon: Files,
    items: [
      { key: 'viewBatch', section: 'process', label: 'Ver arquivos do lote' },
      {
        key: 'uploadBatch',
        section: 'process',
        label: 'Enviar arquivos em lote',
      },
      {
        key: 'deleteBatch',
        section: 'process',
        label: 'Excluir arquivos do lote',
      },
    ],
  },
  {
    label: 'Documentacao (checklist)',
    icon: FileText,
    items: [
      {
        key: 'uploadChecklist',
        section: 'process',
        label: 'Organizar itens do checklist',
        description: 'Permite enviar e organizar documentos nos itens',
      },
      {
        key: 'deleteChecklistFile',
        section: 'process',
        label: 'Excluir arquivos do checklist',
      },
      {
        key: 'markDocumentationReady',
        section: 'process',
        label: 'Marcar documentacao como pronta',
      },
    ],
  },
  {
    label: 'Outras acoes',
    icon: Layers,
    items: [
      {
        key: 'generatePdf',
        section: 'process',
        label: 'Gerar PDF do processo',
      },
    ],
  },
  {
    label: 'Titulares Caixa',
    icon: FileSpreadsheet,
    items: [
      {
        key: 'view',
        section: 'titularCaixa',
        label: 'Acessar titulares Caixa',
        description: 'Tela, termos de quitacao e aba do dashboard',
      },
      {
        key: 'export',
        section: 'titularCaixa',
        label: 'Exportar planilha',
      },
      {
        key: 'import',
        section: 'titularCaixa',
        label: 'Importar planilha',
      },
      {
        key: 'reconsultar',
        section: 'titularCaixa',
        label: 'Reconsultar quitacao',
      },
    ],
  },
  {
    label: 'Cadastros',
    icon: UserCog,
    items: [
      {
        key: 'usuarios',
        section: 'cadastros',
        label: 'Gerenciar usuarios',
        description: 'Criar, editar e resetar usuarios (nao administradores)',
      },
      {
        key: 'conjuntos',
        section: 'cadastros',
        label: 'Gerenciar conjuntos habitacionais',
      },
      {
        key: 'permissoes',
        section: 'cadastros',
        label: 'Gerenciar perfis de permissao',
        description: 'Criar perfis e atribui-los a usuarios',
      },
    ],
  },
  {
    label: 'Pagamentos (financeiro)',
    icon: Landmark,
    items: [
      {
        key: 'view',
        section: 'financeiro',
        label: 'Ver valores financeiros',
        description:
          'Recebimentos, previas, fechamentos e extratos do escopo do perfil',
      },
      {
        key: 'lancar',
        section: 'financeiro',
        label: 'Lancar recebimentos',
        description: 'Registrar recebimentos e anexar comprovantes',
      },
      {
        key: 'conferir',
        section: 'financeiro',
        label: 'Conferir recebimentos',
      },
      {
        key: 'fechar',
        section: 'financeiro',
        label: 'Fechar e estornar lotes',
        description: 'Exige escopo de todos os processos',
      },
      {
        key: 'baixar',
        section: 'financeiro',
        label: 'Registrar baixas de pagamento',
        description: 'Pagamentos feitos fora da plataforma',
      },
      {
        key: 'regras',
        section: 'financeiro',
        label: 'Gerenciar destinatarios e regras',
      },
      {
        key: 'reservas',
        section: 'financeiro',
        label: 'Movimentar reservas e provisoes',
      },
      {
        key: 'exportar',
        section: 'financeiro',
        label: 'Exportar extratos',
      },
    ],
  },
  {
    label: 'Secoes visiveis',
    icon: Eye,
    items: [
      { key: 'dashboard', section: 'sections', label: 'Dashboard' },
      {
        key: 'batch',
        section: 'sections',
        label: 'Aba de lote (arquivos brutos)',
      },
      {
        key: 'documentation',
        section: 'sections',
        label: 'Aba de documentacao',
        description: 'Organizacao dos itens',
      },
      {
        key: 'checklist',
        section: 'sections',
        label: 'Aba de checklist',
        description: 'Status consolidado',
      },
      { key: 'legalData', section: 'sections', label: 'Dados juridicos' },
      {
        key: 'history',
        section: 'sections',
        label: 'Historico de movimentacoes',
      },
    ],
  },
]

type ProfilePermissionsEditorProps = {
  value: ProfilePermissions
  onChange: (value: ProfilePermissions) => void
  disabled?: boolean
}

export function ProfilePermissionsEditor({
  value,
  onChange,
  disabled = false,
}: ProfilePermissionsEditorProps) {
  function toggle(section: PermissionSection, key: string, checked: boolean) {
    onChange({
      ...value,
      [section]: {
        ...value[section],
        [key]: checked,
      },
    })
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {permissionGroups.map((group) => {
        const Icon = group.icon
        return (
          <div
            className="rounded-lg border border-border bg-muted/20 p-3"
            key={group.label}
          >
            <div className="mb-3 flex items-center gap-2">
              <Icon className="size-4 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">
                {group.label}
              </p>
            </div>
            <div className="grid gap-2">
              {group.items.map((item) => {
                const checked = (
                  value[item.section] as Record<string, boolean>
                )[item.key]

                const id = `perm-${item.section}-${item.key}`

                return (
                  <div className="flex items-start gap-2.5" key={item.key}>
                    <Checkbox
                      checked={checked}
                      className="mt-0.5"
                      disabled={disabled}
                      id={id}
                      onCheckedChange={(c) =>
                        toggle(item.section, item.key as string, c === true)
                      }
                    />
                    <div className="grid gap-0.5">
                      <Label
                        className="cursor-pointer text-sm font-normal leading-tight"
                        htmlFor={id}
                      >
                        {item.label}
                      </Label>
                      {item.description ? (
                        <p className="text-xs text-muted-foreground">
                          {item.description}
                        </p>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
