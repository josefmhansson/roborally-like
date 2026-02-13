import './style.css'
import { CARD_DEFS, STARTING_DECK } from './engine/cards'
import { DIRECTIONS, hexToPixel, neighbor, rotateDirection } from './engine/hex'
import {
  createGameState,
  DEFAULT_SETTINGS,
  getSpawnTiles,
  getPlannedMoveSegments,
  getPlannedOrderValidity,
  planOrder,
  resolveNextAction,
  simulatePlannedState,
  startActionPhase,
} from './engine/game'
import { OnlineClient } from './net/client'
import type { OnlineSessionState, PlayMode } from './net/types'
import type { ClientGameCommand, RoomSetup, ServerMessage } from './shared/net/protocol'
import type { GameStateView, PresenceState, ViewMeta } from './shared/net/view'
import type {
  CardInstance,
  CardDefId,
  CardType,
  Direction,
  GameSettings,
  GameState,
  Hex,
  OrderParams,
  PlayerId,
  TileKind,
  Unit,
} from './engine/types'

const app = document.querySelector<HTMLDivElement>('#app')!
if (!app) {
  throw new Error('App root not found')
}

// Theme toggle: remove this line to revert to default.
document.body.classList.add('theme-ember')
const DEBUG_CARD_LAYERS = false
if (DEBUG_CARD_LAYERS) {
  document.body.classList.add('debug-cards')
}

function resolveAssetUrl(relativePath: string): string {
  const baseUrl = import.meta.env.BASE_URL || '/'
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  const normalizedPath = relativePath.replace(/^\/+/, '')
  return `${normalizedBase}${normalizedPath}`
}

function applyCardAssetCssVars(): void {
  const root = document.documentElement
  root.style.setProperty('--card-base-image', `url("${resolveAssetUrl('assets/cards/action_card_base.png')}")`)
  root.style.setProperty('--card-team-image', `url("${resolveAssetUrl('assets/cards/action_card_team.png')}")`)
  root.style.setProperty('--ap-seal-image', `url("${resolveAssetUrl('assets/cards/AP_seal.png')}")`)
}

applyCardAssetCssVars()

app.innerHTML = `
  <div class="app">
    <section id="menu-screen" class="menu-screen">
      <div class="menu-card">
        <div class="title">Untitled Board Game</div>
        <div class="subtitle">MVP sandbox for simultaneous hex tactics</div>
        <div class="menu-actions">
          <button id="menu-start" class="btn">Start Local Game</button>
          <button id="menu-loadout" class="btn ghost">Loadout</button>
          <button id="menu-settings" class="btn ghost">Settings</button>
        </div>
        <div class="seed-block">
          <div class="seed-label">Seed</div>
          <div class="seed-row">
            <input id="seed-input" type="text" placeholder="Copy or paste a seed string..." />
            <button id="seed-copy" class="btn ghost" type="button">Copy</button>
            <button id="seed-apply" class="btn ghost" type="button">Apply</button>
          </div>
          <div id="seed-status" class="seed-status"></div>
        </div>
        <div class="seed-block">
          <div class="seed-label">Online PvP</div>
          <div class="online-row">
            <input id="online-room" type="text" placeholder="Room code (e.g. AB12CD)" />
            <input id="online-token" type="text" placeholder="Seat token" />
          </div>
          <div class="menu-actions">
            <button id="online-create" class="btn" type="button">Create Room</button>
            <button id="online-join" class="btn ghost" type="button">Join Room</button>
            <button id="online-enter" class="btn ghost hidden" type="button">Enter Match</button>
          </div>
          <div id="online-links" class="seed-status"></div>
          <div id="online-status" class="seed-status"></div>
        </div>
      </div>
    </section>

    <section id="loadout-screen" class="menu-screen hidden">
      <div class="menu-card wide">
        <div class="panel-header loadout-header">
          <div class="menu-actions loadout-actions">
            <button id="loadout-toggle" class="btn ghost">Player 1</button>
            <button id="loadout-clear" class="btn ghost">Clear Deck</button>
            <button id="loadout-filters" class="btn ghost">Filter</button>
            <button id="loadout-continue" class="btn hidden">Continue to Match</button>
            <button id="loadout-back" class="btn ghost">Back</button>
          </div>
        </div>
        <div class="loadout-meta">
          <div id="loadout-count"></div>
          <div id="loadout-controls" class="loadout-controls hidden">
            <div class="filter-group">
              <button class="btn ghost filter-btn" data-filter="all">All</button>
              <button class="btn ghost filter-btn" data-filter="reinforcement">Reinforcement</button>
              <button class="btn ghost filter-btn" data-filter="movement">Movement</button>
              <button class="btn ghost filter-btn" data-filter="attack">Attack</button>
              <button class="btn ghost filter-btn" data-filter="spell">Spell</button>
            </div>
            <label class="select-inline">
              Sort
              <select id="loadout-sort">
                <option value="type">Type</option>
                <option value="name">Alphabetical</option>
              </select>
            </label>
          </div>
        </div>
        <div class="loadout-grid">
          <div class="loadout-column">
            <div class="section-title">Selected Cards</div>
            <div id="loadout-selected" class="loadout-list selected"></div>
          </div>
          <div class="loadout-column">
            <div class="section-title">All Cards</div>
            <div id="loadout-all" class="loadout-list cards"></div>
          </div>
        </div>
      </div>
    </section>

    <section id="settings-screen" class="menu-screen hidden">
      <div class="menu-card">
        <div class="panel-header">
          <div>
            <div class="label">Settings</div>
            <div class="planner-name">Game Setup</div>
          </div>
          <button id="settings-back" class="btn ghost">Back</button>
        </div>
        <div class="settings-grid">
          <label>
            Grid rows
            <input id="setting-rows" type="number" min="4" max="14" step="1" />
          </label>
          <label>
            Grid columns
            <input id="setting-cols" type="number" min="4" max="14" step="1" />
          </label>
          <label>
            Stronghold strength
            <input id="setting-stronghold" type="number" min="1" max="20" step="1" />
          </label>
          <label>
            Cards in deck
            <input id="setting-deck" type="number" min="5" max="40" step="1" />
          </label>
          <label>
            Cards drawn per turn
            <input id="setting-draw" type="number" min="1" max="10" step="1" />
          </label>
          <label>
            Max copies per card
            <input id="setting-max-copies" type="number" min="1" max="10" step="1" />
          </label>
          <label>
            Action budget P1
            <input id="setting-action-budget-p1" type="number" min="1" max="10" step="1" />
          </label>
          <label>
            Action budget P2
            <input id="setting-action-budget-p2" type="number" min="1" max="10" step="1" />
          </label>
        </div>
      </div>
    </section>

    <section id="game-screen" class="game-screen hidden">
      <main class="layout">
        <div class="board-stack">
          <section class="board-panel">
            <div class="board-menu">
              <button id="game-menu" class="btn ghost board-menu-btn">Main Menu</button>
              <button id="reset-game" class="btn ghost board-menu-btn">Reset Game</button>
            </div>
            <div id="planner-name" class="board-planner"></div>
            <div class="board-controls">
              <button id="switch-planner" class="btn ghost board-control-btn">Switch Player</button>
              <button id="ready-btn" class="btn board-control-btn">Ready</button>
              <button id="resolve-next" class="btn ghost board-control-btn">Resolve Next</button>
              <button id="resolve-all" class="btn ghost board-control-btn">Resolve Turn</button>
            </div>
            <div id="planner-ap" class="planner-ap board-ap-rail"></div>
            <canvas id="board" aria-label="Game board"></canvas>
            <div class="hud">
              <div id="status">Select a card to start planning.</div>
              <div class="meta">
                <span id="turn"></span>
                <span id="active"></span>
                <span id="counts"></span>
                <span id="network-state"></span>
              </div>
            </div>
          </section>
          <aside class="queue-panel">
            <div id="orders" class="orders orders-vertical"></div>
          </aside>

          <section class="card-rows">
            <div class="card-row">
              <div id="hand" class="card-grid hand-row"></div>
            </div>
          </section>
        </div>
      </main>
      <div class="ui-stash hidden" aria-hidden="true">
        <div id="order-form" class="order-form"></div>
        <div id="log" class="log-list"></div>
      </div>
    </section>
  </div>
  <div id="winner-modal" class="winner-modal hidden" role="dialog" aria-modal="true" aria-labelledby="winner-text">
    <div class="winner-card">
      <div id="winner-text" class="winner-text"></div>
      <div id="winner-note" class="seed-status"></div>
      <div class="winner-actions">
        <button id="winner-menu" class="btn ghost">Main Menu</button>
        <button id="winner-reset" class="btn">Edit Deck</button>
        <button id="winner-rematch" class="btn ghost hidden">Rematch</button>
      </div>
    </div>
  </div>
  <div id="card-overlay" class="card-overlay"></div>
`

const menuScreen = document.querySelector<HTMLDivElement>('#menu-screen')!
const loadoutScreen = document.querySelector<HTMLDivElement>('#loadout-screen')!
const settingsScreen = document.querySelector<HTMLDivElement>('#settings-screen')!
const gameScreen = document.querySelector<HTMLDivElement>('#game-screen')!
const cardOverlay = document.querySelector<HTMLDivElement>('#card-overlay')!

const menuStartButton = document.querySelector<HTMLButtonElement>('#menu-start')!
const menuLoadoutButton = document.querySelector<HTMLButtonElement>('#menu-loadout')!
const menuSettingsButton = document.querySelector<HTMLButtonElement>('#menu-settings')!
const seedInput = document.querySelector<HTMLInputElement>('#seed-input')!
const seedCopyButton = document.querySelector<HTMLButtonElement>('#seed-copy')!
const seedApplyButton = document.querySelector<HTMLButtonElement>('#seed-apply')!
const seedStatus = document.querySelector<HTMLDivElement>('#seed-status')!
const onlineRoomInput = document.querySelector<HTMLInputElement>('#online-room')!
const onlineTokenInput = document.querySelector<HTMLInputElement>('#online-token')!
const onlineCreateButton = document.querySelector<HTMLButtonElement>('#online-create')!
const onlineJoinButton = document.querySelector<HTMLButtonElement>('#online-join')!
const onlineEnterButton = document.querySelector<HTMLButtonElement>('#online-enter')!
const onlineLinksEl = document.querySelector<HTMLDivElement>('#online-links')!
const onlineStatusEl = document.querySelector<HTMLDivElement>('#online-status')!

const loadoutBackButton = document.querySelector<HTMLButtonElement>('#loadout-back')!
const loadoutToggleButton = document.querySelector<HTMLButtonElement>('#loadout-toggle')!
const loadoutClearButton = document.querySelector<HTMLButtonElement>('#loadout-clear')!
const loadoutFilterToggleButton = document.querySelector<HTMLButtonElement>('#loadout-filters')!
const loadoutContinueButton = document.querySelector<HTMLButtonElement>('#loadout-continue')!
const loadoutCountLabel = document.querySelector<HTMLDivElement>('#loadout-count')!
const loadoutControls = document.querySelector<HTMLDivElement>('#loadout-controls')!
const loadoutSelected = document.querySelector<HTMLDivElement>('#loadout-selected')!
const loadoutAll = document.querySelector<HTMLDivElement>('#loadout-all')!
const loadoutSort = document.querySelector<HTMLSelectElement>('#loadout-sort')!
const loadoutFilterButtons = document.querySelectorAll<HTMLButtonElement>('.filter-btn')

const settingsBackButton = document.querySelector<HTMLButtonElement>('#settings-back')!
const settingRows = document.querySelector<HTMLInputElement>('#setting-rows')!
const settingCols = document.querySelector<HTMLInputElement>('#setting-cols')!
const settingStronghold = document.querySelector<HTMLInputElement>('#setting-stronghold')!
const settingDeck = document.querySelector<HTMLInputElement>('#setting-deck')!
const settingDraw = document.querySelector<HTMLInputElement>('#setting-draw')!

const settingMaxCopies = document.querySelector<HTMLInputElement>('#setting-max-copies')!
const settingActionBudgetP1 = document.querySelector<HTMLInputElement>('#setting-action-budget-p1')!
const settingActionBudgetP2 = document.querySelector<HTMLInputElement>('#setting-action-budget-p2')!

const canvas = document.querySelector<HTMLCanvasElement>('#board')!
const statusEl = document.querySelector<HTMLDivElement>('#status')!
const handEl = document.querySelector<HTMLDivElement>('#hand')!
const ordersEl = document.querySelector<HTMLDivElement>('#orders')!
const orderFormEl = document.querySelector<HTMLDivElement>('#order-form')!
const plannerNameEl = document.querySelector<HTMLDivElement>('#planner-name')!
const plannerApEl = document.querySelector<HTMLDivElement>('#planner-ap')!
const turnEl = document.querySelector<HTMLSpanElement>('#turn')!
const activeEl = document.querySelector<HTMLSpanElement>('#active')!
const logEl = document.querySelector<HTMLDivElement>('#log')!
const countsEl = document.querySelector<HTMLSpanElement>('#counts')!
const networkStateEl = document.querySelector<HTMLSpanElement>('#network-state')!
const winnerModal = document.querySelector<HTMLDivElement>('#winner-modal')!
const winnerTextEl = document.querySelector<HTMLDivElement>('#winner-text')!
const winnerNoteEl = document.querySelector<HTMLDivElement>('#winner-note')!
const winnerMenuButton = document.querySelector<HTMLButtonElement>('#winner-menu')!
const winnerResetButton = document.querySelector<HTMLButtonElement>('#winner-reset')!
const winnerRematchButton = document.querySelector<HTMLButtonElement>('#winner-rematch')!
const gameMenuButton = document.querySelector<HTMLButtonElement>('#game-menu')!

const switchPlannerButton = document.querySelector<HTMLButtonElement>('#switch-planner')!
const readyButton = document.querySelector<HTMLButtonElement>('#ready-btn')!
const resolveNextButton = document.querySelector<HTMLButtonElement>('#resolve-next')!
const resolveAllButton = document.querySelector<HTMLButtonElement>('#resolve-all')!
const resetGameButton = document.querySelector<HTMLButtonElement>('#reset-game')!

if (
  !menuScreen ||
  !loadoutScreen ||
  !settingsScreen ||
  !gameScreen ||
  !menuStartButton ||
  !menuLoadoutButton ||
  !menuSettingsButton ||
  !seedInput ||
  !seedCopyButton ||
  !seedApplyButton ||
  !seedStatus ||
  !onlineRoomInput ||
  !onlineTokenInput ||
  !onlineCreateButton ||
  !onlineJoinButton ||
  !onlineEnterButton ||
  !onlineLinksEl ||
  !onlineStatusEl ||
  !loadoutBackButton ||
  !loadoutToggleButton ||
  !loadoutFilterToggleButton ||
  !loadoutContinueButton ||
  !loadoutCountLabel ||
  !loadoutControls ||
  !loadoutSelected ||
  !loadoutAll ||
  !loadoutSort ||
  !settingsBackButton ||
  !settingRows ||
  !settingCols ||
  !settingStronghold ||
  !settingDeck ||
  !settingDraw ||
  !settingMaxCopies ||
  !settingActionBudgetP1 ||
  !settingActionBudgetP2 ||
  !canvas ||
  !statusEl ||
  !handEl ||
  !ordersEl ||
  !orderFormEl ||
  !plannerNameEl ||
  !plannerApEl ||
  !turnEl ||
  !activeEl ||
  !logEl ||
  !countsEl ||
  !networkStateEl ||
  !winnerModal ||
  !winnerTextEl ||
  !winnerNoteEl ||
  !winnerMenuButton ||
  !winnerResetButton ||
  !winnerRematchButton ||
  !gameMenuButton
) {
  throw new Error('UI elements missing')
}

if (
  !switchPlannerButton ||
  !readyButton ||
  !resolveNextButton ||
  !resolveAllButton ||
  !resetGameButton
) {
  throw new Error('Action buttons missing')
}

const ctx = canvas.getContext('2d')!
const deviceScale = Math.max(1, window.devicePixelRatio || 1)
const boardPanel = document.querySelector<HTMLElement>('.board-panel')!
const hudEl = document.querySelector<HTMLDivElement>('.hud')!

let boardZoom = 1
let boardScale = 1
const MIN_BOARD_ZOOM = 0.6
const MAX_BOARD_ZOOM = 2.5
const boardPan = { x: 0, y: 0 }
let boardOffset = { x: 0, y: 0 }
let isPanning = false
let panStart = { x: 0, y: 0 }
let panOrigin = { x: 0, y: 0 }
let didPan = false
let ignoreClick = false
type PinchZoomState = { startDistance: number; startZoom: number }
type TouchPanState = { startX: number; startY: number; originX: number; originY: number; didMove: boolean }
let pinchZoomState: PinchZoomState | null = null
let touchPanState: TouchPanState | null = null

type UnitSnapshot = { pos: Hex; facing: Direction; strength: number; owner: PlayerId; kind: Unit['kind'] }
type MoveAnimation = { type: 'move'; unitId: string; from: Hex; to: Hex; duration: number }
type LungeAnimation = { type: 'lunge'; unitId: string; from: Hex; dir: Direction; duration: number }
type SpawnAnimation = { type: 'spawn'; unitId: string; duration: number }
type BoostAnimation = { type: 'boost'; unitId: string; duration: number }
type DeathAnimation = { type: 'death'; unit: Unit; duration: number }
type LightningAnimation = { type: 'lightning'; target: Hex; duration: number }
type MeteorAnimation = { type: 'meteor'; target: Hex; duration: number }
type ArrowAnimation = { type: 'arrow'; from: Hex; to: Hex; duration: number }
type BoardAnimation =
  | MoveAnimation
  | LungeAnimation
  | SpawnAnimation
  | BoostAnimation
  | DeathAnimation
  | LightningAnimation
  | MeteorAnimation
  | ArrowAnimation

const MOVE_DURATION_MS = 300
const LUNGE_DURATION_MS = 200
const SPAWN_DURATION_MS = 260
const BOOST_DURATION_MS = 320
const DEATH_DURATION_MS = 260
const LIGHTNING_DURATION_MS = 240
const METEOR_DURATION_MS = 1600
const ARROW_DURATION_MS = 300
const CARD_TRANSFER_DURATION_MS = 800

let isAnimating = false
let animationQueue: BoardAnimation[] = []
let currentAnimation: BoardAnimation | null = null
let animationStart = 0
let animationProgress = 0
let autoResolve = false
const pendingDeathUnits = new Map<string, Unit>()
const unitAlphaOverrides = new Map<string, number>()
const deathAlphaOverrides = new Map<string, number>()
let isDraggingOrder = false
let pendingCardTransfer:
  | {
      cardId: string
      fromRect: DOMRect
      fromHandRects: Map<string, DOMRect>
      fromOrderRects: Map<string, DOMRect>
      sourceEl?: HTMLElement
      target: 'hand' | 'orders'
      started?: boolean
    }
  | null = null

let suppressOverlayUntil = 0

if (!boardPanel || !hudEl) {
  throw new Error('Board elements missing')
}

canvas.style.cursor = 'grab'

type ImageAsset = { img: HTMLImageElement; loaded: boolean }

let isInitialized = false

function loadImage(src: string): ImageAsset {
  const img = new Image()
  const asset: ImageAsset = { img, loaded: false }
  img.onload = () => {
    asset.loaded = true
    if (!isInitialized) return
    render()
  }
  img.src = src
  return asset
}

const tileImages: Record<TileKind, ImageAsset> = {
  grass: loadImage(resolveAssetUrl('assets/tiles/tile_grass.png')),
  forest: loadImage(resolveAssetUrl('assets/tiles/tile_forest.png')),
  mountain: loadImage(resolveAssetUrl('assets/tiles/tile_mountain.png')),
  pond: loadImage(resolveAssetUrl('assets/tiles/tile_pond.png')),
  rocky: loadImage(resolveAssetUrl('assets/tiles/tile_rocky.png')),
  rough: loadImage(resolveAssetUrl('assets/tiles/tile_rough.png')),
  shrub: loadImage(resolveAssetUrl('assets/tiles/tile_shrub.png')),
}
const spawnBaseImage = loadImage(resolveAssetUrl('assets/buildings/spawn_village_base.png'))
const spawnTeamImage = loadImage(resolveAssetUrl('assets/buildings/spawn_village_team.png'))
const strongholdBaseImage = loadImage(resolveAssetUrl('assets/buildings/stronghold_base.png'))
const strongholdTeamImage = loadImage(resolveAssetUrl('assets/buildings/stronghold_team.png'))
const unitBaseImage = loadImage(resolveAssetUrl('assets/units/unit_soldier_base.png'))
const unitTeamImage = loadImage(resolveAssetUrl('assets/units/unit_soldier_team.png'))
const unitTeamCache = new Map<PlayerId, HTMLCanvasElement>()
const strongholdTeamCache = new Map<PlayerId, HTMLCanvasElement>()
const spawnTeamCache = new Map<PlayerId, HTMLCanvasElement>()

