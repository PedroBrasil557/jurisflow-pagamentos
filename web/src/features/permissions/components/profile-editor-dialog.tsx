import { useQuery } from '@tanstack/react-query'
import { Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { AppDialog } from '@/shared/components/app-dialog'
import { profileDetailOptions } from '../services/permissions.queries'
import { ProfileForm } from './profile-form'

type ProfileEditorDialogProps = {
  onClose: () => void
  profileId?: string
  readOnly?: boolean
}

export function ProfileEditorDialog({
  onClose,
  profileId,
  readOnly = false,
}: ProfileEditorDialogProps) {
  const profileQuery = useQuery({
    ...profileDetailOptions(profileId ?? ''),
    enabled: !!profileId,
  })

  if (!profileId) {
    return <ProfileForm onClose={onClose} />
  }

  const loadingTitle = readOnly ? 'Ver perfil' : 'Editar perfil'

  if (profileQuery.isLoading) {
    return (
      <AppDialog
        description="Carregando a configuracao atual do perfil."
        icon={ShieldCheck}
        maxWidth="lg"
        onClose={onClose}
        open={true}
        title={loadingTitle}
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span>Buscando dados do perfil...</span>
        </div>
      </AppDialog>
    )
  }

  if (profileQuery.isError || !profileQuery.data) {
    return (
      <AppDialog
        icon={ShieldCheck}
        maxWidth="lg"
        onClose={onClose}
        open={true}
        title={loadingTitle}
        variant="warning"
      >
        <div className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            Nao foi possivel carregar os dados deste perfil.
          </p>

          <div className="flex justify-end">
            <Button onClick={onClose} type="button" variant="outline">
              Fechar
            </Button>
          </div>
        </div>
      </AppDialog>
    )
  }

  return (
    <ProfileForm
      editingProfile={{
        id: profileQuery.data.id,
        name: profileQuery.data.name,
        description: profileQuery.data.description,
        permissions: profileQuery.data.permissions,
        processScope: profileQuery.data.processScope,
        housingComplexes: profileQuery.data.housingComplexes,
      }}
      onClose={onClose}
      readOnly={readOnly}
    />
  )
}
