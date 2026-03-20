import { Eye, EyeOff } from 'lucide-react'
import { forwardRef, type InputHTMLAttributes, useState } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { cn } from '#/lib/utils'

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className, ...props }, ref) {
    const [visible, setVisible] = useState(false)

    return (
      <div className="relative">
        <Input
          className={cn('pr-10', className)}
          ref={ref}
          type={visible ? 'text' : 'password'}
          {...props}
        />
        <Button
          className="absolute right-0 top-0 h-full px-3"
          onClick={() => setVisible((v) => !v)}
          size="icon"
          tabIndex={-1}
          type="button"
          variant="ghost"
        >
          {visible ? (
            <EyeOff className="size-4 text-muted-foreground" />
          ) : (
            <Eye className="size-4 text-muted-foreground" />
          )}
        </Button>
      </div>
    )
  },
)
