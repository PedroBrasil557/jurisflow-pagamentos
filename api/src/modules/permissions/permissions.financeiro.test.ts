import { describe, expect, test } from 'bun:test'
import {
  ATTORNEY_PERMISSIONS,
  DEFAULT_USER_PERMISSIONS,
  normalizeProfilePermissions,
} from './permissions.defaults'
import { createProfilePayloadSchema } from './permissions.schemas'

// Acesso financeiro e NEGADO por padrao: perfis de sistema, perfis gravados antes
// do grupo existir e payloads de clientes antigos (sem o grupo).
describe('permissoes financeiras negadas por padrao', () => {
  test('perfis de sistema nao concedem nada do financeiro', () => {
    for (const profile of [DEFAULT_USER_PERMISSIONS, ATTORNEY_PERMISSIONS]) {
      expect(Object.values(profile.financeiro).every((v) => v === false)).toBe(
        true,
      )
    }
  })

  test('perfil persistido sem o grupo normaliza para tudo false', () => {
    const legacy = { process: { create: true }, cadastros: { usuarios: true } }
    const normalized = normalizeProfilePermissions(legacy)
    expect(normalized.financeiro.view).toBe(false)
    expect(normalized.financeiro.fechar).toBe(false)
    expect(normalized.cadastros.usuarios).toBe(true)
  })

  test('flag concedida explicitamente e preservada', () => {
    const normalized = normalizeProfilePermissions({
      financeiro: { view: true, baixar: 'sim' },
    })
    expect(normalized.financeiro.view).toBe(true)
    expect(normalized.financeiro.baixar).toBe(false) // nao-booleano = negado
  })

  test('payload sem o grupo continua valido e negado', () => {
    const parsed = createProfilePayloadSchema.parse({
      name: 'Perfil antigo',
      processScope: 'all',
      permissions: {
        ...DEFAULT_USER_PERMISSIONS,
        financeiro: undefined,
      },
    })
    expect(parsed.permissions.financeiro.view).toBe(false)
  })
})
