import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '#/components/ui/button'

type QueryErrorProps = {
  message?: string
  onRetry?: () => void
}

export function QueryError({
  message = 'Nao foi possivel carregar os dados.',
  onRetry,
}: QueryErrorProps) {
  return (
    <div className="flex min-h-[30vh] items-center justify-center p-8">
      <div className="mx-auto max-w-sm text-center">
        <div className="mx-auto flex size-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
          <AlertTriangle className="size-5" />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">{message}</p>
        {onRetry ? (
          <Button
            className="mt-3"
            onClick={onRetry}
            size="sm"
            variant="outline"
          >
            <RefreshCw className="size-4" />
            Tentar novamente
          </Button>
        ) : null}
      </div>
    </div>
  )
}
