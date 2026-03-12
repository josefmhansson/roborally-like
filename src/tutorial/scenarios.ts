import { STARTING_DECK } from '../engine/cards'
import { cloneGameState } from '../engine/clone'
import { createGameState, DEFAULT_SETTINGS } from '../engine/game'
import type { CardDefId, GameState, GameSettings, PlayerClassId, PlayerId, Unit } from '../engine/types'
import type {
  TutorialLessonId,
  TutorialOnlineDemoData,
  TutorialScenarioBootstrap,
} from './types'

export function createTutorialScenarioBootstrap(lessonId: TutorialLessonId): TutorialScenarioBootstrap {
  switch (lessonId) {
    case 'first_battle':
      return createFirstBattleBootstrap()
    case 'build_deck':
      return createBuildDeckBootstrap()
    case 'play_online':
      return createPlayOnlineBootstrap()
    default:
      throw new Error(`Unsupported tutorial lesson bootstrap: ${lessonId}`)
  }
}

function createFirstBattleBootstrap(): TutorialScenarioBootstrap {
  const settings: GameSettings = {
    ...createBaseSettings(),
    deckSize: 4,
    drawPerTurn: 2,
    actionBudgetP1: 2,
    actionBudgetP2: 1,
  }
  const loadouts = {
    p1: ['move_forward', 'reinforce_spawn', 'attack_jab', 'attack_jab'],
    p2: ['move_pivot', 'reinforce_boost'],
  } satisfies { p1: CardDefId[]; p2: CardDefId[] }
  const playerClasses = {
    p1: 'commander',
    p2: 'commander',
  } satisfies { p1: PlayerClassId; p2: PlayerClassId }
  const state = createBaseTutorialState(settings, loadouts, playerClasses)

  state.players[0].hand = [makeCard('tut-p1-advance', 'move_forward')]
  state.players[0].deck = [
    makeCard('tut-p1-recruit', 'reinforce_spawn'),
    makeCard('tut-p1-jab-1', 'attack_jab'),
    makeCard('tut-p1-jab-2', 'attack_jab'),
  ]
  state.players[0].discard = []
  state.players[1].hand = [makeCard('tut-p2-pivot', 'move_pivot')]
  state.players[1].deck = [makeCard('tut-p2-boost', 'reinforce_boost')]
  state.players[1].discard = []
  state.units['leader-0'] = makeLeader(state.units['leader-0'], 0, { q: 2, r: 4 }, 2, 5)
  state.units['leader-1'] = makeLeader(state.units['leader-1'], 1, { q: 2, r: 0 }, 3, 2)
  state.units['u0-1'] = makeUnit(state.units['u0-1'], 0, { q: 2, r: 3 }, 2, 2)
  state.units['u1-2'] = makeUnit(state.units['u1-2'], 1, { q: 3, r: 0 }, 4, 2)
  finalizeState(state)

  return {
    mode: 'local',
    screen: 'game',
    gameSettings: settings,
    loadouts,
    playerClasses,
    state,
    planningPlayer: 0,
    statusMessage: 'Tutorial: select Advance.',
  }
}

function createBuildDeckBootstrap(): TutorialScenarioBootstrap {
  const settings: GameSettings = {
    ...DEFAULT_SETTINGS,
    deckSize: 10,
    maxCopies: 2,
  }
  const loadouts = {
    p1: STARTING_DECK.slice(0, 8),
    p2: STARTING_DECK.slice(0, 8),
  }
  const playerClasses = {
    p1: 'commander',
    p2: 'commander',
  } satisfies { p1: PlayerClassId; p2: PlayerClassId }

  return {
    mode: 'local',
    screen: 'loadout',
    gameSettings: settings,
    loadouts,
    playerClasses,
    state: createGameState(settings, loadouts, playerClasses),
    planningPlayer: 0,
    statusMessage: 'Tutorial: build a temporary deck.',
  }
}