let gameSettings: GameSettings = { ...DEFAULT_SETTINGS }
let loadouts: { p1: CardDefId[]; p2: CardDefId[] } = {
  p1: STARTING_DECK.slice(0, gameSettings.deckSize),
  p2: STARTING_DECK.slice(0, gameSettings.deckSize),
}
let state = createGameState(gameSettings, loadouts)
let planningPlayer: PlayerId = 0
let selectedCardId: string | null = null
let pendingOrder: { cardId: string; params: OrderParams } | null = null
let previewState: GameState | null = null
let overlayClone: HTMLElement | null = null
let overlaySourceId: string | null = null
let overlaySourceEl: HTMLElement | null = null
let overlayLocked = false
let overlayHideTimer: number | null = null
let overlayShowTimer: number | null = null
let overlaySourceVisibility = ''
let overlaySourceTransition = ''
const overlayClones = new Map<string, HTMLElement>()
let overlayPrewarmFrame: number | null = null
const lastPointer = { x: 0, y: 0 }
let overlayHideSeq = 0
let overlayShowSeq = 0
let hoverCardId: string | null = null
let hasPointer = false
const hiddenCardIds = new Set<string>()

let mode: PlayMode = 'local'
let onlineClient: OnlineClient | null = null
let onlineSession: OnlineSessionState | null = null
type OnlineResolutionReplayState = {
  finalStateView: GameStateView
  finalViewMeta: ViewMeta
  presence: PresenceState
}
let onlineResolutionReplay: OnlineResolutionReplayState | null = null
let onlinePendingAction:
  | { type: 'create'; setup: RoomSetup }
  | { type: 'join'; roomCode: string; seatToken: string; loadout: CardDefId[] }
  | null = null
let onlineAutoEnterGameOnJoin = true
let onlineRouteToLoadoutOnJoin = false
let onlineRematchRequested = false
let onlineReconnectTimer: number | null = null
let onlineSuppressReconnect = false
let onlineCommandSeq = 1

const ONLINE_SESSION_STORAGE_KEY = 'untitled_game_online_session_v1'
const ONLINE_SESSION_VERSION = 1
const ONLINE_RECONNECT_DELAY_MS = 2000

isInitialized = true

let screen: 'menu' | 'loadout' | 'settings' | 'game' = 'menu'
let loadoutPlayer: PlayerId = 0
let loadoutFilter: 'all' | CardType = 'all'
let loadoutSortMode: 'type' | 'name' = 'type'
let loadoutFiltersExpanded = false

const layout = {
  size: 36,
  origin: { x: 60, y: 60 },
  centers: new Map<string, { x: number; y: number }>(),
  width: 800,
  height: 520,
}

const BOARD_TILT = 0.8
const TILE_IMAGE_SCALE = 3
const TILE_ANCHOR_Y = 0.45
const TILE_GAP = 0.6
const BUILDING_IMAGE_SCALE = 1.8
const BUILDING_ANCHOR_Y = 0.7
const STRONGHOLD_IMAGE_SCALE = BUILDING_IMAGE_SCALE * 1.3
const SPAWN_IMAGE_SCALE = BUILDING_IMAGE_SCALE * 1.5
const SPAWN_ANCHOR_Y = BUILDING_ANCHOR_Y - 0.08
const UNIT_IMAGE_SCALE = 1.1
const UNIT_ANCHOR_Y = 0.78
const GHOST_ALPHA = 0.6

type SeedPayload = {
  settings: GameSettings
  loadouts: { p1: CardDefId[]; p2: CardDefId[] }
}

type PersistedProgress = {
  version: 1
  screen: 'menu' | 'loadout' | 'settings' | 'game'
  gameSettings: GameSettings
  loadouts: { p1: CardDefId[]; p2: CardDefId[] }
  state: GameState
  planningPlayer: PlayerId
  selectedCardId: string | null
  pendingOrder: { cardId: string; params: OrderParams } | null
  boardZoom: number
  boardPan: { x: number; y: number }
}

type PersistedOnlineSession = {
  version: number
  roomCode: string
  seatToken: string
}

const PROGRESS_STORAGE_KEY = 'untitled_game_progress_v1'
const PROGRESS_SAVE_DEBOUNCE_MS = 250
let progressSaveTimer: number | null = null

function normalizeDeckInput(input: unknown): CardDefId[] {
  if (!Array.isArray(input)) return []
  return input.filter((id): id is CardDefId => typeof id === 'string' && id in CARD_DEFS)
}

function scheduleProgressSave(): void {
  if (mode === 'online') return
  if (progressSaveTimer !== null) {
    window.clearTimeout(progressSaveTimer)
  }
  progressSaveTimer = window.setTimeout(() => {
    progressSaveTimer = null
    persistProgressNow()
  }, PROGRESS_SAVE_DEBOUNCE_MS)
}

function persistProgressNow(): void {
  if (mode === 'online') return
  try {
    const payload: PersistedProgress = {
      version: 1,
      screen,
      gameSettings,
      loadouts: {
        p1: [...loadouts.p1],
        p2: [...loadouts.p2],
      },
      state,
      planningPlayer,
      selectedCardId,
      pendingOrder,
      boardZoom,
      boardPan: { ...boardPan },
    }
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Ignore storage write issues (quota/private mode/etc).
  }
}

function restoreProgressFromStorage(): ('menu' | 'loadout' | 'settings' | 'game') | null {
  try {
    const raw = localStorage.getItem(PROGRESS_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedProgress>
    if (parsed.version !== 1) return null
    if (!parsed.state || !Array.isArray(parsed.state.tiles) || !Array.isArray(parsed.state.players)) return null
    if (!parsed.gameSettings || !parsed.loadouts) return null

    gameSettings = { ...DEFAULT_SETTINGS, ...parsed.gameSettings }
    loadouts = {
      p1: normalizeDeckInput(parsed.loadouts.p1),
      p2: normalizeDeckInput(parsed.loadouts.p2),
    }
    state = parsed.state as GameState
    planningPlayer = parsed.planningPlayer === 1 ? 1 : 0
    selectedCardId = typeof parsed.selectedCardId === 'string' ? parsed.selectedCardId : null
    pendingOrder =
      parsed.pendingOrder &&
      typeof parsed.pendingOrder.cardId === 'string' &&
      parsed.pendingOrder.params &&
      typeof parsed.pendingOrder.params === 'object'
        ? { cardId: parsed.pendingOrder.cardId, params: parsed.pendingOrder.params }
        : null

    if (typeof parsed.boardZoom === 'number') {
      boardZoom = clamp(parsed.boardZoom, MIN_BOARD_ZOOM, MAX_BOARD_ZOOM)
    }
    if (parsed.boardPan && typeof parsed.boardPan.x === 'number' && typeof parsed.boardPan.y === 'number') {
      boardPan.x = parsed.boardPan.x
      boardPan.y = parsed.boardPan.y
    }

    const candidateScreen = parsed.screen
    const restoredScreen =
      candidateScreen === 'menu' ||
      candidateScreen === 'loadout' ||
      candidateScreen === 'settings' ||
      candidateScreen === 'game'
        ? candidateScreen
        : 'menu'

    const hand = state.players[planningPlayer]?.hand ?? []
    if (selectedCardId && !hand.some((card) => card.id === selectedCardId)) {
      selectedCardId = null
      pendingOrder = null
    }

    return restoredScreen
  } catch {
    return null
  }
}

function getDefaultSocketUrl(): string {
  const configured = (import.meta.env as Record<string, string | boolean | undefined>).VITE_WS_URL
  if (typeof configured === 'string' && configured.length > 0) return configured
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${window.location.host}/ws`
}

function setOnlineStatus(message: string): void {
  onlineStatusEl.textContent = message
}

function setOnlineLinks(message: string): void {
  onlineLinksEl.textContent = message
}

function buildInviteQrUrl(inviteLink: string): string {
  const data = encodeURIComponent(inviteLink)
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${data}`
}

function renderOnlineInviteLinks(selfSeat: PlayerId, inviteLinks: { seat0: string; seat1: string }): void {
  const opponentSeat: PlayerId = selfSeat === 0 ? 1 : 0
  const opponentLink = opponentSeat === 0 ? inviteLinks.seat0 : inviteLinks.seat1
  const selfLink = selfSeat === 0 ? inviteLinks.seat0 : inviteLinks.seat1

  onlineLinksEl.innerHTML = ''
  const container = document.createElement('div')
  container.className = 'online-invite'

  const title = document.createElement('div')
  title.className = 'online-invite-title'
  title.textContent = `You are P${selfSeat + 1}. Share this invite with P${opponentSeat + 1}:`
  container.appendChild(title)

  const link = document.createElement('a')
  link.className = 'online-invite-link'
  link.href = opponentLink
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.textContent = opponentLink
  container.appendChild(link)

  const actions = document.createElement('div')
  actions.className = 'online-invite-actions'

  const copyInviteButton = document.createElement('button')
  copyInviteButton.type = 'button'
  copyInviteButton.className = 'btn ghost'
  copyInviteButton.textContent = 'Copy Invite Link'
  copyInviteButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(opponentLink)
      setOnlineStatus('Invite link copied.')
    } catch {
      setOnlineStatus('Copy failed. Long-press the link and copy manually.')
    }
  })
  actions.appendChild(copyInviteButton)

  const copySelfButton = document.createElement('button')
  copySelfButton.type = 'button'
  copySelfButton.className = 'btn ghost'
  copySelfButton.textContent = 'Copy My Seat Link'
  copySelfButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(selfLink)
      setOnlineStatus('Your seat link copied.')
    } catch {
      setOnlineStatus('Copy failed. Long-press the link and copy manually.')
    }
  })
  actions.appendChild(copySelfButton)

  container.appendChild(actions)

  const qr = document.createElement('img')
  qr.className = 'online-invite-qr'
  qr.alt = `QR code for Player ${opponentSeat + 1} invite`
  qr.loading = 'lazy'
  qr.src = buildInviteQrUrl(opponentLink)
  container.appendChild(qr)

  const note = document.createElement('div')
  note.className = 'online-invite-note'
  note.textContent = 'Scan QR from phone camera or tap/copy the invite link.'
  container.appendChild(note)

  onlineLinksEl.appendChild(container)
}

function refreshOnlineLobbyUi(): void {
  const hasSession = Boolean(onlineSession)
  onlineEnterButton.classList.toggle('hidden', !hasSession)
  onlineEnterButton.disabled = !hasSession
  if (!hasSession) {
    onlineEnterButton.textContent = 'Enter Match'
    return
  }
  onlineEnterButton.textContent = `Enter Match (P${onlineSession!.seat + 1})`
}

function persistOnlineSession(roomCode: string, seatToken: string): void {
  try {
    const payload: PersistedOnlineSession = {
      version: ONLINE_SESSION_VERSION,
      roomCode,
      seatToken,
    }
    localStorage.setItem(ONLINE_SESSION_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Ignore storage failures.
  }
}

function restoreOnlineSession(): { roomCode: string; seatToken: string } | null {
  try {
    const raw = localStorage.getItem(ONLINE_SESSION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedOnlineSession>
    if (parsed.version !== ONLINE_SESSION_VERSION) return null
    if (typeof parsed.roomCode !== 'string' || typeof parsed.seatToken !== 'string') return null
    return {
      roomCode: parsed.roomCode.toUpperCase(),
      seatToken: parsed.seatToken,
    }
  } catch {
    return null
  }
}

function clearOnlineSessionStorage(): void {
  try {
    localStorage.removeItem(ONLINE_SESSION_STORAGE_KEY)
  } catch {
    // Ignore storage failures.
  }
}

function readInviteFromUrl(): { roomCode: string; seatToken: string } | null {
  const params = new URLSearchParams(window.location.search)
  const roomCode = params.get('room')
  const seatToken = params.get('token')
  if (roomCode && seatToken) {
    return {
      roomCode: roomCode.trim().toUpperCase(),
      seatToken: seatToken.trim(),
    }
  }

  const pathMatch = window.location.pathname.match(/^\/join\/([^/]+)\/([^/]+)\/?$/)
  if (!pathMatch) return null
  return {
    roomCode: decodeURIComponent(pathMatch[1]).trim().toUpperCase(),
    seatToken: decodeURIComponent(pathMatch[2]).trim(),
  }
}

function stripInviteQueryParams(): void {
  const hasInviteQuery = Boolean(window.location.search)
  const hasInvitePath = /^\/join\/[^/]+\/[^/]+\/?$/.test(window.location.pathname)
  if (!hasInviteQuery && !hasInvitePath) return
  const url = new URL(window.location.href)
  url.searchParams.delete('room')
  url.searchParams.delete('token')
  if (/^\/join\/[^/]+\/[^/]+\/?$/.test(url.pathname)) {
    url.pathname = '/'
  }
  window.history.replaceState({}, '', url.toString())
}

function clearOnlineReconnectTimer(): void {
  if (onlineReconnectTimer !== null) {
    window.clearTimeout(onlineReconnectTimer)
    onlineReconnectTimer = null
  }
}

function dispatchPendingOnlineAction(): void {
  if (!onlineClient || !onlineClient.isConnected() || !onlinePendingAction) return
  let sent = false
  if (onlinePendingAction.type === 'create') {
    sent = onlineClient.send({
      type: 'create_room',
      setup: onlinePendingAction.setup,
    })
  } else if (onlinePendingAction.type === 'join') {
    sent = onlineClient.send({
      type: 'join_room',
      roomCode: onlinePendingAction.roomCode,
      seatToken: onlinePendingAction.seatToken,
      loadout: onlinePendingAction.loadout,
    })
  }
  if (sent) {
    onlinePendingAction = null
  }
}

function nextOnlineCommandId(): string {
  const value = `cmd-${onlineCommandSeq}`
  onlineCommandSeq += 1
  return value
}

function applyPlayMode(next: PlayMode): void {
  mode = next
  resetCardVisualState()
}

function resetCardVisualState(): void {
  hiddenCardIds.clear()
  pendingCardTransfer = null
  onlineResolutionReplay = null
  clearOverlayClone()
  suppressOverlayUntil = 0
}

function teardownOnlineSession(clearStoredSession: boolean): void {
  clearOnlineReconnectTimer()
  onlinePendingAction = null
  onlineAutoEnterGameOnJoin = true
  onlineRouteToLoadoutOnJoin = false
  onlineRematchRequested = false
  onlineSuppressReconnect = true
  if (onlineClient) {
    onlineClient.close()
    onlineClient = null
  }
  onlineSession = null
  if (clearStoredSession) {
    clearOnlineSessionStorage()
  }
  setOnlineLinks('')
  setOnlineStatus('')
  refreshOnlineLobbyUi()
}

function scheduleOnlineReconnect(): void {
  if (mode !== 'online' || !onlineSession) return
  const session = onlineSession
  onlineAutoEnterGameOnJoin = screen === 'game'
  onlineRouteToLoadoutOnJoin = false
  if (onlineReconnectTimer !== null) return
  onlineReconnectTimer = window.setTimeout(() => {
    onlineReconnectTimer = null
    onlinePendingAction = {
      type: 'join',
      roomCode: session.roomCode,
      seatToken: session.seatToken,
      loadout: [...loadouts.p1],
    }
    ensureOnlineClient()
  }, ONLINE_RECONNECT_DELAY_MS)
}

function ensureOnlineClient(): void {
  if (onlineClient) {
    if (onlineClient.isConnected()) {
      dispatchPendingOnlineAction()
    } else {
      onlineClient.connect()
    }
    return
  }

  onlineClient = new OnlineClient(getDefaultSocketUrl(), {
    onOpen: () => {
      if (onlineSession) {
        onlineSession.connected = true
      }
      setOnlineStatus('Connected.')
      dispatchPendingOnlineAction()
    },
    onClose: (event) => {
      if (onlineSuppressReconnect) return
      if (onlineSession) {
        onlineSession.connected = false
      }
      const reason = event.reason.toLowerCase()
      const reclaimed = event.code === 4000 || reason.includes('reclaimed')
      if (mode === 'online') {
        if (reclaimed) {
          clearOnlineReconnectTimer()
          onlineSuppressReconnect = true
          setOnlineStatus('Seat token already active on another device. Use the other seat token to join as Player 2.')
          render()
          return
        }
        setOnlineStatus('Disconnected. Reconnecting...')
        scheduleOnlineReconnect()
        render()
      }
    },
    onError: () => {
      setOnlineStatus('Connection error.')
    },
    onMessage: (message) => {
      handleServerMessage(message)
    },
  })
  onlineClient.connect()
}

function beginOnlineCreate(): void {
  onlineSuppressReconnect = false
  onlineAutoEnterGameOnJoin = false
  onlineRouteToLoadoutOnJoin = false
  onlineRematchRequested = false
  const setup: RoomSetup = {
    settings: { ...gameSettings },
    loadouts: {
      p1: [...loadouts.p1],
      p2: [...STARTING_DECK],
    },
  }
  applyPlayMode('online')
  onlinePendingAction = { type: 'create', setup }
  setOnlineStatus('Connecting to create room...')
  ensureOnlineClient()
}

function beginOnlineJoin(roomCode: string, seatToken: string, routeToLoadout = true): void {
  onlineSuppressReconnect = false
  onlineAutoEnterGameOnJoin = !routeToLoadout
  onlineRouteToLoadoutOnJoin = routeToLoadout
  onlineRematchRequested = false
  applyPlayMode('online')
  onlinePendingAction = {
    type: 'join',
    roomCode: roomCode.trim().toUpperCase(),
    seatToken: seatToken.trim(),
    loadout: [...loadouts.p1],
  }
  setOnlineStatus('Connecting to join room...')
  ensureOnlineClient()
}

function sendOnlineCommand(command: ClientGameCommand): void {
  if (mode !== 'online') return
  if (onlineSession && onlineSession.presence.paused) {
    statusEl.textContent = 'Match is paused while waiting for reconnect.'
    return
  }
  if (!onlineClient || !onlineClient.isConnected()) {
    statusEl.textContent = 'Offline. Waiting to reconnect...'
    return
  }
  const cmdId = nextOnlineCommandId()
  const sent = onlineClient.send({
    type: 'command',
    cmdId,
    command,
  })
  if (!sent) {
    statusEl.textContent = 'Unable to send command right now.'
  }
}

function submitOnlineLoadoutAndContinue(): void {
  if (mode !== 'online' || !onlineSession) {
    setScreen('game')
    return
  }
  if (!onlineClient || !onlineClient.isConnected()) {
    setOnlineStatus('Still connecting to room...')
    return
  }
  sendOnlineCommand({
    type: 'update_loadout',
    loadout: [...loadouts.p1],
  })
  statusEl.textContent = state.winner !== null ? 'Deck saved.' : 'Deck submitted. Entering match...'
  if (state.winner !== null) {
    setOnlineStatus('Deck updated for rematch.')
  }
  setScreen('game')
}

function requestOnlineRematch(): void {
  if (mode !== 'online' || !onlineSession) return
  sendOnlineCommand({
    type: 'update_loadout',
    loadout: [...loadouts.p1],
  })
  sendOnlineCommand({ type: 'rematch' })
  onlineRematchRequested = true
  statusEl.textContent = 'Rematch requested, waiting for opponent.'
  setScreen('game')
  render()
}

function mapViewToState(view: GameStateView): GameState {
  const players: GameState['players'] = [
    {
      deck: [],
      hand: cloneCards(view.players[0].hand),
      discard: [],
      orders: cloneOrders(view.players[0].orders),
    },
    {
      deck: [],
      hand: cloneCards(view.players[1].hand),
      discard: [],
      orders: cloneOrders(view.players[1].orders),
    },
  ]

  const units: GameState['units'] = {}
  Object.entries(view.units).forEach(([id, unit]) => {
    units[id] = {
      ...unit,
      pos: { ...unit.pos },
    }
  })

  return {
    boardRows: view.boardRows,
    boardCols: view.boardCols,
    tiles: view.tiles.map((tile) => ({ ...tile })),
    units,
    players,
    ready: [view.ready[0], view.ready[1]],
    actionBudgets: [view.actionBudgets[0], view.actionBudgets[1]],
    activePlayer: view.activePlayer,
    phase: view.phase,
    actionQueue: cloneOrders(view.actionQueue),
    actionIndex: view.actionIndex,
    turn: view.turn,
    nextUnitId: view.nextUnitId,
    nextOrderId: view.nextOrderId,
    log: [...view.log],
    winner: view.winner,
    spawnedByOrder: { ...view.spawnedByOrder },
    settings: { ...view.settings },
  }
}

function cloneCards(cards: CardInstance[] | null): CardInstance[] {
  if (!cards) return []
  return cards.map((card) => ({ ...card }))
}

function cloneOrders(orders: GameState['actionQueue'] | null): GameState['actionQueue'] {
  if (!orders) return []
  return orders.map((order) => ({
    ...order,
    params: {
      ...order.params,
      tile: order.params.tile ? { ...order.params.tile } : undefined,
    },
  }))
}

function applyOnlineSnapshot(stateView: GameStateView, viewMeta: ViewMeta, presence: PresenceState): void {
  clearActionAnimationState()
  state = mapViewToState(stateView)
  gameSettings = { ...state.settings }
  resizeDecks(gameSettings.deckSize)
  enforceMaxCopies()
  planningPlayer = viewMeta.selfSeat
  loadoutPlayer = 0
  clearOverlayClone()
  pendingCardTransfer = null
  hiddenCardIds.clear()
  if (!onlineSession) {
    onlineSession = {
      roomCode: viewMeta.roomCode,
      seat: viewMeta.selfSeat,
      seatToken: '',
      connected: true,
      presence,
      viewMeta,
    }
  } else {
    onlineSession.viewMeta = viewMeta
    onlineSession.presence = presence
    onlineSession.connected = true
  }

  const hand = state.players[planningPlayer]?.hand ?? []
  if (selectedCardId && !hand.some((card) => card.id === selectedCardId)) {
    selectedCardId = null
    pendingOrder = null
  }

  if (pendingOrder) {
    const pendingCardId = pendingOrder.cardId
    if (!hand.some((card) => card.id === pendingCardId)) {
      pendingOrder = null
    }
  }
  if (state.winner === null) {
    onlineRematchRequested = false
  }
  if (screen === 'loadout') {
    renderLoadout()
  }
}

function isOnlineResolutionReplayActive(): boolean {
  return mode === 'online' && onlineResolutionReplay !== null && state.phase === 'action'
}

function finalizeOnlineResolutionReplay(): boolean {
  if (!onlineResolutionReplay) return false
  if (state.phase === 'action') return false
  const replay = onlineResolutionReplay
  onlineResolutionReplay = null
  applyOnlineSnapshot(replay.finalStateView, replay.finalViewMeta, replay.presence)
  if (state.winner !== null) {
    statusEl.textContent = `Player ${state.winner + 1} wins!`
  } else {
    statusEl.textContent = 'Resolution complete. Planning phase.'
  }
  return true
}

function handleServerMessage(message: ServerMessage): void {
  if (message.type === 'room_created') {
    onlineRoomInput.value = message.roomCode
    onlineTokenInput.value = message.seatToken
    renderOnlineInviteLinks(message.seat, message.inviteLinks)
    onlineSession = {
      roomCode: message.roomCode,
      seat: message.seat,
      seatToken: message.seatToken,
      connected: true,
      presence: {
        connected: [true, false],
        paused: false,
        deadlineAt: null,
      },
      viewMeta: null,
    }
    persistOnlineSession(message.roomCode, message.seatToken)
    setOnlineStatus(`Room ${message.roomCode} created.`)
    refreshOnlineLobbyUi()
    return
  }

  if (message.type === 'joined') {
    if (!onlineSession) {
      const token = onlinePendingAction?.type === 'join' ? onlinePendingAction.seatToken : onlineTokenInput.value.trim()
      onlineSession = {
        roomCode: message.roomCode,
        seat: message.seat,
        seatToken: token,
        connected: true,
        presence: {
          connected: [false, false],
          paused: false,
          deadlineAt: null,
        },
        viewMeta: null,
      }
    } else {
      onlineSession.roomCode = message.roomCode
      onlineSession.seat = message.seat
      onlineSession.connected = true
    }
    planningPlayer = message.seat
    loadoutPlayer = 0
    persistOnlineSession(message.roomCode, onlineSession.seatToken)
    setOnlineStatus(`Joined room ${message.roomCode} as Player ${message.seat + 1}.`)
    refreshOnlineLobbyUi()
    if (onlineRouteToLoadoutOnJoin) {
      setScreen('loadout')
      onlineRouteToLoadoutOnJoin = false
    } else if (onlineAutoEnterGameOnJoin) {
      setScreen('game')
    } else {
      setScreen('menu')
    }
    stripInviteQueryParams()
    return
  }

  if (message.type === 'snapshot') {
    applyPlayMode('online')
    onlineResolutionReplay = null
    applyOnlineSnapshot(message.stateView, message.viewMeta, message.presence)
    if (onlineSession) {
      onlineSession.roomCode = message.viewMeta.roomCode
      onlineSession.seat = message.viewMeta.selfSeat
      onlineSession.viewMeta = message.viewMeta
      onlineSession.presence = message.presence
    }
    render()
    return
  }

  if (message.type === 'resolution_bundle') {
    applyPlayMode('online')
    onlineResolutionReplay = {
      finalStateView: message.finalStateView,
      finalViewMeta: message.finalViewMeta,
      presence: message.presence,
    }
    applyOnlineSnapshot(message.actionStartStateView, message.actionStartViewMeta, message.presence)
    statusEl.textContent = 'Resolution started. Step through actions.'
    render()
    return
  }

  if (message.type === 'presence_update') {
    if (onlineSession) {
      onlineSession.presence = {
        connected: [message.connected[0], message.connected[1]],
        paused: message.paused,
        deadlineAt: message.deadlineAt,
      }
    }
    render()
    return
  }

  if (message.type === 'command_result') {
    const lower = (message.message ?? '').toLowerCase()
    if (!message.ok) {
      if (lower.includes('rematch')) {
        onlineRematchRequested = false
      }
      statusEl.textContent = message.message ?? 'Command rejected.'
    } else if (message.message) {
      if (lower.includes('rematch requested')) {
        onlineRematchRequested = true
      }
      statusEl.textContent = message.message
    }
    render()
    return
  }

  if (message.type === 'match_end') {
    if (message.winner !== null) {
      statusEl.textContent = `Player ${message.winner + 1} wins (${message.reason}).`
    } else {
      statusEl.textContent = `Match ended (${message.reason}).`
    }
    return
  }

  if (message.type === 'error') {
    setOnlineStatus(`Error: ${message.message}`)
  }
}

function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Ignore service worker registration failures.
    })
  })
}

