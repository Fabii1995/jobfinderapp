import { Skeleton } from '@renderer/components/ui/skeleton'

/** Initial-load placeholder: same row height / rough column layout as the real table. */
export function SkeletonRows({ count = 8 }: { count?: number }): React.JSX.Element {
  return (
    <div
      className="relative min-h-0 flex-1 overflow-hidden rounded-lg border"
      aria-busy="true"
      aria-label="Loading jobs"
      data-testid="job-list-loading"
    >
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          data-testid="skeleton-row"
          aria-hidden="true"
          className="flex min-h-[72px] items-start gap-3 border-b px-3 py-2.5 last:border-0"
        >
          <div className="w-20 shrink-0">
            <Skeleton className="h-6 w-10 rounded-full" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
          </div>
          <div className="w-24 shrink-0">
            <Skeleton className="h-3 w-14" />
          </div>
        </div>
      ))}
    </div>
  )
}