function createPlayOnlineBootstrap(): TutorialScenarioBootstrap {
  const onlineDemo: TutorialOnlineDemoData = {
    roomCode: 'TUTOR1',
    seatToken: 'seat-token-p2-demo',
    inviteLinks: {
      seat0: 'https://example.invalid/join/TUTOR1/seat-token-p1-demo',
      seat1: 'https://example.invalid/join/TUTOR1/seat-token-p2-demo',
    },
  }

  return {
    mode: 'tutorial',
    screen: 'menu',
    onlineDemo,
    statusMessage: 'Tutorial: review the online flow with sample room details.',
  }
}

function createBaseSettings(): GameSettings {
  return {
    ...DEFAULT_SETTINGS,
    boardRows: 5,
    boardCols: 5,
    deckSize: 2,
    drawPerTurn: 1,
    actionBudgetP1: 1,
    actionBudgetP2: 1,
    maxCopies: 2,
  }
}

function createBaseTutorialState(
  settings: GameSettings,
  loadouts: { p1: CardDefId[]; p2: CardDefId[] },
  playerClasses: { p1: PlayerClassId; p2: PlayerClassId }
): GameState {
  const state = createGameState(settings, loadouts, playerClasses)
  state.phase = 'planning'
  state.turn = 1
  state.activePlayer = 0
  state.actionQueue = []
  state.actionIndex = 0
  state.ready = [false, false]
  state.winner = null
  state.log = ['Tutorial match start.']
  state.players[0].orders = []
  state.players[1].orders = []
  return state
}

function finalizeState(state: GameState): void {
  state.turnStartLeaderPositions = [
    { ...state.units['leader-0'].pos },
    { ...state.units['leader-1'].pos },
  ]
  state.leaderMovedLastTurn = [true, true]
  state.spawnedByOrder = {}
  state.nextOrderId = 1
  state.nextUnitId = Object.keys(state.units).length + 1
}

function makeCard(id: string, defId: CardDefId) {
  return { id, defId }
}

function makeLeader(
  baseLeader: Unit | undefined,
  owner: PlayerId,
  pos: { q: number; r: number },
  facing: 0 | 1 | 2 | 3 | 4 | 5,
  strength: number
): Unit {
  return {
    ...(baseLeader ?? {
      id: `leader-${owner}`,
      owner,
      kind: 'leader',
      strength,
      pos,
      facing,
      modifiers: [],
    }),
    owner,
    strength,
    pos: { ...pos },
    facing,
  }
}

function makeUnit(
  baseUnit: Unit | undefined,
  owner: PlayerId,
  pos: { q: number; r: number },
  facing: 0 | 1 | 2 | 3 | 4 | 5,
  strength: number
): Unit {
  return {
    ...(baseUnit ?? {
      id: `u${owner}-1`,
      owner,
      kind: 'unit',
      strength,
      pos,
      facing,
      modifiers: [],
    }),
    owner,
    kind: 'unit',
    strength,
    pos: { ...pos },
    facing,
    modifiers: baseUnit?.modifiers.map((modifier) => ({ ...modifier })) ?? [],
  }
}

export function cloneTutorialBootstrap(bootstrap: TutorialScenarioBootstrap): TutorialScenarioBootstrap {
  return {
    ...bootstrap,
    gameSettings: bootstrap.gameSettings ? { ...bootstrap.gameSettings } : undefined,
    loadouts: bootstrap.loadouts ? { p1: [...bootstrap.loadouts.p1], p2: [...bootstrap.loadouts.p2] } : undefined,
    playerClasses: bootstrap.playerClasses ? { ...bootstrap.playerClasses } : undefined,
    state: bootstrap.state ? cloneGameState(bootstrap.state) : undefined,
    roguelikeRun: bootstrap.roguelikeRun
      ? {
          ...bootstrap.roguelikeRun,
          deck: [...bootstrap.roguelikeRun.deck],
          draftOptions: [...bootstrap.roguelikeRun.draftOptions],
        }
      : undefined,
    onlineDemo: bootstrap.onlineDemo
      ? {
          roomCode: bootstrap.onlineDemo.roomCode,
          seatToken: bootstrap.onlineDemo.seatToken,
          inviteLinks: {
            seat0: bootstrap.onlineDemo.inviteLinks.seat0,
            seat1: bootstrap.onlineDemo.inviteLinks.seat1,
          },
        }
      : undefined,
  }
}
