export async function getErrorMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { message?: string }

    return body.message ?? fallback
  } catch {
    return fallback
  }
}