function setPlayerReady(player: PlayerId, ready: boolean): void {
  state.ready[player] = ready
  updateReadyButtons()
}

function updateReadyButtons(): void {
  const currentReady = state.ready[planningPlayer]
  readyButton.classList.toggle('ready', currentReady)
  const compactLabels = window.matchMedia('(max-width: 720px)').matches
  readyButton.textContent = compactLabels
    ? currentReady
      ? `P${planningPlayer + 1} Ready`
      : `Ready P${planningPlayer + 1}`
    : currentReady
      ? `Player ${planningPlayer + 1} Ready`
      : `Ready (Player ${planningPlayer + 1})`
}

function clearReady(player?: PlayerId): void {
  if (player === undefined) {
    state.ready = [false, false]
  } else {
    state.ready[player] = false
  }
  updateReadyButtons()
}

function tryStartActionPhase(): void {
  if (state.ready[0] && state.ready[1]) {
    startActionPhase(state)
    selectedCardId = null
    pendingOrder = null
    statusEl.textContent = 'Action phase in progress.'
    render()
  }
}

function resetGameState(statusMessage: string): void {
  if (mode === 'online') {
    statusEl.textContent = 'Reset is disabled in online matches.'
    return
  }
  resetCardVisualState()
  clearActionAnimationState()
  state = createGameState(gameSettings, loadouts)
  planningPlayer = 0
  selectedCardId = null
  pendingOrder = null
  winnerModal.classList.add('hidden')
  updateReadyButtons()
  statusEl.textContent = statusMessage
  render()
}

function clearActionAnimationState(): void {
  animationQueue = []
  currentAnimation = null
  isAnimating = false
  autoResolve = false
  pendingDeathUnits.clear()
  unitAlphaOverrides.clear()
  deathAlphaOverrides.clear()
}

function clearOverlayTimers(): void {
  if (overlayShowTimer !== null) {
    window.clearTimeout(overlayShowTimer)
    overlayShowTimer = null
  }
  if (overlayHideTimer !== null) {
    window.clearTimeout(overlayHideTimer)
    overlayHideTimer = null
  }
}

function clearOverlayClone(): void {
  clearOverlayTimers()
  if (!overlayClone) return
  const clone = overlayClone
  const source = overlaySourceEl
  overlayShowSeq += 1
  overlayHideSeq += 1
  const hideSeq = overlayHideSeq
  overlaySourceId = null
  overlaySourceEl = null
  overlayLocked = false
  if (source && source.isConnected) {
    source.style.opacity = overlaySourceVisibility
    source.style.transition = overlaySourceTransition
  }

  clone.style.display = 'block'
  clone.style.visibility = 'visible'
  clone.style.transition = 'transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity 120ms ease'
  window.requestAnimationFrame(() => {
    if (hideSeq !== overlayHideSeq) return
    clone.style.opacity = '0'
    clone.style.transform = 'scale(1)'
  })

  const finalize = () => {
    if (hideSeq !== overlayHideSeq) return
    clone.removeEventListener('transitionend', finalize)
    if (clone.isConnected) {
      clone.style.display = 'none'
      clone.style.visibility = 'hidden'
    }
  }

  clone.addEventListener('transitionend', finalize)
  window.setTimeout(finalize, 260)
}

function hardResetOverlayClone(): void {
  clearOverlayTimers()
  if (!overlayClone) return
  overlayHideSeq += 1
  const clone = overlayClone
  const source = overlaySourceEl
  overlaySourceId = null
  overlaySourceEl = null
  overlayLocked = false
  if (source && source.isConnected) {
    source.style.opacity = overlaySourceVisibility
    source.style.transition = overlaySourceTransition
  }
  clone.style.opacity = '0'
  clone.style.transform = 'scale(1)'
  clone.style.visibility = 'hidden'
  clone.style.display = 'none'
}

function animateOverlayCloneOut(clone: HTMLElement): void {
  clone.style.display = 'block'
  clone.style.visibility = 'visible'
  clone.style.transition = 'transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity 120ms ease'
  requestAnimationFrame(() => {
    clone.style.opacity = '0'
    clone.style.transform = 'scale(1)'
  })
  const finalize = () => {
    clone.removeEventListener('transitionend', finalize)
    if (clone.isConnected) {
      clone.style.display = 'none'
      clone.style.visibility = 'hidden'
    }
  }
  clone.addEventListener('transitionend', finalize)
  window.setTimeout(finalize, 260)
}

function prewarmOverlayClones(): void {
  const elements = [
    ...handEl.querySelectorAll<HTMLElement>('[data-card-id]'),
    ...ordersEl.querySelectorAll<HTMLElement>('[data-card-id]'),
  ]
  const liveIds = new Set<string>()
  elements.forEach((el) => {
    const id = el.dataset.cardId
    if (!id) return
    liveIds.add(id)
    let clone = overlayClones.get(id)
    if (!clone) {
      clone = el.cloneNode(true) as HTMLElement
      clone.classList.add('card-overlay-clone')
      clone.dataset.cardLayer = 'overlay'
      clone.style.transformOrigin = 'center center'
      clone.style.opacity = '0'
      clone.style.transform = 'scale(1)'
      clone.style.transition = 'none'
      clone.style.display = 'none'
      clone.style.visibility = 'hidden'
      cardOverlay.appendChild(clone)
      overlayClones.set(id, clone)
    } else {
      clone.className = `${el.className} card-overlay-clone`
      clone.innerHTML = el.innerHTML
      clone.dataset.cardLayer = 'overlay'
    }
    const rect = el.getBoundingClientRect()
    clone.style.left = `${rect.left}px`
    clone.style.top = `${rect.top}px`
    clone.style.width = `${rect.width}px`
    clone.style.height = `${rect.height}px`
  })

  overlayClones.forEach((clone, id) => {
    if (!liveIds.has(id)) {
      if (clone.isConnected) clone.remove()
      overlayClones.delete(id)
    }
  })
}

function scheduleOverlayPrewarm(): void {
  if (overlayPrewarmFrame !== null) {
    cancelAnimationFrame(overlayPrewarmFrame)
    overlayPrewarmFrame = null
  }
  overlayPrewarmFrame = requestAnimationFrame(() => {
    overlayPrewarmFrame = requestAnimationFrame(() => {
      overlayPrewarmFrame = null
      prewarmOverlayClones()
    })
  })
}

function showOverlayClone(sourceEl: HTMLElement, lock: boolean, immediate = false): void {
  const cardId = sourceEl.dataset.cardId ?? null
  if (!cardId) return
  if (performance.now() < suppressOverlayUntil) return
  if (hiddenCardIds.has(cardId)) return
  if (overlayLocked && overlaySourceId === cardId) {
    return
  }
  overlayHideSeq += 1
  overlayShowSeq += 1
  const showSeq = overlayShowSeq

  if (overlayClone && overlaySourceId === cardId) {
    if (!overlaySourceEl || !overlaySourceEl.isConnected) {
      clearOverlayClone()
    } else {
      overlayLocked = lock
      const rect = sourceEl.getBoundingClientRect()
      overlayClone.style.left = `${rect.left}px`
      overlayClone.style.top = `${rect.top}px`
      overlayClone.style.width = `${rect.width}px`
      overlayClone.style.height = `${rect.height}px`
      overlayClone.style.display = 'block'
      overlayClone.style.visibility = 'visible'
      overlaySourceEl = sourceEl
      overlaySourceVisibility = sourceEl.style.opacity
      overlaySourceTransition = sourceEl.style.transition
    }
  }

  if (overlaySourceEl && overlaySourceEl !== sourceEl && overlaySourceEl.isConnected) {
    overlaySourceEl.style.transition = 'opacity 120ms ease'
    overlaySourceEl.style.opacity = '1'
  }
  if (!overlayLocked) {
    if (overlayClone && overlaySourceId && overlaySourceId !== cardId) {
      animateOverlayCloneOut(overlayClone)
    } else {
      hardResetOverlayClone()
    }
  }
  let clone = overlayClones.get(cardId)
  if (!clone) {
    clone = sourceEl.cloneNode(true) as HTMLElement
    clone.classList.add('card-overlay-clone')
    clone.dataset.cardLayer = 'overlay'
    clone.style.transformOrigin = 'center center'
    clone.style.opacity = '0'
    clone.style.transform = 'scale(1)'
    clone.style.transition = 'none'
    clone.style.display = 'none'
    clone.style.visibility = 'hidden'
    cardOverlay.appendChild(clone)
    overlayClones.set(cardId, clone)
  } else {
    clone.className = `${sourceEl.className} card-overlay-clone`
    clone.innerHTML = sourceEl.innerHTML
    clone.dataset.cardLayer = 'overlay'
    clone.style.opacity = '0'
    clone.style.transform = 'scale(1)'
    clone.style.transition = 'none'
    clone.style.visibility = 'hidden'
  }
  clone.style.display = 'none'
  overlayClone = clone

  const applyPhase = (activeClone: HTMLElement) => {
    activeClone.style.transition = 'transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity 120ms ease'
    activeClone.style.opacity = '1'
    activeClone.style.visibility = 'visible'
  }

  overlaySourceId = cardId
  overlaySourceEl = sourceEl
  overlayLocked = lock
  overlaySourceVisibility = sourceEl.style.opacity
  overlaySourceTransition = sourceEl.style.transition

  const start = (activeClone: HTMLElement) => {
    const settle = (attempt = 0) => {
      if (showSeq !== overlayShowSeq || overlaySourceId !== cardId) return
      const rectA = sourceEl.getBoundingClientRect()
      window.requestAnimationFrame(() => {
        if (showSeq !== overlayShowSeq || overlaySourceId !== cardId) return
        const rectB = sourceEl.getBoundingClientRect()
        const dx = Math.abs(rectA.left - rectB.left)
        const dy = Math.abs(rectA.top - rectB.top)
        const dw = Math.abs(rectA.width - rectB.width)
        const dh = Math.abs(rectA.height - rectB.height)
        const stable = dx < 0.5 && dy < 0.5 && dw < 0.5 && dh < 0.5
        if (!stable && attempt < 2) {
          settle(attempt + 1)
          return
        }
        activeClone.style.left = `${rectB.left}px`
        activeClone.style.top = `${rectB.top}px`
        activeClone.style.width = `${rectB.width}px`
        activeClone.style.height = `${rectB.height}px`
        activeClone.style.display = 'block'
        applyPhase(activeClone)
        window.requestAnimationFrame(() => {
          if (showSeq !== overlayShowSeq || overlaySourceId !== cardId) return
          activeClone.style.transform = 'scale(1.5)'
          window.requestAnimationFrame(() => {
            if (showSeq !== overlayShowSeq || overlaySourceId !== cardId) return
            if (sourceEl.isConnected) {
              sourceEl.style.transition = 'opacity 80ms ease'
              sourceEl.style.opacity = '0'
            }
          })
        })
      })
    }
    settle()
  }

  if (immediate) {
    start(clone)
  } else {
    window.requestAnimationFrame(() => start(clone))
  }
}

function isPointInsideOverlayClone(): boolean {
  if (!overlayClone) return false
  if (overlayClone.style.display === 'none' || overlayClone.style.visibility === 'hidden') return false
  const rect = overlayClone.getBoundingClientRect()
  return (
    lastPointer.x >= rect.left &&
    lastPointer.x <= rect.right &&
    lastPointer.y >= rect.top &&
    lastPointer.y <= rect.bottom
  )
}

function updateHoverFromPointer(): void {
  if (!hasPointer || overlayLocked) return
  if (performance.now() < suppressOverlayUntil) return
  if (hiddenCardIds.size > 0) return
  const el = document.elementFromPoint(lastPointer.x, lastPointer.y) as HTMLElement | null
  const hoveredEl = el?.closest<HTMLElement>('.card[data-card-id]')
  const cardEl = hoveredEl?.classList.contains('hidden-card') ? null : hoveredEl
  let cardId = cardEl?.dataset.cardId ?? null

  // While a card is zoomed, keep hover active inside the zoomed footprint too.
  if (!cardId && overlaySourceId && isPointInsideOverlayClone()) {
    cardId = overlaySourceId
  }

  if (cardId) {
    if (cardId !== hoverCardId || (overlayClone && overlayClone.style.display === 'none')) {
      hoverCardId = cardId
      if (cardEl) {
        showOverlayClone(cardEl, false, true)
      }
    }
    return
  }
  if (hoverCardId) {
    hoverCardId = null
    clearOverlayClone()
  }
}

function syncOverlayPositionWithSource(): void {
  if (!overlayClone || !overlaySourceId) return
  if (overlayClone.style.display === 'none' || overlayClone.style.visibility === 'hidden') return
  const source =
    handEl.querySelector<HTMLElement>(`[data-card-id="${overlaySourceId}"]`) ??
    ordersEl.querySelector<HTMLElement>(`[data-card-id="${overlaySourceId}"]`)
  if (!source) {
    if (overlayLocked) {
      clearOverlayClone()
    }
    return
  }
  overlaySourceEl = source
  overlaySourceVisibility = source.style.opacity
  overlaySourceTransition = source.style.transition
  const rect = source.getBoundingClientRect()
  overlayClone.style.left = `${rect.left}px`
  overlayClone.style.top = `${rect.top}px`
  overlayClone.style.width = `${rect.width}px`
  overlayClone.style.height = `${rect.height}px`
}

function syncOverlayFromSelection(): void {
  if (selectedCardId) {
    const el = handEl.querySelector<HTMLElement>(`[data-card-id="${selectedCardId}"]`)
    if (el) {
      if (overlayLocked && overlaySourceId === selectedCardId) {
        syncOverlayPositionWithSource()
        return
      }
      showOverlayClone(el, true, true)
      return
    }
  }
  if (overlayLocked) {
    clearOverlayClone()
  }
}



