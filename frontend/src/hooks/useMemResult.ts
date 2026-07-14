import { useState, useRef } from 'react'
import type { EdgePaddingOptions, MemResult } from '../types/mem'
import * as api from '../api/mem'

function rotateComplex(
  realPart: number[],
  imagPart: number[],
  angle: number
): { real_part: number[]; imag_part: number[] } {
  const cosA = Math.cos(angle)
  const sinA = Math.sin(angle)
  const resultReal: number[] = []
  const resultImag: number[] = []
  for (let i = 0; i < realPart.length; i++) {
    resultReal.push(realPart[i] * cosA - imagPart[i] * sinA)
    resultImag.push(realPart[i] * sinA + imagPart[i] * cosA)
  }
  return { real_part: resultReal, imag_part: resultImag }
}

export function useMemResult() {
  const [result, setResult] = useState<MemResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phaseAngle, setPhaseAngle] = useState(0)
  const originalRealRef = useRef<number[]>([])
  const originalImagRef = useRef<number[]>([])

  const runMem = async (
    file: File,
    nn?: number,
    memPoints?: number,
    column?: number,
    edgePadding?: EdgePaddingOptions,
  ) => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.runMem(file, nn, memPoints, column, edgePadding)
      originalRealRef.current = [...data.real_part]
      originalImagRef.current = [...data.imag_part]
      setResult(data)
      setPhaseAngle(0)
    } catch (e: unknown) {
      setError(api.getApiErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const setPhase = (angle: number) => {
    if (!result) return
    setPhaseAngle(angle)
    if (angle === 0) {
      setResult({
        ...result,
        real_part: [...originalRealRef.current],
        imag_part: [...originalImagRef.current],
      })
      return
    }
    const rotated = rotateComplex(originalRealRef.current, originalImagRef.current, angle)
    setResult({
      ...result,
      real_part: rotated.real_part,
      imag_part: rotated.imag_part,
    })
  }

  const resetPhase = () => {
    if (!result) return
    setPhaseAngle(0)
    setResult({
      ...result,
      real_part: [...originalRealRef.current],
      imag_part: [...originalImagRef.current],
    })
  }

  return { result, loading, error, phaseAngle, runMem, setPhase, resetPhase }
}
