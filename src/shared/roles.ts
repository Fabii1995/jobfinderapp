/**
 * Role taxonomy shared by main (classification, persistence) and renderer (filter UI).
 * Electron-free and dependency-free on purpose: the renderer imports this file.
 */
export const ROLES = [
  { slug: 'qa', label: 'QA' },
  { slug: 'backend', label: 'Backend' },
  { slug: 'python', label: 'Python' },
  { slug: 'ai', label: 'AI / ML' },
  { slug: 'forward-deployed', label: 'Forward Deployed' },
  { slug: 'frontend', label: 'Frontend' },
  { slug: 'fullstack', label: 'Full-stack' }
] as const

export type Role = (typeof ROLES)[number]['slug']

export const ROLE_LABELS = Object.fromEntries(ROLES.map((r) => [r.slug, r.label])) as Record<
  Role,
  string
>
