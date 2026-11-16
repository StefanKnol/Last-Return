// Checks the loose objects (things you carry, drop and throw): that they fall and come to rest, that carrying
// one puts it in the way of the scanner, that a knock is heard by how hard it was, that an object which cannot
// follow you is pulled out of your hands, and that the keys and the phone's button do what they say.
const { openGame, startGame, drawFrames } = require('./browser-harness.js');

const failures = [];
function check(description, condition, detail) {
  const line = (condition ? 'ok    ' : 'FAIL  ') + description + (detail !== undefined ? '  ' + JSON.stringify(detail) : '');
  console.log(line);
  if (!condition) failures.push(description);
}

// Helpers that run inside the game's page. They are put on `window.looseLab` once.
function installLab() {
  const d = window.lastReturnDebug, p = d.player;
  const round = (value) => Math.round(value * 1000) / 1000;
  const lab = window.looseLab = {
    round: round,
    noises: [],
    // Starts over: Kessel-9, nothing loose, creatures held still, every noise written down.
    reset: function () {
      d.loadStation('classic', 0);
      d.game.flags.hasLeftLift = true;
      d.setDebugOption('freezeCreatures', true); d.setDebugOption('invulnerable', true); d.setDebugOption('unlimitedStamina', true);
      d.hollow.isActive = false;
      d.input.keysDown.clear(); d.input.touchDropHeld = false;
      d.settings.captions = 'all';
      lab.noises.length = 0;
      d.debugHooks.recordNoise = function (x, z, radius) { lab.noises.push({ x: x, z: z, radius: radius }); };
      for (const key of ['ownObjectKnock', 'ownObjectCrash', 'objectKnock', 'objectCrash']) d.captionCounts[key] = 0;
    },
    // The roomiest spot in the station, and how far it is from there to the nearest thing in any direction.
    findOpenSpot: function () {
      let best = null, bestRoom = 0;
      for (let z = 2; z < 200; z++) {
        for (let x = 2; x < 200; x++) {
          const spot = d.findWalkableSpotNear(x + 0.5, z + 0.5);
          if (!spot || spot.x !== x + 0.5 || spot.z !== z + 0.5 || d.isVentAt(x + 0.5, z + 0.5)) continue;
          if (Math.abs(d.getFloorHeightAt(x + 0.5, z + 0.5)) > 0.01) continue;
          let least = 99;
          for (let eighth = 0; eighth < 8; eighth++) {
            const yaw = eighth * Math.PI / 4;
            for (const height of [0.2, 1.3]) {
              const isHit = d.castScannerRay(x + 0.5, height, z + 0.5, Math.sin(yaw), 0, -Math.cos(yaw), 40);
              least = Math.min(least, isHit ? d.rayHit.distance : 40);
            }
          }
          if (least > bestRoom) { bestRoom = least; best = { x: x + 0.5, z: z + 0.5 }; }
        }
      }
      best.room = bestRoom;
      return best;
    },
    // Distance from (x, z) to the first wall or object along `yaw`, at chest height.
    distanceAhead: function (x, z, yaw) {
      return d.castScannerRay(x, 1.2, z, Math.sin(yaw), 0, -Math.cos(yaw), 60) ? d.rayHit.distance : 60;
    },
    stand: function (x, z, yaw) {
      d.input.keysDown.clear();
      d.teleport(x, z, yaw); p.pitch = 0; p.velocityX = 0; p.velocityZ = 0;
      d.simulate(0.3);
    },
    // Puts an object of this kind straight into your hands and lets it settle there.
    carry: function (kindKey) {
      const held = d.getHeldLooseObject();
      if (held) d.removeLooseObject(held);
      const object = d.createLooseObject(kindKey, p.x + Math.sin(p.yaw) * 0.55, d.getPlayerEyeY() - 0.2, p.z - Math.cos(p.yaw) * 0.55, p.yaw);
      d.pickUpLooseObject(object);
      d.simulate(0.8);
      return object;
    },
    gapToHands: function (object) {
      return Math.hypot(d.looseState.holdTargetX - object.x, d.looseState.holdTargetY - object.y, d.looseState.holdTargetZ - object.z);
    },
    // The share of the scanner's cone, `degrees` wide, that stops on this object. The pulses are spread the way
    // the scanner spreads them, but evenly instead of by chance, so that the answer is the same every time.
    coneShare: function (object, degrees) {
      d.computeScannerBasis(p.yaw, p.pitch);
      const basis = d.scannerBasis, tangent = Math.tan(degrees * Math.PI / 180), eyeY = d.getPlayerEyeY(), pulses = 800;
      let stopped = 0;
      for (let pulse = 0; pulse < pulses; pulse++) {
        const radius = Math.pow((pulse + 0.5) / pulses, 0.62) * tangent, angle = pulse * 2.399963;
        const across = Math.cos(angle) * radius, up = Math.sin(angle) * radius;
        const x = basis.forwardX + basis.rightX * across + basis.upX * up;
        const y = basis.forwardY + basis.rightY * across + basis.upY * up;
        const z = basis.forwardZ + basis.rightZ * across + basis.upZ * up;
        const length = Math.hypot(x, y, z);
        if (d.castScannerRay(p.x, eyeY, p.z, x / length, y / length, z / length, 30) && d.rayHit.looseObject === object) stopped++;
      }
      return round(stopped / pulses);
    },
    knocks: function () { const s = d.looseState.statistics; return { heard: s.knocksHeard, quiet: s.knocksQuiet, pulled: s.pulledFromHands }; },
    since: function (before) { const now = lab.knocks(); return { heard: now.heard - before.heard, quiet: now.quiet - before.quiet, pulled: now.pulled - before.pulled }; },
    messages: function () { return Array.from(document.querySelectorAll('#hud-messages .hud-message')).map((element) => element.textContent); },
    // Is this point inside the station, with room for something to be there?
    isInTheOpen: function (x, y, z) { return d.isSpaceOpenAt(x, y + 0.02, z); },
    // How far it is from (x, z) along +x to the rock itself, whatever stands in front of it.
    rockAhead: function (x, z) {
      let distance = 0;
      while (distance < 60 && d.isSpaceOpenAt(x + distance, 1, z)) distance += 0.05;
      return distance;
    }
  };
}

