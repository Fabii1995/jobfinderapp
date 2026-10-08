import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Loader2, Radar } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Skeleton } from '@renderer/components/ui/skeleton'
import { useDeepSearchMutations, useDeepSearchStatus } from '@renderer/hooks/useDeepSearch'
import { useNow } from '@renderer/hooks/useNow'
import { formatUtcDate, nextMonthStart, providerName } from '@renderer/lib/jsearch'
import { formatAbsolute, formatRelative } from '@renderer/lib/time'
import {
  MAX_API_KEY_LENGTH,
  type DeepSearchProvider,
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

function Controls({ status }: { status: JSearchStatus }): React.JSX.Element {
  const mut = useDeepSearchMutations()
  const deepRefresh = mut.deepRefresh
  const now = useNow()
  const [runError, setRunError] = useState<string | null>(null)
  const sp0 = status.serpapi
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
  const served = s?.provider ?? lastProvider

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

      <p data-testid="deepsearch-last-run" className="text-xs text-muted-foreground">
        {Number.isFinite(lastAt) && s ? (
          <>
            Last run <span title={formatAbsolute(lastAt)}>{formatRelative(lastAt, now)}</span>
            {served ? ` via ${providerName(served)}` : ''}: {s.fetched} found, {s.kept} kept,{' '}
            {s.inserted} new, {s.updated} updated, {s.skippedDuplicates} already known,{' '}
            {s.requests} requests.
          </>
        ) : (
          'Not run yet.'
        )}{' '}
        Also runs about once a week automatically. It does not run on the 3-hour refresh.
      </p>
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
