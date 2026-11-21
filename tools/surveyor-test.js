// Checks the Surveyor (src/js/08-surveyor.js): the creature that is deaf and sees by its own light. That it is
// not there until it arrives, what its body and its way of getting around are, that its light leaves points of
// its own kind which fade and are not on your map, that it makes you out only when its light has been on you
// for long enough with nothing in between, that it comes for you, strikes once and runs off, that it loses
// you, that light in its eye dazzles it, that noise is nothing to it, that the Hollow pays its light no heed,
// and that it goes through the crawlspace as the Hollow does, with its light out up there.
//
// (When it arrives, and that it does not arrive together with the Hollow: arrivals-test.js. That the others
// are shown it down there with others: together-test.js.)
const { openGame, startGame } = require('./browser-harness.js');

const failures = [];
function check(description, condition, detail) {
  const line = (condition ? 'ok    ' : 'FAIL  ') + description + (detail !== undefined ? '  ' + JSON.stringify(detail) : '');
  console.log(line);
  if (!condition) failures.push(description);
}

// Helpers that run inside the page, kept on `window.lab`.
const labSource = String(function () {
  const d = window.lastReturnDebug, lab = {}, s = d.surveyor;
  lab.round = function (value) { return Math.round(value * 100) / 100; };
  lab.state = function () { return d.surveyorStates[s.state]; };
  lab.metresFromYou = function () { return Math.hypot(s.figure.x - d.player.x, s.figure.z - d.player.z); };
  // Is there nothing at all between two places, at shin, chest and head height?
  lab.isClearBetween = function (from, to) {
    const dx = to.x - from.x, dz = to.z - from.z, metres = Math.hypot(dx, dz);
    for (const height of [0.4, 1.0, 1.8]) if (d.castScannerRay(from.x, height, from.z, dx / metres, 0, dz / metres, metres)) return false;
    return true;
  };
  // A generated station on Standard, with the mains on and nothing about, and in it a straight stretch of
  // `metres` with nothing in the way: { you, it }, the two ends. The same one every time.
  lab.station = function (metres) {
    d.loadStation('generated', 7, 'medium', 'mixed', 'one');
    d.game.difficulty = d.difficultyPresets.standard;
    d.game.flags.hasLeftLift = true; d.grantPower();
    d.setDebugOption('invulnerable', false); d.setDebugOption('freezeCreatures', false); d.setDebugOption('creaturesIgnorePlayer', false);
    d.hollow.isActive = false;
    d.clearLooseObjects();
    d.settings.captions = 'all';
    d.clearMessages();
    for (const key of ['surveyorScans', 'surveyorSees', 'surveyorLoses', 'surveyorDazzled', 'surveyorRuns', 'surveyorSteps']) d.captionCounts[key] = 0;
    d.tuning.surveyorLookTurnRate = lab.turnRate; // (as the game has it, until a check holds it still)
    for (let z = 4; z < 150; z += 2) {
      for (let x = 4; x < 150; x += 2) {
        const you = d.findWalkableSpotNear(x + 0.5, z + 0.5);
        if (!you || you.x !== x + 0.5 || you.z !== z + 0.5) continue;
        for (const way of [[1, 0], [0, 1]]) {
          const it = d.findWalkableSpotNear(you.x + way[0] * metres, you.z + way[1] * metres);
          if (!it || Math.abs(Math.hypot(it.x - you.x, it.z - you.z) - metres) > 0.05) continue;
          if (!d.hasClearWalkingLine(you.x, you.z, it.x, it.z) || !lab.isClearBetween(you, it)) continue;
          // Room behind you as well, to be walked off into.
          return { you: you, it: it, wayX: way[0], wayZ: way[1] };
        }
      }
    }
    return null;
  };
  // Puts you at one end and it at the other, standing, looking your way, and not turning.
  lab.faceToFace = function (stretch) {
    d.teleport(stretch.you.x, stretch.you.z, Math.atan2(stretch.it.x - stretch.you.x, -(stretch.it.z - stretch.you.z)));
    d.player.pitch = 0; d.player.velocityX = 0; d.player.velocityZ = 0;
    d.simulate(0.2);
    d.tuning.surveyorLookTurnRate = 0;
    d.activateSurveyor(stretch.it.x, stretch.it.z, 0);
    s.figure.yaw = Math.atan2(stretch.you.x - stretch.it.x, -(stretch.you.z - stretch.it.z)); s.lightYaw = s.figure.yaw;
    s.state = 1; s.timer = 999; // looking round (and, with the turning held, looking at you)
  };
  // Plays until something is so, a tenth of a second at a time. Returns the seconds it took, or -1.
  lab.until = function (isDone, mostSeconds) {
    for (let seconds = 0; seconds <= mostSeconds; seconds += 0.1) {
      if (isDone()) return Math.round(seconds * 10) / 10;
      d.simulate(0.1);
    }
    return isDone() ? mostSeconds : -1;
  };
  // How many of the points in the cloud are of its light's kind, and the longest any of those lasts, in seconds.
  lab.itsPoints = function () {
    const cloud = d.pointCloud, bytes = cloud.byteView;
    let count = 0, longest = 0, forever = 0;
    for (let index = 0; index < cloud.storedCount; index++) {
      if (bytes[index * 20 + 17] !== d.surfaceSurveyorLight) continue;
      count++;
      const life = bytes[index * 20 + 18];
      if (life === 0) forever++; else longest = Math.max(longest, life * 0.25);
    }
    return { count: count, longestSeconds: longest, forever: forever };
  };
  lab.turnRate = d.tuning.surveyorLookTurnRate;
  window.lab = lab;
});

