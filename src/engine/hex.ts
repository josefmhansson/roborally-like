import type { Direction, Hex } from './types'

export const DIRECTIONS: Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

export const DIRECTION_NAMES = [
  'east',
  'northeast',
  'northwest',
  'west',
  'southwest',
  'southeast',
] as const

export function addHex(a: Hex, b: Hex): Hex {
  return { q: a.q + b.q, r: a.r + b.r }
}

export function scaleHex(a: Hex, k: number): Hex {
  return { q: a.q * k, r: a.r * k }
}

export function neighbor(hex: Hex, dir: Direction): Hex {
  const axial = offsetToAxial(hex)
  const next = addHex(axial, DIRECTIONS[dir])
  return axialToOffset(next)
}

export function hexKey(hex: Hex): string {
  return `${hex.q},${hex.r}`
}

export function sameHex(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r
}

export function rotateDirection(dir: Direction, steps: number): Direction {
  const next = (dir + steps) % 6
  return (next < 0 ? next + 6 : next) as Direction
}

export function hexToPixel(hex: Hex, size: number, origin: { x: number; y: number }): { x: number; y: number } {
  const x = size * (Math.sqrt(3) * (hex.q - 0.5 * (hex.r & 1))) + origin.x
  const y = size * (1.5 * hex.r) + origin.y
  return { x, y }
}

export function offsetToAxial(hex: Hex): Hex {
  const q = hex.q - (hex.r + (hex.r & 1)) / 2
  return { q, r: hex.r }
}

export function axialToOffset(hex: Hex): Hex {
  const q = hex.q + (hex.r + (hex.r & 1)) / 2
  return { q, r: hex.r }
}

export function polygonCorners(center: { x: number; y: number }, size: number): { x: number; y: number }[] {
  const corners: { x: number; y: number }[] = []
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 180) * (60 * i - 30)
    corners.push({
      x: center.x + size * Math.cos(angle),
      y: center.y + size * Math.sin(angle),
    })
  }
  return corners
}
