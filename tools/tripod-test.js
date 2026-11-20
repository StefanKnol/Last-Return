// Checks the scanner tripod (src/js/08-loose-objects.js) and the cone of light it fires (src/js/09-scan-cone.js),
// which is what anything that scans by itself will fire: that a station has its tripods, standing; that one
// hangs upright in the beam and faces the way you face, and stands where it is put down; that Q switches it on
// and off; that on, it sends out a pulse of light every so often and each pulse ticks; that its light falls
// where it faces and on nothing behind it or beside it, stops on what is in its way, counts as light on a
// creature and is taken by that creature for where the light came from; and that its battery runs down only
// while it is on, and then it is spent.
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
  lab.round = function (value) { return Math.round(value * 100) / 100; };
  lab.lens = function (tripod) { return d.getScannerTripodLens(tripod, {}); };
  lab.isUpright = function (tripod) { return tripod.matrix[4] > 0.99; };
  // How far it is from a point at lens height to the first thing in the way, level, towards `yaw`.
  lab.clearMetres = function (x, z, yaw) {
    const y = d.getFloorHeightAt(x, z) + 0.45;
    return d.castScannerRay(x, y, z, Math.sin(yaw), 0, -Math.cos(yaw), 40) ? d.rayHit.distance : 40;
  };
  // A quiet station with nothing loose in it, and a place in it with a long clear view one way: where a tripod
  // of this check's own stands, facing that way. Returns the tripod.
  lab.station = function () {
    d.game.difficulty = d.difficultyPresets.standard;
    d.loadStation('classic', 0);
    d.game.flags.hasLeftLift = true;
    d.setDebugOption('holdArrivals', true); d.setDebugOption('invulnerable', true);
    d.hollow.isActive = false;
    d.clearLooseObjects();
    d.settings.captions = 'all';
    lab.place = null;
    for (const waypoint of d.roamingWaypoints) {
      if (d.isVentAt(waypoint[0], waypoint[1])) continue;
      for (let turn = 0; turn < 16; turn++) {
        const yaw = turn * Math.PI / 8, clear = lab.clearMetres(waypoint[0], waypoint[1], yaw);
        // Clear ahead for a good way, at lens height and at shin height, and a little room behind.
        if (clear < 7 || lab.clearMetres(waypoint[0], waypoint[1], yaw + Math.PI) < 1.2) continue;
        if (!lab.place || clear > lab.place.clear) lab.place = { x: waypoint[0], z: waypoint[1], yaw: yaw, clear: clear, floorY: d.getFloorHeightAt(waypoint[0], waypoint[1]) };
      }
    }
    if (!lab.place) return null;
    lab.forward = [Math.sin(lab.place.yaw), -Math.cos(lab.place.yaw)];
    d.teleport(lab.place.x - lab.forward[0] * 1.1, lab.place.z - lab.forward[1] * 1.1, lab.place.yaw); d.player.velocityX = 0; d.player.velocityZ = 0; d.player.pitch = 0;
    const tripod = d.createLooseObject('scannerTripod', lab.place.x, lab.place.floorY + 0.34, lab.place.z, lab.place.yaw);
    for (let step = 0; step < 90 && !tripod.isAsleep; step++) d.simulate(1 / 30);
    return tripod;
  };
  lab.switch = function (tripod) { d.askToAct({ what: 'setOff', id: tripod.id }); };
  // A point `metres` from the place, `turn` round from the way the tripod faces.
  lab.pointAt = function (metres, turn) {
    const yaw = lab.place.yaw + (turn || 0);
    return [lab.place.x + Math.sin(yaw) * metres, lab.place.z - Math.cos(yaw) * metres];
  };
  window.lab = lab;
});

