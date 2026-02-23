import assert from 'node:assert/strict'
import test from 'node:test'
import { CARD_DEFS } from '../engine/cards'
import type { CardDefId } from '../engine/types'
import { getCardArtSvg } from './cardArt'

const CARD_IDS = Object.keys(CARD_DEFS) as CardDefId[]

function countOccurrences(source: string, needle: string): number {
  return source.split(needle).length - 1
}

test('every card id renders a non-empty svg', () => {
  CARD_IDS.forEach((defId) => {
    const svg = getCardArtSvg(defId)
    assert.ok(svg.startsWith('<svg'), `${defId} should render an svg root`)
    assert.ok(svg.length > 100, `${defId} svg should not be empty`)
  })
})

test('only strike and invest use override scenes', () => {
  const overrideIds = CARD_IDS.filter((defId) => getCardArtSvg(defId).includes('data-art-source="override"')).sort()
  assert.deepEqual(overrideIds, ['attack_fwd', 'spell_invest'])
})

test('boost renders as multi-panel with ellipsis connector', () => {
  const svg = getCardArtSvg('reinforce_boost')
  assert.ok(svg.includes('data-art-layout="multi-panel"'))
  assert.ok(svg.includes('data-primitive="ellipsis"'))
})

test('lightning shows mixed unit ownership and selected enemy example', () => {
  const svg = getCardArtSvg('spell_lightning')
  assert.ok(svg.includes('data-owner="friendly"'))
  assert.ok(svg.includes('data-owner="enemy"'))
  assert.ok(svg.includes('data-owner="enemy" data-selected="true"'))
})

test('advance uses card data range depth in art', () => {
  const svg = getCardArtSvg('move_forward')
  assert.ok(svg.includes('data-range="5"'))
})

test('meteor shows center and splash damage stacks', () => {
  const svg = getCardArtSvg('spell_meteor')
  assert.ok(svg.includes('data-primitive="damage-orbs" data-count="5" data-role="center"'))
  assert.ok(svg.includes('data-primitive="damage-orbs" data-count="1" data-role="splash"'))
  assert.ok(svg.includes('data-primitive="affected-tile"'))
  assert.ok(countOccurrences(svg, 'data-primitive="tile-highlight"') >= 36)
})

test('train includes spawn requirement glyph', () => {
  const svg = getCardArtSvg('reinforce_boost_spawn')
  assert.ok(svg.includes('data-primitive="spawn-glyph"'))
})

test('invest uses plus and action stamp without board grid primitives', () => {
  const svg = getCardArtSvg('spell_invest')
  assert.ok(svg.includes('data-primitive="plus"'))
  assert.ok(svg.includes('data-primitive="action-stamp"'))
  assert.equal(svg.includes('data-primitive="tile-highlight"'), false)
})

test('sweeping line uses affected tiles rather than target highlights', () => {
  const svg = getCardArtSvg('attack_line')
  assert.ok(svg.includes('data-primitive="affected-tile"'))
  assert.equal(svg.includes('data-primitive="tile-highlight"'), false)
  assert.equal(svg.includes('data-owner="enemy"'), false)
})

test('strike shows direction choices with one selected direction', () => {
  const svg = getCardArtSvg('attack_fwd')
  assert.ok(svg.includes('data-primitive="direction-arrows"'))
  assert.ok(svg.includes('data-selected-direction="0"'))
})

test('advance shows single selected travel-facing marker', () => {
  const svg = getCardArtSvg('move_forward')
  assert.ok(svg.includes('data-selected-direction="0"'))
  assert.equal(svg.includes('data-show-facing="true"'), false)
})

test('strafe shows single selected marker facing original direction', () => {
  const svg = getCardArtSvg('move_any')
  assert.ok(svg.includes('data-selected-direction="0"'))
  assert.ok(svg.includes('data-show-facing="true"'))
})

test('arrow renders an enemy unit target example', () => {
  const svg = getCardArtSvg('attack_arrow')
  assert.ok(svg.includes('data-owner="enemy"'))
})
