const allowedRedirectHostnames = new Set(['localhost', '127.0.0.1'])

export function getSafeRedirectPath(redirect?: string) {
  if (!redirect) {
    return '/'
  }

  if (redirect.startsWith('/') && !redirect.startsWith('//')) {
    return redirect
  }

  try {
    const url = new URL(redirect, 'http://localhost:3555')

    if (!allowedRedirectHostnames.has(url.hostname)) {
      return '/'
    }

    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return '/'
  }
}
