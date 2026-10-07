import { useMemo } from 'react'
import { ExternalLink } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { ROLE_LABELS, type Job } from '@renderer/lib/types'
import { WORK_MODE_LABEL } from '@renderer/lib/filters'
import { toExcerpt } from '@renderer/lib/text'

interface Props {
  job: Job
  /** Location/work mode are folded into the meta line when their columns are hidden. */
  compact: boolean
  onOpen: (job: Job) => void
}

/** The shared job "card" cell: title button, meta line, role badges, excerpt. */
export function JobCell({ job, compact, onOpen }: Props): React.JSX.Element {
  const excerpt = useMemo(() => toExcerpt(job.description), [job.description])
  const meta = [job.company?.trim() || 'Unknown company']
  const folded: string[] = []
  if (compact) {
    const place = job.city || job.location
    if (place) folded.push(place)
    if (job.workMode && job.workMode !== 'unknown') folded.push(WORK_MODE_LABEL[job.workMode] ?? job.workMode)
  }
  const roles = job.roles ?? []

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <button
        type="button"
        data-job-open
        data-testid={`job-open-${job.id}`}
        onClick={() => onOpen(job)}
        className="group inline-flex max-w-full items-center gap-1 self-start rounded-sm text-left text-sm font-medium text-foreground hover:underline"
      >
        <span className="truncate">{job.title?.trim() || 'Untitled role'}</span>
        <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">(opens in your browser)</span>
      </button>
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
        <span className="max-w-full truncate font-medium text-foreground/80" title={meta[0]}>
          {meta[0]}
        </span>
        {folded.map((f, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <span aria-hidden="true">{'·'}</span>
            <span className="truncate">{f}</span>
          </span>
        ))}
        {roles.map((r) => (
          <Badge key={r} variant="outline" className="px-1.5 py-0 text-[11px] font-normal">
            {ROLE_LABELS[r] ?? r}
          </Badge>
        ))}
      </div>
      {excerpt && (
        <p
          className={`text-xs text-muted-foreground ${compact ? 'line-clamp-1' : 'line-clamp-2'}`}
          data-testid="job-excerpt"
        >
          {excerpt}
        </p>
      )}
    </div>
  )
}
