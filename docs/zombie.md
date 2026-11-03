# DungeonHarness: *The Quiet* (zombie-apocalypse ruleset). Design draft

This is a second ruleset next to D&D fantasy. You keep the 5e core (d20, AC, HP, skills, advantage, levels 1–20) and play a modern survival horror in an invented town. There is no magic. The twelve classes become twelve **professions** you had before the world ended. Species become **origins**, and spells become **techniques**, some of which use up items you find. You **start alone**. Survivors and a home base enter later, through the story.

Your decisions so far:
- Invented town
- Survival rules, with no magic
- Zombies that are mixed and evolve over time
- Classes map 1:1 to professions
- Techniques run on charges and some also need items
- Everyone is human, with an origin
- Survivors and a base, but you start alone
- Survival horror tone

---

## 1. The town: Kessler Falls

A river town of about 38,000 people in a narrow valley, an hour from the nearest city. It was a mill town, then a college town, and then a quiet place that people left. It's late October. The leaves are turning, and the first snow is a week away.

Its districts, which the DM can lean on and which make up the world map:

| District | What's there | Why it matters |
|---|---|---|
| **Downtown / Main Street** | Police station, City Hall, St. Agnes church, Rosie's Diner, Hale's Pharmacy, the Bijou cinema, the bus depot | First looting targets, plus the PD remnants and the church faction |
| **St. Brigid's Regional Hospital** | Hilltop hospital with its own generator | Ground zero. It holds medicine and holds the dead. |
| **Hollis State College** | Campus, library tower, science building with the **Ventara Biologics** lab wing | Where it started, and the main mystery |
| **Old Mill District** | River, dam, abandoned textile mills, rail yard | Raider territory, and hard ground for hordes |
| **Riverside Mall & Route 9 interchange** | Mall, big-box store, gas station, motel, highway | Big loot, big hordes, and the way out |
| **Pinecrest** | Suburbs: cul-de-sacs, school, swimming pool | House-by-house scavenging, families, ugly choices |
| **County farms** | Granger farm, orchards, grain silo, feed store | Food, animals, isolation |
| **The edges** | National Guard armory, Kessler County Correctional, the water treatment plant, the radio tower on Bald Hill, the two bridges | Late-game places, factions and plot |

**The outbreak (canon the DM keeps):** Ventara Biologics ran a quiet trial at the college of a neuro-regenerative drug (code name **LAZARUS-7**) on volunteers, students who were paid for it. On **Day 0**, a Monday, three volunteers collapsed and were taken to St. Brigid's. They "died" in the ER and got up again. The hospital fell in a night.
- **Day 2:** the military seals both bridges and the highway ("Operation Tollgate"). Anyone who approaches the cordon is shot.
- **Day 5:** the power grid fails.
- **Day 9:** the cordon goes silent.
- **Ever since:** a voice on 101.7 FM, broadcast from the radio tower, has been reading lists of names and coordinates at 3 a.m.

**Mysteries:**
- What LAZARUS-7 really does
- Why some people who were bitten took days to turn and others minutes
- Who is broadcasting
- Whether there is a cure in the lab wing
- What happened to the cordon

The DM reveals these slowly. The rules come first.

**Factions** (they appear over time; other survivors are as dangerous as the dead):
- **The Precinct.** The last officers, holding the police station under Sgt. Dana Ruiz. They're orderly, armed and paranoid.
- **The Fold.** Pastor Elias Crane's congregation at St. Agnes. They believe the dead are a judgment and that the living must "earn" their place.
- **The Route 9 Boys.** Raiders running the motel and the gas station. They have fuel and guns and trade in people.
- **The Library.** Students and faculty barricaded in the college library tower. They have knowledge, no food, and a secret about Ventara.
- **The Grangers.** A farm family with the only reliable food in the county. They don't trust anyone.

---

## 2. Professions (the twelve classes)

The class id stays the same (`wizard`, `rogue`…), so the engine, levelling, hit dice, saves and proficiencies all keep working. Only the names, descriptions and a few features change. "Same" means the mechanics are unchanged and only the flavour text is new.

