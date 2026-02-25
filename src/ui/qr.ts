type RsBlockSpec = {
  count: number
  totalCodewords: number
  dataCodewords: number
}

type RsBlock = {
  data: number[]
  ecc: number[]
}

const ALIGNMENT_POSITIONS: Readonly<Record<number, number[]>> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
}

// Error correction level L block layout for versions 1-6.
const RS_BLOCKS_L: Readonly<Record<number, RsBlockSpec[]>> = {
  1: [{ count: 1, totalCodewords: 26, dataCodewords: 19 }],
  2: [{ count: 1, totalCodewords: 44, dataCodewords: 34 }],
  3: [{ count: 1, totalCodewords: 70, dataCodewords: 55 }],
  4: [{ count: 1, totalCodewords: 100, dataCodewords: 80 }],
  5: [{ count: 1, totalCodewords: 134, dataCodewords: 108 }],
  6: [{ count: 2, totalCodewords: 86, dataCodewords: 68 }],
}

const MIN_VERSION = 1
const MAX_VERSION = 6
const MODE_BYTE = 0b0100
const FORMAT_ECC_L = 0b01
const FORMAT_MASK = 0x5412
const FORMAT_GENERATOR = 0x537

const GF_EXP = new Uint16Array(512)
const GF_LOG = new Uint16Array(256)

initGaloisField()

export function createQrSvgDataUrl(text: string): string {
  const matrix = createQrMatrix(text)
  const svg = matrixToSvg(matrix, 4)
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export function createQrMatrix(text: string): boolean[][] {
  const data = Array.from(new TextEncoder().encode(text))
  const version = pickVersion(data.length)
  const blockSpec = RS_BLOCKS_L[version]
  const dataCodewordCapacity = getDataCodewordCapacity(blockSpec)
  const dataCodewords = encodeDataCodewords(data, dataCodewordCapacity)
  const allCodewords = buildAllCodewords(dataCodewords, blockSpec)
  return buildMatrix(version, allCodewords)
}

function pickVersion(inputLength: number): number {
  for (let version = MIN_VERSION; version <= MAX_VERSION; version += 1) {
    const dataCodewordCapacity = getDataCodewordCapacity(RS_BLOCKS_L[version])
    const requiredBits = 4 + 8 + inputLength * 8
    if (requiredBits <= dataCodewordCapacity * 8) {
      return version
    }
  }
  throw new Error('Invite link is too long for local QR encoding.')
}

function getDataCodewordCapacity(spec: RsBlockSpec[]): number {
  return spec.reduce((sum, group) => sum + group.count * group.dataCodewords, 0)
}

function encodeDataCodewords(bytes: number[], capacityCodewords: number): number[] {
  const bits: number[] = []
  appendBits(bits, MODE_BYTE, 4)
  appendBits(bits, bytes.length, 8)
  bytes.forEach((value) => appendBits(bits, value, 8))

  const capacityBits = capacityCodewords * 8
  const terminatorLength = Math.min(4, capacityBits - bits.length)
  appendBits(bits, 0, terminatorLength)

  while (bits.length % 8 !== 0) {
    bits.push(0)
  }

  const codewords: number[] = []
  for (let index = 0; index < bits.length; index += 8) {
    let value = 0
    for (let offset = 0; offset < 8; offset += 1) {
      value = (value << 1) | bits[index + offset]
    }
    codewords.push(value)
  }

  const pads = [0xec, 0x11]
  let padIndex = 0
  while (codewords.length < capacityCodewords) {
    codewords.push(pads[padIndex % 2])
    padIndex += 1
  }

  return codewords
}

function appendBits(bits: number[], value: number, length: number): void {
  for (let bit = length - 1; bit >= 0; bit -= 1) {
    bits.push((value >>> bit) & 1)
  }
}

function buildAllCodewords(dataCodewords: number[], specs: RsBlockSpec[]): number[] {
  const blocks: RsBlock[] = []
  let offset = 0

  specs.forEach((spec) => {
    const eccLength = spec.totalCodewords - spec.dataCodewords
    for (let index = 0; index < spec.count; index += 1) {
      const blockData = dataCodewords.slice(offset, offset + spec.dataCodewords)
      offset += spec.dataCodewords
      blocks.push({
        data: blockData,
        ecc: reedSolomonRemainder(blockData, eccLength),
      })
    }
  })

  const interleaved: number[] = []
  const maxDataLength = Math.max(...blocks.map((block) => block.data.length))
  for (let index = 0; index < maxDataLength; index += 1) {
    blocks.forEach((block) => {
      if (index < block.data.length) interleaved.push(block.data[index])
    })
  }

  const maxEccLength = Math.max(...blocks.map((block) => block.ecc.length))
  for (let index = 0; index < maxEccLength; index += 1) {
    blocks.forEach((block) => {
      if (index < block.ecc.length) interleaved.push(block.ecc[index])
    })
  }

  return interleaved
}

function buildMatrix(version: number, codewords: number[]): boolean[][] {
  const size = version * 4 + 17
  const baseModules = buildEmptyMatrix(size)
  const functionModules = buildEmptyMatrix(size)

  drawFunctionPatterns(version, baseModules, functionModules)
  drawCodewords(baseModules, functionModules, codewords)

  let bestMask = 0
  let bestPenalty = Number.POSITIVE_INFINITY
  let bestMatrix = baseModules

  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = cloneMatrix(baseModules)
    applyMask(mask, candidate, functionModules)
    drawFormatBits(mask, candidate, functionModules)
    const penalty = calculatePenalty(candidate)
    if (penalty < bestPenalty) {
      bestPenalty = penalty
      bestMask = mask
      bestMatrix = candidate
    }
  }

  const output = cloneMatrix(bestMatrix)
  drawFormatBits(bestMask, output, functionModules)
  return output
}

