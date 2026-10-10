import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Loader2, Radar, RotateCcw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { useDeepSearchMutations, useDeepSearchStatus, useDroppedList } from '@renderer/hooks/useDeepSearch'
import { useNow } from '@renderer/hooks/useNow'
import {
  cleanDroppedText,
  DROPPED_FILTER_OPTIONS,
  droppedLiveText,
  filterDropped,
  formatDroppedScore,
  formatDroppedTime,
  formatLastRun,
  formatUtcDate,
  nextMonthStart,
  providerName,
  reasonLabel,
  type DroppedFilter
} from '@renderer/lib/jsearch'
import { formatAbsolute, formatRelative } from '@renderer/lib/time'
import {
  MAX_API_KEY_LENGTH,
  type DeepSearchProvider,
  type DroppedJob,
  type JSearchSetKeyResult,
  type JSearchStatus
} from '@renderer/lib/types'
import { cn } from '@renderer/lib/utils'

const EXPLAINER =
  'Optional. Adds extra junior roles found through the JSearch (OpenWebNinja) service using your own free API key. Many results are LinkedIn links: the app only saves the link and opens it in your browser (LinkedIn may ask you to sign in). It never loads or reads LinkedIn itself. Runs about weekly and when you press Deep refresh, not on the 3-hour refresh. Your keys are stored only on this computer.'

const FALLBACK_NOTE =
  'SerpApi (Google Jobs) is an optional backup with its own free key. The app uses it only when JSearch is near its monthly limit, paused, or has no key. It also saves links only.'

interface KeyMutations {
  save: (key: string) => Promise<JSearchSetKeyResult>
  saving: boolean
  clear: () => void
  clearing: boolean
}

interface ProviderIds {
  /** data-testid prefix: 'deepsearch' (JSearch, legacy ids) or 'deepsearch-serpapi'. */
  tid: string
  name: string
}

function KeyForm({
  ids,
  m,
  onSaved,
  onCancel,
  autoFocus
}: {
  ids: ProviderIds
  m: KeyMutations
  onSaved: () => void
  onCancel?: () => void
  autoFocus?: boolean
}): React.JSX.Element {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    const k = value.trim()
    if (!k || m.saving) return
    setError(null)
    m.save(k).then(
      (res) => {
        if (res.ok) {
          setValue('')
          onSaved()
        } else setError(res.error)
      },
      () => setError('Could not save the key.')
    )
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-1">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-xs font-medium">
          {ids.name} API key
          <Input
            ref={ref}
            data-testid={`${ids.tid}-key-input`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            maxLength={MAX_API_KEY_LENGTH}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && onCancel) onCancel()
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${ids.tid}-key-notice`}
            className="h-8"
          />
        </label>
        <Button
          type="submit"
          size="sm"
          disabled={!value.trim() || m.saving}
          data-testid={`${ids.tid}-key-save`}
          aria-label={`${m.saving ? 'Saving' : 'Save key'}, ${ids.name}`}
        >
          {m.saving ? 'Saving...' : 'Save key'}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Cancel, ${ids.name}`}
            onClick={onCancel}
          >
            Cancel
          </Button>
        )}
      </div>
      <p id={`${ids.tid}-key-notice`} role="alert" className="min-h-4 text-xs text-destructive">
        {error ?? ''}
      </p>
    </form>
  )
}

