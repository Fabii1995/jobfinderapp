import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'

interface Props {
  loading: boolean
  error: boolean
  onClick: () => void
}

export function RefreshButton({ loading, error, onClick }: Props): React.JSX.Element {
  const Icon = error && !loading ? AlertCircle : RefreshCw
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            size="sm"
            variant={error && !loading ? 'outline' : 'default'}
            className={cn(error && !loading && 'border-destructive text-destructive')}
            disabled={loading}
            aria-busy={loading}
            onClick={onClick}
            data-testid="refresh-button"
          >
            <Icon className={cn(loading && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
            {loading ? 'Refreshing...' : error ? 'Retry refresh' : 'Refresh'}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>Refresh jobs (Ctrl+R)</TooltipContent>
    </Tooltip>
  )
}
