import { randomBytes } from 'node:crypto'
import type { WebSocket } from 'ws'
import { CARD_DEFS, STARTING_DECK } from '../src/engine/cards'
import { createGameState, DEFAULT_SETTINGS } from '../src/engine/game'
import type { CardDefId, GameSettings, GameState, PlayerId } from '../src/engine/types'
import type { MatchTelemetrySubmission } from '../src/shared/telemetry'
import type { RoomSetup } from '../src/shared/net/protocol'

type SeatState = {
  token: string
  socket: WebSocket | null
  connected: boolean
  lastSeen: number
  loadoutLocked: boolean
}

type RoomTelemetryState = {
  matchId: string
  startedAt: number
  playedCards: [CardDefId[], CardDefId[]]
  submitted: boolean
}

export type Room = {
  code: string
  state: GameState
  seats: [SeatState, SeatState]
  seatLoadouts: [CardDefId[], CardDefId[]]
  rematchReady: [boolean, boolean]
  paused: boolean
  reconnectDeadlineAt: number | null
  ended: boolean
  endReason: string | null
  createdAt: number
  telemetry: RoomTelemetryState
}

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const ROOM_CODE_LENGTH = 6
const DEFAULT_RECONNECT_GRACE_MS = 10 * 60 * 1000

export class RoomManager {
  private readonly rooms = new Map<string, Room>()
  private readonly reconnectGraceMs: number

  constructor(reconnectGraceMs = DEFAULT_RECONNECT_GRACE_MS) {
    this.reconnectGraceMs = reconnectGraceMs
  }

  createRoom(setup?: RoomSetup): Room {
    const roomCode = this.generateRoomCode()
    const settings = normalizeSettings(setup?.settings)
    const loadouts = normalizeLoadouts(settings, setup?.loadouts)
    const now = Date.now()
    const room: Room = {
      code: roomCode,
      state: createGameState(settings, loadouts),
      seats: [
        {
          token: createToken(),
          socket: null,
          connected: false,
          lastSeen: now,
          loadoutLocked: true,
        },
        {
          token: createToken(),
          socket: null,
          connected: false,
          lastSeen: now,
          loadoutLocked: false,
        },
      ],
      seatLoadouts: [loadouts.p1, loadouts.p2],
      rematchReady: [false, false],
      paused: false,
      reconnectDeadlineAt: null,
      ended: false,
      endReason: null,
      createdAt: now,
      telemetry: createRoomTelemetryState(now),
    }
    this.rooms.set(room.code, room)
    return room
  }

  getRoom(roomCode: string): Room | null {
    return this.rooms.get(roomCode) ?? null
  }

  getSeatByToken(room: Room, token: string): PlayerId | null {
    if (room.seats[0].token === token) return 0
    if (room.seats[1].token === token) return 1
    return null
  }

  attachSeat(room: Room, seat: PlayerId, socket: WebSocket): void {
    const seatState = room.seats[seat]
    if (seatState.socket && seatState.socket !== socket) {
      try {
        seatState.socket.close(4000, 'Seat reclaimed')
      } catch {
        // Ignore close failures.
      }
    }
    seatState.socket = socket
    seatState.connected = true
    seatState.lastSeen = Date.now()

    if (room.seats[0].connected && room.seats[1].connected) {
      room.paused = false
      room.reconnectDeadlineAt = null
    }
  }

  detachSeat(roomCode: string, seat: PlayerId): Room | null {
    const room = this.rooms.get(roomCode)
    if (!room) return null
    const seatState = room.seats[seat]
    seatState.socket = null
    seatState.connected = false
    seatState.lastSeen = Date.now()

    if (!room.ended) {
      const opponent: PlayerId = seat === 0 ? 1 : 0
      if (room.seats[opponent].connected) {
        room.paused = true
        room.reconnectDeadlineAt = Date.now() + this.reconnectGraceMs
      } else {
        room.paused = true
        room.reconnectDeadlineAt = Date.now() + this.reconnectGraceMs
      }
    }

    return room
  }

  applySeatLoadoutOnFirstJoin(room: Room, seat: PlayerId, submittedLoadout?: CardDefId[]): void {
    const seatState = room.seats[seat]
    if (seatState.loadoutLocked) return
    this.updateSeatLoadout(room, seat, submittedLoadout)
    seatState.loadoutLocked = true
  }

