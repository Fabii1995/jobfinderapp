// Dev-only: npm run examples:report -- [--file path]. Scores every example with the CURRENT scoring.ts.
import { resolve } from 'node:path'
import { formatReport } from '../src/main/examples/report'
import { loadExamples } from '../src/main/examples/store'

const i = process.argv.indexOf('--file')
const path = i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : resolve(__dirname, '..', 'training-data', 'examples.json')
try {
  console.log(formatReport(loadExamples(path)))
} catch (e) {
  console.error(`ERROR: ${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 2
}
