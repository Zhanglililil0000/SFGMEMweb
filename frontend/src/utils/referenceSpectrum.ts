export const NRMSE_EPSILON = 1e-12

export interface ReferenceSpectrum {
  name: string
  wavenumbers: number[]
  real: number[]
  imag: number[]
  pointCount: number
  frequencyRange: [number, number]
}

export interface AlignedReferenceSpectrum {
  name: string
  wavenumbers: number[]
  real: number[]
  imag: number[]
  intensity: number[]
  pointCount: number
  originalPointCount: number
  originalFrequencyRange: [number, number]
  frequencyRange: [number, number]
  method: string
  warnings: string[]
}

export interface ReferenceNrmse {
  reNrmse: number
  imNrmse: number
  complexNrmse: number
  reRmsRaw: number
  imRmsRaw: number
  complexRmsRaw: number
  pointCount: number
  warnings: string[]
}

export interface ReferenceColumnInfo {
  index: number
  name: string
}

export interface ReferenceTable {
  name: string
  columns: ReferenceColumnInfo[]
  rows: number[][]
  rowCount: number
  hasHeader: boolean
}

export interface ReferenceColumnSelection {
  wavenumber: number
  real: number
  imag: number
}

export interface ScalarReference {
  name: string
  wavenumbers: number[]
  values: number[]
  pointCount: number
  frequencyRange: [number, number]
}

export interface AlignedScalarReference {
  name: string
  wavenumbers: number[]
  values: number[]
  pointCount: number
  originalPointCount: number
  originalFrequencyRange: [number, number]
  frequencyRange: [number, number]
  method: string
  warnings: string[]
}

export interface ScalarColumnSelection {
  wavenumber: number
  value: number
}

function splitFields(line: string): string[] {
  return line.trim().split(/[,\t; ]+/).map((value) => value.trim()).filter(Boolean)
}

function parseNumber(value: string | undefined): number {
  if (value == null) return NaN
  return Number(value.trim())
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function findColumnIndex(headers: string[], fallback: number, kind: 'wavenumber' | 'real' | 'imag'): number {
  const normalized = headers.map(normalizeHeader)
  const matches = normalized.map((header, index) => ({ header, index }))

  if (kind === 'wavenumber') {
    return matches.find(({ header }) => (
      header.includes('wavenumber')
      || header === 'wn'
      || header.includes('frequency')
      || header.includes('omega')
      || header.includes('cm1')
    ))?.index ?? fallback
  }

  if (kind === 'real') {
    return matches.find(({ header }) => (
      header === 're'
      || header === 'real'
      || header === 'rechi'
      || header.startsWith('real')
      || header.startsWith('rechi')
    ))?.index ?? fallback
  }

  return matches.find(({ header }) => (
    header === 'im'
    || header === 'imag'
    || header === 'imaginary'
    || header === 'imchi'
    || header.startsWith('imag')
    || header.startsWith('imchi')
  ))?.index ?? fallback
}

function findScalarColumnIndex(headers: string[], fallback: number): number {
  const normalized = headers.map(normalizeHeader)
  return normalized.findIndex((header) => (
    header === 'intensity'
    || header === 'i'
    || header.includes('intensity')
    || header.includes('signal')
    || header.includes('abschi2')
    || header.includes('chi2')
  )) >= 0
    ? normalized.findIndex((header) => (
      header === 'intensity'
      || header === 'i'
      || header.includes('intensity')
      || header.includes('signal')
      || header.includes('abschi2')
      || header.includes('chi2')
    ))
    : fallback
}

function firstUnusedColumn(columnCount: number, used: Set<number>, fallback: number): number {
  if (fallback >= 0 && fallback < columnCount && !used.has(fallback)) return fallback
  for (let i = 0; i < columnCount; i++) {
    if (!used.has(i)) return i
  }
  return fallback
}

function sortAndAverageDuplicates(
  wavenumbers: number[],
  real: number[],
  imag: number[],
): { wavenumbers: number[]; real: number[]; imag: number[] } {
  const rows = wavenumbers.map((w, index) => ({ w, real: real[index], imag: imag[index] }))
    .sort((a, b) => a.w - b.w)

  const outW: number[] = []
  const outRe: number[] = []
  const outIm: number[] = []
  let i = 0
  while (i < rows.length) {
    const w = rows[i].w
    let count = 0
    let sumRe = 0
    let sumIm = 0
    while (i < rows.length && rows[i].w === w) {
      sumRe += rows[i].real
      sumIm += rows[i].imag
      count += 1
      i += 1
    }
    outW.push(w)
    outRe.push(sumRe / count)
    outIm.push(sumIm / count)
  }
  return { wavenumbers: outW, real: outRe, imag: outIm }
}

export function parseReferenceTable(text: string, name: string): ReferenceTable {
  const lines = text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))

  if (lines.length === 0) {
    throw new Error('Reference Re/Im file is empty.')
  }

  const firstFields = splitFields(lines[0])
  const firstNumbers = firstFields.map(parseNumber)
  const hasHeader = firstFields.length >= 2 && firstNumbers.some((value) => !Number.isFinite(value))
  const dataLines = hasHeader ? lines.slice(1) : lines
  const maxDataColumns = Math.max(...dataLines.map((line) => splitFields(line).length), firstFields.length)
  const columnCount = hasHeader ? firstFields.length : maxDataColumns

  if (columnCount < 2) {
    throw new Error('Reference file must contain at least 2 columns.')
  }

  const columns: ReferenceColumnInfo[] = Array.from({ length: columnCount }, (_, index) => ({
    index,
    name: hasHeader ? (firstFields[index] ?? `Column ${index + 1}`) : `Column ${index + 1}`,
  }))

  const rows: number[][] = []
  for (const line of dataLines) {
    const fields = splitFields(line)
    const row = columns.map((_, index) => parseNumber(fields[index]))
    if (row.some((value) => Number.isFinite(value))) {
      rows.push(row)
    }
  }

  if (rows.length < 3) {
    throw new Error('Reference file must contain at least 3 numeric data rows.')
  }

  return {
    name,
    columns,
    rows,
    rowCount: rows.length,
    hasHeader,
  }
}

