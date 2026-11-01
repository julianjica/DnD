# DungeonHarness

An AI Dungeon Master for **solo D&D 5e**, served locally in your browser. The DM runs on
**Claude Code** or **Codex** (billed to your signed-in Claude / ChatGPT plan) or on an **API key**
(Anthropic, OpenAI, OpenRouter, Google, … via pi-ai). Personal use only.

- **Code is authoritative.** The AI changes the game only through ~45 game tools: dice, checks and
  saves, HP, inventory, XP, maps, combat, NPCs, quests and the journal. It cannot fudge rolls or forget
  your gold.
- **Full 5e SRD 5.1 (CC-BY-4.0):** the data covers 334 monsters, 319 spells, the classes and
  subclasses, levels 1–20 and multiclassing.
- **Visuals:**
  - Procedural tactical battle maps (14 kinds) with lighting and fog of war.
  - A parchment world map.
  - Illustrated scenes, procedural portraits and 3D physics dice.
  - Ambient music and SFX (CC0).
- **Combat:** grid combat with initiative, an action economy, opportunity attacks, cover, area
  templates, concentration and death saves. You click to move and attack, and the DM plays the
  monsters.
- **Setup wizard:** world and tone (including lines and veils), campaign structure, full character
  creation, and DM style and engine. Everything stays editable mid-game.
- **Saving:** autosave, save slots, a journal, a quest log and an NPC codex.

## Run it

```bash
npm install
npm run dev            # http://localhost:4242 (PORT=xxxx npm run dev to change)
```

Requirements:
- Node 20 or newer.
- At least one engine:
  - **Claude Code:** install it, run `claude` and `/login`.
  - **Codex:** install it and run `codex login`.
  - **API key:** add it in **Settings → API keys**.

Data (campaigns, sessions, keys) lives in `./data/`, which is git-ignored. Override it with `DH_DATA_DIR`.

### Engine options (environment variables)

| Variable | Effect |
|---|---|
| `DH_CLAUDE_CODE_PATH` / `DH_CODEX_PATH` | Use this executable |
| `DH_CLAUDE_CODE=0\|1` / `DH_CODEX=0\|1` | Hide or force-show the engine |
| `DH_CLAUDE_CODE_USE_API_KEY=1` / `DH_CODEX_USE_API_KEY=1` | Let the CLI see API keys (by default the run is billed to your plan) |

The CLIs' own tools (shell, web, MCP, plugins) are switched off, so the DM sees only the game tools.

## Develop

```bash
npm test               # 177 unit tests (rules, combat, maps, engines, art)
npm run typecheck
npx eslint .
npx tsx scripts/engines/smoke.ts claude-code claude-haiku-5-5 low   # live engine check (bills your plan)
DH_DATA_DIR=$(mktemp -d) npx tsx scripts/dm/smoke.ts claude-code claude-haiku-5-5 "I attack"  # live DM loop
```

Dev preview pages: `/dev/maps` (every map kind) and `/dev/art` (scenes, portraits, dice, audio).

### Layout

| Path | What |
|---|---|
| `lib/game/types.ts` | Shared contracts (GameState, maps, combat, engine interface) |
| `lib/engines/` | Claude Code (Agent SDK + in-process MCP), Codex (`app-server` JSON-RPC), API (pi-agent-core) |
| `lib/dm/` | System prompt, state digest, turn loop, DM tools, new-game creation |
| `lib/rules/` | Dice, character rules (creation, leveling, rests, slots), combat engine |
| `lib/srd/` | SRD 5.1 data and lookups (`scripts/srd/import.ts` regenerates it) |
| `lib/maps/` | Map and world generators, line of sight, fog |
| `components/` | Play screen, setup wizard, PixiJS maps, scene art, dice, audio |
| `app/api/` | Turn and action streaming (SSE), campaigns, saves, level-up, engines, keys |

## Credits

- **Rules content:** System Reference Document 5.1 by Wizards of the Coast, licensed CC-BY-4.0 (see
  `lib/srd/ATTRIBUTION.md`).
- **Token icons:** game-icons.net, CC BY 3.0.
- **Audio:** CC0 from OpenGameArt.

Full list in `ASSETS.md`.
