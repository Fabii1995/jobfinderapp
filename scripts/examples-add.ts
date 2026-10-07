// Dev-only: npm run examples:add -- <url-or-id>... [--label fit|no-fit] [--reason "..."] [--text-file path] [--db path]
// Logic lives in src/main/examples (unit-tested); this file only wires argv, real HTTP and the real file.
import { resolve } from 'node:path'
import { UsageError, parseAddArgs, runAdd } from '../src/main/examples/add'
import { createPoliteHttp } from '../src/main/examples/fetcher'

async function main(): Promise<void> {
  const args = parseAddArgs(process.argv.slice(2))
  const examplesPath = resolve(__dirname, '..', 'training-data', 'examples.json')
  const res = await runAdd(args, { http: createPoliteHttp(), examplesPath, log: (l) => console.log(l) })
  if (res.needText.length) {
    console.log(
      `\n${res.needText.length} job(s) need the job text pasted by you (nothing was fetched from those sites):\n` +
        res.needText.map((u) => `  - ${u}`).join('\n')
    )
  }
  if (res.failed.length) process.exitCode = 1
}

main().catch((e) => {
  console.error(e instanceof UsageError ? `Usage error: ${e.message}` : `ERROR: ${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 2
})