export function autoDetectReferenceColumns(table: ReferenceTable): ReferenceColumnSelection {
  const headers = table.columns.map((column) => column.name)
  const columnCount = table.columns.length
  const used = new Set<number>()

  const detectedWavenumber = findColumnIndex(headers, -1, 'wavenumber')
  const wavenumber = firstUnusedColumn(columnCount, used, detectedWavenumber >= 0 ? detectedWavenumber : 0)
  used.add(wavenumber)

  const detectedReal = findColumnIndex(headers, -1, 'real')
  const real = firstUnusedColumn(columnCount, used, detectedReal >= 0 ? detectedReal : 1)
  used.add(real)

  const detectedImag = findColumnIndex(headers, -1, 'imag')
  const imag = firstUnusedColumn(columnCount, used, detectedImag >= 0 ? detectedImag : 2)

  return { wavenumber, real, imag }
}

export function buildReferenceSpectrumFromTable(
  table: ReferenceTable,
  selection: ReferenceColumnSelection,
): ReferenceSpectrum {
  const selected = [selection.wavenumber, selection.real, selection.imag]
  const uniqueSelected = new Set(selected)
  if (uniqueSelected.size !== 3) {
    throw new Error('Wavenumber, Re and Im must use three different columns.')
  }
  for (const index of selected) {
    if (!Number.isInteger(index) || index < 0 || index >= table.columns.length) {
      throw new Error('Selected reference column index is out of range.')
    }
  }

  const wavenumbers: number[] = []
  const real: number[] = []
  const imag: number[] = []

  for (const row of table.rows) {
    const w = row[selection.wavenumber]
    const re = row[selection.real]
    const im = row[selection.imag]
    if (Number.isFinite(w) && Number.isFinite(re) && Number.isFinite(im)) {
      wavenumbers.push(w)
      real.push(re)
      imag.push(im)
    }
  }

  if (wavenumbers.length < 3) {
    throw new Error('Selected Wavenumber, Re and Im columns must contain at least 3 numeric rows.')
  }

  const sorted = sortAndAverageDuplicates(wavenumbers, real, imag)
  if (sorted.wavenumbers.length < 3) {
    throw new Error('Reference Re/Im file must contain at least 3 unique wavenumber points.')
  }

  return {
    name: table.name,
    wavenumbers: sorted.wavenumbers,
    real: sorted.real,
    imag: sorted.imag,
    pointCount: sorted.wavenumbers.length,
    frequencyRange: [sorted.wavenumbers[0], sorted.wavenumbers[sorted.wavenumbers.length - 1]],
  }
}

export function autoDetectScalarColumns(table: ReferenceTable): ScalarColumnSelection {
  const headers = table.columns.map((column) => column.name)
  const columnCount = table.columns.length
  const used = new Set<number>()

  const detectedWavenumber = findColumnIndex(headers, -1, 'wavenumber')
  const wavenumber = firstUnusedColumn(columnCount, used, detectedWavenumber >= 0 ? detectedWavenumber : 0)
  used.add(wavenumber)

  const detectedValue = findScalarColumnIndex(headers, -1)
  const value = firstUnusedColumn(columnCount, used, detectedValue >= 0 ? detectedValue : 1)
  return { wavenumber, value }
}