function buildEmptyMatrix(size: number): boolean[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => false))
}

function cloneMatrix(source: boolean[][]): boolean[][] {
  return source.map((row) => [...row])
}

function drawFunctionPatterns(version: number, modules: boolean[][], functionModules: boolean[][]): void {
  const size = modules.length
  drawFinder(0, 0, modules, functionModules)
  drawFinder(size - 7, 0, modules, functionModules)
  drawFinder(0, size - 7, modules, functionModules)
  drawTimingPatterns(modules, functionModules)
  drawAlignmentPatterns(version, modules, functionModules)
  markFormatAreas(functionModules)
  setModule(8, size - 8, true, modules, functionModules)
}

function drawFinder(x: number, y: number, modules: boolean[][], functionModules: boolean[][]): void {
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const xx = x + dx
      const yy = y + dy
      if (!isInside(xx, yy, modules.length)) continue
      const isCore = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6
      const isDark =
        isCore &&
        (dx === 0 ||
          dx === 6 ||
          dy === 0 ||
          dy === 6 ||
          (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4))
      setModule(xx, yy, isDark, modules, functionModules)
    }
  }
}

function drawTimingPatterns(modules: boolean[][], functionModules: boolean[][]): void {
  const size = modules.length
  for (let index = 8; index < size - 8; index += 1) {
    const dark = index % 2 === 0
    if (!functionModules[6][index]) setModule(index, 6, dark, modules, functionModules)
    if (!functionModules[index][6]) setModule(6, index, dark, modules, functionModules)
  }
}

function drawAlignmentPatterns(version: number, modules: boolean[][], functionModules: boolean[][]): void {
  const positions = ALIGNMENT_POSITIONS[version]
  if (!positions || positions.length === 0) return

  positions.forEach((x, i) => {
    positions.forEach((y, j) => {
      const isFinderOverlap =
        (i === 0 && j === 0) ||
        (i === 0 && j === positions.length - 1) ||
        (i === positions.length - 1 && j === 0)
      if (isFinderOverlap) return
      drawAlignment(x, y, modules, functionModules)
    })
  })
}

