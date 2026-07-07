export type PhaseUnit = 'degrees' | 'radians'

export const phaseUnitOptions = [
  { value: 'degrees', label: 'Degrees (\u00b0)' },
  { value: 'radians', label: 'Radians (rad)' },
]

export function radToDeg(rad: number): number {
  return rad * 180 / Math.PI
}

export function degToRad(deg: number): number {
  return deg * Math.PI / 180
}

export function phaseToDisplay(phaseRad: number, unit: PhaseUnit): number {
  return unit === 'degrees' ? radToDeg(phaseRad) : phaseRad
}

export function phaseFromDisplay(value: number, unit: PhaseUnit): number {
  return unit === 'degrees' ? degToRad(value) : value
}

export function phaseInputStep(unit: PhaseUnit): number {
  return unit === 'degrees' ? 1 : 0.01
}

export function phaseUnitName(unit: PhaseUnit): string {
  return unit === 'degrees' ? 'degrees' : 'radians'
}

export function phaseUnitSymbol(unit: PhaseUnit): string {
  return unit === 'degrees' ? '\u00b0' : 'rad'
}

export function formatParameterNumber(value: number): string {
  if (!Number.isFinite(value)) return ''
  return Number(value.toPrecision(12)).toString()
}

export function formatPhaseForUnit(phaseRad: number, unit: PhaseUnit): string {
  return formatParameterNumber(phaseToDisplay(phaseRad, unit))
}

function splitParameterRow(line: string): string[] {
  return line
    .split(/[,\t;]/)
    .map((cell) => cell.trim().replace(/^"|"$/g, ''))
}

function parseNumber(value: string | undefined): number | null {
  if (value == null) return null
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? parsed : null
}

export function parseParameterFields(text: string): Record<string, string> {
  const kv: Record<string, string> = {}
  const lines = text.split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    if (val !== '') kv[key] = val
  }

  const csvRows = lines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.includes('='))
    .map(splitParameterRow)
    .filter((row) => row.length >= 2)

  for (const row of csvRows) {
    if (row[0] && row[1] && Number.isNaN(Number(row[0]))) {
      kv[row[0]] = row[1]
    }
  }

  if (csvRows.length >= 2 && csvRows[0].length > 2 && csvRows[1].length > 2) {
    const header = csvRows[0]
    const values = csvRows[1]
    if (header.some((cell) => Number.isNaN(Number(cell)))) {
      for (let i = 0; i < header.length; i++) {
        if (header[i] && values[i]) kv[header[i]] = values[i]
      }
    }
  }

  return kv
}

export function parseParameterValues(text: string): Record<string, number> {
  const fields = parseParameterFields(text)
  const values: Record<string, number> = {}
  for (const [key, value] of Object.entries(fields)) {
    const parsed = parseNumber(value)
    if (parsed != null) values[key] = parsed
  }
  return values
}
