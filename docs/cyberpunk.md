# DungeonHarness: *Root Access* (cyberpunk hacker ruleset). Design draft

This is a third ruleset next to D&D fantasy and *The Quiet*. It keeps the 5e core (d20, AC, HP, skills, advantage, levels 1–20) and tells a hacker story in an invented Latin American megacity in the 2060s. There is no magic.
- **Classes:** the twelve classes become twelve **hacking styles**. Everyone can jack in; the class decides how you hack and what you do when the fight is physical.
- **Programs:** spells become programs, loaded into **RAM**.
- **Origins:** species become origins.
- **Three meters:** the story runs on three meters the engine keeps: **Hat** (white to black), **Heat** (how hard they're looking for you) and **Humanity** (what the chrome has cost you).

Your decisions so far:

| Topic | Decision |
|---|---|
| Classes | Hacking styles: everyone jacks in; the class is the style |
| Hacking | Tactical net runs on a network map, with ICE, programs and a trace clock |
| Hat | A sliding scale from white to black, with grey in the middle |
| Den | Upgrades with real effects, rent, and raids when Heat is high. Setbacks, never game over |
| City | A Latin American coastal megacity, invented, in an unnamed country |
| Tone | Chosen at setup: neon noir, grim or satire |
| Cyberware | Each implant costs Humanity, and running low brings episodes |
| Opening | Burned: your crew sold you out, you owe a fixer, and you hold a stolen shard |

---

## 1. The city: Marea

Marea is a coastal megacity of about 14 million people. The year is 2068. The sea took the old centre a canal at a time. The corporations moved up the hills and sold everything else back to the city: water, air and security.

Its districts, which make up the world map:

| District | What's there | Why it matters |
|---|---|---|
| **Los Anegados** (The Drowned, the old town) | Half-flooded colonial streets, canals, stilt houses, noodle stalls, your **first den** | Home turf, gangs and cheap rooms |
| **Tianguis Cromo** (Chrome Market) | A street market of second-hand decks, chrome, ripperdoc chairs and stolen code | Shopping, black market and contacts |
| **Cerro Antena** (Antenna Hill) | A favela of antennas and a pirate mesh: the free net | The hacktivists, and a place to hide |
| **La Cúspide** (The Summit) | Corporate arcologies on the hills behind private security, with clean air by subscription | The big runs, and the money |
| **Distrito Bolsa** (Financial) | Banks, the data vaults, the exchange | Heists |
| **El Puerto** | An automated container port with smugglers and drone yards | Smuggling and hardware |
| **Las Plantas** | The **Aguas Marea** desalination and water plants | Water decides who lives; the main mystery |
| **Ciudad Universitaria** | The university and the **Vantis Neural** AI lab | Where the shard came from |
| **The edges** | The seawall, the old satellite ground station, the Ferro detention data centre, the dry barrios | Late-game places and plot |

**Factions:**
- **Vantis Neural.** Makes the neural jacks almost everyone has.
- **Aguas Marea S.A.** The water monopoly. It decides which barrios get water each day.
- **Grupo Ferro.** A security contractor that *is* the police in every district that can pay.
- **La Red Libre.** Hacktivists on Antenna Hill: white and grey hats who leak and protect.
- **Los Ahogados.** The Drowned's gang. They run the black market and buy and sell data.
- **DCI (the Cybersecurity Directorate).** The state cyber police. They hunt black hats and also hire white ones.
- **La Tía.** Your fixer. You owe her. She is patient, until she isn't.

**The opening (canon the DM keeps): Day 0, "Burned."**
- **The job:** your crew, led by **Santi Varela**, hits a Vantis lab server for a client nobody names. You pull out a **data shard**.
- **The betrayal:** on the way out Santi sells you to Grupo Ferro. You escape with the shard, a burned identity, and a cracked deck.
- **Where you start:** La Tía hides you in a rented capsule room above a noodle stall in Los Anegados. You now owe her the rent and the favour.
- **What everyone wants:** the shard is encrypted, and Vantis, Ferro, Los Ahogados and someone signing as **ECO** all want it.

**Mysteries** (revealed slowly):
- What is on the shard.
- Why Santi sold you out, and to whom.
- Who ECO is. Messages arrive at 3:00 a.m., always from a node that shouldn't exist.
- Why the barrios' water cuts follow a pattern.
- Why children from an old Vantis jack trial keep disappearing.

The hat you grow into decides what you do with the truth: leak it, sell it, or use it.

**Tone** is a setup choice that the DM's style follows:
- **Neon noir:** gritty with wit, and the default.
- **Grim:** bleak, with small costly wins.
- **Satire:** corporate absurdity played for dark laughs.

---

## 2. The classes (twelve hacking styles)

The class id stays the same (`wizard`, `rogue`…), so levelling, hit dice, saves and proficiencies all keep working. Only names, descriptions and some features change; "Same" means the mechanics are unchanged.

**Everyone can jack in.** Every character has a neural jack (from their origin) and can use a **deck**:
- **Basic hacks:** d20 + Intelligence + proficiency, if proficient with decks, + the deck's tier.
- **Built-in programs:** every deck also carries two built-in programs as charges.

Casting classes run many more programs, and stronger ones, from their own RAM. The rest of the classes hack in their own way (on site, by force, through a drone) and carry the physical side of the job.

| Class | Hacking style (EN / ES) | How they hack | Their physical side | Key renames and replacements |
|---|---|---|---|---|
| Wizard | **Netrunner** / Netrunner | The widest program library, learnt from a **Codebook** | Fragile; relies on drones and crew | Spellbook → **Codebook**. Arcane Recovery → **Cache Recovery** (recover RAM on a short rest). Evocation → **ICE Breaker** (offence); homebrew → **Architect** (traps, admin control, defending systems) |
| Warlock | **Leashed** / Atado(a) | Code lent by a patron, beyond their own skill | A neural lash at anyone with implants | Patron → **The Leash**: ECO, the rogue AI (Great Old One); **The Corp** (Fiend: power for loyalty); **The Ghost**, a dead hacker's uploaded mind (Archfey). Pact Magic → **Borrowed Code** (back on a short rest). Eldritch Blast → **Leash Lash**. Invocations → **Exploits**. Boons: Blade → Monowire, Chain → Daemon, Tome → Zero-Day Archive |
| Sorcerer | **Wetwired** / Cableado(a) | Innate: a jack implanted in childhood. Hacks by touch, without a deck | Tough mind | Sorcery Points → **Overclock**. Metamagic → **Overclock tricks** (Subtle = no trace tick, Twinned = two nodes). Draconic → **Prototype** (hardened neural: resists psychic). Wild Magic → **Glitch** (a surge table) |
| Rogue | **Infiltrator** / Infiltrado(a) | On site: air-gapped systems, physical ports, badge clones | Stealth, locks, a knife in the dark | Sneak Attack → **Exploit** (also against ICE). Thieves' Cant → **Street Code**. Cunning Action and Uncanny Dodge are the same. Thief → **Ghost**. Arcane Trickster → **Hardware Hacker** (a few programs; hacks cameras, locks and drones in reach) |
| Bard | **Social Engineer** / Ingeniero(a) social | People, not machines: phishing, pretexting, deepfakes | Talks the guard out of the door | Bardic Inspiration → **Pretext**. Song of Rest → **Debrief**. Vicious Mockery → **Doxx**. Lore → **OSINT** (knows everything about a target). Homebrew → **Influencer** (followers, crowds) |
| Ranger | **Drone Jockey** / Piloto de drones | Through a drone that flies to the port they need | Overwatch with a rifle | Beast Master → **Drone Rigger**: a drone companion that grows with your level (spider, quadrotor or rollerbot chassis). Favored Enemy → **Known Systems**. Natural Explorer → **Home Turf** (a district). Hunter → **Skip Tracer** (finds people through their data trail) |
| Druid | **Biohacker** / Biohacker | Wetware: nanites, chems, riding other bodies' senses | Swarms and toxins | Wild Shape is **replaced** with **Ride-Along**: take over a drone, a robot dog or a camera network for a while (stat blocks by level). Druidic → **Lab Slang**. Land → **Street Alchemist** (chems); Moon → **Wetware Rider** (stronger ride-alongs). Many techniques use up chems |
| Cleric | **Ripperdoc** / Matasanos | Repairs code as well as flesh: reboots crashed allies | Keeps the crew alive | Channel Divinity → **Hard Reboot**: cure dumpshock, or an **EMP Pulse** that drives back drones and robots (replaces Turn Undead). Domains → **Clinics**: Life → **Street Clinic**; Knowledge → **Neurosurgeon** (installs and removes chrome, restores Humanity). Healing uses up med supplies |
| Paladin | **Code-Sworn** / Juramentado(a) | Holy-warrior hacker bound by a code | Front line, in the net and out | Oath → **Code**: Devotion → **Disclosure** (white hat: protect people, expose the truth); Vengeance → **Burn It Down** (black hat: tear the system down); Ancients → **Free Net** (grey). Divine Sense → **Threat Scan**. Lay on Hands → **Patch Kit** (heals and cures dumpshock). Divine Smite → **Payload** (spend RAM for damage, physical or net). Aura → **Firewall Aura**. **Your Code is tied to the Hat meter**: drifting against it suspends Payload until you atone, or you turn |
| Fighter | **Solo** / Solo | Brute force: a deck with good firewalls and nothing fancy | The muscle: guns, armour, tactics | Fighting Style, Second Wind, Action Surge and Extra Attack are the same. Champion → **Merc**. Battle Master → **Tactician**. Eldritch Knight → **Netblade** (a fighter who also runs programs) |
| Barbarian | **Chromed** / Cromado(a) | Breaks the hardware ("percussive maintenance" opens a node) | Combat implants at full redline | Rage → **Overdrive** (resistance and extra damage; at low Humanity it risks an episode). Unarmored Defense → **Subdermal Plating**. Danger Sense → **Threat Sensors**. Reckless Attack is the same. Berserker → **Redline**. Totem → **Animal Chrome** (bear, wolf or eagle mods) |
| Monk | **Edgerunner** / Edgerunner | Reflex wiring; a hit can shut down an implant | Bullet-time, wall-runs, bare hands | Ki → **Reflex**. Martial Arts, Flurry and Patient Defense are the same. Step of the Wind → **Wall-run**. Deflect Missiles → **Bullet-time** (the only class that deflects bullets). Stunning Strike → **Nerve Strike** (also turns off an implant). Open Hand → **Dojo**. Shadow → **Ghost Step** (bursts of optical camo) |

Every subclass gets this treatment: the SRD subclass and the homebrew one are renamed and reflavoured. A feature that can't be read as cyberpunk is replaced with something of equal power. The full feature-by-feature list is part of Phase 1.

### Programs (what replaces spells)

- **They are spells.** Programs are entries in the spell engine, with the same slots, levels, attacks, saves and damage. Slots are called **RAM**. You **load** programs from your codebook at the den, the way spells are prepared.
- **Net or both.** Each program is tagged **net** or **both**:
  - A **net** program works only inside a network, or against a device with a wireless port in range.
  - A **both** program also works in the physical world.
- **Hacking on the street.** In the physical world, a hacker can hit **anything wireless in range**: cameras, locks, turrets, cars, drones, and people with wireless implants (most Ferro guards). Each such hack raises Heat in the district.
- **Items.** Some techniques also use up an item, as in *The Quiet*: a Ripperdoc's healing uses med supplies, a Biohacker's chems use reagents, a Social Engineer's deepfake uses a burner ID.
- **Examples of program families:**
  - **Sledgehammer:** raw damage to ICE (the magic missile family).
  - **Worm:** damage over time.
  - **Ghost:** ICE can't see you.
  - **Mirror:** decoy signatures.
  - **Backdoor:** open a firewall without a trace tick.
  - **Spoof:** an ICE or a guard's implant takes you for a friend.
  - **Daemon:** a summoned helper program.
  - **Blackout:** cut the power to an area.
  - **Lock-on:** mark a target.
- **Coverage.** Every class that runs programs gets about 8–14 of them for levels 0–5. Higher levels come later.

## 3. Origins (instead of species)

Everyone is human and has a neural jack. Your origin gives you what a species used to:

| Origin | Benefit |
|---|---|
| **Barrio kid (Antenna Hill)** | Stealth and Insight; you always find a free-mesh access point |
| **Corp brat (La Cúspide)** | Persuasion and +1 Charisma; an old corp ID that still opens a few doors |
| **Drowned-born** | Athletics (swimming) and Perception; you know the canals |
| **Port family** | Proficiency with vehicles, Deception, and contacts at the port |
| **Vantis trial kid** | An experimental jack: +1 RAM and resistance to psychic damage. **Vantis wants you back.** |
| **Ex-Ferro** | Firearms and light armour, and advantage on spotting patrols and security routines |
| **Campus dropout** | +1 Intelligence and +1 skill of your choice |
| **Coast-road nomad** | Survival and driving, and +1 Constitution |

The **backgrounds** are relabelled: Criminal → Record, Sage → Researcher, Soldier → Ex-Ferro, Urchin → Barrio Kid, Noble → Corp Heir.

## 4. Net runs (enforced by the engine)

Jacking in opens a **network map**. It is drawn with the same map and combat engine as a dungeon, with a glowing net tileset. **Your body stays where you jacked in**, so the den is safe, a café on site less so, and a port in the target's own basement least of all.

```
  [ENTRY]──[FIREWALL]──[CAMERAS]
               │            │
          (Black ICE)   [DOORS]
               │
           [ADMIN]────[VAULT ★]

  TRACE ▓▓▓▓░░░░░░  4/10      RAM ●●●○
```

**Node types:**

| Node | What it does |
|---|---|
| **Entry** | Where you come in |
| **Firewall** | A gate: breach it with a check or a program (a failed breach adds to the trace) |
| **Data** | Paydata to sell, intel, passwords and keys |
| **Control** | Cameras, doors, turrets, lights, alarms, lifts. **Changes the physical world**, which matters when the crew is inside |
| **Admin** | Root: lowers the trace and switches off ICE |
| **Vault** | The objective |
| **Honeypot** | A trap that looks like data: +3 trace |

**ICE fights you like monsters.** AC is its firewall rating and HP is its integrity.

| ICE | Effect |
|---|---|
| **Watchdog** (white) | Raises the trace |
| **Barrier** (white) | Blocks a path |
| **Sparky** (grey) | Stuns, wipes a loaded program |
| **Tar Pit** (grey) | Holds you so you can't jack out |
| **Hellhound / Wraith** (black) | **Psychic damage to your real HP.** Black ICE can kill |

A human **sysadmin** NPC can join late in a run, as a rival hacker.

**The trace clock** (from 0 to 10, like noise in *The Quiet*):

| Event | Trace |
|---|---|
| Each action inside a node | +1 |
| A "loud" program | +2 |
| A failed breach | +2 |
| A honeypot | +3 |
| Taking an Admin node | −3 |

Den proxies ignore the first ticks of each run.

| Trace | What happens |
|---|---|
| **5** | The sysadmin is alerted and joins |
| **8** | Security is sent to wherever your body is, if you're on site |
| **10** | You are **dumped**: dumpshock (psychic damage, stunned), **Heat +3**, and a roll to see whether they found your den |

**Jacking out:**
- Jacking out on purpose takes an action.
- **The van:** while you run, the crew acts in the physical world at the same time, on alternating turns, so a door you open in the net opens for them.

## 5. The three meters

| Meter | Range | Moves with | What it does |
|---|---|---|---|
| **Hat** | Black −10 … +10 white (grey −3 to +3) | Every job and choice. Leaking corporate crimes, protecting people and reporting a flaw move it toward white. Ransomware, selling personal data and harm to bystanders move it toward black. Robbing a corp to feed a barrio is grey. | Who hires you: Bureau and bug-bounty work if white; ransomware and data brokers, better paid, if black. Who sells you gear: licensed and reliable if white; exotic black-market chrome if black. Which crew stay. The ending. The Code-Sworn's oath. |
| **Heat** | 0–10 | Traces, black-hat jobs, witnesses and street hacks raise it; lying low lowers it by 1 a day | 3: prices rise and La Tía turns cautious. 6: Ferro sweeps through your district. 8: **a raid on your den**. 10: **a bounty**, and the hunters come. |
| **Humanity** | Starts at 10 + Wisdom | Each implant costs 1–6. Therapy or removing chrome gives it back. | ≤ 10: a crit fail or a bad shock (0 HP, a death you caused) calls for a Wisdom save, or you have an **episode**: you lose a turn, lash out or freeze. ≤ 5: ordinary people sense it (disadvantage on Persuasion) and the crew worries. 0: a **Fracture**: the crew steps in, one implant comes out, and you wake up in a clinic in debt. A setback, never the end. |

**Cyberware** goes in body slots: neural, eyes, arms, legs, skin and internal. Original pieces include:
- **Hawk Eye** optics
- **Quick Nerve** reflex wiring (initiative)
- **Pangolin Skin** (AC)
- **Crane Arm** (hydraulic)
- **Retractable blades**
- **Filter lungs** (for the toxic air in the dry barrios)
- **RAM expansion**
- **Voice modulator** (deepfake voice)
- **Biomonitor**

A Ripperdoc can install them anywhere. Anyone else needs a clinic chair or the den's med bay.

## 6. The den and the economy

You start in a capsule room above a noodle stall in Los Anegados. **Rent** is weekly. Missing it becomes debt to La Tía: first she takes a cut of every job, then she takes your upgrades.

**Upgrades** (bought with cred; each has a real effect):

| Upgrade | Effect |
|---|---|
| **Deck tier** (carried) | Tier 1–3: +1/+2/+3 to hacks and program DCs; tiers 2 and 3 also give +1 RAM |
| **RAM rack** | +1 program slot per level |
| **Cooling** | Overclock without overheating on long runs |
| **Proxy chain / uplink** | The first 2 ticks of each run are ignored; hack far targets without going on site |
| **Faraday mesh and a steel door** | Raid defence, and they're less likely to find the den when you're dumped |
| **Sleep pod** | Better long rests (+1 Humanity per week of good sleep) |
| **Med bay** | Install chrome and heal at home |
| **Botnet rig** | Cred every day while you sleep. The black-hat version earns more and raises Heat; the white-hat version (a render farm) earns less, cleanly |
| **Workbench** | **Write new programs** (learn spells with cred and days of downtime) and build gear |
| **Cameras and a turret** | Raid defence |
| **Hidden exit** | Escape a lost raid without losing everything |

**Raids** reuse the siege engine. Ferro squads, gangs or bounty hunters attack the den, and your defences matter. Lose one, and 1–2 upgrades are seized and you must **move**: a new den, where the fixed defences start over. Whatever you carry stays with you.

**Gigs** come through La Tía, factions and job boards. Each one shows its pay, risk, likely **hat** shift and **heat**. Kinds:
- Data heist
- Sabotage
- Exposé or leak
- Ransom
- Bug bounty
- **Defence**: a reverse run where you protect a client's system from another hacker
- Extraction: the physical world plus net support
- Skip trace: find a person

## 7. The crew (through the story)

You start alone, with La Tía on the phone. Crew members join through the story (reusing the survivor and group system):
- **What each one has:** a class, a **hat preference**, loyalty, and a skill they bring (driver, face, muscle, medic, a second runner).
- **When they leave:** drift too far from someone's hat and they leave, or worse, sell you out the way Santi did.
- **In fights:** they fight beside you, but you stay the protagonist, the same balance as fantasy allies.

## 8. Look and feel

- **Pixel art in the same style:**
  - **The city:** wet asphalt, canals, stilt houses, neon signs, holo-ads, market stalls, capsule rooms, server racks, drones.
  - **The net:** a tileset of a glowing grid, node icons and ICE sprites.
  - **Characters:** sprites with visible chrome.
  - Previews come before anything is applied.
- **World map:** a stylised map of Marea showing the sea, the canals, the hills, the districts and the seawall.
- **Audio:** rain, synth pads, market noise, the hum of the net, and the 3:00 a.m. ECO tone.
- **Interface:** the same layout. The sheet gains **Hat, Heat and Humanity** meters, cyberware slots and RAM, and a **Den** tab replaces the base.
- **Language:** everything in English and Spanish.

## 9. Build phases

1. **Phase 1: first playable.**
   - **Setup:** the ruleset in setup (cyberpunk, with the tone choice).
   - **Identity:** class, origin and background names (EN/ES) and their feature replacements.
   - **Content:**
     - the programs, with net/both tags;
     - cyberware;
     - modern weapons (reusing the zombie firearms and ammo).
   - **Engine:** the Hat, Heat and Humanity meters.
   - **World and art:** the map of Marea, the DM's setting and rules in the prompt, the "Burned" opening on Day 0, and the city pixel art.
2. **Phase 2: net runs.**
   - **The run:** network maps and nodes, ICE, the trace clock, jacking in and out, and dumpshock.
   - **The street:** hacking anything wireless in range.
   - **Art:** the net tileset.
3. **Phase 3: the den and economy.** Upgrades, rent and debt, the botnet, writing programs, raids, and relocation.
4. **Phase 4: the crew.** Hat preferences, loyalty, betrayal, and runs from the van.

Existing fantasy and zombie campaigns are not touched.

**Still open:**
- the city's name (Marea is a placeholder);
- how fast Heat rises at each difficulty;
- whether a fully black or white hat locks out any class or subclass.