(async () => {
  const { browser, page, problems } = await openGame({ dev: true });
  const inGame = (callback, argument) => page.evaluate(callback, argument);
  await startGame(page, false);
  await inGame((source) => (0, eval)('(' + source + ')')(), labSource);

  // --- a station has them, standing ---
  const stations = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, seen = [];
    const look = function (name) {
      const tripods = d.looseObjects.filter((object) => object.kindKey === 'scannerTripod');
      const rooms = d.level.roomCount || 19;
      seen.push({ name: name, tripods: tripods.length, wanted: Math.max(1, Math.round(rooms * d.tuning.scannerTripodsPerRoom)), counted: d.level.scannerTripodCount,
        allStandAtRest: tripods.every((tripod) => tripod.isAsleep && lab.isUpright(tripod)), allOff: tripods.every((tripod) => !tripod.isOn && !tripod.isSpent && tripod.batterySeconds === d.tuning.tripodBatterySeconds),
        lensHeights: tripods.map((tripod) => lab.round(lab.lens(tripod).y - d.getFloorHeightAt(tripod.x, tripod.z))) });
    };
    d.loadStation('classic', 0); look('classic 0');
    for (const [seed, size] of [[4, 'small'], [7, 'medium'], [3, 'massive']]) if (d.loadStation('generated', seed, size, 'mixed', 'one')) look('generated ' + seed + ' ' + size);
    return seen;
  });
  check('every station has the scanner tripods its rooms ask for, never fewer than one: each standing on its three legs, at rest, switched off, its battery full, its lens under half a metre up',
    stations.length >= 3 && stations.every((station) => station.tripods === station.wanted && station.counted === station.wanted && station.wanted >= 1 && station.allStandAtRest && station.allOff &&
      station.lensHeights.every((height) => height > 0.3 && height < 0.6)) && stations.some((station) => station.tripods >= 2), stations);

  // --- in the beam, and put down ---
  const held = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, p = d.player, tripod = lab.station();
    if (!tripod) return null;
    const seen = { place: lab.place };
    const facing = function () { const lens = lab.lens(tripod); return lab.round(lens.directionX * Math.sin(p.yaw) - lens.directionZ * Math.cos(p.yaw)); }; // 1: the way you face
    seen.asItStands = { isUpright: lab.isUpright(tripod), faces: facing(), label: d.getLooseObjectLabel(tripod) };
    // Taken into the beam while you face another way: it comes round to face the way you do, upright.
    p.yaw = lab.place.yaw + 1.3;
    d.pickUpLooseObject(tripod, false);
    d.simulate(2.5);
    seen.inTheBeam = { held: d.getHeldLooseObject() === tripod, upright: lab.round(tripod.matrix[4]), faces: facing() }; // (1: upright. It is still swinging a little)
    p.yaw = lab.place.yaw;
    d.simulate(2);
    seen.turnedWithYou = { isUpright: lab.isUpright(tripod), faces: facing() };
    // Q switches it on, and says so.
    seen.promptOff = tripod.kind.use.promptFor(tripod);
    d.input.wantsUseCarried = true; d.simulate(0.1);
    seen.switchedOn = { isOn: tripod.isOn, label: d.getLooseObjectLabel(tripod), prompt: tripod.kind.use.promptFor(tripod), told: document.getElementById('hud-messages').textContent };
    // Put down (let go of, looking level): it lands on its legs and stays the way it faced, still on.
    d.releaseHeldLooseObject(0);
    d.simulate(3);
    seen.putDown = { isUpright: lab.isUpright(tripod), faces: facing(), isAtRest: tripod.isAsleep, isOn: tripod.isOn, onTheFloor: lab.round(tripod.y - d.getFloorHeightAt(tripod.x, tripod.z)) };
    // And Q again, in the beam, switches it off.
    d.pickUpLooseObject(tripod, false); d.simulate(0.5);
    d.input.wantsUseCarried = true; d.simulate(0.1);
    seen.switchedOff = { isOn: tripod.isOn, label: d.getLooseObjectLabel(tripod) };
    return seen;
  });
  check('there is a place with a clear view for a tripod to stand', held !== null, held ? held.place : null);
  check('in the beam a tripod hangs upright and comes round to face the way you face, and turns with you',
    held !== null && held.asItStands.isUpright && held.inTheBeam.held && held.inTheBeam.upright > 0.9 && held.inTheBeam.faces > 0.9 && held.turnedWithYou.isUpright && held.turnedWithYou.faces > 0.97, held);
  check('Q with it in the beam switches it on, and what Q is said to do changes with it; put down, it stands on its legs where you put it, facing the way you faced, still on; Q again switches it off',
    held !== null && /Switch the tripod on/.test(held.promptOff) && held.switchedOn.isOn && /, on,/.test(held.switchedOn.label) && /Switch the tripod off/.test(held.switchedOn.prompt) && /tripod is on/.test(held.switchedOn.told) &&
    held.putDown.isUpright && held.putDown.faces > 0.95 && held.putDown.isAtRest && held.putDown.isOn && held.putDown.onTheFloor < 0.4 && !held.switchedOff.isOn && !/, on,/.test(held.switchedOff.label), held);

  // --- on: a pulse every so often, each a tick ---
  const pulses = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, tripod = lab.station();
    const seen = { every: d.tuning.tripodPulseEverySeconds, rays: d.tuning.tripodPulseRays, carries: d.tuning.noiseRadiusTripodPulse, battery: d.tuning.tripodBatterySeconds, noises: [] };
    d.debugHooks.recordNoise = function (x, z, radius) { seen.noises.push([lab.round(Math.hypot(x - tripod.x, z - tripod.z)), lab.round(radius / d.game.difficulty.hearingFactor)]); };
    // Off, it does nothing.
    d.simulate(seen.every * 2);
    seen.whileOff = { fired: tripod.pulsesFired, noises: seen.noises.length, battery: tripod.batterySeconds };
    lab.switch(tripod);
    d.captionCounts.tripodPulse = 0;
    const startedAt = d.game.time;
    d.simulate(seen.every * 4 + 0.2);
    seen.seconds = d.game.time - startedAt;
    seen.whileOn = { fired: tripod.pulsesFired, noises: seen.noises.length, captions: d.captionCounts.tripodPulse || 0, batteryUsed: lab.round(seen.battery - tripod.batterySeconds), isUprightStill: lab.isUpright(tripod) };
    seen.noiseFromIt = seen.noises.every((noise) => noise[0] < 0.2), seen.noiseCarries = seen.noises.length > 0 ? seen.noises[0][1] : -1;
    // Off again: no more of either, and the battery is not counted down.
    lab.switch(tripod);
    const firedThen = tripod.pulsesFired, noisesThen = seen.noises.length, batteryThen = tripod.batterySeconds;
    d.simulate(seen.every * 2);
    seen.offAgain = { fired: tripod.pulsesFired - firedThen, noises: seen.noises.length - noisesThen, batteryUsed: batteryThen - tripod.batterySeconds };
    d.debugHooks.recordNoise = null;
    return seen;
  });
  check('switched off a tripod does nothing; switched on it sends out a pulse of light every so often, each as many of the scanner\'s pulses as a pulse of its own is, each with a tick that is a noise where it stands',
    pulses.whileOff.fired === 0 && pulses.whileOff.noises === 0 && pulses.whileOff.battery === pulses.battery &&
    pulses.whileOn.noises === 4 && Math.abs(pulses.whileOn.fired - 4 * pulses.rays) <= 8 && pulses.whileOn.captions === 4 && pulses.noiseFromIt && Math.abs(pulses.noiseCarries - pulses.carries) < 0.01 && pulses.whileOn.isUprightStill, pulses);
  check('its battery runs down while it is on and only then; switched off again there is no more light and no more noise',
    Math.abs(pulses.whileOn.batteryUsed - pulses.seconds) < 0.1 && pulses.offAgain.fired === 0 && pulses.offAgain.noises === 0 && pulses.offAgain.batteryUsed === 0, pulses);

  // --- where the light falls ---
  const light = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, p = d.player, tripod = lab.station();
    const seen = { half: d.tuning.tripodConeDegrees / 2 };
    const lens = lab.lens(tripod);
    const cone = function (halfDegrees, count, fromY) {
      const result = d.fireScanCone(lens.x, fromY === undefined ? lens.y : fromY, lens.z, lens.directionX, lens.directionY, lens.directionZ, halfDegrees, count, tripod);
      return { fired: result.fired, landed: result.landed, onCreatures: result.onCreatures, onYou: result.litPlayers.indexOf(p) >= 0 };
    };
    const standAt = function (metres, turn) { const point = lab.pointAt(metres, turn); p.x = point[0]; p.z = point[1]; };
    seen.lensLooksTheWayItFaces = lab.round(lens.directionX * lab.forward[0] + lens.directionZ * lab.forward[1]);
    // You, three metres in front of it; behind it; and three metres off, twice as far round as its light opens.
    standAt(3, 0); seen.inFront = cone(seen.half, 600);
    standAt(-1, 0); seen.behind = cone(seen.half, 600);
    standAt(3, seen.half * 2 * Math.PI / 180); seen.beside = cone(seen.half, 600);
    // Just inside the edge of its light, and just outside it.
    standAt(3, (seen.half - 8) * Math.PI / 180); seen.insideTheEdge = cone(seen.half, 1500);
    standAt(3, (seen.half + 9) * Math.PI / 180); seen.outsideTheEdge = cone(seen.half, 1500);
    // Something in the way: a thin ray at shin height, with a crate between it and you, and with the crate gone.
    standAt(3, 0);
    const middle = lab.pointAt(1.5, 0);
    const crate = d.createLooseObject('crate', middle[0], lab.place.floorY + 0.23, middle[1], lab.place.yaw);
    for (let step = 0; step < 60 && !crate.isAsleep; step++) d.simulate(1 / 30);
    standAt(3, 0);
    seen.behindACrate = cone(0.5, 60, lab.place.floorY + 0.2);
    d.removeLooseObject(crate);
    seen.withTheCrateGone = cone(0.5, 60, lab.place.floorY + 0.2);
    // A creature in front of it: the light counts on it, and it takes the tripod for where the light came from. One behind it gets none.
    const ahead = lab.pointAt(Math.min(4, lab.place.clear - 1.5), 0);
    d.spawnHollow(ahead[0], ahead[1]); d.hollow.graceTimer = 99;
    standAt(-1, 0);
    const hitsBefore = d.hollow.figure.totalHits;
    seen.onACreature = cone(seen.half, 1200);
    seen.creature = { hits: d.hollow.figure.totalHits - hitsBefore, lightCameFrom: lab.round(Math.hypot(d.hollow.figure.beamSourceX - lens.x, d.hollow.figure.beamSourceZ - lens.z)),
      metresFromYou: lab.round(Math.hypot(p.x - lens.x, p.z - lens.z)) };
    const back = lab.pointAt(-1, 0);
    d.hollow.figure.x = back[0]; d.hollow.figure.z = back[1]; d.simulate(0.05);
    const hitsThen = d.hollow.figure.totalHits;
    seen.onOneBehindIt = cone(seen.half, 1200).onCreatures + (d.hollow.figure.totalHits - hitsThen);
    d.hollow.isActive = false;
    return seen;
  });
  check('its light goes the way it faces: on you in front of it, not on you behind it or well to one side, and its edge is where its cone ends',
    light.lensLooksTheWayItFaces > 0.99 && light.inFront.fired === 600 && light.inFront.landed > 500 && light.inFront.onYou && !light.behind.onYou && !light.beside.onYou &&
    light.insideTheEdge.onYou && !light.outsideTheEdge.onYou, light);
  check('light stops on what is in its way: with a crate between it and you it does not fall on you, and with the crate gone it does',
    !light.behindACrate.onYou && light.behindACrate.landed === light.behindACrate.fired && light.withTheCrateGone.onYou, [light.behindACrate, light.withTheCrateGone]);
  check('it counts as light on a creature in front of it, which takes the tripod for where the light came from and not you; a creature behind it gets none',
    light.onACreature.onCreatures > 20 && light.creature.hits === light.onACreature.onCreatures && light.creature.lightCameFrom < 0.05 && light.creature.metresFromYou > 0.5 && light.onOneBehindIt === 0, light);

  // --- the battery ---
  const battery = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, tripod = lab.station(), seen = {};
    lab.switch(tripod);
    tripod.batterySeconds = 1;
    d.simulate(0.5);
    seen.nearlyFlat = { isOn: tripod.isOn, label: d.getLooseObjectLabel(tripod) };
    d.simulate(1);
    seen.flat = { isOn: tripod.isOn, isSpent: tripod.isSpent, label: d.getLooseObjectLabel(tripod) };
    const fired = tripod.pulsesFired;
    lab.switch(tripod); // (asked for all the same: nothing comes of it)
    d.pickUpLooseObject(tripod, false); d.simulate(0.5);
    d.input.wantsUseCarried = true; d.simulate(d.tuning.tripodPulseEverySeconds * 2);
    seen.afterwards = { isOn: tripod.isOn, firedSince: tripod.pulsesFired - fired };
    return seen;
  });
  check('when its battery is flat it goes out and is a spent tripod: Q does nothing more',
    battery.nearlyFlat.isOn && /1 % charged/.test(battery.nearlyFlat.label) && !battery.flat.isOn && battery.flat.isSpent && battery.flat.label === 'spent scanner tripod' &&
    !battery.afterwards.isOn && battery.afterwards.firedSince === 0, battery);

  check('no script errors were reported', problems.length === 0, problems);
  await browser.close();

  if (failures.length > 0) {
    console.log('\n' + failures.length + ' check(s) failed.');
    process.exit(1);
  }
  console.log('\nAll tripod checks passed.');
})().catch((error) => { console.error('Tripod test crashed:', error); process.exit(1); });
