// Checks the survey spools as things you carry (LOOSE_OBJECT_KINDS.spool in src/js/08-loose-objects.js, and
// noteSpoolFound, listThingsForTheTerminal and loadThingsAtTheTerminal in src/js/11-game.js): that a spool lies
// loose in its room, is found by whoever first has it in the beam (its log, Dispatch, the count on screen),
// goes into a pocket, and is loaded by the lift terminal out of your pockets, out of your beam and off the
// floor beside it; that the upload waits for every one of them; that one that is lost is back where it lay on
// a Survey order and gone on any other; and that what you had in your pockets when you died can still be
// brought in.
//
// And the core samples of a Recovery order, which are carried to the terminal the same way (a quest with
// `carried`, src/js/09-quests.js) but are too long for a pocket: one in the beam at a time.
//
// (The other suites take a spool with a shortcut, `use`, which finds and loads it in one go. This is the one
// place where the carrying itself is the point. That the host's game says which spools a terminal takes down
// there with others: together-test.js.)
const { openGame, startGame, drawFrames } = require('./browser-harness.js');

const failures = [];
function check(description, condition, detail) {
  const line = (condition ? 'ok    ' : 'FAIL  ') + description + (detail !== undefined ? '  ' + JSON.stringify(detail) : '');
  console.log(line);
  if (!condition) failures.push(description);
}

const OBJECT_LIFT_TERMINAL = 1, OBJECT_SPOOL_1 = 3, OBJECT_SPOOL_2 = 4, OBJECT_SPOOL_3 = 5;