(async () => {
  const { browser, page, problems } = await openGame({ dev: true });
  const inGame = (callback, argument) => page.evaluate(callback, argument);
  await startGame(page, false);
  await inGame(installLab);

  // --- how they are described ---
  const described = await inGame(() => {
    const d = window.lastReturnDebug, wrong = [], counts = {};
    for (const kindKey of Object.keys(d.looseObjectKinds)) {
      const kind = d.looseObjectKinds[kindKey];
      if (!kind.label || !(kind.mass > 0) || ['metal', 'glass', 'case'].indexOf(kind.material) < 0 || (kind.hands !== 1 && kind.hands !== 2) ||
          !(kind.bounce >= 0 && kind.bounce < 1) || !(kind.grip >= 0 && kind.grip <= 1) || !kind.parts || kind.parts.length === 0 ||
          !kind.hold || !(kind.hold.forward > 0.2)) wrong.push(kindKey + ': incomplete');
      const object = d.createLooseObject(kindKey, 0, 0, 0, 0);
      const prepared = object.prepared, shell = prepared.shell;
      counts[kindKey] = prepared.shellCount;
      // The centre of mass is the object's own origin: weighed by volume, the balls of the shell balance about it.
      let x = 0, y = 0, z = 0, total = 0;
      for (let ball = 0; ball < prepared.shellCount; ball++) {
        const weight = Math.pow(shell[ball * 4 + 3], 3);
        x += shell[ball * 4] * weight; y += shell[ball * 4 + 1] * weight; z += shell[ball * 4 + 2] * weight; total += weight;
      }
      if (Math.hypot(x, y, z) / total > 1e-6) wrong.push(kindKey + ': centre of mass is off');
      if (!(prepared.boundsRadius > 0.05 && prepared.boundsRadius < 1) || !(prepared.smallestRadius >= 0.02)) wrong.push(kindKey + ': size');
      d.removeLooseObject(object);
    }
    return { wrong: wrong, counts: counts, kinds: Object.keys(d.looseObjectKinds).length };
  });
  check('every kind of object is described completely, and balances about its own centre', described.wrong.length === 0 && described.kinds >= 6, described);

  // --- falling and coming to rest ---
  const spot = await inGame(() => { window.looseLab.reset(); return window.looseLab.findOpenSpot(); });
  check('Kessel-9 has an open stretch of floor to try things on (4 m clear all round)', spot.room >= 4, spot);

  const drops = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, result = {};
    lab.stand(spot.x - 2.5, spot.z, Math.PI / 2);
    for (const kindKey of Object.keys(d.looseObjectKinds)) {
      d.clearLooseObjects();
      const before = lab.knocks();
      const object = d.createLooseObject(kindKey, spot.x, 1.3, spot.z, 0.4);
      let lowest = 99, asleepAfter = -1, leftTheOpen = false;
      for (let step = 0; step < 150; step++) {
        d.simulate(1 / 30);
        lowest = Math.min(lowest, object.y);
        if (!lab.isInTheOpen(object.x, object.y, object.z)) leftTheOpen = true;
        if (object.isAsleep && asleepAfter < 0) asleepAfter = lab.round((step + 1) / 30);
      }
      result[kindKey] = { restsAt: lab.round(object.y), lowest: lab.round(lowest), asleepAfter: asleepAfter, drifted: lab.round(Math.hypot(object.x - spot.x, object.z - spot.z)),
        leftTheOpen: leftTheOpen, knocks: lab.since(before), reach: lab.round(object.prepared.boundsRadius), smallest: lab.round(object.prepared.smallestRadius) };
    }
    return result;
  }, spot);
  const badDrops = Object.keys(drops).filter((key) => {
    const drop = drops[key];
    return drop.asleepAfter < 0 || drop.asleepAfter > 4 || drop.leftTheOpen || drop.lowest < drop.smallest - 0.02 || drop.restsAt > drop.reach + 0.01 ||
      drop.drifted > 1.2 || drop.knocks.heard < 1 || drop.knocks.heard > 4;
  });
  check('dropped from chest height, every kind lands, stays above the floor, comes to rest within four seconds and is heard one to four times', badDrops.length === 0, drops);
  check('a crate dropped flat lands flat (22 cm from its middle to the floor)', Math.abs(drops.crate.restsAt - 0.22) < 0.012, drops.crate.restsAt);

  const tumble = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab;
    d.clearLooseObjects();
    const runs = [];
    for (let run = 0; run < 2; run++) {
      const object = d.createLooseObject('crate', spot.x, 1.4, spot.z, 0);
      d.setLooseObjectOrientation(object, 0.33, 0.1, 0.22, 0.91); // tipped over two of its edges
      object.spinX = 2; object.velocityX = 1.5;
      for (let step = 0; step < 240 && !object.isAsleep; step++) d.simulate(1 / 30);
      runs.push({ asleep: object.isAsleep, x: object.x, y: object.y, z: object.z, turned: [object.orientationX, object.orientationY, object.orientationZ, object.orientationW] });
      d.removeLooseObject(object);
    }
    return runs;
  }, spot);
  check('a crate thrown down on a corner tumbles and ends up lying on one of its faces',
    tumble[0].asleep && (Math.abs(tumble[0].y - 0.22) < 0.015 || Math.abs(tumble[0].y - 0.25) < 0.015), { y: tumble[0].y });
  check('the same throw twice ends in exactly the same place: nothing in how they move is left to chance',
    JSON.stringify(tumble[0]) === JSON.stringify(tumble[1]), tumble.map((run) => [run.x, run.y, run.z]));

  // --- on a table ---
  const table = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.looseLab;
    d.clearLooseObjects();
    // A flat top between knee and chest height, wide enough to put a tool case on, with nothing standing on it.
    for (const prop of d.worldProps) {
      if (prop.kind !== 0 || prop.isRemoved || prop.isDynamic || prop.halfX < 0.4 || prop.halfZ < 0.4) continue;
      if (prop.maximumY < 0.5 || prop.maximumY > 1.2) continue;
      const isClear = d.worldProps.every((other) => other === prop || other.isRemoved ||
        Math.abs(other.centerX - prop.centerX) > prop.boundsHalfX + other.boundsHalfX || Math.abs(other.centerZ - prop.centerZ) > prop.boundsHalfZ + other.boundsHalfZ ||
        other.maximumY <= prop.maximumY || other.minimumY > prop.maximumY + 0.8);
      if (!isClear) continue;
      const object = d.createLooseObject('toolCase', prop.centerX, prop.maximumY + 0.4, prop.centerZ, 0);
      for (let step = 0; step < 150 && !object.isAsleep; step++) d.simulate(1 / 30);
      return { top: lab.round(prop.maximumY), restsAt: lab.round(object.y), asleep: object.isAsleep, drifted: lab.round(Math.hypot(object.x - prop.centerX, object.z - prop.centerZ)) };
    }
    return null;
  });
  check('a tool case dropped onto a table comes to rest on the table, not on the floor under it',
    table !== null && table.asleep && Math.abs(table.restsAt - table.top - 0.08) < 0.02 && table.drifted < 0.3, table);

  // --- thrown ---
  const thrown = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = {};
    for (const kindKey of ['jar', 'canister', 'pumpMotor']) {
      d.clearLooseObjects();
      const yaw = Math.PI / 2;
      const wall = lab.rockAhead(spot.x, spot.z);
      lab.stand(spot.x, spot.z, yaw);
      const object = lab.carry(kindKey);
      const before = lab.knocks();
      p.pitch = 0.1;
      d.releaseHeldLooseObject(1);
      const speed = Math.hypot(object.velocityX, object.velocityY, object.velocityZ);
      let furthest = 0, leftTheOpen = false;
      for (let step = 0; step < 300 && !object.isAsleep; step++) {
        d.simulate(1 / 60);
        furthest = Math.max(furthest, object.x - spot.x);
        if (!lab.isInTheOpen(object.x, object.y, object.z)) leftTheOpen = true;
      }
      result[kindKey] = { leavesAt: lab.round(speed), wallAt: lab.round(wall), furthest: lab.round(furthest), leftTheOpen: leftTheOpen, asleep: object.isAsleep, knocks: lab.since(before) };
    }
    return result;
  }, spot);
  check('thrown as hard as you can, a jar and a canister reach the far wall and stay in the room; nothing goes through a wall or the floor',
    ['jar', 'canister', 'pumpMotor'].every((key) => !thrown[key].leftTheOpen && thrown[key].asleep && thrown[key].furthest <= thrown[key].wallAt + 0.02 && thrown[key].knocks.heard >= 1) &&
    thrown.jar.furthest > thrown.jar.wallAt - 1 && thrown.canister.furthest > thrown.canister.wallAt - 1, thrown);
  check('a heavy object leaves your hands slower and lands nearer than a light one',
    thrown.pumpMotor.leavesAt < thrown.canister.leavesAt && thrown.canister.leavesAt < thrown.jar.leavesAt && thrown.pumpMotor.furthest < thrown.jar.furthest, thrown);

  // A thrown object is a lure: the noise is where it lands, not where you stand.
  const lure = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player;
    d.clearLooseObjects();
    lab.stand(spot.x - 3, spot.z, Math.PI / 2);
    const object = lab.carry('canister');
    // The Hollow stands seven metres to one side of you, far from where the canister will come down.
    d.spawnHollow(spot.x - 3, spot.z + 7);
    d.hollow.graceTimer = 0; d.hollow.state = 0; d.hollow.hasHeardNoise = false;
    const knockBefore = d.looseState.lastKnock.time;
    p.pitch = 0.25;
    d.releaseHeldLooseObject(1);
    for (let step = 0; step < 240 && d.looseState.lastKnock.time === knockBefore; step++) d.simulate(1 / 60);
    const knock = d.looseState.lastKnock;
    const answer = { landedMetresFromYou: lab.round(Math.hypot(knock.x - p.x, knock.z - p.z)), carries: lab.round(knock.carries),
      hollowMetresFromLanding: lab.round(Math.hypot(knock.x - d.hollow.figure.x, knock.z - d.hollow.figure.z)),
      hollowIsGoingToLook: d.hollow.state === 1, goingToWhereItLanded: Math.hypot(d.hollow.targetX - knock.x, d.hollow.targetZ - knock.z) < 0.5,
      notToYou: Math.hypot(d.hollow.targetX - p.x, d.hollow.targetZ - p.z) > 3 };
    d.hollow.isActive = false;
    return answer;
  }, spot);
  check('a canister thrown across the room is a lure: the Hollow goes to look where it came down, not where you stand',
    lure.landedMetresFromYou > 4 && lure.hollowIsGoingToLook && lure.goingToWhereItLanded && lure.notToYou, lure);

  // --- carrying ---
  const carrying = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = {};
    for (const kindKey of Object.keys(d.looseObjectKinds)) {
      d.clearLooseObjects();
      lab.stand(spot.x - spot.room + 1.2, spot.z, Math.PI / 2);
      const object = lab.carry(kindKey);
      const before = lab.knocks();
      const entry = { atRest: lab.round(lab.gapToHands(object)) };
      d.input.keysDown.add('KeyW');
      d.simulate(0.6); // up to speed
      const fromX = p.x;
      let widest = 0;
      for (let step = 0; step < 30; step++) { d.simulate(1 / 30); widest = Math.max(widest, lab.gapToHands(object)); }
      entry.walking = lab.round(widest);
      entry.speed = lab.round(p.x - fromX);
      entry.wantedSpeed = lab.round(d.tuning.walkSpeed * d.getCarrySpeedFactor());
      d.input.keysDown.add('ShiftLeft');
      d.simulate(0.5);
      entry.canRun = p.isSprinting;
      d.input.keysDown.clear();
      d.simulate(0.5);
      // A quarter turn in a fifth of a second.
      widest = 0;
      for (let step = 0; step < 6; step++) { p.yaw += Math.PI / 12; d.simulate(1 / 30); widest = Math.max(widest, lab.gapToHands(object)); }
      for (let step = 0; step < 20; step++) { d.simulate(1 / 30); widest = Math.max(widest, lab.gapToHands(object)); }
      entry.turning = lab.round(widest);
      entry.stillHeld = d.getHeldLooseObject() === object;
      entry.knocks = lab.since(before);
      entry.hands = object.kind.hands;
      result[kindKey] = entry;
    }
    return result;
  }, spot);
  const badCarry = Object.keys(carrying).filter((key) => {
    const entry = carrying[key];
    return entry.atRest > 0.02 || entry.walking > 0.12 || entry.turning > 0.6 || !entry.stillHeld || entry.knocks.heard + entry.knocks.quiet > 0 ||
      Math.abs(entry.speed - entry.wantedSpeed) > 0.12 || entry.canRun !== (entry.hands === 1);
  });
  check('carried in the open, every kind stays in your hands, walking and through a quick turn, without a knock; it slows you by its weight; two hands cannot run',
    badCarry.length === 0, carrying);
  check('the heavier it is, the further it lags behind a quick turn', carrying.pumpMotor.turning > carrying.jar.turning + 0.1, [carrying.jar.turning, carrying.pumpMotor.turning]);

  // --- in the way of the scanner ---
  const blocking = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = {};
    for (const kindKey of Object.keys(d.looseObjectKinds)) {
      d.clearLooseObjects();
      lab.stand(spot.x, spot.z, Math.PI / 2);
      const object = lab.carry(kindKey);
      const entry = { narrow: lab.coneShare(object, 5), normal: lab.coneShare(object, d.tuning.scannerSpreadDefaultDegrees), wide: lab.coneShare(object, 24) };
      p.pitch = -0.6; d.simulate(0.6);
      entry.lookingDown = lab.coneShare(object, d.tuning.scannerSpreadDefaultDegrees);
      p.pitch = 0.6; d.simulate(0.6);
      entry.lookingUp = lab.coneShare(object, d.tuning.scannerSpreadDefaultDegrees);
      p.pitch = 0; d.simulate(0.4);
      // A real pulse: what does it leave on the object, and how long does that stay?
      d.castScannerRay(object.x - 3, object.y, object.z, 1, 0, 0, 10);
      entry.stopsAPulse = d.rayHit.looseObject === object;
      entry.fadesWhileCarried = d.getLooseObjectPointLifeCode(object) > 0;
      result[kindKey] = entry;
    }
    // Nothing in your hands: nothing in the way.
    d.clearLooseObjects();
    const loose = d.createLooseObject('crate', spot.x + 2, 0.5, spot.z, 0);
    for (let step = 0; step < 120 && !loose.isAsleep; step++) d.simulate(1 / 30);
    result.lyingAhead = { share: lab.coneShare(loose, 24), staysOnceAtRest: d.getLooseObjectPointLifeCode(loose) === 0 };
    return result;
  }, spot);
  check('a crate in your arms takes at least a third of the scanner\'s cone, a jar a small bite of it, a pipe next to nothing',
    blocking.crate.normal >= 0.33 && blocking.crate.normal <= 0.7 && blocking.jar.normal >= 0.05 && blocking.jar.normal <= 0.3 && blocking.pipe.normal <= 0.08 &&
    blocking.pumpMotor.normal >= 0.15 && blocking.toolCase.normal >= 0.08, blocking);
  check('looking down, what you carry comes down with your look and is as much in the way as before; looking up, you see over it',
    blocking.crate.lookingDown >= 0.3 && blocking.crate.lookingUp <= 0.05 && blocking.pumpMotor.lookingUp <= 0.05, [blocking.crate, blocking.pumpMotor]);
  check('a pulse stops on every kind; points on a carried object fade, points on one lying still stay',
    Object.keys(blocking).filter((key) => key !== 'lyingAhead').every((key) => blocking[key].stopsAPulse && blocking[key].fadesWhileCarried) && blocking.lyingAhead.staysOnceAtRest, blocking.lyingAhead);

  // --- knocks ---
  // Carried into a wall at a walk, crouched, and at a run. The Hollow stands four metres off to one side, listening.
  const intoWall = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = {};
    const yaw = Math.PI / 2, wall = lab.distanceAhead(spot.x, spot.z, yaw);
    for (const kindKey of ['canister', 'crate', 'pipe']) {
      for (const pace of ['crouched', 'walking', 'running']) {
        if (pace === 'running' && d.looseObjectKinds[kindKey].hands === 2) continue;
        d.clearLooseObjects();
        lab.stand(spot.x + wall - 2.4, spot.z, yaw);
        const object = lab.carry(kindKey);
        d.spawnHollow(spot.x + wall - 1, spot.z + 4);
        d.hollow.graceTimer = 0; d.hollow.state = 0; d.hollow.hasHeardNoise = false;
        const before = lab.knocks();
        lab.noises.length = 0;
        for (const key of ['ownObjectKnock', 'ownObjectCrash']) d.captionCounts[key] = 0;
        const knockBefore = d.looseState.lastKnock.time;
        d.input.keysDown.add('KeyW');
        if (pace === 'crouched') d.input.keysDown.add('KeyC');
        if (pace === 'running') d.input.keysDown.add('ShiftLeft');
        const startZ = p.z;
        d.simulate(pace === 'crouched' ? 4.5 : 3);
        const lastKnock = d.looseState.lastKnock, wasKnock = lastKnock.time !== knockBefore;
        result[kindKey + ' ' + pace] = {
          knocks: lab.since(before), stillHeld: d.getHeldLooseObject() === object,
          fromWall: lab.round(spot.x + wall - p.x), sideways: lab.round(Math.abs(p.z - startZ)),
          noiseCarries: wasKnock ? lab.round(lastKnock.carries) : 0, knockAtTheWall: wasKnock && Math.abs(lastKnock.x - (spot.x + wall)) < 0.3, yours: wasKnock && lastKnock.isOwn,
          hollowCameToLook: d.hollow.state === 1 && Math.abs(d.hollow.targetX - (spot.x + wall)) < 1.5,
          saidSo: d.captionCounts.ownObjectKnock + d.captionCounts.ownObjectCrash
        };
        d.hollow.isActive = false;
        d.input.keysDown.clear();
      }
    }
    result.hearing = d.game.difficulty.hearingFactor;
    return result;
  }, spot);
  check('walked into a wall, what you carry knocks once, the Hollow four metres off comes to look, and the caption says so',
    ['canister walking', 'crate walking', 'pipe walking'].every((key) => intoWall[key].knocks.heard === 1 && intoWall[key].knocks.quiet <= 1 && intoWall[key].noiseCarries > 4 && intoWall[key].knockAtTheWall && intoWall[key].yours && intoWall[key].hollowCameToLook && intoWall[key].saidSo === 1), intoWall);
  check('crouched, the same walk into the same wall is a tap the Hollow does not hear',
    ['canister crouched', 'crate crouched', 'pipe crouched'].every((key) => intoWall[key].knocks.heard === 0 && intoWall[key].knocks.quiet >= 1 && intoWall[key].knocks.quiet <= 2 && intoWall[key].noiseCarries === 0 && !intoWall[key].hollowCameToLook && intoWall[key].saidSo === 0), intoWall);
  check('a heavy crate carries further than a light canister at the same pace', intoWall['crate walking'].noiseCarries > intoWall['canister walking'].noiseCarries,
    [intoWall['canister walking'].noiseCarries, intoWall['crate walking'].noiseCarries]);
  check('at a walk the object against the wall stops you, and stays in your hands; you are not pushed sideways along the wall',
    ['canister walking', 'crate walking', 'pipe walking', 'crate crouched'].every((key) => intoWall[key].stillHeld && intoWall[key].knocks.pulled === 0 && intoWall[key].sideways < 0.15) &&
    intoWall['pipe walking'].fromWall > 1.0 && intoWall['crate walking'].fromWall > 0.4, intoWall);
  check('run at the wall with a length of pipe and it is torn out of your hands, and clatters',
    !intoWall['pipe running'].stillHeld && intoWall['pipe running'].knocks.pulled === 1 && intoWall['pipe running'].knocks.heard >= 2, intoWall['pipe running']);

  const settingDown = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = {};
    for (const how of ['standing', 'crouched and low']) {
      d.clearLooseObjects();
      lab.stand(spot.x, spot.z, Math.PI / 2);
      if (how !== 'standing') { d.input.keysDown.add('KeyC'); d.simulate(0.8); }
      const object = lab.carry('toolCase');
      if (how !== 'standing') { p.pitch = -1.1; d.simulate(1.2); }
      const before = lab.knocks();
      const height = object.y;
      d.releaseHeldLooseObject(0);
      for (let step = 0; step < 120 && !object.isAsleep; step++) d.simulate(1 / 30);
      result[how] = { fromHeight: lab.round(height), knocks: lab.since(before), asleep: object.isAsleep };
      d.input.keysDown.clear();
    }
    return result;
  }, spot);
  check('let go of standing up, a tool case is heard landing; set down from a crouch, looking at the floor, it is not',
    settingDown.standing.knocks.heard >= 1 && settingDown['crouched and low'].knocks.heard === 0 && settingDown['crouched and low'].asleep, settingDown);

  // --- kicked ---
  const kicked = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = {};
    d.clearLooseObjects();
    lab.stand(spot.x - 2, spot.z, Math.PI / 2);
    const object = d.createLooseObject('canister', spot.x, 0.3, spot.z, 0);
    d.setLooseObjectOrientation(object, 0.7071, 0, 0, 0.7071); // lying on its side
    for (let step = 0; step < 150 && !object.isAsleep; step++) d.simulate(1 / 30);
    result.layStill = object.isAsleep;
    let before = lab.knocks();
    const fromX = object.x;
    d.input.keysDown.add('KeyW');
    d.simulate(1.6);
    d.input.keysDown.clear();
    result.byYou = { moved: lab.round(object.x - fromX), knocks: lab.since(before), saidAsYours: d.captionCounts.ownObjectKnock + d.captionCounts.ownObjectCrash, playerPassed: p.x > fromX };
    for (let step = 0; step < 240 && !object.isAsleep; step++) d.simulate(1 / 30);
    // Now the Hollow walks through it, while you stand well back and have not touched it for a while.
    lab.stand(object.x - 6, object.z, Math.PI / 2);
    d.simulate(4.5);
    for (let step = 0; step < 240 && !object.isAsleep; step++) d.simulate(1 / 30);
    d.spawnHollow(object.x, object.z - 2);
    before = lab.knocks();
    lab.noises.length = 0;
    for (const key of ['objectKnock', 'objectCrash', 'ownObjectKnock', 'ownObjectCrash']) d.captionCounts[key] = 0;
    const startX = object.x, startZ = object.z;
    for (let step = 0; step < 60; step++) { d.hollow.figure.z += 3.2 / 30; d.simulate(1 / 30); }
    result.byTheHollow = { moved: lab.round(Math.hypot(object.x - startX, object.z - startZ)), knocks: lab.since(before),
      noiseAtTheObject: lab.noises.some((noise) => Math.hypot(noise.x - startX, noise.z - startZ) < 1.5),
      saidWithADirection: d.captionCounts.objectKnock + d.captionCounts.objectCrash, saidAsYours: d.captionCounts.ownObjectKnock + d.captionCounts.ownObjectCrash };
    d.hollow.isActive = false;
    return result;
  }, spot);
  check('a canister lying on the floor is kicked along when you walk into it, and does not stop you', kicked.layStill && kicked.byYou.moved > 0.3 && kicked.byYou.playerPassed && kicked.byYou.knocks.heard >= 1 && kicked.byYou.saidAsYours >= 1, kicked.byYou);
  check('the Hollow kicks it too: that is a noise where the canister is, captioned as something out there and not as yours',
    kicked.byTheHollow.moved > 0.3 && kicked.byTheHollow.knocks.heard >= 1 && kicked.byTheHollow.noiseAtTheObject && kicked.byTheHollow.saidWithADirection >= 1 && kicked.byTheHollow.saidAsYours === 0, kicked.byTheHollow);

  // --- a vent ---
  const vent = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = {};
    // A vent mouth: a vent tile with ordinary floor right in front of it, and more vent behind. Kessel-9 has no
    // vents, so this is a generated station: the first of a few that has such a mouth.
    let mouth = null;
    for (let seed = 1; seed <= 12 && !mouth; seed++) {
    d.loadStation('generated', seed, 'medium', 'mixed', 'one');
    d.game.flags.hasLeftLift = true;
    d.setDebugOption('freezeCreatures', true); d.hollow.isActive = false;
    result.seed = seed;
    for (let z = 2; z < 200 && !mouth; z++) {
      for (let x = 2; x < 200 && !mouth; x++) {
        if (!d.isVentAt(x + 0.5, z + 0.5)) continue;
        for (const step of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const outside = d.findWalkableSpotNear(x + 0.5 - step[0], z + 0.5 - step[1]);
          const twoOutside = d.findWalkableSpotNear(x + 0.5 - step[0] * 2, z + 0.5 - step[1] * 2);
          if (!outside || outside.x !== x + 0.5 - step[0] || outside.z !== z + 0.5 - step[1] || d.isVentAt(outside.x, outside.z)) continue;
          if (!twoOutside || twoOutside.x !== x + 0.5 - step[0] * 2 || twoOutside.z !== z + 0.5 - step[1] * 2 || d.isVentAt(twoOutside.x, twoOutside.z)) continue;
          if (!d.isVentAt(x + 0.5 + step[0], z + 0.5 + step[1])) continue;
          if (Math.abs(d.getFloorHeightAt(outside.x, outside.z) - d.getFloorHeightAt(x + 0.5, z + 0.5)) > 0.05) continue;
          mouth = { x: x + 0.5, z: z + 0.5, stepX: step[0], stepZ: step[1] };
          break;
        }
      }
    }
    }
    if (!mouth) return null;
    result.mouth = mouth;
    for (const kindKey of ['jar', 'crate']) {
      d.clearLooseObjects();
      lab.stand(mouth.x - mouth.stepX * 1.6, mouth.z - mouth.stepZ * 1.6, Math.atan2(mouth.stepX, -mouth.stepZ));
      d.input.keysDown.add('KeyC');
      d.simulate(0.8);
      const object = lab.carry(kindKey);
      const before = lab.knocks();
      d.input.keysDown.add('KeyW');
      let objectInVent = false;
      for (let step = 0; step < 150; step++) { d.simulate(1 / 30); if (d.isVentAt(object.x, object.z)) objectInVent = true; }
      result[kindKey] = { playerInVent: d.isVentAt(p.x, p.z), objectInVent: objectInVent, stillHeld: d.getHeldLooseObject() === object, knocks: lab.since(before), messages: lab.messages() };
      d.input.keysDown.clear();
    }
    return result;
  });
  check('a jar goes into a vent with you; with a crate in both arms you cannot crawl in, and are told why',
    vent !== null && vent.jar.playerInVent && vent.jar.objectInVent && vent.jar.stillHeld && !vent.crate.playerInVent && vent.crate.stillHeld &&
    vent.crate.messages.some((text) => /cannot crawl with the crate/.test(text)), vent);

  // --- the pit, and a new descent ---
  const housekeeping = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, result = {};
    d.clearLooseObjects();
    let pit = null;
    for (let z = 2; z < 200 && !pit; z++) for (let x = 2; x < 200 && !pit; x++) if (d.getTileFlagsAt(x + 0.5, z + 0.5) & d.tileFlagPit) pit = { x: x + 0.5, z: z + 0.5 };
    if (pit) {
      const lostBefore = d.looseState.statistics.lostDownThePit;
      const object = d.createLooseObject('jar', pit.x, 0.5, pit.z, 0);
      const fromY = object.y;
      for (let step = 0; step < 400 && d.looseObjects.length > 0; step++) d.simulate(1 / 30);
      result.pit = { there: true, fellFrom: fromY, gone: d.looseObjects.length === 0, counted: d.looseState.statistics.lostDownThePit - lostBefore };
    } else {
      result.pit = { there: false };
    }
    lab.stand(spot.x, spot.z, 0);
    lab.carry('canister');
    d.createLooseObject('crate', spot.x + 1, 0.5, spot.z, 0);
    result.before = { loose: d.looseObjects.length, carrying: d.getHeldLooseObject() !== null };
    d.loadStation('classic', 0);
    result.after = { loose: d.looseObjects.length, carrying: d.getHeldLooseObject() !== null, speedFactor: d.getCarrySpeedFactor() };
    return result;
  }, spot);
  check('something dropped down the shaft is gone for good', housekeeping.pit.there ? housekeeping.pit.gone && housekeeping.pit.counted === 1 : true, housekeeping.pit);
  check('a new descent starts with nothing loose and nothing in your hands',
    housekeeping.before.loose === 2 && housekeeping.before.carrying && housekeeping.after.loose === 0 && !housekeeping.after.carrying && housekeeping.after.speedFactor === 1, housekeeping);

  // --- what it costs ---
  const cost = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab;
    lab.reset();
    lab.stand(spot.x - 3, spot.z, Math.PI / 2);
    const kinds = Object.keys(d.looseObjectKinds);
    // Without anything loose, for comparison.
    let started = performance.now();
    d.simulate(2);
    const plain = performance.now() - started;
    for (let index = 0; index < 12; index++) {
      const object = d.createLooseObject(kinds[index % kinds.length], spot.x + (index % 4) * 0.7 - 1, 1 + Math.floor(index / 4) * 0.7, spot.z + (index % 3) * 0.7 - 0.7, index);
      object.spinX = 3; object.velocityZ = (index % 2 ? 1 : -1) * 2;
    }
    started = performance.now();
    d.simulate(2);
    const tumbling = performance.now() - started;
    for (let step = 0; step < 300; step++) d.simulate(1 / 30);
    const atRest = d.looseObjects.filter((object) => object.isAsleep).length;
    started = performance.now();
    d.simulate(2);
    const resting = performance.now() - started;
    const allInTheOpen = d.looseObjects.every((object) => lab.isInTheOpen(object.x, object.y, object.z));
    return { millisecondsPerSecondOfPlay: { nothingLoose: Math.round(plain / 2), twelveTumbling: Math.round(tumbling / 2), twelveAtRest: Math.round(resting / 2) }, atRest: atRest, of: d.looseObjects.length, allInTheOpen: allInTheOpen };
  }, spot);
  check('twelve objects thrown in a heap all come to rest inside the room', cost.atRest === cost.of && cost.allInTheOpen, cost);
  check('twelve tumbling at once cost less than a fifth of the time there is (200 ms of work per second of play), and at rest they cost nothing to speak of',
    cost.millisecondsPerSecondOfPlay.twelveTumbling - cost.millisecondsPerSecondOfPlay.nothingLoose < 200 &&
    cost.millisecondsPerSecondOfPlay.twelveAtRest - cost.millisecondsPerSecondOfPlay.nothingLoose < 25, cost.millisecondsPerSecondOfPlay);

  // --- the keys ---
  await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab;
    lab.reset();
    lab.stand(spot.x, spot.z, Math.PI / 2);
    const object = d.createLooseObject('canister', spot.x + 1, 0.3, spot.z, 0);
    for (let step = 0; step < 150 && !object.isAsleep; step++) d.simulate(1 / 30);
    d.player.pitch = Math.atan2(object.y - d.getPlayerEyeY(), 1); // look at it
    d.simulate(0.1);
  }, spot);
  await drawFrames(page, 3);
  const beforePickUp = await inGame(() => ({ prompt: document.getElementById('hud-prompt').textContent, promptHidden: document.getElementById('hud-prompt').hidden,
    chipHidden: document.getElementById('chip-carrying').hidden }));
  await page.keyboard.press('KeyE');
  await inGame(() => window.lastReturnDebug.simulate(0.5));
  await drawFrames(page, 8);
  const afterPickUp = await inGame(() => ({ carrying: window.lastReturnDebug.getHeldLooseObject() !== null, chip: document.getElementById('chip-carrying').textContent,
    chipHidden: document.getElementById('chip-carrying').hidden, messages: window.looseLab.messages() }));
  check('looking at an object within reach offers to pick it up, and E does', !beforePickUp.promptHidden && /Pick up the gas canister/.test(beforePickUp.prompt) && beforePickUp.chipHidden && afterPickUp.carrying, [beforePickUp, afterPickUp.carrying]);
  check('the screen says what you carry, and the first time, which key lets go of it',
    !afterPickUp.chipHidden && afterPickUp.chip === 'CARRYING: GAS CANISTER' && afterPickUp.messages.some((text) => /Q lets go/.test(text)), afterPickUp);

  // (A short hold: the browser may draw a frame of its own while the key is down, and that counts as time held too.)
  await page.keyboard.down('KeyQ');
  await inGame(() => window.lastReturnDebug.simulate(0.02));
  await page.keyboard.up('KeyQ');
  const tapped = await inGame(() => {
    const d = window.lastReturnDebug;
    d.simulate(0.05);
    const object = d.looseObjects[0];
    return { carrying: d.getHeldLooseObject() !== null, speed: Math.hypot(object.velocityX, object.velocityZ) };
  });
  check('a tap on Q lets go of it: it drops, it is not thrown', !tapped.carrying && tapped.speed < 0.5, tapped);

  await inGame(() => { const d = window.lastReturnDebug; d.player.pitch = 0.15; d.pickUpLooseObject(d.looseObjects[0]); d.simulate(0.6); });
  await page.keyboard.down('KeyQ');
  await inGame(() => window.lastReturnDebug.simulate(0.6));
  await drawFrames(page, 3);
  const windingUp = await inGame(() => ({ windUp: window.lastReturnDebug.getThrowWindUp(), prompt: document.getElementById('hud-prompt').textContent, stillCarrying: window.lastReturnDebug.getHeldLooseObject() !== null }));
  await page.keyboard.up('KeyQ');
  const thrownByKey = await inGame(() => {
    const d = window.lastReturnDebug;
    d.simulate(0.03);
    const object = d.looseObjects[0];
    return { carrying: d.getHeldLooseObject() !== null, speed: Math.hypot(object.velocityX, object.velocityY, object.velocityZ) };
  });
  check('holding Q winds up a throw, with a bar on screen that fills; letting go throws it', windingUp.stillCarrying && windingUp.windUp > 0.5 && /THROW/.test(windingUp.prompt) && !thrownByKey.carrying && thrownByKey.speed > 3, [windingUp, thrownByKey]);

  const handsFull = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab;
    d.clearLooseObjects();
    lab.stand(spot.x, spot.z, Math.PI / 2);
    lab.carry('jar');
    const other = d.createLooseObject('toolCase', spot.x + 1.1, 0.2, spot.z, 0);
    for (let step = 0; step < 150 && !other.isAsleep; step++) d.simulate(1 / 30);
    d.player.pitch = Math.atan2(other.y - d.getPlayerEyeY(), 1.1);
    d.simulate(0.1);
    return { lookingAtIt: d.player.focusedLooseObject === other };
  }, spot);
  await page.keyboard.press('KeyE');
  await inGame(() => window.lastReturnDebug.simulate(0.2));
  await drawFrames(page, 3);
  const handsFullAfter = await inGame(() => ({ carrying: window.lastReturnDebug.getHeldLooseObject().kindKey, messages: window.looseLab.messages() }));
  check('with something in your hands already, E on another object says your hands are full', handsFull.lookingAtIt && handsFullAfter.carrying === 'jar' && handsFullAfter.messages.some((text) => /hands are full/.test(text)), handsFullAfter);

  check('no script errors were reported', problems.length === 0, problems);
  await browser.close();

  // --- on a phone ---
  const phone = await openGame({ dev: true, width: 844, height: 390, isPhone: true });
  await startGame(phone.page, true);
  await phone.page.evaluate(installLab);
  const phoneBefore = await phone.page.evaluate(() => {
    const d = window.lastReturnDebug, lab = window.looseLab;
    lab.reset();
    return { dropHidden: document.getElementById('touch-drop').hidden };
  });
  await phone.page.evaluate(() => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player;
    lab.stand(p.x, p.z, p.yaw);
    lab.carry('canister');
  });
  await drawFrames(phone.page, 8);
  const phoneCarrying = await phone.page.evaluate(() => {
    const button = document.getElementById('touch-drop'), box = button.getBoundingClientRect();
    const overlaps = ['touch-use', 'touch-sweep', 'touch-scan', 'touch-crouch', 'touch-run', 'touch-spread', 'touch-map', 'touch-pause', 'hud-block-instruments', 'hud-block-map', 'hud-block-objective', 'hud-messages', 'reticle-ring'].filter((id) => {
      const other = document.getElementById(id).getBoundingClientRect();
      return !(other.right <= box.left || other.left >= box.right || other.bottom <= box.top || other.top >= box.bottom);
    });
    return { dropHidden: button.hidden, box: [Math.round(box.left), Math.round(box.top), Math.round(box.right), Math.round(box.bottom)], overlaps: overlaps,
      onScreen: box.left >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight, messages: window.looseLab.messages() };
  });
  check('on a phone the DROP button is only there while you carry something, on screen and clear of the other buttons, the map, the messages and the aiming ring',
    phoneBefore.dropHidden && !phoneCarrying.dropHidden && phoneCarrying.onScreen && phoneCarrying.overlaps.length === 0, phoneCarrying);
  check('and the hint names the button, not a key', phoneCarrying.messages.some((text) => /DROP lets go/.test(text)), phoneCarrying.messages);
  await phone.page.tap('#touch-drop');
  const phoneDropped = await phone.page.evaluate(() => { const d = window.lastReturnDebug; d.simulate(0.1); return { carrying: d.getHeldLooseObject() !== null }; });
  check('a tap on DROP lets go of it', !phoneDropped.carrying, phoneDropped);
  check('no script errors were reported on the phone', phone.problems.length === 0, phone.problems);
  await phone.browser.close();

  console.log(failures.length ? '\n' + failures.length + ' check(s) failed.' : '\nAll checks passed.');
  process.exit(failures.length ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