const ghostCanvas = document.createElement('canvas')
const ghostCtx = ghostCanvas.getContext('2d')!

function projectHex(hex: Hex): { x: number; y: number } {
  const base = hexToPixel(hex, layout.size, { x: 0, y: 0 })
  return { x: base.x + layout.origin.x, y: base.y * BOARD_TILT + layout.origin.y }
}

function polygonCornersProjected(center: { x: number; y: number }, size: number): { x: number; y: number }[] {
  const corners: { x: number; y: number }[] = []
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 180) * (60 * i - 30)
    corners.push({
      x: center.x + size * Math.cos(angle),
      y: center.y + size * Math.sin(angle) * BOARD_TILT,
    })
  }
  return corners
}

function drawAnchoredImageTo(
  context: CanvasRenderingContext2D,
  asset: ImageAsset,
  center: { x: number; y: number },
  scale: number,
  anchorY: number
): void {
  if (!asset.loaded) return
  drawAnchoredSource(context, asset.img, asset.img.width, asset.img.height, center, scale, anchorY)
}

function drawAnchoredImage(asset: ImageAsset, center: { x: number; y: number }, scale: number, anchorY: number): void {
  drawAnchoredImageTo(ctx, asset, center, scale, anchorY)
}

function drawAnchoredSource(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  center: { x: number; y: number },
  scale: number,
  anchorY: number
): void {
  const baseSize = layout.size * scale
  const ratio = sourceHeight / sourceWidth || 1
  const drawWidth = baseSize
  const drawHeight = baseSize * ratio
  const drawX = center.x - drawWidth / 2
  const drawY = center.y - drawHeight * anchorY
  context.drawImage(source, drawX, drawY, drawWidth, drawHeight)
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function drawBoostGlow(center: { x: number; y: number }, progress: number): void {
  const pulse = Math.sin(progress * Math.PI)
  const radius = layout.size * (0.65 + 0.55 * pulse)
  const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius)
  gradient.addColorStop(0, 'rgba(255, 220, 120, 0.55)')
  gradient.addColorStop(0.6, 'rgba(255, 180, 80, 0.25)')
  gradient.addColorStop(1, 'rgba(255, 160, 50, 0)')
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function getTeamTint(owner: PlayerId): string {
  return owner === 0 ? '#2da9ff' : '#ff3b3b'
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return { r, g, b }
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) => v.toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function mixColor(color: string, target: string, amount: number): string {
  const a = hexToRgb(color)
  const b = hexToRgb(target)
  const t = clamp(amount, 0, 1)
  const r = Math.round(a.r + (b.r - a.r) * t)
  const g = Math.round(a.g + (b.g - a.g) * t)
  const bVal = Math.round(a.b + (b.b - a.b) * t)
  return rgbToHex(r, g, bVal)
}

const TEAM_TINT_LIFT = 0.2
const TEAM_RING_DARKEN = 0.3

function getSpriteTint(owner: PlayerId): string {
  return mixColor(getTeamTint(owner), '#ffffff', TEAM_TINT_LIFT)
}

function getRingTint(owner: PlayerId): string {
  return mixColor(getTeamTint(owner), '#000000', TEAM_RING_DARKEN)
}

function getTintedTeamLayer(
  owner: PlayerId,
  base: ImageAsset,
  cache: Map<PlayerId, HTMLCanvasElement>
): HTMLCanvasElement | null {
  if (!base.loaded) return null
  const cached = cache.get(owner)
  if (cached) return cached

  const canvasEl = document.createElement('canvas')
  canvasEl.width = base.img.width
  canvasEl.height = base.img.height
  const context = canvasEl.getContext('2d')!
  context.drawImage(base.img, 0, 0)
  context.globalCompositeOperation = 'overlay'
  context.fillStyle = getSpriteTint(owner)
  context.fillRect(0, 0, canvasEl.width, canvasEl.height)
  context.globalCompositeOperation = 'destination-in'
  context.drawImage(base.img, 0, 0)
  context.globalCompositeOperation = 'source-over'
  cache.set(owner, canvasEl)
  return canvasEl
}

function drawUnitSprite(center: { x: number; y: number }, owner: PlayerId): void {
  if (!unitBaseImage.loaded) return
  drawAnchoredImage(unitBaseImage, center, UNIT_IMAGE_SCALE, UNIT_ANCHOR_Y)
  const tinted = getTintedTeamLayer(owner, unitTeamImage, unitTeamCache)
  if (!tinted) return
  drawAnchoredSource(ctx, tinted, tinted.width, tinted.height, center, UNIT_IMAGE_SCALE, UNIT_ANCHOR_Y)
}

function drawStructureSprite(
  center: { x: number; y: number },
  owner: PlayerId,
  base: ImageAsset,
  team: ImageAsset,
  cache: Map<PlayerId, HTMLCanvasElement>,
  scale: number,
  anchorY: number
): void {
  if (!base.loaded) return
  drawAnchoredImage(base, center, scale, anchorY)
  const tinted = getTintedTeamLayer(owner, team, cache)
  if (!tinted) return
  drawAnchoredSource(ctx, tinted, tinted.width, tinted.height, center, scale, anchorY)
}

function getAnimatedCenter(unit: Unit): { x: number; y: number } {
  if (!currentAnimation || !('unitId' in currentAnimation) || currentAnimation.unitId !== unit.id) {
    return projectHex(unit.pos)
  }

  const t = easeInOutCubic(animationProgress)
  if (currentAnimation.type === 'move') {
    const from = projectHex(currentAnimation.from)
    const to = projectHex(currentAnimation.to)
    return {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    }
  }

  if (currentAnimation.type === 'lunge') {
    const base = projectHex(currentAnimation.from)
    const neighborHex = neighbor(currentAnimation.from, currentAnimation.dir)
    const neighborCenter = projectHex(neighborHex)
    const lunge = Math.sin(t * Math.PI) * 0.35
    return {
      x: base.x + (neighborCenter.x - base.x) * lunge,
      y: base.y + (neighborCenter.y - base.y) * lunge,
    }
  }

  return projectHex(unit.pos)
}

function getAnimationAlpha(): number {
  if (!currentAnimation) return 1
  if (currentAnimation.type === 'spawn') return easeInOutCubic(animationProgress)
  if (currentAnimation.type === 'death') return 1 - easeInOutCubic(animationProgress)
  return 1
}

function drawStrengthDots(
  center: { x: number; y: number },
  baseStrength: number,
  previewStrength: number | null,
  baseColor: string
): void {
  const strength = previewStrength !== null ? Math.max(baseStrength, previewStrength) : baseStrength
  if (strength <= 0) return
  const dotRadius = Math.max(2, layout.size * 0.07)
  const spacing = dotRadius * 2.6
  const baseX = center.x + layout.size * 0.48
  const baseY = center.y
  const delta = previewStrength !== null ? previewStrength - baseStrength : 0

  ctx.save()
  for (let i = 0; i < strength; i += 1) {
    const y = baseY - i * spacing * BOARD_TILT
    let dotColor = baseColor
    if (delta > 0 && i >= baseStrength) {
      dotColor = '#7CFF8A'
    } else if (delta < 0 && previewStrength !== null && i >= previewStrength) {
      dotColor = '#ff2b2b'
    }
    const gradient = ctx.createRadialGradient(
      baseX - dotRadius * 0.35,
      y - dotRadius * 0.35,
      dotRadius * 0.2,
      baseX,
      y,
      dotRadius
    )
    gradient.addColorStop(0, '#ffffff')
    gradient.addColorStop(0.3, dotColor)
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.6)')
    ctx.beginPath()
    ctx.arc(baseX, y, dotRadius, 0, Math.PI * 2)
    ctx.fillStyle = gradient
    ctx.fill()
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)'
    ctx.lineWidth = 0.8
    ctx.stroke()
  }
  ctx.restore()
}

function setScreen(next: typeof screen): void {
  screen = next
  applyCardAssetCssVars()
  menuScreen.classList.toggle('hidden', screen !== 'menu')
  loadoutScreen.classList.toggle('hidden', screen !== 'loadout')
  settingsScreen.classList.toggle('hidden', screen !== 'settings')
  gameScreen.classList.toggle('hidden', screen !== 'game')
  winnerModal.classList.toggle('hidden', screen !== 'game' || state.winner === null)
  if (screen === 'menu') updateSeedDisplay()
  if (screen === 'loadout') renderLoadout()
  if (screen === 'settings') renderSettings()
  if (screen === 'game') render()
  scheduleProgressSave()
}

function drawLightningStrike(center: { x: number; y: number }, progress: number): void {
  const alpha = 1 - progress
  const height = layout.size * 1.5
  const start = { x: center.x + layout.size * 0.25, y: center.y - height }
  const segments = 6
  const points: { x: number; y: number }[] = [start]
  for (let i = 1; i <= segments; i += 1) {
    const t = i / segments
    const jitter = Math.sin((t + progress) * Math.PI * 5) * layout.size * 0.22
    points.push({
      x: center.x + jitter,
      y: start.y + (center.y - start.y) * t,
    })
  }

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = alpha
  ctx.lineCap = 'round'
  ctx.beginPath()
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y)
    else ctx.lineTo(point.x, point.y)
  })
  ctx.strokeStyle = 'rgba(220, 245, 255, 0.9)'
  ctx.lineWidth = 3.2
  ctx.stroke()
  ctx.strokeStyle = 'rgba(120, 190, 255, 0.9)'
  ctx.lineWidth = 1.6
  ctx.stroke()
  ctx.restore()
}

function drawMeteorImpact(target: Hex, progress: number): void {
  const center = projectHex(target)
  const start = {
    x: center.x - layout.size * 1.2,
    y: center.y - layout.size * 3.8,
  }
  const t = easeInOutCubic(progress)
  const orbX = start.x + (center.x - start.x) * t
  const orbY = start.y + (center.y - start.y) * t
  const radius = layout.size * (0.45 + 0.15 * Math.sin(t * Math.PI))

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const gradient = ctx.createRadialGradient(orbX, orbY, radius * 0.2, orbX, orbY, radius)
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)')
  gradient.addColorStop(0.4, 'rgba(255, 190, 120, 0.95)')
  gradient.addColorStop(1, 'rgba(210, 92, 30, 0.8)')
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(orbX, orbY, radius, 0, Math.PI * 2)
  ctx.fill()

  if (progress > 0.9) {
    const ringProgress = (progress - 0.9) / 0.1
    const ringRadius = layout.size * (0.3 + ringProgress * 2.2)
    ctx.beginPath()
    ctx.arc(center.x, center.y, ringRadius, 0, Math.PI * 2)
    ctx.strokeStyle = `rgba(255, 145, 80, ${0.8 - ringProgress * 0.6})`
    ctx.lineWidth = 3
    ctx.stroke()
  }
  ctx.restore()
}

function drawArrowTrail(from: Hex, to: Hex, progress: number): void {
  const start = projectHex(from)
  const end = projectHex(to)
  const t = easeInOutCubic(progress)
  const current = {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  }

  const dx = end.x - start.x
  const dy = (end.y - start.y) / BOARD_TILT
  const len = Math.hypot(dx, dy) || 1
  const nx = dx / len
  const ny = dy / len
  const perpX = -ny
  const perpY = nx
  const headLength = layout.size * 0.22
  const baseWidth = layout.size * 0.08
  const tailLength = layout.size * 0.28

  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.strokeStyle = 'rgba(25, 20, 18, 0.8)'
  ctx.lineWidth = 2

  const tailX = current.x - nx * tailLength
  const tailY = current.y - ny * tailLength
  ctx.beginPath()
  ctx.moveTo(tailX, tailY)
  ctx.lineTo(current.x, current.y)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(current.x, current.y)
  ctx.lineTo(current.x - nx * headLength + perpX * baseWidth, current.y - ny * headLength + perpY * baseWidth)
  ctx.lineTo(current.x - nx * headLength - perpX * baseWidth, current.y - ny * headLength - perpY * baseWidth)
  ctx.closePath()
  ctx.fillStyle = 'rgba(25, 20, 18, 0.9)'
  ctx.fill()
  ctx.restore()
}

function getBoardViewportSize(): { width: number; height: number } {
  const panelRect = boardPanel.getBoundingClientRect()
  const hudRect = hudEl.getBoundingClientRect()
  const hudStyles = window.getComputedStyle(hudEl)
  const styles = window.getComputedStyle(boardPanel)
  const paddingX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight)
  const paddingY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom)
  const gap = parseFloat(styles.rowGap || styles.gap || '0')
  const width = Math.max(0, panelRect.width - paddingX)
  const hudHeight = hudStyles.position === 'absolute' ? 0 : hudRect.height + gap
  const height = Math.max(0, panelRect.height - paddingY - hudHeight)
  return { width, height }
}

function updateBoardScale(viewport?: { width: number; height: number }): { width: number; height: number } {
  const { width, height } = viewport ?? getBoardViewportSize()
  const fitWidth = width > 0 ? width / layout.width : 1
  const fitHeight = height > 0 ? height / layout.height : 1
  const fit = Math.min(fitWidth, fitHeight)
  boardScale = clamp(fit * boardZoom, MIN_BOARD_ZOOM, MAX_BOARD_ZOOM)
  return { width, height }
}

function computeBoardOffset(viewport: { width: number; height: number }): { x: number; y: number } {
  const scaledWidth = layout.width * boardScale
  const scaledHeight = layout.height * boardScale
  return {
    x: (viewport.width - scaledWidth) / 2 + boardPan.x,
    y: (viewport.height - scaledHeight) / 2 + boardPan.y,
  }
}

function setBoardZoom(zoom: number): void {
  boardZoom = clamp(zoom, MIN_BOARD_ZOOM, MAX_BOARD_ZOOM)
  render()
}

(window as Window & { setBoardZoom?: (zoom: number) => void }).setBoardZoom = setBoardZoom

function computeLayout(): void {
  const centers = new Map<string, { x: number; y: number }>()
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (const tile of [...state.tiles].sort((a, b) => a.r - b.r || a.q - b.q)) {
    const base = hexToPixel({ q: tile.q, r: tile.r }, layout.size, { x: 0, y: 0 })
    const projected = { x: base.x, y: base.y * BOARD_TILT }
    centers.set(tile.id, projected)
    minX = Math.min(minX, projected.x)
    maxX = Math.max(maxX, projected.x)
    minY = Math.min(minY, projected.y)
    maxY = Math.max(maxY, projected.y)
  }

  const padding = layout.size * 2.6
  layout.width = maxX - minX + padding * 2
  layout.height = maxY - minY + padding * 2
  layout.origin = { x: padding - minX, y: padding - minY }
  layout.centers = centers
  const viewport = updateBoardScale()
  boardOffset = computeBoardOffset(viewport)
  canvas.width = Math.round(viewport.width * deviceScale)
  canvas.height = Math.round(viewport.height * deviceScale)
  canvas.style.width = `${viewport.width}px`
  canvas.style.height = `${viewport.height}px`
  ctx.setTransform(
    deviceScale * boardScale,
    0,
    0,
    deviceScale * boardScale,
    boardOffset.x * deviceScale,
    boardOffset.y * deviceScale
  )
}

function drawBoard(): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#1a0f0a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(
    deviceScale * boardScale,
    0,
    0,
    deviceScale * boardScale,
    boardOffset.x * deviceScale,
    boardOffset.y * deviceScale
  )

  const spawnTop = getSpawnTiles(state, 0)
  const spawnBottom = getSpawnTiles(state, 1)
  const spawnTopKeys = new Set(spawnTop.map((tile) => `${tile.q},${tile.r}`))
  const spawnBottomKeys = new Set(spawnBottom.map((tile) => `${tile.q},${tile.r}`))

  for (const tile of [...state.tiles].sort((a, b) => a.r - b.r || a.q - b.q)) {
    const center = projectHex({ q: tile.q, r: tile.r })
    const corners = polygonCornersProjected(center, layout.size - TILE_GAP)

    ctx.beginPath()
    corners.forEach((corner, index) => {
      if (index === 0) ctx.moveTo(corner.x, corner.y)
      else ctx.lineTo(corner.x, corner.y)
    })
    ctx.closePath()
    const tileAsset = tileImages[tile.kind] ?? tileImages.grass
    if (tileAsset?.loaded) {
      ctx.save()
      ctx.clip()
      drawAnchoredImage(tileAsset, center, TILE_IMAGE_SCALE, TILE_ANCHOR_Y)
      ctx.restore()
    } else {
      ctx.fillStyle = '#1f2442'
      ctx.fill()
    }
    ctx.strokeStyle = '#070405'
    ctx.lineWidth = 1.2
    ctx.stroke()
  }

  const structures: { pos: Hex; owner: PlayerId; kind: 'spawn' | 'stronghold' }[] = []
  for (const tile of state.tiles) {
    const key = tile.id
    if (key === `${state.units['stronghold-0']?.pos.q},${state.units['stronghold-0']?.pos.r}`) {
      structures.push({ pos: { q: tile.q, r: tile.r }, owner: 0, kind: 'stronghold' })
      continue
    }
    if (key === `${state.units['stronghold-1']?.pos.q},${state.units['stronghold-1']?.pos.r}`) {
      structures.push({ pos: { q: tile.q, r: tile.r }, owner: 1, kind: 'stronghold' })
      continue
    }
    if (spawnTopKeys.has(key) || spawnBottomKeys.has(key)) {
      structures.push({
        pos: { q: tile.q, r: tile.r },
        owner: spawnTopKeys.has(key) ? 0 : 1,
        kind: 'spawn',
      })
    }
  }

  drawStrongholdProjectedDestroyIndicators()

  structures
    .sort((a, b) => a.pos.r - b.pos.r || a.pos.q - b.pos.q)
    .forEach((item) => {
      const center = projectHex(item.pos)
      if (item.kind === 'stronghold') {
        drawStructureSprite(
          center,
          item.owner,
          strongholdBaseImage,
          strongholdTeamImage,
          strongholdTeamCache,
          STRONGHOLD_IMAGE_SCALE,
          BUILDING_ANCHOR_Y
        )
      } else {
        drawStructureSprite(
          center,
          item.owner,
          spawnBaseImage,
          spawnTeamImage,
          spawnTeamCache,
          SPAWN_IMAGE_SCALE,
          SPAWN_ANCHOR_Y
        )
      }
    })

  drawStrongholdPreviewOverlays()
  drawSelectableHighlights()

  if (previewState && state.phase === 'planning') {
    drawPlannedMoves(state)
  }

  for (const unit of Object.values(state.units)) {
    const alphaOverride = unitAlphaOverrides.get(unit.id) ?? 1
    if (alphaOverride <= 0) continue
    drawUnit(unit, getAnimatedCenter(unit), alphaOverride)
  }

  if (currentAnimation?.type === 'lightning') {
    drawLightningStrike(projectHex(currentAnimation.target), animationProgress)
  }

  if (currentAnimation?.type === 'meteor') {
    drawMeteorImpact(currentAnimation.target, animationProgress)
  }

  if (currentAnimation?.type === 'arrow') {
    drawArrowTrail(currentAnimation.from, currentAnimation.to, animationProgress)
  }

  if (currentAnimation?.type === 'death') {
    const fadeCenter = projectHex(currentAnimation.unit.pos)
    drawUnit(currentAnimation.unit, fadeCenter, getAnimationAlpha())
  }

  pendingDeathUnits.forEach((unit) => {
    if (currentAnimation?.type === 'death' && currentAnimation.unit.id === unit.id) return
    const alpha = deathAlphaOverrides.get(unit.id) ?? 1
    if (alpha <= 0) return
    drawUnit(unit, projectHex(unit.pos), alpha)
  })

  if (previewState && state.phase === 'planning') {
    drawGhostUnits(previewState)
  }
}