(async () => {
  const { browser, page, problems } = await openGame({ dev: true });
  const inGame = (callback, argument) => page.evaluate(callback, argument);
  await startGame(page, false);
  await page.evaluate('(' + labSource + ')()');

  // --- what it is ---
  const itself = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, s = d.surveyor, result = {};
    const stretch = lab.station(8);
    result.hasAStretch = stretch !== null;
    result.atTheStart = { isActive: s.isActive, scannable: d.raycastableFigures.indexOf(s.figure) >= 0 };
    result.way = { key: s.way.key, fitsVents: s.way.fitsVents, usesHatches: s.way.usesHatches };
    const doorOf = (kind) => d.doors.filter((door) => door.kind === kind)[0] || null;
    const hollowWay = d.creatureWays.filter((way) => way.key === 'hollow')[0];
    result.doors = d.doors.length > 0 && d.doors.every((door) => s.way.canOpenDoor(door) === hollowWay.canOpenDoor(door));
    d.game.flags.powerOn = false;
    result.doorsWithoutTheMains = d.doors.every((door) => s.way.canOpenDoor(door) === hollowWay.canOpenDoor(door));
    d.game.flags.powerOn = true;
    d.activateSurveyor(stretch.it.x, stretch.it.z, 0);
    result.body = { headHeight: lab.round(s.figure.headHeight), capsules: s.figure.capsuleCount, scannable: d.raycastableFigures.indexOf(s.figure) >= 0, isActive: s.isActive,
      state: lab.state(), ventHeight: d.ventHeight, playerHeight: d.tuning.playerHeight };
    // A new descent: it is gone again.
    d.startOver();
    result.afterANewDescent = { isActive: s.isActive, scannable: d.raycastableFigures.indexOf(s.figure) >= 0 };
    return result;
  });
  check('there is a station with a clear stretch of eight metres to try it on', itself.hasAStretch, itself.hasAStretch);
  check('it is not in the station until it arrives, and a new descent takes it out again',
    !itself.atTheStart.isActive && !itself.atTheStart.scannable && itself.body.isActive && itself.body.scannable && !itself.afterANewDescent.isActive && !itself.afterANewDescent.scannable, itself);
  check('it is far taller than you and than a vent is high: its way does not fit vents, uses the ceiling hatches, and the doors that open for the Hollow are the doors that open for it, with the mains on or off',
    itself.body.headHeight > 1.6 && itself.body.headHeight > itself.body.ventHeight + 0.5 && itself.body.headHeight > itself.body.playerHeight + 0.4 && itself.body.capsules > 10 &&
    itself.way.key === 'surveyor' && itself.way.fitsVents === false && itself.way.usesHatches === true && itself.doors && itself.doorsWithoutTheMains, [itself.body, itself.way]);

  // --- its light ---
  const light = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, s = d.surveyor, result = {};
    const stretch = lab.station(8);
    // You stand aside, behind it: this is about what its light leaves.
    lab.faceToFace(stretch);
    const behind = d.findWalkableSpotNear(stretch.it.x + stretch.wayX * 1.5, stretch.it.z + stretch.wayZ * 1.5) || stretch.it;
    d.teleport(behind.x, behind.z, 0);
    d.clearAllPoints();
    const things = d.interactables.filter((thing) => thing.isAvailable).length, discoveredBefore = d.interactables.filter((thing) => thing.isDiscovered).length;
    const can = d.createLooseObject('can', (stretch.you.x + stretch.it.x) / 2, 0.2, (stretch.you.z + stretch.it.z) / 2, 0);
    for (let step = 0; step < 90 && !can.isAsleep; step++) d.simulate(1 / 30);
    const mapBefore = Array.from(d.getMapImageData().data).reduce((sum, value) => sum + value, 0);
    d.clearAllPoints();
    const pulsesBefore = s.statistics.pulses;
    d.simulate(2);
    result.after = { points: lab.itsPoints(), stored: d.pointCloud.storedCount, pulses: s.statistics.pulses - pulsesBefore, lit: s.isLit, state: lab.state() };
    result.lasts = d.tuning.surveyorLightSeconds; result.perSecond = d.tuning.surveyorRoamPulsesPerSecond;
    result.map = { changed: Array.from(d.getMapImageData().data).reduce((sum, value) => sum + value, 0) - mapBefore, canKnown: can.isKnownOnMap, canAppraised: can.isAppraised === true,
      discovered: d.interactables.filter((thing) => thing.isDiscovered).length - discoveredBefore, things: things };
    result.ticks = d.captionCounts.surveyorScans;
    // Its own light is no light on itself: left standing a metre from a wall for three seconds, it is not dazzled.
    result.selfLit = { dazzle: s.dazzle, timesDazzled: s.statistics.timesDazzled };
    return result;
  });
  check('its light is a cone of pulses out of its head, as many a second as the number says, and it leaves points of a kind of its own',
    light.after.lit && light.after.pulses > light.perSecond * 1.5 && light.after.pulses < light.perSecond * 2.6 && light.after.points.count > light.after.pulses * 0.5 && light.after.points.count <= light.after.stored, light.after);
  check('those points do not last: every one fades, after the seconds the number says and no longer',
    light.after.points.forever === 0 && light.after.points.longestSeconds > 0 && light.after.points.longestSeconds <= light.lasts + 0.25, [light.after.points, light.lasts]);
  check('its light finds nothing out for you: nothing goes on your map, nothing it lands on is marked, and a thing lying in it is not known to you',
    light.map.changed === 0 && !light.map.canKnown && light.map.discovered === 0, light.map);
  check('you hear it ticking, and its own light does not dazzle it', light.ticks >= 1 && light.selfLit.dazzle === 0 && light.selfLit.timesDazzled === 0, [light.ticks, light.selfLit]);

  // --- being seen ---
  const seen = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, s = d.surveyor, result = {};
    const stretch = lab.station(8);
    result.notice = d.tuning.surveyorNoticeSeconds;
    // In its light, eight metres off, nothing in between.
    lab.faceToFace(stretch);
    d.simulate(0.25);
    result.aGlance = { state: lab.state(), seenSeconds: lab.round(s.seenSeconds) };
    result.secondsUntilSeen = lab.until(() => s.state === 2, 12);
    result.onceSeen = { state: lab.state(), isAfterYou: s.quarry === d.player, captions: d.captionCounts.surveyorSees, litFrames: s.statistics.litFrames, timesSeen: s.statistics.timesSeen };
    // A glance and away: out of its light before it has made you out, the count runs down again and it has seen nobody.
    lab.station(8); lab.faceToFace(stretch);
    lab.until(() => s.seenSeconds > result.notice * 0.3, 6);
    const glimpsed = s.seenSeconds;
    const behind = d.findWalkableSpotNear(stretch.it.x + stretch.wayX * 2, stretch.it.z + stretch.wayZ * 2) || stretch.it;
    d.teleport(behind.x, behind.z, 0); // behind its back
    d.simulate(d.tuning.surveyorForgetSeconds + 1);
    result.glanceAndAway = { glimpsed: lab.round(glimpsed), seenSecondsAfter: lab.round(s.seenSeconds), state: lab.state(), timesSeen: s.statistics.timesSeen, metresBehindIt: lab.round(lab.metresFromYou()) };
    // Behind its back, however near: it has no eyes there.
    d.simulate(4);
    result.behindIt = { state: lab.state(), timesSeen: s.statistics.timesSeen };
    // Too far off to be made out: further than it can see.
    d.tuning.surveyorSightMetres = 5;
    lab.station(8); lab.faceToFace(stretch);
    d.simulate(6);
    result.tooFar = { state: lab.state(), timesSeen: s.statistics.timesSeen, metres: lab.round(lab.metresFromYou()), sees: 5 };
    return result;
  });
  await inGame(() => { window.lastReturnDebug.tuning.surveyorSightMetres = 24; });
  check('a glance is not enough: a quarter of a second in its light and it has seen nobody yet',
    seen.aGlance.state === 'looking round' && seen.aGlance.seenSeconds < seen.notice, seen.aGlance);
  check('standing in its light with nothing in between, it makes you out: not sooner than the number says, and then it is after you, with a caption',
    seen.secondsUntilSeen >= seen.notice - 0.11 && seen.secondsUntilSeen > 0 && seen.secondsUntilSeen < 12 && seen.onceSeen.state === 'after somebody' && seen.onceSeen.isAfterYou &&
    seen.onceSeen.captions >= 1 && seen.onceSeen.timesSeen === 1, [seen.secondsUntilSeen, seen.onceSeen]);
  check('out of its light before that, the count runs down again and it has seen nobody; behind its back it sees nobody however near',
    seen.glanceAndAway.glimpsed > 0 && seen.glanceAndAway.seenSecondsAfter === 0 && seen.glanceAndAway.timesSeen === 0 && seen.behindIt.timesSeen === 0 && seen.behindIt.state === 'looking round' &&
    seen.glanceAndAway.metresBehindIt < 3, [seen.glanceAndAway, seen.behindIt]);
  check('further off than it can see, it makes nobody out however long they stand in its light', seen.tooFar.timesSeen === 0 && seen.tooFar.state === 'looking round' && seen.tooFar.metres > seen.tooFar.sees, seen.tooFar);

  // --- a wall in between, and noise ---
  const blocked = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, s = d.surveyor, result = {};
    const stretch = lab.station(8);
    // Somewhere near it with a wall in between: no clear line at any height.
    let hidden = null;
    for (let z = -7; z <= 7 && !hidden; z++) for (let x = -7; x <= 7 && !hidden; x++) {
      const spot = d.findWalkableSpotNear(stretch.it.x + x, stretch.it.z + z);
      if (!spot || Math.hypot(spot.x - stretch.it.x, spot.z - stretch.it.z) < 2.5) continue;
      const dx = spot.x - stretch.it.x, dz = spot.z - stretch.it.z, metres = Math.hypot(dx, dz);
      let isWalled = true;
      for (const height of [0.3, 0.8, 1.2, 1.8]) if (!d.castRayAgainstWorld(stretch.it.x, height, stretch.it.z, dx / metres, 0, dz / metres, metres - 0.4)) isWalled = false;
      if (isWalled && !d.hasClearWalkingLine(stretch.it.x, stretch.it.z, spot.x, spot.z)) hidden = spot;
    }
    result.hasAHiddenSpot = hidden !== null;
    if (!hidden) return result;
    lab.faceToFace(stretch);
    d.teleport(hidden.x, hidden.z, 0);
    s.figure.yaw = Math.atan2(hidden.x - stretch.it.x, -(hidden.z - stretch.it.z)); s.lightYaw = s.figure.yaw; // looking straight at where you are
    d.simulate(6);
    result.behindAWall = { state: lab.state(), timesSeen: s.statistics.timesSeen, litFrames: s.statistics.litFrames, metres: lab.round(lab.metresFromYou()) };
    // Noise: as loud as anything gets, right beside it, again and again.
    const yawBefore = s.figure.yaw, at = [s.figure.x, s.figure.z];
    for (let count = 0; count < 20; count++) { d.emitNoise(s.figure.x + 1, s.figure.z, 30); d.simulate(0.1); }
    result.noise = { state: lab.state(), timesSeen: s.statistics.timesSeen, turned: lab.round(Math.abs(s.figure.yaw - yawBefore)), moved: lab.round(Math.hypot(s.figure.x - at[0], s.figure.z - at[1])),
      hears: d.creatureKinds.filter((kind) => kind.key === 'surveyor')[0].hear === undefined };
    return result;
  });
  check('there is a place near it with a wall in between', blocked.hasAHiddenSpot, blocked.hasAHiddenSpot);
  if (blocked.hasAHiddenSpot) {
    check('with a wall in between it does not see you, though it looks straight at where you stand for six seconds',
      blocked.behindAWall.timesSeen === 0 && blocked.behindAWall.litFrames === 0 && blocked.behindAWall.state === 'looking round', blocked.behindAWall);
    check('it is deaf: twenty noises as loud as anything gets, right beside it, and it neither turns nor moves nor sees anybody',
      blocked.noise.hears && blocked.noise.timesSeen === 0 && blocked.noise.turned === 0 && blocked.noise.moved === 0 && blocked.noise.state === 'looking round', blocked.noise);
  }

  // --- it comes, strikes once, and runs off ---
  const strike = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, s = d.surveyor, p = d.player, result = {};
    const stretch = lab.station(8);
    lab.faceToFace(stretch);
    result.health = p.health; result.takes = d.getHitDamage('surveyor') * d.game.difficulty.damageFactor;
    lab.until(() => s.state === 2, 12);
    const startedAt = lab.metresFromYou(), pulsesBefore = s.statistics.pulses;
    d.simulate(1);
    result.chase = { metresASecond: lab.round(startedAt - lab.metresFromYou()), pulsesASecond: s.statistics.pulses - pulsesBefore, state: lab.state() };
    result.speeds = { chase: d.tuning.surveyorChaseSpeed, flee: d.tuning.surveyorFleeSpeed, walk: d.tuning.walkSpeed, sprint: d.tuning.sprintSpeed, hunt: d.tuning.surveyorHuntPulsesPerSecond };
    result.secondsUntilStruck = lab.until(() => s.statistics.strikes > 0, 8);
    result.struck = { health: p.health, mode: d.game.mode, state: lab.state(), strikes: s.statistics.strikes, metres: lab.round(lab.metresFromYou()), said: document.getElementById('hud-messages').textContent };
    // It is off, and it does not come back for more: you stand where you are for as long as it runs.
    p.hurtGraceSeconds = 0;
    d.simulate(4);
    result.off = { metres: lab.round(lab.metresFromYou()), state: lab.state(), health: p.health, strikes: s.statistics.strikes, runs: d.captionCounts.surveyorRuns };
    // Put right in front of it while it runs: it sees nobody.
    const front = { x: s.figure.x + Math.sin(s.figure.yaw) * 2.5, z: s.figure.z - Math.cos(s.figure.yaw) * 2.5 };
    const spot = d.findWalkableSpotNear(front.x, front.z);
    if (spot) d.teleport(spot.x, spot.z, 0);
    d.simulate(1.5);
    result.whileItRuns = { blind: lab.round(s.blindSeconds), timesSeen: s.statistics.timesSeen, strikes: s.statistics.strikes, health: p.health };
    return result;
  });
  check('after you it is faster than you walk and slower than you run, and its light has many more pulses in it',
    strike.speeds.chase > strike.speeds.walk && strike.speeds.chase < strike.speeds.sprint && strike.chase.metresASecond > strike.speeds.walk * 0.8 &&
    strike.chase.pulsesASecond > strike.speeds.hunt * 0.7, [strike.chase, strike.speeds]);
  check('it reaches you and strikes: once, for what its strike takes, and you are told',
    strike.secondsUntilStruck > 0 && strike.struck.strikes === 1 && Math.abs(strike.struck.health - (strike.health - strike.takes)) < 0.01 && strike.struck.mode === 'playing' &&
    strike.struck.state === 'running off' && /struck you/.test(strike.struck.said), strike.struck);
  check('then it runs off, with a caption, and does not strike again though you stand where you were',
    strike.off.metres > strike.struck.metres + 6 && strike.off.strikes === 1 && strike.off.health === strike.struck.health && strike.off.runs >= 1, strike.off);
  check('while it runs it sees nobody, even one who steps right in front of it',
    strike.whileItRuns.blind > 0 && strike.whileItRuns.timesSeen === 1 && strike.whileItRuns.strikes === 1 && strike.whileItRuns.health === strike.struck.health, strike.whileItRuns);

  // --- the hit that takes the last of you ---
  await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab;
    const stretch = lab.station(8);
    lab.faceToFace(stretch);
    d.player.health = 5;
  });
  await page.waitForFunction(() => { const d = window.lastReturnDebug; d.simulate(0.2); return d.game.mode === 'dying' || d.game.mode === 'dead'; }, null, { timeout: 60000 }).catch(() => {});
  await page.waitForFunction(() => window.lastReturnDebug.game.mode === 'dead', null, { timeout: 20000 }).catch(() => {});
  const death = await inGame(() => ({ mode: window.lastReturnDebug.game.mode, title: document.getElementById('death-title') ? document.getElementById('death-title').textContent : '', lines: document.getElementById('death-lines').textContent }));
  check('the strike that takes the last of your health is your death, and the report says what it was', death.mode === 'dead' && /second scanner/.test(death.lines), death);
  await inGame(() => { const d = window.lastReturnDebug; if (d.game.mode === 'dead') d.retryFromCheckpoint(); });

  // --- losing you ---
  const lost = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, s = d.surveyor, result = {};
    const stretch = lab.station(8);
    d.setDebugOption('invulnerable', true);
    lab.faceToFace(stretch);
    lab.until(() => s.state === 2, 12);
    const lastSeen = [d.player.x, d.player.z];
    // You are gone: somewhere it has no line to.
    const away = d.findWalkableSpotNear(d.playerStart.x, d.playerStart.z);
    d.teleport(away.x, away.z, 0);
    result.farAway = lab.round(Math.hypot(away.x - lastSeen[0], away.z - lastSeen[1]));
    result.secondsUntilLost = lab.until(() => s.state === 3, d.tuning.surveyorLoseSeconds + 6);
    result.lose = d.tuning.surveyorLoseSeconds;
    result.searching = { state: lab.state(), captions: d.captionCounts.surveyorLoses, goesToWhereYouWere: lab.round(Math.hypot(s.goalX - lastSeen[0], s.goalZ - lastSeen[1])) };
    d.tuning.surveyorLookTurnRate = lab.turnRate;
    result.secondsSearching = lab.until(() => s.state === 0 || s.state === 1, d.tuning.surveyorSearchSeconds + 4);
    result.after = { state: lab.state(), search: d.tuning.surveyorSearchSeconds, metresFromWhereYouWere: lab.round(Math.hypot(s.figure.x - lastSeen[0], s.figure.z - lastSeen[1])) };
    // On its rounds it gets about: it walks to somewhere, looks all round there, and walks on.
    const at = [s.figure.x, s.figure.z];
    let walked = 0, looked = 0, last = at.slice();
    // (Until it has stopped to look round once and gone on: two minutes at the most.)
    for (let step = 0; step < 1200 && !(looked > 5 && s.state === 0); step++) { d.simulate(0.1); walked += Math.hypot(s.figure.x - last[0], s.figure.z - last[1]); last = [s.figure.x, s.figure.z]; if (s.state === 1) looked++; }
    result.rounds = { walked: lab.round(walked), lookedRoundFor: looked / 10, roam: d.tuning.surveyorRoamSpeed };
    d.setDebugOption('invulnerable', false);
    return result;
  });
  check('out of its light for as long as the number says, it has lost you: with a caption, it goes to where it last saw you',
    lost.farAway > 10 && lost.secondsUntilLost >= lost.lose - 0.2 && lost.secondsUntilLost <= lost.lose + 1.5 && lost.searching.state === 'searching' && lost.searching.captions >= 1 &&
    lost.searching.goesToWhereYouWere < 0.1, lost);
  check('it looks round there for a while and then takes up its rounds again: it walks, stops to look all round, and walks on',
    lost.secondsSearching > 0 && lost.secondsSearching <= lost.after.search + 0.5 && (lost.after.state === 'on its rounds' || lost.after.state === 'looking round') &&
    lost.rounds.walked > lost.rounds.roam * 8 && lost.rounds.lookedRoundFor > 0, [lost.secondsSearching, lost.after, lost.rounds]);

  // --- light in its eye ---
  const dazzled = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, s = d.surveyor, result = {};
    const stretch = lab.station(6);
    result.numbers = { after: d.tuning.surveyorDazzleAfterSeconds, lasts: d.tuning.surveyorDazzledSeconds, immune: d.tuning.surveyorDazzleImmuneSeconds };
    if (!stretch) return result;
    d.setDebugOption('invulnerable', true); d.setDebugOption('unlimitedScanner', true);
    lab.faceToFace(stretch);
    // Your beam, held on its head.
    d.player.pitch = Math.atan2(s.figure.y + s.figure.headHeight - 0.25 - d.getPlayerEyeY(), 6);
    d.setScanHeld(true);
    result.secondsUntilDazzled = lab.until(() => s.state === 5, 6);
    d.setScanHeld(false);
    const pulsesThen = s.statistics.pulses;
    result.dazzled = { state: lab.state(), lit: s.isLit, captions: d.captionCounts.surveyorDazzled, armRaise: lab.round(s.figure.pose.armRaise), timesDazzled: s.statistics.timesDazzled };
    d.simulate(1.5);
    result.whileDazzled = { pulses: s.statistics.pulses - pulsesThen, state: lab.state(), timesSeen: s.statistics.timesSeen, moved: lab.round(Math.hypot(s.figure.x - stretch.it.x, s.figure.z - stretch.it.z)) };
    result.secondsDazzled = 1.5 + lab.until(() => s.state !== 5, 8);
    result.afterwards = { state: lab.state(), lit: s.isLit || s.state !== 5, immune: lab.round(s.dazzleImmuneSeconds) };
    // More light in its eye at once: it cannot be dazzled again yet.
    for (let step = 0; step < 30; step++) { s.figure.hitsThisFrame = 20; d.simulate(1 / 30); }
    result.again = { timesDazzled: s.statistics.timesDazzled, state: lab.state() };
    // When that is over, it can.
    s.dazzleImmuneSeconds = 0; s.state = 1; s.timer = 99; s.blindSeconds = 99;
    for (let step = 0; step < 30 && s.state !== 5; step++) { s.figure.hitsThisFrame = 20; d.simulate(1 / 30); }
    result.later = { timesDazzled: s.statistics.timesDazzled, state: lab.state() };
    d.setDebugOption('invulnerable', false); d.setDebugOption('unlimitedScanner', false);
    return result;
  });
  check('your beam held on its head dazzles it, after about the half second the number says: it stands with its arms up, its light goes out, with a caption',
    dazzled.secondsUntilDazzled >= dazzled.numbers.after - 0.11 && dazzled.secondsUntilDazzled < 4 && dazzled.dazzled.state === 'dazzled' && !dazzled.dazzled.lit && dazzled.dazzled.captions >= 1 &&
    dazzled.whileDazzled.pulses === 0 && dazzled.whileDazzled.state === 'dazzled' && dazzled.whileDazzled.moved < 0.05, dazzled);
  check('dazzled, it sees nobody; it lasts as long as the number says, and then its light is on again',
    dazzled.whileDazzled.timesSeen === 0 && Math.abs(dazzled.secondsDazzled - dazzled.numbers.lasts) < 0.4 && dazzled.afterwards.state !== 'dazzled' && dazzled.afterwards.immune > 0, [dazzled.secondsDazzled, dazzled.afterwards]);
  check('it cannot be dazzled again at once, however much light is in its eye; when that time is over, it can',
    dazzled.again.timesDazzled === 1 && dazzled.again.state !== 'dazzled' && dazzled.later.timesDazzled === 2 && dazzled.later.state === 'dazzled', [dazzled.again, dazzled.later]);

  // --- the Hollow, and the crawlspace ---
  const others = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, s = d.surveyor, result = {};
    const stretch = lab.station(8);
    d.setDebugOption('invulnerable', true);
    // The Hollow stands in its light for five seconds. (You are out of the way, far off, standing still.)
    lab.faceToFace(stretch);
    const away = d.findWalkableSpotNear(d.playerStart.x, d.playerStart.z);
    d.teleport(away.x, away.z, 0);
    d.spawnHollow(stretch.you.x, stretch.you.z);
    d.hollow.graceTimer = 0; d.hollow.state = 4; d.hollow.listenTimer = 60; d.hollow.anger = 0;
    const hitsBefore = d.hollow.figure.totalHits;
    d.simulate(5);
    result.hollow = { anger: d.hollow.anger, state: d.hollow.state, litByIt: d.hollow.figure.totalHits - hitsBefore, moved: lab.round(Math.hypot(d.hollow.figure.x - stretch.you.x, d.hollow.figure.z - stretch.you.z)) };
    d.hollow.isActive = false;

    // Through the crawlspace, from one hatch to another far off, with you standing under the way.
    let pair = null;
    for (const first of d.hollowHatches) for (const second of d.hollowHatches) {
      if (first === second || pair) continue;
      const metres = Math.hypot(first.x - second.x, first.z - second.z);
      if (metres < 12) continue;
      const middle = d.findWalkableSpotNear((first.x + second.x) / 2, (first.z + second.z) / 2);
      if (middle && Math.hypot(middle.x - (first.x + second.x) / 2, middle.z - (first.z + second.z) / 2) < 0.8) pair = { first: first, second: second, middle: middle };
    }
    result.hasHatches = pair !== null;
    if (!pair) return result;
    d.teleport(pair.middle.x, pair.middle.z, 0); d.simulate(0.1);
    d.activateSurveyor(pair.first.x, pair.first.z, 0);
    d.beginCreatureCrawl(s, pair.first, pair.second);
    const spaces = {}, seenBefore = s.statistics.timesSeen;
    let pulsesAbove = 0, nearest = 99, lastPulses = s.statistics.pulses;
    for (let step = 0; step < 1500 && d.isCreatureInCrawlspace(s); step++) {
      spaces[s.crawlspace.phase] = d.getSpaceOf(s.figure); // (which space it is in during each part of the trip, as each frame begins)
      d.simulate(1 / 30);
      if (d.getSpaceOf(s.figure) === d.spaces.crawlspace) { pulsesAbove += s.statistics.pulses - lastPulses; nearest = Math.min(nearest, lab.metresFromYou()); }
      lastPulses = s.statistics.pulses;
    }
    result.crawl = { reachingUp: spaces[0], crawling: spaces[1], waiting: spaces[2], pulsesAbove: pulsesAbove, passedOverYouWithin: lab.round(nearest), sawSomebody: s.statistics.timesSeen - seenBefore,
      overhead: d.captionCounts.hollowOverhead };
    result.landed = { space: d.getSpaceOf(s.figure), scannable: d.raycastableFigures.indexOf(s.figure) >= 0, metresFromTheHatch: lab.round(Math.hypot(s.figure.x - pair.second.x, s.figure.z - pair.second.z)),
      blind: lab.round(s.blindSeconds), station: d.spaces.station, crawlspace: d.spaces.crawlspace };
    d.simulate(1);
    result.landed.litAgain = s.isLit;
    d.setDebugOption('invulnerable', false);
    return result;
  });
  check('the Hollow pays its light no heed: five seconds in it, and it is no angrier and has not stirred',
    others.hollow.litByIt > 20 && others.hollow.anger === 0 && others.hollow.state === 4 && others.hollow.moved < 0.05, others.hollow);
  check('there are two hatches far apart with floor under the way between them', others.hasHatches, others.hasHatches);
  if (others.hasHatches) {
    check('it goes through the crawlspace as the Hollow does: in the station while it reaches up, above the ceiling from then until it drops, and you hear it overhead',
      others.crawl.reachingUp === others.landed.station && others.crawl.crawling === others.landed.crawlspace && others.crawl.waiting === others.landed.crawlspace && others.crawl.overhead >= 3, others.crawl);
    check('above the ceiling its light is out and it sees nobody, though it passes right over you',
      others.crawl.pulsesAbove === 0 && others.crawl.passedOverYouWithin < 1 && others.crawl.sawSomebody === 0, others.crawl);
    check('it drops out of the other hatch into the station, where a scan finds it; it sees nobody for a moment, and its light is on again',
      others.landed.space === others.landed.station && others.landed.scannable && others.landed.metresFromTheHatch < 0.5 && others.landed.blind > 0 && others.landed.litAgain, others.landed);
  }

  check('no script errors were reported', problems.length === 0, problems);
  await browser.close();

  if (failures.length > 0) {
    console.log('\n' + failures.length + ' Surveyor check(s) failed:');
    for (const failure of failures) console.log('  - ' + failure);
    process.exit(1);
  }
  console.log('\nAll Surveyor checks passed.');
})().catch((error) => { console.error('Surveyor test crashed:', error); process.exit(1); });
