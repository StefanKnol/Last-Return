// Checks the scanners that scan by themselves: the scanner tripod, and the scanner of somebody who fell
// (src/js/08-loose-objects.js), and the cone of light they fire (src/js/09-scan-cone.js),
// which is what anything that scans by itself will fire: that a station has its tripods, standing; that one
// hangs upright in the beam and faces the way you face, and stands where it is put down; that Q switches it on
// and off; that on, it sends out a pulse of light every so often and each pulse ticks; that its light falls
// where it faces and on nothing behind it or beside it, stops on what is in its way, counts as light on a
// creature and is taken by that creature for where the light came from; and that its battery runs down only
// while it is on, and then it is spent; that the light on it is lit while there is charge in it; and that a
// fallen scanner is switched on and scans the same way, with no battery, and is lit as well.
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
  lab.lens = function (scanner) { return d.getLooseScannerLens(scanner, {}); };
  // The scanner lights there are now: the points that one frame's worth of them puts down, as [x, y, z].
  lab.lights = function () {
    const cloud = d.pointCloud, bytes = cloud.byteView.length / cloud.capacity, floats = bytes / 4, from = cloud.writeIndex, found = [];
    d.showLooseScannerLights();
    for (let index = from; index !== cloud.writeIndex; index = (index + 1) % cloud.capacity) {
      if (cloud.byteView[index * bytes + 17] === d.surfaceScannerLight) found.push([cloud.floatView[index * floats], cloud.floatView[index * floats + 1], cloud.floatView[index * floats + 2]]);
    }
    return found;
  };
  // How many of those points are within a hand of the light of this scanner.
  lab.lightsOn = function (scanner) {
    const light = d.getLooseObjectPoint(scanner, scanner.kind.scans.light, {});
    return lab.lights().filter((point) => Math.hypot(point[0] - light.x, point[1] - light.y, point[2] - light.z) < 0.06).length;
  };
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

  // --- the light on it, to find it by ---
  const lit = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, tripod = lab.station(), seen = {};
    const light = d.getLooseObjectPoint(tripod, tripod.kind.scans.light, {});
    seen.whereItIs = { aboveTheFloor: lab.round(light.y - lab.place.floorY), fromItsMiddle: lab.round(Math.hypot(light.x - tripod.x, light.z - tripod.z)), aboveItsLens: lab.round(light.y - lab.lens(tripod).y) };
    seen.offAndCharged = lab.lightsOn(tripod);
    lab.switch(tripod); d.simulate(0.2);
    seen.on = lab.lightsOn(tripod);
    // Knocked over, the light is where its head is now.
    d.setLooseObjectOrientation(tripod, Math.SQRT1_2, 0, 0, Math.SQRT1_2); d.wakeLooseObject(tripod);
    for (let step = 0; step < 120 && !tripod.isAsleep; step++) d.simulate(1 / 30);
    const lightThen = d.getLooseObjectPoint(tripod, tripod.kind.scans.light, {});
    seen.knockedOver = { lights: lab.lightsOn(tripod), aboveTheFloor: lab.round(lightThen.y - lab.place.floorY), isUpright: lab.isUpright(tripod) };
    tripod.batterySeconds = 0.1; d.simulate(0.5);
    seen.flat = { isSpent: tripod.isSpent, lights: lab.lights().length };
    return seen;
  });
  check('the light on a tripod is on top of its head, and is lit for as long as there is charge in it, switched on or off, standing or knocked over; a spent one is dark',
    lit.whereItIs.aboveTheFloor > 0.4 && lit.whereItIs.aboveTheFloor < 0.7 && lit.whereItIs.fromItsMiddle < 0.05 && lit.whereItIs.aboveItsLens > 0 && lit.offAndCharged === 3 && lit.on === 3 &&
    !lit.knockedOver.isUpright && lit.knockedOver.lights === 3 && lit.knockedOver.aboveTheFloor < 0.3 && lit.flat.isSpent && lit.flat.lights === 0, lit);

  // --- the scanner of somebody who fell: the same, without legs or battery ---
  const fallen = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, p = d.player, seen = { every: d.tuning.tripodPulseEverySeconds, rays: d.tuning.tripodPulseRays };
    lab.station();
    d.clearLooseObjects();
    const ahead = lab.pointAt(0, 0);
    const scanner = d.createLooseObject('scanner', ahead[0], lab.place.floorY + 0.2, ahead[1], 0);
    for (let step = 0; step < 90 && !scanner.isAsleep; step++) d.simulate(1 / 30);
    const facing = function () { const lens = lab.lens(scanner); return lab.round(lens.directionX * Math.sin(p.yaw) - lens.directionZ * Math.cos(p.yaw)); }; // 1: the way you face
    seen.lying = { lights: lab.lightsOn(scanner), isOn: scanner.isOn, label: d.getLooseObjectLabel(scanner), prompt: scanner.kind.use.promptFor(scanner) };
    // In the beam its lens comes round to the way you face; Q switches it on.
    d.pickUpLooseObject(scanner, false); d.simulate(2.5);
    seen.inTheBeam = { held: d.getHeldLooseObject() === scanner, faces: facing(), level: lab.round(Math.abs(lab.lens(scanner).directionY)) };
    d.input.wantsUseCarried = true; d.simulate(0.1);
    seen.switchedOn = { isOn: scanner.isOn, label: d.getLooseObjectLabel(scanner), prompt: scanner.kind.use.promptFor(scanner), told: document.getElementById('hud-messages').textContent };
    // Put down, it lies there scanning the way you faced: pulses as a tripod's, and its light falls on you in front of its lens.
    d.releaseHeldLooseObject(0);
    for (let step = 0; step < 150 && !scanner.isAsleep; step++) d.simulate(1 / 30);
    seen.putDown = { faces: facing(), isOn: scanner.isOn, lights: lab.lightsOn(scanner) };
    const firedBefore = scanner.pulsesFired;
    const lens = lab.lens(scanner);
    p.x = lens.x + lens.directionX * 2.5; p.z = lens.z + lens.directionZ * 2.5;
    const litBefore = scanner.lastLitPlayerTime;
    d.simulate(seen.every * 3 + 0.1);
    seen.scanning = { fired: scanner.pulsesFired - firedBefore, fellOnYou: scanner.lastLitPlayerTime > litBefore };
    // No battery: a long time on, it is still on and not spent.
    scanner.batterySeconds = 0;
    d.simulate(20);
    seen.muchLater = { isOn: scanner.isOn, isSpent: scanner.isSpent, label: d.getLooseObjectLabel(scanner) };
    lab.switch(scanner);
    seen.switchedOff = { isOn: scanner.isOn, lights: lab.lightsOn(scanner) };
    return seen;
  });
  check('a fallen scanner is lit where it lies, and is something to switch on: in the beam its lens comes round to the way you face, and Q switches it on',
    fallen.lying.lights === 3 && !fallen.lying.isOn && fallen.lying.label === 'scanner' && /Switch the scanner on/.test(fallen.lying.prompt) && fallen.inTheBeam.held && fallen.inTheBeam.faces > 0.9 && fallen.inTheBeam.level < 0.3 &&
    fallen.switchedOn.isOn && fallen.switchedOn.label === 'scanner, on' && /Switch the scanner off/.test(fallen.switchedOn.prompt) && /scanner is on/.test(fallen.switchedOn.told), fallen);
  check('put down it scans the way it points, in pulses as a tripod does, and its light falls on you in front of its lens; it has no battery to run down; switched off it is still lit',
    fallen.putDown.isOn && fallen.putDown.lights === 3 && Math.abs(fallen.scanning.fired - 3 * fallen.rays) <= 8 && fallen.scanning.fellOnYou && fallen.muchLater.isOn && !fallen.muchLater.isSpent &&
    fallen.muchLater.label === 'scanner, on' && !fallen.switchedOff.isOn && fallen.switchedOff.lights === 3, fallen);

  // --- the Hollow and a scanner that scans by itself: it comes to look, finds out it is a thing, and leaves it be ---
  const known = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, p = d.player, tripod = lab.station();
    const seen = { knowsWithin: d.tuning.hollowKnowsScannerMetres, standsFor: d.tuning.hollowAtScannerSeconds, notices: d.tuning.hollowAngerNoticeLevel };
    const hollow = d.hollow, metresFromIt = function () { return Math.hypot(hollow.figure.x - tripod.x, hollow.figure.z - tripod.z); };
    // You, well away and standing still (but within earshot of what it says): what it does here is about the tripod and nothing else.
    let far = null;
    for (const waypoint of d.roamingWaypoints) {
      const metres = Math.hypot(waypoint[0] - lab.place.x, waypoint[1] - lab.place.z);
      if (metres > 25 || d.isVentAt(waypoint[0], waypoint[1])) continue;
      if (!far || metres > far.metres) far = { x: waypoint[0], z: waypoint[1], metres: metres };
    }
    const standFarOff = function () { d.teleport(far.x, far.z, 0); p.velocityX = 0; p.velocityZ = 0; };
    standFarOff();
    seen.youAreMetresOff = lab.round(far.metres);
    // The Hollow, standing in the tripod's light, five metres in front of it.
    const inTheLight = lab.pointAt(Math.min(5, lab.place.clear - 1.5), 0);
    const putInTheLight = function (seconds) { hollow.figure.x = inTheLight[0]; hollow.figure.z = inTheLight[1]; hollow.state = 4; hollow.listenTimer = seconds; };
    d.spawnHollow(inTheLight[0], inTheLight[1]); hollow.graceTimer = 0;
    putInTheLight(4);
    lab.switch(tripod);
    d.captionCounts.hollowKnowsScanner = 0;
    // It is lit, its temper rises, and it comes for where the light is from.
    seen.mostAnger = 0; seen.wentAfterIt = false; seen.states = [];
    seen.secondsToKnowIt = -1;
    for (let seconds = 0; seconds < 90 && seen.secondsToKnowIt < 0; seconds += 0.25) {
      d.simulate(0.25);
      seen.mostAnger = Math.max(seen.mostAnger, hollow.anger);
      if (hollow.state === 2 || hollow.state === 1) seen.wentAfterIt = true; // hunting, or coming to look
      if (seen.states[seen.states.length - 1] !== hollow.state) seen.states.push(hollow.state);
      if (tripod.isIgnoredByHollow) seen.secondsToKnowIt = seconds + 0.25;
    }
    seen.mostAnger = lab.round(seen.mostAnger);
    seen.whenItKnows = { metresFromIt: lab.round(metresFromIt()), state: hollow.state, anger: lab.round(hollow.anger), isEnraged: hollow.enragedTimer > 0, said: d.captionCounts.hollowKnowsScanner || 0, tripodIsOn: tripod.isOn };
    // It stands over it for a moment and then goes back to its rounds.
    d.simulate(seen.standsFor + 0.5);
    seen.afterAMoment = hollow.state;
    // Put back in its light, and with it ticking away: its temper does not rise, it is not held, it goes after nothing.
    const litBefore = tripod.pulsesOnCreatures;
    seen.inItsLightAgain = { mostAnger: 0, wasHeld: false, wentAfterSomething: false };
    for (let round = 0; round < 6; round++) {
      putInTheLight(3);
      for (let step = 0; step < 8; step++) {
        d.simulate(0.25);
        seen.inItsLightAgain.mostAnger = Math.max(seen.inItsLightAgain.mostAnger, hollow.anger);
        if (hollow.heldAmount > 0.05) seen.inItsLightAgain.wasHeld = true;
        if (hollow.state === 2 || hollow.state === 1) seen.inItsLightAgain.wentAfterSomething = true;
      }
    }
    seen.inItsLightAgain.mostAnger = lab.round(seen.inItsLightAgain.mostAnger);
    seen.inItsLightAgain.pulsesThatLandedOnIt = tripod.pulsesOnCreatures - litBefore;
    // Taken into the beam again it is a new thing to it: put down, its light angers the Hollow as it did.
    hollow.graceTimer = 99;
    d.teleport(tripod.x - lab.forward[0] * 1.1, tripod.z - lab.forward[1] * 1.1, lab.place.yaw); p.velocityX = 0; p.velocityZ = 0; p.pitch = 0;
    d.pickUpLooseObject(tripod, false); d.simulate(1);
    seen.handledAgain = { isKnown: tripod.isIgnoredByHollow };
    d.releaseHeldLooseObject(0);
    for (let step = 0; step < 150 && !tripod.isAsleep; step++) d.simulate(1 / 30);
    standFarOff();
    hollow.graceTimer = 0; hollow.anger = 0;
    seen.handledAgain.mostAnger = 0;
    for (let step = 0; step < 24 && !tripod.isIgnoredByHollow; step++) { if (step % 8 === 0) putInTheLight(3); d.simulate(0.25); seen.handledAgain.mostAnger = Math.max(seen.handledAgain.mostAnger, hollow.anger); }
    seen.handledAgain.mostAnger = lab.round(seen.handledAgain.mostAnger);
    // And by its light alone (its tick made too faint to hear, for this), where its light angers the Hollow
    // faster than its temper cools (a threat level with a quick temper: on Standard a tripod's short pulses do
    // not): lit, its temper rises and it comes for where the light is from, as it would come for you. That ends
    // at the tripod, and so does its temper.
    const tickCarries = d.tuning.noiseRadiusTripodPulse;
    d.tuning.noiseRadiusTripodPulse = 0.4;
    d.game.difficulty = Object.assign({}, d.difficultyPresets.standard, { angerFactor: 4 });
    d.teleport(tripod.x - lab.forward[0] * 1.1, tripod.z - lab.forward[1] * 1.1, lab.place.yaw); p.velocityX = 0; p.velocityZ = 0; p.pitch = 0;
    hollow.graceTimer = 99; hollow.figure.x = inTheLight[0]; hollow.figure.z = inTheLight[1];
    d.pickUpLooseObject(tripod, false); d.simulate(1); d.releaseHeldLooseObject(0);
    for (let step = 0; step < 150 && !tripod.isAsleep; step++) d.simulate(1 / 30);
    standFarOff();
    hollow.graceTimer = 0; hollow.anger = 0; hollow.enragedTimer = 0;
    putInTheLight(120);
    seen.byLightAlone = { mostAnger: 0, cameForIt: false, huntedAThing: false, secondsToKnowIt: -1 };
    for (let seconds = 0; seconds < 120 && seen.byLightAlone.secondsToKnowIt < 0; seconds += 0.25) {
      d.simulate(0.25);
      seen.byLightAlone.mostAnger = Math.max(seen.byLightAlone.mostAnger, hollow.anger);
      if (hollow.state === 2 || hollow.state === 1) seen.byLightAlone.cameForIt = true; // hunting where the light is from, or coming over to look
      if (hollow.state === 2 && hollow.isAfterAThing) seen.byLightAlone.huntedAThing = true;
      if (tripod.isIgnoredByHollow) seen.byLightAlone.secondsToKnowIt = seconds + 0.25;
    }
    seen.byLightAlone.mostAnger = lab.round(seen.byLightAlone.mostAnger);
    seen.byLightAlone.whenItKnows = { state: hollow.state, anger: lab.round(hollow.anger), isEnraged: hollow.enragedTimer > 0, metresFromIt: lab.round(metresFromIt()) };
    seen.byLightAlone.states = [];
    for (let step = 0; step < 80; step++) { d.simulate(0.25); if (seen.byLightAlone.states[seen.byLightAlone.states.length - 1] !== hollow.state) seen.byLightAlone.states.push(hollow.state); }
    seen.byLightAlone.later = { anger: lab.round(hollow.anger), isEnraged: hollow.enragedTimer > 0 };
    d.tuning.noiseRadiusTripodPulse = tickCarries;
    d.game.difficulty = d.difficultyPresets.standard;
    hollow.isActive = false;
    return seen;
  });
  check('where its temper is quick: lit by a tripod, with nothing to hear, the Hollow\'s temper rises and it comes for where the light is from as it would come for you; that ends at the tripod: it finds out, its temper is gone, and in the twenty seconds after it hunts nothing and comes to look at nothing',
    known.byLightAlone.mostAnger >= known.notices * 0.5 && known.byLightAlone.cameForIt && known.byLightAlone.secondsToKnowIt > 0 &&
    known.byLightAlone.whenItKnows.state === 4 && known.byLightAlone.whenItKnows.anger < known.notices && !known.byLightAlone.whenItKnows.isEnraged && known.byLightAlone.whenItKnows.metresFromIt < known.knowsWithin + 0.3 &&
    known.byLightAlone.states.indexOf(2) < 0 && known.byLightAlone.states.indexOf(1) < 0 && known.byLightAlone.later.anger < known.notices && !known.byLightAlone.later.isEnraged, known.byLightAlone);
  check('a tripod that lights the Hollow, ticking, brings it over as any light or noise does; right up to it, the Hollow finds out it is a thing: it sniffs, stands over it for a moment, calm, and goes back to its rounds',
    known.youAreMetresOff > 8 && known.wentAfterIt && known.secondsToKnowIt > 0 && known.whenItKnows.metresFromIt < known.knowsWithin + 0.3 && known.whenItKnows.state === 4 &&
    known.whenItKnows.anger < known.notices && !known.whenItKnows.isEnraged && known.whenItKnows.said === 1 && known.whenItKnows.tripodIsOn && known.afterAMoment === 0, known);
  check('after that the tripod\'s light is nothing to it, and neither is its ticking: standing in the light it is not angered, not held, and goes after nothing, though the light still lands on it',
    known.inItsLightAgain.pulsesThatLandedOnIt > 50 && known.inItsLightAgain.mostAnger <= known.whenItKnows.anger + 0.001 && !known.inItsLightAgain.wasHeld && !known.inItsLightAgain.wentAfterSomething, known.inItsLightAgain);
  check('taken into the beam again the tripod is a new thing to it: put down, its light angers the Hollow as it did at first',
    !known.handledAgain.isKnown && known.handledAgain.mostAnger > 0.03, known.handledAgain);

  // --- what the tools are worth ---
  const worth = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, seen = {};
    lab.station();
    d.clearLooseObjects();
    const at = lab.pointAt(1, 0);
    const grenade = d.createLooseObject('scanGrenade', at[0], lab.place.floorY + 0.2, at[1], 0);
    const tripod = d.createLooseObject('scannerTripod', lab.place.x, lab.place.floorY + 0.34, lab.place.z, 0);
    d.simulate(1);
    seen.unused = { grenade: d.getLooseObjectValue(grenade), tripod: d.getLooseObjectValue(tripod) };
    d.askToAct({ what: 'setOff', id: grenade.id });
    d.simulate(d.tuning.scanGrenadeFuseSeconds + d.tuning.scanGrenadeBurstSeconds + 0.5);
    seen.grenadeGoneOff = { isSpent: grenade.isSpent, worth: d.getLooseObjectValue(grenade) };
    return seen;
  });
  check('a scan grenade is worth a little to Salvage unused, much less than a tripod, and next to nothing once it has gone off',
    worth.unused.grenade > 0 && worth.unused.grenade < worth.unused.tripod / 2 && worth.grenadeGoneOff.isSpent && worth.grenadeGoneOff.worth <= 2 && worth.grenadeGoneOff.worth < worth.unused.grenade, worth);

  check('no script errors were reported', problems.length === 0, problems);
  await browser.close();

  if (failures.length > 0) {
    console.log('\n' + failures.length + ' check(s) failed.');
    process.exit(1);
  }
  console.log('\nAll tripod checks passed.');
})().catch((error) => { console.error('Tripod test crashed:', error); process.exit(1); });
