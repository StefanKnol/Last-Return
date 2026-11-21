## Ideas to (possibly) implement

- Logo and favicon
- More screenshots in readme
- Live game test option for people to test new features and provide feedback (github issue feedback instead of bug)
  - in game bug reporting or feedback instead of github issue, direct in game with screenshot of current location (no menu's)?

- ~~health system~~ (in: 09-health.js)
  - ~~not instant death on being caught, monster gives chance to escape after attack~~ (a hit, a moment of grace, and what hit you holds off)
  - ~~health items to be found (physics based)~~ (first aid kits, a few to a station, used with Q)
  - still open: hurt by a fall (the drop in a vent costs nothing but noise), hurt by what the Hollow throws back, a first aid kit to buy in the shop, the others seeing how hurt you are

- inventory
  - ~~pockets for the tools: four of them, for scan grenades and first aid kits; R puts away, 4 to 7 take out; dropped where you die~~ (in: 08-pockets.js)
  - ~~the survey spools as things you carry or pocket and bring to the lift~~ (found when first in the beam, loaded by the terminal out of pockets, beam and off the floor beside it)
  - ~~core samples the same way~~ (carried in the beam, too long for a pocket; the terminal takes them)
  - the rule: only what unlocks something (keycards) and what is tiny (crew badges) is taken with E; everything else a work order asks for is a thing in the world
  - still open: a spool or core sample the Hollow or a looter does something of its own with

- shop in item collection mode (repo mode)
  - what the tools sell for is set already and is meant to be far below what they cost: a scan grenade 15, a scanner tripod 60, a first aid kit 20

- Even better models
  - player models (overdone and funny, only visible when scanning)
    - a body a player can wear is made in the workshop now (creature tool, "A body a player can wear"); still to do: choosing one, and telling the others which
  - ~~Workshop creature builder, creating new creatures and shaping them (with more body options)~~ (shapes on a skeleton's bones: boxes, balls, capsules, cylinders, cones)
    - more skeletons than the two there are (four legs, no legs, a small thing)
    - generalize creature movements, crouching, etc
    - aggression levels
    - behavior

- random work order numbers and letters
  - same for shaft number and rooms, allowing the same room multiple times with different indicator?
- random 'locations' to go along with work orders (not just Kessel-9 pumping annex)
  - random objectives and rooms tied to location types? pumping annex has shaft 9, others might not. 
- captions as setting, not for normal play (and then for more things, for accessibility)
- scan colors customizable (3 levels, close, medium, far)


- more random objectives
  - item collection, multi-stage generators, activate and escape
    - in drop off bays damage on items off, so they're safe inside
  - only relevant objectives on map
  - fuel not always required (already a thing it seems)
  - multiple generators, could be only objective (3 or more if only objective, random fuel required per generator)
  - fuel spawn closer to generators, not across the map and back
    - ~~fuel as object to carry with physics engine~~
  - REPO item collection
    - collecting items with value until target is reached
    - multiple stages, lower levels unlock with stages
      - stages generated as they unlock? not all at once? bigger levels but performant
      - only load level around player, not whole level for performance
    - shop at collection points or between levels (vending machines with limited stock and items randomly as well?)

- more monsters to vary threat or increase it
  - what they share is in place (08-creatures.js: ways of getting around, walking, hearing, the list of kinds); each is its own file of behaviour
  - a few of the harmless ones from the start of a descent, how many by threat level (left alone by the crew, in lore)
  - ~~lidar monster produces dots around it on everything, but can see the player~~ (in: the Surveyor, 08-surveyor.js. Deaf, sees by its own light, strikes once and runs, dazzled by light in its eye)
  - ~~not all of them from the start: one first, either one, and more as time goes~~ (in: 08-arrivals.js, an order drawn for every descent)
    - nearly 2 m: no vents, but the ceiling hatches. A cone of pulses from its face, more of them while it hunts
    - hits once and runs off (wants the health system)
  - ~~small monster (the looter)~~ (in: 08-looter.js. Still open below: summoning others, throwing things, being thrown)
    - under a metre: walks through vents, cannot reach a hatch. Its nest is in a vent
    - moves objects (including what you need, chaseable and interruptable to get item back): from an open bay, the fuel can
    - out of your hands only if it can reach: held up high it tries and cannot
    - scared off by sound (by how loud: startled first, backing away, and frightened by louder or by a second noise)
    - ~~likes what you have handled or carry best, so it goes for the salvage bays~~ (in)
    - ~~a thing taken back from it, it wants back: waits a moment, then comes for it again~~ (in)
    - ~~mad, not scared, at whoever is in its vents~~ (in: it scolds, and then it bites)
    - makes noise to summon other monsters (hits objects, walks in vents, etc.)
    - throws things at the player when angered (throwing the small monster or hitting it with stuff)
    - fetches a bigger monster if the player pisses it off enough?
  - ~~more vents for it: more of them, T-junctions and crossings, dead ends~~ (done; a vent may lead round a lock now: slow, loud, and not everything fits)
  - ~~one way down from the upper level to the lower~~ (done: a vent with a drop in it)
    - temporary: a keycard door opens from its inner side without the card (`keycardDoorsOpenFromInside`), or the drop is a trap. To be replaced by a proper way back out
    - the Hollow and the other creatures do not use the drop yet
  - levels one above the other (rooms over rooms), which the station cannot hold today: a tile has one floor and one ceiling
    - ~~the half that is about "how near": a thing is in a space, and a ceiling in between halves a noise, stops a touch and lightens a presence~~ (in: "Spaces", 08-creatures.js; the Hollow above the ceiling is the first to use it)
    - still open, and the big half: several floors to a tile in the world itself (walls, floors, path finding, what a scan hits, the generator, the map on screen)
  - ~~the scanner tripod: an item to find (or buy in the shop later), set down and switched on, that scans what is in front of it in pulses. The same system the scanning monster will see by, and a way to try it first~~ (in: 08-loose-objects.js, and fireScanCone in 09-scan-cone.js)
    - still open: to buy in the shop; a tripod that warns you when something walks into its light; the Hollow knocking over or breaking a tripod it has found out about (for now it only loses interest)
  - other types of blind monsters with different systems for it
  - kidnapping monster that moves a player somewhere else

- more cave like rooms for deeper levels (or different locations)
  - ~~rooms that are not a box~~ (in: "Paint tiles" in the workshop's room tool. Rock, and a floor and a ceiling for every tile; `src/js/03-workshop-rooms.js`)
    - still open: floor you can see and not walk to (a ledge, a hollow), which a station would have to know to leave nothing on; real pits in a room; a crawl that is not a vent; slanted and round walls
  - ~~locations with a theme of their own~~ (in: "Place" on the title screen, `src/js/03-locations.js`. The mine is the first: its own rooms, drifts for corridors, rock and brick for walls. Same job in each: power, cards, the last room)
    - ~~winding passages and caverns that are grown instead of drawn, for caves~~ (in: the cave, the third place. `src/js/04-caverns.js`; "Grow a cavern" in the workshop's room tool)
    - still open: medieval, playground; lines and recordings for a place that calls the rooms dispatch names something else (more generic lines, or a recording per place); things lying about that belong to the place; its own sounds; a place editor in the workshop (a place is a table in the source for now)
    - still open for the cave: the rooms the job is about are still the annex's rooms inside it, with what the cave has done to them on top (`roomDressing`); passages that slope; a way through that is water
    - ~~a room that is not the same room in every station~~ (in: "How often it is there" on every thing in a workshop room; ten kinds of grown cavern; twelve rooms of the mine's own)
  - caves
  - bones and fossils
  - mineshafts with deadly drops
  - open field with houses :P
  - limiting certain rooms to level sizes

- extract hard-coded rooms to json files (with a few exceptions?)

- 'event' periods with event decorations
  - christmas
  - halloween
  - easter
  - april fools, metal pipe sound effect pipe item

- multiplayer? (mostly for item collection, like extraction looters), more interesting with the opened github issue <https://github.com/StefanKnol/No-Return/issues/14>
  - joining by lobby code 
  - dev backdoor to mess with people :P (play/direct the monsters, play sounds, control doors, disco mode with random lidar dots coming out of a disco ball and music)
    - only on same server host, not other hosted
    - statistics of players (anonymous, but survival time, playtime and count, etc.)
  - different body shapes to choose from, as skins

### Implemented
~~- Slower detection of beam pointed at monster, so a tap doesn't immediately end in death but raises the monsters 'anger' level.~~
- ~~Better sounds, better monster growl, less 16bit-like audio~~
- ~~Actual voice lines over radio (generated, bad radio filter)~~
- ~~procedural level & objectives generation + bigger levels (multi-story)~~
~~- Better monster AI, more suspense~~
  ~~- Alien isolation like type;~~
    ~~- The Director AI (Macro AI / "The Brain"): This system always knows the player's exact location, but it acts as a restraint rather than an omniscient cheat. It guides the Xenomorph toward the player's general area and manages a "menace gauge" to control pressure, pulling the alien away or giving the player a breather when stress peaks.
      - not much change here :P~~
    ~~- The Xenomorph / Stalker AI (Micro AI / "The Body"): This part controls the physical creature, making it hunt strictly using line-of-sight, sound, and search nodes rather than teleporting or cheating its way to you.
      - the Hollow AI; no line-of-sight, but sound and beam detection etc, as is.
      - Could add more growling and crawling across walls and ceilings?~~
~~- less long-lived scanner dots on mobile things (doors already seem to remove the dots, figures don't)~~
~~- random object that make sound when walked on and warn the monster~~
~~- Hollow can go through locked doors, though small chance, shouldn't be a thing, give alternative ways to get around (ceiling vents only for the monster? teleport with delay), also opens up player locking doors to get away~~
  ~~- if enough doors are locked in its face it starts breaking them down? (protected doors it can't break down?)~~