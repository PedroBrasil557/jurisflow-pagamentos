import { Check, ChevronsUpDown, Loader2, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '#/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#/components/ui/popover'
import { cn } from '#/lib/utils'

export type SearchableSelectOption = {
  value: string
  label: string
  description?: string
}

type SearchableSelectProps = {
  error?: string
  hint?: string
  label: string
  required?: boolean
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  value: string
  onChange: (value: string) => void
  options: readonly SearchableSelectOption[]
  // Opcao ja resolvida para `value` (usada para exibir o rotulo mesmo quando o
  // item nao esta na pagina atual de `options`, ex.: valor pre-carregado na
  // edicao com busca server-side).
  selectedOption?: SearchableSelectOption
  isLoading?: boolean
  hasNextPage?: boolean
  onLoadMore?: () => void
  onSearchChange?: (search: string) => void
}

export function SearchableSelect({
  error,
  hint,
  label,
  required,
  placeholder = 'Selecione...',
  searchPlaceholder = 'Buscar...',
  emptyMessage = 'Nenhum resultado encontrado.',
  value,
  onChange,
  options,
  selectedOption,
  isLoading,
  hasNextPage,
  onLoadMore,
  onSearchChange,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Guarda o ultimo option que casou com `value`, para o botao continuar
  // exibindo o rotulo mesmo depois da lista ser refeita/paginada (a busca
  // server-side reseta para a primeira pagina ao fechar o popover).
  const [cachedOption, setCachedOption] = useState<SearchableSelectOption | null>(
    null,
  )

  useEffect(() => {
    const match = options.find((opt) => opt.value === value)
    if (match) {
      setCachedOption(match)
    }
  }, [options, value])

  const activeOption = useMemo(() => {
    if (!value) {
      return undefined
    }
    return (
      options.find((opt) => opt.value === value) ??
      (selectedOption?.value === value ? selectedOption : undefined) ??
      (cachedOption?.value === value ? cachedOption : undefined)
    )
  }, [options, value, selectedOption, cachedOption])

  const handleSelect = useCallback(
    (optionValue: string) => {
      onChange(optionValue === value ? '' : optionValue)
      setOpen(false)
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
      <span className="text-sm font-medium text-foreground">
        {label}
        {required ? ' *' : ''}
      </span>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            aria-invalid={error ? true : undefined}
            className={cn(
              'h-9 w-full justify-between font-normal',
              !activeOption && 'text-muted-foreground',
              error && 'border-destructive',
            )}
            role="combobox"
            type="button"
            variant="outline"
          >
            <span className="truncate">
              {activeOption?.label ?? placeholder}
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
                  option.value === value && 'bg-muted',
                )}
                key={option.value}
                onClick={() => handleSelect(option.value)}
                type="button"
              >
                <Check
                  className={cn(
                    'size-4 shrink-0',
                    option.value === value ? 'opacity-100' : 'opacity-0',
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

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
