import './style.css'
import { CARD_DEFS, STARTING_DECK, cardCountsAsType, getCardTypes } from './engine/cards'
import { cloneGameState } from './engine/clone'
import {
  DEFAULT_PLAYER_CLASSES,
  getCardClassId,
  getCardPoolForClass,
  getPlayerClassForSeat,
  isCardAllowedForClass,
  isPlayerClassId,
  pickRandomPlayerClass,
  PLAYER_CLASS_DEFS,
  type PlayerClasses,
} from './engine/classes'
import { DIRECTIONS, hexToPixel, neighbor, offsetToAxial, rotateDirection } from './engine/hex'
import {
  canCardTargetUnit,
  canCardSelectUnit,
  createGameState,
  DEFAULT_SETTINGS,
  getBarricadeSpawnTiles,
  getSpawnTiles,
  getPlannedMoveSegments,
  getPlannedOrderValidity,
  planOrder,
  resolveNextAction,
  simulatePlannedState,
  startActionPhase,
  syncUnitState,
} from './engine/game'
import { buildBotPlan } from './engine/bot'
import { generateClusteredBotDeck } from './engine/botDeck'
import { getCardArtSvg } from './ui/cardArt'
import { createQrSvgDataUrl } from './ui/qr'
import {
  getRectCenter,
  getTransformToPoint,
} from './ui/resolutionPreviewGeometry'
import { OnlineClient } from './net/client'
import type { OnlineSessionState, PlayMode } from './net/types'
import type { ClientGameCommand, RoomSetup, ServerMessage } from './shared/net/protocol'
import type { MatchTelemetrySubmission } from './shared/telemetry'
import type { GameStateView, PresenceState, ViewMeta } from './shared/net/view'
import type {
  CardInstance,
  CardDefId,
  CardEffect,
  CardType,
  Direction,
  GameSettings,
  GameState,
  Hex,
  OrderParams,
  PlayerModifier,
  PlayerId,
  PlayerClassId,
  RoguelikeEncounterId,
  Trap,
  Tile,
  TileKind,
  Unit,
} from './engine/types'
import { TutorialController } from './tutorial/controller'
import { TUTORIAL_LESSONS } from './tutorial/lessons'
import { cloneTutorialBootstrap, createTutorialScenarioBootstrap } from './tutorial/scenarios'
import { loadTutorialProgress, saveTutorialProgress } from './tutorial/storage'
import type {
  TutorialActionId,
  TutorialDomTargetId,
  TutorialHighlightTarget,
  TutorialLessonId,
  TutorialOnlineDemoData,
  TutorialPayload,
  TutorialScenarioBootstrap,
} from './tutorial/types'

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

const LEGACY_TILE_KIND_MAP: Record<string, TileKind> = {
  grass: 'grassland',
  forest: 'forest',
  mountain: 'mountain',
  pond: 'swamp',
  rocky: 'hills',
  rough: 'hills',
  shrub: 'meadow',
}

function normalizeTileKindInput(kind: unknown): TileKind {
  if (
    kind === 'grassland' ||
    kind === 'meadow' ||
    kind === 'forest' ||
    kind === 'swamp' ||
    kind === 'hills' ||
    kind === 'mountain' ||
    kind === 'snow' ||
    kind === 'snow_hills'
  ) {
    return kind
  }
  if (typeof kind === 'string' && kind in LEGACY_TILE_KIND_MAP) {
    return LEGACY_TILE_KIND_MAP[kind]
  }
  return 'grassland'
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
          <button id="menu-start-bot" class="btn ghost">Start Vs Bot</button>
          <button id="menu-start-roguelike" class="btn ghost">Start Roguelike</button>
          <button id="menu-tutorial" class="btn ghost">Tutorial</button>
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

    <section id="tutorial-screen" class="menu-screen hidden">
      <div class="menu-card wide tutorial-hub-card">
        <div class="panel-header">
          <div>
            <div class="label">Tutorial</div>
            <div class="planner-name">Lesson Hub</div>
          </div>
          <button id="tutorial-hub-back" class="btn ghost">Main Menu</button>
        </div>
        <div id="tutorial-progress" class="tutorial-progress"></div>
        <div id="tutorial-lessons" class="tutorial-lessons"></div>
      </div>
    </section>

    <section id="loadout-screen" class="menu-screen hidden">
      <div class="menu-card wide">
        <div class="panel-header loadout-header">
          <div class="menu-actions loadout-actions">
            <button id="loadout-toggle" class="btn ghost">Player 1</button>
            <button id="loadout-clear" class="btn ghost">Clear Deck</button>
            <button id="loadout-random" class="btn ghost">Random Deck</button>
            <button id="loadout-filters" class="btn ghost">Filter</button>
            <button id="loadout-continue" class="btn hidden">Continue to Match</button>
            <button id="loadout-back" class="btn ghost">Back</button>
          </div>
        </div>
        <div class="loadout-meta">
          <div id="loadout-count"></div>
          <label class="select-inline">
            Class
            <select id="loadout-class">
              <option value="commander">Commander</option>
              <option value="warleader">Warleader</option>
              <option value="archmage">Archmage</option>
            </select>
          </label>
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
            Leader strength
            <input id="setting-leader-strength" type="number" min="1" max="20" step="1" />
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
              <button id="game-tutorial-hub" class="btn ghost board-menu-btn hidden">Tutorial Hub</button>
              <button id="reset-game" class="btn ghost board-menu-btn">Reset Game</button>
            </div>
            <div id="planner-name" class="board-planner"></div>
            <div class="board-controls">
              <button id="switch-planner" class="btn ghost board-control-btn">Switch Player</button>
              <button id="resolve-next" class="btn ghost board-control-btn">Resolve Next</button>
              <button id="resolve-all" class="btn ghost board-control-btn">Resolve Turn</button>
            </div>
            <div id="planner-ap" class="planner-ap board-ap-rail"></div>
            <canvas id="board" aria-label="Game board"></canvas>
            <div id="unit-status-popover" class="unit-status-popover hidden" aria-live="polite"></div>
            <div id="player-status-popover" class="player-status-popover hidden" aria-live="polite"></div>
            <div class="hud">
              <button id="player-portrait-p1" class="player-portrait player-portrait-p1" type="button" aria-label="Open Player 1 status">
                <canvas id="player-portrait-canvas-p1" class="player-portrait-canvas" width="96" height="96"></canvas>
              </button>
              <div class="hud-center">
                <div id="planning-ready-slot" class="meta-ready-slot">
                  <button id="ready-btn" class="btn board-control-btn">Ready</button>
                </div>
              </div>
              <button id="player-portrait-p2" class="player-portrait player-portrait-p2" type="button" aria-label="Open Player 2 status">
                <canvas id="player-portrait-canvas-p2" class="player-portrait-canvas" width="96" height="96"></canvas>
              </button>
              <div class="hud-meta-stash hidden" aria-hidden="true">
                <div id="status">Select a card to start planning.</div>
                <div class="meta">
                  <div class="meta-phase">
                    <span id="turn"></span>
                    <span id="active"></span>
                    <span id="network-state"></span>
                  </div>
                  <div id="counts" class="meta-counts">
                    <span id="counts-deck-p1"></span>
                    <span id="counts-deck-p2"></span>
                    <span id="counts-discard-p1"></span>
                    <span id="counts-discard-p2"></span>
                  </div>
                </div>
              </div>
            </div>
          </section>
          <aside class="queue-panel">
            <div id="orders" class="orders orders-vertical"></div>
          </aside>

          <section class="card-rows">
            <div class="card-row">
              <div id="hand" class="card-grid hand-row"></div>
              <div id="resolution-controls" class="resolution-controls hidden"></div>
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
      <div id="winner-extra" class="winner-extra"></div>
      <div class="winner-actions">
        <button id="winner-menu" class="btn ghost">Main Menu</button>
        <button id="winner-reset" class="btn">Edit Deck</button>
        <button id="winner-rematch" class="btn ghost hidden">Rematch</button>
      </div>
    </div>
  </div>
  <div id="tutorial-spotlights" class="tutorial-spotlights hidden" aria-hidden="true"></div>
  <div id="tutorial-panel" class="tutorial-panel hidden" aria-live="polite">
    <div class="tutorial-panel-header">
      <div>
        <div id="tutorial-panel-title" class="tutorial-panel-title"></div>
        <div id="tutorial-panel-step" class="tutorial-panel-step"></div>
      </div>
      <span id="tutorial-panel-badge" class="pill hidden">Completed</span>
    </div>
    <div id="tutorial-panel-body" class="tutorial-panel-body"></div>
    <div id="tutorial-panel-feedback" class="tutorial-panel-feedback"></div>
    <div id="tutorial-panel-actions" class="tutorial-panel-actions hidden">
      <button id="tutorial-panel-next" class="btn ghost hidden" type="button">Next</button>
    </div>
  </div>
  <div id="card-overlay" class="card-overlay"></div>
`

const menuScreen = document.querySelector<HTMLDivElement>('#menu-screen')!
const tutorialScreen = document.querySelector<HTMLDivElement>('#tutorial-screen')!
const loadoutScreen = document.querySelector<HTMLDivElement>('#loadout-screen')!
const settingsScreen = document.querySelector<HTMLDivElement>('#settings-screen')!
const gameScreen = document.querySelector<HTMLDivElement>('#game-screen')!
const cardOverlay = document.querySelector<HTMLDivElement>('#card-overlay')!
const tutorialSpotlightsEl = document.querySelector<HTMLDivElement>('#tutorial-spotlights')!
const tutorialPanelEl = document.querySelector<HTMLDivElement>('#tutorial-panel')!
const tutorialPanelTitleEl = document.querySelector<HTMLDivElement>('#tutorial-panel-title')!
const tutorialPanelStepEl = document.querySelector<HTMLDivElement>('#tutorial-panel-step')!
const tutorialPanelBadgeEl = document.querySelector<HTMLSpanElement>('#tutorial-panel-badge')!
const tutorialPanelBodyEl = document.querySelector<HTMLDivElement>('#tutorial-panel-body')!
const tutorialPanelFeedbackEl = document.querySelector<HTMLDivElement>('#tutorial-panel-feedback')!
const tutorialPanelActionsEl = document.querySelector<HTMLDivElement>('#tutorial-panel-actions')!
const tutorialPanelNextButton = document.querySelector<HTMLButtonElement>('#tutorial-panel-next')!

const menuStartButton = document.querySelector<HTMLButtonElement>('#menu-start')!
const menuStartBotButton = document.querySelector<HTMLButtonElement>('#menu-start-bot')!
const menuStartRoguelikeButton = document.querySelector<HTMLButtonElement>('#menu-start-roguelike')!
const menuTutorialButton = document.querySelector<HTMLButtonElement>('#menu-tutorial')!
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
const tutorialHubBackButton = document.querySelector<HTMLButtonElement>('#tutorial-hub-back')!
const tutorialProgressEl = document.querySelector<HTMLDivElement>('#tutorial-progress')!
const tutorialLessonsEl = document.querySelector<HTMLDivElement>('#tutorial-lessons')!

const loadoutBackButton = document.querySelector<HTMLButtonElement>('#loadout-back')!
const loadoutToggleButton = document.querySelector<HTMLButtonElement>('#loadout-toggle')!
const loadoutClearButton = document.querySelector<HTMLButtonElement>('#loadout-clear')!
const loadoutRandomButton = document.querySelector<HTMLButtonElement>('#loadout-random')!
const loadoutFilterToggleButton = document.querySelector<HTMLButtonElement>('#loadout-filters')!
const loadoutContinueButton = document.querySelector<HTMLButtonElement>('#loadout-continue')!
const loadoutCountLabel = document.querySelector<HTMLDivElement>('#loadout-count')!
const loadoutClassSelect = document.querySelector<HTMLSelectElement>('#loadout-class')!
const loadoutControls = document.querySelector<HTMLDivElement>('#loadout-controls')!
const loadoutSelected = document.querySelector<HTMLDivElement>('#loadout-selected')!
const loadoutAll = document.querySelector<HTMLDivElement>('#loadout-all')!
const loadoutSort = document.querySelector<HTMLSelectElement>('#loadout-sort')!
const loadoutFilterButtons = document.querySelectorAll<HTMLButtonElement>('.filter-btn')

const settingsBackButton = document.querySelector<HTMLButtonElement>('#settings-back')!
const settingRows = document.querySelector<HTMLInputElement>('#setting-rows')!
const settingCols = document.querySelector<HTMLInputElement>('#setting-cols')!
const settingLeaderStrength = document.querySelector<HTMLInputElement>('#setting-leader-strength')!
const settingDeck = document.querySelector<HTMLInputElement>('#setting-deck')!
const settingDraw = document.querySelector<HTMLInputElement>('#setting-draw')!

const settingMaxCopies = document.querySelector<HTMLInputElement>('#setting-max-copies')!
const settingActionBudgetP1 = document.querySelector<HTMLInputElement>('#setting-action-budget-p1')!
const settingActionBudgetP2 = document.querySelector<HTMLInputElement>('#setting-action-budget-p2')!

const canvas = document.querySelector<HTMLCanvasElement>('#board')!
const unitStatusPopoverEl = document.querySelector<HTMLDivElement>('#unit-status-popover')!
const playerStatusPopoverEl = document.querySelector<HTMLDivElement>('#player-status-popover')!
const statusEl = document.querySelector<HTMLDivElement>('#status')!
const handEl = document.querySelector<HTMLDivElement>('#hand')!
const ordersEl = document.querySelector<HTMLDivElement>('#orders')!
const orderFormEl = document.querySelector<HTMLDivElement>('#order-form')!
const plannerNameEl = document.querySelector<HTMLDivElement>('#planner-name')!
const plannerApEl = document.querySelector<HTMLDivElement>('#planner-ap')!
const turnEl = document.querySelector<HTMLSpanElement>('#turn')!
const activeEl = document.querySelector<HTMLSpanElement>('#active')!
const logEl = document.querySelector<HTMLDivElement>('#log')!
const countsEl = document.querySelector<HTMLDivElement>('#counts')!
const countsDeckP1El = document.querySelector<HTMLSpanElement>('#counts-deck-p1')!
const countsDeckP2El = document.querySelector<HTMLSpanElement>('#counts-deck-p2')!
const countsDiscardP1El = document.querySelector<HTMLSpanElement>('#counts-discard-p1')!
const countsDiscardP2El = document.querySelector<HTMLSpanElement>('#counts-discard-p2')!
const networkStateEl = document.querySelector<HTMLSpanElement>('#network-state')!
const playerPortraitP1Button = document.querySelector<HTMLButtonElement>('#player-portrait-p1')!
const playerPortraitP2Button = document.querySelector<HTMLButtonElement>('#player-portrait-p2')!
const playerPortraitP1Canvas = document.querySelector<HTMLCanvasElement>('#player-portrait-canvas-p1')!
const playerPortraitP2Canvas = document.querySelector<HTMLCanvasElement>('#player-portrait-canvas-p2')!
const winnerModal = document.querySelector<HTMLDivElement>('#winner-modal')!
const winnerTextEl = document.querySelector<HTMLDivElement>('#winner-text')!
const winnerNoteEl = document.querySelector<HTMLDivElement>('#winner-note')!
const winnerExtraEl = document.querySelector<HTMLDivElement>('#winner-extra')!
const winnerMenuButton = document.querySelector<HTMLButtonElement>('#winner-menu')!
const winnerResetButton = document.querySelector<HTMLButtonElement>('#winner-reset')!
const winnerRematchButton = document.querySelector<HTMLButtonElement>('#winner-rematch')!
const gameMenuButton = document.querySelector<HTMLButtonElement>('#game-menu')!
const gameTutorialHubButton = document.querySelector<HTMLButtonElement>('#game-tutorial-hub')!

const switchPlannerButton = document.querySelector<HTMLButtonElement>('#switch-planner')!
const readyButton = document.querySelector<HTMLButtonElement>('#ready-btn')!
const resolveNextButton = document.querySelector<HTMLButtonElement>('#resolve-next')!
const resolveAllButton = document.querySelector<HTMLButtonElement>('#resolve-all')!
const resetGameButton = document.querySelector<HTMLButtonElement>('#reset-game')!
const boardControlsEl = document.querySelector<HTMLDivElement>('.board-controls')!
const planningReadySlotEl = document.querySelector<HTMLDivElement>('#planning-ready-slot')!
const resolutionControlsEl = document.querySelector<HTMLDivElement>('#resolution-controls')!

if (
  !menuScreen ||
  !tutorialScreen ||
  !loadoutScreen ||
  !settingsScreen ||
  !gameScreen ||
  !tutorialSpotlightsEl ||
  !tutorialPanelEl ||
  !tutorialPanelTitleEl ||
  !tutorialPanelStepEl ||
  !tutorialPanelBadgeEl ||
  !tutorialPanelBodyEl ||
  !tutorialPanelFeedbackEl ||
  !tutorialPanelActionsEl ||
  !tutorialPanelNextButton ||
  !menuStartButton ||
  !menuStartBotButton ||
  !menuStartRoguelikeButton ||
  !menuTutorialButton ||
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
  !tutorialHubBackButton ||
  !tutorialProgressEl ||
  !tutorialLessonsEl ||
  !loadoutBackButton ||
  !loadoutToggleButton ||
  !loadoutClearButton ||
  !loadoutRandomButton ||
  !loadoutFilterToggleButton ||
  !loadoutContinueButton ||
  !loadoutCountLabel ||
  !loadoutClassSelect ||
  !loadoutControls ||
  !loadoutSelected ||
  !loadoutAll ||
  !loadoutSort ||
  !settingsBackButton ||
  !settingRows ||
  !settingCols ||
  !settingLeaderStrength ||
  !settingDeck ||
  !settingDraw ||
  !settingMaxCopies ||
  !settingActionBudgetP1 ||
  !settingActionBudgetP2 ||
  !canvas ||
  !unitStatusPopoverEl ||
  !playerStatusPopoverEl ||
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
  !countsDeckP1El ||
  !countsDeckP2El ||
  !countsDiscardP1El ||
  !countsDiscardP2El ||
  !networkStateEl ||
  !playerPortraitP1Button ||
  !playerPortraitP2Button ||
  !playerPortraitP1Canvas ||
  !playerPortraitP2Canvas ||
  !winnerModal ||
  !winnerTextEl ||
  !winnerNoteEl ||
  !winnerExtraEl ||
  !winnerMenuButton ||
  !winnerResetButton ||
  !winnerRematchButton ||
  !gameMenuButton ||
  !gameTutorialHubButton
) {
  throw new Error('UI elements missing')
}

if (
  !switchPlannerButton ||
  !readyButton ||
  !resolveNextButton ||
  !resolveAllButton ||
  !resetGameButton ||
  !boardControlsEl ||
  !planningReadySlotEl ||
  !resolutionControlsEl
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

type UnitSnapshot = {
  id: string
  pos: Hex
  facing: Direction
  strength: number
  owner: PlayerId
  kind: Unit['kind']
  roguelikeRole?: Unit['roguelikeRole']
  isMinion?: boolean
  modifiers: Unit['modifiers']
}
type MoveAnimation = { type: 'move'; unitId: string; from: Hex; to: Hex; duration: number }
type TeamMoveAnimation = {
  type: 'teamMove'
  moves: { unitId: string; from: Hex; to: Hex }[]
  duration: number
}
type ShoveAnimation = {
  type: 'shove'
  targetUnitId: string
  from: Hex
  to: Hex
  collision: boolean
  duration: number
}
type LungeAnimation = { type: 'lunge'; unitId: string; from: Hex; dir: Direction; duration: number }
type TeamLungeAnimation = {
  type: 'teamLunge'
  lunges: { unitId: string; from: Hex; dir: Direction }[]
  duration: number
}
type SpawnAnimation = { type: 'spawn'; unitId: string; duration: number }
type BoostAnimation = { type: 'boost'; unitId: string; duration: number }
type DeathAnimation = { type: 'death'; unit: Unit; duration: number }
type DamageFlashAnimation = { type: 'damageFlash'; unitIds: string[]; duration: number }
type StrengthChangeAnimation = {
  type: 'strengthChange'
  entries: Array<{ unitId: string; anchor: Hex; amount: number; stackIndex: number }>
  duration: number
}
type LightningAnimation = { type: 'lightning'; target: Hex; duration: number }
type BurnAnimation = { type: 'burn'; target: Hex; duration: number }
type ExecuteAnimation = { type: 'execute'; target: Hex; duration: number }
type WhirlwindAnimation = { type: 'whirlwind'; origin: Hex; duration: number }
type AdjacentStrikeAnimation = { type: 'adjacentStrike'; origin: Hex; duration: number }
type TrapTriggerAnimation = { type: 'trapTrigger'; target: Hex; trapKind: 'pitfall' | 'explosive'; duration: number }
type MeteorAnimation = { type: 'meteor'; target: Hex; duration: number }
type LineProjectileAnimation = {
  type: 'lineProjectile'
  projectile: 'arrow' | 'iceBolt' | 'fireball'
  from: Hex
  to: Hex
  target?: Hex
  fizzle?: boolean
  duration: number
}
type StateSyncAnimation = { type: 'stateSync'; upToLogIndex: number; duration: 0 }
type TeleportAnimation = {
  type: 'teleport'
  unitId: string
  from: Hex
  to: Hex
  fromSnapshot: UnitSnapshot
  toSnapshot: UnitSnapshot
  duration: number
}
type ChainLightningAnimation = { type: 'chainLightning'; from: Hex; to: Hex; duration: number }
type LightningFizzleAnimation = { type: 'lightningFizzle'; centers: Hex[]; duration: number }
type SlimeLobAnimation = { type: 'slimeLob'; arcs: Array<{ from: Hex; to: Hex }>; duration: number }
type VolleyAnimation = { type: 'volley'; shots: Array<{ from: Hex; to: Hex }>; duration: number }
type PincerAnimation = {
  type: 'pincer'
  strikes: Array<{ from: Hex; to: Hex; snapshot: UnitSnapshot; alpha: number }>
  duration: number
}
type HarpoonAnimation = {
  type: 'harpoon'
  from: Hex
  to: Hex
  duration: number
  fizzle?: boolean
  pulledUnit?: {
    id: string
    from: Hex
    to: Hex
    snapshot: UnitSnapshot
  }
}
type FlameThrowerAnimation = { type: 'flameThrower'; from: Hex; to: Hex; duration: number }
type BlizzardAnimation = { type: 'blizzard'; target: Hex; radius: number; duration: number }
type LightningBarrierAnimation = { type: 'lightningBarrier'; arcs: Array<{ from: Hex; to: Hex }>; duration: number }
type BrainFreezeAnimation = { type: 'brainFreeze'; duration: number }
type BoardAnimation =
  | MoveAnimation
  | TeamMoveAnimation
  | ShoveAnimation
  | LungeAnimation
  | TeamLungeAnimation
  | SpawnAnimation
  | BoostAnimation
  | DeathAnimation
  | DamageFlashAnimation
  | StrengthChangeAnimation
  | LightningAnimation
  | BurnAnimation
  | ExecuteAnimation
  | WhirlwindAnimation
  | AdjacentStrikeAnimation
  | TrapTriggerAnimation
  | MeteorAnimation
  | LineProjectileAnimation
  | StateSyncAnimation
  | TeleportAnimation
  | ChainLightningAnimation
  | LightningFizzleAnimation
  | SlimeLobAnimation
  | VolleyAnimation
  | PincerAnimation
  | HarpoonAnimation
  | FlameThrowerAnimation
  | BlizzardAnimation
  | LightningBarrierAnimation
  | BrainFreezeAnimation

const MOVE_DURATION_MS = 300
const SHOVE_DURATION_MS = 520
const LUNGE_DURATION_MS = 200
const SPAWN_DURATION_MS = 260
const BOOST_DURATION_MS = 320
const DEATH_DURATION_MS = 260
const DAMAGE_FLASH_DURATION_MS = 240
const STRENGTH_CHANGE_DURATION_MS = 760
const LIGHTNING_DURATION_MS = 240
const BURN_DURATION_MS = 420
const EXECUTE_DURATION_MS = 360
const WHIRLWIND_DURATION_MS = 340
const ADJACENT_STRIKE_DURATION_MS = 220
const TRAP_TRIGGER_DURATION_MS = 320
const CHAIN_LIGHTNING_HOP_DURATION_MS = 170
const LIGHTNING_FIZZLE_DURATION_MS = 240
const SLIME_LOB_DURATION_MS = 380
const VOLLEY_DURATION_MS = 420
const PINCER_DURATION_MS = 260
const METEOR_DURATION_MS = 1600
const ARROW_DURATION_MS = 300
const TELEPORT_DURATION_MS = 320
const HARPOON_DURATION_MS = 500
const FLAME_THROWER_DURATION_MS = 420
const ICE_BOLT_DURATION_MS = 340
const FIREBALL_DURATION_MS = 620
const BLIZZARD_DURATION_MS = 680
const LIGHTNING_BARRIER_DURATION_MS = 260
const BRAIN_FREEZE_DURATION_MS = 650
const CARD_TRANSFER_DURATION_MS = 800
const RESOLUTION_CARD_APPROACH_DURATION_MS = 360
const RESOLUTION_CARD_HOLD_DURATION_MS = 250
const RESOLUTION_CARD_SHRINK_DURATION_MS = 380
const RESOLUTION_CARD_GLOBAL_FADE_DURATION_MS = 430
const RESOLUTION_CARD_FIZZLE_DURATION_MS = 520
const RESOLUTION_CARD_SCALE = 2.2
const RESOLUTION_CARD_TARGET_SCALE_UNIT = 0.18
const RESOLUTION_CARD_TARGET_SCALE_TILE = 0.14
const RESOLUTION_CARD_TARGET_SCALE_PLAYER = 0.24
const RESOLUTION_CARD_GLOBAL_END_SCALE = 2.85

let isAnimating = false
let animationQueue: BoardAnimation[] = []
let currentAnimation: BoardAnimation | null = null
let animationStart = 0
let animationProgress = 0
let autoResolve = false
const pendingDeathUnits = new Map<string, Unit>()
const unitAlphaOverrides = new Map<string, number>()
const deathAlphaOverrides = new Map<string, number>()
let animationRenderUnits: Record<string, Unit> | null = null
let animationLogEntriesForSync: string[] = []
let animationAppliedLogIndex = -1
type CardReorderDragState = {
  options: CardStripReorderOptions
  pointerId: number
  pointerType: string
  container: HTMLElement
  cards: HTMLElement[]
  card: HTMLElement
  fromId: string
  targetId: string
  startX: number
  startY: number
  lastX: number
  lastY: number
  startScrollLeft: number
  startScrollTop: number
  isDragging: boolean
  didScroll: boolean
  holdTimer: number | null
}
let cardReorderDrag: CardReorderDragState | null = null
const TOUCH_REORDER_HOLD_MS = 180
const TOUCH_REORDER_CANCEL_MOVE_PX = 4
const TOUCH_CARD_SCROLL_START_DISTANCE_PX = 6
const CARD_REORDER_START_DISTANCE_PX = 8
const CARD_ACTIVATE_MAX_MOVE_PX = 8
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

const tileImageFamilies = {
  grassland: loadImage(resolveAssetUrl('assets/tiles/tile_grassland.png')),
  hills: loadImage(resolveAssetUrl('assets/tiles/tile_hills.png')),
  forest: loadImage(resolveAssetUrl('assets/tiles/tile_forest.png')),
  mountain: loadImage(resolveAssetUrl('assets/tiles/tile_mountain.png')),
} as const

// The current tileset only ships four terrain sprites, so older saved terrain kinds
// are mapped to the closest available family instead of failing on missing files.
const tileImages: Record<TileKind, ImageAsset[]> = {
  grassland: [tileImageFamilies.grassland],
  meadow: [tileImageFamilies.grassland],
  forest: [tileImageFamilies.forest],
  swamp: [tileImageFamilies.forest],
  hills: [tileImageFamilies.hills],
  mountain: [tileImageFamilies.mountain],
  snow: [tileImageFamilies.mountain],
  snow_hills: [tileImageFamilies.hills],
}
const tileRenderAdjustments: Record<TileKind, { offsetX: number; offsetY: number; rowOverlayPriority: number }> = {
  grassland: { offsetX: 0, offsetY: 0, rowOverlayPriority: 0 },
  meadow: { offsetX: 0, offsetY: 0, rowOverlayPriority: 0 },
  forest: { offsetX: 0, offsetY: 0, rowOverlayPriority: 1 },
  swamp: { offsetX: 0, offsetY: 0, rowOverlayPriority: 1 },
  hills: { offsetX: -0.01, offsetY: -0.01, rowOverlayPriority: 0 },
  mountain: { offsetX: 0, offsetY: -0.02, rowOverlayPriority: 0 },
  snow: { offsetX: 0, offsetY: -0.02, rowOverlayPriority: 0 },
  snow_hills: { offsetX: -0.01, offsetY: -0.01, rowOverlayPriority: 0 },
}
const spawnBaseImage = loadImage(resolveAssetUrl('assets/buildings/spawn_village_base.png'))
const spawnTeamImage = loadImage(resolveAssetUrl('assets/buildings/spawn_village_team.png'))
const barricadeBaseImage = loadImage(resolveAssetUrl('assets/units/unit_barricade_base.png'))
const barricadeTeamImage = loadImage(resolveAssetUrl('assets/units/unit_barricade_team.png'))
const trapImages: Record<'pitfall' | 'explosive', ImageAsset> = {
  pitfall: loadImage(resolveAssetUrl('assets/traps/pitfall_trap.png')),
  explosive: loadImage(resolveAssetUrl('assets/traps/explosive_trap.png')),
}
const monsterRoleImages: Record<RoguelikeEncounterUnitRole, ImageAsset[]> = {
  slime_grand: [loadImage(resolveAssetUrl('assets/monsters/monster_grandslime.png'))],
  slime_mid: [loadImage(resolveAssetUrl('assets/monsters/monster_slime.png'))],
  slime_small: [loadImage(resolveAssetUrl('assets/monsters/monster_slimeling.png'))],
  troll: [loadImage(resolveAssetUrl('assets/monsters/monster_troll.png'))],
  alpha_wolf: [loadImage(resolveAssetUrl('assets/monsters/monster_alpha_wolf.png'))],
  wolf: [loadImage(resolveAssetUrl('assets/monsters/monster_wolf_2.png'))],
  ice_spirit: [loadImage(resolveAssetUrl('assets/monsters/monster_ice_elemental.png'))],
  fire_spirit: [loadImage(resolveAssetUrl('assets/monsters/monster_fire_elemental.png'))],
  lightning_spirit: [loadImage(resolveAssetUrl('assets/monsters/monster_lightning_elemental.png'))],
  bandit: [
    loadImage(resolveAssetUrl('assets/monsters/monster_bandit_1.png')),
    loadImage(resolveAssetUrl('assets/monsters/monster_bandit_2.png')),
    loadImage(resolveAssetUrl('assets/monsters/monster_bandit_3.png')),
  ],
  necromancer: [loadImage(resolveAssetUrl('assets/monsters/monster_necromancer.png'))],
  skeleton_soldier: [loadImage(resolveAssetUrl('assets/monsters/monster_skeleton_soldier.png'))],
  skeleton_warrior: [loadImage(resolveAssetUrl('assets/monsters/monster_skeleton_warrior.png'))],
  skeleton_mage: [loadImage(resolveAssetUrl('assets/monsters/monster_skeleton_mage.png'))],
}
const roguelikeMonsterVariantByUnitId = new Map<string, number>()
const barricadeTeamCache = new Map<PlayerId, HTMLCanvasElement>()
const spawnTeamCache = new Map<PlayerId, HTMLCanvasElement>()
const monsterTintCache = new Map<string, HTMLCanvasElement>()

function getStableVariantIndex(seed: string, variantCount: number): number {
  if (variantCount <= 1) return 0
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % variantCount
}

function getTileImage(tile: Pick<Tile, 'id' | 'kind'>): ImageAsset | null {
  const variants = tileImages[tile.kind] ?? tileImages.grassland
  if (variants.length === 0) return null
  return variants[getStableVariantIndex(tile.id, variants.length)] ?? variants[0] ?? null
}

function getTileRenderAdjustment(kind: TileKind): { offsetX: number; offsetY: number; rowOverlayPriority: number } {
  return tileRenderAdjustments[kind] ?? tileRenderAdjustments.grassland
}

type ClassSpriteSet = {
  unitBaseImage: ImageAsset
  unitTeamImage: ImageAsset
  leaderBaseImage: ImageAsset
  leaderTeamImage: ImageAsset
  unitTeamCache: Map<PlayerId, HTMLCanvasElement>
  leaderTeamCache: Map<PlayerId, HTMLCanvasElement>
  unitOffsetX: number
  unitOffsetY: number
  leaderOffsetX: number
  leaderOffsetY: number
}

const classSpriteSets: Record<PlayerClassId, ClassSpriteSet> = {
  commander: {
    unitBaseImage: loadImage(resolveAssetUrl(PLAYER_CLASS_DEFS.commander.unitBaseAsset)),
    unitTeamImage: loadImage(resolveAssetUrl(PLAYER_CLASS_DEFS.commander.unitTeamAsset)),
    leaderBaseImage: loadImage(resolveAssetUrl(PLAYER_CLASS_DEFS.commander.leaderBaseAsset)),
    leaderTeamImage: loadImage(resolveAssetUrl(PLAYER_CLASS_DEFS.commander.leaderTeamAsset)),
    unitTeamCache: new Map<PlayerId, HTMLCanvasElement>(),
    leaderTeamCache: new Map<PlayerId, HTMLCanvasElement>(),
    unitOffsetX: -0.06,
    unitOffsetY: 0,
    leaderOffsetX: 0,
    leaderOffsetY: 0,
  },
  warleader: {
    unitBaseImage: loadImage(resolveAssetUrl(PLAYER_CLASS_DEFS.warleader.unitBaseAsset)),
    unitTeamImage: loadImage(resolveAssetUrl(PLAYER_CLASS_DEFS.warleader.unitTeamAsset)),
    leaderBaseImage: loadImage(resolveAssetUrl(PLAYER_CLASS_DEFS.warleader.leaderBaseAsset)),
    leaderTeamImage: loadImage(resolveAssetUrl(PLAYER_CLASS_DEFS.warleader.leaderTeamAsset)),
    unitTeamCache: new Map<PlayerId, HTMLCanvasElement>(),
    leaderTeamCache: new Map<PlayerId, HTMLCanvasElement>(),
    unitOffsetX: -0.1,
    unitOffsetY: -0.05,
    leaderOffsetX: 0,
    leaderOffsetY: -0.05,
  },
  archmage: {
    unitBaseImage: loadImage(resolveAssetUrl(PLAYER_CLASS_DEFS.archmage.unitBaseAsset)),
    unitTeamImage: loadImage(resolveAssetUrl(PLAYER_CLASS_DEFS.archmage.unitTeamAsset)),
    leaderBaseImage: loadImage(resolveAssetUrl(PLAYER_CLASS_DEFS.archmage.leaderBaseAsset)),
    leaderTeamImage: loadImage(resolveAssetUrl(PLAYER_CLASS_DEFS.archmage.leaderTeamAsset)),
    unitTeamCache: new Map<PlayerId, HTMLCanvasElement>(),
    leaderTeamCache: new Map<PlayerId, HTMLCanvasElement>(),
    unitOffsetX: 0,
    unitOffsetY: 0,
    leaderOffsetX: 0,
    leaderOffsetY: 0,
  },
}

let gameSettings: GameSettings = { ...DEFAULT_SETTINGS }
let loadouts: { p1: CardDefId[]; p2: CardDefId[] } = {
  p1: STARTING_DECK.slice(0, gameSettings.deckSize),
  p2: STARTING_DECK.slice(0, gameSettings.deckSize),
}
let playerClasses: PlayerClasses = { ...DEFAULT_PLAYER_CLASSES }

function createStandardMatchState(
  settings: GameSettings = gameSettings,
  decks: { p1: CardDefId[]; p2: CardDefId[] } = loadouts,
  classes: PlayerClasses = playerClasses
): GameState {
  return createGameState({ ...settings, randomizeFirstPlayer: true }, decks, classes)
}

let state = createStandardMatchState()
let planningPlayer: PlayerId = 0
let selectedCardId: string | null = null
let pendingOrder: { cardId: string; params: OrderParams } | null = null
let lastObservedTurn = state.turn
let lastObservedWinner: PlayerId | null = state.winner
let lastObservedRoguelikeRewardVisible = false
let previewState: GameState | null = null
let overlayClone: HTMLElement | null = null
let overlaySourceKey: string | null = null
let overlaySourceId: string | null = null
let overlaySourceDefId: string | null = null
let overlaySourceOrderId: string | null = null
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
let hoverCardKey: string | null = null
let hasPointer = false
let hoveredStatusUnitId: string | null = null
let pinnedStatusUnitId: string | null = null
let pinnedStatusPlayerId: PlayerId | null = null
let lastInputWasTouch = false
let touchTapCandidate = false
let suppressWinnerModalForRestoredOutcome = false
const hiddenCardIds = new Set<string>()
const resolvingOrderIdsHidden = new Set<string>()
const handVisualOrder: Record<PlayerId, string[]> = { 0: [], 1: [] }

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
  | { type: 'join'; roomCode: string; seatToken: string; loadout: CardDefId[]; playerClass: PlayerClassId }
  | null = null
let onlineLastJoinPayload: { loadout: CardDefId[]; playerClass: PlayerClassId } | null = null
let onlineAutoEnterGameOnJoin = true
let onlineRouteToLoadoutOnJoin = false
let onlineRematchRequested = false
let onlineReconnectTimer: number | null = null
let onlineSuppressReconnect = false
let onlineCommandSeq = 1
let botThinking = false
let botPlanToken = 0

const ONLINE_SESSION_STORAGE_KEY = 'untitled_game_online_session_v1'
const ONLINE_SESSION_VERSION = 1
const ONLINE_RECONNECT_DELAY_MS = 2000
const BOT_HUMAN_PLAYER: PlayerId = 0
const BOT_PLAYER: PlayerId = 1
const ROGUELIKE_STARTING_LEADER_HP = 20
const ROGUELIKE_BASE_AP_BUDGET = 3
const ROGUELIKE_RANDOM_REWARD_WEIGHTS = {
  leaderHp: 34,
  extraDraw: 5,
  extraAp: 2,
  extraStartingUnit: 5,
  unitStrength: 5,
  removeCard: 4,
} as const
const ROGUELIKE_STARTING_DECK: CardDefId[] = [
  'reinforce_spawn',
  'reinforce_spawn',
  'move_forward_face',
  'move_forward_face',
  'reinforce_boost',
  'move_forward',
  'attack_fwd_lr',
  'attack_fwd',
  'attack_arrow',
]

type RoguelikeRandomReward = keyof typeof ROGUELIKE_RANDOM_REWARD_WEIGHTS
type RoguelikeUiStage = 'reward_choice' | 'reward_notice' | 'remove_choice' | 'run_over'

type RoguelikeEncounterUnitRole = NonNullable<Unit['roguelikeRole']>
type RoguelikeEncounterUnitSpawn = {
  role: RoguelikeEncounterUnitRole | RoguelikeEncounterUnitRole[]
  count: number
  isMinion?: boolean
}

type RoguelikeEncounterDef = {
  id: RoguelikeEncounterId
  name: string
  deck: (matchNumber: number) => CardDefId[]
  unitCounts: (matchNumber: number) => RoguelikeEncounterUnitSpawn[]
  actionBudget?: (matchNumber: number) => number
}

type RoguelikeRunState = {
  wins: number
  leaderHp: number
  deck: CardDefId[]
  playerClass: PlayerClassId
  bonusDrawPerTurn: number
  bonusActionBudget: number
  bonusStartingUnits: number
  bonusStartingUnitStrength: number
  resultHandled: boolean
  uiStage: RoguelikeUiStage
  draftOptions: CardDefId[]
  pendingRandomReward: RoguelikeRandomReward | null
  rewardNoticeMessage: string | null
  currentEncounterId: RoguelikeEncounterId | null
  currentMatchNumber: number
}

const ROGUELIKE_ENCOUNTER_DEFS: RoguelikeEncounterDef[] = [
  {
    id: 'slimes',
    name: 'Slimes',
    deck: () => [
      'move_forward_face',
      'move_forward_face',
      'move_forward_face',
      'move_forward_face',
      'attack_coordinated',
      'attack_coordinated',
      'attack_roguelike_basic',
      'attack_roguelike_basic',
      'attack_roguelike_basic',
      'attack_roguelike_basic',
      'move_tandem',
      'move_tandem',
    ],
    unitCounts: (n) => [
      { role: 'slime_grand', count: 1 },
      { role: 'slime_mid', count: Math.floor(n / 4) },
      { role: 'slime_small', count: Math.floor(n / 3) },
    ],
  },
  {
    id: 'trolls',
    name: 'Trolls',
    deck: () => [
      'move_forward_face',
      'move_forward_face',
      'move_forward_face',
      'attack_roguelike_slow',
      'attack_roguelike_slow',
      'attack_roguelike_slow',
      'attack_roguelike_slow',
      'attack_roguelike_stomp',
      'attack_roguelike_stomp',
      'attack_roguelike_stomp',
    ],
    unitCounts: (n) => [{ role: 'troll', count: 2 + Math.floor(n / 5) }],
  },
  {
    id: 'wolf_pack',
    name: 'Wolf Pack',
    deck: () => [
      'move_forward',
      'move_forward',
      'move_forward',
      'move_forward',
      'attack_roguelike_basic',
      'attack_roguelike_basic',
      'attack_roguelike_basic',
      'attack_roguelike_basic',
      'attack_roguelike_pack_hunt',
      'attack_roguelike_pack_hunt',
      'spell_roguelike_mark',
      'spell_roguelike_mark',
    ],
    unitCounts: () => [
      { role: 'alpha_wolf', count: 1 },
      { role: 'wolf', count: 4 },
    ],
  },
  {
    id: 'ice_spirits',
    name: 'Ice Spirits',
    deck: () => [
      'attack_ice_bolt',
      'attack_ice_bolt',
      'attack_ice_bolt',
      'attack_ice_bolt',
      'spell_blizzard',
      'move_forward',
      'move_forward',
      'move_forward',
      'move_forward',
      'reinforce_roguelike_split',
    ],
    unitCounts: () => [{ role: 'ice_spirit', count: 3 }],
  },
  {
    id: 'fire_spirits',
    name: 'Fire Spirits',
    deck: () => [
      'attack_fireball',
      'attack_fireball',
      'attack_line',
      'attack_line',
      'spell_meteor',
      'move_forward',
      'move_forward',
      'move_any',
      'move_any',
      'reinforce_roguelike_split',
    ],
    unitCounts: () => [{ role: 'fire_spirit', count: 3 }],
  },
  {
    id: 'lightning_spirits',
    name: 'Lightning Spirits',
    deck: () => [
      'attack_chain_lightning',
      'attack_chain_lightning',
      'attack_chain_lightning',
      'attack_chain_lightning',
      'spell_roguelike_thunderstorm',
      'move_forward',
      'move_forward',
      'move_forward',
      'move_forward',
      'reinforce_roguelike_split',
    ],
    unitCounts: () => [{ role: 'lightning_spirit', count: 3 }],
  },
  {
    id: 'bandits',
    name: 'Bandits',
    deck: () => [
      'move_forward',
      'move_forward',
      'move_forward',
      'move_any',
      'move_any',
      'move_any',
      'move_pivot',
      'move_pivot',
      'move_double_steps',
      'move_double_steps',
      'attack_fwd_lr',
      'attack_fwd_lr',
      'attack_arrow',
      'attack_arrow',
      'attack_charge',
      'attack_whirlwind',
      'attack_blade_dance',
      'attack_execute',
      'reinforce_boost',
      'reinforce_boost',
      'spell_snare',
      'attack_jab',
      'attack_jab',
      'attack_shove',
    ],
    unitCounts: () => [{ role: 'bandit', count: 5 }],
  },
  {
    id: 'necromancer',
    name: 'Necromancer',
    deck: () => [
      'spell_roguelike_raise',
      'spell_roguelike_raise',
      'attack_ice_bolt',
      'attack_ice_bolt',
      'attack_coordinated',
      'attack_roguelike_basic',
      'attack_roguelike_basic',
      'move_tandem',
      'move_any',
      'move_any',
      'move_any',
      'move_forward',
      'move_forward',
      'spell_brain_freeze',
    ],
    unitCounts: (n) => [
      { role: 'necromancer', count: 1 },
      { role: ['skeleton_soldier', 'skeleton_warrior', 'skeleton_mage'], count: 2 + Math.floor(n / 4), isMinion: true },
    ],
  },
]
const ROGUELIKE_ENCOUNTER_ID_SET = new Set<RoguelikeEncounterId>(
  ROGUELIKE_ENCOUNTER_DEFS.map((encounter) => encounter.id)
)

function isRoguelikeEncounterId(value: unknown): value is RoguelikeEncounterId {
  return typeof value === 'string' && ROGUELIKE_ENCOUNTER_ID_SET.has(value as RoguelikeEncounterId)
}

let roguelikeRun: RoguelikeRunState | null = null

type LocalMatchTelemetryState = {
  matchId: string
  mode: 'local' | 'bot'
  startedAt: number
  playedCards: [CardDefId[], CardDefId[]]
  unplayedHandCards: [CardDefId[], CardDefId[]]
  enqueued: boolean
  allowSubmission: boolean
}

let localTelemetry: LocalMatchTelemetryState = createLocalTelemetryState('local')
let pendingTelemetryQueue: MatchTelemetrySubmission[] = restorePendingTelemetryQueue()
let telemetryUploadInFlight = false

isInitialized = true

type Screen = 'menu' | 'tutorial_hub' | 'loadout' | 'settings' | 'game'

const tutorialController = new TutorialController(TUTORIAL_LESSONS, loadTutorialProgress())
const TUTORIAL_RETURN_SNAPSHOT_STORAGE_KEY = 'untitled_game_tutorial_return_snapshot_v1'

let screen: Screen = 'menu'
let loadoutPlayer: PlayerId = 0
let loadoutFilter: 'all' | CardType = 'all'
let loadoutSortMode: 'type' | 'name' = 'type'
let loadoutFiltersExpanded = false
let tutorialOnlineDemo: TutorialOnlineDemoData | null = null
let lastTutorialUiKey: string | null = null

const layout = {
  size: 36,
  origin: { x: 60, y: 60 },
  centers: new Map<string, { x: number; y: number }>(),
  width: 800,
  height: 520,
}

const BOARD_TILT = 0.73
const TILE_IMAGE_SCALE = 1.55 * 1.35
const TILE_ANCHOR_Y = 0.5
const TILE_GAP = 0.6
const BUILDING_IMAGE_SCALE = 1.8
const BUILDING_ANCHOR_Y = 0.7
const SPAWN_IMAGE_SCALE = BUILDING_IMAGE_SCALE * 1.5
const SPAWN_ANCHOR_Y = BUILDING_ANCHOR_Y - 0.08
const UNIT_IMAGE_SCALE = 1.1 * 1.7
const LEADER_IMAGE_SCALE = 1.1 * 2
const PLAYER_PORTRAIT_ART_SCALE = 2.5
const PLAYER_PORTRAIT_ART_ANCHOR_Y = 0.5
const PLAYER_PORTRAIT_ART_OFFSET_Y = -0.02
const UNIT_ANCHOR_Y = 0.78
const BARRICADE_IMAGE_SCALE = UNIT_IMAGE_SCALE * 0.74 * 1.3
const BARRICADE_ANCHOR_Y = UNIT_ANCHOR_Y - 0.2
const GHOST_ALPHA = 0.6

type SeedPayload = {
  settings: GameSettings
  loadouts: { p1: CardDefId[]; p2: CardDefId[] }
  playerClasses?: PlayerClasses
}

type PersistedProgress = {
  version: 1 | 2 | 3 | 4 | 5
  screen: Screen
  localMode?: 'local' | 'bot' | 'roguelike'
  gameSettings: GameSettings
  loadouts: { p1: CardDefId[]; p2: CardDefId[] }
  playerClasses?: PlayerClasses
  state: GameState
  planningPlayer: PlayerId
  selectedCardId: string | null
  pendingOrder: { cardId: string; params: OrderParams } | null
  boardZoom: number
  boardPan: { x: number; y: number }
  roguelikeRun?: RoguelikeRunState | null
}

type TutorialReturnSnapshot = {
  hadProgress: boolean
  progress: PersistedProgress | null
}

type PersistedOnlineSession = {
  version: number
  roomCode: string
  seatToken: string
}

const PROGRESS_STORAGE_KEY = 'untitled_game_progress_v1'
const PROGRESS_SAVE_DEBOUNCE_MS = 250
const TELEMETRY_QUEUE_STORAGE_KEY = 'untitled_game_telemetry_queue_v1'
let progressSaveTimer: number | null = null

function normalizeDeckInput(input: unknown): CardDefId[] {
  if (!Array.isArray(input)) return []
  return input.filter((id): id is CardDefId => typeof id === 'string' && id in CARD_DEFS)
}

function normalizePlayerClassInput(input: unknown, fallback: PlayerClassId = DEFAULT_PLAYER_CLASSES.p1): PlayerClassId {
  return isPlayerClassId(input) ? input : fallback
}

function normalizePlayerClassesInput(input: unknown): PlayerClasses {
  if (!input || typeof input !== 'object') return { ...DEFAULT_PLAYER_CLASSES }
  const source = input as Partial<PlayerClasses>
  return {
    p1: normalizePlayerClassInput(source.p1, DEFAULT_PLAYER_CLASSES.p1),
    p2: normalizePlayerClassInput(source.p2, DEFAULT_PLAYER_CLASSES.p2),
  }
}

function getLoadoutClass(player: PlayerId): PlayerClassId {
  return getPlayerClassForSeat(playerClasses, player)
}

function setLoadoutClass(player: PlayerId, classId: PlayerClassId): void {
  if (player === 0) {
    playerClasses.p1 = classId
  } else {
    playerClasses.p2 = classId
  }
}

function sanitizeDeckForCurrentClass(
  deck: CardDefId[],
  classId: PlayerClassId,
  enforceClassRestrictions = true,
  maxSize: number | null = gameSettings.deckSize
): CardDefId[] {
  const counts: Partial<Record<CardDefId, number>> = {}
  const filtered: CardDefId[] = []
  for (const cardId of deck) {
    if (enforceClassRestrictions && !isCardAllowedForClass(cardId, classId)) continue
    const currentCount = counts[cardId] ?? 0
    if (currentCount >= gameSettings.maxCopies) continue
    filtered.push(cardId)
    counts[cardId] = currentCount + 1
    if (typeof maxSize === 'number' && filtered.length >= maxSize) break
  }
  return filtered
}

function getLoadoutDeckMaxSize(modeValue: PlayMode = mode): number | null {
  return modeValue === 'roguelike' ? null : gameSettings.deckSize
}

function sanitizeLoadoutsForCurrentClasses(options: { enforceClassRestrictions?: boolean } = {}): void {
  const enforceClassRestrictions = options.enforceClassRestrictions ?? true
  const maxSize = getLoadoutDeckMaxSize()
  loadouts.p1 = sanitizeDeckForCurrentClass(loadouts.p1, playerClasses.p1, enforceClassRestrictions, maxSize)
  loadouts.p2 = sanitizeDeckForCurrentClass(loadouts.p2, playerClasses.p2, enforceClassRestrictions, maxSize)
}

function getTutorialSession() {
  return tutorialController.getSession()
}

function isTutorialLessonActive(lessonId?: TutorialLessonId): boolean {
  const session = getTutorialSession()
  if (!session) return false
  return lessonId ? session.lessonId === lessonId : true
}

function isTutorialHubVisible(): boolean {
  return screen === 'tutorial_hub'
}

function shouldSuspendLocalPersistence(): boolean {
  return isTutorialLessonActive() || isTutorialHubVisible()
}

function isBotControlledMode(modeValue: PlayMode = mode): boolean {
  return modeValue === 'bot' || modeValue === 'roguelike'
}

function getPersistedLocalMode(modeValue: PlayMode): Exclude<PersistedProgress['localMode'], undefined> {
  if (modeValue === 'bot') return 'bot'
  if (modeValue === 'roguelike') return 'roguelike'
  return 'local'
}

function getLocalTelemetryMode(modeValue: PlayMode): 'local' | 'bot' {
  return modeValue === 'bot' || modeValue === 'roguelike' ? 'bot' : 'local'
}

function createInitialRoguelikeRunState(playerClass: PlayerClassId = playerClasses.p1): RoguelikeRunState {
  const normalizedClass = normalizePlayerClassInput(playerClass, DEFAULT_PLAYER_CLASSES.p1)
  return {
    wins: 0,
    leaderHp: ROGUELIKE_STARTING_LEADER_HP,
    deck: sanitizeDeckForCurrentClass([...ROGUELIKE_STARTING_DECK], normalizedClass, true, null),
    playerClass: normalizedClass,
    bonusDrawPerTurn: 0,
    bonusActionBudget: 0,
    bonusStartingUnits: 0,
    bonusStartingUnitStrength: 0,
    resultHandled: false,
    uiStage: 'reward_choice',
    draftOptions: [],
    pendingRandomReward: null,
    rewardNoticeMessage: null,
    currentEncounterId: null,
    currentMatchNumber: 1,
  }
}

function normalizeLeaderUnitReference(unitId: string): string {
  return unitId.startsWith('stronghold-') ? `leader-${unitId.slice('stronghold-'.length)}` : unitId
}

function normalizeGameSettingsInput(input: unknown): GameSettings {
  if (!input || typeof input !== 'object') return { ...DEFAULT_SETTINGS }
  const source = input as Partial<GameSettings> & { strongholdStrength?: unknown }
  const { strongholdStrength: _legacyStrongholdStrength, ...rest } = source
  const leaderStrength = Number(source.leaderStrength ?? source.strongholdStrength)
  return {
    ...DEFAULT_SETTINGS,
    ...rest,
    leaderStrength: Number.isFinite(leaderStrength) ? leaderStrength : DEFAULT_SETTINGS.leaderStrength,
  }
}

function normalizeOrderParamsLeaderReferences(params: OrderParams): OrderParams {
  return {
    ...params,
    unitId: params.unitId ? normalizeLeaderUnitReference(params.unitId) : undefined,
    unitId2: params.unitId2 ? normalizeLeaderUnitReference(params.unitId2) : undefined,
  }
}

function normalizeRoguelikeRewardInput(input: unknown): RoguelikeRandomReward | null {
  const rewardKey = input === 'strongholdHp' ? 'leaderHp' : input
  return typeof rewardKey === 'string' && rewardKey in ROGUELIKE_RANDOM_REWARD_WEIGHTS
    ? (rewardKey as RoguelikeRandomReward)
    : null
}

function normalizeRoguelikeRunInput(input: unknown): RoguelikeRunState | null {
  if (!input || typeof input !== 'object') return null
  const source = input as Partial<RoguelikeRunState> & { strongholdHp?: unknown }
  const playerClass = normalizePlayerClassInput(source.playerClass, playerClasses.p1)
  const deck = sanitizeDeckForCurrentClass(normalizeDeckInput(source.deck), playerClass, true, null)
  const uiStage =
    source.uiStage === 'reward_choice' ||
    source.uiStage === 'reward_notice' ||
    source.uiStage === 'remove_choice' ||
    source.uiStage === 'run_over'
      ? source.uiStage
      : 'reward_choice'
  const pendingRandomReward = normalizeRoguelikeRewardInput(source.pendingRandomReward)
  const currentEncounterId = isRoguelikeEncounterId(source.currentEncounterId) ? source.currentEncounterId : null
  const currentMatchNumber = Math.max(1, Math.floor(Number(source.currentMatchNumber) || 1))

  return {
    wins: Math.max(0, Math.floor(Number(source.wins) || 0)),
    leaderHp: Math.max(1, Math.floor(Number(source.leaderHp ?? source.strongholdHp) || ROGUELIKE_STARTING_LEADER_HP)),
    deck:
      deck.length > 0
        ? deck
        : sanitizeDeckForCurrentClass([...ROGUELIKE_STARTING_DECK], playerClass, true, null),
    playerClass,
    bonusDrawPerTurn: Math.max(0, Math.floor(Number(source.bonusDrawPerTurn) || 0)),
    bonusActionBudget: Math.max(0, Math.floor(Number(source.bonusActionBudget) || 0)),
    bonusStartingUnits: Math.max(0, Math.floor(Number(source.bonusStartingUnits) || 0)),
    bonusStartingUnitStrength: Math.max(0, Math.floor(Number(source.bonusStartingUnitStrength) || 0)),
    resultHandled: Boolean(source.resultHandled),
    uiStage,
    draftOptions: sanitizeDeckForCurrentClass(normalizeDeckInput(source.draftOptions), playerClass, true, null).slice(0, 3),
    pendingRandomReward,
    rewardNoticeMessage: typeof source.rewardNoticeMessage === 'string' ? source.rewardNoticeMessage : null,
    currentEncounterId,
    currentMatchNumber,
  }
}

function scheduleProgressSave(): void {
  if (mode === 'online' || shouldSuspendLocalPersistence()) return
  if (progressSaveTimer !== null) {
    window.clearTimeout(progressSaveTimer)
  }
  progressSaveTimer = window.setTimeout(() => {
    progressSaveTimer = null
    persistProgressNow()
  }, PROGRESS_SAVE_DEBOUNCE_MS)
}

function cloneRoguelikeRunState(source: RoguelikeRunState | null): RoguelikeRunState | null {
  if (!source) return null
  return {
    ...source,
    deck: [...source.deck],
    draftOptions: [...source.draftOptions],
  }
}

function buildPersistedProgressPayload(screenOverride: Screen = screen): PersistedProgress {
  return {
    version: 5,
    screen: screenOverride,
    localMode: getPersistedLocalMode(mode),
    gameSettings: { ...gameSettings },
    loadouts: {
      p1: [...loadouts.p1],
      p2: [...loadouts.p2],
    },
    playerClasses: { ...playerClasses },
    state: cloneGameState(state),
    planningPlayer,
    selectedCardId,
    pendingOrder: pendingOrder
      ? {
          cardId: pendingOrder.cardId,
          params: normalizeOrderParamsLeaderReferences(pendingOrder.params),
        }
      : null,
    boardZoom,
    boardPan: { ...boardPan },
    roguelikeRun: mode === 'roguelike' ? cloneRoguelikeRunState(roguelikeRun) : null,
  }
}

function persistProgressNow(): void {
  if (mode === 'online' || shouldSuspendLocalPersistence()) return
  try {
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(buildPersistedProgressPayload()))
  } catch {
    // Ignore storage write issues (quota/private mode/etc).
  }
}

function applyPersistedProgressPayload(parsed: Partial<PersistedProgress>): Screen | null {
  if (
    parsed.version !== 1 &&
    parsed.version !== 2 &&
    parsed.version !== 3 &&
    parsed.version !== 4 &&
    parsed.version !== 5
  ) {
    return null
  }
  if (!parsed.state || !Array.isArray(parsed.state.tiles) || !Array.isArray(parsed.state.players)) return null
  if (!parsed.gameSettings || !parsed.loadouts) return null

  gameSettings = normalizeGameSettingsInput(parsed.gameSettings)
  playerClasses =
    parsed.version === 4 || parsed.version === 5 ? normalizePlayerClassesInput(parsed.playerClasses) : { ...DEFAULT_PLAYER_CLASSES }
  loadouts = {
    p1: normalizeDeckInput(parsed.loadouts.p1),
    p2: normalizeDeckInput(parsed.loadouts.p2),
  }
  sanitizeLoadoutsForCurrentClasses()
  state = parsed.state as GameState
  normalizeLeaderUnitsInState(state)
  suppressWinnerModalForRestoredOutcome = state.winner !== null
  planningPlayer = parsed.planningPlayer === 1 ? 1 : 0
  selectedCardId = typeof parsed.selectedCardId === 'string' ? parsed.selectedCardId : null
  pendingOrder =
    parsed.pendingOrder &&
    typeof parsed.pendingOrder.cardId === 'string' &&
    parsed.pendingOrder.params &&
    typeof parsed.pendingOrder.params === 'object'
      ? { cardId: parsed.pendingOrder.cardId, params: normalizeOrderParamsLeaderReferences(parsed.pendingOrder.params) }
      : null

  if (typeof parsed.boardZoom === 'number') {
    boardZoom = clamp(parsed.boardZoom, MIN_BOARD_ZOOM, MAX_BOARD_ZOOM)
  }
  if (parsed.boardPan && typeof parsed.boardPan.x === 'number' && typeof parsed.boardPan.y === 'number') {
    boardPan.x = parsed.boardPan.x
    boardPan.y = parsed.boardPan.y
  }

  const candidateScreen = parsed.screen
  const restoredScreen: Screen =
    candidateScreen === 'menu' ||
    candidateScreen === 'tutorial_hub' ||
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

  roguelikeRun = null
  if (restoredScreen === 'tutorial_hub') {
    applyPlayMode('tutorial')
  } else if ((parsed.version === 2 || parsed.version === 3 || parsed.version === 4 || parsed.version === 5) && parsed.localMode === 'bot') {
    applyPlayMode('bot')
    planningPlayer = BOT_HUMAN_PLAYER
  } else if ((parsed.version === 3 || parsed.version === 4 || parsed.version === 5) && parsed.localMode === 'roguelike') {
    const restoredRun = normalizeRoguelikeRunInput(parsed.roguelikeRun)
    if (restoredRun) {
      roguelikeRun = restoredRun
      playerClasses.p1 = restoredRun.playerClass
      applyPlayMode('roguelike')
      planningPlayer = BOT_HUMAN_PLAYER
    } else {
      applyPlayMode('local')
    }
  } else {
    applyPlayMode('local')
  }

  tutorialOnlineDemo = null
  lastObservedTurn = state.turn
  lastObservedWinner = state.winner
  lastObservedRoguelikeRewardVisible = false
  if (state.winner !== null) {
    markLocalTelemetryAsRestoredOutcome()
  } else {
    resetLocalTelemetryForCurrentMatch()
  }

  return restoredScreen
}

function restoreProgressFromStorage(): Screen | null {
  try {
    const raw = localStorage.getItem(PROGRESS_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedProgress>
    return applyPersistedProgressPayload(parsed)
  } catch {
    return null
  }
}

function persistTutorialProgress(): void {
  saveTutorialProgress(tutorialController.getProgress())
}

function clearTutorialFeedback(): void {
  tutorialPanelFeedbackEl.textContent = ''
}

function setTutorialFeedback(message: string): void {
  tutorialPanelFeedbackEl.textContent = message
  if (screen === 'game') {
    statusEl.textContent = message
  } else if (screen === 'menu') {
    onlineStatusEl.textContent = message
  }
}

function persistTutorialReturnSnapshot(): void {
  try {
    const snapshot: TutorialReturnSnapshot = {
      hadProgress: true,
      progress: buildPersistedProgressPayload(),
    }
    localStorage.setItem(TUTORIAL_RETURN_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // Ignore storage failures.
  }
}

function clearTutorialReturnSnapshot(): void {
  try {
    localStorage.removeItem(TUTORIAL_RETURN_SNAPSHOT_STORAGE_KEY)
  } catch {
    // Ignore storage failures.
  }
}

function restoreTutorialReturnSnapshot(): void {
  try {
    const raw = localStorage.getItem(TUTORIAL_RETURN_SNAPSHOT_STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Partial<TutorialReturnSnapshot>
    if (!parsed.hadProgress || !parsed.progress) return
    applyPersistedProgressPayload(parsed.progress)
  } catch {
    // Ignore restore failures.
  }
}

function getDefaultSocketUrl(): string {
  const configured = (import.meta.env as Record<string, string | boolean | undefined>).VITE_WS_URL
  if (typeof configured === 'string' && configured.length > 0) return configured
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${window.location.host}/ws`
}

function createLocalTelemetryState(modeValue: 'local' | 'bot', now = Date.now()): LocalMatchTelemetryState {
  return {
    matchId: createMatchId(now),
    mode: modeValue,
    startedAt: now,
    playedCards: [[], []],
    unplayedHandCards: [[], []],
    enqueued: false,
    allowSubmission: true,
  }
}

function resetLocalTelemetryForCurrentMatch(now = Date.now()): void {
  if (mode === 'online' || isTutorialLessonActive()) return
  localTelemetry = createLocalTelemetryState(getLocalTelemetryMode(mode), now)
}

function markLocalTelemetryAsRestoredOutcome(): void {
  if (mode === 'online' || isTutorialLessonActive()) return
  localTelemetry = createLocalTelemetryState(getLocalTelemetryMode(mode))
  localTelemetry.allowSubmission = false
}

function recordActionQueueTelemetry(sourceState: GameState): void {
  if (mode === 'online' || isTutorialLessonActive()) return
  sourceState.actionQueue.forEach((order) => {
    localTelemetry.playedCards[order.player].push(order.defId)
  })
}

function recordUnplayedHandTelemetry(sourceState: GameState): void {
  if (mode === 'online' || isTutorialLessonActive()) return
  localTelemetry.unplayedHandCards[0].push(...sourceState.players[0].hand.map((card) => card.defId))
  localTelemetry.unplayedHandCards[1].push(...sourceState.players[1].hand.map((card) => card.defId))
}

function trySubmitLocalTelemetryIfNeeded(): void {
  if (mode === 'online' || isTutorialLessonActive()) return
  if (state.winner === null) return
  if (localTelemetry.enqueued || !localTelemetry.allowSubmission) return
  const submission = buildLocalMatchTelemetrySubmission()
  if (!submission) return
  localTelemetry.enqueued = true
  enqueuePendingTelemetrySubmission(submission)
  void flushPendingTelemetryQueue()
}

function buildLocalMatchTelemetrySubmission(now = Date.now()): MatchTelemetrySubmission | null {
  if (mode === 'online' || isTutorialLessonActive()) return null
  return {
    schemaVersion: 1,
    matchId: localTelemetry.matchId,
    mode: localTelemetry.mode,
    startedAt: localTelemetry.startedAt,
    endedAt: now,
    winner: state.winner,
    endReason: 'victory',
    settings: { ...state.settings },
    players: [
      {
        seat: 0,
        decklist: [...loadouts.p1],
        cardsPlayed: [...localTelemetry.playedCards[0]],
        cardsInHandNotPlayed: [
          ...localTelemetry.unplayedHandCards[0],
          ...state.players[0].hand.map((card) => card.defId),
        ],
      },
      {
        seat: 1,
        decklist: [...loadouts.p2],
        cardsPlayed: [...localTelemetry.playedCards[1]],
        cardsInHandNotPlayed: [
          ...localTelemetry.unplayedHandCards[1],
          ...state.players[1].hand.map((card) => card.defId),
        ],
      },
    ],
  }
}

async function postLocalMatchTelemetry(submission: MatchTelemetrySubmission): Promise<boolean> {
  const endpoint = getTelemetryEndpointUrl()
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submission),
      keepalive: true,
    })
    return response.ok
  } catch {
    // Local/bot games should still complete even if telemetry server is unavailable.
    return false
  }
  return false
}

function getTelemetryEndpointUrl(): string {
  try {
    const socketUrl = new URL(getDefaultSocketUrl(), window.location.href)
    const protocol = socketUrl.protocol === 'wss:' ? 'https:' : 'http:'
    return `${protocol}//${socketUrl.host}/telemetry/match`
  } catch {
    return '/telemetry/match'
  }
}

function createMatchId(now = Date.now()): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }
  const random = Math.random().toString(36).slice(2, 12)
  return `local_${now.toString(36)}_${random}`
}

function restorePendingTelemetryQueue(): MatchTelemetrySubmission[] {
  try {
    const raw = localStorage.getItem(TELEMETRY_QUEUE_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isTelemetrySubmission)
  } catch {
    return []
  }
}

function persistPendingTelemetryQueue(): void {
  try {
    localStorage.setItem(TELEMETRY_QUEUE_STORAGE_KEY, JSON.stringify(pendingTelemetryQueue))
  } catch {
    // Ignore storage write issues.
  }
}

function enqueuePendingTelemetrySubmission(submission: MatchTelemetrySubmission): void {
  pendingTelemetryQueue.push(submission)
  persistPendingTelemetryQueue()
}

async function flushPendingTelemetryQueue(): Promise<void> {
  if (telemetryUploadInFlight) return
  if (pendingTelemetryQueue.length === 0) return
  telemetryUploadInFlight = true
  try {
    while (pendingTelemetryQueue.length > 0) {
      const current = pendingTelemetryQueue[0]
      const posted = await postLocalMatchTelemetry(current)
      if (!posted) break
      pendingTelemetryQueue.shift()
      persistPendingTelemetryQueue()
    }
  } finally {
    telemetryUploadInFlight = false
  }
}

function isTelemetrySubmission(value: unknown): value is MatchTelemetrySubmission {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<MatchTelemetrySubmission>
  if (candidate.schemaVersion !== 1) return false
  if (typeof candidate.matchId !== 'string' || candidate.matchId.length === 0) return false
  if (candidate.mode !== 'local' && candidate.mode !== 'bot' && candidate.mode !== 'online') return false
  if (typeof candidate.startedAt !== 'number' || typeof candidate.endedAt !== 'number') return false
  if (candidate.winner !== null && candidate.winner !== 0 && candidate.winner !== 1) return false
  if (typeof candidate.endReason !== 'string' || candidate.endReason.length === 0) return false
  if (!candidate.settings || typeof candidate.settings !== 'object') return false
  if (!Array.isArray(candidate.players) || candidate.players.length !== 2) return false
  return true
}

function setOnlineStatus(message: string): void {
  onlineStatusEl.textContent = message
}

function setOnlineLinks(message: string): void {
  onlineLinksEl.textContent = message
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

  const note = document.createElement('div')
  note.className = 'online-invite-note'
  note.textContent = 'Scan the QR code with your phone camera, or copy the invite link.'

  try {
    const qr = document.createElement('img')
    qr.className = 'online-invite-qr'
    qr.alt = `QR code for Player ${opponentSeat + 1} invite`
    qr.loading = 'lazy'
    qr.src = createQrSvgDataUrl(opponentLink)
    container.appendChild(qr)
  } catch {
    note.textContent = 'QR could not be generated locally for this link. Copy the invite link instead.'
  }

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
      playerClass: onlinePendingAction.playerClass,
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

function invalidateBotPlanning(): void {
  botPlanToken += 1
  botThinking = false
}

function isBotPlanningLocked(): boolean {
  return isBotControlledMode() && botThinking
}

function applyPlayMode(next: PlayMode): void {
  const previousMode = mode
  invalidateBotPlanning()
  if (isBotControlledMode(next)) {
    planningPlayer = BOT_HUMAN_PLAYER
  }
  mode = next
  if (previousMode === 'roguelike' && next !== 'roguelike') {
    roguelikeRun = null
    winnerExtraEl.innerHTML = ''
  }
  if (next !== 'online') {
    resetLocalTelemetryForCurrentMatch()
  }
  resetCardVisualState()
}

function resetCardVisualState(): void {
  hiddenCardIds.clear()
  resolvingOrderIdsHidden.clear()
  pendingCardTransfer = null
  onlineResolutionReplay = null
  clearOverlayClone()
  suppressOverlayUntil = 0
}

function teardownOnlineSession(clearStoredSession: boolean): void {
  clearOnlineReconnectTimer()
  onlinePendingAction = null
  onlineLastJoinPayload = null
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
    const reconnectSeat = session.seat
    const reconnectLoadout = reconnectSeat === 0 ? [...loadouts.p1] : [...loadouts.p2]
    const reconnectClass = reconnectSeat === 0 ? playerClasses.p1 : playerClasses.p2
    onlineLastJoinPayload = {
      loadout: reconnectLoadout,
      playerClass: reconnectClass,
    }
    onlinePendingAction = {
      type: 'join',
      roomCode: session.roomCode,
      seatToken: session.seatToken,
      loadout: reconnectLoadout,
      playerClass: reconnectClass,
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
  onlineLastJoinPayload = null
  onlineAutoEnterGameOnJoin = false
  onlineRouteToLoadoutOnJoin = false
  onlineRematchRequested = false
  const setup: RoomSetup = {
    settings: { ...gameSettings },
    loadouts: {
      p1: [...loadouts.p1],
      p2: [...STARTING_DECK],
    },
    playerClasses: {
      p1: playerClasses.p1,
      p2: DEFAULT_PLAYER_CLASSES.p2,
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
  const joinLoadout = [...loadouts.p1]
  const joinClass = playerClasses.p1
  onlineLastJoinPayload = {
    loadout: joinLoadout,
    playerClass: joinClass,
  }
  applyPlayMode('online')
  onlinePendingAction = {
    type: 'join',
    roomCode: roomCode.trim().toUpperCase(),
    seatToken: seatToken.trim(),
    loadout: joinLoadout,
    playerClass: joinClass,
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
  const selfSeat = onlineSession.seat
  const selfLoadout = selfSeat === 0 ? [...loadouts.p1] : [...loadouts.p2]
  const selfClass = selfSeat === 0 ? playerClasses.p1 : playerClasses.p2
  sendOnlineCommand({
    type: 'update_loadout',
    loadout: selfLoadout,
    playerClass: selfClass,
  })
  statusEl.textContent = state.winner !== null ? 'Deck saved.' : 'Deck submitted. Entering match...'
  if (state.winner !== null) {
    setOnlineStatus('Deck updated for rematch.')
  }
  setScreen('game')
}

function requestOnlineRematch(): void {
  if (mode !== 'online' || !onlineSession) return
  const selfSeat = onlineSession.seat
  const selfLoadout = selfSeat === 0 ? [...loadouts.p1] : [...loadouts.p2]
  const selfClass = selfSeat === 0 ? playerClasses.p1 : playerClasses.p2
  sendOnlineCommand({
    type: 'update_loadout',
    loadout: selfLoadout,
    playerClass: selfClass,
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
      modifiers: clonePlayerModifiers(view.players[0].modifiers),
    },
    {
      deck: [],
      hand: cloneCards(view.players[1].hand),
      discard: [],
      orders: cloneOrders(view.players[1].orders),
      modifiers: clonePlayerModifiers(view.players[1].modifiers),
    },
  ]

  const units: GameState['units'] = {}
  Object.entries(view.units).forEach(([id, unit]) => {
    units[id] = {
      ...unit,
      pos: { ...unit.pos },
      modifiers: unit.modifiers.map((modifier) => ({ ...modifier })),
    }
  })

  const mapped: GameState = {
    boardRows: view.boardRows,
    boardCols: view.boardCols,
    tiles: view.tiles.map((tile) => ({ ...tile })),
    units,
    traps: (view.traps ?? []).map((trap) => ({ ...trap, pos: { ...trap.pos } })),
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
    playerClasses: [view.playerClasses?.[0] ?? null, view.playerClasses?.[1] ?? null],
  }
  normalizeLeaderUnitsInState(mapped)
  return mapped
}

function normalizeLeaderUnitsInState(sourceState: GameState): void {
  sourceState.settings = normalizeGameSettingsInput(sourceState.settings)
  sourceState.tiles = Array.isArray(sourceState.tiles)
    ? sourceState.tiles.map((tile) => ({
        ...tile,
        id: typeof tile.id === 'string' ? tile.id : `${tile.q},${tile.r}`,
        q: Math.floor(tile.q),
        r: Math.floor(tile.r),
        kind: normalizeTileKindInput((tile as { kind?: unknown }).kind),
      }))
    : []
  const normalizedUnits: GameState['units'] = {}
  Object.entries(sourceState.units).forEach(([unitId, unit]) => {
    const normalizedUnitId = normalizeLeaderUnitReference(unitId)
    normalizedUnits[normalizedUnitId] = {
      ...unit,
      id: normalizeLeaderUnitReference(unit.id),
    }
  })
  sourceState.units = normalizedUnits
  sourceState.players.forEach((playerState) => {
    playerState.orders = playerState.orders.map((order) => ({
      ...order,
      params: normalizeOrderParamsLeaderReferences(order.params),
    }))
  })
  sourceState.actionQueue = sourceState.actionQueue.map((order) => ({
    ...order,
    params: normalizeOrderParamsLeaderReferences(order.params),
  }))
  const normalizedTraps = Array.isArray((sourceState as { traps?: unknown }).traps)
    ? (sourceState as { traps: unknown[] }).traps
        .filter((entry): entry is { id?: unknown; owner?: unknown; kind?: unknown; pos?: { q?: unknown; r?: unknown } } => {
          if (!entry || typeof entry !== 'object') return false
          const trap = entry as { owner?: unknown; kind?: unknown; pos?: { q?: unknown; r?: unknown } }
          if (trap.owner !== 0 && trap.owner !== 1) return false
          if (trap.kind !== 'pitfall' && trap.kind !== 'explosive') return false
          if (!trap.pos || typeof trap.pos.q !== 'number' || typeof trap.pos.r !== 'number') return false
          return Number.isFinite(trap.pos.q) && Number.isFinite(trap.pos.r)
        })
        .map((trap, index) => ({
          id: typeof trap.id === 'string' ? trap.id : `trap-restored-${index}`,
          owner: trap.owner as PlayerId,
          kind: trap.kind as 'pitfall' | 'explosive',
          pos: {
            q: Math.floor((trap.pos as { q: number }).q),
            r: Math.floor((trap.pos as { r: number }).r),
          },
        }))
    : []
  sourceState.traps = normalizedTraps
  if (!sourceState.playerClasses) {
    sourceState.playerClasses = [null, null]
  }
  if (!sourceState.leaderMovedLastTurn) {
    sourceState.leaderMovedLastTurn = [true, true]
  }
  if (!sourceState.archmageBonusApplied) {
    sourceState.archmageBonusApplied = [0, 0]
  }
  if (!sourceState.turnStartLeaderPositions) {
    sourceState.turnStartLeaderPositions = [
      { ...(sourceState.units['leader-0']?.pos ?? { q: -1, r: -1 }) },
      { ...(sourceState.units['leader-1']?.pos ?? { q: -1, r: -1 }) },
    ]
  }

  Object.values(sourceState.units).forEach((unit) => {
    const rawKind = (unit as { kind: string }).kind
    if (rawKind === 'stronghold' || rawKind === 'commander') {
      ;(unit as Unit).kind = 'leader'
    }
    if (unit.kind !== 'leader') return
    const leaderClass = sourceState.playerClasses?.[unit.owner] ?? null
    const hasSlow = unit.modifiers.some((modifier) => modifier.type === 'slow')
    const hasSpellResistance = unit.modifiers.some((modifier) => modifier.type === 'spellResistance')
    const hasReinforcementPenalty = unit.modifiers.some((modifier) => modifier.type === 'reinforcementPenalty')
    if (leaderClass === 'warleader') {
      unit.modifiers = unit.modifiers.filter((modifier) => modifier.type !== 'slow')
    } else if (!hasSlow) {
      unit.modifiers.unshift({ type: 'slow', turnsRemaining: 'indefinite' })
    }
    if (!hasSpellResistance) {
      unit.modifiers.unshift({ type: 'spellResistance', turnsRemaining: 'indefinite' })
    }
    if (!hasReinforcementPenalty) {
      unit.modifiers.unshift({ type: 'reinforcementPenalty', turnsRemaining: 'indefinite' })
    }
  })
  syncUnitState(sourceState)
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
      tile2: order.params.tile2 ? { ...order.params.tile2 } : undefined,
      tile3: order.params.tile3 ? { ...order.params.tile3 } : undefined,
    },
  }))
}

function clonePlayerModifiers(modifiers: PlayerModifier[] | null | undefined): PlayerModifier[] {
  if (!modifiers) return []
  return modifiers.map((modifier) => ({ ...modifier }))
}

function applyOnlineSnapshot(stateView: GameStateView, viewMeta: ViewMeta, presence: PresenceState): void {
  clearActionAnimationState()
  state = mapViewToState(stateView)
  gameSettings = { ...state.settings }
  resizeDecks(gameSettings.deckSize)
  enforceMaxCopies()
  planningPlayer = viewMeta.selfSeat
  loadoutPlayer = viewMeta.selfSeat
  playerClasses = {
    p1: normalizePlayerClassInput(state.playerClasses?.[0], DEFAULT_PLAYER_CLASSES.p1),
    p2: normalizePlayerClassInput(state.playerClasses?.[1], DEFAULT_PLAYER_CLASSES.p2),
  }
  sanitizeLoadoutsForCurrentClasses()
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
    if (onlineLastJoinPayload) {
      if (message.seat === 0) {
        loadouts.p1 = [...onlineLastJoinPayload.loadout]
        playerClasses.p1 = onlineLastJoinPayload.playerClass
      } else {
        loadouts.p2 = [...onlineLastJoinPayload.loadout]
        playerClasses.p2 = onlineLastJoinPayload.playerClass
      }
    }
    planningPlayer = message.seat
    loadoutPlayer = message.seat
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

function tryStartActionPhase(): boolean {
  if (state.ready[0] && state.ready[1]) {
    recordUnplayedHandTelemetry(state)
    startActionPhase(state)
    recordActionQueueTelemetry(state)
    selectedCardId = null
    pendingOrder = null
    statusEl.textContent = 'Action phase in progress.'
    render()
    return true
  }
  return false
}

function scheduleBotPlanningTurn(): void {
  if (!isBotControlledMode()) return
  if (state.phase !== 'planning') return
  if (!state.ready[BOT_HUMAN_PLAYER]) return
  const token = botPlanToken + 1
  botPlanToken = token
  botThinking = true

  window.setTimeout(() => {
    if (token !== botPlanToken) return
    if (!isBotControlledMode() || state.phase !== 'planning' || !state.ready[BOT_HUMAN_PLAYER]) {
      botThinking = false
      render()
      return
    }

    const botState = state.players[BOT_PLAYER]
    botState.orders = []
    state.ready[BOT_PLAYER] = false
    const plan = buildBotPlan(state, BOT_PLAYER, {
      thinkTimeMs: 50,
      beamWidth: 10,
      maxCandidatesPerCard: 12,
    })

    if (token !== botPlanToken) return
    if (!isBotControlledMode() || state.phase !== 'planning' || !state.ready[BOT_HUMAN_PLAYER]) {
      botThinking = false
      render()
      return
    }

    for (const order of plan.orders) {
      const queued = planOrder(state, BOT_PLAYER, order.cardId, order.params)
      if (!queued) break
    }

    setPlayerReady(BOT_PLAYER, true)
    botThinking = false
    statusEl.textContent = 'You are ready. Bot ready.'
    const actionPhaseStarted = tryStartActionPhase()
    if (actionPhaseStarted) {
      notifyTutorialEvent('action_phase_started', { turn: state.turn })
    }
    render()
  }, 0)
}

function resetGameState(statusMessage: string): void {
  if (mode === 'online') {
    statusEl.textContent = 'Reset is disabled in online matches.'
    return
  }
  if (mode === 'roguelike') {
    startNextRoguelikeMatch('Match restarted.')
    return
  }
  invalidateBotPlanning()
  resetCardVisualState()
  clearActionAnimationState()
  sanitizeLoadoutsForCurrentClasses()
  state = createStandardMatchState()
  resetLocalTelemetryForCurrentMatch()
  suppressWinnerModalForRestoredOutcome = false
  planningPlayer = isBotControlledMode() ? BOT_HUMAN_PLAYER : 0
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
  clearAnimationBoardSync()
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

function getCardVisualKey(cardEl: HTMLElement): string | null {
  const cardId = cardEl.dataset.cardId?.trim()
  if (!cardId) return null
  const orderId = cardEl.dataset.orderId?.trim()
  if (orderId) return `order:${orderId}`
  const layer = cardEl.dataset.cardLayer?.trim() ?? 'card'
  const cardDefId = cardEl.dataset.cardDefId?.trim()
  return cardDefId ? `${layer}:${cardId}::${cardDefId}` : `${layer}:${cardId}`
}

function getOverlaySourceKey(): string | null {
  return overlaySourceKey
}

function syncOverlayCloneCardStyle(clone: HTMLElement, sourceEl: HTMLElement): void {
  const sourceStyles = getComputedStyle(sourceEl)
  const cardTint =
    sourceEl.style.getPropertyValue('--card-tint').trim() ||
    sourceStyles.getPropertyValue('--card-tint').trim()
  if (cardTint) {
    clone.style.setProperty('--card-tint', cardTint)
  } else {
    clone.style.removeProperty('--card-tint')
  }
}

function findCardElementByIdentity(cardId: string, cardDefId: string | null, orderId: string | null): HTMLElement | null {
  if (orderId && orderId.length > 0) {
    const orderSelector = `[data-order-id="${orderId}"]`
    const exactOrder = handEl.querySelector<HTMLElement>(orderSelector) ?? ordersEl.querySelector<HTMLElement>(orderSelector)
    if (exactOrder) return exactOrder
  }
  const selector =
    cardDefId && cardDefId.length > 0
      ? `[data-card-id="${cardId}"][data-card-def-id="${cardDefId}"]`
      : `[data-card-id="${cardId}"]`
  const exact = handEl.querySelector<HTMLElement>(selector) ?? ordersEl.querySelector<HTMLElement>(selector)
  if (exact) return exact
  if (!cardDefId) return null
  const fallback = `[data-card-id="${cardId}"]`
  return handEl.querySelector<HTMLElement>(fallback) ?? ordersEl.querySelector<HTMLElement>(fallback)
}

function clearOverlayClone(): void {
  clearOverlayTimers()
  if (!overlayClone) return
  const clone = overlayClone
  const source = overlaySourceEl
  overlayShowSeq += 1
  overlayHideSeq += 1
  const hideSeq = overlayHideSeq
  overlaySourceKey = null
  overlaySourceId = null
  overlaySourceDefId = null
  overlaySourceOrderId = null
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
  overlaySourceKey = null
  overlaySourceId = null
  overlaySourceDefId = null
  overlaySourceOrderId = null
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
  const liveKeys = new Set<string>()
  elements.forEach((el) => {
    const key = getCardVisualKey(el)
    if (!key) return
    liveKeys.add(key)
    let clone = overlayClones.get(key)
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
      overlayClones.set(key, clone)
    } else {
      clone.className = `${el.className} card-overlay-clone`
      clone.innerHTML = el.innerHTML
      clone.dataset.cardLayer = 'overlay'
    }
    syncOverlayCloneCardStyle(clone, el)
    const rect = el.getBoundingClientRect()
    clone.style.left = `${rect.left}px`
    clone.style.top = `${rect.top}px`
    clone.style.width = `${rect.width}px`
    clone.style.height = `${rect.height}px`
  })

  overlayClones.forEach((clone, key) => {
    if (!liveKeys.has(key)) {
      if (clone.isConnected) clone.remove()
      overlayClones.delete(key)
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
  const cardId = sourceEl.dataset.cardId?.trim() ?? null
  const cardDefId = sourceEl.dataset.cardDefId?.trim() ?? null
  const cardOrderId = sourceEl.dataset.orderId?.trim() ?? null
  const cardKey = getCardVisualKey(sourceEl)
  if (!cardId || !cardKey) return
  if (performance.now() < suppressOverlayUntil) return
  if (hiddenCardIds.has(cardId)) return
  const sourceKey = getOverlaySourceKey()
  if (overlayLocked && sourceKey === cardKey) {
    return
  }
  overlayHideSeq += 1
  overlayShowSeq += 1
  const showSeq = overlayShowSeq

  if (overlayClone && sourceKey === cardKey) {
    if (!overlaySourceEl || !overlaySourceEl.isConnected) {
      clearOverlayClone()
    } else {
      overlayLocked = lock
      const rect = sourceEl.getBoundingClientRect()
      syncOverlayCloneCardStyle(overlayClone, sourceEl)
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
    const currentSourceKey = getOverlaySourceKey()
    if (overlayClone && currentSourceKey && currentSourceKey !== cardKey) {
      animateOverlayCloneOut(overlayClone)
    } else {
      hardResetOverlayClone()
    }
  }
  let clone = overlayClones.get(cardKey)
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
    overlayClones.set(cardKey, clone)
  } else {
    clone.className = `${sourceEl.className} card-overlay-clone`
    clone.innerHTML = sourceEl.innerHTML
    clone.dataset.cardLayer = 'overlay'
    clone.style.opacity = '0'
    clone.style.transform = 'scale(1)'
    clone.style.transition = 'none'
    clone.style.visibility = 'hidden'
  }
  syncOverlayCloneCardStyle(clone, sourceEl)
  clone.style.display = 'none'
  overlayClone = clone

  const applyPhase = (activeClone: HTMLElement) => {
    activeClone.style.transition = 'transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity 120ms ease'
    activeClone.style.opacity = '1'
    activeClone.style.visibility = 'visible'
  }

  overlaySourceKey = cardKey
  overlaySourceId = cardId
  overlaySourceDefId = cardDefId
  overlaySourceOrderId = cardOrderId
  overlaySourceEl = sourceEl
  overlayLocked = lock
  overlaySourceVisibility = sourceEl.style.opacity
  overlaySourceTransition = sourceEl.style.transition

  const start = (activeClone: HTMLElement) => {
    const isCurrentSource = () => getOverlaySourceKey() === cardKey
    const settle = (attempt = 0) => {
      if (showSeq !== overlayShowSeq || !isCurrentSource()) return
      const rectA = sourceEl.getBoundingClientRect()
      window.requestAnimationFrame(() => {
        if (showSeq !== overlayShowSeq || !isCurrentSource()) return
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
          if (showSeq !== overlayShowSeq || !isCurrentSource()) return
          activeClone.style.transform = 'scale(1.5)'
          window.requestAnimationFrame(() => {
            if (showSeq !== overlayShowSeq || !isCurrentSource()) return
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
  if (cardReorderDrag) {
    if (hoverCardKey && !overlayLocked) {
      hoverCardKey = null
      clearOverlayClone()
    }
    return
  }
  if (performance.now() < suppressOverlayUntil) return
  if (hiddenCardIds.size > 0) return
  const el = document.elementFromPoint(lastPointer.x, lastPointer.y) as HTMLElement | null
  const hoveredEl = el?.closest<HTMLElement>('.card[data-card-id]')
  const cardEl = hoveredEl?.classList.contains('hidden-card') ? null : hoveredEl
  let cardKey = cardEl ? getCardVisualKey(cardEl) : null

  // While a card is zoomed, keep hover active inside the zoomed footprint too.
  if (!cardKey && getOverlaySourceKey() && isPointInsideOverlayClone()) {
    cardKey = getOverlaySourceKey()
  }

  if (cardKey) {
    if (cardKey !== hoverCardKey || (overlayClone && overlayClone.style.display === 'none')) {
      hoverCardKey = cardKey
      if (cardEl) {
        showOverlayClone(cardEl, false, true)
      }
    }
    return
  }
  if (hoverCardKey) {
    hoverCardKey = null
    clearOverlayClone()
  }
}

function syncOverlayPositionWithSource(): void {
  if (!overlayClone || !overlaySourceId) return
  if (overlayClone.style.display === 'none' || overlayClone.style.visibility === 'hidden') return
  const source = findCardElementByIdentity(overlaySourceId, overlaySourceDefId, overlaySourceOrderId)
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
      const selectedKey = getCardVisualKey(el)
      if (overlayLocked && selectedKey && getOverlaySourceKey() === selectedKey) {
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
  anchorY: number,
  offsetX = 0,
  offsetY = 0
): void {
  if (!asset.loaded) return
  drawAnchoredSource(context, asset.img, asset.img.width, asset.img.height, center, scale, anchorY, offsetX, offsetY)
}

function drawAnchoredImage(
  asset: ImageAsset,
  center: { x: number; y: number },
  scale: number,
  anchorY: number,
  offsetX = 0,
  offsetY = 0
): void {
  drawAnchoredImageTo(ctx, asset, center, scale, anchorY, offsetX, offsetY)
}

function drawAnchoredSource(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  center: { x: number; y: number },
  scale: number,
  anchorY: number,
  offsetX = 0,
  offsetY = 0
): void {
  const baseSize = layout.size * scale
  const ratio = sourceHeight / sourceWidth || 1
  const drawWidth = baseSize
  const drawHeight = baseSize * ratio
  const drawX = center.x - drawWidth / 2 + drawWidth * offsetX
  const drawY = center.y - drawHeight * anchorY + drawHeight * offsetY
  context.drawImage(source, drawX, drawY, drawWidth, drawHeight)
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
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
  return owner === 0 ? '#2da9ff' : '#ff1f3d'
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

const TEAM_TINT_LIFT_P1 = 0.2
const TEAM_TINT_LIFT_P2 = 0.08
const TEAM_RING_DARKEN = 0.3

function getSpriteTint(owner: PlayerId): string {
  const lift = owner === 0 ? TEAM_TINT_LIFT_P1 : TEAM_TINT_LIFT_P2
  return mixColor(getTeamTint(owner), '#ffffff', lift)
}

function getRingTint(owner: PlayerId): string {
  return mixColor(getTeamTint(owner), '#000000', TEAM_RING_DARKEN)
}

function getEncounterRoleColor(role: Unit['roguelikeRole']): string | null {
  if (role === 'slime_grand') return '#ffb75d'
  if (role === 'slime_mid') return '#ff953d'
  if (role === 'slime_small') return '#df6f2f'
  if (role === 'troll') return '#9aa26f'
  if (role === 'alpha_wolf') return '#b8c4d6'
  if (role === 'wolf') return '#9ca8bd'
  if (role === 'ice_spirit') return '#87d8ff'
  if (role === 'fire_spirit') return '#ff8a5f'
  if (role === 'lightning_spirit') return '#f0dc66'
  if (role === 'bandit') return '#b68961'
  if (role === 'necromancer') return '#7ea08f'
  if (role === 'skeleton_soldier') return '#d8d0c0'
  if (role === 'skeleton_warrior') return '#c8c0b0'
  if (role === 'skeleton_mage') return '#b9d0df'
  return null
}

function getUnitRingColor(unit: Unit): string {
  const fallback = getRingTint(unit.owner)
  if (mode !== 'roguelike') return fallback
  if (unit.owner !== BOT_PLAYER) return fallback
  const roleColor = getEncounterRoleColor(unit.roguelikeRole)
  return roleColor ?? fallback
}

function getUnitRenderScale(unit: Unit): number {
  if (mode !== 'roguelike' || unit.owner !== BOT_PLAYER) return 1
  return getEncounterRoleScale(unit.roguelikeRole)
}

function getEncounterRoleRenderStyle(role: Unit['roguelikeRole']): {
  tint: string | null
  offsetX: number
  offsetY: number
} {
  if (role === 'slime_grand') {
    return { tint: '#ffb75d', offsetX: 0, offsetY: 0.09 }
  }
  if (role === 'slime_mid') {
    return { tint: '#ff953d', offsetX: 0, offsetY: 0.07 }
  }
  if (role === 'slime_small') {
    return { tint: '#df6f2f', offsetX: 0, offsetY: 0.055 }
  }
  if (role === 'ice_spirit' || role === 'fire_spirit' || role === 'lightning_spirit') {
    return { tint: null, offsetX: 0, offsetY: 0.03 }
  }
  if (role === 'bandit') {
    return { tint: null, offsetX: 0, offsetY: 0.015 }
  }
  if (role === 'necromancer') {
    return { tint: null, offsetX: 0, offsetY: 0.035 }
  }
  if (role === 'skeleton_soldier' || role === 'skeleton_warrior' || role === 'skeleton_mage') {
    return { tint: null, offsetX: 0, offsetY: 0.02 }
  }
  return { tint: null, offsetX: 0, offsetY: 0 }
}

function pruneRoguelikeMonsterVariants(sourceState: GameState, preview: GameState | null): void {
  const liveUnitIds = new Set<string>([
    ...Object.keys(sourceState.units),
    ...pendingDeathUnits.keys(),
  ])
  if (preview) {
    Object.keys(preview.units).forEach((unitId) => {
      liveUnitIds.add(unitId)
    })
  }
  roguelikeMonsterVariantByUnitId.forEach((_, unitId) => {
    if (liveUnitIds.has(unitId)) return
    roguelikeMonsterVariantByUnitId.delete(unitId)
  })
}

function getRoguelikeMonsterImage(unit: Unit): ImageAsset | null {
  if (mode !== 'roguelike') return null
  if (unit.owner !== BOT_PLAYER) return null
  if (!unit.roguelikeRole) return null
  const variants = monsterRoleImages[unit.roguelikeRole]
  if (!variants || variants.length === 0) return null

  const loaded = variants
    .map((asset, index) => ({ asset, index }))
    .filter((entry) => entry.asset.loaded)
  if (loaded.length === 0) return null

  const existing = roguelikeMonsterVariantByUnitId.get(unit.id)
  if (existing !== undefined) {
    const matched = loaded.find((entry) => entry.index === existing)
    if (matched) return matched.asset
  }

  const picked = loaded[Math.floor(Math.random() * loaded.length)]
  roguelikeMonsterVariantByUnitId.set(unit.id, picked.index)
  return picked.asset
}

function getTintedMonsterLayer(asset: ImageAsset, tint: string): HTMLCanvasElement | null {
  if (!asset.loaded) return null
  const sourceId = asset.img.currentSrc || asset.img.src
  const cacheKey = `${sourceId}|${tint}`
  const cached = monsterTintCache.get(cacheKey)
  if (cached) return cached

  const canvasEl = document.createElement('canvas')
  canvasEl.width = asset.img.width
  canvasEl.height = asset.img.height
  const context = canvasEl.getContext('2d')
  if (!context) return null

  context.drawImage(asset.img, 0, 0)
  const imageData = context.getImageData(0, 0, canvasEl.width, canvasEl.height)
  const data = imageData.data
  const tintRgb = hexToRgb(tint)
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue
    const luminance = (data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722) / 255
    const shade = 0.18 + luminance * 0.82
    data[index] = Math.round(tintRgb.r * shade)
    data[index + 1] = Math.round(tintRgb.g * shade)
    data[index + 2] = Math.round(tintRgb.b * shade)
  }
  context.putImageData(imageData, 0, 0)
  monsterTintCache.set(cacheKey, canvasEl)
  return canvasEl
}

function drawMonsterSprite(
  context: CanvasRenderingContext2D,
  center: { x: number; y: number },
  unit: Unit,
  scale = UNIT_IMAGE_SCALE
): boolean {
  const monsterImage = getRoguelikeMonsterImage(unit)
  if (!monsterImage) return false

  const style = getEncounterRoleRenderStyle(unit.roguelikeRole)
  if (style.tint) {
    const tinted = getTintedMonsterLayer(monsterImage, style.tint)
    if (tinted) {
      drawAnchoredSource(
        context,
        tinted,
        tinted.width,
        tinted.height,
        center,
        scale,
        UNIT_ANCHOR_Y,
        style.offsetX,
        style.offsetY
      )
      return true
    }
  }

  drawAnchoredImageTo(context, monsterImage, center, scale, UNIT_ANCHOR_Y, style.offsetX, style.offsetY)
  return true
}

function getSpriteSetForOwner(owner: PlayerId): ClassSpriteSet {
  const classId = getLoadoutClass(owner)
  return classSpriteSets[classId] ?? classSpriteSets.commander
}

function getUnitDisplayName(owner: PlayerId): string {
  const classId = getLoadoutClass(owner)
  return PLAYER_CLASS_DEFS[classId].unitName
}

function getUnitLabel(unit: Unit): string {
  if (unit.roguelikeRole) return getEncounterUnitLabel(unit.roguelikeRole)
  return getUnitDisplayName(unit.owner)
}

function getLeaderDisplayName(owner: PlayerId): string {
  const classId = getLoadoutClass(owner)
  return PLAYER_CLASS_DEFS[classId].name
}

function getLeaderPortraitColor(owner: PlayerId): string {
  return getTeamTint(owner)
}

function getMatchThemeClassId(): PlayerClassId {
  if (mode === 'roguelike' && roguelikeRun) return roguelikeRun.playerClass
  return getLoadoutClass(planningPlayer)
}

function applyMatchClassTheme(): void {
  if (screen !== 'game') {
    document.body.classList.remove('in-match')
    document.body.removeAttribute('data-match-class')
    return
  }
  const classId = getMatchThemeClassId()
  const classColor = PLAYER_CLASS_DEFS[classId].color
  const root = document.documentElement
  root.style.setProperty('--match-class-primary', classColor)
  root.style.setProperty('--match-class-dark', mixColor(classColor, '#000000', 0.26))
  root.style.setProperty('--match-class-light', mixColor(classColor, '#ffffff', 0.14))
  root.style.setProperty('--match-class-border', mixColor(classColor, '#ffffff', 0.18))
  document.body.dataset.matchClass = classId
  document.body.classList.add('in-match')
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

function drawUnitSprite(center: { x: number; y: number }, owner: PlayerId, scale = UNIT_IMAGE_SCALE): void {
  const spriteSet = getSpriteSetForOwner(owner)
  if (!spriteSet.unitBaseImage.loaded) return
  drawAnchoredImage(spriteSet.unitBaseImage, center, scale, UNIT_ANCHOR_Y, spriteSet.unitOffsetX, spriteSet.unitOffsetY)
  const tinted = getTintedTeamLayer(owner, spriteSet.unitTeamImage, spriteSet.unitTeamCache)
  if (!tinted) return
  drawAnchoredSource(
    ctx,
    tinted,
    tinted.width,
    tinted.height,
    center,
    scale,
    UNIT_ANCHOR_Y,
    spriteSet.unitOffsetX,
    spriteSet.unitOffsetY
  )
}

function drawLeaderSprite(center: { x: number; y: number }, owner: PlayerId, scale = LEADER_IMAGE_SCALE): void {
  const spriteSet = getSpriteSetForOwner(owner)
  if (!spriteSet.leaderBaseImage.loaded) return
  drawAnchoredImage(
    spriteSet.leaderBaseImage,
    center,
    scale,
    UNIT_ANCHOR_Y,
    spriteSet.leaderOffsetX,
    spriteSet.leaderOffsetY
  )
  const tinted = getTintedTeamLayer(owner, spriteSet.leaderTeamImage, spriteSet.leaderTeamCache)
  if (!tinted) return
  drawAnchoredSource(
    ctx,
    tinted,
    tinted.width,
    tinted.height,
    center,
    scale,
    UNIT_ANCHOR_Y,
    spriteSet.leaderOffsetX,
    spriteSet.leaderOffsetY
  )
}

function drawLeaderPortrait(canvasEl: HTMLCanvasElement, owner: PlayerId): void {
  const size = Math.max(64, Math.round(canvasEl.clientWidth || canvasEl.width || 96))
  const scale = Math.max(1, window.devicePixelRatio || 1)
  const pixelSize = Math.round(size * scale)
  if (canvasEl.width !== pixelSize || canvasEl.height !== pixelSize) {
    canvasEl.width = pixelSize
    canvasEl.height = pixelSize
  }

  const context = canvasEl.getContext('2d')
  if (!context) return

  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, canvasEl.width, canvasEl.height)
  context.setTransform(scale, 0, 0, scale, 0, 0)
  context.imageSmoothingEnabled = true

  const radius = size * 0.5
  const center = { x: radius, y: radius }
  const spriteSet = getSpriteSetForOwner(owner)
  const drawSize = size * PLAYER_PORTRAIT_ART_SCALE

  const drawPortraitLayer = (source: CanvasImageSource, sourceWidth: number, sourceHeight: number): void => {
    const ratio = sourceHeight / sourceWidth || 1
    const drawWidth = drawSize
    const drawHeight = drawSize * ratio
    const drawX = center.x - drawWidth / 2 + drawWidth * spriteSet.leaderOffsetX
    const drawY =
      center.y -
      drawHeight * PLAYER_PORTRAIT_ART_ANCHOR_Y +
      drawHeight * (spriteSet.leaderOffsetY + PLAYER_PORTRAIT_ART_OFFSET_Y)
    context.drawImage(source, drawX, drawY, drawWidth, drawHeight)
  }

  context.save()
  context.beginPath()
  context.arc(center.x, center.y, radius - 1, 0, Math.PI * 2)
  context.clip()

  context.fillStyle = '#000000'
  context.fillRect(0, 0, size, size)

  if (spriteSet.leaderBaseImage.loaded) {
    drawPortraitLayer(
      spriteSet.leaderBaseImage.img,
      spriteSet.leaderBaseImage.img.width,
      spriteSet.leaderBaseImage.img.height
    )
  }
  const tinted = getTintedTeamLayer(owner, spriteSet.leaderTeamImage, spriteSet.leaderTeamCache)
  if (tinted) {
    drawPortraitLayer(tinted, tinted.width, tinted.height)
  }

  context.restore()
}

function drawBarricadeSprite(
  center: { x: number; y: number },
  owner: PlayerId,
  context: CanvasRenderingContext2D = ctx
): void {
  if (!barricadeBaseImage.loaded) return
  drawAnchoredImageTo(context, barricadeBaseImage, center, BARRICADE_IMAGE_SCALE, BARRICADE_ANCHOR_Y)
  const tinted = getTintedTeamLayer(owner, barricadeTeamImage, barricadeTeamCache)
  if (!tinted) return
  drawAnchoredSource(context, tinted, tinted.width, tinted.height, center, BARRICADE_IMAGE_SCALE, BARRICADE_ANCHOR_Y)
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
  if (!currentAnimation) {
    return projectHex(unit.pos)
  }

  const t = easeInOutCubic(animationProgress)
  if (currentAnimation.type === 'move' && currentAnimation.unitId === unit.id) {
    const from = projectHex(currentAnimation.from)
    const to = projectHex(currentAnimation.to)
    return {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    }
  }

  if (currentAnimation.type === 'teamMove') {
    const move = currentAnimation.moves.find((entry) => entry.unitId === unit.id)
    if (!move) return projectHex(unit.pos)
    const from = projectHex(move.from)
    const to = projectHex(move.to)
    return {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    }
  }

  if (currentAnimation.type === 'shove' && currentAnimation.targetUnitId === unit.id) {
    const from = projectHex(currentAnimation.from)
    const to = projectHex(currentAnimation.to)
    if (!currentAnimation.collision) {
      return {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
      }
    }
    if (t <= 0.5) {
      const p = t * 2
      return {
        x: from.x + (to.x - from.x) * p,
        y: from.y + (to.y - from.y) * p,
      }
    }
    const p = (t - 0.5) * 2
    return {
      x: to.x + (from.x - to.x) * p,
      y: to.y + (from.y - to.y) * p,
    }
  }

  if (currentAnimation.type === 'lunge' && currentAnimation.unitId === unit.id) {
    const base = projectHex(currentAnimation.from)
    const neighborHex = neighbor(currentAnimation.from, currentAnimation.dir)
    const neighborCenter = projectHex(neighborHex)
    const lunge = Math.sin(t * Math.PI) * 0.35
    return {
      x: base.x + (neighborCenter.x - base.x) * lunge,
      y: base.y + (neighborCenter.y - base.y) * lunge,
    }
  }

  if (currentAnimation.type === 'teamLunge') {
    const lungeAnimation = currentAnimation.lunges.find((entry) => entry.unitId === unit.id)
    if (!lungeAnimation) return projectHex(unit.pos)
    const base = projectHex(lungeAnimation.from)
    const neighborHex = neighbor(lungeAnimation.from, lungeAnimation.dir)
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
  const strength = previewStrength !== null ? Math.max(0, previewStrength) : baseStrength
  if (strength <= 0) return
  const dotRadius = Math.max(2, layout.size * 0.07)
  const orbHeight = dotRadius * 2
  const gap = dotRadius * 0.9
  const baseX = center.x + layout.size * 0.48
  const baseY = center.y

  if (strength >= 5) {
    const orbColor =
      previewStrength === null || previewStrength === baseStrength
        ? baseColor
        : previewStrength < baseStrength
          ? '#ff4a4a'
          : '#7CFF8A'
    const orbRadius = Math.max(dotRadius * 1.95, layout.size * 0.17)
    const gradient = ctx.createRadialGradient(
      baseX - orbRadius * 0.38,
      baseY - orbRadius * 0.38,
      orbRadius * 0.24,
      baseX,
      baseY,
      orbRadius
    )
    gradient.addColorStop(0, '#ffffff')
    gradient.addColorStop(0.32, orbColor)
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.62)')

    ctx.save()
    ctx.beginPath()
    ctx.arc(baseX, baseY, orbRadius, 0, Math.PI * 2)
    ctx.fillStyle = gradient
    ctx.fill()
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.38)'
    ctx.lineWidth = 1
    ctx.stroke()

    const label = String(strength)
    const fontSize = Math.max(10, orbRadius * (label.length >= 3 ? 0.9 : 1.18))
    ctx.font = `700 ${fontSize}px "Trebuchet MS", "Verdana", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = Math.max(2, fontSize * 0.13)
    ctx.strokeStyle = 'rgba(12, 12, 18, 0.78)'
    ctx.fillStyle = '#fffaf2'
    ctx.strokeText(label, baseX, baseY + orbRadius * 0.03)
    ctx.fillText(label, baseX, baseY + orbRadius * 0.03)
    ctx.restore()
    return
  }

  type StrengthIcon = { start: number; end: number }
  const icons: StrengthIcon[] = []
  for (let i = 0; i < strength; i += 1) {
    const start = i + 1
    icons.push({ start, end: start })
  }

  const centerYs: number[] = []
  for (let i = 0; i < icons.length; i += 1) {
    if (i === 0) {
      centerYs.push(baseY)
      continue
    }
    const nextY = centerYs[i - 1] - (orbHeight + gap) * BOARD_TILT
    centerYs.push(nextY)
  }

  const getRemovedFraction = (icon: StrengthIcon): number => {
    if (previewStrength === null) return 0
    if (previewStrength >= icon.end) return 0
    const iconHp = icon.end - icon.start + 1
    const removed = icon.end - Math.max(previewStrength, icon.start - 1)
    return Math.max(0, Math.min(1, removed / iconHp))
  }

  const getAddedFraction = (icon: StrengthIcon): number => {
    if (previewStrength === null) return 0
    if (previewStrength <= baseStrength) return 0
    const iconHp = icon.end - icon.start + 1
    const addedTop = Math.min(icon.end, previewStrength)
    const addedBottomExclusive = Math.max(icon.start - 1, baseStrength)
    const added = addedTop - addedBottomExclusive
    return Math.max(0, Math.min(1, added / iconHp))
  }

  ctx.save()
  for (let i = 0; i < icons.length; i += 1) {
    const icon = icons[i]
    const y = centerYs[i]
    const damageFraction = getRemovedFraction(icon)
    const healFraction = getAddedFraction(icon)
    const overlayFraction = damageFraction > 0 ? damageFraction : healFraction
    const overlayColor = damageFraction > 0 ? '#ff2b2b' : '#7CFF8A'
    const orbColor = overlayFraction >= 1 ? overlayColor : baseColor
    const gradient = ctx.createRadialGradient(
      baseX - dotRadius * 0.35,
      y - dotRadius * 0.35,
      dotRadius * 0.2,
      baseX,
      y,
      dotRadius
    )
    gradient.addColorStop(0, '#ffffff')
    gradient.addColorStop(0.3, orbColor)
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

function drawStrengthChangeAnimation(animation: StrengthChangeAnimation, progress: number): void {
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  animation.entries.forEach((entry) => {
    const delay = Math.min(0.3, entry.stackIndex * 0.12)
    const localProgress = clamp((progress - delay) / Math.max(0.0001, 1 - delay), 0, 1)
    if (localProgress <= 0 || localProgress >= 1) return

    const center = projectHex(entry.anchor)
    const rise = layout.size * (0.16 + easeOutCubic(localProgress) * 0.54)
    const sideOffset =
      entry.stackIndex === 0
        ? 0
        : (entry.stackIndex % 2 === 0 ? -1 : 1) * layout.size * 0.08 * Math.ceil(entry.stackIndex / 2)
    const x = center.x + sideOffset
    const y = center.y - layout.size * 0.72 - rise - entry.stackIndex * layout.size * 0.06
    const alpha = 1 - Math.pow(localProgress, 1.35)
    const label = `${entry.amount > 0 ? '+' : '-'}${Math.abs(entry.amount)}`
    const fontSize = Math.max(14, layout.size * (Math.abs(entry.amount) >= 10 ? 0.26 : 0.29))
    const fillStyle = entry.amount > 0 ? '#7CFF8A' : '#ff6666'

    ctx.save()
    ctx.globalAlpha = alpha
    ctx.font = `700 ${fontSize}px "Trebuchet MS", "Verdana", sans-serif`
    ctx.lineWidth = Math.max(2.6, fontSize * 0.15)
    ctx.strokeStyle = 'rgba(10, 10, 16, 0.82)'
    ctx.fillStyle = fillStyle
    ctx.shadowColor = fillStyle
    ctx.shadowBlur = fontSize * 0.35
    ctx.strokeText(label, x, y)
    ctx.fillText(label, x, y)
    ctx.restore()
  })

  ctx.restore()
}

function getUnitAtStateHex(hex: Hex): Unit | null {
  for (const unit of Object.values(state.units)) {
    if (unit.pos.q === hex.q && unit.pos.r === hex.r) return unit
  }
  return null
}

function describeUnitModifier(modifier: Unit['modifiers'][number]): { label: string; kind: 'buff' | 'debuff' } {
  if (modifier.type === 'cannotMove') {
    return { label: 'Cannot move', kind: 'debuff' }
  }
  if (modifier.type === 'stunned') {
    return { label: 'Stunned', kind: 'debuff' }
  }
  if (modifier.type === 'slow') {
    return { label: 'Slow', kind: 'debuff' }
  }
  if (modifier.type === 'chilled') {
    return { label: 'Chilled', kind: 'debuff' }
  }
  if (modifier.type === 'frozen') {
    return { label: 'Frozen', kind: 'debuff' }
  }
  if (modifier.type === 'spellResistance') {
    return { label: 'Spell resistance', kind: 'buff' }
  }
  if (modifier.type === 'reinforcementPenalty') {
    return { label: 'Reinforcement penalty', kind: 'debuff' }
  }
  if (modifier.type === 'burn') {
    return { label: 'Burn', kind: 'debuff' }
  }
  if (modifier.type === 'scalding') {
    return { label: 'Scalding', kind: 'buff' }
  }
  if (modifier.type === 'regeneration') {
    return { label: 'Regeneration', kind: 'buff' }
  }
  if (modifier.type === 'disarmed') {
    return { label: 'Disarmed', kind: 'debuff' }
  }
  if (modifier.type === 'vulnerable') {
    return { label: 'Vulnerable', kind: 'debuff' }
  }
  if (modifier.type === 'strong') {
    return { label: 'Strong', kind: 'buff' }
  }
  if (modifier.type === 'undying') {
    return { label: 'Undying', kind: 'buff' }
  }
  if (modifier.type === 'spikes') {
    return { label: 'Spikes', kind: 'buff' }
  }
  if (modifier.type === 'berserk') {
    return { label: 'Berserk', kind: 'buff' }
  }
  if (modifier.type === 'lightningBarrier') {
    return { label: 'Lightning barrier', kind: 'buff' }
  }
  return { label: modifier.type, kind: 'debuff' }
}

function summarizeUnitModifiers(
  modifiers: Unit['modifiers']
): { label: string; kind: 'buff' | 'debuff'; turnsRemaining: number | 'indefinite'; count: number }[] {
  const grouped = new Map<
    Unit['modifiers'][number]['type'],
    { modifier: Unit['modifiers'][number]; count: number; maxTurns: number }
  >()

  modifiers.forEach((modifier) => {
    const existing = grouped.get(modifier.type)
    if (!existing) {
      grouped.set(modifier.type, {
        modifier,
        count: 1,
        maxTurns: modifier.turnsRemaining === 'indefinite' ? 0 : modifier.turnsRemaining,
      })
      return
    }
    existing.count += 1
    if (modifier.turnsRemaining !== 'indefinite') {
      existing.maxTurns = Math.max(existing.maxTurns, modifier.turnsRemaining)
    }
    if (existing.modifier.turnsRemaining !== 'indefinite' && modifier.turnsRemaining === 'indefinite') {
      existing.modifier = modifier
    }
  })

  return Array.from(grouped.values()).map(({ modifier, count, maxTurns }) => {
    const details = describeUnitModifier(modifier)
    return {
      label: details.label,
      kind: details.kind,
      turnsRemaining: modifier.turnsRemaining === 'indefinite' ? 'indefinite' : maxTurns,
      count,
    }
  })
}

function getUnitPopoverLabel(unit: Unit): string {
  if (unit.kind === 'leader') return getLeaderDisplayName(unit.owner)
  if (unit.kind === 'barricade') return 'Barricade'
  return unit.isMinion ? `${getUnitLabel(unit)} (Minion)` : getUnitLabel(unit)
}

function hideUnitStatusPopover(): void {
  unitStatusPopoverEl.classList.add('hidden')
  unitStatusPopoverEl.innerHTML = ''
}

function clearUnitStatusPopoverState(): void {
  hoveredStatusUnitId = null
  pinnedStatusUnitId = null
  hideUnitStatusPopover()
}

function hidePlayerStatusPopover(): void {
  playerStatusPopoverEl.classList.add('hidden')
  playerStatusPopoverEl.innerHTML = ''
}

function clearPlayerStatusPopoverState(): void {
  pinnedStatusPlayerId = null
  hidePlayerStatusPopover()
}

function isUnitStatusInspectionEnabled(): boolean {
  return selectedCardId === null && pendingOrder === null
}

function renderUnitStatusPopover(): void {
  if (screen !== 'game' || gameScreen.classList.contains('hidden')) {
    hideUnitStatusPopover()
    return
  }
  if (!isUnitStatusInspectionEnabled()) {
    clearUnitStatusPopoverState()
    return
  }

  const unitId = pinnedStatusUnitId ?? hoveredStatusUnitId
  if (!unitId) {
    hideUnitStatusPopover()
    return
  }

  const unit = state.units[unitId]
  if (!unit) {
    if (pinnedStatusUnitId === unitId) pinnedStatusUnitId = null
    if (hoveredStatusUnitId === unitId) hoveredStatusUnitId = null
    hideUnitStatusPopover()
    return
  }

  const rows =
    unit.modifiers.length > 0
      ? summarizeUnitModifiers(unit.modifiers)
          .map((summary) => {
            const turns =
              summary.turnsRemaining === 'indefinite'
                ? 'indefinite'
                : `${summary.turnsRemaining} turn${summary.turnsRemaining === 1 ? '' : 's'}`
            const stackSuffix = summary.count > 1 ? ` x${summary.count}` : ''
            return `<li class="unit-status-row ${summary.kind}"><span class="unit-status-kind">${summary.kind}</span><span class="unit-status-name">${summary.label}${stackSuffix}</span><span class="unit-status-turns">${turns}</span></li>`
          })
          .join('')
      : '<li class="unit-status-row none"><span class="unit-status-name">No active effects.</span></li>'

  unitStatusPopoverEl.innerHTML = [
    `<div class="unit-status-title">${getUnitPopoverLabel(unit)} ${unit.id}</div>`,
    `<ul class="unit-status-list">${rows}</ul>`,
  ].join('')
  unitStatusPopoverEl.classList.remove('hidden')

  const center = getAnimatedCenter(unit)
  const panelRect = boardPanel.getBoundingClientRect()
  const canvasRect = canvas.getBoundingClientRect()
  const canvasX = boardOffset.x + center.x * boardScale
  const canvasY = boardOffset.y + center.y * boardScale
  const idealX = canvasRect.left - panelRect.left + canvasX
  const idealY = canvasRect.top - panelRect.top + canvasY
  const halfWidth = unitStatusPopoverEl.offsetWidth / 2
  const popoverHeight = unitStatusPopoverEl.offsetHeight
  const clampedX = clamp(idealX, 12 + halfWidth, panelRect.width - 12 - halfWidth)
  const clampedY = clamp(idealY, 16 + popoverHeight + 8, panelRect.height - 12)

  unitStatusPopoverEl.style.left = `${clampedX}px`
  unitStatusPopoverEl.style.top = `${clampedY}px`
}

function updateUnitStatusHoverFromPointer(clientX: number, clientY: number): void {
  if (!isUnitStatusInspectionEnabled()) {
    clearUnitStatusPopoverState()
    return
  }
  if (lastInputWasTouch || pinnedStatusUnitId || overlayLocked || isPanning) return
  if (screen !== 'game' || gameScreen.classList.contains('hidden')) return

  const rect = canvas.getBoundingClientRect()
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    if (hoveredStatusUnitId !== null) {
      hoveredStatusUnitId = null
      renderUnitStatusPopover()
    }
    return
  }

  const hex = pickHexFromClient(clientX, clientY)
  const unit = hex ? getUnitAtStateHex(hex) : null
  const nextUnitId = unit ? unit.id : null
  if (nextUnitId !== hoveredStatusUnitId) {
    hoveredStatusUnitId = nextUnitId
    renderUnitStatusPopover()
  }
}

function togglePinnedUnitStatusFromHex(hex: Hex): void {
  if (!isUnitStatusInspectionEnabled()) {
    clearUnitStatusPopoverState()
    return
  }
  const unit = getUnitAtStateHex(hex)
  if (!unit) {
    pinnedStatusUnitId = null
    hoveredStatusUnitId = null
    renderUnitStatusPopover()
    return
  }
  pinnedStatusUnitId = pinnedStatusUnitId === unit.id ? null : unit.id
  hoveredStatusUnitId = null
  renderUnitStatusPopover()
}

function getPlayerResourceCounts(player: PlayerId): { deck: number; discard: number; hand: number } {
  const counts = onlineSession?.viewMeta?.counts?.[player]
  if (mode === 'online' && counts) {
    return {
      deck: counts.deck,
      discard: counts.discard,
      hand: counts.hand,
    }
  }
  return {
    deck: state.players[player].deck.length,
    discard: state.players[player].discard.length,
    hand: state.players[player].hand.length,
  }
}

function getPlayerApBudget(player: PlayerId): number {
  return (
    state.actionBudgets?.[player] ??
    (player === 0 ? state.settings.actionBudgetP1 : state.settings.actionBudgetP2) ??
    (player === 0 ? gameSettings.actionBudgetP1 : gameSettings.actionBudgetP2) ??
    3
  )
}

function describePlayerModifierSummary(summary: {
  type: PlayerModifier['type']
  amount: number
  turnsRemaining: number | 'indefinite'
}): { label: string; description: string; kind: 'buff' | 'debuff' } {
  if (summary.type === 'extraDraw') {
    const amountLabel = `${summary.amount} extra card${summary.amount === 1 ? '' : 's'}`
    return {
      label: 'Extra Draw',
      description:
        summary.turnsRemaining === 'indefinite'
          ? `Draw ${amountLabel} at the start of each turn.`
          : `Draw ${amountLabel} at the start of your next turn.`,
      kind: 'buff',
    }
  }
  return {
    label: 'Brain Freeze',
    description: 'All cards become Slow next turn. Priority and Slow cancel each other out.',
    kind: 'debuff',
  }
}

function summarizePlayerModifiers(
  modifiers: PlayerModifier[]
): Array<{
  label: string
  description: string
  kind: 'buff' | 'debuff'
  turnsRemaining: number | 'indefinite'
}> {
  let extraDrawAmount = 0
  let extraDrawTurns: number | 'indefinite' | null = null
  let hasBrainFreeze = false
  let brainFreezeTurns: number | 'indefinite' | null = null

  modifiers.forEach((modifier) => {
    if (modifier.type === 'extraDraw') {
      extraDrawAmount += modifier.amount
      if (extraDrawTurns === 'indefinite' || modifier.turnsRemaining === 'indefinite') {
        extraDrawTurns = 'indefinite'
      } else {
        extraDrawTurns = Math.max(extraDrawTurns ?? 0, modifier.turnsRemaining)
      }
      return
    }
    if (modifier.type === 'brainFreeze') {
      hasBrainFreeze = true
      if (brainFreezeTurns === 'indefinite' || modifier.turnsRemaining === 'indefinite') {
        brainFreezeTurns = 'indefinite'
      } else {
        brainFreezeTurns = Math.max(brainFreezeTurns ?? 0, modifier.turnsRemaining)
      }
    }
  })

  const summaries: Array<{
    label: string
    description: string
    kind: 'buff' | 'debuff'
    turnsRemaining: number | 'indefinite'
  }> = []

  if (extraDrawTurns && extraDrawAmount > 0) {
    const details = describePlayerModifierSummary({
      type: 'extraDraw',
      amount: extraDrawAmount,
      turnsRemaining: extraDrawTurns,
    })
    summaries.push({
      label: details.label,
      description: details.description,
      kind: details.kind,
      turnsRemaining: extraDrawTurns,
    })
  }

  if (hasBrainFreeze && brainFreezeTurns) {
    const details = describePlayerModifierSummary({
      type: 'brainFreeze',
      amount: 0,
      turnsRemaining: brainFreezeTurns,
    })
    summaries.push({
      label: details.label,
      description: details.description,
      kind: details.kind,
      turnsRemaining: brainFreezeTurns,
    })
  }

  return summaries
}

function getPlayerPortraitButton(player: PlayerId): HTMLButtonElement {
  return player === 0 ? playerPortraitP1Button : playerPortraitP2Button
}

function renderPlayerPortraits(): void {
  ;([0, 1] as PlayerId[]).forEach((player) => {
    const button = getPlayerPortraitButton(player)
    const portraitCanvas = player === 0 ? playerPortraitP1Canvas : playerPortraitP2Canvas
    button.style.setProperty('--leader-color', getLeaderPortraitColor(player))
    button.style.setProperty('--team-color', getTeamTint(player))
    button.classList.toggle('active-player', state.activePlayer === player)
    button.classList.toggle('is-open', pinnedStatusPlayerId === player)
    drawLeaderPortrait(portraitCanvas, player)
  })
}

function renderPlayerStatusPopover(): void {
  if (screen !== 'game' || gameScreen.classList.contains('hidden')) {
    hidePlayerStatusPopover()
    return
  }
  if (pinnedStatusPlayerId === null) {
    hidePlayerStatusPopover()
    return
  }

  const player = pinnedStatusPlayerId
  const counts = getPlayerResourceCounts(player)
  const apBudget = getPlayerApBudget(player)
  const effects = summarizePlayerModifiers(state.players[player].modifiers)
  const effectRows =
    effects.length > 0
      ? effects
          .map((effect) => {
            const turns =
              effect.turnsRemaining === 'indefinite'
                ? 'indefinite'
                : `${effect.turnsRemaining} turn${effect.turnsRemaining === 1 ? '' : 's'}`
            return [
              `<li class="player-status-effect ${effect.kind}">`,
              `<div class="player-status-effect-head">`,
              `<span class="unit-status-kind">${effect.kind}</span>`,
              `<span class="player-status-effect-name">${effect.label}</span>`,
              `<span class="player-status-effect-turns">${turns}</span>`,
              `</div>`,
              `<div class="player-status-effect-desc">${effect.description}</div>`,
              `</li>`,
            ].join('')
          })
          .join('')
      : '<li class="player-status-effect none"><div class="player-status-effect-desc">No active player effects.</div></li>'

  playerStatusPopoverEl.innerHTML = [
    `<div class="player-status-title">Player ${player + 1} ${getLeaderDisplayName(player)}</div>`,
    `<div class="player-status-stats">`,
    `<div class="player-status-stat"><span class="player-status-stat-label">AP budget</span><span class="player-status-stat-value">${apBudget}</span></div>`,
    `<div class="player-status-stat"><span class="player-status-stat-label">Hand</span><span class="player-status-stat-value">${counts.hand}</span></div>`,
    `<div class="player-status-stat"><span class="player-status-stat-label">Deck</span><span class="player-status-stat-value">${counts.deck}</span></div>`,
    `<div class="player-status-stat"><span class="player-status-stat-label">Discard</span><span class="player-status-stat-value">${counts.discard}</span></div>`,
    `</div>`,
    `<div class="player-status-section-title">Status Effects</div>`,
    `<ul class="player-status-effects">${effectRows}</ul>`,
  ].join('')
  playerStatusPopoverEl.classList.remove('hidden')

  const button = getPlayerPortraitButton(player)
  const panelRect = boardPanel.getBoundingClientRect()
  const buttonRect = button.getBoundingClientRect()
  const halfWidth = playerStatusPopoverEl.offsetWidth / 2
  const popoverHeight = playerStatusPopoverEl.offsetHeight
  const idealX = buttonRect.left - panelRect.left + buttonRect.width / 2
  const idealTop = buttonRect.top - panelRect.top - 8
  const clampedX = clamp(idealX, 12 + halfWidth, panelRect.width - 12 - halfWidth)
  const clampedTop = clamp(idealTop, 16 + popoverHeight, panelRect.height - 12)
  playerStatusPopoverEl.style.left = `${clampedX}px`
  playerStatusPopoverEl.style.top = `${clampedTop}px`
}

function togglePinnedPlayerStatus(player: PlayerId): void {
  pinnedStatusPlayerId = pinnedStatusPlayerId === player ? null : player
  renderPlayerPortraits()
  renderPlayerStatusPopover()
}

function setScreen(next: Screen): void {
  if (isBotControlledMode() && next !== 'game') {
    invalidateBotPlanning()
  }
  screen = next
  applyCardAssetCssVars()
  menuScreen.classList.toggle('hidden', screen !== 'menu')
  tutorialScreen.classList.toggle('hidden', screen !== 'tutorial_hub')
  loadoutScreen.classList.toggle('hidden', screen !== 'loadout')
  settingsScreen.classList.toggle('hidden', screen !== 'settings')
  gameScreen.classList.toggle('hidden', screen !== 'game')
  winnerModal.classList.toggle('hidden', screen !== 'game' || state.winner === null || suppressWinnerModalForRestoredOutcome)
  if (screen !== 'game') {
    clearUnitStatusPopoverState()
    clearPlayerStatusPopoverState()
  }
  applyMatchClassTheme()
  if (screen === 'menu') updateSeedDisplay()
  if (screen === 'tutorial_hub') renderTutorialHub()
  if (screen === 'loadout') renderLoadout()
  if (screen === 'settings') renderSettings()
  if (screen === 'game') render()
  syncTutorialUi()
  notifyTutorialEvent('screen_changed', { screen })
  scheduleProgressSave()
}

function getTutorialDomTargetElement(targetId: TutorialDomTargetId): HTMLElement | null {
  switch (targetId) {
    case 'menu-tutorial':
      return menuTutorialButton
    case 'menu-online-create':
      return onlineCreateButton
    case 'menu-online-join':
      return onlineJoinButton
    case 'menu-online-room':
      return onlineRoomInput
    case 'menu-online-token':
      return onlineTokenInput
    case 'menu-online-links':
      return onlineLinksEl
    case 'loadout-class':
      return loadoutClassSelect
    case 'loadout-back':
      return loadoutBackButton
    case 'loadout-filter-attack':
      return document.querySelector<HTMLButtonElement>('[data-filter="attack"]')
    case 'loadout-all':
      return loadoutAll
    case 'loadout-selected':
      return loadoutSelected
    case 'planner-ap':
      return plannerApEl
    case 'active-player':
      return activeEl
    case 'hand':
      return handEl
    case 'orders':
      return ordersEl
    case 'ready':
      return readyButton
    case 'resolve-next':
      return resolveNextButton
    case 'resolve-all':
      return resolveAllButton
    case 'winner':
      return winnerModal
    default:
      return null
  }
}

function findTutorialHighlightElement(target: TutorialHighlightTarget): HTMLElement | null {
  if (target.type === 'dom') {
    return getTutorialDomTargetElement(target.targetId)
  }
  if (target.type === 'hand_card') {
    return handEl.querySelector<HTMLElement>(`[data-card-layer="hand"][data-card-def-id="${target.defId}"]`)
  }
  if (target.type === 'loadout_card') {
    return loadoutAll.querySelector<HTMLElement>(`[data-add-id="${target.defId}"]`)
  }
  if (target.type === 'selected_loadout_card') {
    return loadoutSelected.querySelector<HTMLElement>(`[data-remove-id="${target.defId}"]`)
  }
  if (target.type === 'queue_card') {
    return ordersEl.querySelector<HTMLElement>(`[data-card-layer="queue"][data-card-def-id="${target.defId}"]`)
  }
  return null
}

function getActiveTutorialHighlights(): TutorialHighlightTarget[] {
  const step = tutorialController.getCurrentStep()
  return step?.highlights ?? []
}

function getTutorialHighlightPriority(target: TutorialHighlightTarget): number {
  switch (target.type) {
    case 'board_unit':
    case 'board_tile':
      return 5
    case 'hand_card':
    case 'queue_card':
    case 'loadout_card':
    case 'selected_loadout_card':
      return 4
    case 'dom':
      switch (target.targetId) {
        case 'ready':
        case 'resolve-next':
        case 'resolve-all':
        case 'winner':
        case 'menu-online-create':
        case 'menu-online-join':
        case 'loadout-class':
        case 'loadout-back':
        case 'loadout-filter-attack':
          return 3
        case 'orders':
        case 'hand':
          return 1
        default:
          return 2
      }
    default:
      return 0
  }
}

function getTutorialFocusHighlight():
  | { target: TutorialHighlightTarget; rect: DOMRect; element: HTMLElement | null }
  | null {
  const candidates = getActiveTutorialHighlights()
    .map((target) => {
      const rect = getTutorialHighlightRect(target)
      if (!rect) return null
      return {
        target,
        rect,
        element: findTutorialHighlightElement(target),
      }
    })
    .filter((candidate): candidate is { target: TutorialHighlightTarget; rect: DOMRect; element: HTMLElement | null } =>
      Boolean(candidate)
    )

  if (candidates.length === 0) return null

  candidates.sort((left, right) => {
    const priorityDelta = getTutorialHighlightPriority(right.target) - getTutorialHighlightPriority(left.target)
    if (priorityDelta !== 0) return priorityDelta
    const leftArea = left.rect.width * left.rect.height
    const rightArea = right.rect.width * right.rect.height
    return leftArea - rightArea
  })

  return candidates[0]
}

function isQueueLikeTutorialTarget(target: TutorialHighlightTarget): boolean {
  return (
    target.type === 'queue_card' ||
    target.type === 'hand_card' ||
    (target.type === 'dom' && (target.targetId === 'orders' || target.targetId === 'hand'))
  )
}

function renderTutorialSpotlights(): void {
  tutorialSpotlightsEl.innerHTML = ''
  if (screen === 'tutorial_hub') {
    tutorialSpotlightsEl.classList.add('hidden')
    return
  }

  const elements = getActiveTutorialHighlights()
    .map((target) => findTutorialHighlightElement(target))
    .filter((element): element is HTMLElement => Boolean(element))
  if (elements.length === 0) {
    tutorialSpotlightsEl.classList.add('hidden')
    return
  }

  elements.forEach((element) => {
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const frame = document.createElement('div')
    frame.className = 'tutorial-spotlight-frame'
    frame.style.left = `${rect.left - 6}px`
    frame.style.top = `${rect.top - 6}px`
    frame.style.width = `${rect.width + 12}px`
    frame.style.height = `${rect.height + 12}px`
    tutorialSpotlightsEl.appendChild(frame)
  })

  tutorialSpotlightsEl.classList.toggle('hidden', tutorialSpotlightsEl.childElementCount === 0)
}

function scrollActiveTutorialTargetIntoView(): void {
  getTutorialFocusHighlight()?.element?.scrollIntoView({
    behavior: 'auto',
    block: 'nearest',
    inline: 'center',
  })
}

function getTutorialBoardHighlightRect(target: TutorialHighlightTarget): DOMRect | null {
  const hex =
    target.type === 'board_tile'
      ? target.hex
      : target.type === 'board_unit'
        ? state.units[target.unitId]?.pos ?? null
        : null
  if (!hex) return null
  const canvasRect = canvas.getBoundingClientRect()
  const center = projectHex(hex)
  const viewportCenterX = canvasRect.left + boardOffset.x + center.x * boardScale
  const viewportCenterY = canvasRect.top + boardOffset.y + center.y * boardScale
  const radiusX = layout.size * boardScale * (target.type === 'board_unit' ? 1.12 : 0.92)
  const radiusY = layout.size * BOARD_TILT * boardScale * (target.type === 'board_unit' ? 1.18 : 0.78)
  return new DOMRect(viewportCenterX - radiusX, viewportCenterY - radiusY, radiusX * 2, radiusY * 2)
}

function getTutorialHighlightRect(target: TutorialHighlightTarget): DOMRect | null {
  const element = findTutorialHighlightElement(target)
  if (element) {
    const rect = element.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) return rect
  }
  if (target.type === 'board_tile' || target.type === 'board_unit') {
    return getTutorialBoardHighlightRect(target)
  }
  return null
}

function clampPanelPosition(left: number, top: number, width: number, height: number, margin: number): { left: number; top: number } {
  return {
    left: clamp(left, margin, Math.max(margin, window.innerWidth - width - margin)),
    top: clamp(top, margin, Math.max(margin, window.innerHeight - height - margin)),
  }
}

function getRectOverlapArea(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number }
): number {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  return width * height
}

function positionTutorialOverlay(): void {
  if (tutorialPanelEl.classList.contains('hidden')) return
  const step = tutorialController.getCurrentStep()
  const rect = tutorialPanelEl.getBoundingClientRect()
  const width = rect.width || 240
  const height = rect.height || 140
  const margin = 12
  const gap = 12
  const focus = getTutorialFocusHighlight()
  const focusRect = focus?.rect ?? null

  let left = window.innerWidth - width - margin
  let top = margin

  if (focusRect) {
    const focusCenterX = focusRect.left + focusRect.width / 2
    const focusCenterY = focusRect.top + focusRect.height / 2
    const rightDockedLeft = window.innerWidth - width - margin
    const forceRightDock = step?.panelPlacement === 'right' || step?.panelPlacement === 'right_above'
    const forceRightAbove = step?.panelPlacement === 'right_above'
    const useRightDock = forceRightDock || (focus ? isQueueLikeTutorialTarget(focus.target) : false)
    const centeredLeft = focusCenterX - width / 2
    const verticalLeft = useRightDock ? rightDockedLeft : centeredLeft
    const sideBias = useRightDock
      ? { right: 180, above: 90, below: 60, left: 0 }
      : { right: 80, above: 40, below: 30, left: 0 }
    const sideCandidates = [
      {
        side: 'right' as const,
        required: width,
        available: window.innerWidth - focusRect.right - margin - gap,
        left: focusRect.right + gap,
        top: focusCenterY - height / 2,
      },
      {
        side: 'above' as const,
        required: height,
        available: focusRect.top - margin - gap,
        left: verticalLeft,
        top: focusRect.top - height - gap,
      },
      {
        side: 'below' as const,
        required: height,
        available: window.innerHeight - focusRect.bottom - margin - gap,
        left: verticalLeft,
        top: focusRect.bottom + gap,
      },
      {
        side: 'left' as const,
        required: width,
        available: focusRect.left - margin - gap,
        left: focusRect.left - width - gap,
        top: focusCenterY - height / 2,
      },
    ]
      .filter((candidate) => candidate.available >= candidate.required)
      .sort((leftCandidate, rightCandidate) => {
        const leftScore = leftCandidate.available + sideBias[leftCandidate.side]
        const rightScore = rightCandidate.available + sideBias[rightCandidate.side]
        return rightScore - leftScore
      })

    if (forceRightAbove) {
      const candidate = clampPanelPosition(rightDockedLeft, focusRect.top - height - gap, width, height, margin)
      left = candidate.left
      top = candidate.top
    } else if (forceRightDock) {
      const candidate = clampPanelPosition(rightDockedLeft, focusCenterY - height / 2, width, height, margin)
      left = candidate.left
      top = candidate.top
    } else if (sideCandidates.length > 0) {
      const candidate = clampPanelPosition(sideCandidates[0].left, sideCandidates[0].top, width, height, margin)
      left = candidate.left
      top = candidate.top
    } else {
      const fallbackCandidates = [
        clampPanelPosition(window.innerWidth - width - margin, margin, width, height, margin),
        clampPanelPosition(window.innerWidth - width - margin, window.innerHeight - height - margin, width, height, margin),
        clampPanelPosition(margin, margin, width, height, margin),
        clampPanelPosition(margin, window.innerHeight - height - margin, width, height, margin),
      ]
      const bestFallback = fallbackCandidates
        .map((candidate) => ({
          ...candidate,
          overlap: getRectOverlapArea(
            { left: candidate.left, top: candidate.top, right: candidate.left + width, bottom: candidate.top + height },
            focusRect
          ),
        }))
        .sort((a, b) => a.overlap - b.overlap)[0]
      left = bestFallback.left
      top = bestFallback.top
    }
  }

  tutorialPanelEl.style.left = `${Math.round(left)}px`
  tutorialPanelEl.style.top = `${Math.round(top)}px`
  tutorialPanelEl.style.right = 'auto'
  tutorialPanelEl.style.bottom = 'auto'
}

function canAdvanceTutorialStepManually(): boolean {
  const step = tutorialController.getCurrentStep()
  if (!step) return false
  return (
    step.completeOn.some((rule) => rule.event === 'manual_next') ||
    step.allowedActions?.some((rule) => rule.action === 'tutorial_next') === true
  )
}

function renderTutorialHub(): void {
  const lessons = tutorialController.listLessons()
  tutorialProgressEl.textContent = `${tutorialController.getCompletedCount()} / ${lessons.length} lessons completed`
  tutorialLessonsEl.innerHTML = lessons
    .map((lesson) => {
      const completed = tutorialController.isLessonCompleted(lesson.id)
      return `
        <article class="tutorial-lesson-card">
          <div class="tutorial-lesson-meta">
            <div class="tutorial-lesson-title-row">
              <div class="tutorial-lesson-title">${lesson.title}</div>
              ${lesson.recommended ? '<span class="pill">Recommended First</span>' : ''}
              ${completed ? '<span class="pill tutorial-complete-pill">Completed</span>' : ''}
            </div>
            <div class="tutorial-lesson-summary">${lesson.summary}</div>
            <div class="tutorial-lesson-estimate">${lesson.estimateMinutes} min</div>
          </div>
          <div class="tutorial-lesson-actions">
            <button class="btn" data-tutorial-start="${lesson.id}" type="button">${completed ? 'Replay' : 'Start'}</button>
          </div>
        </article>
      `
    })
    .join('')

  tutorialLessonsEl.querySelectorAll<HTMLButtonElement>('[data-tutorial-start]').forEach((button) => {
    button.addEventListener('click', () => {
      const lessonId = button.dataset.tutorialStart as TutorialLessonId | undefined
      if (!lessonId) return
      startTutorialLesson(lessonId)
    })
  })
}

function renderTutorialOverlay(): void {
  const session = getTutorialSession()
  if (!session || screen === 'tutorial_hub') {
    tutorialPanelEl.classList.add('hidden')
    tutorialPanelBadgeEl.classList.add('hidden')
    return
  }

  const lesson = tutorialController.getLesson(session.lessonId)
  const step = tutorialController.getCurrentStep()
  const stepNumber = Math.min(session.stepIndex + 1, lesson.steps.length)
  const completed = Boolean(session.completedAt)
  tutorialPanelTitleEl.textContent = lesson.title
  tutorialPanelStepEl.textContent = completed ? `Completed` : `Step ${stepNumber} / ${lesson.steps.length}`
  tutorialPanelBadgeEl.classList.toggle('hidden', !completed)
  tutorialPanelBodyEl.textContent = completed
    ? `${step?.instruction ?? lesson.summary} Lesson complete. Use Tutorial Hub to return.`
    : step?.instruction ?? lesson.summary
  const showNextButton = !completed && canAdvanceTutorialStepManually()
  tutorialPanelActionsEl.classList.toggle('hidden', !showNextButton)
  tutorialPanelNextButton.classList.toggle('hidden', !showNextButton)
  tutorialPanelEl.classList.remove('hidden')
  positionTutorialOverlay()
}

function getTutorialUiKey(): string | null {
  const session = getTutorialSession()
  if (!session) return null
  return `${session.lessonId}:${session.stepIndex}:${session.completedAt ? 'done' : 'active'}`
}

function syncTutorialUi(): void {
  renderTutorialOverlay()
  renderTutorialSpotlights()
  const nextKey = getTutorialUiKey()
  if (nextKey !== lastTutorialUiKey) {
    clearTutorialFeedback()
    scrollActiveTutorialTargetIntoView()
    window.requestAnimationFrame(() => {
      renderTutorialSpotlights()
      positionTutorialOverlay()
    })
    lastTutorialUiKey = nextKey
  }
  if (!nextKey) {
    lastTutorialUiKey = null
  }
}

function notifyTutorialEvent(event: Parameters<TutorialController['recordEvent']>[0], payload: TutorialPayload = {}): void {
  if (!isTutorialLessonActive()) return
  const result = tutorialController.recordEvent(event, payload)
  if (!result.advanced && !result.completed) return
  persistTutorialProgress()
  if (result.completed) {
    setTutorialFeedback('Lesson complete. Use Tutorial Hub to return.')
    if (state.winner !== null) {
      winnerMenuButton.textContent = 'Back to Tutorials'
      winnerResetButton.textContent = 'Replay Lesson'
      winnerRematchButton.classList.add('hidden')
      winnerRematchButton.disabled = true
    }
  }
}

function guardTutorialAction(action: TutorialActionId, payload: TutorialPayload = {}): boolean {
  if (!isTutorialLessonActive()) return true
  const result = tutorialController.canPerform(action, payload)
  if (result.allowed) return true
  setTutorialFeedback(result.message)
  return false
}

function applyTutorialBootstrap(bootstrap: TutorialScenarioBootstrap): void {
  if (mode === 'online') {
    teardownOnlineSession(true)
  }
  tutorialOnlineDemo = bootstrap.onlineDemo ?? null
  applyPlayMode(bootstrap.mode)
  if (bootstrap.gameSettings) {
    gameSettings = normalizeGameSettingsInput(bootstrap.gameSettings)
  }
  if (bootstrap.playerClasses) {
    playerClasses = normalizePlayerClassesInput(bootstrap.playerClasses)
  }
  if (bootstrap.loadouts) {
    loadouts = {
      p1: [...bootstrap.loadouts.p1],
      p2: [...bootstrap.loadouts.p2],
    }
  }
  sanitizeLoadoutsForCurrentClasses()
  if (bootstrap.state) {
    state = cloneGameState(bootstrap.state)
    normalizeLeaderUnitsInState(state)
  } else {
    state = createStandardMatchState()
  }
  roguelikeRun = cloneRoguelikeRunState((bootstrap.roguelikeRun as RoguelikeRunState | null | undefined) ?? null)
  planningPlayer = bootstrap.planningPlayer ?? 0
  selectedCardId = null
  pendingOrder = null
  lastObservedTurn = state.turn
  lastObservedWinner = state.winner
  lastObservedRoguelikeRewardVisible = false
  suppressWinnerModalForRestoredOutcome = false
  winnerModal.classList.add('hidden')
  clearTutorialFeedback()
  refreshOnlineLobbyUi()
  if (tutorialOnlineDemo) {
    onlineRoomInput.value = tutorialOnlineDemo.roomCode
    onlineTokenInput.value = tutorialOnlineDemo.seatToken
    setOnlineLinks('')
    setOnlineStatus(bootstrap.statusMessage ?? '')
  }
  setScreen(bootstrap.screen)
  if (screen === 'game') {
    statusEl.textContent = bootstrap.statusMessage ?? 'Tutorial active.'
    render()
  } else if (screen === 'loadout') {
    renderLoadout()
  } else if (screen === 'menu') {
    if (tutorialOnlineDemo) {
      onlineRoomInput.value = tutorialOnlineDemo.roomCode
      onlineTokenInput.value = tutorialOnlineDemo.seatToken
    }
    setOnlineStatus(bootstrap.statusMessage ?? '')
  }
}

function startTutorialLesson(lessonId: TutorialLessonId): void {
  if (!isTutorialLessonActive() && !isTutorialHubVisible()) {
    persistTutorialReturnSnapshot()
  }
  tutorialController.startLesson(lessonId)
  const bootstrap = cloneTutorialBootstrap(createTutorialScenarioBootstrap(lessonId))
  applyTutorialBootstrap(bootstrap)
}

function returnToTutorialHub(): void {
  tutorialController.clearSession()
  tutorialOnlineDemo = null
  restoreTutorialReturnSnapshot()
  applyPlayMode('tutorial')
  setScreen('tutorial_hub')
}

function leaveTutorialHubToMenu(): void {
  tutorialController.clearSession()
  tutorialOnlineDemo = null
  restoreTutorialReturnSnapshot()
  clearTutorialReturnSnapshot()
  setScreen('menu')
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

function drawLightningArc(from: { x: number; y: number }, to: { x: number; y: number }, progress: number): void {
  const t = easeInOutCubic(progress)
  const end = {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  }
  const segments = 6
  const points: { x: number; y: number }[] = [from]
  for (let index = 1; index <= segments; index += 1) {
    const segmentT = index / segments
    const jitter = Math.sin((segmentT * 7 + progress * 9) * Math.PI) * layout.size * 0.18
    points.push({
      x: from.x + (end.x - from.x) * segmentT + jitter,
      y: from.y + (end.y - from.y) * segmentT,
    })
  }

  const alpha = 0.85 - progress * 0.35
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = Math.max(0.2, alpha)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y)
    else ctx.lineTo(point.x, point.y)
  })
  ctx.strokeStyle = 'rgba(225, 245, 255, 0.95)'
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.strokeStyle = 'rgba(126, 193, 255, 0.95)'
  ctx.lineWidth = 1.5
  ctx.stroke()

  const impactRadius = layout.size * (0.09 + 0.24 * t)
  const impactGradient = ctx.createRadialGradient(end.x, end.y, impactRadius * 0.15, end.x, end.y, impactRadius)
  impactGradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)')
  impactGradient.addColorStop(0.55, 'rgba(147, 212, 255, 0.85)')
  impactGradient.addColorStop(1, 'rgba(86, 144, 215, 0)')
  ctx.fillStyle = impactGradient
  ctx.beginPath()
  ctx.arc(end.x, end.y, impactRadius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawTeleportAnimation(animation: TeleportAnimation, progress: number): void {
  const t = easeInOutCubic(progress)
  const fromCenter = projectHex(animation.from)
  const toCenter = projectHex(animation.to)
  const fromAlpha = Math.max(0, 1 - t)
  const toAlpha = Math.max(0, t)

  const flashRadius = layout.size * (0.35 + 0.55 * t)
  const drawFlash = (center: { x: number; y: number }, intensity: number): void => {
    if (intensity <= 0) return
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = intensity
    const gradient = ctx.createRadialGradient(center.x, center.y, flashRadius * 0.12, center.x, center.y, flashRadius)
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)')
    gradient.addColorStop(0.5, 'rgba(135, 210, 255, 0.75)')
    gradient.addColorStop(1, 'rgba(85, 135, 255, 0)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(center.x, center.y, flashRadius, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  drawFlash(fromCenter, fromAlpha * 0.9)
  drawFlash(toCenter, toAlpha * 0.9)
  drawUnit(animation.fromSnapshot as Unit, fromCenter, fromAlpha)
  drawUnit(animation.toSnapshot as Unit, toCenter, toAlpha)
}

function drawChainLightningAnimation(animation: ChainLightningAnimation, progress: number): void {
  drawLightningArc(projectHex(animation.from), projectHex(animation.to), progress)
}

function drawLightningFizzleAt(center: { x: number; y: number }, progress: number): void {
  const pulse = Math.sin(progress * Math.PI)
  const outerRadius = layout.size * (0.18 + pulse * 0.14)

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = 0.9 - progress * 0.45
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (let index = 0; index < 7; index += 1) {
    const angle = progress * Math.PI * 2.2 + (Math.PI * 2 * index) / 7
    const inner = layout.size * (0.06 + (index % 2) * 0.02)
    const mid = outerRadius * (0.56 + (index % 3) * 0.1)
    const outer = outerRadius * (0.95 + (index % 2) * 0.08)
    const midAngle = angle + (index % 2 === 0 ? 0.22 : -0.2)
    const points = [
      {
        x: center.x + Math.cos(angle) * inner,
        y: center.y + Math.sin(angle) * inner * BOARD_TILT,
      },
      {
        x: center.x + Math.cos(midAngle) * mid,
        y: center.y + Math.sin(midAngle) * mid * BOARD_TILT,
      },
      {
        x: center.x + Math.cos(angle) * outer,
        y: center.y + Math.sin(angle) * outer * BOARD_TILT,
      },
    ]

    ctx.beginPath()
    points.forEach((point, pointIndex) => {
      if (pointIndex === 0) ctx.moveTo(point.x, point.y)
      else ctx.lineTo(point.x, point.y)
    })
    ctx.strokeStyle = 'rgba(230, 245, 255, 0.96)'
    ctx.lineWidth = 2.4
    ctx.stroke()

    ctx.beginPath()
    points.forEach((point, pointIndex) => {
      if (pointIndex === 0) ctx.moveTo(point.x, point.y)
      else ctx.lineTo(point.x, point.y)
    })
    ctx.strokeStyle = 'rgba(120, 190, 255, 0.95)'
    ctx.lineWidth = 1.2
    ctx.stroke()
  }

  const glow = ctx.createRadialGradient(center.x, center.y, outerRadius * 0.1, center.x, center.y, outerRadius * 1.65)
  glow.addColorStop(0, 'rgba(255, 255, 255, 0.88)')
  glow.addColorStop(0.5, 'rgba(140, 205, 255, 0.52)')
  glow.addColorStop(1, 'rgba(90, 150, 255, 0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.ellipse(center.x, center.y, outerRadius * 1.28, outerRadius * BOARD_TILT * 1.08, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawLightningFizzleAnimation(animation: LightningFizzleAnimation, progress: number): void {
  animation.centers.forEach((centerHex) => {
    drawLightningFizzleAt(projectHex(centerHex), progress)
  })
}

function drawSingleSlimeLobArc(fromTile: Hex, toTile: Hex, progress: number): void {
  const from = projectHex(fromTile)
  const to = projectHex(toTile)
  const t = easeInOutCubic(progress)
  const arcHeight = layout.size * 0.9
  const center = {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t - Math.sin(t * Math.PI) * arcHeight,
  }
  const radius = layout.size * (0.13 + 0.05 * Math.sin(progress * Math.PI))

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = 0.45 + Math.sin(progress * Math.PI) * 0.35
  const glow = ctx.createRadialGradient(center.x, center.y, radius * 0.2, center.x, center.y, radius * 1.8)
  glow.addColorStop(0, 'rgba(185, 255, 205, 0.92)')
  glow.addColorStop(0.55, 'rgba(95, 220, 132, 0.86)')
  glow.addColorStop(1, 'rgba(60, 170, 104, 0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.ellipse(center.x, center.y, radius * 1.4, radius, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.globalAlpha = 0.95
  ctx.fillStyle = 'rgba(118, 255, 162, 0.95)'
  ctx.beginPath()
  ctx.ellipse(center.x, center.y, radius, radius * 0.75, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawSlimeLobAnimation(animation: SlimeLobAnimation, progress: number): void {
  animation.arcs.forEach((arc) => {
    drawSingleSlimeLobArc(arc.from, arc.to, progress)
  })
}

function drawSingleVolleyArc(fromTile: Hex, toTile: Hex, progress: number): void {
  const from = projectHex(fromTile)
  const to = projectHex(toTile)
  const t = easeInOutCubic(progress)
  const arcHeight = layout.size * 0.82
  const center = {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t - Math.sin(t * Math.PI) * arcHeight,
  }
  const leadT = Math.min(1, t + 0.04)
  const ahead = {
    x: from.x + (to.x - from.x) * leadT,
    y: from.y + (to.y - from.y) * leadT - Math.sin(leadT * Math.PI) * arcHeight,
  }
  const dx = ahead.x - center.x
  const dy = (ahead.y - center.y) / BOARD_TILT
  const len = Math.hypot(dx, dy) || 1
  const nx = dx / len
  const ny = dy / len
  const perpX = -ny
  const perpY = nx
  const headLength = layout.size * 0.22
  const baseWidth = layout.size * 0.07
  const tailLength = layout.size * 0.26

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.strokeStyle = 'rgba(255, 228, 182, 0.95)'
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(center.x - nx * tailLength, center.y - ny * tailLength)
  ctx.lineTo(center.x, center.y)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(center.x, center.y)
  ctx.lineTo(center.x - nx * headLength + perpX * baseWidth, center.y - ny * headLength + perpY * baseWidth)
  ctx.lineTo(center.x - nx * headLength - perpX * baseWidth, center.y - ny * headLength - perpY * baseWidth)
  ctx.closePath()
  ctx.fillStyle = 'rgba(255, 245, 210, 0.96)'
  ctx.fill()

  const glowRadius = layout.size * 0.16
  const glow = ctx.createRadialGradient(center.x, center.y, glowRadius * 0.2, center.x, center.y, glowRadius)
  glow.addColorStop(0, 'rgba(255, 255, 255, 0.95)')
  glow.addColorStop(0.55, 'rgba(255, 206, 132, 0.88)')
  glow.addColorStop(1, 'rgba(255, 150, 80, 0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(center.x, center.y, glowRadius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawVolleyAnimation(animation: VolleyAnimation, progress: number): void {
  animation.shots.forEach((shot) => {
    drawSingleVolleyArc(shot.from, shot.to, progress)
  })
}

function drawPincerAnimation(animation: PincerAnimation, progress: number): void {
  const t = easeInOutCubic(progress)
  const lunge = Math.sin(t * Math.PI) * 0.34
  const targetKeys = new Set<string>()

  animation.strikes.forEach((strike) => {
    targetKeys.add(`${strike.to.q},${strike.to.r}`)
    const from = projectHex(strike.from)
    const to = projectHex(strike.to)
    const center = {
      x: from.x + (to.x - from.x) * lunge,
      y: from.y + (to.y - from.y) * lunge,
    }
    const snapshotUnit = {
      id: strike.snapshot.id,
      owner: strike.snapshot.owner,
      kind: strike.snapshot.kind,
      strength: strike.snapshot.strength,
      pos: { ...strike.snapshot.pos },
      facing: strike.snapshot.facing,
      modifiers: strike.snapshot.modifiers.map((modifier) => ({ ...modifier })),
      roguelikeRole: strike.snapshot.roguelikeRole,
      isMinion: strike.snapshot.isMinion,
    } as Unit
    drawUnit(snapshotUnit, center, strike.alpha)
  })

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = 0.42 + Math.sin(progress * Math.PI) * 0.35
  targetKeys.forEach((key) => {
    const [q, r] = key.split(',').map(Number)
    const center = projectHex({ q, r })
    const radius = layout.size * (0.22 + 0.18 * Math.sin(progress * Math.PI))
    const glow = ctx.createRadialGradient(center.x, center.y, radius * 0.2, center.x, center.y, radius * 1.4)
    glow.addColorStop(0, 'rgba(255, 255, 255, 0.9)')
    glow.addColorStop(0.55, 'rgba(255, 150, 110, 0.82)')
    glow.addColorStop(1, 'rgba(255, 70, 40, 0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(center.x, center.y, radius * 1.2, 0, Math.PI * 2)
    ctx.fill()
  })
  ctx.restore()
}

function drawBurnDamageAnimation(target: Hex, progress: number): void {
  const center = projectHex(target)
  const pulse = Math.sin(progress * Math.PI)
  const alpha = 0.3 + pulse * 0.7
  const flameHeight = layout.size * (0.44 + pulse * 0.25)
  const baseY = center.y + layout.size * 0.22

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = alpha

  for (let i = -1; i <= 1; i += 1) {
    const offsetX = i * layout.size * 0.16 + Math.sin((progress + i * 0.17) * Math.PI * 10) * layout.size * 0.04
    const topY = baseY - flameHeight * (1 - Math.abs(i) * 0.12)
    const flameWidth = layout.size * (0.12 + pulse * 0.06)

    const flame = ctx.createLinearGradient(center.x + offsetX, baseY, center.x + offsetX, topY)
    flame.addColorStop(0, 'rgba(255, 70, 20, 0.95)')
    flame.addColorStop(0.55, 'rgba(255, 150, 40, 0.92)')
    flame.addColorStop(1, 'rgba(255, 245, 160, 0.9)')
    ctx.fillStyle = flame
    ctx.beginPath()
    ctx.moveTo(center.x + offsetX - flameWidth, baseY)
    ctx.quadraticCurveTo(center.x + offsetX - flameWidth * 0.4, topY + flameHeight * 0.45, center.x + offsetX, topY)
    ctx.quadraticCurveTo(center.x + offsetX + flameWidth * 0.4, topY + flameHeight * 0.45, center.x + offsetX + flameWidth, baseY)
    ctx.closePath()
    ctx.fill()
  }

  const scorchRadius = layout.size * (0.3 + pulse * 0.12)
  const scorchGlow = ctx.createRadialGradient(
    center.x,
    center.y + layout.size * 0.1,
    scorchRadius * 0.2,
    center.x,
    center.y + layout.size * 0.1,
    scorchRadius
  )
  scorchGlow.addColorStop(0, 'rgba(255, 180, 80, 0.75)')
  scorchGlow.addColorStop(1, 'rgba(150, 20, 0, 0)')
  ctx.fillStyle = scorchGlow
  ctx.beginPath()
  ctx.ellipse(center.x, center.y + layout.size * 0.08, scorchRadius, scorchRadius * BOARD_TILT, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
}

function drawExecuteAnimation(target: Hex, progress: number): void {
  const center = projectHex(target)
  const pulse = Math.sin(progress * Math.PI)
  const alpha = 0.35 + pulse * 0.65
  const size = layout.size * (0.3 + pulse * 0.2)
  const thickness = Math.max(2, layout.size * (0.06 + pulse * 0.04))

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = alpha
  ctx.strokeStyle = 'rgba(255, 60, 60, 0.96)'
  ctx.lineWidth = thickness
  ctx.lineCap = 'round'

  ctx.beginPath()
  ctx.moveTo(center.x - size, center.y - size * BOARD_TILT)
  ctx.lineTo(center.x + size, center.y + size * BOARD_TILT)
  ctx.moveTo(center.x + size, center.y - size * BOARD_TILT)
  ctx.lineTo(center.x - size, center.y + size * BOARD_TILT)
  ctx.stroke()

  const glowRadius = size * 1.6
  const glow = ctx.createRadialGradient(center.x, center.y, glowRadius * 0.2, center.x, center.y, glowRadius)
  glow.addColorStop(0, 'rgba(255, 220, 220, 0.9)')
  glow.addColorStop(0.55, 'rgba(255, 90, 90, 0.75)')
  glow.addColorStop(1, 'rgba(255, 0, 0, 0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.ellipse(center.x, center.y, glowRadius, glowRadius * BOARD_TILT, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawWhirlwindAnimation(origin: Hex, progress: number): void {
  const center = projectHex(origin)
  const pulse = Math.sin(progress * Math.PI)
  const spin = progress * Math.PI * 4
  const spread = layout.size * (0.42 + pulse * 0.32)

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = 0.35 + pulse * 0.55
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.96)'
  ctx.lineCap = 'round'

  for (let i = 0; i < 3; i += 1) {
    const radius = spread + i * layout.size * 0.17
    const start = spin + (i * Math.PI * 2) / 3
    const end = start + Math.PI * (0.84 + i * 0.07)
    ctx.lineWidth = Math.max(2, layout.size * (0.14 - i * 0.03))
    ctx.beginPath()
    ctx.ellipse(center.x, center.y, radius, radius * BOARD_TILT, 0, start, end)
    ctx.stroke()
  }

  const glow = ctx.createRadialGradient(center.x, center.y, spread * 0.15, center.x, center.y, spread * 1.25)
  glow.addColorStop(0, 'rgba(255, 255, 255, 0.6)')
  glow.addColorStop(0.7, 'rgba(255, 255, 255, 0.2)')
  glow.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.ellipse(center.x, center.y, spread * 1.2, spread * BOARD_TILT, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawAdjacentStrikeAnimation(origin: Hex, progress: number): void {
  const center = projectHex(origin)
  const pulse = Math.sin(progress * Math.PI)
  const alpha = 0.35 + pulse * 0.65
  const radius = layout.size * (0.36 + pulse * 0.18)

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = alpha

  for (let direction = 0 as Direction; direction < 6; direction += 1) {
    const targetCenter = projectHex(neighbor(origin, direction))
    const dx = targetCenter.x - center.x
    const dy = targetCenter.y - center.y
    const length = Math.hypot(dx, dy)
    if (length <= 0.001) continue
    const nx = dx / length
    const ny = dy / length
    const start = {
      x: center.x + nx * (layout.size * 0.32),
      y: center.y + ny * (layout.size * 0.32),
    }
    const end = {
      x: start.x + nx * radius,
      y: start.y + ny * radius,
    }

    ctx.strokeStyle = 'rgba(255, 235, 190, 0.95)'
    ctx.lineWidth = Math.max(1.6, layout.size * 0.07)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
    ctx.stroke()
  }

  const ring = ctx.createRadialGradient(center.x, center.y, radius * 0.3, center.x, center.y, radius * 1.2)
  ring.addColorStop(0, 'rgba(255, 255, 230, 0.85)')
  ring.addColorStop(0.6, 'rgba(255, 170, 90, 0.65)')
  ring.addColorStop(1, 'rgba(255, 80, 40, 0)')
  ctx.fillStyle = ring
  ctx.beginPath()
  ctx.ellipse(center.x, center.y, radius * 1.1, radius * BOARD_TILT, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawTrapTriggerAnimation(animation: TrapTriggerAnimation, progress: number): void {
  const center = projectHex(animation.target)
  const t = easeInOutCubic(progress)
  const alpha = 1 - t
  const radius = layout.size * (0.18 + 0.65 * t)

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = alpha
  const trapImage = trapImages[animation.trapKind]
  if (trapImage?.loaded) {
    drawAnchoredImageTo(ctx, trapImage, center, 1.15 + t * 0.18, 0.78)
  }

  if (animation.trapKind === 'pitfall') {
    ctx.strokeStyle = 'rgba(147, 102, 45, 0.95)'
    ctx.lineWidth = 2.6
    ctx.beginPath()
    ctx.ellipse(center.x, center.y, radius, radius * BOARD_TILT, 0, 0, Math.PI * 2)
    ctx.stroke()

    const dust = ctx.createRadialGradient(center.x, center.y, radius * 0.2, center.x, center.y, radius * 1.2)
    dust.addColorStop(0, 'rgba(170, 122, 60, 0.72)')
    dust.addColorStop(1, 'rgba(90, 56, 24, 0)')
    ctx.fillStyle = dust
    ctx.beginPath()
    ctx.ellipse(center.x, center.y, radius * 1.15, radius * 0.85 * BOARD_TILT, 0, 0, Math.PI * 2)
    ctx.fill()
  } else {
    const burst = ctx.createRadialGradient(center.x, center.y, radius * 0.1, center.x, center.y, radius * 1.2)
    burst.addColorStop(0, 'rgba(255, 245, 190, 0.95)')
    burst.addColorStop(0.45, 'rgba(255, 156, 60, 0.92)')
    burst.addColorStop(1, 'rgba(195, 75, 22, 0)')
    ctx.fillStyle = burst
    ctx.beginPath()
    ctx.arc(center.x, center.y, radius * 1.15, 0, Math.PI * 2)
    ctx.fill()

    ctx.strokeStyle = 'rgba(255, 210, 165, 0.95)'
    ctx.lineWidth = 2
    for (let i = 0; i < 6; i += 1) {
      const angle = (Math.PI * 2 * i) / 6
      const inner = layout.size * (0.08 + 0.2 * t)
      const outer = layout.size * (0.24 + 0.52 * t)
      ctx.beginPath()
      ctx.moveTo(center.x + Math.cos(angle) * inner, center.y + Math.sin(angle) * inner * BOARD_TILT)
      ctx.lineTo(center.x + Math.cos(angle) * outer, center.y + Math.sin(angle) * outer * BOARD_TILT)
      ctx.stroke()
    }
  }

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

function getLineProjectilePose(
  animation: LineProjectileAnimation,
  progress: number,
  hitTravelEnd: number
): {
  start: { x: number; y: number }
  current: { x: number; y: number }
  nx: number
  ny: number
  perpX: number
  perpY: number
  fadeAlpha: number
} {
  const start = projectHex(animation.from)
  const end = projectHex(animation.to)
  const travelWindow = animation.fizzle ? 1 : hitTravelEnd
  const travelProgress = clamp(progress / travelWindow, 0, 1)
  const travelT = easeInOutCubic(travelProgress)
  const current = {
    x: start.x + (end.x - start.x) * travelT,
    y: start.y + (end.y - start.y) * travelT,
  }
  const dx = end.x - start.x
  const dy = (end.y - start.y) / BOARD_TILT
  const len = Math.hypot(dx, dy) || 1
  const nx = dx / len
  const ny = dy / len
  const perpX = -ny
  const perpY = nx
  const fadeAlpha = animation.fizzle ? 1 - clamp((progress - 0.72) / 0.28, 0, 1) : 1
  return { start, current, nx, ny, perpX, perpY, fadeAlpha }
}

function drawArrowProjectile(animation: LineProjectileAnimation, progress: number): void {
  const pose = getLineProjectilePose(animation, progress, 1)
  const headLength = layout.size * 0.22
  const baseWidth = layout.size * 0.08
  const tailLength = layout.size * 0.28

  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = pose.fadeAlpha
  ctx.strokeStyle = 'rgba(25, 20, 18, 0.8)'
  ctx.lineWidth = 2

  const tailX = pose.current.x - pose.nx * tailLength
  const tailY = pose.current.y - pose.ny * tailLength
  ctx.beginPath()
  ctx.moveTo(tailX, tailY)
  ctx.lineTo(pose.current.x, pose.current.y)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(pose.current.x, pose.current.y)
  ctx.lineTo(
    pose.current.x - pose.nx * headLength + pose.perpX * baseWidth,
    pose.current.y - pose.ny * headLength + pose.perpY * baseWidth
  )
  ctx.lineTo(
    pose.current.x - pose.nx * headLength - pose.perpX * baseWidth,
    pose.current.y - pose.ny * headLength - pose.perpY * baseWidth
  )
  ctx.closePath()
  ctx.fillStyle = 'rgba(25, 20, 18, 0.9)'
  ctx.fill()
  ctx.restore()
}

function drawHarpoonAnimation(animation: HarpoonAnimation, progress: number): void {
  const start = projectHex(animation.from)
  const end = projectHex(animation.to)
  const phase = progress < 0.5 ? 'extend' : 'retract'
  const phaseProgress = easeInOutCubic(phase === 'extend' ? progress * 2 : (progress - 0.5) * 2)

  const tip =
    phase === 'extend'
      ? {
          x: start.x + (end.x - start.x) * phaseProgress,
          y: start.y + (end.y - start.y) * phaseProgress,
        }
      : {
          x: end.x + (start.x - end.x) * phaseProgress,
          y: end.y + (start.y - end.y) * phaseProgress,
        }

  const dirX = phase === 'extend' ? end.x - start.x : start.x - end.x
  const dirY = phase === 'extend' ? (end.y - start.y) / BOARD_TILT : (start.y - end.y) / BOARD_TILT
  const len = Math.hypot(dirX, dirY) || 1
  const nx = dirX / len
  const ny = dirY / len
  const perpX = -ny
  const perpY = nx
  const headLength = layout.size * 0.24
  const baseWidth = layout.size * 0.1
  const tailLength = layout.size * 0.24

  const tailX = tip.x - nx * tailLength
  const tailY = tip.y - ny * tailLength
  const alpha = animation.fizzle ? 1 - clamp((progress - 0.72) / 0.28, 0, 1) : 1

  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = 'rgba(89, 71, 53, 0.9)'
  ctx.lineWidth = 2.4
  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  ctx.lineTo(tip.x, tip.y)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(tailX, tailY)
  ctx.lineTo(tip.x, tip.y)
  ctx.strokeStyle = 'rgba(25, 20, 18, 0.85)'
  ctx.lineWidth = 1.6
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(tip.x, tip.y)
  ctx.lineTo(tip.x - nx * headLength + perpX * baseWidth, tip.y - ny * headLength + perpY * baseWidth)
  ctx.lineTo(tip.x - nx * headLength - perpX * baseWidth, tip.y - ny * headLength - perpY * baseWidth)
  ctx.closePath()
  ctx.fillStyle = 'rgba(25, 20, 18, 0.95)'
  ctx.fill()
  ctx.restore()

  if (phase === 'retract' && animation.pulledUnit) {
    const fromCenter = projectHex(animation.pulledUnit.from)
    const toCenter = projectHex(animation.pulledUnit.to)
    const center = {
      x: fromCenter.x + (toCenter.x - fromCenter.x) * phaseProgress,
      y: fromCenter.y + (toCenter.y - fromCenter.y) * phaseProgress,
    }
    const pulled = {
      id: animation.pulledUnit.id,
      owner: animation.pulledUnit.snapshot.owner,
      kind: animation.pulledUnit.snapshot.kind,
      strength: animation.pulledUnit.snapshot.strength,
      pos: { ...animation.pulledUnit.snapshot.pos },
      facing: animation.pulledUnit.snapshot.facing,
      modifiers: animation.pulledUnit.snapshot.modifiers.map((modifier) => ({ ...modifier })),
    } as Unit
    drawUnit(pulled, center, 0.9)
  }
}

function drawFlameThrower(from: Hex, to: Hex, progress: number): void {
  const start = projectHex(from)
  const end = projectHex(to)
  const t = easeInOutCubic(progress)
  const current = {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  }
  const dx = current.x - start.x
  const dy = current.y - start.y
  const len = Math.hypot(dx, dy) || 1
  const nx = dx / len
  const ny = dy / len
  const perpX = -ny
  const perpY = nx

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'

  for (let layer = 0; layer < 4; layer += 1) {
    ctx.globalAlpha = 0.28 + 0.16 * (1 - layer / 4)
    ctx.strokeStyle = layer < 2 ? 'rgba(255, 110, 40, 0.95)' : 'rgba(255, 225, 160, 0.9)'
    ctx.lineWidth = Math.max(2, layout.size * (0.28 - layer * 0.04))
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    for (let segment = 1; segment <= 7; segment += 1) {
      const segT = segment / 7
      const jitter = Math.sin((segT * 8 + progress * 9 + layer) * Math.PI) * layout.size * (0.08 - layer * 0.012)
      ctx.lineTo(start.x + dx * segT + perpX * jitter, start.y + dy * segT + perpY * jitter)
    }
    ctx.stroke()
  }

  for (let ember = 0; ember < 7; ember += 1) {
    const emberT = Math.max(0, t - ember * 0.08)
    const center = {
      x: start.x + (end.x - start.x) * emberT,
      y: start.y + (end.y - start.y) * emberT,
    }
    const radius = layout.size * (0.07 + 0.05 * Math.sin((progress + ember * 0.14) * Math.PI))
    const glow = ctx.createRadialGradient(center.x, center.y, radius * 0.15, center.x, center.y, radius * 1.8)
    glow.addColorStop(0, 'rgba(255, 255, 220, 0.95)')
    glow.addColorStop(0.5, 'rgba(255, 175, 90, 0.88)')
    glow.addColorStop(1, 'rgba(255, 85, 35, 0)')
    ctx.globalAlpha = 0.42 + 0.38 * (1 - ember / 7)
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(center.x, center.y, radius * 1.45, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function drawIceBoltProjectile(animation: LineProjectileAnimation, progress: number): void {
  const pose = getLineProjectilePose(animation, progress, 0.82)
  const headLength = layout.size * 0.28
  const baseWidth = layout.size * 0.1

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = 0.95 * pose.fadeAlpha
  ctx.strokeStyle = 'rgba(180, 235, 255, 0.95)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(pose.current.x - pose.nx * headLength * 0.95, pose.current.y - pose.ny * headLength * 0.95)
  ctx.lineTo(pose.current.x, pose.current.y)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(pose.current.x, pose.current.y)
  ctx.lineTo(
    pose.current.x - pose.nx * headLength + pose.perpX * baseWidth,
    pose.current.y - pose.ny * headLength + pose.perpY * baseWidth
  )
  ctx.lineTo(pose.current.x - pose.nx * headLength * 0.3, pose.current.y - pose.ny * headLength * 0.3)
  ctx.lineTo(
    pose.current.x - pose.nx * headLength - pose.perpX * baseWidth,
    pose.current.y - pose.ny * headLength - pose.perpY * baseWidth
  )
  ctx.closePath()
  ctx.fillStyle = 'rgba(205, 245, 255, 0.96)'
  ctx.fill()

  const glowRadius = layout.size * 0.22
  const glow = ctx.createRadialGradient(
    pose.current.x,
    pose.current.y,
    glowRadius * 0.15,
    pose.current.x,
    pose.current.y,
    glowRadius
  )
  glow.addColorStop(0, 'rgba(255, 255, 255, 0.95)')
  glow.addColorStop(0.55, 'rgba(130, 205, 255, 0.88)')
  glow.addColorStop(1, 'rgba(78, 150, 255, 0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(pose.current.x, pose.current.y, glowRadius, 0, Math.PI * 2)
  ctx.fill()

  if (!animation.fizzle && animation.target) {
    const target = projectHex(animation.target)
    const tint = clamp((progress - 0.58) / 0.42, 0, 1)
    if (tint > 0) {
      const radius = layout.size * (0.42 + tint * 0.12)
      const frost = ctx.createRadialGradient(target.x, target.y, radius * 0.15, target.x, target.y, radius)
      frost.addColorStop(0, 'rgba(220, 248, 255, 0.8)')
      frost.addColorStop(0.55, 'rgba(120, 190, 255, 0.48)')
      frost.addColorStop(1, 'rgba(70, 120, 220, 0)')
      ctx.globalAlpha = tint * 0.95
      ctx.fillStyle = frost
      ctx.beginPath()
      ctx.ellipse(target.x, target.y, radius, radius * BOARD_TILT, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

function drawFireballProjectile(animation: LineProjectileAnimation, progress: number): void {
  const pose = getLineProjectilePose(animation, progress, 0.72)
  const radius = layout.size * (0.18 + 0.06 * Math.sin(progress * Math.PI))

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = pose.fadeAlpha
  const trail = ctx.createLinearGradient(pose.start.x, pose.start.y, pose.current.x, pose.current.y)
  trail.addColorStop(0, 'rgba(255, 120, 40, 0)')
  trail.addColorStop(1, 'rgba(255, 188, 90, 0.82)')
  ctx.strokeStyle = trail
  ctx.lineWidth = Math.max(2, layout.size * 0.11)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(pose.start.x, pose.start.y)
  ctx.lineTo(pose.current.x, pose.current.y)
  ctx.stroke()

  const glow = ctx.createRadialGradient(
    pose.current.x,
    pose.current.y,
    radius * 0.15,
    pose.current.x,
    pose.current.y,
    radius * 1.8
  )
  glow.addColorStop(0, 'rgba(255, 255, 225, 0.95)')
  glow.addColorStop(0.45, 'rgba(255, 180, 70, 0.95)')
  glow.addColorStop(1, 'rgba(220, 78, 18, 0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(pose.current.x, pose.current.y, radius * 1.6, 0, Math.PI * 2)
  ctx.fill()

  if (!animation.fizzle && animation.target && progress > 0.66) {
    const target = projectHex(animation.target)
    const burstT = (progress - 0.66) / 0.34
    const burstRadius = layout.size * (0.28 + burstT * 1.35)
    ctx.globalAlpha = Math.max(0.12, 0.88 - burstT * 0.58)
    ctx.strokeStyle = 'rgba(255, 165, 90, 0.95)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(target.x, target.y, burstRadius, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

function drawLineProjectileAnimation(animation: LineProjectileAnimation, progress: number): void {
  if (animation.projectile === 'arrow') {
    drawArrowProjectile(animation, progress)
    return
  }
  if (animation.projectile === 'iceBolt') {
    drawIceBoltProjectile(animation, progress)
    return
  }
  drawFireballProjectile(animation, progress)
}

function drawBlizzardAnimation(animation: BlizzardAnimation, progress: number): void {
  const center = projectHex(animation.target)
  const pulse = Math.sin(progress * Math.PI)
  const radius = layout.size * (0.95 + animation.radius * 1.05 + pulse * 0.24)

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = 0.34 + pulse * 0.38
  const glow = ctx.createRadialGradient(center.x, center.y, radius * 0.2, center.x, center.y, radius * 1.2)
  glow.addColorStop(0, 'rgba(245, 250, 255, 0.82)')
  glow.addColorStop(0.55, 'rgba(170, 215, 255, 0.5)')
  glow.addColorStop(1, 'rgba(120, 170, 235, 0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.ellipse(center.x, center.y, radius, radius * BOARD_TILT, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = 'rgba(225, 245, 255, 0.92)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.ellipse(center.x, center.y, radius * 0.95, radius * 0.95 * BOARD_TILT, 0, 0, Math.PI * 2)
  ctx.stroke()

  for (let i = 0; i < 12; i += 1) {
    const angle = (Math.PI * 2 * i) / 12 + progress * Math.PI
    const dist = radius * (0.2 + ((i % 4) / 4) * 0.7)
    const snowX = center.x + Math.cos(angle) * dist
    const snowY = center.y + Math.sin(angle) * dist * BOARD_TILT
    const size = layout.size * 0.05
    ctx.beginPath()
    ctx.moveTo(snowX - size, snowY)
    ctx.lineTo(snowX + size, snowY)
    ctx.moveTo(snowX, snowY - size)
    ctx.lineTo(snowX, snowY + size)
    ctx.stroke()
  }
  ctx.restore()
}

function drawLightningBarrierAnimation(animation: LightningBarrierAnimation, progress: number): void {
  animation.arcs.forEach((arc) => {
    drawLightningArc(projectHex(arc.from), projectHex(arc.to), progress)
  })
}

function drawBrainFreezeAnimation(progress: number): void {
  const center = { x: layout.width / 2, y: layout.height * 0.36 }
  const coverRadius = Math.hypot(layout.width * 0.72, layout.height * 0.72)
  const fadeStart = 0.72
  const fadeT = progress <= fadeStart ? 0 : (progress - fadeStart) / (1 - fadeStart)
  const alpha = 0.82 * (1 - fadeT)
  const size = layout.size * 0.55 + coverRadius * progress

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.globalAlpha = alpha
  ctx.strokeStyle = 'rgba(220, 245, 255, 0.96)'
  ctx.lineWidth = 3
  for (let arm = 0; arm < 6; arm += 1) {
    const angle = (Math.PI * 2 * arm) / 6
    const innerX = center.x + Math.cos(angle) * size * 0.12
    const innerY = center.y + Math.sin(angle) * size * 0.12
    const outerX = center.x + Math.cos(angle) * size
    const outerY = center.y + Math.sin(angle) * size
    ctx.beginPath()
    ctx.moveTo(innerX, innerY)
    ctx.lineTo(outerX, outerY)
    ctx.stroke()

    const branchBaseX = center.x + Math.cos(angle) * size * 0.62
    const branchBaseY = center.y + Math.sin(angle) * size * 0.62
    const left = angle - Math.PI / 6
    const right = angle + Math.PI / 6
    ctx.beginPath()
    ctx.moveTo(branchBaseX, branchBaseY)
    ctx.lineTo(branchBaseX + Math.cos(left) * size * 0.2, branchBaseY + Math.sin(left) * size * 0.2)
    ctx.moveTo(branchBaseX, branchBaseY)
    ctx.lineTo(branchBaseX + Math.cos(right) * size * 0.2, branchBaseY + Math.sin(right) * size * 0.2)
    ctx.stroke()
  }

  const glow = ctx.createRadialGradient(center.x, center.y, size * 0.08, center.x, center.y, size * 1.25)
  glow.addColorStop(0, 'rgba(255, 255, 255, 0.75)')
  glow.addColorStop(0.6, 'rgba(170, 220, 255, 0.32)')
  glow.addColorStop(1, 'rgba(120, 170, 255, 0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.ellipse(center.x, center.y, size * 1.08, size * 0.92, 0, 0, Math.PI * 2)
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

function getVisibleTraps(sourceState: GameState): Trap[] {
  const traps = sourceState.traps ?? []
  if (mode === 'online') return traps
  return traps.filter((trap) => trap.owner === planningPlayer)
}

function getTrapRenderKey(trap: Trap): string {
  return `${trap.owner}:${trap.kind}:${trap.pos.q},${trap.pos.r}`
}

function getPreviewGhostTraps(previewSource: GameState, baseSource: GameState): Trap[] {
  const visibleBase = new Set(getVisibleTraps(baseSource).map((trap) => getTrapRenderKey(trap)))
  return getVisibleTraps(previewSource).filter((trap) => !visibleBase.has(getTrapRenderKey(trap)))
}

function drawTrapMarker(trap: Trap): void {
  const center = projectHex(trap.pos)
  const trapImage = trapImages[trap.kind]
  if (trapImage?.loaded) {
    ctx.save()
    drawAnchoredImageTo(ctx, trapImage, center, 1.15, 0.78)
    ctx.restore()
    return
  }

  const size = layout.size * 0.48
  const half = size / 2
  const baseFill = trap.kind === 'pitfall' ? 'rgba(122, 82, 38, 0.9)' : 'rgba(164, 88, 34, 0.9)'
  const innerFill = trap.kind === 'pitfall' ? 'rgba(81, 53, 22, 0.92)' : 'rgba(231, 136, 58, 0.94)'
  const stroke = trap.kind === 'pitfall' ? 'rgba(48, 28, 12, 0.95)' : 'rgba(78, 36, 14, 0.95)'

  ctx.save()
  ctx.fillStyle = baseFill
  ctx.strokeStyle = stroke
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.rect(center.x - half, center.y - half, size, size)
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = innerFill
  ctx.beginPath()
  ctx.rect(center.x - half * 0.55, center.y - half * 0.55, size * 0.55, size * 0.55)
  ctx.fill()

  if (trap.kind === 'explosive') {
    ctx.strokeStyle = 'rgba(255, 228, 190, 0.95)'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(center.x - half * 0.2, center.y)
    ctx.lineTo(center.x + half * 0.2, center.y)
    ctx.moveTo(center.x, center.y - half * 0.2)
    ctx.lineTo(center.x, center.y + half * 0.2)
    ctx.stroke()
  }
  ctx.restore()
}

function drawGhostTrapMarker(trap: Trap): void {
  const center = projectHex(trap.pos)
  const trapImage = trapImages[trap.kind]
  if (trapImage?.loaded) {
    ctx.save()
    ctx.globalAlpha = 0.5
    ctx.filter = 'grayscale(1) brightness(1.9)'
    drawAnchoredImageTo(ctx, trapImage, center, 1.15, 0.78)
    ctx.filter = 'none'
    ctx.strokeStyle = 'rgba(220, 242, 255, 0.9)'
    ctx.lineWidth = 1.6
    ctx.setLineDash([5, 4])
    ctx.beginPath()
    ctx.ellipse(center.x, center.y + layout.size * 0.1, layout.size * 0.42, layout.size * 0.26 * BOARD_TILT, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
    return
  }

  const size = layout.size * 0.48
  const half = size / 2
  ctx.save()
  ctx.globalAlpha = 0.52
  ctx.strokeStyle = 'rgba(220, 242, 255, 0.92)'
  ctx.lineWidth = 1.5
  ctx.setLineDash([5, 4])
  ctx.beginPath()
  ctx.rect(center.x - half, center.y - half, size, size)
  ctx.stroke()
  ctx.restore()
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
  pruneRoguelikeMonsterVariants(state, previewState && state.phase === 'planning' ? previewState : null)

  const showMonsterSpawnTiles = mode !== 'roguelike'
  const spawnTop = getSpawnTiles(state, 0)
  const spawnBottom = showMonsterSpawnTiles ? getSpawnTiles(state, 1) : []
  const spawnTopKeys = new Set(spawnTop.map((tile) => `${tile.q},${tile.r}`))
  const spawnBottomKeys = new Set(spawnBottom.map((tile) => `${tile.q},${tile.r}`))

  for (const tile of [...state.tiles].sort((a, b) => {
    const rowDelta = a.r - b.r
    if (rowDelta !== 0) return rowDelta
    const overlayDelta = getTileRenderAdjustment(a.kind).rowOverlayPriority - getTileRenderAdjustment(b.kind).rowOverlayPriority
    if (overlayDelta !== 0) return overlayDelta
    return a.q - b.q
  })) {
    const center = projectHex({ q: tile.q, r: tile.r })
    const tileAsset = getTileImage(tile)
    const adjustment = getTileRenderAdjustment(tile.kind)
    if (tileAsset?.loaded) {
      drawAnchoredImage(tileAsset, center, TILE_IMAGE_SCALE, TILE_ANCHOR_Y, adjustment.offsetX, adjustment.offsetY)
    } else {
      const corners = polygonCornersProjected(center, layout.size - TILE_GAP)
      ctx.beginPath()
      corners.forEach((corner, index) => {
        if (index === 0) ctx.moveTo(corner.x, corner.y)
        else ctx.lineTo(corner.x, corner.y)
      })
      ctx.closePath()
      ctx.fillStyle = '#1f2442'
      ctx.fill()
    }
  }

  const structures: { pos: Hex; owner: PlayerId }[] = []
  for (const tile of state.tiles) {
    const key = tile.id
    if (spawnTopKeys.has(key) || spawnBottomKeys.has(key)) {
      structures.push({
        pos: { q: tile.q, r: tile.r },
        owner: spawnTopKeys.has(key) ? 0 : 1,
      })
    }
  }

  structures
    .sort((a, b) => a.pos.r - b.pos.r || a.pos.q - b.pos.q)
    .forEach((item) => {
      const center = projectHex(item.pos)
      drawStructureSprite(
        center,
        item.owner,
        spawnBaseImage,
        spawnTeamImage,
        spawnTeamCache,
        SPAWN_IMAGE_SCALE,
        SPAWN_ANCHOR_Y
      )
    })

  getVisibleTraps(state)
    .filter((trap) => isTile(trap.pos))
    .sort((a, b) => a.pos.r - b.pos.r || a.pos.q - b.pos.q)
    .forEach((trap) => {
      drawTrapMarker(trap)
    })
  if (previewState && state.phase === 'planning') {
    getPreviewGhostTraps(previewState, state)
      .filter((trap) => isTile(trap.pos))
      .sort((a, b) => a.pos.r - b.pos.r || a.pos.q - b.pos.q)
      .forEach((trap) => {
        drawGhostTrapMarker(trap)
      })
  }

  drawSelectableHighlights()
  drawTutorialBoardHighlights()

  if (previewState && state.phase === 'planning') {
    drawPlannedMoves(state)
  }

  const boardUnits = animationRenderUnits ?? state.units
  const drawableUnits = Object.values(boardUnits)
    .filter((unit) => !(currentAnimation?.type === 'harpoon' && currentAnimation.pulledUnit?.id === unit.id))
    .filter((unit) => !(currentAnimation?.type === 'teleport' && currentAnimation.unitId === unit.id))
    .map((unit) => ({
      unit,
      center: getAnimatedCenter(unit),
    }))
    .sort((a, b) => a.center.y - b.center.y || a.center.x - b.center.x || a.unit.id.localeCompare(b.unit.id))

  drawableUnits.forEach(({ unit, center }) => {
    const alphaOverride = unitAlphaOverrides.get(unit.id) ?? 1
    if (alphaOverride <= 0) return
    drawUnit(unit, center, alphaOverride)
  })

  if (currentAnimation?.type === 'lightning') {
    drawLightningStrike(projectHex(currentAnimation.target), animationProgress)
  }

  if (currentAnimation?.type === 'burn') {
    drawBurnDamageAnimation(currentAnimation.target, animationProgress)
  }

  if (currentAnimation?.type === 'adjacentStrike') {
    drawAdjacentStrikeAnimation(currentAnimation.origin, animationProgress)
  }

  if (currentAnimation?.type === 'whirlwind') {
    drawWhirlwindAnimation(currentAnimation.origin, animationProgress)
  }

  if (currentAnimation?.type === 'trapTrigger') {
    drawTrapTriggerAnimation(currentAnimation, animationProgress)
  }

  if (currentAnimation?.type === 'meteor') {
    drawMeteorImpact(currentAnimation.target, animationProgress)
  }

  if (currentAnimation?.type === 'lineProjectile') {
    drawLineProjectileAnimation(currentAnimation, animationProgress)
  }

  if (currentAnimation?.type === 'chainLightning') {
    drawChainLightningAnimation(currentAnimation, animationProgress)
  }

  if (currentAnimation?.type === 'lightningFizzle') {
    drawLightningFizzleAnimation(currentAnimation, animationProgress)
  }

  if (currentAnimation?.type === 'slimeLob') {
    drawSlimeLobAnimation(currentAnimation, animationProgress)
  }

  if (currentAnimation?.type === 'volley') {
    drawVolleyAnimation(currentAnimation, animationProgress)
  }

  if (currentAnimation?.type === 'pincer') {
    drawPincerAnimation(currentAnimation, animationProgress)
  }

  if (currentAnimation?.type === 'teleport') {
    drawTeleportAnimation(currentAnimation, animationProgress)
  }

  if (currentAnimation?.type === 'harpoon') {
    drawHarpoonAnimation(currentAnimation, animationProgress)
  }

  if (currentAnimation?.type === 'flameThrower') {
    drawFlameThrower(currentAnimation.from, currentAnimation.to, animationProgress)
  }

  if (currentAnimation?.type === 'blizzard') {
    drawBlizzardAnimation(currentAnimation, animationProgress)
  }

  if (currentAnimation?.type === 'lightningBarrier') {
    drawLightningBarrierAnimation(currentAnimation, animationProgress)
  }

  if (currentAnimation?.type === 'brainFreeze') {
    drawBrainFreezeAnimation(animationProgress)
  }

  if (currentAnimation?.type === 'death') {
    drawDeathGhostUnit(currentAnimation.unit, getAnimationAlpha())
  }

  pendingDeathUnits.forEach((unit) => {
    if (currentAnimation?.type === 'death' && currentAnimation.unit.id === unit.id) return
    const alpha = unitAlphaOverrides.get(unit.id) ?? deathAlphaOverrides.get(unit.id) ?? 1
    if (alpha <= 0) return
    drawDeathGhostUnit(unit, alpha)
  })

  if (currentAnimation?.type === 'execute') {
    drawExecuteAnimation(currentAnimation.target, animationProgress)
  }

  if (currentAnimation?.type === 'strengthChange') {
    drawStrengthChangeAnimation(currentAnimation, animationProgress)
  }

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

  const isUnitStep = nextStep === 'unit' || nextStep === 'unit2'
  const isDirectionStep = nextStep === 'direction' || nextStep === 'moveDirection' || nextStep === 'faceDirection'
  const useDirectionArrows = isDirectionStep
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

function drawTutorialBoardHighlights(): void {
  if (!isTutorialLessonActive()) return
  const pulse = 0.55 + Math.abs(Math.sin(performance.now() / 320)) * 0.45
  getActiveTutorialHighlights().forEach((highlight) => {
    if (highlight.type === 'board_tile') {
      const center = projectHex(highlight.hex)
      const corners = polygonCornersProjected(center, layout.size - 2)
      ctx.save()
      ctx.globalAlpha = pulse
      ctx.beginPath()
      corners.forEach((corner, index) => {
        if (index === 0) ctx.moveTo(corner.x, corner.y)
        else ctx.lineTo(corner.x, corner.y)
      })
      ctx.closePath()
      ctx.fillStyle = 'rgba(255, 214, 102, 0.18)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(255, 214, 102, 0.95)'
      ctx.lineWidth = 3
      ctx.stroke()
      ctx.restore()
      return
    }

    if (highlight.type === 'board_unit') {
      const unit = state.units[highlight.unitId] ?? previewState?.units[highlight.unitId]
      if (!unit) return
      const center = projectHex(unit.pos)
      ctx.save()
      ctx.globalAlpha = pulse
      ctx.strokeStyle = 'rgba(255, 214, 102, 0.95)'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.ellipse(center.x, center.y, layout.size * 0.72, layout.size * 0.5 * BOARD_TILT, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  })
}

function getUnitRingMetrics(kind: Unit['kind']): {
  radius: number
  stroke: number
  outerTipDistance: number
  outerBaseDistance: number
  outerBaseHalfWidth: number
  innerTipDistance: number
  innerBaseDistance: number
  innerBaseHalfWidth: number
} {
  const leaderScale = kind === 'leader' ? 1.2 : 1
  const baseScale = 1.3 * leaderScale
  const radius = layout.size * 0.38 * baseScale
  const stroke = layout.size * 0.12 * 1.15 * leaderScale
  const outerTipDistance = layout.size * 0.66 * baseScale
  const outerBaseDistance = layout.size * 0.388 * baseScale
  const outerBaseHalfWidth = layout.size * 0.156 * baseScale
  const innerTipDistance = -(radius * 0.42)
  const innerBaseDistance = -(radius - stroke * 0.3)
  const innerBaseHalfWidth = outerBaseHalfWidth * 0.74
  return {
    radius,
    stroke,
    outerTipDistance,
    outerBaseDistance,
    outerBaseHalfWidth,
    innerTipDistance,
    innerBaseDistance,
    innerBaseHalfWidth,
  }
}

function drawDirectionalTriangle(
  context: CanvasRenderingContext2D,
  nx: number,
  ny: number,
  tipDistance: number,
  baseDistance: number,
  halfWidth: number,
  fillStyle: string | CanvasGradient,
  strokeStyle: string,
  lineWidth: number
): void {
  const perpX = -ny
  const perpY = nx
  const tipX = nx * tipDistance
  const tipY = ny * tipDistance
  const baseX = nx * baseDistance
  const baseY = ny * baseDistance

  context.beginPath()
  context.moveTo(tipX, tipY)
  context.lineTo(baseX + perpX * halfWidth, baseY + perpY * halfWidth)
  context.lineTo(baseX - perpX * halfWidth, baseY - perpY * halfWidth)
  context.closePath()
  context.fillStyle = fillStyle
  context.fill()
  context.strokeStyle = strokeStyle
  context.lineWidth = lineWidth
  context.stroke()
}

function unitHasActiveModifier(unit: Pick<Unit, 'modifiers'>, type: Unit['modifiers'][number]['type']): boolean {
  return unit.modifiers.some(
    (modifier) => modifier.type === type && (modifier.turnsRemaining === 'indefinite' || modifier.turnsRemaining > 0)
  )
}

function getDisplayedUnitFacing(unit: Pick<Unit, 'id' | 'facing'>): Direction {
  if (!currentAnimation) return unit.facing
  if (currentAnimation.type === 'lunge' && currentAnimation.unitId === unit.id) {
    return currentAnimation.dir
  }
  if (currentAnimation.type === 'teamLunge') {
    const lunge = currentAnimation.lunges.find((entry) => entry.unitId === unit.id)
    if (lunge) return lunge.dir
  }
  return unit.facing
}

function getUnitModifierGlowColors(unit: Unit): { inner: string; mid: string; outer: string } | null {
  if (unitHasActiveModifier(unit, 'frozen')) {
    return {
      inner: 'rgba(165, 220, 255, 0.95)',
      mid: 'rgba(90, 165, 255, 0.72)',
      outer: 'rgba(40, 95, 200, 0)',
    }
  }
  if (unitHasActiveModifier(unit, 'chilled')) {
    return {
      inner: 'rgba(165, 225, 255, 0.82)',
      mid: 'rgba(85, 175, 255, 0.55)',
      outer: 'rgba(40, 95, 200, 0)',
    }
  }
  if (unitHasActiveModifier(unit, 'lightningBarrier')) {
    return {
      inner: 'rgba(250, 235, 140, 0.95)',
      mid: 'rgba(170, 220, 90, 0.65)',
      outer: 'rgba(110, 160, 40, 0)',
    }
  }
  if (unit.modifiers.length === 0) return null
  const visibleModifiers = unit.modifiers.some(
    (modifier) =>
      modifier.type !== 'slow' &&
      modifier.type !== 'spellResistance' &&
      modifier.type !== 'reinforcementPenalty'
  )
  if (!visibleModifiers) return null
  return {
    inner: 'rgba(255, 60, 60, 1)',
    mid: 'rgba(255, 20, 20, 0.72)',
    outer: 'rgba(120, 0, 0, 0)',
  }
}

function drawUnit(unit: Unit, centerOverride?: { x: number; y: number }, alphaOverride?: number): void {
  const center = centerOverride ?? projectHex(unit.pos)
  const displayFacing = getDisplayedUnitFacing(unit)
  const color = getUnitRingColor(unit)
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

  const modifierGlowColors = getUnitModifierGlowColors(unit)
  if (modifierGlowColors) {
    const glowRadius = unit.kind === 'barricade' ? layout.size * 0.72 : layout.size * 0.9
    const glowGradient = ctx.createRadialGradient(
      center.x,
      center.y,
      glowRadius * 0.18,
      center.x,
      center.y,
      glowRadius
    )
    glowGradient.addColorStop(0, modifierGlowColors.inner)
    glowGradient.addColorStop(0.58, modifierGlowColors.mid)
    glowGradient.addColorStop(1, modifierGlowColors.outer)
    ctx.save()
    ctx.globalCompositeOperation = 'screen'
    ctx.beginPath()
    ctx.ellipse(center.x, center.y, glowRadius, glowRadius * BOARD_TILT, 0, 0, Math.PI * 2)
    ctx.fillStyle = glowGradient
    ctx.fill()
    ctx.restore()
  }

  if (
    currentAnimation &&
    'unitId' in currentAnimation &&
    currentAnimation.unitId === unit.id &&
    currentAnimation.type === 'boost'
  ) {
    drawBoostGlow(center, animationProgress)
  }

  if (unit.kind === 'unit' || unit.kind === 'leader') {
    const next = neighbor(unit.pos, displayFacing)
    const target = projectHex(next)
    const dir = {
      x: target.x - center.x,
      y: (target.y - center.y) / BOARD_TILT,
    }
    const length = Math.hypot(dir.x, dir.y) || 1
    const nx = dir.x / length
    const ny = dir.y / length
    const ringMetrics = getUnitRingMetrics(unit.kind)

    ctx.save()
    ctx.translate(center.x, center.y)
    ctx.scale(1, BOARD_TILT)

    const ringRadius = ringMetrics.radius
    const ringStroke = ringMetrics.stroke
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

    drawDirectionalTriangle(
      ctx,
      nx,
      ny,
      ringMetrics.outerTipDistance,
      ringMetrics.outerBaseDistance,
      ringMetrics.outerBaseHalfWidth,
      ringGradient,
      'rgba(0, 0, 0, 0.28)',
      1.1
    )
    drawDirectionalTriangle(
      ctx,
      nx,
      ny,
      ringMetrics.innerTipDistance,
      ringMetrics.innerBaseDistance,
      ringMetrics.innerBaseHalfWidth,
      ringGradient,
      'rgba(0, 0, 0, 0.22)',
      1
    )

    ctx.globalAlpha = 0.9
    ctx.beginPath()
    ctx.arc(0, 0, ringRadius, 0, Math.PI * 2)
    ctx.strokeStyle = color
    ctx.lineWidth = 1.4
    ctx.stroke()
    drawDirectionalTriangle(
      ctx,
      nx,
      ny,
      ringMetrics.outerTipDistance,
      ringMetrics.outerBaseDistance,
      ringMetrics.outerBaseHalfWidth,
      color,
      color,
      1.2
    )
    drawDirectionalTriangle(
      ctx,
      nx,
      ny,
      ringMetrics.innerTipDistance,
      ringMetrics.innerBaseDistance,
      ringMetrics.innerBaseHalfWidth,
      color,
      color,
      1.1
    )
    ctx.globalAlpha = 1

    ctx.restore()
  }

  if (unit.kind === 'unit') {
    const unitScale = UNIT_IMAGE_SCALE * getUnitRenderScale(unit)
    if (!drawMonsterSprite(ctx, center, unit, unitScale)) {
      drawUnitSprite(center, unit.owner, unitScale)
    }
  } else if (unit.kind === 'leader') {
    drawLeaderSprite(center, unit.owner, LEADER_IMAGE_SCALE)
  } else if (unit.kind === 'barricade' && barricadeBaseImage.loaded) {
    drawBarricadeSprite(center, unit.owner)
  }

  if (unit.kind !== 'barricade' && unitHasActiveModifier(unit, 'frozen')) {
    const frozenRadius = unit.kind === 'leader' ? layout.size * 0.62 : layout.size * 0.52
    const frozenGradient = ctx.createRadialGradient(
      center.x,
      center.y - frozenRadius * 0.18,
      frozenRadius * 0.15,
      center.x,
      center.y,
      frozenRadius
    )
    frozenGradient.addColorStop(0, 'rgba(220, 245, 255, 0.42)')
    frozenGradient.addColorStop(0.55, 'rgba(120, 195, 255, 0.34)')
    frozenGradient.addColorStop(1, 'rgba(70, 145, 235, 0)')
    ctx.save()
    ctx.globalCompositeOperation = 'screen'
    ctx.beginPath()
    ctx.ellipse(center.x, center.y - frozenRadius * 0.04, frozenRadius, frozenRadius * BOARD_TILT, 0, 0, Math.PI * 2)
    ctx.fillStyle = frozenGradient
    ctx.fill()
    ctx.restore()
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
  const ghostScale = Math.max(1, Math.ceil(window.devicePixelRatio || 1))
  const ghostSize = Math.ceil(layout.size * 4)
  const ghostPixelSize = ghostSize * ghostScale
  if (ghostCanvas.width !== ghostPixelSize || ghostCanvas.height !== ghostPixelSize) {
    ghostCanvas.width = ghostPixelSize
    ghostCanvas.height = ghostPixelSize
  }
  ghostCtx.setTransform(1, 0, 0, 1, 0, 0)
  ghostCtx.clearRect(0, 0, ghostCanvas.width, ghostCanvas.height)
  ghostCtx.setTransform(ghostScale, 0, 0, ghostScale, 0, 0)
  ghostCtx.imageSmoothingEnabled = true

  const localCenter = { x: ghostSize / 2, y: ghostSize / 2 }
  if (unit.kind === 'barricade') {
    ghostCtx.save()
    ghostCtx.translate(localCenter.x, localCenter.y)
    ghostCtx.scale(1, BOARD_TILT)
    const size = layout.size * 0.5
    ghostCtx.lineWidth = 2
    ghostCtx.strokeStyle = ringColor
    ghostCtx.strokeRect(-size / 2, -size / 2, size, size)
    ghostCtx.restore()

    if (barricadeBaseImage.loaded) {
      ghostCtx.save()
      ghostCtx.filter = 'grayscale(1) brightness(1.8)'
      drawBarricadeSprite(localCenter, unit.owner, ghostCtx)
      ghostCtx.filter = 'none'
      ghostCtx.restore()
    }
  } else {
    const unitSpriteScale = unit.kind === 'leader' ? LEADER_IMAGE_SCALE : UNIT_IMAGE_SCALE
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
    const ringMetrics = getUnitRingMetrics(unit.kind)

    ghostCtx.save()
    ghostCtx.translate(localCenter.x, localCenter.y)
    ghostCtx.scale(1, BOARD_TILT)

    ghostCtx.beginPath()
    ghostCtx.arc(0, 0, ringMetrics.radius, 0, Math.PI * 2)
    ghostCtx.strokeStyle = ringColor
    ghostCtx.lineWidth = 2.4
    ghostCtx.stroke()

    drawDirectionalTriangle(
      ghostCtx,
      nx,
      ny,
      ringMetrics.outerTipDistance,
      ringMetrics.outerBaseDistance,
      ringMetrics.outerBaseHalfWidth,
      ringColor,
      ringColor,
      1.1
    )
    drawDirectionalTriangle(
      ghostCtx,
      nx,
      ny,
      ringMetrics.innerTipDistance,
      ringMetrics.innerBaseDistance,
      ringMetrics.innerBaseHalfWidth,
      ringColor,
      ringColor,
      1
    )

    ghostCtx.restore()

    const spriteSet = getSpriteSetForOwner(unit.owner)
    const troopBaseImage = unit.kind === 'leader' ? spriteSet.leaderBaseImage : spriteSet.unitBaseImage
    let monsterDrawn = false
    if (unit.kind === 'unit') {
      ghostCtx.save()
      ghostCtx.filter = 'grayscale(1) brightness(1.8)'
      monsterDrawn = drawMonsterSprite(ghostCtx, localCenter, unit, unitSpriteScale * getUnitRenderScale(unit))
      ghostCtx.filter = 'none'
      ghostCtx.restore()
    }
    if (!monsterDrawn && troopBaseImage.loaded) {
      const spriteOffsetX = unit.kind === 'leader' ? spriteSet.leaderOffsetX : spriteSet.unitOffsetX
      const spriteOffsetY = unit.kind === 'leader' ? spriteSet.leaderOffsetY : spriteSet.unitOffsetY
      ghostCtx.save()
      ghostCtx.filter = 'grayscale(1) brightness(1.8)'
      drawAnchoredImageTo(
        ghostCtx,
        troopBaseImage,
        localCenter,
        unitSpriteScale,
        UNIT_ANCHOR_Y,
        spriteOffsetX,
        spriteOffsetY
      )
      ghostCtx.filter = 'none'
      ghostCtx.restore()
    }
  }

  ctx.save()
  ctx.globalAlpha = GHOST_ALPHA
  ctx.drawImage(
    ghostCanvas,
    0,
    0,
    ghostPixelSize,
    ghostPixelSize,
    center.x - localCenter.x,
    center.y - localCenter.y,
    ghostSize,
    ghostSize
  )
  ctx.restore()
}

function drawDeathGhostUnit(unit: Unit, alpha: number): void {
  const center = getAnimatedCenter(unit)
  const ghostAlpha = clamp(alpha * 1.25, 0, 1)
  const mistRadius = layout.size * (unit.kind === 'leader' ? 0.92 : 0.74)

  ctx.save()
  ctx.globalAlpha = ghostAlpha
  const mist = ctx.createRadialGradient(
    center.x,
    center.y - mistRadius * 0.08,
    mistRadius * 0.12,
    center.x,
    center.y,
    mistRadius
  )
  mist.addColorStop(0, 'rgba(230, 244, 255, 0.68)')
  mist.addColorStop(0.58, 'rgba(155, 210, 255, 0.42)')
  mist.addColorStop(1, 'rgba(105, 165, 240, 0)')
  ctx.fillStyle = mist
  ctx.beginPath()
  ctx.ellipse(center.x, center.y, mistRadius, mistRadius * BOARD_TILT, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.globalAlpha = ghostAlpha
  drawGhostComposite(center, unit, 'rgba(220, 242, 255, 0.98)')
  ctx.restore()
}

function drawGhostUnits(snapshot: GameState): void {
  ctx.save()
  ctx.setLineDash([6, 4])

  const snapshotUnitIds = new Set(Object.keys(snapshot.units))

  for (const unit of Object.values(snapshot.units)) {
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

type CardStripReorderOptions = {
  container: HTMLElement
  cards: HTMLElement[]
  cardSelector: string
  canReorder: () => boolean
  getCardId: (card: HTMLElement) => string | null
  onReorder: (fromId: string, toId: string) => void
  onActivate?: (card: HTMLElement) => void
}

type HandCard = GameState['players'][number]['hand'][number]

function syncHandVisualOrder(player: PlayerId): void {
  const cardIds = state.players[player].hand.map((card) => card.id)
  const idSet = new Set(cardIds)
  const nextOrder = handVisualOrder[player].filter((cardId) => idSet.has(cardId))
  const seen = new Set(nextOrder)
  cardIds.forEach((cardId) => {
    if (seen.has(cardId)) return
    nextOrder.push(cardId)
    seen.add(cardId)
  })
  handVisualOrder[player] = nextOrder
}

function getOrderedHandCards(player: PlayerId): HandCard[] {
  syncHandVisualOrder(player)
  const byId = new Map<string, HandCard>(state.players[player].hand.map((card) => [card.id, card]))
  return handVisualOrder[player]
    .map((cardId) => byId.get(cardId))
    .filter((card): card is HandCard => Boolean(card))
}

function reorderHandCards(fromId: string, toId: string): void {
  if (!fromId || !toId || fromId === toId) return
  if (isTutorialLessonActive()) {
    setTutorialFeedback('Card reordering is disabled during the tutorial.')
    return
  }
  if (state.phase !== 'planning' || state.ready[planningPlayer] || isBotPlanningLocked()) return
  syncHandVisualOrder(planningPlayer)
  const order = handVisualOrder[planningPlayer]
  const fromIndex = order.indexOf(fromId)
  const toIndex = order.indexOf(toId)
  if (fromIndex === -1 || toIndex === -1) return
  const [moved] = order.splice(fromIndex, 1)
  order.splice(toIndex, 0, moved)
  render()
}

function reorderQueuedOrder(fromId: string, toId: string): void {
  if (!fromId || !toId || fromId === toId) return
  if (isBotPlanningLocked()) return
  if (state.ready[planningPlayer]) return
  const playerState = state.players[planningPlayer]
  const fromOrder = playerState.orders.find((order) => order.id === fromId) ?? null
  const toOrder = playerState.orders.find((order) => order.id === toId) ?? null
  if (
    !guardTutorialAction('queue_reorder', {
      fromId,
      toId,
      fromDefId: fromOrder?.defId ?? null,
      toDefId: toOrder?.defId ?? null,
      turn: state.turn,
    })
  ) {
    return
  }
  if (mode === 'online') {
    sendOnlineCommand({
      type: 'reorder_order',
      fromOrderId: fromId,
      toOrderId: toId,
    })
    statusEl.textContent = 'Moving order...'
    return
  }
  const fromIndex = playerState.orders.findIndex((order) => order.id === fromId)
  const toIndex = playerState.orders.findIndex((order) => order.id === toId)
  if (fromIndex === -1 || toIndex === -1) return
  const [moved] = playerState.orders.splice(fromIndex, 1)
  playerState.orders.splice(toIndex, 0, moved)
  clearReady(planningPlayer)
  statusEl.textContent = 'Order moved.'
  notifyTutorialEvent('queue_reordered', {
    fromId,
    toId,
    fromDefId: moved.defId,
    toDefId: toOrder?.defId ?? null,
    order: playerState.orders.map((order) => order.defId),
    turn: state.turn,
  })
  render()
}

function updateCardReorderDragVisual(card: HTMLElement, drag: CardReorderDragState, clientX: number, clientY: number): void {
  const scrollDx = drag.container.scrollLeft - drag.startScrollLeft
  const scrollDy = drag.container.scrollTop - drag.startScrollTop
  const dx = clientX - drag.startX + scrollDx
  const dy = clientY - drag.startY + scrollDy
  card.style.setProperty('--drag-translate-x', `${dx}px`)
  card.style.setProperty('--drag-translate-y', `${dy}px`)
}

function clearCardReorderDragVisual(card: HTMLElement): void {
  card.classList.remove('card-reorder-dragging')
  card.style.removeProperty('--drag-translate-x')
  card.style.removeProperty('--drag-translate-y')
}

function clearCardStripDragOver(cards: HTMLElement[]): void {
  cards.forEach((card) => card.classList.remove('card-reorder-over'))
}

function clearCardReorderHoldTimer(drag: CardReorderDragState): void {
  if (drag.holdTimer === null) return
  window.clearTimeout(drag.holdTimer)
  drag.holdTimer = null
}

function autoScrollContainerForPointer(container: HTMLElement, clientX: number, clientY: number): void {
  const rect = container.getBoundingClientRect()
  const canScrollX = container.scrollWidth > container.clientWidth
  const canScrollY = container.scrollHeight > container.clientHeight
  const edge = 48
  const maxSpeed = 22
  let scrollX = 0
  let scrollY = 0

  if (canScrollX) {
    if (clientX < rect.left + edge) {
      const distance = rect.left + edge - clientX
      scrollX = -Math.ceil((distance / edge) * maxSpeed)
    } else if (clientX > rect.right - edge) {
      const distance = clientX - (rect.right - edge)
      scrollX = Math.ceil((distance / edge) * maxSpeed)
    }
  }

  if (canScrollY) {
    if (clientY < rect.top + edge) {
      const distance = rect.top + edge - clientY
      scrollY = -Math.ceil((distance / edge) * maxSpeed)
    } else if (clientY > rect.bottom - edge) {
      const distance = clientY - (rect.bottom - edge)
      scrollY = Math.ceil((distance / edge) * maxSpeed)
    }
  }

  if (scrollX !== 0) {
    container.scrollLeft += scrollX
  }
  if (scrollY !== 0) {
    container.scrollTop += scrollY
  }
}

function beginCardReorderDrag(drag: CardReorderDragState): void {
  if (drag.isDragging) return
  clearCardReorderHoldTimer(drag)
  drag.isDragging = true
  if (!overlayLocked) {
    hoverCardKey = null
    clearOverlayClone()
  }
  drag.card.classList.add('card-reorder-dragging')
}

function finishCardReorderDrag(pointerId: number): CardReorderDragState | null {
  if (!cardReorderDrag || cardReorderDrag.pointerId !== pointerId) return null
  const drag = cardReorderDrag
  clearCardReorderHoldTimer(drag)
  cardReorderDrag = null
  if (drag.card.hasPointerCapture(pointerId)) {
    try {
      drag.card.releasePointerCapture(pointerId)
    } catch {
      // Pointer may already be released.
    }
  }
  clearCardReorderDragVisual(drag.card)
  clearCardStripDragOver(drag.cards)
  return drag
}

function resolveCardStripTarget(options: CardStripReorderOptions, clientX: number, clientY: number): HTMLElement | null {
  const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null
  const target = element?.closest<HTMLElement>(options.cardSelector)
  if (!target) return null
  if (!options.container.contains(target)) return null
  return options.cards.includes(target) ? target : null
}

function getCardStripPrimaryAxis(cards: HTMLElement[], excludedCard?: HTMLElement): 'horizontal' | 'vertical' {
  const candidateRects = cards
    .filter((card) => card !== excludedCard)
    .map((card) => card.getBoundingClientRect())

  if (candidateRects.length <= 1) return 'horizontal'

  const centerXs = candidateRects.map((rect) => rect.left + rect.width / 2)
  const centerYs = candidateRects.map((rect) => rect.top + rect.height / 2)
  const spreadX = Math.max(...centerXs) - Math.min(...centerXs)
  const spreadY = Math.max(...centerYs) - Math.min(...centerYs)
  return spreadX >= spreadY ? 'horizontal' : 'vertical'
}

function resolveCardStripTargetByAxis(
  cards: HTMLElement[],
  clientX: number,
  clientY: number,
  excludedCard?: HTMLElement
): HTMLElement | null {
  const axis = getCardStripPrimaryAxis(cards, excludedCard)
  const pointerPos = axis === 'horizontal' ? clientX : clientY
  const orderedCards = cards
    .filter((card) => card !== excludedCard)
    .map((card) => {
      const rect = card.getBoundingClientRect()
      const primaryStart = axis === 'horizontal' ? rect.left : rect.top
      const primaryEnd = axis === 'horizontal' ? rect.right : rect.bottom
      return {
        card,
        primaryCenter: (primaryStart + primaryEnd) / 2,
      }
    })
    .sort((left, right) => left.primaryCenter - right.primaryCenter)

  if (orderedCards.length === 0) return null

  const target = orderedCards.find((candidate) => pointerPos <= candidate.primaryCenter) ?? orderedCards.at(-1)
  return target?.card ?? null
}

function shouldActivateCardStripCard(drag: CardReorderDragState, clientX: number, clientY: number): boolean {
  if (drag.isDragging || drag.didScroll) return false
  const movedDistance = Math.abs(clientX - drag.startX) + Math.abs(clientY - drag.startY)
  if (movedDistance > CARD_ACTIVATE_MAX_MOVE_PX) return false
  const target = resolveCardStripTarget(drag.options, clientX, clientY)
  if (!target) return false
  return drag.options.getCardId(target) === drag.fromId
}

function bindCardStripReorder(options: CardStripReorderOptions): void {
  const { cards } = options
  cards.forEach((card) => {
    card.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      if (!options.canReorder()) return
      if (cardReorderDrag) return
      lastInputWasTouch = event.pointerType === 'touch'
      event.preventDefault()
      const fromId = options.getCardId(card)
      if (!fromId) return
      cardReorderDrag = {
        options,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        container: options.container,
        cards,
        card,
        fromId,
        targetId: fromId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        startScrollLeft: options.container.scrollLeft,
        startScrollTop: options.container.scrollTop,
        isDragging: false,
        didScroll: false,
        holdTimer: null,
      }
      try {
        if (!card.hasPointerCapture(event.pointerId)) {
          card.setPointerCapture(event.pointerId)
        }
      } catch {
        // Ignore failures when the pointer is no longer active.
      }
      if (event.pointerType === 'touch') {
        cardReorderDrag.holdTimer = window.setTimeout(() => {
          if (!cardReorderDrag || cardReorderDrag.pointerId !== event.pointerId) return
          beginCardReorderDrag(cardReorderDrag)
        }, TOUCH_REORDER_HOLD_MS)
      }
    })

    card.addEventListener('pointermove', (event) => {
      if (!cardReorderDrag || cardReorderDrag.pointerId !== event.pointerId) return
      if (!options.canReorder()) {
        finishCardReorderDrag(event.pointerId)
        return
      }
      const drag = cardReorderDrag
      const dx = event.clientX - drag.startX
      const dy = event.clientY - drag.startY
      const movedDistance = Math.abs(dx) + Math.abs(dy)
      if (!drag.isDragging) {
        if (drag.pointerType === 'touch') {
          const moveX = event.clientX - drag.lastX
          const moveY = event.clientY - drag.lastY
          drag.lastX = event.clientX
          drag.lastY = event.clientY
          if (movedDistance >= TOUCH_REORDER_CANCEL_MOVE_PX) {
            clearCardReorderHoldTimer(drag)
          }
          if (movedDistance >= TOUCH_CARD_SCROLL_START_DISTANCE_PX) {
            drag.didScroll = true
            if (moveX !== 0) {
              drag.container.scrollLeft -= moveX
            }
            if (moveY !== 0) {
              drag.container.scrollTop -= moveY
            }
          }
          return
        }
        if (movedDistance < CARD_REORDER_START_DISTANCE_PX) return
        beginCardReorderDrag(drag)
      }
      event.preventDefault()
      autoScrollContainerForPointer(drag.container, event.clientX, event.clientY)
      updateCardReorderDragVisual(drag.card, drag, event.clientX, event.clientY)
      clearCardStripDragOver(drag.cards)
      const validTarget =
        resolveCardStripTarget(options, event.clientX, event.clientY) ??
        resolveCardStripTargetByAxis(drag.cards, event.clientX, event.clientY, drag.card)
      const targetId = validTarget ? options.getCardId(validTarget) : null
      if (validTarget && targetId && targetId !== drag.fromId) {
        validTarget.classList.add('card-reorder-over')
        drag.targetId = targetId
      } else {
        drag.targetId = drag.fromId
      }
    })

    card.addEventListener('pointerup', (event) => {
      const drag = finishCardReorderDrag(event.pointerId)
      if (!drag) return
      if (drag.isDragging) {
        if (drag.targetId && drag.targetId !== drag.fromId) {
          drag.options.onReorder(drag.fromId, drag.targetId)
          return
        }
        syncOverlayFromSelection()
        return
      }
      if (drag.options.onActivate && shouldActivateCardStripCard(drag, event.clientX, event.clientY)) {
        drag.options.onActivate(drag.card)
      }
    })

    card.addEventListener('pointercancel', (event) => {
      finishCardReorderDrag(event.pointerId)
    })

    card.addEventListener('lostpointercapture', (event) => {
      finishCardReorderDrag(event.pointerId)
    })

    card.addEventListener('dragstart', (event) => {
      event.preventDefault()
    })
  })
}

function handleHandCardActivation(button: HTMLButtonElement): void {
  if (state.phase !== 'planning') return
  if (isBotPlanningLocked()) return
  if (state.ready[planningPlayer]) return
  const cardId = button.dataset.cardId ?? null
  if (!cardId) return
  const buttonKey = getCardVisualKey(button)
  if (
    overlayLocked &&
    selectedCardId === cardId &&
    buttonKey &&
    getOverlaySourceKey() === buttonKey
  ) {
    selectedCardId = null
    pendingOrder = null
    hoverCardKey = null
    clearOverlayClone()
    statusEl.textContent = 'Select a card to start planning.'
    render()
    return
  }
  const defId = button.dataset.cardDefId as CardDefId | undefined
  if (!guardTutorialAction('hand_card_select', { cardId, defId: defId ?? null })) return
  if (overlayLocked && buttonKey && getOverlaySourceKey() !== buttonKey) {
    overlayLocked = false
    clearOverlayClone()
  }
  if (overlayClone && buttonKey && getOverlaySourceKey() === buttonKey && overlayClone.style.display !== 'none') {
    overlayLocked = true
    overlaySourceEl = button
    overlaySourceVisibility = button.style.opacity
    overlaySourceTransition = button.style.transition
  } else {
    showOverlayClone(button, true, true)
  }
  hoverCardKey = buttonKey
  selectedCardId = cardId
  pendingOrder = selectedCardId ? { cardId: selectedCardId, params: {} } : null
  statusEl.textContent = selectedCardId ? 'Pick a unit/tile on the board.' : 'Select a card to start planning.'
  if (defId) {
    notifyTutorialEvent('card_selected', { cardId, defId })
  }
  tryAutoAddOrder()
  render()
}

function handleOrderCardActivation(card: HTMLDivElement): void {
  if (state.phase !== 'planning' || state.ready[planningPlayer] || isBotPlanningLocked()) return
  const orderId = card.dataset.orderId
  const defId = (card.dataset.cardDefId as CardDefId | undefined) ?? null
  if (!orderId) return
  if (!guardTutorialAction('queue_remove', { orderId, defId, turn: state.turn })) return
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
  notifyTutorialEvent('queue_removed', { orderId, defId: removed.defId, turn: state.turn })
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
}

function renderHand(): void {
  const playerHand = getOrderedHandCards(planningPlayer)
  if (playerHand.length === 0) {
    handEl.innerHTML = '<div class="empty">No cards in hand.</div>'
    return
  }

  handEl.innerHTML = playerHand
    .map((card) => {
      const def = CARD_DEFS[card.defId]
      const cardTypeClassNames = getCardTypeClassNames(def)
      const cardClassName = getCardClassName(def.id)
      const isSelected = selectedCardId === card.id
      const isHidden = hiddenCardIds.has(card.id)
      const isPendingTransfer = pendingCardTransfer?.cardId === card.id && pendingCardTransfer?.target === 'hand'
      if (isPendingTransfer) {
        return `
          <button class="card hand-card ${cardTypeClassNames} ${cardClassName} card-placeholder" data-card-id="${card.id}" data-card-def-id="${def.id}" data-card-layer="hand" ${getCardStyleAttr(def)}></button>
        `
      }
      return `
        <button class="card hand-card ${cardTypeClassNames} ${cardClassName} ${isSelected ? 'selected' : ''} ${isHidden ? 'hidden-card' : ''}" data-card-id="${card.id}" data-card-def-id="${def.id}" data-card-layer="hand" ${getCardStyleAttr(def, isHidden)}>
          ${renderCardFace(def, { owner: planningPlayer })}
        </button>
      `
    })
    .join('')

  const cardButtons = Array.from(handEl.querySelectorAll<HTMLButtonElement>('.hand-card'))
  bindCardStripReorder({
    container: handEl,
    cards: cardButtons,
    cardSelector: '.hand-card',
    canReorder: () => state.phase === 'planning' && !state.ready[planningPlayer] && !isBotPlanningLocked(),
    getCardId: (card) => card.dataset.cardId ?? null,
    onReorder: reorderHandCards,
    onActivate: (card) => handleHandCardActivation(card as HTMLButtonElement),
  })
}

function renderOrders(): void {
  const inPlanning = state.phase === 'planning'
  if (inPlanning && resolvingOrderIdsHidden.size > 0) {
    resolvingOrderIdsHidden.clear()
  }
  const playerOrders = state.players[planningPlayer].orders
  const allOrders = state.actionQueue
  const ordersToShow = inPlanning
    ? playerOrders
    : allOrders.slice(state.actionIndex).filter((order) => !resolvingOrderIdsHidden.has(order.id))
  const validity = inPlanning ? getPlannedOrderValidity(state, planningPlayer) : []
  if (ordersToShow.length === 0) {
    ordersEl.innerHTML = '<div class="empty">No orders queued.</div>'
    return
  }
  ordersEl.innerHTML = ordersToShow
    .map((order, index) => {
      const def = CARD_DEFS[order.defId]
      const cardTypeClassNames = getCardTypeClassNames(def)
      const cardClassName = getCardClassName(def.id)
      const isValid = inPlanning ? validity[index] ?? true : true
      const teamClass = `order-team-${order.player}`
      const resolvedClass = ''
      const isHidden = hiddenCardIds.has(order.cardId)
      const isPendingTransfer = pendingCardTransfer?.cardId === order.cardId && pendingCardTransfer?.target === 'orders'
      if (isPendingTransfer) {
        return `
          <div class="card order-card ${cardTypeClassNames} ${cardClassName} ${teamClass} ${resolvedClass} ${isValid ? '' : 'invalid'} card-placeholder" data-order-id="${order.id}" data-card-id="${order.cardId}" data-card-def-id="${def.id}" data-card-layer="queue" ${getCardStyleAttr(def)}></div>
        `
      }
      return `
        <div class="card order-card ${cardTypeClassNames} ${cardClassName} ${teamClass} ${resolvedClass} ${isValid ? '' : 'invalid'} ${isHidden ? 'hidden-card' : ''}" data-order-id="${order.id}" data-card-id="${order.cardId}" data-card-def-id="${def.id}" data-card-layer="queue" ${getCardStyleAttr(def, isHidden)}>
          ${renderCardFace(def, { orderIndex: index + 1, owner: order.player })}
        </div>
      `
    })
    .join('')

  if (inPlanning) {
    const cards = Array.from(ordersEl.querySelectorAll<HTMLDivElement>('.order-card'))

    bindCardStripReorder({
      container: ordersEl,
      cards,
      cardSelector: '.order-card',
      canReorder: () => state.phase === 'planning' && !state.ready[planningPlayer] && !isBotPlanningLocked(),
      getCardId: (card) => card.dataset.orderId ?? null,
      onReorder: reorderQueuedOrder,
      onActivate: (card) => handleOrderCardActivation(card as HTMLDivElement),
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
  const summary = renderOrderSummary(def.id, activeOrder.params)
  const description = getCardDescriptionForMatch(def.id, def.description)

  orderFormEl.innerHTML = `
    <div class="order-summary">
      <div class="order-title">${def.name}</div>
      <div class="order-desc">${description}</div>
      <div class="order-cost">${renderApBadge(apCost)}</div>
      <div class="order-steps">${summary}</div>
      <div class="order-hint">${nextStep ? stepHint(nextStep) : 'Auto-adding this order.'}</div>
    </div>
  `
}

function renderOrderSummary(defId: CardDefId, params: OrderParams): string {
  const parts: string[] = []
  if (defId === 'move_double_steps') {
    if (params.unitId) {
      parts.push(`Unit: ${renderUnitLabel(params.unitId)}`)
    }
    if (params.tile) {
      parts.push(`Move 1: ${params.tile.q},${params.tile.r}`)
    }
    if (params.unitId2) {
      parts.push(`Unit 2: ${renderUnitLabel(params.unitId2)}`)
    }
    if (params.tile2) {
      parts.push(`Move 2: ${params.tile2.q},${params.tile2.r}`)
    }
  } else {
    if (params.unitId) {
      parts.push(`Unit: ${renderUnitLabel(params.unitId)}`)
    }
    if (params.unitId2) {
      parts.push(`Unit 2: ${renderUnitLabel(params.unitId2)}`)
    }
    if (params.tile) {
      parts.push(`Tile: ${params.tile.q},${params.tile.r}`)
    }
    if (params.tile2) {
      parts.push(`Tile 2: ${params.tile2.q},${params.tile2.r}`)
    }
  }
  if (params.tile3) {
    parts.push(`Tile 3: ${params.tile3.q},${params.tile3.r}`)
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
      return 'Click a different unit (or planned spawn) for the second selection.'
    case 'tile':
      return 'Click a highlighted tile.'
    case 'tile2':
      return 'Click a highlighted tile for the second placement.'
    case 'tile3':
      return 'Click a highlighted tile for the third placement.'
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

function getCurrentRoguelikeMatchNumber(): number {
  if (mode !== 'roguelike') return 1
  const fromSettings = Number(state.settings.roguelikeMatchNumber)
  if (Number.isFinite(fromSettings) && fromSettings > 0) return Math.floor(fromSettings)
  if (roguelikeRun) return Math.max(1, roguelikeRun.currentMatchNumber)
  return 1
}

function getRoguelikeMonsterDamageModifierForMatch(matchNumber: number): number {
  return 1 + matchNumber / 10
}

function scaleRoguelikeMonsterCardDamageValue(baseDamage: number, matchNumber: number): number {
  const normalized = Math.max(0, baseDamage)
  if (normalized <= 0) return 0
  return Math.max(1, Math.round(normalized * getRoguelikeMonsterDamageModifierForMatch(matchNumber)))
}

function getCardDescriptionForMatch(defId: CardDefId, fallback: string, owner?: PlayerId): string {
  if (mode !== 'roguelike' || owner !== BOT_PLAYER) return fallback
  const matchNumber = getCurrentRoguelikeMatchNumber()
  if (defId === 'attack_roguelike_basic') {
    return `Face a direction, then deal ${scaleRoguelikeMonsterCardDamageValue(1, matchNumber)} damage to an adjacent unit.`
  }
  if (defId === 'attack_roguelike_slow') {
    return `Slow. Face a direction, then deal ${scaleRoguelikeMonsterCardDamageValue(5, matchNumber)} damage to an adjacent unit.`
  }
  if (defId === 'attack_roguelike_stomp') {
    return `Deal ${scaleRoguelikeMonsterCardDamageValue(1, matchNumber)} damage and Stun all adjacent units for the rest of the turn.`
  }
  if (defId === 'attack_roguelike_pack_hunt') {
    return `Move 1 tile in any direction, then deal ${scaleRoguelikeMonsterCardDamageValue(2, matchNumber)} damage per adjacent ally to the tile in front.`
  }
  return fallback
}

function renderCardArt(defId: CardDefId): string {
  return `<div class="card-art" aria-hidden="true">${getCardArtSvg(defId)}</div>`
}

const CARD_TYPE_LABELS: Record<CardType, string> = {
  reinforcement: 'Reinforcement',
  movement: 'Movement',
  attack: 'Attack',
  spell: 'Spell',
}

const CARD_TYPE_TINTS: Record<CardType, string> = {
  reinforcement: 'var(--frame-reinforcement)',
  movement: 'var(--frame-movement)',
  attack: 'var(--frame-attack)',
  spell: 'var(--frame-spell)',
}

function getCardTypeClassNames(def: { type: CardType; countsAs?: CardType[] }): string {
  return getCardTypes(def)
    .map((type) => `type-${type}`)
    .join(' ')
}

function getCardTintValue(def: { type: CardType; countsAs?: CardType[] }): string {
  const types = getCardTypes(def)
  if (types.length >= 3) {
    return 'var(--frame-multitype-gold)'
  }
  if (types.length === 2) {
    return `linear-gradient(90deg, ${CARD_TYPE_TINTS[types[0]]} 0%, ${CARD_TYPE_TINTS[types[1]]} 100%)`
  }
  return CARD_TYPE_TINTS[types[0]]
}

function getCardStyleAttr(def: { type: CardType; countsAs?: CardType[] }, hidden = false): string {
  const styles = [`--card-tint:${getCardTintValue(def)}`]
  if (hidden) {
    styles.push('visibility:hidden', 'opacity:0')
  }
  return `style="${styles.join(';')}"`
}

function formatCardTypeLabel(def: { type: CardType; countsAs?: CardType[] }): string {
  return getCardTypes(def)
    .map((type) => CARD_TYPE_LABELS[type])
    .join('/')
}

function getCardTypeSortRank(def: { type: CardType; countsAs?: CardType[] }): number {
  const order: CardType[] = ['reinforcement', 'movement', 'attack', 'spell']
  return Math.min(...getCardTypes(def).map((type) => order.indexOf(type)))
}

function getCardClassName(defId: CardDefId): string {
  const classId = getCardClassId(defId)
  return classId ? `card-class-${classId}` : 'card-class-generic'
}

function renderCardClassMark(defId: CardDefId): string {
  const classId = getCardClassId(defId)
  if (!classId) return ''
  return `<div class="card-class-mark">${PLAYER_CLASS_DEFS[classId].name}</div>`
}

function renderCardFace(
  def: {
    id: CardDefId
    name: string
    description: string
    type: CardType
    countsAs?: CardType[]
    actionCost?: number
    keywords?: string[]
  },
  options: { metaText?: string; orderIndex?: number; owner?: PlayerId } = {}
): string {
  const apCost = def.actionCost ?? 1
  const meta = options.metaText ? `<div class="card-meta">${options.metaText}</div>` : ''
  const keywords =
    def.keywords && def.keywords.length > 0
      ? `<div class="card-keywords">${def.keywords.map((keyword) => `<span class="card-keyword">${keyword}</span>`).join('')}</div>`
      : ''
  const description = getCardDescriptionForMatch(def.id, def.description, options.owner)
  const classMark = renderCardClassMark(def.id)
  const orderIndex = options.orderIndex ? `<div class="order-index">#${options.orderIndex}</div>` : ''
  return [
    renderApBadge(apCost),
    classMark,
    `<div class="card-title">${def.name}</div>`,
    renderCardArt(def.id),
    `<div class="card-desc">${description}</div>`,
    keywords,
    meta,
    orderIndex,
  ].join('')
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
  clone.classList.remove('card-placeholder')
  clone.classList.remove('hidden-card')
  clone.classList.remove('dragging')
  clone.classList.remove('drag-over')
  clone.classList.remove('selected')
  clone.classList.add('card-moving')
  if (sourceEl) {
    clone.innerHTML = sourceEl.innerHTML
  }
  const cardTint = getComputedStyle(baseEl).getPropertyValue('--card-tint').trim()
  clone.dataset.cardLayer = 'moving'
  clone.style.cssText = ''
  if (cardTint) {
    clone.style.setProperty('--card-tint', cardTint)
  }
  clone.style.position = 'fixed'
  clone.style.left = `${fromRect.left}px`
  clone.style.top = `${fromRect.top}px`
  clone.style.width = `${fromRect.width}px`
  clone.style.height = `${fromRect.height}px`
  clone.style.margin = '0'
  clone.style.pointerEvents = 'none'
  clone.style.zIndex = '9999'
  clone.style.transformOrigin = 'top left'
  clone.style.transform = 'translate(0px, 0px) scale(1, 1)'
  clone.style.opacity = '0'
  clone.style.visibility = 'hidden'
  document.body.appendChild(clone)

  const dx = toRect.left - fromRect.left
  const dy = toRect.top - fromRect.top
  const scaleX = fromRect.width > 0 ? toRect.width / fromRect.width : 1
  const scaleY = fromRect.height > 0 ? toRect.height / fromRect.height : 1
  target.style.visibility = 'hidden'
  target.style.opacity = '0'
  requestAnimationFrame(() => {
    clone.style.visibility = 'visible'
    clone.style.opacity = '1'
    const animation = clone.animate(
      [
        { transform: 'translate(0px, 0px) scale(1, 1)' },
        { transform: `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})` },
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

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function waitForWebAnimation(animation: Animation | null): Promise<void> {
  return new Promise((resolve) => {
    if (!animation) {
      resolve()
      return
    }
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    animation.onfinish = finish
    animation.oncancel = finish
  })
}

type ResolutionPreviewSource = {
  rect: DOMRect
  defId: CardDefId
  owner: PlayerId
}

type ResolutionCardPreviewTarget = {
  kind: 'unit' | 'tile' | 'player'
  rect: DOMRect
  scale: number
}

type ResolutionCardPreviewPlan =
  | {
      mode: 'targeted'
      targets: ResolutionCardPreviewTarget[]
    }
  | {
      mode: 'global'
    }
  | {
      mode: 'fizzle'
    }

const MULTI_TARGET_PREVIEW_EFFECT_TYPES = new Set<CardEffect['type']>([
  'boostAllFriendly',
  'teamAttackForward',
  'damageAdjacent',
  'stunAdjacent',
  'chainLightningAllFriendly',
  'pincerAttack',
  'jointAttack',
  'markAdvanceToward',
  'moveAdjacentFriendlyGroup',
])

function createResolutionCardClone(source: ResolutionPreviewSource): HTMLElement {
  const def = CARD_DEFS[source.defId]
  const clone = document.createElement('div')
  const baseCardWidth = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-width'))
  const baseCardHeight = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-height'))
  const width = baseCardWidth > 0 ? baseCardWidth : source.rect.width
  const height = baseCardHeight > 0 ? baseCardHeight : source.rect.height
  const left = source.rect.left + source.rect.width / 2 - width / 2
  const top = source.rect.top + source.rect.height / 2 - height / 2
  const sourceScale = width > 0 ? source.rect.width / width : 1
  // Build a fresh overlay card instead of cloning queue DOM, so queue-only layout rules
  // like `.order-card { position: relative; }` cannot offset later split copies.
  clone.className = `card resolution-card-spotlight ${getCardTypeClassNames(def)} ${getCardClassName(def.id)}`
  clone.dataset.cardDefId = def.id
  clone.dataset.cardLayer = 'resolution-preview'
  clone.innerHTML = renderCardFace(def, { owner: source.owner })
  clone.style.setProperty('--card-tint', getCardTintValue(def))
  clone.style.setProperty('--card-scale', '1')
  clone.style.position = 'fixed'
  clone.style.left = `${left}px`
  clone.style.top = `${top}px`
  clone.style.width = `${width}px`
  clone.style.height = `${height}px`
  clone.style.margin = '0'
  clone.style.pointerEvents = 'none'
  clone.style.zIndex = '10001'
  clone.style.transformOrigin = 'center center'
  clone.style.transform = `translate(0px, 0px) scale(${sourceScale})`
  clone.style.opacity = '1'
  clone.style.clipPath = 'inset(0 0 0 0 round 16px)'
  clone.style.overflow = 'hidden'
  cardOverlay.appendChild(clone)
  return clone
}

function getResolutionPreviewSourceTransform(sourceRect: DOMRect): string {
  const baseCardWidth = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-width'))
  const sourceScale = baseCardWidth > 0 && sourceRect.width > 0 ? sourceRect.width / baseCardWidth : 1
  return `translate(0px, 0px) scale(${sourceScale})`
}

function getResolutionPreviewTransform(
  sourceRect: DOMRect,
  targetX: number,
  targetY: number,
  scale: number
): string {
  return getTransformToPoint(sourceRect, targetX, targetY, scale)
}

function getBoardPreviewTargetRect(hex: Hex, kind: 'unit' | 'tile'): DOMRect {
  const canvasRect = canvas.getBoundingClientRect()
  const center = projectHex(hex)
  const viewportCenterX = canvasRect.left + boardOffset.x + center.x * boardScale
  const viewportCenterY = canvasRect.top + boardOffset.y + center.y * boardScale
  const radiusX = layout.size * boardScale * (kind === 'unit' ? 1.12 : 0.84)
  const radiusY = layout.size * BOARD_TILT * boardScale * (kind === 'unit' ? 1.18 : 0.72)
  return new DOMRect(viewportCenterX - radiusX, viewportCenterY - radiusY, radiusX * 2, radiusY * 2)
}

function getPlayerPreviewTargetRect(player: PlayerId): DOMRect {
  return getPlayerPortraitButton(player).getBoundingClientRect()
}

function parseResolutionPreviewAffectedUnitIds(logEntries: string[]): string[] {
  const unitIds = new Set<string>()
  logEntries.forEach((entry) => {
    const damageMatch = entry.match(/^Unit (.+) takes \d+ damage\.$/)
    if (damageMatch) {
      unitIds.add(damageMatch[1])
      return
    }
    const gainMatch = entry.match(/^Unit (.+) gains \d+ strength\.$/)
    if (gainMatch) {
      unitIds.add(gainMatch[1])
      return
    }
    const regenMatch = entry.match(/^Regeneration heals unit (.+) for \d+\.$/)
    if (regenMatch) {
      unitIds.add(regenMatch[1])
      return
    }
    const splitMatch = entry.match(/^(?:Slime split|Split): (.+) lobs from -?\d+,-?\d+ to -?\d+,-?\d+\.$/)
    if (splitMatch) {
      unitIds.add(splitMatch[1])
      return
    }
    const modifierMatch = entry.match(
      /^Unit (.+) is affected: [a-zA-Z]+ (?:for \d+ turn\(s\)|indefinitely)(?: \(stacks: \d+\))?\.$/
    )
    if (modifierMatch) {
      unitIds.add(modifierMatch[1])
      return
    }
    const clearAllModifiersMatch = entry.match(/^Unit (.+) has all modifiers removed\.$/)
    if (clearAllModifiersMatch) {
      unitIds.add(clearAllModifiersMatch[1])
      return
    }
    const clearDebuffsMatch = entry.match(/^Unit (.+) has debuffs removed\.$/)
    if (clearDebuffsMatch) {
      unitIds.add(clearDebuffsMatch[1])
      return
    }
    const moveMatch = entry.match(/^Unit (.+) moves to -?\d+,-?\d+\.$/)
    if (moveMatch) {
      unitIds.add(moveMatch[1])
    }
  })
  return [...unitIds]
}

function getPreviewUnitTargetSnapshot(
  snapshot: GameState,
  order: GameState['actionQueue'][number],
  unitParam: 'unitId' | 'unitId2'
): { pos: Hex; facing: Direction } | null {
  const unitId = unitParam === 'unitId2' ? order.params.unitId2 : order.params.unitId
  if (!unitId) return null
  return getUnitSnapshot(snapshot, unitId, order.player)
}

function buildResolutionCardPreviewPlan(
  order: GameState['actionQueue'][number],
  beforeState: GameState,
  logEntries: string[],
  animations: BoardAnimation[],
  shouldFizzleForUnavailableTarget = false
): ResolutionCardPreviewPlan {
  void animations
  if (shouldFizzleForUnavailableTarget) {
    return { mode: 'fizzle' }
  }

  const playerTargets: PlayerId[] = []
  const seenPlayerTargets = new Set<PlayerId>()
  const tileTargets: Hex[] = []
  const seenTileTargets = new Set<string>()
  const unitTargets: Hex[] = []
  const seenAffectedUnitTargets = new Set<string>()
  const affectedUnitIds = parseResolutionPreviewAffectedUnitIds(logEntries)

  const pushPlayerTarget = (player: PlayerId): void => {
    if (seenPlayerTargets.has(player)) return
    seenPlayerTargets.add(player)
    playerTargets.push(player)
  }

  const pushTileTarget = (tile: Hex): void => {
    const key = `${tile.q},${tile.r}`
    if (seenTileTargets.has(key)) return
    seenTileTargets.add(key)
    tileTargets.push({ ...tile })
  }

  const pushAffectedUnitTarget = (unitId: string): void => {
    if (seenAffectedUnitTargets.has(unitId)) return
    seenAffectedUnitTargets.add(unitId)
    const normalizedUnitId = normalizeLeaderUnitReference(unitId)
    const pos = beforeState.units[normalizedUnitId]?.pos ?? state.units[normalizedUnitId]?.pos ?? null
    if (!pos) return
    unitTargets.push({ ...pos })
  }

  CARD_DEFS[order.defId].effects.forEach((effect) => {
    if (effect.type === 'applyPlayerModifier') {
      pushPlayerTarget(effect.target === 'opponent' ? (order.player === 0 ? 1 : 0) : order.player)
      return
    }
    if (effect.type === 'budget') {
      pushPlayerTarget(order.player)
      return
    }
    if (effect.type === 'volley') {
      const target = getPreviewUnitTargetSnapshot(beforeState, order, effect.unitParam)
      if (target) {
        unitTargets.push({ ...target.pos })
      }
      return
    }
    if (
      effect.type === 'damageTile' ||
      effect.type === 'damageTileArea' ||
      effect.type === 'damageRadius' ||
      effect.type === 'placeTrap' ||
      effect.type === 'convergeTowardTile' ||
      effect.type === 'spawn' ||
      effect.type === 'spawnAdjacentFriendly' ||
      effect.type === 'spawnSkeletonAdjacent'
    ) {
      const tile = getOrderTileParam(order.params, effect.tileParam)
      if (tile) {
        pushTileTarget(tile)
      }
      return
    }
    if (MULTI_TARGET_PREVIEW_EFFECT_TYPES.has(effect.type)) {
      affectedUnitIds.forEach((unitId) => pushAffectedUnitTarget(unitId))
      return
    }
    if ('unitParam' in effect) {
      const target = getPreviewUnitTargetSnapshot(beforeState, order, effect.unitParam)
      if (target) unitTargets.push({ ...target.pos })
    }
    if ('targetUnitParam' in effect) {
      const target = getPreviewUnitTargetSnapshot(beforeState, order, effect.targetUnitParam)
      if (target) unitTargets.push({ ...target.pos })
    }
  })

  if (playerTargets.length > 0) {
    return {
      mode: 'targeted',
      targets: playerTargets.map((player) => ({
        kind: 'player' as const,
        rect: getPlayerPreviewTargetRect(player),
        scale: RESOLUTION_CARD_TARGET_SCALE_PLAYER,
      })),
    }
  }

  if (tileTargets.length > 0) {
    return {
      mode: 'targeted',
      targets: tileTargets.map((tile) => ({
        kind: 'tile' as const,
        rect: getBoardPreviewTargetRect(tile, 'tile'),
        scale: RESOLUTION_CARD_TARGET_SCALE_TILE,
      })),
    }
  }

  if (unitTargets.length > 0) {
    const targets: ResolutionCardPreviewTarget[] = []
    unitTargets.forEach((pos) => {
      targets.push({
        kind: 'unit' as const,
        rect: getBoardPreviewTargetRect(pos, 'unit'),
        scale: RESOLUTION_CARD_TARGET_SCALE_UNIT,
      })
    })
    if (targets.length > 0) {
      return {
        mode: 'targeted',
        targets,
      }
    }
  }

  return { mode: 'global' }
}

function doesPreviewRequirementTargetPlayer(
  requirement: NonNullable<(typeof CARD_DEFS)[CardDefId]['requires']['unit']>,
  player: PlayerId,
  target: Unit
): boolean {
  if (requirement === 'friendly') return target.owner === player
  if (requirement === 'enemy') return target.owner !== player
  return true
}

function shouldPreviewFizzleForUnavailableTarget(
  order: GameState['actionQueue'][number],
  liveState: GameState
): boolean {
  const def = CARD_DEFS[order.defId]
  const requiredUnitParams: Array<{
    requirement: 'friendly' | 'enemy' | 'any'
    unitParam: 'unitId' | 'unitId2'
  }> = []

  if (def.requires.unit) {
    requiredUnitParams.push({
      requirement: def.requires.unit,
      unitParam: 'unitId',
    })
  }
  if (def.requires.unit2) {
    requiredUnitParams.push({
      requirement: def.requires.unit2,
      unitParam: 'unitId2',
    })
  }

  return requiredUnitParams.some(({ requirement, unitParam }) => {
    const resolvedId = resolveUnitIdFromParams(order.params, liveState.spawnedByOrder, unitParam)
    if (!resolvedId) return true
    const target = liveState.units[resolvedId]
    if (!target) return true
    if (!canCardTargetUnit(order.defId, target)) return true
    return !doesPreviewRequirementTargetPlayer(requirement, order.player, target)
  })
}

async function animateResolutionCardTargetTravel(
  clone: HTMLElement,
  sourceRect: DOMRect,
  startTransform: string,
  target: ResolutionCardPreviewTarget,
  delayMs = 0
): Promise<void> {
  clone.style.transform = startTransform
  clone.style.opacity = '1'
  clone.style.clipPath = 'inset(0 0 0 0 round 16px)'
  clone.getBoundingClientRect()
  if (delayMs > 0) {
    await waitMs(delayMs)
  }
  const targetCenter = getRectCenter(target.rect)
  const endTransform = getResolutionPreviewTransform(sourceRect, targetCenter.x, targetCenter.y, target.scale)
  const animation = clone.animate(
    [
      { transform: startTransform, opacity: 1, clipPath: 'inset(0 0 0 0 round 16px)' },
      { transform: endTransform, opacity: 1, clipPath: 'inset(0 0 0 0 round 16px)' },
    ],
    {
      duration: RESOLUTION_CARD_SHRINK_DURATION_MS,
      easing: 'cubic-bezier(0.18, 0.72, 0.24, 1)',
      fill: 'forwards',
    }
  )
  await waitForWebAnimation(animation)
  clone.style.transform = endTransform
  clone.style.opacity = '1'
  clone.style.clipPath = 'inset(0 0 0 0 round 16px)'
  animation.cancel()
}

async function animateResolutionCardGlobalFade(
  clone: HTMLElement,
  sourceRect: DOMRect,
  targetX: number,
  targetY: number
): Promise<void> {
  const startTransform = getResolutionPreviewTransform(sourceRect, targetX, targetY, RESOLUTION_CARD_SCALE)
  const endTransform = getResolutionPreviewTransform(sourceRect, targetX, targetY, RESOLUTION_CARD_GLOBAL_END_SCALE)
  const animation = clone.animate(
    [
      { transform: startTransform, opacity: 1 },
      { transform: endTransform, opacity: 0 },
    ],
    {
      duration: RESOLUTION_CARD_GLOBAL_FADE_DURATION_MS,
      easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
      fill: 'forwards',
    }
  )
  await waitForWebAnimation(animation)
  clone.style.transform = endTransform
  clone.style.opacity = '0'
  animation.cancel()
}

async function animateResolutionCardBurnUp(
  clone: HTMLElement,
  sourceRect: DOMRect,
  targetX: number,
  targetY: number
): Promise<void> {
  const burnLine = document.createElement('div')
  burnLine.style.position = 'absolute'
  burnLine.style.left = '7%'
  burnLine.style.width = '86%'
  burnLine.style.height = '5px'
  burnLine.style.borderRadius = '999px'
  burnLine.style.background =
    'linear-gradient(90deg, rgba(255,196,112,0) 0%, rgba(255,208,122,0.95) 18%, rgba(255,96,48,1) 50%, rgba(255,208,122,0.95) 82%, rgba(255,196,112,0) 100%)'
  burnLine.style.boxShadow = '0 0 10px rgba(255, 120, 48, 0.85), 0 0 22px rgba(255, 185, 96, 0.55)'
  burnLine.style.bottom = '0%'
  clone.appendChild(burnLine)

  await new Promise<void>((resolve) => {
    const start = performance.now()
    const tick = (now: number) => {
      const raw = clamp((now - start) / RESOLUTION_CARD_FIZZLE_DURATION_MS, 0, 1)
      const eased = easeInOutCubic(raw)
      const removedPercent = eased * 100
      const scale = RESOLUTION_CARD_SCALE + eased * 0.18
      clone.style.transform = getResolutionPreviewTransform(sourceRect, targetX, targetY, scale)
      clone.style.opacity = `${1 - clamp((raw - 0.68) / 0.32, 0, 1)}`
      clone.style.clipPath = `inset(0 0 ${removedPercent}% 0 round 16px)`
      burnLine.style.bottom = `calc(${removedPercent}% - 2px)`
      if (raw >= 1) {
        resolve()
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

async function playResolutionCardPreview(
  source: ResolutionPreviewSource | null,
  plan: ResolutionCardPreviewPlan,
  existingPrimaryClone?: HTMLElement | null
): Promise<void> {
  if (!source) {
    existingPrimaryClone?.remove()
    return
  }
  if (source.rect.width <= 0 || source.rect.height <= 0) {
    existingPrimaryClone?.remove()
    return
  }

  const viewportCenterX = window.innerWidth / 2
  const viewportCenterY = window.innerHeight / 2
  const sourceTransform = getResolutionPreviewSourceTransform(source.rect)
  const centerTransform = getResolutionPreviewTransform(source.rect, viewportCenterX, viewportCenterY, RESOLUTION_CARD_SCALE)
  const primaryClone = existingPrimaryClone ?? createResolutionCardClone(source)
  const clones = [primaryClone]

  try {
    primaryClone.style.transform = sourceTransform
    primaryClone.style.opacity = '1'
    primaryClone.style.clipPath = 'inset(0 0 0 0 round 16px)'
    primaryClone.getBoundingClientRect()
    const approach = primaryClone.animate(
      [
        { transform: sourceTransform, opacity: 1 },
        { transform: centerTransform, opacity: 1 },
      ],
      {
        duration: RESOLUTION_CARD_APPROACH_DURATION_MS,
        easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
        fill: 'forwards',
      }
    )
    await waitForWebAnimation(approach)
    primaryClone.style.transform = centerTransform
    primaryClone.style.opacity = '1'
    approach.cancel()
    await waitMs(RESOLUTION_CARD_HOLD_DURATION_MS)

    if (plan.mode === 'global') {
      await animateResolutionCardGlobalFade(primaryClone, source.rect, viewportCenterX, viewportCenterY)
      return
    }

    if (plan.mode === 'fizzle') {
      await animateResolutionCardBurnUp(primaryClone, source.rect, viewportCenterX, viewportCenterY)
      return
    }

    const targets = plan.targets
    if (targets.length <= 1) {
      const [target] = targets
      if (!target) {
        await animateResolutionCardGlobalFade(primaryClone, source.rect, viewportCenterX, viewportCenterY)
        return
      }
      await animateResolutionCardTargetTravel(primaryClone, source.rect, centerTransform, target)
      return
    }

    for (let index = 1; index < targets.length; index += 1) {
      const clone = createResolutionCardClone(source)
      clone.style.transform = centerTransform
      clone.style.opacity = '1'
      clone.style.clipPath = 'inset(0 0 0 0 round 16px)'
      clone.getBoundingClientRect()
      clones.push(clone)
    }

    await Promise.all(
      clones.map((clone, index) =>
        animateResolutionCardTargetTravel(clone, source.rect, centerTransform, targets[index])
      )
    )
  } finally {
    clones.forEach((clone) => clone.remove())
  }
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
  sanitizeLoadoutsForCurrentClasses()
  if (mode === 'online') {
    loadoutPlayer = onlineSession?.seat ?? planningPlayer
  }
  const loadoutClass = getLoadoutClass(loadoutPlayer)
  const loadoutClassDef = PLAYER_CLASS_DEFS[loadoutClass]
  const deck = loadoutPlayer === 0 ? loadouts.p1 : loadouts.p2
  const maxDeckSize = getLoadoutDeckMaxSize()
  const isDeckFull = typeof maxDeckSize === 'number' && deck.length >= maxDeckSize
  const tutorialSession = getTutorialSession()
  loadoutToggleButton.textContent = mode === 'online' ? 'Your Deck' : `Player ${loadoutPlayer + 1}`
  loadoutToggleButton.classList.toggle('hidden', mode === 'online')
  loadoutContinueButton.classList.toggle('hidden', !(mode === 'online' && onlineSession))
  loadoutContinueButton.disabled = !(mode === 'online' && onlineSession)
  loadoutContinueButton.textContent =
    mode === 'online' && state.winner !== null ? 'Save Deck + Back to Match' : 'Continue to Match'
  loadoutBackButton.textContent = tutorialSession ? 'Tutorial Hub' : 'Back'
  loadoutBackButton.classList.toggle('tutorial-return-ready', Boolean(tutorialSession?.completedAt))
  loadoutCountLabel.textContent =
    typeof maxDeckSize === 'number'
      ? `${deck.length}/${maxDeckSize} cards | ${loadoutClassDef.name}`
      : `${deck.length} cards | ${loadoutClassDef.name}`
  loadoutClassSelect.value = loadoutClass
  loadoutClassSelect.disabled = false
  loadoutClassSelect.style.borderColor = loadoutClassDef.color
  loadoutClassSelect.parentElement?.classList.remove('hidden')
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
      if (!guardTutorialAction('loadout_card_remove', { defId })) return
      deck.splice(index, 1)
      notifyTutorialEvent('loadout_card_removed', { defId })
      renderLoadout()
    })
  })

  const classPool = new Set(getCardPoolForClass(loadoutClass))
  const allCards = Object.values(CARD_DEFS)
    .filter((def) => (classPool ? classPool.has(def.id) : true))
    .filter((def) => loadoutFilter === 'all' || cardCountsAsType(def, loadoutFilter))
    .sort((a, b) => {
      if (loadoutSortMode === 'name') return a.name.localeCompare(b.name)
      const typeDiff = getCardTypeSortRank(a) - getCardTypeSortRank(b)
      return typeDiff !== 0 ? typeDiff : a.name.localeCompare(b.name)
    })

  loadoutAll.innerHTML = allCards
    .map((def) => {
      const count = counts[def.id] ?? 0
      const disabled = isDeckFull || count >= gameSettings.maxCopies
      const cardTypeClassNames = getCardTypeClassNames(def)
      const cardClassName = getCardClassName(def.id)
      return `
        <button class="card loadout-card ${cardTypeClassNames} ${cardClassName} ${disabled ? 'disabled' : ''}" data-add-id="${def.id}" ${
          disabled ? 'disabled' : ''
        } ${getCardStyleAttr(def)}>
          ${renderCardFace(def, { metaText: `${formatCardTypeLabel(def)} | ${count}/${gameSettings.maxCopies}` })}
        </button>
      `
    })
    .join('')

  const addButtons = loadoutAll.querySelectorAll<HTMLButtonElement>('[data-add-id]')
  addButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (isDeckFull) return
      const defId = button.dataset.addId as CardDefId
      if (classPool && !isCardAllowedForClass(defId, loadoutClass)) return
      const count = counts[defId] ?? 0
      if (count >= gameSettings.maxCopies) return
      if (!guardTutorialAction('loadout_card_add', { defId })) return
      deck.push(defId)
      notifyTutorialEvent('loadout_card_added', { defId })
      renderLoadout()
    })
  })

  updateSeedDisplay()
  syncTutorialUi()
}
function renderSettings(): void {
  settingRows.value = String(gameSettings.boardRows)
  settingCols.value = String(gameSettings.boardCols)
  settingLeaderStrength.value = String(gameSettings.leaderStrength)
  settingDeck.value = String(gameSettings.deckSize)
  settingDraw.value = String(gameSettings.drawPerTurn)
  settingMaxCopies.value = String(gameSettings.maxCopies)
  settingActionBudgetP1.value = String(gameSettings.actionBudgetP1)
  settingActionBudgetP2.value = String(gameSettings.actionBudgetP2)
  updateSeedDisplay()
  syncTutorialUi()
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
  const maxSize = mode === 'roguelike' ? null : newSize
  if (typeof maxSize === 'number' && loadouts.p1.length > maxSize) loadouts.p1 = loadouts.p1.slice(0, maxSize)
  if (typeof maxSize === 'number' && loadouts.p2.length > maxSize) loadouts.p2 = loadouts.p2.slice(0, maxSize)
  sanitizeLoadoutsForCurrentClasses()
}

function enforceMaxCopies(): void {
  sanitizeLoadoutsForCurrentClasses()
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
    playerClasses: { ...playerClasses },
  }
}

function updateSeedDisplay(): void {
  if (!seedInput) return
  seedInput.value = encodeSeed(getSeedPayload())
  seedStatus.textContent = ''
}

function applySeed(seed: string): void {
  invalidateBotPlanning()
  const payload = decodeSeed(seed)
  gameSettings = normalizeGameSettingsInput(payload.settings)
  playerClasses = normalizePlayerClassesInput(payload.playerClasses)
  loadouts = {
    p1: [...(payload.loadouts?.p1 ?? [])],
    p2: [...(payload.loadouts?.p2 ?? [])],
  }
  sanitizeLoadoutsForCurrentClasses()
  state = createStandardMatchState()
  resetLocalTelemetryForCurrentMatch()
  if (isBotControlledMode()) {
    planningPlayer = BOT_HUMAN_PLAYER
  }
  if (screen === 'settings') renderSettings()
  if (screen === 'loadout') renderLoadout()
  updateSeedDisplay()
}

function getRoguelikeMatchNumber(run: RoguelikeRunState): number {
  return Math.max(1, run.wins + 1)
}

function getEncounterById(id: RoguelikeEncounterId): RoguelikeEncounterDef | null {
  return ROGUELIKE_ENCOUNTER_DEFS.find((encounter) => encounter.id === id) ?? null
}

function pickRandomRoguelikeEncounter(): RoguelikeEncounterDef {
  const index = Math.floor(Math.random() * ROGUELIKE_ENCOUNTER_DEFS.length)
  return ROGUELIKE_ENCOUNTER_DEFS[Math.max(0, Math.min(index, ROGUELIKE_ENCOUNTER_DEFS.length - 1))]
}

function getRoguelikeEncounterActionBudget(encounter: RoguelikeEncounterDef, matchNumber: number): number {
  const fallback = ROGUELIKE_BASE_AP_BUDGET + Math.floor(matchNumber / 5)
  const value = encounter.actionBudget?.(matchNumber) ?? fallback
  return Math.max(1, Math.floor(value))
}

function getEncounterRoleStrength(role: RoguelikeEncounterUnitRole, matchNumber: number): number {
  if (role === 'slime_grand') return 5 + Math.floor(matchNumber / 2)
  if (role === 'slime_mid') return 3 + Math.floor(matchNumber / 4)
  if (role === 'slime_small') return 1 + Math.floor(matchNumber / 8)
  if (role === 'troll') return 10 + Math.floor(matchNumber / 2)
  if (role === 'alpha_wolf') return 4 + Math.floor(matchNumber / 3)
  if (role === 'ice_spirit' || role === 'fire_spirit' || role === 'lightning_spirit') return 2 + Math.floor(matchNumber / 3)
  if (role === 'bandit') return 3 + Math.floor(matchNumber / 5)
  if (role === 'necromancer') return 4 + Math.floor(matchNumber / 4)
  if (role === 'skeleton_soldier' || role === 'skeleton_warrior' || role === 'skeleton_mage') return 2
  return 2 + Math.floor(matchNumber / 6)
}

function getEncounterUnitLabel(role: Unit['roguelikeRole']): string {
  if (role === 'slime_grand') return 'Grandslime'
  if (role === 'slime_mid') return 'Slime'
  if (role === 'slime_small') return 'Slimeling'
  if (role === 'troll') return 'Troll'
  if (role === 'alpha_wolf') return 'Alpha Wolf'
  if (role === 'wolf') return 'Wolf'
  if (role === 'ice_spirit') return 'Ice Spirit'
  if (role === 'fire_spirit') return 'Fire Spirit'
  if (role === 'lightning_spirit') return 'Lightning Spirit'
  if (role === 'bandit') return 'Bandit'
  if (role === 'necromancer') return 'Necromancer'
  if (role === 'skeleton_soldier') return 'Skeleton Soldier'
  if (role === 'skeleton_warrior') return 'Skeleton Warrior'
  if (role === 'skeleton_mage') return 'Skeleton Mage'
  return 'Unit'
}

function getEncounterRoleScale(role: Unit['roguelikeRole']): number {
  if (role === 'slime_grand') return 1.26
  if (role === 'slime_mid') return 1.05
  if (role === 'slime_small') return 0.8
  if (role === 'alpha_wolf') return 1.12
  if (role === 'ice_spirit' || role === 'fire_spirit' || role === 'lightning_spirit') return 1.08
  if (role === 'bandit') return 0.98
  if (role === 'necromancer') return 1.08
  if (role === 'skeleton_soldier') return 0.98
  if (role === 'skeleton_warrior') return 1.02
  if (role === 'skeleton_mage') return 0.96
  return 1
}

function getUnitAtHex(sourceState: GameState, hex: Hex): Unit | null {
  for (const unit of Object.values(sourceState.units)) {
    if (unit.pos.q === hex.q && unit.pos.r === hex.r) return unit
  }
  return null
}

function addStartingUnit(sourceState: GameState, owner: PlayerId, strength: number): boolean {
  const leader = sourceState.units[`leader-${owner}`]
  if (!leader) return false
  const spawnTiles = getSpawnTiles(sourceState, owner)
  for (const tile of spawnTiles) {
    if (getUnitAtHex(sourceState, tile)) continue
    const id = `u${owner}-${sourceState.nextUnitId}`
    sourceState.nextUnitId += 1
    sourceState.units[id] = {
      id,
      owner,
      kind: 'unit',
      strength: Math.max(1, strength),
      pos: { ...tile },
      facing: leader.facing,
      modifiers: [],
    }
    return true
  }
  return false
}

function addMultipleStartingUnits(sourceState: GameState, owner: PlayerId, count: number, strength: number): void {
  for (let i = 0; i < count; i += 1) {
    if (!addStartingUnit(sourceState, owner, strength)) break
  }
}

function buildEncounterRoleList(
  encounter: RoguelikeEncounterDef,
  matchNumber: number
): Array<{ role: RoguelikeEncounterUnitRole; isMinion: boolean }> {
  return encounter.unitCounts(matchNumber)
    .flatMap((entry) =>
      Array.from({ length: Math.max(0, Math.floor(entry.count)) }, () => {
        const rolePool = Array.isArray(entry.role) ? entry.role : [entry.role]
        const index = Math.floor(Math.random() * rolePool.length)
        const role = rolePool[Math.max(0, Math.min(index, rolePool.length - 1))] ?? rolePool[0]
        return {
          role,
          isMinion: entry.isMinion === true,
        }
      })
    )
}

function getEncounterPlacementTiles(sourceState: GameState): Hex[] {
  const topAnchor = { q: Math.floor(sourceState.boardCols / 2), r: 0 }
  const bottomAnchor = { q: Math.floor(sourceState.boardCols / 2), r: sourceState.boardRows - 1 }
  const distanceBuckets = new Map<number, Hex[]>()
  sourceState.tiles.forEach((tile) => {
    if (tile.r > Math.floor((sourceState.boardRows - 1) * 0.78)) return
    const hex = { q: tile.q, r: tile.r }
    if (
      (hex.q === topAnchor.q && hex.r === topAnchor.r) ||
      (hex.q === bottomAnchor.q && hex.r === bottomAnchor.r)
    ) {
      return
    }
    const key = Math.floor(hexDistance(hex, topAnchor))
    if (!distanceBuckets.has(key)) {
      distanceBuckets.set(key, [])
    }
    distanceBuckets.get(key)!.push(hex)
  })
  return [...distanceBuckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([, entries]) => shuffleCards(entries))
}

function placeEncounterUnits(
  sourceState: GameState,
  encounter: RoguelikeEncounterDef,
  matchNumber: number
): void {
  const roles = buildEncounterRoleList(encounter, matchNumber)
  const placementTiles = getEncounterPlacementTiles(sourceState)
  const facing: Direction = 5
  roles.forEach(({ role, isMinion }) => {
    const tile = placementTiles.find((candidate) => !getUnitAtHex(sourceState, candidate))
    if (!tile) return
    const id = `u${BOT_PLAYER}-${sourceState.nextUnitId}`
    sourceState.nextUnitId += 1
    const modifiers: Unit['modifiers'] = role === 'troll' ? [{ type: 'regeneration', turnsRemaining: 'indefinite' }] : []
    sourceState.units[id] = {
      id,
      owner: BOT_PLAYER,
      kind: 'unit',
      strength: getEncounterRoleStrength(role, matchNumber),
      pos: { ...tile },
      facing,
      modifiers,
      roguelikeRole: role,
      isMinion,
    }
  })
}

function applyRoguelikeEncounterSetup(
  sourceState: GameState,
  encounter: RoguelikeEncounterDef,
  matchNumber: number
): void {
  Object.entries(sourceState.units).forEach(([unitId, unit]) => {
    if (unit.owner !== BOT_PLAYER) return
    delete sourceState.units[unitId]
  })
  sourceState.settings = {
    ...sourceState.settings,
    victoryCondition: 'eliminate_units',
    roguelikeMatchNumber: matchNumber,
    roguelikeEncounterId: encounter.id,
  }
  placeEncounterUnits(sourceState, encounter, matchNumber)
  syncUnitState(sourceState)
}

function shuffleCards<T>(cards: T[]): T[] {
  const copy = [...cards]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function drawCardToHand(sourceState: GameState, player: PlayerId): boolean {
  const playerState = sourceState.players[player]
  if (playerState.deck.length === 0) {
    if (playerState.discard.length === 0) return false
    playerState.deck = shuffleCards(playerState.discard)
    playerState.discard = []
  }
  const card = playerState.deck.shift()
  if (!card) return false
  playerState.hand.push(card)
  return true
}

function applyOpeningHandDrawDelta(sourceState: GameState, player: PlayerId, drawDelta: number): void {
  if (drawDelta === 0) return
  const playerState = sourceState.players[player]
  if (drawDelta > 0) {
    for (let i = 0; i < drawDelta; i += 1) {
      if (!drawCardToHand(sourceState, player)) break
    }
    return
  }

  const removeCount = Math.min(playerState.hand.length, Math.abs(drawDelta))
  for (let i = 0; i < removeCount; i += 1) {
    const card = playerState.hand.pop()
    if (!card) break
    // Put cards back on top so opening hand mirrors a reduced draw count.
    playerState.deck.unshift(card)
  }
}

function applyRoguelikeMatchModifiers(
  sourceState: GameState,
  run: RoguelikeRunState,
  encounter: RoguelikeEncounterDef,
  matchNumber: number
): void {
  const playerLeader = sourceState.units[`leader-${BOT_HUMAN_PLAYER}`]
  if (playerLeader) {
    playerLeader.strength = Math.max(1, run.leaderHp)
  }

  let p1Budget = ROGUELIKE_BASE_AP_BUDGET
  let p2Budget = getRoguelikeEncounterActionBudget(encounter, matchNumber)
  if (run.bonusActionBudget > 0) {
    p1Budget = Math.max(1, p1Budget + run.bonusActionBudget)
  }
  sourceState.actionBudgets = [p1Budget, p2Budget]
  sourceState.settings = {
    ...sourceState.settings,
    actionBudgetP1: p1Budget,
    actionBudgetP2: p2Budget,
  }

  if (run.bonusDrawPerTurn !== 0) {
    sourceState.players[BOT_HUMAN_PLAYER].modifiers.push({
      type: 'extraDraw',
      amount: run.bonusDrawPerTurn,
      turnsRemaining: 'indefinite',
    })
    applyOpeningHandDrawDelta(sourceState, BOT_HUMAN_PLAYER, run.bonusDrawPerTurn)
  }

  if (run.bonusStartingUnits > 0) {
    addMultipleStartingUnits(sourceState, BOT_HUMAN_PLAYER, run.bonusStartingUnits, 2)
  }
  if (run.bonusStartingUnitStrength > 0) {
    Object.values(sourceState.units).forEach((unit) => {
      if (unit.owner !== BOT_HUMAN_PLAYER || unit.kind !== 'unit') return
      unit.strength = Math.max(1, unit.strength + run.bonusStartingUnitStrength)
    })
  }
}

function startNextRoguelikeMatch(statusMessage: string): void {
  if (!roguelikeRun) return
  invalidateBotPlanning()
  resetCardVisualState()
  clearActionAnimationState()
  clearUnitStatusPopoverState()
  winnerExtraEl.innerHTML = ''

  const matchNumber = getRoguelikeMatchNumber(roguelikeRun)
  const encounter = pickRandomRoguelikeEncounter()
  const encounterDeck = encounter.deck(matchNumber)
  const settings: GameSettings = {
    ...gameSettings,
    leaderStrength: ROGUELIKE_STARTING_LEADER_HP,
    victoryCondition: 'eliminate_units',
    roguelikeMatchNumber: matchNumber,
    roguelikeEncounterId: encounter.id,
  }
  const playerClass = roguelikeRun.playerClass
  const playerDeck = sanitizeDeckForCurrentClass([...roguelikeRun.deck], playerClass, true, null)
  if (playerDeck.length === 0) {
    playerDeck.push(...sanitizeDeckForCurrentClass([...ROGUELIKE_STARTING_DECK], playerClass, true, null))
  }
  roguelikeRun.deck = [...playerDeck]
  roguelikeRun.currentEncounterId = encounter.id
  roguelikeRun.currentMatchNumber = matchNumber
  playerClasses.p1 = playerClass
  playerClasses.p2 = 'commander'

  state = createGameState(settings, {
    p1: playerDeck,
    p2: encounterDeck,
  }, { p1: playerClass, p2: null })
  applyRoguelikeMatchModifiers(state, roguelikeRun, encounter, matchNumber)
  applyRoguelikeEncounterSetup(state, encounter, matchNumber)
  resetLocalTelemetryForCurrentMatch()
  suppressWinnerModalForRestoredOutcome = false
  roguelikeRun.resultHandled = false
  roguelikeRun.uiStage = 'reward_choice'
  roguelikeRun.draftOptions = []
  roguelikeRun.pendingRandomReward = null
  roguelikeRun.rewardNoticeMessage = null
  planningPlayer = BOT_HUMAN_PLAYER
  selectedCardId = null
  pendingOrder = null
  winnerModal.classList.add('hidden')
  updateReadyButtons()
  statusEl.textContent = `${statusMessage} Encounter: ${encounter.name}.`
  render()
}

function startRoguelikeRun(): void {
  applyPlayMode('roguelike')
  roguelikeRun = createInitialRoguelikeRunState(getLoadoutClass(0))
  startNextRoguelikeMatch('Roguelike run started. Match 1 begins.')
  setScreen('game')
}

function pickWeightedRoguelikeReward(): RoguelikeRandomReward {
  const entries = (Object.entries(ROGUELIKE_RANDOM_REWARD_WEIGHTS) as Array<[RoguelikeRandomReward, number]>).filter(
    ([reward]) => reward !== 'removeCard' || (roguelikeRun?.deck.length ?? 0) > 1
  )
  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0)
  let roll = Math.random() * totalWeight
  for (const [reward, weight] of entries) {
    roll -= weight
    if (roll <= 0) return reward
  }
  return entries[entries.length - 1][0]
}

function pickRandomCardOptions(count: number, classId: PlayerClassId): CardDefId[] {
  const pool = [...getCardPoolForClass(classId)]
  const picks: CardDefId[] = []
  while (pool.length > 0 && picks.length < count) {
    const totalWeight = pool.reduce((sum, cardId) => sum + (getCardClassId(cardId) === classId ? 3 : 1), 0)
    let roll = Math.random() * totalWeight
    let pickedIndex = pool.length - 1
    for (let i = 0; i < pool.length; i += 1) {
      roll -= getCardClassId(pool[i]) === classId ? 3 : 1
      if (roll <= 0) {
        pickedIndex = i
        break
      }
    }
    const [picked] = pool.splice(pickedIndex, 1)
    if (picked) {
      picks.push(picked)
    }
  }
  return picks
}

function getRoguelikeRandomRewardLabel(reward: RoguelikeRandomReward): string {
  if (!roguelikeRun) return 'Reward'
  if (reward === 'leaderHp') {
    return `+5 ${PLAYER_CLASS_DEFS[roguelikeRun.playerClass].name} HP`
  }
  if (reward === 'extraDraw') return '+1 extra card each hand'
  if (reward === 'extraAp') return '+1 action budget'
  if (reward === 'extraStartingUnit') return '+1 starting unit'
  if (reward === 'removeCard') return 'Remove a card'
  return '+1 starting unit strength'
}

function renderRoguelikeRewardCardOption(
  cardId: CardDefId,
  action: 'draft' | 'remove-card',
  metaText: string,
  extraData = ''
): string {
  const def = CARD_DEFS[cardId]
  return `
    <button
      class="card winner-option winner-reward-card ${getCardTypeClassNames(def)} ${getCardClassName(def.id)}"
      data-roguelike-action="${action}"
      data-card-id="${cardId}"
      ${extraData}
      type="button"
      ${getCardStyleAttr(def)}
    >
      ${renderCardFace(def, { metaText })}
    </button>
  `
}

function prepareRoguelikeRewardChoiceOptions(): void {
  if (!roguelikeRun) return
  if (roguelikeRun.draftOptions.length < 3) {
    roguelikeRun.draftOptions = pickRandomCardOptions(3, roguelikeRun.playerClass)
  }
  if (!roguelikeRun.pendingRandomReward) {
    roguelikeRun.pendingRandomReward = pickWeightedRoguelikeReward()
  }
}

function applyRoguelikeRandomReward(reward: RoguelikeRandomReward): void {
  if (!roguelikeRun) return
  if (reward === 'leaderHp') {
    roguelikeRun.leaderHp += 5
    showRoguelikeRewardNotice(`Reward gained: +5 ${PLAYER_CLASS_DEFS[roguelikeRun.playerClass].name} HP.`)
    return
  }
  if (reward === 'extraDraw') {
    roguelikeRun.bonusDrawPerTurn += 1
    showRoguelikeRewardNotice('Reward gained: +1 extra card each hand.')
    return
  }
  if (reward === 'extraAp') {
    roguelikeRun.bonusActionBudget += 1
    showRoguelikeRewardNotice('Reward gained: +1 action budget.')
    return
  }
  if (reward === 'extraStartingUnit') {
    roguelikeRun.bonusStartingUnits += 1
    showRoguelikeRewardNotice('Reward gained: +1 starting unit.')
    return
  }
  if (reward === 'removeCard') {
    if (roguelikeRun.deck.length <= 1) {
      showRoguelikeRewardNotice('Reward gained: deck too small to remove a card.')
      return
    }
    roguelikeRun.uiStage = 'remove_choice'
    render()
    return
  }
  roguelikeRun.bonusStartingUnitStrength += 1
  showRoguelikeRewardNotice('Reward gained: +1 starting unit strength.')
}

function startRoguelikeMatchAfterReward(statusMessage: string): void {
  if (!roguelikeRun) return
  const matchNumber = roguelikeRun.wins + 1
  startNextRoguelikeMatch(`${statusMessage} Match ${matchNumber} begins.`)
}

function showRoguelikeRewardNotice(message: string): void {
  if (!roguelikeRun) return
  roguelikeRun.rewardNoticeMessage = message
  roguelikeRun.uiStage = 'reward_notice'
  render()
}

function continueAfterRoguelikeRewardNotice(): void {
  if (!roguelikeRun) return
  if (roguelikeRun.uiStage !== 'reward_notice') return
  const message = roguelikeRun.rewardNoticeMessage ?? 'Reward gained.'
  roguelikeRun.rewardNoticeMessage = null
  startRoguelikeMatchAfterReward(message)
}

function chooseRoguelikeRandomReward(): void {
  if (!roguelikeRun || state.winner !== BOT_HUMAN_PLAYER) return
  const reward = roguelikeRun.pendingRandomReward ?? pickWeightedRoguelikeReward()
  roguelikeRun.pendingRandomReward = null
  applyRoguelikeRandomReward(reward)
}

function handleRoguelikeMatchResultIfNeeded(): void {
  if (mode !== 'roguelike' || !roguelikeRun) return
  if (state.winner === null) return
  if (roguelikeRun.resultHandled) return

  roguelikeRun.resultHandled = true

  if (state.winner === BOT_HUMAN_PLAYER) {
    const leader = state.units[`leader-${BOT_HUMAN_PLAYER}`]
    roguelikeRun.leaderHp = Math.max(1, leader?.strength ?? roguelikeRun.leaderHp)
    roguelikeRun.wins += 1
    roguelikeRun.uiStage = 'reward_choice'
    roguelikeRun.draftOptions = []
    roguelikeRun.pendingRandomReward = null
    prepareRoguelikeRewardChoiceOptions()
    return
  }

  roguelikeRun.draftOptions = []
  roguelikeRun.pendingRandomReward = null
  roguelikeRun.uiStage = 'run_over'
}

function renderRoguelikeWinnerModal(): void {
  if (mode !== 'roguelike' || !roguelikeRun || state.winner === null) return

  winnerExtraEl.innerHTML = ''
  winnerMenuButton.classList.remove('hidden')
  winnerResetButton.classList.remove('hidden')
  winnerRematchButton.classList.add('hidden')
  winnerResetButton.disabled = false
  winnerRematchButton.disabled = false

  if (state.winner === BOT_HUMAN_PLAYER) {
    const nextMatch = roguelikeRun.wins + 1
    if (roguelikeRun.uiStage === 'reward_notice') {
      winnerTextEl.textContent = `Match ${roguelikeRun.wins} won. Reward received.`
      winnerNoteEl.textContent = roguelikeRun.rewardNoticeMessage ?? 'Reward gained.'
      winnerMenuButton.textContent = 'End Run'
      winnerResetButton.classList.add('hidden')
      winnerRematchButton.classList.add('hidden')
      winnerExtraEl.innerHTML =
        '<button class="btn winner-option" data-roguelike-action="continue-reward" type="button">Continue to Next Match</button>'
      winnerModal.classList.remove('hidden')
      return
    }
    if (roguelikeRun.uiStage === 'remove_choice') {
      winnerTextEl.textContent = `Match ${roguelikeRun.wins} won.`
      winnerNoteEl.textContent = 'Choose a card to remove before the next match.'
      winnerMenuButton.textContent = 'End Run'
      winnerResetButton.classList.add('hidden')
      winnerRematchButton.classList.add('hidden')
      winnerExtraEl.innerHTML = [
        ...roguelikeRun.deck.map((cardId, index) =>
          renderRoguelikeRewardCardOption(cardId, 'remove-card', 'Remove from deck', `data-deck-index="${index}"`)
        ),
        '<button class="btn winner-option" data-roguelike-action="skip-reward" type="button">Skip Reward</button>',
      ].join('')
      winnerModal.classList.remove('hidden')
      return
    }
    prepareRoguelikeRewardChoiceOptions()
    winnerTextEl.textContent = `Match ${roguelikeRun.wins} won.`
    winnerNoteEl.textContent = `${PLAYER_CLASS_DEFS[roguelikeRun.playerClass].name} HP carries over: ${roguelikeRun.leaderHp}. Choose your reward for match ${nextMatch}.`
    winnerMenuButton.textContent = 'End Run'
    winnerResetButton.classList.add('hidden')
    winnerRematchButton.classList.remove('hidden')
    const randomReward = roguelikeRun.pendingRandomReward ?? pickWeightedRoguelikeReward()
    roguelikeRun.pendingRandomReward = randomReward
    winnerRematchButton.textContent = `Random: ${getRoguelikeRandomRewardLabel(randomReward)}`
    winnerRematchButton.disabled = false
    winnerExtraEl.innerHTML = [
      ...roguelikeRun.draftOptions.map((cardId) => renderRoguelikeRewardCardOption(cardId, 'draft', 'Add to deck')),
      '<button class="btn winner-option" data-roguelike-action="skip-reward" type="button">Skip Reward</button>',
    ].join('')
  } else {
    winnerTextEl.textContent = 'Roguelike run ended.'
    winnerNoteEl.textContent = `Matches won before loss: ${roguelikeRun.wins}.`
    winnerMenuButton.textContent = 'Main Menu'
    winnerResetButton.textContent = 'New Run'
    winnerResetButton.classList.remove('hidden')
    winnerRematchButton.classList.add('hidden')
  }

  winnerModal.classList.remove('hidden')
}

function renderMeta(): void {
  turnEl.textContent = `Turn ${state.turn}`
  activeEl.textContent = `Active Player: ${state.activePlayer + 1}`
  const compactLabels = window.matchMedia('(max-width: 720px)').matches
  if (mode === 'online') {
    plannerNameEl.textContent = compactLabels ? `P${planningPlayer + 1} Online` : `Player ${planningPlayer + 1} Online`
  } else if (mode === 'roguelike') {
    const encounterLabel = roguelikeRun?.currentEncounterId
      ? getEncounterById(roguelikeRun.currentEncounterId)?.name ?? null
      : null
    plannerNameEl.textContent = compactLabels
      ? `P1 Run ${roguelikeRun?.wins ?? 0}`
      : encounterLabel
        ? `Run ${roguelikeRun?.wins ?? 0} | ${encounterLabel}`
        : `Roguelike Run ${roguelikeRun?.wins ?? 0}`
  } else if (isBotControlledMode()) {
    plannerNameEl.textContent = compactLabels ? 'P1' : 'Player 1'
  } else {
    plannerNameEl.textContent = compactLabels ? `P${planningPlayer + 1}` : `Player ${planningPlayer + 1}`
  }
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
  const deckP1 = mode === 'online' && counts ? counts[0].deck : state.players[0].deck.length
  const deckP2 = mode === 'online' && counts ? counts[1].deck : state.players[1].deck.length
  const discardP1 = mode === 'online' && counts ? counts[0].discard : state.players[0].discard.length
  const discardP2 = mode === 'online' && counts ? counts[1].discard : state.players[1].discard.length
  countsDeckP1El.textContent = `Deck P1: ${deckP1}`
  countsDeckP2El.textContent = `Deck P2: ${deckP2}`
  countsDiscardP1El.textContent = `Discard P1: ${discardP1}`
  countsDiscardP2El.textContent = `Discard P2: ${discardP2}`

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
  gameTutorialHubButton.textContent = compactLabels ? 'Tutorial' : 'Tutorial Hub'
  gameTutorialHubButton.classList.toggle('hidden', !isTutorialLessonActive())
  resetGameButton.textContent =
    mode === 'online'
      ? compactLabels
        ? 'Reset Off'
        : 'Reset (Local Only)'
      : mode === 'roguelike'
        ? compactLabels
          ? 'Restart'
          : 'Restart Match'
        : compactLabels
          ? 'Reset'
          : 'Reset Game'
  const tutorialSession = getTutorialSession()
  if (tutorialSession?.completedAt && state.winner !== null) {
    winnerMenuButton.textContent = 'Back to Tutorials'
    winnerResetButton.textContent = 'Replay Lesson'
    winnerRematchButton.classList.add('hidden')
    winnerRematchButton.disabled = true
    return
  }
  winnerMenuButton.textContent = mode === 'online' ? 'Leave Match' : 'Main Menu'
  winnerResetButton.textContent = mode === 'online' ? 'Edit Deck' : 'Reset Game'
  winnerRematchButton.classList.toggle('hidden', mode !== 'online')
  winnerRematchButton.textContent = onlineRematchRequested ? 'Rematch Pending' : 'Rematch'
  winnerRematchButton.disabled = mode !== 'online' || onlineRematchRequested || !(onlineSession?.connected ?? false)
}

function syncPhaseControlPlacement(): void {
  if (readyButton.parentElement !== planningReadySlotEl) {
    planningReadySlotEl.appendChild(readyButton)
  }
  const inResolution = state.phase === 'action'
  const resolveParent = inResolution ? resolutionControlsEl : boardControlsEl
  if (resolveNextButton.parentElement !== resolveParent) {
    resolveParent.appendChild(resolveNextButton)
  }
  if (resolveAllButton.parentElement !== resolveParent) {
    resolveParent.appendChild(resolveAllButton)
  }
}

function render(): void {
  applyMatchClassTheme()
  syncPhaseControlPlacement()
  previewState = state.phase === 'planning' ? simulatePlannedState(state, planningPlayer) : null
  const canShowWinnerModal = screen === 'game' && !gameScreen.classList.contains('hidden')
  const handScroll = handEl.scrollLeft
  const ordersScroll = ordersEl.scrollLeft
  computeLayout()
  drawBoard()
  renderUnitStatusPopover()
  renderMeta()
  renderPlayerPortraits()
  renderPlayerStatusPopover()
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
  if (hasPointer && !lastInputWasTouch) {
    updateUnitStatusHoverFromPointer(lastPointer.x, lastPointer.y)
  } else {
    renderUnitStatusPopover()
  }

  if (state.winner !== null) {
    trySubmitLocalTelemetryIfNeeded()
    if (mode === 'roguelike' && roguelikeRun) {
      handleRoguelikeMatchResultIfNeeded()
      statusEl.textContent =
        state.winner === BOT_HUMAN_PLAYER
          ? `Match ${roguelikeRun.wins} won. Choose your reward.`
          : `Run over. Matches won: ${roguelikeRun.wins}.`
      if (canShowWinnerModal) {
        renderRoguelikeWinnerModal()
      } else {
        winnerModal.classList.add('hidden')
      }
    } else {
      statusEl.textContent = `Player ${state.winner + 1} wins!`
      winnerTextEl.textContent = `Player ${state.winner + 1} wins the game.`
      winnerNoteEl.textContent =
        mode === 'online' && onlineRematchRequested ? 'Rematch requested, waiting for opponent.' : ''
      winnerModal.classList.toggle('hidden', suppressWinnerModalForRestoredOutcome || !canShowWinnerModal)
    }
  } else {
    suppressWinnerModalForRestoredOutcome = false
    winnerNoteEl.textContent = ''
    winnerExtraEl.innerHTML = ''
    winnerModal.classList.add('hidden')
  }

  if (state.turn !== lastObservedTurn) {
    lastObservedTurn = state.turn
    notifyTutorialEvent('turn_changed', { turn: state.turn })
  }
  if (state.winner !== lastObservedWinner) {
    lastObservedWinner = state.winner
    if (state.winner !== null) {
      notifyTutorialEvent('winner_shown', { winner: state.winner })
    }
  }
  const roguelikeRewardVisible =
    mode === 'roguelike' &&
    Boolean(
      roguelikeRun &&
        state.winner === BOT_HUMAN_PLAYER &&
        (roguelikeRun.uiStage === 'reward_choice' || roguelikeRun.uiStage === 'remove_choice')
    ) &&
    !winnerModal.classList.contains('hidden')
  if (roguelikeRewardVisible && !lastObservedRoguelikeRewardVisible) {
    notifyTutorialEvent('roguelike_reward_shown')
  }
  lastObservedRoguelikeRewardVisible = roguelikeRewardVisible

  const inPlanning = state.phase === 'planning'
  const inOnlineMode = mode === 'online'
  const inBotMode = isBotControlledMode()
  const inOnlineReplayAction = inOnlineMode && isOnlineResolutionReplayActive()
  const showResolutionControls = !inPlanning && !(inOnlineMode && !inOnlineReplayAction)
  const roomPaused = inOnlineMode ? onlineSession?.presence.paused ?? false : false
  const disconnected = inOnlineMode ? !(onlineSession?.connected ?? false) : false
  readyButton.classList.toggle('hidden', !inPlanning)
  resolveNextButton.classList.toggle('hidden', !showResolutionControls)
  resolveAllButton.classList.toggle('hidden', !showResolutionControls)
  handEl.classList.toggle('resolution-hidden-hand', showResolutionControls)
  resolutionControlsEl.classList.toggle('hidden', !showResolutionControls)
  switchPlannerButton.classList.toggle('hidden', mode !== 'local')
  readyButton.disabled = !inPlanning || state.ready[planningPlayer] || roomPaused || disconnected || (inBotMode && botThinking)
  resolveNextButton.disabled = state.phase !== 'action' || isAnimating
  resolveAllButton.disabled = state.phase !== 'action' || isAnimating
  const cardsCanReorder = inPlanning && !state.ready[planningPlayer] && !isBotPlanningLocked()
  handEl.classList.toggle('reorder-enabled', cardsCanReorder)
  ordersEl.classList.toggle('reorder-enabled', cardsCanReorder)
  resetGameButton.disabled = inOnlineMode
  scheduleProgressSave()
  syncTutorialUi()
}

function renderBoardOnly(): void {
  previewState = state.phase === 'planning' ? simulatePlannedState(state, planningPlayer) : null
  computeLayout()
  drawBoard()
  renderUnitStatusPopover()
  renderPlayerPortraits()
  renderPlayerStatusPopover()
  renderTutorialSpotlights()
  positionTutorialOverlay()
}

function snapshotUnits(source: GameState): Record<string, UnitSnapshot> {
  const snap: Record<string, UnitSnapshot> = {}
  Object.values(source.units).forEach((unit) => {
    snap[unit.id] = {
      id: unit.id,
      pos: { ...unit.pos },
      facing: unit.facing,
      strength: unit.strength,
      owner: unit.owner,
      kind: unit.kind,
      roguelikeRole: unit.roguelikeRole,
      isMinion: unit.isMinion,
      modifiers: unit.modifiers.map((modifier) => ({ ...modifier })),
    }
  })
  return snap
}

function cloneSnapshotUnit(snapshot: UnitSnapshot): Unit {
  return {
    id: snapshot.id,
    owner: snapshot.owner,
    kind: snapshot.kind,
    strength: snapshot.strength,
    pos: { ...snapshot.pos },
    facing: snapshot.facing,
    modifiers: snapshot.modifiers.map((modifier) => ({ ...modifier })),
    roguelikeRole: snapshot.roguelikeRole,
    isMinion: snapshot.isMinion,
  }
}

function startAnimationBoardSync(before: Record<string, UnitSnapshot>, logEntries: string[]): void {
  const units: Record<string, Unit> = {}
  Object.values(before).forEach((snapshot) => {
    units[snapshot.id] = cloneSnapshotUnit(snapshot)
  })
  animationRenderUnits = units
  animationLogEntriesForSync = [...logEntries]
  animationAppliedLogIndex = -1
}

function clearAnimationBoardSync(): void {
  animationRenderUnits = null
  animationLogEntriesForSync = []
  animationAppliedLogIndex = -1
}

function parseModifierDuration(raw: string | undefined): number | 'indefinite' {
  if (!raw) return 'indefinite'
  const turns = Number(raw)
  if (!Number.isFinite(turns)) return 'indefinite'
  return Math.max(0, Math.floor(turns))
}

function applyAnimationBoardSyncUpTo(upToLogIndex: number): void {
  if (!animationRenderUnits) return
  if (animationLogEntriesForSync.length === 0) return
  if (upToLogIndex <= animationAppliedLogIndex) return
  const capped = Math.min(upToLogIndex, animationLogEntriesForSync.length - 1)
  for (let index = animationAppliedLogIndex + 1; index <= capped; index += 1) {
    const entry = animationLogEntriesForSync[index]
    if (!entry) continue

    const moveMatch = entry.match(/^Unit (.+) moves to (-?\d+),(-?\d+)\.$/)
    if (moveMatch) {
      const unit = animationRenderUnits[moveMatch[1]]
      if (unit) {
        unit.pos = { q: Number(moveMatch[2]), r: Number(moveMatch[3]) }
      }
      continue
    }

    const pushedMatch = entry.match(/^Unit (.+) is pushed to (-?\d+),(-?\d+)\.$/)
    if (pushedMatch) {
      const unit = animationRenderUnits[pushedMatch[1]]
      if (unit) {
        unit.pos = { q: Number(pushedMatch[2]), r: Number(pushedMatch[3]) }
      }
      continue
    }

    const pulledMatch = entry.match(/^Unit (.+) is pulled to (-?\d+),(-?\d+)\.$/)
    if (pulledMatch) {
      const unit = animationRenderUnits[pulledMatch[1]]
      if (unit) {
        unit.pos = { q: Number(pulledMatch[2]), r: Number(pulledMatch[3]) }
      }
      continue
    }

    const teleportMatch = entry.match(/^Unit (.+) teleports to (-?\d+),(-?\d+)\.$/)
    if (teleportMatch) {
      const unit = animationRenderUnits[teleportMatch[1]]
      if (unit) {
        unit.pos = { q: Number(teleportMatch[2]), r: Number(teleportMatch[3]) }
      }
      continue
    }

    const faceMatch = entry.match(/^Unit (.+) faces (\d+)\.$/)
    if (faceMatch) {
      const unit = animationRenderUnits[faceMatch[1]]
      if (unit) {
        unit.facing = Number(faceMatch[2]) as Direction
      }
      continue
    }

    const damageMatch = entry.match(/^Unit (.+) takes (\d+) damage\.$/)
    if (damageMatch) {
      const unit = animationRenderUnits[damageMatch[1]]
      if (unit) {
        unit.strength = Math.max(0, unit.strength - Number(damageMatch[2]))
      }
      continue
    }

    const gainMatch = entry.match(/^Unit (.+) gains (\d+) strength\.$/)
    if (gainMatch) {
      const unit = animationRenderUnits[gainMatch[1]]
      if (unit) {
        unit.strength += Number(gainMatch[2])
      }
      continue
    }

    const regenMatch = entry.match(/^Regeneration heals unit (.+) for (\d+)\.$/)
    if (regenMatch) {
      const unit = animationRenderUnits[regenMatch[1]]
      if (unit) {
        unit.strength += Number(regenMatch[2])
      }
      continue
    }

    const splitMatch = entry.match(/^(?:Slime split|Split): (.+) lobs from -?\d+,-?\d+ to -?\d+,-?\d+\.$/)
    if (splitMatch) {
      const unit = animationRenderUnits[splitMatch[1]]
      const finalUnit = state.units[splitMatch[1]]
      if (unit && finalUnit) {
        unit.strength = finalUnit.strength
      }
      continue
    }

    const modifierMatch = entry.match(
      /^Unit (.+) is affected: ([a-zA-Z]+) (?:for (\d+) turn\(s\)|indefinitely)(?: \(stacks: (\d+)\))?\.$/
    )
    if (modifierMatch) {
      const unit = animationRenderUnits[modifierMatch[1]]
      if (!unit) continue
      const modifierType = modifierMatch[2] as Unit['modifiers'][number]['type']
      const duration = parseModifierDuration(modifierMatch[3])
      const stacks = modifierMatch[4] ? Math.max(1, Number(modifierMatch[4])) : null
      if (stacks !== null && Number.isFinite(stacks)) {
        unit.modifiers = unit.modifiers.filter((modifier) => modifier.type !== modifierType)
        for (let i = 0; i < stacks; i += 1) {
          unit.modifiers.push({ type: modifierType, turnsRemaining: duration })
        }
      } else {
        const existing = unit.modifiers.find((modifier) => modifier.type === modifierType)
        if (existing) {
          existing.turnsRemaining = duration
        } else {
          unit.modifiers.push({ type: modifierType, turnsRemaining: duration })
        }
      }
      continue
    }

    const clearAllModifiersMatch = entry.match(/^Unit (.+) has all modifiers removed\.$/)
    if (clearAllModifiersMatch) {
      const unit = animationRenderUnits[clearAllModifiersMatch[1]]
      if (unit) {
        unit.modifiers = []
      }
      continue
    }

    const clearDebuffsMatch = entry.match(/^Unit (.+) has debuffs removed\.$/)
    if (clearDebuffsMatch) {
      const unit = animationRenderUnits[clearDebuffsMatch[1]]
      if (unit) {
        unit.modifiers = unit.modifiers.filter(
          (modifier) =>
            modifier.type !== 'cannotMove' &&
            modifier.type !== 'stunned' &&
            modifier.type !== 'slow' &&
            modifier.type !== 'chilled' &&
            modifier.type !== 'frozen' &&
            modifier.type !== 'reinforcementPenalty' &&
            modifier.type !== 'burn' &&
            modifier.type !== 'disarmed' &&
            modifier.type !== 'vulnerable'
        )
      }
      continue
    }

    const destroyedMatch = entry.match(/^Unit (.+) is destroyed\.$/)
    if (destroyedMatch) {
      delete animationRenderUnits[destroyedMatch[1]]
      continue
    }

    const executedMatch = entry.match(/^Unit (.+) is executed\.$/)
    if (executedMatch) {
      delete animationRenderUnits[executedMatch[1]]
      continue
    }
  }
  animationAppliedLogIndex = capped
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
  const mapped = spawnedByOrder[plannedId]
  if (mapped) return mapped
  const separator = plannedId.indexOf(':')
  if (separator === -1) return null
  const baseOrderId = plannedId.slice(0, separator)
  return spawnedByOrder[baseOrderId] ?? null
}

function getOrderTileParam(params: OrderParams, key: 'tile' | 'tile2' | 'tile3'): Hex | undefined {
  if (key === 'tile2') return params.tile2
  if (key === 'tile3') return params.tile3
  return params.tile
}

function findSnapshotUnitAt(before: Record<string, UnitSnapshot>, hex: Hex): UnitSnapshot | null {
  const entry = Object.values(before).find((unit) => unit.pos.q === hex.q && unit.pos.r === hex.r)
  return entry ?? null
}

function findFirstUnitInLine(
  before: Record<string, UnitSnapshot>,
  origin: Hex,
  dir: Direction,
  maxRange?: number
): UnitSnapshot | null {
  let cursor = { ...origin }
  let steps = 0
  for (;;) {
    cursor = neighbor(cursor, dir)
    steps += 1
    if (typeof maxRange === 'number' && steps > maxRange) break
    if (!isTile(cursor)) break
    const target = findSnapshotUnitAt(before, cursor)
    if (target) return target
  }
  return null
}

function findLineEndHex(origin: Hex, dir: Direction, maxRange?: number): Hex | null {
  let cursor = { ...origin }
  let lastValid: Hex | null = null
  let steps = 0
  for (;;) {
    cursor = neighbor(cursor, dir)
    steps += 1
    if (typeof maxRange === 'number' && steps > maxRange) break
    if (!isTile(cursor)) break
    lastValid = { ...cursor }
  }
  return lastValid
}

function findLineExitHex(origin: Hex, dir: Direction): Hex {
  let cursor = { ...origin }
  for (;;) {
    const next = neighbor(cursor, dir)
    if (!isTile(next)) return next
    cursor = next
  }
}

function getDirectionToNeighbor(from: Hex, to: Hex): Direction | null {
  for (let direction = 0 as Direction; direction < 6; direction += 1) {
    const candidate = neighbor(from, direction)
    if (candidate.q === to.q && candidate.r === to.r) return direction
  }
  return null
}

function parseChainLightningEvents(logEntries: string[]): {
  paths: Array<{ originUnitId?: string; path: string[] }>
  fizzles: Array<{ originUnitId?: string }>
} {
  const paths: Array<{ originUnitId?: string; path: string[] }> = []
  const fizzles: Array<{ originUnitId?: string }> = []
  logEntries.forEach((entry) => {
    const pathWithOriginMatch = entry.match(/^Chain lightning from unit (.+) path: (.+)\.$/)
    if (pathWithOriginMatch) {
      paths.push({
        originUnitId: pathWithOriginMatch[1],
        path: pathWithOriginMatch[2]
          .split(' -> ')
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
      })
      return
    }
    const pathMatch = entry.match(/^Chain lightning path: (.+)\.$/)
    if (pathMatch) {
      paths.push({
        path: pathMatch[1]
          .split(' -> ')
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
      })
      return
    }
    const fizzleWithOriginMatch = entry.match(/^Chain lightning from unit (.+) finds no adjacent targets\.$/)
    if (fizzleWithOriginMatch) {
      fizzles.push({ originUnitId: fizzleWithOriginMatch[1] })
      return
    }
    if (entry === 'Chain lightning finds no adjacent targets.') {
      fizzles.push({})
    }
  })
  return { paths, fizzles }
}

function parseUnitPositionUpdates(logEntries: string[]): Map<string, Hex> {
  const updates = new Map<string, Hex>()
  logEntries.forEach((entry) => {
    const moveMatch = entry.match(/^Unit (.+) moves to (-?\d+),(-?\d+)\.$/)
    if (moveMatch) {
      updates.set(moveMatch[1], { q: Number(moveMatch[2]), r: Number(moveMatch[3]) })
      return
    }
    const teleportMatch = entry.match(/^Unit (.+) teleports to (-?\d+),(-?\d+)\.$/)
    if (teleportMatch) {
      updates.set(teleportMatch[1], { q: Number(teleportMatch[2]), r: Number(teleportMatch[3]) })
      return
    }
    const pushMatch = entry.match(/^Unit (.+) is pushed to (-?\d+),(-?\d+)\.$/)
    if (pushMatch) {
      updates.set(pushMatch[1], { q: Number(pushMatch[2]), r: Number(pushMatch[3]) })
    }
  })
  return updates
}

function parseUnitMoveEvents(logEntries: string[]): Map<string, { index: number; pos: Hex }[]> {
  const events = new Map<string, { index: number; pos: Hex }[]>()
  logEntries.forEach((entry, index) => {
    const match = entry.match(/^Unit (.+) moves to (-?\d+),(-?\d+)\.$/)
    if (!match) return
    const unitId = match[1]
    const tile = { index, pos: { q: Number(match[2]), r: Number(match[3]) } }
    const queue = events.get(unitId) ?? []
    queue.push(tile)
    events.set(unitId, queue)
  })
  return events
}

function parseUnitMoveAttempts(logEntries: string[]): Map<string, { index: number; moved: boolean; pos?: Hex }[]> {
  const attempts = new Map<string, { index: number; moved: boolean; pos?: Hex }[]>()
  logEntries.forEach((entry, index) => {
    const moveMatch = entry.match(/^Unit (.+) moves to (-?\d+),(-?\d+)\.$/)
    if (moveMatch) {
      const unitId = moveMatch[1]
      const queue = attempts.get(unitId) ?? []
      queue.push({
        index,
        moved: true,
        pos: { q: Number(moveMatch[2]), r: Number(moveMatch[3]) },
      })
      attempts.set(unitId, queue)
      return
    }

    const blockedMatch = entry.match(/^Unit (.+) cannot move(?: this turn)?\.$/)
    if (!blockedMatch) return
    const unitId = blockedMatch[1]
    const queue = attempts.get(unitId) ?? []
    queue.push({
      index,
      moved: false,
    })
    attempts.set(unitId, queue)
  })
  return attempts
}

function parseDestroyedUnits(logEntries: string[]): { index: number; unitId: string }[] {
  const destroyed: { index: number; unitId: string }[] = []
  logEntries.forEach((entry, index) => {
    const destroyedMatch = entry.match(/^Unit (.+) is destroyed\.$/)
    if (destroyedMatch) {
      destroyed.push({ index, unitId: destroyedMatch[1] })
      return
    }
    const executedMatch = entry.match(/^Unit (.+) is executed\.$/)
    if (executedMatch) {
      destroyed.push({ index, unitId: executedMatch[1] })
    }
  })
  return destroyed
}

function parseSpawnEvents(logEntries: string[]): Array<{ index: number; unitId: string; pos: Hex }> {
  const events: Array<{ index: number; unitId: string; pos: Hex }> = []
  logEntries.forEach((entry, index) => {
    const match = entry.match(/^Unit (.+) spawned at (-?\d+),(-?\d+)\.$/)
    if (!match) return
    events.push({
      index,
      unitId: match[1],
      pos: { q: Number(match[2]), r: Number(match[3]) },
    })
  })
  return events
}

function parseSlimeSplitEvents(
  logEntries: string[]
): Array<{ index: number; sourceUnitId: string; from: Hex; to: Hex; spawnedUnitId?: string }> {
  const splitEvents: Array<{ index: number; sourceUnitId: string; from: Hex; to: Hex; spawnedUnitId?: string }> = []
  const spawnEvents = parseSpawnEvents(logEntries)
  const usedSpawnIndices = new Set<number>()

  logEntries.forEach((entry, index) => {
    const match = entry.match(/^(?:Slime split|Split): (.+) lobs from (-?\d+),(-?\d+) to (-?\d+),(-?\d+)\.$/)
    if (!match) return
    const sourceUnitId = match[1]
    const from = { q: Number(match[2]), r: Number(match[3]) }
    const to = { q: Number(match[4]), r: Number(match[5]) }

    let spawnedUnitId: string | undefined
    for (let i = spawnEvents.length - 1; i >= 0; i -= 1) {
      const spawn = spawnEvents[i]
      if (usedSpawnIndices.has(spawn.index)) continue
      if (spawn.index > index) continue
      if (spawn.pos.q !== to.q || spawn.pos.r !== to.r) continue
      spawnedUnitId = spawn.unitId
      usedSpawnIndices.add(spawn.index)
      break
    }

    splitEvents.push({ index, sourceUnitId, from, to, spawnedUnitId })
  })

  return splitEvents
}

function parseTrapTriggers(logEntries: string[]): Array<{ index: number; unitId: string; trapKind: 'pitfall' | 'explosive'; tile?: Hex }> {
  const triggers: Array<{ index: number; unitId: string; trapKind: 'pitfall' | 'explosive'; tile?: Hex }> = []
  logEntries.forEach((entry, index) => {
    const match = entry.match(/^Unit (.+) triggers a (bear|pitfall|explosive) trap(?: at (-?\d+),(-?\d+))?\.$/)
    if (!match) return
    const trapKind = (match[2] === 'bear' ? 'pitfall' : match[2]) as 'pitfall' | 'explosive'
    const tile =
      match[3] !== undefined && match[4] !== undefined
        ? { q: Number(match[3]), r: Number(match[4]) }
        : undefined
    triggers.push({ index, unitId: match[1], trapKind, tile })
  })
  return triggers
}

function parseBurnDamageTargets(logEntries: string[]): string[] {
  const targets: string[] = []
  logEntries.forEach((entry) => {
    const match = entry.match(/^Burn deals \d+ damage to unit (.+)\.$/)
    if (!match) return
    targets.push(match[1])
  })
  return targets
}

function parseLightningBarrierEvents(logEntries: string[]): {
  arcs: Array<{ sourceUnitId: string; targetUnitId: string }>
  fizzles: string[]
} {
  const arcs: Array<{ sourceUnitId: string; targetUnitId: string }> = []
  const fizzles: string[] = []
  logEntries.forEach((entry) => {
    const arcMatch = entry.match(/^Lightning barrier arcs from unit (.+) to unit (.+)\.$/)
    if (arcMatch) {
      arcs.push({ sourceUnitId: arcMatch[1], targetUnitId: arcMatch[2] })
      return
    }
    const fizzleMatch = entry.match(/^Lightning barrier on unit (.+) crackles but finds no adjacent targets\.$/)
    if (fizzleMatch) {
      fizzles.push(fizzleMatch[1])
    }
  })
  return { arcs, fizzles }
}

function findTurnEndEffectLogStart(logEntries: string[]): number {
  return logEntries.findIndex(
    (entry) =>
      /^Burn deals \d+ damage to unit .+\.$/.test(entry) ||
      /^Regeneration heals unit .+ for \d+\.$/.test(entry) ||
      /^Lightning barrier arcs from unit .+ to unit .+\.$/.test(entry) ||
      /^Lightning barrier on unit .+ crackles but finds no adjacent targets\.$/.test(entry)
  )
}

function buildTurnEndReplayAnimations(
  before: Record<string, UnitSnapshot>,
  turnEndLogs: string[],
  logOffset = 0
): BoardAnimation[] {
  if (turnEndLogs.length === 0) return []

  const turnEndPositions = parseUnitPositionUpdates(turnEndLogs)
  const lightningBarrierEvents = parseLightningBarrierEvents(turnEndLogs)
  const groupedBarrierArcs = new Map<string, Array<{ from: Hex; to: Hex }>>()
  lightningBarrierEvents.arcs.forEach((event) => {
    const from =
      turnEndPositions.get(event.sourceUnitId) ?? state.units[event.sourceUnitId]?.pos ?? before[event.sourceUnitId]?.pos
    const to =
      turnEndPositions.get(event.targetUnitId) ??
      state.units[event.targetUnitId]?.pos ??
      before[event.targetUnitId]?.pos
    if (!from || !to) return
    const arcs = groupedBarrierArcs.get(event.sourceUnitId) ?? []
    arcs.push({ from: { ...from }, to: { ...to } })
    groupedBarrierArcs.set(event.sourceUnitId, arcs)
  })

  const animations: BoardAnimation[] = [...groupedBarrierArcs.values()].map(
    (arcs) =>
      ({
        type: 'lightningBarrier',
        arcs,
        duration: LIGHTNING_BARRIER_DURATION_MS,
      }) as BoardAnimation
  )

  const lightningBarrierFizzles = lightningBarrierEvents.fizzles
    .map((unitId) => turnEndPositions.get(unitId) ?? state.units[unitId]?.pos ?? before[unitId]?.pos)
    .filter((center): center is Hex => center !== undefined)
  if (lightningBarrierFizzles.length > 0) {
    animations.push({
      type: 'lightningFizzle',
      centers: lightningBarrierFizzles.map((center) => ({ ...center })),
      duration: LIGHTNING_FIZZLE_DURATION_MS,
    })
  }

  animations.push(
    ...parseBurnDamageTargets(turnEndLogs)
      .map((unitId) => {
        const targetPos = turnEndPositions.get(unitId) ?? state.units[unitId]?.pos ?? before[unitId]?.pos
        if (!targetPos) return null
        return {
          type: 'burn',
          target: { ...targetPos },
          duration: BURN_DURATION_MS,
        } as BoardAnimation
      })
      .filter((animation): animation is BoardAnimation => animation !== null)
  )

  const damageFlashUnitIds = [...new Set(parseDamageEvents(turnEndLogs).filter((event) => event.amount > 0).map((event) => event.unitId))]
  if (damageFlashUnitIds.length > 0) {
    animations.push({
      type: 'damageFlash',
      unitIds: damageFlashUnitIds,
      duration: DAMAGE_FLASH_DURATION_MS,
    })
  }

  const strengthChangeEntries = collectStrengthChangeAnimationEntries(before, state.units, turnEndLogs, turnEndPositions)
  if (strengthChangeEntries.length > 0) {
    animations.push({
      type: 'strengthChange',
      entries: strengthChangeEntries,
      duration: STRENGTH_CHANGE_DURATION_MS,
    })
  }

  animations.push({
    type: 'stateSync',
    upToLogIndex: logOffset + turnEndLogs.length - 1,
    duration: 0,
  })
  return animations
}

function snapshotCanActAsUnit(snapshot: Pick<UnitSnapshot, 'kind'>): boolean {
  return snapshot.kind === 'unit' || snapshot.kind === 'leader'
}

function snapshotHasModifier(
  snapshot: Pick<UnitSnapshot, 'modifiers'>,
  type: Unit['modifiers'][number]['type']
): boolean {
  return snapshot.modifiers.some(
    (modifier) => modifier.type === type && (modifier.turnsRemaining === 'indefinite' || modifier.turnsRemaining > 0)
  )
}

function snapshotIsActionBlocked(snapshot: Pick<UnitSnapshot, 'modifiers'>): boolean {
  return snapshotHasModifier(snapshot, 'stunned') || snapshotHasModifier(snapshot, 'frozen')
}

function snapshotIsMovementBlocked(snapshot: Pick<UnitSnapshot, 'modifiers'>): boolean {
  return snapshotHasModifier(snapshot, 'cannotMove') || snapshotIsActionBlocked(snapshot)
}

function getCommanderAnimationParticipants(
  before: Record<string, UnitSnapshot>,
  player: PlayerId,
  tile: Hex,
  excludeUnitId?: string
): UnitSnapshot[] {
  return Object.values(before)
    .filter(
      (unit) =>
        unit.owner === player &&
        unit.id !== excludeUnitId &&
        snapshotCanActAsUnit(unit) &&
        !snapshotIsActionBlocked(unit) &&
        hexDistance(unit.pos, tile) === 1
    )
    .sort((a, b) => a.id.localeCompare(b.id))
}

function parseDamageEvents(logEntries: string[]): { index: number; unitId: string; amount: number }[] {
  const events: { index: number; unitId: string; amount: number }[] = []
  logEntries.forEach((entry, index) => {
    const match = entry.match(/^Unit (.+) takes (\d+) damage\.$/)
    if (!match) return
    events.push({
      index,
      unitId: match[1],
      amount: Number(match[2]),
    })
  })
  return events
}

function parseStrengthChangeEvents(logEntries: string[]): Array<{ index: number; unitId: string; amount: number }> {
  const events: Array<{ index: number; unitId: string; amount: number }> = []
  logEntries.forEach((entry, index) => {
    const damageMatch = entry.match(/^Unit (.+) takes (\d+) damage\.$/)
    if (damageMatch) {
      const amount = Number(damageMatch[2])
      if (amount > 0) {
        events.push({
          index,
          unitId: damageMatch[1],
          amount: -amount,
        })
      }
      return
    }

    const gainMatch = entry.match(/^Unit (.+) gains (\d+) strength\.$/)
    if (gainMatch) {
      const amount = Number(gainMatch[2])
      if (amount > 0) {
        events.push({
          index,
          unitId: gainMatch[1],
          amount,
        })
      }
      return
    }

    const regenMatch = entry.match(/^Regeneration heals unit (.+) for (\d+)\.$/)
    if (regenMatch) {
      const amount = Number(regenMatch[2])
      if (amount > 0) {
        events.push({
          index,
          unitId: regenMatch[1],
          amount,
        })
      }
    }
  })
  return events
}

function collectStrengthChangeAnimationEntries(
  before: Record<string, UnitSnapshot>,
  afterUnits: Record<string, Unit>,
  logEntries: string[],
  loggedPositions: Map<string, Hex>,
  animatedPositions?: Map<string, Hex>
): StrengthChangeAnimation['entries'] {
  const explicitEvents = parseStrengthChangeEvents(logEntries)
  const unitsWithExplicitEvents = new Set(explicitEvents.map((event) => event.unitId))
  const silentDeltaEvents: Array<{ index: number; unitId: string; amount: number }> = []
  const splitIndexByUnit = new Map<string, number>()

  parseSlimeSplitEvents(logEntries).forEach((event) => {
    splitIndexByUnit.set(event.sourceUnitId, Math.max(splitIndexByUnit.get(event.sourceUnitId) ?? -1, event.index))
  })

  Object.values(before).forEach((snapshot) => {
    if (unitsWithExplicitEvents.has(snapshot.id)) return
    const afterStrength = afterUnits[snapshot.id]?.strength
    if (afterStrength === undefined || afterStrength === snapshot.strength) return
    silentDeltaEvents.push({
      index: splitIndexByUnit.get(snapshot.id) ?? logEntries.length,
      unitId: snapshot.id,
      amount: afterStrength - snapshot.strength,
    })
  })

  const stackCounts = new Map<string, number>()
  return [...explicitEvents, ...silentDeltaEvents]
    .filter((event) => event.amount !== 0)
    .sort((a, b) => a.index - b.index || a.unitId.localeCompare(b.unitId))
    .map((event) => {
      const anchor =
        animatedPositions?.get(event.unitId) ??
        loggedPositions.get(event.unitId) ??
        afterUnits[event.unitId]?.pos ??
        before[event.unitId]?.pos
      if (!anchor) return null
      const stackIndex = stackCounts.get(event.unitId) ?? 0
      stackCounts.set(event.unitId, stackIndex + 1)
      return {
        unitId: event.unitId,
        anchor: { ...anchor },
        amount: event.amount,
        stackIndex,
      }
    })
    .filter((entry): entry is StrengthChangeAnimation['entries'][number] => entry !== null)
}

function parseShoveCollisions(logEntries: string[]): { index: number; targetUnitId: string }[] {
  const collisions: { index: number; targetUnitId: string }[] = []
  logEntries.forEach((entry, index) => {
    const match = entry.match(/^Unit (.+) collides with .+\.$/)
    if (!match) return
    collisions.push({
      index,
      targetUnitId: match[1],
    })
  })
  return collisions
}

function resolveDirectionFromParams(
  source: Extract<CardEffect, { type: 'shove' }>['direction'],
  facing: Direction,
  params: OrderParams
): Direction | null {
  if (source === 'facing') return facing
  if (source.type === 'param') {
    const value =
      source.key === 'moveDirection'
        ? params.moveDirection
        : source.key === 'faceDirection'
          ? params.faceDirection
          : params.direction
    return value ?? null
  }
  if (source.type === 'relative') {
    if (source.offsets.length === 0) return null
    return rotateDirection(facing, source.offsets[0])
  }
  return null
}

function buildAnimations(
  order: GameState['actionQueue'][number],
  before: Record<string, UnitSnapshot>,
  logEntries: string[] = []
): BoardAnimation[] {
  if (logEntries.some((entry) => /^Unit .+ is stunned and cannot act this turn\.$/.test(entry))) {
    return []
  }
  const def = CARD_DEFS[order.defId]
  const animations: BoardAnimation[] = []
  const loggedPositions = parseUnitPositionUpdates(logEntries)
  const loggedMoveEvents = parseUnitMoveEvents(logEntries)
  const loggedMoveAttempts = parseUnitMoveAttempts(logEntries)
  const damageEvents = parseDamageEvents(logEntries)
  const destroyedEvents = parseDestroyedUnits(logEntries)
  const destroyedUnitIds = new Set(destroyedEvents.map((event) => event.unitId))
  const trapTriggers = parseTrapTriggers(logEntries)
  const trapTriggerCountByUnit = new Map<string, number>()
  trapTriggers.forEach((trigger) => {
    trapTriggerCountByUnit.set(trigger.unitId, (trapTriggerCountByUnit.get(trigger.unitId) ?? 0) + 1)
  })
  const queuedTrapTriggerCountByUnit = new Map<string, number>()
  const deferredDestroyedByUnit = new Map<string, { index: number; unitId: string }[]>()
  const shoveCollisions = parseShoveCollisions(logEntries)
  const slimeSplitEvents = parseSlimeSplitEvents(logEntries)
  const damageFlashUnitIds = [...new Set(damageEvents.filter((event) => event.amount > 0).map((event) => event.unitId))]
  const animatedPositions = new Map<string, Hex>()
  const spawnedFallbackSnapshots = new Map<string, UnitSnapshot>()
  const destroyedAnimated = new Set<string>()
  let destroyedCursor = 0
  let lastConsumedLogIndex = -1
  let lastQueuedSyncLogIndex = -1

  const queueStateSync = (upToLogIndex: number): void => {
    if (logEntries.length === 0) return
    const capped = Math.min(upToLogIndex, logEntries.length - 1)
    if (capped < 0) return
    if (capped <= lastQueuedSyncLogIndex) return
    animations.push({
      type: 'stateSync',
      upToLogIndex: capped,
      duration: 0,
    })
    lastQueuedSyncLogIndex = capped
  }

  const consumeLoggedMove = (unitId: string): { index: number; pos: Hex } | null => {
    const queue = loggedMoveEvents.get(unitId)
    if (!queue || queue.length === 0) return null
    const [next] = queue.splice(0, 1)
    return next
  }

  const consumeLoggedMoveAttempt = (unitId: string): { index: number; moved: boolean; pos?: Hex } | null => {
    const queue = loggedMoveAttempts.get(unitId)
    if (!queue || queue.length === 0) return null
    const [next] = queue.splice(0, 1)
    return next
  }

  const consumeShoveCollision = (targetUnitId: string): { index: number; targetUnitId: string } | null => {
    const index = shoveCollisions.findIndex((entry) => entry.targetUnitId === targetUnitId)
    if (index === -1) return null
    const [next] = shoveCollisions.splice(index, 1)
    return next
  }

  const enqueueDestroyedEvent = (event: { index: number; unitId: string }): void => {
    if (destroyedAnimated.has(event.unitId)) return
    if (state.units[event.unitId]) return
    const snapshot = before[event.unitId] ?? spawnedFallbackSnapshots.get(event.unitId)
    if (!snapshot) return
    const deathPos = animatedPositions.get(event.unitId) ?? loggedPositions.get(event.unitId) ?? snapshot.pos
    pendingDeathUnits.set(event.unitId, {
      id: event.unitId,
      owner: snapshot.owner,
      kind: snapshot.kind,
      strength: snapshot.strength,
      pos: { ...deathPos },
      facing: snapshot.facing,
      modifiers: snapshot.modifiers.map((modifier) => ({ ...modifier })),
      roguelikeRole: snapshot.roguelikeRole,
      isMinion: snapshot.isMinion,
    })
    deathAlphaOverrides.set(event.unitId, 1)
    queueStateSync(event.index)
    animations.push({
      type: 'death',
      unit: pendingDeathUnits.get(event.unitId)!,
      duration: DEATH_DURATION_MS,
    })
    destroyedAnimated.add(event.unitId)
  }

  const flushDeferredDestroyedForUnit = (unitId: string): void => {
    const trapCount = trapTriggerCountByUnit.get(unitId) ?? 0
    if (trapCount === 0) return
    const queuedCount = queuedTrapTriggerCountByUnit.get(unitId) ?? 0
    if (queuedCount < trapCount) return
    const deferred = deferredDestroyedByUnit.get(unitId)
    if (!deferred || deferred.length === 0) return
    deferred.sort((a, b) => a.index - b.index).forEach((event) => enqueueDestroyedEvent(event))
    deferredDestroyedByUnit.delete(unitId)
  }

  const enqueueDestroyedUpTo = (maxLogIndex: number): void => {
    while (destroyedCursor < destroyedEvents.length && destroyedEvents[destroyedCursor].index <= maxLogIndex) {
      const event = destroyedEvents[destroyedCursor]
      destroyedCursor += 1
      if (destroyedAnimated.has(event.unitId)) continue
      const trapCount = trapTriggerCountByUnit.get(event.unitId) ?? 0
      const queuedCount = queuedTrapTriggerCountByUnit.get(event.unitId) ?? 0
      if (trapCount > queuedCount) {
        const deferred = deferredDestroyedByUnit.get(event.unitId) ?? []
        deferred.push(event)
        deferredDestroyedByUnit.set(event.unitId, deferred)
        continue
      }
      enqueueDestroyedEvent(event)
    }
  }

  let handledDoubleStepsMoveAnimation = false

  for (const effect of def.effects) {
    if (effect.type === 'spawn' || effect.type === 'spawnAdjacentFriendly' || effect.type === 'spawnSkeletonAdjacent') {
      const tile = getOrderTileParam(order.params, effect.tileParam)
      if (!tile) continue
      const scopedKey = `${order.id}:${effect.tileParam}`
      let spawnedId: string | undefined = state.spawnedByOrder[scopedKey] ?? state.spawnedByOrder[order.id]
      if (!spawnedId) {
        spawnedId =
          Object.values(state.units).find((unit) => !before[unit.id] && unit.pos.q === tile.q && unit.pos.r === tile.r)?.id ??
          parseSpawnEvents(logEntries).find((event) => event.pos.q === tile.q && event.pos.r === tile.r)?.unitId
      }
      if (typeof spawnedId === 'string') {
        if (!before[spawnedId] && !spawnedFallbackSnapshots.has(spawnedId)) {
          const spawnFacing =
            effect.type === 'spawn'
              ? effect.facingParam
                ? order.params.direction
                : effect.facing
              : effect.type === 'spawnAdjacentFriendly'
                ? effect.facingParam
                  ? order.params.direction
                  : undefined
                : before[order.params.unitId ?? '']?.facing ?? state.units[order.params.unitId ?? '']?.facing
          const spawnSnapshot: UnitSnapshot = {
            id: spawnedId,
            owner: state.units[spawnedId]?.owner ?? order.player,
            kind: effect.type === 'spawn' ? (effect.kind ?? 'unit') : 'unit',
            strength: effect.strength,
            pos: { ...tile },
            facing: (spawnFacing ?? 0) as Direction,
            modifiers: [],
            roguelikeRole: state.units[spawnedId]?.roguelikeRole,
            isMinion: state.units[spawnedId]?.isMinion,
          }
          spawnedFallbackSnapshots.set(spawnedId, spawnSnapshot)
          if (!state.units[spawnedId] && destroyedUnitIds.has(spawnedId)) {
            pendingDeathUnits.set(spawnedId, {
              id: spawnSnapshot.id,
              owner: spawnSnapshot.owner,
              kind: spawnSnapshot.kind,
              strength: spawnSnapshot.strength,
              pos: { ...spawnSnapshot.pos },
              facing: spawnSnapshot.facing,
              modifiers: [],
              roguelikeRole: spawnSnapshot.roguelikeRole,
              isMinion: spawnSnapshot.isMinion,
            })
            deathAlphaOverrides.set(spawnedId, 1)
          }
        }
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
      if (order.defId === 'move_tandem') {
        continue
      }
      const beforeUnit = before[resolvedId]
      const from = animatedPositions.get(resolvedId) ?? beforeUnit?.pos
      const consumedMoveAttempt = consumeLoggedMoveAttempt(resolvedId)
      if (consumedMoveAttempt) {
        enqueueDestroyedUpTo(consumedMoveAttempt.index - 1)
        lastConsumedLogIndex = Math.max(lastConsumedLogIndex, consumedMoveAttempt.index)
      }
      if (consumedMoveAttempt && !consumedMoveAttempt.moved) {
        continue
      }
      const consumedMove = consumedMoveAttempt?.moved ? consumeLoggedMove(resolvedId) : null
      if (!consumedMoveAttempt && consumedMove) {
        enqueueDestroyedUpTo(consumedMove.index - 1)
        lastConsumedLogIndex = Math.max(lastConsumedLogIndex, consumedMove.index)
      }
      const destination = consumedMove?.pos ?? consumedMoveAttempt?.pos
      if (!from || !destination) continue
      if (from.q === destination.q && from.r === destination.r) continue
      animations.push({
        type: 'move',
        unitId: resolvedId,
        from: { ...from },
        to: { ...destination },
        duration: MOVE_DURATION_MS,
      })
      animatedPositions.set(resolvedId, { ...destination })
      if (consumedMove) {
        queueStateSync(consumedMove.index)
      } else if (consumedMoveAttempt?.moved) {
        queueStateSync(consumedMoveAttempt.index)
      }
    }

    if (effect.type === 'moveToTile') {
      if (order.defId === 'move_double_steps') {
        if (handledDoubleStepsMoveAnimation) continue
        handledDoubleStepsMoveAnimation = true

        const formationMoves: Array<{ unitId: string; from: Hex; to: Hex; index: number }> = []
        ;(['unitId', 'unitId2'] as const).forEach((unitParam) => {
          const resolvedId = resolveUnitIdFromParams(order.params, state.spawnedByOrder, unitParam)
          if (!resolvedId) return
          const beforeUnit = before[resolvedId]
          if (!beforeUnit) return

          const from = animatedPositions.get(resolvedId) ?? beforeUnit.pos
          const consumedMoveAttempt = consumeLoggedMoveAttempt(resolvedId)
          if (consumedMoveAttempt && !consumedMoveAttempt.moved) return
          const consumedMove = consumedMoveAttempt?.moved ? consumeLoggedMove(resolvedId) : consumeLoggedMove(resolvedId)
          const destination = consumedMove?.pos ?? consumedMoveAttempt?.pos
          const index = consumedMove?.index ?? consumedMoveAttempt?.index
          if (!destination || index === undefined) return
          if (from.q === destination.q && from.r === destination.r) return
          formationMoves.push({
            unitId: resolvedId,
            from: { ...from },
            to: { ...destination },
            index,
          })
        })

        formationMoves.sort((a, b) => a.index - b.index)
        if (formationMoves.length > 0) {
          enqueueDestroyedUpTo(formationMoves[0].index - 1)
          lastConsumedLogIndex = Math.max(lastConsumedLogIndex, formationMoves[formationMoves.length - 1].index)
          animations.push({
            type: 'teamMove',
            moves: formationMoves.map((move) => ({ unitId: move.unitId, from: move.from, to: move.to })),
            duration: MOVE_DURATION_MS,
          })
          formationMoves.forEach((move) => {
            animatedPositions.set(move.unitId, { ...move.to })
          })
          queueStateSync(formationMoves[formationMoves.length - 1].index)
        }
      }
      continue
    }

    if (effect.type === 'moveAdjacentFriendlyGroup' && order.defId === 'move_tandem') {
      const formationMoves: Array<{ unitId: string; from: Hex; to: Hex; index: number }> = []
      loggedMoveEvents.forEach((entries, unitId) => {
        if (entries.length === 0) return
        const beforeUnit = before[unitId]
        if (!beforeUnit) return
        const from = animatedPositions.get(unitId) ?? beforeUnit.pos
        const [firstMove] = entries.splice(0, 1)
        if (!firstMove) return
        if (from.q === firstMove.pos.q && from.r === firstMove.pos.r) return
        formationMoves.push({
          unitId,
          from: { ...from },
          to: { ...firstMove.pos },
          index: firstMove.index,
        })
      })
      formationMoves.sort((a, b) => a.index - b.index)
      if (formationMoves.length > 0) {
        enqueueDestroyedUpTo(formationMoves[0].index - 1)
        lastConsumedLogIndex = Math.max(lastConsumedLogIndex, formationMoves[formationMoves.length - 1].index)
        animations.push({
          type: 'teamMove',
          moves: formationMoves.map((move) => ({ unitId: move.unitId, from: move.from, to: move.to })),
          duration: MOVE_DURATION_MS,
        })
        formationMoves.forEach((move) => {
          animatedPositions.set(move.unitId, { ...move.to })
        })
        queueStateSync(formationMoves[formationMoves.length - 1].index)
      }
      continue
    }

    if (effect.type === 'convergeTowardTile' || effect.type === 'markAdvanceToward') {
      const formationMoves: Array<{ unitId: string; from: Hex; to: Hex; index: number }> = []
      loggedMoveEvents.forEach((entries, unitId) => {
        if (entries.length === 0) return
        const beforeUnit = before[unitId]
        if (!beforeUnit) return
        const from = animatedPositions.get(unitId) ?? beforeUnit.pos
        const [firstMove] = entries.splice(0, 1)
        if (!firstMove) return
        if (from.q === firstMove.pos.q && from.r === firstMove.pos.r) return
        formationMoves.push({
          unitId,
          from: { ...from },
          to: { ...firstMove.pos },
          index: firstMove.index,
        })
      })
      formationMoves.sort((a, b) => a.index - b.index)
      if (formationMoves.length > 0) {
        enqueueDestroyedUpTo(formationMoves[0].index - 1)
        lastConsumedLogIndex = Math.max(lastConsumedLogIndex, formationMoves[formationMoves.length - 1].index)
        animations.push({
          type: 'teamMove',
          moves: formationMoves.map((move) => ({ unitId: move.unitId, from: move.from, to: move.to })),
          duration: MOVE_DURATION_MS,
        })
        formationMoves.forEach((move) => {
          animatedPositions.set(move.unitId, { ...move.to })
        })
        queueStateSync(formationMoves[formationMoves.length - 1].index)
      }
      continue
    }

    if (effect.type === 'packHunt') {
      const resolvedId = resolveUnitIdFromParams(order.params, state.spawnedByOrder)
      if (!resolvedId) continue
      const beforeUnit = before[resolvedId]
      const from = animatedPositions.get(resolvedId) ?? beforeUnit?.pos
      const consumedMoveAttempt = consumeLoggedMoveAttempt(resolvedId)
      if (consumedMoveAttempt) {
        enqueueDestroyedUpTo(consumedMoveAttempt.index - 1)
        lastConsumedLogIndex = Math.max(lastConsumedLogIndex, consumedMoveAttempt.index)
      }
      if (consumedMoveAttempt?.moved && from && consumedMoveAttempt.pos) {
        const destination = consumedMoveAttempt.pos
        if (from.q !== destination.q || from.r !== destination.r) {
          animations.push({
            type: 'move',
            unitId: resolvedId,
            from: { ...from },
            to: { ...destination },
            duration: MOVE_DURATION_MS,
          })
          animatedPositions.set(resolvedId, { ...destination })
        }
        queueStateSync(consumedMoveAttempt.index)
      }

      const actorAfter = state.units[resolvedId]
      if (!actorAfter) continue
      const targetTile = neighbor(actorAfter.pos, actorAfter.facing)
      if (!isTile(targetTile)) continue
      const lunges = Object.values(state.units)
        .filter(
          (unit) =>
            unit.owner === order.player &&
            (unit.kind === 'unit' || unit.kind === 'leader') &&
            hexDistance(unit.pos, targetTile) === 1
        )
        .map((unit) => {
          const fromPos = animatedPositions.get(unit.id) ?? before[unit.id]?.pos ?? unit.pos
          const dir = getDirectionToNeighbor(fromPos, targetTile)
          if (dir === null) return null
          return {
            unitId: unit.id,
            from: { ...fromPos },
            dir,
          }
        })
        .filter((entry): entry is { unitId: string; from: Hex; dir: Direction } => entry !== null)
      if (lunges.length > 0) {
        animations.push({
          type: 'teamLunge',
          lunges,
          duration: LUNGE_DURATION_MS,
        })
      }
      continue
    }

    if (effect.type === 'executeForward') {
      const resolvedId = resolveUnitIdFromParams(order.params, state.spawnedByOrder)
      if (!resolvedId) continue
      const acting = before[resolvedId]
      if (!acting) continue
      const executeOrigin = animatedPositions.get(resolvedId) ?? acting.pos
      animations.push({
        type: 'lunge',
        unitId: resolvedId,
        from: { ...executeOrigin },
        dir: acting.facing,
        duration: LUNGE_DURATION_MS,
      })
      const targetTile = neighbor(acting.pos, acting.facing)
      const target = findSnapshotUnitAt(before, targetTile)
      if (!target) continue
      animations.push({
        type: 'execute',
        target: { ...target.pos },
        duration: EXECUTE_DURATION_MS,
      })
    }

    if (effect.type === 'damageAdjacent') {
      const resolvedId = resolveUnitIdFromParams(order.params, state.spawnedByOrder)
      if (!resolvedId) continue
      const origin = animatedPositions.get(resolvedId) ?? before[resolvedId]?.pos ?? state.units[resolvedId]?.pos
      if (!origin) continue
      if (order.defId === 'attack_blade_dance') {
        const nextMoveIndex = (() => {
          const queue = loggedMoveEvents.get(resolvedId)
          if (!queue || queue.length === 0) return Number.MAX_SAFE_INTEGER
          return queue[0].index
        })()
        const hitTargets = damageEvents
          .filter(
            (event) =>
              event.index > lastConsumedLogIndex &&
              event.index < nextMoveIndex &&
              event.amount > 0
          )
          .map((event) => event.unitId)
          .filter((unitId, index, all) => all.indexOf(unitId) === index)
        hitTargets.forEach((targetId) => {
          const targetPos =
            animatedPositions.get(targetId) ??
            loggedPositions.get(targetId) ??
            state.units[targetId]?.pos ??
            before[targetId]?.pos
          if (!targetPos) return
          const dir = getDirectionToNeighbor(origin, targetPos)
          if (dir === null) return
          animations.push({
            type: 'lunge',
            unitId: resolvedId,
            from: { ...origin },
            dir,
            duration: LUNGE_DURATION_MS,
          })
        })
        const stageSyncIndex =
          nextMoveIndex !== Number.MAX_SAFE_INTEGER ? nextMoveIndex - 1 : logEntries.length - 1
        queueStateSync(stageSyncIndex)
        enqueueDestroyedUpTo(stageSyncIndex)
        if (nextMoveIndex !== Number.MAX_SAFE_INTEGER) {
          lastConsumedLogIndex = Math.max(lastConsumedLogIndex, nextMoveIndex - 1)
        } else {
          lastConsumedLogIndex = logEntries.length
        }
        continue
      }
      animations.push({
        type: 'adjacentStrike',
        origin: { ...origin },
        duration: ADJACENT_STRIKE_DURATION_MS,
      })
    }

    if (effect.type === 'whirlwind') {
      const resolvedId = resolveUnitIdFromParams(order.params, state.spawnedByOrder)
      if (!resolvedId) continue
      const origin = animatedPositions.get(resolvedId) ?? before[resolvedId]?.pos ?? state.units[resolvedId]?.pos
      if (!origin) continue
      animations.push({
        type: 'whirlwind',
        origin: { ...origin },
        duration: WHIRLWIND_DURATION_MS,
      })
      const pushMoves: Array<{ unitId: string; from: Hex; to: Hex }> = []
      for (let dir = 0 as Direction; dir < 6; dir += 1) {
        const target = findSnapshotUnitAt(before, neighbor(origin, dir))
        if (!target) continue
        const from = animatedPositions.get(target.id) ?? target.pos
        const to = state.units[target.id]?.pos ?? loggedPositions.get(target.id)
        if (!to) continue
        if (from.q === to.q && from.r === to.r) continue
        pushMoves.push({
          unitId: target.id,
          from: { ...from },
          to: { ...to },
        })
      }
      if (pushMoves.length > 0) {
        animations.push({
          type: 'teamMove',
          moves: pushMoves,
          duration: SHOVE_DURATION_MS,
        })
        pushMoves.forEach((move) => {
          animatedPositions.set(move.unitId, { ...move.to })
        })
      }
    }

    if (effect.type === 'teleport') {
      const resolvedId = resolveUnitIdFromParams(order.params, state.spawnedByOrder)
      if (!resolvedId) continue
      const beforeUnit = before[resolvedId]
      const afterUnit = state.units[resolvedId]
      if (!beforeUnit || !afterUnit) continue
      if (beforeUnit.pos.q === afterUnit.pos.q && beforeUnit.pos.r === afterUnit.pos.r) continue
      animations.push({
        type: 'teleport',
        unitId: resolvedId,
        from: { ...beforeUnit.pos },
        to: { ...afterUnit.pos },
        fromSnapshot: {
          ...beforeUnit,
          pos: { ...beforeUnit.pos },
        },
        toSnapshot: {
          ...afterUnit,
          pos: { ...afterUnit.pos },
          modifiers: afterUnit.modifiers.map((modifier) => ({ ...modifier })),
        },
        duration: TELEPORT_DURATION_MS,
      })
      animatedPositions.set(resolvedId, { ...afterUnit.pos })
    }

    if (effect.type === 'jointAttack') {
      const resolvedId = resolveUnitIdFromParams(order.params, state.spawnedByOrder)
      const tile = getOrderTileParam(order.params, effect.tileParam)
      if (!resolvedId || !tile) continue
      const actingUnit = before[resolvedId] ?? state.units[resolvedId]
      const actingLunge =
        actingUnit
          ? (() => {
              const dir = getDirectionToNeighbor(animatedPositions.get(resolvedId) ?? actingUnit.pos, tile)
              if (dir === null) return null
              return {
                unitId: resolvedId,
                from: { ...(animatedPositions.get(resolvedId) ?? actingUnit.pos) },
                dir,
              }
            })()
          : null
      const participants = [
        actingLunge,
        ...getCommanderAnimationParticipants(before, order.player, tile, resolvedId)
        .map((participant) => {
          const dir = getDirectionToNeighbor(participant.pos, tile)
          if (dir === null) return null
          return {
            unitId: participant.id,
            from: { ...participant.pos },
            dir,
          }
        })
          .filter((entry): entry is { unitId: string; from: Hex; dir: Direction } => entry !== null),
      ].filter((entry): entry is { unitId: string; from: Hex; dir: Direction } => entry !== null)
      if (participants.length > 0) {
        animations.push({
          type: 'teamLunge',
          lunges: participants,
          duration: LUNGE_DURATION_MS,
        })
      }
      continue
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
        const paramValue =
          effect.directions.key === 'moveDirection'
            ? order.params.moveDirection
            : effect.directions.key === 'faceDirection'
              ? order.params.faceDirection
              : order.params.direction
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
          animations.push({
            type: 'lineProjectile',
            projectile: 'arrow',
            from: beforeUnit.pos,
            to: target ? { ...target.pos } : findLineExitHex(beforeUnit.pos, dir),
            target: target ? { ...target.pos } : undefined,
            fizzle: !target,
            duration: ARROW_DURATION_MS,
          })
        } else if (order.defId === 'attack_ice_bolt') {
          const target = findFirstUnitInLine(before, beforeUnit.pos, dir)
          animations.push({
            type: 'lineProjectile',
            projectile: 'iceBolt',
            from: beforeUnit.pos,
            to: target ? { ...target.pos } : findLineExitHex(beforeUnit.pos, dir),
            target: target ? { ...target.pos } : undefined,
            fizzle: !target,
            duration: ICE_BOLT_DURATION_MS,
          })
        } else if (order.defId === 'attack_line') {
          const end = findLineEndHex(beforeUnit.pos, dir, effect.maxRange)
          if (end) {
            animations.push({
              type: 'flameThrower',
              from: beforeUnit.pos,
              to: end,
              duration: FLAME_THROWER_DURATION_MS,
            })
          }
        }
      })
    }

    if (effect.type === 'lineSplash') {
      const resolvedId = resolveUnitIdFromParams(order.params, state.spawnedByOrder)
      if (!resolvedId) continue
      const beforeUnit = before[resolvedId]
      const afterUnit = state.units[resolvedId]
      if (!beforeUnit || !afterUnit) continue
      const direction = afterUnit.facing
      const target = findFirstUnitInLine(before, beforeUnit.pos, direction, effect.maxRange)
      animations.push({
        type: 'lineProjectile',
        projectile: 'fireball',
        from: beforeUnit.pos,
        to: target ? { ...target.pos } : findLineExitHex(beforeUnit.pos, direction),
        target: target ? { ...target.pos } : undefined,
        duration: FIREBALL_DURATION_MS,
        fizzle: !target,
      })
      continue
    }

    if (effect.type === 'chainLightning' || effect.type === 'chainLightningAllFriendly') {
      const events = parseChainLightningEvents(logEntries)
      const defaultOriginId =
        effect.type === 'chainLightning' ? resolveUnitIdFromParams(order.params, state.spawnedByOrder) ?? undefined : undefined

      events.paths.forEach((event) => {
        const originUnitId = event.originUnitId ?? defaultOriginId
        if (!originUnitId) return
        const actingUnit = before[originUnitId] ?? state.units[originUnitId]
        if (!actingUnit) return
        let currentFrom = { ...actingUnit.pos }
        event.path.forEach((targetId) => {
          const targetSnapshot = before[targetId] ?? state.units[targetId]
          if (!targetSnapshot) return
          const targetPos = { ...targetSnapshot.pos }
          animations.push({
            type: 'chainLightning',
            from: currentFrom,
            to: targetPos,
            duration: CHAIN_LIGHTNING_HOP_DURATION_MS,
          })
          currentFrom = targetPos
        })
      })
      events.fizzles.forEach((event) => {
        const originUnitId = event.originUnitId ?? defaultOriginId
        if (!originUnitId) return
        const actingUnit = before[originUnitId] ?? state.units[originUnitId]
        if (!actingUnit) return
        animations.push({
          type: 'lightningFizzle',
          centers: [{ ...actingUnit.pos }],
          duration: LIGHTNING_FIZZLE_DURATION_MS,
        })
      })
    }

    if (effect.type === 'volley') {
      const resolvedId = resolveUnitIdFromParams(order.params, state.spawnedByOrder)
      const tile = getOrderTileParam(order.params, effect.tileParam)
      const actingUnit = resolvedId ? before[resolvedId] ?? state.units[resolvedId] : null
      if (!actingUnit || !tile) continue
      const shots = [
        { from: { ...actingUnit.pos }, to: { ...tile } },
        ...getCommanderAnimationParticipants(before, order.player, actingUnit.pos, actingUnit.id).map((participant) => ({
          from: { ...participant.pos },
          to: { ...tile },
        })),
      ]
      if (shots.length > 0) {
        animations.push({
          type: 'volley',
          shots,
          duration: VOLLEY_DURATION_MS,
        })
      }
      continue
    }

    if (effect.type === 'harpoon') {
      const resolvedId = resolveUnitIdFromParams(order.params, state.spawnedByOrder)
      if (!resolvedId) continue
      const beforeUnit = before[resolvedId]
      const afterUnit = state.units[resolvedId]
      if (!beforeUnit || !afterUnit) continue

      const target = findFirstUnitInLine(before, beforeUnit.pos, beforeUnit.facing)
      if (!target) {
        animations.push({
          type: 'harpoon',
          from: { ...beforeUnit.pos },
          to: findLineEndHex(beforeUnit.pos, beforeUnit.facing) ?? findLineExitHex(beforeUnit.pos, beforeUnit.facing),
          duration: HARPOON_DURATION_MS,
          fizzle: true,
        })
        continue
      }

      const afterTarget = state.units[target.id]
      const hasPull = Boolean(
        afterTarget &&
          (afterTarget.pos.q !== target.pos.q || afterTarget.pos.r !== target.pos.r)
      )

      animations.push({
        type: 'harpoon',
        from: { ...beforeUnit.pos },
        to: { ...target.pos },
        duration: HARPOON_DURATION_MS,
        pulledUnit:
          hasPull && afterTarget
            ? {
                id: target.id,
                from: { ...target.pos },
                to: { ...afterTarget.pos },
                snapshot: {
                  ...target,
                  pos: { ...target.pos },
                  facing: afterTarget.facing,
                  strength: afterTarget.strength,
                  modifiers: afterTarget.modifiers.map((modifier) => ({ ...modifier })),
                  roguelikeRole: afterTarget.roguelikeRole ?? target.roguelikeRole,
                  isMinion: afterTarget.isMinion ?? target.isMinion,
                },
              }
            : undefined,
      })
    }

    if (effect.type === 'shove') {
      const resolvedId = resolveUnitIdFromParams(order.params, state.spawnedByOrder)
      if (!resolvedId) continue
      const beforeUnit = before[resolvedId]
      const afterUnit = state.units[resolvedId] ?? before[resolvedId]
      if (!beforeUnit || !afterUnit) continue

      const direction = resolveDirectionFromParams(effect.direction, afterUnit.facing, order.params)
      if (direction === null) continue
      const targetTile = neighbor(beforeUnit.pos, direction)
      const target = findSnapshotUnitAt(before, targetTile)
      if (!target) continue

      const attemptedTile = neighbor(target.pos, direction)
      const afterTargetPos = state.units[target.id]?.pos ?? loggedPositions.get(target.id)
      const collision = consumeShoveCollision(target.id)
      if (collision) {
        if (
          afterTargetPos &&
          (afterTargetPos.q !== target.pos.q || afterTargetPos.r !== target.pos.r)
        ) {
          enqueueDestroyedUpTo(collision.index - 1)
          lastConsumedLogIndex = Math.max(lastConsumedLogIndex, collision.index)
          animations.push({
            type: 'shove',
            targetUnitId: target.id,
            from: { ...target.pos },
            to: { ...afterTargetPos },
            collision: false,
            duration: SHOVE_DURATION_MS,
          })
          animatedPositions.set(target.id, { ...afterTargetPos })
          queueStateSync(collision.index)
          continue
        }
        if (isTile(attemptedTile)) {
          enqueueDestroyedUpTo(collision.index - 1)
          lastConsumedLogIndex = Math.max(lastConsumedLogIndex, collision.index)
          animations.push({
            type: 'shove',
            targetUnitId: target.id,
            from: { ...target.pos },
            to: { ...attemptedTile },
            collision: true,
            duration: SHOVE_DURATION_MS,
          })
          queueStateSync(collision.index)
        }
        continue
      }

      if (!afterTargetPos) continue
      if (afterTargetPos.q === target.pos.q && afterTargetPos.r === target.pos.r) continue
      animations.push({
        type: 'shove',
        targetUnitId: target.id,
        from: { ...target.pos },
        to: { ...afterTargetPos },
        collision: false,
        duration: SHOVE_DURATION_MS,
      })
      animatedPositions.set(target.id, { ...afterTargetPos })
    }

    if (effect.type === 'teamAttackForward') {
      const lunges = Object.values(state.units)
        .filter((unit) => unit.owner === order.player && (unit.kind === 'unit' || unit.kind === 'leader'))
        .map((unit) => ({
          unitId: unit.id,
          from: { ...unit.pos },
          dir: unit.facing,
        }))
      if (lunges.length > 0) {
        animations.push({
          type: 'teamLunge',
          lunges,
          duration: LUNGE_DURATION_MS,
        })
      }
    }

    if (effect.type === 'pincerAttack') {
      const attackedTargets = damageEvents
        .filter((event) => event.amount > 0)
        .map((event) => before[event.unitId] ?? state.units[event.unitId])
        .filter((target): target is UnitSnapshot => target !== undefined)
      const strikeCounts = new Map<string, number>()
      attackedTargets.forEach((target) => {
        getCommanderAnimationParticipants(before, order.player, target.pos).forEach((participant) => {
          strikeCounts.set(participant.id, (strikeCounts.get(participant.id) ?? 0) + 1)
        })
      })
      const strikes = attackedTargets.flatMap((target) =>
        getCommanderAnimationParticipants(before, order.player, target.pos).map((participant) => ({
          from: { ...participant.pos },
          to: { ...target.pos },
          snapshot: {
            ...participant,
            pos: { ...participant.pos },
            modifiers: participant.modifiers.map((modifier) => ({ ...modifier })),
          },
          alpha: (strikeCounts.get(participant.id) ?? 0) > 1 ? 0.52 : 0.86,
        }))
      )
      if (strikes.length > 0) {
        animations.push({
          type: 'pincer',
          strikes,
          duration: PINCER_DURATION_MS,
        })
      }
      continue
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

    if (effect.type === 'boostAllFriendly') {
      Object.values(before).forEach((beforeUnit) => {
        if (beforeUnit.owner !== order.player) return
        const afterUnit = state.units[beforeUnit.id]
        if (!afterUnit) return
        if (afterUnit.strength <= beforeUnit.strength) return
        animations.push({
          type: 'boost',
          unitId: beforeUnit.id,
          duration: BOOST_DURATION_MS,
        })
      })
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

    if (effect.type === 'applyPlayerModifier' && order.defId === 'spell_brain_freeze') {
      animations.push({
        type: 'brainFreeze',
        duration: BRAIN_FREEZE_DURATION_MS,
      })
    }

    if (effect.type === 'damageTileArea' && order.defId === 'spell_meteor' && order.params.tile) {
      animations.push({
        type: 'meteor',
        target: { ...order.params.tile },
        duration: METEOR_DURATION_MS,
      })
    }

    if (effect.type === 'damageRadius' && order.defId === 'spell_blizzard') {
      const tile = getOrderTileParam(order.params, effect.tileParam)
      if (!tile) continue
      animations.push({
        type: 'blizzard',
        target: { ...tile },
        radius: effect.radius,
        duration: BLIZZARD_DURATION_MS,
      })
    }
  }

  trapTriggers.forEach((trigger) => {
    const fallback =
      loggedPositions.get(trigger.unitId) ??
      state.units[trigger.unitId]?.pos ??
      before[trigger.unitId]?.pos
    const target = trigger.tile ?? fallback
    if (!target) return
    animations.push({
      type: 'trapTrigger',
      target: { ...target },
      trapKind: trigger.trapKind,
      duration: TRAP_TRIGGER_DURATION_MS,
    })
    queueStateSync(trigger.index)
    queuedTrapTriggerCountByUnit.set(trigger.unitId, (queuedTrapTriggerCountByUnit.get(trigger.unitId) ?? 0) + 1)
    flushDeferredDestroyedForUnit(trigger.unitId)
  })

  parseBurnDamageTargets(logEntries).forEach((unitId) => {
    const targetPos = loggedPositions.get(unitId) ?? state.units[unitId]?.pos ?? before[unitId]?.pos
    if (!targetPos) return
    animations.push({
      type: 'burn',
      target: { ...targetPos },
      duration: BURN_DURATION_MS,
    })
  })

  const splitGroups: Array<{
    index: number
    arcs: Array<{ from: Hex; to: Hex }>
    spawnedUnitIds: string[]
  }> = []
  const splitGroupsBySource = new Map<string, (typeof splitGroups)[number]>()
  slimeSplitEvents.forEach((event) => {
    let group = splitGroupsBySource.get(event.sourceUnitId)
    if (!group) {
      group = {
        index: event.index,
        arcs: [],
        spawnedUnitIds: [],
      }
      splitGroupsBySource.set(event.sourceUnitId, group)
      splitGroups.push(group)
    }
    group.arcs.push({
      from: { ...event.from },
      to: { ...event.to },
    })
    if (!event.spawnedUnitId) return
    if (before[event.spawnedUnitId]) return
    if (!state.units[event.spawnedUnitId]) return
    if (group.spawnedUnitIds.includes(event.spawnedUnitId)) return
    group.spawnedUnitIds.push(event.spawnedUnitId)
  })

  splitGroups.forEach((group) => {
    enqueueDestroyedUpTo(group.index - 1)
    lastConsumedLogIndex = Math.max(lastConsumedLogIndex, group.index)
    animations.push({
      type: 'slimeLob',
      arcs: group.arcs.map((arc) => ({ from: { ...arc.from }, to: { ...arc.to } })),
      duration: SLIME_LOB_DURATION_MS,
    })
    queueStateSync(group.index)
    group.spawnedUnitIds.forEach((unitId) => {
      unitAlphaOverrides.set(unitId, 0)
      animations.push({
        type: 'spawn',
        unitId,
        duration: SPAWN_DURATION_MS,
      })
    })
  })

  const animatedMoveIds = new Set<string>()
  animations.forEach((animation) => {
    if (animation.type === 'move') {
      animatedMoveIds.add(animation.unitId)
    }
    if (animation.type === 'teamMove') {
      animation.moves.forEach((move) => {
        animatedMoveIds.add(move.unitId)
      })
    }
    if (animation.type === 'shove') {
      animatedMoveIds.add(animation.targetUnitId)
    }
    if (animation.type === 'teleport') {
      animatedMoveIds.add(animation.unitId)
    }
    if (animation.type === 'harpoon' && animation.pulledUnit) {
      animatedMoveIds.add(animation.pulledUnit.id)
    }
  })
  Object.entries(before).forEach(([unitId, previous]) => {
    if (animatedMoveIds.has(unitId)) return
    const afterUnit = state.units[unitId]
    if (!afterUnit) return
    if (previous.pos.q === afterUnit.pos.q && previous.pos.r === afterUnit.pos.r) return
    animations.push({
      type: 'move',
      unitId,
      from: previous.pos,
      to: afterUnit.pos,
      duration: MOVE_DURATION_MS,
    })
  })

  queueStateSync(Number.MAX_SAFE_INTEGER)
  enqueueDestroyedUpTo(Number.MAX_SAFE_INTEGER)
  deferredDestroyedByUnit.forEach((events) => {
    events.sort((a, b) => a.index - b.index).forEach((event) => enqueueDestroyedEvent(event))
  })
  deferredDestroyedByUnit.clear()
  if (damageFlashUnitIds.length > 0) {
    const damageFlashAnimation: BoardAnimation = {
      type: 'damageFlash',
      unitIds: damageFlashUnitIds,
      duration: DAMAGE_FLASH_DURATION_MS,
    }
    const firstDeathIndex = animations.findIndex((animation) => animation.type === 'death')
    if (firstDeathIndex === -1) {
      animations.push(damageFlashAnimation)
    } else {
      animations.splice(firstDeathIndex, 0, damageFlashAnimation)
    }
  }

  const strengthChangeEntries = collectStrengthChangeAnimationEntries(before, state.units, logEntries, loggedPositions, animatedPositions)
  if (strengthChangeEntries.length > 0) {
    const strengthChangeAnimation: BoardAnimation = {
      type: 'strengthChange',
      entries: strengthChangeEntries,
      duration: STRENGTH_CHANGE_DURATION_MS,
    }
    const firstDeathIndex = animations.findIndex((animation) => animation.type === 'death')
    if (firstDeathIndex === -1) {
      animations.push(strengthChangeAnimation)
    } else {
      animations.splice(firstDeathIndex, 0, strengthChangeAnimation)
    }
  }

  return animations
}

function tickAnimation(time: number): void {
  if (!currentAnimation) return
  const elapsed = time - animationStart
  animationProgress = Math.min(1, elapsed / currentAnimation.duration)
  if (currentAnimation.type === 'spawn') {
    unitAlphaOverrides.set(currentAnimation.unitId, easeInOutCubic(animationProgress))
  } else if (currentAnimation.type === 'damageFlash') {
    const flicker = 0.35 + Math.abs(Math.sin(animationProgress * Math.PI * 4)) * 0.65
    currentAnimation.unitIds.forEach((unitId) => {
      unitAlphaOverrides.set(unitId, flicker)
    })
  } else if (currentAnimation.type === 'death') {
    deathAlphaOverrides.set(currentAnimation.unit.id, 1 - easeInOutCubic(animationProgress))
  }
  renderBoardOnly()
  if (animationProgress >= 1) {
    if (currentAnimation.type === 'spawn') {
      unitAlphaOverrides.delete(currentAnimation.unitId)
    } else if (currentAnimation.type === 'damageFlash') {
      currentAnimation.unitIds.forEach((unitId) => {
        unitAlphaOverrides.delete(unitId)
      })
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
  const nextAnimation = animationQueue.shift() ?? null
  if (!nextAnimation) {
    currentAnimation = null
    isAnimating = false
    clearAnimationBoardSync()
    if (autoResolve && state.phase === 'action') {
      requestAnimationFrame(() => resolveNextActionAnimated())
      return
    }
    finalizeOnlineResolutionReplay()
    render()
    return
  }
  if (nextAnimation.type === 'stateSync') {
    applyAnimationBoardSyncUpTo(nextAnimation.upToLogIndex)
    renderBoardOnly()
    runNextAnimation()
    return
  }
  currentAnimation = nextAnimation
  if (currentAnimation.type === 'spawn' && animationRenderUnits && !animationRenderUnits[currentAnimation.unitId]) {
    const source = state.units[currentAnimation.unitId] ?? pendingDeathUnits.get(currentAnimation.unitId)
    if (source) {
      animationRenderUnits[currentAnimation.unitId] = {
        ...source,
        pos: { ...source.pos },
        modifiers: source.modifiers.map((modifier) => ({ ...modifier })),
      }
    }
  }
  isAnimating = true
  animationProgress = 0
  animationStart = performance.now()
  renderBoardOnly()
  requestAnimationFrame(tickAnimation)
}

function resolveNextActionAnimated(): void {
  if (state.phase !== 'action' || isAnimating) return
  const currentOrder = state.actionQueue[state.actionIndex]
  const sourceOrderEl = currentOrder ? ordersEl.querySelector<HTMLElement>(`[data-order-id="${currentOrder.id}"]`) : null
  const previewSource =
    currentOrder && sourceOrderEl
      ? {
          rect: sourceOrderEl.getBoundingClientRect(),
          defId: currentOrder.defId,
          owner: currentOrder.player,
        }
      : null

  const runResolutionStep = async (
    order: GameState['actionQueue'][number] | undefined,
    preview: ResolutionPreviewSource | null,
    previewClone: HTMLElement | null
  ): Promise<void> => {
    const beforeState = cloneGameState(state)
    const before = snapshotUnits(beforeState)
    const shouldPreviewFizzle = order ? shouldPreviewFizzleForUnavailableTarget(order, state) : false
    const logStart = state.log.length
    resolveNextAction(state)
    if (!order) {
      const turnEndLogs = state.log.slice(logStart)
      const turnEndAnimations = buildTurnEndReplayAnimations(before, turnEndLogs)
      if (turnEndAnimations.length > 0) {
        startAnimationBoardSync(before, turnEndLogs)
        animationQueue.push(...turnEndAnimations)
        if (!currentAnimation) runNextAnimation()
        return
      }
      clearAnimationBoardSync()
      isAnimating = false
      finalizeOnlineResolutionReplay()
      render()
      return
    }
    const allLogs = state.log.slice(logStart)
    let orderLogs = allLogs
    let turnEndStartIndex = -1
    let turnEndAnimations: BoardAnimation[] = []
    if (state.phase === 'planning' && state.winner === null) {
      turnEndStartIndex = findTurnEndEffectLogStart(allLogs)
      if (turnEndStartIndex !== -1) {
        orderLogs = allLogs.slice(0, turnEndStartIndex)
        turnEndAnimations = buildTurnEndReplayAnimations(before, allLogs.slice(turnEndStartIndex), turnEndStartIndex)
      }
    }
    const animations = buildAnimations(order, before, orderLogs)
    const previewPlan = buildResolutionCardPreviewPlan(order, beforeState, orderLogs, animations, shouldPreviewFizzle)
    await playResolutionCardPreview(preview, previewPlan, previewClone)
    const combinedAnimations = [...animations]
    if (turnEndAnimations.length > 0 && turnEndStartIndex > 0) {
      combinedAnimations.push({
        type: 'stateSync',
        upToLogIndex: turnEndStartIndex - 1,
        duration: 0,
      })
    }
    combinedAnimations.push(...turnEndAnimations)
    if (combinedAnimations.length === 0) {
      clearAnimationBoardSync()
      isAnimating = false
      finalizeOnlineResolutionReplay()
      render()
      if (autoResolve && state.phase === 'action') {
        requestAnimationFrame(() => resolveNextActionAnimated())
      }
      return
    }
    startAnimationBoardSync(before, allLogs)
    animationQueue.push(...combinedAnimations)
    if (!currentAnimation) {
      runNextAnimation()
    }
  }

  if (!currentOrder) {
    void runResolutionStep(undefined, null, null)
    return
  }

  const previewClone = previewSource ? createResolutionCardClone(previewSource) : null
  clearOverlayClone()
  isAnimating = true
  const fromOrderRects = captureCardRects(ordersEl)
  resolvingOrderIdsHidden.add(currentOrder.id)
  render()
  applyDelayedReflow(ordersEl, fromOrderRects, 0, currentOrder.cardId)
  void runResolutionStep(currentOrder, previewSource, previewClone)
    .catch(() => {
      // Ignore preview animation failures and continue resolving.
    })
    .finally(() => {
      previewClone?.remove()
      resolvingOrderIdsHidden.delete(currentOrder.id)
    })
}

function tryAutoAddOrder(): void {
  if (!pendingOrder || state.phase !== 'planning') return
  if (isBotPlanningLocked()) return
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
  notifyTutorialEvent('order_queued', { defId: order.defId, cardId: order.cardId, turn: state.turn })
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

type SelectionStep =
  | 'unit'
  | 'unit2'
  | 'tile'
  | 'tile2'
  | 'tile3'
  | 'direction'
  | 'moveDirection'
  | 'faceDirection'
  | 'distance'

type MoveSemantics = {
  directionSource: 'facing' | { type: 'param'; key: 'direction' | 'moveDirection' | 'faceDirection' }
  distanceSource: { type: 'fixed'; value: number } | { type: 'param'; key: 'distance' }
}

type DistanceSelectionTarget = {
  tile: Hex
  direction?: Direction
  distance?: number
}

function deriveMoveSemantics(defId: CardDefId): MoveSemantics | null {
  const def = CARD_DEFS[defId]
  const moveEffect = def.effects.find(
    (effect): effect is Extract<CardEffect, { type: 'move' }> => effect.type === 'move' && effect.unitParam === 'unitId'
  )
  if (!moveEffect) return null

  const directionSource =
    moveEffect.direction === 'facing' ? 'facing' : moveEffect.direction.type === 'param' ? moveEffect.direction : null
  if (!directionSource) return null

  const distanceSource =
    typeof moveEffect.distance === 'number'
      ? { type: 'fixed' as const, value: moveEffect.distance }
      : { type: 'param' as const, key: moveEffect.distance.key }

  return {
    directionSource,
    distanceSource,
  }
}

function getDistanceSelectionTargets(
  snapshot: GameState,
  defId: CardDefId,
  params: OrderParams,
  player: PlayerId
): DistanceSelectionTarget[] {
  const semantics = deriveMoveSemantics(defId)
  const unitSnapshot = getUnitSnapshot(snapshot, params.unitId ?? '', player)
  if (!semantics || !unitSnapshot) return []

  const directionCandidates: Direction[] = []
  if (semantics.directionSource === 'facing') {
    directionCandidates.push(unitSnapshot.facing)
  } else {
    const selectedDirection =
      semantics.directionSource.key === 'direction'
        ? params.direction
        : semantics.directionSource.key === 'moveDirection'
          ? params.moveDirection
          : params.faceDirection
    if (selectedDirection === undefined) {
      DIRECTIONS.forEach((_, index) => directionCandidates.push(index as Direction))
    } else {
      directionCandidates.push(selectedDirection)
    }
  }

  const distanceCandidates =
    semantics.distanceSource.type === 'fixed'
      ? [semantics.distanceSource.value]
      : CARD_DEFS[defId].requires.distanceOptions ?? (params.distance !== undefined ? [params.distance] : [])
  if (distanceCandidates.length === 0) return []

  const targets: DistanceSelectionTarget[] = []
  directionCandidates.forEach((direction) => {
    distanceCandidates.forEach((distance) => {
      const tile = stepInDirection(unitSnapshot.pos, direction, distance)
      if (!isTile(tile)) return
      targets.push({
        tile,
        direction: semantics.directionSource === 'facing' ? undefined : direction,
        distance: semantics.distanceSource.type === 'param' ? distance : undefined,
      })
    })
  })

  return targets
}

function resolveDistanceClick(
  snapshot: GameState,
  defId: CardDefId,
  params: OrderParams,
  player: PlayerId,
  clickedHex: Hex
):
  | { matched: false }
  | { matched: true; directionKey?: 'direction' | 'moveDirection' | 'faceDirection'; direction?: Direction; distance?: number } {
  const semantics = deriveMoveSemantics(defId)
  if (!semantics) return { matched: false }

  const match = getDistanceSelectionTargets(snapshot, defId, params, player).find(
    (candidate) => candidate.tile.q === clickedHex.q && candidate.tile.r === clickedHex.r
  )
  if (!match) return { matched: false }

  return {
    matched: true,
    directionKey: semantics.directionSource === 'facing' ? undefined : semantics.directionSource.key,
    direction: match.direction,
    distance: match.distance,
  }
}

function getNextRequirement(defId: CardDefId, params: OrderParams): SelectionStep | null {
  const def = CARD_DEFS[defId]
  if (defId === 'move_double_steps') {
    const selectionState = simulatePlannedState(state, planningPlayer)
    if (!params.unitId) return 'unit'
    if (!params.tile) return 'tile'
    if (!params.unitId2) {
      if (hasResolvableDoubleStepsFollowUpSelection(selectionState, planningPlayer, params)) return 'unit2'
    }
    if (params.unitId2 && !params.tile2) return 'tile2'
  }
  if (def.requires.unit && !params.unitId) return 'unit'
  if (def.requires.unit2 && params.unitId && !params.unitId2) return 'unit2'
  if (defId === 'reinforce_boost' && params.unitId && !params.unitId2) {
    const selectionState = simulatePlannedState(state, planningPlayer)
    if (hasSecondaryBoostTarget(selectionState, planningPlayer, params.unitId)) return 'unit2'
  }
  if (def.requires.tile && !params.tile) return 'tile'
  if (def.requires.tile2 && !params.tile2) return 'tile2'
  if (def.requires.tile3 && !params.tile3) return 'tile3'
  if (defId === 'reinforce_barricade' && params.tile && params.tile2) {
    if (params.tile.q === params.tile2.q && params.tile.r === params.tile2.r) return 'tile2'
  }
  if (defId === 'reinforce_spawn' && params.tile && params.direction === undefined) return 'direction'
  if (defId === 'attack_fwd' && params.direction === undefined) return 'direction'
  const moveSemantics = deriveMoveSemantics(defId)
  if (moveSemantics?.directionSource !== 'facing' && moveSemantics?.distanceSource.type === 'param') {
    const directionResolved =
      moveSemantics.directionSource.key === 'direction'
        ? params.direction !== undefined
        : moveSemantics.directionSource.key === 'moveDirection'
          ? params.moveDirection !== undefined
          : params.faceDirection !== undefined
    if (!directionResolved || params.distance === undefined) return 'distance'
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
  const units = Object.values(snapshot.units).filter(
    (unit) => unit.owner === player && canCardSelectUnit('reinforce_boost', unit)
  )
  const unitHexes = units.map((unit) => ({ ...unit.pos }))
  const planned = getPlannedSpawnTiles(player)
  return [...unitHexes, ...planned].some((hex) => hex.q !== selected.pos.q || hex.r !== selected.pos.r)
}

type SnapshotMovePlan = {
  unitId: string
  target: Hex
}

function canSnapshotUnitMove(unit: Unit): boolean {
  return unit.kind === 'unit' || unit.kind === 'leader'
}

function getSnapshotDirectionToAdjacentTile(from: Hex, to: Hex): Direction | null {
  for (let direction = 0 as Direction; direction < 6; direction += 1) {
    const candidate = neighbor(from, direction)
    if (candidate.q === to.q && candidate.r === to.r) return direction
  }
  return null
}

function canResolveSnapshotSimultaneousMoves(snapshot: GameState, plans: SnapshotMovePlan[]): boolean {
  const resolvedPlans = new Map<string, { unit: Unit; target: Hex }>()
  plans.forEach((plan) => {
    const unit = snapshot.units[plan.unitId]
    if (!unit || !canSnapshotUnitMove(unit)) return
    const direction = getSnapshotDirectionToAdjacentTile(unit.pos, plan.target)
    if (direction === null || !isTile(plan.target)) return
    resolvedPlans.set(plan.unitId, { unit, target: { ...plan.target } })
  })
  if (resolvedPlans.size === 0) return false

  const movable = new Set(
    [...resolvedPlans.entries()]
      .filter(([, plan]) => !snapshotIsMovementBlocked(plan.unit))
      .map(([unitId]) => unitId)
  )

  let changed = true
  while (changed) {
    changed = false
    const targetCounts = new Map<string, number>()
    movable.forEach((unitId) => {
      const plan = resolvedPlans.get(unitId)
      if (!plan) return
      const key = `${plan.target.q},${plan.target.r}`
      targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1)
    })
    for (const unitId of [...movable]) {
      const plan = resolvedPlans.get(unitId)
      if (!plan) {
        movable.delete(unitId)
        changed = true
        continue
      }
      const key = `${plan.target.q},${plan.target.r}`
      if ((targetCounts.get(key) ?? 0) > 1) {
        movable.delete(unitId)
        changed = true
        continue
      }
      const occupant = Object.values(snapshot.units).find(
        (unit) => unit.pos.q === plan.target.q && unit.pos.r === plan.target.r
      )
      if (!occupant || occupant.id === unitId) continue
      if (!resolvedPlans.has(occupant.id) || !movable.has(occupant.id)) {
        movable.delete(unitId)
        changed = true
      }
    }
  }

  return movable.size === resolvedPlans.size
}

function hasResolvableDoubleStepsFollowUpSelection(snapshot: GameState, player: PlayerId, params: OrderParams): boolean {
  const firstUnitId = resolveSnapshotUnitId(snapshot, params.unitId ?? '', player)
  const firstTile = params.tile
  if (!firstUnitId || !firstTile) return false
  return Object.values(snapshot.units).some((unit) => {
    if (unit.owner !== player || unit.id === firstUnitId || !canCardSelectUnit('move_double_steps', unit)) {
      return false
    }
    return DIRECTIONS.some((_, index) => {
      const candidate = neighbor(unit.pos, index as Direction)
      if (!isTile(candidate)) return false
      return canResolveSnapshotSimultaneousMoves(snapshot, [
        { unitId: firstUnitId, target: firstTile },
        { unitId: unit.id, target: candidate },
      ])
    })
  })
}

function unitHasResolvableDoubleStepsTarget(
  snapshot: GameState,
  player: PlayerId,
  params: OrderParams,
  secondUnitId: string
): boolean {
  const firstUnitId = resolveSnapshotUnitId(snapshot, params.unitId ?? '', player)
  const firstTile = params.tile
  if (!firstUnitId || !firstTile) return false
  return DIRECTIONS.some((_, index) => {
    const candidate = neighbor(snapshot.units[secondUnitId].pos, index as Direction)
    if (!isTile(candidate)) return false
    return canResolveSnapshotSimultaneousMoves(snapshot, [
      { unitId: firstUnitId, target: firstTile },
      { unitId: secondUnitId, target: candidate },
    ])
  })
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

function hexDistance(a: Hex, b: Hex): number {
  const aAxial = offsetToAxial(a)
  const bAxial = offsetToAxial(b)
  const dq = aAxial.q - bAxial.q
  const dr = aAxial.r - bAxial.r
  const ds = -aAxial.q - aAxial.r - (-bAxial.q - bAxial.r)
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2
}

function getTeleportSelectionTargets(
  snapshot: GameState,
  params: OrderParams,
  player: PlayerId,
  maxDistance = 3
): Hex[] {
  const unitSnapshot = getUnitSnapshot(snapshot, params.unitId ?? '', player)
  if (!unitSnapshot) return []
  const rawUnit = params.unitId ? snapshot.units[params.unitId] : null
  const hasSlow = rawUnit
    ? snapshotHasModifier(rawUnit, 'slow') || snapshotHasModifier(rawUnit, 'chilled')
    : false
  const effectiveMaxDistance = hasSlow ? Math.min(1, maxDistance) : maxDistance
  return snapshot.tiles
    .map((tile) => ({ q: tile.q, r: tile.r }))
    .filter((tile) => {
      if (tile.q === unitSnapshot.pos.q && tile.r === unitSnapshot.pos.r) return false
      if (hexDistance(unitSnapshot.pos, tile) > effectiveMaxDistance) return false
      return true
    })
}

function getAdjacentTileSelectionTargets(
  snapshot: GameState,
  unitId: string,
  player: PlayerId,
  allowOccupied: boolean
): Hex[] {
  const unitSnapshot = getUnitSnapshot(snapshot, unitId, player)
  if (!unitSnapshot) return []
  return DIRECTIONS.map((_, index) => neighbor(unitSnapshot.pos, index as Direction))
    .filter((hex) => isTile(hex))
    .filter((hex) => {
      if (allowOccupied) return true
      return !Object.values(snapshot.units).some((unit) => unit.pos.q === hex.q && unit.pos.r === hex.r)
    })
}

function getTilesWithinRadius(snapshot: GameState, origin: Hex, radius: number): Hex[] {
  return snapshot.tiles
    .map((tile) => ({ q: tile.q, r: tile.r }))
    .filter((tile) => hexDistance(origin, tile) <= radius)
}

function getCustomTileSelectionTargets(
  snapshot: GameState,
  defId: CardDefId,
  params: OrderParams,
  player: PlayerId,
  step: TileSelectionParam
): Hex[] | null {
  if (defId === 'attack_joint_attack' && step === 'tile') {
    return getAdjacentTileSelectionTargets(snapshot, params.unitId ?? '', player, true)
  }
  if (defId === 'move_double_steps' && step === 'tile') {
    const firstUnitId = resolveSnapshotUnitId(snapshot, params.unitId ?? '', player)
    if (!firstUnitId) return []
    const firstUnit = snapshot.units[firstUnitId]
    if (!firstUnit) return []
    return DIRECTIONS.map((_, index) => neighbor(firstUnit.pos, index as Direction))
      .filter((hex) => isTile(hex))
      .filter((hex) => {
        const occupant = Object.values(snapshot.units).find((unit) => unit.pos.q === hex.q && unit.pos.r === hex.r)
        if (!occupant) return true
        if (occupant.owner !== player || !canCardSelectUnit(defId, occupant) || occupant.id === firstUnitId) {
          return false
        }
        return hasResolvableDoubleStepsFollowUpSelection(snapshot, player, {
          ...params,
          tile: { ...hex },
        })
      })
  }
  if (defId === 'move_double_steps' && step === 'tile2') {
    const secondUnitId = resolveSnapshotUnitId(snapshot, params.unitId2 ?? '', player)
    const firstUnitId = resolveSnapshotUnitId(snapshot, params.unitId ?? '', player)
    if (!secondUnitId || !firstUnitId || !params.tile) return []
    const secondUnit = snapshot.units[secondUnitId]
    if (!secondUnit) return []
    return DIRECTIONS.map((_, index) => neighbor(secondUnit.pos, index as Direction))
      .filter((hex) => isTile(hex))
      .filter((hex) =>
        canResolveSnapshotSimultaneousMoves(snapshot, [
          { unitId: firstUnitId, target: params.tile! },
          { unitId: secondUnitId, target: hex },
        ])
      )
  }
  if (defId === 'attack_volley' && step === 'tile') {
    const unitSnapshot = getUnitSnapshot(snapshot, params.unitId ?? '', player)
    if (!unitSnapshot) return []
    const volleyEffect = CARD_DEFS[defId].effects.find((effect) => effect.type === 'volley')
    return getTilesWithinRadius(snapshot, unitSnapshot.pos, volleyEffect?.radius ?? 2)
  }
  return null
}

type TileSelectionParam = 'tile' | 'tile2' | 'tile3'

type ChainedTileMoveConfig = {
  directionParam: 'direction' | 'moveDirection' | 'faceDirection'
  maxDistance: number
  baseParam?: TileSelectionParam
}

function getChainedTileMoveConfig(defId: CardDefId, step: TileSelectionParam): ChainedTileMoveConfig | null {
  if (defId === 'move_forward_face') {
    return step === 'tile' ? { directionParam: 'moveDirection', maxDistance: 1 } : null
  }
  if (defId === 'attack_blade_dance') {
    if (step === 'tile') return { directionParam: 'direction', maxDistance: 1 }
    if (step === 'tile2') return { directionParam: 'moveDirection', maxDistance: 1, baseParam: 'tile' }
    if (step === 'tile3') return { directionParam: 'faceDirection', maxDistance: 1, baseParam: 'tile2' }
  }
  return null
}

function getChainedTileMoveBase(
  snapshot: GameState,
  params: OrderParams,
  player: PlayerId,
  config: ChainedTileMoveConfig
): Hex | null {
  if (config.baseParam) {
    const base = getOrderTileParam(params, config.baseParam)
    return base ? { ...base } : null
  }
  const unitSnapshot = getUnitSnapshot(snapshot, params.unitId ?? '', player)
  return unitSnapshot ? { ...unitSnapshot.pos } : null
}

function resolveDirectionAndDistance(base: Hex, target: Hex, maxDistance: number): { direction: Direction; distance: number } | null {
  for (let direction = 0 as Direction; direction < 6; direction += 1) {
    for (let distance = 1; distance <= maxDistance; distance += 1) {
      const candidate = stepInDirection(base, direction, distance)
      if (!isTile(candidate)) break
      if (candidate.q === target.q && candidate.r === target.r) {
        return { direction, distance }
      }
    }
  }
  return null
}

function getModifierStackCount(
  unit: Pick<Unit, 'modifiers'>,
  type: Unit['modifiers'][number]['type']
): number {
  return unit.modifiers.reduce((sum, modifier) => sum + (modifier.type === type ? 1 : 0), 0)
}

function buildBladeDanceSelectionSnapshot(
  snapshot: GameState,
  params: OrderParams,
  player: PlayerId,
  step: TileSelectionParam
): { base: Hex | null; occupied: Set<string> } {
  const actingUnitId = resolveSnapshotUnitId(snapshot, params.unitId ?? '', player)
  if (!actingUnitId) return { base: null, occupied: new Set() }

  const units = new Map<string, Unit>(
    Object.values(snapshot.units).map((unit) => [
      unit.id,
      {
        ...unit,
        pos: { ...unit.pos },
        modifiers: unit.modifiers.map((modifier) => ({ ...modifier })),
      },
    ])
  )
  const actingUnit = units.get(actingUnitId)
  if (!actingUnit) return { base: null, occupied: new Set() }

  const applyAdjacentBladeDanceDamage = (): void => {
    const dealtDelta = getModifierStackCount(actingUnit, 'strong') - getModifierStackCount(actingUnit, 'disarmed')
    for (let direction = 0 as Direction; direction < 6; direction += 1) {
      const targetHex = neighbor(actingUnit.pos, direction)
      const target = [...units.values()].find((unit) => unit.pos.q === targetHex.q && unit.pos.r === targetHex.r)
      if (!target || !canCardTargetUnit('attack_blade_dance', target)) continue
      const damage = Math.max(0, 1 + dealtDelta + getModifierStackCount(target, 'vulnerable'))
      if (damage <= 0) continue
      target.strength -= damage
      if (target.strength <= 0) {
        units.delete(target.id)
      }
    }
  }

  const applyBladeDanceMoveStage = (direction: Direction | undefined): void => {
    if (direction === undefined) return
    const targetHex = neighbor(actingUnit.pos, direction)
    if (!isTile(targetHex)) return
    const blocked = [...units.values()].some(
      (unit) => unit.id !== actingUnit.id && unit.pos.q === targetHex.q && unit.pos.r === targetHex.r
    )
    if (blocked) return
    actingUnit.pos = { ...targetHex }
    applyAdjacentBladeDanceDamage()
  }

  if (step === 'tile2' || step === 'tile3') {
    applyBladeDanceMoveStage(params.direction)
  }
  if (step === 'tile3') {
    applyBladeDanceMoveStage(params.moveDirection)
  }

  const occupied = new Set<string>(
    [...units.values()].map((unit) => `${unit.pos.q},${unit.pos.r}`)
  )
  return { base: { ...actingUnit.pos }, occupied }
}

function getMoveToTileSelectionTargets(
  snapshot: GameState,
  defId: CardDefId,
  params: OrderParams,
  player: PlayerId,
  step: TileSelectionParam
): Hex[] | null {
  const config = getChainedTileMoveConfig(defId, step)
  if (!config) return null
  const bladeDanceSnapshot =
    defId === 'attack_blade_dance' ? buildBladeDanceSelectionSnapshot(snapshot, params, player, step) : null
  const base = bladeDanceSnapshot?.base ?? getChainedTileMoveBase(snapshot, params, player, config)
  if (!base) return []
  const targets: Hex[] = []
  for (let direction = 0 as Direction; direction < 6; direction += 1) {
    for (let distance = 1; distance <= config.maxDistance; distance += 1) {
      const tile = stepInDirection(base, direction, distance)
      if (!isTile(tile)) break
      targets.push(tile)
    }
  }
  return dedupeHexes(targets)
}

function applyChainedTileMoveSelection(
  snapshot: GameState,
  defId: CardDefId,
  params: OrderParams,
  player: PlayerId,
  step: TileSelectionParam,
  selected: Hex
): boolean {
  const config = getChainedTileMoveConfig(defId, step)
  if (!config) return false
  const base = getChainedTileMoveBase(snapshot, params, player, config)
  if (!base) return false
  const resolved = resolveDirectionAndDistance(base, selected, config.maxDistance)
  if (!resolved) return false

  if (step === 'tile') {
    params.tile = selected
  } else if (step === 'tile2') {
    params.tile2 = selected
  } else {
    params.tile3 = selected
  }

  if (config.directionParam === 'direction') {
    params.direction = resolved.direction
  } else if (config.directionParam === 'moveDirection') {
    params.moveDirection = resolved.direction
  } else {
    params.faceDirection = resolved.direction
  }

  return true
}

function clearLaterChainedTileMoveSelections(defId: CardDefId, params: OrderParams, step: TileSelectionParam): void {
  if (defId !== 'attack_blade_dance') return
  if (step === 'tile') {
    delete params.tile2
    delete params.tile3
    delete params.moveDirection
    delete params.faceDirection
    return
  }
  if (step === 'tile2') {
    delete params.tile3
    delete params.faceDirection
  }
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
    const units = Object.values(snapshot.units).filter((unit) => canCardSelectUnit(defId, unit))
    if (requirement === 'any') {
      const currentUnits = Object.values(state.units).filter((unit) => canCardSelectUnit(defId, unit))
      return dedupeHexes([
        ...units.map((unit) => ({ ...unit.pos })),
        ...currentUnits.map((unit) => ({ ...unit.pos })),
      ])
    }
    if (requirement === 'enemy') {
      const enemies = units.filter((unit) => unit.owner !== player)
      const currentEnemies = Object.values(state.units).filter(
        (unit) => unit.owner !== player && canCardSelectUnit(defId, unit)
      )
      return dedupeHexes([
        ...enemies.map((unit) => ({ ...unit.pos })),
        ...currentEnemies.map((unit) => ({ ...unit.pos })),
      ])
    }
    const friendlyUnits = units.filter((unit) => unit.owner === player)
    const unitHexes = friendlyUnits.map((unit) => ({ ...unit.pos }))
    const planned = getPlannedSpawnTiles(player)
    return [...unitHexes, ...planned]
  }

  if (step === 'unit2') {
    if (defId === 'move_double_steps') {
      const selected = params.unitId ? getUnitSnapshot(snapshot, params.unitId, player) : null
      return Object.values(snapshot.units)
        .filter(
          (unit) =>
            unit.owner === player &&
            canCardSelectUnit(defId, unit) &&
            (!selected || unit.pos.q !== selected.pos.q || unit.pos.r !== selected.pos.r) &&
            unitHasResolvableDoubleStepsTarget(snapshot, player, params, unit.id)
        )
        .map((unit) => ({ ...unit.pos }))
    }
    const requirement = CARD_DEFS[defId].requires.unit2 ?? 'friendly'
    const units = Object.values(snapshot.units).filter(
      (unit) =>
        (requirement === 'friendly'
          ? unit.owner === player
          : requirement === 'enemy'
            ? unit.owner !== player
            : true) && canCardSelectUnit(defId, unit)
    )
    const currentUnits = Object.values(state.units).filter(
      (unit) =>
        (requirement === 'friendly'
          ? unit.owner === player
          : requirement === 'enemy'
            ? unit.owner !== player
            : true) && canCardSelectUnit(defId, unit)
    )
    const selected = params.unitId ? getUnitSnapshot(snapshot, params.unitId, player) : null
    const unitHexes = dedupeHexes([
      ...units.map((unit) => ({ ...unit.pos })),
      ...currentUnits.map((unit) => ({ ...unit.pos })),
      ...(requirement === 'friendly' ? getPlannedSpawnTiles(player) : []),
    ])
    if (!selected) return unitHexes
    return unitHexes.filter((hex) => hex.q !== selected.pos.q || hex.r !== selected.pos.r)
  }

  if (step === 'tile') {
    const customTargets = getCustomTileSelectionTargets(snapshot, defId, params, player, 'tile')
    if (customTargets) return customTargets
    const chainedMoveTargets = getMoveToTileSelectionTargets(snapshot, defId, params, player, 'tile')
    if (chainedMoveTargets) return chainedMoveTargets
    if (CARD_DEFS[defId].requires.tile === 'any') {
      if (defId === 'move_teleport') {
        return getTeleportSelectionTargets(snapshot, params, player, 3)
      }
      return snapshot.tiles.map((tile) => ({ q: tile.q, r: tile.r }))
    }
    if (CARD_DEFS[defId].requires.tile === 'barricade') {
      return getBarricadeSpawnTiles(snapshot, player)
    }
    return getSpawnTiles(snapshot, player)
  }

  if (step === 'tile2') {
    const customTargets = getCustomTileSelectionTargets(snapshot, defId, params, player, 'tile2')
    if (customTargets) return customTargets
    const chainedMoveTargets = getMoveToTileSelectionTargets(snapshot, defId, params, player, 'tile2')
    if (chainedMoveTargets) return chainedMoveTargets
    if (CARD_DEFS[defId].requires.tile2 === 'barricade') {
      const blocked = params.tile
      return getBarricadeSpawnTiles(snapshot, player).filter((hex) =>
        blocked ? hex.q !== blocked.q || hex.r !== blocked.r : true
      )
    }
    if (CARD_DEFS[defId].requires.tile2 === 'any') {
      return snapshot.tiles.map((tile) => ({ q: tile.q, r: tile.r }))
    }
    return []
  }

  if (step === 'tile3') {
    const chainedMoveTargets = getMoveToTileSelectionTargets(snapshot, defId, params, player, 'tile3')
    if (chainedMoveTargets) return chainedMoveTargets
    if (CARD_DEFS[defId].requires.tile3 === 'any') {
      return snapshot.tiles.map((tile) => ({ q: tile.q, r: tile.r }))
    }
    return []
  }

  if (step === 'direction' || step === 'moveDirection' || step === 'faceDirection') {
    const base = getDirectionBase(snapshot, defId, params, player, step)
    if (!base) return []
    return DIRECTIONS.map((_, index) => neighbor(base, index as Direction)).filter((hex) => isTile(hex))
  }

  if (step === 'distance') {
    const targets = getDistanceSelectionTargets(snapshot, defId, params, player)
    return dedupeHexes(targets.map((target) => target.tile))
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
  if (defId === 'reinforce_battlefield_recruitment' && params.tile) return params.tile
  const unitSnapshot = getUnitSnapshot(snapshot, params.unitId ?? '', player)
  if (!unitSnapshot) return null

  const directionParam = step === 'faceDirection' ? 'faceDirection' : step === 'moveDirection' ? 'moveDirection' : 'direction'
  const faceIndex = CARD_DEFS[defId].effects.findIndex(
    (effect) =>
      effect.type === 'face' &&
      effect.unitParam === 'unitId' &&
      effect.directionParam === directionParam
  )
  if (faceIndex !== -1) {
    let currentPos = { ...unitSnapshot.pos }
    let currentFacing = unitSnapshot.facing
    for (let i = 0; i < faceIndex; i += 1) {
      const effect = CARD_DEFS[defId].effects[i]
      if (effect.type === 'move' && effect.unitParam === 'unitId') {
        const resolvedDirection =
          effect.direction === 'facing'
            ? currentFacing
            : effect.direction.type === 'param'
              ? effect.direction.key === 'moveDirection'
                ? params.moveDirection
                : effect.direction.key === 'faceDirection'
                  ? params.faceDirection
                  : params.direction
              : undefined
        const resolvedDistance = typeof effect.distance === 'number' ? effect.distance : params.distance
        if (resolvedDirection !== undefined && resolvedDistance) {
          currentPos = stepInDirection(currentPos, resolvedDirection, resolvedDistance)
        }
        continue
      }
      if (effect.type === 'teleport' && effect.unitParam === 'unitId') {
        const tile = getOrderTileParam(params, effect.tileParam)
        if (tile) {
          currentPos = tile
        }
        continue
      }
      if (effect.type === 'face' && effect.unitParam === 'unitId') {
        const nextFacing = effect.directionParam === 'faceDirection' ? params.faceDirection : params.direction
        if (nextFacing !== undefined) {
          currentFacing = nextFacing
        }
      }
    }
    return currentPos
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

function resolveSnapshotUnitId(snapshot: GameState, unitId: string, player: PlayerId): string | null {
  if (!unitId) return null
  const normalizedUnitId = normalizeLeaderUnitReference(unitId)
  if (normalizedUnitId.startsWith('planned:')) {
    const orderRef = normalizedUnitId.replace('planned:', '')
    const resolved = snapshot.spawnedByOrder[orderRef]
    if (resolved && snapshot.units[resolved]) return resolved
    const separator = orderRef.indexOf(':')
    const orderId = separator === -1 ? orderRef : orderRef.slice(0, separator)
    const spawnKey = separator === -1 ? null : orderRef.slice(separator + 1)
    const baseResolved = snapshot.spawnedByOrder[orderId]
    if (baseResolved && snapshot.units[baseResolved]) return baseResolved
    const planned = state.players[player].orders.find((order) => order.id === orderId)
    if (!planned) return null
    for (const effect of CARD_DEFS[planned.defId].effects) {
      if (effect.type !== 'spawn' && effect.type !== 'spawnAdjacentFriendly') continue
      if (!effect.mapToOrder) continue
      if (spawnKey && effect.tileParam !== spawnKey) continue
      const tile = getOrderTileParam(planned.params, effect.tileParam)
      if (!tile) continue
      return Object.values(snapshot.units).find((unit) => unit.pos.q === tile.q && unit.pos.r === tile.r)?.id ?? null
    }
    return null
  }
  return snapshot.units[normalizedUnitId] ? normalizedUnitId : null
}

function getUnitSnapshot(
  snapshot: GameState,
  unitId: string,
  player: PlayerId
): { pos: Hex; facing: Direction } | null {
  const resolvedUnitId = resolveSnapshotUnitId(snapshot, unitId, player)
  if (!resolvedUnitId) return null
  const unit = snapshot.units[resolvedUnitId]
  if (!unit) return null
  return { pos: unit.pos, facing: unit.facing }
}

function getPlannedSpawnTiles(player: PlayerId): Hex[] {
  const plannedTiles: Hex[] = []
  state.players[player].orders.forEach((order) => {
    CARD_DEFS[order.defId].effects.forEach((effect) => {
      if (effect.type === 'spawn' && effect.mapToOrder) {
        const tile = getOrderTileParam(order.params, effect.tileParam)
        if (tile) plannedTiles.push({ ...tile })
      }
      if (effect.type === 'spawnAdjacentFriendly' && effect.mapToOrder) {
        const tile = getOrderTileParam(order.params, effect.tileParam)
        if (tile) plannedTiles.push({ ...tile })
      }
    })
  })
  return dedupeHexes(plannedTiles)
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

function pickHexFromClient(clientX: number, clientY: number): Hex | null {
  const { x, y } = screenToWorld(clientX, clientY)

  const yUnscaled = (y - layout.origin.y) / BOARD_TILT
  const r = Math.round(yUnscaled / (1.5 * layout.size))
  const q = Math.round((x - layout.origin.x) / (Math.sqrt(3) * layout.size) + 0.5 * (r & 1))
  const rounded = { q, r }
  if (!isTile(rounded)) return null
  return rounded
}

function pickHexFromEvent(event: MouseEvent): Hex | null {
  return pickHexFromClient(event.clientX, event.clientY)
}

function resolveSelectableUnitId(
  selectionState: GameState,
  defId: CardDefId,
  hex: Hex,
  player: PlayerId,
  requirement: 'friendly' | 'enemy' | 'any'
): string | null {
  if (requirement === 'any') {
    const unit = Object.values(selectionState.units).find(
      (item) => item.pos.q === hex.q && item.pos.r === hex.r && canCardSelectUnit(defId, item)
    )
    if (unit) return unit.id
    const currentUnit = Object.values(state.units).find(
      (item) => item.pos.q === hex.q && item.pos.r === hex.r && canCardSelectUnit(defId, item)
    )
    return currentUnit ? currentUnit.id : null
  }

  if (requirement === 'enemy') {
    const unit = Object.values(selectionState.units).find(
      (item) =>
        item.pos.q === hex.q &&
        item.pos.r === hex.r &&
        item.owner !== player &&
        canCardSelectUnit(defId, item)
    )
    if (unit) return unit.id
    const currentUnit = Object.values(state.units).find(
      (item) =>
        item.pos.q === hex.q &&
        item.pos.r === hex.r &&
        item.owner !== player &&
        canCardSelectUnit(defId, item)
    )
    return currentUnit ? currentUnit.id : null
  }

  const unit = Object.values(selectionState.units).find(
    (item) =>
      item.pos.q === hex.q &&
      item.pos.r === hex.r &&
      item.owner === player &&
      canCardSelectUnit(defId, item)
  )
  if (unit) {
    if (state.units[unit.id]) {
      return unit.id
    }
    const plannedOrderId = findPlannedOrderId(selectionState, unit.id)
    return plannedOrderId ? `planned:${plannedOrderId}` : null
  }

  for (const order of state.players[player].orders) {
    for (const effect of CARD_DEFS[order.defId].effects) {
      if (effect.type !== 'spawn' && effect.type !== 'spawnAdjacentFriendly') continue
      if (!effect.mapToOrder) continue
      const tile = getOrderTileParam(order.params, effect.tileParam)
      if (!tile) continue
      if (tile.q !== hex.q || tile.r !== hex.r) continue
      return `planned:${order.id}:${effect.tileParam}`
    }
  }
  return null
}

function handleBoardClick(hex: Hex): void {
  if (mode === 'online' && onlineSession && (onlineSession.presence.paused || !onlineSession.connected)) {
    statusEl.textContent = 'Waiting for connection...'
    return
  }
  if (isBotPlanningLocked()) return
  if (!guardTutorialAction('board_select', { hex })) return
  if (!pendingOrder || state.phase !== 'planning') return
  const activeOrder = pendingOrder
  const defId = getCardDefId(activeOrder.cardId)
  if (!defId) return
  const nextStep = getNextRequirement(defId, activeOrder.params)
  if (!nextStep) return
  const selectionState = simulatePlannedState(state, planningPlayer)
  let tutorialSelectionSucceeded = false

  if (nextStep === 'unit') {
    const requirement = CARD_DEFS[defId].requires.unit ?? 'friendly'
    const selectionId = resolveSelectableUnitId(selectionState, defId, hex, planningPlayer, requirement)
    if (selectionId) {
      activeOrder.params.unitId = selectionId
      statusEl.textContent =
        selectionId.startsWith('planned:') ? 'Planned spawn selected.' : 'Unit selected.'
      tutorialSelectionSucceeded = true
    } else {
      statusEl.textContent =
        requirement === 'enemy'
          ? 'Select an enemy unit.'
          : requirement === 'any'
            ? 'Select a unit.'
            : 'Select a valid unit or planned spawn.'
    }
  }

  if (nextStep === 'unit2') {
    const requirement = CARD_DEFS[defId].requires.unit2 ?? 'friendly'
    const selectionId = resolveSelectableUnitId(selectionState, defId, hex, planningPlayer, requirement)
    if (!selectionId) {
      statusEl.textContent =
        requirement === 'enemy'
          ? 'Select a different enemy unit.'
          : requirement === 'any'
            ? 'Select a different unit.'
            : 'Select a different unit or planned spawn.'
    } else if (selectionId === activeOrder.params.unitId) {
      statusEl.textContent = 'Select a different unit.'
    } else {
      activeOrder.params.unitId2 = selectionId
      statusEl.textContent =
        selectionId.startsWith('planned:') ? 'Second planned spawn selected.' : 'Second unit selected.'
      tutorialSelectionSucceeded = true
    }
  }

  if (nextStep === 'tile') {
    const customTargets = getCustomTileSelectionTargets(selectionState, defId, activeOrder.params, planningPlayer, 'tile')
    if (customTargets) {
      if (customTargets.some((tile) => tile.q === hex.q && tile.r === hex.r)) {
        activeOrder.params.tile = hex
        statusEl.textContent = 'Tile selected.'
        tutorialSelectionSucceeded = true
      } else {
        statusEl.textContent = 'Select a highlighted tile.'
      }
    } else {
      const chainedMoveTargets = getMoveToTileSelectionTargets(selectionState, defId, activeOrder.params, planningPlayer, 'tile')
      if (chainedMoveTargets) {
        if (
          chainedMoveTargets.some((tile) => tile.q === hex.q && tile.r === hex.r) &&
          applyChainedTileMoveSelection(selectionState, defId, activeOrder.params, planningPlayer, 'tile', hex)
        ) {
          clearLaterChainedTileMoveSelections(defId, activeOrder.params, 'tile')
          statusEl.textContent = 'Move target selected.'
          tutorialSelectionSucceeded = true
        } else {
          statusEl.textContent = 'Select a highlighted move target.'
        }
      } else {
        const tileRequirement = CARD_DEFS[defId].requires.tile
        if (tileRequirement === 'any') {
          const validTiles =
            defId === 'move_teleport'
              ? getTeleportSelectionTargets(selectionState, activeOrder.params, planningPlayer, 3)
              : selectionState.tiles.map((tile) => ({ q: tile.q, r: tile.r }))
          if (validTiles.some((tile) => tile.q === hex.q && tile.r === hex.r)) {
            activeOrder.params.tile = hex
            statusEl.textContent = defId === 'move_teleport' ? 'Teleport destination selected.' : 'Tile selected.'
            tutorialSelectionSucceeded = true
          } else {
            statusEl.textContent = defId === 'move_teleport' ? 'Select a valid teleport destination.' : 'Select a tile.'
          }
        } else {
          const validTiles =
            tileRequirement === 'barricade'
              ? getBarricadeSpawnTiles(selectionState, planningPlayer)
              : getSpawnTiles(selectionState, planningPlayer)
          if (validTiles.some((tile) => tile.q === hex.q && tile.r === hex.r)) {
            activeOrder.params.tile = hex
            statusEl.textContent = tileRequirement === 'barricade' ? 'Barricade tile selected.' : 'Spawn tile selected.'
            tutorialSelectionSucceeded = true
          } else {
            statusEl.textContent =
              tileRequirement === 'barricade' ? 'Select a valid barricade tile.' : 'Select a spawn tile.'
          }
        }
      }
    }
  }

  if (nextStep === 'tile2') {
    const customTargets = getCustomTileSelectionTargets(selectionState, defId, activeOrder.params, planningPlayer, 'tile2')
    if (customTargets) {
      if (customTargets.some((tile) => tile.q === hex.q && tile.r === hex.r)) {
        activeOrder.params.tile2 = hex
        statusEl.textContent = 'Second tile selected.'
        tutorialSelectionSucceeded = true
      } else {
        statusEl.textContent = 'Select a highlighted second tile.'
      }
    } else {
      const chainedMoveTargets = getMoveToTileSelectionTargets(selectionState, defId, activeOrder.params, planningPlayer, 'tile2')
      if (chainedMoveTargets) {
        if (
          chainedMoveTargets.some((tile) => tile.q === hex.q && tile.r === hex.r) &&
          applyChainedTileMoveSelection(selectionState, defId, activeOrder.params, planningPlayer, 'tile2', hex)
        ) {
          clearLaterChainedTileMoveSelections(defId, activeOrder.params, 'tile2')
          statusEl.textContent = 'Second move target selected.'
          tutorialSelectionSucceeded = true
        } else {
          statusEl.textContent = 'Select a highlighted second move target.'
        }
      } else if (CARD_DEFS[defId].requires.tile2 === 'barricade') {
        const validTiles = getBarricadeSpawnTiles(selectionState, planningPlayer)
        if (!validTiles.some((tile) => tile.q === hex.q && tile.r === hex.r)) {
          statusEl.textContent = 'Select a valid second barricade tile.'
        } else if (activeOrder.params.tile && activeOrder.params.tile.q === hex.q && activeOrder.params.tile.r === hex.r) {
          statusEl.textContent = 'Second tile must be different.'
        } else {
          activeOrder.params.tile2 = hex
          statusEl.textContent = 'Second barricade tile selected.'
          tutorialSelectionSucceeded = true
        }
      } else if (CARD_DEFS[defId].requires.tile2 === 'any') {
        const validTiles = selectionState.tiles.map((tile) => ({ q: tile.q, r: tile.r }))
        if (validTiles.some((tile) => tile.q === hex.q && tile.r === hex.r)) {
          activeOrder.params.tile2 = hex
          statusEl.textContent = 'Second tile selected.'
          tutorialSelectionSucceeded = true
        } else {
          statusEl.textContent = 'Select a valid second tile.'
        }
      }
    }
  }

  if (nextStep === 'tile3') {
    const chainedMoveTargets = getMoveToTileSelectionTargets(selectionState, defId, activeOrder.params, planningPlayer, 'tile3')
    if (chainedMoveTargets) {
      if (
        chainedMoveTargets.some((tile) => tile.q === hex.q && tile.r === hex.r) &&
        applyChainedTileMoveSelection(selectionState, defId, activeOrder.params, planningPlayer, 'tile3', hex)
      ) {
        statusEl.textContent = 'Third move target selected.'
        tutorialSelectionSucceeded = true
      } else {
        statusEl.textContent = 'Select a highlighted third move target.'
      }
    } else if (CARD_DEFS[defId].requires.tile3 === 'any') {
      const validTiles = selectionState.tiles.map((tile) => ({ q: tile.q, r: tile.r }))
      if (validTiles.some((tile) => tile.q === hex.q && tile.r === hex.r)) {
        activeOrder.params.tile3 = hex
        statusEl.textContent = 'Third tile selected.'
        tutorialSelectionSucceeded = true
      } else {
        statusEl.textContent = 'Select a valid third tile.'
      }
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
        tutorialSelectionSucceeded = true
      } else {
        statusEl.textContent = 'Click an adjacent tile for direction.'
      }
    }
  }

  if (nextStep === 'distance') {
    const unitSnapshot = getUnitSnapshot(selectionState, activeOrder.params.unitId ?? '', planningPlayer)
    if (!unitSnapshot) {
      statusEl.textContent = 'Select a unit first.'
    } else {
      const resolution = resolveDistanceClick(selectionState, defId, activeOrder.params, planningPlayer, hex)
      if (resolution.matched) {
        if (resolution.directionKey === 'direction' && resolution.direction !== undefined) {
          activeOrder.params.direction = resolution.direction
        }
        if (resolution.directionKey === 'moveDirection' && resolution.direction !== undefined) {
          activeOrder.params.moveDirection = resolution.direction
        }
        if (resolution.directionKey === 'faceDirection' && resolution.direction !== undefined) {
          activeOrder.params.faceDirection = resolution.direction
        }
        if (resolution.distance !== undefined) {
          activeOrder.params.distance = resolution.distance
        }
        tutorialSelectionSucceeded = true
      }
      statusEl.textContent = resolution.matched ? 'Distance selected.' : 'Click a highlighted tile.'
    }
  }

  if (tutorialSelectionSucceeded) {
    notifyTutorialEvent('board_tile_selected', { hex })
  }
  tryAutoAddOrder()
  render()
}
menuStartButton.addEventListener('click', () => {
  if (isTutorialLessonActive()) {
    setTutorialFeedback('Finish the current lesson or use Tutorial Hub.')
    return
  }
  if (mode === 'online') {
    teardownOnlineSession(true)
    setOnlineStatus('')
  }
  applyPlayMode('local')
  resetGameState('Select a card to start planning.')
  setScreen('game')
})

menuStartBotButton.addEventListener('click', () => {
  if (isTutorialLessonActive()) {
    setTutorialFeedback('Finish the current lesson or use Tutorial Hub.')
    return
  }
  if (mode === 'online') {
    teardownOnlineSession(true)
    setOnlineStatus('')
  }
  applyPlayMode('bot')
  const botClass = pickRandomPlayerClass()
  setLoadoutClass(BOT_PLAYER, botClass)
  loadouts.p2 = generateClusteredBotDeck(gameSettings, { classId: botClass })
  resetGameState('Select a card to start planning.')
  planningPlayer = BOT_HUMAN_PLAYER
  setScreen('game')
})

menuStartRoguelikeButton.addEventListener('click', () => {
  if (isTutorialLessonActive()) {
    setTutorialFeedback('Finish the current lesson or use Tutorial Hub.')
    return
  }
  if (mode === 'online') {
    teardownOnlineSession(true)
    setOnlineStatus('')
  }
  startRoguelikeRun()
})

menuTutorialButton.addEventListener('click', () => {
  if (mode === 'online') {
    teardownOnlineSession(true)
    setOnlineStatus('')
  }
  if (!isTutorialHubVisible() && !isTutorialLessonActive()) {
    persistTutorialReturnSnapshot()
  }
  tutorialController.clearSession()
  tutorialOnlineDemo = null
  applyPlayMode('tutorial')
  setScreen('tutorial_hub')
})

menuLoadoutButton.addEventListener('click', () => {
  if (isTutorialLessonActive()) {
    setTutorialFeedback('Finish the current lesson or use Tutorial Hub.')
    return
  }
  if (mode !== 'online') {
    loadoutPlayer = 0
  }
  setScreen('loadout')
})

menuSettingsButton.addEventListener('click', () => {
  if (isTutorialLessonActive()) {
    setTutorialFeedback('Finish the current lesson or use Tutorial Hub.')
    return
  }
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
  if (isTutorialLessonActive('play_online')) {
    if (!guardTutorialAction('online_create')) return
    if (tutorialOnlineDemo) {
      renderOnlineInviteLinks(0, tutorialOnlineDemo.inviteLinks)
      setOnlineStatus('Sample room created. In a real match, these links come from the server.')
    }
    notifyTutorialEvent('online_create_clicked')
    syncTutorialUi()
    return
  }
  beginOnlineCreate()
})

onlineJoinButton.addEventListener('click', () => {
  if (isTutorialLessonActive('play_online')) {
    if (!guardTutorialAction('online_join')) return
    setOnlineStatus('Sample join complete. In a real match, the room code and seat token would be validated by the server.')
    notifyTutorialEvent('online_join_clicked')
    syncTutorialUi()
    return
  }
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
  if (isTutorialLessonActive()) {
    leaveTutorialHubToMenu()
    return
  }
  if (mode === 'online') {
    teardownOnlineSession(true)
    applyPlayMode('local')
    setOnlineStatus('')
  } else if (mode === 'roguelike') {
    applyPlayMode('local')
  }
  selectedCardId = null
  pendingOrder = null
  setScreen('menu')
})

loadoutBackButton.addEventListener('click', () => {
  if (isTutorialLessonActive()) {
    returnToTutorialHub()
    return
  }
  setScreen('menu')
})

tutorialHubBackButton.addEventListener('click', () => {
  leaveTutorialHubToMenu()
})

tutorialPanelNextButton.addEventListener('click', () => {
  if (!guardTutorialAction('tutorial_next')) return
  notifyTutorialEvent('manual_next')
  syncTutorialUi()
})

gameTutorialHubButton.addEventListener('click', () => {
  returnToTutorialHub()
})

loadoutToggleButton.addEventListener('click', () => {
  if (isTutorialLessonActive()) {
    setTutorialFeedback('Stay on the current tutorial step.')
    return
  }
  if (mode === 'online') return
  loadoutPlayer = loadoutPlayer === 0 ? 1 : 0
  renderLoadout()
})

loadoutContinueButton.addEventListener('click', () => {
  if (isTutorialLessonActive()) {
    setTutorialFeedback('Return to the tutorial hub when you are done.')
    return
  }
  submitOnlineLoadoutAndContinue()
})

loadoutClearButton.addEventListener('click', () => {
  if (isTutorialLessonActive()) {
    setTutorialFeedback('Use the highlighted tutorial actions instead of clearing the deck.')
    return
  }
  if (loadoutPlayer === 0) {
    loadouts.p1 = []
  } else {
    loadouts.p2 = []
  }
  renderLoadout()
})

loadoutRandomButton.addEventListener('click', () => {
  if (isTutorialLessonActive()) {
    setTutorialFeedback('Use the highlighted tutorial actions instead of randomizing the deck.')
    return
  }
  const targetPlayer: PlayerId = mode === 'online' ? (onlineSession?.seat ?? 0) : loadoutPlayer
  const randomClass = pickRandomPlayerClass()
  setLoadoutClass(targetPlayer, randomClass)
  const randomizedDeck = generateClusteredBotDeck(gameSettings, { classId: randomClass })
  if (targetPlayer === 0) {
    loadouts.p1 = randomizedDeck
  } else {
    loadouts.p2 = randomizedDeck
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

loadoutClassSelect.addEventListener('change', () => {
  const nextClass = normalizePlayerClassInput(loadoutClassSelect.value, getLoadoutClass(loadoutPlayer))
  if (!guardTutorialAction('loadout_class_change', { classId: nextClass })) {
    renderLoadout()
    return
  }
  setLoadoutClass(loadoutPlayer, nextClass)
  const maxSize = getLoadoutDeckMaxSize()
  if (loadoutPlayer === 0) {
    loadouts.p1 = sanitizeDeckForCurrentClass(loadouts.p1, nextClass, true, maxSize)
  } else {
    loadouts.p2 = sanitizeDeckForCurrentClass(loadouts.p2, nextClass, true, maxSize)
  }
  notifyTutorialEvent('loadout_class_changed', { classId: nextClass })
  renderLoadout()
})

loadoutFilterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const nextFilter = (button.dataset.filter as 'all' | CardType) ?? 'all'
    if (!guardTutorialAction('loadout_filter_change', { filter: nextFilter })) return
    loadoutFilter = nextFilter
    notifyTutorialEvent('loadout_filter_changed', { filter: nextFilter })
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

settingLeaderStrength.addEventListener('change', () => {
  const value = clamp(Number(settingLeaderStrength.value), 1, 20)
  gameSettings = { ...gameSettings, leaderStrength: value }
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
  if (isTutorialLessonActive()) {
    setTutorialFeedback('Stay on the guided lesson flow.')
    return
  }
  if (mode !== 'local') return
  planningPlayer = planningPlayer === 0 ? 1 : 0
  selectedCardId = null
  pendingOrder = null
  render()
})

playerPortraitP1Button.addEventListener('click', (event) => {
  event.stopPropagation()
  togglePinnedPlayerStatus(0)
})

playerPortraitP2Button.addEventListener('click', (event) => {
  event.stopPropagation()
  togglePinnedPlayerStatus(1)
})

playerPortraitP1Button.addEventListener('pointerdown', (event) => {
  event.stopPropagation()
})

playerPortraitP2Button.addEventListener('pointerdown', (event) => {
  event.stopPropagation()
})

playerStatusPopoverEl.addEventListener('pointerdown', (event) => {
  event.stopPropagation()
})

document.addEventListener('pointerdown', (event) => {
  const target = event.target
  if (!(target instanceof Node)) return
  if (
    playerPortraitP1Button.contains(target) ||
    playerPortraitP2Button.contains(target) ||
    playerStatusPopoverEl.contains(target)
  ) {
    return
  }
  if (pinnedStatusPlayerId === null) return
  clearPlayerStatusPopoverState()
  renderPlayerPortraits()
})

readyButton.addEventListener('click', () => {
  if (!guardTutorialAction('ready', { turn: state.turn })) return
  if (mode === 'online') {
    if (state.phase !== 'planning') return
    if (state.ready[planningPlayer]) return
    sendOnlineCommand({ type: 'ready' })
    statusEl.textContent = 'Marking ready...'
    return
  }
  if (isBotPlanningLocked()) return
  if (isTutorialLessonActive('first_battle')) {
    if (state.phase !== 'planning' || state.ready[0]) return
    setPlayerReady(BOT_HUMAN_PLAYER, true)
    selectedCardId = null
    pendingOrder = null
    notifyTutorialEvent('ready_pressed', { turn: state.turn })
    if (state.turn === 1 && state.players[1].orders.length === 0) {
      const pivotCard = state.players[1].hand.find((card) => card.defId === 'move_pivot')
      if (pivotCard) {
        planOrder(state, 1, pivotCard.id, { unitId: 'leader-1', direction: 5 })
      }
    } else if (state.turn === 2 && state.players[1].orders.length === 0) {
      const boostCard = state.players[1].hand.find((card) => card.defId === 'reinforce_boost')
      if (boostCard) {
        planOrder(state, 1, boostCard.id, { unitId: 'u1-2' })
      }
    }
    setPlayerReady(BOT_PLAYER, true)
    const actionPhaseStarted = tryStartActionPhase()
    if (actionPhaseStarted) {
      notifyTutorialEvent('action_phase_started', { turn: state.turn })
    }
    render()
    return
  }
  if (isBotControlledMode()) {
    if (state.phase !== 'planning') return
    if (state.ready[BOT_HUMAN_PLAYER]) return
    planningPlayer = BOT_HUMAN_PLAYER
    setPlayerReady(BOT_HUMAN_PLAYER, true)
    selectedCardId = null
    pendingOrder = null
    statusEl.textContent = 'You are ready. Bot planning...'
    notifyTutorialEvent('ready_pressed', { turn: state.turn })
    notifyTutorialEvent('bot_planning_started', { turn: state.turn })
    scheduleBotPlanningTurn()
    render()
    return
  }
  if (state.phase !== 'planning') return
  if (state.ready[planningPlayer]) return
  const currentPlayer = planningPlayer
  const otherPlayer = currentPlayer === 0 ? 1 : 0
  setPlayerReady(currentPlayer, true)
  notifyTutorialEvent('ready_pressed', { turn: state.turn })
  if (!state.ready[otherPlayer]) {
    planningPlayer = otherPlayer
    selectedCardId = null
    pendingOrder = null
    statusEl.textContent = `Player ${currentPlayer + 1} is ready. Player ${otherPlayer + 1} planning.`
  }
  const actionPhaseStarted = tryStartActionPhase()
  if (actionPhaseStarted) {
    notifyTutorialEvent('action_phase_started', { turn: state.turn })
  }
  render()
})

resolveNextButton.addEventListener('click', () => {
  if (!guardTutorialAction('resolve_next')) return
  if (mode === 'online' && !isOnlineResolutionReplayActive()) return
  autoResolve = false
  resolveNextActionAnimated()
})

resolveAllButton.addEventListener('click', () => {
  if (!guardTutorialAction('resolve_all')) return
  if (mode === 'online' && !isOnlineResolutionReplayActive()) return
  autoResolve = true
  resolveNextActionAnimated()
})

resetGameButton.addEventListener('click', () => {
  if (isTutorialLessonActive()) {
    if (!guardTutorialAction('reset_game')) return
    returnToTutorialHub()
    return
  }
  if (mode === 'online') {
    statusEl.textContent = 'Reset is disabled in online mode.'
    return
  }
  resetGameState('Game reset.')
})

winnerMenuButton.addEventListener('click', () => {
  if (isTutorialLessonActive()) {
    if (!guardTutorialAction('winner_primary')) return
    returnToTutorialHub()
    return
  }
  if (mode === 'online') {
    teardownOnlineSession(true)
    applyPlayMode('local')
  } else if (mode === 'roguelike') {
    applyPlayMode('local')
  }
  setScreen('menu')
})

winnerResetButton.addEventListener('click', () => {
  if (isTutorialLessonActive()) {
    if (!guardTutorialAction('winner_secondary')) return
    returnToTutorialHub()
    return
  }
  if (mode === 'roguelike') {
    if (!roguelikeRun) return
    if (state.winner === BOT_HUMAN_PLAYER) return
    startRoguelikeRun()
    return
  }
  if (mode === 'online') {
    setScreen('loadout')
    statusEl.textContent = 'Adjust your deck. Return to the match and press Rematch when ready.'
    return
  }
  resetGameState('Game reset.')
})

winnerRematchButton.addEventListener('click', () => {
  if (isTutorialLessonActive()) {
    if (!guardTutorialAction('winner_secondary')) return
    returnToTutorialHub()
    return
  }
  if (mode === 'roguelike') {
    if (!roguelikeRun || state.winner !== BOT_HUMAN_PLAYER || roguelikeRun.uiStage !== 'reward_choice') return
    chooseRoguelikeRandomReward()
    return
  }
  if (mode !== 'online') return
  if (onlineRematchRequested) return
  requestOnlineRematch()
})

winnerExtraEl.addEventListener('click', (event) => {
  if (mode !== 'roguelike' || !roguelikeRun || state.winner !== BOT_HUMAN_PLAYER) return
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-roguelike-action]')
  if (!target) return
  const action = target.dataset.roguelikeAction
  if (action === 'continue-reward') {
    continueAfterRoguelikeRewardNotice()
    return
  }
  if (action === 'skip-reward' && (roguelikeRun.uiStage === 'reward_choice' || roguelikeRun.uiStage === 'remove_choice')) {
    startRoguelikeMatchAfterReward('Reward skipped.')
    return
  }
  if (action === 'remove-card' && roguelikeRun.uiStage === 'remove_choice') {
    const deckIndex = Number(target.dataset.deckIndex)
    if (!Number.isInteger(deckIndex) || deckIndex < 0 || deckIndex >= roguelikeRun.deck.length) return
    const [removed] = roguelikeRun.deck.splice(deckIndex, 1)
    if (!removed) return
    startRoguelikeMatchAfterReward(`Reward gained: removed ${CARD_DEFS[removed].name}.`)
    return
  }
  const cardId = target.dataset.cardId as CardDefId | undefined
  if (!cardId) return
  if (!(cardId in CARD_DEFS)) return

  if (action === 'draft' && roguelikeRun.uiStage === 'reward_choice') {
    if (!roguelikeRun.draftOptions.includes(cardId)) return
    if (!isCardAllowedForClass(cardId, roguelikeRun.playerClass)) return
    roguelikeRun.deck.push(cardId)
    startRoguelikeMatchAfterReward(`Reward gained: added ${CARD_DEFS[cardId].name}.`)
    return
  }
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
    lastInputWasTouch = true
    if (event.touches.length === 2) {
      touchTapCandidate = false
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
      touchTapCandidate = true
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
      touchTapCandidate = false
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
        touchTapCandidate = false
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
    touchTapCandidate = false
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
    const wasTap = !touchPanState.didMove && touchTapCandidate
    if (wasTap) {
      const touch = event.changedTouches[0]
      const hex = touch ? pickHexFromClient(touch.clientX, touch.clientY) : null
      if (hex) {
        const canInspectUnitBeforeTap = isUnitStatusInspectionEnabled()
        handleBoardClick(hex)
        if (canInspectUnitBeforeTap) {
          togglePinnedUnitStatusFromHex(hex)
        }
      }
    }
    ignoreClick = true
    touchPanState = null
    touchTapCandidate = false
  }
})

canvas.addEventListener('touchcancel', () => {
  pinchZoomState = null
  touchPanState = null
  touchTapCandidate = false
})

canvas.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return
  lastInputWasTouch = false
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
  updateUnitStatusHoverFromPointer(event.clientX, event.clientY)
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
  if (lastInputWasTouch) return
  const hex = pickHexFromEvent(event)
  if (!hex) return
  handleBoardClick(hex)
})

window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    persistProgressNow()
    return
  }
  void flushPendingTelemetryQueue()
})

window.addEventListener('pagehide', () => {
  persistProgressNow()
})

const restoredScreen = restoreProgressFromStorage()
setScreen(restoredScreen ?? 'menu')
registerServiceWorker()
refreshOnlineLobbyUi()
void flushPendingTelemetryQueue()

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

window.addEventListener('online', () => {
  void flushPendingTelemetryQueue()
})
