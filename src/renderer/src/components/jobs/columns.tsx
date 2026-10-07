import { Check } from 'lucide-react'
import type { LegacyColumnDef } from '@tanstack/react-table/legacy'
import type { Job } from '@renderer/lib/types'
import { WORK_MODE_LABEL } from '@renderer/lib/filters'
import { daysSincePosted, formatAbsolute, formatRelative } from '@renderer/lib/time'
import { ScoreBadge } from './ScoreBadge'
import { JobCell } from './JobCell'

export type ColumnId = 'score' | 'job' | 'workMode' | 'location' | 'postedAt' | 'visitedAt'

/** Fixed widths; the `job` column takes the remaining space. */
export const COLUMN_WIDTH: Record<ColumnId, string> = {
  score: 'w-20',
  job: '',
  workMode: 'w-24',
  location: 'w-40',
  postedAt: 'w-24',
  visitedAt: 'w-28'
}

interface Opts {
  compact: boolean
  now: number
  onOpen: (job: Job) => void
}

function WorkModeText({ mode }: { mode: string | null }): React.JSX.Element {
  const m = mode ?? 'unknown'
  return (
    <span className={`block pt-0.5 text-xs ${m === 'unknown' ? 'text-muted-foreground' : ''}`}>
      {WORK_MODE_LABEL[m] ?? m}
    </span>
  )
}

// Null values map to `undefined` so `sortUndefined: 'last'` keeps them last in both directions.
export function buildColumns({ compact, now, onOpen }: Opts): LegacyColumnDef<Job>[] {
  return [
    {
      id: 'score',
      header: 'Score',
      accessorFn: (j) => j.score ?? 0,
      sortFn: 'basic',
      cell: ({ row }) => <ScoreBadge score={row.original.score} />
    },
    {
      id: 'job',
      header: 'Job',
      accessorFn: (j) => j.title?.trim().toLowerCase() || undefined,
      sortUndefined: 'last',
      sortFn: 'text',
      cell: ({ row }) => <JobCell job={row.original} compact={compact} onOpen={onOpen} />
    },
    {
      id: 'workMode',
      header: 'Work mode',
      accessorFn: (j) => j.workMode ?? 'unknown',
      sortFn: 'text',
      cell: ({ row }) => <WorkModeText mode={row.original.workMode} />
    },
    {
      id: 'location',
      header: 'Location',
      accessorFn: (j) => (j.city || j.location)?.trim().toLowerCase() || undefined,
      sortUndefined: 'last',
      sortFn: 'text',
      cell: ({ row }) => (
        <span className="block truncate pt-0.5 text-xs" title={row.original.location ?? undefined}>
          {row.original.city || row.original.location || '-'}
        </span>
      )
    },
    {
      id: 'postedAt',
      header: 'Posted',
      accessorFn: (j) => j.postedAt ?? undefined,
      sortUndefined: 'last',
      sortFn: 'basic',
      cell: ({ row }) => {
        const t = row.original.postedAt
        return t == null ? (
          <span className="block pt-0.5 text-xs text-muted-foreground">-</span>
        ) : (
          <span className="block pt-0.5 text-xs" title={formatAbsolute(t)}>
            {daysSincePosted(t, now)}
          </span>
        )
      }
    },
    {
      id: 'visitedAt',
      header: 'Visited',
      accessorFn: (j) => j.visitedAt ?? undefined,
      sortUndefined: 'last',
      sortFn: 'basic',
      cell: ({ row }) => {
        const t = row.original.visitedAt
        return t == null ? null : (
          <span
            className="inline-flex items-center gap-1 pt-0.5 text-xs text-muted-foreground"
            title={formatAbsolute(t)}
          >
            <Check className="size-3.5" aria-hidden="true" />
            {formatRelative(t, now)}
          </span>
        )
      }
    }
  ]
}