| Class | Profession (EN / ES) | Key renames and replacements |
|---|---|---|
| Barbarian | **Firefighter** / Bombero(a) | Rage → **Adrenaline**. Unarmored Defense → **Tough as Nails**. Danger Sense → **Situational Awareness**. Primal Path → **Crew** (Berserker → Smoke Eater). |
| Bard | **Radio Host** / Locutor(a) | Bardic Inspiration → **Pep Talk**. Song of Rest → **Campfire Stories**. Techniques: taunt, air horn, sweet talk, lull, "keep breathing". Tied to the 101.7 FM mystery. |
| Cleric | **Nurse** / Enfermero(a) | Channel Divinity → **Triage**. Turn Undead → **Road Flare**: a lit flare drives the dead back and holds them off. Domains become **Wards** (Life → ER, Light → Burn Unit…). Healing techniques use up medical supplies. |
| Druid | **Farmer / Vet** / Granjero(a)·Veterinario(a) | Wild Shape is **replaced** with **Loyal Dog**, an animal companion that grows with your level. Druidic → **Country Sense**. Techniques: snares, smoke from burning hay, preserves (Goodberry), herbal remedies, animal whispering. |
| Fighter | **Soldier / Veteran** / Soldado(a)·Veterano(a) | Fighting Style, Second Wind, Action Surge and Extra Attack are the same. Champion → **Infantry**. |
| Monk | **Martial-Arts Coach** / Instructor(a) de artes marciales | Ki → **Focus**. Martial Arts, Flurry, Patient Defense, Step of the Wind and Stunning Strike are the same. Open Hand → **Dojo**. Deflect Missiles → **Deflect** (no bullets). |
| Paladin | **Police Officer** / Policía | Divine Sense → **Cop Instinct**: sense hidden threats nearby. Lay on Hands → **First Responder**: a pool of first aid. Divine Smite → **Takedown**. Oath → **Badge** (Devotion → Protect & Serve). Aura of Protection → **Command Presence**. |
| Ranger | **Hunter** / Cazador(a) | Favored Enemy → **Know Your Prey**. Natural Explorer → **Backwoods**. Techniques: mark target, tin-can alarm, field dressing, camouflage, snare. |
| Rogue | **Locksmith / Petty Thief** / Cerrajero(a)·Ratero(a) | Sneak Attack → **Cheap Shot**. Thieves' Cant → **Street Slang**. Cunning Action and Uncanny Dodge are the same. Thief subclass → **Burglar**. |
| Sorcerer | **Athlete** / Atleta | Sorcery Points → **Grit**. Metamagic → **Pushing Limits**. Techniques are physical: sprint, tackle, hurled brick (a ranged attack), parkour leap, roll landing, block. |
| Warlock | **Ex-Con** / Ex-convicto(a) | Your "patron" is **The Connection**, someone you owe (Fiend → The Cartel). Pact Magic → **Favors**, which come back on a short rest. Eldritch Blast → **Shiv Flurry**. Pact Boons: Blade → Shank, Chain → Lookout, Tome → Prison Library. Invocations → **Yard Tricks**. |
| Wizard | **Chemistry Teacher / Engineer** / Profesor(a) de química·Ingeniero(a) | Spellbook → **Notebook**. Arcane Recovery → **Tinker**. Techniques: Molotov, pipe bomb, flashbang, tripwire, taser, smoke bomb, thermite, jury-rig, flashlight. Most of them use up components. |

Subclasses get the same treatment: the SRD subclass and the homebrew one are renamed and reflavoured, with no new mechanics. Features that can't be read as modern (for example Wild Shape, or the more magical capstones) are replaced with something of equal power. The full feature-by-feature list is part of Phase 1.

### Techniques (what replaces spells)
- Techniques are entries in the spell engine. They keep the same slots, levels, attacks, saves and damage, but each one has a modern name and description. The DM and the player cast them like spells.
- Techniques that need materials also **use up an item** from your inventory, and the cast fails without it. For example:
  - **Molotov:** a glass bottle, a can of gasoline and a rag.
  - **Field Surgery:** a medkit charge.
  - **Pipe Bomb:** a pipe, powder and a fuse.
- Every profession that casts gets about 8–14 techniques for levels 0–5. Higher levels come later.

## 3. Origins (instead of species)

Everyone is human. Your origin gives you what a species used to:

| Origin | Benefit |
|---|---|
| **Athletic** | +5 ft speed, proficiency in Athletics |
| **Streetwise** | Insight and Stealth, and advantage on spotting an ambush in town |
| **Rural** | Survival and Animal Handling, and you can identify edible food or safe water |
| **Military family** | Proficiency with firearms and one tool (gunsmithing or first aid) |
| **Bookworm** | +1 skill of your choice and +1 Intelligence |
| **Bilingual / immigrant** | An extra language, Insight, and advantage when reading people |
| **Night owl** | Dim-light vision 30 ft, and no penalty when resting by day |
| **Local legend** | You know Kessler Falls: shortcuts, people and keys (advantage when finding your way and on local lore) |

The **backgrounds** are relabelled: Acolyte → Churchgoer, Criminal → Record, Sage → Grad Student, Soldier → Veteran.

## 4. The dead (evolving)

Zombies get stronger and stranger as the days pass. The engine knows the day count and offers the DM only the variants that exist so far.

