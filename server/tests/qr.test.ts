import test from 'node:test'
import assert from 'node:assert/strict'
import { createQrSvgDataUrl } from '../../src/ui/qr'

test('local QR encoder builds SVG data URL for invite links', () => {
  const invite = 'https://example.local/join/AB12CD/0123456789abcdef0123456789abcdef0123456789abcdef'
  const dataUrl = createQrSvgDataUrl(invite)
  assert.ok(dataUrl.startsWith('data:image/svg+xml'))
  const encoded = dataUrl.split(',')[1] ?? ''
  const svg = decodeURIComponent(encoded)
  assert.ok(svg.includes('<svg'))
  assert.ok(svg.includes('<path'))
})

test('local QR encoder rejects links that exceed supported local capacity', () => {
  assert.throws(() => createQrSvgDataUrl(`https://example.local/join/${'x'.repeat(400)}`))
})