function drawAlignment(cx: number, cy: number, modules: boolean[][], functionModules: boolean[][]): void {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const xx = cx + dx
      const yy = cy + dy
      if (!isInside(xx, yy, modules.length)) continue
      const distance = Math.max(Math.abs(dx), Math.abs(dy))
      setModule(xx, yy, distance !== 1, modules, functionModules)
    }
  }
}

function markFormatAreas(functionModules: boolean[][]): void {
  const size = functionModules.length
  for (let index = 0; index < 9; index += 1) {
    if (index === 6) continue
    functionModules[8][index] = true
    functionModules[index][8] = true
  }
  for (let index = 0; index < 8; index += 1) {
    functionModules[8][size - 1 - index] = true
    functionModules[size - 1 - index][8] = true
  }
}

function drawCodewords(modules: boolean[][], functionModules: boolean[][], codewords: number[]): void {
  const size = modules.length
  let bitIndex = 0
  let upward = true

  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step
      for (let colOffset = 0; colOffset < 2; colOffset += 1) {
        const x = col - colOffset
        if (functionModules[row][x]) continue
        const value = getBit(codewords, bitIndex)
        modules[row][x] = value
        bitIndex += 1
      }
    }
    upward = !upward
  }
}

function getBit(codewords: number[], bitIndex: number): boolean {
  const byteIndex = Math.floor(bitIndex / 8)
  if (byteIndex >= codewords.length) return false
  const bitOffset = 7 - (bitIndex % 8)
  return ((codewords[byteIndex] >>> bitOffset) & 1) === 1
}

function applyMask(mask: number, modules: boolean[][], functionModules: boolean[][]): void {
  const size = modules.length
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (functionModules[y][x]) continue
      if (isMaskCell(mask, x, y)) {
        modules[y][x] = !modules[y][x]
      }
    }
  }
}

function isMaskCell(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0
    case 1:
      return y % 2 === 0
    case 2:
      return x % 3 === 0
    case 3:
      return (x + y) % 3 === 0
    case 4:
      return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0
    case 6:
      return ((((x * y) % 2) + ((x * y) % 3)) % 2) === 0
    case 7:
      return ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0
    default:
      return false
  }
}

function drawFormatBits(mask: number, modules: boolean[][], functionModules: boolean[][]): void {
  const size = modules.length
  const format = buildFormatBits(mask)

  for (let index = 0; index < 15; index += 1) {
    const bit = ((format >>> index) & 1) === 1

    if (index < 6) {
      setModule(8, index, bit, modules, functionModules)
    } else if (index < 8) {
      setModule(8, index + 1, bit, modules, functionModules)
    } else {
      setModule(8, size - 15 + index, bit, modules, functionModules)
    }

    if (index < 8) {
      setModule(size - index - 1, 8, bit, modules, functionModules)
    } else if (index < 9) {
      setModule(15 - index, 8, bit, modules, functionModules)
    } else {
      setModule(15 - index - 1, 8, bit, modules, functionModules)
    }
  }

  setModule(8, size - 8, true, modules, functionModules)
}

function buildFormatBits(mask: number): number {
  const data = (FORMAT_ECC_L << 3) | mask
  let remainder = data << 10
  for (let bit = 14; bit >= 10; bit -= 1) {
    if (((remainder >>> bit) & 1) === 1) {
      remainder ^= FORMAT_GENERATOR << (bit - 10)
    }
  }
  return ((data << 10) | remainder) ^ FORMAT_MASK
}

