import { Building2 } from 'lucide-react'
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
    defaultValues: {
      name: '',
      district: '',
      city: '',
      state: '',
      zipcode: '',
      vara: '',
      causeValue: '',
    },
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

        <div className="grid gap-4 md:grid-cols-2">
          <FormInput
            error={errors.vara?.message}
            hint="Usada na peticao inicial"
            label="Vara"
            placeholder="Ex: 2a Vara Civel Federal"
            {...register('vara', {
              onChange: () => clearErrors('root'),
            })}
          />

          <FormInput
            error={errors.causeValue?.message}
            hint="Valor da causa (ex: 130000,00)"
            label="Valor da causa"
            placeholder="0,00"
            {...register('causeValue', {
              onChange: () => clearErrors('root'),
            })}
          />
        </div>

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
