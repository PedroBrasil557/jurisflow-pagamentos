import { format, isValid, parse } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CalendarIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Calendar } from '#/components/ui/calendar'
import { Input } from '#/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '#/components/ui/popover'
import { cn } from '#/lib/utils'
import { ProcessFormField } from './process-form-field'

type ProcessDateFieldProps = {
  error?: string
  hint?: string
  label: string
  required?: boolean
  value: string
  onChange: (isoDate: string) => void
}

function applyDateMask(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

function isoToDisplay(iso: string): string {
  if (!iso) return ''
  const date = parse(iso, 'yyyy-MM-dd', new Date())
  if (!isValid(date)) return ''
  return format(date, 'dd/MM/yyyy')
}

function displayToIso(display: string): string | null {
  if (display.length !== 10) return null
  const date = parse(display, 'dd/MM/yyyy', new Date())
  if (!isValid(date)) return null
  return format(date, 'yyyy-MM-dd')
}

export function ProcessDateField({
  error,
  hint,
  label,
  required,
  value,
  onChange,
}: ProcessDateFieldProps) {
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState(() => isoToDisplay(value))
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => {
    if (value) {
      const d = parse(value, 'yyyy-MM-dd', new Date())
      if (isValid(d)) return d
    }
    return new Date()
  })
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) return

    setInputValue(isoToDisplay(value))

    if (value) {
      const d = parse(value, 'yyyy-MM-dd', new Date())
      if (isValid(d)) setCalendarMonth(d)
    }
  }, [value, open])

  const handleInputChange = useCallback(
    (rawValue: string) => {
      const masked = applyDateMask(rawValue)
      setInputValue(masked)

      if (masked.length === 10) {
        const iso = displayToIso(masked)
        if (iso) {
          onChange(iso)
          const d = parse(iso, 'yyyy-MM-dd', new Date())
          if (isValid(d)) setCalendarMonth(d)
        }
      } else if (masked.length === 0) {
        onChange('')
      }
    },
    [onChange],
  )

  const handleCalendarSelect = useCallback(
    (date: Date | undefined) => {
      if (!date) return
      const iso = format(date, 'yyyy-MM-dd')
      onChange(iso)
      setInputValue(format(date, 'dd/MM/yyyy'))
      setCalendarMonth(date)
      setOpen(false)
    },
    [onChange],
  )

  const selectedDate = value
    ? parse(value, 'yyyy-MM-dd', new Date())
    : undefined
  const validSelectedDate =
    selectedDate && isValid(selectedDate) ? selectedDate : undefined

  return (
    <ProcessFormField
      error={error}
      hint={hint}
      label={label}
      required={required}
    >
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setOpen(false)
            setInputValue(isoToDisplay(value))
          }
        }}
      >
        <PopoverAnchor asChild>
          <div className="relative">
            <Input
              aria-invalid={error ? true : undefined}
              aria-label={label}
              className={cn('pr-9', error && 'border-destructive')}
              onChange={(e) => handleInputChange(e.target.value)}
              onClick={(e) => {
                if (!open) setOpen(true)
                e.stopPropagation()
              }}
              onFocus={() => {
                if (!open) setOpen(true)
              }}
              placeholder="dd/mm/aaaa"
              ref={inputRef}
              value={inputValue}
            />
            <button
              aria-label="Abrir calendario"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground opacity-60 hover:opacity-100 focus:outline-none"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setOpen(true)
              }}
              tabIndex={-1}
              type="button"
            >
              <CalendarIcon className={cn('size-4', open && 'text-primary')} />
            </button>
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          className="w-auto p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Calendar
            locale={ptBR}
            mode="single"
            month={calendarMonth}
            onMonthChange={setCalendarMonth}
            onSelect={handleCalendarSelect}
            selected={validSelectedDate}
          />
        </PopoverContent>
      </Popover>
    </ProcessFormField>
  )
}