function drawDirectionSelectionArrow(
  from: { x: number; y: number },
  to: { x: number; y: number },
  stroke: string,
  lineWidth: number
): void {
  const dx = to.x - from.x
  const dy = (to.y - from.y) / BOARD_TILT
  const length = Math.hypot(dx, dy)
  if (length <= 0.001) return

  const nx = dx / length
  const ny = dy / length
  const perpX = -ny
  const perpY = nx

  const tailInset = layout.size * 0.22
  const tipInset = layout.size * 0.24
  const headLength = layout.size * 0.22
  const headWidth = lineWidth * 2.4

  const tipX = to.x - nx * tipInset
  const tipY = to.y - ny * tipInset
  const shaftStartX = from.x + nx * tailInset
  const shaftStartY = from.y + ny * tailInset
  const headBaseX = tipX - nx * headLength
  const headBaseY = tipY - ny * headLength

  ctx.save()
  ctx.strokeStyle = stroke
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(shaftStartX, shaftStartY)
  ctx.lineTo(headBaseX, headBaseY)
  ctx.stroke()

  ctx.fillStyle = stroke
  ctx.beginPath()
  ctx.moveTo(tipX, tipY)
  ctx.lineTo(headBaseX + perpX * headWidth, headBaseY + perpY * headWidth)
  ctx.lineTo(headBaseX - perpX * headWidth, headBaseY - perpY * headWidth)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function drawSelectableHighlights(): void {
  if (!pendingOrder || state.phase !== 'planning') return
  const defId = getCardDefId(pendingOrder.cardId)
  if (!defId) return
  const nextStep = getNextRequirement(defId, pendingOrder.params)
  if (!nextStep) return

  const selectionState = previewState ?? state
  const selectable = getSelectableHexes(selectionState, defId, pendingOrder.params, planningPlayer, nextStep)
  if (selectable.length === 0) return

  const isUnitStep = nextStep === 'unit'
  const isDirectionStep = nextStep === 'direction' || nextStep === 'moveDirection' || nextStep === 'faceDirection'
  const useDirectionArrows = isDirectionStep && !(defId === 'move_forward_face' && nextStep === 'moveDirection')
  const stroke = isUnitStep ? '#ffe66a' : '#7bd8ff'
  const lineWidth = 2.2

  if (useDirectionArrows) {
    const base = getDirectionBase(selectionState, defId, pendingOrder.params, planningPlayer, nextStep)
    if (!base) return
    const origin = projectHex(base)
    selectable.forEach((hex) => {
      drawDirectionSelectionArrow(origin, projectHex(hex), stroke, lineWidth)
    })
    return
  }

  selectable.forEach((hex) => {
    const center = projectHex(hex)
    const corners = polygonCornersProjected(center, layout.size - 4)
    ctx.beginPath()
    corners.forEach((corner, index) => {
      if (index === 0) ctx.moveTo(corner.x, corner.y)
      else ctx.lineTo(corner.x, corner.y)
    })
    ctx.closePath()
    ctx.strokeStyle = stroke
    ctx.lineWidth = lineWidth
    ctx.stroke()
  })
}

function getProjectedDestroyedStrongholds(): Unit[] {
  if (!previewState || state.phase !== 'planning') return []
  const currentPreview = previewState
  const strongholds: Unit[] = []
  ;([0, 1] as PlayerId[]).forEach((player) => {
    const strongholdId = `stronghold-${player}`
    const actual = state.units[strongholdId]
    if (!actual) return
    const preview = currentPreview.units[strongholdId]
    const previewStrength = preview?.strength ?? 0
    if (previewStrength > 0) return
    strongholds.push(actual)
  })
  return strongholds
}

function drawStrongholdProjectedDestroyIndicators(): void {
  const destroyedStrongholds = getProjectedDestroyedStrongholds()
  destroyedStrongholds.forEach((stronghold) => {
    const center = projectHex(stronghold.pos)
    ctx.save()
    ctx.globalAlpha = 0.92
    ctx.translate(center.x, center.y)
    ctx.scale(1, BOARD_TILT)
    ctx.beginPath()
    ctx.arc(0, 0, layout.size * 0.62, 0, Math.PI * 2)
    ctx.strokeStyle = '#ff2b2b'
    ctx.lineWidth = 4
    ctx.stroke()
    ctx.restore()
  })
}

function drawStrongholdPreviewOverlays(): void {
  const destroyedStrongholds = getProjectedDestroyedStrongholds()
  destroyedStrongholds.forEach((actual) => {
    const center = projectHex(actual.pos)

    ctx.save()
    ctx.globalAlpha = 0.6
    ctx.filter = 'grayscale(1) brightness(0.7)'
    drawStructureSprite(
      center,
      actual.owner,
      strongholdBaseImage,
      strongholdTeamImage,
      strongholdTeamCache,
      STRONGHOLD_IMAGE_SCALE,
      BUILDING_ANCHOR_Y
    )
    ctx.filter = 'none'
    ctx.restore()

    ctx.save()
    ctx.globalAlpha = 0.9
    drawStrengthDots(center, actual.strength, 0, '#ff2b2b')
    ctx.restore()
  })
}

function drawUnit(unit: Unit, centerOverride?: { x: number; y: number }, alphaOverride?: number): void {
  const center = centerOverride ?? projectHex(unit.pos)
  const radius = unit.kind === 'stronghold' ? 20 : 14
  const color = getRingTint(unit.owner)
  const border = unit.kind === 'stronghold' ? '#101425' : '#0b0f1b'
  const preview = previewState?.units[unit.id]
  const previewStrength =
    state.phase === 'planning' && preview && preview.strength !== unit.strength ? preview.strength : null

  ctx.save()
  const animationAlpha =
    currentAnimation &&
    'unitId' in currentAnimation &&
    currentAnimation.unitId === unit.id &&
    currentAnimation.type === 'spawn'
      ? easeInOutCubic(animationProgress)
      : 1
  const overrideAlpha = alphaOverride ?? 1
  ctx.globalAlpha = animationAlpha * overrideAlpha

  if (
    currentAnimation &&
    'unitId' in currentAnimation &&
    currentAnimation.unitId === unit.id &&
    currentAnimation.type === 'boost'
  ) {
    drawBoostGlow(center, animationProgress)
  }

  if (unit.kind === 'unit') {
    const next = neighbor(unit.pos, unit.facing)
    const target = projectHex(next)
    const dir = {
      x: target.x - center.x,
      y: (target.y - center.y) / BOARD_TILT,
    }
    const length = Math.hypot(dir.x, dir.y) || 1
    const nx = dir.x / length
    const ny = dir.y / length
    const tipDistance = layout.size * 0.66
    const tipX = nx * tipDistance
    const tipY = ny * tipDistance
    const baseDistance = layout.size * 0.388
    const baseHalfWidth = layout.size * 0.156
    const baseX = nx * baseDistance
    const baseY = ny * baseDistance
    const perpX = -ny
    const perpY = nx

    ctx.save()
    ctx.translate(center.x, center.y)
    ctx.scale(1, BOARD_TILT)

    const ringRadius = layout.size * 0.38
    const ringStroke = layout.size * 0.12
    const ringGradient = ctx.createRadialGradient(0, 0, ringRadius - ringStroke * 0.4, 0, 0, ringRadius)
    ringGradient.addColorStop(0, 'rgba(255, 255, 255, 0.85)')
    ringGradient.addColorStop(0.5, color)
    ringGradient.addColorStop(1, 'rgba(0, 0, 0, 0.25)')
    ctx.beginPath()
    ctx.arc(0, 0, ringRadius, 0, Math.PI * 2)
    ctx.strokeStyle = ringGradient
    ctx.lineWidth = ringStroke
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(0, 0, ringRadius, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
    ctx.lineWidth = 1.1
    ctx.stroke()

    ctx.beginPath()
    ctx.arc(0, 0, ringRadius, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)'
    ctx.lineWidth = 1.2
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(tipX, tipY)
    ctx.lineTo(baseX + perpX * baseHalfWidth, baseY + perpY * baseHalfWidth)
    ctx.lineTo(baseX - perpX * baseHalfWidth, baseY - perpY * baseHalfWidth)
    ctx.closePath()
    ctx.fillStyle = ringGradient
    ctx.fill()
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)'
    ctx.lineWidth = 1.1
    ctx.stroke()

    ctx.globalAlpha = 0.9
    ctx.beginPath()
    ctx.arc(0, 0, ringRadius, 0, Math.PI * 2)
    ctx.strokeStyle = color
    ctx.lineWidth = 1.4
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(tipX, tipY)
    ctx.lineTo(baseX + perpX * baseHalfWidth, baseY + perpY * baseHalfWidth)
    ctx.lineTo(baseX - perpX * baseHalfWidth, baseY - perpY * baseHalfWidth)
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = 1.2
    ctx.stroke()
    ctx.globalAlpha = 1

    ctx.restore()
  }

  if (unit.kind === 'unit' && unitBaseImage.loaded) {
    drawUnitSprite(center, unit.owner)
  } else if (unit.kind === 'stronghold' && strongholdBaseImage.loaded) {
    // Stronghold sprite already drawn as structure; skip circle.
  } else {
    ctx.beginPath()
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2)
    ctx.fillStyle = unit.kind === 'stronghold' ? '#0c0f1d' : color
    ctx.fill()
    ctx.lineWidth = unit.kind === 'stronghold' ? 3 : 2
    ctx.strokeStyle = border
    ctx.stroke()
  }

  drawStrengthDots(center, unit.strength, previewStrength, color)
  ctx.restore()
}

function drawPlannedMoves(snapshot: GameState): void {
  const segments = getPlannedMoveSegments(snapshot, planningPlayer)
  if (segments.length === 0) return

  ctx.save()
  ctx.setLineDash([6, 6])
  ctx.lineWidth = 2
  ctx.strokeStyle = '#ffe66a'

  segments.forEach((segment) => {
    const start = projectHex(segment.from)
    const end = projectHex(segment.to)
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
    ctx.stroke()

    const angle = Math.atan2(end.y - start.y, end.x - start.x)
    const headLength = 8
    ctx.beginPath()
    ctx.moveTo(end.x, end.y)
    ctx.lineTo(end.x - headLength * Math.cos(angle - Math.PI / 6), end.y - headLength * Math.sin(angle - Math.PI / 6))
    ctx.lineTo(end.x - headLength * Math.cos(angle + Math.PI / 6), end.y - headLength * Math.sin(angle + Math.PI / 6))
    ctx.closePath()
    ctx.fillStyle = '#ffe66a'
    ctx.fill()
  })

  ctx.restore()
}

function drawGhostComposite(center: { x: number; y: number }, unit: Unit, ringColor: string): void {
  if (!unitBaseImage.loaded) return
  const ghostSize = Math.ceil(layout.size * 4)
  if (ghostCanvas.width !== ghostSize) {
    ghostCanvas.width = ghostSize
    ghostCanvas.height = ghostSize
  }
  ghostCtx.setTransform(1, 0, 0, 1, 0, 0)
  ghostCtx.clearRect(0, 0, ghostCanvas.width, ghostCanvas.height)

  const localCenter = { x: ghostCanvas.width / 2, y: ghostCanvas.height / 2 }
  const next = neighbor(unit.pos, unit.facing)
  const target = projectHex(next)
  const base = projectHex(unit.pos)
  const dir = {
    x: target.x - base.x,
    y: (target.y - base.y) / BOARD_TILT,
  }
  const length = Math.hypot(dir.x, dir.y) || 1
  const nx = dir.x / length
  const ny = dir.y / length
  const tipDistance = layout.size * 0.66
  const baseDistance = layout.size * 0.38
  const baseHalfWidth = layout.size * 0.156
  const tipX = nx * tipDistance
  const tipY = ny * tipDistance
  const baseX = nx * baseDistance
  const baseY = ny * baseDistance
  const perpX = -ny
  const perpY = nx

  ghostCtx.save()
  ghostCtx.translate(localCenter.x, localCenter.y)
  ghostCtx.scale(1, BOARD_TILT)

  ghostCtx.beginPath()
  ghostCtx.arc(0, 0, layout.size * 0.38, 0, Math.PI * 2)
  ghostCtx.strokeStyle = ringColor
  ghostCtx.lineWidth = 2
  ghostCtx.stroke()

  ghostCtx.beginPath()
  ghostCtx.moveTo(tipX, tipY)
  ghostCtx.lineTo(baseX + perpX * baseHalfWidth, baseY + perpY * baseHalfWidth)
  ghostCtx.lineTo(baseX - perpX * baseHalfWidth, baseY - perpY * baseHalfWidth)
  ghostCtx.closePath()
  ghostCtx.fillStyle = ringColor
  ghostCtx.fill()

  ghostCtx.restore()

  ghostCtx.save()
  ghostCtx.filter = 'grayscale(1) brightness(1.8)'
  drawAnchoredImageTo(ghostCtx, unitBaseImage, localCenter, UNIT_IMAGE_SCALE, UNIT_ANCHOR_Y)
  ghostCtx.filter = 'none'
  ghostCtx.restore()

  ctx.save()
  ctx.globalAlpha = GHOST_ALPHA
  ctx.drawImage(ghostCanvas, center.x - localCenter.x, center.y - localCenter.y)
  ctx.restore()
}

function drawGhostUnits(snapshot: GameState): void {
  ctx.save()
  ctx.setLineDash([6, 4])

  const snapshotUnitIds = new Set(Object.keys(snapshot.units))

  for (const unit of Object.values(snapshot.units)) {
    if (unit.kind !== 'unit') continue
    const actual = state.units[unit.id]
    const moved =
      !actual ||
      actual.pos.q !== unit.pos.q ||
      actual.pos.r !== unit.pos.r ||
      actual.facing !== unit.facing ||
      actual.strength !== unit.strength
    if (!moved) continue

    const center = projectHex(unit.pos)
    const strengthDelta = actual ? unit.strength - actual.strength : unit.strength
    const showStrengthChange = !actual || strengthDelta !== 0

    const previewStrength = unit.strength
    let ringColor = getRingTint(unit.owner)
    if (previewStrength <= 0) {
      ringColor = '#ff2b2b'
    } else if (!actual && unit.strength > 0) {
      ringColor = '#7CFF8A'
    }

    drawGhostComposite(center, unit, ringColor)

    if (showStrengthChange) {
      const baseStrength = actual?.strength ?? 0
      ctx.save()
      ctx.globalAlpha = GHOST_ALPHA
      drawStrengthDots(center, baseStrength, unit.strength, ringColor)
      ctx.restore()
    }
  }

  for (const unit of Object.values(state.units)) {
    if (unit.kind !== 'unit') continue
    if (snapshotUnitIds.has(unit.id)) continue

    const center = projectHex(unit.pos)
    const ringColor = '#ff2b2b'
    drawGhostComposite(center, unit, ringColor)

    ctx.save()
    ctx.globalAlpha = GHOST_ALPHA
    drawStrengthDots(center, unit.strength, 0, ringColor)
    ctx.restore()
  }

  ctx.restore()
}

function renderHand(): void {
  const playerHand = state.players[planningPlayer].hand
  if (playerHand.length === 0) {
    handEl.innerHTML = '<div class="empty">No cards in hand.</div>'
    return
  }

  handEl.innerHTML = playerHand
    .map((card) => {
      const def = CARD_DEFS[card.defId]
      const isSelected = selectedCardId === card.id
      const isHidden = hiddenCardIds.has(card.id)
      const isPendingTransfer = pendingCardTransfer?.cardId === card.id && pendingCardTransfer?.target === 'hand'
      if (isPendingTransfer) {
        return `
          <button class="card type-${def.type} card-placeholder" data-card-id="${card.id}" data-card-layer="hand"></button>
        `
      }
      const apCost = def.actionCost ?? 1
      const hiddenStyle = isHidden ? 'style="visibility:hidden;opacity:0;"' : ''
      return `
        <button class="card type-${def.type} ${isSelected ? 'selected' : ''} ${isHidden ? 'hidden-card' : ''}" data-card-id="${card.id}" data-card-layer="hand" ${hiddenStyle}>
          ${renderApBadge(apCost)}
          <div class="card-title">${def.name}</div>
          <div class="card-desc">${def.description}</div>
        </button>
      `
    })
    .join('')

  const cardButtons = handEl.querySelectorAll<HTMLButtonElement>('.card')
  cardButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (state.phase !== 'planning') return
      if (state.ready[planningPlayer]) return
      const cardId = button.dataset.cardId ?? null
      if (!cardId) return
      if (overlayLocked && overlaySourceId !== cardId) {
        overlayLocked = false
        clearOverlayClone()
      }
      if (overlayClone && overlaySourceId === cardId && overlayClone.style.display !== 'none') {
        overlayLocked = true
        overlaySourceEl = button
        overlaySourceVisibility = button.style.opacity
        overlaySourceTransition = button.style.transition
      } else {
        showOverlayClone(button, true, true)
      }
      hoverCardId = cardId
      selectedCardId = cardId
      pendingOrder = selectedCardId ? { cardId: selectedCardId, params: {} } : null
      statusEl.textContent = selectedCardId ? 'Pick a unit/tile on the board.' : 'Select a card to start planning.'
      tryAutoAddOrder()
      render()
    })
  })
}

function renderOrders(): void {
  const inPlanning = state.phase === 'planning'
  const playerOrders = state.players[planningPlayer].orders
  const allOrders = state.actionQueue
  const ordersToShow = inPlanning ? playerOrders : allOrders
  const validity = inPlanning ? getPlannedOrderValidity(state, planningPlayer) : []
  if (ordersToShow.length === 0) {
    ordersEl.innerHTML = '<div class="empty">No orders queued.</div>'
    return
  }
  const playedIds = !inPlanning ? new Set(state.actionQueue.slice(0, state.actionIndex).map((order) => order.id)) : null
  ordersEl.innerHTML = ordersToShow
    .map((order, index) => {
      const def = CARD_DEFS[order.defId]
      const apCost = def.actionCost ?? 1
      const isValid = inPlanning ? validity[index] ?? true : true
      const teamClass = `order-team-${order.player}`
      const resolvedClass = playedIds?.has(order.id) ? 'order-resolved' : ''
      const isHidden = hiddenCardIds.has(order.cardId)
      const isPendingTransfer = pendingCardTransfer?.cardId === order.cardId && pendingCardTransfer?.target === 'orders'
      if (isPendingTransfer) {
        return `
          <div class="card order-card type-${def.type} ${teamClass} ${resolvedClass} ${isValid ? '' : 'invalid'} card-placeholder" data-order-id="${order.id}" data-card-id="${order.cardId}" data-card-layer="queue"></div>
        `
      }
      const hiddenStyle = isHidden ? 'style="visibility:hidden;opacity:0;"' : ''
      return `
        <div class="card order-card type-${def.type} ${teamClass} ${resolvedClass} ${isValid ? '' : 'invalid'} ${isHidden ? 'hidden-card' : ''}" data-order-id="${order.id}" data-card-id="${order.cardId}" data-card-layer="queue" draggable="${inPlanning && !state.ready[planningPlayer]}" ${hiddenStyle}>
          ${renderApBadge(apCost)}
          <div class="card-title">${def.name}</div>
          <div class="card-desc">${def.description}</div>
          <div class="order-index">#${index + 1}</div>
        </div>
      `
    })
    .join('')

  if (inPlanning) {
    const cards = Array.from(ordersEl.querySelectorAll<HTMLDivElement>('.order-card'))
    cards.forEach((card) => {
      card.addEventListener('dragstart', (event) => {
        if (state.ready[planningPlayer]) {
          event.preventDefault()
          return
        }
        const target = event.currentTarget as HTMLDivElement
        const orderId = target.dataset.orderId ?? ''
        event.dataTransfer?.setData('text/plain', orderId)
        event.dataTransfer?.setDragImage(target, 20, 20)
        target.classList.add('dragging')
        isDraggingOrder = true
      })

      card.addEventListener('dragend', (event) => {
        ;(event.currentTarget as HTMLDivElement).classList.remove('dragging')
        cards.forEach((item) => item.classList.remove('drag-over'))
        isDraggingOrder = false
      })

      card.addEventListener('dragover', (event) => {
        event.preventDefault()
        ;(event.currentTarget as HTMLDivElement).classList.add('drag-over')
      })

      card.addEventListener('dragleave', (event) => {
        ;(event.currentTarget as HTMLDivElement).classList.remove('drag-over')
      })

      card.addEventListener('drop', (event) => {
        event.preventDefault()
        if (state.ready[planningPlayer]) return
        const target = event.currentTarget as HTMLDivElement
        const fromId = event.dataTransfer?.getData('text/plain')
        const toId = target.dataset.orderId
        if (!fromId || !toId || fromId === toId) return
        if (mode === 'online') {
          sendOnlineCommand({
            type: 'reorder_order',
            fromOrderId: fromId,
            toOrderId: toId,
          })
          statusEl.textContent = 'Moving order...'
          return
        }
        const playerState = state.players[planningPlayer]
        const fromIndex = playerState.orders.findIndex((order) => order.id === fromId)
        const toIndex = playerState.orders.findIndex((order) => order.id === toId)
        if (fromIndex === -1 || toIndex === -1) return
        const [moved] = playerState.orders.splice(fromIndex, 1)
        playerState.orders.splice(toIndex, 0, moved)
        clearReady(planningPlayer)
        statusEl.textContent = 'Order moved.'
        render()
      })

      card.addEventListener('click', () => {
        if (isDraggingOrder || state.phase !== 'planning' || state.ready[planningPlayer]) return
        const orderId = card.dataset.orderId
        if (!orderId) return
        if (mode === 'online') {
          sendOnlineCommand({
            type: 'remove_order',
            orderId,
          })
          statusEl.textContent = 'Removing order...'
          return
        }
        const fromRect = card.getBoundingClientRect()
        const fromHandRects = captureCardRects(handEl)
        const fromOrderRects = captureCardRects(ordersEl)
        const playerState = state.players[planningPlayer]
        const orderIndex = playerState.orders.findIndex((order) => order.id === orderId)
        if (orderIndex === -1) return
        const [removed] = playerState.orders.splice(orderIndex, 1)
        playerState.hand.push({ id: removed.cardId, defId: removed.defId })
        clearReady(planningPlayer)
        statusEl.textContent = 'Order removed.'
        clearOverlayClone()
        suppressOverlayUntil = performance.now() + 200
        card.style.visibility = 'hidden'
        if (fromRect) {
          hiddenCardIds.add(removed.cardId)
          const pendingHandEl = handEl.querySelector<HTMLElement>(`[data-card-id="${removed.cardId}"]`)
          if (pendingHandEl) {
            pendingHandEl.classList.add('hidden-card')
            pendingHandEl.style.visibility = 'hidden'
            pendingHandEl.style.opacity = '0'
          }
          const pendingOrderEl = ordersEl.querySelector<HTMLElement>(`[data-card-id="${removed.cardId}"]`)
          if (pendingOrderEl) {
            pendingOrderEl.classList.add('hidden-card')
            pendingOrderEl.style.visibility = 'hidden'
            pendingOrderEl.style.opacity = '0'
          }
          pendingCardTransfer = {
            cardId: removed.cardId,
            fromRect,
            fromHandRects,
            fromOrderRects,
            sourceEl: card,
            target: 'hand',
            started: false,
          }
        }
        render()
      })
    })
  }
}

