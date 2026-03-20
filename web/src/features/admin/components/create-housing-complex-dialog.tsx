import { Building2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { AppDialog } from '@/shared/components/app-dialog'
import { FormInput, useZodForm } from '@/shared/components/ui/form'
import {
  type HousingComplexFormInput,
  type HousingComplexFormPayload,
  housingComplexFormSchema,
} from '../schemas/admin-housing-complex-form.schema'
import { useCreateHousingComplex } from '../services/admin-housing-complexes.mutations'

type CreateHousingComplexDialogProps = {
  onClose: () => void
}

export function CreateHousingComplexDialog({
  onClose,
}: CreateHousingComplexDialogProps) {
  const mutation = useCreateHousingComplex()
  const {
    clearErrors,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useZodForm<HousingComplexFormInput, HousingComplexFormPayload>({
    defaultValues: { name: '' },
    schema: housingComplexFormSchema,
  })

  async function handleCreate(values: HousingComplexFormPayload) {
    try {
      const result = await mutation.mutateAsync(values)

      toast.success(result.message)
      onClose()
    } catch (error) {
      setError('root', {
        message:
          error instanceof Error
            ? error.message
            : 'Nao foi possivel criar o conjunto.',
      })
    }
  }

  return (
    <AppDialog
      icon={Building2}
      maxWidth="lg"
      onClose={onClose}
      open={true}
      title="Novo conjunto"
      description="Cadastre um novo conjunto / residencial."
    >
      <form
        className="grid gap-4"
        noValidate
        onSubmit={handleSubmit(handleCreate)}
      >
        <FormInput
          error={errors.name?.message}
          label="Nome"
          placeholder="Digite o nome do conjunto"
          required
          {...register('name', {
            onChange: () => clearErrors('root'),
          })}
        />

        {errors.root?.message ? (
          <p className="text-sm text-destructive">{errors.root.message}</p>
        ) : null}

        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button onClick={onClose} type="button" variant="ghost">
            Cancelar
          </Button>
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Criando...' : 'Criar conjunto'}
          </Button>
        </div>
      </form>
    </AppDialog>
  )
}
