import { CalendarDays } from 'lucide-react'
import type { DateRange } from 'react-day-picker'
import { Button } from '#/components/ui/button'
import { Calendar } from '#/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { dateToIso, formatShortDate, isoToDate } from '@/shared/lib/format'
import type { ProductivityPeriod } from '../../services/dashboard.service'

export type ProductivityFilter =
  | { mode: 'preset'; period: ProductivityPeriod }
  | { mode: 'custom'; from?: string; to?: string }

type ProductivityPeriodFilterProps = {
  value: ProductivityFilter
  onChange: (value: ProductivityFilter) => void
}

const presetLabels: Record<ProductivityPeriod, string> = {
  '7d': 'Ultimos 7 dias',
  '30d': 'Ultimos 30 dias',
  '90d': 'Ultimos 90 dias',
}

const CUSTOM_VALUE = 'custom'

export function ProductivityPeriodFilter({
  value,
  onChange,
}: ProductivityPeriodFilterProps) {
  const selectValue = value.mode === 'preset' ? value.period : CUSTOM_VALUE

  function handleSelectChange(next: string) {
    if (next === CUSTOM_VALUE) {
      onChange({ mode: 'custom', from: undefined, to: undefined })
      return
    }

    onChange({ mode: 'preset', period: next as ProductivityPeriod })
  }

  const range: DateRange | undefined =
    value.mode === 'custom'
      ? { from: isoToDate(value.from), to: isoToDate(value.to) }
      : undefined

  function handleRangeChange(next: DateRange | undefined) {
    onChange({
      mode: 'custom',
      from: dateToIso(next?.from),
      to: dateToIso(next?.to),
    })
  }

  const rangeLabel =
    value.mode === 'custom' && value.from && value.to
      ? `${formatShortDate(value.from)} - ${formatShortDate(value.to)}`
      : value.mode === 'custom' && value.from
        ? `A partir de ${formatShortDate(value.from)}`
        : 'Selecionar intervalo'

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Select onValueChange={handleSelectChange} value={selectValue}>
        <SelectTrigger className="w-full sm:w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(presetLabels) as ProductivityPeriod[]).map((period) => (
            <SelectItem key={period} value={period}>
              {presetLabels[period]}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM_VALUE}>Personalizado</SelectItem>
        </SelectContent>
      </Select>

      {value.mode === 'custom' ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              className="justify-start font-normal sm:w-[230px]"
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
              onSelect={handleRangeChange}
              selected={range}
            />
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  )
}
