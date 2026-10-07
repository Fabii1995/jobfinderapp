// Dev-only: probes candidate ATS slugs and reports Israel postings + junior-ish hits. Not part of the app or vitest.
import { makeCompanyEntry } from '../src/main/companies/validate'
import { isKeepableLocation } from '../src/main/location'
import { scoreJob } from '../src/main/scoring'
import { fetchCompany } from '../src/main/sources'
import { mapLimit } from '../src/main/sources/http'

const cands: Array<[string, string, Record<string, string>]> = []
const gh = process.argv[2]?.split(',') ?? []
const lv = process.argv[3]?.split(',') ?? []
const ab = process.argv[4]?.split(',') ?? []
const sr = process.argv[5]?.split(',') ?? []
for (const s of gh.filter(Boolean)) cands.push([s, 'greenhouse', { token: s }])
for (const s of lv.filter(Boolean)) cands.push([s, 'lever', { slug: s }])
for (const s of ab.filter(Boolean)) cands.push([s, 'ashby', { name: s }])
for (const s of sr.filter(Boolean)) cands.push([s, 'smartrecruiters', { id: s }])

async function main(): Promise<void> {
  const rows = await mapLimit(cands, 4, async ([name, ats, params]) => {
    try {
      const e = makeCompanyEntry({ name, ats, params })
      const jobs = await fetchCompany(e, undefined, 150)
      const il = jobs.filter(isKeepableLocation)
      const kept = il.filter((j) => scoreJob(j) >= 30)
      const junior = kept.filter((j) => scoreJob(j) >= 40)
      return `${ats}:${name}\tfetched=${jobs.length}\tIL=${il.length}\tkept=${kept.length}\tjunior40+=${junior.length}`
    } catch (err) {
      return `${ats}:${name}\tERR ${(err instanceof Error ? err.message : String(err)).slice(0, 60)}`
    }
  })
  console.log(rows.join('\n'))
}
void main()
