import type { TutorialLessonDef } from './types'

export const TUTORIAL_LESSONS: TutorialLessonDef[] = [
  {
    id: 'first_battle',
    title: 'First Battle',
    summary: 'Learn the core loop: select a card, target it, queue it, and resolve a turn.',
    estimateMinutes: 3,
    recommended: true,
    behavior: 'local_match',
    startScreen: 'game',
    steps: [
      {
        id: 'select-advance',
        instruction: 'Your goal is to defeat the enemy leader. Start by selecting Advance.',
        allowedActions: [
          {
            action: 'hand_card_select',
            match: { defId: 'move_forward' },
            message: 'Select Advance from your hand.',
          },
        ],
        completeOn: [{ event: 'card_selected', match: { defId: 'move_forward' } }],
        highlights: [{ type: 'hand_card', defId: 'move_forward' }],
      },
      {
        id: 'pick-unit',
        instruction: 'Select your front unit to move it.',
        allowedActions: [
          {
            action: 'board_select',
            match: { hex: { q: 2, r: 3 } },
            message: 'Select the highlighted unit.',
          },
        ],
        completeOn: [{ event: 'board_tile_selected', match: { hex: { q: 2, r: 3 } } }],
        highlights: [{ type: 'board_unit', unitId: 'u0-1' }],
      },
      {
        id: 'pick-destination',
        instruction: 'Pick the highlighted destination to move next to the enemy leader.',
        allowedActions: [
          {
            action: 'board_select',
            match: { hex: { q: 3, r: 1 } },
            message: 'Pick the highlighted destination tile.',
          },
        ],
        completeOn: [{ event: 'order_queued', match: { defId: 'move_forward' } }],
        highlights: [{ type: 'board_tile', hex: { q: 3, r: 1 } }],
      },
      {
        id: 'ready-turn-one',
        instruction: 'Press Ready. Both sides reveal their queued orders at the same time.',
        allowedActions: [
          {
            action: 'ready',
            message: 'Press Ready to reveal the turn.',
          },
        ],
        completeOn: [{ event: 'action_phase_started', match: { turn: 1 } }],
        highlights: [{ type: 'dom', targetId: 'ready' }],
      },
      {
        id: 'watch-resolution',
        instruction: 'Watch the turn resolve. The enemy pivots to face your unit, and you draw your attack for turn two.',
        blockedMessage: 'Let the current turn finish resolving.',
        completeOn: [{ event: 'turn_changed', match: { turn: 2 } }],
      },
      {
        id: 'select-jab',
        instruction: 'Select Jab. It deals 2 damage to the nearest unit in the chosen direction.',
        allowedActions: [
          {
            action: 'hand_card_select',
            match: { defId: 'attack_jab' },
            message: 'Select Jab from your hand.',
          },
        ],
        completeOn: [{ event: 'card_selected', match: { defId: 'attack_jab' } }],
        highlights: [{ type: 'hand_card', defId: 'attack_jab' }],
      },
      {
        id: 'select-attacker',
        instruction: 'Select the unit you advanced last turn.',
        allowedActions: [
          {
            action: 'board_select',
            match: { hex: { q: 3, r: 1 } },
            message: 'Select the highlighted unit.',
          },
        ],
        completeOn: [{ event: 'board_tile_selected', match: { hex: { q: 3, r: 1 } } }],
        highlights: [{ type: 'board_unit', unitId: 'u0-1' }],
      },
      {
        id: 'set-attack-direction',
        instruction: "Choose the enemy leader's direction to finish the attack.",
        allowedActions: [
          {
            action: 'board_select',
            match: { hex: { q: 2, r: 0 } },
            message: 'Click the enemy leader tile to set the attack direction.',
          },
        ],
        completeOn: [{ event: 'order_queued', match: { defId: 'attack_jab' } }],
        highlights: [{ type: 'board_tile', hex: { q: 2, r: 0 } }],
      },
      {
        id: 'ready-finish',
        instruction: 'Press Ready again to resolve the finishing blow.',
        allowedActions: [
          {
            action: 'ready',
            message: 'Press Ready to resolve the attack.',
          },
        ],
        completeOn: [{ event: 'winner_shown', match: { winner: 0 } }],
        highlights: [{ type: 'dom', targetId: 'ready' }],
      },
    ],
  },
  {
    id: 'build_deck',
    title: 'Build a Deck',
    summary: 'Learn class selection, filtering, adding cards, and trimming the deck back down.',
    estimateMinutes: 2,
    behavior: 'loadout',
    startScreen: 'loadout',
    steps: [
      {
        id: 'change-class',
        instruction: 'Start by changing your class to Warleader.',
        allowedActions: [
          {
            action: 'loadout_class_change',
            match: { classId: 'warleader' },
            message: 'Change the class selector to Warleader.',
          },
        ],
        completeOn: [{ event: 'loadout_class_changed', match: { classId: 'warleader' } }],
        highlights: [{ type: 'dom', targetId: 'loadout-class' }],
      },
      {
        id: 'filter-attacks',
        instruction: 'Use the Attack filter to narrow the card pool.',
        allowedActions: [
          {
            action: 'loadout_filter_change',
            match: { filter: 'attack' },
            message: 'Use the Attack filter.',
          },
        ],
        completeOn: [{ event: 'loadout_filter_changed', match: { filter: 'attack' } }],
        highlights: [{ type: 'dom', targetId: 'loadout-filter-attack' }],
      },
      {
        id: 'add-card',
        instruction: 'Add Whirlwind. Class cards appear once the class and filter make sense.',
        allowedActions: [
          {
            action: 'loadout_card_add',
            match: { defId: 'attack_whirlwind' },
            message: 'Add Whirlwind from the available card list.',
          },
        ],
        completeOn: [{ event: 'loadout_card_added', match: { defId: 'attack_whirlwind' } }],
        highlights: [{ type: 'loadout_card', defId: 'attack_whirlwind' }],
      },
      {
        id: 'remove-card',
        instruction: 'Remove that card again. Deck size and max-copy limits keep the final list legal.',
        allowedActions: [
          {
            action: 'loadout_card_remove',
            match: { defId: 'attack_whirlwind' },
            message: 'Remove Whirlwind from the selected deck.',
          },
        ],
        completeOn: [{ event: 'loadout_card_removed', match: { defId: 'attack_whirlwind' } }],
        highlights: [{ type: 'selected_loadout_card', defId: 'attack_whirlwind' }],
      },
    ],
  },
  {
    id: 'fight_bot',
    title: 'Fight the Bot',
    summary: 'Queue one safe order, ready up, and watch the bot answer automatically.',
    estimateMinutes: 2,
    behavior: 'bot_match',
    startScreen: 'game',
    steps: [
      {
        id: 'bot-select-card',
        instruction: 'Select Advance for a simple first order.',
        allowedActions: [
          {
            action: 'hand_card_select',
            match: { defId: 'move_forward' },
            message: 'Select Advance from your hand.',
          },
        ],
        completeOn: [{ event: 'card_selected', match: { defId: 'move_forward' } }],
        highlights: [{ type: 'hand_card', defId: 'move_forward' }],
      },
      {
        id: 'bot-select-unit',
        instruction: 'Select your front unit.',
        allowedActions: [
          {
            action: 'board_select',
            match: { hex: { q: 2, r: 3 } },
            message: 'Select the highlighted unit.',
          },
        ],
        completeOn: [{ event: 'board_tile_selected', match: { hex: { q: 2, r: 3 } } }],
        highlights: [{ type: 'board_unit', unitId: 'u0-1' }],
      },
      {
        id: 'bot-queue-order',
        instruction: 'Move it to the highlighted tile, then the order will queue automatically.',
        allowedActions: [
          {
            action: 'board_select',
            match: { hex: { q: 2, r: 2 } },
            message: 'Pick the highlighted destination tile.',
          },
        ],
        completeOn: [{ event: 'order_queued', match: { defId: 'move_forward' } }],
        highlights: [{ type: 'board_tile', hex: { q: 2, r: 2 } }],
      },
      {
        id: 'bot-ready',
        instruction: 'Press Ready. The bot will plan immediately after you lock in.',
        allowedActions: [
          {
            action: 'ready',
            message: 'Press Ready to hand planning over to the bot.',
          },
        ],
        completeOn: [{ event: 'bot_planning_started' }],
        highlights: [{ type: 'dom', targetId: 'ready' }],
      },
      {
        id: 'bot-watch',
        instruction: 'Watch the bot finish planning and the turn resolve. After that, you can replay the lesson or return to the hub.',
        blockedMessage: 'Wait for the bot and the turn resolution to finish.',
        completeOn: [{ event: 'turn_changed', match: { turn: 2 } }],
      },
    ],
  },
  {
    id: 'roguelike_run',
    title: 'Roguelike Run',
    summary: 'Play one tiny roguelike encounter, then see how the reward screen works.',
    estimateMinutes: 3,
    behavior: 'roguelike_match',
    startScreen: 'game',
    steps: [
      {
        id: 'rogue-select-card',
        instruction: 'Select Attack. This lesson uses the roguelike victory rule: eliminate all enemy units.',
        allowedActions: [
          {
            action: 'hand_card_select',
            match: { defId: 'attack_roguelike_basic' },
            message: 'Select the Attack card.',
          },
        ],
        completeOn: [{ event: 'card_selected', match: { defId: 'attack_roguelike_basic' } }],
        highlights: [{ type: 'hand_card', defId: 'attack_roguelike_basic' }],
      },
      {
        id: 'rogue-select-unit',
        instruction: 'Select your front unit.',
        allowedActions: [
          {
            action: 'board_select',
            match: { hex: { q: 2, r: 2 } },
            message: 'Select the highlighted unit.',
          },
        ],
        completeOn: [{ event: 'board_tile_selected', match: { hex: { q: 2, r: 2 } } }],
        highlights: [{ type: 'board_unit', unitId: 'u0-1' }],
      },
      {
        id: 'rogue-set-direction',
        instruction: 'Choose the monster tile to set the attack direction.',
        allowedActions: [
          {
            action: 'board_select',
            match: { hex: { q: 2, r: 1 } },
            message: 'Click the highlighted monster tile.',
          },
        ],
        completeOn: [{ event: 'order_queued', match: { defId: 'attack_roguelike_basic' } }],
        highlights: [{ type: 'board_tile', hex: { q: 2, r: 1 } }],
      },
      {
        id: 'rogue-ready',
        instruction: 'Press Ready to resolve the encounter.',
        allowedActions: [
          {
            action: 'ready',
            message: 'Press Ready to resolve the encounter.',
          },
        ],
        completeOn: [{ event: 'roguelike_reward_shown' }],
        highlights: [{ type: 'dom', targetId: 'ready' }],
      },
    ],
  },
  {
    id: 'play_online',
    title: 'Play Online',
    summary: 'See how room codes, seat tokens, invite links, and joining work before using a live server.',
    estimateMinutes: 2,
    behavior: 'online_demo',
    startScreen: 'menu',
    steps: [
      {
        id: 'online-create',
        instruction: 'Tutorial rooms start with Create Room. This generates invite links and a QR code for the other seat.',
        allowedActions: [
          {
            action: 'online_create',
            message: 'Use Create Room to show the invite flow.',
          },
        ],
        completeOn: [{ event: 'online_create_clicked' }],
        highlights: [
          { type: 'dom', targetId: 'menu-online-create' },
          { type: 'dom', targetId: 'menu-online-links' },
        ],
      },
      {
        id: 'online-join',
        instruction: 'Join Room uses the room code plus a seat token. In the real game, each token grants control of one seat.',
        allowedActions: [
          {
            action: 'online_join',
            message: 'Use Join Room to review the token-based join flow.',
          },
        ],
        completeOn: [{ event: 'online_join_clicked' }],
        highlights: [
          { type: 'dom', targetId: 'menu-online-room' },
          { type: 'dom', targetId: 'menu-online-token' },
          { type: 'dom', targetId: 'menu-online-join' },
        ],
      },
    ],
  },
]