function renderOrderForm(): void {
  if (!pendingOrder) {
    orderFormEl.innerHTML = '<div class="empty">Select a card to configure an order.</div>'
    return
  }

  const activeOrder = pendingOrder
  const card = state.players[planningPlayer].hand.find((item) => item.id === activeOrder.cardId)
  if (!card) {
    orderFormEl.innerHTML = '<div class="empty">Card unavailable.</div>'
    return
  }

  const def = CARD_DEFS[card.defId]
  const apCost = def.actionCost ?? 1
  const nextStep = getNextRequirement(def.id, activeOrder.params)
  const summary = renderOrderSummary(activeOrder.params)

  orderFormEl.innerHTML = `
    <div class="order-summary">
      <div class="order-title">${def.name}</div>
      <div class="order-desc">${def.description}</div>
      <div class="order-cost">${renderApBadge(apCost)}</div>
      <div class="order-steps">${summary}</div>
      <div class="order-hint">${nextStep ? stepHint(nextStep) : 'Auto-adding this order.'}</div>
    </div>
  `
}

function renderOrderSummary(params: OrderParams): string {
  const parts: string[] = []
  if (params.unitId) {
    parts.push(`Unit: ${renderUnitLabel(params.unitId)}`)
  }
  if (params.unitId2) {
    parts.push(`Unit 2: ${renderUnitLabel(params.unitId2)}`)
  }
  if (params.tile) {
    parts.push(`Tile: ${params.tile.q},${params.tile.r}`)
  }
  if (params.direction !== undefined) {
    parts.push(`Direction: ${params.direction}`)
  }
  if (params.moveDirection !== undefined) {
    parts.push(`Move Dir: ${params.moveDirection}`)
  }
  if (params.faceDirection !== undefined) {
    parts.push(`Face Dir: ${params.faceDirection}`)
  }
  if (params.distance !== undefined) {
    parts.push(`Distance: ${params.distance}`)
  }
  if (parts.length === 0) {
    return 'Nothing selected yet.'
  }
  return parts.join(' | ')
}

function stepHint(step: SelectionStep): string {
  switch (step) {
    case 'unit':
      return 'Click a unit (or planned spawn) on the board.'
    case 'unit2':
      return 'Click a different unit (or planned spawn) for the second boost.'
    case 'tile':
      return 'Click a highlighted spawn tile.'
    case 'direction':
      return 'Click an adjacent tile (arrow shown) to set direction.'
    case 'moveDirection':
      return 'Click a highlighted adjacent tile to set move direction.'
    case 'faceDirection':
      return 'Click an adjacent tile (arrow shown) to set facing direction.'
    case 'distance':
      return 'Click a highlighted tile to set direction and distance.'
    default:
      return ''
  }
}

function renderUnitLabel(unitId: string): string {
  if (unitId.startsWith('planned:')) {
    return 'Planned spawn'
  }
  return unitId
}

function renderApBadge(cost: number): string {
  const count = Math.max(0, Math.min(6, cost))
  const orbs =
    count > 0
      ? Array.from({ length: count })
          .map(() => '<span class="ap-orb"></span>')
          .join('')
      : '<span class="ap-orb zero"></span>'
  const zeroMark = cost <= 0 ? '<span class="ap-zero">✕</span>' : ''
  return `<div class="card-ap">${orbs}${zeroMark}</div>`
}
function captureCardRects(container: HTMLElement): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>()
  container.querySelectorAll<HTMLElement>('[data-card-id]').forEach((el) => {
    const id = el.dataset.cardId
    if (!id) return
    rects.set(id, el.getBoundingClientRect())
  })
  return rects
}

function applyDelayedReflow(
  container: HTMLElement,
  beforeRects: Map<string, DOMRect>,
  delayMs: number,
  excludeCardId?: string
): void {
  const elements = Array.from(container.querySelectorAll<HTMLElement>('[data-card-id]'))
  const active: HTMLElement[] = []
  elements.forEach((el) => {
    const id = el.dataset.cardId
    if (!id || id === excludeCardId) return
    const before = beforeRects.get(id)
    if (!before) return
    const after = el.getBoundingClientRect()
    const dx = before.left - after.left
    const dy = before.top - after.top
    if (dx === 0 && dy === 0) return
    el.style.transition = 'none'
    el.style.transform = `translate(${dx}px, ${dy}px)`
    active.push(el)
  })

  if (active.length === 0) return
  requestAnimationFrame(() => {
    window.setTimeout(() => {
      active.forEach((el) => {
        el.style.transition = 'transform 280ms cubic-bezier(0.22, 0.61, 0.36, 1)'
        el.style.transform = ''
      })
    }, delayMs)
  })
}

function revealCardId(cardId: string): void {
  hiddenCardIds.delete(cardId)
  handEl.querySelectorAll<HTMLElement>(`[data-card-id="${cardId}"]`).forEach((el) => {
    el.classList.remove('hidden-card')
    el.style.visibility = ''
    el.style.opacity = ''
  })
  ordersEl.querySelectorAll<HTMLElement>(`[data-card-id="${cardId}"]`).forEach((el) => {
    el.classList.remove('hidden-card')
    el.style.visibility = ''
    el.style.opacity = ''
  })
}

function animateCardMove(
  cardId: string,
  fromRect: DOMRect,
  container: HTMLElement,
  durationMs: number,
  sourceEl?: HTMLElement,
  onDone?: () => void
): void {
  const selector = `[data-card-id="${cardId}"]`
  const target = container.querySelector<HTMLElement>(selector)
  if (!target) {
    revealCardId(cardId)
    if (sourceEl && sourceEl.isConnected) sourceEl.style.visibility = ''
    onDone?.()
    return
  }
  const toRect = target.getBoundingClientRect()
  const baseEl = sourceEl ?? target
  const clone = baseEl.cloneNode(true) as HTMLElement
  clone.className = target.className
  clone.classList.remove('card-placeholder')
  clone.classList.remove('hidden-card')
  clone.classList.remove('dragging')
  clone.classList.remove('drag-over')
  clone.classList.add('card-moving')
  if (sourceEl) {
    clone.innerHTML = sourceEl.innerHTML
  }
  clone.dataset.cardLayer = 'moving'
  clone.style.cssText = ''
  clone.style.position = 'fixed'
  clone.style.left = `${fromRect.left}px`
  clone.style.top = `${fromRect.top}px`
  clone.style.width = `${fromRect.width}px`
  clone.style.height = `${fromRect.height}px`
  clone.style.margin = '0'
  clone.style.pointerEvents = 'none'
  clone.style.zIndex = '9999'
  clone.style.transform = 'translate(0, 0) scale(1)'
  clone.style.opacity = '0'
  clone.style.visibility = 'hidden'
  document.body.appendChild(clone)

  const dx = toRect.left - fromRect.left
  const dy = toRect.top - fromRect.top
  target.style.visibility = 'hidden'
  target.style.opacity = '0'
  requestAnimationFrame(() => {
    clone.style.visibility = 'visible'
    clone.style.opacity = '1'
    const animation = clone.animate(
      [
        { transform: 'translate(0, 0) scale(1)' },
        { transform: `translate(${dx}px, ${dy}px) scale(1)` },
      ],
      { duration: durationMs, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' }
    )
    animation.onfinish = () => {
      clone.remove()
      target.style.visibility = ''
      target.style.opacity = ''
      revealCardId(cardId)
      if (sourceEl && sourceEl.isConnected) sourceEl.style.visibility = ''
      onDone?.()
    }
  })
}

function runPendingCardTransfer(): void {
  if (!pendingCardTransfer || pendingCardTransfer.started) return
  pendingCardTransfer.started = true
  const { cardId, fromRect, fromHandRects, fromOrderRects, sourceEl, target } = pendingCardTransfer

  const targetContainer = target === 'orders' ? ordersEl : handEl
  handEl.querySelectorAll<HTMLElement>(`[data-card-id="${cardId}"]`).forEach((el) => {
    el.style.visibility = 'hidden'
    el.style.opacity = '0'
  })
  ordersEl.querySelectorAll<HTMLElement>(`[data-card-id="${cardId}"]`).forEach((el) => {
    el.style.visibility = 'hidden'
    el.style.opacity = '0'
  })
  const exclude = cardId
  applyDelayedReflow(handEl, fromHandRects, CARD_TRANSFER_DURATION_MS, exclude)
  applyDelayedReflow(ordersEl, fromOrderRects, CARD_TRANSFER_DURATION_MS, exclude)
  animateCardMove(cardId, fromRect, targetContainer, CARD_TRANSFER_DURATION_MS, sourceEl, () => {
    pendingCardTransfer = null
    render()
  })
}

function renderLog(): void {
  const recent = state.log.slice(-8).reverse()
  logEl.innerHTML = recent.map((entry) => `<div class="log-item">${entry}</div>`).join('')
}

function renderLoadout(): void {
  applyCardAssetCssVars()
  if (mode === 'online') {
    loadoutPlayer = 0
  }
  const deck = loadoutPlayer === 0 ? loadouts.p1 : loadouts.p2
  loadoutToggleButton.textContent = mode === 'online' ? 'Your Deck' : `Player ${loadoutPlayer + 1}`
  loadoutToggleButton.classList.toggle('hidden', mode === 'online')
  loadoutContinueButton.classList.toggle('hidden', !(mode === 'online' && onlineSession))
  loadoutContinueButton.disabled = !(mode === 'online' && onlineSession)
  loadoutContinueButton.textContent =
    mode === 'online' && state.winner !== null ? 'Save Deck + Back to Match' : 'Continue to Match'
  loadoutCountLabel.textContent = `${deck.length}/${gameSettings.deckSize} cards`
  loadoutControls.classList.toggle('hidden', !loadoutFiltersExpanded)
  loadoutFilterToggleButton.classList.toggle('active', loadoutFiltersExpanded)
  loadoutFilterToggleButton.textContent = loadoutFiltersExpanded ? 'Filter ▲' : 'Filter ▼'

  loadoutFilterButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.filter === loadoutFilter)
  })

  const counts = deck.reduce((acc, id) => {
    acc[id] = (acc[id] ?? 0) + 1
    return acc
  }, {} as Record<CardDefId, number>)

  loadoutSelected.innerHTML = Object.entries(counts)
    .map(([defId, count]) => {
      const def = CARD_DEFS[defId as CardDefId]
      return `
        <button class="loadout-row" data-remove-id="${defId}" type="button" title="Remove one">
          <span class="order-name">${def.name}</span>
          <span class="count-pill">x${count}</span>
        </button>
      `
    })
    .join('')

  const removeButtons = loadoutSelected.querySelectorAll<HTMLButtonElement>('[data-remove-id]')
  removeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const defId = button.dataset.removeId as CardDefId
      const index = deck.findIndex((id) => id === defId)
      if (index === -1) return
      deck.splice(index, 1)
      renderLoadout()
    })
  })

  const allCards = Object.values(CARD_DEFS)
    .filter((def) => loadoutFilter === 'all' || def.type === loadoutFilter)
    .sort((a, b) => {
      if (loadoutSortMode === 'name') return a.name.localeCompare(b.name)
      const order: CardType[] = ['reinforcement', 'movement', 'attack', 'spell']
      const typeDiff = order.indexOf(a.type) - order.indexOf(b.type)
      return typeDiff !== 0 ? typeDiff : a.name.localeCompare(b.name)
    })

  loadoutAll.innerHTML = allCards
    .map((def) => {
      const count = counts[def.id] ?? 0
      const disabled = deck.length >= gameSettings.deckSize || count >= gameSettings.maxCopies
      const apCost = def.actionCost ?? 1
      return `
        <button class="card loadout-card type-${def.type} ${disabled ? 'disabled' : ''}" data-add-id="${def.id}" ${
          disabled ? 'disabled' : ''
        }>
          ${renderApBadge(apCost)}
          <div class="card-title">${def.name}</div>
          <div class="card-desc">${def.description}</div>
          <div class="card-meta">${def.type} | ${count}/${gameSettings.maxCopies}</div>
        </button>
      `
    })
    .join('')

  const addButtons = loadoutAll.querySelectorAll<HTMLButtonElement>('[data-add-id]')
  addButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (deck.length >= gameSettings.deckSize) return
      const defId = button.dataset.addId as CardDefId
      const count = counts[defId] ?? 0
      if (count >= gameSettings.maxCopies) return
      deck.push(defId)
      renderLoadout()
    })
  })

  updateSeedDisplay()
}
function renderSettings(): void {
  settingRows.value = String(gameSettings.boardRows)
  settingCols.value = String(gameSettings.boardCols)
  settingStronghold.value = String(gameSettings.strongholdStrength)
  settingDeck.value = String(gameSettings.deckSize)
  settingDraw.value = String(gameSettings.drawPerTurn)
  settingMaxCopies.value = String(gameSettings.maxCopies)
  settingActionBudgetP1.value = String(gameSettings.actionBudgetP1)
  settingActionBudgetP2.value = String(gameSettings.actionBudgetP2)
  updateSeedDisplay()
}