export function buildScalarReferenceFromTable(
  table: ReferenceTable,
  selection: ScalarColumnSelection,
  valueName = 'reference intensity',
): ScalarReference {
  if (selection.wavenumber === selection.value) {
    throw new Error('Wavenumber and intensity must use two different columns.')
  }
  for (const index of [selection.wavenumber, selection.value]) {
    if (!Number.isInteger(index) || index < 0 || index >= table.columns.length) {
      throw new Error('Selected reference column index is out of range.')
    }
  }

  const wavenumbers: number[] = []
  const values: number[] = []
  for (const row of table.rows) {
    const w = row[selection.wavenumber]
    const value = row[selection.value]
    if (Number.isFinite(w) && Number.isFinite(value)) {
      wavenumbers.push(w)
      values.push(value)
    }
  }

  if (wavenumbers.length < 3) {
    throw new Error(`Selected Wavenumber and ${valueName} columns must contain at least 3 numeric rows.`)
  }

  const sorted = sortAndAverageDuplicates(wavenumbers, values, values)
  if (sorted.wavenumbers.length < 3) {
    throw new Error('Reference intensity file must contain at least 3 unique wavenumber points.')
  }

  return {
    name: table.name,
    wavenumbers: sorted.wavenumbers,
    values: sorted.real,
    pointCount: sorted.wavenumbers.length,
    frequencyRange: [sorted.wavenumbers[0], sorted.wavenumbers[sorted.wavenumbers.length - 1]],
  }
}

export function parseReferenceSpectrum(text: string, name: string): ReferenceSpectrum {
  const table = parseReferenceTable(text, name)
  return buildReferenceSpectrumFromTable(table, autoDetectReferenceColumns(table))
}

function sameGrid(source: number[], target: number[]): boolean {
  if (source.length !== target.length) return false
  const range = Math.max(Math.abs(target[target.length - 1] - target[0]), 1)
  const tolerance = range * 1e-9
  return source.every((value, index) => Math.abs(value - target[index]) <= tolerance)
}

function interpolate(sourceX: number[], sourceY: number[], targetX: number[]): number[] {
  const out: number[] = []
  let j = 0
  for (const x of targetX) {
    while (j < sourceX.length - 2 && sourceX[j + 1] < x) j += 1
    const x0 = sourceX[j]
    const x1 = sourceX[j + 1]
    const y0 = sourceY[j]
    const y1 = sourceY[j + 1]
    if (Math.abs(x - x0) <= 1e-12) {
      out.push(y0)
    } else if (Math.abs(x - x1) <= 1e-12) {
      out.push(y1)
    } else {
      const t = (x - x0) / (x1 - x0)
      out.push(y0 + t * (y1 - y0))
    }
  }
  return out
}

export function alignReferenceToGrid(
  reference: ReferenceSpectrum,
  targetWavenumbers: number[],
): { aligned?: AlignedReferenceSpectrum; error?: string } {
  if (targetWavenumbers.length < 3) {
    return { error: 'MEM output grid must contain at least 3 points before reference alignment.' }
  }

  const targetStart = targetWavenumbers[0]
  const targetEnd = targetWavenumbers[targetWavenumbers.length - 1]
  const sourceStart = reference.frequencyRange[0]
  const sourceEnd = reference.frequencyRange[1]
  const range = Math.max(Math.abs(targetEnd - targetStart), Math.abs(sourceEnd - sourceStart), 1)
  const tolerance = range * 1e-9

  if (targetStart < sourceStart - tolerance || targetEnd > sourceEnd + tolerance) {
    return {
      error: `External reference range ${sourceStart} to ${sourceEnd} cm^-1 does not cover MEM grid ${targetStart} to ${targetEnd} cm^-1.`,
    }
  }

  const warnings: string[] = []
  let alignedReal: number[]
  let alignedImag: number[]
  let method: string

  if (sameGrid(reference.wavenumbers, targetWavenumbers)) {
    alignedReal = [...reference.real]
    alignedImag = [...reference.imag]
    method = 'Direct use of external reference grid'
  } else {
    alignedReal = interpolate(reference.wavenumbers, reference.real, targetWavenumbers)
    alignedImag = interpolate(reference.wavenumbers, reference.imag, targetWavenumbers)
    method = `Interpolated external reference from ${reference.pointCount} to ${targetWavenumbers.length} MEM points`
    warnings.push('External Re/Im reference was interpolated onto the MEM output grid for comparison.')
  }

  const intensity = alignedReal.map((re, index) => re * re + alignedImag[index] * alignedImag[index])

  return {
    aligned: {
      name: reference.name,
      wavenumbers: [...targetWavenumbers],
      real: alignedReal,
      imag: alignedImag,
      intensity,
      pointCount: targetWavenumbers.length,
      originalPointCount: reference.pointCount,
      originalFrequencyRange: reference.frequencyRange,
      frequencyRange: [targetStart, targetEnd],
      method,
      warnings,
    },
  }
}