/** Key state line + Replace/Remove (configured) or the entry form (not configured). */
function KeyControls({
  ids,
  m,
  configured,
  blocked
}: {
  ids: ProviderIds
  m: KeyMutations
  configured: boolean
  blocked: boolean
}): React.JSX.Element {
  const [replacing, setReplacing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [focusInput, setFocusInput] = useState(false)
  const replaceBtn = useRef<HTMLButtonElement>(null)
  const removeBtn = useRef<HTMLButtonElement>(null)
  const confirmBtn = useRef<HTMLButtonElement>(null)
  const pendingFocus = useRef<'replace' | 'remove' | 'confirm' | null>(null)
  // Runs after every render: focuses the requested button once it has mounted.
  useEffect(() => {
    const want = pendingFocus.current
    if (!want) return
    const el = { replace: replaceBtn, remove: removeBtn, confirm: confirmBtn }[want].current
    if (el) {
      el.focus()
      pendingFocus.current = null
    }
  })

  let content: React.JSX.Element
  if (!configured) {
    content = (
      <>
        <p data-testid={`${ids.tid}-key-state`} className="text-sm text-muted-foreground">
          No key
        </p>
        <KeyForm
          ids={ids}
          m={m}
          autoFocus={focusInput}
          onSaved={() => {
            setFocusInput(false)
            pendingFocus.current = 'replace'
            setNotice('Key saved.')
          }}
        />
      </>
    )
  } else if (replacing) {
    content = (
      <KeyForm
        ids={ids}
        m={m}
        autoFocus
        onSaved={() => {
          setReplacing(false)
          setNotice('Key saved.')
          pendingFocus.current = 'replace'
        }}
        onCancel={() => {
          setReplacing(false)
          pendingFocus.current = 'replace'
        }}
      />
    )
  } else {
    content = (
      <div className="flex flex-wrap items-center gap-2">
        <p data-testid={`${ids.tid}-key-state`} className="flex items-center gap-1 text-sm">
          <Check className="size-4" aria-hidden="true" /> Key set
        </p>
        <Button
          ref={replaceBtn}
          variant={blocked ? 'default' : 'outline'}
          size="sm"
          data-testid={`${ids.tid}-key-replace`}
          aria-label={`Replace key, ${ids.name}`}
          onClick={() => {
            setNotice(null)
            setReplacing(true)
          }}
        >
          Replace key
        </Button>
        {confirming ? (
          <span className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground">Saved jobs stay.</span>
            <Button
              ref={confirmBtn}
              variant="destructive"
              size="sm"
              disabled={m.clearing}
              aria-label={`Remove, ${ids.name}`}
              data-testid={`${ids.tid}-key-remove-confirm`}
              onClick={() => {
                m.clear()
                setConfirming(false)
                setFocusInput(true)
                setNotice(`Key removed. ${ids.name} is off.`)
              }}
            >
              Remove
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Cancel, ${ids.name}`}
              onClick={() => {
                setConfirming(false)
                pendingFocus.current = 'remove'
              }}
            >
              Cancel
            </Button>
          </span>
        ) : (
          <Button
            ref={removeBtn}
            variant="ghost"
            size="sm"
            aria-label={`Remove key, ${ids.name}`}
            data-testid={`${ids.tid}-key-remove`}
            onClick={() => {
              setConfirming(true)
              pendingFocus.current = 'confirm'
            }}
          >
            Remove key
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {content}
      <p role="status" className="min-h-4 text-xs text-muted-foreground">
        {notice}
      </p>
    </div>
  )
}

function Quota({
  tid,
  label,
  used,
  limit,
  unit,
  children
}: {
  tid: string
  label: string
  used: number
  limit: number
  unit: string
  children: React.ReactNode
}): React.JSX.Element {
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100))
  const barColor = pct >= 100 ? 'bg-destructive' : pct >= 80 ? 'bg-score-possible-fg' : 'bg-primary'
  return (
    <div data-testid={tid} className="flex flex-col gap-1 text-xs tabular-nums">
      <p>
        <strong>
          {used} / {limit} this month
        </strong>{' '}
        {children}
      </p>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        aria-valuetext={`${used} of ${limit} ${unit} used this month`}
        className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
      >
        <div
          className={cn('h-full transition-[width] motion-reduce:transition-none', barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function StatusAlerts({
  tid,
  name,
  blocked,
  reason,
  blockedUntil,
  atLimit,
  resetDate,
  now
}: {
  tid: string
  name: string
  blocked: boolean
  reason: string | null
  blockedUntil: string | null
  atLimit: boolean
  resetDate: string
  now: number
}): React.JSX.Element | null {
  const until = blockedUntil ? Date.parse(blockedUntil) : NaN
  const untilFuture = Number.isFinite(until) && until > now
  if (blocked) {
    return (
      <Alert data-testid={`${tid}-blocked`}>
        <AlertTriangle aria-hidden="true" />
        <AlertTitle>{name} is paused</AlertTitle>
        <AlertDescription>
          <p>{reason ?? 'The service reported a problem.'}</p>
          <p title={untilFuture ? formatAbsolute(until) : undefined}>
            {untilFuture
              ? `It turns back on ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(until)}.`
              : 'It will retry on the next scheduled run.'}
          </p>
        </AlertDescription>
      </Alert>
    )
  }
  if (atLimit) {
    return (
      <Alert data-testid={`${tid}-limit`}>
        <AlertTriangle aria-hidden="true" />
        <AlertTitle>{name}: monthly limit reached</AlertTitle>
        <AlertDescription>Available again on {resetDate}.</AlertDescription>
      </Alert>
    )
  }
  return null
}

function whyNotJSearch(status: JSearchStatus): string {
  if (!status.configured) return 'JSearch has no key'
  if (status.blocked) return 'JSearch is paused'
  if (status.used >= status.softLimit) return 'JSearch reached its monthly limit'
  return `JSearch is near its monthly limit (${status.used} of ${status.softLimit} used)`
}

function activeText(status: JSearchStatus, resetDate: string): string {
  switch (status.activeProvider) {
    case 'jsearch':
      return 'Next run uses JSearch.'
    case 'serpapi':
      return `Next run uses SerpApi (Google Jobs) because ${whyNotJSearch(status)}.`
    default:
      if (!status.configured && !status.serpapi.configured) return 'Add a key to use Deep refresh.'
      if (status.blocked || status.serpapi.blocked) return 'Paused, see above.'
      return `No search available: monthly limits reached. Available again ${resetDate}.`
  }
}

function ClearSeen({
  running,
  runButtonRef
}: {
  running: boolean
  runButtonRef: React.RefObject<HTMLButtonElement | null>
}): React.JSX.Element {
  const { clearSeen } = useDeepSearchMutations()
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const pending = clearSeen.isPending

  useEffect(() => {
    if (open) confirmRef.current?.focus()
  }, [open])

  // Clear the local message when a deep refresh starts ("until the next run/clear").
  useEffect(() => {
    if (running) {
      setNotice('')
      setError('')
    }
  }, [running])

  const returnFocus = (): void => {
    // Wait for the confirm to unmount / the trigger to re-enable before moving focus.
    requestAnimationFrame(() => {
      const t = triggerRef.current
      if (t && !t.disabled) t.focus()
      else runButtonRef.current?.focus()
    })
  }

  const close = (): void => {
    setOpen(false)
    returnFocus()
  }

  const confirm = (): void => {
    if (running || pending) return
    setNotice('')
    setError('')
    clearSeen.mutate(undefined, {
      onSuccess: (res) => {
        if (res.ok) setNotice(`Cleared ${res.cleared} remembered ${res.cleared === 1 ? 'job' : 'jobs'}`)
        else setError(res.error)
        setOpen(false)
        returnFocus()
      },
      onError: () => {
        setError('Could not clear seen jobs.')
        setOpen(false)
        returnFocus()
      }
    })
  }

  return (
    <div className="flex flex-col gap-2">
      {open ? (
        <div
          id="deepsearch-clear-seen-confirm"
          role="group"
          aria-labelledby="deepsearch-clear-seen-title"
          data-testid="deepsearch-clear-seen-confirm"
          className="flex flex-col gap-2 rounded-md border p-2"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !pending) {
              e.stopPropagation()
              close()
            }
          }}
        >
          <p id="deepsearch-clear-seen-title" className="text-xs font-medium">
            Clear remembered jobs?
          </p>
          <p className="text-xs text-muted-foreground">
            The next deep refresh will look at every job the search returns again, including jobs it
            rejected earlier under older rules, so some may now be added. This does not reset the
            monthly request counter, unblock a paused provider, touch your keys, or change or delete
            any saved jobs. Clearing itself uses no requests.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              ref={confirmRef}
              size="sm"
              variant="default"
              aria-label={pending ? undefined : 'Clear seen jobs, confirm'}
              aria-busy={pending || undefined}
              aria-describedby={running ? 'deepsearch-clear-seen-hint' : undefined}
              disabled={running || pending}
              onClick={confirm}
            >
              {pending && (
                <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
              )}
              {pending ? 'Clearing...' : 'Clear'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Cancel, clear seen jobs"
              disabled={pending}
              onClick={close}
            >
              Cancel
            </Button>
          </div>
          {running && (
            <p id="deepsearch-clear-seen-hint" className="text-xs text-muted-foreground">
              Available when the deep refresh finishes.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            ref={triggerRef}
            size="sm"
            variant="outline"
            data-testid="deepsearch-clear-seen"
            aria-expanded={false}
            aria-controls="deepsearch-clear-seen-confirm"
            aria-describedby={running ? 'deepsearch-clear-seen-hint' : undefined}
            disabled={running}
            onClick={() => {
              setNotice('')
              setError('')
              setOpen(true)
            }}
          >
            <RotateCcw aria-hidden="true" />
            Clear seen jobs
          </Button>
          {running && (
            <span id="deepsearch-clear-seen-hint" className="text-xs text-muted-foreground">
              Available when the deep refresh finishes.
            </span>
          )}
        </div>
      )}
      <p
        role="status"
        data-testid="deepsearch-clear-seen-notice"
        className="text-xs text-muted-foreground empty:hidden"
      >
        {notice}
      </p>
      <p
        role="alert"
        data-testid="deepsearch-clear-seen-error"
        className="text-xs text-destructive empty:hidden"
      >
        {error}
      </p>
    </div>
  )
}

function DroppedRow({ job, now }: { job: DroppedJob; now: number }): React.JSX.Element {
  const title = cleanDroppedText(job.title) || 'Untitled'
  const company = cleanDroppedText(job.company)
  const location = cleanDroppedText(job.location)
  const when = formatDroppedTime(job.runAt, now)
  const segments: React.ReactNode[] = []
  if (company) segments.push(<span key="c">{company}</span>)
  if (location) segments.push(<span key="l">{location}</span>)
  segments.push(<span key="r">Reason: {reasonLabel(job.reason)}</span>)
  if (when) {
    segments.push(
      <span key="t" title={job.runAt}>
        {when}
      </span>
    )
  }
  segments.push(<span key="p">{providerName(job.provider)}</span>)
  return (
    <li data-testid="deepsearch-dropped-row" className="flex flex-col gap-0.5 px-2 py-1.5 text-xs">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate font-medium" title={title}>
          {title}
        </span>
        <span className="shrink-0 tabular-nums">{formatDroppedScore(job.score)}</span>
      </div>
      <div className="flex flex-wrap gap-x-2 text-muted-foreground">
        {segments.map((seg, i) => (
          <span key={i} className="flex gap-x-2">
            {i > 0 && <span aria-hidden="true">&middot;</span>}
            {seg}
          </span>
        ))}
      </div>
    </li>
  )
}

function DroppedSection({ running }: { running: boolean }): React.JSX.Element {
  const q = useDroppedList()
  const now = useNow()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<DroppedFilter>('all')
  const [live, setLive] = useState('')
  const list = q.data
  const total = list?.length ?? 0
  const rows = filterDropped(list, filter)
  const seen = useRef<unknown>(undefined)

  // Announce only when a run (or other refetch) changes the data after mount, never on first load.
  useEffect(() => {
    if (!list) return
    if (seen.current === undefined) {
      seen.current = list
      return
    }
    if (seen.current !== list) {
      seen.current = list
      setLive(droppedLiveText(list.length, filterDropped(list, filter).length, filter, open))
    }
  }, [list, filter, open])

  return (
    <div data-testid="deepsearch-dropped" className="flex flex-col gap-2">
      <h4 className="text-xs font-semibold">
        <button
          type="button"
          id="deepsearch-dropped-toggle"
          data-testid="deepsearch-dropped-toggle"
          aria-expanded={open}
          aria-controls="deepsearch-dropped-panel"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1 rounded-md outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {open ? (
            <ChevronDown className="size-3.5" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-3.5" aria-hidden="true" />
          )}
          Recently dropped ({total})
        </button>
      </h4>
      <div
        id="deepsearch-dropped-live"
        data-testid="deepsearch-dropped-live"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {live}
      </div>
      <div
        id="deepsearch-dropped-panel"
        role="region"
        aria-labelledby="deepsearch-dropped-toggle"
        aria-busy={running || undefined}
        hidden={!open}
        className="flex flex-col gap-2"
      >
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="deepsearch-dropped-filter" className="text-xs">
            Reason
          </label>
          <select
            id="deepsearch-dropped-filter"
            data-testid="deepsearch-dropped-filter"
            value={filter}
            disabled={total === 0}
            onChange={(e) => {
              const f = e.target.value as DroppedFilter
              setFilter(f)
              setLive(droppedLiveText(total, filterDropped(list, f).length, f, open))
            }}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 dark:border-white/30"
          >
            {DROPPED_FILTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {running && <span className="text-xs text-muted-foreground">Updating after this run...</span>}
        </div>
        <p id="deepsearch-dropped-note" className="text-xs text-muted-foreground">
          Jobs skipped as already seen are not listed (they were not re-checked). This list is kept in memory
          only and is cleared when the app restarts.
        </p>
        {q.isError ? (
          <p className="text-xs text-muted-foreground">Couldn&apos;t load the dropped list.</p>
        ) : total === 0 ? (
          <p data-testid="deepsearch-dropped-empty" className="text-xs text-muted-foreground">
            Nothing dropped in the last run, or the app was restarted since
          </p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No dropped jobs match this reason.</p>
        ) : (
          <ul
            role="list"
            tabIndex={0}
            aria-label="Recently dropped jobs"
            aria-describedby="deepsearch-dropped-note"
            data-testid="deepsearch-dropped-list"
            className="flex max-h-64 flex-col divide-y overflow-y-auto rounded-md border outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {rows.map((r, i) => (
              <DroppedRow key={`${r.runAt}-${i}`} job={r} now={now} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function Controls({ status }: { status: JSearchStatus }): React.JSX.Element {
  const mut = useDeepSearchMutations()
  const deepRefresh = mut.deepRefresh
  const now = useNow()
  const [runError, setRunError] = useState<string | null>(null)
  const sp0 = status.serpapi
  const runButtonRef = useRef<HTMLButtonElement>(null)
  const [lastProvider, setLastProvider] = useState<DeepSearchProvider | null>(null)

  useEffect(() => {
    setRunError(null)
  }, [status.configured, status.blocked, sp0.configured, sp0.blocked])

  const resetTs = nextMonthStart(status.month)
  const resetDate = resetTs != null ? formatUtcDate(resetTs) : 'next month'
  const sp = status.serpapi
  const atLimit = status.used >= status.softLimit
  const spAtLimit = sp.used >= sp.cap
  const running = deepRefresh.isPending
  const canRun = status.activeProvider !== 'none' && !running

  const lastAt = status.lastRunAt ? Date.parse(status.lastRunAt) : NaN
  const s = status.lastRunSummary
  const lines = s ? formatLastRun(s, lastProvider) : null

  const jsMut: KeyMutations = {
    save: (k) => {
      setRunError(null)
      return mut.setKey.mutateAsync(k)
    },
    saving: mut.setKey.isPending,
    clear: () => {
      setRunError(null)
      mut.clearKey.mutate()
    },
    clearing: mut.clearKey.isPending
  }
  const spMut: KeyMutations = {
    save: (k) => {
      setRunError(null)
      return mut.setSerpapiKey.mutateAsync(k)
    },
    saving: mut.setSerpapiKey.isPending,
    clear: () => {
      setRunError(null)
      mut.clearSerpapiKey.mutate()
    },
    clearing: mut.clearSerpapiKey.isPending
  }

  const run = (): void => {
    if (!canRun) return
    setRunError(null)
    deepRefresh.mutate(undefined, {
      onSuccess: (res) => {
        setRunError(res.ok ? null : res.message)
        if (res.provider) setLastProvider(res.provider)
      },
      onError: (e) => setRunError(e instanceof Error ? e.message : 'Deep refresh failed.')
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="deepsearch-jsearch-title" className="flex flex-col gap-2">
        <h4 id="deepsearch-jsearch-title" className="text-xs font-semibold">
          JSearch (OpenWebNinja)
        </h4>
        <KeyControls
          ids={{ tid: 'deepsearch', name: 'JSearch' }}
          m={jsMut}
          configured={status.configured}
          blocked={status.blocked}
        />
        {status.configured && (
          <>
            <StatusAlerts
              tid="deepsearch"
              name="JSearch"
              blocked={status.blocked}
              reason={status.blockedReason}
              blockedUntil={status.blockedUntil}
              atLimit={atLimit}
              resetDate={resetDate}
              now={now}
            />
            <Quota
              tid="deepsearch-quota"
              label="JSearch monthly requests"
              used={status.used}
              limit={status.softLimit}
              unit="requests"
            >
              Resets on {resetDate}.
            </Quota>
          </>
        )}
      </section>

      <section aria-labelledby="deepsearch-serpapi-title" className="flex flex-col gap-2">
        <h4 id="deepsearch-serpapi-title" className="text-xs font-semibold">
          SerpApi (Google Jobs), backup
        </h4>
        <p className="text-xs text-muted-foreground">{FALLBACK_NOTE}</p>
        <KeyControls
          ids={{ tid: 'deepsearch-serpapi', name: 'SerpApi' }}
          m={spMut}
          configured={sp.configured}
          blocked={sp.blocked}
        />
        {sp.configured && (
          <>
            <StatusAlerts
              tid="deepsearch-serpapi"
              name="SerpApi"
              blocked={sp.blocked}
              reason={sp.blockedReason}
              blockedUntil={sp.blockedUntil}
              atLimit={spAtLimit}
              resetDate={resetDate}
              now={now}
            />
            <Quota
              tid="deepsearch-serpapi-quota"
              label="SerpApi monthly searches"
              used={sp.used}
              limit={sp.cap}
              unit="searches"
            >
              Resets on {resetDate}.
              {status.configured && !status.blocked &&
                ` Takes over when JSearch reaches ${status.fallbackThreshold}.`}
            </Quota>
          </>
        )}
      </section>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={!canRun}
            aria-busy={running || undefined}
            aria-describedby="deepsearch-run-hint"
            data-testid="deepsearch-run"
            ref={runButtonRef}
            onClick={run}
          >
            {running ? (
              <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <Radar aria-hidden="true" />
            )}
            {running ? 'Deep refreshing...' : 'Deep refresh'}
          </Button>
          <span id="deepsearch-run-hint" role="status" className="text-xs text-muted-foreground">
            {running ? 'Searching, this can take a minute.' : activeText(status, resetDate)}
          </span>
        </div>
        {runError && (
          <p role="alert" className="text-xs text-destructive">
            {runError}
          </p>
        )}
      </div>

      <div
        data-testid="deepsearch-last-run"
        className="flex flex-col gap-0.5 text-xs text-muted-foreground"
      >
        {Number.isFinite(lastAt) && s && lines ? (
          <>
            <p>
              Last run <span title={formatAbsolute(lastAt)}>{formatRelative(lastAt, now)}</span>
              {lines.headerTail}
            </p>
            {lines.filtering && <p>{lines.filtering}</p>}
            <p>{lines.kept}</p>
          </>
        ) : (
          <p>Not run yet.</p>
        )}
        <p>Also runs about once a week automatically. It does not run on the 3-hour refresh.</p>
      </div>

      <DroppedSection running={running} />

      <ClearSeen running={running} runButtonRef={runButtonRef} />
    </div>
  )
}

export function DeepSearchPanel(): React.JSX.Element {
  const q = useDeepSearchStatus()
  const status = q.data

  const anyConfigured = !!status && (status.configured || status.serpapi.configured)
  const badge = !status ? null : !anyConfigured ? (
    <Badge variant="outline">Off</Badge>
  ) : status.activeProvider === 'none' && (status.blocked || status.serpapi.blocked) ? (
    <Badge variant="outline">
      <AlertTriangle className="size-3" aria-hidden="true" /> Paused
    </Badge>
  ) : (
    <Badge variant="outline">
      On{status.activeProvider !== 'none' ? `: ${providerName(status.activeProvider)}` : ''}
    </Badge>
  )

  return (
    <section
      aria-labelledby="deep-search-title"
      aria-busy={q.isPending || undefined}
      data-testid="deepsearch"
      className="flex flex-col gap-3 rounded-lg border p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id="deep-search-title" className="text-sm font-semibold">
          Deep search
        </h3>
        {q.isPending ? <Skeleton className="h-5 w-12" /> : badge}
      </div>
      <p className="text-xs text-muted-foreground">{EXPLAINER}</p>
      {q.isPending ? (
        <Skeleton className="h-8 w-full" />
      ) : q.isError || !status ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load Deep search status</AlertTitle>
          <AlertDescription>
            <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <Controls status={status} />
      )}
    </section>
  )
}
