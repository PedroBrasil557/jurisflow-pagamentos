// Log estruturado (JSON) para eventos rastreaveis — uma linha por evento, fácil
// de consultar no CloudWatch/stdout. Inclua sempre o requestId para correlacao.
export function logEvent(
  event: string,
  fields: Record<string, unknown> = {},
): void {
  console.log(
    JSON.stringify({ ts: new Date().toISOString(), event, ...fields }),
  )
}

export function logErrorEvent(
  event: string,
  fields: Record<string, unknown> = {},
): void {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      event,
      ...fields,
    }),
  )
}
