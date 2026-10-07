import { useMemo, useState } from 'react'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Skeleton } from '@renderer/components/ui/skeleton'
import {
  useCompaniesQuery,
  useCompanyCountsQuery,
  useCompanyMutations
} from '@renderer/hooks/useCompanies'
import { useStatsQuery } from '@renderer/hooks/useJobs'
import { atsLabel } from '@renderer/lib/sources'
import type { Company } from '@renderer/lib/types'
import { cn } from '@renderer/lib/utils'

const URL_MAX = 2048
const NAME_MAX = 100

type Notice = { kind: 'ok' | 'error'; text: string } | null

function AddCompanyBox(): React.JSX.Element {
  const { add } = useCompanyMutations()
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [notice, setNotice] = useState<Notice>(null)

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    const u = url.trim()
    if (!u || add.isPending) return
    setNotice(null)
    add.mutate(
      { url: u, name: name.trim() || undefined },
      {
        onSuccess: (res) => {
          if (res.ok) {
            setNotice({
              kind: 'ok',
              text: `Added ${res.company.name} (${atsLabel(res.company.ats)}). Press Refresh to load its jobs.`
            })
            setUrl('')
            setName('')
          } else {
            setNotice({ kind: 'error', text: res.error })
          }
        },
        onError: (err) =>
          setNotice({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
      }
    )
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-2 rounded-lg border p-3" data-testid="add-company">
      <h3 className="text-sm font-semibold">Add a company</h3>
      <p className="text-xs text-muted-foreground">
        Paste the link to a company&apos;s careers board. Supported: Greenhouse, Lever, Ashby,
        SmartRecruiters, Workday and Comeet. Custom careers sites can&apos;t be read.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[16rem] flex-[3] flex-col gap-1 text-xs font-medium">
          Careers page URL
          <Input
            data-testid="add-company-url"
            type="url"
            inputMode="url"
            maxLength={URL_MAX}
            placeholder="https://boards.greenhouse.io/company"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-invalid={notice?.kind === 'error' || undefined}
            aria-describedby="add-company-notice"
            className="h-8"
          />
        </label>
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs font-medium">
          Name (optional)
          <Input
            data-testid="add-company-name"
            maxLength={NAME_MAX}
            placeholder="Detected from the link"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8"
          />
        </label>
        <Button type="submit" size="sm" disabled={!url.trim() || add.isPending} data-testid="add-company-submit">
          <Plus aria-hidden="true" /> {add.isPending ? 'Checking...' : 'Add company'}
        </Button>
      </div>
      <p
        id="add-company-notice"
        role={notice?.kind === 'error' ? 'alert' : 'status'}
        data-testid="add-company-notice"
        className={cn('min-h-4 text-xs', notice?.kind === 'error' ? 'text-destructive' : 'text-muted-foreground')}
      >
        {add.isPending ? 'Checking that the board can be reached...' : (notice?.text ?? '')}
      </p>
    </form>
  )
}

function CompanyRow({
  company,
  jobCount,
  status
}: {
  company: Company
  jobCount: number | undefined
  status: { ok: boolean; error?: string; kept?: number } | undefined
}): React.JSX.Element {
  const { remove, setEnabled } = useCompanyMutations()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = remove.isPending || setEnabled.isPending

  const handle = (res: { ok: boolean; error?: string }): void =>
    setError(res.ok ? null : (res.error ?? 'failed'))
  const onErr = (e: unknown): void => setError(e instanceof Error ? e.message : String(e))

  return (
    <li
      data-testid={`company-row-${company.id}`}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2 last:border-b-0"
    >
      <label className="flex shrink-0 items-center" title={company.enabled ? 'Enabled' : 'Disabled'}>
        <input
          type="checkbox"
          role="switch"
          checked={company.enabled}
          disabled={busy}
          aria-label={`Enable ${company.name}`}
          data-testid={`company-toggle-${company.id}`}
          className="size-4 cursor-pointer accent-primary"
          onChange={(e) =>
            setEnabled.mutate(
              { id: company.id, enabled: e.target.checked },
              { onSuccess: handle, onError: onErr }
            )
          }
        />
      </label>
      <span
        className={cn('min-w-0 flex-1 truncate text-sm font-medium', !company.enabled && 'text-muted-foreground')}
        title={company.name}
      >
        {company.name}
      </span>
      <Badge variant="outline" className="shrink-0 font-normal">
        {atsLabel(company.ats)}
      </Badge>
      <span className="w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
        {jobCount != null ? `${jobCount} ${jobCount === 1 ? 'job' : 'jobs'}` : '-'}
      </span>
      <span className="w-44 shrink-0 text-xs">
        {!company.enabled ? (
          <span className="text-muted-foreground">Disabled</span>
        ) : status == null ? (
          <span className="text-muted-foreground">Not refreshed yet</span>
        ) : status.ok ? (
          <span className="text-muted-foreground">OK, {status.kept ?? 0} kept last refresh</span>
        ) : (
          <span className="flex items-center gap-1 text-destructive" title={status.error}>
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">Failed: {status.error ?? 'unknown error'}</span>
          </span>
        )}
      </span>
      {confirming ? (
        <span className="flex shrink-0 items-center gap-1">
          <Button
            variant="destructive"
            size="xs"
            disabled={busy}
            data-testid={`company-remove-confirm-${company.id}`}
            aria-label={`Confirm remove ${company.name}`}
            onClick={() => remove.mutate(company.id, { onSuccess: handle, onError: onErr })}
          >
            Remove
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </span>
      ) : (
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0"
          aria-label={`Remove ${company.name}`}
          data-testid={`company-remove-${company.id}`}
          onClick={() => setConfirming(true)}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      )}
      {error && (
        <p role="alert" className="basis-full text-xs text-destructive">
          {error}
        </p>
      )}
    </li>
  )
}

export function CompaniesPanel(): React.JSX.Element {
  const listQ = useCompaniesQuery()
  const { data: counts } = useCompanyCountsQuery()
  const { data: stats } = useStatsQuery()

  const statusById = useMemo(
    () => new Map((stats?.lastRefresh?.sources ?? []).map((s) => [s.source, s])),
    [stats]
  )
  const companies = useMemo(
    () => [...(listQ.data?.companies ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [listQ.data]
  )
  const enabledCount = companies.filter((c) => c.enabled).length

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="companies-panel">
      <AddCompanyBox />
      {listQ.data?.error && (
        <Alert variant="destructive" data-testid="companies-error">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>Company list problem</AlertTitle>
          <AlertDescription>
            <p>{listQ.data.error}</p>
            <p>Showing the built-in list. Changes are disabled until the file is fixed or deleted.</p>
          </AlertDescription>
        </Alert>
      )}
      <p className="text-xs text-muted-foreground" data-testid="companies-summary">
        {listQ.data
          ? `${enabledCount} of ${companies.length} companies enabled. Disabled companies are skipped on refresh; their saved jobs stay.`
          : ' '}
      </p>
      {listQ.isError && !listQ.data ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn&apos;t load companies</AlertTitle>
        </Alert>
      ) : !listQ.data ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <ul
          aria-label="Companies"
          className="max-h-[60vh] min-h-[260px] flex-1 overflow-y-auto rounded-lg border"
          data-testid="companies-list"
        >
          {companies.map((c) => (
            <CompanyRow
              key={c.id}
              company={c}
              jobCount={counts?.[c.name]}
              status={statusById.get(c.id)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
