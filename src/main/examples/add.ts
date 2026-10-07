import { readFileSync } from 'node:fs'
import type { Http } from '../sources/types'
import { dbRowToFields, lookupJobsInDb, type DbJobRow } from './dbLookup'
import { experienceText, resolveUrl, type ResolvedFields } from './resolve'
import { LABELS, manualId, validateExample, type Example, type ExampleLabel } from './schema'
import { loadExamples, saveExamples, upsertExample } from './store'

export interface AddArgs {
  inputs: string[]
  label: ExampleLabel
  labelGiven: boolean
  reason?: string
  textFile?: string
  title?: string
  company?: string
  location?: string
  db?: string
  file?: string
}

export class UsageError extends Error {}

const VALUE_FLAGS = ['--label', '--reason', '--text-file', '--title', '--company', '--location', '--db', '--file']

export function parseAddArgs(argv: string[]): AddArgs {
  const out: AddArgs = { inputs: [], label: 'fit', labelGiven: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      const flag = eq >= 0 ? a.slice(0, eq) : a
      if (!VALUE_FLAGS.includes(flag)) throw new UsageError(`unknown option ${flag}`)
      const value = eq >= 0 ? a.slice(eq + 1) : argv[++i]
      if (value === undefined) throw new UsageError(`${flag} needs a value`)
      switch (flag) {
        case '--label':
          if (!LABELS.includes(value as ExampleLabel)) throw new UsageError('--label must be "fit" or "no-fit"')
          out.label = value as ExampleLabel
          out.labelGiven = true
          break
        case '--reason':
          if (value.trim()) out.reason = value.trim()
          break
        case '--text-file':
          out.textFile = value
          break
        case '--title':
          out.title = value
          break
        case '--company':
          out.company = value
          break
        case '--location':
          out.location = value
          break
        case '--db':
          out.db = value
          break
        case '--file':
          out.file = value
          break
      }
    } else out.inputs.push(a)
  }
  if (!out.inputs.length) throw new UsageError('give at least one job URL or id')
  if (out.textFile && out.inputs.length !== 1) throw new UsageError('--text-file works with exactly one URL')
  return out
}

export interface AddDeps {
  http: Http & { getText(url: string): Promise<string> }
  examplesPath: string
  now?: () => Date
  readText?: (path: string) => string
  /** Log sink (default: collected only in the result). */
  log?: (line: string) => void
}

export interface AddResult {
  lines: string[]
  /** URLs/ids that still need the user to paste job text. */
  needText: string[]
  /** Inputs that could not be turned into any entry (ids without a source, invalid URLs). */
  failed: string[]
  changed: boolean
}

const isUrl = (s: string): boolean => /^https?:\/\//i.test(s)

function finalize(fields: ResolvedFields, args: AddArgs, at: Date): Example {
  const { extraExperience, ...rest } = fields
  const e: Example = {
    ...rest,
    label: args.label,
    ...(args.reason ? { reason: args.reason } : {}),
    fetchedAt: at.toISOString(),
    company: args.company ?? rest.company,
    description: rest.description
  }
  if (!e.description.trim()) {
    e.via = 'manual'
    e.needsText = true
  }
  const exp = experienceText(e.description, extraExperience)
  if (exp) e.experienceText = exp
  return e
}

function stub(url: string, args: AddArgs, at: Date): Example {
  return {
    id: manualId(url),
    url,
    label: args.label,
    ...(args.reason ? { reason: args.reason } : {}),
    title: args.title ?? '',
    company: args.company ?? '',
    location: args.location ?? '',
    description: '',
    fetchedAt: at.toISOString(),
    via: 'manual',
    needsText: true
  }
}

function pasteHint(url: string): string {
  return `    -> paste the job text into a file and run: npm run examples:add -- "${url}" --text-file <path> (or send the text to the assistant)`
}

