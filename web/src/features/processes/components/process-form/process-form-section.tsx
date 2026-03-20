import type { ReactNode } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'

type ProcessFormSectionProps = {
  children: ReactNode
  description?: string
  eyebrow?: string
  title: string
}

export function ProcessFormSection({
  children,
  description,
  eyebrow,
  title,
}: ProcessFormSectionProps) {
  return (
    <Card>
      <CardHeader>
        {eyebrow ? (
          <CardDescription className="text-xs font-medium text-primary">
            {eyebrow}
          </CardDescription>
        ) : null}
        <CardTitle className="text-lg">{title}</CardTitle>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}
