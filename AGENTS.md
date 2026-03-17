# AGENTS.md

This file is for future agents working in this repository.

## Project Shape

- Frontend game client lives in `src/`.
- Server code and tests live in `server/`.
- Runtime board art lives in `public/assets/`.
- New source art for the ongoing board/art overhaul lives in `public/assets/new style/`.
- Generated team-tint assets are produced by `scripts/generateTeamAssets.ps1`.
- The living gameplay specification workbook is `specifications.xlsx` in the repo root.

## Useful Commands

- `npm run build`
- `npm run test:server`
- `npm run assets:generate-team`
- `python scripts/syncSpecifications.py check`
- `python scripts/syncSpecifications.py write`

Use `build` after client/rendering changes. Use `test:server` after engine/server/game-rule changes. Use `assets:generate-team` after changing source art in `public/assets/new style/` for units, barricades, or spawn village. Use `syncSpecifications.py check` for spreadsheet/code consistency audits. Use `syncSpecifications.py write` only after reconciling spreadsheet-driven changes or refreshing the workbook from already-implemented code.

## Specification Workbook

- `specifications.xlsx` is the living gameplay/content document for cards, units, encounters, classes, status effects, and similar player-facing data.
- Treat user edits in `specifications.xlsx` as intentional design changes unless the user says the sheet is outdated, partial, or exploratory.
- When the workbook and code disagree, do not blindly overwrite the workbook. Review the workbook diff first, implement the relevant code changes, then refresh the workbook as needed.
- When you change player-facing gameplay content in code, update the corresponding workbook rows in the same task before you finish.
- When workbook changes imply implementation work but the row is ambiguous, ask the user instead of guessing.
- Periodically run a consistency pass with `python scripts/syncSpecifications.py check`. If it fails because the workbook was intentionally edited first, update the code rather than forcing the workbook back to the old implementation.
- Keep implementation-only compatibility details in code/`AGENTS.md` when they do not fit the workbook well. Example: legacy internal ids such as `pitfall`.

## User Preferences

- If art mapping or visual intent is ambiguous, ask. The user explicitly prefers an extra clarification over a wrong assumption.
- The user often works iteratively on visuals and likes small, targeted numeric adjustments rather than broad redesigns.
- Do not revert unrelated worktree changes. This repo often has ongoing art asset churn in parallel with code changes.
- When making visual tuning changes, keep constants easy to tweak rather than burying magic numbers deep in logic.

## Current Art/Board Notes

- The board is in the middle of an art overhaul.
- Current source art is the `new style` set, but some values are temporary and tuned by eye.
- `BOARD_TILT` in `src/main.ts` is intentionally set to match the current temporary tile set. Do not "correct" it without checking visually with the user.
- Current user-approved temporary `BOARD_TILT` is `0.55`. Treat that as intentional, not accidental.
- Tile generation currently uses the new terrain families from `src/engine/types.ts` and `src/engine/game.ts`:
  - `grassland`
  - `meadow`
  - `forest`
  - `swamp`
  - `hills`
  - `mountain`
  - `snow`
  - `snow_hills`
- The old pond exception was intentionally removed from tile generation.
- Loaded tile art is intentionally not hex-clipped right now, so tall tile features can overlap neighboring tiles.

## Sprite/Tint Pipeline

- Units and spawn village still use the `base + team` runtime tint pipeline.
- Roguelike monster recolors can also be done at runtime in `src/main.ts`; slime monsters currently use an orange runtime tint rather than dedicated recolored PNGs.
- Source art for these assets is in `public/assets/new style/`.
- Generated outputs currently overwrite files in:
  - `public/assets/units/*_base.png`
  - `public/assets/units/*_team.png`
  - `public/assets/buildings/spawn_village_base.png`
  - `public/assets/buildings/spawn_village_team.png`
- The tint-mask generator currently uses a heuristic to extract blue team-marked regions from source art. If output looks wrong, inspect the generated PNGs visually before changing runtime code.

## Gameplay/Asset Conventions

- `stronghold` is legacy and should not be reintroduced as active board art. Some code/tests still accept legacy identifiers for compatibility.
- Spawn village is still used and has active art.
- Bear trap art replaces the old pitfall art, but the internal trap kind/card id still uses legacy `pitfall` naming in several code paths for compatibility.
- Trap markers are intentionally drawn larger than the source PNG and currently do not use a separate ground-shadow oval.
- Wolf enemies currently use a single art variant.
- `attack_roguelike_pack_hunt` is intentionally alpha-wolf-only.
- `Double Steps`, `Converge`, and `Mark` intentionally resolve movement simultaneously, including moves into tiles vacated in the same step.
- Multi-target damage and chain effects should snapshot eligible targets at effect start so newly spawned slimes are not hit again by the same resolving effect.
- Arrow, Ice Bolt, and Fireball share a line-projectile animation path; fizzles should travel off the board and fade out rather than playing a hit burst.
- `GameSettings.randomizeFirstPlayer` is used for online and standard local matches; roguelike runs intentionally keep their fixed opener.

## Roguelike UI Notes

- Roguelike reward selection uses rendered card UI, not plain text buttons.
- Remove-card rewards use the winner modal with `uiStage = 'remove_choice'` and present the current deck as removable card options.
- Slime monsters are intentionally rendered a bit lower than other roguelike monsters to sit better on the current board art.

## Animation/UI Notes

- Turn-end burn/lightning-barrier replay may be embedded in the final order's log slice; client replay code needs to split those logs out instead of assuming they only appear in a separate no-order resolution step.
- On touch, tapping an already zoomed hand card should collapse the zoom and clear that in-progress selection.
- Movement and teleport planning selectors intentionally allow targeting tiles that are currently occupied; queue order and simulated resolution determine whether those tiles will be vacated in time.

## Good Places To Tune Visuals

Most board/render tuning happens in `src/main.ts`, especially:

- board tilt and projection
- tile scale/anchor
- unit and leader scale
- ring geometry and facing indicators
- class-specific sprite offsets

If the user asks for visual nudges, check there first.

Current visual tuning has helper support for:

- per-class sprite offsets for units and leaders
- leader-specific ring sizing on top of the shared ring geometry
- dual facing arrows on the unit ring markers

## Commit-Time Maintenance Rule

Whenever you create a new commit:

1. Review the conversation since the previous commit.
2. Update this `AGENTS.md` with any new durable repo-specific guidance, user preferences, workflow rules, asset pipeline changes, or visual tuning conventions that emerged.
3. Keep the file concise and focused on information that will help the next agent make better decisions.

Do not add transient task details that will go stale immediately. Add stable patterns and conventions.
