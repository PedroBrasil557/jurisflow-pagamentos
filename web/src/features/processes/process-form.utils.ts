import type { PlatformUserOption } from './process-form.types'

function onlyDigits(value: string) {
  return value.replace(/\D/g, '')
}

export function formatCpf(value: string) {
  const digits = onlyDigits(value).slice(0, 11)

  if (digits.length <= 3) {
    return digits
  }

  if (digits.length <= 6) {
    return `${digits.slice(0, 3)}.${digits.slice(3)}`
  }

  if (digits.length <= 9) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`
  }

  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
}

export function formatZipCode(value: string) {
  const digits = onlyDigits(value).slice(0, 8)

  if (digits.length <= 5) {
    return digits
  }

  return `${digits.slice(0, 5)}-${digits.slice(5)}`
}

export function formatWhatsapp(value: string) {
  const digits = onlyDigits(value).slice(0, 11)

  if (digits.length <= 2) {
    return digits
  }

  if (digits.length <= 7) {
    return `${digits.slice(0, 2)} ${digits.slice(2)}`
  }

  return `${digits.slice(0, 2)} ${digits.slice(2, 7)}-${digits.slice(7)}`
}

export function getWitnessOptions(
  users: readonly PlatformUserOption[],
  blockedId: string,
) {
  return users.filter((user) => user.id !== blockedId)
}
