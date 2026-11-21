// Checks the loose objects (things you carry, drop and throw): that they fall and come to rest, that carrying
// one puts it in the way of the scanner, that a knock is heard by how hard it was, that an object which cannot
// follow you is pulled out of your hands, and that the keys and the phone's button do what they say.
const { openGame, startGame, drawFrames } = require('./browser-harness.js');
const { TEST_OBJECT_KINDS, installTestObjectKinds, removeTestObjectKinds } = require('./test-objects.js');

// The test objects (tools/test-objects.js) that are in the game's table for the whole of this suite. A check about
// a rule of weight, size or shape (a heavy thing lands nearer than a light one, a rod is wider than a vent) is
// made with these and not with the game's own things, which the game is free to retune or reshape. They are put
// in before anything else, and so the checks below that are made of every kind there is are made of them as
// well: what holds for any object holds for them, and those checks are where the others read them from.
// (The open crate, testCrate, is put in only for the checks of a crate that holds things.)
const TEST_KINDS_OF_THIS_SUITE = ['testCapsule', 'testJar', 'testCase', 'testRod', 'testBox', 'testMotor', 'testTin', 'testWeight', 'testDrum', 'testCone', 'testBall'];

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
  // Most of these checks are about how things move, and were written when nothing could break. So in this
  // suite nothing does, unless a check asks for it: the checks under "what a knock costs" switch it on.
  const whole = { from: d.tuning.looseDamageFromSpeed, shattersAt: {} };
  for (const kindKey of Object.keys(d.looseObjectKinds)) whole.shattersAt[kindKey] = d.looseObjectKinds[kindKey].shattersAt;
  const lab = window.looseLab = {
    round: round,
    noises: [],
    setBreakable: function (isBreakable) {
      d.tuning.looseDamageFromSpeed = isBreakable ? whole.from : 1000;
      for (const kindKey of Object.keys(d.looseObjectKinds)) {
        // (A kind put in after the lab was, such as a test object, is taken as it was put in.)
        if (!(kindKey in whole.shattersAt)) whole.shattersAt[kindKey] = d.looseObjectKinds[kindKey].shattersAt;
        d.looseObjectKinds[kindKey].shattersAt = isBreakable ? whole.shattersAt[kindKey] : undefined;
      }
    },
    // Starts over: Kessel-9, nothing loose, creatures held still, every noise written down.
    reset: function () {
      d.loadStation('classic', 0);
      d.clearLooseObjects(); // the station's own loose things have their own checks, further down
      d.game.flags.hasLeftLift = true;
      d.setDebugOption('freezeCreatures', true); d.setDebugOption('invulnerable', true); d.setDebugOption('unlimitedStamina', true);
      d.hollow.isActive = false;
      d.input.keysDown.clear(); d.input.touchDropHeld = false;
      d.settings.captions = 'all';
      lab.noises.length = 0;
      d.debugHooks.recordNoise = function (x, z, radius) { lab.noises.push({ x: x, z: z, radius: radius }); };
      for (const key of ['ownObjectKnock', 'ownObjectCrash', 'ownObjectKicked', 'objectKnock', 'objectCrash', 'hollowFling']) d.captionCounts[key] = 0;
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
      let stopped = 0;
      for (let pulse = 0; pulse < pulses; pulse++) {
        const radius = Math.pow((pulse + 0.5) / pulses, 0.62) * tangent, angle = pulse * 2.399963;
        const across = Math.cos(angle) * radius, up = Math.sin(angle) * radius;
        if (d.castScannerPulse(across, up) && d.rayHit.looseObject === object) stopped++;
      }
      return round(stopped / pulses);
    },
    // Counts the scan points inside a box that will stay (not fading, not removed): those on the floor and walls,
    // and those on things that can be picked up.
    countPoints: function (x, y, z, reach) {
      const floats = d.pointCloud.floatView, bytes = d.pointCloud.byteView, counts = { station: 0, onObjects: 0, fading: 0, inTheWarningColour: 0 };
      for (let index = 0; index < d.pointCloud.storedCount; index++) {
        const px = floats[index * 5], py = floats[index * 5 + 1], pz = floats[index * 5 + 2];
        if (Math.abs(px - x) > reach || Math.abs(py - y) > reach || Math.abs(pz - z) > reach) continue;
        if (floats[index * 5 + 3] < -1e8) continue; // removed
        // (Which points are a loose thing's is kept with the point, not read off its colour: a thing that is loud
        // to kick is scanned in the warning colour.)
        const isOnALooseThing = bytes[index * 20 + 19] === 1, lifeCode = bytes[index * 20 + 18];
        if (lifeCode !== 0) counts.fading++;
        else if (isOnALooseThing) { counts.onObjects++; if (bytes[index * 20 + 17] === 12) counts.inTheWarningColour++; }
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
  // This suite's test objects, among them a cylinder and a cone (so that every check below that is made of every
  // kind is made of those shapes as well) and something made to bounce.
  await installTestObjectKinds(page, TEST_KINDS_OF_THIS_SUITE);
  await inGame(installLab);

  // --- how they are described ---
  // (Before the lab makes nothing breakable, so that what a kind says about shattering is looked at as it is.)
  const described = await inGame((testKinds) => {
    const d = window.lastReturnDebug, wrong = [], counts = {};
    for (const kindKey of Object.keys(d.looseObjectKinds)) {
      const kind = d.looseObjectKinds[kindKey];
      // (A bounce of 1, keeping all of its speed, is as far as the workshop lets one go.)
      if (!kind.label || !(kind.mass > 0) || ['metal', 'glass', 'case', 'tin', 'card'].indexOf(kind.material) < 0 || typeof kind.bulky !== 'boolean' ||
          !(kind.value >= 0) || !(kind.loud > 0) || ['upright', 'onItsSide', 'either'].indexOf(kind.lies) < 0 ||
          !(kind.bounce >= 0 && kind.bounce <= 1) || !(kind.grip >= 0 && kind.grip <= 1) || !kind.parts || kind.parts.length === 0 ||
          (kind.fragile !== undefined && !(kind.fragile >= 0 && kind.fragile <= 1)) || (kind.shattersAt !== undefined && !(kind.shattersAt > 0))) wrong.push(kindKey + ': incomplete');
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
      // Of a size the workshop allows (d.designedObjectLimits): a part as thin as minimumRadius, and its middle up to
      // `reach` out along each of the three axes with the largest part there is around it. Its own centre of mass is
      // within all that too, so nothing of it is further from that centre than that space is across.
      const limits = d.designedObjectLimits, furthestCorner = Math.sqrt(3) * (limits.reach + Math.max(limits.maximumHalf, limits.maximumRadius));
      if (!(prepared.boundsRadius >= prepared.smallestRadius && prepared.boundsRadius <= 2 * furthestCorner) || !(prepared.smallestRadius >= limits.minimumRadius)) wrong.push(kindKey + ': size');
      // (A scanner is what is left of a player, and a fuel can with fuel in it is for a generator: neither is
      // salvage. A tool is: a scan grenade and a scanner tripod are worth something unused.)
      if (kindKey !== 'scanner' && kindKey !== 'fuelCan' && !(kind.value > 0)) wrong.push(kindKey + ': is worth nothing');
      d.removeLooseObject(object);
    }
    return { wrong: wrong, counts: counts, kinds: Object.keys(d.looseObjectKinds).length, ofTheGame: Object.keys(d.looseObjectKinds).filter((kindKey) => testKinds.indexOf(kindKey) < 0).length };
  }, TEST_KINDS_OF_THIS_SUITE);
  check('every kind of object is described completely, is of a size the workshop allows, and balances about its own centre; and the game has kinds of its own besides the tests\' ones', described.wrong.length === 0 && described.ofTheGame >= 1, described);
  await inGame(() => window.looseLab.setBreakable(false));

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
      // How much of its speed a thing must keep to do more than the checks below allow it, worked out from the
      // game's own numbers. Let go of at 1.3 m it comes down at no more than `fallSpeed`, and each time it comes up
      // again it keeps `bounce` of its speed (or less: a thing that turns as it lands keeps less). A knock under
      // looseKnockQuietSpeed is not heard, and a hit under looseBounceFromSpeed does not bounce at all. So:
      // - heard more than four times, bouncing straight up and down, only if bounce^4 x fallSpeed is still heard:
      //   that is what is "made to bounce", and it is given ten seconds and twelve knocks instead of four and four;
      // - up a third time only if bounce^2 x fallSpeed still bounces.
      // (A ball keeps 0.95 and is made to bounce; a steel pipe keeps 0.35 and does neither.)
      const tuning = d.tuning, fallSpeed = Math.sqrt(2 * tuning.looseGravity * 1.3);
      const isMadeToBounce = object.kind.bounce > Math.pow(tuning.looseKnockQuietSpeed / fallSpeed, 1 / 4);
      const mayComeUpAThirdTime = object.kind.bounce > Math.sqrt(tuning.looseBounceFromSpeed / fallSpeed);
      let lowest = 99, asleepAfter = -1, leftTheOpen = false, wasRising = false, heightBefore = object.y;
      const tops = []; // how high it was each time it came up again and turned
      for (let step = 0; step < (isMadeToBounce ? 300 : 150); step++) {
        d.simulate(1 / 30);
        lowest = Math.min(lowest, object.y);
        if (!lab.isInTheOpen(object.x, object.y, object.z)) leftTheOpen = true;
        if (object.isAsleep && asleepAfter < 0) asleepAfter = lab.round((step + 1) / 30);
        if (wasRising && object.y < heightBefore) tops.push(heightBefore);
        wasRising = object.y > heightBefore; heightBefore = object.y;
      }
      const bounces = tops.filter((top) => top > object.y + 0.02); // (not the last tremble before it lies still)
      result[kindKey] = { restsAt: lab.round(object.y), lowest: lab.round(lowest), asleepAfter: asleepAfter, drifted: lab.round(Math.hypot(object.x - spot.x, object.z - spot.z)),
        leftTheOpen: leftTheOpen, knocks: lab.since(before), reach: lab.round(object.prepared.boundsRadius), smallest: lab.round(object.prepared.smallestRadius),
        isMadeToBounce: isMadeToBounce, mayComeUpAThirdTime: mayComeUpAThirdTime, bounces: bounces.length, eachBounceLower: bounces.every((top, index) => index === 0 || top < bounces[index - 1]) };
    }
    return result;
  }, spot);
  const badDrops = Object.keys(drops).filter((key) => {
    const drop = drops[key];
    // What is made to bounce has ten seconds, and is heard once for every time it comes down hard enough.
    return drop.asleepAfter < 0 || drop.asleepAfter > (drop.isMadeToBounce ? 10 : 4) || drop.leftTheOpen || drop.lowest < drop.smallest - 0.02 || drop.restsAt > drop.reach + 0.01 ||
      drop.drifted > 1.2 || drop.knocks.heard < 1 || drop.knocks.heard > (drop.isMadeToBounce ? 12 : 4);
  });
  check('dropped from chest height, every kind lands, stays above the floor, comes to rest within four seconds and is heard one to four times (ten seconds, and up to twelve times, for what is made to bounce: anything that keeps enough of its speed to be heard a fifth time)',
    badDrops.length === 0, drops);
  check('a ball that is made to bounce does: it comes up again at least five times, each time lower than the last, and nothing that keeps too little of its speed to bounce a third time comes up more than twice',
    drops.testBall.bounces >= 5 && drops.testBall.eachBounceLower && Object.keys(drops).every((key) => drops[key].mayComeUpAThirdTime || drops[key].bounces <= 2),
    Object.keys(drops).map((key) => key + ': ' + drops[key].bounces));
  check('a box dropped flat lands flat (half its height from its middle to the floor)', Math.abs(drops.testBox.restsAt - TEST_OBJECT_KINDS.testBox.parts[0].half[1]) < 0.012, drops.testBox.restsAt);

  // --- cylinders and cones ---
  const forms = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, result = {};
    lab.stand(spot.x - 2.5, spot.z, Math.PI / 2);
    const settle = function (kindKey, turn) {
      d.clearLooseObjects();
      const object = d.createLooseObject(kindKey, spot.x, 0.6, spot.z, 0);
      if (turn) d.setLooseObjectOrientation(object, turn[0], turn[1], turn[2], turn[3]);
      // Set down a finger above the floor, whichever way up: its lowest ball just clear of it.
      let lowest = Infinity;
      for (let ball = 0; ball < object.prepared.shellCount; ball++) {
        const shell = object.prepared.shell, m = object.matrix;
        lowest = Math.min(lowest, m[3] * shell[ball * 4] + m[4] * shell[ball * 4 + 1] + m[5] * shell[ball * 4 + 2] - shell[ball * 4 + 3]);
      }
      object.y = 0.02 - lowest;
      d.wakeLooseObject(object);
      d.simulate(4);
      return object;
    };
    // Which way the object's own "up" points, and how high its own origin is (not its centre of mass).
    const standing = function (object) {
      const m = object.matrix, c = object.prepared;
      return { up: lab.round(m[4]), originY: lab.round(object.y - (m[3] * c.centreX + m[4] * c.centreY + m[5] * c.centreZ)), isAtRest: object.isAsleep,
        drifted: lab.round(Math.hypot(object.x - spot.x, object.z - spot.z)) };
    };
    // Turned about the line that points to your right: 0 is upright, a quarter turn lays it down, a half turn
    // is upside down. Nothing is set down dead straight: three degrees off, each time.
    const turned = function (angle) { return [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)]; };
    const offStraight = 0.05;
    result.drumUpright = standing(settle('testDrum', turned(offStraight)));
    result.drumUpsideDown = standing(settle('testDrum', turned(Math.PI - offStraight)));
    result.drumOnItsSide = standing(settle('testDrum', turned(Math.PI / 2)));
    result.coneUpright = standing(settle('testCone', turned(offStraight)));
    const coneOnItsSide = settle('testCone', turned(Math.PI / 2));
    result.coneOnItsSide = standing(coneOnItsSide);
    result.coneOnItsSide.top = lab.round(d.getLooseObjectTopY(coneOnItsSide));
    // A capsule of much the same size: set down on its round end it does not stay there.
    result.capsuleUpright = standing(settle('testCapsule', turned(offStraight)));

    // What the scanner makes of them. Each hangs still in the air, upright, its own origin 1.2 m up; a pulse is
    // fired at it and must land where the form itself is, not where the balls it touches with are.
    const hang = function (kindKey) {
      d.clearLooseObjects();
      const centre = d.createLooseObject(kindKey, 0, 0, 0, 0).prepared;
      d.clearLooseObjects();
      const object = d.createLooseObject(kindKey, spot.x + centre.centreX, 1.2 + centre.centreY, spot.z + centre.centreZ, 0);
      object.isAsleep = true;
      return object;
    };
    const fire = function (fromX, fromY, fromZ, directionX, directionY, directionZ) {
      const length = Math.hypot(directionX, directionY, directionZ);
      const isHit = d.castScannerRay(fromX, fromY, fromZ, directionX / length, directionY / length, directionZ / length, 20);
      return isHit && d.rayHit.looseObject ? { distance: lab.round(d.rayHit.distance), y: lab.round(d.rayHit.y), across: lab.round(Math.hypot(d.rayHit.x - spot.x, d.rayHit.z - spot.z)) } : null;
    };
    // The drum is 30 cm high and 24 across: from 1.05 to 1.35 m up.
    hang('testDrum');
    result.drumRays = {
      side: fire(spot.x - 2, 1.2, spot.z, 1, 0, 0),              // square on to its side: 12 cm short of its middle line
      top: fire(spot.x + 0.05, 2.2, spot.z, 0, -1, 0),           // straight down onto its flat top
      overTheTop: fire(spot.x - 2, 1.36, spot.z, 1, 0, 0),       // a finger above the top: a capsule's round end would be there
      pastTheSide: fire(spot.x - 2, 1.2, spot.z + 0.125, 1, 0, 0),
      ontoTheTop: fire(spot.x - 1, 2.35, spot.z, 0.93, -1, 0),   // slanting down at the top: it lands on it 7 cm from the middle, at the top's own height
      underneath: fire(spot.x, 0.3, spot.z + 0.1, 0, 1, 0)       // and from below, on its other flat end
    };
    // The cone is 45 cm high and 30 across its flat end: from 1.05 m up to its point at 1.5.
    const cone = hang('testCone');
    result.coneRays = {
      low: fire(spot.x - 2, 1.14, spot.z, 1, 0, 0),              // a fifth of the way up it is four fifths as wide
      high: fire(spot.x - 2, 1.41, spot.z, 1, 0, 0),             // four fifths of the way up, one fifth
      point: fire(spot.x, 2.5, spot.z, 0, -1, 0),                // straight down onto the point
      slope: fire(spot.x + 0.05, 2.5, spot.z, 0, -1, 0),         // 5 cm off the middle line it lands on the slope, a third of the way down
      overThePoint: fire(spot.x - 2, 1.51, spot.z, 1, 0, 0),
      besideThePoint: fire(spot.x - 2, 1.41, spot.z + 0.04, 1, 0, 0),
      underneath: fire(spot.x + 0.1, 0.3, spot.z, 0, 1, 0)       // from below, on its flat end
    };
    // And lying any way at all: fired at from all round, every pulse that lands on it lands on its surface.
    d.setLooseObjectOrientation(cone, 0.3, -0.5, 0.2, 0.79);
    const m = cone.matrix, c = cone.prepared;
    let landed = 0, offTheSurface = 0, worst = 0;
    for (let shot = 0; shot < 400; shot++) {
      const turn = shot * 2.399963, height = 1 - 2 * (shot + 0.5) / 400, ring = Math.sqrt(1 - height * height);
      const aim = [(Math.sin(shot * 12.9898) * 43758.5453 % 1) * 0.2, (Math.sin(shot * 78.233) * 12543.123 % 1) * 0.2, (Math.sin(shot * 39.425) * 3758.31 % 1) * 0.2];
      const from = [cone.x + Math.cos(turn) * ring * 1.5, cone.y + height * 1.1, cone.z + Math.sin(turn) * ring * 1.5];
      const direction = [cone.x + aim[0] - from[0], cone.y + aim[1] - from[1], cone.z + aim[2] - from[2]];
      const length = Math.hypot(direction[0], direction[1], direction[2]);
      if (!d.castScannerRay(from[0], from[1], from[2], direction[0] / length, direction[1] / length, direction[2] / length, 20) || d.rayHit.looseObject !== cone) continue;
      landed++;
      // Where it landed, in the cone's own coordinates as its parts were given: how far up it, and how far from its middle line.
      const offset = [d.rayHit.x - cone.x, d.rayHit.y - cone.y, d.rayHit.z - cone.z];
      const local = [m[0] * offset[0] + m[3] * offset[1] + m[6] * offset[2] + c.centreX, m[1] * offset[0] + m[4] * offset[1] + m[7] * offset[2] + c.centreY, m[2] * offset[0] + m[5] * offset[1] + m[8] * offset[2] + c.centreZ];
      const up = local[1] + 0.15, across = Math.hypot(local[0], local[2]);
      const fromTheFlatEnd = Math.abs(up) + Math.max(0, across - 0.15), fromTheSlope = Math.abs(across - 0.15 * (1 - up / 0.45)) + Math.max(0, -up, up - 0.45);
      const off = Math.min(fromTheFlatEnd, fromTheSlope);
      worst = Math.max(worst, off);
      if (off > 0.002) offTheSurface++;
    }
    result.coneAllRound = { landed: landed, offTheSurface: offTheSurface, worst: lab.round(worst) };
    d.clearLooseObjects();
    return result;
  }, spot);
  check('a cylinder stands on either of its flat ends, 15 cm from its middle to the floor, and stays where it was put',
    [forms.drumUpright, forms.drumUpsideDown].every((drum) => drum.isAtRest && Math.abs(Math.abs(drum.up) - 1) < 0.002 && Math.abs(drum.originY - 0.15) < 0.012 && drum.drifted < 0.02) &&
    forms.drumUpsideDown.up < 0, [forms.drumUpright, forms.drumUpsideDown]);
  check('on its side the cylinder lies on its round, 12 cm from its middle line to the floor',
    forms.drumOnItsSide.isAtRest && Math.abs(forms.drumOnItsSide.up) < 0.02 && Math.abs(forms.drumOnItsSide.originY - 0.12) < 0.012, forms.drumOnItsSide);
  check('a cone stands on its flat end, and a capsule set down on its round end does not stay on it',
    forms.coneUpright.isAtRest && forms.coneUpright.up > 0.998 && Math.abs(forms.coneUpright.originY - 0.15) < 0.012 && forms.coneUpright.drifted < 0.02 &&
    Math.abs(forms.capsuleUpright.up) < 0.5, [forms.coneUpright, forms.capsuleUpright]);
  check('laid on its side a cone comes to rest on its slope, point down a little, no higher than it is wide',
    forms.coneOnItsSide.isAtRest && forms.coneOnItsSide.up < -0.1 && forms.coneOnItsSide.up > -0.6 && forms.coneOnItsSide.top < 0.31 && forms.coneOnItsSide.top > 0.2, forms.coneOnItsSide);
  check('the scanner finds a cylinder where it is: its round side, its flat ends from above, aslant and below, and nothing above the top or beside it',
    forms.drumRays.side && Math.abs(forms.drumRays.side.distance - 1.88) < 0.002 && forms.drumRays.top && Math.abs(forms.drumRays.top.y - 1.35) < 0.002 &&
    forms.drumRays.overTheTop === null && forms.drumRays.pastTheSide === null &&
    forms.drumRays.ontoTheTop && Math.abs(forms.drumRays.ontoTheTop.y - 1.35) < 0.002 && Math.abs(forms.drumRays.ontoTheTop.across - 0.07) < 0.002 &&
    forms.drumRays.underneath && Math.abs(forms.drumRays.underneath.y - 1.05) < 0.002, forms.drumRays);
  check('and a cone: as wide as it is at each height, its point, its slope from above, its flat end from below, and nothing beyond the point',
    forms.coneRays.low && Math.abs(forms.coneRays.low.distance - 1.88) < 0.002 && forms.coneRays.high && Math.abs(forms.coneRays.high.distance - 1.97) < 0.002 &&
    forms.coneRays.point && Math.abs(forms.coneRays.point.y - 1.5) < 0.002 && forms.coneRays.slope && Math.abs(forms.coneRays.slope.y - 1.35) < 0.002 &&
    forms.coneRays.overThePoint === null && forms.coneRays.besideThePoint === null &&
    forms.coneRays.underneath && Math.abs(forms.coneRays.underneath.y - 1.05) < 0.002 && Math.abs(forms.coneRays.underneath.across - 0.1) < 0.002, forms.coneRays);
  check('turned any way and scanned from all round, every pulse that lands on the cone lands on its surface',
    forms.coneAllRound.landed > 100 && forms.coneAllRound.offTheSurface === 0, forms.coneAllRound);

  const tumble = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab;
    d.clearLooseObjects();
    const runs = [];
    for (let run = 0; run < 2; run++) {
      const object = d.createLooseObject('testBox', spot.x, 1.4, spot.z, 0);
      d.setLooseObjectOrientation(object, 0.33, 0.1, 0.22, 0.91); // tipped over two of its edges
      object.spinX = 2; object.velocityX = 1.5;
      for (let step = 0; step < 240 && !object.isAsleep; step++) d.simulate(1 / 30);
      runs.push({ asleep: object.isAsleep, x: object.x, y: object.y, z: object.z, turned: [object.orientationX, object.orientationY, object.orientationZ, object.orientationW] });
      d.removeLooseObject(object);
    }
    return runs;
  }, spot);
  check('a box thrown down on a corner tumbles and ends up lying on one of its faces',
    tumble[0].asleep && TEST_OBJECT_KINDS.testBox.parts[0].half.some((half) => Math.abs(tumble[0].y - half) < 0.015), { y: tumble[0].y });
  check('the same throw twice ends in exactly the same place: nothing in how they move is left to chance',
    JSON.stringify(tumble[0]) === JSON.stringify(tumble[1]), tumble.map((run) => [run.x, run.y, run.z]));

  // --- on a table ---
  const table = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.looseLab;
    d.clearLooseObjects();
    // A flat top between knee and chest height, wide enough to put a case on, with nothing standing on it.
    for (const prop of d.worldProps) {
      if (prop.kind !== 0 || prop.isRemoved || prop.isDynamic || prop.halfX < 0.4 || prop.halfZ < 0.4) continue;
      if (prop.maximumY < 0.5 || prop.maximumY > 1.2) continue;
      const isClear = d.worldProps.every((other) => other === prop || other.isRemoved ||
        Math.abs(other.centerX - prop.centerX) > prop.boundsHalfX + other.boundsHalfX || Math.abs(other.centerZ - prop.centerZ) > prop.boundsHalfZ + other.boundsHalfZ ||
        other.maximumY <= prop.maximumY || other.minimumY > prop.maximumY + 0.8);
      if (!isClear) continue;
      const object = d.createLooseObject('testCase', prop.centerX, prop.maximumY + 0.4, prop.centerZ, 0);
      for (let step = 0; step < 150 && !object.isAsleep; step++) d.simulate(1 / 30);
      return { top: lab.round(prop.maximumY), restsAt: lab.round(object.y), asleep: object.isAsleep, drifted: lab.round(Math.hypot(object.x - prop.centerX, object.z - prop.centerZ)) };
    }
    return null;
  });
  check('a case dropped onto a table comes to rest on the table, not on the floor under it',
    table !== null && table.asleep && Math.abs(table.restsAt - table.top - TEST_OBJECT_KINDS.testCase.parts[0].half[1]) < 0.02 && table.drifted < 0.3, table);

  // --- thrown ---
  const thrown = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = {};
    for (const kindKey of ['testJar', 'testCapsule', 'testMotor']) {
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
  check('thrown as hard as you can, a light jar reaches the far wall and a capsule of three kilograms goes metres; nothing goes through a wall or the floor',
    ['testJar', 'testCapsule', 'testMotor'].every((key) => !thrown[key].leftTheOpen && thrown[key].asleep && thrown[key].furthest <= thrown[key].wallAt + 0.02 && thrown[key].knocks.heard >= 1) &&
    thrown.testJar.furthest > thrown.testJar.wallAt - 1.2 && thrown.testCapsule.furthest > 3, thrown);
  check('a heavy object leaves your hands slower and lands nearer than a light one',
    thrown.testMotor.leavesAt < thrown.testCapsule.leavesAt && thrown.testCapsule.leavesAt < thrown.testJar.leavesAt && thrown.testMotor.furthest < thrown.testJar.furthest, thrown);

  // A thrown object is a lure: the noise is where it lands, not where you stand.
  const lure = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player;
    d.clearLooseObjects();
    lab.stand(spot.x - 3, spot.z, Math.PI / 2);
    const object = lab.carry('testCapsule');
    // The Hollow stands seven metres to one side of you, far from where the capsule will come down.
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
  check('a capsule thrown across the room is a lure: the Hollow goes to look where it came down, not where you stand',
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
  check('it swings wide behind a quick turn, and the heavier it is the wider', carrying.testJar.turning > 0.3 && carrying.testMotor.turning > carrying.testJar.turning + 0.1, [carrying.testJar.turning, carrying.testMotor.turning]);

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
    const loose = d.createLooseObject('testBox', spot.x + 2, 0.5, spot.z, 0);
    for (let step = 0; step < 120 && !loose.isAsleep; step++) d.simulate(1 / 30);
    result.lyingAhead = { share: lab.coneShare(loose, 24), staysOnceAtRest: d.getLooseObjectPointLifeCode(loose) === 0 };
    return result;
  }, spot);
  const kindsCarried = Object.keys(blocking).filter((key) => key !== 'lyingAhead');
  check('what the beam holds hangs straight out from the scanner and is in its way: a big box takes nearly all of the normal beam, a jar or a thin rod a part of it',
    blocking.testBox.normal >= 0.85 && blocking.testMotor.normal >= 0.5 && blocking.testCase.normal >= 0.5 &&
    blocking.testJar.normal >= 0.1 && blocking.testJar.normal <= 0.6 && blocking.testRod.normal >= 0.05 && blocking.testRod.normal <= 0.4 &&
    kindsCarried.every((key) => blocking[key].normal > 0 && blocking[key].lookingDown > 0 && blocking[key].lookingUp > 0), blocking);
  check('a pulse that meets a carried object stops on it', kindsCarried.every((key) => blocking[key].narrow > 0 || blocking[key].normal > 0), kindsCarried);
  check('the wide beam sees round it, and the narrow beam least of all: every kind takes a smaller share of the wide beam than of the normal one',
    kindsCarried.every((key) => blocking[key].wide < blocking[key].normal && blocking[key].narrow >= blocking[key].normal) && blocking.testBox.wide < 0.8, blocking);
  check('points on a carried object fade, points on one lying still stay, and any of them out of your hands stops a pulse that meets it',
    Object.keys(blocking).filter((key) => key !== 'lyingAhead').every((key) => blocking[key].stopsAPulseOutOfYourHands && blocking[key].fadesWhileCarried) && blocking.lyingAhead.staysOnceAtRest, blocking.lyingAhead);

  // --- where the scanner's light comes from ---
  const bareWallForScanner = await inGame(() => { window.looseLab.reset(); return window.looseLab.findBareWall(); });
  const light = await inGame((bare) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = { offBy: [] };
    d.clearLooseObjects();
    const cast = function (fromEye, across, up) {
      const eyeY = d.getPlayerEyeY();
      d.computeScannerBasis(p.yaw, p.pitch);
      if (fromEye) d.updateScanEmitterAtEye(p.x, eyeY, p.z); else d.updateScanEmitterAtLens(p.x, eyeY, p.z);
      return d.castScannerPulse(across, up) ? { x: d.rayHit.x, y: d.rayHit.y, z: d.rayHit.z, looseObject: d.rayHit.looseObject } : null;
    };
    // You aim with your eyes: with nothing in the way, every pulse lands on the station where your eye sees it.
    lab.stand(bare.x + bare.stepX * (bare.wall - 3), bare.z + bare.stepZ * (bare.wall - 3), bare.yaw);
    for (const offset of [[0, 0], [0.19, 0], [-0.19, 0], [0, 0.19], [0, -0.19], [0.1, -0.12]]) {
      const seen = cast(true, offset[0], offset[1]), lit = cast(false, offset[0], offset[1]);
      result.offBy.push(seen && lit ? Math.hypot(seen.x - lit.x, seen.y - lit.y, seen.z - lit.z) : 99);
    }
    const emitter = d.scanEmitter, eyeY = d.getPlayerEyeY();
    result.lensFromTheEye = lab.round(Math.hypot(emitter.x - p.x, emitter.y - eyeY, emitter.z - p.z));
    result.lensBelowTheEye = lab.round(eyeY - emitter.y);
    // What the beam carries is tested from the lens: a pulse it stops lands on it, on the straight line from
    // the lens to the spot the pulse was going to.
    const going = cast(false, 0.02, -0.02);
    const box = lab.carry('testBox');
    const stopped = cast(false, 0.02, -0.02);
    const lens = { x: d.scanEmitter.x, y: d.scanEmitter.y, z: d.scanEmitter.z };
    const whole = Math.hypot(going.x - lens.x, going.y - lens.y, going.z - lens.z), part = stopped ? Math.hypot(stopped.x - lens.x, stopped.y - lens.y, stopped.z - lens.z) : 0;
    result.carried = { stopsThePulse: Boolean(stopped) && stopped.looseObject === box, metresFromTheLens: lab.round(part),
      offTheLine: stopped ? Math.hypot(lens.x + (going.x - lens.x) * part / whole - stopped.x, lens.y + (going.y - lens.y) * part / whole - stopped.y, lens.z + (going.z - lens.z) * part / whole - stopped.z) : 99,
      onTheBox: Boolean(stopped) && Math.hypot(stopped.x - box.x, stopped.y - box.y, stopped.z - box.z) < box.prepared.partsRadius + 0.01 };
    d.clearLooseObjects();
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
  check('you aim with your eyes: with nothing in the beam, every pulse lands exactly where your eye sees its place in the ring',
    light.offBy.every((metres) => metres < 1e-6), light.offBy);
  check('what the beam carries is tested from the lens, a forearm from your eyes: a pulse the box stops lands on the box, on the straight line from the lens to where it was going',
    light.lensFromTheEye > 0.5 && light.lensBelowTheEye > 0.1 && light.carried.stopsThePulse && light.carried.onTheBox && light.carried.offTheLine < 1e-6 && light.carried.metresFromTheLens < 1.6, light);
  check('with your face against a wall the scanner is held back out of it, and still paints', light.atTheWall.emitterInTheOpen && light.atTheWall.fromTheWall > 0.05 && light.atTheWall.paints, light.atTheWall);
  check('a pulse can be fired from anywhere, not only from the scanner: one fired straight down in mid-room leaves a point on the floor under it',
    light.fromAnywhere.landed && light.fromAnywhere.onTheFloor && light.fromAnywhere.pointsAdded === 1, light.fromAnywhere);

  // --- the scanner trails a little behind where you look (issue #55) ---
  const trailing = await inGame((bare) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, tuning = d.tuning, result = {};
    const degrees = 180 / Math.PI;
    d.clearLooseObjects();
    lab.stand(bare.x + bare.stepX * (bare.wall - 3), bare.z + bare.stepZ * (bare.wall - 3), bare.yaw);
    result.atRestDegrees = Math.abs(p.yaw - p.scannerYaw) * degrees + Math.abs(p.pitch - p.scannerPitch) * degrees;
    const ringAtRest = d.computeHeldScannerInView();
    result.ringAtRest = Math.hypot(ringAtRest[6], ringAtRest[7]);
    // A small turn to the right: the scanner is behind it, to the left, and its pulses with it.
    p.yaw += 5 / degrees;
    d.updateHeldScannerLag(1 / 60);
    result.behindAfterOneStepDegrees = (p.yaw - p.scannerYaw) * degrees;
    const ring = d.computeHeldScannerInView();
    result.ringIsToTheLeft = -ring[6] / ring[8] < -0.01;
    d.computeHeldScannerBasis();
    d.updateScanEmitterAtLens(p.x, d.getPlayerEyeY(), p.z);
    const lit = d.castScannerPulse(0, 0) ? { x: d.rayHit.x, y: d.rayHit.y, z: d.rayHit.z } : null;
    // Where your eye sees the middle of the ring: along the scanner's own direction, from the eye.
    const seen = d.castScannerRay(p.x, d.getPlayerEyeY(), p.z, Math.sin(p.scannerYaw) * Math.cos(p.scannerPitch), Math.sin(p.scannerPitch), -Math.cos(p.scannerYaw) * Math.cos(p.scannerPitch), 60)
      ? { x: d.rayHit.x, y: d.rayHit.y, z: d.rayHit.z } : null;
    result.pulseOffTheRing = lit && seen ? Math.hypot(lit.x - seen.x, lit.y - seen.y, lit.z - seen.z) : 99;
    for (let step = 0; step < 60; step++) d.updateHeldScannerLag(1 / 60);
    result.behindAfterASecondDegrees = Math.abs(p.yaw - p.scannerYaw) * degrees;
    // Spun right round and looking up at once: it is never further behind than the limit.
    p.yaw += 2.5; p.pitch = 0.6;
    d.updateHeldScannerLag(1 / 60);
    result.behindAfterASpinDegrees = Math.hypot(Math.atan2(Math.sin(p.yaw - p.scannerYaw), Math.cos(p.yaw - p.scannerYaw)), p.pitch - p.scannerPitch) * degrees;
    result.limitDegrees = tuning.scannerLagMaximumDegrees;
    p.pitch = 0; d.steadyHeldScanner();
    // Stepping to the right leaves it to the left; running forward brings it a little toward you.
    p.velocityX = Math.cos(p.yaw) * tuning.walkSpeed; p.velocityZ = Math.sin(p.yaw) * tuning.walkSpeed;
    for (let step = 0; step < 60; step++) d.updateHeldScannerLag(1 / 60);
    result.driftRightWhileSteppingRight = p.scannerDriftRight;
    p.velocityX = Math.sin(p.yaw) * tuning.sprintSpeed; p.velocityZ = -Math.cos(p.yaw) * tuning.sprintSpeed;
    for (let step = 0; step < 60; step++) d.updateHeldScannerLag(1 / 60);
    result.driftBackWhileRunning = p.scannerDriftBack;
    result.driftRightWhileRunning = p.scannerDriftRight;
    p.velocityX = 0; p.velocityZ = 0;
    for (let step = 0; step < 60; step++) d.updateHeldScannerLag(1 / 60);
    result.driftLeftStandingStill = Math.abs(p.scannerDriftRight) + Math.abs(p.scannerDriftBack);
    d.steadyHeldScanner();
    return result;
  }, bareWallForScanner);
  check('standing still the scanner points where you look and the ring is in the middle of the view',
    trailing.atRestDegrees < 0.01 && trailing.ringAtRest < 1e-4, trailing);
  check('the scanner trails a turn: a step after turning it is behind, the ring is on the side you turned from, and a second later it has caught up',
    trailing.behindAfterOneStepDegrees > 1 && trailing.behindAfterOneStepDegrees < 5 && trailing.ringIsToTheLeft && trailing.behindAfterASecondDegrees < 0.01, trailing);
  check('the pulses go with the scanner: the middle one lands exactly where your eye sees the middle of the ring',
    trailing.pulseOffTheRing < 1e-6, trailing.pulseOffTheRing);
  check('however fast you turn, the scanner is never further behind than its limit',
    trailing.behindAfterASpinDegrees <= trailing.limitDegrees + 1e-6 && trailing.behindAfterASpinDegrees > trailing.limitDegrees - 0.5, trailing);
  check('a step to the side leaves the scanner a few centimetres behind, running brings it a little toward you, and standing still it comes back',
    trailing.driftRightWhileSteppingRight < -0.02 && trailing.driftRightWhileSteppingRight > -0.08 && trailing.driftBackWhileRunning > 0.01 && trailing.driftBackWhileRunning < 0.04 &&
    Math.abs(trailing.driftRightWhileRunning) < 0.002 && trailing.driftLeftStandingStill < 0.001, trailing);

  // --- knocks ---
  const bareWall = await inGame(() => { window.looseLab.reset(); return window.looseLab.findBareWall(); });
  check('Kessel-9 has a bare wall with a clear run up to it and no door near', bareWall !== null, bareWall);
  // Carried into that wall at a walk, crouched, and at a run. The Hollow stands four metres off to one side, listening.
  const intoWall = await inGame((bare) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = {};
    const wallX = bare.x + bare.stepX * bare.wall, wallZ = bare.z + bare.stepZ * bare.wall;
    for (const kindKey of ['testCapsule', 'testBox', 'testRod']) {
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
    ['testCapsule walking', 'testBox walking', 'testRod walking'].every((key) => intoWall[key].knocks.heard === 1 && intoWall[key].knocks.quiet <= 1 && intoWall[key].noiseCarries > 4 && intoWall[key].knockAtTheWall && intoWall[key].yours && intoWall[key].hollowCameToLook && intoWall[key].saidSo === 1), intoWall);
  check('crouched, the same walk into the same wall is a tap the Hollow does not hear',
    ['testCapsule crouched', 'testBox crouched', 'testRod crouched'].every((key) => intoWall[key].knocks.heard === 0 && intoWall[key].knocks.quiet >= 1 && intoWall[key].knocks.quiet <= 2 && intoWall[key].noiseCarries === 0 && !intoWall[key].hollowCameToLook && intoWall[key].saidSo === 0), intoWall);
  check('a heavy box carries further than a light capsule at the same pace', intoWall['testBox walking'].noiseCarries > intoWall['testCapsule walking'].noiseCarries,
    [intoWall['testCapsule walking'].noiseCarries, intoWall['testBox walking'].noiseCarries]);
  // Against something straight ahead the beam gives: the thing comes nearer to you, and you can walk right up.
  // (The beam is 0.7 m long, and it used to hold you off the wall by that much and the size of the thing.)
  check('walked into a wall, what you carry comes in close and stays in the beam: with a small capsule you reach the wall, with a big box you stop where the box is between you and it; you are not pushed sideways',
    ['testCapsule walking', 'testBox walking', 'testRod walking', 'testBox crouched', 'testCapsule running', 'testRod running'].every((key) => intoWall[key].stillHeld && intoWall[key].knocks.pulled === 0 && intoWall[key].sideways < 0.2) &&
    intoWall['testCapsule walking'].fromWall < 0.5 && intoWall['testBox walking'].fromWall > 0.6 && intoWall['testBox walking'].fromWall < 1.0 && intoWall['testRod walking'].fromWall < 1.05, intoWall);
  check('run at the wall with a long thin rod and it clatters, and is still in the beam', intoWall['testRod running'].stillHeld && intoWall['testRod running'].knocks.heard >= 1 && intoWall['testRod running'].fromWall < 0.6, intoWall['testRod running']);

  // The beam shortens, and lets out again when there is room.
  const beamGives = await inGame((bare) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = {};
    d.clearLooseObjects();
    lab.stand(bare.x + bare.stepX * (bare.wall - 2.9), bare.z + bare.stepZ * (bare.wall - 2.9), bare.yaw);
    const object = lab.carry('testCase');
    const fromLens = function () { return lab.round(Math.hypot(object.x - d.scanEmitter.x, object.y - d.scanEmitter.y, object.z - d.scanEmitter.z) - object.prepared.partsRadius); };
    result.inTheOpen = { length: lab.round(d.looseState.holdLength), fromLens: fromLens() };
    d.input.keysDown.add('KeyW');
    d.simulate(3.5);
    d.input.keysDown.clear();
    d.simulate(0.5);
    const along = (p.x - bare.x) * bare.stepX + (p.z - bare.z) * bare.stepZ;
    result.atTheWall = { length: lab.round(d.looseState.holdLength), fromLens: fromLens(), youFromWall: lab.round(bare.wall - along), held: d.getHeldLooseObject() === object };
    d.input.keysDown.add('KeyS');
    d.simulate(1.2);
    d.input.keysDown.clear();
    d.simulate(1.2);
    result.backedAway = { length: lab.round(d.looseState.holdLength), fromLens: fromLens(), held: d.getHeldLooseObject() === object };
    result.full = d.tuning.looseHoldDistance; result.shortest = d.tuning.looseHoldShortestDistance;
    return result;
  }, bareWall);
  check('against a wall the beam holds the thing nearer, down to its shortest; back away and it lets it out to its full length again',
    beamGives.inTheOpen.length === beamGives.full && beamGives.atTheWall.held && beamGives.atTheWall.length < beamGives.full - 0.2 && beamGives.atTheWall.length >= beamGives.shortest &&
    beamGives.atTheWall.fromLens < beamGives.inTheOpen.fromLens - 0.2 && beamGives.backedAway.held && beamGives.backedAway.length === beamGives.full && Math.abs(beamGives.backedAway.fromLens - beamGives.inTheOpen.fromLens) < 0.1, beamGives);

  // What the beam still loses: a thing left behind something. You stand in front of the wall beside a doorway
  // with a capsule in the beam, and are then on the other side of that wall (the test puts you there in one
  // step, as a corner turned too sharply would): the capsule is against the wall, and the beam lets it go.
  const leftBehind = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = { found: false };
    lab.reset();
    d.game.flags.powerOn = true;
    const isPlain = function (x, z) { const spot = d.findWalkableSpotNear(x, z); return Boolean(spot) && spot.x === x && spot.z === z && Math.abs(d.getFloorHeightAt(x, z)) < 0.01 && d.getTileFlagsAt(x, z) === 0; };
    // (The door's own frame does not count: it stands proud of the wall by five centimetres and stops nobody.)
    const clearOfThings = function (x, z) { return d.worldProps.every((prop) => prop.isRemoved || prop.isDynamic || !prop.blocksMovement || prop.minimumY > 2.2 || prop.maximumY < 0.03 || Math.abs(prop.centerX - x) > prop.boundsHalfX + 0.75 || Math.abs(prop.centerZ - z) > prop.boundsHalfZ + 0.75); };
    for (const door of d.doors) {
      if (door.kind !== d.doorKinds.automatic || result.found) continue;
      for (const step of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        // Beside the door, a tile and a bit to one side: floor on both sides of the wall there, two tiles deep, and nothing standing on it.
        const sideX = -step[1], sideZ = step[0];
        const spots = [-2, -1, 1, 2].map((along) => [door.centerX + step[0] * along + sideX, door.centerZ + step[1] * along + sideZ]);
        if (!spots.every((spot) => isPlain(spot[0], spot[1]) && clearOfThings(spot[0], spot[1]))) continue;
        if (d.isSpaceOpenAt(door.centerX + sideX, 1, door.centerZ + sideZ)) continue; // there must be wall beside the door
        result.found = true;
        lab.stand(door.centerX - step[0] * 1.6 + sideX, door.centerZ - step[1] * 1.6 + sideZ, Math.atan2(step[0], -step[1]));
        const capsule = lab.carry('testCapsule');
        d.simulate(0.5);
        const before = lab.knocks();
        result.inFrontOfTheWall = { held: d.getHeldLooseObject() === capsule };
        d.teleport(door.centerX + step[0] * 1.6 + sideX, door.centerZ + step[1] * 1.6 + sideZ);
        d.simulate(2.5);
        const side = (capsule.x - door.centerX) * step[0] + (capsule.z - door.centerZ) * step[1];
        result.behindIt = { stillHeld: d.getHeldLooseObject() === capsule, capsuleOnTheFirstSide: side < 0, knocks: lab.since(before), messages: lab.messages() };
        break;
      }
    }
    return result;
  });
  check('with a wall between you and what you carry, the beam loses it, and says so',
    leftBehind.found && leftBehind.inFrontOfTheWall.held && !leftBehind.behindIt.stillHeld && leftBehind.behindIt.capsuleOnTheFirstSide && leftBehind.behindIt.knocks.pulled === 1 &&
    leftBehind.behindIt.messages.some((text) => text.indexOf('The beam loses the ' + TEST_OBJECT_KINDS.testCapsule.label) >= 0), leftBehind);

  const settingDown = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = {};
    for (const how of ['standing', 'crouched and low']) {
      d.clearLooseObjects();
      lab.stand(spot.x, spot.z, Math.PI / 2);
      if (how !== 'standing') { d.input.keysDown.add('KeyC'); d.simulate(0.8); }
      const object = lab.carry('testCase');
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
  check('let go of standing up, a case is heard landing; set down from a crouch, looking at the floor, it is not',
    settingDown.standing.knocks.heard >= 1 && settingDown['crouched and low'].knocks.heard === 0 && settingDown['crouched and low'].asleep, settingDown);

  // --- kicked ---
  const kicked = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = {};
    d.clearLooseObjects();
    lab.stand(spot.x - 2, spot.z, Math.PI / 2);
    const object = d.createLooseObject('testCapsule', spot.x, 0.3, spot.z, 0);
    d.setLooseObjectOrientation(object, 0.7071, 0, 0, 0.7071); // lying on its side
    for (let step = 0; step < 150 && !object.isAsleep; step++) d.simulate(1 / 30);
    result.layStill = object.isAsleep;
    result.stopsYouFrom = d.tuning.looseShoveBlockMass; // what weighs this much or more stops you
    let before = lab.knocks();
    const fromX = object.x;
    d.input.keysDown.add('KeyW');
    d.simulate(1.6);
    d.input.keysDown.clear();
    result.byYou = { moved: lab.round(object.x - fromX), knocks: lab.since(before), saidAsYours: d.captionCounts.ownObjectKnock + d.captionCounts.ownObjectCrash + d.captionCounts.ownObjectKicked, playerPassed: p.x > fromX };
    for (let step = 0; step < 240 && !object.isAsleep; step++) d.simulate(1 / 30);
    // Now the Hollow walks through it, while you stand well back and have not touched it for a while.
    lab.stand(object.x - 6, object.z, Math.PI / 2);
    d.simulate(4.5);
    for (let step = 0; step < 240 && !object.isAsleep; step++) d.simulate(1 / 30);
    d.spawnHollow(object.x, object.z - 2);
    before = lab.knocks();
    lab.noises.length = 0;
    for (const key of ['objectKnock', 'objectCrash', 'ownObjectKnock', 'ownObjectCrash', 'ownObjectKicked']) d.captionCounts[key] = 0;
    const startX = object.x, startZ = object.z;
    for (let step = 0; step < 60; step++) { d.hollow.figure.z += 3.2 / 30; d.simulate(1 / 30); }
    result.byTheHollow = { moved: lab.round(Math.hypot(object.x - startX, object.z - startZ)), knocks: lab.since(before),
      noiseAtTheObject: lab.noises.some((noise) => Math.hypot(noise.x - startX, noise.z - startZ) < 1.5),
      saidWithADirection: d.captionCounts.objectKnock + d.captionCounts.objectCrash, saidAsYours: d.captionCounts.ownObjectKnock + d.captionCounts.ownObjectCrash + d.captionCounts.ownObjectKicked };
    d.hollow.isActive = false;
    return result;
  }, spot);
  check('a capsule of three kilograms, lighter than what stops you, lying on the floor is kicked along when you walk into it, and does not stop you', TEST_OBJECT_KINDS.testCapsule.mass < kicked.stopsYouFrom && kicked.layStill && kicked.byYou.moved > 0.3 && kicked.byYou.playerPassed && kicked.byYou.knocks.heard >= 1 && kicked.byYou.saidAsYours >= 1, [kicked.byYou, kicked.stopsYouFrom]);
  check('the Hollow kicks it too: you hear that, captioned as something out there and not as yours, and the Hollow is not startled by a noise of its own making',
    kicked.byTheHollow.moved > 0.3 && kicked.byTheHollow.knocks.heard >= 1 && !kicked.byTheHollow.noiseAtTheObject && kicked.byTheHollow.saidWithADirection >= 1 && kicked.byTheHollow.saidAsYours === 0, kicked.byTheHollow);

  // --- how it is turned ---
  const turned = await inGame(([spot, bare]) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = {};
    lab.reset();
    // The angle between the rod's length and your right-hand side, in degrees, 0 to 90: 0 is square across you.
    const acrossYou = function (object) {
      const lengthX = object.matrix[0], lengthZ = object.matrix[6], rightX = Math.cos(p.yaw), rightZ = Math.sin(p.yaw);
      const cosine = Math.abs(lengthX * rightX + lengthZ * rightZ) / Math.hypot(lengthX, lengthZ);
      return Math.round(Math.acos(Math.min(1, cosine)) * 180 / Math.PI);
    };
    // A rod lying on the floor a step and a half ahead, at an angle to you, taken into the beam.
    const takeUp = function (x, z, yaw) {
      d.clearLooseObjects();
      lab.stand(x, z, yaw);
      const rod = d.createLooseObject('testRod', x + Math.sin(yaw) * 1.4, 0.2, z - Math.cos(yaw) * 1.4, yaw + 0.5);
      for (let step = 0; step < 150 && !rod.isAsleep; step++) d.simulate(1 / 30);
      const lying = acrossYou(rod);
      d.pickUpLooseObject(rod);
      d.simulate(2.5);
      return { rod: rod, lying: lying };
    };
    // In the open: the beam takes it as it lies, and it comes round with you when you turn.
    let taken = takeUp(spot.x, spot.z, Math.PI / 2);
    result.lying = taken.lying;
    result.takenUp = { angle: acrossYou(taken.rod), level: Math.abs(taken.rod.matrix[3]) < 0.1 };
    for (let step = 0; step < 30; step++) { p.yaw += Math.PI / 60; d.simulate(1 / 30); } // a quarter turn in a second
    d.simulate(2.5);
    result.afterAQuarterTurn = { angle: acrossYou(taken.rod), stillHeld: d.getHeldLooseObject() === taken.rod };
    // At the bare wall: walk it, crouched, against the wall. One end meets the wall first and the wall turns it.
    taken = takeUp(bare.x + bare.stepX * (bare.wall - 3.1), bare.z + bare.stepZ * (bare.wall - 3.1), bare.yaw);
    result.atTheWall = { before: acrossYou(taken.rod) };
    const before = lab.knocks();
    d.input.keysDown.add('KeyW'); d.input.keysDown.add('KeyC');
    d.simulate(5);
    d.input.keysDown.clear();
    result.atTheWall.against = acrossYou(taken.rod);
    result.atTheWall.stillHeld = d.getHeldLooseObject() === taken.rod;
    result.atTheWall.knocks = lab.since(before);
    // Back off: it stays as the wall left it.
    d.input.keysDown.add('KeyS');
    d.simulate(1);
    d.input.keysDown.clear();
    d.simulate(2.5);
    result.atTheWall.backedOff = acrossYou(taken.rod);
    result.atTheWall.stillHeldAfter = d.getHeldLooseObject() === taken.rod;
    return result;
  }, [spot, bareWallForScanner]);
  check('the beam takes a thing as it lies, without straightening it, and it comes round with you when you turn',
    turned.lying > 20 && Math.abs(turned.takenUp.angle - turned.lying) <= 8 && turned.afterAQuarterTurn.stillHeld && Math.abs(turned.afterAQuarterTurn.angle - turned.lying) <= 8, turned);
  // (Even crouched this is not silent every time: as the wall turns the rod, its far end comes round faster than you walk.)
  check('walked against a wall, a long rod held at an angle is turned by the wall, with one knock at most, and it stays as the wall left it',
    turned.atTheWall.stillHeld && turned.atTheWall.against < turned.atTheWall.before - 15 && turned.atTheWall.knocks.heard <= 1 &&
    turned.atTheWall.stillHeldAfter && Math.abs(turned.atTheWall.backedOff - turned.atTheWall.against) <= 8, turned.atTheWall);

  // --- a pile ---
  const pile = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, result = {};
    lab.reset();
    d.clearLooseObjects();
    lab.stand(spot.x - 2.6, spot.z, Math.PI / 2);
    const kinds = ['testBox', 'testCase', 'testCapsule', 'testBox', 'testJar', 'testMotor', 'testCase', 'testCapsule', 'testRod', 'testJar'];
    const started = performance.now();
    for (let index = 0; index < kinds.length; index++) {
      d.createLooseObject(kinds[index], spot.x + (index % 3 - 1) * 0.12, 1.6, spot.z + (index % 2 - 0.5) * 0.12, index * 0.9);
      d.simulate(0.5);
    }
    let settledAfter = -1;
    for (let step = 0; step < 300; step++) {
      d.simulate(1 / 30);
      if (settledAfter < 0 && d.looseObjects.every((object) => object.isAsleep)) settledAfter = lab.round((step + 1) / 30);
    }
    const describe = function () {
      return { atRest: d.looseObjects.filter((object) => object.isAsleep).length, of: d.looseObjects.length,
        lowest: lab.round(Math.min.apply(null, d.looseObjects.map((object) => object.y))), highest: lab.round(Math.max.apply(null, d.looseObjects.map((object) => object.y))),
        widest: lab.round(Math.max.apply(null, d.looseObjects.map((object) => Math.hypot(object.x - spot.x, object.z - spot.z)))),
        allInTheOpen: d.looseObjects.every((object) => lab.isInTheOpen(object.x, object.y, object.z)),
        allNumbers: d.looseObjects.every((object) => [object.x, object.y, object.z, object.orientationW].every(Number.isFinite)) };
    };
    result.dropped = describe();
    result.dropped.settledAfter = settledAfter;
    result.dropped.milliseconds = Math.round(performance.now() - started);
    // Something is lying on something: take the thing underneath away and what was on it comes down. Of all the
    // things that have another one over them (higher, and within a hand's breadth of straight above), the one
    // that has it most squarely over it: that one is certainly lying on it, however the heap fell this time.
    let lowest = null, nearestOver = 0.2;
    for (const under of d.looseObjects) {
      for (const over of d.looseObjects) {
        const aside = Math.hypot(over.x - under.x, over.z - under.z);
        if (over !== under && over.y > under.y + 0.05 && aside < nearestOver) { nearestOver = aside; lowest = under; }
      }
    }
    if (!lowest) lowest = d.looseObjects.slice().sort((a, b) => a.y - b.y)[0];
    const above = d.looseObjects.filter((object) => object !== lowest && object.y > lowest.y + 0.05 && Math.hypot(object.x - lowest.x, object.z - lowest.z) <= nearestOver);
    result.somethingOnTop = above.length;
    const heights = above.map((object) => object.y);
    d.removeLooseObject(lowest);
    d.simulate(0.2);
    result.wokeWhenItWent = above.some((object) => !object.isAsleep);
    for (let step = 0; step < 300 && !d.looseObjects.every((object) => object.isAsleep); step++) d.simulate(1 / 30);
    result.cameDown = above.some((object, index) => object.y < heights[index] - 0.05);
    result.afterwards = describe();
    result.putBack = d.looseState.statistics.putBack;
    return result;
  }, spot);
  check('ten things dropped onto one spot make a heap that comes to rest, with nothing through the floor and nothing lost',
    pile.dropped.atRest === pile.dropped.of && pile.dropped.settledAfter >= 0 && pile.dropped.settledAfter <= 8 && pile.dropped.lowest > 0.02 &&
    pile.dropped.highest > 0.3 && pile.dropped.widest < 3 && pile.dropped.allInTheOpen && pile.dropped.allNumbers && pile.putBack === 0, pile.dropped);
  check('take a thing out from under another in the heap and what lay on it wakes, comes down and comes to rest again',
    pile.somethingOnTop >= 1 && pile.wokeWhenItWent && pile.cameDown && pile.afterwards.atRest === pile.afterwards.of && pile.afterwards.allInTheOpen, pile);

  // --- a crate that holds things ---
  // Two loose things touch each other's boxes as they are, flat faces and all (against the station a thing
  // touches with the balls of its shell, which leave gaps a can goes through). So an open crate holds what is put
  // in it, carries it, and spills it when it goes over. The crate here is the tests' own (tools/test-objects.js): five boards.
  await installTestObjectKinds(page, ['testCrate']);
  const crated = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = {};
    // Where a thing is in the crate's own frame, from the middle of the top of its bottom board.
    const inCrate = function (thing, crate) {
      const m = crate.matrix, board = crate.prepared.boxes[4], x = thing.x - crate.x, y = thing.y - crate.y, z = thing.z - crate.z;
      return { x: m[0] * x + m[3] * y + m[6] * z - board.centerX, y: m[1] * x + m[4] * y + m[7] * z - board.centerY - board.halfY, z: m[2] * x + m[5] * y + m[8] * z - board.centerZ };
    };
    const isInIt = function (thing, crate) {
      const at = inCrate(thing, crate);
      return d.looseObjects.indexOf(thing) >= 0 && Math.abs(at.x) < 0.23 && Math.abs(at.z) < 0.23 && at.y > -0.01 && at.y < 0.6;
    };
    // The lowest point of a thing, above the top of the crate's bottom board (in the world: the crate stands level).
    const aboveTheBoard = function (thing, crate) {
      const shell = thing.prepared.shell, m = thing.matrix, board = crate.prepared.boxes[4];
      let lowest = Infinity;
      for (let ball = 0; ball < thing.prepared.shellCount; ball++) lowest = Math.min(lowest, thing.y + m[3] * shell[ball * 4] + m[4] * shell[ball * 4 + 1] + m[5] * shell[ball * 4 + 2] - shell[ball * 4 + 3]);
      return lowest - (crate.y + board.centerY + board.halfY);
    };
    const untilAtRest = function (seconds) {
      for (let step = 0; step < seconds * 30; step++) { d.simulate(1 / 30); if (d.looseObjects.every((object) => object.isAsleep)) return lab.round((step + 1) / 30); }
      return -1;
    };

    // One thing let go of in it, with the crate made first and with the thing made first (the one made later is
    // the one that notes what the two do to each other).
    result.letGoOf = {};
    for (const kindKey of ['testTin', 'testJar', 'testCapsule', 'testRod']) {
      for (const isCrateFirst of [true, false]) {
        d.clearLooseObjects();
        lab.stand(spot.x - 2.5, spot.z, Math.PI / 2);
        let crate = isCrateFirst ? d.createLooseObject('testCrate', spot.x, 0.25, spot.z, 0) : null;
        const thing = d.createLooseObject(kindKey, spot.x + 0.04, 0.6, spot.z + 0.03, 0.3);
        if (!crate) crate = d.createLooseObject('testCrate', spot.x, 0.25, spot.z, 0);
        const atRestAfter = untilAtRest(8);
        result.letGoOf[kindKey + (isCrateFirst ? ', crate first' : ', thing first')] = { isInIt: isInIt(thing, crate), aboveTheBoard: lab.round(aboveTheBoard(thing, crate)), atRestAfter: atRestAfter,
          crateMoved: lab.round(Math.hypot(crate.x - spot.x, crate.z - spot.z)) };
      }
    }

    // Filled, picked up, walked with, stood with, turned with, walked on with.
    d.clearLooseObjects();
    lab.stand(spot.x - 2.5, spot.z, Math.PI / 2);
    p.pitch = -0.3;
    const crate = d.createLooseObject('testCrate', spot.x - 1.1, 0.25, spot.z, 0);
    d.simulate(1);
    const contents = ['testTin', 'testTin', 'testTin', 'testJar', 'testCapsule'];
    const things = contents.map((kindKey, index) => d.createLooseObject(kindKey, crate.x + [-0.12, 0.12, -0.12, 0.12, 0][index], crate.y + (index < 4 ? 0 : 0.3), crate.z + [-0.12, -0.12, 0.12, 0.12, 0][index], index));
    const weight = things.reduce((sum, thing) => sum + thing.kind.mass, 0);
    result.filled = { atRestAfter: untilAtRest(8), inIt: things.filter((thing) => isInIt(thing, crate)).length, of: things.length };
    const before = lab.knocks();
    d.pickUpLooseObject(crate, false);
    d.simulate(1.5);
    let asleepWhileCarried = 0, fewestInIt = things.length;
    const carryFor = function (seconds, turn) {
      for (let step = 0; step < seconds * 30; step++) {
        if (turn) p.yaw += turn / (seconds * 30);
        d.simulate(1 / 30);
        asleepWhileCarried = Math.max(asleepWhileCarried, things.filter((thing) => thing.isAsleep).length);
        fewestInIt = Math.min(fewestInIt, things.filter((thing) => isInIt(thing, crate)).length);
      }
    };
    result.pickedUp = { held: d.getHeldLooseObject() === crate, liftedBy: lab.round(crate.y - 0.22), inIt: things.filter((thing) => isInIt(thing, crate)).length };
    d.input.keysDown.add('KeyW'); carryFor(0.7);
    result.walking = { speed: lab.round(Math.hypot(p.velocityX, p.velocityZ)), wantedSpeed: lab.round(d.tuning.walkSpeed / (1 + (crate.kind.mass + weight) * d.tuning.carrySlowdownPerKilogram)), emptyHanded: d.tuning.walkSpeed };
    d.input.keysDown.clear(); carryFor(3);
    result.standing = { load: lab.round(d.looseState.heldLoad), weight: lab.round(weight), speedFactor: lab.round(d.getCarrySpeedFactor()) };
    carryFor(1.2, Math.PI / 2);
    d.input.keysDown.add('KeyW'); carryFor(0.5);
    d.input.keysDown.clear(); carryFor(0.6);
    result.carried = { held: d.getHeldLooseObject() === crate, fewestInIt: fewestInIt, asleepWhileCarried: asleepWhileCarried, knocks: lab.since(before) };
    // Set down: look at the floor, let go. It all comes to rest in it.
    for (let step = 0; step < 30; step++) { p.pitch += (-0.75 - p.pitch) * 0.2; d.simulate(1 / 30); }
    d.releaseHeldLooseObject(0);
    result.setDown = { atRestAfter: untilAtRest(10), inIt: things.filter((thing) => isInIt(thing, crate)).length, load: d.looseState.heldLoad, speedFactor: d.getCarrySpeedFactor() };
    // Tipped right over: it spills.
    d.setLooseObjectOrientation(crate, Math.sin(1.15), 0, 0, Math.cos(1.15));
    crate.y += 0.45;
    d.wakeLooseObject(crate);
    for (const thing of things) d.wakeLooseObject(thing);
    // (Some of it may lie under the crate, if that ends upside down over it: it is on the floor all the same.)
    result.tippedOver = { atRestAfter: untilAtRest(12), crateStandsUpright: lab.round(crate.matrix[4]),
      onTheFloor: things.filter((thing) => thing.y < thing.prepared.boundsRadius + 0.06).length, allInTheOpen: d.looseObjects.every((object) => lab.isInTheOpen(object.x, object.y, object.z)) };

    // Flat faces: one closed box set down on another stands on it, level.
    d.clearLooseObjects();
    const lower = d.createLooseObject('testBox', spot.x, 0.23, spot.z, 0);
    d.simulate(1);
    const upper = d.createLooseObject('testBox', spot.x + 0.03, lower.y + 0.47, spot.z + 0.02, 0.2);
    const stackedAfter = untilAtRest(8);
    result.stacked = { atRestAfter: stackedAfter, apart: lab.round(upper.y - lower.y), tilt: lab.round(Math.acos(Math.min(1, upper.matrix[4])) * 180 / Math.PI), aside: lab.round(Math.hypot(upper.x - lower.x, upper.z - lower.z)) };

    d.clearLooseObjects();
    p.pitch = 0;
    return result;
  }, spot);
  await removeTestObjectKinds(page, ['testCrate']);
  check('what is let go of in an open crate lies on its bottom board, not in it or under it, whichever of the two was made first: a small tin, a jar, a capsule, a rod longer than the crate is wide',
    Object.keys(crated.letGoOf).every((key) => { const entry = crated.letGoOf[key]; return (entry.isInIt || key.indexOf('testRod') === 0) && entry.aboveTheBoard > -0.006 && entry.atRestAfter >= 0 && entry.crateMoved < 0.1; }) &&
    crated.letGoOf['testRod, crate first'].aboveTheBoard > 0.1 && crated.letGoOf['testRod, thing first'].aboveTheBoard > 0.1, crated.letGoOf);
  check('a crate with three small tins, a jar and a capsule in it is picked up with all of it in it, and carried: walked with, stood with, turned and walked on with, nothing falls out and the beam keeps hold',
    crated.filled.inIt === crated.filled.of && crated.filled.atRestAfter >= 0 && crated.pickedUp.held && crated.pickedUp.liftedBy > 0.08 && crated.pickedUp.inIt === 5 &&
    crated.carried.held && crated.carried.fewestInIt === 5 && crated.carried.knocks.pulled === 0, [crated.filled, crated.pickedUp, crated.carried]);
  check('what rides in a carried crate does not come to rest in it, and its weight is yours: the beam bears it to within a tenth, and you walk as slowly as with one thing that heavy',
    crated.carried.asleepWhileCarried === 0 && Math.abs(crated.standing.load - crated.standing.weight) < crated.standing.weight * 0.1 &&
    Math.abs(crated.walking.speed - crated.walking.wantedSpeed) < 0.12 && crated.walking.wantedSpeed < crated.walking.emptyHanded - 0.3, [crated.standing, crated.walking, crated.carried]);
  check('set down, it all comes to rest in the crate, and the weight is off you',
    crated.setDown.atRestAfter >= 0 && crated.setDown.inIt === 5 && crated.setDown.load === 0 && crated.setDown.speedFactor === 1, crated.setDown);
  check('tipped right over, it spills: the crate ends on its side or on its top, all that was in it lies on the floor, and everything comes to rest',
    crated.tippedOver.crateStandsUpright < 0.3 && crated.tippedOver.onTheFloor === 5 && crated.tippedOver.atRestAfter >= 0 && crated.tippedOver.allInTheOpen, crated.tippedOver);
  check('one box set down on another stands on it level: as far apart as a box is high, not tilted, not slid off',
    crated.stacked.atRestAfter >= 0 && Math.abs(crated.stacked.apart - 2 * TEST_OBJECT_KINDS.testBox.parts[0].half[1]) < 0.012 && crated.stacked.tilt < 2 && crated.stacked.aside < 0.08, crated.stacked);

  // --- a door ---
  const wedged = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = {};
    lab.reset();
    d.clearLooseObjects();
    const door = d.doors.find((candidate) => candidate.kind === 0 && candidate.forcedState === null);
    const alongX = door.slab.halfX < door.slab.halfZ ? 1 : 0, alongZ = 1 - alongX; // the way through the door
    const near = function () { d.teleport(door.centerX - alongX * 1.2, door.centerZ - alongZ * 1.2, Math.atan2(alongX, -alongZ)); d.simulate(1.5); };
    const away = function () { d.teleport(door.centerX - alongX * 7, door.centerZ - alongZ * 7, 0); d.simulate(4); };
    near();
    result.opensForYou = door.openFraction;
    away();
    result.closesBehindYou = door.openFraction;
    near();
    const object = d.createLooseObject('testWeight', door.centerX, 0.4, door.centerZ, 0);
    for (let step = 0; step < 150 && !object.isAsleep; step++) d.simulate(1 / 30);
    away();
    result.wedged = { open: door.openFraction, objectStill: object.isAsleep, inTheDoorway: Math.hypot(object.x - door.centerX, object.z - door.centerZ) < 0.6 };
    // Take it out of the doorway and the door closes.
    d.removeLooseObject(object);
    d.simulate(4);
    result.afterItIsGone = door.openFraction;
    return result;
  });
  check('a door opens for you and closes behind you; with something lying in the doorway it waits, open; take the thing away and it closes',
    wedged.opensForYou === 1 && wedged.closesBehindYou === 0 && wedged.wedged.open === 1 && wedged.wedged.objectStill && wedged.wedged.inTheDoorway && wedged.afterItIsGone === 0, wedged);

  // --- thrown about at random ---
  const stations = [['classic', 0], ['generated', 2, 'medium', 'mixed', 'two'], ['generated', 5, 'large', 'mixed', 'two']];
  for (const station of stations) {
    const storm = await inGame(([station, testKinds]) => {
      const d = window.lastReturnDebug, lab = window.looseLab;
      d.loadStation.apply(null, station);
      d.clearLooseObjects();
      d.game.flags.hasLeftLift = true;
      d.setDebugOption('freezeCreatures', true); d.hollow.isActive = false;
      d.input.keysDown.clear();
      // Chance that is the same every run.
      let seed = 12345 + station[1] * 977;
      const chance = function () { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const places = [];
      // Anywhere there is floor to stand on. (Not simply any open tile: one with a pump or a cabinet on it would
      // start a thing off inside the machine, which is not throwing it, and it is squeezed down into the floor.)
      for (let z = 2; z < 300; z++) for (let x = 2; x < 300; x++) {
        if (!d.isSpaceOpenAt(x + 0.5, 1, z + 0.5) || (d.getTileFlagsAt(x + 0.5, z + 0.5) & d.tileFlagPit)) continue;
        const spot = d.findWalkableSpotNear(x + 0.5, z + 0.5);
        if (spot && spot.x === x + 0.5 && spot.z === z + 0.5) places.push([x + 0.5, z + 0.5]);
      }
      // Every kind of the game's own, and of the test objects only the drum, the cone and the ball (shapes and a
      // bounce the game's own may not have): so each of the game's kinds gets as many of the throws as it always had.
      const kinds = Object.keys(d.looseObjectKinds).filter((kindKey) => testKinds.indexOf(kindKey) < 0 || ['testDrum', 'testCone', 'testBall'].indexOf(kindKey) >= 0), thrown = [];
      const statistics = d.looseState.statistics, lostBefore = statistics.lostDownThePit, putBackBefore = statistics.putBack;
      const started = performance.now();
      let stillMoving = 0, outside = 0, notNumbers = 0, count = 0;
      for (let batch = 0; batch < 4; batch++) {
        d.clearLooseObjects();
        for (let index = 0; index < 30; index++) {
          let place = places[Math.floor(chance() * places.length)];
          const kindKey = kinds[Math.floor(chance() * kinds.length)];
          // Something too big to be in a vent at all (a vent cover is bigger than the vent it covers) is not started
          // off inside one: that is not throwing it, and it is squeezed into the rock there. It gets another place.
          while (d.isVentAt(place[0], place[1]) && d.looseObjectKinds[kindKey].prepared.boundsRadius > 0.7) place = places[Math.floor(chance() * places.length)];
          const floor = d.getFloorHeightAt(place[0], place[1]);
          const object = d.createLooseObject(kindKey, place[0], floor + 0.7 + chance() * 0.6, place[1], chance() * 6);
          d.setLooseObjectOrientation(object, chance() - 0.5, chance() - 0.5, chance() - 0.5, chance() - 0.5);
          const speed = 2 + chance() * 11, heading = chance() * Math.PI * 2, climb = (chance() - 0.5) * 2;
          object.velocityX = Math.cos(heading) * speed; object.velocityZ = Math.sin(heading) * speed; object.velocityY = climb * speed * 0.6;
          object.spinX = (chance() - 0.5) * 30; object.spinY = (chance() - 0.5) * 30; object.spinZ = (chance() - 0.5) * 30;
          thrown.push(object);
        }
        // Twenty seconds at most: something round that came down on top of something else can take a while to roll off it.
        for (let step = 0; step < 600 && !d.looseObjects.every((object) => object.isAsleep); step++) d.simulate(1 / 30);
        for (const object of d.looseObjects) {
          count++;
          if (![object.x, object.y, object.z, object.orientationX, object.orientationW, object.velocityX].every(Number.isFinite)) notNumbers++;
          else if (!lab.isInTheOpen(object.x, object.y, object.z)) outside++;
          else if (!object.isAsleep) stillMoving++;
        }
      }
      d.clearLooseObjects();
      return { station: station.slice(0, 3).join(' '), places: places.length, thrown: thrown.length, stillInTheStation: count, lostDownThePit: statistics.lostDownThePit - lostBefore,
        notNumbers: notNumbers, outside: outside, stillMoving: stillMoving, putBack: statistics.putBack - putBackBefore, seconds: Math.round((performance.now() - started) / 100) / 10 };
    }, [station, TEST_KINDS_OF_THIS_SUITE]);
    check('120 objects thrown at random through ' + storm.station + ', spinning, at up to 13 m/s: every one ends inside the station and at rest (or down the pit), and none had to be put back',
      storm.thrown === 120 && storm.stillInTheStation + storm.lostDownThePit === 120 && storm.notNumbers === 0 && storm.outside === 0 && storm.stillMoving === 0 && storm.putBack === 0, storm);
  }

  // --- the scan grenade ---
  await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab;
    lab.reset();
    d.setDebugOption('freezeCreatures', false); // the Hollow has to be able to be stunned, and to come
    lab.stand(spot.x - 2.8, spot.z, Math.PI / 2);
    lab.carry('scanGrenade');
  }, spot);
  await drawFrames(page, 4);
  const beforeArming = await inGame(() => ({ prompt: document.getElementById('hud-prompt').textContent, chip: document.getElementById('chip-carrying').textContent }));
  await page.keyboard.press('KeyQ');
  const armed = await inGame(() => { const d = window.lastReturnDebug; d.simulate(0.1); const grenade = d.getHeldLooseObject(); return { armed: grenade.armedTime >= 0, spent: grenade.isSpent, label: d.getLooseObjectLabel(grenade), messages: window.looseLab.messages() }; });
  check('with a scan grenade in the beam the screen offers Q to arm it, and Q arms it',
    /\[Q\]  Arm the scan grenade/.test(beforeArming.prompt) && beforeArming.chip === 'CARRYING: SCAN GRENADE' && armed.armed && !armed.spent && armed.label === 'scan grenade, armed' && armed.messages.some((text) => /Armed/.test(text)), [beforeArming, armed]);

  const grenade = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = {};
    const object = d.getHeldLooseObject();
    // The Hollow stands in the open, a few metres past where you are; you throw the grenade its way.
    d.spawnHollow(spot.x + 1.5, spot.z + 0.6);
    d.hollow.graceTimer = 0; d.hollow.state = 0; d.hollow.hasHeardNoise = false; d.hollow.anger = 0;
    const hollowAt = { x: d.hollow.figure.x, z: d.hollow.figure.z };
    const pointsBefore = d.pointCloud.totalReturns;
    lab.noises.length = 0;
    p.pitch = 0.15;
    d.releaseHeldLooseObject(0.45);
    let wentOffAt = null, stunnedAtAll = false, movedWhileStunned = 0, longestStun = 0;
    for (let step = 0; step < 180; step++) {
      d.simulate(1 / 30);
      if (wentOffAt === null && object.burstSeconds > 0) wentOffAt = { x: object.x, z: object.z, afterSeconds: lab.round(step / 30) };
      if (d.hollow.stunSeconds > 0) {
        stunnedAtAll = true; longestStun = Math.max(longestStun, d.hollow.stunSeconds);
        movedWhileStunned = Math.max(movedWhileStunned, d.hollow.currentSpeed);
      }
      if (object.isSpent && d.hollow.stunSeconds <= 0 && step > 60) break;
    }
    result.wentOff = wentOffAt;
    result.metresFromYou = wentOffAt ? lab.round(Math.hypot(wentOffAt.x - p.x, wentOffAt.z - p.z)) : 0;
    result.metresFromTheHollow = wentOffAt ? lab.round(Math.hypot(wentOffAt.x - hollowAt.x, wentOffAt.z - hollowAt.z)) : 99;
    result.pointsAdded = d.pointCloud.totalReturns - pointsBefore;
    result.noiseThere = wentOffAt !== null && lab.noises.some((noise) => Math.hypot(noise.x - wentOffAt.x, noise.z - wentOffAt.z) < 0.5 && noise.radius > 10);
    result.hitsOnTheHollow = object.burstHitsOnHollow;
    result.stunned = { atAll: stunnedAtAll, seconds: lab.round(longestStun), fastestWhileStunned: lab.round(movedWhileStunned), hitsItTakes: d.tuning.scanGrenadeStunHits, forSeconds: d.tuning.scanGrenadeStunSeconds };
    // Afterwards it comes for where the light came from: the grenade, not you.
    d.simulate(1.5);
    const goingTo = d.hollow.state === 2 ? { x: d.hollow.lastKnownPlayerX, z: d.hollow.lastKnownPlayerZ } : { x: d.hollow.targetX, z: d.hollow.targetZ };
    // (The grenade rolls on while it is going off, so: where it went off, or where it lies now.)
    result.afterwards = { state: d.hollow.state, metresFromWhereItWentOff: wentOffAt !== null ? lab.round(Math.hypot(goingTo.x - wentOffAt.x, goingTo.z - wentOffAt.z)) : 99,
      metresFromWhereItLies: lab.round(Math.hypot(goingTo.x - object.x, goingTo.z - object.z)), metresFromYou: lab.round(Math.hypot(goingTo.x - p.x, goingTo.z - p.z)) };
    result.afterwards.toTheGrenade = Math.min(result.afterwards.metresFromWhereItWentOff, result.afterwards.metresFromWhereItLies) < 1.5;
    result.afterwards.notToYou = result.afterwards.metresFromYou > 2;
    result.spent = { isSpent: object.isSpent, label: d.getLooseObjectLabel(object), counted: d.looseState.statistics.grenadesSpent };
    d.hollow.isActive = false;
    // Used up: Q with it in the beam again does nothing.
    d.pickUpLooseObject(object);
    d.simulate(0.5);
    d.input.wantsUseCarried = true;
    d.simulate(0.3);
    result.spent.armsAgain = object.armedTime > 0 && object.burstSeconds < d.tuning.scanGrenadeBurstSeconds;
    return result;
  }, spot);
  check('thrown, the armed grenade goes off a moment after it lands, metres from you, and scans the room from there: thousands of points, and a noise at that place',
    grenade.wentOff !== null && grenade.metresFromYou > 2.5 && grenade.pointsAdded > 8000 && grenade.noiseThere, grenade);
  // (Stunned for the whole of scanGrenadeStunSeconds: it is read a step after it began, so one step of it, 1/30 s, has run already.)
  check('its light stuns the Hollow where it stands, for a few seconds', grenade.hitsOnTheHollow >= grenade.stunned.hitsItTakes && grenade.stunned.atAll && grenade.stunned.seconds >= grenade.stunned.forSeconds - 1 / 30 - 0.001 && grenade.stunned.fastestWhileStunned < 0.05, [grenade.hitsOnTheHollow, grenade.stunned]);
  check('and then the Hollow comes for where the light came from, which is the grenade and not you', grenade.afterwards.toTheGrenade && grenade.afterwards.notToYou, grenade.afterwards);
  check('a grenade that has gone off is spent: it says so and cannot be armed again', grenade.spent.isSpent && grenade.spent.label === 'spent scan grenade' && grenade.spent.counted === 1 && !grenade.spent.armsAgain, grenade.spent);

  const grenadeEdges = await inGame(([spot, bare]) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = {};
    // Armed and never thrown: its fuse runs out and it goes off in the beam.
    d.clearLooseObjects();
    lab.stand(spot.x - 2.8, spot.z, Math.PI / 2);
    let object = lab.carry('scanGrenade');
    d.input.wantsUseCarried = true;
    d.simulate(0.1);
    const pointsBefore = d.pointCloud.totalReturns;
    d.simulate(d.tuning.scanGrenadeFuseSeconds - 0.5);
    result.beforeTheFuseIsOut = { spent: object.isSpent, bursting: object.burstSeconds > 0 };
    d.simulate(0.5 + d.tuning.scanGrenadeBurstSeconds + 0.3);
    result.afterTheFuse = { spent: object.isSpent, stillInTheBeam: d.getHeldLooseObject() === object, pointsAdded: d.pointCloud.totalReturns - pointsBefore };
    // Held up in the air, its light goes down as well: the floor under it and round it is lit.
    {
      const added = result.afterTheFuse.pointsAdded, floats = d.pointCloud.floatView;
      let underIt = 0, onTheFloor = 0;
      for (let index = d.pointCloud.storedCount - added; index < d.pointCloud.storedCount; index++) {
        if (floats[index * 5 + 1] >= 0.02) continue;
        onTheFloor++;
        if (Math.hypot(floats[index * 5] - object.x, floats[index * 5 + 2] - object.z) < 1) underIt++;
      }
      result.inTheAir = { height: lab.round(object.y), floorPointsWithinAMetre: underIt, shareOnTheFloor: lab.round(onTheFloor / added) };
    }
    // Lying on the floor, its light goes on the room and not into the floor it lies on.
    d.clearLooseObjects();
    object = d.createLooseObject('scanGrenade', spot.x + 0.5, 0.3, spot.z, 0);
    for (let step = 0; step < 150 && !object.isAsleep; step++) d.simulate(1 / 30);
    const landedBefore = d.pointCloud.totalReturns;
    object.armedTime = d.game.time; object.goesOffTime = d.game.time;
    d.simulate(d.tuning.scanGrenadeBurstSeconds + 0.2);
    const landed = d.pointCloud.totalReturns - landedBefore, floats = d.pointCloud.floatView;
    let underIt = 0, onTheFloor = 0, furthest = 0;
    for (let index = d.pointCloud.storedCount - landed; index < d.pointCloud.storedCount; index++) {
      const away = Math.hypot(floats[index * 5] - object.x, floats[index * 5 + 2] - object.z);
      if (floats[index * 5 + 1] < 0.02) onTheFloor++;
      if (Math.hypot(away, floats[index * 5 + 1] - object.y) < 0.24) underIt++;
      furthest = Math.max(furthest, away);
    }
    result.whereItsLightGoes = { pulses: landed, shareUnderIt: lab.round(underIt / landed), shareOnTheFloor: lab.round(onTheFloor / landed), furthestMetres: lab.round(furthest) };
    // Lying on the floor right up against a wall: nothing on the floor under it and nothing on the wall beside it.
    d.clearLooseObjects();
    object = d.createLooseObject('scanGrenade', bare.x + bare.stepX * (bare.wall - 0.07), 0.08, bare.z + bare.stepZ * (bare.wall - 0.07), 0);
    object.isAsleep = true; // as it lies
    {
      const before = d.pointCloud.totalReturns;
      object.armedTime = d.game.time; object.goesOffTime = d.game.time;
      d.simulate(d.tuning.scanGrenadeBurstSeconds + 0.2);
      const added = d.pointCloud.totalReturns - before, floats = d.pointCloud.floatView;
      let near = 0, onThatWall = 0, awayFromTheWall = 0;
      for (let index = d.pointCloud.storedCount - added; index < d.pointCloud.storedCount; index++) {
        const x = floats[index * 5], y = floats[index * 5 + 1], z = floats[index * 5 + 2];
        if (Math.hypot(x - object.x, y - object.y, z - object.z) < 0.24) near++;
        const towardsTheWall = (x - object.x) * bare.stepX + (z - object.z) * bare.stepZ;
        if (towardsTheWall > 0.02) onThatWall++; else if (towardsTheWall < -0.5) awayFromTheWall++;
      }
      result.againstAWall = { fromTheWall: lab.round(bare.wall - ((object.x - bare.x) * bare.stepX + (object.z - bare.z) * bare.stepZ)), pulses: added,
        shareWithinAHand: lab.round(near / added), shareOnThatWall: lab.round(onThatWall / added), shareOutIntoTheRoom: lab.round(awayFromTheWall / added) };
    }
    // An enraged Hollow is not stunned by it.
    d.clearLooseObjects();
    object = d.createLooseObject('scanGrenade', spot.x + 0.5, 0.3, spot.z, 0);
    for (let step = 0; step < 150 && !object.isAsleep; step++) d.simulate(1 / 30);
    d.setDebugOption('freezeCreatures', true); // it stays where it is put, enraged
    d.spawnHollow(spot.x + 2, spot.z);
    d.hollow.graceTimer = 0; d.hollow.enragedTimer = 30;
    object.armedTime = d.game.time; object.goesOffTime = d.game.time;
    d.simulate(d.tuning.scanGrenadeBurstSeconds + 0.2);
    result.enraged = { hits: object.burstHitsOnHollow, stunSeconds: d.hollow.stunSeconds, hitsThatWouldStun: d.tuning.scanGrenadeStunHits };
    d.hollow.isActive = false; d.hollow.enragedTimer = 0;
    return result;
  }, [spot, bareWallForScanner]);
  check('armed and never thrown, it goes off in the beam when its fuse runs out, and not before',
    !grenadeEdges.beforeTheFuseIsOut.spent && !grenadeEdges.beforeTheFuseIsOut.bursting && grenadeEdges.afterTheFuse.spent && grenadeEdges.afterTheFuse.stillInTheBeam && grenadeEdges.afterTheFuse.pointsAdded > 8000, grenadeEdges);
  check('held up in the air when it goes off, its light goes down too: the floor right under it is lit',
    grenadeEdges.inTheAir.height > 0.8 && grenadeEdges.inTheAir.floorPointsWithinAMetre > 500 && grenadeEdges.inTheAir.shareOnTheFloor > 0.25, grenadeEdges.inTheAir);
  check('lying on the floor, a grenade puts its light on the room: next to none of it on the patch of floor it lies on, some of it on the floor round about, and it reaches the walls',
    grenadeEdges.whereItsLightGoes.shareUnderIt < 0.05 && grenadeEdges.whereItsLightGoes.shareOnTheFloor > 0.08 && grenadeEdges.whereItsLightGoes.shareOnTheFloor < 0.3 && grenadeEdges.whereItsLightGoes.furthestMetres > 3, grenadeEdges.whereItsLightGoes);
  check('lying against a wall, its light goes away from the wall as well as from the floor: almost none within a hand of it, and more than half of it out into the room',
    grenadeEdges.againstAWall.fromTheWall < 0.1 && grenadeEdges.againstAWall.pulses > 8000 && grenadeEdges.againstAWall.shareWithinAHand < 0.05 && grenadeEdges.againstAWall.shareOutIntoTheRoom > 0.5, grenadeEdges.againstAWall);
  check('an enraged Hollow is lit by it and not stunned', grenadeEdges.enraged.hits >= grenadeEdges.enraged.hitsThatWouldStun && grenadeEdges.enraged.stunSeconds === 0, grenadeEdges.enraged);

  // --- the Hollow goes after what it kicks ---
  const chased = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, result = {};
    lab.reset(); // creatures held still again: the test walks the Hollow by hand
    lab.stand(spot.x - 2.9, spot.z - 2, Math.PI / 2);
    for (const which of ['testCapsule', 'testMotor', 'testCapsule you never touched']) {
      const kindKey = which.split(' ')[0];
      d.clearLooseObjects();
      const object = d.createLooseObject(kindKey, spot.x, 0.3, spot.z, 0);
      object.wasHandled = which === kindKey; // as if you had had it in the beam, some time ago
      if (kindKey === 'testCapsule') d.setLooseObjectOrientation(object, 0.7071, 0, 0, 0.7071); // lying on its side, to roll
      for (let step = 0; step < 150 && !object.isAsleep; step++) d.simulate(1 / 30);
      d.spawnHollow(object.x, object.z - 1.5);
      d.hollow.graceTimer = 0; d.hollow.state = 0;
      const start = { x: object.x, z: object.z };
      for (let step = 0; step < 24; step++) { d.hollow.figure.z += 3 / 30; d.simulate(1 / 30); } // it walks through where the thing lies
      const entry = { kicked: lab.round(Math.hypot(object.x - start.x, object.z - start.z)), state: d.hollow.state,
        goingAfterIt: d.hollow.state === 1 && Math.hypot(d.hollow.targetX - object.x, d.hollow.targetZ - object.z) < 0.6 };
      // Give the thing a shove by hand and see whether the Hollow's aim follows it, now and after it has had enough.
      object.x += 1.2; d.wakeLooseObject(object); object.kickedByHollowTime = d.game.time;
      d.simulate(0.2);
      entry.followsIt = Math.hypot(d.hollow.targetX - object.x, d.hollow.targetZ - object.z) < 0.6;
      d.simulate(d.tuning.hollowChasesKickedSeconds + 1);
      const before = { x: d.hollow.targetX, z: d.hollow.targetZ };
      object.x -= 1.5; d.wakeLooseObject(object); object.kickedByHollowTime = d.game.time;
      d.simulate(0.2);
      entry.hasHadEnough = Math.hypot(d.hollow.targetX - before.x, d.hollow.targetZ - before.z) < 0.01;
      result[which] = entry;
      d.hollow.isActive = false;
    }
    result.limit = d.tuning.hollowChasesKickedMass;
    return result;
  }, spot);
  // (What it goes after is what weighs no more than the game's hollowChasesKickedMass: the capsule must, the motor must not.)
  check('the Hollow goes after a capsule it has kicked, light enough for it to go after, if you have handled it: it follows it as it rolls, and has had enough after a few seconds',
    TEST_OBJECT_KINDS.testCapsule.mass <= chased.limit && chased.testCapsule.kicked > 0.3 && chased.testCapsule.goingAfterIt && chased.testCapsule.followsIt && chased.testCapsule.hasHadEnough, [chased.testCapsule, chased.limit]);
  check('it does not go after something too heavy to roll off, like a motor heavier than that', TEST_OBJECT_KINDS.testMotor.mass > chased.limit && !chased.testMotor.goingAfterIt && !chased.testMotor.followsIt, [chased.testMotor, chased.limit]);
  check('and what you have never touched it kicks aside and forgets', chased['testCapsule you never touched'].kicked > 0.3 && !chased['testCapsule you never touched'].goingAfterIt && !chased['testCapsule you never touched'].followsIt, chased['testCapsule you never touched']);

  // --- its points, and the floor's ---
  const pointsKept = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = {};
    lab.reset();
    d.clearLooseObjects();
    const object = d.createLooseObject('testBox', spot.x, 0.4, spot.z, 0.3);
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

  // The same for a thing that is loud to kick, which is scanned in the warning colour and not in the colour of
  // things you can take: a steel plate. (Its points used to stay where it had lain, for good.)
  const loudPointsKept = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = {};
    lab.reset();
    d.clearLooseObjects();
    const object = d.createLooseObject('plate', spot.x, 0.3, spot.z, 0.3);
    for (let step = 0; step < 150 && !object.isAsleep; step++) d.simulate(1 / 30);
    lab.scan(object);
    const reach = object.prepared.partsRadius + 0.3;
    result.scannedAtRest = lab.countPoints(object.x, object.y, object.z, reach);
    const wasAt = { x: object.x, y: object.y, z: object.z };
    lab.stand(object.x - 1.6, object.z, Math.PI / 2);
    d.pickUpLooseObject(object);
    p.pitch = 0.9;
    d.simulate(2);
    result.carriedOff = lab.countPoints(wasAt.x, wasAt.y, wasAt.z, reach);
    // Set down and scanned where it lies now, then kicked away by something else (not carried): they are let go as well.
    d.releaseHeldLooseObject(0);
    for (let step = 0; step < 150 && !object.isAsleep; step++) d.simulate(1 / 30);
    lab.scan(object);
    const liesAt = { x: object.x, y: object.y, z: object.z };
    result.scannedAgain = lab.countPoints(liesAt.x, liesAt.y, liesAt.z, reach);
    d.wakeLooseObject(object); object.velocityX = 4; object.velocityY = 1.5;
    d.simulate(2.5);
    result.kickedAway = { metres: Math.hypot(object.x - liesAt.x, object.z - liesAt.z), points: lab.countPoints(liesAt.x, liesAt.y, liesAt.z, reach) };
    // And taken out of the station where it has come to lie: its points go with it.
    for (let step = 0; step < 200 && !object.isAsleep; step++) d.simulate(1 / 30);
    lab.scan(object);
    const lastAt = { x: object.x, y: object.y, z: object.z };
    result.scannedLast = lab.countPoints(lastAt.x, lastAt.y, lastAt.z, reach);
    d.removeLooseObject(object);
    result.removed = lab.countPoints(lastAt.x, lastAt.y, lastAt.z, reach);
    return result;
  }, spot);
  check('the same for a thing that is loud to kick, scanned in the warning colour (a steel plate): carried off, kicked away or taken out of the station, its points are let go and the floor keeps its own',
    loudPointsKept.scannedAtRest.onObjects > 50 && loudPointsKept.scannedAtRest.inTheWarningColour === loudPointsKept.scannedAtRest.onObjects &&
    loudPointsKept.carriedOff.onObjects === 0 && loudPointsKept.carriedOff.station === loudPointsKept.scannedAtRest.station &&
    loudPointsKept.scannedAgain.onObjects > 50 && loudPointsKept.kickedAway.metres > 0.5 && loudPointsKept.kickedAway.points.onObjects === 0 &&
    loudPointsKept.scannedLast.onObjects > 50 && loudPointsKept.removed.onObjects === 0 && loudPointsKept.removed.station === loudPointsKept.scannedLast.station,
    loudPointsKept);

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
    for (const kindKey of ['testJar', 'testCase', 'testBox', 'testMotor']) result[kindKey] = walk(kindKey);
    // What the game says is light enough to kick along freely, and heavy enough to stop you.
    result.freeBelow = d.tuning.looseShoveFreeMass; result.stopsFrom = d.tuning.looseShoveBlockMass;
    return result;
  }, bareWall);
  // (Each test object must be on its side of the game's thresholds, or the check is not the one it says it is.)
  const weighs = (kindKey) => TEST_OBJECT_KINDS[kindKey].mass;
  check('a jar on the floor, lighter than what slows you, is kicked along without slowing you; a case heavier than that slows you a little, a box twice its weight a lot',
    weighs('testJar') < shoved.freeBelow && weighs('testCase') > shoved.freeBelow && weighs('testBox') > weighs('testCase') && weighs('testBox') < shoved.stopsFrom &&
    shoved.testJar.walked > shoved.nothing.walked - 0.1 && shoved.testJar.objectMoved > 0.5 &&
    shoved.testCase.walked < shoved.nothing.walked - 0.1 && shoved.testBox.walked < shoved.testCase.walked - 0.2 && shoved.testBox.objectMoved > 0.05, shoved);
  check('a motor on the floor, as heavy as what stops you or more, does not move for your legs: it stops you where it lies',
    weighs('testMotor') >= shoved.stopsFrom && shoved.testMotor.resistance === 1 && shoved.testMotor.objectMoved < 0.03 && shoved.testMotor.walked < 0.6, [shoved.testMotor, shoved.stopsFrom]);

  // --- a vent ---
  const vent = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = {};
    // A vent mouth: a vent tile with ordinary floor right in front of it, and more vent behind. Kessel-9 has no
    // vents, so this is a generated station: the first of forty that has such a mouth.
    let mouth = null;
    result.seedsLookedAt = 0;
    for (let seed = 1; seed <= 40 && !mouth; seed++) {
    if (d.loadStation('generated', seed, 'medium', 'mixed', 'one') === false) continue; // one that cannot be built is stepped over
    result.seedsLookedAt++;
    d.clearLooseObjects();
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
    if (!mouth) return result;
    result.mouth = mouth;
    for (const kindKey of ['testJar', 'testBox', 'testMotor', 'testRod', 'testCase']) {
      d.clearLooseObjects();
      lab.stand(mouth.x - mouth.stepX * 1.6, mouth.z - mouth.stepZ * 1.6, Math.atan2(mouth.stepX, -mouth.stepZ));
      d.input.keysDown.add('KeyC');
      d.simulate(0.8);
      const object = lab.carry(kindKey);
      if (kindKey === 'testRod') {
        // Taken up squarely across your way: put down, turned across the vent, and taken into the beam again.
        d.releaseHeldLooseObject(0);
        d.setLooseObjectYaw(object, mouth.stepX !== 0 ? Math.PI / 2 : 0);
        object.velocityX = 0; object.velocityY = 0; object.velocityZ = 0; object.spinX = 0; object.spinY = 0; object.spinZ = 0;
        d.pickUpLooseObject(object, false);
        d.simulate(0.6);
      }
      const before = lab.knocks();
      // Which way its length lies: 1 along the vent, 0 across it. (Its own first axis is its length, for the rod.)
      const alongTheVent = function () { return lab.round(Math.abs(object.matrix[0] * mouth.stepX + object.matrix[6] * mouth.stepZ)); };
      const acrossAtFirst = alongTheVent();
      d.input.keysDown.add('KeyW');
      let objectInVent = false;
      for (let step = 0; step < 150; step++) { d.simulate(1 / 30); if (d.isVentAt(object.x, object.z)) objectInVent = true; }
      result[kindKey] = { playerInVent: d.isVentAt(p.x, p.z), objectInVent: objectInVent, objectInVentAtTheEnd: d.isVentAt(object.x, object.z), stillHeld: d.getHeldLooseObject() === object, knocks: lab.since(before), messages: lab.messages(),
        metresIn: lab.round((p.x - mouth.x) * mouth.stepX + (p.z - mouth.z) * mouth.stepZ), acrossAtFirst: acrossAtFirst, alongTheVent: alongTheVent() };
      d.input.keysDown.clear();
    }
    return result;
  });
  // No rule says what may go into a vent: a thing goes where it fits. A vent is a metre wide and 1.15 m high.
  check('there is a medium station with a vent mouth to try (a vent tile with floor in front of it and more vent behind)',
    Boolean(vent.mouth), vent.mouth ? vent : 'no medium station with such a vent mouth among the ' + vent.seedsLookedAt + ' of the first forty seeds that could be built');
  check('a jar, a case, a box of 50 by 44 cm and a motor each go into a vent ahead of you, still in the beam',
    Boolean(vent.mouth) && ['testJar', 'testCase', 'testBox', 'testMotor'].every((key) => vent[key].playerInVent && vent[key].objectInVent && vent[key].stillHeld), vent);
  check('a rod 1.2 m long hangs across the beam and is wider than the vent: it goes in only once pressing it against the mouth has turned it lengthwise, and nothing but the rod says so',
    Boolean(vent.mouth) && vent.testRod.stillHeld && (!vent.testRod.playerInVent || vent.testRod.alongTheVent > 0.6) && vent.testRod.acrossAtFirst < 0.45 &&
    ['testJar', 'testCase', 'testBox', 'testMotor', 'testRod'].every((key) => !vent[key].messages.some((text) => /will not go in|no room in here/.test(text))), vent.mouth ? vent.testRod : null);

  // --- the pit, and a new descent ---
  const housekeeping = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, result = {};
    lab.reset(); // Kessel-9, which has the shaft (the station the vents were tried in is another)
    let pit = null;
    for (let z = 2; z < 200 && !pit; z++) for (let x = 2; x < 200 && !pit; x++) if (d.getTileFlagsAt(x + 0.5, z + 0.5) & d.tileFlagPit) pit = { x: x + 0.5, z: z + 0.5 };
    if (pit) {
      const lostBefore = d.looseState.statistics.lostDownThePit;
      const object = d.createLooseObject('testJar', pit.x, 0.5, pit.z, 0);
      const fromY = object.y;
      for (let step = 0; step < 400 && d.looseObjects.length > 0; step++) d.simulate(1 / 30);
      result.pit = { there: true, fellFrom: fromY, gone: d.looseObjects.length === 0, counted: d.looseState.statistics.lostDownThePit - lostBefore };
    } else {
      result.pit = { there: false };
    }
    lab.stand(spot.x, spot.z, Math.PI / 2);
    lab.carry('testCapsule');
    d.createLooseObject('testBox', spot.x - 1.5, 0.5, spot.z, 0);
    result.before = { loose: d.looseObjects.length, carrying: d.getHeldLooseObject() !== null };
    d.loadStation('classic', 0);
    result.after = { loose: d.looseObjects.length, ofTheStation: d.stationLooseObjects.length, carrying: d.getHeldLooseObject() !== null, speedFactor: d.getCarrySpeedFactor() };
    return result;
  }, spot);
  check('something dropped down the shaft is gone for good', housekeeping.pit.there && housekeeping.pit.gone && housekeeping.pit.counted === 1, housekeeping.pit);
  check('a new descent starts with nothing in the beam, and nothing loose but what the station has lying about',
    housekeeping.before.loose === 2 && housekeeping.before.carrying && housekeeping.after.loose === housekeeping.after.ofTheStation && housekeeping.after.ofTheStation > 10 && !housekeeping.after.carrying && housekeeping.after.speedFactor === 1, housekeeping);

  // --- what a station has lying about ---
  const lyingAbout = await inGame(() => {
    const d = window.lastReturnDebug, result = {};
    // (The massive one has about 150 things: woken all at once, that is as many touches in one step as there ever are.)
    for (const station of [['classic', 0], ['generated', 7, 'medium', 'mixed', 'one'], ['generated', 99, 'large', 'mixed', 'one'], ['generated', 3, 'massive', 'mixed', 'one']]) {
      d.loadStation.apply(null, station);
      d.setDebugOption('freezeCreatures', true); d.hollow.isActive = false;
      // What the station asks for: litter and things worth carrying out by how many rooms it has (Kessel-9 counts as nineteen).
      const rooms = d.level.roomCount || 19;
      // (What a quest puts out, a fuel can, is counted with them: it lies about the station like the rest.)
      const entry = { total: d.stationLooseObjects.length + d.questLooseObjects.length, fromQuests: d.questLooseObjects.length, loose: d.looseObjects.length, asleep: d.looseObjects.filter((object) => object.isAsleep).length,
        counts: {}, value: 0, onSurfaces: 0, lowestSurface: 9, cansInHeaps: d.noisyFloorCanHeaps.reduce((sum, heap) => sum + heap.cans.length, 0), problems: d.auditStationLooseObjects(),
        mouths: d.level.ventMouths.length, wanted: { litter: Math.round(rooms * d.tuning.looseLitterPerRoom), valuables: Math.round(rooms * d.tuning.looseValuablesPerRoom), firstAidKits: Math.max(1, Math.round(rooms * d.tuning.firstAidKitsPerRoom)), tripods: Math.max(1, Math.round(rooms * d.tuning.scannerTripodsPerRoom)) }, notOnASurface: [] };
      // At most this many of the valuables go on tables and shelves (as the game rounds it).
      entry.wanted.onSurfacesAtMost = Math.round(entry.wanted.valuables * d.tuning.looseValuablesShareOnSurfaces);
      d.stationLooseObjects.forEach((item, index) => {
        entry.counts[item.kindKey] = (entry.counts[item.kindKey] || 0) + 1;
        entry.value += d.looseObjectKinds[item.kindKey].value;
        if (item.on !== 'surface') return;
        entry.onSurfaces++;
        // Its underside (the lowest of the balls it touches with), and the table or shelf whose top that lies on.
        const object = d.looseObjects[index], shell = object.prepared.shell, m = object.matrix;
        let underside = Infinity;
        for (let ball = 0; ball < object.prepared.shellCount; ball++) underside = Math.min(underside, object.y + m[3] * shell[ball * 4] + m[4] * shell[ball * 4 + 1] + m[5] * shell[ball * 4 + 2] - shell[ball * 4 + 3]);
        const surface = d.worldProps.find((prop) => !prop.isRemoved && Math.abs(prop.maximumY - underside) < 0.02 &&
          Math.abs(prop.centerX - object.x) <= prop.boundsHalfX && Math.abs(prop.centerZ - object.z) <= prop.boundsHalfZ);
        if (!surface) entry.notOnASurface.push(item.kindKey + ' at ' + object.x.toFixed(1) + ', ' + object.z.toFixed(1));
        else entry.lowestSurface = Math.min(entry.lowestSurface, surface.maximumY - d.getFloorHeightAt(surface.centerX, surface.centerZ));
      });
      entry.lowestSurface = Math.round(entry.lowestSurface * 100) / 100;
      const signature = JSON.stringify([d.stationLooseObjects, d.questLooseObjects]);
      // Wake every one of them: put down as it would lie, none of them should stir, and none should make a sound.
      const noises = []; d.debugHooks.recordNoise = function (x, z, radius) { noises.push(radius); };
      const before = d.looseObjects.map((object) => [object.x, object.y, object.z, object.orientationX, object.orientationY, object.orientationZ, object.orientationW]);
      for (const object of d.looseObjects) d.wakeLooseObject(object);
      for (let step = 0; step < 120; step++) d.simulate(1 / 30);
      entry.stirred = 0;
      d.looseObjects.forEach((object, index) => {
        const was = before[index];
        const turned = 2 * Math.acos(Math.min(1, Math.abs(object.orientationX * was[3] + object.orientationY * was[4] + object.orientationZ * was[5] + object.orientationW * was[6]))) * 180 / Math.PI;
        if (Math.hypot(object.x - was[0], object.y - was[1], object.z - was[2]) > 0.03 || turned > 5) entry.stirred++;
      });
      entry.asleepAgain = d.looseObjects.filter((object) => object.isAsleep).length;
      entry.noises = noises.length;
      // Carry one off and kick another away, then come down again: all of it lies where it lay.
      d.looseObjects[0].x += 0.4; d.looseObjects[0].y += 1; d.wakeLooseObject(d.looseObjects[0]);
      d.removeLooseObject(d.looseObjects[1]);
      d.simulate(0.5);
      d.loadStation.apply(null, station);
      entry.sameAgain = JSON.stringify([d.stationLooseObjects, d.questLooseObjects]) === signature && d.looseObjects.length === entry.total &&
        d.looseObjects.every((object, index) => object.isAsleep && Math.hypot(object.x - before[index][0], object.y - before[index][1], object.z - before[index][2]) < 1e-6);
      result[station.join(' ')] = entry;
    }
    window.looseLab.reset();
    return result;
  });
  for (const stationName of Object.keys(lyingAbout)) {
    const entry = lyingAbout[stationName];
    check(stationName + ': the station has things lying about, each at rest, none in rock, a doorway, a vent, the pit or the lift car',
      entry.total > 0 && entry.fromQuests <= 4 && entry.loose === entry.total && entry.asleep === entry.total && entry.problems.length === 0, entry);
    // Besides the cans of the heaps, the vents' covers and what a quest put out: never more litter and things worth carrying out than its
    // rooms ask for, and as many where the station has floor enough to put them on (the game stops putting them out
    // when it runs out of floor: these stations have plenty). Of the valuables no more than their share on tables
    // and shelves, and each of those really lies on the top of one, 35 cm high or more (findStationSurfaces).
    // (Which kinds they are is the game's draw, from its tables: that is not looked at here.)
    const litterAndValuables = entry.total - entry.fromQuests - entry.cansInHeaps - (entry.counts.ventCover || 0) - (entry.counts.firstAidKit || 0) - (entry.counts.scannerTripod || 0);
    entry.shortOfWhatTheRoomsAskFor = entry.wanted.litter + entry.wanted.valuables - litterAndValuables;
    check(stationName + ': cans where the draw put cans, litter, and things worth carrying out, as many as its rooms ask for in a station with floor enough, and no more than their share on tables and shelves, each lying on one',
      entry.counts.can >= entry.cansInHeaps && (entry.counts.ventCover || 0) <= entry.mouths && entry.shortOfWhatTheRoomsAskFor === 0 &&
      entry.onSurfaces <= entry.wanted.onSurfacesAtMost && entry.notOnASurface.length === 0 && (entry.onSurfaces === 0 || entry.lowestSurface >= 0.35), entry);
    check(stationName + ': and the first aid kits and the scanner tripods its rooms ask for, never fewer than one of either', entry.counts.firstAidKit === entry.wanted.firstAidKits && entry.wanted.firstAidKits >= 1 &&
      entry.counts.scannerTripod === entry.wanted.tripods && entry.wanted.tripods >= 1, [entry.counts.firstAidKit, entry.counts.scannerTripod, entry.wanted]);
    check(stationName + ': woken, none of them stirs or makes a sound, and they are at rest again', entry.stirred === 0 && entry.noises === 0 && entry.asleepAgain === entry.total, entry);
    check(stationName + ': the same station has the same things in the same places, and a new descent puts them back', entry.sameAgain, entry);
  }

  // --- cans ---
  const cans = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = {};
    for (const pace of ['crouched', 'walking', 'running']) {
      lab.reset();
      lab.stand(spot.x - 2.2, spot.z, Math.PI / 2);
      const can = d.createLooseObject('can', spot.x, 0.05, spot.z, 0);
      d.setLooseObjectOrientation(can, 0.7071, 0, 0, 0.7071); // on its side, across your way
      for (let step = 0; step < 150 && !can.isAsleep; step++) d.simulate(1 / 30);
      const before = lab.knocks(), fromX = can.x;
      lab.noises.length = 0;
      if (pace === 'crouched') { d.input.keysDown.add('KeyC'); d.simulate(0.8); }
      if (pace === 'running') d.input.keysDown.add('ShiftLeft');
      d.input.keysDown.add('KeyW');
      // How far the loudest knock of the can carried. (Your own steps make noise too: those are not counted.)
      let carries = 0, knockTime = d.looseState.lastKnock.time;
      for (let step = 0; step < (pace === 'crouched' ? 90 : 42); step++) {
        d.simulate(1 / 30);
        if (d.looseState.lastKnock.time !== knockTime) { knockTime = d.looseState.lastKnock.time; carries = Math.max(carries, d.looseState.lastKnock.carries); }
      }
      d.input.keysDown.clear();
      result[pace] = { layStill: Math.abs(fromX - spot.x) < 0.05, moved: lab.round(can.x - fromX), knocks: lab.since(before), youPassed: p.x > fromX,
        carries: lab.round(carries), saidKicked: d.captionCounts.ownObjectKicked, saidOtherwise: d.captionCounts.ownObjectKnock + d.captionCounts.ownObjectCrash };
    }
    // One left standing stays standing, until something touches it.
    lab.reset();
    lab.stand(spot.x - 3, spot.z, Math.PI / 2);
    const standing = d.createLooseObject('can', spot.x, 0.0665, spot.z, 0.4);
    for (let step = 0; step < 150 && !standing.isAsleep; step++) d.simulate(1 / 30);
    result.standing = { atRest: standing.isAsleep, upright: lab.round(standing.matrix[4]), height: lab.round(standing.y) };
    // In a scan it shows in the warning colour, like broken glass; a jar that is no louder than ordinary shows as something to take.
    const colourOf = function (object) { return d.castScannerRay(object.x - 1, object.y + 0.3, object.z, 0.958, -0.287, 0, 5) && d.rayHit.looseObject === object ? d.rayHit.surfaceClass : -1; };
    const jar = d.createLooseObject('testJar', spot.x, 0.3, spot.z + 1, 0);
    for (let step = 0; step < 150 && !jar.isAsleep; step++) d.simulate(1 / 30);
    result.colours = { can: colourOf(standing), jar: colourOf(jar) };
    // How far broken glass underfoot carries, walking and running.
    result.glassWalking = d.tuning.noiseRadiusNoisyFloorWalk; result.glassRunning = d.tuning.noiseRadiusNoisyFloorSprint;
    return result;
  }, spot);
  // (About as far: within three tenths either way of what the game says broken glass carries. A can is kicked at
  // about the speed you walk into it, and a knock carries further the harder it is (noiseRadiusKnockSoft to
  // noiseRadiusKnockHard): at a run, about as far as running over broken glass (noiseRadiusNoisyFloorSprint), less
  // a quarter for a stride that is not yet at full speed; and "much further" than at a walk is half as far again.)
  check('walked into, an empty can is kicked away and heard about as far as broken glass underfoot, and the caption says what you did',
    cans.walking.layStill && cans.walking.moved > 0.3 && cans.walking.youPassed && cans.walking.carries >= cans.glassWalking * 0.7 && cans.walking.carries <= cans.glassWalking * 1.3 &&
    cans.walking.saidKicked >= 1 && cans.walking.saidOtherwise === 0, [cans.walking, cans.glassWalking]);
  check('at a run it carries much further, nearly as far as broken glass run over; crouched, you nudge it aside and the Hollow hears nothing',
    cans.running.carries >= cans.glassRunning * 0.75 && cans.running.carries >= cans.walking.carries * 1.5 && cans.crouched.carries === 0 && cans.crouched.knocks.heard === 0 && cans.crouched.youPassed, { running: cans.running, crouched: cans.crouched });
  check('a can left standing stays standing', cans.standing.atRest && cans.standing.upright > 0.99 && cans.standing.height > 0.05, cans.standing);
  check('a can shows in the warning colour in a scan, a jar of ordinary loudness as something to take', cans.colours.can === 12 && cans.colours.jar === 7, cans.colours);

  // --- thrown back ---
  const thrownBack = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = {};
    // (The tin twice, from the same beginning: for "what it throws back is not left to chance".)
    for (const [which, name] of [['testTin', 'testTin'], ['testCapsule', 'testCapsule'], ['testTin', 'testTinAgain']]) {
      lab.reset(); // creatures held still: the test walks the Hollow by hand
      lab.stand(spot.x - 2.9, spot.z - 2, Math.PI / 2);
      const object = d.createLooseObject(which, spot.x + 2, 0.3, spot.z + 1, 0);
      d.setLooseObjectOrientation(object, 0.7071, 0, 0, 0.7071);
      for (let step = 0; step < 150 && !object.isAsleep; step++) d.simulate(1 / 30);
      object.wasHandled = true; // you threw it there, a while ago
      d.spawnHollow(object.x, object.z - 1.5);
      d.hollow.graceTimer = 0; d.hollow.state = 0;
      for (let step = 0; step < 24; step++) { d.hollow.figure.z += 3 / 30; d.simulate(1 / 30); } // it walks through where the thing lies
      const entry = { kicked: object.kickedByHollowTime > d.game.time - 2, flungTooSoon: d.looseState.statistics.flungBack };
      // It stays on the thing's heels for as long as it goes after it.
      lab.noises.length = 0;
      const before = lab.knocks();
      let flungAt = -1;
      for (let step = 0; step < 150 && flungAt < 0; step++) {
        d.hollow.figure.x = object.x + 0.6; d.hollow.figure.z = object.z; object.kickedByHollowTime = d.game.time;
        d.simulate(1 / 30);
        if (d.looseState.statistics.flungBack > 0) flungAt = step / 30;
      }
      entry.flungAfterSeconds = lab.round(flungAt);
      entry.speed = lab.round(Math.hypot(object.velocityX, object.velocityZ));
      entry.said = d.captionCounts.hollowFling;
      // Where it aimed. (Where the thing ends up is another matter: a can bounces and rolls.)
      entry.aimedMetresFromYou = flungAt >= 0 ? lab.round(Math.hypot(d.looseState.lastFling.targetX - p.x, d.looseState.lastFling.targetZ - p.z)) : -1;
      entry.scatter = d.tuning.hollowFlingsScatterMetres;
      // Where it aimed, measured from you, and (further down) where the thing came to rest: to the last digit.
      entry.aimedExactly = flungAt >= 0 ? [d.looseState.lastFling.targetX - p.x, d.looseState.lastFling.targetZ - p.z] : null;
      const hollowAt = { x: d.hollow.figure.x, z: d.hollow.figure.z };
      for (let step = 0; step < 240 && !object.isAsleep; step++) d.simulate(1 / 30);
      entry.landedMetresFromYou = lab.round(Math.hypot(object.x - p.x, object.z - p.z));
      entry.landedExactly = [object.x, object.y, object.z];
      entry.wasMetresFromYou = lab.round(Math.hypot(hollowAt.x - p.x, hollowAt.z - p.z));
      entry.knocksOnLanding = lab.since(before);
      entry.noisesTheHollowHeard = lab.noises.length;
      entry.hollowStillLooksAtIt = Math.hypot(d.hollow.targetX - object.x, d.hollow.targetZ - object.z) < 1;
      entry.ignored = object.isIgnoredByHollow; entry.stillOfInterest = object.wasHandled;
      // In the beam again, it is yours again and its noise counts.
      d.pickUpLooseObject(object, false);
      entry.afterPickingItUp = { ignored: object.isIgnoredByHollow, ofInterest: object.wasHandled };
      d.releaseHeldLooseObject(0);
      d.hollow.isActive = false;
      result[name] = entry;
    }
    result.throwsUpTo = d.tuning.hollowFlingsMass; result.goesAfterUpTo = d.tuning.hollowChasesKickedMass;
    return result;
  }, spot);
  // (The tin must weigh no more than the game's hollowFlingsMass, and no more than hollowChasesKickedMass: it throws
  // only what it goes after. The capsule more than hollowFlingsMass, and no more than
  // hollowChasesKickedMass, so that it is gone after and not thrown.)
  const tin = thrownBack.testTin, capsule = thrownBack.testCapsule;
  check('a small tin you have handled, light enough to throw, the Hollow kicks, goes after for a couple of seconds, and then throws back: aimed at you or just beside you, it comes down on your side of the room, with a caption',
    TEST_OBJECT_KINDS.testTin.mass <= thrownBack.throwsUpTo && TEST_OBJECT_KINDS.testTin.mass <= thrownBack.goesAfterUpTo && tin.kicked && tin.flungTooSoon === 0 && tin.flungAfterSeconds >= 0.5 && tin.speed > 3 && tin.said >= 1 &&
    tin.aimedMetresFromYou >= 0 && tin.aimedMetresFromYou <= tin.scatter + 0.01 && tin.landedMetresFromYou < tin.wasMetresFromYou - 1.5, [tin, thrownBack.throwsUpTo]);
  check('what it threw makes its own noise where it lands, and the Hollow does not come to that; picked up again, the thing is yours again',
    tin.knocksOnLanding.heard + tin.knocksOnLanding.quiet >= 1 && tin.noisesTheHollowHeard === 0 && tin.ignored && !tin.stillOfInterest &&
    !tin.afterPickingItUp.ignored && tin.afterPickingItUp.ofInterest, tin);
  check('what it throws back is not left to chance: from the same beginning the tin is aimed at exactly the same spot beside you, and comes to rest in exactly the same place',
    tin.aimedExactly !== null && JSON.stringify(thrownBack.testTinAgain) === JSON.stringify(tin), [tin.aimedExactly, thrownBack.testTinAgain.aimedExactly, tin.landedExactly, thrownBack.testTinAgain.landedExactly]);
  check('a capsule of three kilograms is too heavy for that: it goes after it and does not throw it',
    TEST_OBJECT_KINDS.testCapsule.mass > thrownBack.throwsUpTo && TEST_OBJECT_KINDS.testCapsule.mass <= thrownBack.goesAfterUpTo && capsule.kicked && capsule.flungAfterSeconds < 0 && !capsule.ignored, [capsule, thrownBack.throwsUpTo]);

  // --- vent covers ---
  const covers = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = { wrong: [] };
    lab.reset();
    const mouthOf = function (object) { return d.level.ventMouths.slice().sort((a, b) => Math.hypot(a.faceX - object.x, a.faceZ - object.z) - Math.hypot(b.faceX - object.x, b.faceZ - object.z))[0]; };
    // Where something is, measured from the face of a mouth: positive inside the duct, negative out in the room.
    const along = function (mouth, x, z) { return lab.round((x - mouth.faceX) * mouth.outwardX + (z - mouth.faceZ) * mouth.outwardZ); };
    const sheet = d.looseObjectKinds.ventCover.parts[0].half;
    result.size = { worth: d.looseObjectKinds.ventCover.value, width: sheet[0] * 2, height: sheet[1] * 2, mouthHeight: d.ventHeight };
    result.counts = [];
    // Loads a station and looks at where each of its covers is. Returns them: { item, object }.
    // Like every station in these checks they are built from the code alone, without the rooms and the objects
    // from the workshop, so that making a room or an object does not make them other stations (browser-harness.js).
    // And which of them has what these checks need is looked for, not written down: the first of forty seeds whose
    // covers are `asWanted`, so that a change to how stations are planned does not break this either. What is counted,
    // and what is found wrong, is of the station that was chosen (or, if none will do, of the last one looked at).
    const survey = function (size, asWanted) {
      let all = [], counts = null, wrong = [];
      for (let seed = 1; seed <= 40; seed++) {
        if (d.loadStation('generated', seed, size, 'mixed', 'one') === false) continue; // one that cannot be built is stepped over
        d.game.flags.hasLeftLift = true; d.game.flags.powerOn = true;
        d.setDebugOption('freezeCreatures', true); d.hollow.isActive = false;
        all = d.stationLooseObjects.map((item, index) => ({ item: item, object: d.looseObjects[index] })).filter((entry) => entry.item.kindKey === 'ventCover');
        counts = { station: size, seed: seed, vents: d.level.ventCount, branches: d.level.ventBranchCount, mouths: d.level.ventMouths.length, covers: all.length, standing: all.filter((entry) => entry.item.on === 'vent').length };
        wrong = [];
        for (const entry of all) {
          const object = entry.object, mouth = mouthOf(object), fromMouth = Math.hypot(mouth.faceX - object.x, mouth.faceZ - object.z), up = Math.abs(object.matrix[4]);
          const where = size + ' ' + seed + ': the cover at ' + object.x.toFixed(1) + ', ' + object.z.toFixed(1);
          if (entry.item.on === 'vent') { if (d.isVentAt(object.x, object.z) || up < 0.99 || fromMouth > 0.2 || along(mouth, object.x, object.z) > -0.05) wrong.push(where + ' should stand upright in front of the mouth of its vent, out in the room'); }
          else if (d.isVentAt(object.x, object.z) || up > 0.1 || object.y - mouth.floorY > 0.12 || fromMouth > 3.2) wrong.push(where + ' should lie flat on the floor near its vent');
        }
        if (asWanted(all)) break;
      }
      result.counts.push(counts);
      for (const line of wrong) result.wrong.push(line);
      return all;
    };
    // A way to walk right over a cover that lies on the floor: the first of the four ways along which there are
    // three and a half metres of nothing from 1.3 m short of it, at shin height and at chest height. Or null.
    const wayOver = function (cover) {
      for (const yaw of [Math.PI / 2, -Math.PI / 2, 0, Math.PI]) {
        const fromX = cover.x - Math.sin(yaw) * 1.3, fromZ = cover.z + Math.cos(yaw) * 1.3;
        if (!d.isSpaceOpenAt(fromX, 1, fromZ)) continue;
        if (lab.distanceAhead(fromX, fromZ, yaw) > 3.5 && (!d.castScannerRay(fromX, d.getFloorHeightAt(fromX, fromZ) + 0.35, fromZ, Math.sin(yaw), 0, -Math.cos(yaw), 60) || d.rayHit.distance > 3.5)) return { x: fromX, z: fromZ, yaw: yaw };
      }
      return null;
    };
    const into = function (mouth, metres) { return d.castScannerRay(mouth.faceX - mouth.outwardX * 0.7, mouth.floorY + 0.6, mouth.faceZ - mouth.outwardZ * 0.7, mouth.outwardX, 0, mouth.outwardZ, metres) ? { metres: lab.round(d.rayHit.distance), colour: d.rayHit.surfaceClass, isTheCover: d.rayHit.looseObject !== null } : { metres: 99, colour: -1, isTheCover: false }; };

    // A massive station that has covers of both sorts, one of them lying where there is room to walk over it.
    // One that lies flat is a plate on the floor: walked over, it stays where it is and makes no sound.
    const lyingOnes = survey('massive', (all) => all.some((entry) => entry.item.on === 'vent') && all.some((entry) => entry.item.on === 'floor' && wayOver(entry.object) !== null))
      .filter((entry) => entry.item.on === 'floor' && wayOver(entry.object) !== null);
    if (lyingOnes.length === 0) { result.notFound = 'no massive station among the first forty seeds has a cover standing and one lying with room to walk over it'; return result; }
    const lying = lyingOnes[0].object, way = wayOver(lying);
    lab.stand(way.x, way.z, way.yaw);
    d.simulate(0.5);
    result.scanLying = d.castScannerRay(lying.x - 0.3, lying.y + 0.8, lying.z, 0.3, -0.954, 0, 3) ? { colour: d.rayHit.surfaceClass, isTheCover: d.rayHit.looseObject === lying } : { colour: -1, isTheCover: false };
    let before = lab.knocks();
    const lyingAt = { x: lying.x, z: lying.z }, walkedFrom = { x: p.x, z: p.z };
    d.input.keysDown.add('KeyW');
    d.simulate(1.4);
    d.input.keysDown.clear();
    d.simulate(0.5);
    result.walkedOver = { youWalked: lab.round(Math.hypot(p.x - walkedFrom.x, p.z - walkedFrom.z)), itMoved: lab.round(Math.hypot(lying.x - lyingAt.x, lying.z - lyingAt.z)), knocks: lab.since(before) };

    // A station with five that stand, for the rest. A massive one: a large one has three vents at most, six
    // mouths, and five of six covers standing is a draw that forty seeds can miss (seeds 2001 to 2040 did).
    // The Hollow throws a cover where there is room (chooseVentCoverThrow, in 08-loose-objects.js). The ways it
    // may throw are a fan: coming out of the duct, straight out into the room or up to hollowThrowsCoverOutSpread
    // to either side of that; going in from the room, along the wall to one side or the other, from
    // hollowThrowsCoverAsideFrom to hollowThrowsCoverAsideTo round. Of those it looks along one way every
    // hollowThrowsCoverWayApart, and takes one that has room. So the cover for these checks needs room along a
    // stretch of its fan, not along all of it: a stretch wider than the gap between two ways the game looks
    // along, so that one of them lies in it.
    // Room is measured here with the scanner's ray, not with the game's own measure, which is what is being
    // checked: open floor two and a half metres out, at shin, waist and shoulder height (a cover is 1.2 m high),
    // from a third of a metre in front of the cover, its middle and either end of it (it is 1.12 m wide).
    // Anything in the way counts, a loose thing too.
    const hasRoomAlong = function (cover, angle) {
      const mouth = mouthOf(cover), outX = mouth.outwardX, outZ = mouth.outwardZ;
      const towardsX = -outX * Math.cos(angle) + outZ * Math.sin(angle), towardsZ = -outZ * Math.cos(angle) - outX * Math.sin(angle);
      for (const alongTheWall of [-0.56, 0, 0.56]) {
        const fromX = cover.x - outX * 0.35 + outZ * alongTheWall, fromZ = cover.z - outZ * 0.35 - outX * alongTheWall;
        for (const height of [0.3, 0.9, 1.4]) {
          if (d.castScannerRay(fromX, mouth.floorY + height, fromZ, towardsX, 0, towardsZ, 2.5) && d.rayHit.distance < 2.5) return false;
        }
      }
      return true;
    };
    // Is there such a stretch between these two angles: four ways in a row, half a gap apart, each with room?
    // (Four, which is a gap and a half: the game spreads its ways evenly over the fan, and where the fan is not
    // a whole number of gaps wide they come out up to half as far apart again as hollowThrowsCoverWayApart says.)
    const hasStretchWithRoom = function (cover, first, last) {
      let inARow = 0;
      for (let angle = first; angle <= last + 1e-9; angle += d.tuning.hollowThrowsCoverWayApart / 2) {
        inARow = hasRoomAlong(cover, angle) ? inARow + 1 : 0;
        if (inARow === 4) return true;
      }
      return false;
    };
    const outSpread = d.tuning.hollowThrowsCoverOutSpread, asideFrom = d.tuning.hollowThrowsCoverAsideFrom, asideTo = d.tuning.hollowThrowsCoverAsideTo;
    // Of the covers that stand: one with room somewhere out of its duct, and another with room along the wall
    // on both sides (so that there is another side to throw to when something is put on one). Or null.
    // (The second also has to have floor for the box that is stood beside it, on either side: where the box goes
    // (see "Something heavy standing beside the mouth" below) there is plain floor, and nothing stands or
    // lies on it within the box's reach.)
    const hasFloorForABoxBeside = function (cover) {
      const mouth = mouthOf(cover);
      for (const side of [-1, 1]) {
        const boxX = cover.x + mouth.outwardZ * side * 0.95 - mouth.outwardX * 0.2, boxZ = cover.z - mouth.outwardX * side * 0.95 - mouth.outwardZ * 0.2;
        const spot = d.findWalkableSpotNear(boxX, boxZ);
        if (!spot || spot.x !== Math.floor(boxX) + 0.5 || spot.z !== Math.floor(boxZ) + 0.5 || d.getTileFlagsAt(boxX, boxZ) !== 0) return false;
        if (!d.isSpaceOpenAt(boxX, mouth.floorY + 0.24, boxZ) || Math.abs(d.getFloorHeightAt(boxX, boxZ) - mouth.floorY) > 0.01) return false;
        if (d.looseObjects.some((other) => other !== cover && Math.hypot(other.x - boxX, other.z - boxZ) < 1)) return false;
        // Nothing of the station's stands or lies where the box will: litter is low and stops nobody, but a
        // box put down on it slides off. (Its own reach and a little more: the frame of the mouth is just outside that.)
        for (const prop of d.worldProps) {
          if (prop.isRemoved || prop.minimumY > mouth.floorY + 0.6 || prop.maximumY < mouth.floorY + 0.005) continue;
          const halfX = prop.boundsHalfX !== undefined ? prop.boundsHalfX : (prop.radius || 0), halfZ = prop.boundsHalfZ !== undefined ? prop.boundsHalfZ : (prop.radius || 0);
          if (Math.abs(prop.centerX - boxX) < halfX + 0.3 && Math.abs(prop.centerZ - boxZ) < halfZ + 0.3) return false;
        }
      }
      return true;
    };
    const roomyPair = function (standingCovers) {
      for (const outward of standingCovers.filter((cover) => hasStretchWithRoom(cover, -outSpread, outSpread))) {
        const aside = standingCovers.find((cover) => cover !== outward && hasStretchWithRoom(cover, asideFrom, asideTo) && hasStretchWithRoom(cover, -asideTo, -asideFrom) && hasFloorForABoxBeside(cover));
        if (aside) return { outward: outward, aside: aside };
      }
      return null;
    };
    // And one more with bare floor straight out of its mouth, to be crawled out through: pushed over, it has to
    // land on the floor, and not on a heap of cans or a low crate that happens to lie there. (Bare: nothing in
    // the way at any height, and nothing lying on the floor either, as far out as a cover falls.)
    const hasBareFloorOut = function (cover) {
      if (!hasRoomAlong(cover, 0)) return false;
      const mouth = mouthOf(cover);
      for (const alongTheWall of [-0.5, 0, 0.5]) {
        const fromX = cover.x - mouth.outwardX * 0.2 + mouth.outwardZ * alongTheWall, fromZ = cover.z - mouth.outwardZ * 0.2 - mouth.outwardX * alongTheWall;
        if (d.castScannerRay(fromX, mouth.floorY + 0.06, fromZ, -mouth.outwardX, 0, -mouth.outwardZ, 1.9) && d.rayHit.distance < 1.9) return false;
      }
      return true;
    };
    const bareOf = function (standingCovers) {
      const pair = roomyPair(standingCovers);
      return pair ? standingCovers.find((cover) => cover !== pair.outward && cover !== pair.aside && hasBareFloorOut(cover)) : undefined;
    };
    let standing = survey('massive', (all) => { const standingCovers = all.filter((entry) => entry.item.on === 'vent').map((entry) => entry.object); return standingCovers.length >= 5 && roomyPair(standingCovers) !== null && bareOf(standingCovers) !== undefined; })
      .filter((entry) => entry.item.on === 'vent').map((entry) => entry.object);
    const roomy = roomyPair(standing), bare = bareOf(standing);
    if (standing.length < 5 || !roomy || !bare) { result.notFound = 'no massive station among the first forty seeds has five covers standing, among them one with room somewhere out of its duct, another with room along the wall on both sides and floor there for a box, and a third with bare floor in front of it'; return result; }
    // (In the order the checks below take them: two of the others; third the one with bare floor, to be crawled
    // out through; fourth and fifth the roomy two, for the Hollow coming out and for the Hollow going in. Then
    // whatever else stands in that station, which may be a good many.)
    const others = standing.filter((cover) => cover !== roomy.outward && cover !== roomy.aside && cover !== bare);
    standing = others.slice(0, 2).concat([bare, roomy.outward, roomy.aside], others.slice(2));

    // The rule itself, asked of every cover that stands in that station, both ways through its mouth: the ways
    // it looks along run from one end of the fan to the other and nowhere else, about as far apart as the game
    // says (never half as far again); each has the room the game measures along it when asked again; the way it
    // takes is one of them, and has as much room as any of them (room is measured no further than "room enough",
    // so every way with room enough is as good as another); and asked twice, it takes the same way and turns the
    // cover the same.
    result.rule = { covers: standing.length, asked: 0, withRoomEnough: 0, withLess: 0, wrong: [] };
    for (const cover of standing) {
      for (const isHollowInTheRoom of [false, true]) {
        const mouth = mouthOf(cover), taken = d.chooseVentCoverThrow(cover, mouth, isHollowInTheRoom), again = d.chooseVentCoverThrow(cover, mouth, isHollowInTheRoom);
        const where = (isHollowInTheRoom ? 'going in at' : 'coming out at') + ' the cover at ' + cover.x.toFixed(1) + ', ' + cover.z.toFixed(1) + ': ';
        const angles = taken.ways.map((way) => way.angle), enough = d.tuning.hollowThrowsCoverRoomMetres, apart = d.tuning.hollowThrowsCoverWayApart;
        result.rule.asked++;
        if (taken.roomMetres >= enough) result.rule.withRoomEnough++; else result.rule.withLess++;
        const sides = isHollowInTheRoom ? [angles.filter((angle) => angle < 0).map((angle) => -angle), angles.filter((angle) => angle > 0)] : [angles];
        const first = isHollowInTheRoom ? asideFrom : -outSpread, last = isHollowInTheRoom ? asideTo : outSpread;
        for (const side of sides) {
          if (side.length < 2 || Math.abs(side[0] - first) > 1e-9 || Math.abs(side[side.length - 1] - last) > 1e-9) result.rule.wrong.push(where + 'the ways it looks along do not run from one end of the fan to the other');
          for (let index = 1; index < side.length; index++) if (side[index] - side[index - 1] > apart * 1.5 + 1e-9 || side[index] <= side[index - 1]) result.rule.wrong.push(where + 'two ways it looks along are further apart than the game says, or out of order');
        }
        for (const way of taken.ways) {
          if (Math.abs(way.roomMetres - d.measureRoomForLooseObject(cover, way.towardsX, way.towardsZ, enough)) > 1e-9) result.rule.wrong.push(where + 'a way does not have the room the game measures along it');
          if (way.roomMetres > taken.roomMetres + 1e-9) result.rule.wrong.push(where + 'it takes a way with ' + taken.roomMetres.toFixed(2) + ' m of room while another has ' + way.roomMetres.toFixed(2));
        }
        if (!taken.ways.some((way) => way.angle === taken.angle && way.roomMetres === taken.roomMetres && way.towardsX === taken.towardsX && way.towardsZ === taken.towardsZ)) result.rule.wrong.push(where + 'the way it takes is not one of the ways it looked along');
        if (again.angle !== taken.angle || again.random() !== taken.random() || again.random() !== taken.random() || again.random() !== taken.random()) result.rule.wrong.push(where + 'asked twice, it does not take the same way or turn the cover the same');
      }
    }

    // The station as it was when it was looked at, again, and that cover in it: for the Hollow's throws. They are
    // made from the same beginning each time, because the same beginning is what must give the same throw; and
    // so that no cover lies in the way that the checks before moved there.
    const chosenSeed = result.counts[result.counts.length - 1].seed;
    const indexOf = new Map(standing.map((cover) => [cover, d.looseObjects.indexOf(cover)])); // (where each is in the station's list)
    const asItWas = function (cover) {
      const index = indexOf.get(cover);
      d.loadStation('generated', chosenSeed, 'massive', 'mixed', 'one');
      d.game.flags.hasLeftLift = true; d.game.flags.powerOn = true;
      d.setDebugOption('freezeCreatures', true); d.hollow.isActive = false;
      const again = d.looseObjects[index];
      indexOf.set(again, index);
      return again;
    };

    // One taken off with the beam: quietly, and then the vent is open.
    let cover = standing[0], mouth = mouthOf(cover);
    lab.stand(cover.x - mouth.outwardX * 1.6, cover.z - mouth.outwardZ * 1.6, Math.atan2(mouth.outwardX, -mouth.outwardZ));
    p.pitch = -0.4;
    d.simulate(0.2);
    result.scanBefore = into(mouth, 3);
    before = lab.knocks();
    result.taken = { picked: d.pickUpLooseObject(cover, false) };
    d.simulate(1.5);
    result.taken.held = d.getHeldLooseObject() === cover; result.taken.knocks = lab.since(before); result.taken.slowsYouTo = lab.round(d.getCarrySpeedFactor()); result.taken.bulky = cover.kind.bulky;
    result.taken.byItsWeight = lab.round(1 / (1 + cover.kind.mass * d.tuning.carrySlowdownPerKilogram));
    // Turned away and put down behind you: now nothing stands in front of the mouth.
    p.yaw += Math.PI;
    d.simulate(1.5);
    p.pitch = -1.1;
    d.simulate(1.5);
    d.releaseHeldLooseObject(0);
    d.simulate(2);
    result.scanAfter = into(mouth, 3);

    // One crawled into from the room: it is bigger than the mouth, and you do not get in.
    cover = standing[1]; mouth = mouthOf(cover);
    lab.stand(cover.x - mouth.outwardX * 1.5, cover.z - mouth.outwardZ * 1.5, Math.atan2(mouth.outwardX, -mouth.outwardZ));
    d.input.keysDown.add('KeyC');
    d.simulate(0.8);
    d.input.keysDown.add('KeyW');
    let furthestIn = -9, coverFurthestIn = -9;
    for (let step = 0; step < 180; step++) { d.simulate(1 / 30); furthestIn = Math.max(furthestIn, along(mouth, p.x, p.z)); coverFurthestIn = Math.max(coverFurthestIn, along(mouth, cover.x, cover.z)); }
    d.input.keysDown.clear();
    result.fromTheRoom = { youGotAsFarAs: furthestIn, itGotAsFarAs: coverFurthestIn, youInTheVent: d.isVentAt(p.x, p.z), itInTheVent: d.isVentAt(cover.x, cover.z) };

    // One crawled out through, from inside the duct: it goes over into the room, and that carries.
    cover = standing[2]; mouth = mouthOf(cover);
    lab.stand(mouth.faceX + mouth.outwardX * 1.3, mouth.faceZ + mouth.outwardZ * 1.3, Math.atan2(-mouth.outwardX, mouth.outwardZ));
    d.input.keysDown.add('KeyC');
    d.simulate(0.8);
    before = lab.knocks();
    let carries = 0, knockTime = d.looseState.lastKnock.time;
    d.input.keysDown.add('KeyW');
    for (let step = 0; step < 150; step++) {
      d.simulate(1 / 30);
      if (d.looseState.lastKnock.time !== knockTime) { knockTime = d.looseState.lastKnock.time; carries = Math.max(carries, d.looseState.lastKnock.carries); }
    }
    d.input.keysDown.clear();
    d.simulate(1.5);
    result.fromInside = { liesFlat: Math.abs(cover.matrix[4]) < 0.1, knocks: lab.since(before), carries: lab.round(carries), youAre: along(mouth, p.x, p.z), itLies: along(mouth, cover.x, cover.z), itInTheVent: d.isVentAt(cover.x, cover.z) };

    // The Hollow. Walking past along the wall it leaves a cover alone. Coming out through the vent it throws
    // the cover out across the room: you hear that, with a direction, and the noise does not startle the Hollow.
    const hollowGoes = function (cover, mouth, fromAlong, fromAcross, stepAlong, stepAcross, steps) {
      lab.stand(mouth.faceX - mouth.outwardX * 7, mouth.faceZ - mouth.outwardZ * 7, 0);
      d.simulate(3);
      // Across is along the wall.
      d.spawnHollow(mouth.faceX + mouth.outwardX * fromAlong + mouth.outwardZ * fromAcross, mouth.faceZ + mouth.outwardZ * fromAlong - mouth.outwardX * fromAcross);
      d.hollow.graceTimer = 0; d.hollow.state = 0;
      d.captionCounts.hollowFling = 0;
      lab.noises.length = 0;
      const stoodAt = { x: cover.x, z: cover.z }, thrownBefore = d.looseState.statistics.coversThrown, knocksBefore = lab.knocks();
      for (let step = 0; step < steps; step++) {
        d.hollow.figure.x += (mouth.outwardX * stepAlong + mouth.outwardZ * stepAcross) / 30; d.hollow.figure.z += (mouth.outwardZ * stepAlong - mouth.outwardX * stepAcross) / 30;
        d.simulate(1 / 30);
      }
      d.hollow.isActive = false;
      for (let step = 0; step < 240 && !cover.isAsleep; step++) d.simulate(1 / 30);
      // Which way it was thrown, as the game measures it: round from "straight out of the mouth into the room",
      // in radians. More than nothing is to the one side along the wall, less than nothing to the other.
      // (Nothing at all if it was not thrown.)
      const thrown = d.looseState.lastCoverThrown, wasThrown = d.looseState.statistics.coversThrown > thrownBefore;
      const angle = wasThrown ? Math.atan2(thrown.towardsX * mouth.outwardZ - thrown.towardsZ * mouth.outwardX, -(thrown.towardsX * mouth.outwardX + thrown.towardsZ * mouth.outwardZ)) : null;
      return { thrown: d.looseState.statistics.coversThrown - thrownBefore, metres: lab.round(Math.hypot(cover.x - stoodAt.x, cover.z - stoodAt.z)), itEndedAt: along(mouth, cover.x, cover.z), itInTheVent: d.isVentAt(cover.x, cover.z),
        knocks: lab.since(knocksBefore), said: d.captionCounts.hollowFling, startledIt: lab.noises.length, angle: wasThrown ? lab.round(angle) : null,
        // Where it came to rest and how it lies, to the last digit: for "the same throw twice".
        exactly: [cover.x, cover.y, cover.z, cover.orientationX, cover.orientationY, cover.orientationZ, cover.orientationW] };
    };
    result.fans = { outSpread: outSpread, asideFrom: asideFrom, asideTo: asideTo };
    // Each walk in the station as it was. The last two are made twice, for "the same throw twice".
    const walksPast = function () { cover = asItWas(standing[3]); mouth = mouthOf(cover); return hollowGoes(cover, mouth, -0.75, -2.5, 0, 3, 50); }; // along the wall, three quarters of a metre off it, past the mouth
    const comesOut = function () { cover = asItWas(standing[3]); mouth = mouthOf(cover); return hollowGoes(cover, mouth, 1.5, 0, -3, 0, 45); };     // from inside the duct, out through the mouth
    const goesIn = function () { cover = asItWas(standing[4]); mouth = mouthOf(cover); return hollowGoes(cover, mouth, -2.6, 0, 3, 0, 45); };       // from the room, in through the mouth
    result.hollowPast = walksPast();
    result.hollowOut = comesOut();
    result.hollowIn = goesIn();
    result.again = { hollowOut: comesOut(), hollowIn: goesIn() };

    // Something heavy standing beside the mouth, first on one side and then on the other: going in from the
    // room, the Hollow throws the cover to the side that is open. (The box of tools/test-objects.js, which
    // weighs more than the game's looseShoveFreeMass: light things are not in a thrown cover's way.) It stands
    // against the wall, its middle 95 cm along from the cover's: just past the cover's end.
    result.besideABox = [];
    for (const side of [-1, 1]) {
      cover = asItWas(standing[4]); mouth = mouthOf(cover);
      const boxX = cover.x + mouth.outwardZ * side * 0.95 - mouth.outwardX * 0.2, boxZ = cover.z - mouth.outwardX * side * 0.95 - mouth.outwardZ * 0.2;
      const box = d.createLooseObject('testBox', boxX, mouth.floorY + 0.24, boxZ, 0);
      for (let step = 0; step < 90 && !box.isAsleep; step++) d.simulate(1 / 30);
      const boxStoodWithin = lab.round(Math.hypot(box.x - boxX, box.z - boxZ)), gameSeesNoRoomOnThatSide = d.chooseVentCoverThrow(cover, mouth, true).ways.filter((way) => way.angle * side > 0).every((way) => way.roomMetres < 1);
      const went = hollowGoes(cover, mouth, -2.6, 0, 3, 0, 45);
      result.besideABox.push({ boxOnSide: side, boxWeighs: d.looseObjectKinds.testBox.mass, lightIsUnder: d.tuning.looseShoveFreeMass, boxAtRest: box.isAsleep && boxStoodWithin < 0.1, boxStoodWithin: boxStoodWithin,
        gameSeesNoRoomOnThatSide: gameSeesNoRoomOnThatSide, thrown: went.thrown, angle: went.angle, metres: went.metres, itInTheVent: went.itInTheVent });
    }
    lab.reset();
    return result;
  });
  check('there are stations with the covers these checks need, among forty massive stations for each', !covers.notFound, covers.notFound || covers.counts);
  check('every cover belongs to a vent mouth: standing upright in front of it, out in the room, or lying flat on the floor nearby; no station has more covers than mouths; a cover is bigger than the mouth, and worth something',
    // (Each vent has a mouth at either end, but for one that ends on another vent: that has one. A mouth may have no
    // cover, where there is room neither to stand one nor to lay one down.)
    covers.counts.length === 2 && covers.counts.every((station) => station.mouths === station.vents * 2 - station.branches && station.covers <= station.mouths) &&
    covers.counts[0].standing >= 1 && covers.counts[0].standing < covers.counts[0].covers && covers.counts[1].standing >= 5 &&
    covers.size.width > 1 && covers.size.height > covers.size.mouthHeight && covers.size.worth > 0 && covers.wrong.length === 0, [covers.counts, covers.size, covers.wrong]);
  check('a cover that lies flat on the floor is walked over: it stays where it is, without a sound, and so a scan does not show it in the warning colour',
    Boolean(covers.walkedOver) && covers.walkedOver.youWalked > 1.5 && covers.walkedOver.itMoved < 0.02 && covers.walkedOver.knocks.heard + covers.walkedOver.knocks.quiet === 0 &&
    covers.scanLying.isTheCover && covers.scanLying.colour !== 12, [covers.walkedOver, covers.scanLying]);
  check('a cover in front of its vent hides the vent from a scan, in the warning colour; taken off with the beam it comes quietly, slows you by its weight, and the vent is open',
    Boolean(covers.hollowIn) && covers.scanBefore.isTheCover && covers.scanBefore.colour === 12 && covers.scanBefore.metres < 0.7 && covers.taken.picked && covers.taken.held && covers.taken.knocks.heard === 0 && covers.taken.slowsYouTo < 1 && Math.abs(covers.taken.slowsYouTo - covers.taken.byItsWeight) < 0.01 && covers.taken.bulky &&
    !covers.scanAfter.isTheCover && covers.scanAfter.metres > 1.2, [covers.scanBefore, covers.taken, covers.scanAfter]);
  check('crawl into a cover from the room and it does not let you in: it is bigger than the mouth, and neither you nor it gets into the duct',
    Boolean(covers.hollowIn) && !covers.fromTheRoom.youInTheVent && !covers.fromTheRoom.itInTheVent && covers.fromTheRoom.youGotAsFarAs < 0 && covers.fromTheRoom.itGotAsFarAs < 0.05, covers.fromTheRoom);
  check('crawl out through one from inside and it goes over into the room with a clang that carries; it lies flat out there, and you are out',
    Boolean(covers.hollowIn) && covers.fromInside.liesFlat && !covers.fromInside.itInTheVent && covers.fromInside.itLies < -0.3 && covers.fromInside.knocks.heard >= 1 && covers.fromInside.carries > 10 && covers.fromInside.youAre < -0.5, covers.fromInside);
  // (Which way: within the fan the game's numbers give, with a hundredth of a radian for the rounding here.)
  check('the Hollow walking past a covered vent leaves the cover alone; coming out through the vent it throws the cover out across the room: you hear that, with a direction, and it does not startle the Hollow',
    Boolean(covers.hollowIn) && covers.hollowPast.thrown === 0 && covers.hollowPast.metres === 0 && covers.hollowOut.thrown === 1 && covers.hollowOut.metres > 0.8 && !covers.hollowOut.itInTheVent && covers.hollowOut.itEndedAt < -0.3 &&
    Math.abs(covers.hollowOut.angle) <= covers.fans.outSpread + 0.01 &&
    covers.hollowOut.knocks.heard >= 1 && covers.hollowOut.said >= 1 && covers.hollowOut.startledIt === 0, [covers.hollowPast, covers.hollowOut]);
  check('going into a vent from the room, it throws the cover aside along the wall, and the cover does not end up in the duct',
    Boolean(covers.hollowIn) && covers.hollowIn.thrown === 1 && covers.hollowIn.metres > 0.8 && !covers.hollowIn.itInTheVent && covers.hollowIn.startledIt === 0 &&
    Math.abs(covers.hollowIn.angle) >= covers.fans.asideFrom - 0.01 && Math.abs(covers.hollowIn.angle) <= covers.fans.asideTo + 0.01, covers.hollowIn);
  check('which way it throws a cover is not left to chance: the same station and the same mouth, and the cover goes the same way and comes to rest in exactly the same place, coming out and going in',
    Boolean(covers.again) && covers.hollowOut.thrown === 1 && covers.hollowIn.thrown === 1 &&
    JSON.stringify(covers.again.hollowOut) === JSON.stringify(covers.hollowOut) && JSON.stringify(covers.again.hollowIn) === JSON.stringify(covers.hollowIn),
    covers.again ? { comingOut: [covers.hollowOut.exactly, covers.again.hollowOut.exactly], goingIn: [covers.hollowIn.exactly, covers.again.hollowIn.exactly] } : undefined);
  check('it looks where there is room: with something heavy standing beside the mouth on one side it throws the cover to the other side, whichever side that is',
    Boolean(covers.besideABox) && covers.besideABox.length === 2 && covers.besideABox.every((went) => went.boxWeighs >= went.lightIsUnder && went.boxAtRest && went.gameSeesNoRoomOnThatSide &&
      went.thrown === 1 && went.angle * went.boxOnSide < 0 && went.metres > 0.8 && !went.itInTheVent), covers.besideABox);
  check('of the ways it may throw a cover it takes one with the most room, and every way with room enough is as good as another: so for every cover that stands in that station, coming out and going in',
    Boolean(covers.rule) && covers.rule.asked === covers.rule.covers * 2 && covers.rule.covers >= 5 && covers.rule.wrong.length === 0, covers.rule);

  // --- what a knock costs ---
  const breakage = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = {};
    lab.reset();
    lab.setBreakable(true);
    const wall = lab.rockAhead(spot.x, spot.z);
    // How a thing of this kind fares: set down from a crouch, let go of standing up, or thrown as hard as you can.
    const fares = function (kindKey, how) {
      d.clearLooseObjects();
      lab.stand(spot.x, spot.z, Math.PI / 2);
      if (how === 'set down') { d.input.keysDown.add('KeyC'); d.simulate(0.8); }
      const object = lab.carry(kindKey);
      // Set down: you look down at the floor over a second and a half, so that it is lowered and not slammed.
      if (how === 'set down') { for (let step = 0; step < 45; step++) { p.pitch -= 1.1 / 45; d.simulate(1 / 30); } d.simulate(0.8); } else p.pitch = how === 'thrown' ? 0.1 : 0;
      d.captionCounts.ownObjectShatter = 0; d.captionCounts.ownObjectBreak = 0;
      d.clearMessages();
      lab.noises.length = 0;
      const shatteredBefore = d.looseState.statistics.shattered;
      d.releaseHeldLooseObject(how === 'thrown' ? 1 : 0);
      for (let step = 0; step < 300 && !object.isAsleep && !object.isRemoved; step++) d.simulate(1 / 30);
      d.input.keysDown.clear();
      return { whole: object.kind.value, worth: object.isRemoved ? 0 : d.getLooseObjectValue(object), gone: object.isRemoved, shattered: d.looseState.statistics.shattered - shatteredBefore,
        said: lab.messages(), caption: d.captionCounts.ownObjectShatter, captionBreak: d.captionCounts.ownObjectBreak, loudest: lab.round(Math.max.apply(null, [0].concat(lab.noises.map((noise) => noise.radius)))),
        at: [lab.round(object.x), lab.round(object.z)] };
    };
    // How far a shattering carries, as the Hollow hears it: the game makes exactly noiseRadiusShatter of noise, heard by the difficulty's hearing.
    result.shatterCarries = lab.round(d.tuning.noiseRadiusShatter * d.game.difficulty.hearingFactor);
    result.testCase = { setDown: fares('testCase', 'set down'), dropped: fares('testCase', 'dropped'), thrown: fares('testCase', 'thrown') };
    // Something that is not fragile at all (testWeight: fragile 0).
    result.notFragile = { thrown: fares('testWeight', 'thrown') };
    // Thrown again and again, it is never worth less than a tenth of what it was.
    d.clearLooseObjects();
    lab.stand(spot.x, spot.z, Math.PI / 2);
    const battered = lab.carry('testCase');
    for (let again = 0; again < 14; again++) {
      p.pitch = 0.1;
      d.releaseHeldLooseObject(1);
      for (let step = 0; step < 240 && !battered.isAsleep; step++) d.simulate(1 / 30);
      lab.stand(battered.x - 1.2, battered.z, Math.PI / 2);
      p.pitch = Math.atan2(battered.y - d.getPlayerEyeY(), 1.2);
      d.simulate(0.1);
      d.pickUpLooseObject(battered, false);
      d.simulate(1.2);
      lab.stand(spot.x, spot.z, Math.PI / 2);
      d.simulate(0.8);
    }
    result.battered = { worth: d.getLooseObjectValue(battered), whole: battered.kind.value, least: battered.kind.value * d.tuning.looseWorthLeastShare, lostInAll: d.looseState.statistics.worthLost };
    d.releaseHeldLooseObject(0);

    // A sample jar: set down it is whole; carried into a wall at a walk it lives, and is worth a little less;
    // let go of standing up it shatters.
    result.jar = { setDown: fares('testJar', 'set down') };
    d.clearLooseObjects();
    lab.stand(spot.x + wall - 2.6, spot.z, Math.PI / 2);
    const bumped = lab.carry('testJar');
    d.input.keysDown.add('KeyW');
    d.simulate(2.5);
    d.input.keysDown.clear();
    result.jar.walkedIntoAWall = { gone: bumped.isRemoved, worth: bumped.isRemoved ? 0 : d.getLooseObjectValue(bumped), whole: bumped.kind.value, held: d.getHeldLooseObject() === bumped };
    const patchesBefore = d.noisyFloorPatches.length;
    result.jar.dropped = fares('testJar', 'dropped');
    const glass = d.noisyFloorPatches.filter((patch) => patch.isFromPlay);
    result.glass = { patches: d.noisyFloorPatches.length - patchesBefore, kind: glass.length ? glass[0].kind : '', metresFromWhereItBroke: glass.length ? lab.round(Math.hypot(glass[0].x - result.jar.dropped.at[0], glass[0].z - result.jar.dropped.at[1])) : 99,
      pieces: glass.length ? glass[0].props.length : 0, markedLoud: glass.length ? d.findNoisyFloorPatchAt(glass[0].x, glass[0].z) === glass[0] : false };
    // Anything set to shatter does, not only glass: a box told to break at 3 m/s breaks apart when let go of.
    // It leaves nothing: no glass on the floor.
    d.looseObjectKinds.testBox.shattersAt = 3;
    const patchesBeforeTheBox = d.noisyFloorPatches.length;
    result.box = { dropped: fares('testBox', 'dropped'), glassLeft: 0 };
    result.box.glassLeft = d.noisyFloorPatches.length - patchesBeforeTheBox;
    delete d.looseObjectKinds.testBox.shattersAt;
    // Walking across what is left of it is as loud as any broken glass.
    if (glass.length) {
      d.clearLooseObjects();
      d.noisyFloorCounts.byPlayer = 0;
      lab.stand(glass[0].x - 1.6, glass[0].z, Math.PI / 2);
      d.input.keysDown.add('KeyW');
      d.simulate(1.6);
      d.input.keysDown.clear();
      result.glass.setOffByWalkingOverIt = d.noisyFloorCounts.byPlayer;
    }
    // A new descent: the glass is swept up, and what the station has lying about is whole again.
    d.startOver();
    d.game.flags.hasLeftLift = true; d.hollow.isActive = false;
    result.newDescent = { glassLeft: d.noisyFloorPatches.filter((patch) => patch.isFromPlay).length, patches: d.noisyFloorPatches.length - patchesBefore,
      allWhole: d.looseObjects.length > 10 && d.looseObjects.every((object) => d.getLooseObjectValue(object) === object.kind.value), lost: d.looseState.statistics.worthLost };
    lab.reset();
    lab.setBreakable(false);
    return result;
  }, spot);
  check('a knock costs by how hard it is: a case set down from a crouch is worth what it was, let go of standing up it is worth less, thrown it is worth less still',
    breakage.testCase.setDown.worth === breakage.testCase.setDown.whole && breakage.testCase.dropped.worth < breakage.testCase.dropped.whole && breakage.testCase.dropped.worth > breakage.testCase.dropped.whole * 0.6 &&
    breakage.testCase.thrown.worth < breakage.testCase.dropped.worth && !breakage.testCase.thrown.gone, breakage.testCase);
  check('something not fragile at all loses nothing however it is thrown, and a thing thrown again and again is never worth less than the least share of what it was',
    TEST_OBJECT_KINDS.testWeight.fragile === 0 && breakage.notFragile.thrown.worth === breakage.notFragile.thrown.whole &&
    breakage.battered.worth >= Math.round(breakage.battered.least) && breakage.battered.worth <= breakage.battered.whole * 0.25 && breakage.battered.lostInAll > 0, [breakage.notFragile, breakage.battered]);
  check('a glass jar set down is whole; carried into a wall at a walk it lives, worth no more than it was; let go of standing up it shatters, loudly, and is gone',
    !breakage.jar.setDown.gone && breakage.jar.setDown.worth === breakage.jar.setDown.whole && !breakage.jar.walkedIntoAWall.gone && breakage.jar.walkedIntoAWall.held && breakage.jar.walkedIntoAWall.worth <= breakage.jar.walkedIntoAWall.whole &&
    breakage.jar.walkedIntoAWall.worth >= breakage.jar.walkedIntoAWall.whole * 0.7 && breakage.jar.dropped.gone && breakage.jar.dropped.shattered === 1 && breakage.jar.dropped.caption === 1 && breakage.jar.dropped.loudest >= breakage.shatterCarries - 0.01, [breakage.jar, breakage.shatterCarries]);
  check('anything set to shatter does, not only glass: a box told to breaks apart when let go of, loudly, says so, and leaves no glass',
    breakage.box.dropped.gone && breakage.box.dropped.shattered === 1 && breakage.box.dropped.captionBreak === 1 && breakage.box.dropped.caption === 0 && breakage.box.dropped.loudest >= breakage.shatterCarries - 0.01 && breakage.box.glassLeft === 0, breakage.box);
  check('where it shattered there is broken glass on the floor, as loud to walk over as any other; a new descent sweeps it up and has everything whole again',
    breakage.glass.patches === 1 && breakage.glass.kind === 'glass' && breakage.glass.metresFromWhereItBroke < 0.8 && breakage.glass.pieces >= 3 && breakage.glass.markedLoud && breakage.glass.setOffByWalkingOverIt >= 1 &&
    breakage.newDescent.glassLeft === 0 && breakage.newDescent.patches === 0 && breakage.newDescent.allWhole && breakage.newDescent.lost === 0, [breakage.glass, breakage.newDescent]);

  // --- what a thing is worth ---
  await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab;
    lab.reset();
    d.settings.hasPickedSomethingUp = false; // the line that says how to pick a thing up is due
    lab.stand(spot.x, spot.z, Math.PI / 2);
    const object = d.createLooseObject('testCapsule', spot.x + 1, 0.3, spot.z, 0);
    for (let step = 0; step < 150 && !object.isAsleep; step++) d.simulate(1 / 30);
    d.player.pitch = Math.atan2(object.y - d.getPlayerEyeY(), 1); // look at it
    d.simulate(0.1);
  }, spot);
  await drawFrames(page, 3);
  // What is on screen just now: each marker's text and where it is, as shares of the screen's width and height.
  // What floats at a thing is there for a few seconds of the game's own clock, and a browser may run that clock
  // on by itself between two steps of this test. So `before` is done in the same breath as the reading:
  // 'scan' puts half a second of the beam on what you look at, 'wait' lets a marker's few seconds run out.
  const readScreen = (before) => inGame((before) => {
    const d = window.lastReturnDebug, object = d.looseObjects[0], prompt = document.getElementById('hud-prompt');
    if (before === 'scan') { d.setDebugOption('unlimitedScanner', true); d.setScanHeld(true); d.simulate(0.5); d.setScanHeld(false); d.simulate(0.1); }
    if (before === 'wait') d.simulate(d.tuning.looseMarkerSeconds + 0.3);
    d.updateLooseMarkers(1); // which things have a marker is looked at afresh, and each is put where the last drawn frame saw its thing
    const markers = Array.from(document.querySelectorAll('.loose-marker')).filter((element) => !element.hidden).map((element) => {
      const box = element.getBoundingClientRect();
      return { text: element.textContent, across: Math.round((box.left + box.width / 2) / window.innerWidth * 100) / 100, down: Math.round(box.bottom / window.innerHeight * 100) / 100 };
    });
    let remembered = false;
    try { remembered = JSON.parse(window.localStorage.getItem('last-return-settings') || '{}').hasPickedSomethingUp === true; } catch (error) { /* no storage */ }
    return { prompt: prompt.hidden ? '' : prompt.textContent, markers: markers, inReach: d.player.focusedLooseObject === object, remembered: remembered,
      worth: object ? d.getLooseObjectWorth(object) : 0, pulses: object ? object.scanHits : 0, chip: document.getElementById('chip-carrying').hidden ? '' : document.getElementById('chip-carrying').textContent };
  }, before);
  const unread = await readScreen();
  // Scanned where it lies, from where you stand: a second and a half of the ordinary beam.
  const read = await inGame(() => {
    const d = window.lastReturnDebug, object = d.looseObjects[0];
    d.looseState.hasShownAppraisalHint = false;
    d.clearMessages();
    d.setDebugOption('unlimitedScanner', true);
    d.setScanHeld(true); d.simulate(1.5); d.setScanHeld(false); d.simulate(0.1);
    return { worth: d.getLooseObjectWorth(object), really: object.kind.value, pulses: object.scanHits, needed: d.tuning.looseAppraiseHits, messages: window.looseLab.messages() };
  });
  await drawFrames(page, 4);
  const readOnScreen = await readScreen('scan');
  // Only for a few seconds after the scan: then the number is gone, though the thing and its points are still there.
  const aWhileLater = await readScreen('wait');
  // Scanned again, it shows again.
  const rescanned = await readScreen('scan');
  // Picked up: it has no marker while the beam has it, and the status line says what it is worth.
  await inGame(() => { const d = window.lastReturnDebug; d.pickUpLooseObject(d.looseObjects[0], false); d.simulate(0.3); });
  await drawFrames(page, 4);
  const carried = await readScreen();
  // Set down and looked at again. You have picked something up now, so the screen no longer says how, and
  // nothing floats at the thing for being in reach. Scanned again, its worth shows again, as for any other.
  const lookAtIt = () => inGame(() => {
    const d = window.lastReturnDebug, p = d.player, object = d.looseObjects[0];
    p.yaw = Math.atan2(object.x - p.x, -(object.z - p.z));
    p.pitch = Math.atan2(object.y - d.getPlayerEyeY(), Math.hypot(object.x - p.x, object.z - p.z));
    d.simulate(0.2);
  });
  await inGame(() => {
    const d = window.lastReturnDebug, p = d.player, object = d.looseObjects[0];
    d.input.keysDown.add('KeyC'); d.simulate(0.8);
    for (let step = 0; step < 45; step++) { p.pitch -= 1.0 / 45; d.simulate(1 / 30); }
    d.releaseHeldLooseObject(0);
    for (let step = 0; step < 240 && !object.isAsleep; step++) d.simulate(1 / 30);
    d.input.keysDown.clear(); d.simulate(0.6);
  });
  await lookAtIt();
  await drawFrames(page, 4);
  const setDown = await readScreen('wait'); // its last scan is long enough ago
  const scannedAgain = await readScreen('scan');
  // Looked away from: nothing floats where nothing is in view.
  await inGame(() => { const d = window.lastReturnDebug; d.player.yaw += Math.PI; d.player.pitch = 0; d.simulate(0.3); });
  await drawFrames(page, 4);
  const lookedAway = await readScreen();
  await inGame(() => { window.lastReturnDebug.settings.hasPickedSomethingUp = false; });
  // (The thing is this suite's test capsule: what it is called and what it is worth are its own.)
  const capsuleLabel = TEST_OBJECT_KINDS.testCapsule.label, capsuleWorth = TEST_OBJECT_KINDS.testCapsule.value;
  check('what floats at a thing is there for a few seconds after a scan and then gone; scanned again, it is there again',
    aWhileLater.markers.length === 0 && aWhileLater.worth === capsuleWorth && rescanned.markers.length === 1 && rescanned.markers[0].text === String(capsuleWorth), { aWhileLater: aWhileLater, rescanned: rescanned });
  check('what a thing is worth is not on screen until the scanner has read it; then it floats at the thing, as a number, and the line that says how to pick it up does not mention it',
    unread.prompt.endsWith('Pick up the ' + capsuleLabel) && unread.worth === 0 && unread.markers.length === 0 && read.pulses >= read.needed && read.worth === read.really && read.really > 0 &&
    read.messages.some((text) => text.indexOf('The scanner has read what that is: ' + capsuleLabel + ', worth ' + capsuleWorth) >= 0) && readOnScreen.prompt.endsWith('Pick up the ' + capsuleLabel) &&
    readOnScreen.markers.length === 1 && readOnScreen.markers[0].text === String(capsuleWorth) &&
    Math.abs(readOnScreen.markers[0].across - 0.5) < 0.08 && readOnScreen.markers[0].down > 0.25 && readOnScreen.markers[0].down < 0.55,
    { unread: unread, read: read, onScreen: readOnScreen });
  check('in the beam a thing has no marker, and the status line says what it is, not what it is worth', carried.markers.length === 0 && carried.chip === 'CARRYING: ' + capsuleLabel.toUpperCase(), carried);
  check('how to pick a thing up is a tutorial: once you have done it the screen never says it again, and nothing floats at a thing for being in reach; its worth shows when it is scanned, as before',
    setDown.prompt === '' && setDown.markers.length === 0 && setDown.inReach && setDown.remembered &&
    scannedAgain.prompt === '' && scannedAgain.markers.length === 1 && scannedAgain.markers[0].text === String(capsuleWorth) && lookedAway.markers.length === 0,
    { setDown: setDown, scannedAgain: scannedAgain, lookedAway: lookedAway });

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
    // The same throw three times over, and the quickest of the three counts: the clock on the wall also measures
    // whatever else the machine is doing, and that can only make a run look slower, never quicker.
    let tumbling = Infinity;
    for (let attempt = 0; attempt < 3; attempt++) {
      d.clearLooseObjects();
      for (let index = 0; index < 12; index++) {
        const object = d.createLooseObject(kinds[index % kinds.length], spot.x + (index % 4) * 0.7 - 1, 1 + Math.floor(index / 4) * 0.7, spot.z + (index % 3) * 0.7 - 0.7, index);
        object.spinX = 3; object.velocityZ = (index % 2 ? 1 : -1) * 2;
      }
      started = performance.now();
      d.simulate(2);
      tumbling = Math.min(tumbling, performance.now() - started);
    }
    // Given up to a minute for the last of them to stop: a box that came down on a length of pipe rides it across
    // the floor for half a minute before both lie still. How long it took is in the result.
    let secondsToRest = 0;
    while (secondsToRest < 60 && d.looseObjects.some((object) => !object.isAsleep)) { for (let step = 0; step < 30; step++) d.simulate(1 / 30); secondsToRest++; }
    const atRest = d.looseObjects.filter((object) => object.isAsleep).length;
    const notAtRest = d.looseObjects.filter((object) => !object.isAsleep).map((object) => object.kind.label + ' at height ' + lab.round(object.y) + ', moving ' + lab.round(Math.hypot(object.velocityX, object.velocityY, object.velocityZ)) + ' m/s, turning ' + lab.round(Math.hypot(object.spinX, object.spinY, object.spinZ)));
    started = performance.now();
    d.simulate(2);
    const resting = performance.now() - started;
    const allInTheOpen = d.looseObjects.every((object) => lab.isInTheOpen(object.x, object.y, object.z));
    return { millisecondsPerSecondOfPlay: { nothingLoose: Math.round(plain / 2), twelveTumbling: Math.round(tumbling / 2), twelveAtRest: Math.round(resting / 2) }, atRest: atRest, of: d.looseObjects.length, secondsToRest: secondsToRest + 2, notAtRest: notAtRest, allInTheOpen: allInTheOpen };
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
    const object = d.createLooseObject('testCapsule', spot.x + 1, 0.3, spot.z, 0);
    for (let step = 0; step < 150 && !object.isAsleep; step++) d.simulate(1 / 30);
    d.player.pitch = Math.atan2(object.y - d.getPlayerEyeY(), 1); // look at it
    d.simulate(0.1);
    // The hint about the keys is given once a descent, and this descent has had it. Make it due again.
    d.looseState.hasShownCarryHint = false;
    d.settings.hasPickedSomethingUp = false; // and so is the line that says how to pick a thing up
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
  check('looking at an object within reach offers to pick it up, and E does', !beforePickUp.promptHidden && beforePickUp.prompt.indexOf('Pick up the ' + capsuleLabel) >= 0 && beforePickUp.chipHidden && afterPickUp.carrying, [beforePickUp, afterPickUp.carrying]);
  check('the screen says what you carry, and the first time, which key lets go of it',
    !afterPickUp.chipHidden && afterPickUp.chip === 'CARRYING: ' + capsuleLabel.toUpperCase() && afterPickUp.messages.some((text) => /E again lets go/.test(text)), afterPickUp);

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
  // (The pointer is put in place first, while the game is not yet listening to it: once the game takes mouse
  // movement as looking around, moving the pointer there would turn the view away from the object.)
  //
  // The test's browser does capture the mouse, and while it does, every press and release that this script
  // sends arrives with a movement of the pointer that never happened (640 by 360 pixels: the whole way from the
  // corner of the page). The game would take that for the view being whipped round, and on GitHub, where the
  // browser draws frames by itself between the steps below, it did so at once: with the button still down, the
  // thing in the beam was swung and then let go at five metres a second. So for these steps the game is told
  // to take no mouse movement as looking around; the checks turn the view themselves where they need to.
  await page.mouse.move(640, 360);
  await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player;
    d.clearLooseObjects();
    lab.stand(spot.x, spot.z, Math.PI / 2);
    const object = d.createLooseObject('testCapsule', spot.x + 1.6, 0.3, spot.z, 0);
    for (let step = 0; step < 150 && !object.isAsleep; step++) d.simulate(1 / 30);
    p.pitch = Math.atan2(object.y - d.getPlayerEyeY(), 1.6);
    d.simulate(0.1);
    d.input.isPointerLocked = true; // for where the browser does not capture the mouse by itself
    d.input.ignoreLookUntil = performance.now() + 600000; // see above; set back below
    d.input.lookDeltaX = 0; d.input.lookDeltaY = 0;
    d.looseState.hasShownCarryHint = false;
    d.clearMessages();
    // Everything the browser tells the page about the mouse from here on is written down, so that a failure
    // of the checks below says what the browser did. (On GitHub the browser draws frames by itself between
    // the steps of this test, and anything the game is told there it acts on at once.)
    if (!window.mouseLog) {
      window.mouseLog = [];
      for (const type of ['mousemove', 'mousedown', 'mouseup', 'contextmenu', 'blur', 'pointerlockchange', 'visibilitychange']) {
        window.addEventListener(type, function (event) {
          window.mouseLog.push(type + (type === 'mousemove' ? ' ' + (event.movementX || 0) + ',' + (event.movementY || 0) : '') + (event.button !== undefined && type !== 'mousemove' ? ' button ' + event.button : '') + ' mode ' + d.game.mode);
        }, true);
      }
    }
    window.mouseLog.length = 0;
  }, spot);
  await page.mouse.down({ button: 'right' });
  const grabbed = await inGame(() => {
    const d = window.lastReturnDebug;
    d.input.lookDeltaX = 0; d.input.lookDeltaY = 0; // nothing the browser's pointer did counts as looking around
    d.simulate(0.6);
    return { buttonSeen: d.input.isGrabHeld, carrying: d.getHeldLooseObject() !== null, byButton: d.looseState.isHeldByButton, sweeping: d.player.sweepTimeRemaining > 0, messages: window.looseLab.messages() };
  });
  await inGame(() => { const d = window.lastReturnDebug; d.player.pitch = 0; d.simulate(1.5); });
  const stillGrabbed = await inGame(() => window.lastReturnDebug.getHeldLooseObject() !== null);
  await page.mouse.up({ button: 'right' });
  const letGo = await inGame((spot) => {
    const d = window.lastReturnDebug, p = d.player, object = d.looseObjects[0], round = window.looseLab.round;
    const atEntry = { carrying: d.getHeldLooseObject() !== null, velocity: [round(object.velocityX), round(object.velocityY), round(object.velocityZ)],
      yawDegrees: round(p.yaw * 180 / Math.PI), pitchDegrees: round(p.pitch * 180 / Math.PI), movedFromSpot: round(Math.hypot(p.x - spot.x, p.z - spot.z)),
      objectFromYou: [round(object.x - p.x), round(object.y - d.getPlayerEyeY()), round(object.z - p.z)],
      pendingLook: [d.input.lookDeltaX, d.input.lookDeltaY], grabHeld: d.input.isGrabHeld, pointerLockFlag: d.input.isPointerLocked, reallyLocked: document.pointerLockElement !== null, mode: d.game.mode };
    d.simulate(0.05);
    return { carrying: d.getHeldLooseObject() !== null, speed: Math.hypot(object.velocityX, object.velocityZ), objects: d.looseObjects.length, atEntry: atEntry, whatTheBrowserSaid: window.mouseLog.slice(-30) };
  }, spot);
  check('holding the right mouse button on an object within reach takes it into the beam and keeps it there; it does not sweep',
    grabbed.buttonSeen && grabbed.carrying && grabbed.byButton && !grabbed.sweeping && stillGrabbed && grabbed.messages.some((text) => /while you hold the button/.test(text)), grabbed);
  check('letting the button go drops it where it hangs', !letGo.carrying && letGo.speed < 0.6 && Math.abs(letGo.atEntry.yawDegrees - 90) < 0.5, letGo);

  // Swung and let go, it flies: there is no other throw with the mouse.
  // (With an object of its own, put where the last one lay: wherever that one ended up is no concern of this check.)
  const flung = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player;
    d.input.isGrabHeld = false; d.input.lookDeltaX = 0; d.input.lookDeltaY = 0;
    d.clearLooseObjects();
    lab.stand(spot.x, spot.z, Math.PI / 2);
    const object = d.createLooseObject('testCapsule', spot.x + 1.6, 0.3, spot.z, 0);
    for (let step = 0; step < 150 && !object.isAsleep; step++) d.simulate(1 / 30);
    p.yaw = Math.atan2(object.x - p.x, -(object.z - p.z));
    p.pitch = Math.atan2(object.y - d.getPlayerEyeY(), Math.hypot(object.x - p.x, object.z - p.z));
    d.simulate(0.1);
    d.input.isGrabHeld = true;
    d.simulate(1.5);
    const wasCarrying = d.getHeldLooseObject() === object;
    p.pitch = 0.2;
    for (let step = 0; step < 9; step++) { p.yaw += Math.PI / 18; d.simulate(1 / 30); } // a quarter turn in a third of a second
    d.simulate(0.1);
    d.input.isGrabHeld = false;
    d.simulate(1 / 30);
    return { wasCarrying: wasCarrying, carrying: d.getHeldLooseObject() !== null, speed: Math.hypot(object.velocityX, object.velocityY, object.velocityZ) };
  }, spot);
  check('swung round and let go, it keeps the speed of the swing', flung.wasCarrying && !flung.carrying && flung.speed > 2.5, flung);

  // The two ways of holding a thing, E and the right mouse button, together.
  const together = await inGame((spot) => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player, result = {};
    // A thing on the floor in front of you, looked at, with nothing pressed.
    const begin = function () {
      d.input.isGrabHeld = false; d.input.keysDown.clear(); d.input.wantsInteract = false; d.input.lookDeltaX = 0; d.input.lookDeltaY = 0;
      d.clearLooseObjects();
      lab.stand(spot.x, spot.z, Math.PI / 2);
      const object = d.createLooseObject('testTin', spot.x + 1.6, 0.3, spot.z, 0);
      for (let step = 0; step < 150 && !object.isAsleep; step++) d.simulate(1 / 30);
      p.yaw = Math.atan2(object.x - p.x, -(object.z - p.z));
      p.pitch = Math.atan2(object.y - d.getPlayerEyeY(), Math.hypot(object.x - p.x, object.z - p.z));
      d.simulate(0.1);
      return object;
    };
    const metresFromYou = (object) => lab.round(Math.hypot(object.x - p.x, object.z - p.z));
    const pressE = function (seconds) {
      d.input.keysDown.add('KeyE'); d.input.wantsInteract = true;
      d.simulate(Math.max(seconds, 1 / 30));
      d.input.keysDown.delete('KeyE');
      d.simulate(1 / 30);
    };
    d.settings.carryButton = 'hold';

    // Held by the button, thrown with E, the button still down: it flies, and is not taken back.
    let object = begin();
    d.input.isGrabHeld = true; d.simulate(1);
    result.thrown = { carriedByButton: d.getHeldLooseObject() === object && d.looseState.isHeldByButton };
    p.pitch = 0.2; d.simulate(0.3);
    pressE(0.7);
    result.thrown.letGo = d.getHeldLooseObject() === null;
    result.thrown.speed = lab.round(Math.hypot(object.velocityX, object.velocityY, object.velocityZ));
    let everTakenBack = false;
    for (let step = 0; step < 45; step++) { d.simulate(1 / 30); if (d.getHeldLooseObject()) everTakenBack = true; }
    result.thrown.takenBack = everTakenBack; result.thrown.metresFromYou = metresFromYou(object); result.thrown.buttonStillDown = d.input.isGrabHeld;

    // Held by the button, a tap of E: it drops, and the button that is still down does not take it back,
    // though it lies where you are looking. Up and down again, and it does.
    object = begin();
    d.input.isGrabHeld = true; d.simulate(1);
    const carried = d.getHeldLooseObject() === object;
    pressE(0);
    let takenBack = false;
    for (let step = 0; step < 30; step++) {
      d.simulate(1 / 30);
      p.yaw = Math.atan2(object.x - p.x, -(object.z - p.z)); p.pitch = Math.atan2(object.y - d.getPlayerEyeY(), Math.hypot(object.x - p.x, object.z - p.z));
      if (d.getHeldLooseObject()) takenBack = true;
    }
    result.tapped = { carried: carried, takenBack: takenBack, inReach: d.player.focusedLooseObject === object, metresFromYou: metresFromYou(object) };
    d.input.isGrabHeld = false; d.simulate(0.1);
    d.input.isGrabHeld = true; d.simulate(0.5);
    result.tapped.takenAtTheNextPress = d.getHeldLooseObject() === object;
    d.input.isGrabHeld = false; d.simulate(0.2);

    // Taken with E, and then the button goes down: it is the button's, and letting the button go lets go of it.
    object = begin();
    pressE(0);
    result.handedOver = { takenWithE: d.getHeldLooseObject() === object && !d.looseState.isHeldByButton };
    d.simulate(0.5);
    d.input.isGrabHeld = true; d.simulate(0.3);
    result.handedOver.stillCarried = d.getHeldLooseObject() === object; result.handedOver.byButton = d.looseState.isHeldByButton;
    d.input.isGrabHeld = false; d.simulate(0.1);
    result.handedOver.letGo = d.getHeldLooseObject() === null;

    // The button set to "click": it does for a thing what E does.
    d.settings.carryButton = 'toggle';
    object = begin();
    d.input.isGrabHeld = true; d.simulate(0.1);
    result.click = { taken: d.getHeldLooseObject() === object, byButton: d.looseState.isHeldByButton };
    d.simulate(0.8); // (kept down for a while after taking it: that winds up nothing)
    d.input.isGrabHeld = false; d.simulate(0.5);
    result.click.staysAfterTheButtonIsUp = d.getHeldLooseObject() === object;
    d.input.isGrabHeld = true; d.simulate(1 / 30); d.input.isGrabHeld = false; d.simulate(1 / 30);
    result.click.clickLetsGo = d.getHeldLooseObject() === null; result.click.dropSpeed = lab.round(Math.hypot(object.velocityX, object.velocityZ));
    // Taken again, and then held and let go: thrown.
    for (let step = 0; step < 150 && !object.isAsleep; step++) d.simulate(1 / 30);
    p.yaw = Math.atan2(object.x - p.x, -(object.z - p.z)); p.pitch = Math.atan2(object.y - d.getPlayerEyeY(), Math.hypot(object.x - p.x, object.z - p.z));
    d.simulate(0.1);
    d.input.isGrabHeld = true; d.simulate(1 / 30); d.input.isGrabHeld = false; d.simulate(0.5);
    result.click.takenAgain = d.getHeldLooseObject() === object;
    p.pitch = 0.2; d.simulate(0.3);
    d.input.isGrabHeld = true; d.simulate(0.7);
    result.click.windUp = lab.round(d.getThrowWindUp());
    d.input.isGrabHeld = false; d.simulate(1 / 30);
    result.click.thrown = d.getHeldLooseObject() === null; result.click.throwSpeed = lab.round(Math.hypot(object.velocityX, object.velocityY, object.velocityZ));
    d.simulate(1.5);
    result.click.metresFromYou = metresFromYou(object);
    // E still does the same there.
    object = begin();
    pressE(0);
    result.click.eTakes = d.getHeldLooseObject() === object;
    pressE(0);
    result.click.eLetsGo = d.getHeldLooseObject() === null;
    d.settings.carryButton = 'hold';
    d.input.isGrabHeld = false; d.clearLooseObjects(); d.simulate(0.1);
    result.menus = Array.from(document.querySelectorAll('[data-setting="carryButton"]')).map((control) => Array.from(control.options).map((option) => option.value).join());
    return result;
  }, spot);
  check('held with the right mouse button and thrown with E while the button is still down, a thing flies and is not taken straight back',
    together.thrown.carriedByButton && together.thrown.letGo && together.thrown.speed > 3 && !together.thrown.takenBack && together.thrown.buttonStillDown && together.thrown.metresFromYou > 3, together.thrown);
  check('a tap of E drops what the button holds, and the button that is still down does not take it back though it lies in reach; let go of and pressed again, it does',
    together.tapped.carried && !together.tapped.takenBack && together.tapped.inReach && together.tapped.takenAtTheNextPress, together.tapped);
  check('a thing taken with E is the button\'s once the button goes down: letting the button go lets go of it',
    together.handedOver.takenWithE && together.handedOver.stillCarried && together.handedOver.byButton && together.handedOver.letGo, together.handedOver);
  check('with the right mouse button set to "click" it takes a thing and keeps it after the button is up; a click lets go, and held and let go it throws; E does as it always did',
    together.click.taken && !together.click.byButton && together.click.staysAfterTheButtonIsUp && together.click.clickLetsGo && together.click.dropSpeed < 0.6 && together.click.takenAgain &&
    together.click.windUp > 0.25 && together.click.thrown && together.click.throwSpeed > 3 && together.click.metresFromYou > 3 && together.click.eTakes && together.click.eLetsGo, together.click);
  check('the title screen and the pause screen both have the setting, with both choices', together.menus.length === 2 && together.menus.every((values) => values === 'hold,toggle'), together.menus);

  await inGame(() => { const d = window.lastReturnDebug; d.clearLooseObjects(); d.player.heat = 0; d.simulate(0.2); });
  await page.mouse.down({ button: 'right' });
  const rightAlone = await inGame(() => { const d = window.lastReturnDebug; d.simulate(0.1); return d.player.sweepTimeRemaining > 0; });
  await page.mouse.up({ button: 'right' });
  await page.mouse.down({ button: 'middle' });
  const middle = await inGame(() => { const d = window.lastReturnDebug; d.simulate(0.1); return d.player.sweepTimeRemaining > 0; });
  await page.mouse.up({ button: 'middle' });
  await inGame(() => { const d = window.lastReturnDebug; d.simulate(3); d.input.isPointerLocked = false; d.input.ignoreLookUntil = 0; d.input.lookDeltaX = 0; d.input.lookDeltaY = 0; });
  check('the right mouse button no longer sweeps; the wheel button does (and F still does)', !rightAlone && middle, { rightSweeps: rightAlone, middleSweeps: middle });

  // With something to use in front of you, E uses that and you keep what you carry.
  const usedInstead = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player;
    d.clearLooseObjects();
    const target = d.interactables.find((interactable) => interactable.isAvailable);
    if (!target) return null;
    const spot = d.findWalkableSpotNear(target.x, target.z);
    lab.stand(spot.x, spot.z, Math.atan2(target.x - spot.x, -(target.z - spot.z)));
    const object = lab.carry('testJar');
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
    lab.carry('testJar');
    const other = d.createLooseObject('testCase', spot.x + 1.1, 0.2, spot.z, 0);
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
  check('with something in the beam already, E on another object says so', handsFull.lookingAtIt && handsFullAfter.carrying === 'testJar' && handsFullAfter.messages.some((text) => /already holding something/.test(text)), handsFullAfter);

  check('no script errors were reported', problems.length === 0, problems);
  await browser.close();

  // --- on a phone ---
  const phone = await openGame({ dev: true, width: 844, height: 390, isPhone: true });
  await startGame(phone.page, true);
  await installTestObjectKinds(phone.page, TEST_KINDS_OF_THIS_SUITE);
  await phone.page.evaluate(installLab);
  await phone.page.evaluate(() => window.looseLab.setBreakable(false));
  const phoneHint = await phone.page.evaluate(() => {
    const d = window.lastReturnDebug, lab = window.looseLab, p = d.player;
    lab.reset();
    lab.stand(p.x, p.z, p.yaw);
    lab.carry('testCapsule');
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
    const object = lab.carry('testCapsule');
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
  // Something that does something: a button for it appears, and only then.
  await phone.page.evaluate(() => { const d = window.lastReturnDebug, lab = window.looseLab; d.clearLooseObjects(); lab.carry('testCapsule'); d.player.pitch = 0; d.simulate(0.3); });
  await drawFrames(phone.page, 4);
  const phoneWithCapsule = await phone.page.evaluate(() => ({ buttonHidden: document.getElementById('touch-use-carried').hidden }));
  await phone.page.evaluate(() => { const d = window.lastReturnDebug, lab = window.looseLab; d.clearLooseObjects(); lab.carry('scanGrenade'); d.player.pitch = 0; d.simulate(0.3); });
  await drawFrames(phone.page, 4);
  const phoneWithGrenade = await phone.page.evaluate(() => {
    const button = document.getElementById('touch-use-carried'), box = button.getBoundingClientRect(), scan = document.getElementById('touch-scan').getBoundingClientRect();
    return { buttonHidden: button.hidden, says: button.textContent, prompt: document.getElementById('hud-prompt').textContent, onScreen: box.width > 40 && box.right <= window.innerWidth && box.top >= 0,
      clearOfScan: box.bottom <= scan.top + 1, armed: window.lastReturnDebug.getHeldLooseObject().armedTime >= 0 };
  });
  await phone.page.tap('#touch-use-carried');
  await phone.page.evaluate(() => window.lastReturnDebug.simulate(0.1));
  await drawFrames(phone.page, 4);
  const phoneArmed = await phone.page.evaluate(() => { const d = window.lastReturnDebug, grenade = d.getHeldLooseObject(); return { armed: grenade !== null && grenade.armedTime >= 0, buttonHidden: document.getElementById('touch-use-carried').hidden, messages: window.looseLab.messages() }; });
  check('on a phone, a scan grenade in the beam brings up an ARM button above SCAN and a prompt that names it; a capsule, which has nothing to do, does not',
    phoneWithCapsule.buttonHidden && !phoneWithGrenade.buttonHidden && phoneWithGrenade.says === 'ARM' && phoneWithGrenade.prompt === 'ARM · Arm the scan grenade' && phoneWithGrenade.onScreen && phoneWithGrenade.clearOfScan && !phoneWithGrenade.armed,
    [phoneWithCapsule, phoneWithGrenade]);
  check('a tap on it arms the grenade, and the button goes away again', phoneArmed.armed && phoneArmed.buttonHidden && phoneArmed.messages.some((text) => /Armed/.test(text)), phoneArmed);
  check('no script errors were reported on the phone', phone.problems.length === 0, phone.problems);
  await phone.browser.close();

  console.log(failures.length ? '\n' + failures.length + ' check(s) failed.' : '\nAll checks passed.');
  process.exit(failures.length ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
