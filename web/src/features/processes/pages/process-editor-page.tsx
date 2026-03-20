import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  getRouteApi,
  Link,
  useBlocker,
  useNavigate,
} from '@tanstack/react-router'
import { ArrowLeft, Loader2, User } from 'lucide-react'
import type { ChangeEvent } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Controller, type SubmitHandler, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { getUserRoleLabel } from '@/features/auth/auth.roles'
import { SearchableSelect } from '@/shared/components/searchable-select'
import { StatusBadge } from '@/shared/components/status-badge'
import { useZodForm } from '@/shared/components/ui/form'
import { useDebouncedValue } from '@/shared/hooks/use-debounced-value'
import { ProcessDateField } from '../components/process-form/process-date-field'
import {
  ProcessRadioGroupField,
  ProcessSelectField,
  ProcessTextAreaField,
  ProcessTextField,
} from '../components/process-form/process-form-field'
import { ProcessFormSection } from '../components/process-form/process-form-section'
import { ProcessPdfModelDialog } from '../components/process-pdf/process-pdf-model-dialog'
import { ProcessSaveSuccessDialog } from '../components/process-pdf/process-save-success-dialog'
import {
  brazilStateOptions,
  emptyProcessFormValues,
  maritalStatusOptions,
  ownerTypeOptions,
  yesNoOptions,
  yesNoUnknownOptions,
} from '../process-form.data'
import type {
  BinaryChoice,
  ProcessFormMode,
  ProcessFormValues,
} from '../process-form.types'
import {
  formatCpf,
  formatWhatsapp,
  formatZipCode,
  getWitnessOptions,
} from '../process-form.utils'
import { processFormSchema } from '../schemas/process-form.schema'
import { housingComplexOptionsInfiniteQuery } from '../services/housing-complexes.queries'
import {
  useCreateProcess,
  useUpdateProcess,
} from '../services/processes.mutations'
import {
  processDetailOptions,
  userOptionsInfiniteQuery,
} from '../services/processes.queries'
import {
  generateProcessPdfRequest,
  getProcessPdfModelsRequest,
  type ProcessPdfModelOption,
} from '../services/processes.service'

const protectedRouteApi = getRouteApi('/_protected')

type ProcessFormShellProps = {
  mode: ProcessFormMode
  processId?: string
}

type ProcessSaveSuccessState = {
  processId: string
  processName: string
}

export function NewProcessPage() {
  return <ProcessFormShell mode="create" />
}

export function EditProcessPage({ processId }: { processId: string }) {
  return <ProcessFormShell mode="edit" processId={processId} />
}