export function alignScalarReferenceToGrid(
  reference: ScalarReference,
  targetWavenumbers: number[],
  label = 'External intensity reference',
): { aligned?: AlignedScalarReference; error?: string } {
  if (targetWavenumbers.length < 3) {
    return { error: 'Target grid must contain at least 3 points before reference alignment.' }
  }

  const targetStart = targetWavenumbers[0]
  const targetEnd = targetWavenumbers[targetWavenumbers.length - 1]
  const sourceStart = reference.frequencyRange[0]
  const sourceEnd = reference.frequencyRange[1]
  const range = Math.max(Math.abs(targetEnd - targetStart), Math.abs(sourceEnd - sourceStart), 1)
  const tolerance = range * 1e-9

  if (targetStart < sourceStart - tolerance || targetEnd > sourceEnd + tolerance) {
    return {
      error: `${label} range ${sourceStart} to ${sourceEnd} cm^-1 does not cover target grid ${targetStart} to ${targetEnd} cm^-1.`,
    }
  }

  const warnings: string[] = []
  let values: number[]
  let method: string
  if (sameGrid(reference.wavenumbers, targetWavenumbers)) {
    values = [...reference.values]
    method = `Direct use of ${label} grid`
  } else {
    values = interpolate(reference.wavenumbers, reference.values, targetWavenumbers)
    method = `Interpolated ${label} from ${reference.pointCount} to ${targetWavenumbers.length} target points`
    warnings.push(`${label} was interpolated onto the fitted grid for comparison.`)
  }

  return {
    aligned: {
      name: reference.name,
      wavenumbers: [...targetWavenumbers],
      values,
      pointCount: targetWavenumbers.length,
      originalPointCount: reference.pointCount,
      originalFrequencyRange: reference.frequencyRange,
      frequencyRange: [targetStart, targetEnd],
      method,
      warnings,
    },
  }
}

function rms(values: number[]): number {
  if (values.length === 0) return 0
  let sumSq = 0
  for (const value of values) sumSq += value * value
  return Math.sqrt(sumSq / values.length)
}

export function computeNrmseAgainstReference(
  memReal: number[],
  memImag: number[],
  referenceReal: number[],
  referenceImag: number[],
  label = 'Reference',
): { metrics?: ReferenceNrmse; error?: string } {
  const n = memReal.length
  if (
    n === 0
    || memImag.length !== n
    || referenceReal.length !== n
    || referenceImag.length !== n
  ) {
    return { error: 'MEM Re/Im and reference Re/Im arrays must have the same non-zero length before NRMSE calculation.' }
  }

  let sumSqRe = 0
  let sumSqIm = 0
  let referenceComplexSumSq = 0
  for (let i = 0; i < n; i++) {
    const reResidual = memReal[i] - referenceReal[i]
    const imResidual = memImag[i] - referenceImag[i]
    sumSqRe += reResidual * reResidual
    sumSqIm += imResidual * imResidual
    referenceComplexSumSq += referenceReal[i] * referenceReal[i] + referenceImag[i] * referenceImag[i]
  }

  const reRmsRaw = rms(referenceReal)
  const imRmsRaw = rms(referenceImag)
  const complexRmsRaw = Math.sqrt(referenceComplexSumSq / n)
  const reRms = Math.max(reRmsRaw, NRMSE_EPSILON)
  const imRms = Math.max(imRmsRaw, NRMSE_EPSILON)
  const complexRms = Math.max(complexRmsRaw, NRMSE_EPSILON)
  const warnings: string[] = []
  if (reRmsRaw < NRMSE_EPSILON) warnings.push(`${label} Re RMS is near zero; Re-NRMSE used epsilon normalization.`)
  if (imRmsRaw < NRMSE_EPSILON) warnings.push(`${label} Im RMS is near zero; Im-NRMSE used epsilon normalization.`)
  if (complexRmsRaw < NRMSE_EPSILON) warnings.push(`${label} complex RMS is near zero; complex NRMSE used epsilon normalization.`)

  return {
    metrics: {
      reNrmse: Math.sqrt(sumSqRe / n) / reRms,
      imNrmse: Math.sqrt(sumSqIm / n) / imRms,
      complexNrmse: Math.sqrt((sumSqRe + sumSqIm) / n) / complexRms,
      reRmsRaw,
      imRmsRaw,
      complexRmsRaw,
      pointCount: n,
      warnings,
    },
  }
}