function renderApDots(used: number, total: number): string {
  const dots: string[] = []
  for (let i = 0; i < total; i += 1) {
    const spent = i < used
    dots.push(`<span class="ap-dot ${spent ? 'spent' : ''}"></span>`)
  }
  return `<div class="ap-dots">${dots.join('')}</div>`
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function resizeDecks(newSize: number): void {
  if (loadouts.p1.length > newSize) loadouts.p1 = loadouts.p1.slice(0, newSize)
  if (loadouts.p2.length > newSize) loadouts.p2 = loadouts.p2.slice(0, newSize)
}

function enforceMaxCopies(): void {
  const trimDeck = (deck: CardDefId[]): CardDefId[] => {
    const counts: Record<CardDefId, number> = {} as Record<CardDefId, number>
    const next: CardDefId[] = []
    deck.forEach((id) => {
      counts[id] = (counts[id] ?? 0) + 1
      if (counts[id] <= gameSettings.maxCopies) {
        next.push(id)
      }
    })
    return next
  }
  loadouts.p1 = trimDeck(loadouts.p1)
  loadouts.p2 = trimDeck(loadouts.p2)
  updateSeedDisplay()
}

function encodeSeed(payload: SeedPayload): string {
  const json = JSON.stringify(payload)
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

function decodeSeed(seed: string): SeedPayload {
  const binary = atob(seed.trim())
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  const json = new TextDecoder().decode(bytes)
  return JSON.parse(json) as SeedPayload
}

function getSeedPayload(): SeedPayload {
  return {
    settings: { ...gameSettings },
    loadouts: { p1: [...loadouts.p1], p2: [...loadouts.p2] },
  }
}

function updateSeedDisplay(): void {
  if (!seedInput) return
  seedInput.value = encodeSeed(getSeedPayload())
  seedStatus.textContent = ''
}

function applySeed(seed: string): void {
  const payload = decodeSeed(seed)
  gameSettings = { ...DEFAULT_SETTINGS, ...payload.settings }
  loadouts = {
    p1: [...(payload.loadouts?.p1 ?? [])],
    p2: [...(payload.loadouts?.p2 ?? [])],
  }
  resizeDecks(gameSettings.deckSize)
  enforceMaxCopies()
  state = createGameState(gameSettings, loadouts)
  if (screen === 'settings') renderSettings()
  if (screen === 'loadout') renderLoadout()
  updateSeedDisplay()
}

function renderMeta(): void {
  turnEl.textContent = `Turn ${state.turn}`
  activeEl.textContent = `Active Player: ${state.activePlayer + 1}`
  const compactLabels = window.matchMedia('(max-width: 720px)').matches
  plannerNameEl.textContent =
    mode === 'online'
      ? compactLabels
        ? `P${planningPlayer + 1} Online`
        : `Player ${planningPlayer + 1} Online`
      : compactLabels
        ? `P${planningPlayer + 1}`
        : `Player ${planningPlayer + 1}`
  plannerNameEl.classList.toggle('team-0', planningPlayer === 0)
  plannerNameEl.classList.toggle('team-1', planningPlayer === 1)
  const usedAP = state.players[planningPlayer].orders.reduce((sum, order) => {
    return sum + (CARD_DEFS[order.defId].actionCost ?? 1)
  }, 0)
  const totalAP =
    state.actionBudgets?.[planningPlayer] ??
    (planningPlayer === 0 ? state.settings.actionBudgetP1 : state.settings.actionBudgetP2) ??
    (planningPlayer === 0 ? gameSettings.actionBudgetP1 : gameSettings.actionBudgetP2) ??
    3
  const counts = onlineSession?.viewMeta?.counts
  if (mode === 'online' && counts) {
    countsEl.textContent = `Deck P1: ${counts[0].deck} | Discard P1: ${counts[0].discard} | Deck P2: ${counts[1].deck} | Discard P2: ${counts[1].discard}`
  } else {
    countsEl.textContent = `Deck P1: ${state.players[0].deck.length} | Discard P1: ${state.players[0].discard.length} | Deck P2: ${state.players[1].deck.length} | Discard P2: ${state.players[1].discard.length}`
  }

  if (mode === 'online' && onlineSession) {
    const deadline = onlineSession.presence.deadlineAt
    if (onlineSession.presence.paused && deadline) {
      const remainingMs = Math.max(0, deadline - Date.now())
      const seconds = Math.ceil(remainingMs / 1000)
      networkStateEl.textContent = `Room ${onlineSession.roomCode} | Paused (${seconds}s)`
    } else if (!onlineSession.connected) {
      networkStateEl.textContent = `Room ${onlineSession.roomCode} | Reconnecting...`
    } else {
      networkStateEl.textContent = `Room ${onlineSession.roomCode} | Connected`
    }
  } else {
    networkStateEl.textContent = ''
  }

  plannerApEl.innerHTML = renderApDots(usedAP, totalAP)
  updateReadyButtons()
  switchPlannerButton.textContent = compactLabels ? 'Switch' : 'Switch Player'
  resolveNextButton.textContent = compactLabels ? 'Next' : 'Resolve Next'
  resolveAllButton.textContent = compactLabels ? 'Resolve' : 'Resolve Turn'
  gameMenuButton.textContent =
    mode === 'online' ? (compactLabels ? 'Leave' : 'Leave Match') : compactLabels ? 'Menu' : 'Main Menu'
  resetGameButton.textContent =
    mode === 'online' ? (compactLabels ? 'Reset Off' : 'Reset (Local Only)') : compactLabels ? 'Reset' : 'Reset Game'
  winnerMenuButton.textContent = mode === 'online' ? 'Leave Match' : 'Main Menu'
  winnerResetButton.textContent = mode === 'online' ? 'Edit Deck' : 'Reset Game'
  winnerRematchButton.classList.toggle('hidden', mode !== 'online')
  winnerRematchButton.textContent = onlineRematchRequested ? 'Rematch Pending' : 'Rematch'
  winnerRematchButton.disabled = mode !== 'online' || onlineRematchRequested || !(onlineSession?.connected ?? false)
}

function render(): void {
  previewState = state.phase === 'planning' ? simulatePlannedState(state, planningPlayer) : null
  const handScroll = handEl.scrollLeft
  const ordersScroll = ordersEl.scrollLeft
  computeLayout()
  drawBoard()
  renderMeta()
  renderHand()
  renderOrderForm()
  renderOrders()
  renderLog()
  handEl.scrollLeft = handScroll
  ordersEl.scrollLeft = ordersScroll
  runPendingCardTransfer()
  scheduleOverlayPrewarm()
  syncOverlayFromSelection()
  updateHoverFromPointer()

  if (state.winner !== null) {
    statusEl.textContent = `Player ${state.winner + 1} wins!`
    winnerTextEl.textContent = `Player ${state.winner + 1} wins the game.`
    winnerNoteEl.textContent =
      mode === 'online' && onlineRematchRequested ? 'Rematch requested, waiting for opponent.' : ''
    winnerModal.classList.remove('hidden')
  } else {
    winnerNoteEl.textContent = ''
    winnerModal.classList.add('hidden')
  }

  const inPlanning = state.phase === 'planning'
  const inOnlineMode = mode === 'online'
  const inOnlineReplayAction = inOnlineMode && isOnlineResolutionReplayActive()
  const roomPaused = inOnlineMode ? onlineSession?.presence.paused ?? false : false
  const disconnected = inOnlineMode ? !(onlineSession?.connected ?? false) : false
  readyButton.classList.toggle('hidden', !inPlanning)
  resolveNextButton.classList.toggle('hidden', inPlanning || (inOnlineMode && !inOnlineReplayAction))
  resolveAllButton.classList.toggle('hidden', inPlanning || (inOnlineMode && !inOnlineReplayAction))
  switchPlannerButton.classList.toggle('hidden', inOnlineMode)
  readyButton.disabled = !inPlanning || state.ready[planningPlayer] || roomPaused || disconnected
  resolveNextButton.disabled = state.phase !== 'action' || isAnimating
  resolveAllButton.disabled = state.phase !== 'action' || isAnimating
  resetGameButton.disabled = inOnlineMode
  scheduleProgressSave()
}

function renderBoardOnly(): void {
  previewState = state.phase === 'planning' ? simulatePlannedState(state, planningPlayer) : null
  computeLayout()
  drawBoard()
}

function snapshotUnits(source: GameState): Record<string, UnitSnapshot> {
  const snap: Record<string, UnitSnapshot> = {}
  Object.values(source.units).forEach((unit) => {
    snap[unit.id] = {
      pos: { ...unit.pos },
      facing: unit.facing,
      strength: unit.strength,
      owner: unit.owner,
      kind: unit.kind,
    }
  })
  return snap
}

function resolveUnitIdFromParams(
  params: OrderParams,
  spawnedByOrder: Record<string, string>,
  unitParam: 'unitId' | 'unitId2' = 'unitId'
): string | null {
  const unitId = unitParam === 'unitId2' ? params.unitId2 : params.unitId
  if (!unitId) return null
  if (!unitId.startsWith('planned:')) return unitId
  const plannedId = unitId.replace('planned:', '')
  return spawnedByOrder[plannedId] ?? null
}

function findSnapshotUnitAt(before: Record<string, UnitSnapshot>, hex: Hex): UnitSnapshot | null {
  const entry = Object.values(before).find((unit) => unit.pos.q === hex.q && unit.pos.r === hex.r)
  return entry ?? null
}

function findFirstUnitInLine(before: Record<string, UnitSnapshot>, origin: Hex, dir: Direction): UnitSnapshot | null {
  let cursor = { ...origin }
  for (;;) {
    cursor = neighbor(cursor, dir)
    if (!isTile(cursor)) break
    const target = findSnapshotUnitAt(before, cursor)
    if (target) return target
  }
  return null
}

function buildAnimations(order: GameState['actionQueue'][number], before: Record<string, UnitSnapshot>): BoardAnimation[] {
  const def = CARD_DEFS[order.defId]
  const animations: BoardAnimation[] = []

  for (const effect of def.effects) {
    if (effect.type === 'spawn') {
      const tile = order.params.tile
      if (!tile) continue
      let spawnedId: string | undefined = state.spawnedByOrder[order.id]
      if (!spawnedId) {
        spawnedId = Object.values(state.units).find(
          (unit) =>
            !before[unit.id] && unit.pos.q === tile.q && unit.pos.r === tile.r
        )?.id
      }
      if (typeof spawnedId === 'string') {
        unitAlphaOverrides.set(spawnedId, 0)
        animations.push({
          type: 'spawn',
          unitId: spawnedId,
          duration: SPAWN_DURATION_MS,
        })
      }
    }

    if (effect.type === 'move') {
      const resolvedId = resolveUnitIdFromParams(order.params, state.spawnedByOrder)
      if (!resolvedId) continue
      const beforeUnit = before[resolvedId]
      const afterUnit = state.units[resolvedId]
      if (!beforeUnit || !afterUnit) continue
      if (beforeUnit.pos.q !== afterUnit.pos.q || beforeUnit.pos.r !== afterUnit.pos.r) {
        animations.push({
          type: 'move',
          unitId: resolvedId,
          from: beforeUnit.pos,
          to: afterUnit.pos,
          duration: MOVE_DURATION_MS,
        })
      }
    }

    if (effect.type === 'attack') {
      const resolvedId = resolveUnitIdFromParams(order.params, state.spawnedByOrder)
      if (!resolvedId) continue
      const beforeUnit = before[resolvedId]
      const afterUnit = state.units[resolvedId]
      if (!beforeUnit || !afterUnit) continue
      const facing = afterUnit.facing
      let dirs: Direction[] = []
      if (effect.directions === 'facing') {
        dirs = [facing]
      } else if (effect.directions.type === 'param') {
        const paramValue = effect.directions.key === 'moveDirection' ? order.params.moveDirection : order.params.direction
        if (paramValue !== undefined) dirs = [paramValue]
      } else {
        dirs = effect.directions.offsets.map((offset) => rotateDirection(facing, offset))
      }
      dirs.forEach((dir) => {
        animations.push({
          type: 'lunge',
          unitId: resolvedId,
          from: afterUnit.pos,
          dir,
          duration: LUNGE_DURATION_MS,
        })
        if (order.defId === 'attack_arrow') {
          const target = findFirstUnitInLine(before, beforeUnit.pos, dir)
          if (target) {
            animations.push({
              type: 'arrow',
              from: beforeUnit.pos,
              to: target.pos,
              duration: ARROW_DURATION_MS,
            })
          }
        }
      })
    }

    if (effect.type === 'boost') {
      const resolvedId = resolveUnitIdFromParams(order.params, state.spawnedByOrder, effect.unitParam)
      if (!resolvedId) continue
      const beforeUnit = before[resolvedId]
      const afterUnit = state.units[resolvedId]
      if (!beforeUnit || !afterUnit) continue
      if (afterUnit.strength > beforeUnit.strength) {
        animations.push({
          type: 'boost',
          unitId: resolvedId,
          duration: BOOST_DURATION_MS,
        })
      }
    }

    if (effect.type === 'damage' && order.defId === 'spell_lightning') {
      const resolvedId = resolveUnitIdFromParams(order.params, state.spawnedByOrder)
      if (!resolvedId) continue
      const target = before[resolvedId] ?? state.units[resolvedId]
      if (!target) continue
      animations.push({
        type: 'lightning',
        target: { ...target.pos },
        duration: LIGHTNING_DURATION_MS,
      })
    }

    if (effect.type === 'damageTileArea' && order.defId === 'spell_meteor' && order.params.tile) {
      animations.push({
        type: 'meteor',
        target: { ...order.params.tile },
        duration: METEOR_DURATION_MS,
      })
    }
  }

  Object.entries(before).forEach(([unitId, unit]) => {
    if (state.units[unitId]) return
    pendingDeathUnits.set(unitId, {
      id: unitId,
      owner: unit.owner,
      kind: unit.kind,
      strength: unit.strength,
      pos: unit.pos,
      facing: unit.facing,
    })
    deathAlphaOverrides.set(unitId, 1)
    animations.push({
      type: 'death',
      unit: pendingDeathUnits.get(unitId)!,
      duration: DEATH_DURATION_MS,
    })
  })

  return animations
}

function tickAnimation(time: number): void {
  if (!currentAnimation) return
  const elapsed = time - animationStart
  animationProgress = Math.min(1, elapsed / currentAnimation.duration)
  if (currentAnimation.type === 'spawn') {
    unitAlphaOverrides.set(currentAnimation.unitId, easeInOutCubic(animationProgress))
  } else if (currentAnimation.type === 'death') {
    deathAlphaOverrides.set(currentAnimation.unit.id, 1 - easeInOutCubic(animationProgress))
  }
  renderBoardOnly()
  if (animationProgress >= 1) {
    if (currentAnimation.type === 'spawn') {
      unitAlphaOverrides.delete(currentAnimation.unitId)
    } else if (currentAnimation.type === 'death') {
      pendingDeathUnits.delete(currentAnimation.unit.id)
      deathAlphaOverrides.delete(currentAnimation.unit.id)
    }
    currentAnimation = null
    animationProgress = 0
    runNextAnimation()
    return
  }
  requestAnimationFrame(tickAnimation)
}

function runNextAnimation(): void {
  currentAnimation = animationQueue.shift() ?? null
  if (!currentAnimation) {
    isAnimating = false
    if (autoResolve && state.phase === 'action') {
      requestAnimationFrame(() => resolveNextActionAnimated())
      return
    }
    finalizeOnlineResolutionReplay()
    render()
    return
  }
  isAnimating = true
  animationProgress = 0
  animationStart = performance.now()
  renderBoardOnly()
  requestAnimationFrame(tickAnimation)
}

function resolveNextActionAnimated(): void {
  if (state.phase !== 'action') return
  const before = snapshotUnits(state)
  const currentOrder = state.actionQueue[state.actionIndex]
  resolveNextAction(state)
  if (!currentOrder) {
    finalizeOnlineResolutionReplay()
    render()
    return
  }
  const animations = buildAnimations(currentOrder, before)
  if (animations.length === 0) {
    finalizeOnlineResolutionReplay()
    render()
    if (autoResolve && state.phase === 'action') {
      requestAnimationFrame(() => resolveNextActionAnimated())
    }
    return
  }
  animationQueue.push(...animations)
  if (!currentAnimation) {
    runNextAnimation()
  }
}

function tryAutoAddOrder(): void {
  if (!pendingOrder || state.phase !== 'planning') return
  const defId = getCardDefId(pendingOrder.cardId)
  if (!defId) return
  if (getNextRequirement(defId, pendingOrder.params) !== null) return
  if (mode === 'online') {
    sendOnlineCommand({
      type: 'queue_order',
      cardId: pendingOrder.cardId,
      params: pendingOrder.params,
    })
    selectedCardId = null
    pendingOrder = null
    statusEl.textContent = 'Queueing order...'
    render()
    return
  }
  const fromEl = handEl.querySelector<HTMLElement>(`[data-card-id="${pendingOrder.cardId}"]`)
  const fromRect = fromEl?.getBoundingClientRect()
  const fromHandRects = captureCardRects(handEl)
  const fromOrderRects = captureCardRects(ordersEl)
  const order = planOrder(state, planningPlayer, pendingOrder.cardId, pendingOrder.params)
  if (!order) {
    statusEl.textContent = 'Unable to add this order (check AP or targets).'
    return
  }
  clearOverlayClone()
  suppressOverlayUntil = performance.now() + 200
  if (fromEl) fromEl.style.visibility = 'hidden'
  selectedCardId = null
  pendingOrder = null
  clearReady(planningPlayer)
  statusEl.textContent = 'Order queued.'
  if (fromRect) {
    hiddenCardIds.add(order.cardId)
    const pendingHandEl = handEl.querySelector<HTMLElement>(`[data-card-id="${order.cardId}"]`)
    if (pendingHandEl) {
      pendingHandEl.classList.add('hidden-card')
      pendingHandEl.style.visibility = 'hidden'
      pendingHandEl.style.opacity = '0'
    }
    const pendingOrderEl = ordersEl.querySelector<HTMLElement>(`[data-card-id="${order.cardId}"]`)
    if (pendingOrderEl) {
      pendingOrderEl.classList.add('hidden-card')
      pendingOrderEl.style.visibility = 'hidden'
      pendingOrderEl.style.opacity = '0'
    }
    pendingCardTransfer = {
      cardId: order.cardId,
      fromRect,
      fromHandRects,
      fromOrderRects,
      sourceEl: fromEl ?? undefined,
      target: 'orders',
      started: false,
    }
  }
}

function getCardDefId(cardId: string): CardDefId | null {
  const card = state.players[planningPlayer].hand.find((item) => item.id === cardId)
  return card?.defId ?? null
}

type SelectionStep = 'unit' | 'unit2' | 'tile' | 'direction' | 'moveDirection' | 'faceDirection' | 'distance'

function getNextRequirement(defId: CardDefId, params: OrderParams): SelectionStep | null {
  const def = CARD_DEFS[defId]
  if (def.requires.unit && !params.unitId) return 'unit'
  if (defId === 'reinforce_boost' && params.unitId && !params.unitId2) {
    const selectionState = simulatePlannedState(state, planningPlayer)
    if (hasSecondaryBoostTarget(selectionState, planningPlayer, params.unitId)) return 'unit2'
  }
  if (def.requires.tile && !params.tile) return 'tile'
  if (defId === 'reinforce_spawn' && params.tile && params.direction === undefined) return 'direction'
  if (defId === 'move_forward_face') {
    if (params.moveDirection === undefined) return 'moveDirection'
    if (params.faceDirection === undefined) return 'faceDirection'
  }
  if (defId === 'attack_fwd' && params.direction === undefined) return 'direction'
  if (defId === 'move_any' || defId === 'move_forward') {
    if (params.distance === undefined || params.direction === undefined) return 'distance'
  }
  if (def.requires.moveDirection && params.moveDirection === undefined) return 'moveDirection'
  if (def.requires.faceDirection && params.faceDirection === undefined) return 'faceDirection'
  if (def.requires.direction && params.direction === undefined) return 'direction'
  if (def.requires.distanceOptions && params.distance === undefined) return 'distance'
  return null
}

function hasSecondaryBoostTarget(snapshot: GameState, player: PlayerId, selectedUnitId: string): boolean {
  const selected = getUnitSnapshot(snapshot, selectedUnitId, player)
  if (!selected) return false
  const units = Object.values(snapshot.units).filter((unit) => unit.owner === player && unit.kind === 'unit')
  const unitHexes = units.map((unit) => ({ ...unit.pos }))
  const planned = getPlannedSpawnTiles(player)
  return [...unitHexes, ...planned].some((hex) => hex.q !== selected.pos.q || hex.r !== selected.pos.r)
}

function dedupeHexes(hexes: Hex[]): Hex[] {
  const seen = new Set<string>()
  const unique: Hex[] = []
  hexes.forEach((hex) => {
    const key = `${hex.q},${hex.r}`
    if (seen.has(key)) return
    seen.add(key)
    unique.push(hex)
  })
  return unique
}

function getSelectableHexes(
  snapshot: GameState,
  defId: CardDefId,
  params: OrderParams,
  player: PlayerId,
  step: SelectionStep
): Hex[] {
  if (step === 'unit') {
    const requirement = CARD_DEFS[defId].requires.unit
    const units = Object.values(snapshot.units).filter((unit) => unit.kind === 'unit')
    if (requirement === 'any') {
      const currentUnits = Object.values(state.units).filter((unit) => unit.kind === 'unit')
      return dedupeHexes([
        ...units.map((unit) => ({ ...unit.pos })),
        ...currentUnits.map((unit) => ({ ...unit.pos })),
      ])
    }
    const friendlyUnits = units.filter((unit) => unit.owner === player)
    const unitHexes = friendlyUnits.map((unit) => ({ ...unit.pos }))
    const planned = getPlannedSpawnTiles(player)
    return [...unitHexes, ...planned]
  }

  if (step === 'unit2') {
    const units = Object.values(snapshot.units).filter((unit) => unit.owner === player && unit.kind === 'unit')
    const unitHexes = units.map((unit) => ({ ...unit.pos }))
    const planned = getPlannedSpawnTiles(player)
    const selected = params.unitId ? getUnitSnapshot(snapshot, params.unitId, player) : null
    if (!selected) return [...unitHexes, ...planned]
    return [...unitHexes, ...planned].filter((hex) => hex.q !== selected.pos.q || hex.r !== selected.pos.r)
  }

  if (step === 'tile') {
    if (CARD_DEFS[defId].requires.tile === 'any') {
      return snapshot.tiles.map((tile) => ({ q: tile.q, r: tile.r }))
    }
    return getSpawnTiles(snapshot, player)
  }

  if (step === 'direction' || step === 'moveDirection' || step === 'faceDirection') {
    const base = getDirectionBase(snapshot, defId, params, player, step)
    if (!base) return []
    return DIRECTIONS.map((_, index) => neighbor(base, index as Direction)).filter((hex) => isTile(hex))
  }

  if (step === 'distance') {
    const unitSnapshot = getUnitSnapshot(snapshot, params.unitId ?? '', player)
    if (!unitSnapshot) return []
    const { pos, facing } = unitSnapshot
    const def = CARD_DEFS[defId]
    if (!def.requires.distanceOptions) return []

    const targets: Hex[] = []
    if (defId === 'move_any' || defId === 'move_forward') {
      DIRECTIONS.forEach((_, dirIndex) => {
        def.requires.distanceOptions?.forEach((distance) => {
          const target = stepInDirection(pos, dirIndex as Direction, distance)
          if (isTile(target)) targets.push(target)
        })
      })
    } else {
      def.requires.distanceOptions.forEach((distance) => {
        const target = stepInDirection(pos, facing, distance)
        if (isTile(target)) targets.push(target)
      })
    }

    return targets
  }

  return []
}

function getDirectionBase(
  snapshot: GameState,
  defId: CardDefId,
  params: OrderParams,
  player: PlayerId,
  step: SelectionStep
): Hex | null {
  if (defId === 'reinforce_spawn' && params.tile) return params.tile
  const unitSnapshot = getUnitSnapshot(snapshot, params.unitId ?? '', player)
  if (!unitSnapshot) return null
  if (defId === 'move_forward_face' && step === 'faceDirection') {
    if (params.moveDirection === undefined) return null
    return stepInDirection(unitSnapshot.pos, params.moveDirection, 1)
  }
  return unitSnapshot.pos
}

function stepInDirection(base: Hex, direction: Direction, distance: number): Hex {
  let current = { ...base }
  for (let step = 0; step < distance; step += 1) {
    current = neighbor(current, direction)
  }
  return current
}

function getUnitSnapshot(
  snapshot: GameState,
  unitId: string,
  player: PlayerId
): { pos: Hex; facing: Direction } | null {
  if (!unitId) return null
  if (unitId.startsWith('planned:')) {
    const orderId = unitId.replace('planned:', '')
    const resolved = snapshot.spawnedByOrder[orderId]
    if (resolved && snapshot.units[resolved]) {
      const unit = snapshot.units[resolved]
      return { pos: unit.pos, facing: unit.facing }
    }
    const planned = state.players[player].orders.find((order) => order.id === orderId)
    if (!planned || planned.defId !== 'reinforce_spawn') return null
    if (!planned.params.tile || planned.params.direction === undefined) return null
    return { pos: planned.params.tile, facing: planned.params.direction }
  }
  const unit = snapshot.units[unitId]
  if (!unit) return null
  return { pos: unit.pos, facing: unit.facing }
}

function getPlannedSpawnTiles(player: PlayerId): Hex[] {
  return state.players[player].orders
    .filter((order) => order.defId === 'reinforce_spawn' && order.params.tile)
    .map((order) => order.params.tile as Hex)
}

function findPlannedOrderId(snapshot: GameState, unitId: string): string | null {
  const entry = Object.entries(snapshot.spawnedByOrder).find(([, spawnedId]) => spawnedId === unitId)
  return entry ? entry[0] : null
}

function isTile(hex: Hex): boolean {
  return state.tiles.some((tile) => tile.q === hex.q && tile.r === hex.r)
}

function screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  const localX = clientX - rect.left - boardOffset.x
  const localY = clientY - rect.top - boardOffset.y
  return { x: localX / boardScale, y: localY / boardScale }
}

function zoomBoardAtClientPoint(clientX: number, clientY: number, nextZoom: number): void {
  const clampedZoom = clamp(nextZoom, MIN_BOARD_ZOOM, MAX_BOARD_ZOOM)
  if (clampedZoom === boardZoom) return
  const { x: worldX, y: worldY } = screenToWorld(clientX, clientY)
  boardZoom = clampedZoom
  const viewport = updateBoardScale()
  const rect = canvas.getBoundingClientRect()
  const localX = clientX - rect.left
  const localY = clientY - rect.top
  const centeredOffsetX = (viewport.width - layout.width * boardScale) / 2
  const centeredOffsetY = (viewport.height - layout.height * boardScale) / 2
  boardPan.x = localX - worldX * boardScale - centeredOffsetX
  boardPan.y = localY - worldY * boardScale - centeredOffsetY
  renderBoardOnly()
}

function getTouchDistance(touches: TouchList): number {
  if (touches.length < 2) return 0
  const dx = touches[1].clientX - touches[0].clientX
  const dy = touches[1].clientY - touches[0].clientY
  return Math.hypot(dx, dy)
}

function getTouchMidpoint(touches: TouchList): { x: number; y: number } {
  if (touches.length < 2) return { x: 0, y: 0 }
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  }
}

