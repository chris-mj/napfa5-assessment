#!/usr/bin/env node
// Build precomputed IPPT-3 lookup tables from CSVs for fastest runtime evaluation.
// Reads CSVs in ./public and writes ./src/data/ippt3_tables.js

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const pubDir = path.join(root, 'public')
const outDir = path.join(root, 'src', 'data')
const outFile = path.join(outDir, 'ippt3_tables.js')

function readCsv(p) {
  const txt = fs.readFileSync(p, 'utf8')
  const lines = txt.trim().split(/\r?\n/)
  const headers = lines[0].split(',').map(s=>s.trim())
  const rows = []
  for (let i=1;i<lines.length;i++){
    const parts = lines[i].split(',')
    if (parts.length < headers.length) continue
    const obj = {}
    headers.forEach((h, idx) => { obj[h] = parts[idx] })
    rows.push(obj)
  }
  return rows
}

function toSeconds(mmss){
  if (!mmss) return null
  const [m,s] = String(mmss).split(':').map(Number)
  if (!Number.isFinite(m) || !Number.isFinite(s)) return null
  return m*60 + s
}

function normSexKey(sex){
  const s = String(sex||'').toLowerCase()
  return s.startsWith('f') ? 'female' : 'male'
}

function buildTables(sitRows, pushRows, runRows){
  const genders = ['male','female']
  const tables = {
    situps: { male: { byAge:{}, minAge: Infinity, maxAge: -Infinity }, female: { byAge:{}, minAge: Infinity, maxAge: -Infinity } },
    pushups:{ male: { byAge:{}, minAge: Infinity, maxAge: -Infinity }, female: { byAge:{}, minAge: Infinity, maxAge: -Infinity } },
    run:    { male: { byAge:{}, minAge: Infinity, maxAge: -Infinity, maxSec: 0 }, female: { byAge:{}, minAge: Infinity, maxAge: -Infinity, maxSec: 0 } },
  }

  for (const sex of genders){
    const sRows = sitRows.filter(r=> normSexKey(r.gender)===sex)
    const pRows = pushRows.filter(r=> normSexKey(r.gender)===sex)
    const rRows = runRows.filter(r=> normSexKey(r.gender)===sex)
    const minA = Math.min(...sRows.map(r=>+r.age_min), ...pRows.map(r=>+r.age_min), ...rRows.map(r=>+r.age_min))
    const maxA = Math.max(...sRows.map(r=>+r.age_max), ...pRows.map(r=>+r.age_max), ...rRows.map(r=>+r.age_max))
    tables.situps[sex].minAge = minA; tables.situps[sex].maxAge = maxA
    tables.pushups[sex].minAge = minA; tables.pushups[sex].maxAge = maxA
    tables.run[sex].minAge = minA; tables.run[sex].maxAge = maxA
    const maxSec = rRows.length ? Math.max(...rRows.map(r=> +r.max_s)) : 0
    tables.run[sex].maxSec = maxSec

    for (let age=minA; age<=maxA; age++){
      const sBand = sRows.filter(r=> age>=+r.age_min && age<=+r.age_max)
      const pBand = pRows.filter(r=> age>=+r.age_min && age<=+r.age_max)
      const rBand = rRows.filter(r=> age>=+r.age_min && age<=+r.age_max)

      const sArr = new Array(61).fill(0)
      for (let reps=0; reps<=60; reps++){
        let best=0
        for (const r of sBand){ if (reps >= +r.performance_reps) best = Math.max(best, +r.score) }
        sArr[reps]=best
      }
      tables.situps[sex].byAge[String(age)] = sArr

      const pArr = new Array(61).fill(0)
      for (let reps=0; reps<=60; reps++){
        let best=0
        for (const r of pBand){ if (reps >= +r.performance_reps) best = Math.max(best, +r.score) }
        pArr[reps]=best
      }
      tables.pushups[sex].byAge[String(age)] = pArr

      const rArr = new Array(maxSec+1).fill(0)
      let bestScore = 0
      let minBandMin = Number.POSITIVE_INFINITY
      for (const rr of rBand){ bestScore = Math.max(bestScore, +rr.score); minBandMin = Math.min(minBandMin, +rr.min_s) }
      for (const rr of rBand){
        const lo = Math.max(0, +rr.min_s); const hi = Math.min(maxSec, +rr.max_s)
        for (let s=lo; s<=hi; s++){ if (+rr.score > rArr[s]) rArr[s] = +rr.score }
      }
      if (Number.isFinite(minBandMin)){
        for (let s=0; s<Math.max(0, Math.min(minBandMin, rArr.length)); s++) rArr[s] = Math.max(rArr[s], bestScore)
      }
      tables.run[sex].byAge[String(age)] = rArr
    }
  }
  return tables
}

function main(){
  const sitCsv = path.join(pubDir, 'ippt3_standards_situp.csv')
  const pushCsv = path.join(pubDir, 'ippt3_standards_pushup.csv')
  const runCsv = path.join(pubDir, 'ippt3_standards_2p4.csv')
  if (!fs.existsSync(sitCsv) || !fs.existsSync(pushCsv) || !fs.existsSync(runCsv)){
    console.error('Missing IPPT-3 CSVs in public/.'); process.exit(1)
  }
  const sitRaw = readCsv(sitCsv)
  const pushRaw = readCsv(pushCsv)
  const runRaw = readCsv(runCsv).map(r=> ({
    gender: r.gender,
    age_min: +r.age_min,
    age_max: +r.age_max,
    min_s: toSeconds(r.run_min),
    max_s: toSeconds(r.run_max),
    score: +r.score,
  }))

  const tables = buildTables(sitRaw, pushRaw, runRaw)

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const header = `// GENERATED FILE. Built from CSVs in /public by scripts/build-ippt3-tables.mjs\n`+
                 `// Do not edit manually. Commit this file for fastest runtime lookups.\n\n`
  const body = `export default ${JSON.stringify(tables)}\n`
  fs.writeFileSync(outFile, header + body, 'utf8')
  console.log('Wrote', path.relative(root, outFile))
}

main()

