// Checks when the Hollow arrives (src/js/08-arrivals.js): that in a generated station it comes in its own time,
// sooner for every noise, and no longer waits for Generator 2; that Kessel-9 is as it was; what Dispatch says
// about it; that it can get to you before the mains is on, through the ceiling; and that a station has the
// hatches for that (src/js/08-crawlspace.js).
// This is the one suite whose page lets it come by itself: see `arrivals` in browser-harness.js.
const { openGame, startGame } = require('./browser-harness.js');

const failures = [];
function check(description, condition, detail) {
  const line = (condition ? 'ok    ' : 'FAIL  ') + description + (detail !== undefined ? '  ' + JSON.stringify(detail) : '');
  console.log(line);
  if (!condition) failures.push(description);
}

(async () => {
  const { browser, page, problems } = await openGame({ dev: true, arrivals: true });
  const inGame = (callback, argument) => page.evaluate(callback, argument);
  await startGame(page, false);

  // Helpers kept in the page.
  await inGame(() => {
    const d = window.lastReturnDebug, lab = {};
    // Plays `seconds` of the game a quarter of a second at a time, and returns every line the screen showed meanwhile.
    lab.playAndRead = function (seconds) {
      const seen = {};
      for (let elapsed = 0; elapsed < seconds; elapsed += 0.25) {
        d.simulate(0.25);
        for (const element of document.querySelectorAll('#hud-messages .hud-message')) seen[element.textContent] = true;
      }
      return Object.keys(seen).join(' | ');
    };
    // Which of them comes first is drawn for every descent. These checks say: the Hollow first, unless a check says otherwise.
    d.debugState.arrivalOrder = ['hollow', 'surveyor'];
    // A new descent into the station that is loaded, out of the lift, with nothing able to catch you.
    // The checks that are about the Hollow's own wait leave the Surveyor out of the descent (`withTheOthers`
    // false): the ones about the two of them, at the end, do not.
    lab.descend = function (withTheOthers) {
      d.startOver();
      d.clearMessages();
      d.setDebugOption('invulnerable', true);
      d.game.flags.hasLeftLift = true;
      if (!withTheOthers && d.arrivals.waits.surveyor) d.arrivals.waits.surveyor.place = -1;
      return d.arrivals.waits.hollow;
    };
    // A generated station of this size whose Generator 2 has fuel (so that it can simply be started).
    lab.findStation = async function (size, firstSeed, levels) {
      for (let seed = firstSeed; seed < firstSeed + 60; seed++) {
        await window.letTheBrowserCatchUp();
        if (d.loadStation('generated', seed, size, 'mixed', levels || 'one') && !d.level.mission.needsFuel) return seed;
      }
      return 0;
    };
    lab.metresFromTheShaft = function () { return Math.hypot(d.hollow.figure.x - d.hollowSpawn.x, d.hollow.figure.z - d.hollowSpawn.z); };
    window.lab = lab;
  });

  // --- the threat levels, and the custom one ---
  const levels = await inGame(() => {
    const d = window.lastReturnDebug, option = d.customDifficultyOptions.filter((candidate) => candidate.key === 'arrivalFactor')[0];
    return { presets: Object.keys(d.difficultyPresets).map((key) => [key, d.difficultyPresets[key].arrivalFactor]), range: d.tuning.hollowArrivalQuietSeconds,
      option: option ? { kind: option.kind, choices: option.choices.map((choice) => choice[0]) } : null,
      explained: option ? option.choices.map((choice) => d.explainCustomDifficultyValue('arrivalFactor', choice[0])) : [],
      hollowSwitch: d.explainCustomDifficultyValue('hollowEnabled', true) };
  });
  check('every threat level says how soon it comes by itself, Nightmare sooner than Standard; the custom one can choose, down to "only with the power"',
    levels.presets.length === 3 && levels.presets.every((preset) => typeof preset[1] === 'number' && preset[1] > 0) &&
    levels.presets.filter((preset) => preset[0] === 'nightmare')[0][1] > levels.presets.filter((preset) => preset[0] === 'standard')[0][1] &&
    levels.option !== null && levels.option.kind === 'choice' && levels.option.choices.indexOf(0) >= 0 && levels.option.choices.indexOf(1) >= 0, levels);
  check('each choice is explained in minutes worked out from the numbers, and "with the power" says so; the switch for the Hollow no longer says it waits for the power',
    levels.explained.length === levels.option.choices.length && /Only once Generator 2 is running/.test(levels.explained[levels.option.choices.indexOf(0)]) &&
    new RegExp(levels.range[0] / 60 + ' to ' + levels.range[1] / 60 + ' quiet minutes').test(levels.explained[levels.option.choices.indexOf(1)]) &&
    levels.explained.every((text) => text.length > 20) && !/power/.test(levels.hollowSwitch), [levels.explained, levels.hollowSwitch]);

  // --- Kessel-9: as it was written. It comes with the mains and no sooner. ---
  const classic = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, result = {};
    d.loadStation('classic', 0);
    const wait = lab.descend();
    result.byThemselves = d.doCreaturesArriveByThemselves(); result.secondsUntil = d.getSecondsUntilArrival('hollow');
    for (let count = 0; count < 300; count++) d.emitNoise(d.player.x, d.player.z, 30);
    result.heard = lab.playAndRead(20);
    result.afterNoiseAndTime = { active: d.hollow.isActive, goneBy: wait.goneBy };
    d.use(2);
    d.simulate(d.tuning.hollowWakeDelaySeconds - 1);
    result.justBefore = d.hollow.isActive;
    d.simulate(1.5);
    result.woken = { active: d.hollow.isActive, cause: wait.cause, state: d.hollow.state, metresFromTheShaft: lab.metresFromTheShaft(),
      goesToTheGenerator: Math.hypot(d.hollow.targetX - d.level.generatorApproachX, d.hollow.targetZ - d.level.generatorApproachZ) < 0.01 || d.hollow.state !== 1 };
    result.said = lab.playAndRead(8);
    return result;
  });
  check('Kessel-9: nothing comes by itself, however long you take and however loud you are',
    classic.byThemselves === false && classic.secondsUntil === -1 && !classic.afterNoiseAndTime.active && classic.afterNoiseAndTime.goneBy === 0 && !/motion sensor/.test(classic.heard), classic);
  check('Kessel-9: it wakes at the shaft a few seconds after Generator 2 is started, as ever, and Dispatch blames the mains',
    !classic.justBefore && classic.woken.active && classic.woken.cause === 'mains' && classic.woken.metresFromTheShaft < 6 && classic.woken.goesToTheGenerator &&
    /Probably the mains coming back/.test(classic.said) && !/Keep the noise down/.test(classic.said), [classic.woken, classic.said]);

  // --- a generated station: the wait ---
  const waits = await inGame(async () => {
    const d = window.lastReturnDebug, lab = window.lab, result = {};
    result.seed = await lab.findStation('medium', 1);
    const range = d.tuning.hollowArrivalQuietSeconds;
    const draw = function (difficulty, descents) {
      d.game.difficulty = difficulty;
      const drawn = [];
      for (let count = 0; count < descents; count++) drawn.push(lab.descend().quietSeconds);
      return { fewest: Math.min.apply(null, drawn), most: Math.max.apply(null, drawn), different: new Set(drawn.map((seconds) => Math.round(seconds))).size,
        within: [range[0] / difficulty.arrivalFactor, range[1] / difficulty.arrivalFactor], byThemselves: d.doCreaturesArriveByThemselves(), secondsUntil: d.getSecondsUntilArrival('hollow') };
    };
    result.standard = draw(d.difficultyPresets.standard, 24);
    result.nightmare = draw(d.difficultyPresets.nightmare, 24);
    // No Hollow at all, and a custom level that keeps it for the mains.
    d.game.difficulty = d.difficultyPresets.survey; lab.descend();
    result.surveyOnly = d.getSecondsUntilArrival('hollow');
    const withThePower = d.createCustomDifficultyValues('standard'); withThePower.arrivalFactor = 0;
    d.game.difficulty = d.buildCustomDifficulty(withThePower); lab.descend();
    result.withThePower = { byThemselves: d.doCreaturesArriveByThemselves(), secondsUntil: d.getSecondsUntilArrival('hollow') };
    d.game.difficulty = d.difficultyPresets.standard;

    // What counts.
    const wait = d.arrivals.waits; let own = lab.descend();
    d.game.flags.hasLeftLift = false;
    d.simulate(5); d.emitNoise(d.player.x, d.player.z, 30);
    result.inTheCar = own.goneBy;
    d.game.flags.hasLeftLift = true;
    d.simulate(20);
    result.twentySeconds = own.goneBy;
    d.setDebugOption('freezeCreatures', true);
    d.simulate(10); d.emitNoise(d.player.x, d.player.z, 30);
    result.frozen = own.goneBy - result.twentySeconds;
    d.setDebugOption('freezeCreatures', false);
    const cost = function (radius) { const before = own.goneBy; d.emitNoise(d.player.x, d.player.z, radius); return Math.round((own.goneBy - before) * 100) / 100; };
    const perMetre = d.tuning.arrivalSecondsPerNoiseMetre, quiet = d.tuning.arrivalQuietNoiseRadius, round = (value) => Math.round(value * 100) / 100;
    result.noise = { crouchedStep: cost(d.tuning.noiseRadiusCrouchStep), walkingStep: cost(d.tuning.noiseRadiusWalkStep), scannerHum: cost(d.tuning.noiseRadiusScannerHum),
      door: [cost(d.tuning.noiseRadiusDoor), round((d.tuning.noiseRadiusDoor - quiet) * perMetre)],
      runningStep: [cost(d.tuning.noiseRadiusSprintStep), round((d.tuning.noiseRadiusSprintStep - quiet) * perMetre)],
      sweep: [cost(d.tuning.noiseRadiusSweep), round((d.tuning.noiseRadiusSweep - quiet) * perMetre)] };
    result.takenByNoise = round(own.takenByNoise);
    result.stillAsleep = !d.hollow.isActive;
    // The switch in debug mode.
    d.setDebugOption('holdArrivals', true);
    result.held = { byThemselves: d.doCreaturesArriveByThemselves(), secondsUntil: d.getSecondsUntilArrival('hollow') };
    d.setDebugOption('holdArrivals', false);
    return result;
  });
  check('there is a generated station to try it in', waits.seed > 0, waits.seed);
  check('Standard: how long it waits in silence is drawn afresh for every descent, between the two numbers the game is tuned to',
    waits.standard.byThemselves && waits.standard.fewest >= waits.standard.within[0] && waits.standard.most <= waits.standard.within[1] && waits.standard.different >= 12 &&
    Math.abs(waits.standard.secondsUntil - waits.standard.most) < 400, waits.standard);
  check('Nightmare: the same, divided by its factor',
    waits.nightmare.fewest >= waits.nightmare.within[0] - 0.001 && waits.nightmare.most <= waits.nightmare.within[1] + 0.001 && waits.nightmare.within[1] < waits.standard.within[1] && waits.nightmare.different >= 12, waits.nightmare);
  check('on a threat level with no Hollow nothing is waited for; on a custom one set to "with the power" it does not come by itself; nor with the debug switch on',
    waits.surveyOnly === -1 && waits.withThePower.byThemselves === false && waits.withThePower.secondsUntil === -1 && waits.held.byThemselves === false && waits.held.secondsUntil === -1,
    [waits.surveyOnly, waits.withThePower, waits.held]);
  check('nothing counts while you are in the lift car; once you are out, a second is a second; and nothing counts while the creatures are frozen',
    waits.inTheCar === 0 && Math.abs(waits.twentySeconds - 20) < 0.3 && waits.frozen === 0, [waits.inTheCar, waits.twentySeconds, waits.frozen]);
  check('a noise that carries no further than a walking step costs nothing (a crouched step, a walking step, the scanner\'s hum); a louder one costs by how far it carries (a door, a running step, a sweep)',
    waits.noise.crouchedStep === 0 && waits.noise.walkingStep === 0 && waits.noise.scannerHum === 0 &&
    waits.noise.door[0] === waits.noise.door[1] && waits.noise.runningStep[0] === waits.noise.runningStep[1] && waits.noise.sweep[0] === waits.noise.sweep[1] &&
    waits.noise.door[0] > 0 && waits.noise.runningStep[0] > waits.noise.door[0] && waits.noise.sweep[0] > waits.noise.runningStep[0] &&
    Math.abs(waits.takenByNoise - (waits.noise.door[0] + waits.noise.runningStep[0] + waits.noise.sweep[0])) < 0.02 && waits.stillAsleep, waits.noise);

  // --- a generated station: arriving ---
  const arriving = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, result = {};
    // By time alone.
    let wait = lab.descend();
    wait.quietSeconds = 6;
    d.simulate(5);
    result.byTime = { before: d.hollow.isActive };
    d.simulate(1.5);
    result.byTime.after = { active: d.hollow.isActive, cause: wait.cause, hunting: d.hollow.state === 2, metresFromTheShaft: lab.metresFromTheShaft(), powerOn: d.game.flags.powerOn, secondsUntil: d.getSecondsUntilArrival('hollow') };
    result.byTime.said = lab.playAndRead(6);
    // It comes once: sent away again (as the tests do), it does not come back by itself.
    d.hollow.isActive = false;
    for (let count = 0; count < 100; count++) d.emitNoise(d.player.x, d.player.z, 30);
    d.simulate(20);
    result.byTime.again = d.hollow.isActive;

    // By noise: it comes to look at where the noise was.
    wait = lab.descend();
    wait.quietSeconds = 60;
    const place = d.findWalkableSpotNear(d.player.x + 9, d.player.z + 4) || { x: d.player.x, z: d.player.z };
    let noises = 0;
    while (wait.isDue === '' && noises < 100) { d.emitNoise(place.x, place.z, d.tuning.noiseRadiusSweep); noises++; }
    result.byNoise = { noises: noises, due: wait.isDue, notYetHere: !d.hollow.isActive };
    d.simulate(0.1);
    result.byNoise.after = { active: d.hollow.isActive, cause: wait.cause, state: d.hollow.state, metresFromTheShaft: lab.metresFromTheShaft(),
      goesToTheNoise: Math.hypot(d.hollow.targetX - place.x, d.hollow.targetZ - place.z) < 0.01 };
    result.byNoise.said = lab.playAndRead(6);
    // Generator 2 is started with it already about: nothing wakes a second time, and Dispatch does not blame the mains.
    const whereItWas = [d.hollow.figure.x, d.hollow.figure.z];
    d.setDebugOption('freezeCreatures', true);
    d.use(2);
    result.mainsAfterwards = { powerOn: d.game.flags.powerOn, said: lab.playAndRead(14), cause: wait.cause, moved: Math.hypot(d.hollow.figure.x - whereItWas[0], d.hollow.figure.z - whereItWas[1]), active: d.hollow.isActive };
    d.setDebugOption('freezeCreatures', false);

    // Generator 2 started while it is still asleep: it wakes a few seconds on, and comes to the generator.
    wait = lab.descend();
    d.use(2);
    d.simulate(d.tuning.hollowWakeDelaySeconds - 1);
    result.mainsFirst = { justBefore: d.hollow.isActive };
    d.simulate(1.5);
    result.mainsFirst.after = { active: d.hollow.isActive, cause: wait.cause, state: d.hollow.state, metresFromTheShaft: lab.metresFromTheShaft(), secondsUntil: d.getSecondsUntilArrival('hollow'),
      goesToTheGenerator: Math.hypot(d.hollow.targetX - d.level.generatorApproachX, d.hollow.targetZ - d.level.generatorApproachZ) < 0.01 || d.hollow.state !== 1 };
    result.mainsFirst.said = lab.playAndRead(8);
    return result;
  });
  check('with nothing making a sound it wakes when its wait is over and not before: at the shaft, with the mains still off, not hunting; and it is not waited for any more',
    !arriving.byTime.before && arriving.byTime.after.active && arriving.byTime.after.cause === 'time' && !arriving.byTime.after.hunting && arriving.byTime.after.metresFromTheShaft < 6 &&
    !arriving.byTime.after.powerOn && arriving.byTime.after.secondsUntil === -1, arriving.byTime);
  check('Dispatch says the shaft sensor has tripped, and does not blame the mains', /motion sensor in the shaft chamber just tripped.*Keep the noise down/.test(arriving.byTime.said) && !/Probably the mains/.test(arriving.byTime.said), arriving.byTime.said);
  check('it comes once in a descent', arriving.byTime.again === false, arriving.byTime.again);
  check('noise brings it sooner: enough of it and the wait is over, it arrives at the next turn of the station, and it comes to look at where the noise was',
    arriving.byNoise.noises > 1 && arriving.byNoise.noises < 20 && arriving.byNoise.due === 'noise' && arriving.byNoise.notYetHere && arriving.byNoise.after.active && arriving.byNoise.after.cause === 'noise' &&
    arriving.byNoise.after.state === 1 && arriving.byNoise.after.goesToTheNoise && arriving.byNoise.after.metresFromTheShaft < 6 && /Keep the noise down/.test(arriving.byNoise.said), arriving.byNoise);
  check('Generator 2 started with it already about wakes nothing a second time (it is where it was), and Dispatch does not say the sensor tripped with the mains',
    arriving.mainsAfterwards.powerOn && arriving.mainsAfterwards.active && arriving.mainsAfterwards.cause === 'noise' && arriving.mainsAfterwards.moved < 0.01 &&
    /Mains restored|Generator 2 running/.test(arriving.mainsAfterwards.said) && !/Probably the mains/.test(arriving.mainsAfterwards.said), arriving.mainsAfterwards);
  check('Generator 2 started while it is still asleep wakes it a few seconds on, at the shaft, and it comes to the generator; Dispatch blames the mains, as in Kessel-9',
    !arriving.mainsFirst.justBefore && arriving.mainsFirst.after.active && arriving.mainsFirst.after.cause === 'mains' && arriving.mainsFirst.after.metresFromTheShaft < 6 &&
    arriving.mainsFirst.after.goesToTheGenerator && arriving.mainsFirst.after.secondsUntil === -1 && /Probably the mains coming back/.test(arriving.mainsFirst.said) && !/Keep the noise down/.test(arriving.mainsFirst.said),
    arriving.mainsFirst);

  // --- before the mains is on, it can get to you: through the ceiling ---
  const reach = [];
  for (const station of [['medium', 1, 'one'], ['large', 20, 'two'], ['small', 40, 'one']]) {
    reach.push(await inGame(async ([size, firstSeed, levels]) => {
      const d = window.lastReturnDebug, lab = window.lab, result = { size: size };
      result.seed = await lab.findStation(size, firstSeed, levels);
      const wait = lab.descend();
      // Out of the car, somewhere in the part you can reach without power, well away from the lift.
      const startTiles = d.findUnpoweredStartTiles();
      let far = null, farthest = 0;
      for (const index of startTiles) {
        const x = index % d.gridWidth + 0.5, z = Math.floor(index / d.gridWidth) + 0.5, metres = Math.hypot(x - d.playerStart.x, z - d.playerStart.z);
        if (metres > farthest) { farthest = metres; far = { x: x, z: z }; }
      }
      d.teleport(far.x, far.z, 0);
      result.hatchInThatPart = d.hollowHatches.filter((hatch) => startTiles.indexOf(hatch.index) >= 0).length;
      wait.quietSeconds = 1;
      d.emitNoise(d.player.x, d.player.z, d.tuning.noiseRadiusSweep);
      d.simulate(0.2);
      result.woken = d.hollow.isActive; result.stepsOnFoot = d.getHollowStepsTo(d.player.x, d.player.z);
      let seconds = 0, nearest = 999, hasCrawled = false;
      while (seconds < 240) {
        d.simulate(0.5); seconds += 0.5;
        if (d.isHollowInCrawlspace()) { hasCrawled = true; continue; }
        const metres = Math.hypot(d.hollow.figure.x - d.player.x, d.hollow.figure.z - d.player.z);
        nearest = Math.min(nearest, metres);
        if (hasCrawled && metres < 3) break;
        // (It hears nothing more of you while you stand still. Now and then, a noise, so that it keeps coming.)
        if (seconds % 15 === 0) d.emitNoise(d.player.x, d.player.z, d.tuning.noiseRadiusSweep);
      }
      result.came = { seconds: seconds, nearestMetres: Math.round(nearest * 10) / 10, throughTheCeiling: hasCrawled, powerOn: d.game.flags.powerOn,
        poweredDoorsShutToIt: d.doors.filter((door) => door.kind === d.doorKinds.powered).every((door) => !d.canHollowOpenDoor(door)) };
      return result;
    }, station));
  }
  for (const entry of reach) {
    check(entry.size + ' station: woken before the mains is on, with every powered door shut to it, it comes through the ceiling and is at you within four minutes',
      entry.seed > 0 && entry.hatchInThatPart >= 1 && entry.woken && entry.came.throughTheCeiling && entry.came.nearestMetres <= 3 && !entry.came.powerOn && entry.came.poweredDoorsShutToIt, entry);
  }

  // --- the hatches: its second way through the whole station ---
  const hatches = await inGame(async () => {
    const d = window.lastReturnDebug, result = { bad: [], perRoom: [], sizes: {} };
    for (const size of ['small', 'medium', 'large', 'massive']) {
      const counts = [];
      for (let seed = 1; seed <= 8; seed++) {
        await window.letTheBrowserCatchUp();
        if (!d.loadStation('generated', seed, size, ['tight', 'mixed', 'sprawling', 'sparse'][seed % 4], seed % 2 ? 'one' : 'two')) { result.bad.push(size + ' ' + seed + ': not built'); continue; }
        const problems = d.auditHollowRoutes();
        if (problems.length > 0) result.bad.push(size + ' ' + seed + ': ' + problems.slice(0, 2).join('; '));
        const startTiles = d.findUnpoweredStartTiles();
        if (!d.hollowHatches.some((hatch) => startTiles.indexOf(hatch.index) >= 0)) result.bad.push(size + ' ' + seed + ': no hatch in the part you can reach without the mains');
        // No two on the same tile, and none where the audit of the map would object.
        if (new Set(d.hollowHatches.map((hatch) => hatch.index)).size !== d.hollowHatches.length) result.bad.push(size + ' ' + seed + ': two hatches on one tile');
        counts.push(d.hollowHatches.length);
        result.perRoom.push(d.hollowHatches.length / d.level.roomCount);
      }
      result.sizes[size] = { fewest: Math.min.apply(null, counts), most: Math.max.apply(null, counts) };
    }
    d.loadStation('classic', 0);
    result.classic = { hatches: d.hollowHatches.length, problems: d.auditHollowRoutes(), inTheStartPart: d.hollowHatches.filter((hatch) => d.findUnpoweredStartTiles().indexOf(hatch.index) >= 0).length };
    result.perRoom.sort((a, b) => a - b);
    return result;
  });
  check('32 stations of every size: each has a hatch in the part you can reach without the mains, the Hollow can get there from the shaft with the powered doors shut, and the locks still stop it on foot',
    hatches.bad.length === 0, hatches.bad.slice(0, 4));
  check('there are hatches all through a station, not only at its locked doors: at least one to every five rooms, in every station, and more in a bigger one',
    hatches.perRoom[0] >= 0.2 && hatches.sizes.massive.fewest > hatches.sizes.small.most, [hatches.sizes, hatches.perRoom[0], hatches.perRoom[hatches.perRoom.length - 1]]);
  check('Kessel-9 has them too, one of them in the part before the powered doors, and its routes check out', hatches.classic.hatches >= 6 && hatches.classic.inTheStartPart >= 1 && hatches.classic.problems.length === 0, hatches.classic);

  // --- more than one thing arrives: one first, either one, and the others later ---
  const roster = await inGame(async () => {
    const d = window.lastReturnDebug, lab = window.lab, result = {};
    result.seed = await lab.findStation('medium', 1);
    if (!result.seed) return result;
    d.game.difficulty = d.difficultyPresets.standard;
    const here = () => ({ hollow: d.hollow.isActive, surveyor: d.surveyor.isActive });
    const metresFromTheShaft = (figure) => Math.round(Math.hypot(figure.x - d.hollowSpawn.x, figure.z - d.hollowSpawn.z) * 100) / 100;
    result.threatLevels = Object.keys(d.difficultyPresets).map((key) => [key, d.difficultyPresets[key].hollowEnabled, d.difficultyPresets[key].surveyorEnabled]);
    result.nextRange = d.tuning.arrivalNextQuietSeconds; result.firstRange = d.tuning.hollowArrivalQuietSeconds;

    // The order is drawn afresh for every descent, and both come first some of the time.
    d.debugState.arrivalOrder = null;
    const firsts = { hollow: 0, surveyor: 0 }, wrong = [];
    for (let descent = 0; descent < 40; descent++) {
      d.startOver();
      const order = d.arrivals.order.slice();
      if (order.slice().sort().join() !== 'hollow,surveyor') wrong.push(order.join());
      else firsts[order[0]]++;
      const places = [d.arrivals.waits.hollow.place, d.arrivals.waits.surveyor.place];
      if (places[0] !== order.indexOf('hollow') || places[1] !== order.indexOf('surveyor')) wrong.push('places ' + places.join());
    }
    result.drawn = { firsts: firsts, wrong: wrong };
    // Kessel-9, and a threat level without it: the Hollow alone.
    d.loadStation('classic', 0); d.startOver();
    result.classicOrder = d.arrivals.order.join();
    d.loadStation('generated', result.seed, 'medium', 'mixed', 'one');
    d.game.difficulty = d.difficultyPresets.survey; d.startOver();
    result.surveyOnlyOrder = d.arrivals.order.join();
    d.game.difficulty = d.difficultyPresets.standard;

    // The Surveyor first. Its wait runs out; the Hollow's has not begun.
    d.debugState.arrivalOrder = ['surveyor', 'hollow'];
    lab.descend(true);
    let first = d.arrivals.waits.surveyor, second = d.arrivals.waits.hollow;
    result.surveyorFirst = { order: d.arrivals.order.join(), firstWaits: Math.round(first.quietSeconds), secondWaits: Math.round(second.quietSeconds),
      untilFirst: Math.round(d.getSecondsUntilArrival('surveyor')), untilSecondBeforeItsTurn: Math.round(d.getSecondsUntilArrival('hollow')) };
    first.quietSeconds = 5;
    d.simulate(4);
    result.surveyorFirst.before = { here: here(), secondGoneBy: second.goneBy };
    d.simulate(1.5);
    result.surveyorFirst.arrived = { here: here(), cause: first.cause, metresFromTheShaft: metresFromTheShaft(d.surveyor.figure), secondGoneBy: Math.round(second.goneBy * 10) / 10 };
    result.surveyorFirst.said = lab.playAndRead(6);
    // Now the Hollow's own wait runs. A noise takes time off it; when it is over the Hollow comes too, and Dispatch counts.
    const goneByBefore = second.goneBy;
    d.emitNoise(d.player.x, d.player.z, d.tuning.noiseRadiusSweep);
    result.surveyorFirst.noiseTookOffTheSecond = Math.round((second.goneBy - goneByBefore) * 100) / 100;
    result.surveyorFirst.noiseShouldTake = Math.round((d.tuning.noiseRadiusSweep - d.tuning.arrivalQuietNoiseRadius) * d.tuning.arrivalSecondsPerNoiseMetre * 100) / 100;
    second.quietSeconds = second.goneBy + 3;
    d.simulate(2);
    result.surveyorFirst.secondNotYet = here();
    d.simulate(1.5);
    result.surveyorFirst.both = { here: here(), cause: second.cause, hollowMetresFromTheShaft: metresFromTheShaft(d.hollow.figure) };
    result.surveyorFirst.saidThen = lab.playAndRead(6);

    // The Hollow first, the Surveyor after it.
    d.debugState.arrivalOrder = ['hollow', 'surveyor'];
    lab.descend(true);
    first = d.arrivals.waits.hollow; second = d.arrivals.waits.surveyor;
    first.quietSeconds = 3;
    d.simulate(4);
    result.hollowFirst = { order: d.arrivals.order.join(), afterTheFirst: here() };
    second.quietSeconds = second.goneBy + 2;
    d.simulate(3);
    result.hollowFirst.both = here();

    // The mains comes on with nothing about yet: the first in the order wakes, and only that one.
    d.debugState.arrivalOrder = ['surveyor', 'hollow'];
    lab.descend(true);
    d.use(2);
    d.simulate(d.tuning.hollowWakeDelaySeconds + 1);
    result.mains = { powerOn: d.game.flags.powerOn, here: here(), cause: d.arrivals.waits.surveyor.cause, hollowWaits: Math.round(d.getSecondsUntilArrival('hollow')) };
    // ... and with one about already, the mains wakes nothing more.
    lab.descend(true);
    d.arrivals.waits.surveyor.quietSeconds = 1;
    d.simulate(2);
    const hereBeforeTheMains = here();
    d.arrivals.waits.hollow.quietSeconds = 9999;
    d.use(2);
    d.simulate(d.tuning.hollowWakeDelaySeconds + 2);
    result.mainsAfter = { before: hereBeforeTheMains, after: here(), powerOn: d.game.flags.powerOn };

    d.debugState.arrivalOrder = ['hollow', 'surveyor'];
    d.surveyor.isActive = false; d.hollow.isActive = false;
    return result;
  });
  check('there is a generated station to try the two of them in', roster.seed > 0, roster.seed);
  if (roster.seed > 0) {
    check('the Surveyor is one of the things that arrive on Standard and Nightmare, not on Survey only; the wait of one that comes second is a number of its own',
      roster.threatLevels.join(' ') === 'survey,false,false standard,true,true nightmare,true,true' && Array.isArray(roster.nextRange) && roster.nextRange[0] > 0 && roster.nextRange[1] > roster.nextRange[0], [roster.threatLevels, roster.nextRange]);
    check('which of them comes first is drawn afresh for every descent: in forty descents each is first some of the time, and both are always in the order, once',
      roster.drawn.wrong.length === 0 && roster.drawn.firsts.hollow >= 5 && roster.drawn.firsts.surveyor >= 5 && roster.drawn.firsts.hollow + roster.drawn.firsts.surveyor === 40, roster.drawn);
    check('Kessel-9 has the Hollow alone, and so has a threat level without the Surveyor', roster.classicOrder === 'hollow' && roster.surveyOnlyOrder === '', [roster.classicOrder, roster.surveyOnlyOrder]);
    check('with the Surveyor first: its wait is the first wait, and the Hollow\'s does not run until the Surveyor has come',
      roster.surveyorFirst.order === 'surveyor,hollow' && roster.surveyorFirst.firstWaits >= roster.firstRange[0] && roster.surveyorFirst.firstWaits <= roster.firstRange[1] &&
      roster.surveyorFirst.secondWaits >= roster.nextRange[0] && roster.surveyorFirst.secondWaits <= roster.nextRange[1] && roster.surveyorFirst.untilFirst > 0 && roster.surveyorFirst.untilSecondBeforeItsTurn > 0 &&
      !roster.surveyorFirst.before.here.surveyor && !roster.surveyorFirst.before.here.hollow && roster.surveyorFirst.before.secondGoneBy === 0, roster.surveyorFirst);
    check('it arrives alone, at the shaft, when its wait is over, and Dispatch says the shaft sensor has tripped',
      roster.surveyorFirst.arrived.here.surveyor && !roster.surveyorFirst.arrived.here.hollow && roster.surveyorFirst.arrived.cause === 'time' && roster.surveyorFirst.arrived.metresFromTheShaft < 3 &&
      /motion sensor in the shaft chamber just tripped/.test(roster.surveyorFirst.said) && !/shaft sensor again/.test(roster.surveyorFirst.said), roster.surveyorFirst);
    check('from then the Hollow\'s own wait runs, sooner for every noise; when it is over the Hollow comes too, and Dispatch says there are two',
      roster.surveyorFirst.arrived.secondGoneBy > 0 && roster.surveyorFirst.arrived.secondGoneBy < 2 && Math.abs(roster.surveyorFirst.noiseTookOffTheSecond - roster.surveyorFirst.noiseShouldTake) < 0.02 &&
      roster.surveyorFirst.noiseShouldTake > 0 && !roster.surveyorFirst.secondNotYet.hollow && roster.surveyorFirst.both.here.hollow && roster.surveyorFirst.both.here.surveyor &&
      roster.surveyorFirst.both.hollowMetresFromTheShaft < 3 && /The shaft sensor again/.test(roster.surveyorFirst.saidThen), roster.surveyorFirst);
    check('the other way round the Hollow comes first and the Surveyor after it',
      roster.hollowFirst.order === 'hollow,surveyor' && roster.hollowFirst.afterTheFirst.hollow && !roster.hollowFirst.afterTheFirst.surveyor && roster.hollowFirst.both.hollow && roster.hollowFirst.both.surveyor, roster.hollowFirst);
    check('Generator 2 started with nothing about wakes the first in the order and only that one: the other keeps to its wait',
      roster.mains.powerOn && roster.mains.here.surveyor && !roster.mains.here.hollow && roster.mains.cause === 'mains' && roster.mains.hollowWaits > 0, roster.mains);
    check('started with one of them about already, it wakes nothing more',
      roster.mainsAfter.before.surveyor && !roster.mainsAfter.before.hollow && roster.mainsAfter.powerOn && roster.mainsAfter.after.surveyor && !roster.mainsAfter.after.hollow, roster.mainsAfter);
  }

  check('no script errors were reported', problems.length === 0, problems);
  await browser.close();

  if (failures.length > 0) {
    console.log('\n' + failures.length + ' arrival check(s) failed:');
    for (const failure of failures) console.log('  - ' + failure);
    process.exit(1);
  }
  console.log('\nAll arrival checks passed.');
})().catch((error) => { console.error('Arrivals test crashed:', error); process.exit(1); });