function pickHexFromEvent(event: MouseEvent): Hex | null {
  const { x, y } = screenToWorld(event.clientX, event.clientY)

  const yUnscaled = (y - layout.origin.y) / BOARD_TILT
  const r = Math.round(yUnscaled / (1.5 * layout.size))
  const q = Math.round((x - layout.origin.x) / (Math.sqrt(3) * layout.size) + 0.5 * (r & 1))
  const rounded = { q, r }
  if (!isTile(rounded)) return null
  return rounded
}

function resolveSelectableUnitId(
  selectionState: GameState,
  hex: Hex,
  player: PlayerId,
  requirement: 'friendly' | 'any'
): string | null {
  if (requirement === 'any') {
    const unit = Object.values(selectionState.units).find(
      (item) => item.pos.q === hex.q && item.pos.r === hex.r && item.kind === 'unit'
    )
    if (unit) return unit.id
    const currentUnit = Object.values(state.units).find(
      (item) => item.pos.q === hex.q && item.pos.r === hex.r && item.kind === 'unit'
    )
    return currentUnit ? currentUnit.id : null
  }

  const unit = Object.values(selectionState.units).find(
    (item) => item.pos.q === hex.q && item.pos.r === hex.r && item.owner === player && item.kind === 'unit'
  )
  if (unit) {
    if (state.units[unit.id]) {
      return unit.id
    }
    const plannedOrderId = findPlannedOrderId(selectionState, unit.id)
    return plannedOrderId ? `planned:${plannedOrderId}` : null
  }

  const planned = state.players[player].orders.find(
    (order) => order.defId === 'reinforce_spawn' && order.params.tile?.q === hex.q && order.params.tile?.r === hex.r
  )
  return planned ? `planned:${planned.id}` : null
}

function handleBoardClick(hex: Hex): void {
  if (mode === 'online' && onlineSession && (onlineSession.presence.paused || !onlineSession.connected)) {
    statusEl.textContent = 'Waiting for connection...'
    return
  }
  if (!pendingOrder || state.phase !== 'planning') return
  const activeOrder = pendingOrder
  const defId = getCardDefId(activeOrder.cardId)
  if (!defId) return
  const nextStep = getNextRequirement(defId, activeOrder.params)
  if (!nextStep) return
  const selectionState = simulatePlannedState(state, planningPlayer)

  if (nextStep === 'unit') {
    const requirement = CARD_DEFS[defId].requires.unit ?? 'friendly'
    const selectionId = resolveSelectableUnitId(selectionState, hex, planningPlayer, requirement)
    if (selectionId) {
      activeOrder.params.unitId = selectionId
      statusEl.textContent =
        selectionId.startsWith('planned:') ? 'Planned spawn selected.' : 'Unit selected.'
    } else {
      statusEl.textContent = requirement === 'any' ? 'Select a unit.' : 'Select a valid unit or planned spawn.'
    }
  }

  if (nextStep === 'unit2') {
    const selectionId = resolveSelectableUnitId(selectionState, hex, planningPlayer, 'friendly')
    if (!selectionId) {
      statusEl.textContent = 'Select a different unit or planned spawn.'
    } else if (selectionId === activeOrder.params.unitId) {
      statusEl.textContent = 'Select a different unit.'
    } else {
      activeOrder.params.unitId2 = selectionId
      statusEl.textContent = selectionId.startsWith('planned:') ? 'Second planned spawn selected.' : 'Second unit selected.'
    }
  }

  if (nextStep === 'tile') {
    if (CARD_DEFS[defId].requires.tile === 'any') {
      if (isTile(hex)) {
        activeOrder.params.tile = hex
        statusEl.textContent = 'Tile selected.'
      } else {
        statusEl.textContent = 'Select a tile.'
      }
    } else if (getSpawnTiles(selectionState, planningPlayer).some((tile) => tile.q === hex.q && tile.r === hex.r)) {
      activeOrder.params.tile = hex
      statusEl.textContent = 'Spawn tile selected.'
    } else {
      statusEl.textContent = 'Select a spawn tile.'
    }
  }

  if (nextStep === 'direction' || nextStep === 'moveDirection' || nextStep === 'faceDirection') {
    const base = getDirectionBase(selectionState, defId, pendingOrder.params, planningPlayer, nextStep)
    if (!base) {
      statusEl.textContent = 'Select a unit or tile first.'
    } else {
      const dirIndex = DIRECTIONS.findIndex(
        (_, index) => {
          const candidate = neighbor(base, index as Direction)
          return candidate.q === hex.q && candidate.r === hex.r
        }
      )
      if (dirIndex !== -1) {
        const direction = dirIndex as Direction
        if (nextStep === 'moveDirection') {
          activeOrder.params.moveDirection = direction
          statusEl.textContent = 'Move direction selected.'
        } else if (nextStep === 'faceDirection') {
          activeOrder.params.faceDirection = direction
          statusEl.textContent = 'Facing direction selected.'
        } else {
          activeOrder.params.direction = direction
          statusEl.textContent = 'Direction selected.'
        }
      } else {
        statusEl.textContent = 'Click an adjacent tile for direction.'
      }
    }
  }

  if (nextStep === 'distance') {
    const snapshot = getUnitSnapshot(selectionState, activeOrder.params.unitId ?? '', planningPlayer)
    if (!snapshot) {
      statusEl.textContent = 'Select a unit first.'
    } else {
      const def = CARD_DEFS[defId]
      if (!def.requires.distanceOptions) return
      let matched = false
      if (defId === 'move_any' || defId === 'move_forward') {
        DIRECTIONS.forEach((_, dirIndex) => {
          def.requires.distanceOptions?.forEach((distance) => {
            const target = stepInDirection(snapshot.pos, dirIndex as Direction, distance)
            if (target.q === hex.q && target.r === hex.r) {
              activeOrder.params.direction = dirIndex as Direction
              activeOrder.params.distance = distance
              matched = true
            }
          })
        })
      } else {
        def.requires.distanceOptions.forEach((distance) => {
          const target = stepInDirection(snapshot.pos, snapshot.facing, distance)
          if (target.q === hex.q && target.r === hex.r) {
            activeOrder.params.distance = distance
            matched = true
          }
        })
      }
      statusEl.textContent = matched ? 'Distance selected.' : 'Click a highlighted tile.'
    }
  }

  tryAutoAddOrder()
  render()
}

menuStartButton.addEventListener('click', () => {
  if (mode === 'online') {
    teardownOnlineSession(true)
    applyPlayMode('local')
    setOnlineStatus('')
  }
  resetGameState('Select a card to start planning.')
  setScreen('game')
})

menuLoadoutButton.addEventListener('click', () => {
  setScreen('loadout')
})

menuSettingsButton.addEventListener('click', () => {
  if (mode === 'online') {
    setOnlineStatus('Leave online match to edit settings.')
    return
  }
  setScreen('settings')
})

seedCopyButton.addEventListener('click', async () => {
  const seed = encodeSeed(getSeedPayload())
  seedInput.value = seed
  seedStatus.textContent = ''
  try {
    await navigator.clipboard.writeText(seed)
    seedStatus.textContent = 'Seed copied.'
  } catch {
    seedInput.select()
    seedStatus.textContent = 'Seed selected. Press Ctrl+C to copy.'
  }
})

seedApplyButton.addEventListener('click', () => {
  seedStatus.textContent = ''
  const seed = seedInput.value.trim()
  if (!seed) {
    seedStatus.textContent = 'Paste a seed to apply.'
    return
  }
  try {
    applySeed(seed)
    seedStatus.textContent = 'Seed applied.'
  } catch {
    seedStatus.textContent = 'Invalid seed string.'
  }
})

onlineCreateButton.addEventListener('click', () => {
  beginOnlineCreate()
})

onlineJoinButton.addEventListener('click', () => {
  const roomCode = onlineRoomInput.value.trim().toUpperCase()
  const seatToken = onlineTokenInput.value.trim()
  if (!roomCode || !seatToken) {
    setOnlineStatus('Enter room code and seat token.')
    return
  }
  beginOnlineJoin(roomCode, seatToken, true)
})

onlineEnterButton.addEventListener('click', () => {
  if (!onlineSession) {
    setOnlineStatus('Create or join a room first.')
    return
  }
  setScreen('game')
})

gameMenuButton.addEventListener('click', () => {
  if (mode === 'online') {
    teardownOnlineSession(true)
    applyPlayMode('local')
    setOnlineStatus('')
  }
  selectedCardId = null
  pendingOrder = null
  setScreen('menu')
})

loadoutBackButton.addEventListener('click', () => {
  setScreen('menu')
})

loadoutToggleButton.addEventListener('click', () => {
  if (mode === 'online') return
  loadoutPlayer = loadoutPlayer === 0 ? 1 : 0
  renderLoadout()
})

loadoutContinueButton.addEventListener('click', () => {
  submitOnlineLoadoutAndContinue()
})

loadoutClearButton.addEventListener('click', () => {
  if (loadoutPlayer === 0) {
    loadouts.p1 = []
  } else {
    loadouts.p2 = []
  }
  renderLoadout()
})

loadoutFilterToggleButton.addEventListener('click', () => {
  loadoutFiltersExpanded = !loadoutFiltersExpanded
  renderLoadout()
})

loadoutSort.addEventListener('change', () => {
  loadoutSortMode = (loadoutSort.value as 'type' | 'name') ?? 'type'
  renderLoadout()
})

loadoutFilterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    loadoutFilter = (button.dataset.filter as 'all' | CardType) ?? 'all'
    renderLoadout()
  })
})

settingsBackButton.addEventListener('click', () => {
  setScreen('menu')
})

settingRows.addEventListener('change', () => {
  const value = clamp(Number(settingRows.value), 4, 14)
  gameSettings = { ...gameSettings, boardRows: value }
  renderSettings()
})

settingCols.addEventListener('change', () => {
  const value = clamp(Number(settingCols.value), 4, 14)
  gameSettings = { ...gameSettings, boardCols: value }
  renderSettings()
})

settingStronghold.addEventListener('change', () => {
  const value = clamp(Number(settingStronghold.value), 1, 20)
  gameSettings = { ...gameSettings, strongholdStrength: value }
  renderSettings()
})

settingDeck.addEventListener('change', () => {
  const value = clamp(Number(settingDeck.value), 5, 40)
  gameSettings = { ...gameSettings, deckSize: value }
  resizeDecks(value)
  renderSettings()
  renderLoadout()
})

settingDraw.addEventListener('change', () => {
  const value = clamp(Number(settingDraw.value), 1, 10)
  gameSettings = { ...gameSettings, drawPerTurn: value }
  renderSettings()
})

settingMaxCopies.addEventListener('change', () => {
  const value = clamp(Number(settingMaxCopies.value), 1, 10)
  gameSettings = { ...gameSettings, maxCopies: value }
  enforceMaxCopies()
  renderSettings()
  renderLoadout()
})

settingActionBudgetP1.addEventListener('change', () => {
  const value = clamp(Number(settingActionBudgetP1.value), 1, 10)
  gameSettings = { ...gameSettings, actionBudgetP1: value }
  state.settings = { ...state.settings, actionBudgetP1: value }
  state.actionBudgets = [value, state.actionBudgets[1]]
  clearReady()
  render()
  renderSettings()
})

settingActionBudgetP2.addEventListener('change', () => {
  const value = clamp(Number(settingActionBudgetP2.value), 1, 10)
  gameSettings = { ...gameSettings, actionBudgetP2: value }
  state.settings = { ...state.settings, actionBudgetP2: value }
  state.actionBudgets = [state.actionBudgets[0], value]
  clearReady()
  render()
  renderSettings()
})

switchPlannerButton.addEventListener('click', () => {
  if (mode === 'online') return
  planningPlayer = planningPlayer === 0 ? 1 : 0
  selectedCardId = null
  pendingOrder = null
  render()
})

readyButton.addEventListener('click', () => {
  if (mode === 'online') {
    if (state.phase !== 'planning') return
    if (state.ready[planningPlayer]) return
    sendOnlineCommand({ type: 'ready' })
    statusEl.textContent = 'Marking ready...'
    return
  }
  if (state.phase !== 'planning') return
  if (state.ready[planningPlayer]) return
  const currentPlayer = planningPlayer
  const otherPlayer = currentPlayer === 0 ? 1 : 0
  setPlayerReady(currentPlayer, true)
  if (!state.ready[otherPlayer]) {
    planningPlayer = otherPlayer
    selectedCardId = null
    pendingOrder = null
    statusEl.textContent = `Player ${currentPlayer + 1} is ready. Player ${otherPlayer + 1} planning.`
  }
  tryStartActionPhase()
  render()
})

resolveNextButton.addEventListener('click', () => {
  if (mode === 'online' && !isOnlineResolutionReplayActive()) return
  autoResolve = false
  resolveNextActionAnimated()
})

resolveAllButton.addEventListener('click', () => {
  if (mode === 'online' && !isOnlineResolutionReplayActive()) return
  autoResolve = true
  resolveNextActionAnimated()
})

resetGameButton.addEventListener('click', () => {
  if (mode === 'online') {
    statusEl.textContent = 'Reset is disabled in online mode.'
    return
  }
  resetGameState('Game reset.')
})

winnerMenuButton.addEventListener('click', () => {
  if (mode === 'online') {
    teardownOnlineSession(true)
    applyPlayMode('local')
  }
  setScreen('menu')
})

winnerResetButton.addEventListener('click', () => {
  if (mode === 'online') {
    setScreen('loadout')
    statusEl.textContent = 'Adjust your deck. Return to the match and press Rematch when ready.'
    return
  }
  resetGameState('Game reset.')
})

winnerRematchButton.addEventListener('click', () => {
  if (mode !== 'online') return
  if (onlineRematchRequested) return
  requestOnlineRematch()
})

canvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault()
    const zoomFactor = Math.exp(-event.deltaY * 0.001)
    zoomBoardAtClientPoint(event.clientX, event.clientY, boardZoom * zoomFactor)
  },
  { passive: false }
)

canvas.addEventListener(
  'touchstart',
  (event) => {
    if (event.touches.length === 2) {
      const startDistance = getTouchDistance(event.touches)
      if (startDistance <= 0) return
      pinchZoomState = { startDistance, startZoom: boardZoom }
      touchPanState = null
      isPanning = false
      didPan = false
      event.preventDefault()
      return
    }
    if (event.touches.length === 1 && !pinchZoomState) {
      const touch = event.touches[0]
      touchPanState = {
        startX: touch.clientX,
        startY: touch.clientY,
        originX: boardPan.x,
        originY: boardPan.y,
        didMove: false,
      }
    }
  },
  { passive: false }
)

canvas.addEventListener(
  'touchmove',
  (event) => {
    if (pinchZoomState && event.touches.length === 2) {
      const distance = getTouchDistance(event.touches)
      if (distance <= 0 || pinchZoomState.startDistance <= 0) return
      const midpoint = getTouchMidpoint(event.touches)
      const nextZoom = pinchZoomState.startZoom * (distance / pinchZoomState.startDistance)
      zoomBoardAtClientPoint(midpoint.x, midpoint.y, nextZoom)
      event.preventDefault()
      return
    }
    if (touchPanState && !pinchZoomState && event.touches.length === 1) {
      const touch = event.touches[0]
      const dx = touch.clientX - touchPanState.startX
      const dy = touch.clientY - touchPanState.startY
      if (Math.abs(dx) + Math.abs(dy) > 4) {
        touchPanState.didMove = true
      }
      boardPan.x = touchPanState.originX + dx
      boardPan.y = touchPanState.originY + dy
      renderBoardOnly()
      event.preventDefault()
    }
  },
  { passive: false }
)

canvas.addEventListener('touchend', (event) => {
  if (pinchZoomState && event.touches.length < 2) {
    pinchZoomState = null
    ignoreClick = true
    if (event.touches.length === 1) {
      const touch = event.touches[0]
      touchPanState = {
        startX: touch.clientX,
        startY: touch.clientY,
        originX: boardPan.x,
        originY: boardPan.y,
        didMove: false,
      }
    }
    return
  }
  if (touchPanState && event.touches.length === 0) {
    if (touchPanState.didMove) {
      ignoreClick = true
    }
    touchPanState = null
  }
})

canvas.addEventListener('touchcancel', () => {
  pinchZoomState = null
  touchPanState = null
})

canvas.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return
  isPanning = true
  didPan = false
  panStart = { x: event.clientX, y: event.clientY }
  panOrigin = { ...boardPan }
  canvas.style.cursor = 'grabbing'
  event.preventDefault()
})

window.addEventListener('mousemove', (event) => {
  lastPointer.x = event.clientX
  lastPointer.y = event.clientY
  hasPointer = true
  if (!isPanning) return
  const dx = event.clientX - panStart.x
  const dy = event.clientY - panStart.y
  if (Math.abs(dx) + Math.abs(dy) > 4) {
    didPan = true
  }
  boardPan.x = panOrigin.x + dx
  boardPan.y = panOrigin.y + dy
  renderBoardOnly()
})

window.addEventListener('mousemove', () => {
  updateHoverFromPointer()
})

window.addEventListener('mouseup', () => {
  if (!isPanning) return
  isPanning = false
  canvas.style.cursor = 'grab'
  if (didPan) {
    ignoreClick = true
  }
})

const syncOverlayOnScroll = () => {
  syncOverlayPositionWithSource()
}

handEl.addEventListener('scroll', syncOverlayOnScroll, { passive: true })
ordersEl.addEventListener('scroll', syncOverlayOnScroll, { passive: true })

canvas.addEventListener('click', (event) => {
  if (ignoreClick) {
    ignoreClick = false
    return
  }
  const hex = pickHexFromEvent(event)
  if (!hex) return
  handleBoardClick(hex)
})

window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    persistProgressNow()
  }
})

window.addEventListener('pagehide', () => {
  persistProgressNow()
})

const restoredScreen = restoreProgressFromStorage()
setScreen(restoredScreen ?? 'menu')
registerServiceWorker()
refreshOnlineLobbyUi()

const inviteJoin = readInviteFromUrl()
if (inviteJoin) {
  onlineRoomInput.value = inviteJoin.roomCode
  onlineTokenInput.value = inviteJoin.seatToken
  beginOnlineJoin(inviteJoin.roomCode, inviteJoin.seatToken, true)
} else {
  const persistedOnline = restoreOnlineSession()
  if (persistedOnline) {
    onlineRoomInput.value = persistedOnline.roomCode
    onlineTokenInput.value = persistedOnline.seatToken
    beginOnlineJoin(persistedOnline.roomCode, persistedOnline.seatToken, false)
  }
}

window.addEventListener('resize', () => {
  render()
})






