| Appears | Variant | Notes |
|---|---|---|
| Day 0 | **Fresh turned** | They still lurch at a jog for the first day, then slow down. |
| Day 0 | **Shambler** | Slow (20 ft) and weak alone. The bite infects. |
| Day 1 | **Crawler** | A torso under cars and in tall grass. Stealthy, with a bite to the ankles. |
| Day 1 | **Horde** (swarm) | A Large or Huge mass. Grapples and drags you down. |
| Day 7 | **Bloater** | Bursts into a sickening cloud when killed. |
| Day 7 | **Riot dead** | Cops and Guard in body armour: high AC, shoot for the head. |
| Day 14 | **Screamer** | Shrieks and raises the noise level to the maximum. Kill it first. |
| Day 21 | **Runner** | Fast and rare. Every encounter becomes a chase. |
| Day 30 | **Brute** | A huge, mutated thing. Boss tier. |

The living:
- **Raiders:** a thug, a gunman and a leader, all with guns.
- **Feral dogs.**
- **Cordon soldiers.**
- **Desperate survivors.**

## 5. Survival rules (enforced by the engine, not just narrated)

| System | Rule |
|---|---|
| **Firearms** | New weapon property: **loud**. Original stats, for example: pistol 1d10 (50/150 ft), revolver 2d4+, shotgun 2d6 (close range), hunting rifle 2d8 (loading), carbine 2d6, crossbow and compound bow 1d8 (**quiet**). Each shot **uses up 1 round** of the matching ammunition. With no ammo, you can't fire. |
| **Noise** | Each area has a noise level from 0 to 10:<br>- Gunshot: +3 (+1 with a suppressor)<br>- Explosion: +5<br>- Breaking glass: +2<br>- Car alarm: +4<br>- Shouting: +1<br><br>Noise drops by 1 for every 10 quiet minutes. At **4**, wanderers arrive. At **7**, a pack. At **10**, a **horde** converges, and the engine tells the DM what is coming. |
| **Bites and infection** | A zombie bite that hits forces a CON save. If you fail, you are **infected**, and a clock starts on the game clock:<br>- **Fever:** you gain exhaustion over the hours<br>- **Delirium**<br>- **Death and turning**, after 24–72 hours (rolled and kept hidden)<br><br>There is **no known cure**. Cutting off the limb within an hour of a bite there stops the infection, at a permanent cost. A rumoured antiviral in the Ventara lab is a story goal. |
| **Food and water** | You need 1 food and 1 water a day, taken from your inventory automatically when the day changes. Each meal or drink you miss adds a level of exhaustion. Cold weather without shelter counts as a missed need. |
| **Rest** | A long rest needs a **secured** spot: barricaded, quiet and dark. Resting anywhere else risks being interrupted, with the noise level and time of night as modifiers. |
| **Scavenging** | A `scavenge` tool rolls on a loot table for that kind of place (pharmacy, gas station, house, police station, hospital, farm…). It costs time and adds noise, and searching more thoroughly finds more but takes longer and is riskier. Shelves already emptied stay empty. |
| **Barricades** | A new map tile, **barricade**, with its own HP. You build it from materials (planks, nails, furniture) and time. Hordes attack it. |
| **Night** | More of the dead are out, sight is limited, and a flashlight draws attention. |

## 6. Look and feel

- **Pixel art in the same style:**
  - Modern ground (asphalt, sidewalk, lawn, linoleum, carpet, concrete).
  - Objects (cars and wrecks, shopping carts, shelves, fridges, desks, beds, chain-link fences, barricades, dumpsters, gas pumps).
  - Zombie sprites for each variant, with modern clothes on people (hoodies, scrubs, uniforms, turnout coats).
  - Modern gear in hand (pistol, rifle, bat, fire axe, crowbar).
- **World map:** a stylised map of the valley, showing the river, both bridges, the road grid, the districts and Route 9.
- **Audio:** the same system plus a few new tracks (an empty town, wind, distant groans, the radio).
- **Interface:** the same layout. The rules language changes ("Techniques", "Professions"). The sheet gains an infection status and food and water days, and later a Group/Base tab.
- **Language:** everything in English and Spanish.

## 7. Group and base (later, through the story)

You start alone. Survivors join through the story.
- **Survivors:** each one has a profession, a morale from 0 to 10, needs, a skill they bring, and a sprite and portrait.
- **The base:** any building you secure. It has:
  - **Fortification level**
  - **Stockpiles:** food, water, medicine, ammo, fuel
  - **Upgrades:** rain catcher, garden, radio, workshop, infirmary, watchtower
  - **Events:** horde assaults, raiders, sickness, people who want to leave

## 8. Build phases

1. **Phase 1: first playable**
   - **Setup and identity:** the ruleset in setup ("Zombie apocalypse"), the profession, origin and background names (EN/ES), and the feature replacements.
   - **Content:** the techniques with item costs, modern equipment, firearms with ammo and the loud property, the early zombies, raiders and dogs.
   - **World and art:** the Kessler Falls world map, modern pixel art and zombie sprites, and the DM's setting and rules in the prompt.
2. **Phase 2: survival engine.** Noise and hordes, infection, food, water and rest, scavenging, barricades, and the variants that appear over time.
3. **Phase 3: survivors, then the base.**

Existing fantasy campaigns are not touched.
