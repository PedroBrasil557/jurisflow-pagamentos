import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '#/components/ui/button'

export function AuthenticatedThemeSwitcher() {
  const { resolvedTheme, setTheme } = useTheme()

  function handleToggle() {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }

  return (
    <Button
      aria-label="Alternar tema"
      onClick={handleToggle}
      size="icon"
      type="button"
      variant="ghost"
    >
      <Sun className="size-4 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute size-4 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
    </Button>
  )
}
