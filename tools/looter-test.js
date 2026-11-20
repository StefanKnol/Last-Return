// Checks the looters (src/js/08-looter.js): where they live and how many there are, that one goes for a thing
// that lies loose and carries it home, that noise makes it drop what it has and run, that it takes a thing out
// of your beam only if it can reach it, and that you can take a thing back out of its arms.
//
// The station is whichever generated one the first seeds give that has a looter with a room to go to. The
// things are put there by the checks: everything else that lies loose is cleared away first, so that what a
// looter goes for is what the check put down.
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
  lab.state = function (looter) { return d.looterStates[looter.state]; };
  lab.round = function (value) { return Math.round(value * 100) / 100; };
  // A generated station that has a looter, quiet (nothing arrives, nothing catches anybody), with nothing lying
  // loose in it and the mains on. Returns the first looter, or null.
  lab.station = function (size) {
    for (let seed = 1; seed <= 40; seed++) {
      if (!d.loadStation('generated', seed, size || 'medium', 'mixed', 'one') || d.looters.length === 0) continue;
      const looter = d.looters[0];
      // Somewhere for a thing to lie: plain floor of a room some ten to twenty steps from its nest, on its own floor.
      lab.spot = null;
      for (const waypoint of d.roamingWaypoints) {
        const metres = Math.hypot(waypoint[0] - looter.nest.x, waypoint[1] - looter.nest.z);
        if (metres < 6 || metres > 16 || d.isVentAt(waypoint[0], waypoint[1]) || Math.abs(d.getFloorHeightAt(waypoint[0], waypoint[1]) - looter.nest.floorY) > 0.01) continue;
        const field = new Int16Array(d.creatureWays[0].tileBlocks.length);
        d.game.flags.powerOn = true; d.refreshCreatureDoorBlocks();
        d.computeWayDistanceField(looter.way, field, d.findNearestWalkableTileIndex(looter.nest.x, looter.nest.z), true);
        const steps = field[d.findNearestWalkableTileIndex(waypoint[0], waypoint[1])];
        if (steps < 8 || steps > 40) continue;
        lab.spot = { x: waypoint[0], z: waypoint[1], steps: steps };
        break;
      }
      if (!lab.spot) continue;
      d.game.flags.hasLeftLift = true; d.game.flags.powerOn = true;
      d.setDebugOption('invulnerable', true); d.setDebugOption('holdArrivals', true);
      d.hollow.isActive = false;
      d.clearLooseObjects();
      d.settings.captions = 'all';
      // One looter, so that what is seen is what this one does: another would get to the thing first every so often.
      for (const other of d.looters.slice(1)) d.setFigureRaycastable(other.figure, false);
      d.looters.length = 1;
      lab.seed = seed;
      return looter;
    }
    return null;
  };
  // Lets time pass until `isDone` says so, or the time is up. Returns the seconds it took, or -1.
  lab.until = function (isDone, mostSeconds) {
    for (let seconds = 0; seconds <= mostSeconds; seconds += 0.1) {
      if (isDone()) return Math.round(seconds * 10) / 10;
      d.simulate(0.1);
    }
    return isDone() ? mostSeconds : -1;
  };
  lab.inNest = function (looter, object) { return Math.hypot(object.x - looter.nest.x, object.z - looter.nest.z) < 1.3; };
  // Puts a thing on the floor at the spot and lets it come to rest.
  lab.putDown = function (kindKey) {
    const object = d.createLooseObject(kindKey, lab.spot.x, d.getFloorHeightAt(lab.spot.x, lab.spot.z) + 0.3, lab.spot.z, 0);
    for (let step = 0; step < 120 && !object.isAsleep; step++) d.simulate(1 / 30);
    return object;
  };
  // You, standing still a step and a half from the spot (near enough to hear what happens there), on open floor.
  lab.standBy = function () {
    for (const [stepX, stepZ] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const x = lab.spot.x + stepX * 1.5, z = lab.spot.z + stepZ * 1.5;
      if (!d.isSpaceOpenAt(x, d.getFloorHeightAt(lab.spot.x, lab.spot.z) + 0.5, z) || d.isVentAt(x, z)) continue;
      d.teleport(x, z, 0); d.player.velocityX = 0; d.player.velocityZ = 0;
      return true;
    }
    d.teleport(lab.spot.x, lab.spot.z, 0); d.player.velocityX = 0; d.player.velocityZ = 0;
    return false;
  };
  // Sends the looter out now, with nothing put off for later.
  lab.sendOut = function (looter) { looter.ignored = {}; looter.state = 0; looter.timer = 0; };
  window.lab = lab;
});