function ProcessFormShell({ mode, processId }: ProcessFormShellProps) {
  const { user } = protectedRouteApi.useRouteContext()
  const navigate = useNavigate()

  const [witnessSearch, setWitnessSearch] = useState('')
  const debouncedWitnessSearch = useDebouncedValue(witnessSearch, {
    delay: 300,
  })
  const [hcSearch, setHcSearch] = useState('')
  const debouncedHcSearch = useDebouncedValue(hcSearch, { delay: 300 })

  const witnessQ = useInfiniteQuery(
    userOptionsInfiniteQuery(debouncedWitnessSearch),
  )
  const hcQ = useInfiniteQuery(
    housingComplexOptionsInfiniteQuery(debouncedHcSearch),
  )
  const detailQ = useQuery({
    ...processDetailOptions(processId ?? ''),
    enabled: mode === 'edit' && !!processId,
  })

  const allWitnessUsers = useMemo(
    () => witnessQ.data?.pages.flatMap((p) => p.witnessUsers) ?? [],
    [witnessQ.data],
  )
  const allHousingComplexes = useMemo(
    () => hcQ.data?.pages.flatMap((p) => p.items) ?? [],
    [hcQ.data],
  )
  const draft = detailQ.data?.draft

  const initialValues = useMemo(
    () => draft?.values ?? { ...emptyProcessFormValues },
    [draft],
  )
  const [successState, setSuccessState] =
    useState<ProcessSaveSuccessState | null>(null)
  const [isPdfModelDialogOpen, setIsPdfModelDialogOpen] = useState(false)
  const [isLoadingPdfModels, setIsLoadingPdfModels] = useState(false)
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false)
  const [pdfModels, setPdfModels] = useState<readonly ProcessPdfModelOption[]>(
    [],
  )
  const [pdfModelError, setPdfModelError] = useState('')
  const [selectedPdfModelKey, setSelectedPdfModelKey] = useState<
    ProcessPdfModelOption['key'] | null
  >(null)

  const createMutation = useCreateProcess()
  const updateMutation = useUpdateProcess(processId ?? '')

  const {
    control,
    formState: { errors, isDirty, isSubmitted, isSubmitting },
    handleSubmit,
    register,
    reset,
    setValue,
  } = useZodForm<ProcessFormValues>({
    defaultValues: initialValues,
    schema: processFormSchema,
  })
  const watchedValues = useWatch({ control })
  const values = (watchedValues ?? initialValues) as ProcessFormValues
  const witness1Options = getWitnessOptions(allWitnessUsers, values.witness2Id)
  const witness2Options = getWitnessOptions(allWitnessUsers, values.witness1Id)
  useEffect(() => {
    reset(initialValues)
  }, [initialValues, reset])

  const shouldBlock = isDirty && !isSubmitting && !successState
  useBlocker({
    shouldBlockFn: () => shouldBlock,
    enableBeforeUnload: () => shouldBlock,
    disabled: !shouldBlock,
  })

  useEffect(() => {
    if (
      values.deliveredMoreThanTenYears !== 'sim' &&
      values.purchaseAgreementLessThanTenYears
    ) {
      setValue('purchaseAgreementLessThanTenYears', '', {
        shouldDirty: true,
        shouldValidate: isSubmitted,
      })
    }
  }, [
    isSubmitted,
    setValue,
    values.deliveredMoreThanTenYears,
    values.purchaseAgreementLessThanTenYears,
  ])

  function updateValue<FieldName extends keyof ProcessFormValues>(
    fieldName: FieldName,
    nextValue: ProcessFormValues[FieldName],
  ) {
    setValue(fieldName as never, nextValue as never, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: isSubmitted,
    })
  }

  function handleTextChange<FieldName extends keyof ProcessFormValues>(
    fieldName: FieldName,
  ) {
    return (
      event: ChangeEvent<HTMLInputElement> | ChangeEvent<HTMLTextAreaElement>,
    ) => {
      let nextValue = event.target.value

      if (fieldName === 'cpf') {
        nextValue = formatCpf(nextValue)
      } else if (fieldName === 'zipcode') {
        nextValue = formatZipCode(nextValue)
      } else if (fieldName === 'whatsapp') {
        nextValue = formatWhatsapp(nextValue)
      } else if (fieldName === 'email') {
        // email nao converte para maiusculo
      } else {
        nextValue = nextValue.toUpperCase()
      }

      if (fieldName === 'observation') {
        nextValue = nextValue.slice(0, 500)
      }

      updateValue(fieldName, nextValue as ProcessFormValues[FieldName])
    }
  }

  function handleSelectChange<FieldName extends keyof ProcessFormValues>(
    fieldName: FieldName,
  ) {
    return (event: ChangeEvent<HTMLSelectElement>) => {
      const nextValue = event.target.value as ProcessFormValues[FieldName]

      updateValue(fieldName, nextValue)
    }
  }

  function handleBinaryChoiceChange(
    fieldName:
      | 'deliveredMoreThanTenYears'
      | 'purchaseAgreementLessThanTenYears',
  ) {
    return (nextValue: BinaryChoice) => {
      if (fieldName === 'deliveredMoreThanTenYears') {
        updateValue(fieldName, nextValue)

        if (nextValue !== 'sim') {
          updateValue('purchaseAgreementLessThanTenYears', '')
        }

        return
      }

      updateValue(fieldName, nextValue)
    }
  }

  function handleReset() {
    reset(initialValues)
  }

  async function handleCompleteSuccessFlow() {
    setSuccessState(null)
    setIsPdfModelDialogOpen(false)
    setIsLoadingPdfModels(false)
    setIsGeneratingPdf(false)
    setPdfModelError('')
    setPdfModels([])
    setSelectedPdfModelKey(null)

    await navigate({ to: '/processos' })
  }

  async function handleOpenPdfModelDialog() {
    if (!successState) {
      return
    }

    setIsPdfModelDialogOpen(true)
    setIsLoadingPdfModels(true)
    setPdfModelError('')
    setSelectedPdfModelKey(null)

    try {
      const result = await getProcessPdfModelsRequest(successState.processId)

      setPdfModels(result.items)
    } catch (error) {
      setPdfModels([])
      setPdfModelError(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel carregar os modelos de PDF.',
      )
    } finally {
      setIsLoadingPdfModels(false)
    }
  }

  function handleClosePdfModelDialog() {
    setIsPdfModelDialogOpen(false)
    setIsLoadingPdfModels(false)
    setIsGeneratingPdf(false)
    setPdfModelError('')
    setSelectedPdfModelKey(null)
  }

  function openGeneratedPdf(downloadUrl: string) {
    const link = document.createElement('a')

    link.href = downloadUrl
    link.rel = 'noopener noreferrer'
    link.target = '_blank'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  async function handleGeneratePdf(modelKey: ProcessPdfModelOption['key']) {
    if (!successState) {
      return
    }

    setIsGeneratingPdf(true)
    setSelectedPdfModelKey(modelKey)
    setPdfModelError('')

    try {
      const result = await generateProcessPdfRequest({
        processId: successState.processId,
        modelKey,
      })

      openGeneratedPdf(result.document.downloadUrl)
      toast.success(result.message)
      handleClosePdfModelDialog()
    } catch (error) {
      setPdfModelError(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel gerar o PDF.',
      )
    } finally {
      setIsGeneratingPdf(false)
    }
  }

  const handleProcessSubmit: SubmitHandler<ProcessFormValues> = async (
    values,
  ) => {
    try {
      if (mode === 'create') {
        const result = await createMutation.mutateAsync(values)

        setSuccessState({
          processId: result.process.id,
          processName: result.process.fullName,
        })

        return
      }

      if (!processId) {
        throw new Error('PROCESSO NAO ENCONTRADO PARA EDICAO.')
      }

      const result = await updateMutation.mutateAsync(values)

      reset(values)
      setSuccessState({
        processId: result.process.id,
        processName: result.process.fullName,
      })
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel salvar o processo.',
      )
    }
  }

  const housingComplexSelectOptions = useMemo(
    () =>
      allHousingComplexes.map((item) => ({
        value: item.name,
        label: item.name,
      })),
    [allHousingComplexes],
  )

  const witness1SelectOptions = useMemo(
    () =>
      witness1Options.map((u) => ({
        value: u.id,
        label: u.label,
        description: u.cpf,
      })),
    [witness1Options],
  )

  const witness2SelectOptions = useMemo(
    () =>
      witness2Options.map((u) => ({
        value: u.id,
        label: u.label,
        description: u.cpf,
      })),
    [witness2Options],
  )

  const handleWitnessSearchChange = useCallback(
    (search: string) => setWitnessSearch(search),
    [],
  )

  const handleHcSearchChange = useCallback(
    (search: string) => setHcSearch(search),
    [],
  )

  const isLoading = mode === 'edit' && detailQ.isLoading

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const title = mode === 'create' ? 'Novo processo' : 'Editar processo'
  const submitLabel = mode === 'create' ? 'Criar processo' : 'Salvar alteracoes'

  function getRoleTone(role: string) {
    switch (role) {
      case 'admin':
        return 'error' as const
      case 'attorney':
        return 'info' as const
      default:
        return 'ghost' as const
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>

          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-2.5">
            <User className="size-4 text-muted-foreground" />
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Operador:</span>
              <span className="text-sm font-medium text-foreground">
                {user.name}
              </span>
              <StatusBadge tone={getRoleTone(user.role)}>
                {getUserRoleLabel(user.role)}
              </StatusBadge>
            </div>
          </div>
        </div>

        <div className="mt-3">
          <Link className="no-underline" to="/processos">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="size-4" />
              Voltar para processos
            </Button>
          </Link>
        </div>
      </div>

      <form
        className="grid gap-6"
        noValidate
        onSubmit={handleSubmit(handleProcessSubmit)}
      >
        <ProcessFormSection title="Dados pessoais">
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            <div className="md:col-span-2">
              <ProcessTextField
                {...register('fullName')}
                error={errors.fullName?.message}
                label="Nome completo"
                onChange={handleTextChange('fullName')}
                placeholder="Digite o nome completo"
                required
                value={values.fullName}
              />
            </div>

            <ProcessDateField
              error={errors.birthDate?.message}
              label="Data de nascimento"
              onChange={(v) => updateValue('birthDate', v)}
              required
              value={values.birthDate}
            />

            <ProcessTextField
              {...register('nationality')}
              error={errors.nationality?.message}
              label="Nacionalidade"
              onChange={handleTextChange('nationality')}
              readOnly
              required
              value={values.nationality}
            />

            <ProcessSelectField
              {...register('maritalStatus')}
              error={errors.maritalStatus?.message}
              label="Estado civil"
              onChange={handleSelectChange('maritalStatus')}
              options={maritalStatusOptions}
              value={values.maritalStatus}
            />

            <ProcessTextField
              {...register('profession')}
              error={errors.profession?.message}
              label="Profissao"
              onChange={handleTextChange('profession')}
              placeholder="Digite a profissao"
              value={values.profession}
            />
          </div>
        </ProcessFormSection>

        <ProcessFormSection title="Documentacao">
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            <div className="md:col-span-2 lg:col-span-3">
              <ProcessSelectField
                {...register('ownerType')}
                error={errors.ownerType?.message}
                label="Proprietario (tipo)"
                onChange={handleSelectChange('ownerType')}
                options={ownerTypeOptions}
                required
                value={values.ownerType}
              />
            </div>

            <ProcessTextField
              {...register('cpf')}
              error={errors.cpf?.message}
              label="CPF"
              maxLength={14}
              onChange={handleTextChange('cpf')}
              placeholder="000.000.000-00"
              required
              value={values.cpf}
            />

            <ProcessTextField
              {...register('rg')}
              error={errors.rg?.message}
              label="RG"
              onChange={handleTextChange('rg')}
              placeholder="00.000.000-0"
              required
              value={values.rg}
            />

            <ProcessSelectField
              {...register('cadunico')}
              error={errors.cadunico?.message}
              label="CadUnico"
              onChange={handleSelectChange('cadunico')}
              options={yesNoOptions}
              value={values.cadunico}
            />

            <div className="md:col-span-2 lg:col-span-3">
              <div className="grid gap-5 rounded-[26px] border border-border/50 bg-muted/30 p-4">
                <div className="max-w-3xl">
                  <ProcessSelectField
                    {...register('propertyPaidOff')}
                    error={errors.propertyPaidOff?.message}
                    label="O imovel e quitado?"
                    onChange={handleSelectChange('propertyPaidOff')}
                    options={yesNoUnknownOptions}
                    value={values.propertyPaidOff}
                  />

                  {values.propertyPaidOff === 'sim' ? (
                    <div className="mt-3 rounded-[20px] border border-amber-500/25 bg-amber-500/12 px-4 py-3">
                      <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
                        Falta documento de quitacao
                      </span>
                    </div>
                  ) : null}
                </div>

                <div
                  className={`grid gap-5 border-t border-border/50 pt-5 ${values.deliveredMoreThanTenYears === 'sim' ? 'lg:grid-cols-2' : ''}`}
                >
                  <Controller
                    control={control}
                    name="deliveredMoreThanTenYears"
                    render={() => (
                      <ProcessRadioGroupField
                        error={errors.deliveredMoreThanTenYears?.message}
                        label="O imovel foi entregue ha mais de 10 anos?"
                        onChange={handleBinaryChoiceChange(
                          'deliveredMoreThanTenYears',
                        )}
                        options={[
                          { label: 'Sim', value: 'sim' },
                          { label: 'Nao', value: 'nao' },
                        ]}
                        value={values.deliveredMoreThanTenYears}
                      />
                    )}
                  />

                  {values.deliveredMoreThanTenYears === 'sim' ? (
                    <Controller
                      control={control}
                      name="purchaseAgreementLessThanTenYears"
                      render={() => (
                        <ProcessRadioGroupField
                          error={
                            errors.purchaseAgreementLessThanTenYears?.message
                          }
                          label="O contrato de compra e venda foi celebrado ha menos de 10 anos?"
                          onChange={handleBinaryChoiceChange(
                            'purchaseAgreementLessThanTenYears',
                          )}
                          options={[
                            { label: 'Sim', value: 'sim' },
                            { label: 'Nao', value: 'nao' },
                          ]}
                          value={values.purchaseAgreementLessThanTenYears}
                        />
                      )}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </ProcessFormSection>

        <ProcessFormSection title="Endereco">
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            <ProcessSelectField
              {...register('state')}
              error={errors.state?.message}
              label="UF"
              onChange={handleSelectChange('state')}
              options={brazilStateOptions}
              value={values.state}
            />

            <div className="lg:col-span-2">
              <ProcessTextField
                {...register('city')}
                error={errors.city?.message}
                label="Cidade"
                onChange={handleTextChange('city')}
                placeholder="Digite a cidade"
                required
                value={values.city}
              />
            </div>

            <ProcessTextField
              {...register('district')}
              error={errors.district?.message}
              label="Bairro"
              onChange={handleTextChange('district')}
              placeholder="Selecione ou digite o bairro"
              required
              value={values.district}
            />

            <div className="lg:col-span-2">
              <SearchableSelect
                error={errors.housingComplex?.message}
                hasNextPage={hcQ.hasNextPage}
                isLoading={hcQ.isFetchingNextPage}
                label="Conjunto / Residencial"
                onChange={(v) => updateValue('housingComplex', v)}
                onLoadMore={() => hcQ.fetchNextPage()}
                onSearchChange={handleHcSearchChange}
                options={housingComplexSelectOptions}
                placeholder="Selecione o conjunto..."
                required
                searchPlaceholder="Buscar conjunto..."
                value={values.housingComplex}
              />
            </div>

            <div className="lg:col-span-2">
              <ProcessTextField
                {...register('street')}
                error={errors.street?.message}
                label="Rua / Logradouro"
                onChange={handleTextChange('street')}
                placeholder="Digite o logradouro"
                required
                value={values.street}
              />
            </div>

            <ProcessTextField
              {...register('number')}
              error={errors.number?.message}
              label="Numero"
              onChange={handleTextChange('number')}
              placeholder="Digite o numero"
              value={values.number}
            />

            <div className="lg:col-span-2">
              <ProcessTextField
                {...register('complement')}
                error={errors.complement?.message}
                label="Complemento"
                onChange={handleTextChange('complement')}
                placeholder="Apartamento, bloco ou referencia"
                value={values.complement}
              />
            </div>

            <div className="lg:col-span-2">
              <ProcessTextField
                {...register('zipcode')}
                error={errors.zipcode?.message}
                label="CEP"
                maxLength={9}
                onChange={handleTextChange('zipcode')}
                placeholder="00000-000"
                required
                value={values.zipcode}
              />
            </div>
          </div>
        </ProcessFormSection>

        <ProcessFormSection title="Contato">
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <ProcessTextField
                {...register('email')}
                error={errors.email?.message}
                label="E-mail"
                onChange={handleTextChange('email')}
                placeholder="Digite o e-mail principal"
                type="email"
                value={values.email}
              />
            </div>

            <div className="lg:col-span-2">
              <ProcessTextField
                {...register('whatsapp')}
                error={errors.whatsapp?.message}
                label="Whatsapp"
                maxLength={13}
                onChange={handleTextChange('whatsapp')}
                placeholder="00 00000-0000"
                value={values.whatsapp}
              />
            </div>
          </div>
        </ProcessFormSection>

        <ProcessFormSection title="Testemunhas">
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            <div className="lg:col-span-2">
              <SearchableSelect
                error={errors.witness1Id?.message}
                hasNextPage={witnessQ.hasNextPage}
                isLoading={witnessQ.isFetchingNextPage}
                label="Selecionar testemunha 1"
                onChange={(v) => updateValue('witness1Id', v)}
                onLoadMore={() => witnessQ.fetchNextPage()}
                onSearchChange={handleWitnessSearchChange}
                options={witness1SelectOptions}
                placeholder="Selecione..."
                required
                searchPlaceholder="Buscar por nome ou CPF..."
                value={values.witness1Id}
              />
            </div>

            <div className="lg:col-span-2">
              <SearchableSelect
                error={errors.witness2Id?.message}
                hasNextPage={witnessQ.hasNextPage}
                isLoading={witnessQ.isFetchingNextPage}
                label="Selecionar testemunha 2"
                onChange={(v) => updateValue('witness2Id', v)}
                onLoadMore={() => witnessQ.fetchNextPage()}
                onSearchChange={handleWitnessSearchChange}
                options={witness2SelectOptions}
                placeholder="Selecione..."
                required
                searchPlaceholder="Buscar por nome ou CPF..."
                value={values.witness2Id}
              />
            </div>
          </div>
        </ProcessFormSection>

        <ProcessFormSection title="Observacao">
          <div className="grid gap-4">
            <ProcessTextAreaField
              {...register('observation')}
              error={errors.observation?.message}
              hint="Limite de 500 caracteres para a primeira versao."
              label="Observacao"
              maxLength={500}
              onChange={handleTextChange('observation')}
              placeholder="Digite aqui alguma observacao sobre o processo..."
              rows={5}
              value={values.observation}
            />

            <div className="flex justify-end">
              <span className="text-xs font-medium text-muted-foreground">
                {values.observation.length}/500
              </span>
            </div>
          </div>
        </ProcessFormSection>

        <div className="sticky bottom-0 -mx-4 border-t border-border bg-background/95 px-4 py-4 backdrop-blur-sm sm:-mx-6 sm:px-6 xl:-mx-8 xl:px-8">
          <div className="mx-auto flex max-w-5xl items-center justify-between">
            <button
              className="text-sm text-muted-foreground hover:text-foreground"
              disabled={isSubmitting}
              onClick={handleReset}
              type="button"
            >
              Restaurar campos
            </button>
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting ? 'Salvando...' : submitLabel}
            </Button>
          </div>
        </div>
      </form>

      {successState && !isPdfModelDialogOpen ? (
        <ProcessSaveSuccessDialog
          isBusy={isLoadingPdfModels || isGeneratingPdf}
          mode={mode}
          onClose={handleCompleteSuccessFlow}
          onComplete={handleCompleteSuccessFlow}
          onGeneratePdf={handleOpenPdfModelDialog}
          processName={successState.processName}
        />
      ) : null}

      {successState && isPdfModelDialogOpen ? (
        <ProcessPdfModelDialog
          errorMessage={pdfModelError}
          isGenerating={isGeneratingPdf}
          isLoading={isLoadingPdfModels}
          models={pdfModels}
          onCancel={handleClosePdfModelDialog}
          onSelect={handleGeneratePdf}
          selectedModelKey={selectedPdfModelKey}
        />
      ) : null}
    </div>
  )
}