/** Core of `npm run examples:add`. Pure apart from the injected http/fs; throws only on a corrupt examples file. */
export async function runAdd(args: AddArgs, deps: AddDeps): Promise<AddResult> {
  const path = args.file ?? deps.examplesPath
  const now = deps.now ?? ((): Date => new Date())
  const readText = deps.readText ?? ((p: string): string => readFileSync(p, 'utf8'))
  const result: AddResult = { lines: [], needText: [], failed: [], changed: false }
  const say = (l: string): void => {
    result.lines.push(l)
    deps.log?.(l)
  }
  let list = loadExamples(path) // throws (and we never write) when the file is corrupt

  const commit = (e: Example, input: string): void => {
    const problems = validateExample(e)
    if (problems.length) {
      result.failed.push(input)
      say(`FAILED  ${input}: produced an invalid entry (${problems.join('; ')})`)
      return
    }
    const r = upsertExample(list, e, { labelGiven: args.labelGiven, reasonGiven: args.reason !== undefined })
    list = r.list
    result.changed = true
    const what = r.action === 'added' ? 'added' : r.action === 'updated' ? 'updated (already present, not duplicated)' : 'kept existing text (already present)'
    say(`OK      ${what}: [${r.entry.label}] ${r.entry.id}  ${r.entry.title || '(no title yet)'}`)
    if (r.entry.needsText) {
      result.needText.push(e.url)
      say(pasteHint(e.url))
    }
  }

  for (const input of args.inputs) {
    const at = now()
    // --- pasted text for a blocked / unsupported site ---------------------------------------
    if (args.textFile) {
      if (!isUrl(input)) {
        result.failed.push(input)
        say(`FAILED  ${input}: --text-file needs the job's URL as the identifier`)
        continue
      }
      let text: string
      try {
        text = readText(args.textFile).trim()
      } catch (e) {
        result.failed.push(input)
        say(`FAILED  ${input}: cannot read ${args.textFile} (${e instanceof Error ? e.message : String(e)})`)
        continue
      }
      if (!text) {
        result.failed.push(input)
        say(`FAILED  ${input}: ${args.textFile} is empty`)
        continue
      }
      const firstLine = text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? ''
      const e = stub(input, args, at)
      delete e.needsText
      e.description = text
      e.title = args.title ?? firstLine.slice(0, 120)
      const exp = experienceText(text)
      if (exp) e.experienceText = exp
      say(`        using pasted text from ${args.textFile} (no network request made)`)
      commit(e, input)
      continue
    }

    // --- an id rather than a URL ------------------------------------------------------------
    if (!isUrl(input)) {
      const known = list.find((e) => e.id === input)
      if (known) {
        // Re-label / re-reason an entry that is already in the file (no fetch).
        commit({ ...known, label: args.labelGiven ? args.label : known.label, ...(args.reason ? { reason: args.reason } : {}) }, input)
        continue
      }
      if (!args.db) {
        result.failed.push(input)
        say(`FAILED  ${input}: a job id alone cannot be looked up without a database. Send the job's URL, or pass --db <path to the app's jobs.sqlite>.`)
        continue
      }
      let rows: DbJobRow[]
      try {
        rows = lookupJobsInDb(args.db, input)
      } catch (e) {
        result.failed.push(input)
        say(`FAILED  ${input}: cannot read ${args.db} (${e instanceof Error ? e.message : String(e)})`)
        continue
      }
      if (rows.length !== 1) {
        result.failed.push(input)
        say(
          rows.length === 0
            ? `FAILED  ${input}: no job with that id in ${args.db}. Send the job's URL instead.`
            : `FAILED  ${input}: ${rows.length} jobs match (${rows.map((r) => `${r.source}:${r.external_id}`).join(', ')}). Use the full "<source>:<externalId>" or the URL.`
        )
        continue
      }
      commit(finalize(dbRowToFields(rows[0]), args, at), input)
      continue
    }

    // --- a URL ------------------------------------------------------------------------------
    const res = await resolveUrl(input, deps.http)
    if (res.kind === 'invalid') {
      result.failed.push(input)
      say(`FAILED  ${input}: ${res.reason}`)
      continue
    }
    if (res.kind === 'manual') {
      say(`MANUAL  ${input}`)
      say(`        ${res.reason}`)
      commit(stub(input, args, at), input)
      continue
    }
    const entry = finalize(res.fields, args, at)
    if (args.title) entry.title = args.title
    if (args.location) entry.location = args.location
    commit(entry, input)
  }

  if (result.changed) saveExamples(path, list)
  return result
}