  canUpdateLoadout(room: Room): boolean {
    return canRoomUpdateLoadout(room)
  }

  updateSeatLoadout(room: Room, seat: PlayerId, submittedLoadout?: CardDefId[]): void {
    updateRoomSeatLoadout(room, seat, submittedLoadout)
  }

  requestRematch(room: Room, seat: PlayerId): { started: boolean } {
    return requestRoomRematch(room, seat)
  }

  listRooms(): Room[] {
    return [...this.rooms.values()]
  }

  tick(now = Date.now()): Room[] {
    const forfeited: Room[] = []
    for (const room of this.rooms.values()) {
      if (room.paused && room.reconnectDeadlineAt !== null && now >= room.reconnectDeadlineAt) {
        room.paused = false
        room.reconnectDeadlineAt = null
        const connectedSeats = ([0, 1] as PlayerId[]).filter((seat) => room.seats[seat].connected)
        if (connectedSeats.length === 1) {
          room.state.winner = connectedSeats[0]
          room.ended = true
          room.endReason = 'disconnect_timeout'
          forfeited.push(room)
        } else {
          this.rooms.delete(room.code)
          continue
        }
      }

      if (room.ended && !room.seats[0].connected && !room.seats[1].connected) {
        this.rooms.delete(room.code)
      }
    }
    return forfeited
  }

  deleteRoom(roomCode: string): void {
    this.rooms.delete(roomCode)
  }

  private generateRoomCode(): string {
    for (;;) {
      const bytes = randomBytes(ROOM_CODE_LENGTH)
      let value = ''
      for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
        value += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length]
      }
      if (!this.rooms.has(value)) return value
    }
  }
}

export function canRoomUpdateLoadout(room: Room): boolean {
  if (room.ended || room.state.winner !== null) return true
  return isPregameLoadoutWindow(room)
}

export function updateRoomSeatLoadout(room: Room, seat: PlayerId, submittedLoadout?: CardDefId[]): void {
  const normalizedDeck = sanitizeDeck(submittedLoadout ?? STARTING_DECK, room.state.settings)
  room.seatLoadouts[seat] = [...normalizedDeck]
  room.state.players[seat] = createPlayerStateFromDeck(normalizedDeck, seat, room.state.settings.drawPerTurn)
  room.state.ready[seat] = false
  if (room.ended || room.state.winner !== null) {
    room.rematchReady[seat] = false
  } else {
    room.rematchReady = [false, false]
  }
}

export function requestRoomRematch(room: Room, seat: PlayerId): { started: boolean } {
  room.rematchReady[seat] = true
  if (!(room.rematchReady[0] && room.rematchReady[1])) {
    return { started: false }
  }
  resetRoomForRematch(room)
  return { started: true }
}

function resetRoomForRematch(room: Room): void {
  const now = Date.now()
  room.state = createGameState(room.state.settings, {
    p1: [...room.seatLoadouts[0]],
    p2: [...room.seatLoadouts[1]],
  })
  room.ended = false
  room.endReason = null
  room.rematchReady = [false, false]
  room.paused = false
  room.reconnectDeadlineAt = null
  room.telemetry = createRoomTelemetryState(now)
}

export function recordRoomPlayedCards(room: Room, actionStartState: GameState): void {
  actionStartState.actionQueue.forEach((order) => {
    room.telemetry.playedCards[order.player].push(order.defId)
  })
}

export function buildRoomTelemetrySubmission(room: Room, now = Date.now()): MatchTelemetrySubmission | null {
  if (room.telemetry.submitted) return null
  return {
    schemaVersion: 1,
    matchId: room.telemetry.matchId,
    mode: 'online',
    roomCode: room.code,
    startedAt: room.telemetry.startedAt,
    endedAt: now,
    winner: room.state.winner,
    endReason: room.endReason ?? 'ended',
    settings: { ...room.state.settings },
    players: [
      {
        seat: 0,
        decklist: [...room.seatLoadouts[0]],
        cardsPlayed: [...room.telemetry.playedCards[0]],
        cardsInHandNotPlayed: room.state.players[0].hand.map((card) => card.defId),
      },
      {
        seat: 1,
        decklist: [...room.seatLoadouts[1]],
        cardsPlayed: [...room.telemetry.playedCards[1]],
        cardsInHandNotPlayed: room.state.players[1].hand.map((card) => card.defId),
      },
    ],
  }
}

