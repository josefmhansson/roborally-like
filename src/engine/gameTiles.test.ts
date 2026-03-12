import assert from 'node:assert/strict'
import test from 'node:test'
import { createGameState, getSpawnTiles } from './game'

const EXPECTED_TILE_KINDS = new Set(['grassland', 'forest', 'hills', 'mountain'])

test('new games only generate tile kinds that exist in the current tileset', () => {
  for (let i = 0; i < 20; i += 1) {
    const state = createGameState()
    const kinds = new Set(state.tiles.map((tile) => tile.kind))
    kinds.forEach((kind) => {
      assert.equal(EXPECTED_TILE_KINDS.has(kind), true, `unexpected generated tile kind: ${kind}`)
    })
  }
})

test('spawn tiles are always grassland', () => {
  for (let i = 0; i < 20; i += 1) {
    const state = createGameState()
    const spawnTiles = [...getSpawnTiles(state, 0), ...getSpawnTiles(state, 1)]
    spawnTiles.forEach((hex) => {
      const tile = state.tiles.find((candidate) => candidate.q === hex.q && candidate.r === hex.r)
      assert.ok(tile, `missing tile at ${hex.q},${hex.r}`)
      assert.equal(tile.kind, 'grassland', `spawn tile ${hex.q},${hex.r} should be grassland`)
    })
  }
})
