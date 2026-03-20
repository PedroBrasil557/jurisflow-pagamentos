import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '#/lib/utils'

type SettingsNavItem = {
  icon: LucideIcon
  isActive?: boolean
  label: string
  onClick: () => void
}

type SettingsLayoutProps = {
  children: ReactNode
  items: readonly SettingsNavItem[]
}

export function SettingsLayout({ children, items }: SettingsLayoutProps) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
      <nav className="flex gap-1 overflow-x-auto lg:w-52 lg:shrink-0 lg:flex-col">
        {items.map((item) => {
          const Icon = item.icon

          return (
            <button
              key={item.label}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                item.isActive
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              )}
              onClick={item.onClick}
              type="button"
            >
              <Icon className="size-4 shrink-0" />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}
