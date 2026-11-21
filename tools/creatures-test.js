// Checks what the creatures have in common (src/js/08-creatures.js): ways of getting around, walking by one,
// and the list of kinds the game runs. The Hollow and the Stills have suites of their own; what is checked here
// is what the next creature will stand on, so it is checked with ways and a creature that belong to this file:
// a way that fits vents and uses no hatches, a way that uses the hatches and fits no vent, and a walker that is
// added to the list of kinds as a new creature would be.
const { openGame, startGame } = require('./browser-harness.js');

const failures = [];
function check(description, condition, detail) {
  const line = (condition ? 'ok    ' : 'FAIL  ') + description + (detail !== undefined ? '  ' + JSON.stringify(detail) : '');
  console.log(line);
  if (!condition) failures.push(description);
}

// Helpers that run inside the page, kept on `window.lab`.
const labSource = String(function () {
  const d = window.lastReturnDebug, lab = {};
  // The same doors open for both as open for the Hollow, so that what they reach can be held against what it reaches.
  const opensAsForTheHollow = function (door) { return d.canHollowOpenDoor(door); };
  lab.small = d.createCreatureWay({ key: 'testSmall', canOpenDoor: opensAsForTheHollow, fitsVents: true, usesHatches: false });
  lab.tall = d.createCreatureWay({ key: 'testTall', canOpenDoor: opensAsForTheHollow, fitsVents: false, usesHatches: true });
  lab.hollowWay = d.creatureWays.filter(function (way) { return way.key === 'hollow'; })[0];
  lab.unreachable = 32000; // NAVIGATION_UNREACHABLE (02-world.js)
  lab.tileCount = lab.hollowWay.tileBlocks.length;
  lab.isVentTile = function (index) { return d.isVentAt(index % d.gridWidth + 0.5, Math.floor(index / d.gridWidth) + 0.5); };
  lab.partOfTile = function (index) { return d.getHollowPartAt(index % d.gridWidth + 0.5, Math.floor(index / d.gridWidth) + 0.5); };
  // How far it is from everywhere to a tile, by a way: a field of its own each time.
  lab.fieldFor = function (way, targetIndex, useCrawlspace) {
    const field = new Int16Array(lab.tileCount);
    d.computeWayDistanceField(way, field, targetIndex, useCrawlspace);
    return field;
  };
  // A vent of the station that is loaded, and the floor it opens onto: { ventIndex, floorIndex }, the tile just
  // inside one of its ends and the tile of the room in front of that. Null for a station without a vent.
  lab.findVentMouth = function () {
    for (let index = 0; index < lab.tileCount; index++) {
      if (!lab.isVentTile(index)) continue;
      const tileX = index % d.gridWidth, tileZ = Math.floor(index / d.gridWidth);
      for (const step of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const beside = (tileZ + step[1]) * d.gridWidth + tileX + step[0];
        if (!lab.isVentTile(beside) && lab.partOfTile(beside) !== 0 && d.findNearestWalkableTileIndex(tileX + step[0] + 0.5, tileZ + step[1] + 0.5) === beside) return { ventIndex: index, floorIndex: beside };
      }
    }
    return null;
  };
  // A generated station for these checks: quiet (nothing arrives by itself, nothing catches anybody), the mains
  // on so that the powered doors open, and every way told how the doors stand.
  lab.station = function (seed) {
    if (!d.loadStation('generated', seed, 'large', 'mixed', 'two')) return false;
    d.game.flags.hasLeftLift = true; d.game.flags.powerOn = true;
    d.setDebugOption('invulnerable', true); d.setDebugOption('holdArrivals', true);
    d.hollow.isActive = false;
    d.refreshCreatureDoorBlocks();
    return true;
  };

  // A creature of this file's own, added to the list of kinds the way a new creature is.
  lab.calls = { updates: 0, seconds: 0, held: 0, resets: 0, heard: [], climbs: 0 };
  lab.walker = Object.assign(d.createCreatureLegs(lab.small), {
    figure: d.createFigureOfKind('dummy'), isThere: false, target: null, speed: 4,
    // (Through the ceiling in no time at all: how a crawl looks and sounds is each creature's own affair.)
    climbIntoHatch: function (fromHatch, toHatch) { lab.calls.climbs++; lab.walker.figure.x = toHatch.x; lab.walker.figure.z = toHatch.z; }
  });
  d.creatureKinds.push({
    key: 'testWalker',
    update: function (dt) {
      lab.calls.updates++; lab.calls.seconds += dt;
      const walker = lab.walker;
      if (walker.isThere && walker.target) d.moveCreatureToward(walker, walker.target.x, walker.target.z, walker.speed, dt);
      if (walker.isThere) d.updateFigureCapsules(walker.figure);
    },
    holdStill: function () { lab.calls.held++; },
    reset: function () { lab.calls.resets++; lab.walker.isThere = false; lab.walker.target = null; lab.walker.fieldTargetIndex = -1; },
    hear: function (x, z, radius) { lab.calls.heard.push([x, z, radius]); },
    walkers: function (into) { if (lab.walker.isThere) into.push(lab.walker); }
  });
  lab.placeWalker = function (way, x, z) {
    const walker = lab.walker;
    walker.way = way; walker.fieldTargetIndex = -1; walker.target = null;
    walker.figure.x = x; walker.figure.z = z; walker.isThere = true;
  };
  // Sends the walker somewhere and lets time pass until it is there (within `nearEnough` metres) or the time is
  // up. Says what was seen of it on the way.
  lab.walkTo = function (x, z, mostSeconds, nearEnough) {
    const walker = lab.walker, seen = { arrived: false, seconds: 0, wasInAVent: false, wasBehindAShutDoor: false, climbs: 0 };
    const climbsBefore = lab.calls.climbs;
    walker.target = { x: x, z: z };
    for (let time = 0; time < mostSeconds && !seen.arrived; time += 0.25) {
      d.simulate(0.25);
      seen.seconds = time + 0.25;
      const index = Math.floor(walker.figure.z) * d.gridWidth + Math.floor(walker.figure.x);
      if (lab.isVentTile(index)) seen.wasInAVent = true;
      if (walker.way.tileBlocks[index] === 1) seen.wasBehindAShutDoor = true;
      seen.arrived = Math.hypot(walker.figure.x - x, walker.figure.z - z) < nearEnough;
    }
    seen.climbs = lab.calls.climbs - climbsBefore;
    walker.target = null;
    return seen;
  };
  // The first door of a kind that the player is nowhere near, and a walkable spot on one side of it, 1.2 m from its middle.
  lab.findDoor = function (kind) {
    for (const door of d.doors) {
      if (door.kind !== kind || Math.hypot(d.player.x - door.centerX, d.player.z - door.centerZ) < 5) continue;
      for (const step of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) {
        const spot = d.findWalkableSpotNear(door.centerX + step[0], door.centerZ + step[1]);
        if (spot && Math.abs(spot.x - (door.centerX + Math.sign(step[0]))) < 0.01 && Math.abs(spot.z - (door.centerZ + Math.sign(step[1]))) < 0.01) {
          return { door: door, index: Math.floor(door.centerZ) * d.gridWidth + Math.floor(door.centerX), x: door.centerX + step[0], z: door.centerZ + step[1] };
        }
      }
    }
    return null;
  };
  window.lab = lab;
});

