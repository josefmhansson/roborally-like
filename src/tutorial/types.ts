import type { CardDefId, GameState, GameSettings, Hex, PlayerClassId } from '../engine/types'
import type { PlayMode } from '../net/types'

export type TutorialLessonId =
  | 'first_battle'
  | 'build_deck'
  | 'play_online'

export type TutorialDomTargetId =
  | 'menu-tutorial'
  | 'menu-online-create'
  | 'menu-online-join'
  | 'menu-online-room'
  | 'menu-online-token'
  | 'menu-online-links'
  | 'loadout-class'
  | 'loadout-back'
  | 'loadout-filter-attack'
  | 'loadout-all'
  | 'loadout-selected'
  | 'planner-ap'
  | 'active-player'
  | 'hand'
  | 'orders'
  | 'ready'
  | 'resolve-next'
  | 'resolve-all'
  | 'winner'

export type TutorialActionId =
  | 'tutorial_next'
  | 'loadout_class_change'
  | 'loadout_filter_change'
  | 'loadout_card_add'
  | 'loadout_card_remove'
  | 'hand_card_select'
  | 'queue_remove'
  | 'queue_reorder'
  | 'board_select'
  | 'ready'
  | 'resolve_next'
  | 'resolve_all'
  | 'online_create'
  | 'online_join'
  | 'reset_game'
  | 'leave_match'
  | 'winner_primary'
  | 'winner_secondary'

export type TutorialEventId =
  | 'manual_next'
  | 'screen_changed'
  | 'loadout_class_changed'
  | 'loadout_filter_changed'
  | 'loadout_card_added'
  | 'loadout_card_removed'
  | 'card_selected'
  | 'board_tile_selected'
  | 'order_queued'
  | 'queue_removed'
  | 'queue_reordered'
  | 'ready_pressed'
  | 'action_phase_started'
  | 'turn_changed'
  | 'winner_shown'
  | 'bot_planning_started'
  | 'roguelike_reward_shown'
  | 'online_create_clicked'
  | 'online_join_clicked'

export type TutorialValue =
  | string
  | number
  | boolean
  | null
  | TutorialValue[]
  | { [key: string]: TutorialValue }

export type TutorialPayload = Record<string, TutorialValue>

export type TutorialHighlightTarget =
  | { type: 'dom'; targetId: TutorialDomTargetId }
  | { type: 'hand_card'; defId: CardDefId }
  | { type: 'loadout_card'; defId: CardDefId }
  | { type: 'selected_loadout_card'; defId: CardDefId }
  | { type: 'queue_card'; defId: CardDefId }
  | { type: 'board_tile'; hex: Hex }
  | { type: 'board_unit'; unitId: string }

export type TutorialActionRule = {
  action: TutorialActionId
  match?: TutorialPayload
  message: string
}

export type TutorialEventRule = {
  event: TutorialEventId
  match?: TutorialPayload
}

export type TutorialStep = {
  id: string
  instruction: string
  blockedMessage?: string
  allowedActions?: TutorialActionRule[]
  completeOn: TutorialEventRule[]
  highlights?: TutorialHighlightTarget[]
  panelPlacement?: 'auto' | 'right' | 'right_above'
}

export type TutorialLessonBehavior = 'local_match' | 'loadout' | 'online_demo'

export type TutorialLessonDef = {
  id: TutorialLessonId
  title: string
  summary: string
  estimateMinutes: number
  recommended?: boolean
  behavior: TutorialLessonBehavior
  startScreen: 'menu' | 'loadout' | 'game'
  steps: TutorialStep[]
}

export type TutorialProgress = {
  completedAt: Partial<Record<TutorialLessonId, number>>
}

export type TutorialSession = {
  lessonId: TutorialLessonId
  stepIndex: number
  startedAt: number
  completedAt: number | null
}

export type TutorialGuardResult =
  | { allowed: true }
  | { allowed: false; message: string }

export type TutorialScenarioBootstrap = {
  mode: PlayMode
  screen: 'menu' | 'loadout' | 'game'
  gameSettings?: GameSettings
  loadouts?: { p1: CardDefId[]; p2: CardDefId[] }
  playerClasses?: { p1: PlayerClassId; p2: PlayerClassId }
  state?: GameState
  planningPlayer?: 0 | 1
  statusMessage?: string
  roguelikeRun?: TutorialRoguelikeRunState | null
  onlineDemo?: TutorialOnlineDemoData
}

export type TutorialOnlineDemoData = {
  roomCode: string
  seatToken: string
  inviteLinks: {
    seat0: string
    seat1: string
  }
}

export type TutorialRoguelikeRunState = {
  wins: number
  leaderHp: number
  deck: CardDefId[]
  playerClass: PlayerClassId
  bonusDrawPerTurn: number
  bonusActionBudget: number
  bonusStartingUnits: number
  bonusStartingUnitStrength: number
  resultHandled: boolean
  uiStage: 'reward_choice' | 'reward_notice' | 'remove_choice' | 'run_over'
  draftOptions: CardDefId[]
  pendingRandomReward: 'leaderHp' | 'extraDraw' | 'extraAp' | 'extraStartingUnit' | 'unitStrength' | 'removeCard' | null
  rewardNoticeMessage: string | null
  currentEncounterId: 'slimes' | 'trolls' | 'wolf_pack' | null
  currentMatchNumber: number
}
