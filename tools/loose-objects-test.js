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
    // The roomiest spot in the station: the place on plain level floor that is furthest from every wall, from
    // everything that stands or hangs lower than 2.2 m, and from any floor that is not plain (the pit, water,
    // a grate, something noisy to step on). `room` is that distance, in metres.
    findOpenSpot: function () {
      const props = d.worldProps.filter((prop) => !prop.isRemoved && prop.minimumY < 2.2 && prop.maximumY > 0.02);
      let best = null, bestRoom = 0;
      for (let z = 2; z < 200; z++) {
        for (let x = 2; x < 200; x++) {
          const centreX = x + 0.5, centreZ = z + 0.5;
          const spot = d.findWalkableSpotNear(centreX, centreZ);
          if (!spot || spot.x !== centreX || spot.z !== centreZ || d.isVentAt(centreX, centreZ)) continue;
          if (Math.abs(d.getFloorHeightAt(centreX, centreZ)) > 0.01 || d.getTileFlagsAt(centreX, centreZ) !== 0) continue;
          let room = 9;
          // Rock, steps and vents, tile by tile.
          for (let tileZ = z - 9; tileZ <= z + 9 && room > bestRoom; tileZ++) {
            for (let tileX = x - 9; tileX <= x + 9; tileX++) {
              if (d.isSpaceOpenAt(tileX + 0.5, 1.5, tileZ + 0.5) && Math.abs(d.getFloorHeightAt(tileX + 0.5, tileZ + 0.5)) < 0.01 && d.getTileFlagsAt(tileX + 0.5, tileZ + 0.5) === 0) continue;
              const nearX = Math.max(tileX, Math.min(centreX, tileX + 1)), nearZ = Math.max(tileZ, Math.min(centreZ, tileZ + 1));
              room = Math.min(room, Math.hypot(nearX - centreX, nearZ - centreZ));
            }
          }
          if (room <= bestRoom) continue;
          for (const prop of props) {
            const awayX = Math.max(0, Math.abs(prop.centerX - centreX) - prop.boundsHalfX), awayZ = Math.max(0, Math.abs(prop.centerZ - centreZ) - prop.boundsHalfZ);
            room = Math.min(room, Math.hypot(awayX, awayZ));
            if (room <= bestRoom) break;
          }
          if (room > bestRoom) { bestRoom = room; best = { x: centreX, z: centreZ }; }
        }
      }
      best.room = bestRoom;
      return best;
    },
    // A bare wall to walk into: a stretch of rock with nothing standing against it, no door near it, and a clear
    // run of two and a half metres or more straight up to it, wider than anything you can carry.
    findBareWall: function () {
      for (let z = 2; z < 200; z++) {
        for (let x = 2; x < 200; x++) {
          const here = d.findWalkableSpotNear(x + 0.5, z + 0.5);
          if (!here || here.x !== x + 0.5 || here.z !== z + 0.5 || d.isVentAt(x + 0.5, z + 0.5) || Math.abs(d.getFloorHeightAt(x + 0.5, z + 0.5)) > 0.01) continue;
          for (const step of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            // How far the rock is, straight ahead from this tile.
            let rock = 0;
            while (rock < 12 && d.isSpaceOpenAt(x + 0.5 + step[0] * rock, 1, z + 0.5 + step[1] * rock)) rock += 0.05;
            if (rock < 3.2 || rock >= 12) continue;
            let isBare = true;
            for (const across of [-0.7, -0.35, 0, 0.35, 0.7]) {
              for (const height of [0.15, 0.6, 1.0, 1.4, 1.7]) {
                const fromX = x + 0.5 - step[1] * across, fromZ = z + 0.5 + step[0] * across;
                const isHit = d.castScannerRay(fromX, height, fromZ, step[0], 0, step[1], 20);
                if (!isHit || Math.abs(d.rayHit.distance - rock) > 0.08) isBare = false;
              }
            }
            if (!isBare) continue;
            const wallX = x + 0.5 + step[0] * rock, wallZ = z + 0.5 + step[1] * rock;
            if (d.doors.some((door) => Math.hypot(door.centerX - wallX, door.centerZ - wallZ) < 4 || Math.hypot(door.centerX - (x + 0.5), door.centerZ - (z + 0.5)) < 4)) continue;
            return { x: x + 0.5, z: z + 0.5, stepX: step[0], stepZ: step[1], wall: rock, yaw: Math.atan2(step[0], -step[1]) };
          }
        }
      }
      return null;
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
      d.simulate(1.6);
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
      d.updateScanEmitterAtLens(p.x, eyeY, p.z);
      const emitter = d.scanEmitter;
      let stopped = 0;
      for (let pulse = 0; pulse < pulses; pulse++) {
        const radius = Math.pow((pulse + 0.5) / pulses, 0.62) * tangent, angle = pulse * 2.399963;
        const across = Math.cos(angle) * radius, up = Math.sin(angle) * radius;
        const direction = d.computeScannerPulseDirection(across, up);
        if (d.castScannerRay(emitter.x, emitter.y, emitter.z, direction.x, direction.y, direction.z, 30) && d.rayHit.looseObject === object) stopped++;
      }
      return round(stopped / pulses);
    },
    // Counts the scan points inside a box that will stay (not fading, not removed): those on the floor and walls,
    // and those on things that can be picked up.
    countPoints: function (x, y, z, reach) {
      const floats = d.pointCloud.floatView, bytes = d.pointCloud.byteView, counts = { station: 0, onObjects: 0, fading: 0 };
      for (let index = 0; index < d.pointCloud.storedCount; index++) {
        const px = floats[index * 5], py = floats[index * 5 + 1], pz = floats[index * 5 + 2];
        if (Math.abs(px - x) > reach || Math.abs(py - y) > reach || Math.abs(pz - z) > reach) continue;
        if (floats[index * 5 + 3] < -1e8) continue; // removed
        const surfaceClass = bytes[index * 20 + 17], lifeCode = bytes[index * 20 + 18];
        if (lifeCode !== 0) counts.fading++;
        else if (surfaceClass === 7) counts.onObjects++;
        else counts.station++;
      }
      return counts;
    },
    // Stands two metres from an object, looks at it, and scans it and the floor around it for a second and a half.
    scan: function (object) {
      lab.stand(object.x - 2, object.z, Math.PI / 2);
      p.pitch = Math.atan2(object.y - d.getPlayerEyeY(), 2);
      d.setDebugOption('unlimitedScanner', true);
      d.setScannerSpread(24);
      d.setScanHeld(true);
      d.simulate(1.5);
      d.setScanHeld(false);
      d.setScannerSpread(d.tuning.scannerSpreadDefaultDegrees);
      d.simulate(0.1);
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
      if (!kind.label || !(kind.mass > 0) || ['metal', 'glass', 'case'].indexOf(kind.material) < 0 || typeof kind.bulky !== 'boolean' ||
          !(kind.bounce >= 0 && kind.bounce < 1) || !(kind.grip >= 0 && kind.grip <= 1) || !kind.parts || kind.parts.length === 0) wrong.push(kindKey + ': incomplete');
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
  check('Kessel-9 has an open stretch of floor to try things on (3 m clear of everything, all round)', spot.room >= 3, spot);

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
    table !== null && table.asleep && Math.abs(table.restsAt - table.top - 0.15) < 0.02 && table.drifted < 0.3, table);

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
      for (let step = 0; step < 720 && !object.isAsleep; step++) {
        d.simulate(1 / 60);
        furthest = Math.max(furthest, object.x - spot.x);
        if (!lab.isInTheOpen(object.x, object.y, object.z)) leftTheOpen = true;
      }
      result[kindKey] = { leavesAt: lab.round(speed), wallAt: lab.round(wall), furthest: lab.round(furthest), leftTheOpen: leftTheOpen, asleep: object.isAsleep, knocks: lab.since(before) };
    }
    return result;
  }, spot);
  check('thrown as hard as you can, a jar reaches the far wall and a canister goes metres; nothing goes through a wall or the floor',
    ['jar', 'canister', 'pumpMotor'].every((key) => !thrown[key].leftTheOpen && thrown[key].asleep && thrown[key].furthest <= thrown[key].wallAt + 0.02 && thrown[key].knocks.heard >= 1) &&
    thrown.jar.furthest > thrown.jar.wallAt - 1.2 && thrown.canister.furthest > 3, thrown);
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
      entry.knocksWalking = lab.since(before);
      // A quarter turn in a fifth of a second. (What it swings into on the way round is the room's business.)
      widest = 0;
      for (let step = 0; step < 6; step++) { p.yaw += Math.PI / 12; d.simulate(1 / 30); widest = Math.max(widest, lab.gapToHands(object)); }
      for (let step = 0; step < 20; step++) { d.simulate(1 / 30); widest = Math.max(widest, lab.gapToHands(object)); }
      entry.turning = lab.round(widest);
      entry.stillHeld = d.getHeldLooseObject() === object;
      entry.knocks = lab.since(before);
      entry.bulky = object.kind.bulky;
      result[kindKey] = entry;
    }
    return result;
  }, spot);
  const badCarry = Object.keys(carrying).filter((key) => {
    const entry = carrying[key];
    return entry.atRest > 0.03 || entry.walking > 0.35 || !entry.stillHeld || entry.knocksWalking.heard + entry.knocksWalking.quiet > 0 ||
      Math.abs(entry.speed - entry.wantedSpeed) > 0.12 || entry.canRun !== !entry.bulky;
  });
  check('carried in the open, every kind stays in the beam, walking without a knock and through a quick turn; it slows you by its weight; you cannot run with a bulky one',
    badCarry.length === 0, carrying);
  check('it swings wide behind a quick turn, and the heavier it is the wider', carrying.jar.turning > 0.3 && carrying.pumpMotor.turning > carrying.jar.turning + 0.1, [carrying.jar.turning, carrying.pumpMotor.turning]);

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
      entry.fadesWhileCarried = d.getLooseObjectPointLifeCode(object) > 0;
      // Out of your hands it is an object like any other: a pulse that meets it stops on it.
      d.releaseHeldLooseObject(0);
      d.castScannerRay(object.x - 3, object.y, object.z, 1, 0, 0, 10);
      entry.stopsAPulseOutOfYourHands = d.rayHit.looseObject === object;
      result[kindKey] = entry;
    }
    // Nothing in your hands: nothing in the way.
    d.clearLooseObjects();
    const loose = d.createLooseObject('crate', spot.x + 2, 0.5, spot.z, 0);
    for (let step = 0; step < 120 && !loose.isAsleep; step++) d.simulate(1 / 30);
    result.lyingAhead = { share: lab.coneShare(loose, 24), staysOnceAtRest: d.getLooseObjectPointLifeCode(loose) === 0 };
    return result;
  }, spot);
  const kindsCarried = Object.keys(blocking).filter((key) => key !== 'lyingAhead');
  check('what the beam holds hangs straight out from the scanner and is in its way: a crate takes nearly all of the normal beam, a jar or a pipe a part of it',
    blocking.crate.normal >= 0.85 && blocking.pumpMotor.normal >= 0.5 && blocking.toolCase.normal >= 0.5 &&
    blocking.jar.normal >= 0.1 && blocking.jar.normal <= 0.6 && blocking.pipe.normal >= 0.05 && blocking.pipe.normal <= 0.4 &&
    kindsCarried.every((key) => blocking[key].normal > 0 && blocking[key].lookingDown > 0 && blocking[key].lookingUp > 0), blocking);
  check('a pulse that meets a carried object stops on it', kindsCarried.every((key) => blocking[key].narrow > 0 || blocking[key].normal > 0), kindsCarried);
  check('the wide beam sees round it, and the narrow beam least of all: every kind takes a smaller share of the wide beam than of the normal one',
    kindsCarried.every((key) => blocking[key].wide < blocking[key].normal && blocking[key].narrow >= blocking[key].normal) && blocking.crate.wide < 0.8, blocking);
  check('points on a carried object fade, points on one lying still stay, and any of them out of your hands stops a pulse that meets it',
    Object.keys(blocking).filter((key) => key !== 'lyingAhead').every((key) => blocking[key].stopsAPulseOutOfYourHands && blocking[key].fadesWhileCarried) && blocking.lyingAhead.staysOnceAtRest, blocking.lyingAhead);

  // --- where the scanner's light comes from ---
  const bareWallForScanner = await inGame(() => { window.looseLab.reset(); return window.looseLab.findBareWall(); });
  const zeroed = await inGame((bare) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = { offBy: [], sideways: [] };
    d.clearLooseObjects();
    const cast = function (fromEye, across, up) {
      const eyeY = d.getPlayerEyeY();
      d.computeScannerBasis(p.yaw, p.pitch);
      if (fromEye) d.updateScanEmitterAtEye(p.x, eyeY, p.z); else d.updateScanEmitterAtLens(p.x, eyeY, p.z);
      const direction = d.computeScannerPulseDirection(across, up), emitter = d.scanEmitter;
      const isHit = d.castScannerRay(emitter.x, emitter.y, emitter.z, direction.x, direction.y, direction.z, 40);
      return isHit ? { x: d.rayHit.x, y: d.rayHit.y, z: d.rayHit.z } : null;
    };
    // Three metres from a bare wall, square to it: every pulse lands where the eye sees its place in the ring.
    lab.stand(bare.x + bare.stepX * (bare.wall - 3), bare.z + bare.stepZ * (bare.wall - 3), bare.yaw);
    for (const offset of [[0, 0], [0.19, 0], [-0.19, 0], [0, 0.19], [0, -0.19], [0.1, -0.12]]) {
      const seen = cast(true, offset[0], offset[1]), lit = cast(false, offset[0], offset[1]);
      result.offBy.push(seen && lit ? Math.hypot(seen.x - lit.x, seen.y - lit.y, seen.z - lit.z) : 99);
    }
    const emitter = d.scanEmitter, eyeY = d.getPlayerEyeY();
    result.lensFromTheEye = lab.round(Math.hypot(emitter.x - p.x, emitter.y - eyeY, emitter.z - p.z));
    result.lensBelowTheEye = lab.round(eyeY - emitter.y);
    // With your face against the wall the scanner would be inside it. It is held back, and still paints.
    lab.stand(bare.x + bare.stepX * (bare.wall - 0.32), bare.z + bare.stepZ * (bare.wall - 0.32), bare.yaw);
    d.computeScannerBasis(p.yaw, p.pitch);
    d.updateScanEmitterAtLens(p.x, d.getPlayerEyeY(), p.z);
    result.atTheWall = { emitterInTheOpen: d.isSpaceOpenAt(d.scanEmitter.x, d.scanEmitter.y, d.scanEmitter.z),
      fromTheWall: lab.round(bare.wall - ((d.scanEmitter.x - bare.x) * bare.stepX + (d.scanEmitter.z - bare.z) * bare.stepZ)),
      paints: [cast(false, 0, 0), cast(false, 0.15, 0.1), cast(false, -0.15, -0.1)].every((hit) => hit !== null) };
    // Anything can fire a pulse from anywhere: one from the middle of the room, straight down, lands on the floor under it.
    const before = d.pointCloud.totalReturns;
    const landed = d.fireScanPulse(bare.x, 1.2, bare.z, 0, -1, 0, false);
    result.fromAnywhere = { landed: landed, onTheFloor: landed && Math.abs(d.rayHit.y) < 0.01 && Math.abs(d.rayHit.x - bare.x) < 0.001, pointsAdded: d.pointCloud.totalReturns - before };
    return result;
  }, bareWallForScanner);
  check('the scanner\'s pulses leave its lens, a forearm from your eyes, and land where you see the aiming ring on the wall you are looking at',
    zeroed.lensFromTheEye > 0.5 && zeroed.lensBelowTheEye > 0.1 && zeroed.offBy.every((metres) => metres < 0.01), zeroed);
  check('with your face against a wall the scanner is held back out of it, and still paints', zeroed.atTheWall.emitterInTheOpen && zeroed.atTheWall.fromTheWall > 0.05 && zeroed.atTheWall.paints, zeroed.atTheWall);
  check('a pulse can be fired from anywhere, not only from the scanner: one fired straight down in mid-room leaves a point on the floor under it',
    zeroed.fromAnywhere.landed && zeroed.fromAnywhere.onTheFloor && zeroed.fromAnywhere.pointsAdded === 1, zeroed.fromAnywhere);

  // --- knocks ---
  const bareWall = await inGame(() => { window.looseLab.reset(); return window.looseLab.findBareWall(); });
  check('Kessel-9 has a bare wall with a clear run up to it and no door near', bareWall !== null, bareWall);
  // Carried into that wall at a walk, crouched, and at a run. The Hollow stands four metres off to one side, listening.
  const intoWall = await inGame((bare) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = {};
    const wallX = bare.x + bare.stepX * bare.wall, wallZ = bare.z + bare.stepZ * bare.wall;
    for (const kindKey of ['canister', 'crate', 'pipe']) {
      for (const pace of ['crouched', 'walking', 'running']) {
        if (pace === 'running' && d.looseObjectKinds[kindKey].bulky) continue;
        d.clearLooseObjects();
        const startX = bare.x + bare.stepX * (bare.wall - 2.9), startZ = bare.z + bare.stepZ * (bare.wall - 2.9);
        lab.stand(startX, startZ, bare.yaw);
        const object = lab.carry(kindKey);
        // A metre back from the wall and four metres to one side. (It is held still, so it may stand anywhere.)
        d.spawnHollow(wallX - bare.stepX - bare.stepZ * 4, wallZ - bare.stepZ + bare.stepX * 4);
        d.hollow.graceTimer = 0; d.hollow.state = 0; d.hollow.hasHeardNoise = false;
        const before = lab.knocks();
        for (const key of ['ownObjectKnock', 'ownObjectCrash']) d.captionCounts[key] = 0;
        const knockBefore = d.looseState.lastKnock.time;
        d.input.keysDown.add('KeyW');
        if (pace === 'crouched') d.input.keysDown.add('KeyC');
        if (pace === 'running') d.input.keysDown.add('ShiftLeft');
        d.simulate(pace === 'crouched' ? 5 : 3.5);
        const lastKnock = d.looseState.lastKnock, wasKnock = lastKnock.time !== knockBefore;
        const along = (p.x - bare.x) * bare.stepX + (p.z - bare.z) * bare.stepZ;
        result[kindKey + ' ' + pace] = {
          knocks: lab.since(before), stillHeld: d.getHeldLooseObject() === object,
          fromWall: lab.round(bare.wall - along), sideways: lab.round(Math.abs((p.x - startX) * bare.stepZ - (p.z - startZ) * bare.stepX)),
          noiseCarries: wasKnock ? lab.round(lastKnock.carries) : 0,
          knockAtTheWall: wasKnock && Math.abs((lastKnock.x - wallX) * bare.stepX + (lastKnock.z - wallZ) * bare.stepZ) < 0.3, yours: wasKnock && lastKnock.isOwn,
          hollowCameToLook: d.hollow.state === 1 && Math.hypot(d.hollow.targetX - wallX, d.hollow.targetZ - wallZ) < 1.5,
          saidSo: d.captionCounts.ownObjectKnock + d.captionCounts.ownObjectCrash
        };
        d.hollow.isActive = false;
        d.input.keysDown.clear();
      }
    }
    result.hearing = d.game.difficulty.hearingFactor;
    return result;
  }, bareWall);
  check('walked into a wall, what you carry knocks once, the Hollow four metres off comes to look, and the caption says so',
    ['canister walking', 'crate walking', 'pipe walking'].every((key) => intoWall[key].knocks.heard === 1 && intoWall[key].knocks.quiet <= 1 && intoWall[key].noiseCarries > 4 && intoWall[key].knockAtTheWall && intoWall[key].yours && intoWall[key].hollowCameToLook && intoWall[key].saidSo === 1), intoWall);
  check('crouched, the same walk into the same wall is a tap the Hollow does not hear',
    ['canister crouched', 'crate crouched', 'pipe crouched'].every((key) => intoWall[key].knocks.heard === 0 && intoWall[key].knocks.quiet >= 1 && intoWall[key].knocks.quiet <= 2 && intoWall[key].noiseCarries === 0 && !intoWall[key].hollowCameToLook && intoWall[key].saidSo === 0), intoWall);
  check('a heavy crate carries further than a light canister at the same pace', intoWall['crate walking'].noiseCarries > intoWall['canister walking'].noiseCarries,
    [intoWall['canister walking'].noiseCarries, intoWall['crate walking'].noiseCarries]);
  check('at a walk the object against the wall stops you, and stays in your hands; you are not pushed sideways along the wall',
    ['canister walking', 'crate walking', 'pipe walking', 'crate crouched'].every((key) => intoWall[key].stillHeld && intoWall[key].knocks.pulled === 0 && intoWall[key].sideways < 0.15) &&
    intoWall['pipe walking'].fromWall > 1.0 && intoWall['crate walking'].fromWall > 0.7, intoWall);
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

  // --- its points, and the floor's ---
  const pointsKept = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = {};
    lab.reset();
    d.clearLooseObjects();
    const object = d.createLooseObject('crate', spot.x, 0.4, spot.z, 0.3);
    for (let step = 0; step < 150 && !object.isAsleep; step++) d.simulate(1 / 30);
    lab.scan(object);
    const reach = object.prepared.partsRadius + 0.3;
    result.scannedAtRest = lab.countPoints(object.x, object.y, object.z, reach);
    const wasAt = { x: object.x, y: object.y, z: object.z };
    // Picked up and carried off: its points go, the floor's stay.
    lab.stand(object.x - 1.6, object.z, Math.PI / 2);
    d.pickUpLooseObject(object);
    p.pitch = 0.9; // up and away from where it lay
    d.simulate(2);
    result.carriedOff = lab.countPoints(wasAt.x, wasAt.y, wasAt.z, reach);
    // In the beam and scanned: the points on it are the kind that fade.
    p.pitch = 0;
    d.simulate(1);
    d.setScanHeld(true); d.simulate(0.4); d.setScanHeld(false);
    result.inTheBeam = lab.countPoints(object.x, object.y, object.z, object.prepared.partsRadius + 0.1);
    // Set down, scanned where it lies, and then taken out of the world: its points go with it.
    d.releaseHeldLooseObject(0);
    for (let step = 0; step < 150 && !object.isAsleep; step++) d.simulate(1 / 30);
    lab.scan(object);
    const liesAt = { x: object.x, y: object.y, z: object.z };
    result.scannedAgain = lab.countPoints(liesAt.x, liesAt.y, liesAt.z, reach);
    const button = document.getElementById('debug-loose-clear');
    result.usedTheDebugButton = Boolean(button);
    if (button) button.click(); else d.removeLooseObject(object);
    result.removed = { loose: d.looseObjects.length, points: lab.countPoints(liesAt.x, liesAt.y, liesAt.z, reach) };
    return result;
  }, spot);
  check('an object scanned where it lies keeps the points; picked up, they are let go and the floor it stood on keeps every one of its own',
    pointsKept.scannedAtRest.onObjects > 50 && pointsKept.scannedAtRest.station > 50 && pointsKept.carriedOff.onObjects === 0 && pointsKept.carriedOff.station === pointsKept.scannedAtRest.station,
    [pointsKept.scannedAtRest, pointsKept.carriedOff]);
  check('points scanned onto an object in the beam are of the kind that fade', pointsKept.inTheBeam.fading > 20 && pointsKept.inTheBeam.onObjects === 0, pointsKept.inTheBeam);
  check('"Remove them all" in debug mode takes each object\'s points with it, and leaves the floor\'s',
    pointsKept.usedTheDebugButton && pointsKept.scannedAgain.onObjects > 50 && pointsKept.removed.loose === 0 && pointsKept.removed.points.onObjects === 0 && pointsKept.removed.points.station === pointsKept.scannedAgain.station,
    [pointsKept.scannedAgain, pointsKept.removed]);

  // --- walking into one that lies on the floor ---
  const shoved = await inGame((bare) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = {};
    lab.reset();
    const startX = bare.x + bare.stepX * (bare.wall - 3.1), startZ = bare.z + bare.stepZ * (bare.wall - 3.1);
    const walk = function (kindKey) {
      d.clearLooseObjects();
      lab.stand(startX, startZ, bare.yaw);
      let object = null;
      if (kindKey) {
        object = d.createLooseObject(kindKey, startX + bare.stepX * 0.9, 0.5, startZ + bare.stepZ * 0.9, bare.yaw);
        for (let step = 0; step < 150 && !object.isAsleep; step++) d.simulate(1 / 30);
      }
      const objectAt = object ? { x: object.x, z: object.z } : null;
      d.input.keysDown.add('KeyW');
      d.simulate(1.2);
      d.input.keysDown.clear();
      return { walked: lab.round((p.x - startX) * bare.stepX + (p.z - startZ) * bare.stepZ),
        objectMoved: object ? lab.round((object.x - objectAt.x) * bare.stepX + (object.z - objectAt.z) * bare.stepZ) : 0,
        resistance: kindKey ? d.getLooseShoveResistance(d.looseObjectKinds[kindKey].mass) : 0 };
    };
    result.nothing = walk(null);
    for (const kindKey of ['jar', 'toolCase', 'crate', 'pumpMotor']) result[kindKey] = walk(kindKey);
    return result;
  }, bareWall);
  check('a jar on the floor is kicked along without slowing you; a tool case slows you a little, a crate a lot',
    shoved.jar.walked > shoved.nothing.walked - 0.1 && shoved.jar.objectMoved > 0.5 &&
    shoved.toolCase.walked < shoved.nothing.walked - 0.1 && shoved.crate.walked < shoved.toolCase.walked - 0.2 && shoved.crate.objectMoved > 0.05, shoved);
  check('a pump motor on the floor does not move for your legs: it stops you where it lies',
    shoved.pumpMotor.resistance === 1 && shoved.pumpMotor.objectMoved < 0.03 && shoved.pumpMotor.walked < 0.6, shoved.pumpMotor);

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
  check('a jar goes into a vent ahead of you; with a crate in the beam you cannot crawl in, and are told why',
    vent !== null && vent.jar.playerInVent && vent.jar.objectInVent && vent.jar.stillHeld && !vent.crate.playerInVent && vent.crate.stillHeld &&
    vent.crate.messages.some((text) => /crate will not go in there/.test(text)), vent);

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
    lab.stand(spot.x, spot.z, Math.PI / 2);
    lab.carry('canister');
    d.createLooseObject('crate', spot.x - 1.5, 0.5, spot.z, 0);
    result.before = { loose: d.looseObjects.length, carrying: d.getHeldLooseObject() !== null };
    d.loadStation('classic', 0);
    result.after = { loose: d.looseObjects.length, carrying: d.getHeldLooseObject() !== null, speedFactor: d.getCarrySpeedFactor() };
    return result;
  }, spot);
  check('something dropped down the shaft is gone for good', housekeeping.pit.there ? housekeeping.pit.gone && housekeeping.pit.counted === 1 : true, housekeeping.pit);
  check('a new descent starts with nothing loose and nothing in the beam',
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
    // The hint about the keys is given once a descent, and this descent has had it. Make it due again.
    d.looseState.hasShownCarryHint = false;
    d.clearMessages();
  }, spot);
  await drawFrames(page, 3);
  const beforePickUp = await inGame(() => ({ prompt: document.getElementById('hud-prompt').textContent, promptHidden: document.getElementById('hud-prompt').hidden,
    chipHidden: document.getElementById('chip-carrying').hidden }));
  await page.keyboard.press('KeyE');
  // A message stays for a few seconds of the game's own clock, which the browser may run on by itself while
  // this test waits for it. So what is on screen is read in the same breath as the thing that puts it there.
  const pickUpMessages = await inGame(() => { window.lastReturnDebug.simulate(0.5); return window.looseLab.messages(); });
  await drawFrames(page, 8);
  const afterPickUp = await inGame(() => ({ carrying: window.lastReturnDebug.getHeldLooseObject() !== null, chip: document.getElementById('chip-carrying').textContent,
    chipHidden: document.getElementById('chip-carrying').hidden }));
  afterPickUp.messages = pickUpMessages;
  check('looking at an object within reach offers to pick it up, and E does', !beforePickUp.promptHidden && /Pick up the gas canister/.test(beforePickUp.prompt) && beforePickUp.chipHidden && afterPickUp.carrying, [beforePickUp, afterPickUp.carrying]);
  check('the screen says what you carry, and the first time, which key lets go of it',
    !afterPickUp.chipHidden && afterPickUp.chip === 'CARRYING: GAS CANISTER' && afterPickUp.messages.some((text) => /E again lets go/.test(text)), afterPickUp);

  // A tap on E, with nothing in front of you to use, lets go. The key is put down and let go inside the game
  // here, not through the browser: between a real press and a real release the browser may draw frames of its
  // own, and each of those counts as time the key was held. (The real key is what the check after this uses.)
  const tapped = await inGame(() => {
    const d = window.lastReturnDebug;
    d.player.pitch = 0.1; d.simulate(1.5); // look up from where it lay, and let it stop swinging: nothing to use or pick up in view
    const nothingInView = d.player.focusedInteractable === null && d.player.focusedLooseObject === null;
    d.input.keysDown.add('KeyE'); d.input.wantsInteract = true;
    d.simulate(0.05);
    const whileDown = d.getHeldLooseObject() !== null;
    d.input.keysDown.delete('KeyE');
    d.simulate(0.05);
    const object = d.looseObjects[0];
    return { nothingInView: nothingInView, stillCarryingWhileTheKeyIsDown: whileDown, carrying: d.getHeldLooseObject() !== null, speed: Math.hypot(object.velocityX, object.velocityZ) };
  });
  check('E again, with nothing in front of you to use, lets go of it when the key comes up: it drops, it is not thrown',
    tapped.nothingInView && tapped.stillCarryingWhileTheKeyIsDown && !tapped.carrying && tapped.speed < 0.5, tapped);

  // The press that picks something up does not also let go of it, however long E is held.
  const pickUpHeld = await inGame(() => {
    const d = window.lastReturnDebug, object = d.looseObjects[0];
    for (let step = 0; step < 150 && !object.isAsleep; step++) d.simulate(1 / 30);
    d.player.pitch = Math.atan2(object.y - d.getPlayerEyeY(), Math.hypot(object.x - d.player.x, object.z - d.player.z));
    d.player.yaw = Math.atan2(object.x - d.player.x, -(object.z - d.player.z));
    d.simulate(0.1);
    const lookingAtIt = d.player.focusedLooseObject === object;
    d.input.keysDown.add('KeyE'); d.input.wantsInteract = true;
    d.simulate(1.2);
    d.input.keysDown.delete('KeyE');
    d.simulate(0.2);
    return { lookingAtIt: lookingAtIt, carrying: d.getHeldLooseObject() === object };
  });
  check('holding E down while picking something up does not throw it away again', pickUpHeld.lookingAtIt && pickUpHeld.carrying, pickUpHeld);

  await inGame(() => { const d = window.lastReturnDebug; d.player.pitch = 0.15; d.simulate(0.6); });
  await page.keyboard.down('KeyE');
  await inGame(() => window.lastReturnDebug.simulate(0.6));
  await drawFrames(page, 3);
  const windingUp = await inGame(() => ({ windUp: window.lastReturnDebug.getThrowWindUp(), prompt: document.getElementById('hud-prompt').textContent, stillCarrying: window.lastReturnDebug.getHeldLooseObject() !== null }));
  await page.keyboard.up('KeyE');
  const thrownByKey = await inGame(() => {
    const d = window.lastReturnDebug;
    d.simulate(0.03);
    const object = d.looseObjects[0];
    return { carrying: d.getHeldLooseObject() !== null, speed: Math.hypot(object.velocityX, object.velocityY, object.velocityZ) };
  });
  check('holding E winds up a throw, with a bar on screen that fills; letting go throws it', windingUp.stillCarrying && windingUp.windUp > 0.5 && /THROW/.test(windingUp.prompt) && !thrownByKey.carrying && thrownByKey.speed > 3, [windingUp, thrownByKey]);

  // The right mouse button: held, it carries; let go, it drops. And it no longer sweeps: the wheel button does.
  await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player;
    d.clearLooseObjects();
    lab.stand(spot.x, spot.z, Math.PI / 2);
    const object = d.createLooseObject('canister', spot.x + 1.6, 0.3, spot.z, 0);
    for (let step = 0; step < 150 && !object.isAsleep; step++) d.simulate(1 / 30);
    p.pitch = Math.atan2(object.y - d.getPlayerEyeY(), 1.6);
    d.simulate(0.1);
    d.input.isPointerLocked = true; // the test's browser does not capture the mouse by itself
    d.looseState.hasShownCarryHint = false;
    d.clearMessages();
  }, spot);
  await page.mouse.move(640, 360);
  await page.mouse.down({ button: 'right' });
  const grabbed = await inGame(() => {
    const d = window.lastReturnDebug;
    d.simulate(0.6);
    return { buttonSeen: d.input.isGrabHeld, carrying: d.getHeldLooseObject() !== null, byButton: d.looseState.isHeldByButton, sweeping: d.player.sweepTimeRemaining > 0, messages: window.looseLab.messages() };
  });
  await inGame(() => { const d = window.lastReturnDebug; d.player.pitch = 0; d.simulate(1.5); });
  const stillGrabbed = await inGame(() => window.lastReturnDebug.getHeldLooseObject() !== null);
  await page.mouse.up({ button: 'right' });
  const letGo = await inGame(() => {
    const d = window.lastReturnDebug;
    d.simulate(0.05);
    const object = d.looseObjects[0];
    return { carrying: d.getHeldLooseObject() !== null, speed: Math.hypot(object.velocityX, object.velocityZ) };
  });
  check('holding the right mouse button on an object within reach takes it into the beam and keeps it there; it does not sweep',
    grabbed.buttonSeen && grabbed.carrying && grabbed.byButton && !grabbed.sweeping && stillGrabbed && grabbed.messages.some((text) => /while you hold the button/.test(text)), grabbed);
  check('letting the button go drops it where it hangs', !letGo.carrying && letGo.speed < 0.6, letGo);

  // Swung and let go, it flies: there is no other throw with the mouse.
  const flung = await inGame(() => {
    const d = window.lastReturnDebug, p = d.player, object = d.looseObjects[0];
    for (let step = 0; step < 150 && !object.isAsleep; step++) d.simulate(1 / 30);
    p.yaw = Math.atan2(object.x - p.x, -(object.z - p.z));
    p.pitch = Math.atan2(object.y - d.getPlayerEyeY(), Math.hypot(object.x - p.x, object.z - p.z));
    d.simulate(0.1);
    d.input.isGrabHeld = true;
    d.simulate(1.5);
    p.pitch = 0.2;
    for (let step = 0; step < 9; step++) { p.yaw += Math.PI / 18; d.simulate(1 / 30); } // a quarter turn in a third of a second
    d.simulate(0.1);
    d.input.isGrabHeld = false;
    d.simulate(1 / 30);
    return { wasCarrying: true, carrying: d.getHeldLooseObject() !== null, speed: Math.hypot(object.velocityX, object.velocityY, object.velocityZ) };
  });
  check('swung round and let go, it keeps the speed of the swing', !flung.carrying && flung.speed > 2.5, flung);

  await inGame(() => { const d = window.lastReturnDebug; d.clearLooseObjects(); d.player.heat = 0; d.simulate(0.2); });
  await page.mouse.down({ button: 'right' });
  const rightAlone = await inGame(() => { const d = window.lastReturnDebug; d.simulate(0.1); return d.player.sweepTimeRemaining > 0; });
  await page.mouse.up({ button: 'right' });
  await page.mouse.down({ button: 'middle' });
  const middle = await inGame(() => { const d = window.lastReturnDebug; d.simulate(0.1); return d.player.sweepTimeRemaining > 0; });
  await page.mouse.up({ button: 'middle' });
  await inGame(() => { const d = window.lastReturnDebug; d.simulate(3); d.input.isPointerLocked = false; });
  check('the right mouse button no longer sweeps; the wheel button does (and F still does)', !rightAlone && middle, { rightSweeps: rightAlone, middleSweeps: middle });

  // With something to use in front of you, E uses that and you keep what you carry.
  const usedInstead = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player;
    d.clearLooseObjects();
    const target = d.interactables.find((interactable) => interactable.isAvailable);
    if (!target) return null;
    const spot = d.findWalkableSpotNear(target.x, target.z);
    lab.stand(spot.x, spot.z, Math.atan2(target.x - spot.x, -(target.z - spot.z)));
    const object = lab.carry('jar');
    p.yaw = Math.atan2(target.x - p.x, -(target.z - p.z));
    p.pitch = Math.atan2(target.y - d.getPlayerEyeY(), Math.hypot(target.x - p.x, target.z - p.z));
    d.simulate(0.2);
    const lookingAtIt = p.focusedInteractable === target;
    d.input.keysDown.add('KeyE'); d.input.wantsInteract = true;
    d.simulate(0.05);
    d.input.keysDown.delete('KeyE');
    d.simulate(0.3);
    if (d.game.mode === 'reading') d.closeReader();
    return { lookingAtIt: lookingAtIt, stillCarrying: d.getHeldLooseObject() === object, metresAway: Math.round(Math.hypot(target.x - p.x, target.z - p.z) * 100) / 100 };
  });
  check('with something to use in front of you, E uses that, and you keep what you carry', usedInstead !== null && usedInstead.lookingAtIt && usedInstead.stillCarrying, usedInstead);

  const handsFull = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab;
    d.clearLooseObjects();
    lab.stand(spot.x, spot.z, Math.PI / 2);
    lab.carry('jar');
    const other = d.createLooseObject('toolCase', spot.x + 1.1, 0.2, spot.z, 0);
    for (let step = 0; step < 150 && !other.isAsleep; step++) d.simulate(1 / 30);
    d.player.pitch = Math.atan2(other.y - d.getPlayerEyeY(), 1.1);
    d.simulate(0.1);
    d.clearMessages();
    return { lookingAtIt: d.player.focusedLooseObject === other };
  }, spot);
  // E is given inside the game, so that the message is read in the same step as the press that causes it.
  const handsFullAfter = await inGame(() => {
    const d = window.lastReturnDebug;
    d.input.wantsInteract = true;
    d.simulate(0.05);
    return { carrying: d.getHeldLooseObject().kindKey, messages: window.looseLab.messages() };
  });
  check('with something in the beam already, E on another object says so', handsFull.lookingAtIt && handsFullAfter.carrying === 'jar' && handsFullAfter.messages.some((text) => /already holding something/.test(text)), handsFullAfter);

  check('no script errors were reported', problems.length === 0, problems);
  await browser.close();

  // --- on a phone ---
  const phone = await openGame({ dev: true, width: 844, height: 390, isPhone: true });
  await startGame(phone.page, true);
  await phone.page.evaluate(installLab);
  const phoneHint = await phone.page.evaluate(() => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player;
    lab.reset();
    lab.stand(p.x, p.z, p.yaw);
    lab.carry('canister');
    p.pitch = 0.1; d.simulate(0.3);
    return { messages: lab.messages(), nothingInView: p.focusedInteractable === null && p.focusedLooseObject === null, noDropButton: document.getElementById('touch-drop') === null };
  });
  check('on a phone the hint names the USE button, not a key, and there is no extra button for letting go',
    phoneHint.messages.some((text) => /USE again lets go/.test(text)) && phoneHint.noDropButton, phoneHint);
  await phone.page.tap('#touch-use');
  const phoneDropped = await phone.page.evaluate(() => { const d = window.lastReturnDebug; d.simulate(0.2); return { carrying: d.getHeldLooseObject() !== null }; });
  check('a tap on USE, with nothing to use in view, lets go of it', phoneHint.nothingInView && !phoneDropped.carrying, phoneDropped);
  // A finger held on USE winds up a throw.
  const phoneThrow = await phone.page.evaluate(() => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player;
    const object = lab.carry('canister');
    p.pitch = 0.15; d.simulate(0.3);
    const button = document.getElementById('touch-use');
    const touch = function (type) { button.dispatchEvent(new Event(type, { bubbles: true, cancelable: true })); };
    touch('touchstart');
    d.simulate(0.7);
    const windUp = d.getThrowWindUp(), stillCarrying = d.getHeldLooseObject() === object;
    touch('touchend');
    d.simulate(0.03);
    return { windUp: windUp, stillCarryingWhileHeld: stillCarrying, carrying: d.getHeldLooseObject() !== null, speed: Math.hypot(object.velocityX, object.velocityY, object.velocityZ) };
  });
  check('a finger held on USE winds up a throw, and lifting it throws', phoneThrow.stillCarryingWhileHeld && phoneThrow.windUp > 0.5 && !phoneThrow.carrying && phoneThrow.speed > 3, phoneThrow);
  check('no script errors were reported on the phone', phone.problems.length === 0, phone.problems);
  await phone.browser.close();

  console.log(failures.length ? '\n' + failures.length + ' check(s) failed.' : '\nAll checks passed.');
  process.exit(failures.length ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