export function markRoomTelemetrySubmitted(room: Room): void {
  room.telemetry.submitted = true
}

function isPregameLoadoutWindow(room: Room): boolean {
  if (room.state.turn !== 1) return false
  if (room.state.phase !== 'planning') return false
  if (room.state.winner !== null) return false
  if (room.state.ready[0] || room.state.ready[1]) return false
  if (room.state.players[0].orders.length > 0 || room.state.players[1].orders.length > 0) return false
  return true
}

function createToken(): string {
  return randomBytes(24).toString('hex')
}

function createRoomTelemetryState(now: number): RoomTelemetryState {
  return {
    matchId: createMatchId(now),
    startedAt: now,
    playedCards: [[], []],
    submitted: false,
  }
}

function createMatchId(now: number): string {
  return `m_${now.toString(36)}_${randomBytes(6).toString('hex')}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalizeSettings(input?: GameSettings): GameSettings {
  if (!input) return { ...DEFAULT_SETTINGS }
  const defaults = DEFAULT_SETTINGS
  return {
    boardRows: toBoundedInt(input.boardRows, defaults.boardRows, 4, 14),
    boardCols: toBoundedInt(input.boardCols, defaults.boardCols, 4, 14),
    strongholdStrength: toBoundedInt(input.strongholdStrength, defaults.strongholdStrength, 1, 20),
    deckSize: toBoundedInt(input.deckSize, defaults.deckSize, 5, 40),
    drawPerTurn: toBoundedInt(input.drawPerTurn, defaults.drawPerTurn, 1, 10),
    maxCopies: toBoundedInt(input.maxCopies, defaults.maxCopies, 1, 10),
    actionBudgetP1: toBoundedInt(input.actionBudgetP1, defaults.actionBudgetP1, 1, 10),
    actionBudgetP2: toBoundedInt(input.actionBudgetP2, defaults.actionBudgetP2, 1, 10),
  }
}

function toBoundedInt(input: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof input === 'number' ? input : Number(input)
  if (!Number.isFinite(numeric)) return fallback
  return clamp(Math.floor(numeric), min, max)
}

function normalizeLoadouts(
  settings: GameSettings,
  input?: { p1: CardDefId[]; p2: CardDefId[] }
): { p1: CardDefId[]; p2: CardDefId[] } {
  const p1 = sanitizeDeck(input?.p1 ?? STARTING_DECK, settings)
  const p2 = sanitizeDeck(input?.p2 ?? STARTING_DECK, settings)
  return { p1, p2 }
}

function sanitizeDeck(deck: CardDefId[], settings: GameSettings): CardDefId[] {
  const counts = new Map<CardDefId, number>()
  const output: CardDefId[] = []
  for (const defId of deck) {
    if (!(defId in CARD_DEFS)) continue
    const count = counts.get(defId) ?? 0
    if (count >= settings.maxCopies) continue
    output.push(defId)
    counts.set(defId, count + 1)
    if (output.length >= settings.deckSize) break
  }

  while (output.length < settings.deckSize) {
    let paddedAny = false
    for (const defId of STARTING_DECK) {
      const count = counts.get(defId) ?? 0
      if (count >= settings.maxCopies) continue
      output.push(defId)
      counts.set(defId, count + 1)
      paddedAny = true
      if (output.length >= settings.deckSize) break
    }
    if (!paddedAny) break
  }

  return output
}

function createPlayerStateFromDeck(
  deckDefIds: CardDefId[],
  seat: PlayerId,
  drawCount: number
): GameState['players'][number] {
  const deck = shuffle(
    deckDefIds.map((defId, index) => ({
      id: `p${seat + 1}-c${index + 1}`,
      defId,
    }))
  )
  const hand = deck.splice(0, Math.max(0, drawCount))
  return {
    deck,
    hand,
    discard: [],
    orders: [],
    modifiers: [],
  }
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items]
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}
