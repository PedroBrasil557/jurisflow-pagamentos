import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link, useBlocker, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Loader2, Sparkles, User } from 'lucide-react'
import type { ChangeEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type SubmitHandler, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { getUserRoleLabel } from '@/features/auth/auth.roles'
import { useSession } from '@/features/auth/hooks/use-session'
import { SearchableSelect } from '@/shared/components/searchable-select'
import { StatusBadge } from '@/shared/components/status-badge'
import { useZodForm } from '@/shared/components/ui/form'
import { useDebouncedValue } from '@/shared/hooks/use-debounced-value'
import { downloadFile } from '@/shared/lib/download'
import { ProcessDocumentationAssignee } from '../components/process-documentation-assignee'
import { ProcessDateField } from '../components/process-form/process-date-field'
import {
  ProcessRadioGroupField,
  ProcessSelectField,
  ProcessTextAreaField,
  ProcessTextField,
} from '../components/process-form/process-form-field'
import { ProcessFormSection } from '../components/process-form/process-form-section'
import { ImportFromDocumentDialog } from '../components/process-import/import-from-document-dialog'
import { ProcessSaveSuccessDialog } from '../components/process-pdf/process-save-success-dialog'
import { buildProcessRelationship, canEditProcess } from '../lib/process-access'
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
import { formatCpf, formatWhatsapp, formatZipCode } from '../process-form.utils'
import { processFormSchema } from '../schemas/process-form.schema'
import type {
  ExtractedDocument,
  ExtractedField,
} from '../services/extraction.service'
import { importBundleRequest } from '../services/extraction.service'
import { housingComplexOptionsInfiniteQuery } from '../services/housing-complexes.queries'
import {
  useCreateProcess,
  useUpdateProcess,
} from '../services/processes.mutations'
import { processDetailOptions } from '../services/processes.queries'
import {
  generateProcessPdfRequest,
  getProcessPdfModelsRequest,
} from '../services/processes.service'

type ImportedBundle = {
  file: File | null
  documents: ExtractedDocument[]
}

const emptyImportedBundle: ImportedBundle = {
  file: null,
  documents: [],
}

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
  const { permissions, user } = useSession()
  const navigate = useNavigate()

  const [hcSearch, setHcSearch] = useState('')
  const debouncedHcSearch = useDebouncedValue(hcSearch, { delay: 300 })

  const hcQ = useInfiniteQuery(
    housingComplexOptionsInfiniteQuery(debouncedHcSearch),
  )
  const detailQ = useQuery({
    ...processDetailOptions(processId ?? ''),
    enabled: mode === 'edit' && !!processId,
  })

  const allHousingComplexes = useMemo(
    () => hcQ.data?.pages.flatMap((p) => p.items) ?? [],
    [hcQ.data],
  )
  const draft = detailQ.data?.draft
  const detailProcess = detailQ.data?.process
  const isReadOnly = useMemo(() => {
    if (mode === 'create') return false
    if (!detailProcess) return false
    const relationship = buildProcessRelationship({
      process: detailProcess,
      userId: user.id,
      permissions,
    })
    return !canEditProcess(permissions, relationship)
  }, [mode, detailProcess, user.id, permissions])

  const initialValues = useMemo(() => {
    if (draft?.values) {
      return draft.values
    }

    return emptyProcessFormValues
  }, [draft])
  const [successState, setSuccessState] =
    useState<ProcessSaveSuccessState | null>(null)
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false)
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
  const importedBundleRef = useRef<ImportedBundle>(emptyImportedBundle)

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
  useEffect(() => {
    reset(initialValues)
  }, [initialValues, reset])

  const shouldBlock = isDirty && !isSubmitting && !successState
  useBlocker({
    shouldBlockFn: () => {
      if (!shouldBlock) {
        return false
      }

      return !window.confirm(
        'Existem alteracoes nao salvas. Deseja sair sem salvar?',
      )
    },
    enableBeforeUnload: () => shouldBlock,
    disabled: !shouldBlock,
  })

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

      if (fieldName === 'cpf' || fieldName === 'spouseCpf') {
        nextValue = formatCpf(nextValue)
      } else if (fieldName === 'zipcode' || fieldName === 'spouseZipcode') {
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

  function handleReset() {
    reset(initialValues)
  }

  async function handleCompleteSuccessFlow() {
    setSuccessState(null)
    setIsGeneratingPdf(false)

    await navigate({ to: '/processos' })
  }

  async function handleGeneratePdf() {
    if (!successState) {
      return
    }

    setIsGeneratingPdf(true)

    try {
      const models = await getProcessPdfModelsRequest(successState.processId)
      const firstModel = models.items[0]

      if (!firstModel) {
        toast.error('Nenhum modelo de PDF disponivel.')
        return
      }

      const result = await generateProcessPdfRequest({
        processId: successState.processId,
        modelKey: firstModel.key,
      })

      await downloadFile(result.document.downloadUrl, result.document.fileName)
      toast.success('PDF gerado com sucesso.')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel gerar o PDF.',
      )
    } finally {
      setIsGeneratingPdf(false)
    }
  }

  function handleImportApply(
    fields: ExtractedField[],
    file: File,
    documents: ExtractedDocument[],
  ) {
    for (const field of fields) {
      updateValue(field.key as keyof ProcessFormValues, field.value as never)
    }

    importedBundleRef.current = { file, documents }

    toast.success(
      documents.length > 0
        ? 'Dados aplicados. Os documentos serao separados e anexados ao checklist apos criar o processo.'
        : 'Dados aplicados ao formulario.',
    )
  }

  const handleProcessSubmit: SubmitHandler<ProcessFormValues> = async (
    values,
  ) => {
    try {
      if (mode === 'create') {
        const result = await createMutation.mutateAsync(values)

        const bundle = importedBundleRef.current
        if (bundle.file && bundle.documents.length > 0) {
          try {
            await importBundleRequest({
              processId: result.process.id,
              file: bundle.file,
              documents: bundle.documents,
            })
            // So limpa o bundle apos anexar com sucesso.
            importedBundleRef.current = emptyImportedBundle
          } catch (error) {
            // Mantem o bundle (nao limpa) e mostra o motivo real do backend.
            toast.error(
              error instanceof Error
                ? `${error.message} Voce pode anexa-los manualmente no checklist do processo.`
                : 'Processo criado, mas nao foi possivel anexar os documentos. Anexe-os manualmente no checklist.',
            )
          }
        } else {
          importedBundleRef.current = emptyImportedBundle
        }

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
  const housingComplexDefaultsByName = useMemo(
    () =>
      new Map(
        allHousingComplexes.map((item) => [
          item.name,
          {
            district: item.district,
            city: item.city,
            state: item.state,
            zipcode: item.zipcode,
          },
        ]),
      ),
    [allHousingComplexes],
  )

  const handleHcSearchChange = useCallback(
    (search: string) => setHcSearch(search),
    [],
  )

  function handleHousingComplexChange(value: string) {
    updateValue('housingComplex', value)

    const defaults = housingComplexDefaultsByName.get(value)
    if (defaults) {
      if (defaults.district) {
        updateValue('district', defaults.district)
      }
      if (defaults.city) {
        updateValue('city', defaults.city)
      }
      if (defaults.state) {
        updateValue('state', defaults.state)
      }
      if (defaults.zipcode) {
        updateValue('zipcode', defaults.zipcode)
      }
    }
  }

  const isLoading = mode === 'edit' && detailQ.isLoading

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const title = isReadOnly
    ? 'Detalhes do processo'
    : mode === 'create'
      ? 'Novo processo'
      : 'Editar processo'
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
          <Link className="no-underline" preload={false} to="/processos">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="size-4" />
              Voltar
            </Button>
          </Link>
        </div>
      </div>

      {mode === 'edit' &&
      processId &&
      user.role === 'admin' &&
      detailQ.data?.process &&
      detailQ.data.process.status !== 'FINALIZADO' &&
      detailQ.data.process.status !== 'CANCELADO' ? (
        <div className="mb-6">
          <ProcessDocumentationAssignee
            currentAssigneeId={detailQ.data.process.documentationAssigneeId}
            currentAssigneeName={
              detailQ.data.process.documentationAssigneeName ?? null
            }
            processId={processId}
          />
        </div>
      ) : null}

      {isReadOnly ? (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          Voce esta visualizando este processo em modo somente leitura.
        </div>
      ) : null}

      {mode === 'create' && !isReadOnly ? (
        <div className="mb-6 flex flex-col gap-3 rounded-lg border border-blue-500/30 bg-blue-500/5 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 size-5 shrink-0 text-blue-500" />
            <div className="grid gap-0.5">
              <span className="text-sm font-medium text-foreground">
                Preencher a partir de documentos
              </span>
              <span className="text-xs text-muted-foreground">
                Envie RG/CNH e comprovante de endereco para preencher o cadastro
                automaticamente com IA.
              </span>
            </div>
          </div>
          <Button
            className="shrink-0"
            onClick={() => setIsImportDialogOpen(true)}
            type="button"
            variant="outline"
          >
            <Sparkles className="size-4" />
            Importar de documentos
          </Button>
        </div>
      ) : null}

      <form
        className="grid gap-6"
        noValidate
        onSubmit={handleSubmit(handleProcessSubmit)}
      >
        <fieldset className="contents" disabled={isReadOnly}>
          <ProcessFormSection title="Tipo de proprietario">
            <ProcessSelectField
              {...register('ownerType')}
              error={errors.ownerType?.message}
              label="Proprietario (tipo)"
              onChange={handleSelectChange('ownerType')}
              options={ownerTypeOptions}
              required
              value={values.ownerType}
            />
          </ProcessFormSection>

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
            </div>
          </ProcessFormSection>

          <ProcessFormSection title="Endereco">
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              <div className="lg:col-span-3">
                <SearchableSelect
                  error={errors.housingComplex?.message}
                  hasNextPage={hcQ.hasNextPage}
                  isLoading={hcQ.isFetchingNextPage}
                  label="Conjunto / Residencial"
                  onChange={handleHousingComplexChange}
                  onLoadMore={() => hcQ.fetchNextPage()}
                  onSearchChange={handleHcSearchChange}
                  options={housingComplexSelectOptions}
                  placeholder="Selecione o conjunto..."
                  required
                  searchPlaceholder="Buscar conjunto..."
                  value={values.housingComplex}
                />
              </div>

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

              <div className="lg:col-span-3">
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
            </div>
          </ProcessFormSection>

          <ProcessFormSection title="Documentacao">
            <div className="grid gap-5">
              <div className="max-w-xl">
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

              {values.ownerType !== '' ? (
                <ProcessRadioGroupField
                  error={errors.spouseContractSigned?.message}
                  label={
                    values.ownerType === 'titular_contrato_caixa'
                      ? 'Contrato com a caixa assinado junto com o conjuge?'
                      : 'Contrato de compra e venda assinado junto com o conjuge?'
                  }
                  onChange={(v) => updateValue('spouseContractSigned', v)}
                  options={[
                    { label: 'Sim', value: 'sim' },
                    { label: 'Nao', value: 'nao' },
                  ]}
                  value={values.spouseContractSigned}
                />
              ) : null}
            </div>
          </ProcessFormSection>

          {values.spouseContractSigned === 'sim' ? (
            <>
              <ProcessFormSection title="Dados do conjuge">
                <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                  <div className="md:col-span-2">
                    <ProcessTextField
                      {...register('spouseFullName')}
                      error={errors.spouseFullName?.message}
                      label="Nome completo do conjuge"
                      onChange={handleTextChange('spouseFullName')}
                      placeholder="Digite o nome completo"
                      value={values.spouseFullName}
                    />
                  </div>

                  <ProcessDateField
                    error={errors.spouseBirthDate?.message}
                    label="Data de nascimento"
                    onChange={(v) => updateValue('spouseBirthDate', v)}
                    value={values.spouseBirthDate}
                  />

                  <ProcessTextField
                    {...register('spouseNationality')}
                    error={errors.spouseNationality?.message}
                    label="Nacionalidade"
                    onChange={handleTextChange('spouseNationality')}
                    readOnly
                    value={values.spouseNationality}
                  />

                  <ProcessSelectField
                    {...register('spouseMaritalStatus')}
                    error={errors.spouseMaritalStatus?.message}
                    label="Estado civil"
                    onChange={handleSelectChange('spouseMaritalStatus')}
                    options={maritalStatusOptions}
                    value={values.spouseMaritalStatus}
                  />

                  <ProcessTextField
                    {...register('spouseProfession')}
                    error={errors.spouseProfession?.message}
                    label="Profissao"
                    onChange={handleTextChange('spouseProfession')}
                    placeholder="Digite a profissao"
                    value={values.spouseProfession}
                  />

                  <ProcessTextField
                    {...register('spouseCpf')}
                    error={errors.spouseCpf?.message}
                    label="CPF"
                    maxLength={14}
                    onChange={handleTextChange('spouseCpf')}
                    placeholder="000.000.000-00"
                    value={values.spouseCpf}
                  />

                  <ProcessTextField
                    {...register('spouseRg')}
                    error={errors.spouseRg?.message}
                    label="RG"
                    onChange={handleTextChange('spouseRg')}
                    placeholder="00.000.000-0"
                    value={values.spouseRg}
                  />

                  <ProcessSelectField
                    {...register('spouseCadunico')}
                    error={errors.spouseCadunico?.message}
                    label="CadUnico"
                    onChange={handleSelectChange('spouseCadunico')}
                    options={yesNoOptions}
                    value={values.spouseCadunico}
                  />
                </div>
              </ProcessFormSection>

              <ProcessFormSection title="Endereco do conjuge">
                <div className="grid gap-5">
                  <ProcessRadioGroupField
                    error={errors.spouseSameAddress?.message}
                    label="Mesmo endereco do titular?"
                    onChange={(nextValue: BinaryChoice) => {
                      updateValue('spouseSameAddress', nextValue)

                      if (nextValue === 'sim') {
                        updateValue('spouseState', values.state)
                        updateValue('spouseCity', values.city)
                        updateValue('spouseDistrict', values.district)
                        updateValue(
                          'spouseHousingComplex',
                          values.housingComplex,
                        )
                        updateValue('spouseStreet', values.street)
                        updateValue('spouseNumber', values.number)
                        updateValue('spouseComplement', values.complement)
                        updateValue('spouseZipcode', values.zipcode)
                      }
                    }}
                    options={[
                      { label: 'Sim', value: 'sim' },
                      { label: 'Nao', value: 'nao' },
                    ]}
                    value={values.spouseSameAddress}
                  />

                  <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
                    <div className="lg:col-span-3">
                      <ProcessTextField
                        {...register('spouseHousingComplex')}
                        error={errors.spouseHousingComplex?.message}
                        label="Conjunto / Residencial"
                        onChange={handleTextChange('spouseHousingComplex')}
                        placeholder="Digite o conjunto"
                        disabled={values.spouseSameAddress === 'sim'}
                        value={values.spouseHousingComplex}
                      />
                    </div>

                    <ProcessTextField
                      {...register('spouseZipcode')}
                      error={errors.spouseZipcode?.message}
                      label="CEP"
                      maxLength={9}
                      onChange={handleTextChange('spouseZipcode')}
                      placeholder="00000-000"
                      disabled={values.spouseSameAddress === 'sim'}
                      value={values.spouseZipcode}
                    />

                    <ProcessSelectField
                      {...register('spouseState')}
                      error={errors.spouseState?.message}
                      label="UF"
                      onChange={handleSelectChange('spouseState')}
                      options={brazilStateOptions}
                      disabled={values.spouseSameAddress === 'sim'}
                      value={values.spouseState}
                    />

                    <div className="lg:col-span-2">
                      <ProcessTextField
                        {...register('spouseCity')}
                        error={errors.spouseCity?.message}
                        label="Cidade"
                        onChange={handleTextChange('spouseCity')}
                        placeholder="Digite a cidade"
                        disabled={values.spouseSameAddress === 'sim'}
                        value={values.spouseCity}
                      />
                    </div>

                    <ProcessTextField
                      {...register('spouseDistrict')}
                      error={errors.spouseDistrict?.message}
                      label="Bairro"
                      onChange={handleTextChange('spouseDistrict')}
                      placeholder="Digite o bairro"
                      disabled={values.spouseSameAddress === 'sim'}
                      value={values.spouseDistrict}
                    />

                    <div className="lg:col-span-3">
                      <ProcessTextField
                        {...register('spouseStreet')}
                        error={errors.spouseStreet?.message}
                        label="Rua / Logradouro"
                        onChange={handleTextChange('spouseStreet')}
                        placeholder="Digite o logradouro"
                        disabled={values.spouseSameAddress === 'sim'}
                        value={values.spouseStreet}
                      />
                    </div>

                    <ProcessTextField
                      {...register('spouseNumber')}
                      error={errors.spouseNumber?.message}
                      label="Numero"
                      onChange={handleTextChange('spouseNumber')}
                      placeholder="Digite o numero"
                      disabled={values.spouseSameAddress === 'sim'}
                      value={values.spouseNumber}
                    />

                    <div className="lg:col-span-2">
                      <ProcessTextField
                        {...register('spouseComplement')}
                        error={errors.spouseComplement?.message}
                        label="Complemento"
                        onChange={handleTextChange('spouseComplement')}
                        placeholder="Apartamento, bloco ou referencia"
                        disabled={values.spouseSameAddress === 'sim'}
                        value={values.spouseComplement}
                      />
                    </div>
                  </div>
                </div>
              </ProcessFormSection>
            </>
          ) : null}

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
        </fieldset>

        {isReadOnly ? (
          <div className="sticky bottom-0 -mx-4 border-t border-border bg-background/95 px-4 py-4 backdrop-blur-sm sm:-mx-6 sm:px-6 xl:-mx-8 xl:px-8">
            <div className="mx-auto flex max-w-5xl items-center justify-end">
              <Link className="no-underline" preload={false} to="/processos">
                <Button type="button" variant="outline">
                  Voltar para a lista
                </Button>
              </Link>
            </div>
          </div>
        ) : (
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
        )}
      </form>

      {mode === 'create' && !isReadOnly ? (
        <ImportFromDocumentDialog
          onApply={handleImportApply}
          onClose={() => setIsImportDialogOpen(false)}
          open={isImportDialogOpen}
        />
      ) : null}

      {successState ? (
        <ProcessSaveSuccessDialog
          isBusy={isGeneratingPdf}
          mode={mode}
          onClose={handleCompleteSuccessFlow}
          onComplete={handleCompleteSuccessFlow}
          onGeneratePdf={() => void handleGeneratePdf()}
          processName={successState.processName}
        />
      ) : null}
    </div>
  )
}
