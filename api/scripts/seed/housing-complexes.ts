import { eq } from 'drizzle-orm'
import { housingComplex } from '../../src/modules/housing-complexes/housing-complexes.schema'
import { db } from '../../src/shared/db'

type HousingComplexSeed = {
  id: string
  name: string
  district: string
  city: string
  state: string
  zipcode: string
}

export const housingComplexesSeed: HousingComplexSeed[] = [
  {
    id: 'hc_jardim_das_flores',
    name: 'Residencial Jardim das Flores',
    district: 'Jardim das Flores',
    city: 'Sao Paulo',
    state: 'SP',
    zipcode: '05000-000',
  },
  {
    id: 'hc_vila_nova',
    name: 'Conjunto Vila Nova',
    district: 'Vila Nova',
    city: 'Rio de Janeiro',
    state: 'RJ',
    zipcode: '22000-000',
  },
  {
    id: 'hc_morada_do_sol',
    name: 'Morada do Sol',
    district: 'Morada do Sol',
    city: 'Belo Horizonte',
    state: 'MG',
    zipcode: '30000-000',
  },
  {
    id: 'hc_bosque_verde',
    name: 'Residencial Bosque Verde',
    district: 'Bosque Verde',
    city: 'Porto Alegre',
    state: 'RS',
    zipcode: '90000-000',
  },
  {
    id: 'hc_alvorada',
    name: 'Conjunto Alvorada',
    district: 'Alvorada',
    city: 'Fortaleza',
    state: 'CE',
    zipcode: '60000-000',
  },
]

export async function seedHousingComplexes() {
  for (const complex of housingComplexesSeed) {
    const [existing] = await db
      .select({ id: housingComplex.id })
      .from(housingComplex)
      .where(eq(housingComplex.name, complex.name))
      .limit(1)

    if (existing) {
      continue
    }

    await db.insert(housingComplex).values({
      id: complex.id,
      name: complex.name,
      district: complex.district,
      city: complex.city,
      state: complex.state,
      zipcode: complex.zipcode,
    })
  }
}
