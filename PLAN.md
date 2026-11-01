# DungeonHarness — Plan (draft for approval)

An AI Dungeon Master for solo D&D 5e play, served locally in the browser. The DM runs
on Claude Code, Codex (both on your signed-in plans), or an API key, the same way
`learnharness` (branch `local-cli-engines`) does.

## Decisions so far

| Topic | Decision |
|---|---|
| Codebase | New app in `~/dnd`. Port only the engine layer from learnharness. |
| Players | Solo: one human character. |
| Rules | D&D 5e SRD 5.2 (CC-BY-4.0), full data, levels 1–20. |
| Authority | Code is authoritative. The AI acts only through game tools, and the server validates every change. |
| Platform | Local web (`npm run dev` → localhost). Personal use only. |
| Stack | Next.js 16, React 19, Tailwind 4, shadcn/Radix, TypeScript, local JSON files, PixiJS for maps. |
| Engines | Claude Code, Codex and API keys (Anthropic/OpenAI/others through pi-ai), selectable at setup and changeable mid-game. |
| Visuals | Tactical battle map, scene illustrations, world map, character sheet and 3D dice. |
| Art source | Procedural generation plus bundled CC0 asset packs. No image API. |
| Maps | Code generates the layout procedurally (dungeon, cave, forest, town, …). The DM places monsters, doors, traps and loot through tools. |
| Combat | Full 5e: initiative, action, bonus action, reaction and movement on the grid. The AI picks monster tactics; code resolves them. |
| Story | Pure improvisation, within the structure chosen at setup. |
| Input | Free text plus 3–4 suggested actions. In combat, click actions on the map. |
| Saves | Autosave, multiple campaigns and save slots, an auto-written journal, quest log and NPC codex. |
| Mid-game | All settings can be edited at any time. The DM is told about each change. |
| Audio | Ambient loops and SFX in v1 (bundled CC0 files, chosen by the DM through a tool). |
| Language | English. |

## Architecture

```
Browser (React)
 ├─ Setup wizard ──────────────┐
 ├─ Game screen                │  REST + SSE
 │   ├─ Narration/chat pane    │
 │   ├─ Scene panel (art)      ▼
 │   ├─ PixiJS map (battle / world)    Next.js server
 │   ├─ Sheet, inventory, spells ──▶  ├─ Game engine (pure TS, authoritative)
 │   ├─ Initiative tracker            │   rules · dice · combat · map gen · SRD data
 │   └─ 3D dice overlay               ├─ DM agent (pi Agent)
 └─ Settings                          │   ├─ ClaudeCodeAgent (Agent SDK, MCP tools)
                                      │   ├─ CodexAgent (codex app-server)
                                      │   └─ pi API-key engines
                                      ├─ Game tools (only interface AI→state)
                                      └─ Store: data/campaigns/<id>/{state.json, log.jsonl, journal.md, saves/}
```

### Engine layer (ported)
- Copy `src/agent/claude-code/*`, `src/agent/codex/*`, the `subscription-*` helpers and
  `provider-events.ts`, plus the model catalog and pricing pieces they need.
- Remove the teaching code. Keep the pi `Agent` contract, the session ledgers
  (`data/claude-code/`, `data/codex/`), env stripping, the CLI's own tools switched off,
  effort mapping, and the plan-usage readout.
- Keep the same env vars, renamed with a `DH_` prefix.

### Game engine (deterministic TypeScript, unit-tested)
- **SRD data**: JSON for species, classes and subclasses, backgrounds, feats, spells,
  monsters, equipment and magic items, conditions. Imported from the SRD 5.2
  CC-BY sources by a build script, with attribution.
- **Dice**: a seeded RNG and a dice-notation parser. Advantage/disadvantage. Every
  roll is logged and visible.
- **Character**: creation (point-buy, standard array or 4d6), derived stats,
  proficiencies, spell slots, rests, level-up 1–20, conditions, exhaustion,
  death saves.
