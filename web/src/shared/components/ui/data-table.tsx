import type { ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'

export type DataTableColumn<TItem> = {
  cellClassName?: string
  header: ReactNode
  headerClassName?: string
  id: string
  render: (item: TItem) => ReactNode
}

type DataTablePagination = {
  itemLabel: string
  onPageChange: (page: number) => void
  page: number
  pageSize: number
  total: number
}

type DataTableProps<TItem> = {
  ariaLabel: string
  columns: readonly DataTableColumn<TItem>[]
  emptyState: ReactNode
  getItemKey: (item: TItem) => string
  items: readonly TItem[]
  pagination?: DataTablePagination
  renderMobileCard: (item: TItem) => ReactNode
}

function getVisiblePages(page: number, pageCount: number) {
  if (pageCount <= 5) {
    return Array.from({ length: pageCount }, (_, index) => index + 1)
  }

  if (page <= 3) {
    return [1, 2, 3, 4, 5]
  }

  if (page >= pageCount - 2) {
    return [
      pageCount - 4,
      pageCount - 3,
      pageCount - 2,
      pageCount - 1,
      pageCount,
    ]
  }

  return [page - 2, page - 1, page, page + 1, page + 2]
}

function DataTablePaginationControls({
  itemLabel,
  onPageChange,
  page,
  pageSize,
  total,
}: DataTablePagination) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const visiblePages = getVisiblePages(page, pageCount)
  const startItem = total === 0 ? 0 : (page - 1) * pageSize + 1
  const endItem = total === 0 ? 0 : Math.min(page * pageSize, total)

  if (total <= pageSize) {
    return null
  }

  return (
    <div className="flex flex-col gap-4 border-t border-border pt-5 md:flex-row md:items-center md:justify-between">
      <p className="text-sm text-muted-foreground">
        {`Mostrando ${startItem} a ${endItem} de ${total} ${itemLabel}`}
      </p>

      <div className="flex self-start md:self-auto">
        <Button
          disabled={page === 1}
          onClick={() => onPageChange(page - 1)}
          size="sm"
          type="button"
          variant="outline"
        >
          Anterior
        </Button>

        {visiblePages.map((visiblePage) => (
          <Button
            key={visiblePage}
            onClick={() => onPageChange(visiblePage)}
            size="sm"
            type="button"
            variant={visiblePage === page ? 'default' : 'outline'}
          >
            {visiblePage}
          </Button>
        ))}

        <Button
          disabled={page === pageCount}
          onClick={() => onPageChange(page + 1)}
          size="sm"
          type="button"
          variant="outline"
        >
          Proxima
        </Button>
      </div>
    </div>
  )
}

export function DataTable<TItem>({
  ariaLabel,
  columns,
  emptyState,
  getItemKey,
  items,
  pagination,
  renderMobileCard,
}: DataTableProps<TItem>) {
  if (items.length === 0) {
    return emptyState
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 xl:hidden">
        {items.map((item) => (
          <div key={getItemKey(item)}>{renderMobileCard(item)}</div>
        ))}
      </div>

      <div className="hidden xl:block">
        <Table aria-label={ariaLabel}>
          <TableHeader>
            <TableRow className="text-xs text-muted-foreground">
              {columns.map((column) => (
                <TableHead className={column.headerClassName} key={column.id}>
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>

          <TableBody>
            {items.map((item) => (
              <TableRow key={getItemKey(item)}>
                {columns.map((column) => (
                  <TableCell className={column.cellClassName} key={column.id}>
                    {column.render(item)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {pagination ? <DataTablePaginationControls {...pagination} /> : null}
    </div>
  )
}
