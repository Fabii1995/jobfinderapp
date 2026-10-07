import { useEffect, useState } from 'react'

/** Current time, re-rendered every `ms` (default 30 s) so relative labels stay fresh. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(id)
  }, [ms])
  return now
}