- **Combat**: initiative, the turn economy, movement and pathing on the grid
  (difficult terrain, opportunity attacks), attack and damage resolution, saves,
  concentration, areas of effect, cover, line of sight.
- **Maps**: procedural generators (BSP dungeon, cellular caves, wilderness,
  town/tavern interiors) plus fog of war. The world map is a hex/region graph of
  discovered locations.

### DM agent tools (the only way the AI changes state)
`roll`, `ability_check`, `saving_throw`, `start_scene(type, mood, art_tags)`,
`generate_map(kind, size, features)`, `place_entity`, `move_entity`,
`start_combat(monsters)`, `monster_turn(actor, action, target, path)`, `end_combat`,
`apply_damage` / `heal`, `apply_condition`, `give_item` / `remove_item`, `award_xp`,
`add_npc` / `update_npc`, `add_quest` / `update_quest`, `journal_note`,
`set_ambience(track)`, `suggest_actions([..])`, `reveal_location`, `travel`,
plus read tools: `get_state`, `lookup_srd(query)`, `get_journal`.
The player's own actions in combat (clicked on the map) go straight to the engine.
The DM is then told the result and narrates it.

### Memory and consistency
The DM keeps one long-lived CLI session per campaign. Every turn also injects a compact
"state digest" (party, location, active quests, recent journal) so that resuming,
compaction and switching engines stay consistent.

## UI

- **Setup wizard** (each step skippable, with "let the DM decide" defaults):
  1. World & tone: preset setting or custom text, tone, content limits (lines & veils).
  2. Character: species, class, background, abilities, equipment, a procedural portrait
     (layered CC0 parts).
  3. Campaign structure: one-shot or campaign, length, starting level, difficulty,
     optional hook.
  4. DM style & engine: verbosity, rules strictness, combat frequency, engine, model
     and effort.
- **Game screen**: narration stream on the left. The scene art or the active map is in
  the center, switching between battle, world and scene. A tabbed side panel holds the
  sheet, inventory, spells, quests, journal and codex. Initiative bar on top, dice
  overlay, suggested-action chips.
- **Scene art**: layered procedural parallax scenes (sky, terrain, structures, props,
  lighting by time of day and mood) built from CC0 packs. NPC portraits are made from
  layered parts.
- **Settings**: everything from the wizard, editable at any time. Also engine status and
  plan usage.

## Assets (CC0 only, bundled)
- Tiles and tokens: Kenney packs and other CC0 dungeon/top-down sets.
- Dice: three.js plus cannon-es physics.
- Audio: CC0 loops and SFX from freesound/OpenGameArt (CC0 filter only).

Each asset is recorded in `ASSETS.md` with its license.

## Milestones (one git commit or more per milestone)

1. **Scaffold**: Next.js app, tooling, test runner, `data/` store, campaign CRUD.
2. **Engines**: port Claude Code, Codex and pi-API. A "hello DM" chat streams through
   each engine. Model picker.
3. **Rules core**: SRD import, dice, character model and creation, level-up. Unit tests.
4. **DM loop**: system prompt, game tools over MCP and pi tools, state digest, journal,
   suggestions, narration UI.
5. **Setup wizard and settings**: all four steps, editable mid-game.
6. **Maps**: procedural generators, PixiJS renderer, fog, tokens, world map.
7. **Combat**: initiative, turn economy, grid actions, monster AI turns, conditions,
   concentration.
8. **Presentation**: 3D dice, scene art compositor, portraits, ambience and SFX.
9. **Saves and polish**: slots, autosave, codex and quest views, error and rate-limit UX,
   README.

## Open risks
- SRD 5.2 coverage: "full SRD" means what the SRD contains. It does not include PHB-only
  subclasses or spells.
- Each CLI turn adds 1–3 s of latency. Combat turns that call many tools will feel
  slower, so monster turns are batched into one tool call each.
- The quality of procedural scene art depends on the CC0 packs available. Expect it to
  look good and stylized, not painterly.
