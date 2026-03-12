import type { TutorialLessonDef } from './types'

export const TUTORIAL_LESSONS: TutorialLessonDef[] = [
  {
    id: 'first_battle',
    title: 'First Battle',
    summary: 'Learn planning, AP, queue order, queue editing, priority, spawning, and why cards sometimes fizzle.',
    estimateMinutes: 5,
    recommended: true,
    behavior: 'local_match',
    startScreen: 'game',
    steps: [
      {
        id: 'intro-goal',
        instruction: 'Your goal is to defeat the enemy leader. This lesson will pause to explain the planner UI before each new idea.',
        allowedActions: [
          {
            action: 'tutorial_next',
            message: 'Use Next to continue the explanation.',
          },
        ],
        completeOn: [{ event: 'manual_next' }],
      },
      {
        id: 'explain-ap',
        instruction:
          "The wax seals by your name are your action points. The seals printed on each card are that card's AP cost, so with 2 AP you can queue two 1-cost cards in the same turn.",
        allowedActions: [
          {
            action: 'tutorial_next',
            message: 'Use Next after checking the AP rail and the card costs in hand.',
          },
        ],
        completeOn: [{ event: 'manual_next' }],
        highlights: [
          { type: 'dom', targetId: 'planner-ap' },
          { type: 'dom', targetId: 'hand' },
        ],
      },
      {
        id: 'explain-active-player',
        instruction:
          'Active Player shows who gets the first slot in the resolution sequence this turn. Both sides still plan in secret, but turn order matters once the queues reveal.',
        allowedActions: [
          {
            action: 'tutorial_next',
            message: 'Use Next to keep going.',
          },
        ],
        completeOn: [{ event: 'manual_next' }],
        highlights: [{ type: 'dom', targetId: 'active-player' }],
      },
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
        id: 'explain-ghost-preview',
        instruction:
          'The ghost preview on the board shows where your plan would end if nothing interrupts it. The queue on the right stores your planned orders from top to bottom.',
        allowedActions: [
          {
            action: 'tutorial_next',
            message: 'Use Next after checking the queue and the board preview.',
          },
        ],
        completeOn: [{ event: 'manual_next' }],
        highlights: [
          { type: 'queue_card', defId: 'move_forward' },
          { type: 'dom', targetId: 'orders' },
        ],
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
        id: 'explain-resolution-controls',
        instruction:
          'Revealed orders resolve one card at a time. Use Resolve Next to step through them, or Resolve Turn to play the rest automatically. Priority can jump ahead; Slow pushes cards to the back.',
        panelPlacement: 'right_above',
        allowedActions: [
          {
            action: 'tutorial_next',
            message: 'Use Next after checking the resolution controls.',
          },
        ],
        completeOn: [{ event: 'manual_next' }],
        highlights: [
          { type: 'dom', targetId: 'resolve-next' },
          { type: 'dom', targetId: 'resolve-all' },
          { type: 'dom', targetId: 'orders' },
        ],
      },
      {
        id: 'resolve-turn-one',
        instruction: 'Resolve turn one now. You can step card by card or finish the whole sequence at once.',
        blockedMessage: 'Use Resolve Next or Resolve Turn to continue the resolution.',
        panelPlacement: 'right_above',
        allowedActions: [
          {
            action: 'resolve_next',
            message: 'Use Resolve Next or Resolve Turn to continue.',
          },
          {
            action: 'resolve_all',
            message: 'Use Resolve Next or Resolve Turn to continue.',
          },
        ],
        completeOn: [{ event: 'turn_changed', match: { turn: 2 } }],
        highlights: [
          { type: 'dom', targetId: 'resolve-next' },
          { type: 'dom', targetId: 'resolve-all' },
        ],
      },
      {
        id: 'explain-turn-two-hand',
        instruction:
          'You drew Recruit and Jab. Jab is a Priority attack, while Recruit adds a 1-strength unit to one of your grassland spawn tiles. This turn we will queue both.',
        allowedActions: [
          {
            action: 'tutorial_next',
            message: 'Use Next after checking the new cards.',
          },
        ],
        completeOn: [{ event: 'manual_next' }],
        highlights: [
          { type: 'dom', targetId: 'hand' },
          { type: 'dom', targetId: 'planner-ap' },
        ],
      },
      {
        id: 'select-jab',
        instruction: 'Select Jab first.',
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
        id: 'set-priority-attack-direction',
        instruction: 'Aim Jab at the enemy soldier.',
        allowedActions: [
          {
            action: 'board_select',
            match: { hex: { q: 3, r: 0 } },
            message: 'Click the enemy soldier tile to set the attack direction.',
          },
        ],
        completeOn: [{ event: 'order_queued', match: { defId: 'attack_jab' } }],
        highlights: [{ type: 'board_tile', hex: { q: 3, r: 0 } }],
      },
      {
        id: 'explain-priority-queue',
        instruction:
          'Jab is now queued first. Priority does not make it free, but it can jump ahead of ordinary cards once both queues reveal.',
        allowedActions: [
          {
            action: 'tutorial_next',
            message: 'Use Next after checking the queue and AP rail.',
          },
        ],
        completeOn: [{ event: 'manual_next' }],
        highlights: [
          { type: 'queue_card', defId: 'attack_jab' },
          { type: 'dom', targetId: 'orders' },
          { type: 'dom', targetId: 'planner-ap' },
        ],
      },
      {
        id: 'select-recruit',
        instruction: 'Select Recruit next so you finish the turn with two queued cards.',
        allowedActions: [
          {
            action: 'hand_card_select',
            match: { defId: 'reinforce_spawn' },
            message: 'Select Recruit from your hand.',
          },
        ],
        completeOn: [{ event: 'card_selected', match: { defId: 'reinforce_spawn' } }],
        highlights: [{ type: 'hand_card', defId: 'reinforce_spawn' }],
      },
      {
        id: 'pick-spawn-tile',
        instruction: 'Pick the highlighted spawn tile for the new unit.',
        allowedActions: [
          {
            action: 'board_select',
            match: { hex: { q: 1, r: 4 } },
            message: 'Pick the highlighted spawn tile.',
          },
        ],
        completeOn: [{ event: 'board_tile_selected', match: { hex: { q: 1, r: 4 } } }],
        highlights: [{ type: 'board_tile', hex: { q: 1, r: 4 } }],
      },
      {
        id: 'set-spawn-facing',
        instruction: "Choose the tile in front of that spawn to set the new unit's facing.",
        allowedActions: [
          {
            action: 'board_select',
            match: { hex: { q: 1, r: 3 } },
            message: 'Click the highlighted tile to set the spawned unit facing upward.',
          },
        ],
        completeOn: [{ event: 'order_queued', match: { defId: 'reinforce_spawn' } }],
        highlights: [{ type: 'board_tile', hex: { q: 1, r: 3 } }],
      },
      {
        id: 'explain-edit-queue',
        instruction:
          'Queued cards are not locked in. You can click a queued card to return it to hand, or drag cards to change their order before you press Ready.',
        allowedActions: [
          {
            action: 'tutorial_next',
            message: 'Use Next after checking the queue controls.',
          },
        ],
        completeOn: [{ event: 'manual_next' }],
        highlights: [
          { type: 'queue_card', defId: 'attack_jab' },
          { type: 'queue_card', defId: 'reinforce_spawn' },
          { type: 'dom', targetId: 'orders' },
        ],
      },
      {
        id: 'remove-jab-from-queue',
        instruction: 'Remove Jab from the queue once so you can see how to take a card back into hand.',
        allowedActions: [
          {
            action: 'queue_remove',
            match: { defId: 'attack_jab' },
            message: 'Click the queued Jab card to return it to your hand.',
          },
        ],
        completeOn: [{ event: 'queue_removed', match: { defId: 'attack_jab' } }],
        highlights: [{ type: 'queue_card', defId: 'attack_jab' }],
      },
      {
        id: 'reselect-jab',
        instruction: 'Select Jab again.',
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
        id: 'reselect-priority-attacker',
        instruction: 'Select the same advanced unit again.',
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
        id: 'reset-priority-attack-direction',
        instruction: 'Aim Jab at the enemy soldier again.',
        allowedActions: [
          {
            action: 'board_select',
            match: { hex: { q: 3, r: 0 } },
            message: 'Click the enemy soldier tile to set the attack direction.',
          },
        ],
        completeOn: [{ event: 'order_queued', match: { defId: 'attack_jab' } }],
        highlights: [{ type: 'board_tile', hex: { q: 3, r: 0 } }],
      },
      {
        id: 'explain-drag-drop',
        instruction:
          'Jab returned to the bottom of the queue when you added it back. Drag it above Recruit. On touch, press and hold the card before you drag.',
        allowedActions: [
          {
            action: 'tutorial_next',
            message: 'Use Next after checking the queue order.',
          },
        ],
        completeOn: [{ event: 'manual_next' }],
        highlights: [
          { type: 'dom', targetId: 'orders' },
          { type: 'queue_card', defId: 'attack_jab' },
          { type: 'queue_card', defId: 'reinforce_spawn' },
        ],
      },
      {
        id: 'reorder-jab-first',
        instruction: 'Drag Jab above Recruit so your attack is back in the first slot.',
        allowedActions: [
          {
            action: 'queue_reorder',
            match: { fromDefId: 'attack_jab', toDefId: 'reinforce_spawn' },
            message: 'Drag Jab above Recruit.',
          },
          {
            action: 'queue_reorder',
            match: { fromDefId: 'reinforce_spawn', toDefId: 'attack_jab' },
            message: 'Move Jab to the first slot.',
          },
        ],
        completeOn: [{ event: 'queue_reordered', match: { order: ['attack_jab', 'reinforce_spawn'] } }],
        highlights: [
          { type: 'queue_card', defId: 'attack_jab' },
          { type: 'queue_card', defId: 'reinforce_spawn' },
          { type: 'dom', targetId: 'orders' },
        ],
      },
      {
        id: 'ready-turn-two',
        instruction: 'Press Ready to reveal the second turn.',
        allowedActions: [
          {
            action: 'ready',
            message: 'Press Ready to reveal the second turn.',
          },
        ],
        completeOn: [{ event: 'action_phase_started', match: { turn: 2 } }],
        highlights: [{ type: 'dom', targetId: 'ready' }],
      },
      {
        id: 'explain-turn-two-reveal',
        instruction:
          'Now both queues are visible. Player 2 is the active player this turn, so their card would normally go first. The enemy revealed Boost on that soldier, but your Jab has Priority, so Jab will cut ahead of it anyway. Use Resolve Next to step through it or Resolve Turn to play the whole sequence.',
        panelPlacement: 'right_above',
        allowedActions: [
          {
            action: 'tutorial_next',
            message: 'Use Next after checking the revealed queues.',
          },
        ],
        completeOn: [{ event: 'manual_next' }],
        highlights: [
          { type: 'queue_card', defId: 'attack_jab' },
          { type: 'queue_card', defId: 'reinforce_boost' },
          { type: 'dom', targetId: 'resolve-next' },
          { type: 'dom', targetId: 'resolve-all' },
        ],
      },
      {
        id: 'resolve-turn-two',
        instruction: 'Resolve turn two now.',
        blockedMessage: 'Use Resolve Next or Resolve Turn to continue the resolution.',
        panelPlacement: 'right_above',
        allowedActions: [
          {
            action: 'resolve_next',
            message: 'Use Resolve Next or Resolve Turn to continue.',
          },
          {
            action: 'resolve_all',
            message: 'Use Resolve Next or Resolve Turn to continue.',
          },
        ],
        completeOn: [{ event: 'turn_changed', match: { turn: 3 } }],
        highlights: [
          { type: 'dom', targetId: 'resolve-next' },
          { type: 'dom', targetId: 'resolve-all' },
          { type: 'dom', targetId: 'orders' },
        ],
      },
      {
        id: 'explain-fizzle',
        instruction:
          'The enemy Boost fizzled because Jab removed its target before that card could resolve. If a target or requirement is invalid when a card resolves, the order does nothing.',
        allowedActions: [
          {
            action: 'tutorial_next',
            message: 'Use Next to set up the final attack.',
          },
        ],
        completeOn: [{ event: 'manual_next' }],
        highlights: [{ type: 'dom', targetId: 'hand' }],
      },
      {
        id: 'select-final-jab',
        instruction: 'Select your second Jab to finish the enemy leader.',
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
        id: 'select-final-attacker',
        instruction: 'Select your advanced unit again.',
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
        id: 'set-final-direction',
        instruction: "Choose the enemy leader's tile to set the final attack direction.",
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
        instruction: 'Press Ready again. You can step the end of the turn card by card or resolve the whole sequence.',
        allowedActions: [
          {
            action: 'ready',
            message: 'Press Ready to reveal the last turn.',
          },
        ],
        completeOn: [{ event: 'action_phase_started', match: { turn: 3 } }],
        highlights: [{ type: 'dom', targetId: 'ready' }],
      },
      {
        id: 'resolve-finish',
        instruction: 'Resolve the final turn to win the lesson.',
        blockedMessage: 'Use Resolve Next or Resolve Turn to finish the lesson.',
        allowedActions: [
          {
            action: 'resolve_next',
            message: 'Use Resolve Next or Resolve Turn to finish the lesson.',
          },
          {
            action: 'resolve_all',
            message: 'Use Resolve Next or Resolve Turn to finish the lesson.',
          },
        ],
        completeOn: [{ event: 'winner_shown', match: { winner: 0 } }],
        highlights: [
          { type: 'dom', targetId: 'resolve-next' },
          { type: 'dom', targetId: 'resolve-all' },
        ],
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
        highlights: [
          { type: 'selected_loadout_card', defId: 'attack_whirlwind' },
          { type: 'dom', targetId: 'loadout-back' },
        ],
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
