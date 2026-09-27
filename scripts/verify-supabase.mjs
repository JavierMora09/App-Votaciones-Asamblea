import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function parseCsvLine(line) {
  const values = []
  let value = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1 } else { quoted = !quoted }
    } else if (character === ',' && !quoted) { values.push(value); value = '' } else { value += character }
  }
  values.push(value)
  return values
}

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
  const separator = line.indexOf('=')
  return [line.slice(0, separator), line.slice(separator + 1)]
}))
const [headers, firstRecord] = fs.readFileSync('private/parcelas_importables.csv', 'utf8').trim().split(/\r?\n/)
const record = Object.fromEntries(parseCsvLine(headers).map((header, index) => [header, parseCsvLine(firstRecord)[index] ?? '']))
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY)
const { data, error } = await supabase.rpc('start_voter_session', { p_document: record.document_number, p_parcel_code: record.parcel_code })

if (error || !data?.[0]) {
  console.log(`VALIDACION_PUBLICA: ERROR - ${error?.message ?? 'Sin respuesta'}`)
  process.exitCode = 1
} else {
  console.log('VALIDACION_PUBLICA: OK')
  console.log(`PARCELAS_EN_SESION: ${data[0].parcels.length}`)
}
