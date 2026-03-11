import type { GameState } from './types'

export function cloneGameState(source: GameState): GameState {
  const units: GameState['units'] = {}
  Object.entries(source.units).forEach(([unitId, unit]) => {
    units[unitId] = {
      ...unit,
      pos: { ...unit.pos },
      modifiers: unit.modifiers.map((modifier) => ({ ...modifier })),
    }
  })

  const players: GameState['players'] = [
    {
      deck: cloneCards(source.players[0].deck),
      hand: cloneCards(source.players[0].hand),
      discard: cloneCards(source.players[0].discard),
      orders: cloneOrders(source.players[0].orders),
      modifiers: source.players[0].modifiers.map((modifier) => ({ ...modifier })),
    },
    {
      deck: cloneCards(source.players[1].deck),
      hand: cloneCards(source.players[1].hand),
      discard: cloneCards(source.players[1].discard),
      orders: cloneOrders(source.players[1].orders),
      modifiers: source.players[1].modifiers.map((modifier) => ({ ...modifier })),
    },
  ]

  return {
    boardRows: source.boardRows,
    boardCols: source.boardCols,
    tiles: source.tiles.map((tile) => ({ ...tile })),
    units,
    traps: source.traps.map((trap) => ({ ...trap, pos: { ...trap.pos } })),
    players,
    ready: [source.ready[0], source.ready[1]],
    actionBudgets: [source.actionBudgets[0], source.actionBudgets[1]],
    activePlayer: source.activePlayer,
    phase: source.phase,
    actionQueue: cloneOrders(source.actionQueue),
    actionIndex: source.actionIndex,
    turn: source.turn,
    nextUnitId: source.nextUnitId,
    nextOrderId: source.nextOrderId,
    log: [...source.log],
    winner: source.winner,
    spawnedByOrder: { ...source.spawnedByOrder },
    settings: { ...source.settings },
    playerClasses: source.playerClasses ? [source.playerClasses[0], source.playerClasses[1]] : undefined,
    leaderMovedLastTurn: source.leaderMovedLastTurn ? [source.leaderMovedLastTurn[0], source.leaderMovedLastTurn[1]] : undefined,
    turnStartLeaderPositions: source.turnStartLeaderPositions
      ? [
          { ...source.turnStartLeaderPositions[0] },
          { ...source.turnStartLeaderPositions[1] },
        ]
      : undefined,
    archmageBonusApplied: source.archmageBonusApplied
      ? [source.archmageBonusApplied[0], source.archmageBonusApplied[1]]
      : undefined,
  }
}

function cloneCards(cards: GameState['players'][number]['hand']): GameState['players'][number]['hand'] {
  return cards.map((card) => ({ ...card }))
}

function cloneOrders(orders: GameState['players'][number]['orders']): GameState['players'][number]['orders'] {
  return orders.map((order) => ({
    ...order,
    params: {
      ...order.params,
      tile: order.params.tile ? { ...order.params.tile } : undefined,
      tile2: order.params.tile2 ? { ...order.params.tile2 } : undefined,
      tile3: order.params.tile3 ? { ...order.params.tile3 } : undefined,
    },
  }))
}
