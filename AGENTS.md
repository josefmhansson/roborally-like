# AGENTS.md

This file is for future agents working in this repository.

## Project Shape

- Frontend game client lives in `src/`.
- Server code and tests live in `server/`.
- Runtime board art lives in `public/assets/`.
- New source art for the ongoing board/art overhaul lives in `public/assets/new style/`.
- Generated team-tint assets are produced by `scripts/generateTeamAssets.ps1`.

## Useful Commands

- `npm run build`
- `npm run test:server`
- `npm run assets:generate-team`

Use `build` after client/rendering changes. Use `test:server` after engine/server/game-rule changes. Use `assets:generate-team` after changing source art in `public/assets/new style/` for units, barricades, or spawn village.

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
- Wolf enemies currently use a single art variant.

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
