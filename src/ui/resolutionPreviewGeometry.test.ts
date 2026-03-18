import assert from 'node:assert/strict'
import test from 'node:test'
import {
  interpolatePoint,
  type Point,
} from './resolutionPreviewGeometry'

function assertNearlyEqual(actual: number, expected: number, epsilon = 0.001): void {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`
  )
}

function assertCoordinateLocked(
  starts: Point[],
  ends: Point[],
  axis: 'x' | 'y',
  epsilon = 0.001
): void {
  ;[0, 0.25, 0.5, 0.75, 1].forEach((progress) => {
    const [first, second] = starts.map((start, index) => interpolatePoint(start, ends[index], progress))
    assert.ok(first && second)
    assertNearlyEqual(first[axis], second[axis], epsilon)
  })
}

test('horizontal neighbors keep matching y across split preview travel', () => {
  const center = { x: 500, y: 320 }
  const targets = [
    { x: 420, y: 220 },
    { x: 580, y: 220 },
  ]
  const starts = targets.map(() => center)

  assertCoordinateLocked(starts, targets, 'y')
})

test('vertical neighbors keep matching x across split preview travel', () => {
  const center = { x: 500, y: 320 }
  const targets = [
    { x: 500, y: 220 },
    { x: 500, y: 420 },
  ]
  const starts = targets.map(() => center)

  assertCoordinateLocked(starts, targets, 'x')
})
