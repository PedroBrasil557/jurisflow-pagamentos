import { useEffect, useState } from 'react'

type UseDebouncedValueOptions = {
  delay?: number
}

export function useDebouncedValue<T>(
  value: T,
  options?: UseDebouncedValueOptions,
) {
  const delay = options?.delay ?? 350
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [delay, value])

  return debouncedValue
}