(async () => {
  const { browser, page, problems } = await openGame({ dev: true, looters: true });
  const inGame = (callback, argument) => page.evaluate(callback, argument);
  await startGame(page, false);
  await inGame((source) => (0, eval)('(' + source + ')')(), labSource);

  // --- where they live, and how many there are ---
  const living = await inGame(() => {
    const d = window.lastReturnDebug, seen = { stations: [], kessel: -1 };
    d.loadStation('classic', 0);
    seen.kessel = d.looters.length;
    for (let seed = 1; seed <= 12; seed++) {
      if (!d.loadStation('generated', seed, 'medium', 'mixed', seed % 2 ? 'one' : 'two')) continue;
      const nests = d.looters.map((looter) => looter.nest);
      seen.stations.push({ seed: seed, looters: d.looters.length, wanted: d.game.difficulty.looterCount, nestsThereAre: d.level.ventNests.length,
        allInVents: d.looters.every((looter) => d.isVentAt(looter.figure.x, looter.figure.z) && Math.hypot(looter.figure.x - looter.nest.x, looter.figure.z - looter.nest.z) < 0.01),
        nestsOfTheirOwn: new Set(nests).size === nests.length,
        deadEndsFirst: d.level.ventPockets.length === 0 || nests.some((nest) => nest.isPocket),
        tallest: Math.max.apply(null, d.looters.map((looter) => (looter.figure.boundsCenterY - looter.figure.y) * 2).concat([0])) });
    }
    seen.ventHeight = d.ventHeight;
    return seen;
  });
  check('Kessel-9 has no vents, and so no looters', living.kessel === 0, living.kessel);
  check('a generated station has as many looters as the threat level says, or as many as it has nests for if that is fewer: each at home in a vent, in a nest of its own, a dead end if the station has one',
    living.stations.length >= 8 && living.stations.every((station) => station.looters === Math.min(station.wanted, station.nestsThereAre) && station.allInVents && station.nestsOfTheirOwn && station.deadEndsFirst) &&
    living.stations.some((station) => station.looters >= 2), living.stations);
  check('a looter is under a metre tall, and so walks upright where you crawl',
    living.stations.every((station) => station.looters === 0 || (station.tallest > 0.4 && station.tallest < 1 && station.tallest < living.ventHeight)), living.stations.map((station) => Math.round(station.tallest * 100) / 100));

  // --- what it carries off, and what it leaves ---
  const lootable = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab;
    if (!lab.station()) return null;
    const answers = {};
    for (const kindKey of ['jar', 'toolCase', 'fuelCan', 'pumpMotor', 'pipe', 'ventCover']) {
      const object = d.createLooseObject(kindKey, lab.spot.x, 1, lab.spot.z, 0);
      answers[kindKey] = { takes: d.isLootable(object), kilograms: object.kind.mass, reaches: Math.round(object.prepared.boundsRadius * 100) / 100 };
      d.removeLooseObject(object);
    }
    answers.most = { kilograms: d.tuning.looterCarriesKilograms, reaches: d.tuning.looterCarriesReach };
    return answers;
  });
  check('it carries off what is small and light enough (a jar, a tool case, the fuel can), and leaves what is too heavy (a pump motor), too long (a length of pipe), or the cover of a vent',
    lootable !== null && lootable.jar.takes && lootable.toolCase.takes && lootable.fuelCan.takes && !lootable.pumpMotor.takes && lootable.pumpMotor.kilograms > lootable.most.kilograms &&
    !lootable.pipe.takes && lootable.pipe.reaches > lootable.most.reaches && !lootable.ventCover.takes, lootable);

  // --- it goes for a thing and carries it home ---
  const fetch = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, looter = lab.station();
    if (!looter) return null;
    const seen = { seed: lab.seed, steps: lab.spot.steps };
    lab.standBy();
    const jar = lab.putDown('jar');
    seen.jarLiesAtTheSpot = Math.hypot(jar.x - lab.spot.x, jar.z - lab.spot.z) < 0.5 && jar.isAsleep;
    d.captionCounts.looterTakes = 0; d.captionCounts.looterSteps = 0;
    lab.sendOut(looter);
    seen.wentAfterIt = lab.until(() => looter.wanted === jar, 2) >= 0 && lab.state(looter) === 'after a thing';
    seen.secondsToTakeIt = lab.until(() => looter.carried === jar, 60);
    seen.tookItThere = Math.hypot(looter.figure.x - lab.spot.x, looter.figure.z - lab.spot.z) < 1.6;
    // In its arms: where the looter is, off the floor, and no longer a thing that lies anywhere by itself.
    d.simulate(1);
    seen.inItsArms = jar.looterIndex === looter.index && Math.hypot(jar.x - looter.figure.x, jar.z - looter.figure.z) < 0.6 && jar.y - looter.figure.y > 0.15 && jar.isAsleep;
    seen.state = lab.state(looter);
    const startedAt = [looter.figure.x, looter.figure.z, d.game.time];
    d.simulate(2);
    seen.carrySpeed = lab.round(Math.hypot(looter.figure.x - startedAt[0], looter.figure.z - startedAt[1]) / (d.game.time - startedAt[2]));
    seen.secondsHome = lab.until(() => looter.state === 0, 90);
    d.simulate(2);
    seen.jarInTheNest = lab.inNest(looter, jar) && jar.looterIndex === -1 && d.isVentAt(jar.x, jar.z);
    seen.jarLiesStill = jar.isAsleep; seen.jarOnTheFloor = lab.round(jar.y - d.getFloorHeightAt(jar.x, jar.z));
    seen.said = { takes: d.captionCounts.looterTakes || 0, steps: d.captionCounts.looterSteps || 0 };
    seen.itRests = looter.timer >= d.tuning.looterRestSeconds[0] - 2.5;
    // And what lies in a nest is left there: it does not go for it again.
    lab.sendOut(looter);
    d.simulate(3);
    seen.leavesItThere = looter.wanted !== jar && looter.carried !== jar;
    seen.speeds = { walk: d.tuning.looterWalkSpeed, carry: d.tuning.looterCarrySpeed, crouch: d.tuning.crouchSpeed };
    return seen;
  });
  check('there is a station with a looter and a room for it to go to', fetch !== null, fetch ? fetch.seed : 'none among forty seeds');
  check('sent out, it goes after a thing that lies loose within its range, takes it where it lies, and has it in its arms: the thing is where the looter is',
    fetch !== null && fetch.jarLiesAtTheSpot && fetch.wentAfterIt && fetch.secondsToTakeIt > 0 && fetch.secondsToTakeIt < 10 + fetch.steps / fetch.speeds.walk * 1.6 && fetch.tookItThere && fetch.inItsArms &&
    fetch.state === 'carrying a thing home', fetch);
  check('it carries the thing home, slower than you creep, puts it down in its nest in the vent, where it lies still, and sits down for a while; it is heard taking it and walking, and it leaves what lies in a nest alone',
    fetch !== null && fetch.carrySpeed > 0.5 && fetch.carrySpeed <= fetch.speeds.carry + 0.05 && fetch.speeds.carry < fetch.speeds.crouch && fetch.secondsHome > 0 && fetch.jarInTheNest && fetch.jarLiesStill &&
    fetch.jarOnTheFloor < 0.2 && fetch.itRests && fetch.said.takes === 1 && fetch.said.steps >= 5 && fetch.leavesItThere, fetch);

  // --- noise: how loud it is where the looter stands says what comes of it ---
  const fear = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, looter = lab.station();
    if (!looter) return null;
    const run = d.tuning.noiseRadiusSprintStep, hearsTo = run * d.tuning.looterHearingFactor;
    const seen = { startledAt: d.tuning.looterStartledAt, scaredAt: d.tuning.looterScaredAt, backsOffFor: d.tuning.looterStartledSeconds, backsOffAt: d.tuning.looterBackOffSpeed,
      onEdgeFor: d.tuning.looterOnEdgeSeconds, steadyFor: d.tuning.looterSteadySeconds };
    // A running step, as loud to the looter as `loudness` says: so many metres to one side of it.
    const metresFor = function (loudness) { return hearsTo * (1 - loudness); };
    let noiseAt = [0, 0];
    const aRunningStep = function (loudness) { noiseAt = [looter.figure.x + metresFor(loudness), looter.figure.z]; d.emitNoise(noiseAt[0], noiseAt[1], run); };
    const metresFromTheNoise = function () { return Math.hypot(looter.figure.x - noiseAt[0], looter.figure.z - noiseAt[1]); };
    lab.standBy();
    const jar = lab.putDown('jar');
    lab.sendOut(looter);
    seen.tookIt = lab.until(() => looter.carried === jar, 60) >= 0;
    d.simulate(1.5);
    // What it is used to: a walking step, right beside it.
    d.emitNoise(looter.figure.x + 0.5, looter.figure.z, d.tuning.noiseRadiusWalkStep);
    d.simulate(0.3);
    seen.afterAStep = { state: lab.state(looter), hasIt: looter.carried === jar };
    // A running step that it hears, but far off: quieter to it than what startles it.
    d.captionCounts.looterStartled = 0; d.captionCounts.looterScared = 0;
    aRunningStep(seen.startledAt * 0.5);
    d.simulate(0.3);
    seen.afterAFarOne = { state: lab.state(looter), hasIt: looter.carried === jar, said: d.captionCounts.looterStartled || 0 };
    // Nearer: between what startles it and what frightens it. It stops, turns to the noise and backs away from it, with the thing still in its arms.
    aRunningStep((seen.startledAt + seen.scaredAt) / 2);
    seen.startled = { state: lab.state(looter), hasIt: looter.carried === jar, said: d.captionCounts.looterStartled || 0, squealed: d.captionCounts.looterScared || 0 };
    const from = [looter.figure.x, looter.figure.z, metresFromTheNoise(), d.game.time];
    d.simulate(1.5);
    const towards = Math.atan2(noiseAt[0] - looter.figure.x, -(noiseAt[1] - looter.figure.z));
    seen.backingOff = { state: lab.state(looter), hasIt: looter.carried === jar, moved: lab.round(Math.hypot(looter.figure.x - from[0], looter.figure.z - from[1])),
      fartherBy: lab.round(metresFromTheNoise() - from[2]), speed: lab.round(Math.hypot(looter.figure.x - from[0], looter.figure.z - from[1]) / (d.game.time - from[3])),
      facesIt: Math.abs(Math.atan2(Math.sin(towards - looter.figure.yaw), Math.cos(towards - looter.figure.yaw))) < 0.5, hasNowhereToGo: looter.isTargetOutOfReach === true };
    seen.secondsStartled = lab.until(() => looter.state !== 9, 6) + 1.5;
    seen.thenGoesOn = { state: lab.state(looter), hasIt: looter.carried === jar };
    // Still on edge: the same noise again is too much. It lets the thing fall where it stands, squeals and runs home.
    const where = [looter.figure.x, looter.figure.z];
    aRunningStep((seen.startledAt + seen.scaredAt) / 2);
    d.simulate(0.2);
    seen.onEdge = { state: lab.state(looter), hasIt: looter.carried === jar, jarIsItsOwnAgain: jar.looterIndex === -1, said: d.captionCounts.looterScared || 0 };
    const before = [looter.figure.x, looter.figure.z, d.game.time];
    d.simulate(1);
    seen.runsAt = lab.round(Math.hypot(looter.figure.x - before[0], looter.figure.z - before[1]) / (d.game.time - before[2]));
    seen.secondsHome = lab.until(() => looter.state === 0, 60);
    seen.staysIn = looter.timer >= d.tuning.looterFearSeconds[0] - 0.5;
    d.simulate(3);
    seen.jarLiesWhereItFell = Math.hypot(jar.x - where[0], jar.z - where[1]) < 2.5 && !lab.inNest(looter, jar) && jar.isAsleep;
    // Out again, and calm again: a running step near it, louder to it than what frightens it, frightens it at once.
    lab.sendOut(looter);
    seen.wentOutAgain = lab.until(() => looter.carried === jar, 60) >= 0;
    d.simulate(0.5);
    // (And one out of its hearing does nothing at all.)
    d.emitNoise(looter.figure.x + hearsTo + 3, looter.figure.z, run);
    d.simulate(0.3);
    seen.afterOneOutOfHearing = { state: lab.state(looter), hasIt: looter.carried === jar };
    aRunningStep(Math.min(0.98, seen.scaredAt + 0.1));
    seen.afterANearOne = { state: lab.state(looter), hasIt: looter.carried === jar };
    seen.speeds = { flee: d.tuning.looterFleeSpeed, walk: d.tuning.walkSpeed };
    return seen;
  });
  check('a walking step beside it does not trouble it, and neither does a running step far off, though it hears it: quieter to it than what startles it is nothing to it',
    fear !== null && fear.tookIt && fear.afterAStep.state === 'carrying a thing home' && fear.afterAStep.hasIt && fear.afterAFarOne.state === 'carrying a thing home' && fear.afterAFarOne.hasIt && fear.afterAFarOne.said === 0 &&
    fear.startledAt > 0 && fear.scaredAt > fear.startledAt && fear.scaredAt < 1, fear);
  check('a noise between what startles it and what frightens it startles it: it chirps, turns to the noise and backs away from it slowly with the thing still in its arms, and after a few seconds goes on home with it',
    fear !== null && fear.startled.state === 'startled' && fear.startled.hasIt && fear.startled.said === 1 && fear.startled.squealed === 0 &&
    fear.backingOff.state === 'startled' && fear.backingOff.hasIt && fear.backingOff.facesIt && fear.backingOff.fartherBy > -0.05 && fear.backingOff.speed <= fear.backsOffAt + 0.05 &&
    (fear.backingOff.moved > 0.2 || fear.backingOff.hasNowhereToGo) && fear.secondsStartled >= fear.backsOffFor[0] - 0.2 && fear.secondsStartled <= fear.backsOffFor[1] + 0.3 &&
    fear.thenGoesOn.state === 'carrying a thing home' && fear.thenGoesOn.hasIt, fear);
  check('still on edge, the same noise again frightens it: it lets the thing fall where it stands, squeals, and runs home faster than you walk, where it stays for a while',
    fear !== null && fear.onEdgeFor > fear.backsOffFor[1] + fear.steadyFor && fear.onEdge.state === 'frightened' && !fear.onEdge.hasIt && fear.onEdge.jarIsItsOwnAgain && fear.onEdge.said === 1 &&
    fear.runsAt > fear.speeds.walk && fear.runsAt <= fear.speeds.flee + 0.1 && fear.secondsHome > 0 && fear.staysIn && fear.jarLiesWhereItFell, fear);
  check('a noise louder to it than what frightens it frightens it at once; one out of its hearing does nothing',
    fear !== null && fear.wentOutAgain && fear.afterOneOutOfHearing.state === 'carrying a thing home' && fear.afterOneOutOfHearing.hasIt && fear.afterANearOne.state === 'frightened' && !fear.afterANearOne.hasIt, fear);

  // --- out of your beam: only if it can reach ---
  const hands = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, looter = lab.station(), p = d.player;
    if (!looter) return null;
    const seen = { reach: d.tuning.looterReachHeight };
    const jar = lab.putDown('jar');
    // You, standing still at the spot with the jar in the beam, looking up: it hangs high.
    d.teleport(lab.spot.x, lab.spot.z - 0.9, Math.PI); p.velocityX = 0; p.velocityZ = 0;
    d.simulate(0.3);
    d.pickUpLooseObject(jar, false);
    p.pitch = 0.75;
    d.simulate(1.5);
    seen.held = d.getHeldLooseObject() === jar;
    seen.heldHigh = lab.round(jar.y - p.floorY);
    d.captionCounts.looterTries = 0;
    lab.sendOut(looter);
    seen.cameForIt = lab.until(() => looter.state === 2, 60) >= 0; // reaching for a thing
    seen.armsUp = lab.until(() => looter.figure.pose.armRaise > 2, 2) >= 0;
    seen.secondsTrying = lab.until(() => looter.state !== 2, 20);
    seen.stillYours = d.getHeldLooseObject() === jar && jar.looterIndex === -1;
    seen.gaveUp = { state: lab.state(looter), said: d.captionCounts.looterTries || 0, triesFor: d.tuning.looterTriesSeconds };
    // The same, looking at the floor in front of you: it hangs low.
    seen.secondsHomeAgain = lab.until(() => looter.state === 0, 60);
    p.pitch = -0.5;
    d.simulate(1.5);
    seen.heldLow = lab.round(jar.y - p.floorY);
    lab.sendOut(looter);
    seen.secondsToTakeIt = lab.until(() => looter.carried === jar, 60);
    seen.outOfYourBeam = d.getHeldLooseObject() === null && !jar.isHeld && jar.looterIndex === looter.index;
    return seen;
  });
  check('a thing in your beam that hangs higher than it can reach: it comes, stands under it with its arms up, scolds, and gives up; the thing is still yours',
    hands !== null && hands.held && hands.heldHigh > hands.reach && hands.cameForIt && hands.armsUp && hands.secondsTrying > 0 && hands.secondsTrying <= hands.gaveUp.triesFor + 0.5 &&
    hands.stillYours && hands.gaveUp.state === 'going home' && hands.gaveUp.said === 1, hands);
  check('the same thing carried low, where it can reach: it takes it out of your beam',
    hands !== null && hands.heldLow <= hands.reach && hands.secondsToTakeIt > 0 && hands.outOfYourBeam, hands);

  // --- what it likes best: what one of you has had in the beam ---
  const likes = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, looter = lab.station();
    if (!looter) return null;
    const seen = { tries: 40, forTheHandledOne: 0, likes: { handled: d.tuning.looterLikesHandled, carried: d.tuning.looterLikesCarried, bay: d.tuning.looterLikesBay } };
    // Two of the same thing in the same place, one of which you have had in the beam.
    const plain = lab.putDown('jar'), handled = lab.putDown('jar');
    handled.wasHandled = true;
    seen.sameWorth = d.getLooseObjectValue(plain) === d.getLooseObjectValue(handled);
    for (let count = 0; count < seen.tries; count++) {
      looter.ignored = {}; looter.state = 0; looter.wanted = null;
      d.chooseLooterOuting(looter);
      if (looter.wanted === handled) seen.forTheHandledOne++;
      seen.wentForOne = looter.wanted === handled || looter.wanted === plain;
    }
    looter.state = 0; looter.wanted = null; looter.timer = 999;
    return seen;
  });
  check('of two things alike in the same place it goes for the one that one of you has had in the beam; what is in a beam now it likes better still, and what lies in a salvage bay more again',
    likes !== null && likes.sameWorth && likes.wentForOne && likes.likes.handled > 1 && likes.likes.carried > likes.likes.handled && likes.likes.bay > 1 &&
    likes.forTheHandledOne >= likes.tries * (likes.likes.handled >= 2.4 ? 1 : 0.6), likes);

  // --- robbed: take a thing out of its arms and it wants it back ---
  const robbed = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, looter = lab.station(), p = d.player;
    if (!looter) return null;
    const seen = { waits: d.tuning.looterWantsBackSeconds, speeds: { chase: d.tuning.looterChaseSpeed, itsWalk: d.tuning.looterWalkSpeed, yourWalk: d.tuning.walkSpeed, yourRun: d.tuning.sprintSpeed } };
    const jar = lab.putDown('jar');
    // You, a step from it (behind it, if there is room there that is not a vent: in a vent it would be mad at
    // you, which is another check), turned to it, taking the thing out of its arms.
    const takeItBack = function () {
      const figure = looter.figure;
      let place = null;
      for (const turn of [Math.PI, Math.PI * 0.75, -Math.PI * 0.75, Math.PI / 2, -Math.PI / 2, 0]) {
        const way = figure.yaw + turn, x = figure.x + Math.sin(way) * 1.1, z = figure.z - Math.cos(way) * 1.1;
        if (d.isVentAt(x, z) || !d.isSpaceOpenAt(x, d.getFloorHeightAt(figure.x, figure.z) + 0.5, z)) continue;
        place = [x, z, way + Math.PI];
        break;
      }
      if (!place) place = [figure.x - Math.sin(figure.yaw) * 1.1, figure.z + Math.cos(figure.yaw) * 1.1, figure.yaw];
      d.teleport(place[0], place[1], place[2]); p.velocityX = 0; p.velocityZ = 0;
      d.pickUpLooseObject(jar, false);
      d.simulate(0.2);
      return d.getHeldLooseObject() === jar && jar.looterIndex === -1;
    };
    lab.standBy();
    lab.sendOut(looter);
    seen.tookIt = lab.until(() => looter.carried === jar, 60) >= 0;
    d.simulate(0.5);
    // Carried low: it stands there cross for a moment, and then takes it again.
    p.pitch = -0.5;
    d.captionCounts.looterRobbed = 0; d.captionCounts.looterScared = 0;
    seen.backInYourBeam = takeItBack();
    seen.afterYouTookIt = { state: lab.state(looter), hasIt: looter.carried === jar, wantsIt: looter.wanted === jar, said: d.captionCounts.looterRobbed || 0, squealed: d.captionCounts.looterScared || 0 };
    const before = [looter.figure.x, looter.figure.z];
    seen.secondsCross = lab.until(() => looter.state !== 7, 12) + 0.2;
    seen.stoodStill = Math.hypot(looter.figure.x - before[0], looter.figure.z - before[1]) < 0.05;
    seen.secondsToTakeItAgain = lab.until(() => looter.carried === jar, 15);
    seen.outOfYourBeamAgain = d.getHeldLooseObject() === null && jar.looterIndex === looter.index;
    // Once more, held high this time, and with some way between you and it (it is put back in its nest, cross
    // as it is): it comes after you, quicker than it walks and than you walk, reaches up, and gives up.
    // (Out in the room, where there is headroom: lifted in the mouth of a vent a jar breaks on the sheet metal.)
    d.simulate(0.5);
    looter.figure.x = lab.spot.x; looter.figure.z = lab.spot.z;
    d.simulate(0.1);
    seen.backInYourBeamAgain = takeItBack();
    p.pitch = 0.75;
    looter.figure.x = looter.nest.x; looter.figure.z = looter.nest.z;
    d.simulate(0.3);
    seen.metresToCome = lab.round(Math.hypot(looter.figure.x - p.x, looter.figure.z - p.z));
    seen.cameAfterIt = lab.until(() => looter.state === 1, 12) >= 0;
    seen.fastest = 0;
    seen.reachedUp = lab.until(() => { seen.fastest = Math.max(seen.fastest, looter.currentSpeed); return looter.state === 2; }, 30) >= 0;
    seen.fastest = lab.round(seen.fastest);
    seen.gaveUp = lab.until(() => looter.state === 4, 10) >= 0;
    seen.stillYours = d.getHeldLooseObject() === jar;
    // And robbed or not, noise frightens it.
    p.pitch = -0.5;
    d.simulate(1);
    lab.sendOut(looter);
    seen.tookItAThirdTime = lab.until(() => looter.carried === jar, 60) >= 0;
    d.simulate(0.5);
    looter.figure.x = lab.spot.x; looter.figure.z = lab.spot.z; // (in the room again: in the mouth of a vent the jar knocks the sheet metal, which is a noise)
    d.simulate(0.1);
    takeItBack();
    seen.crossAgain = lab.state(looter);
    d.emitNoise(looter.figure.x + 3, looter.figure.z, d.tuning.noiseRadiusSprintStep);
    d.simulate(0.2);
    seen.afterANoise = { state: lab.state(looter), wantsIt: looter.wanted === jar, yours: d.getHeldLooseObject() === jar };
    return seen;
  });
  check('take a thing out of its arms and it is not frightened: it stands there cross for a moment, and then takes it again if it hangs low enough',
    robbed !== null && robbed.tookIt && robbed.backInYourBeam && robbed.afterYouTookIt.state === 'wanting a thing back' && !robbed.afterYouTookIt.hasIt && robbed.afterYouTookIt.wantsIt &&
    robbed.afterYouTookIt.said === 1 && robbed.afterYouTookIt.squealed === 0 && robbed.stoodStill &&
    robbed.secondsCross >= robbed.waits[0] - 0.3 && robbed.secondsCross <= robbed.waits[1] + 0.5 && robbed.secondsToTakeItAgain >= 0 && robbed.outOfYourBeamAgain, robbed);
  check('off with it, it comes after you quicker than you walk and slower than you run; held high it reaches up and gives up, and the thing is still yours. Noise frightens it as ever',
    robbed !== null && robbed.backInYourBeamAgain && robbed.cameAfterIt && robbed.reachedUp && robbed.speeds.chase > robbed.speeds.yourWalk && robbed.speeds.chase < robbed.speeds.yourRun &&
    robbed.fastest <= robbed.speeds.chase + 0.05 && (robbed.metresToCome < 2.5 || robbed.fastest > robbed.speeds.itsWalk + 0.2) && robbed.gaveUp && robbed.stillYours &&
    robbed.tookItAThirdTime && robbed.crossAgain === 'wanting a thing back' && robbed.afterANoise.state === 'frightened' && !robbed.afterANoise.wantsIt && robbed.afterANoise.yours, robbed);

  // --- the vents are its own: with you in one it is mad, not afraid ---
  const mad = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, looter = lab.station(), p = d.player;
    if (!looter) return null;
    const seen = { near: d.tuning.looterMadMetres, territory: d.tuning.looterTerritoryMetres, calm: d.tuning.looterCalmSeconds, speeds: { mad: d.tuning.looterMadSpeed, crawl: d.tuning.crouchSpeed } };
    const metresFromYou = function () { return Math.hypot(looter.figure.x - p.x, looter.figure.z - p.z); };
    const jar = lab.putDown('jar');
    lab.standBy();
    lab.sendOut(looter);
    seen.tookIt = lab.until(() => looter.carried === jar, 60) >= 0;
    d.simulate(1);
    // You out in a room: nothing to it. You in the vent where its nest is: it is mad.
    seen.withYouInARoom = lab.state(looter);
    d.captionCounts.looterMad = 0; d.captionCounts.looterScared = 0;
    d.teleport(looter.nest.x, looter.nest.z, 0); p.velocityX = 0; p.velocityZ = 0;
    d.simulate(0.3);
    seen.youAreInAVent = d.isVentAt(p.x, p.z);
    seen.withYouInItsVent = { state: lab.state(looter), keepsIt: looter.carried === jar };
    // A running step, near it: it is not frightened, and keeps what it has.
    d.emitNoise(looter.figure.x + 3, looter.figure.z, d.tuning.noiseRadiusSprintStep);
    d.simulate(0.2);
    seen.afterANoise = { state: lab.state(looter), keepsIt: looter.carried === jar, squealed: d.captionCounts.looterScared || 0 };
    // It comes up to you, stops in front of you, turned to you, and scolds.
    seen.secondsToYou = lab.until(() => metresFromYou() < seen.near + 0.3, 40);
    d.simulate(4);
    seen.metresFromYou = lab.round(metresFromYou());
    const towardsYou = Math.atan2(p.x - looter.figure.x, -(p.z - looter.figure.z));
    seen.turnedToYou = Math.abs(Math.atan2(Math.sin(towardsYou - looter.figure.yaw), Math.cos(towardsYou - looter.figure.yaw))) < 0.5;
    seen.scolded = d.captionCounts.looterMad || 0;
    seen.stillMad = { state: lab.state(looter), keepsIt: looter.carried === jar };
    // And if you stay, it bites: a little off your health each time, again and again, and never the last of it.
    seen.bites = { after: d.tuning.looterBiteAfterSeconds, every: d.tuning.looterBiteEverySeconds, takes: d.getHitDamage('looter') * d.game.difficulty.damageFactor, of: d.tuning.playerMaxHealth };
    d.setDebugOption('invulnerable', false);
    p.health = seen.bites.of; p.hurtGraceSeconds = 0; d.captionCounts.looterBites = 0;
    seen.bites.secondsToTheFirst = lab.until(() => p.health < seen.bites.of, seen.bites.every + 1);
    seen.bites.afterTheFirst = { lost: lab.round(seen.bites.of - p.health), mode: d.game.mode, said: d.captionCounts.looterBites || 0 };
    const healthThen = p.health;
    seen.bites.secondsToTheNext = lab.until(() => p.health < healthThen, seen.bites.every + 1);
    p.health = 2; p.hurtGraceSeconds = 0;
    lab.until(() => p.health < 2, seen.bites.every + 1);
    seen.bites.atTheLast = { health: p.health, mode: d.game.mode };
    d.setDebugOption('invulnerable', true); p.health = seen.bites.of;
    // Out of the vents again: a moment more, and it goes back to what it was about. And noise frightens it again.
    lab.standBy();
    d.simulate(0.2);
    seen.secondsStillMad = lab.until(() => looter.state !== 8, 12) + 0.2;
    seen.then = { state: lab.state(looter), keepsIt: looter.carried === jar };
    d.emitNoise(looter.figure.x + 3, looter.figure.z, d.tuning.noiseRadiusSprintStep);
    seen.afterANoiseOutside = lab.state(looter); // (at once: it is a step from home)
    d.simulate(0.2);
    // In a vent a long way from it and from its nest you are nothing to it, until you make a noise there.
    seen.farVent = null;
    lab.until(() => looter.state === 0, 60);
    looter.timer = 999;
    d.simulate(2); // (what it let fall when it was frightened has been heard, and it listens again)
    for (const nest of d.level.ventNests) {
      if (Math.hypot(nest.x - looter.nest.x, nest.z - looter.nest.z) > seen.territory + 2 && Math.hypot(nest.x - looter.nest.x, nest.z - looter.nest.z) < d.tuning.noiseRadiusSprintStep * d.tuning.looterHearingFactor - 1) { seen.farVent = { x: nest.x, z: nest.z }; break; }
    }
    if (seen.farVent) {
      d.teleport(seen.farVent.x, seen.farVent.z, 0); p.velocityX = 0; p.velocityZ = 0;
      d.simulate(1);
      seen.farVent.quiet = lab.state(looter);
      d.emitNoise(p.x, p.z, d.tuning.noiseRadiusSprintStep);
      d.simulate(0.2);
      seen.farVent.afterANoise = lab.state(looter);
    }
    return seen;
  });
  check('with you in a vent near its nest it is mad, not afraid: a running step does not frighten it, and it keeps what it has',
    mad !== null && mad.tookIt && mad.withYouInARoom === 'carrying a thing home' && mad.youAreInAVent && mad.withYouInItsVent.state === 'driving somebody out of its vents' && mad.withYouInItsVent.keepsIt &&
    mad.afterANoise.state === 'driving somebody out of its vents' && mad.afterANoise.keepsIt && mad.afterANoise.squealed === 0, mad);
  check('it comes for you faster than you crawl, stops an arm\'s length in front of you, turned to you, and scolds for as long as you are there',
    mad !== null && mad.speeds.mad > mad.speeds.crawl && mad.secondsToYou >= 0 && mad.metresFromYou > mad.near - 0.4 && mad.metresFromYou < mad.near + 0.4 && mad.turnedToYou && mad.scolded >= 2 &&
    mad.stillMad.state === 'driving somebody out of its vents' && mad.stillMad.keepsIt, mad);
  check('if you stay it bites: a little off your health, again every few seconds, heard by anybody near; and a bite never takes the last of it',
    mad !== null && mad.bites.secondsToTheFirst >= 0 && Math.abs(mad.bites.afterTheFirst.lost - mad.bites.takes) < 0.01 && mad.bites.afterTheFirst.mode === 'playing' && mad.bites.afterTheFirst.said >= 1 &&
    mad.bites.secondsToTheNext > 0 && mad.bites.secondsToTheNext <= mad.bites.every + 0.3 && mad.bites.atTheLast.health >= 1 && mad.bites.atTheLast.health < 2 && mad.bites.atTheLast.mode === 'playing', mad.bites);
  check('out of the vents again it is mad a moment more and then goes on home with its thing, and noise frightens it again. In a vent far from it you are nothing to it until you make a noise there, and then it is mad and not afraid',
    mad !== null && mad.secondsStillMad >= mad.calm - 0.3 && mad.secondsStillMad <= mad.calm + 0.6 && mad.then.state === 'carrying a thing home' && mad.then.keepsIt && mad.afterANoiseOutside === 'frightened' &&
    (mad.farVent === null || (mad.farVent.quiet === 'in its nest' && mad.farVent.afterANoise === 'driving somebody out of its vents')), mad);

  // --- a salvage bay: what a looter has in its arms is not in the bay, and what it takes out of one is gone from it ---
  const count = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, looter = lab.station();
    if (!looter) return null;
    const jar = lab.putDown('jar');
    // A bay of this check's own: the floor round the spot.
    const bay = { floorY: d.getFloorHeightAt(lab.spot.x, lab.spot.z), minimumX: lab.spot.x - 1, maximumX: lab.spot.x + 1, minimumZ: lab.spot.z - 1, maximumZ: lab.spot.z + 1 };
    const isIn = () => d.isLooseObjectInHaulBay(jar, bay);
    const seen = { lying: isIn() };
    lab.sendOut(looter);
    lab.until(() => looter.carried === jar, 60);
    seen.inItsArms = isIn();
    return seen;
  });
  check('what a looter has in its arms counts for nothing in a salvage bay, even while the looter still stands in it',
    count !== null && count.lying === true && count.inItsArms === false, count);

  check('no script errors were reported', problems.length === 0, problems);
  await browser.close();

  if (failures.length > 0) {
    console.log('\n' + failures.length + ' check(s) failed.');
    process.exit(1);
  }
  console.log('\nAll looter checks passed.');
})().catch((error) => { console.error('Looter test crashed:', error); process.exit(1); });
