import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'
import type { ProductivityStats } from '../../services/dashboard.service'

type ProductivityTableProps = {
  data: ProductivityStats['perUser']
}

export function ProductivityTable({ data }: ProductivityTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Produtividade por usuario
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto px-0 sm:px-0">
        {data.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            Nenhuma atividade registrada no periodo.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuario</TableHead>
                <TableHead className="text-right">Criados</TableHead>
                <TableHead className="text-right">Doc. pronta</TableHead>
                <TableHead className="text-right">Iniciados</TableHead>
                <TableHead className="text-right">Finalizados</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row) => (
                <TableRow key={row.userId}>
                  <TableCell className="font-medium text-foreground">
                    {row.userName}
                  </TableCell>
                  <TableCell className="text-right">{row.criados}</TableCell>
                  <TableCell className="text-right">{row.docPronta}</TableCell>
                  <TableCell className="text-right">{row.iniciados}</TableCell>
                  <TableCell className="text-right">{row.finalizados}</TableCell>
                  <TableCell className="text-right font-semibold text-foreground">
                    {row.total}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
