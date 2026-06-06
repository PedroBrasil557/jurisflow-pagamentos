const CPF_LENGTH = 11

export function normalizeCpf(value: string) {
  return value.replace(/\D/g, '').slice(0, CPF_LENGTH)
}

export function formatCpf(value: string) {
  const digits = normalizeCpf(value)

  if (digits.length !== CPF_LENGTH) {
    return value.trim()
  }

  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
}

function getCpfCheckDigit(baseDigits: string) {
  const sum = baseDigits
    .split('')
    .reduce(
      (total, digit, index) =>
        total + Number(digit) * (baseDigits.length + 1 - index),
      0,
    )

  const remainder = (sum * 10) % 11
  return remainder === 10 ? 0 : remainder
}

export function isValidCpf(value: string) {
  const cpf = normalizeCpf(value)

  if (cpf.length !== CPF_LENGTH) {
    return false
  }

  if (/^(\d)\1{10}$/.test(cpf)) {
    return false
  }

  const firstCheckDigit = getCpfCheckDigit(cpf.slice(0, 9))
  const secondCheckDigit = getCpfCheckDigit(cpf.slice(0, 10))

  return (
    firstCheckDigit === Number(cpf[9]) && secondCheckDigit === Number(cpf[10])
  )
}
