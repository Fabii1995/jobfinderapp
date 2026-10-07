import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { canonicalUrl, parseExamplesFile, type Example } from './schema'

/** Missing file = no examples. An unparseable/invalid file THROWS (and is never overwritten). */
export function loadExamples(path: string): Example[] {
  if (!existsSync(path)) return []
  return parseExamplesFile(readFileSync(path, 'utf8'))
}

/** Atomic-ish write: temp file then rename, so a crash cannot leave a half-written examples.json. */
export function saveExamples(path: string, examples: Example[]): void {
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(examples, null, 2) + '\n', 'utf8')
  renameSync(tmp, path)
}

export type UpsertAction = 'added' | 'updated' | 'unchanged-kept-existing'

export interface UpsertOptions {
  /** True only when the user passed --label; otherwise an existing entry keeps its label. */
  labelGiven: boolean
  /** True only when the user passed --reason; otherwise an existing entry keeps its reason. */
  reasonGiven: boolean
}

export function findExisting(list: Example[], incoming: Pick<Example, 'id' | 'url'>): number {
  const key = canonicalUrl(incoming.url)
  return list.findIndex((e) => e.id === incoming.id || (e.url && canonicalUrl(e.url) === key))
}

/**
 * Idempotent add: the same posting (same id, or same canonical URL) is never duplicated. On re-add the
 * listing fields are refreshed but the user's existing label/reason are kept unless they were passed again.
 * A text-less stub never overwrites an entry that already has job text.
 */
export function upsertExample(
  list: Example[],
  incoming: Example,
  opts: UpsertOptions
): { list: Example[]; action: UpsertAction; entry: Example } {
  const i = findExisting(list, incoming)
  if (i < 0) return { list: [...list, incoming], action: 'added', entry: incoming }
  const old = list[i]
  const label = opts.labelGiven ? incoming.label : old.label
  const reason = opts.reasonGiven ? incoming.reason : old.reason
  const base = incoming.needsText && !old.needsText ? old : incoming
  const merged: Example = { ...base, label }
  if (reason !== undefined) merged.reason = reason
  else delete merged.reason
  const next = [...list]
  next[i] = merged
  return { list: next, action: base === old ? 'unchanged-kept-existing' : 'updated', entry: merged }
}
