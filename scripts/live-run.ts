// Dev-only live run into a SCRATCH sqlite file (never %APPDATA%). Usage: npx tsx scripts/live-run.ts [dbPath]
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedCompanies } from '../src/main/companies/seeds'
import { openDb } from '../src/main/db'
import { refreshJobs } from '../src/main/ingest/refresh'

void (async () => {
  const dbPath = process.argv[2] ?? join(mkdtempSync(join(tmpdir(), 'jobfinder-scratch-')), 'scratch.db')
  if (/[\/]Roaming[\/]/i.test(dbPath)) throw new Error('refusing to use an AppData path')
  console.log('scratch db:', dbPath)
  const { db, close } = openDb(dbPath)
  const r = await refreshJobs(db, { companies: seedCompanies() })
  for (const s of r.sources) {
    console.log(`${s.source}\t${s.ok ? `fetched=${s.count} israel=${s.israel} kept=${s.kept}` : `FAILED ${s.error}`}`)
  }
  console.log(`inserted=${r.inserted} updated=${r.updated} errors=${JSON.stringify(r.errors)}`)
  close()
  const Database = (await import('better-sqlite3')).default
  const raw = new Database(dbPath, { readonly: true })
  const total = raw.prepare('select count(*) c from jobs').get() as { c: number }
  console.log('total kept rows:', total.c)
  const rows = raw
    .prepare('select score, title, company, city, work_mode, source, url from jobs order by score desc, title limit 25')
    .all() as Array<Record<string, unknown>>
  for (const x of rows) console.log(`${x.score}\t${x.title}\t${x.company}\t${x.city ?? '-'}\t${x.work_mode}\t${x.url}`)
  const juniorish = raw.prepare("select count(*) c from jobs where score >= 40").get() as { c: number }
  console.log('score>=40:', juniorish.c)
  console.log('--- by source (kept rows)')
  for (const x of raw.prepare('select source, count(*) c, max(score) m from jobs group by source order by c desc').all() as Array<Record<string, unknown>>) console.log(x.source, x.c, x.m)
  raw.close()
})()
