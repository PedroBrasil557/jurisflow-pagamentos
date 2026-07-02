import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { CalendarDays } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { Button } from '#/components/ui/button'
import { Calendar } from '#/components/ui/calendar'
import { Checkbox } from '#/components/ui/checkbox'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '#/components/ui/sheet'
import { SearchableMultiSelect } from '@/shared/components/searchable-multi-select'
import { useDebouncedValue } from '@/shared/hooks/use-debounced-value'
import {
  housingComplexOptionsByIdsQuery,
  housingComplexOptionsInfiniteQuery,
} from '../../services/housing-complexes.queries'
import {
  type OwnerTypeValue,
  ownerTypeFilterOptions,
  type ProcessStatusValue,
  processStatusOptions,
} from '../../services/processes.service'
import { dateToIso, formatShortDate, isoToDate } from './process-filters.utils'

export type ProcessFiltersValue = {
  statuses: ProcessStatusValue[]
  ownerTypes: OwnerTypeValue[]
  housingComplexIds: string[]
  createdFrom?: string
  createdTo?: string
  needsClassificationReview: boolean
}

type ProcessFiltersSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: ProcessFiltersValue
  onApply: (value: ProcessFiltersValue) => void
}

export function ProcessFiltersSheet({
  open,
  onOpenChange,
  value,
  onApply,
}: ProcessFiltersSheetProps) {
  const statusFieldId = useId()
  const ownerTypeFieldId = useId()
  const [statuses, setStatuses] = useState<ProcessStatusValue[]>(value.statuses)
  const [ownerTypes, setOwnerTypes] = useState<OwnerTypeValue[]>(
    value.ownerTypes,
  )
  const [housingComplexIds, setHousingComplexIds] = useState<string[]>(
    value.housingComplexIds,
  )
  const [needsClassificationReview, setNeedsClassificationReview] = useState(
    value.needsClassificationReview,
  )
  const [range, setRange] = useState<DateRange | undefined>(undefined)
  const [hcSearch, setHcSearch] = useState('')
  const debouncedHcSearch = useDebouncedValue(hcSearch, { delay: 300 })

  const hcQuery = useInfiniteQuery(
    housingComplexOptionsInfiniteQuery(debouncedHcSearch),
  )
  const selectedHcQuery = useQuery(
    housingComplexOptionsByIdsQuery(value.housingComplexIds),
  )

  const housingComplexOptions = useMemo(
    () =>
      (hcQuery.data?.pages.flatMap((page) => page.items) ?? []).map((item) => ({
        value: item.id,
        label: item.name,
      })),
    [hcQuery.data],
  )
  const selectedHousingComplexOptions = useMemo(
    () =>
      (selectedHcQuery.data?.items ?? []).map((item) => ({
        value: item.id,
        label: item.name,
      })),
    [selectedHcQuery.data],
  )

  // Sincroniza o rascunho com a URL sempre que o painel abre.
  useEffect(() => {
    if (open) {
      setStatuses(value.statuses)
      setOwnerTypes(value.ownerTypes)
      setHousingComplexIds(value.housingComplexIds)
      setNeedsClassificationReview(value.needsClassificationReview)
      setRange({
        from: isoToDate(value.createdFrom),
        to: isoToDate(value.createdTo),
      })
    }
  }, [
    open,
    value.statuses,
    value.ownerTypes,
    value.housingComplexIds,
    value.createdFrom,
    value.createdTo,
    value.needsClassificationReview,
  ])

  function toggleStatus(status: ProcessStatusValue) {
    setStatuses((prev) =>
      prev.includes(status)
        ? prev.filter((item) => item !== status)
        : [...prev, status],
    )
  }

  function toggleOwnerType(ownerType: OwnerTypeValue) {
    setOwnerTypes((prev) =>
      prev.includes(ownerType)
        ? prev.filter((item) => item !== ownerType)
        : [...prev, ownerType],
    )
  }

  function handleClear() {
    setStatuses([])
    setOwnerTypes([])
    setHousingComplexIds([])
    setNeedsClassificationReview(false)
    setRange(undefined)
  }

  function handleApply() {
    onApply({
      statuses,
      ownerTypes,
      housingComplexIds,
      createdFrom: dateToIso(range?.from),
      createdTo: dateToIso(range?.to ?? range?.from),
      needsClassificationReview,
    })
    onOpenChange(false)
  }

  const rangeLabel =
    range?.from && range?.to
      ? `${formatShortDate(range.from)} – ${formatShortDate(range.to)}`
      : range?.from
        ? `A partir de ${formatShortDate(range.from)}`
        : 'Selecionar período'

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-md" side="right">
        <SheetHeader>
          <SheetTitle>Filtros</SheetTitle>
          <SheetDescription>
            Refine a lista de processos por etapa, titularidade, conjunto e
            período de criação.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4">
          <div className="grid gap-6 py-2">
            <fieldset className="grid gap-3">
              <legend className="text-sm font-medium text-foreground">
                Etapa
              </legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {processStatusOptions.map((option) => (
                  <label
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
                    htmlFor={`${statusFieldId}-${option.value}`}
                    key={option.value}
                  >
                    <Checkbox
                      checked={statuses.includes(option.value)}
                      id={`${statusFieldId}-${option.value}`}
                      onCheckedChange={() => toggleStatus(option.value)}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="grid gap-3">
              <legend className="text-sm font-medium text-foreground">
                Tipo de titular
              </legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ownerTypeFilterOptions.map((option) => (
                  <label
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
                    htmlFor={`${ownerTypeFieldId}-${option.value}`}
                    key={option.value}
                  >
                    <Checkbox
                      checked={ownerTypes.includes(option.value)}
                      id={`${ownerTypeFieldId}-${option.value}`}
                      onCheckedChange={() => toggleOwnerType(option.value)}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <SearchableMultiSelect
              hasNextPage={hcQuery.hasNextPage}
              isLoading={hcQuery.isFetchingNextPage || hcQuery.isLoading}
              label="Condomínio / conjunto"
              onChange={setHousingComplexIds}
              onLoadMore={() => hcQuery.fetchNextPage()}
              onSearchChange={setHcSearch}
              options={housingComplexOptions}
              placeholder="Selecionar conjuntos..."
              searchPlaceholder="Buscar conjunto..."
              selectedOptions={selectedHousingComplexOptions}
              value={housingComplexIds}
            />

            <div className="grid gap-3">
              <span className="text-sm font-medium text-foreground">
                Período (criação)
              </span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    className="justify-start font-normal"
                    type="button"
                    variant="outline"
                  >
                    <CalendarDays className="size-4" />
                    {rangeLabel}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto">
                  <Calendar
                    autoFocus
                    mode="range"
                    numberOfMonths={1}
                    onSelect={setRange}
                    selected={range}
                  />
                  <Button
                    className="w-full"
                    onClick={() => setRange(undefined)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Limpar período
                  </Button>
                </PopoverContent>
              </Popover>
            </div>

            <fieldset className="grid gap-3">
              <legend className="text-sm font-medium text-foreground">
                Classificação
              </legend>
              <label
                className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
                htmlFor={`${statusFieldId}-review`}
              >
                <Checkbox
                  checked={needsClassificationReview}
                  id={`${statusFieldId}-review`}
                  onCheckedChange={(checked) =>
                    setNeedsClassificationReview(checked === true)
                  }
                />
                <span className="grid gap-0.5">
                  Revisar classificação
                  <span className="text-xs text-muted-foreground">
                    A digitalização reconheceu um documento que não foi anexado,
                    deixou páginas sem identificar ou de fora.
                  </span>
                </span>
              </label>
            </fieldset>
          </div>
        </div>

        <SheetFooter className="flex-row justify-end gap-2">
          <Button onClick={handleClear} type="button" variant="outline">
            Limpar
          </Button>
          <Button onClick={handleApply} type="button">
            Aplicar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
