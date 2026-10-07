import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { flexRender, useTable, type SortingState } from '@tanstack/react-table'
import { TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@renderer/components/ui/table'
import type { Job } from '@renderer/lib/types'
import { cn } from '@renderer/lib/utils'
import { useIsCompact } from '@renderer/hooks/useWindowWidth'
import { useNow } from '@renderer/hooks/useNow'
import { useOpenJob } from '@renderer/hooks/useOpenJob'
import { SEARCH_INPUT_ID } from '@renderer/hooks/useAppEvents'
import { buildColumns, COLUMN_WIDTH, jobTableFeatures, type ColumnId } from './columns'

interface Props {
  mode: 'new' | 'visited'
  /** Already filtered, in the default (server) order. */
  jobs: Job[]
}

const SORT_LABEL: Record<string, string> = {
  score: 'score',
  job: 'title',
  workMode: 'work mode',
  location: 'location',
  postedAt: 'posted date',
  visitedAt: 'visited date'
}

export function JobTable({ mode, jobs }: Props): React.JSX.Element {
  const compact = useIsCompact()
  const now = useNow()
  const open = useOpenJob()
  const containerRef = useRef<HTMLDivElement>(null)
  const [sorting, setSorting] = useState<SortingState>([])

  // Latest rows, for focus management after a job leaves the New list.
  const orderRef = useRef<number[]>([])

  const onOpen = useCallback(
    (job: Job) => {
      if (open.isPending) return
      const order = orderRef.current
      const i = order.indexOf(job.id)
      const nextId = i >= 0 ? (order[i + 1] ?? order[i - 1]) : undefined
      open.mutate(job, {
        onSuccess: () => {
          if (mode !== 'new') return
          window.setTimeout(() => {
            const next =
              nextId != null
                ? containerRef.current?.querySelector<HTMLElement>(`[data-testid="job-open-${nextId}"]`)
                : null
            ;(next ?? document.getElementById(SEARCH_INPUT_ID))?.focus()
          }, 0)
        }
      })
    },
    [open, mode]
  )

  const columns = useMemo(() => buildColumns({ compact, now, onOpen }), [compact, now, onOpen])

  const table = useTable({
    features: jobTableFeatures,
    data: jobs,
    columns,
    state: {
      sorting,
      columnVisibility: {
        workMode: !compact,
        location: !compact,
        visitedAt: mode === 'visited'
      }
    },
    onSortingChange: setSorting,
    getRowId: (j) => String(j.id),
    sortDescFirst: true, // cycle: desc -> asc -> default order
    enableSortingRemoval: true
  })

  const rows = table.getRowModel().rows
  useEffect(() => {
    orderRef.current = rows.map((r) => r.original.id)
  }, [rows])

  const sortedBy = sorting[0]
  const caption = `${mode === 'new' ? 'New' : 'Visited'} jobs, sorted by ${
    sortedBy
      ? `${SORT_LABEL[sortedBy.id] ?? sortedBy.id} ${sortedBy.desc ? 'descending' : 'ascending'}`
      : mode === 'new'
        ? 'score, then posted date'
        : 'most recently visited'
  }`

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const target = e.target as HTMLElement
    if (!target.hasAttribute('data-job-open')) return
    const all = Array.from(containerRef.current?.querySelectorAll<HTMLElement>('[data-job-open]') ?? [])
    const i = all.indexOf(target)
    let next: HTMLElement | undefined
    if (e.key === 'ArrowDown') next = all[i + 1]
    else if (e.key === 'ArrowUp') next = all[i - 1]
    else if (e.key === 'Home') next = all[0]
    else if (e.key === 'End') next = all[all.length - 1]
    else return
    e.preventDefault()
    next?.focus()
  }

  return (
    <div
      ref={containerRef}
      onKeyDown={onKeyDown}
      className="relative min-h-0 flex-1 overflow-y-auto rounded-lg border"
      data-testid="job-list"
    >
      <table className="w-full table-fixed caption-bottom text-sm" data-slot="table">
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_var(--border)]">
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id} className="hover:bg-transparent">
              {hg.headers.map((h) => {
                const sorted = h.column.getIsSorted()
                const id = h.column.id as ColumnId
                const Icon = sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ChevronsUpDown
                return (
                  <TableHead
                    key={h.id}
                    scope="col"
                    aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
                    className={cn('px-3', COLUMN_WIDTH[id])}
                  >
                    <button
                      type="button"
                      onClick={h.column.getToggleSortingHandler()}
                      className="-mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      <Icon className="size-3.5" aria-hidden="true" />
                    </button>
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              data-testid="job-row"
              data-job-id={row.original.id}
              className="min-h-[72px] cursor-pointer focus-within:bg-muted/50"
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('button')) return
                onOpen(row.original)
              }}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell
                  key={cell.id}
                  className={cn(
                    'px-3 py-2.5 align-top whitespace-normal',
                    cell.column.id === 'job' && 'min-w-0'
                  )}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </table>
    </div>
  )
}
