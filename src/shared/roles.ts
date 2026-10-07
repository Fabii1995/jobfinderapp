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

export const ROLE_LABELS: Record<Role, string> = {
  qa: 'QA',
  backend: 'Backend',
  python: 'Python',
  ai: 'AI / ML',
  'forward-deployed': 'Forward Deployed',
  frontend: 'Frontend',
  fullstack: 'Full-stack'
}