(async () => {
  const { browser, page, problems } = await openGame({ dev: true });
  const inGame = (callback, argument) => page.evaluate(callback, argument);
  await startGame(page, false);

  // Helpers kept in the page.
  await inGame(() => {
    const d = window.lastReturnDebug, lab = {};
    lab.messages = function () { return Array.from(document.querySelectorAll('#hud-messages .hud-message')).map((element) => element.textContent).join(' | '); };
    lab.settle = function () {
      d.game.flags.hasLeftLift = true;
      d.hollow.isActive = false;
      d.setDebugOption('freezeCreatures', true); d.setDebugOption('invulnerable', false);
      d.clearMessages();
      d.teleport(d.playerStart.x, d.playerStart.z, 0);
      d.simulate(0.1);
    };
    // A new descent into Kessel-9 (a Survey order, three spools), out of the lift, with nothing about.
    lab.fresh = function () { d.loadStation('classic', 0); lab.settle(); };
    lab.spool = function (objectId) { return d.findSpool(objectId); };
    lab.terminal = function () { return d.findInteractable(1); };
    // Stands you beside a place, looking at it.
    lab.standBy = function (x, z) {
      const spot = d.findWalkableSpotNear(x, z);
      d.teleport(spot.x, spot.z, Math.atan2(x - spot.x, -(z - spot.z)));
      d.simulate(0.1);
    };
    // Takes a spool into the beam where it lies, and shuts the log it opens. Returns what the moment was like.
    lab.take = function (spool) {
      lab.standBy(spool.x, spool.z);
      const taken = d.pickUpLooseObject(spool, false);
      const result = { taken: taken, mode: d.game.mode, heading: document.getElementById('reader-heading').textContent, source: document.getElementById('reader-source').textContent };
      if (d.game.mode === 'reading') d.closeReader();
      d.simulate(0.1);
      return result;
    };
    lab.press = function (key) {
      if (key === 'R') d.input.wantsStow = true; else d.input.wantsPocket = Number(key) - 4;
      d.simulate(0.1);
    };
    // Walks up to the lift terminal and presses it.
    lab.pressTerminal = function () {
      const terminal = lab.terminal();
      lab.standBy(terminal.x, terminal.z);
      d.clearMessages();
      d.use(1);
      d.simulate(0.1);
      return lab.messages();
    };
    // Carries what is in your first pocket to a place, and takes it out into the beam there. (In a pocket is how
    // a thing goes with you over a distance in a test: the beam lets go of what a jump of sixty metres tears away.)
    lab.bringOutAt = function (x, z) {
      lab.standBy(x, z);
      lab.press('4');
      return d.getHeldLooseObject();
    };
    lab.setDown = function (object) {
      d.releaseHeldLooseObject(0);
      for (let step = 0; step < 150 && !object.isAsleep; step++) d.simulate(1 / 30);
    };
    // Takes what is in your beam along to a place. (For a thing that fits no pocket: it is put where the beam
    // holds it once you stand there, as a walk would have brought it.)
    lab.carryTo = function (x, z) {
      const held = d.getHeldLooseObject();
      lab.standBy(x, z);
      if (held) { held.x = d.player.x; held.y = d.getPlayerEyeY() - 0.3; held.z = d.player.z; held.velocityX = 0; held.velocityY = 0; held.velocityZ = 0; }
      d.simulate(0.3);
      return d.getHeldLooseObject();
    };
    lab.pockets = function () { return d.getOwnPockets().map((object) => object ? object.kindKey : null); };
    lab.isInTheStation = function (object) { return d.looseObjects.indexOf(object) >= 0; };
    lab.isAnywhere = function (object) { return lab.isInTheStation(object) || d.findPocketedObject(object.id) !== null; };
    lab.flags = function () { return { found: d.game.flags.spoolsCollected, loaded: d.game.flags.spoolsLoaded, uploadStarted: d.game.flags.uploadStarted }; };
    lab.round = function (value) { return Math.round(value * 1000) / 1000; };
    window.lab = lab;
  });

  // --- lying in its room ---
  const lying = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, result = {};
    lab.fresh();
    const kind = d.looseObjectKinds.spool;
    result.kind = { label: kind.label, mass: kind.mass, value: kind.value, pocket: kind.pocket, bulky: kind.bulky };
    result.count = d.level.spoolCount; result.onTheOrder = d.areSpoolsOnTheOrder();
    result.spools = [3, 4, 5].map((objectId) => {
      const spool = lab.spool(objectId);
      if (!spool) return null;
      return { kindKey: spool.kindKey, asleep: spool.isAsleep, found: spool.wasFound, known: spool.isKnownOnMap, aboveTheFloor: lab.round(spool.y - d.getFloorHeightAt(spool.x, spool.z)),
        onTheMap: d.getLooseObjectMapMark(spool), fits: d.canLooseObjectBePocketed(spool), lootable: d.isLootable(spool), pressable: d.findInteractable(objectId).isLoose === true };
    });
    result.fromTheRooms = d.roomLooseObjects.filter((entry) => entry.kindKey === 'spool').length;
    result.flags = lab.flags();
    result.objective = d.game.objectiveText;
    // Scanned, it is on the map as something you came for.
    const first = lab.spool(3);
    first.isKnownOnMap = true;
    result.scanned = d.getLooseObjectMapMark(first);
    first.isKnownOnMap = false;
    return result;
  });
  check('a survey spool is a kind of loose object: light, worth nothing to Salvage, and small enough for a pocket',
    lying.kind.label === 'survey spool' && lying.kind.mass > 0 && lying.kind.mass <= 1 && lying.kind.value === 0 && lying.kind.pocket === true && lying.kind.bulky === false, lying.kind);
  check('Kessel-9 has its three spools lying loose in their rooms, at rest, put out by the rooms and not by the map\'s litter: nobody has found one, none is on the map, and no looter would touch one yet',
    lying.count === 3 && lying.onTheOrder && lying.fromTheRooms === 3 && lying.spools.every((spool) => spool !== null && spool.kindKey === 'spool' && spool.asleep && !spool.found && !spool.known && spool.onTheMap === null &&
      spool.fits && spool.pressable && !spool.lootable && spool.aboveTheFloor > -0.05 && spool.aboveTheFloor < 1.6) && lying.flags.found === 0 && lying.flags.loaded === 0, lying);
  check('once your scanner has been on one it is on the map as a spool, and as something this work order wants',
    lying.scanned !== null && lying.scanned.label === 'SPOOL' && lying.scanned.isWanted === true, lying.scanned);

  // --- nothing is put out on top of one ---
  const clear = await inGame(() => {
    const d = window.lastReturnDebug, result = { stations: 0, spools: 0, nearestMetres: 99, onTop: [], notAtRest: 0 };
    const stations = [['classic', 0]];
    for (let seed = 1; seed <= 8; seed++) for (const size of ['small', 'large']) stations.push(['generated', seed, size, 'mixed', 'one']);
    for (const station of stations) {
      if (!d.loadStation.apply(null, station)) continue;
      result.stations++;
      for (const spool of d.roomLooseObjects.filter((entry) => entry.kindKey === 'spool')) {
        result.spools++;
        for (const thing of d.stationLooseObjects) {
          const metres = Math.hypot(thing.x - spool.x, thing.y - spool.y, thing.z - spool.z);
          result.nearestMetres = Math.min(result.nearestMetres, Math.round(metres * 100) / 100);
          if (metres < 0.25) result.onTop.push([station.join(' '), thing.kindKey, Math.round(metres * 100) / 100]);
        }
      }
      result.notAtRest += d.looseObjects.filter((object) => object.kindKey === 'spool' && !object.isAsleep).length;
    }
    return result;
  });
  check('in Kessel-9 and sixteen generated stations nothing of the station\'s litter is put out on top of a spool or inside one, and every spool lies at rest',
    clear.stations >= 15 && clear.spools >= clear.stations * 3 && clear.onTop.length === 0 && clear.notAtRest === 0, clear);

  // --- found ---
  await inGame(() => { window.lab.fresh(); });
  await drawFrames(page, 3);
  const chipAtFirst = await inGame(() => document.getElementById('chip-spools').textContent);
  const found = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, result = {};
    const spool = lab.spool(3);
    window.kept = { first: spool };
    const noises = [];
    d.debugHooks.recordNoise = function (x, z, radius) { noises.push(radius); };
    result.first = lab.take(spool);
    d.debugHooks.recordNoise = null;
    result.noises = noises.length;
    result.held = d.getHeldLooseObject() === spool;
    result.flags = lab.flags(); result.wasFound = spool.wasFound;
    result.checkpointMetresFromYou = lab.round(Math.hypot(d.game.checkpoint.x - d.player.x, d.game.checkpoint.z - d.player.z));
    d.simulate(3);
    result.said = lab.messages();
    result.dispatch = result.said.indexOf(d.radioText('firstSpool')) >= 0;
    result.objective = d.game.objectiveText;
    result.label = d.getLooseObjectLabel ? d.getLooseObjectLabel(spool) : spool.kind.label;
    // Put down and taken up again: it is found once.
    d.releaseHeldLooseObject(0);
    for (let step = 0; step < 90 && !spool.isAsleep; step++) d.simulate(1 / 30);
    result.again = lab.take(spool);
    result.flagsAgain = lab.flags();
    return result;
  });
  await drawFrames(page, 3);
  const foundScreen = await inGame(() => ({ chip: document.getElementById('chip-spools').textContent, lit: document.getElementById('chip-spools').classList.contains('is-on'),
    prompt: document.getElementById('hud-prompt').textContent, carrying: document.getElementById('chip-carrying').textContent }));
  check('taken into the beam for the first time, a spool is found: it counts, its log opens for you to read, the place is your checkpoint, and it is in your beam',
    found.first.taken && found.first.mode === 'reading' && found.first.heading !== '' && found.held && found.wasFound && found.flags.found === 1 && found.flags.loaded === 0 && found.checkpointMetresFromYou < 0.5 && found.noises >= 1, found);
  check('Dispatch has something to say about the first one, and the screen counts it as found of three: not loaded, and not lit',
    found.dispatch && chipAtFirst === 'SPOOLS 0/3' && foundScreen.chip === 'SPOOLS 1/3' && !foundScreen.lit, { said: found.said, before: chipAtFirst, screen: foundScreen });
  check('put down and taken up again it is not found a second time, and no log opens',
    found.again.taken && found.again.mode === 'playing' && found.flagsAgain.found === 1, [found.again, found.flagsAgain]);
  check('with a spool in the beam the screen offers a pocket for it', /\[R\]\s+Pocket it/.test(foundScreen.prompt), foundScreen);

  // --- into a pocket, and what the terminal makes of it without the mains ---
  const pocketed = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, result = {};
    const spool = window.kept.first;
    lab.press('R');
    result.pockets = lab.pockets(); result.held = d.getHeldLooseObject() === null; result.inTheStation = lab.isInTheStation(spool); result.mass = lab.round(d.getPocketMass());
    result.canRun = d.canSprintWhileCarrying();
    result.flags = lab.flags();
    result.atTheTerminal = d.listThingsForTheTerminal(0).length;
    // No mains: the terminal refuses, and takes nothing.
    result.noMains = lab.pressTerminal();
    result.afterNoMains = { pockets: lab.pockets(), flags: lab.flags() };
    return result;
  });
  check('R puts it in a pocket: out of the station, out of the beam, a few hundred grams on you, found and not yet loaded, and you can still run',
    pocketed.pockets.join() === 'spool,,,' && pocketed.held && !pocketed.inTheStation && pocketed.mass > 0 && pocketed.mass <= 1 && pocketed.canRun && pocketed.flags.found === 1 && pocketed.flags.loaded === 0, pocketed);
  check('without the mains the lift terminal refuses and takes nothing: the spool stays in your pocket',
    /no mains power/.test(pocketed.noMains) && pocketed.afterNoMains.pockets.join() === 'spool,,,' && pocketed.afterNoMains.flags.loaded === 0 && !pocketed.afterNoMains.flags.uploadStarted, pocketed);

  // --- loaded: out of a pocket, out of the beam, off the floor ---
  const loading = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, result = {};
    const first = window.kept.first, second = lab.spool(4), third = lab.spool(5);
    d.grantPower();
    // One in a pocket.
    result.fromAPocketSaid = lab.pressTerminal();
    result.fromAPocket = { pockets: lab.pockets(), flags: lab.flags(), anywhere: lab.isAnywhere(first) };
    // Pressed again with nothing to give: it says the same, and nothing changes.
    result.againSaid = lab.pressTerminal();
    result.again = lab.flags();
    // One in the beam.
    const terminal = lab.terminal();
    lab.take(second); lab.press('R');
    result.secondFound = lab.flags();
    result.secondInTheBeam = lab.bringOutAt(terminal.x, terminal.z) === second && lab.pockets().every((thing) => thing === null);
    result.fromTheBeamSaid = lab.pressTerminal();
    result.fromTheBeam = { held: d.getHeldLooseObject() === null, flags: lab.flags(), anywhere: lab.isAnywhere(second) };
    result.objectiveWithTwo = d.game.objectiveText;
    // The last one, set down too far from the terminal to count: five metres off.
    lab.take(third); lab.press('R');
    result.thirdFound = lab.flags();
    result.objectiveWithAllFound = d.game.objectiveText;
    let far = null;
    for (let turn = 0; turn < 16 && !far; turn++) {
      const spot = d.findWalkableSpotNear(terminal.x + Math.cos(turn * Math.PI / 8) * 5.5, terminal.z + Math.sin(turn * Math.PI / 8) * 5.5);
      if (spot && Math.hypot(spot.x - terminal.x, spot.z - terminal.z) > d.tuning.terminalTakesWithinMetres + 1.5) far = spot;
    }
    lab.bringOutAt(far.x, far.z);
    lab.setDown(third);
    result.farMetres = lab.round(Math.hypot(third.x - terminal.x, third.z - terminal.z));
    result.reach = d.tuning.terminalTakesWithinMetres;
    result.tooFarSaid = lab.pressTerminal();
    result.tooFar = { flags: lab.flags(), inTheStation: lab.isInTheStation(third) };
    // Set down beside the terminal, and pressed from a step away with nothing in the beam or a pocket.
    result.takenAgain = lab.take(third); result.takenAgain.held = d.getHeldLooseObject() === third; result.takenAgain.flags = lab.flags();
    lab.press('R');
    lab.bringOutAt(terminal.x, terminal.z);
    lab.setDown(third);
    result.nearMetres = lab.round(Math.hypot(third.x - terminal.x, third.z - terminal.z));
    result.nothingOnYou = d.getHeldLooseObject() === null && lab.pockets().every((thing) => thing === null);
    result.offTheFloorSaid = lab.pressTerminal();
    result.offTheFloor = { flags: lab.flags(), anywhere: lab.isAnywhere(third), spoolsLeft: d.looseObjects.filter((object) => object.kindKey === 'spool').length };
    result.manifest = d.describeUploadManifest ? d.describeUploadManifest() : '';
    return result;
  });
  await drawFrames(page, 3);
  const loadedScreen = await inGame(() => ({ chip: document.getElementById('chip-spools').textContent, lit: document.getElementById('chip-spools').classList.contains('is-on') }));
  check('with the mains on the terminal takes the spool out of your pocket: it is loaded and is no longer a thing anywhere, the terminal says what it took, and the upload stays locked with the count it has',
    loading.fromAPocket.pockets.every((thing) => thing === null) && loading.fromAPocket.flags.loaded === 1 && loading.fromAPocket.flags.found === 1 && !loading.fromAPocket.anywhere &&
    !loading.fromAPocket.flags.uploadStarted && /LIFT CONTROL: loaded 1 survey spool\./.test(loading.fromAPocketSaid) && /Survey spools loaded: 1 of 3/.test(loading.fromAPocketSaid), [loading.fromAPocketSaid, loading.fromAPocket]);
  check('pressed again with nothing to give it, the terminal says the same and nothing changes',
    /Survey spools loaded: 1 of 3/.test(loading.againSaid) && !/LIFT CONTROL: loaded/.test(loading.againSaid) && loading.again.loaded === 1 && loading.again.found === 1 && !loading.again.uploadStarted, [loading.againSaid, loading.again]);
  check('it takes one straight out of your beam as well',
    loading.secondFound.found === 2 && loading.secondFound.loaded === 1 && loading.secondInTheBeam && loading.fromTheBeam.held && loading.fromTheBeam.flags.loaded === 2 && !loading.fromTheBeam.anywhere &&
    /Survey spools loaded: 2 of 3/.test(loading.fromTheBeamSaid) && !loading.fromTheBeam.flags.uploadStarted, [loading.secondFound, loading.fromTheBeamSaid, loading.fromTheBeam]);
  check('with every spool found the objective sends you to the lift, and not before',
    !/lift lobby/.test(loading.objectiveWithTwo) && loading.thirdFound.found === 3 && /lift lobby/.test(loading.objectiveWithAllFound), [loading.objectiveWithTwo, loading.objectiveWithAllFound]);
  check('a spool lying further from the terminal than it reaches is not taken: found is not loaded, and the upload stays locked',
    loading.farMetres > loading.reach && loading.farMetres < 12 && loading.tooFar.flags.loaded === 2 && loading.tooFar.flags.found === 3 && loading.tooFar.inTheStation && !loading.tooFar.flags.uploadStarted &&
    /Survey spools loaded: 2 of 3/.test(loading.tooFarSaid), [loading.farMetres, loading.tooFarSaid, loading.tooFar]);
  check('set down beside the terminal it is taken off the floor, with nothing in your beam or pockets; that is all of them, and the upload starts',
    loading.takenAgain.held && loading.takenAgain.mode === 'playing' && loading.takenAgain.flags.found === 3 && loading.nearMetres <= loading.reach && loading.nothingOnYou &&
    loading.offTheFloor.flags.loaded === 3 && loading.offTheFloor.flags.uploadStarted && !loading.offTheFloor.anywhere && loading.offTheFloor.spoolsLeft === 0, loading);
  check('the screen then shows all three, lit', loadedScreen.chip === 'SPOOLS 3/3' && loadedScreen.lit, loadedScreen);

  // --- the screen while some are found and fewer are loaded ---
  await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab;
    lab.fresh(); d.grantPower();
    lab.take(lab.spool(3)); lab.press('R');
    lab.pressTerminal();
    lab.take(lab.spool(4)); lab.press('R');
  });
  await drawFrames(page, 3);
  const partScreen = await inGame(() => ({ chip: document.getElementById('chip-spools').textContent, lit: document.getElementById('chip-spools').classList.contains('is-on'),
    pocket: document.getElementById('pocket-0').textContent }));
  check('with two found and one of them loaded the screen says both, and names the one in your pocket',
    /^SPOOLS 2\/3/.test(partScreen.chip) && /1 LOADED/.test(partScreen.chip) && !partScreen.lit && /SPOOL/i.test(partScreen.pocket), partScreen);

  // --- lost ---
  const lost = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, result = {};
    lab.fresh();
    // On a Survey order a spool cannot be done without: down the shaft, it is back where it first lay.
    const spool = lab.spool(3), home = { x: spool.x, y: spool.y, z: spool.z };
    lab.take(spool); lab.press('R');
    result.before = lab.flags();
    const away = d.findWalkableSpotNear(d.playerStart.x, d.playerStart.z);
    result.inTheBeamThere = lab.bringOutAt(away.x, away.z) === spool;
    result.carriedMetresFromHome = lab.round(Math.hypot(spool.x - home.x, spool.z - home.z));
    d.clearMessages();
    d.askToAct({ what: 'lose', id: spool.id });
    d.simulate(0.2);
    result.wanted = { inTheStation: lab.isInTheStation(spool), metresFromHome: lab.round(Math.hypot(spool.x - home.x, spool.y - home.y, spool.z - home.z)), held: d.getHeldLooseObject() === null,
      said: lab.messages(), flags: lab.flags(), asleep: spool.isAsleep, onTheMap: d.getLooseObjectMapMark(spool) };
    // Taken up again there, it is the same spool: not found a second time.
    result.again = lab.take(spool);
    result.flagsAgain = lab.flags();
    return result;
  });
  check('on a Survey order a spool that goes down the shaft is back where it first lay, and the screen says so; it is still found, and taking it again does not count twice',
    lost.inTheBeamThere && lost.carriedMetresFromHome > 2 && lost.wanted.inTheStation && lost.wanted.metresFromHome < 0.05 && lost.wanted.held && /back where it first stood/.test(lost.wanted.said) &&
    lost.wanted.flags.found === 1 && lost.wanted.flags.loaded === 0 && lost.again.taken && lost.again.mode === 'playing' && lost.flagsAgain.found === 1, lost);

  // On any other work order nobody asks for it: lost is lost.
  const unasked = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab;
    for (let seed = 1; seed <= 40; seed++) {
      if (!d.loadStation('generated', seed, 'small', 'mixed', 'one', undefined, ['salvage'])) continue;
      if (d.areSpoolsOnTheOrder() || d.looseObjects.filter((object) => object.kindKey === 'spool').length === 0) continue;
      lab.settle();
      const result = { seed: seed, order: d.level.workOrder, count: d.level.spoolCount };
      const spools = d.looseObjects.filter((object) => object.kindKey === 'spool');
      result.onTheMap = (function () { spools[0].isKnownOnMap = true; const mark = d.getLooseObjectMapMark(spools[0]); spools[0].isKnownOnMap = false; return mark; })();
      // Found: a line on screen, and no word from Dispatch about spools.
      result.first = lab.take(spools[0]);
      d.simulate(3);
      result.said = lab.messages();
      result.flags = lab.flags();
      // Down the shaft: gone for good.
      d.clearMessages();
      d.askToAct({ what: 'lose', id: spools[0].id });
      d.simulate(0.2);
      result.lost = { anywhere: lab.isAnywhere(spools[0]), said: lab.messages(), flags: lab.flags(), spoolsLeft: d.looseObjects.filter((object) => object.kindKey === 'spool').length };
      // Another, brought to the terminal with the mains on: it is taken, and goes on the manifest as a thing nobody asked for.
      d.grantPower();
      lab.take(spools[1]); lab.press('R');
      lab.pressTerminal();
      result.loaded = { pockets: lab.pockets(), flags: lab.flags(), manifest: d.describeUploadManifest() };
      return result;
    }
    return null;
  });
  check('there is a Salvage station with spools nobody asked for', unasked !== null, unasked);
  if (unasked) {
    check('on a work order that is not Survey a spool is still there to be found, marked on the map as nothing wanted, and the screen says it is not on the order',
      unasked.onTheMap !== null && unasked.onTheMap.label === 'SPOOL' && unasked.onTheMap.isWanted === false && unasked.first.taken && unasked.first.mode === 'reading' &&
      /not on this work order/.test(unasked.said) && unasked.flags.found === 1, unasked);
    check('lost down the shaft there, it is gone: nothing puts it back',
      !unasked.lost.anywhere && !/back where it first stood/.test(unasked.lost.said) && unasked.lost.spoolsLeft === unasked.count - 1, unasked.lost);
    check('the terminal takes one all the same, and the manifest lists it as not on the work order',
      unasked.loaded.pockets.every((thing) => thing === null) && unasked.loaded.flags.loaded === 1 && /Not on the work order: 1 survey spool/.test(unasked.loaded.manifest), unasked.loaded);
  }

  // --- a station with more spools than pockets ---
  const many = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab;
    for (const size of ['large', 'massive']) {
      for (let seed = 1; seed <= 30; seed++) {
        if (!d.loadStation('generated', seed, size, 'mixed', 'one', undefined, ['survey'])) continue;
        if (!d.areSpoolsOnTheOrder() || d.level.spoolCount <= d.tuning.pocketCount) continue;
        lab.settle(); d.grantPower();
        const result = { seed: seed, size: size, count: d.level.spoolCount, pocketCount: d.tuning.pocketCount, headings: [], trips: 0, refusals: [] };
        const spools = d.looseObjects.filter((object) => object.kindKey === 'spool');
        result.loose = spools.length;
        // As many as your pockets hold, and one more in the beam; then to the terminal, and back for the rest.
        for (const spool of spools) {
          const taken = lab.take(spool);
          result.headings.push(taken.heading);
          if (lab.pockets().indexOf(null) >= 0) { lab.press('R'); continue; }
          result.fullWith = { pockets: lab.pockets().join(), inTheBeam: d.getHeldLooseObject() === spool, found: lab.flags().found };
          // (The one in the beam is left where it was taken up: the test jumps to the terminal, and a beam does not hold over that.)
          lab.setDown(spool);
          const said = lab.pressTerminal();
          result.trips++; result.refusals.push(said); result.afterFirstTrip = lab.flags();
          lab.take(spool); lab.press('R');
        }
        result.beforeLast = lab.flags();
        result.lastSaid = lab.pressTerminal();
        result.trips++;
        result.end = lab.flags(); result.left = d.looseObjects.filter((object) => object.kindKey === 'spool').length; result.pockets = lab.pockets();
        result.objective = d.game.objectiveText;
        return result;
      }
    }
    return null;
  });
  check('there is a Survey station with more spools than you have pockets', many !== null, many);
  if (many) {
    check('there every spool is a loose thing; Ripley\'s three logs are headed with how many the station has, and the others are unlabelled',
      many.loose === many.count && many.headings.length === many.count && many.headings.filter((heading) => new RegExp(' of ' + many.count + '$').test(heading)).length === 3 &&
      many.headings.filter((heading) => /unlabelled/.test(heading)).length === many.count - 3, many);
    check('your pockets hold four and your beam a fifth; the terminal takes what you bring, says how many it has of how many, and takes the rest at the next visit: then it has them all',
      many.fullWith && many.fullWith.pockets === 'spool,spool,spool,spool' && many.fullWith.inTheBeam && many.fullWith.found === many.pocketCount + 1 && many.afterFirstTrip.loaded === many.pocketCount &&
      new RegExp('LIFT CONTROL: loaded ' + many.pocketCount + ' survey spools\\.').test(many.refusals[0]) && new RegExp('Survey spools loaded: ' + many.pocketCount + ' of ' + many.count).test(many.refusals[0]) && many.beforeLast.found === many.count && many.end.loaded === many.count && many.left === 0 &&
      many.pockets.every((thing) => thing === null) && !/Survey spools loaded/.test(many.lastSaid), many);
  }

  // --- a looter's ---
  const looted = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, result = {};
    lab.fresh(); d.grantPower();
    const spool = lab.spool(3), terminal = lab.terminal();
    lab.take(spool); lab.press('R');
    lab.bringOutAt(terminal.x, terminal.z);
    lab.setDown(spool);
    result.lootable = d.isLootable(spool);
    result.lyingThere = d.listThingsForTheTerminal(0).length;
    spool.looterIndex = 0; // in a looter's arms, beside the terminal
    result.inItsArms = d.listThingsForTheTerminal(0).length;
    result.said = lab.pressTerminal();
    result.flags = lab.flags();
    spool.looterIndex = -1;
    return result;
  });
  check('once found, a spool is small and light enough for a looter to carry off, and one in a looter\'s arms is not the terminal\'s to take, however near',
    looted.lootable && looted.lyingThere === 1 && looted.inItsArms === 0 && looted.flags.loaded === 0 && /Survey spools loaded: 0 of 3/.test(looted.said), looted);

  // --- dying with spools on you ---
  const dyingBefore = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, result = {};
    lab.fresh(); d.grantPower();
    const first = lab.spool(3), second = lab.spool(4);
    lab.take(first); lab.press('R');
    lab.take(second); lab.press('R');
    result.pockets = lab.pockets(); result.flags = lab.flags();
    const elsewhere = d.findWalkableSpotNear(d.playerStart.x + 6, d.playerStart.z + 4);
    window.kept = { first: first, second: second, where: elsewhere };
    d.teleport(elsewhere.x, elsewhere.z, 0); d.simulate(0.1);
    d.spawnHollow(d.player.x + 0.4, d.player.z);
    d.player.hurtGraceSeconds = 0; d.player.health = 1;
    result.hit = d.hitPlayer('hollow', d.hollow.figure);
    return result;
  });
  await page.waitForFunction(() => window.lastReturnDebug.game.mode === 'dead', null, { timeout: 20000 }).catch(() => {});
  const dying = await inGame((before) => {
    const d = window.lastReturnDebug, lab = window.lab, result = { before: before };
    const first = window.kept.first, second = window.kept.second, where = window.kept.where;
    result.dead = { mode: d.game.mode, pockets: lab.pockets(), flags: lab.flags(),
      lieWhereYouFell: [first, second].every((spool) => lab.isInTheStation(spool) && Math.hypot(spool.x - where.x, spool.z - where.z) < 1) };
    d.retryFromCheckpoint();
    d.hollow.isActive = false;
    d.simulate(2.5);
    result.back = { mode: d.game.mode, pockets: lab.pockets(), flags: lab.flags(), metresFromWhereYouFell: lab.round(Math.hypot(d.player.x - where.x, d.player.z - where.z)) };
    // Gone back for: taken up again (found already, so no log), pocketed, and brought in.
    result.takenAgain = [lab.take(first).mode];
    lab.press('R');
    result.takenAgain.push(lab.take(second).mode);
    lab.press('R');
    result.flagsWithBoth = lab.flags(); result.pocketsWithBoth = lab.pockets();
    result.said = lab.pressTerminal();
    result.loaded = { pockets: lab.pockets(), flags: lab.flags() };
    return result;
  }, dyingBefore);
  check('when you die with spools in your pockets they lie where you fell: still found, not loaded',
    dying.before.pockets.join() === 'spool,spool,,' && dying.before.hit === 'dead' && dying.dead.mode === 'dead' && dying.dead.pockets.every((thing) => thing === null) && dying.dead.lieWhereYouFell &&
    dying.dead.flags.found === 2 && dying.dead.flags.loaded === 0, dying);
  check('back from your checkpoint you go and get them: they are not found a second time, and the terminal takes both out of your pockets at one press',
    dying.back.mode === 'playing' && dying.back.pockets.every((thing) => thing === null) && dying.back.metresFromWhereYouFell > 3 && dying.takenAgain.join() === 'playing,playing' &&
    dying.flagsWithBoth.found === 2 && dying.pocketsWithBoth.join() === 'spool,spool,,' && dying.loaded.flags.loaded === 2 && dying.loaded.pockets.every((thing) => thing === null) &&
    /Survey spools loaded: 2 of 3/.test(dying.said), dying);

  // --- a new descent ---
  const again = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab;
    const before = { flags: lab.flags(), spools: d.looseObjects.filter((object) => object.kindKey === 'spool').length };
    d.startOver();
    return { before: before, flags: lab.flags(), spools: d.looseObjects.filter((object) => object.kindKey === 'spool').map((spool) => [spool.wasFound, spool.isAsleep || true]), pockets: lab.pockets() };
  });
  check('a new descent puts every spool back in its room, found by nobody and loaded nowhere',
    again.before.flags.loaded === 2 && again.before.spools === 1 && again.flags.found === 0 && again.flags.loaded === 0 && again.spools.length === 3 && again.spools.every((spool) => spool[0] === false) &&
    again.pockets.every((thing) => thing === null), again);

  // --- core samples: carried the same way, and too long for a pocket ---
  const cores = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab;
    for (let seed = 1; seed <= 60; seed++) {
      if (!d.loadStation('generated', seed, 'large', 'mixed', 'one', undefined, ['recovery'])) continue;
      const quest = d.findQuest('cores');
      if (!quest || quest.isOptional || quest.total < 3 || d.findQuest('breaker')) continue;
      lab.settle(); d.grantPower();
      const result = { seed: seed, total: quest.total };
      const kind = d.looseObjectKinds.coreSample;
      result.kind = { label: kind.label, mass: kind.mass, value: kind.value, pocket: kind.pocket === true, bulky: kind.bulky };
      const things = quest.objects.map((object) => d.findQuestItem(object.objectId));
      result.lying = things.map((core) => core ? { kindKey: core.kindKey, asleep: core.isAsleep, found: core.wasFound, aboveTheFloor: lab.round(core.y - d.getFloorHeightAt(core.x, core.z)),
        onTheMap: d.getLooseObjectMapMark(core), lootable: d.isLootable(core), fits: d.canLooseObjectBePocketed(core), pressable: d.findInteractable(core.questObjectId).isLoose === true } : null);
      if (things.some((core) => !core)) return result;
      const terminal = lab.terminal(), first = things[0], second = things[1], third = things[2];
      const home = { x: first.x, y: first.y, z: first.z };
      result.shareAtFirst = d.getWorkOrderProgressShare();
      // The first: into the beam.
      d.clearMessages();
      lab.standBy(first.x, first.z);
      result.taken = { taken: d.pickUpLooseObject(first, false), mode: d.game.mode };
      d.simulate(0.2);
      result.taken.said = lab.messages(); result.taken.found = first.wasFound; result.taken.done = quest.done;
      result.taken.checkpointMetresFromYou = lab.round(Math.hypot(d.game.checkpoint.x - d.player.x, d.game.checkpoint.z - d.player.z));
      result.taken.lootable = d.isLootable(first);
      first.isKnownOnMap = true; result.taken.onTheMap = d.getLooseObjectMapMark(first);
      result.shareWithOneFound = d.getWorkOrderProgressShare();
      result.carrying = { speed: lab.round(d.getCarrySpeedFactor()), canRun: d.canSprintWhileCarrying() };
      // It does not go into a pocket.
      d.clearMessages();
      lab.press('R');
      result.pocket = { pockets: lab.pockets(), held: d.getHeldLooseObject() === first, said: lab.messages() };
      // Down the shaft on the order that asks for it: back on its crate, still found.
      result.carriedMetresFromHome = (function () { lab.carryTo(d.playerStart.x, d.playerStart.z); return lab.round(Math.hypot(first.x - home.x, first.z - home.z)); })();
      d.clearMessages();
      d.askToAct({ what: 'lose', id: first.id });
      d.simulate(0.2);
      result.lost = { inTheStation: lab.isInTheStation(first), metresFromHome: lab.round(Math.hypot(first.x - home.x, first.y - home.y, first.z - home.z)), said: lab.messages(), found: first.wasFound, done: quest.done };
      // Taken up again and carried to the terminal: it is taken out of the beam.
      d.clearMessages();
      lab.standBy(first.x, first.z);
      d.pickUpLooseObject(first, false); d.simulate(0.2);
      result.takenAgainSaid = lab.messages();
      result.inTheBeamAtTheTerminal = lab.carryTo(terminal.x, terminal.z) === first;
      result.firstSaid = lab.pressTerminal();
      result.afterFirst = { done: quest.done, anywhere: lab.isAnywhere(first), held: d.getHeldLooseObject() === null, chips: d.getQuestChips().join(' · '), uploadStarted: d.game.flags.uploadStarted };
      // The second: set down five metres from the terminal, which does not count; then beside it, which does.
      lab.standBy(second.x, second.z);
      d.pickUpLooseObject(second, false); d.simulate(0.2);
      let far = null;
      for (let turn = 0; turn < 16 && !far; turn++) {
        const spot = d.findWalkableSpotNear(terminal.x + Math.cos(turn * Math.PI / 8) * 5.5, terminal.z + Math.sin(turn * Math.PI / 8) * 5.5);
        if (spot && Math.hypot(spot.x - terminal.x, spot.z - terminal.z) > d.tuning.terminalTakesWithinMetres + 1.5) far = spot;
      }
      lab.carryTo(far.x, far.z);
      lab.setDown(second);
      result.farMetres = lab.round(Math.hypot(second.x - terminal.x, second.z - terminal.z));
      lab.pressTerminal();
      result.tooFar = { done: quest.done, inTheStation: lab.isInTheStation(second) };
      lab.standBy(second.x, second.z);
      d.pickUpLooseObject(second, false); d.simulate(0.2);
      lab.carryTo(terminal.x, terminal.z);
      lab.setDown(second);
      result.nearMetres = lab.round(Math.hypot(second.x - terminal.x, second.z - terminal.z));
      result.reach = d.tuning.terminalTakesWithinMetres;
      result.secondSaid = lab.pressTerminal();
      result.afterSecond = { done: quest.done, anywhere: lab.isAnywhere(second) };
      // The rest, the same way; and the badges and whatever else the station asks for, without the walking.
      for (const core of things.slice(2)) {
        lab.standBy(core.x, core.z);
        d.pickUpLooseObject(core, false); d.simulate(0.2);
        lab.carryTo(terminal.x, terminal.z);
        lab.pressTerminal();
      }
      result.afterAll = { done: quest.done, left: d.looseObjects.filter((object) => object.kindKey === 'coreSample').length, chips: d.getQuestChips().join(' · '), uploadStarted: d.game.flags.uploadStarted };
      for (const other of d.level.quests) if (!other.isOptional && other.key !== 'cores') d.doQuest(other.key);
      result.lastSaid = lab.pressTerminal();
      result.end = { uploadStarted: d.game.flags.uploadStarted, share: d.getWorkOrderProgressShare() };
      // A new descent puts them back on their crates.
      d.startOver();
      result.again = { done: d.findQuest('cores').done, cores: d.looseObjects.filter((object) => object.kindKey === 'coreSample').map((core) => core.wasFound) };
      return result;
    }
    return null;
  });
  check('there is a Recovery station with three core samples or more', cores !== null && cores.lying && cores.lying.every((core) => core !== null), cores);
  if (cores && cores.end) {
    check('a core sample is a kind of loose object: a few kilograms, worth nothing to Salvage, not bulky, and too long for a pocket',
      cores.kind.label === 'core sample' && cores.kind.mass >= 1.5 && cores.kind.mass <= 4 && cores.kind.value === 0 && !cores.kind.pocket && cores.kind.bulky === false, cores.kind);
    check('each lies loose on its crate, at rest: found by nobody, not on the map, not for a pocket, and not for a looter to take yet',
      cores.lying.length === cores.total && cores.lying.every((core) => core.kindKey === 'coreSample' && core.asleep && !core.found && core.onTheMap === null && !core.lootable && !core.fits && core.pressable &&
        core.aboveTheFloor > 0.4 && core.aboveTheFloor < 0.6), cores.lying);
    check('taken into the beam it is found: the screen says where it goes, the place is your checkpoint, the map marks it as wanted, and the Hollow is pressed on; it is not counted yet, and from now a looter may take it',
      cores.taken.taken && cores.taken.mode === 'playing' && /The lift terminal takes it/.test(cores.taken.said) && cores.taken.found && cores.taken.done === 0 && cores.taken.checkpointMetresFromYou < 0.5 &&
      cores.taken.lootable && cores.taken.onTheMap !== null && cores.taken.onTheMap.label === 'CORE' && cores.taken.onTheMap.isWanted === true && cores.shareAtFirst === 0 && cores.shareWithOneFound > 0, cores);
    check('it slows you a little, you can still run with it, and R does not put it in a pocket: the screen says it does not fit',
      cores.carrying.speed < 1 && cores.carrying.speed > 0.85 && cores.carrying.canRun && cores.pocket.pockets.every((thing) => thing === null) && cores.pocket.held && /does not fit in a pocket/.test(cores.pocket.said), [cores.carrying, cores.pocket]);
    check('down the shaft on a Recovery order it is back on its crate, and the screen says so; it stays found, and taking it again says nothing new',
      cores.carriedMetresFromHome > 2 && cores.lost.inTheStation && cores.lost.metresFromHome < 0.05 && /back where it first stood/.test(cores.lost.said) && cores.lost.found && cores.lost.done === 0 &&
      !/The lift terminal takes it/.test(cores.takenAgainSaid), [cores.carriedMetresFromHome, cores.lost, cores.takenAgainSaid]);
    check('the lift terminal takes one out of your beam: the quest counts it, it is no longer a thing anywhere, and the terminal says what it took and that the manifest is still short',
      cores.inTheBeamAtTheTerminal && cores.afterFirst.done === 1 && !cores.afterFirst.anywhere && cores.afterFirst.held && /LIFT CONTROL: loaded 1 core sample\./.test(cores.firstSaid) && /manifest incomplete/.test(cores.firstSaid) &&
      cores.afterFirst.chips.indexOf('CORES 1/' + cores.total) >= 0 && !cores.afterFirst.uploadStarted, [cores.firstSaid, cores.afterFirst]);
    check('one set down five metres off is not taken; set down beside the terminal it is taken off the floor',
      cores.farMetres > cores.reach && cores.tooFar.done === 1 && cores.tooFar.inTheStation && cores.nearMetres <= cores.reach && cores.afterSecond.done === 2 && !cores.afterSecond.anywhere, cores);
    check('with every core sample loaded the count is full, and with the rest of the work order done the terminal calls the lift',
      cores.afterAll.done === cores.total && cores.afterAll.left === 0 && cores.afterAll.chips.indexOf('CORES ' + cores.total + '/' + cores.total) >= 0 && !cores.afterAll.uploadStarted &&
      cores.end.uploadStarted && cores.end.share === 1, [cores.afterAll, cores.lastSaid, cores.end]);
    check('a new descent puts every core sample back on its crate, found by nobody', cores.again.done === 0 && cores.again.cores.length === cores.total && cores.again.cores.every((found) => found === false), cores.again);
  }

  check('no script errors were reported', problems.length === 0, problems);
  await browser.close();

  if (failures.length > 0) {
    console.log('\n' + failures.length + ' spool check(s) failed:');
    for (const failure of failures) console.log('  - ' + failure);
    process.exit(1);
  }
  console.log('\nAll spool checks passed.');
})().catch((error) => { console.error('Spools test crashed:', error); process.exit(1); });
