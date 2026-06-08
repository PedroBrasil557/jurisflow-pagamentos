import { Check, ChevronsUpDown, Loader2, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
import { cn } from '#/lib/utils'
import type { SearchableSelectOption } from './searchable-select'

type SearchableMultiSelectProps = {
  label: string
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  value: string[]
  onChange: (value: string[]) => void
  options: readonly SearchableSelectOption[]
  // Opcoes ja resolvidas para os valores selecionados (usado para exibir os
  // chips mesmo quando o item nao esta na pagina atual de `options`).
  selectedOptions?: readonly SearchableSelectOption[]
  isLoading?: boolean
  hasNextPage?: boolean
  onLoadMore?: () => void
  onSearchChange?: (search: string) => void
}

export function SearchableMultiSelect({
  label,
  placeholder = 'Selecione...',
  searchPlaceholder = 'Buscar...',
  emptyMessage = 'Nenhum resultado encontrado.',
  value,
  onChange,
  options,
  selectedOptions,
  isLoading,
  hasNextPage,
  onLoadMore,
  onSearchChange,
}: SearchableMultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Mapa value -> label, mesclando opcoes carregadas e as resolvidas.
  const labelByValue = useMemo(() => {
    const map = new Map<string, string>()
    for (const option of options) {
      map.set(option.value, option.label)
    }
    for (const option of selectedOptions ?? []) {
      map.set(option.value, option.label)
    }
    return map
  }, [options, selectedOptions])

  const handleToggle = useCallback(
    (optionValue: string) => {
      onChange(
        value.includes(optionValue)
          ? value.filter((item) => item !== optionValue)
          : [...value, optionValue],
      )
    },
    [onChange, value],
  )

  const handleSearchChange = useCallback(
    (nextSearch: string) => {
      setSearch(nextSearch)
      onSearchChange?.(nextSearch)
    },
    [onSearchChange],
  )

  useEffect(() => {
    if (!open) {
      setSearch('')
      onSearchChange?.('')
    }
  }, [open, onSearchChange])

  useEffect(() => {
    if (!hasNextPage || !onLoadMore || isLoading) {
      return
    }

    const sentinel = sentinelRef.current
    if (!sentinel) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          onLoadMore()
        }
      },
      { root: listRef.current, threshold: 0.1 },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasNextPage, onLoadMore, isLoading])

  const filteredOptions =
    onSearchChange !== undefined
      ? options
      : options.filter(
          (opt) =>
            opt.label.toLowerCase().includes(search.toLowerCase()) ||
            opt.description?.toLowerCase().includes(search.toLowerCase()),
        )

  return (
    <div className="flex w-full flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            className={cn(
              'h-9 w-full justify-between font-normal',
              value.length === 0 && 'text-muted-foreground',
            )}
            role="combobox"
            type="button"
            variant="outline"
          >
            <span className="truncate">
              {value.length === 0
                ? placeholder
                : `${value.length} selecionado(s)`}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-(--radix-popover-trigger-width) p-0"
        >
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              type="text"
              value={search}
            />
          </div>

          <div className="max-h-60 overflow-y-auto p-1" ref={listRef}>
            {filteredOptions.length === 0 && !isLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {emptyMessage}
              </p>
            ) : null}

            {filteredOptions.map((option) => (
              <button
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-muted',
                  value.includes(option.value) && 'bg-muted',
                )}
                key={option.value}
                onClick={() => handleToggle(option.value)}
                type="button"
              >
                <Check
                  className={cn(
                    'size-4 shrink-0',
                    value.includes(option.value) ? 'opacity-100' : 'opacity-0',
                  )}
                />
                <div className="flex-1 text-left">
                  <span>{option.label}</span>
                  {option.description ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  ) : null}
                </div>
              </button>
            ))}

            {hasNextPage ? (
              <div className="py-2" ref={sentinelRef}>
                {isLoading ? (
                  <div className="flex justify-center">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  </div>
                ) : null}
              </div>
            ) : null}

            {isLoading && !hasNextPage ? (
              <div className="flex justify-center py-4">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>

      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((selected) => (
            <Badge className="gap-1 pr-1" key={selected} variant="secondary">
              {labelByValue.get(selected) ?? selected}
              <button
                aria-label={`Remover ${labelByValue.get(selected) ?? selected}`}
                className="rounded-sm text-muted-foreground hover:text-foreground"
                onClick={() => handleToggle(selected)}
                type="button"
              >
                <X className="size-3.5" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  )
}