(async () => {
  const { browser, page, problems } = await openGame({ dev: true });
  const inGame = (callback, argument) => page.evaluate(callback, argument);
  await startGame(page, false);
  await inGame((source) => (0, eval)('(' + source + ')')(), labSource);

  // --- ways of getting around: what each can reach ---
  // Looked at in stations that have what the rules are about: more than one locked-off part, and a vent.
  // Whichever seeds build such stations; four of them. Each is measured from the floor a vent opens onto, so
  // that the vent is there to be walked into by whatever fits it.
  const reach = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, stations = [];
    for (let seed = 1; seed <= 60 && stations.length < 4; seed++) {
      if (!lab.station(seed)) continue;
      const mouth = lab.findVentMouth();
      if (!mouth) continue;
      const startIndex = mouth.floorIndex;
      const hollowOnFoot = lab.fieldFor(lab.hollowWay, startIndex, false), hollowAnyWay = lab.fieldFor(lab.hollowWay, startIndex, true);
      const small = lab.fieldFor(lab.small, startIndex, true), tall = lab.fieldFor(lab.tall, startIndex, true);
      const seen = { seed: seed, parts: d.getHollowPartCount(), hatches: d.hollowHatches.length, ventsTheHollowWalksTo: 0, ventsForSmall: 0, ventsForTall: 0,
        smallUnlikeHollowOnFoot: 0, tallBeyondTheHollow: 0, hatchesOutOfTallsReach: 0, tilesForTall: 0 };
      const partsForSmall = {}, partsForTall = {};
      for (let index = 0; index < lab.tileCount; index++) {
        const isVent = lab.isVentTile(index), part = lab.partOfTile(index);
        if (isVent && hollowOnFoot[index] < lab.unreachable) seen.ventsTheHollowWalksTo++;
        if (isVent && small[index] < lab.unreachable) seen.ventsForSmall++;
        if (isVent && tall[index] < lab.unreachable) seen.ventsForTall++;
        if (small[index] !== hollowOnFoot[index]) seen.smallUnlikeHollowOnFoot++;
        if (tall[index] < lab.unreachable) seen.tilesForTall++;
        if (tall[index] < lab.unreachable && hollowAnyWay[index] >= lab.unreachable) seen.tallBeyondTheHollow++;
        if (part !== 0 && small[index] < lab.unreachable) partsForSmall[part] = true;
        if (part !== 0 && tall[index] < lab.unreachable) partsForTall[part] = true;
      }
      for (const hatch of d.hollowHatches) if (tall[hatch.index] >= lab.unreachable) seen.hatchesOutOfTallsReach++;
      seen.partsForSmall = Object.keys(partsForSmall).length; seen.partsForTall = Object.keys(partsForTall).length;
      if (seen.parts > 1 && seen.ventsTheHollowWalksTo > 0) stations.push(seen);
    }
    return stations;
  });
  check('there are stations to look at: more than one locked-off part, and a vent', reach.length === 4, reach.map((seen) => seen.seed));
  check('a way that fits vents and uses no hatches goes exactly where the Hollow goes on foot: through the vents, and into no other locked-off part',
    reach.length > 0 && reach.every((seen) => seen.smallUnlikeHollowOnFoot === 0 && seen.ventsForSmall === seen.ventsTheHollowWalksTo && seen.partsForSmall === 1), reach);
  check('a way that uses the hatches and fits no vent reaches no vent, nowhere the Hollow cannot, and every hatch: so every locked-off part',
    reach.length > 0 && reach.every((seen) => seen.ventsForTall === 0 && seen.tallBeyondTheHollow === 0 && seen.hatchesOutOfTallsReach === 0 && seen.partsForTall === seen.parts && seen.tilesForTall > 100), reach);

  // --- a door that shuts, shuts for a way; and the way knows ---
  const doorBlocks = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab;
    d.loadStation('classic', 0);
    d.game.flags.hasLeftLift = true; d.game.flags.powerOn = false;
    d.setDebugOption('invulnerable', true); d.setDebugOption('holdArrivals', true);
    d.refreshCreatureDoorBlocks();
    const powered = lab.findDoor(d.doorKinds.powered), keycard = lab.findDoor(d.doorKinds.keycard), automatic = lab.findDoor(d.doorKinds.automatic);
    if (!powered || !keycard || !automatic) return null;
    const seen = { withoutMains: [lab.small.tileBlocks[automatic.index], lab.small.tileBlocks[powered.index], lab.small.tileBlocks[keycard.index]], versionBefore: lab.small.version };
    d.game.flags.powerOn = true;
    d.simulate(0.2); // (the doors are gone over every frame, and the ways with them)
    seen.withMains = [lab.small.tileBlocks[automatic.index], lab.small.tileBlocks[powered.index], lab.small.tileBlocks[keycard.index]];
    seen.versionAfter = lab.small.version;
    return seen;
  });
  check('a way counts the doors that are shut to it: without the mains the powered and the keycard door, with the mains only the keycard door, and it says so when that changes',
    doorBlocks !== null && doorBlocks.withoutMains.join() === '0,1,1' && doorBlocks.withMains.join() === '0,0,1' && doorBlocks.versionAfter > doorBlocks.versionBefore, doorBlocks);

  // --- the list of kinds: the game runs whatever is in it ---
  const lifecycle = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, calls = lab.calls, seen = {};
    d.loadStation('classic', 0);
    d.game.flags.hasLeftLift = true;
    d.setDebugOption('invulnerable', true); d.setDebugOption('holdArrivals', true);
    seen.kinds = d.creatureKinds.map(function (kind) { return kind.key; });
    let before = calls.resets;
    d.startOver();
    seen.resetsOnANewDescent = calls.resets - before;
    before = calls.updates; calls.seconds = 0;
    d.simulate(1);
    seen.updatesInASecond = calls.updates - before; seen.secondsGiven = Math.round(calls.seconds * 100) / 100;
    calls.heard.length = 0;
    d.emitNoise(41.5, 47.25, 9);
    seen.heard = calls.heard.slice();
    d.setDebugOption('freezeCreatures', true);
    before = calls.updates; const heldBefore = calls.held;
    d.simulate(0.5);
    seen.updatesWhileFrozen = calls.updates - before; seen.heldWhileFrozen = calls.held - heldBefore;
    d.setDebugOption('freezeCreatures', false);
    return seen;
  });
  // (The director is the first thing in the list: it is run before the creatures it paces, so that what it
  // decides in a frame is what they go by in that frame. src/js/08-director.js)
  // (The others are in the order of their files: the Stills of 08-entities.js, the Hollow of 08-hollow.js, and so on.)
  check('a creature added to the list of kinds is one of them, after the ones the game has: the director first, then the creatures it has, the Stills and the Hollow among them',
    lifecycle.kinds.indexOf('director') === 0 && lifecycle.kinds.indexOf('stills') > 0 && lifecycle.kinds.indexOf('hollow') > 0 && lifecycle.kinds.indexOf('testWalker') === lifecycle.kinds.length - 1, lifecycle.kinds);
  check('the game runs it without knowing it: reset once for a new descent, updated every frame with the time that has passed, told of a noise with where it was and how far it carries',
    lifecycle.resetsOnANewDescent === 1 && lifecycle.updatesInASecond >= 29 && lifecycle.updatesInASecond <= 31 && Math.abs(lifecycle.secondsGiven - 1) < 0.05 &&
    JSON.stringify(lifecycle.heard) === '[[41.5,47.25,9]]', lifecycle);
  check('with the creatures frozen it is not updated, and is told to hold still instead', lifecycle.updatesWhileFrozen === 0 && lifecycle.heldWhileFrozen > 0, lifecycle);

  // --- doors open for what stands at them, as its way says ---
  const doors = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, seen = {};
    d.loadStation('classic', 0);
    d.game.flags.hasLeftLift = true; d.game.flags.powerOn = true;
    d.setDebugOption('invulnerable', true); d.setDebugOption('holdArrivals', true);
    d.simulate(0.2);
    const automatic = lab.findDoor(d.doorKinds.automatic), keycard = lab.findDoor(d.doorKinds.keycard);
    if (!automatic || !keycard) return null;
    seen.shutBefore = [automatic.door.openFraction, keycard.door.openFraction];
    lab.placeWalker(lab.small, automatic.x, automatic.z);
    d.simulate(2);
    seen.automaticWithItThere = automatic.door.openFraction;
    lab.walker.isThere = false;
    d.simulate(4);
    seen.automaticWithItGone = automatic.door.openFraction;
    lab.placeWalker(lab.small, keycard.x, keycard.z);
    d.simulate(2);
    seen.keycardWithItThere = keycard.door.openFraction;
    lab.walker.isThere = false;
    return seen;
  });
  check('a door opens for a creature that stands at it if its way says so, and shuts again behind it; a door its way does not open stays shut in its face',
    doors !== null && doors.shutBefore.join() === '0,0' && doors.automaticWithItThere > 0.9 && doors.automaticWithItGone === 0 && doors.keycardWithItThere === 0, doors);

  // --- walking by a way ---
  // In a station as above. The small one is sent into a vent from some twenty-five steps away. The tall one
  // starts on the floor that vent opens onto and is sent to a hatch in another locked-off part, which it can
  // only get to through the ceiling; on the way it must keep out of every vent.
  const walks = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab;
    for (let seed = 1; seed <= 60; seed++) {
      if (!lab.station(seed)) continue;
      const mouth = lab.findVentMouth();
      if (!mouth) continue;
      const toTheVent = lab.fieldFor(lab.small, mouth.ventIndex, true), tallOnFoot = lab.fieldFor(lab.tall, mouth.floorIndex, false);
      // Where the small one starts: the floor that is nearest to twenty-five steps from the vent.
      let fromIndex = -1;
      for (let index = 0; index < lab.tileCount; index++) {
        if (toTheVent[index] >= lab.unreachable || lab.isVentTile(index)) continue;
        if (fromIndex < 0 || Math.abs(toTheVent[index] - 25) < Math.abs(toTheVent[fromIndex] - 25)) fromIndex = index;
      }
      const farHatch = d.hollowHatches.filter(function (hatch) { return tallOnFoot[hatch.index] >= lab.unreachable; })[0];
      if (fromIndex < 0 || toTheVent[fromIndex] < 10 || !farHatch) continue;
      const placeOf = function (index) { return { x: index % d.gridWidth + 0.5, z: Math.floor(index / d.gridWidth) + 0.5 }; };
      const seen = { seed: seed, stepsToTheVent: toTheVent[fromIndex] };
      d.teleport(d.playerStart.x, d.playerStart.z, 0);
      lab.placeWalker(lab.small, placeOf(fromIndex).x, placeOf(fromIndex).z);
      seen.small = lab.walkTo(placeOf(mouth.ventIndex).x, placeOf(mouth.ventIndex).z, 20 + toTheVent[fromIndex], 0.3); // (right into it, not up to its mouth)
      lab.placeWalker(lab.tall, placeOf(mouth.floorIndex).x, placeOf(mouth.floorIndex).z);
      seen.tall = lab.walkTo(farHatch.x, farHatch.z, 240, 0.9);
      lab.walker.isThere = false;
      return seen;
    }
    return null;
  });
  check('sent into a vent, a creature whose way fits vents walks there, in about the time the distance takes at its speed, through no door that is shut to it',
    walks !== null && walks.small.arrived && walks.small.wasInAVent && !walks.small.wasBehindAShutDoor && walks.small.seconds < 10 + walks.stepsToTheVent / 4 * 1.6, walks);
  check('sent to a hatch in another locked-off part, a creature whose way uses the hatches gets there through the ceiling, and one that fits no vent sets foot in none on the way',
    walks !== null && walks.tall.arrived && walks.tall.climbs >= 1 && !walks.tall.wasInAVent && !walks.tall.wasBehindAShutDoor, walks);

  check('no script errors were reported', problems.length === 0, problems);
  await browser.close();

  if (failures.length > 0) {
    console.log('\n' + failures.length + ' check(s) failed.');
    process.exit(1);
  }
  console.log('\nAll creature checks passed.');
})().catch((error) => { console.error('Creature test crashed:', error); process.exit(1); });
