import { Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { brazilStateOptions } from '@/features/processes/process-form.data'
import { formatZipCode } from '@/features/processes/process-form.utils'
import { AppDialog } from '@/shared/components/app-dialog'
import { FormInput, FormSelect, useZodForm } from '@/shared/components/ui/form'
import {
  type HousingComplexFormInput,
  type HousingComplexFormPayload,
  housingComplexFormSchema,
} from '../schemas/admin-housing-complex-form.schema'
import { useUpdateHousingComplex } from '../services/admin-housing-complexes.mutations'
import type { HousingComplexListItem } from '../services/admin-housing-complexes.service'
import { HousingComplexDocumentsSection } from './housing-complex-documents-section'

type EditHousingComplexDialogProps = {
  housingComplex: HousingComplexListItem
  onClose: () => void
}

export function EditHousingComplexDialog({
  housingComplex,
  onClose,
}: EditHousingComplexDialogProps) {
  const updateMutation = useUpdateHousingComplex()
  const {
    clearErrors,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useZodForm<HousingComplexFormInput, HousingComplexFormPayload>({
    defaultValues: {
      name: housingComplex.name,
      district: housingComplex.district ?? '',
      city: housingComplex.city ?? '',
      state: housingComplex.state ?? '',
      zipcode: housingComplex.zipcode ?? '',
    },
    schema: housingComplexFormSchema,
  })

  async function handleUpdate(values: HousingComplexFormPayload) {
    try {
      await updateMutation.mutateAsync({
        housingComplexId: housingComplex.id,
        payload: values,
      })
      toast.success('Conjunto atualizado com sucesso.')
      onClose()
    } catch (error) {
      setError('root', {
        message:
          error instanceof Error
            ? error.message
            : 'Nao foi possivel atualizar o conjunto.',
      })
    }
  }

  return (
    <AppDialog
      icon={Pencil}
      maxWidth="lg"
      onClose={onClose}
      open={true}
      title="Editar conjunto"
    >
      <form
        className="grid gap-4"
        noValidate
        onSubmit={handleSubmit(handleUpdate)}
      >
        <FormInput
          error={errors.name?.message}
          label="Nome"
          placeholder="Nome do conjunto"
          required
          {...register('name', {
            onChange: () => clearErrors('root'),
          })}
        />

        <div className="grid gap-4 md:grid-cols-2">
          <FormInput
            error={errors.district?.message}
            hint="Opcional"
            label="Bairro"
            placeholder="Digite o bairro padrao"
            {...register('district', {
              onChange: () => clearErrors('root'),
            })}
          />

          <FormInput
            error={errors.city?.message}
            hint="Opcional"
            label="Cidade"
            placeholder="Digite a cidade padrao"
            {...register('city', {
              onChange: () => clearErrors('root'),
            })}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <FormSelect
            error={errors.state?.message}
            hint="Opcional"
            label="UF"
            options={brazilStateOptions}
            {...register('state', {
              onChange: () => clearErrors('root'),
            })}
          />

          <FormInput
            error={errors.zipcode?.message}
            hint="Opcional"
            label="CEP"
            maxLength={9}
            placeholder="00000-000"
            {...register('zipcode', {
              onChange: (event) => {
                event.target.value = formatZipCode(event.target.value)
                clearErrors('root')
              },
            })}
          />
        </div>

        {errors.root?.message ? (
          <p className="text-sm text-destructive">{errors.root.message}</p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            disabled={isSubmitting}
            onClick={onClose}
            type="button"
            variant="outline"
          >
            Cancelar
          </Button>
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      </form>

      <HousingComplexDocumentsSection housingComplexId={housingComplex.id} />
    </AppDialog>
  )
}
