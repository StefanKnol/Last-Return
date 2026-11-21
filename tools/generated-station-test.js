// Checks the generated stations: that many of them can be built and finished,
// that a seed always gives the same station, and that one of them plays from lift to lift.
const { openGame, startGame, drawFrames, carryFuelToTank } = require('./browser-harness.js');

const failures = [];
function check(description, condition, detail) {
  const line = (condition ? 'ok    ' : 'FAIL  ') + description + (detail !== undefined ? '  ' + JSON.stringify(detail) : '');
  console.log(line);
  if (!condition) failures.push(description);
}

// How many seeds to try for each size. Each one is tried with one of the three layouts in turn,
// and alternately with one level and with two.
const SEEDS_PER_SIZE = Number(process.env.GENERATED_SEEDS || 40);

(async () => {
  const { browser, page, problems } = await openGame();
  const inGame = (callback, argument) => page.evaluate(callback, argument);

  // Describes the first vent of the station that is loaded: its tiles, and the two places where it opens into a
  // room (a vent tile with ordinary floor next to it). It runs inside the page, so it is handed over as text.
  const describeFirstVent = function () {
    const debug = window.lastReturnDebug, level = debug.level;
    const tiles = [], mouths = [];
    for (let z = level.boundsMinimumZ; z < level.boundsMaximumZ; z++) for (let x = level.boundsMinimumX; x < level.boundsMaximumX; x++) {
      if (!debug.isVentAt(x + 0.5, z + 0.5) || debug.zoneNames[debug.getZoneAt(x + 0.5, z + 0.5)] !== 'VENT') continue;
      tiles.push([x, z]);
      for (const step of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const beside = [x + step[0] + 0.5, z + step[1] + 0.5];
        const spot = debug.findWalkableSpotNear(beside[0], beside[1]);
        if (spot && spot.x === beside[0] && spot.z === beside[1] && !debug.isVentAt(beside[0], beside[1])) {
          mouths.push({ mouthX: x + 0.5, mouthZ: z + 0.5, roomX: beside[0], roomZ: beside[1], stepX: -step[0], stepZ: -step[1] });
        }
      }
    }
    return { seed: level.seed, ventCount: level.ventCount, tileCount: tiles.length, mouths: mouths.slice(0, 2), mouthCount: mouths.length,
      headroom: tiles.length ? debug.getHeadroomAt(tiles[0][0] + 0.5, tiles[0][1] + 0.5) : 0, ventHeight: debug.ventHeight };
  };

  // What follows is asked of stations in general, a hundred and twenty of them: these are built as the game
  // builds them, with every room and every loose thing the workshop made. (The checks further down that walk
  // through one particular station go back to stations built from the code alone: browser-harness.js.)
  await inGame(() => window.lastReturnDebug.setWorkshopContentUsed(true));

  // --- a seed is a promise, part one: note what a few seeds build while the page is still cold ---
  // (A browser runs code differently once it has warmed up. Anything in the planner that leans on that, such as
  // a sort with a random number inside its comparison, shows up as a station that differs between now and later.)
  const promisedSeeds = [[2, 'large', 'mixed', 'one'], [3, 'large', 'sprawling', 'two'], [7, 'medium', 'mixed', 'two'], [11, 'small', 'tight', 'one'], [5, 'massive', 'mixed', 'two']];
  const buildPrints = (seeds) => inGame((list) => list.map((entry) => {
    window.lastReturnDebug.loadStation('generated', entry[0], entry[1], entry[2], entry[3]);
    return window.lastReturnDebug.getStationFingerprint();
  }), seeds);
  const coldPrints = await buildPrints(promisedSeeds);

  // --- many stations: every one must be buildable and finishable in the intended order ---
  const jobTotals = { fuel: 0, cores: 0, breaker: 0, generators: 0 };
  const ventTotals = { stations: 0, junctions: 0, crossings: 0, pockets: 0, roundALock: 0, branches: 0, twoLevels: 0, withADrop: 0, dropsOnOneLevel: 0 };
  for (const sizeKey of ['small', 'medium', 'large']) {
    const result = await inGame(([size, seedCount]) => {
      const debug = window.lastReturnDebug;
      const layouts = ['tight', 'mixed', 'sprawling'];
      const bad = [];
      let roomTotal = 0, loopTotal = 0, stairTotal = 0, twoLevelCount = 0, ventTotal = 0, withVent = 0;
      const jobs = { fuel: 0, cores: 0, breaker: 0, generators: 0 };
      const vents = { stations: 0, junctions: 0, crossings: 0, pockets: 0, roundALock: 0, branches: 0, twoLevels: 0, withADrop: 0, dropsOnOneLevel: 0 };
      for (let seed = 1; seed <= seedCount; seed++) {
        const layout = layouts[seed % 3], levels = seed % 2 === 0 ? 'two' : 'one';
        const wasBuilt = debug.loadStation('generated', seed, size, layout, levels);
        const found = wasBuilt ? debug.auditLayout().concat(debug.auditProgression()).concat(debug.auditHollowRoutes()).concat(debug.auditNoisyFloor()).concat(debug.auditVents()) : ['no plan could be made'];
        if (wasBuilt) {
          // What its vents come to: where three or four ways meet, dead ends, and whether one leads round a lock.
          const measured = debug.measureVents();
          vents.stations++; vents.junctions += measured.junctions; vents.crossings += measured.crossings;
          vents.pockets += debug.level.ventPockets.length; vents.branches += debug.level.ventBranchCount;
          if (measured.floorThroughVents > measured.floorOnFoot) vents.roundALock++;
          // A vent that goes down to the lower level, one way: only where there is a lower level.
          if (levels === 'two') { vents.twoLevels++; if (debug.level.ventDrops.length > 0) vents.withADrop++; }
          else vents.dropsOnOneLevel += debug.level.ventDrops.length;
        }
        // A two-level station must have its shaft a flight of stairs down; a one-level station must be flat.
        const shaftFloor = debug.getFloorHeightAt(debug.findInteractable(5).x, debug.findInteractable(5).z);
        if (wasBuilt && levels === 'two' && !(shaftFloor < 0 && debug.level.stairCount >= 1)) found.push('two levels were asked for but the shaft is at ' + shaftFloor);
        if (wasBuilt && levels === 'one' && (shaftFloor !== 0 || debug.level.stairCount !== 0)) found.push('one level was asked for but the shaft is at ' + shaftFloor);
        if (found.length > 0) bad.push({ seed: seed, layout: layout, levels: levels, problems: found.slice(0, 4) });
        roomTotal += debug.level.roomCount; loopTotal += debug.level.loopCount;
        ventTotal += debug.level.ventCount; if (debug.level.ventCount > 0) withVent++;
        if (debug.level.mission.needsFuel) jobs.fuel++;
        if (debug.level.mission.coreCount > 0) jobs.cores++;
        if (debug.level.mission.needsBreaker) jobs.breaker++;
        if (debug.level.mission.extraGenerators.length > 0) jobs.generators++;
        if (levels === 'two') { twoLevelCount++; stairTotal += debug.level.stairCount; }
      }
      return { bad: bad, averageRooms: Math.round(roomTotal / seedCount), averageLoops: Math.round(loopTotal / seedCount * 10) / 10,
        averageStairs: Math.round(stairTotal / Math.max(1, twoLevelCount) * 10) / 10,
        averageVents: Math.round(ventTotal / seedCount * 10) / 10, withVent: withVent, jobs: jobs, vents: vents };
    }, [sizeKey, SEEDS_PER_SIZE]);
    check(SEEDS_PER_SIZE + ' ' + sizeKey + ' stations, half of them with two levels: all can be built, walked and finished in order (about ' +
      result.averageRooms + ' rooms and corridors, ' + result.averageLoops + ' extra ducts, ' + result.averageVents + ' vents, ' + result.averageStairs + ' stairs each)', result.bad.length === 0, result.bad.slice(0, 3));
    check('at least three in four ' + sizeKey + ' stations have a vent', result.withVent >= SEEDS_PER_SIZE * 0.75, result.withVent + ' of ' + SEEDS_PER_SIZE);
    jobTotals.fuel += result.jobs.fuel; jobTotals.cores += result.jobs.cores; jobTotals.breaker += result.jobs.breaker; jobTotals.generators += result.jobs.generators;
    for (const key in ventTotals) ventTotals[key] += result.vents[key];
  }

  // (Every one of those stations was also checked vent by vent: a tile wide, crawl height, the mouths it should
  // have, dead ends that are dead ends, all of it reachable. And every one can be finished in order on foot,
  // with every vent shut: nothing hangs on a vent. What is asked here is that the vents are more than tunnels
  // from one room to another.)
  check('across those stations vents meet (one ends on another, so that three ways meet there), some have a dead end off their side, and in some a vent leads round a lock: floor you could not walk to with every lock shut',
    ventTotals.branches >= 10 && ventTotals.junctions >= ventTotals.branches + ventTotals.pockets && ventTotals.pockets >= 10 && ventTotals.roundALock >= 5, ventTotals);
  check('at least one in four of the stations with two levels has a vent that goes down to the lower one, and no station with one level has such a thing',
    ventTotals.withADrop >= ventTotals.twoLevels / 4 && ventTotals.dropsOnOneLevel === 0, ventTotals);

  check('across those stations every kind of extra job turns up (fuel, core samples, winch breaker, more generators)',
    jobTotals.fuel > 5 && jobTotals.cores > 5 && jobTotals.breaker > 5 && jobTotals.generators > 5, jobTotals);

  // --- another place: the same job, somewhere that is not the pumping annex ---
  // Every location the game has but the annex is tried (src/js/03-locations.js). What is asked of each is what
  // its own entry there says of it, not what any one of them happens to be.
  const otherPlaces = await inGame(() => Object.keys(window.lastReturnDebug.locations).filter((key) => key !== 'annex'));
  check('there is somewhere to go down besides the pumping annex', otherPlaces.length > 0, otherPlaces);
  for (const placeKey of otherPlaces) {
    const place = await inGame(([locationKey, seedCount]) => {
      const debug = window.lastReturnDebug, location = debug.locations[locationKey], annex = debug.locations.annex;
      const layouts = ['tight', 'mixed', 'sprawling'], sizes = ['small', 'medium', 'large'];
      // What the tiles of the station that is loaded are made of: how many of each, corridors apart from the rest.
      const countLooks = function () {
        const counts = { corridor: {}, other: {} };
        for (let z = debug.level.boundsMinimumZ; z < debug.level.boundsMaximumZ; z++) for (let x = debug.level.boundsMinimumX; x < debug.level.boundsMaximumX; x++) {
          const look = debug.getLookAt(x + 0.5, z + 0.5);
          if (look === '') continue;
          const zoneName = debug.zoneNames[debug.getZoneAt(x + 0.5, z + 0.5)] || '';
          const group = zoneName.indexOf(location.corridorName + ' ') === 0 || zoneName.indexOf(annex.corridorName + ' ') === 0 ? counts.corridor : counts.other;
          group[look] = (group[look] || 0) + 1;
        }
        return counts;
      };
      const bad = [], annexBad = [];
      let sameMapAsAnnex = 0, renamedRooms = 0;
      for (let seed = 1; seed <= seedCount; seed++) {
        const size = sizes[seed % 3], layout = layouts[seed % 3], levels = seed % 2 === 0 ? 'two' : 'one';
        // The annex first, for this seed: nothing of the other place may have got into it.
        debug.loadStation('generated', seed, size, layout, levels);
        const annexPrint = debug.level.mapFingerprint, annexLooks = countLooks();
        const strangers = debug.getStationRooms().filter((room) => room.isExtra && !debug.isRoomOfLocation(room.key, 'annex')).map((room) => room.name);
        if (debug.level.locationKey !== 'annex' || strangers.length > 0 || Object.keys(annexLooks.corridor).join() !== annex.corridorLook) annexBad.push({ seed: seed, strangers: strangers, corridors: annexLooks.corridor });
        // Then the same seed there.
        const wasBuilt = debug.loadStation('generated', seed, size, layout, levels, undefined, undefined, locationKey);
        const found = wasBuilt ? debug.auditLayout().concat(debug.auditProgression()).concat(debug.auditHollowRoutes()).concat(debug.auditNoisyFloor()).concat(debug.auditVents()) : ['no plan could be made'];
        if (wasBuilt) {
          if (debug.level.locationKey !== locationKey) found.push('it was built in ' + debug.level.locationKey);
          if (debug.level.mapFingerprint === annexPrint) sameMapAsAnnex++;
          const rooms = debug.getStationRooms();
          for (const room of rooms) {
            if (room.isExtra && !debug.isRoomOfLocation(room.key, locationKey)) found.push(room.name + ' does not belong there');
            const ownName = location.roomNames[room.key];
            if (ownName) { renamedRooms++; if (room.name.indexOf(ownName) !== 0) found.push(room.key + ' is called ' + room.name + ', not ' + ownName); }
            if (room.key === 'corridor' && room.name.indexOf(location.corridorName + ' ') !== 0) found.push('a corridor is called ' + room.name);
          }
          const looks = countLooks();
          if (Object.keys(looks.corridor).join() !== location.corridorLook) found.push('its corridors are made of ' + Object.keys(looks.corridor).join(' and '));
          if (debug.getIntroLines().join(' ').indexOf(String(seed)) < 0 || (location.introLines && debug.getIntroLines()[0] !== location.introLines[0])) found.push('the lines before the descent are ' + debug.getIntroLines().join(' / '));
        }
        if (found.length > 0) bad.push({ seed: seed, size: size, layout: layout, levels: levels, problems: found.slice(0, 4) });
      }
      return { label: location.label, bad: bad, annexBad: annexBad, sameMapAsAnnex: sameMapAsAnnex, renamedRooms: renamedRooms, hasOtherNames: Object.keys(location.roomNames).length > 0 };
    }, [placeKey, Math.max(12, Math.round(SEEDS_PER_SIZE * 0.75))]);
    check(place.label + ': stations there can be built, walked and finished in order, with the rooms, the names, the corridors and the first lines that belong there',
      place.bad.length === 0 && (!place.hasOtherNames || place.renamedRooms > 0), { bad: place.bad.slice(0, 3), renamedRooms: place.renamedRooms });
    check(place.label + ': the same seed is another station there than in the annex, and the annex has nothing of it', place.sameMapAsAnnex === 0 && place.annexBad.length === 0,
      { sameMapAsAnnex: place.sameMapAsAnnex, annexBad: place.annexBad.slice(0, 3) });
  }

  // --- what is grown instead of drawn (src/js/04-caverns.js) ---
  // A cavern: grown from a number, the same from the same number, another from another; and whatever grows, a
  // room that keeps the rules a painted one keeps (every door of it can be walked to, all of its floor is built).
  const grown = await inGame(() => {
    const debug = window.lastReturnDebug;
    const doors = [{ wall: 'west', at: 5 }, { wall: 'east', at: 4 }, { wall: 'south', at: 6 }, { wall: 'north', at: 2 }];
    const bad = [], seen = {};
    let boxes = 0, least = 1;
    for (let number = 1; number <= 150; number++) {
      const room = debug.growCavernRoom(12, 10, 3, doors, number, { fill: 0.4 + (number % 5) * 0.03 });
      if (!room.tiles) { boxes++; continue; }
      const shape = debug.resolveDesignedRoomShape(room), text = room.tiles.join('');
      const openShare = 1 - (text.split('#').length - 1) / text.length;
      least = Math.min(least, openShare);
      if (shape.cutOffDoors.length > 0 || shape.sealedCount > 0 || room.tiles.length !== 10 || room.tiles.some((row) => row.length !== 12)) bad.push({ number: number, cutOff: shape.cutOffDoors, sealed: shape.sealedCount });
      for (const door of [[0, 5], [11, 4], [6, 9], [2, 0]]) if (room.tiles[door[1]].charAt(door[0]) !== '.') bad.push({ number: number, door: door, is: room.tiles[door[1]].charAt(door[0]) });
      seen[text] = true;
    }
    const again = debug.growCavernRoom(12, 10, 3, doors, 7, { fill: 0.44 }), same = debug.growCavernRoom(12, 10, 3, doors, 7, { fill: 0.44 });
    return { bad: bad.slice(0, 3), boxes: boxes, different: Object.keys(seen).length, least: Math.round(least * 100) / 100, sameFromSameNumber: JSON.stringify(again) === JSON.stringify(same) };
  });
  check('a cavern grown from a number is the same from the same number and another from another, and every one is a room that can be walked: all doors, all of its floor',
    grown.bad.length === 0 && grown.boxes <= 3 && grown.different >= 140 && grown.least >= 0.3 && grown.sameFromSameNumber, grown);

  // A passage that winds: in a place whose corridors are passages, a corridor is not the rectangle it was planned
  // as (rock is left standing in it), no two stations wind alike, and the same seed winds the same way twice.
  const windingPlaces = await inGame(() => Object.keys(window.lastReturnDebug.locations).filter((key) => window.lastReturnDebug.locations[key].corridorStyle === 'passage'));
  for (const placeKey of windingPlaces) {
    const winding = await inGame((locationKey) => {
      const debug = window.lastReturnDebug, location = debug.locations[locationKey];
      // The corridors of the station that is loaded, as text: a line a row of the map, '+' where a corridor's floor is.
      const drawCorridors = function () {
        const rows = [];
        let floor = 0;
        for (let z = debug.level.boundsMinimumZ; z < debug.level.boundsMaximumZ; z++) {
          let row = '';
          for (let x = debug.level.boundsMinimumX; x < debug.level.boundsMaximumX; x++) {
            const isCorridor = debug.getLookAt(x + 0.5, z + 0.5) !== '' && (debug.zoneNames[debug.getZoneAt(x + 0.5, z + 0.5)] || '').indexOf(location.corridorName + ' ') === 0;
            row += isCorridor ? '+' : ' ';
            if (isCorridor) floor++;
          }
          rows.push(row);
        }
        return { text: rows.join('\n'), floor: floor };
      };
      let planned = 0, plannedTiles = 0, dug = 0, differentKinds = 0;
      const drawings = [];
      for (let seed = 1; seed <= 6; seed++) {
        debug.loadStation('generated', seed, 'medium', 'mixed', seed % 2 === 0 ? 'two' : 'one', undefined, undefined, locationKey);
        const first = drawCorridors();
        drawings.push(first.text);
        dug += first.floor;
        const rooms = debug.getStationRooms();
        planned += rooms.filter((room) => room.key === 'corridor').length;
        plannedTiles += rooms.filter((room) => room.key === 'corridor').reduce((sum, room) => sum + room.plannedTiles, 0);
        // Two caverns of one kind in the same station are not the same cavern.
        differentKinds += debug.getGrownShapes().filter((shape, index, all) => all.some((other, otherIndex) => otherIndex !== index && other.key === shape.key && other.tiles !== shape.tiles)).length;
      }
      debug.loadStation('generated', 3, 'medium', 'mixed', 'one', undefined, undefined, locationKey);
      const again = drawCorridors().text;
      // (How much of what was planned as corridor is floor. The doorways count as the corridor's here, so a little over what was dug.)
      return { corridors: planned, shareDug: Math.round(dug / Math.max(1, plannedTiles) * 100) / 100, sameAgain: again === drawings[2], allDifferent: new Set(drawings).size === drawings.length,
        differentKinds: differentKinds, width: location.corridorWidth || 2 };
    }, placeKey);
    check('in a place with passages for corridors, they wind: narrower than they were planned, no two stations alike, the same seed the same way twice; and two caverns of a kind in one station are two different caverns',
      winding.corridors > 0 && winding.shareDug > 0.35 && winding.shareDug < 0.92 && winding.sameAgain && winding.allDifferent && winding.differentKinds > 0, winding);
  }

  // Where a descent is goes with it: from the title screen into what is built, and to whoever goes down with you
  // (what the host says of the descent is read on the other side as something from a stranger: 11-together.js).
  const carried = await inGame((place) => {
    const debug = window.lastReturnDebug, before = { station: debug.settings.station, place: debug.settings.stationLocation, seed: debug.settings.seedText };
    debug.settings.station = 'generated'; debug.settings.stationLocation = place; debug.settings.seedText = '77';
    const said = JSON.parse(JSON.stringify(debug.describeChosenDescent()));
    const heard = debug.readSharedDescent(said);
    const fromBefore = debug.readSharedDescent(Object.assign({}, said, { locationKey: undefined }));
    const nowhere = debug.readSharedDescent(Object.assign({}, said, { locationKey: 'atlantis' }));
    debug.settings.station = before.station; debug.settings.stationLocation = before.place; debug.settings.seedText = before.seed;
    return { said: said.locationKey, heard: heard && heard.locationKey, fromBefore: fromBefore && fromBefore.locationKey, nowhere: nowhere };
  }, otherPlaces[0]);
  check('the place chosen on the title screen is part of the descent, reaches whoever goes down with you, and a place this game does not have is refused',
    carried.said === otherPlaces[0] && carried.heard === otherPlaces[0] && carried.fromBefore === 'annex' && carried.nowhere === null, carried);

  // --- a seed is a promise: the same seed must give the same station, a different seed a different one ---
  const repeat = await inGame(() => {
    const debug = window.lastReturnDebug;
    debug.loadStation('generated', 4471, 'medium', 'mixed');
    const first = debug.getStationFingerprint();
    debug.loadStation('generated', 4472, 'medium', 'mixed');
    const other = debug.getStationFingerprint();
    debug.loadStation('generated', 4471, 'medium', 'mixed');
    const again = debug.getStationFingerprint();
    return { same: first === again, different: first !== other, wordSeed: debug.chooseSeedFromText('ripley') === debug.chooseSeedFromText('ripley'),
      numberSeed: debug.chooseSeedFromText('4471'), emptySeedsDiffer: debug.chooseSeedFromText('') !== debug.chooseSeedFromText('') };
  });
  check('the same seed builds the same station, and another seed a different one', repeat.same && repeat.different, repeat);
  // Part two of the promise: after well over a hundred stations the page is warm. The same seeds must build the same stations.
  const warmPrints = await buildPrints(promisedSeeds);
  const changed = promisedSeeds.filter((entry, index) => coldPrints[index] !== warmPrints[index]).map((entry) => entry.join('/'));
  check('five seeds build exactly the same stations on a warm page as they did on a cold one', changed.length === 0, changed);
  const plannerSource = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'js', '03-levelgen.js'), 'utf8');
  const riskySorts = plannerSource.match(/\.sort\(function \([^)]*\) \{[^}]*random\(/g) || [];
  check('no sort in the planner has a random number inside its comparison', riskySorts.length === 0, riskySorts);
  check('a typed number is used as the seed, a typed word always gives the same seed, an empty box a new one',
    repeat.numberSeed === 4471 && repeat.wordSeed && repeat.emptySeedsDiffer, repeat);

  await inGame(() => window.lastReturnDebug.setWorkshopContentUsed(false)); // one particular station from here on: from the code alone

  // --- choose the station for the lift-to-lift run below ---
  // It has to have a vent that is the shortest way between the two rooms it joins, so that the Hollow, which
  // always takes the shortest way, can be watched crawling through it. Which seed that is depends on the planner,
  // so the test looks for one instead of trusting a number that was right once.
  const playSeed = await inGame(([describeSource]) => {
    const debug = window.lastReturnDebug, describeFirstVent = (0, eval)('(' + describeSource + ')');
    for (let seed = 1; seed <= 80; seed++) {
      if (!debug.loadStation('generated', seed, 'medium', 'mixed', 'two')) continue;
      const vent = describeFirstVent();
      if (vent.mouths.length !== 2 || vent.tileCount < 3) continue;
      debug.teleport(vent.mouths[0].roomX, vent.mouths[0].roomZ, 0);
      // room, every vent tile, room: one more step than the vent has tiles
      // (The station's own seed is what is typed into the title screen below. It is the seed asked for, unless the
      // tests were told to build other stations: a seed typed into the menu is taken as it is.)
      if (debug.stepsFromPlayerTo(vent.mouths[1].roomX, vent.mouths[1].roomZ) === vent.tileCount + 1) return debug.level.seed;
    }
    return 0;
  }, [String(describeFirstVent)]);
  check('a medium two-level station whose first vent is a real short cut exists among the first 80 seeds', playSeed > 0, playSeed);

  // --- going back to the classic station restores it exactly ---
  const classicAgain = await inGame(() => {
    const debug = window.lastReturnDebug;
    debug.loadStation('classic', 0);
    return { kind: debug.level.kind, problems: debug.auditLayout().concat(debug.auditProgression()).concat(debug.auditHollowRoutes()).concat(debug.auditNoisyFloor()), start: [debug.playerStart.x, debug.playerStart.z], zone: debug.zoneNames[3] };
  });
  check('loading Kessel-9 again after generated stations gives the classic station back',
    classicAgain.kind === 'classic' && classicAgain.problems.length === 0 && classicAgain.start[0] === 6.5 && classicAgain.zone === 'MAIN CORRIDOR A', classicAgain);

  // --- one generated station, played from lift to lift through the real title screen ---
  await page.evaluate(() => document.getElementById('station-generated').click());
  check('choosing "Uncharted annex" shows the size, layout and seed boxes', await page.evaluate(() => !document.getElementById('station-options').hidden));
  await page.selectOption('#title-station-size', 'medium');
  await page.selectOption('#title-station-layout', 'mixed');
  await page.selectOption('#title-station-levels', 'two'); // as the station was chosen above
  await page.fill('#title-seed', String(playSeed));
  await startGame(page, false);
  const loaded = await inGame(() => ({ kind: window.lastReturnDebug.level.kind, seed: window.lastReturnDebug.level.seed, description: window.lastReturnDebug.level.description }));
  check('Begin descent loads the generated station for the typed seed', loaded.kind === 'generated' && loaded.seed === playSeed, loaded);
  // The link works out its address when it is reached for, so there is no need to pause for this.
  const reported = await inGame(() => {
    const link = document.getElementById('link-report-problem');
    link.dispatchEvent(new Event('pointerdown'));
    return Object.fromEntries(new URL(link.href).searchParams);
  });
  // The work orders there are, by name, as the game has them.
  const workOrderLabels = await inGame(() => window.lastReturnDebug.workOrders.map((order) => order.label));
  check('"Report a problem" carries the seed and the station options',
    reported.station === 'Uncharted annex' && new RegExp('^' + playSeed + ', medium, [a-z]+, two levels, work order (' + workOrderLabels.join('|') + '), (with the|no) wait for the lift$').test(reported.seed), reported);

  await page.keyboard.down('KeyW');
  await inGame(() => window.lastReturnDebug.simulate(4));
  await page.keyboard.up('KeyW');
  check('walking forward leaves the lift car', await inGame(() => window.lastReturnDebug.game.flags.hasLeftLift));
  await inGame(() => window.lastReturnDebug.simulate(4));
  check('lift door closes behind the player', (await inGame(() => window.lastReturnDebug.getLiftDoor().openFraction)) === 0);

  // --- the stairs: walk down them on foot, and check the view goes down with the floor ---
  const stairs = await inGame(() => {
    const debug = window.lastReturnDebug, level = debug.level;
    const zone = debug.zoneNames.indexOf('STAIRS');
    let top = null, bottom = null;
    const tiles = [];
    for (let z = level.boundsMinimumZ; z < level.boundsMaximumZ; z++) for (let x = level.boundsMinimumX; x < level.boundsMaximumX; x++) {
      if (debug.getZoneAt(x + 0.5, z + 0.5) !== zone) continue;
      const floor = debug.getFloorHeightAt(x + 0.5, z + 0.5);
      tiles.push({ x: x + 0.5, z: z + 0.5, floor: floor });
      if (!bottom || floor < bottom.floor) bottom = { x: x + 0.5, z: z + 0.5, floor: floor };
    }
    // Stand on the top landing, on the tile nearest the foot (the far end of the landing is the stair door, and a
    // closed door pushes you back out of it), in the same lane as the bottom tile found, facing down the flight.
    for (const tile of tiles) {
      if (tile.floor < -0.01) continue;
      if (!top || Math.hypot(tile.x - bottom.x, tile.z - bottom.z) < Math.hypot(top.x - bottom.x, top.z - bottom.z)) top = tile;
    }
    const alongX = Math.abs(bottom.x - top.x) > Math.abs(bottom.z - top.z);
    if (alongX) top.z = bottom.z; else top.x = bottom.x;
    debug.teleport(top.x, top.z, Math.atan2(bottom.x - top.x, -(bottom.z - top.z)));
    debug.simulate(0.2);
    return { top: top, bottom: bottom, floorAtTop: debug.player.floorY };
  });
  await page.keyboard.down('KeyW');
  const descent = await inGame(() => {
    const debug = window.lastReturnDebug;
    const heights = [];
    for (let step = 0; step < 16; step++) { debug.simulate(0.5); heights.push(Math.round(debug.player.floorY * 100) / 100); }
    return { heights: heights, camera: debug.renderCamera.y, mode: debug.game.mode };
  });
  await page.keyboard.up('KeyW');
  await drawFrames(page, 1);
  const cameraAtFoot = await inGame(() => window.lastReturnDebug.renderCamera.y);
  const neverJumps = descent.heights.every((height, index) => index === 0 || Math.abs(height - descent.heights[index - 1]) < 1);
  // How far down the stairs go differs from station to station, so everything is measured against the foot of this one.
  check('walking down the stairs lowers the floor under you smoothly, all the way to the foot',
    stairs.floorAtTop === 0 && stairs.bottom.floor < -0.2 && Math.abs(descent.heights[descent.heights.length - 1] - stairs.bottom.floor) < 0.05 && neverJumps, { stairs: stairs, descent: descent });
  // Measured against the standing eye height in the tuning, so resizing the player does not break this check.
  const standingEye = await inGame(() => window.lastReturnDebug.tuning.playerHeight*window.lastReturnDebug.tuning.playerEyeHeightToBody);
  const eyeAboveFoot = cameraAtFoot - stairs.bottom.floor;
  check('the view follows the floor down', eyeAboveFoot > standingEye - 0.05 && eyeAboveFoot < standingEye + 0.6,
    { cameraAtFoot: cameraAtFoot, foot: stairs.bottom.floor, standingEye: standingEye });
  await inGame(() => { const debug = window.lastReturnDebug; debug.teleport(debug.playerStart.x, debug.playerStart.z, 0); debug.simulate(0.2); });

  // --- vents: you only fit crouched, it is loud in there, and the Hollow crawls through ---
  // (These checks are about the duct itself. A vent's cover may stand in front of its mouth, and you do not get
  // past one without taking it off: the covers have their own checks, with the loose objects. So here they are cleared away.
  // Only the covers: the survey spools are loose things too, and the walk further down is for them.)
  await inGame(() => { const d = window.lastReturnDebug; for (const cover of d.looseObjects.filter((object) => object.kindKey === 'ventCover')) d.removeLooseObject(cover); });
  const vent = await inGame(([describeSource]) => (0, eval)('(' + describeSource + ')')(), [String(describeFirstVent)]);
  check('a vent is crawl height and opens into a room at each end', vent.mouths.length === 2 && Math.abs(vent.headroom - vent.ventHeight) < 0.01 && vent.tileCount >= 3, vent);
  const enterVent = async (holdCrouch) => {
    const mouth = vent.mouths[0];
    await inGame(([m]) => {
      const debug = window.lastReturnDebug;
      debug.teleport(m.roomX, m.roomZ, Math.atan2(m.stepX, -m.stepZ));
      debug.player.velocityX = 0; debug.player.velocityZ = 0;
      debug.simulate(0.1);
    }, [mouth]);
    if (holdCrouch) await page.keyboard.down('KeyC');
    await page.keyboard.down('KeyW');
    const state = await inGame(() => {
      const debug = window.lastReturnDebug;
      // Two and a half seconds forward. How audible the player is gets noted while they are moving inside the
      // vent, because a vent can bend, and a player stopped against the bend is quiet again.
      let loudestInVent = 0;
      for (let step = 0; step < 25; step++) {
        debug.simulate(0.1);
        if (debug.isVentAt(debug.player.x, debug.player.z) && debug.player.isMoving) loudestInVent = Math.max(loudestInVent, debug.player.audibleRadius);
      }
      return { inVent: debug.isVentAt(debug.player.x, debug.player.z), crouching: debug.player.isCrouching, audible: loudestInVent, eye: Math.round(debug.player.eyeHeight * 100) / 100 };
    });
    if (holdCrouch) {
      // Let go of crouch and keep crawling: there is no room to stand up.
      await page.keyboard.up('KeyC');
      await inGame(() => window.lastReturnDebug.simulate(1));
      Object.assign(state, await inGame(() => ({ stillCrouching: window.lastReturnDebug.player.isCrouching, stillInVent: window.lastReturnDebug.isVentAt(window.lastReturnDebug.player.x, window.lastReturnDebug.player.z),
        eyeAfter: Math.round(window.lastReturnDebug.player.eyeHeight * 100) / 100,
        crouchedEye: window.lastReturnDebug.tuning.playerHeightCrouching * window.lastReturnDebug.tuning.playerEyeHeightToCrouchedBody, // where the eyes are crouched (09-player.js)
        quietLimit: window.lastReturnDebug.tuning.audibleRadiusCrouchWalking, ventLimit: window.lastReturnDebug.tuning.audibleRadiusVentCrawling })));
    }
    await page.keyboard.up('KeyW');
    return state;
  };
  const standing = await enterVent(false);
  check('walking at a vent on your feet does not get you in', standing.inVent === false && standing.crouching === false, standing);
  const crawling = await enterVent(true);
  check('crouched you crawl in, and you stay down in there even when you let go of crouch',
    crawling.inVent && crawling.crouching && crawling.stillInVent && crawling.stillCrouching && Math.abs(crawling.eyeAfter - crawling.crouchedEye) < 0.05, crawling);
  check('crawling in a vent is louder than creeping in a room', crawling.audible === crawling.ventLimit && crawling.ventLimit > crawling.quietLimit, crawling);
  const hollowInVent = await inGame(([mouths]) => {
    const debug = window.lastReturnDebug, hollow = debug.hollow;
    // Out of the vent and out of earshot; then send the Hollow from one end of the vent to the room at the other.
    debug.teleport(debug.playerStart.x, debug.playerStart.z, 0);
    debug.spawnHollow(mouths[0].roomX, mouths[0].roomZ);
    hollow.graceTimer = 999; // it senses nothing: this is only about getting through
    let wasInVent = false, lowestTopAboveFloor = Infinity, mostCrawl = 0, seconds = 0, closest = Infinity;
    for (; seconds < 60 && closest > 1.6; seconds += 0.1) {
      hollow.state = 0; hollow.targetX = mouths[1].roomX; hollow.targetZ = mouths[1].roomZ;
      debug.simulate(0.1);
      const figure = hollow.figure;
      if (debug.isVentAt(figure.x, figure.z)) {
        wasInVent = true;
        let top = 0;
        for (let capsule = 0; capsule < figure.capsuleCount; capsule++) top = Math.max(top, figure.capsules[capsule * 7 + 1] + figure.capsules[capsule * 7 + 6], figure.capsules[capsule * 7 + 4] + figure.capsules[capsule * 7 + 6]);
        // measured two tiles in, once it has had time to get down
        if (debug.isVentAt(figure.x + Math.sin(figure.yaw) * -1.2, figure.z - Math.cos(figure.yaw) * -1.2)) lowestTopAboveFloor = Math.min(lowestTopAboveFloor, top - figure.y);
        mostCrawl = Math.max(mostCrawl, figure.pose.crawl);
      }
      closest = Math.min(closest, Math.hypot(figure.x - mouths[1].roomX, figure.z - mouths[1].roomZ));
    }
    hollow.isActive = false;
    return { wasInVent: wasInVent, lowestTop: Math.round(lowestTopAboveFloor * 100) / 100, mostCrawl: Math.round(mostCrawl * 100) / 100, seconds: Math.round(seconds), closest: Math.round(closest * 10) / 10, mode: debug.game.mode };
  }, [vent.mouths]);
  check('the Hollow goes through the vent on knees and hands and comes out at the other end',
    hollowInVent.wasInVent && hollowInVent.closest <= 1.6 && hollowInVent.mostCrawl > 0.8 && hollowInVent.lowestTop < vent.ventHeight, hollowInVent);

  await inGame(() => { const debug = window.lastReturnDebug; debug.teleport(debug.playerStart.x, debug.playerStart.z, 0); debug.simulate(0.2); });

  // Helpers that work in any station: stand next to a thing, or next to the first door of a kind.
  const standNear = (objectId) => inGame((id) => {
    const debug = window.lastReturnDebug;
    const thing = debug.findInteractable(id);
    const spot = debug.findWalkableSpotNear(thing.x, thing.z);
    debug.teleport(spot.x, spot.z, 0);
    return Math.hypot(spot.x - thing.x, spot.z - thing.z);
  }, objectId);
  const standAtDoorOfKind = (kind) => inGame((doorKind) => {
    const debug = window.lastReturnDebug;
    const door = debug.doors.find((candidate) => candidate.kind === doorKind);
    for (const step of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      // (At its outer side: from its inner side a keycard door opens without the card, which has a check of its own.)
      if (door.insideStepX === step[0] && door.insideStepZ === step[1]) continue;
      const spot = debug.findWalkableSpotNear(door.tileX + 0.5 + step[0], door.tileZ + 0.5 + step[1]);
      if (spot && Math.abs(spot.x - door.tileX - 0.5 - step[0]) < 0.01 && Math.abs(spot.z - door.tileZ - 0.5 - step[1]) < 0.01) {
        debug.teleport(spot.x, spot.z, 0);
        debug.simulate(1.5);
        return door.openFraction;
      }
    }
    return -1;
  }, kind);

  check('a powered door stays shut while the mains is off', (await standAtDoorOfKind(1)) === 0);

  const reachToSpool = await standNear(3);
  await inGame(() => window.lastReturnDebug.use(3));
  check('the first spool is within reach of the floor and opens its log', reachToSpool < 2 && (await inGame(() => window.lastReturnDebug.game.mode)) === 'reading',
    [reachToSpool, await inGame(() => { const d = window.lastReturnDebug; return { mode: d.game.mode, found: d.game.flags.spoolsCollected, loaded: d.game.flags.spoolsLoaded, spools: d.looseObjects.filter((object) => object.kindKey === 'spool').map((object) => [object.questObjectId, object.wasFound, object.looterIndex]) }; })]);
  await page.keyboard.press('KeyE');

  // This station's extra jobs, whatever the seed gave it. The run below does each one where it belongs.
  const mission = await inGame(() => JSON.parse(JSON.stringify(window.lastReturnDebug.level.mission)));
  const missionIds = await inGame(() => window.lastReturnDebug.missionObjectIds);
  console.log('      (this station\'s extra jobs: ' + JSON.stringify(mission) + ')');
  if (mission.needsFuel) {
    await standNear(2);
    await inGame(() => window.lastReturnDebug.use(2));
    const refused = await inGame(() => ({ powerOn: window.lastReturnDebug.game.flags.powerOn, objective: window.lastReturnDebug.game.objectiveText }));
    // The can is a loose thing on a crate: it is taken into the beam, carried to the set and held against it.
    const fuelled = await carryFuelToTank(page, missionIds.fuelCan, 0);
    check('the generator will not start with an empty day tank, and says so; the fuel can is in reach, is carried to it in the beam, and runs out into the tank in about five seconds',
      refused.powerOn === false && /fuel/i.test(refused.objective) && fuelled.reachToCan < 2 && fuelled.isInTheBeam && /hold it against/.test(fuelled.objectiveWithCan) &&
      fuelled.isFull && fuelled.seconds >= 4 && fuelled.seconds <= 6.5 && fuelled.canIsNow === 'empty fuel can' && fuelled.isStillInTheBeam, [refused, fuelled]);
  }
  await standNear(2);
  const hollowWalk = await inGame(() => {
    const debug = window.lastReturnDebug;
    debug.use(2);
    debug.teleport(debug.playerStart.x, debug.playerStart.z, 0);
    debug.simulate(7);
    const appeared = debug.game.flags.powerOn && debug.hollow.isActive;
    let closest = Infinity, seconds = 0;
    for (; seconds < 300 && closest >= 3 && debug.game.mode === 'playing'; seconds++) {
      debug.simulate(1);
      closest = Math.min(closest, Math.hypot(debug.hollow.figure.x - debug.level.generatorApproachX, debug.hollow.figure.z - debug.level.generatorApproachZ));
    }
    debug.hollow.isActive = false;
    return { appeared: appeared, closest: closest, seconds: seconds, mode: debug.game.mode };
  });
  check('the generator restores power and the Hollow appears', hollowWalk.appeared, hollowWalk);
  check('the Hollow finds its way from the shaft to the generator room', hollowWalk.closest < 3, hollowWalk);

  check('the powered door opens once the mains is on', (await standAtDoorOfKind(1)) === 1);
  check('a keycard door stays shut without the card', (await standAtDoorOfKind(2)) === 0);
  await standNear(6);
  await inGame(() => window.lastReturnDebug.use(6));
  check('the keycard door opens with the card', (await standAtDoorOfKind(2)) === 1);

  for (const spool of [4, 5]) {
    await standNear(spool);
    await inGame((id) => window.lastReturnDebug.use(id), spool);
    await page.keyboard.press('KeyE');
    await inGame(() => { window.lastReturnDebug.hollow.isActive = false; });
  }
  check('all three spools can be collected', (await inGame(() => window.lastReturnDebug.game.flags.spoolsCollected)) === 3);

  if (mission.coreCount > 0) {
    await standNear(1);
    await inGame(() => window.lastReturnDebug.use(1));
    const refused = await inGame(() => ({ started: window.lastReturnDebug.game.flags.uploadStarted, uploaded: window.lastReturnDebug.game.flags.spoolsUploaded }));
    for (let core = 0; core < mission.coreCount; core++) {
      await standNear(missionIds.firstCore + core);
      await inGame((id) => window.lastReturnDebug.use(id), missionIds.firstCore + core);
      await inGame(() => { window.lastReturnDebug.hollow.isActive = false; });
    }
    check('the terminal will not take the upload until every core sample is in hand', !refused.started && !refused.uploaded &&
      (await inGame(() => window.lastReturnDebug.game.flags.coresCollected)) === mission.coreCount, refused);
  }
  if (mission.extraGenerators.length > 0) {
    // The lift terminal refuses until every generator runs. Each is walked to; one with an empty tank gets its can first.
    await standNear(1);
    await inGame(() => window.lastReturnDebug.use(1));
    const refused = await inGame(() => ({ started: window.lastReturnDebug.game.flags.uploadStarted, uploaded: window.lastReturnDebug.game.flags.spoolsUploaded,
      objective: window.lastReturnDebug.game.objectiveText }));
    let furthestReach = 0;
    const notFuelled = []; // every can that did not fill the tank it was carried to, with what happened
    for (const generator of mission.extraGenerators) {
      if (generator.needsFuel) {
        const fuelled = await carryFuelToTank(page, generator.fuelCanId, generator.objectId);
        furthestReach = Math.max(furthestReach, fuelled.reachToCan);
        if (!fuelled.isFull) notFuelled.push(fuelled);
      }
      furthestReach = Math.max(furthestReach, await standNear(generator.objectId));
      await inGame((id) => { window.lastReturnDebug.use(id); window.lastReturnDebug.hollow.isActive = false; }, generator.objectId);
    }
    check('the terminal will not call the lift until every generator is running; each can be walked to and started, one with an empty tank once its can has been carried to it',
      !refused.started && !refused.uploaded && /generator/i.test(refused.objective) && furthestReach < 2 && notFuelled.length === 0 &&
      (await inGame(() => window.lastReturnDebug.game.flags.extraGeneratorsRunning)) === mission.extraGenerators.length, { refused: refused, furthestReach: furthestReach, notFuelled: notFuelled });
  }
  // Whatever else this station asks for before the upload (quests added since the checks above were written):
  // the terminal refuses for each in turn, and each of its things can be walked to and used.
  const otherQuests = await inGame(() => window.lastReturnDebug.level.quests
    .filter((quest) => quest.definition.blocks === 'upload' && ['spools', 'cores', 'generators'].indexOf(quest.key) < 0)
    .map((quest) => ({ key: quest.key, objects: quest.objects.map((object) => ({ objectId: object.objectId, needsItem: object.needsItem, itemObjectId: object.itemObjectId })) })));
  for (const quest of otherQuests) {
    await standNear(1);
    await inGame(() => window.lastReturnDebug.use(1));
    const refused = await inGame(() => ({ started: window.lastReturnDebug.game.flags.uploadStarted, uploaded: window.lastReturnDebug.game.flags.spoolsUploaded }));
    let furthestReach = 0;
    for (const object of quest.objects) {
      if (object.needsItem) {
        furthestReach = Math.max(furthestReach, await standNear(object.itemObjectId));
        await inGame((id) => window.lastReturnDebug.use(id), object.itemObjectId);
      }
      furthestReach = Math.max(furthestReach, await standNear(object.objectId));
      await inGame((id) => { window.lastReturnDebug.use(id); window.lastReturnDebug.hollow.isActive = false; }, object.objectId);
    }
    check('the quest "' + quest.key + '": the terminal refuses until it is done, and each of its things can be walked to and used',
      !refused.started && !refused.uploaded && furthestReach < 2 && (await inGame((key) => window.lastReturnDebug.isQuestUnfinished(key), quest.key)) === false, { refused: refused, furthestReach: furthestReach });
  }
  await standNear(1);
  await inGame(() => window.lastReturnDebug.use(1));
  if (mission.needsBreaker) {
    const waiting = await inGame(() => ({ started: window.lastReturnDebug.game.flags.uploadStarted, uploaded: window.lastReturnDebug.game.flags.spoolsUploaded, objective: window.lastReturnDebug.game.objectiveText,
      marked: window.lastReturnDebug.findInteractable(window.lastReturnDebug.missionObjectIds.winchBreaker).isDiscovered }));
    await standNear(missionIds.winchBreaker);
    await inGame((id) => window.lastReturnDebug.use(id), missionIds.winchBreaker);
    check('with the winch breaker open the upload goes through but the lift does not come; closing the breaker calls it',
      waiting.uploaded && !waiting.started && waiting.marked && /breaker/i.test(waiting.objective) && (await inGame(() => window.lastReturnDebug.game.flags.uploadStarted)) === true, waiting);
  }
  // (Whether the car has to come down is one of the station's complications: without it, it is there at once.)
  const upload = await inGame(() => ({ started: window.lastReturnDebug.game.flags.uploadStarted, countdown: window.lastReturnDebug.game.liftCountdown,
    waits: window.lastReturnDebug.level.liftWaits, arrived: window.lastReturnDebug.game.flags.liftArrived, wait: window.lastReturnDebug.tuning.liftArrivalSeconds }));
  check('with the work order done the terminal calls the lift: the full wait in a station with the wait, at once in one without',
    upload.started && (upload.waits ? upload.countdown > upload.wait - 1 && upload.countdown <= upload.wait && !upload.arrived : upload.arrived), upload);
  // The wait and a second more with nothing hunting you: the Hollow is sent away again every second, because its waking
  // (some seconds after Generator 2 starts, by the game's own clock) may fall anywhere in this wait.
  await inGame((wait) => { const debug = window.lastReturnDebug; for (let second = 0; second < wait + 1; second++) { debug.hollow.isActive = false; debug.simulate(1); } }, upload.wait);
  const arrival = await inGame(() => { const debug = window.lastReturnDebug; return { arrived: debug.game.flags.liftArrived, door: debug.getLiftDoor().openFraction, mode: debug.game.mode, countdown: debug.game.liftCountdown, workOrder: debug.level.workOrder, objective: debug.game.objectiveText }; });
  check('the lift arrives and opens', arrival.arrived && arrival.door === 1, arrival);
  await inGame(() => { const debug = window.lastReturnDebug; debug.teleport(debug.playerStart.x, debug.playerStart.z, 0); debug.simulate(0.2); });
  check('boarding the lift starts the ascent', (await inGame(() => window.lastReturnDebug.game.mode)) === 'ascending');
  await page.waitForFunction(() => window.lastReturnDebug.game.mode === 'ending', null, { timeout: 90000 });
  await drawFrames(page, 1);
  const endingText = await page.evaluate(() => document.getElementById('ending-stats').textContent);
  check('the ending screen names the station and its seed', endingText.indexOf('seed ' + playSeed) >= 0, endingText);
  const endingOrder = await page.evaluate(() => ({ label: window.lastReturnDebug.workOrders.filter((order) => order.key === window.lastReturnDebug.level.workOrder)[0].label,
    manifest: document.getElementById('ending-manifest').textContent, says: window.lastReturnDebug.describeUploadManifest() }));
  check('the ending screen names the work order, and its manifest lists what that order brought up',
    endingText.indexOf('Work order' + endingOrder.label) >= 0 && endingOrder.manifest.indexOf('Upload manifest: ' + endingOrder.says + '. Automatic classification') === 0, endingOrder);
  check('the ending screen names the build', /Build\d+\.\d+\.\d+ · build \d+ · [0-9a-f]{7}/.test(endingText), endingText);

  // --- "somewhere uncharted" on the ending screen switches the title screen over ---
  await page.evaluate(() => document.getElementById('button-ending-uncharted').click());
  const afterEnding = await page.evaluate(() => ({ mode: window.lastReturnDebug.game.mode, station: window.lastReturnDebug.settings.station, checked: document.getElementById('station-generated').checked }));
  check('the ending screen can send you to the title screen with "Uncharted annex" chosen',
    afterEnding.mode === 'title' && afterEnding.station === 'generated' && afterEnding.checked, afterEnding);
  for (let pump = 0; pump < 6; pump++) await drawFrames(page, 1);
  check('the title screen scans the generated lift lobby by itself', (await inGame(() => window.lastReturnDebug.pointCloud.totalReturns)) > 0);

  // --- more than one keycard: a large station has as many as its size says (two or more), and each opens only its own ring of doors ---
  // Any large station will do: the first seed that can be built, typed in by its own seed as above.
  const largeSeed = await inGame(() => {
    for (let seed = 1; seed <= 20; seed++) if (window.lastReturnDebug.loadStation('generated', seed, 'large', 'mixed', 'two')) return window.lastReturnDebug.level.seed;
    return 0;
  });
  await page.selectOption('#title-station-size', 'large');
  await page.fill('#title-seed', String(largeSeed));
  await startGame(page, false);
  const cards = await inGame(() => {
    const debug = window.lastReturnDebug, result = { seed: debug.level.seed, count: debug.level.keycardCount, sizeSays: debug.sizePresets.large.keycards, problems: debug.auditProgression() };
    debug.grantPower();
    const doorOfCard = (cardLevel) => debug.doors.find((door) => door.kind === 2 && door.cardLevel === cardLevel);
    const tryDoor = (door) => {
      for (const step of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (door.insideStepX === step[0] && door.insideStepZ === step[1]) continue; // (at its outer side, where the card is asked for)
        const spot = debug.findWalkableSpotNear(door.tileX + 0.5 + step[0], door.tileZ + 0.5 + step[1]);
        if (spot && Math.abs(spot.x - door.tileX - 0.5 - step[0]) < 0.01 && Math.abs(spot.z - door.tileZ - 0.5 - step[1]) < 0.01) {
          debug.teleport(spot.x, spot.z, 0); debug.simulate(1.5); return door.openFraction;
        }
      }
      return -1;
    };
    const take = (objectId) => { const thing = debug.findInteractable(objectId); const spot = debug.findWalkableSpotNear(thing.x, thing.z); debug.teleport(spot.x, spot.z, 0); debug.use(objectId); debug.simulate(0.2); };
    result.hasBothKindsOfDoor = Boolean(doorOfCard(1) && doorOfCard(2));
    result.card1DoorNoCard = tryDoor(doorOfCard(1));
    take(debug.keycardObjectIds[1]);
    result.levelAfterCard1 = debug.game.flags.keycardLevel;
    result.card1DoorWithCard1 = tryDoor(doorOfCard(1));
    result.card2DoorWithCard1 = tryDoor(doorOfCard(2));
    take(debug.keycardObjectIds[2]);
    result.levelAfterCard2 = debug.game.flags.keycardLevel;
    result.card2DoorWithCard2 = tryDoor(doorOfCard(2));
    result.chip = document.getElementById('chip-keycard').textContent;
    debug.hollow.isActive = false;
    return result;
  });
  await drawFrames(page, 2);
  cards.chip = await page.evaluate(() => document.getElementById('chip-keycard').textContent);
  check('a large station has the keycards its size says, two or more, and passes the lock-order check',
    largeSeed > 0 && cards.seed === largeSeed && cards.count === cards.sizeSays && cards.count >= 2 && cards.problems.length === 0 && cards.hasBothKindsOfDoor, cards);
  check('keycard 1 opens its own doors and not keycard 2 doors; keycard 2 opens those',
    cards.card1DoorNoCard === 0 && cards.levelAfterCard1 === 1 && cards.card1DoorWithCard1 === 1 && cards.card2DoorWithCard1 === 0 &&
    cards.levelAfterCard2 === 2 && cards.card2DoorWithCard2 === 1 && cards.chip === 'KEYCARDS 2/' + cards.count, cards);

  // --- the core sample and winch breaker jobs, each on the first large station the seeds give it to ---
  const jobRules = await inGame(() => {
    const debug = window.lastReturnDebug, flags = debug.game.flags, ids = debug.missionObjectIds, result = {};
    // (A seed that cannot be built is stepped over. When none of the seeds has the job, the check below fails and says so.)
    const findStation = (wanted) => { for (let seed = 1; seed < 80; seed++) { if (!debug.loadStation('generated', seed, 'large', 'mixed', 'one')) continue; if (wanted(debug.level.mission)) return seed; } return -1; };
    // These stations have other quests as well, and the lift waits for those too. This does every one of them
    // but the two these checks are about (each quest's own rules are checked in generators-test and quests-test).
    const startEveryGenerator = () => {
      for (const quest of debug.level.quests) if (['spools', 'fuel', 'cores', 'breaker'].indexOf(quest.key) < 0) debug.doQuest(quest.key);
      debug.hollow.isActive = false;
    };
    // Core samples, and no breaker to muddy it.
    result.coreSeed = findStation((mission) => mission.coreCount > 0 && !mission.needsBreaker);
    if (result.coreSeed < 0) result.notFound = 'no large station with core samples and no winch breaker among seeds 1 to 79';
    debug.grantPower(); debug.grantSpools(); startEveryGenerator();
    debug.use(1);
    result.refusedWithoutCores = !flags.uploadStarted && !flags.spoolsUploaded;
    for (let core = 0; core < debug.level.mission.coreCount; core++) debug.use(ids.firstCore + core);
    result.coresCollected = flags.coresCollected === debug.level.mission.coreCount;
    result.chipText = '';
    debug.use(1);
    result.acceptedWithCores = flags.uploadStarted === true;
    // The winch breaker, closed after the upload.
    result.breakerSeed = findStation((mission) => mission.needsBreaker && debug.level.liftWaits);
    if (result.breakerSeed < 0) result.notFound = 'no large station with a winch breaker and the wait for the lift among seeds 1 to 79';
    debug.grantSpools();
    debug.use(ids.winchBreaker);
    result.breakerNeedsPower = flags.breakerClosed === false;
    debug.grantPower(); startEveryGenerator();
    for (let core = 0; core < debug.level.mission.coreCount; core++) debug.use(ids.firstCore + core);
    debug.use(1);
    result.uploadedButNoLift = flags.spoolsUploaded === true && flags.uploadStarted === false;
    debug.use(ids.winchBreaker);
    result.liftCalledByBreaker = flags.uploadStarted === true && debug.game.liftCountdown > debug.tuning.liftArrivalSeconds - 1;
    // The other order: breaker first, then the upload calls the lift straight away.
    debug.loadStation('generated', result.breakerSeed, 'large', 'mixed', 'one');
    debug.grantPower(); debug.grantSpools(); startEveryGenerator();
    for (let core = 0; core < debug.level.mission.coreCount; core++) debug.use(ids.firstCore + core);
    debug.use(ids.winchBreaker);
    result.breakerFirstDoesNotCallLift = flags.breakerClosed === true && flags.uploadStarted === false;
    debug.use(1);
    result.thenUploadCallsLift = flags.uploadStarted === true;
    debug.hollow.isActive = false;
    return result;
  });
  check('core samples: the terminal refuses the upload without them and takes it with them',
    jobRules.coreSeed > 0 && jobRules.refusedWithoutCores && jobRules.coresCollected && jobRules.acceptedWithCores, jobRules);
  check('winch breaker: it needs power; closed after the upload it calls the lift; closed before, the upload does',
    jobRules.breakerSeed > 0 && jobRules.breakerNeedsPower && jobRules.uploadedButNoLift && jobRules.liftCalledByBreaker &&
    jobRules.breakerFirstDoesNotCallLift && jobRules.thenUploadCallsLift, jobRules);

  // --- the largest size: as many keycards as its size says ---
  await inGame(() => window.lastReturnDebug.setWorkshopContentUsed(true)); // (any eight of them: as the game builds them)
  const massive = await inGame(() => {
    const debug = window.lastReturnDebug, bad = [];
    const wrongCardCounts = [];
    for (let seed = 1; seed <= 8; seed++) {
      const wasBuilt = debug.loadStation('generated', seed, 'massive', ['tight', 'mixed', 'sprawling'][seed % 3], seed % 2 === 0 ? 'two' : 'one');
      const found = wasBuilt ? debug.auditLayout().concat(debug.auditProgression()).concat(debug.auditHollowRoutes()).concat(debug.auditNoisyFloor()) : ['no plan could be made'];
      if (found.length > 0) bad.push({ seed: seed, problems: found.slice(0, 4) });
      if (debug.level.keycardCount !== debug.sizePresets.massive.keycards) wrongCardCounts.push({ seed: seed, keycards: debug.level.keycardCount });
    }
    return { bad: bad, wrongCardCounts: wrongCardCounts, sizeSays: debug.sizePresets.massive.keycards };
  });
  check('8 massive stations: all can be built and finished in order, each with as many keycards as its size says', massive.bad.length === 0 && massive.wrongCardCounts.length === 0, massive);

  // --- a vent that goes down: over the edge, down to the lower level, and no way back up it ---
  const drop = await inGame(() => {
    const debug = window.lastReturnDebug, p = debug.player, result = { found: false };
    for (let seed = 1; seed <= 60 && !result.found; seed++) {
      if (!debug.loadStation('generated', seed, 'medium', 'mixed', 'two') || debug.level.ventDrops.length === 0) continue;
      const foot = debug.level.ventDrops[0];
      // The edge: the tile of the vent beside the foot that is on the upper floor.
      const step = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter((way) => debug.isVentAt(foot.x + way[0], foot.z + way[1]) && Math.abs(debug.getFloorHeightAt(foot.x + way[0], foot.z + way[1]) - foot.topY) < 0.01)[0];
      if (!step) continue;
      result.found = true; result.seed = seed; result.deep = Math.round((foot.topY - foot.bottomY) * 100) / 100;
      debug.game.flags.hasLeftLift = true;
      // From the edge (the tile of the vent before the drop), crouched, on and over it.
      const noises = []; debug.debugHooks.recordNoise = function (x, z, radius) { noises.push(radius); };
      debug.input.keysDown.add('KeyC');
      debug.teleport(foot.x + step[0] * 1.2, foot.z + step[1] * 1.2, Math.atan2(-step[0], step[1]));
      p.velocityX = 0; p.velocityZ = 0;
      debug.simulate(0.8);
      result.startedOnTheUpperFloor = Math.abs(p.floorY - foot.topY) < 0.01 && debug.isVentAt(p.x, p.z);
      debug.input.keysDown.add('KeyW');
      let seconds = 0, wasFalling = false;
      while (seconds < 12 && Math.abs(p.floorY - foot.bottomY) > 0.01) { debug.simulate(1 / 30); seconds += 1 / 30; if (p.fallSpeed > 0) wasFalling = true; }
      result.cameDown = Math.abs(p.floorY - foot.bottomY) < 0.01; result.secondsToTheBottom = Math.round(seconds * 10) / 10;
      result.fell = wasFalling; result.loudest = Math.max.apply(null, noises.concat([0]));
      // (What is recorded is how far a noise carries to the Hollow's ears on this threat level.)
      result.landingWasHeard = result.loudest >= debug.tuning.noiseRadiusDropLanding * debug.game.difficulty.hearingFactor * 0.99;
      // And back: turned round at the foot, walking at the edge above for three seconds.
      debug.input.keysDown.delete('KeyW');
      debug.teleport(foot.x, foot.z, Math.atan2(step[0], -step[1]));
      p.velocityX = 0; p.velocityZ = 0;
      debug.simulate(0.3);
      debug.input.keysDown.add('KeyW');
      debug.simulate(3);
      debug.input.keysDown.clear();
      result.stayedDown = Math.abs(p.floorY - foot.bottomY) < 0.01 && Math.abs(p.x - foot.x) < 0.5 && Math.abs(p.z - foot.z) < 0.5;
      // Down there every door back up wants the last keycard. From its inner side a keycard door opens without
      // one, and without the mains (a temporary rule: TUNING.keycardDoorsOpenFromInside); from outside it does not.
      const door = debug.doors.filter((one) => one.kind === debug.doorKinds.keycard && one.insideStepX !== undefined)[0];
      result.hasADoorWithAnInside = Boolean(door);
      if (door) {
        debug.game.flags.powerOn = false; debug.game.flags.keycardLevel = 0;
        debug.teleport(door.centerX + door.insideStepX * 1.2, door.centerZ + door.insideStepZ * 1.2, 0);
        debug.simulate(1.5);
        result.fromInside = Math.round(door.openFraction * 100) / 100;
        debug.teleport(debug.playerStart.x, debug.playerStart.z, 0);
        debug.simulate(4);
        result.shutAgain = door.openFraction;
        debug.game.flags.powerOn = true;
        debug.teleport(door.centerX - door.insideStepX * 1.2, door.centerZ - door.insideStepZ * 1.2, 0);
        debug.simulate(1.5);
        result.fromOutside = door.openFraction;
      }
      debug.debugHooks.recordNoise = null;
    }
    return result;
  });
  check('a vent with a drop in it: crawled along from the upper level you go over the edge and come down on the lower one, which is heard; and from the foot there is no way back up',
    drop.found && drop.deep > 1 && drop.startedOnTheUpperFloor && drop.fell && drop.cameDown && drop.secondsToTheBottom < 8 && drop.landingWasHeard && drop.stayedDown, drop);
  check('a keycard door opens from its inner side without the card and without the mains, shuts behind you, and from outside stays shut without the card',
    drop.hasADoorWithAnInside && drop.fromInside > 0.9 && drop.shutAgain === 0 && drop.fromOutside === 0, drop);

  check('no script errors were reported', problems.length === 0, problems);
  await browser.close();

  if (failures.length > 0) {
    console.log('\n' + failures.length + ' check(s) failed.');
    process.exit(1);
  }
  console.log('\nAll generated-station checks passed.');
})();
