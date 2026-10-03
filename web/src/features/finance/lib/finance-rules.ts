type RuleWindow = {
  status: string
  validFrom: string
  validTo: string | null
}

/**
 * "ATIVA" significa apenas que a versão não foi revogada. A UI de configuração
 * diária precisa considerar também a janela de vigência.
 */
export function ruleEffectiveOn(rule: RuleWindow, civilDate: string): boolean {
  return (
    rule.status === 'ATIVA' &&
    rule.validFrom <= civilDate &&
    (rule.validTo === null || rule.validTo >= civilDate)
  )
}

export function rulesEffectiveOn<T extends RuleWindow>(
  rules: T[],
  civilDate: string,
): T[] {
  return rules.filter((rule) => ruleEffectiveOn(rule, civilDate))
}
