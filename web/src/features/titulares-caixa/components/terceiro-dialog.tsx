import { Contact, Plus, X } from 'lucide-react'
import { useFieldArray } from 'react-hook-form'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { formatWhatsapp } from '@/features/processes/process-form.utils'
import { AppDialog } from '@/shared/components/app-dialog'
import { FormInput, useZodForm } from '@/shared/components/ui/form'
import {
  type TerceiroFormInput,
  type TerceiroFormPayload,
  terceiroFormSchema,
} from '../schemas/titular-terceiro-form.schema'
import { useUpsertTerceiro } from '../services/titulares-caixa.mutations'
import type { TitularListItem } from '../services/titulares-caixa.service'

type TerceiroDialogProps = {
  titular: TitularListItem
  onClose: () => void
}

// Cadastro/edicao do terceiro vinculado ao titular (exatamente um por titular —
// salvar de novo edita). Pre-preenche a partir da propria linha da lista
// (terceiroNome/terceiroTelefones vem no payload da listagem, sem GET extra).
export function TerceiroDialog({ titular, onClose }: TerceiroDialogProps) {
  const mutation = useUpsertTerceiro()
  const {
    clearErrors,
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useZodForm<TerceiroFormInput, TerceiroFormPayload>({
    defaultValues: {
      nome: titular.terceiroNome ?? '',
      telefones: titular.terceiroTelefones?.length
        ? titular.terceiroTelefones.map((value) => ({ value }))
        : [{ value: '' }],
    },
    schema: terceiroFormSchema,
  })
  const { append, fields, remove } = useFieldArray({
    control,
    name: 'telefones',
  })

  async function handleSave(values: TerceiroFormPayload) {
    try {
      await mutation.mutateAsync({
        titularId: titular.id,
        nome: values.nome,
        telefones: values.telefones.map((telefone) => telefone.value),
      })

      toast.success('Terceiro salvo com sucesso.')
      onClose()
    } catch (error) {
      setError('root', {
        message:
          error instanceof Error
            ? error.message
            : 'Nao foi possivel salvar o terceiro.',
      })
    }
  }

  return (
    <AppDialog
      icon={Contact}
      maxWidth="lg"
      onClose={onClose}
      open={true}
      title="Terceiro"
      description={`${titular.mutuarioNome} · ${titular.empreendimento}`}
    >
      <form
        className="grid gap-4"
        noValidate
        onSubmit={handleSubmit(handleSave)}
      >
        <FormInput
          error={errors.nome?.message}
          label="Nome"
          placeholder="Digite o nome do terceiro"
          required
          {...register('nome', {
            onChange: () => clearErrors('root'),
          })}
        />

        <div className="grid gap-3">
          {fields.map((field, index) => (
            <div className="flex items-start gap-2" key={field.id}>
              <FormInput
                error={errors.telefones?.[index]?.value?.message}
                label={index === 0 ? 'Telefone' : `Telefone ${index + 1}`}
                maxLength={13}
                placeholder="11 91234-5678"
                required={index === 0}
                wrapperClassName="flex-1"
                {...register(`telefones.${index}.value`, {
                  onChange: (event) => {
                    event.target.value = formatWhatsapp(event.target.value)
                    clearErrors('root')
                  },
                })}
              />
              <Button
                aria-label="Remover telefone"
                className="mt-6"
                disabled={fields.length === 1}
                onClick={() => remove(index)}
                size="icon"
                type="button"
                variant="ghost"
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}

          <Button
            className="justify-self-start"
            onClick={() => append({ value: '' })}
            size="sm"
            type="button"
            variant="outline"
          >
            <Plus className="size-4" />
            Adicionar telefone
          </Button>
        </div>

        {errors.telefones?.root?.message || errors.telefones?.message ? (
          <p className="text-sm text-destructive">
            {errors.telefones?.root?.message ?? errors.telefones?.message}
          </p>
        ) : null}

        {errors.root?.message ? (
          <p className="text-sm text-destructive">{errors.root.message}</p>
        ) : null}

        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button onClick={onClose} type="button" variant="ghost">
            Cancelar
          </Button>
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      </form>
    </AppDialog>
  )
}
