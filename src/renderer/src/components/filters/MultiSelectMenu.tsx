import { ChevronDown } from 'lucide-react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'

interface Props {
  label: string
  testId: string
  options: { value: string; label: string }[]
  selected: string[]
  onToggle: (value: string) => void
}

export function MultiSelectMenu({ label, testId, options, selected, onToggle }: Props): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" data-testid={testId} aria-label={selected.length ? `${label} (${selected.length} selected)` : label}>
          {label}
          {selected.length > 0 && (
            <Badge variant="secondary" className="tabular-nums">
              {selected.length}
            </Badge>
          )}
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.length === 0 && (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">No options yet</div>
        )}
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.value}
            checked={selected.includes(o.value)}
            onCheckedChange={() => onToggle(o.value)}
            onSelect={(e) => e.preventDefault()} // keep the menu open for multi-select
          >
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