function calculatePenalty(modules: boolean[][]): number {
  const size = modules.length
  let penalty = 0

  for (let y = 0; y < size; y += 1) {
    let runColor = modules[y][0]
    let runLength = 1
    for (let x = 1; x < size; x += 1) {
      const color = modules[y][x]
      if (color === runColor) {
        runLength += 1
      } else {
        if (runLength >= 5) penalty += 3 + (runLength - 5)
        runColor = color
        runLength = 1
      }
    }
    if (runLength >= 5) penalty += 3 + (runLength - 5)
  }

  for (let x = 0; x < size; x += 1) {
    let runColor = modules[0][x]
    let runLength = 1
    for (let y = 1; y < size; y += 1) {
      const color = modules[y][x]
      if (color === runColor) {
        runLength += 1
      } else {
        if (runLength >= 5) penalty += 3 + (runLength - 5)
        runColor = color
        runLength = 1
      }
    }
    if (runLength >= 5) penalty += 3 + (runLength - 5)
  }

  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const color = modules[y][x]
      if (
        modules[y][x + 1] === color &&
        modules[y + 1][x] === color &&
        modules[y + 1][x + 1] === color
      ) {
        penalty += 3
      }
    }
  }

  const patternA = [true, false, true, true, true, false, true, false, false, false, false]
  const patternB = [false, false, false, false, true, false, true, true, true, false, true]
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x <= size - 11; x += 1) {
      const row = modules[y].slice(x, x + 11)
      if (matchesPattern(row, patternA) || matchesPattern(row, patternB)) {
        penalty += 40
      }
    }
  }
  for (let x = 0; x < size; x += 1) {
    for (let y = 0; y <= size - 11; y += 1) {
      const column: boolean[] = []
      for (let offset = 0; offset < 11; offset += 1) {
        column.push(modules[y + offset][x])
      }
      if (matchesPattern(column, patternA) || matchesPattern(column, patternB)) {
        penalty += 40
      }
    }
  }

  let darkCount = 0
  modules.forEach((row) => {
    row.forEach((cell) => {
      if (cell) darkCount += 1
    })
  })
  const total = size * size
  const balance = Math.abs(darkCount * 20 - total * 10) / total
  penalty += Math.floor(balance) * 10

  return penalty
}

function matchesPattern(value: boolean[], pattern: boolean[]): boolean {
  if (value.length !== pattern.length) return false
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== pattern[index]) return false
  }
  return true
}

function setModule(
  x: number,
  y: number,
  value: boolean,
  modules: boolean[][],
  functionModules: boolean[][]
): void {
  if (!isInside(x, y, modules.length)) return
  modules[y][x] = value
  functionModules[y][x] = true
}

function isInside(x: number, y: number, size: number): boolean {
  return x >= 0 && x < size && y >= 0 && y < size
}

function matrixToSvg(matrix: boolean[][], border: number): string {
  const size = matrix.length
  const dimension = size + border * 2
  const rects: string[] = []

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!matrix[y][x]) continue
      rects.push(`M${x + border},${y + border}h1v1h-1z`)
    }
  }

  const path = rects.join('')
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dimension} ${dimension}" shape-rendering="crispEdges">`,
    '<rect width="100%" height="100%" fill="#ffffff"/>',
    `<path d="${path}" fill="#000000"/>`,
    '</svg>',
  ].join('')
}

function reedSolomonRemainder(data: number[], eccLength: number): number[] {
  const generator = reedSolomonGenerator(eccLength)
  const message = [...data, ...Array.from({ length: eccLength }, () => 0)]
  for (let i = 0; i < data.length; i += 1) {
    const factor = message[i]
    if (factor === 0) continue
    for (let j = 0; j < generator.length; j += 1) {
      message[i + j] ^= gfMul(generator[j], factor)
    }
  }
  return message.slice(data.length)
}

function reedSolomonGenerator(degree: number): number[] {
  let poly = [1]
  for (let i = 0; i < degree; i += 1) {
    const next = Array.from({ length: poly.length + 1 }, () => 0)
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= gfMul(poly[j], 1)
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i])
    }
    poly = next
  }
  return poly
}

function initGaloisField(): void {
  let value = 1
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = value
    GF_LOG[value] = i
    value <<= 1
    if ((value & 0x100) !== 0) {
      value ^= 0x11d
    }
  }
  for (let i = 255; i < 512; i += 1) {
    GF_EXP[i] = GF_EXP[i - 255]
  }
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return GF_EXP[GF_LOG[a] + GF_LOG[b]]
}
