import { X } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'

// Escopo do dashboard de Titular Caixa. null = "Todos". Um municipio selecionado
// sempre carrega junto a sua UF (nome de municipio nao e unico entre UFs). O
// conjunto (housing_complex) e um recorte adicional, independente da UF/municipio.
export type TitularCaixaScope = {
  uf: string | null
  municipio: string | null
  conjuntoId: string | null
}

export type MunicipioOption = {
  uf: string
  municipio: string
}

export type ConjuntoOption = {
  id: string
  nome: string
}

type TitularCaixaScopeFilterProps = {
  scope: TitularCaixaScope
  ufs: string[]
  // Ja filtrados pela UF do escopo quando ha uma UF selecionada.
  municipios: MunicipioOption[]
  // Ja filtrados pelo escopo geografico (UF/municipio) quando ha um selecionado.
  conjuntos: ConjuntoOption[]
  onChange: (scope: TitularCaixaScope) => void
}

// Sentinela p/ a opcao "Todos" — o Radix Select nao aceita value string vazio.
const ALL = '__all__'

function municipioValue(option: MunicipioOption) {
  return `${option.uf}|${option.municipio}`
}

export function TitularCaixaScopeFilter({
  scope,
  ufs,
  municipios,
  conjuntos,
  onChange,
}: TitularCaixaScopeFilterProps) {
  const hasFilter =
    scope.uf !== null || scope.municipio !== null || scope.conjuntoId !== null

  function handleUf(next: string) {
    // Trocar a UF sempre reseta municipio e conjunto (evita combinacao invalida).
    onChange(
      next === ALL
        ? { uf: null, municipio: null, conjuntoId: null }
        : { uf: next, municipio: null, conjuntoId: null },
    )
  }

  function handleMunicipio(next: string) {
    // Trocar o municipio reseta o conjunto (conjunto pertence a um local).
    if (next === ALL) {
      onChange({ uf: scope.uf, municipio: null, conjuntoId: null })
      return
    }
    const [uf, municipio] = next.split('|')
    onChange({ uf, municipio, conjuntoId: null })
  }

  function handleConjunto(next: string) {
    onChange({
      ...scope,
      conjuntoId: next === ALL ? null : next,
    })
  }

  const municipioSelected = scope.municipio
    ? `${scope.uf}|${scope.municipio}`
    : ALL

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        Indicadores por escopo geografico e conjunto.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select onValueChange={handleUf} value={scope.uf ?? ALL}>
          <SelectTrigger className="w-full sm:w-[160px]">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os estados</SelectItem>
            {ufs.map((uf) => (
              <SelectItem key={uf} value={uf}>
                {uf}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select onValueChange={handleMunicipio} value={municipioSelected}>
          <SelectTrigger className="w-full sm:w-[220px]">
            <SelectValue placeholder="Municipio" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os municipios</SelectItem>
            {municipios.map((option) => (
              <SelectItem
                key={municipioValue(option)}
                value={municipioValue(option)}
              >
                {scope.uf
                  ? option.municipio
                  : `${option.municipio} · ${option.uf}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select onValueChange={handleConjunto} value={scope.conjuntoId ?? ALL}>
          <SelectTrigger className="w-full sm:w-[220px]">
            <SelectValue placeholder="Conjunto" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os conjuntos</SelectItem>
            {conjuntos.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasFilter ? (
          <Button
            className="text-muted-foreground"
            onClick={() =>
              onChange({ uf: null, municipio: null, conjuntoId: null })
            }
            size="sm"
            type="button"
            variant="ghost"
          >
            <X className="size-4" />
            Limpar
          </Button>
        ) : null}
      </div>
    </div>
  )
}
