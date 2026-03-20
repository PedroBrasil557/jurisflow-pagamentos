import { Search } from 'lucide-react'
import type { InputHTMLAttributes } from 'react'
import { cn } from '#/lib/utils'

type SearchInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  containerClassName?: string
}

export function SearchInput({
  className,
  containerClassName,
  ...props
}: SearchInputProps) {
  return (
    <div className={cn('relative', containerClassName)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        className={cn(
          'h-9 w-full rounded-lg border border-input bg-transparent pl-9 pr-3 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30',
          className,
        )}
        type="search"
        {...props}
      />
    </div>
  )
}
