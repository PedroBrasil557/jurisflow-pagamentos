import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '#/components/ui/button'

type ErrorBoundaryProps = {
  children: ReactNode
  fallback?: ReactNode
}

type ErrorBoundaryState = {
  error: Error | null
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo)
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="flex min-h-[50vh] items-center justify-center p-8">
          <div className="mx-auto max-w-md text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <AlertTriangle className="size-6" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-foreground">
              Algo deu errado
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {this.state.error.message || 'Ocorreu um erro inesperado.'}
            </p>
            <Button
              className="mt-4"
              onClick={() => {
                this.setState({ error: null })
                window.location.reload()
              }}
              variant="outline"
            >
              <RefreshCw className="size-4" />
              Recarregar pagina
            </Button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
