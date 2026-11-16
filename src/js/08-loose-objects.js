// ---------------------------------------------------------------------------
// Loose objects: things you can pick up, carry, set down and throw.
//
// Each one is a small rigid body. It falls, bounces, tumbles, rolls and comes to rest on the floor, on a
// shelf or on another object. Carried, it hangs in front of you on a spring: it lags behind when you turn,
// stops against a door frame, and is pulled out of your hands when it is left too far behind.
//
// What that does to the game:
//   - A scanner pulse stops on an object like on anything else, so what you carry is in the way of the scanner.
//   - The object hides the points behind it, as a wall does.
//   - Every knock is heard, by you and by the Hollow, by how hard it was. Slow is silent.
//
// This is not a general physics engine, and is not meant to become one. There is one kind of contact (a small
// ball against something solid), objects are never stacked into towers, and nothing is jointed. An object
// is described as boxes, balls and capsules (`parts`); from those the game makes a shell of small balls that
// does the touching, which is what lets a box land on a corner and tip over.
//
// To add a kind of object: add an entry to LOOSE_OBJECT_KINDS. Nothing else needs to change.
// ---------------------------------------------------------------------------

// TWEAK: the objects.
//   label      what it is called on screen ("Pick up the gas canister")
//   mass       kilograms. Heavier lags further behind your hands, slows you more, throws shorter, knocks louder.
//   material   what it sounds like when it hits something: 'metal', 'glass' or 'case' (a dull box)
//   hands      1 or 2. With 2 you cannot run.
//   bounce     0 to 1: how much of its speed it keeps when it bounces. A glass jar 0.2, a steel pipe 0.35.
//   grip       0 to 1: how much it resists sliding. Low slides like a puck, high stops and tips over.
//   parts      its shape, in metres, as it is carried: x to your right, y up, z towards you (so -z points ahead).
//              { shape: 'box', center: [x, y, z], half: [x, y, z] }
//              { shape: 'ball', center: [x, y, z], radius: r }
//              { shape: 'capsule', from: [x, y, z], to: [x, y, z], radius: r }   a rod with round ends
//   hold       where it hangs while carried, from your eyes: metres to the right, down and ahead.
//              The scanner is in your right hand: its lens is about 0.28 to the right, 0.21 down and 0.55 ahead.
//              Something held to the left of that (everything one-handed) is never in the beam's way. Something
//              held in front of it (the two-handed things) is, by as much as it rises above the lens.
const LOOSE_OBJECT_KINDS = {
  canister: {
    label: 'gas canister', mass: 3, material: 'metal', hands: 1, bounce: 0.3, grip: 0.5,
    parts: [{ shape: 'capsule', from: [0, -0.13, 0], to: [0, 0.13, 0], radius: 0.07 }],
    hold: { right: -0.28, down: 0.3, forward: 0.5 }
  },
  jar: {
    label: 'sample jar', mass: 0.8, material: 'glass', hands: 1, bounce: 0.2, grip: 0.45,
    parts: [{ shape: 'capsule', from: [0, -0.05, 0], to: [0, 0.05, 0], radius: 0.06 }],
    hold: { right: -0.26, down: 0.28, forward: 0.45 }
  },
  toolCase: {
    label: 'tool case', mass: 6, material: 'case', hands: 1, bounce: 0.15, grip: 0.6,
    parts: [{ shape: 'box', center: [0, 0, 0], half: [0.21, 0.08, 0.15] }],
    hold: { right: -0.3, down: 0.4, forward: 0.42 }
  },
  pipe: {
    label: 'length of pipe', mass: 4, material: 'metal', hands: 1, bounce: 0.35, grip: 0.4,
    parts: [{ shape: 'capsule', from: [0, 0, -0.6], to: [0, 0, 0.6], radius: 0.03 }],
    hold: { right: -0.32, down: 0.3, forward: 0.75 }
  },
  crate: {
    label: 'crate', mass: 12, material: 'case', hands: 2, bounce: 0.12, grip: 0.7,
    parts: [{ shape: 'box', center: [0, 0, 0], half: [0.25, 0.22, 0.22] }],
    hold: { right: 0.05, down: 0.4, forward: 0.87 }
  },
  pumpMotor: {
    label: 'pump motor', mass: 18, material: 'metal', hands: 2, bounce: 0.1, grip: 0.65,
    parts: [
      { shape: 'capsule', from: [-0.12, 0, 0], to: [0.12, 0, 0], radius: 0.13 },
      { shape: 'capsule', from: [0.12, 0, 0], to: [0.3, 0, 0], radius: 0.035 },
      { shape: 'box', center: [-0.02, -0.14, 0], half: [0.16, 0.025, 0.13] }
    ],
    hold: { right: 0.1, down: 0.29, forward: 0.8 }
  }
};

const LOOSE_SHELL_BALL_RADIUS = 0.06;   // the largest ball in the shell that does a box's touching
const LOOSE_SHELL_BALL_SPACING = 0.16;  // at most this far from one ball of the shell to the next
const LOOSE_MAXIMUM_CONTACTS = 24;
const LOOSE_CONTACT_SLOP = 0.003;       // overlap that is left alone, so that an object at rest is not nudged every step

const looseObjects = [];
const looseState = {
  accumulator: 0,
  nextId: 1,
  held: null,              // the object in your hands, or null
  holdTargetX: 0, holdTargetY: 0, holdTargetZ: 0,
  holdBreakTimer: 0,       // how long the carried object has been too far from your hands
  isLettingGo: false,      // E went down with something in your hands and nothing to use: this press lets go or throws
  lettingGoSeconds: 0,     // ... and has been held this long. A tap lets go, a hold winds up a throw.
  hasShownCarryHint: false,
  hasShownKnockHint: false,
  hollowLastX: 0, hollowLastZ: 0, hollowVelocityX: 0, hollowVelocityZ: 0, hollowWasActive: false,
  // How fast you are really moving, from where you were a frame ago. (`player.velocityX` is how fast your legs
  // are trying to go, which is not the same thing with a wall in front of you.)
  playerLastX: 0, playerLastZ: 0, playerVelocityX: 0, playerVelocityZ: 0, playerWasThere: false,
  // How far something heavy on the floor has pushed back at you this frame (the deepest push, and which way).
  shoveBackDepth: 0, shoveBackX: 0, shoveBackZ: 0,
  // How fast you walked this frame before anything on the floor held you back: that is the speed you kick with.
  playerStrideX: 0, playerStrideZ: 0,
  statistics: { knocksHeard: 0, knocksQuiet: 0, pulledFromHands: 0, lostDownThePit: 0 },
  lastKnock: { x: 0, z: 0, speed: 0, carries: 0, isOwn: false, time: -10 } // the last knock the Hollow could hear: where, how hard, how far it carried
};

// Scratch space, so that a step allocates nothing.
const looseContacts = [];
for (let contactIndex = 0; contactIndex < LOOSE_MAXIMUM_CONTACTS; contactIndex++) {
  looseContacts.push({ normalX: 0, normalY: 0, normalZ: 0, depth: 0, velocityX: 0, velocityZ: 0, other: null, isSoft: false, isPlayer: false });
}
let looseContactCount = 0;
const looseScratchVector = { x: 0, y: 0, z: 0 };
const looseLocalRay = { originX: 0, originY: 0, originZ: 0, directionX: 0, directionY: 0, directionZ: 0 };
const looseCapsuleScratch = new Float32Array(7);

// ---------------------------------------------------------------------------
// Preparing a kind: the shell of balls, the centre of mass, how hard it is to spin
// ---------------------------------------------------------------------------

function addShellBallsForPart(part, balls) {
  if (part.shape === 'ball') {
    balls.push([part.center[0], part.center[1], part.center[2], part.radius]);
  } else if (part.shape === 'capsule') {
    const deltaX = part.to[0] - part.from[0], deltaY = part.to[1] - part.from[1], deltaZ = part.to[2] - part.from[2];
    const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ);
    const steps = Math.max(1, Math.ceil(length / (part.radius * 1.2)));
    for (let step = 0; step <= steps; step++) {
      const along = step / steps;
      balls.push([part.from[0] + deltaX * along, part.from[1] + deltaY * along, part.from[2] + deltaZ * along, part.radius]);
    }
  } else {
    // A box: balls on its faces, edges and corners, set in by their own radius so that the shell is the box's size.
    const radius = Math.min(LOOSE_SHELL_BALL_RADIUS, part.half[0], part.half[1], part.half[2]);
    const counts = [], spans = [];
    for (let axis = 0; axis < 3; axis++) {
      spans.push(Math.max(0, part.half[axis] - radius));
      counts.push(spans[axis] < 0.001 ? 1 : Math.max(2, Math.ceil(spans[axis] * 2 / LOOSE_SHELL_BALL_SPACING) + 1));
    }
    for (let indexX = 0; indexX < counts[0]; indexX++) {
      for (let indexY = 0; indexY < counts[1]; indexY++) {
        for (let indexZ = 0; indexZ < counts[2]; indexZ++) {
          const isOnShell = indexX === 0 || indexX === counts[0] - 1 || indexY === 0 || indexY === counts[1] - 1 || indexZ === 0 || indexZ === counts[2] - 1;
          if (!isOnShell) continue;
          balls.push([
            part.center[0] + (counts[0] === 1 ? 0 : -spans[0] + spans[0] * 2 * indexX / (counts[0] - 1)),
            part.center[1] + (counts[1] === 1 ? 0 : -spans[1] + spans[1] * 2 * indexY / (counts[1] - 1)),
            part.center[2] + (counts[2] === 1 ? 0 : -spans[2] + spans[2] * 2 * indexZ / (counts[2] - 1)),
            radius]);
        }
      }
    }
  }
}

// Works out, once per kind, everything the steps below need. The parts are moved so that the object's own
// origin is its centre of mass: that is the point it turns about.
function prepareLooseObjectKind(kindKey) {
  const kind = LOOSE_OBJECT_KINDS[kindKey];
  if (kind.prepared) return kind.prepared;
  const balls = [];
  for (const part of kind.parts) addShellBallsForPart(part, balls);
  // Weigh each ball by its volume, so that a thin shaft does not pull the centre of mass as far as the motor it is on.
  let totalWeight = 0, centreX = 0, centreY = 0, centreZ = 0;
  for (const ball of balls) {
    const weight = ball[3] * ball[3] * ball[3];
    totalWeight += weight; centreX += ball[0] * weight; centreY += ball[1] * weight; centreZ += ball[2] * weight;
  }
  centreX /= totalWeight; centreY /= totalWeight; centreZ /= totalWeight;
  const shell = new Float32Array(balls.length * 4);
  let inertiaX = 0, inertiaY = 0, inertiaZ = 0, boundsRadius = 0, smallestRadius = Infinity;
  for (let ballIndex = 0; ballIndex < balls.length; ballIndex++) {
    const ball = balls[ballIndex];
    const x = ball[0] - centreX, y = ball[1] - centreY, z = ball[2] - centreZ, radius = ball[3];
    shell[ballIndex * 4] = x; shell[ballIndex * 4 + 1] = y; shell[ballIndex * 4 + 2] = z; shell[ballIndex * 4 + 3] = radius;
    const ballMass = kind.mass * radius * radius * radius / totalWeight;
    const own = 0.4 * radius * radius;
    inertiaX += ballMass * (y * y + z * z + own);
    inertiaY += ballMass * (x * x + z * z + own);
    inertiaZ += ballMass * (x * x + y * y + own);
    boundsRadius = Math.max(boundsRadius, Math.sqrt(x * x + y * y + z * z) + radius);
    smallestRadius = Math.min(smallestRadius, radius);
  }
  const parts = kind.parts.map(function (part) {
    if (part.shape === 'box') return { shape: 'box', centerX: part.center[0] - centreX, centerY: part.center[1] - centreY, centerZ: part.center[2] - centreZ, halfX: part.half[0], halfY: part.half[1], halfZ: part.half[2] };
    if (part.shape === 'ball') return { shape: 'ball', centerX: part.center[0] - centreX, centerY: part.center[1] - centreY, centerZ: part.center[2] - centreZ, radius: part.radius };
    return { shape: 'capsule', radius: part.radius,
      fromX: part.from[0] - centreX, fromY: part.from[1] - centreY, fromZ: part.from[2] - centreZ,
      toX: part.to[0] - centreX, toY: part.to[1] - centreY, toZ: part.to[2] - centreZ };
  });
  // How far any part reaches from the centre of mass. This is more than the shell's reach for a box, whose
  // corners are sharp where the shell's are round: a pulse must be able to land on a corner.
  let partsRadius = 0;
  for (const part of parts) {
    if (part.shape === 'box') {
      partsRadius = Math.max(partsRadius, Math.sqrt(Math.pow(Math.abs(part.centerX) + part.halfX, 2) + Math.pow(Math.abs(part.centerY) + part.halfY, 2) + Math.pow(Math.abs(part.centerZ) + part.halfZ, 2)));
    } else if (part.shape === 'ball') {
      partsRadius = Math.max(partsRadius, Math.sqrt(part.centerX * part.centerX + part.centerY * part.centerY + part.centerZ * part.centerZ) + part.radius);
    } else {
      partsRadius = Math.max(partsRadius, Math.sqrt(part.fromX * part.fromX + part.fromY * part.fromY + part.fromZ * part.fromZ) + part.radius,
        Math.sqrt(part.toX * part.toX + part.toY * part.toY + part.toZ * part.toZ) + part.radius);
    }
  }
  kind.prepared = {
    partsRadius: partsRadius,
    shell: shell, shellCount: balls.length, parts: parts,
    inverseMass: 1 / kind.mass,
    inverseInertiaX: 1 / inertiaX, inverseInertiaY: 1 / inertiaY, inverseInertiaZ: 1 / inertiaZ,
    boundsRadius: boundsRadius, smallestRadius: smallestRadius
  };
  return kind.prepared;
}

// ---------------------------------------------------------------------------
// Making, removing, waking
// ---------------------------------------------------------------------------

// Sets which way an object faces: turned `yaw` about the vertical, the way the player's own yaw is counted.
function setLooseObjectYaw(object, yaw) {
  object.orientationX = 0; object.orientationY = Math.sin(-yaw / 2); object.orientationZ = 0; object.orientationW = Math.cos(-yaw / 2);
  updateLooseObjectMatrix(object);
}

// Sets how an object is turned outright, as a quaternion (x, y, z, w). It is made unit length here.
function setLooseObjectOrientation(object, x, y, z, w) {
  const length = Math.sqrt(x * x + y * y + z * z + w * w) || 1;
  object.orientationX = x / length; object.orientationY = y / length; object.orientationZ = z / length; object.orientationW = w / length;
  updateLooseObjectMatrix(object);
}

// The rotation as nine numbers, row by row: a point of the object is at position + matrix * (its own coordinates).
function updateLooseObjectMatrix(object) {
  const x = object.orientationX, y = object.orientationY, z = object.orientationZ, w = object.orientationW;
  const matrix = object.matrix;
  matrix[0] = 1 - 2 * (y * y + z * z); matrix[1] = 2 * (x * y - w * z); matrix[2] = 2 * (x * z + w * y);
  matrix[3] = 2 * (x * y + w * z); matrix[4] = 1 - 2 * (x * x + z * z); matrix[5] = 2 * (y * z - w * x);
  matrix[6] = 2 * (x * z - w * y); matrix[7] = 2 * (y * z + w * x); matrix[8] = 1 - 2 * (x * x + y * y);
}

function createLooseObject(kindKey, x, y, z, yaw) {
  const kind = LOOSE_OBJECT_KINDS[kindKey];
  if (!kind) return null;
  const prepared = prepareLooseObjectKind(kindKey);
  const object = {
    id: looseState.nextId++,
    kindKey: kindKey, kind: kind, prepared: prepared,
    x: x, y: y, z: z,
    orientationX: 0, orientationY: 0, orientationZ: 0, orientationW: 1,
    matrix: new Float32Array(9),
    velocityX: 0, velocityY: 0, velocityZ: 0,
    spinX: 0, spinY: 0, spinZ: 0,       // how fast it turns, in radians per second, about each axis of the world
    beforeVelocityX: 0, beforeVelocityY: 0, beforeVelocityZ: 0, beforeSpinX: 0, beforeSpinY: 0, beforeSpinZ: 0, // ... and how it was moving a moment ago
    isHeld: false,
    isAsleep: false,                    // at rest: it is left out of the steps until something touches it
    restSeconds: 0,
    touchedThisStep: false,
    lastGoodX: x, lastGoodY: y, lastGoodZ: z,
    // The hardest knock since the last frame, for the sound and the noise.
    knockSpeed: 0, knockX: 0, knockY: 0, knockZ: 0, knockIsOwn: false,
    lastKnockTime: -10,
    lastHandledTime: -10,               // when you last had it in your hands: a knock soon after is your doing
    lastScannedTime: -10,               // when a pulse last landed on it
    hasRestPoints: false,               // it was scanned where it lies, and those points are still on it
    isRemoved: false
  };
  setLooseObjectYaw(object, yaw || 0);
  looseObjects.push(object);
  return object;
}

function clearLooseObjects() {
  looseObjects.length = 0;
  looseState.held = null;
  looseState.accumulator = 0;
  looseState.holdBreakTimer = 0;
  looseState.isLettingGo = false;
  looseState.lettingGoSeconds = 0;
  looseState.hollowWasActive = false;
  looseState.playerWasThere = false; looseState.playerVelocityX = 0; looseState.playerVelocityZ = 0;
}

// A new descent: nothing loose is left over from the last one, and the hints are due again.
function resetLooseObjectsForNewRun() {
  clearLooseObjects();
  looseState.hasShownCarryHint = false;
  looseState.hasShownKnockHint = false;
  const statistics = looseState.statistics;
  statistics.knocksHeard = 0; statistics.knocksQuiet = 0; statistics.pulledFromHands = 0; statistics.lostDownThePit = 0;
}

function removeLooseObject(object) {
  changePointsOnLooseObject(object, 0); // its points do not stay behind in the air
  if (looseState.held === object) looseState.held = null;
  object.isRemoved = true;
  object.isHeld = false;
  const index = looseObjects.indexOf(object);
  if (index >= 0) looseObjects.splice(index, 1);
}

// Is this point (in the station) on the surface of the object, where it is now? A hand's width of slack.
function isPointOnLooseObject(object, x, y, z) {
  const matrix = object.matrix, slack = 0.04;
  const offsetX = x - object.x, offsetY = y - object.y, offsetZ = z - object.z;
  const localX = matrix[0] * offsetX + matrix[3] * offsetY + matrix[6] * offsetZ;
  const localY = matrix[1] * offsetX + matrix[4] * offsetY + matrix[7] * offsetZ;
  const localZ = matrix[2] * offsetX + matrix[5] * offsetY + matrix[8] * offsetZ;
  const parts = object.prepared.parts;
  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    const part = parts[partIndex];
    if (part.shape === 'box') {
      if (Math.abs(localX - part.centerX) <= part.halfX + slack && Math.abs(localY - part.centerY) <= part.halfY + slack && Math.abs(localZ - part.centerZ) <= part.halfZ + slack) return true;
    } else if (part.shape === 'ball') {
      const reach = part.radius + slack;
      if (Math.pow(localX - part.centerX, 2) + Math.pow(localY - part.centerY, 2) + Math.pow(localZ - part.centerZ, 2) <= reach * reach) return true;
    } else {
      // How far from the rod's middle line.
      const alongX = part.toX - part.fromX, alongY = part.toY - part.fromY, alongZ = part.toZ - part.fromZ;
      const lengthSquared = alongX * alongX + alongY * alongY + alongZ * alongZ;
      const share = lengthSquared > 0 ? clampNumber(((localX - part.fromX) * alongX + (localY - part.fromY) * alongY + (localZ - part.fromZ) * alongZ) / lengthSquared, 0, 1) : 0;
      const reach = part.radius + slack;
      if (Math.pow(localX - part.fromX - alongX * share, 2) + Math.pow(localY - part.fromY - alongY * share, 2) + Math.pow(localZ - part.fromZ - alongZ * share, 2) <= reach * reach) return true;
    }
  }
  return false;
}

// The points that were scanned onto an object at rest stay where they were measured. When it moves off they
// are let go, the way a door's are when it slides away; when it is taken out of the world they go at once
// (`seconds` 0). Only the points on the object itself: the floor it stood on keeps its own.
function changePointsOnLooseObject(object, seconds) {
  const reach = object.prepared.partsRadius + 0.05;
  changePointsOnShape(object.x - reach, object.y - reach, object.z - reach, object.x + reach, object.y + reach, object.z + reach,
    SURFACE_INTERACTIVE, seconds > 0 ? convertSecondsToPointLifeCode(seconds) : 0,
    function (x, y, z) { return isPointOnLooseObject(object, x, y, z); });
}

// A pulse has landed on this object.
function noteLooseObjectScanned(object) {
  object.lastScannedTime = game.time;
  if (object.isAsleep) object.hasRestPoints = true;
}

// Does the object have points on it right now? Only then is it drawn as something solid that hides what is behind it.
function isLooseObjectSeen(object) {
  return object.hasRestPoints || game.time - object.lastScannedTime < TUNING.looseImprintSeconds;
}

// Wakes an object at rest, and with it whatever lies against it or on top of it: take the bottom crate away
// and the one above must fall.
function wakeLooseObject(object) {
  if (!object.isAsleep) return;
  object.isAsleep = false;
  object.restSeconds = 0;
  if (object.hasRestPoints) {
    // Its points stay behind where it lay, and go over the next moment. It is seen for as long as they are.
    changePointsOnLooseObject(object, TUNING.looseImprintSeconds);
    object.hasRestPoints = false;
    object.lastScannedTime = game.time;
  }
  wakeLooseObjectsTouching(object);
}

function wakeLooseObjectsTouching(object) {
  for (let objectIndex = 0; objectIndex < looseObjects.length; objectIndex++) {
    const other = looseObjects[objectIndex];
    if (other === object || !other.isAsleep) continue;
    const reach = object.prepared.boundsRadius + other.prepared.boundsRadius + 0.02;
    const deltaX = other.x - object.x, deltaY = other.y - object.y, deltaZ = other.z - object.z;
    if (deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ < reach * reach) wakeLooseObject(other);
  }
}

// ---------------------------------------------------------------------------
// Scanner pulses
// ---------------------------------------------------------------------------

// Distance along a ray, given in the object's own coordinates, to one box part. -1 for a miss.
function intersectRayWithLooseBox(part, ray) {
  let near = -Infinity, far = Infinity;
  const originX = ray.originX - part.centerX, originY = ray.originY - part.centerY, originZ = ray.originZ - part.centerZ;
  if (Math.abs(ray.directionX) < 1e-9) { if (Math.abs(originX) > part.halfX) return -1; }
  else {
    let first = (-part.halfX - originX) / ray.directionX, second = (part.halfX - originX) / ray.directionX;
    if (first > second) { const swap = first; first = second; second = swap; }
    if (first > near) near = first;
    if (second < far) far = second;
  }
  if (Math.abs(ray.directionY) < 1e-9) { if (Math.abs(originY) > part.halfY) return -1; }
  else {
    let first = (-part.halfY - originY) / ray.directionY, second = (part.halfY - originY) / ray.directionY;
    if (first > second) { const swap = first; first = second; second = swap; }
    if (first > near) near = first;
    if (second < far) far = second;
  }
  if (Math.abs(ray.directionZ) < 1e-9) { if (Math.abs(originZ) > part.halfZ) return -1; }
  else {
    let first = (-part.halfZ - originZ) / ray.directionZ, second = (part.halfZ - originZ) / ray.directionZ;
    if (first > second) { const swap = first; first = second; second = swap; }
    if (first > near) near = first;
    if (second < far) far = second;
  }
  if (near > far || near <= 0) return -1;
  return near;
}

// Distance along a ray (in the world) to the nearest part of one object, or -1.
function intersectRayWithLooseObject(object, originX, originY, originZ, directionX, directionY, directionZ, nearerThan) {
  const toCentreX = object.x - originX, toCentreY = object.y - originY, toCentreZ = object.z - originZ;
  const projection = toCentreX * directionX + toCentreY * directionY + toCentreZ * directionZ;
  const boundsRadius = object.prepared.partsRadius;
  if (projection < -boundsRadius || projection - boundsRadius > nearerThan) return -1;
  const perpendicularSquared = toCentreX * toCentreX + toCentreY * toCentreY + toCentreZ * toCentreZ - projection * projection;
  if (perpendicularSquared > boundsRadius * boundsRadius) return -1;
  // The same ray in the object's own coordinates: the rotation undone.
  const matrix = object.matrix, ray = looseLocalRay;
  ray.originX = -(matrix[0] * toCentreX + matrix[3] * toCentreY + matrix[6] * toCentreZ);
  ray.originY = -(matrix[1] * toCentreX + matrix[4] * toCentreY + matrix[7] * toCentreZ);
  ray.originZ = -(matrix[2] * toCentreX + matrix[5] * toCentreY + matrix[8] * toCentreZ);
  ray.directionX = matrix[0] * directionX + matrix[3] * directionY + matrix[6] * directionZ;
  ray.directionY = matrix[1] * directionX + matrix[4] * directionY + matrix[7] * directionZ;
  ray.directionZ = matrix[2] * directionX + matrix[5] * directionY + matrix[8] * directionZ;
  let best = -1;
  const parts = object.prepared.parts;
  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    const part = parts[partIndex];
    let distance;
    if (part.shape === 'box') {
      distance = intersectRayWithLooseBox(part, ray);
    } else if (part.shape === 'ball') {
      distance = intersectRayWithSphere(part.centerX, part.centerY, part.centerZ, part.radius,
        ray.originX, ray.originY, ray.originZ, ray.directionX, ray.directionY, ray.directionZ);
    } else {
      const capsule = looseCapsuleScratch;
      capsule[0] = part.fromX; capsule[1] = part.fromY; capsule[2] = part.fromZ;
      capsule[3] = part.toX; capsule[4] = part.toY; capsule[5] = part.toZ; capsule[6] = part.radius;
      distance = intersectRayWithCapsule(capsule, 0, ray.originX, ray.originY, ray.originZ, ray.directionX, ray.directionY, ray.directionZ);
    }
    if (distance > 0.03 && distance < nearerThan && (best < 0 || distance < best)) best = distance;
  }
  return best;
}

// The nearest loose object a ray meets before `nearerThan`, or null. `castScannerRay` asks this for every pulse.
let looseRayDistance = 0;
function findLooseObjectOnRay(originX, originY, originZ, directionX, directionY, directionZ, nearerThan) {
  let best = null;
  looseRayDistance = nearerThan;
  for (let objectIndex = 0; objectIndex < looseObjects.length; objectIndex++) {
    if (looseObjects[objectIndex].isHeld) continue;
    const distance = intersectRayWithLooseObject(looseObjects[objectIndex], originX, originY, originZ, directionX, directionY, directionZ, looseRayDistance);
    if (distance > 0) { looseRayDistance = distance; best = looseObjects[objectIndex]; }
  }
  return best;
}

// Where the scanner's lens is in the station: the place the laser lines are drawn from.
const scannerLens = { x: 0, y: 0, z: 0 };
function updateScannerLens(eyeX, eyeY, eyeZ, fieldOfViewDegrees) {
  const lens = getSteadyLensInView(fieldOfViewDegrees), basis = scannerBasis;
  scannerLens.x = eyeX + basis.rightX * lens.x + basis.upX * lens.y - basis.forwardX * lens.z;
  scannerLens.y = eyeY + basis.rightY * lens.x + basis.upY * lens.y - basis.forwardY * lens.z;
  scannerLens.z = eyeZ + basis.rightZ * lens.x + basis.upZ * lens.y - basis.forwardZ * lens.z;
}

// One pulse of the scanner, with what you carry taken into account. Where a pulse lands is worked out from
// your eyes, like everything you see. But the scanner is in your right hand, and its beam is drawn from there:
// so what you carry stops a pulse only when it is on the straight line from the lens to where the pulse was
// going. A canister at your left side is never on that line. A crate held in front of the scanner is.
// Fills `rayHit` and returns true on a hit, like castScannerRay. Call updateScannerLens first.
function castScannerPulse(eyeX, eyeY, eyeZ, directionX, directionY, directionZ, maximumDistance) {
  const isHit = castScannerRay(eyeX, eyeY, eyeZ, directionX, directionY, directionZ, maximumDistance);
  const held = looseState.held;
  if (held === null) return isHit;
  // Where the pulse was going: what it hit, or as far as the scanner reaches.
  const reach = isHit ? rayHit.distance : maximumDistance;
  let alongX = eyeX + directionX * reach - scannerLens.x, alongY = eyeY + directionY * reach - scannerLens.y, alongZ = eyeZ + directionZ * reach - scannerLens.z;
  const length = Math.sqrt(alongX * alongX + alongY * alongY + alongZ * alongZ);
  if (length < 0.05) return isHit;
  alongX /= length; alongY /= length; alongZ /= length;
  const distance = intersectRayWithLooseObject(held, scannerLens.x, scannerLens.y, scannerLens.z, alongX, alongY, alongZ, length);
  if (distance <= 0) return isHit;
  fillRayHit(distance, SURFACE_INTERACTIVE, 0.6 + Math.random() * 0.3, 0, scannerLens.x, scannerLens.y, scannerLens.z, alongX, alongY, alongZ);
  rayHit.looseObject = held;
  return true;
}

// How long a point scanned onto this object stays: for good while it lies still, a moment while it moves.
function getLooseObjectPointLifeCode(object) {
  return object.isAsleep ? 0 : convertSecondsToPointLifeCode(TUNING.looseImprintSeconds);
}

// ---------------------------------------------------------------------------
// What a ball of the shell is touching
// ---------------------------------------------------------------------------

function addLooseContact(normalX, normalY, normalZ, depth) {
  if (looseContactCount >= LOOSE_MAXIMUM_CONTACTS) return null;
  const contact = looseContacts[looseContactCount++];
  contact.normalX = normalX; contact.normalY = normalY; contact.normalZ = normalZ; contact.depth = depth;
  contact.velocityX = 0; contact.velocityZ = 0; contact.other = null; contact.isSoft = false; contact.isPlayer = false;
  return contact;
}

function isLooseSpaceOpenAt(tileX, tileZ, height) {
  if (!isInsideGrid(tileX, tileZ)) return false;
  const index = tileZ * GRID_WIDTH + tileX;
  return tileIsOpen[index] === 1 && tileFloorHeight[index] <= height && tileCeilingHeight[index] >= height;
}

// The ball's centre is inside something solid that fills this tile at this height (rock, the floor of a step,
// a lintel). Push it out through the nearest side that has room beyond it; `otherwise` is used when none has.
function addLooseContactOutOfTile(positionX, positionY, positionZ, radius, tileX, tileZ, otherwiseX, otherwiseY, otherwiseZ, otherwiseDepth) {
  let bestDepth = otherwiseDepth, normalX = otherwiseX, normalY = otherwiseY, normalZ = otherwiseZ;
  const toWest = positionX - tileX, toEast = tileX + 1 - positionX, toNorth = positionZ - tileZ, toSouth = tileZ + 1 - positionZ;
  if (toWest + radius < bestDepth && isLooseSpaceOpenAt(tileX - 1, tileZ, positionY)) { bestDepth = toWest + radius; normalX = -1; normalY = 0; normalZ = 0; }
  if (toEast + radius < bestDepth && isLooseSpaceOpenAt(tileX + 1, tileZ, positionY)) { bestDepth = toEast + radius; normalX = 1; normalY = 0; normalZ = 0; }
  if (toNorth + radius < bestDepth && isLooseSpaceOpenAt(tileX, tileZ - 1, positionY)) { bestDepth = toNorth + radius; normalX = 0; normalY = 0; normalZ = -1; }
  if (toSouth + radius < bestDepth && isLooseSpaceOpenAt(tileX, tileZ + 1, positionY)) { bestDepth = toSouth + radius; normalX = 0; normalY = 0; normalZ = 1; }
  if (bestDepth < Infinity) addLooseContact(normalX, normalY, normalZ, bestDepth);
}

function addLooseContactsWithBoxProp(prop, positionX, positionY, positionZ, radius) {
  const offsetX = positionX - prop.centerX, offsetZ = positionZ - prop.centerZ;
  const localX = offsetX * prop.cosineYaw + offsetZ * prop.sineYaw;
  const localZ = -offsetX * prop.sineYaw + offsetZ * prop.cosineYaw;
  const localY = positionY - prop.centerY;
  const nearestX = clampNumber(localX, -prop.halfX, prop.halfX);
  const nearestY = clampNumber(localY, -prop.halfY, prop.halfY);
  const nearestZ = clampNumber(localZ, -prop.halfZ, prop.halfZ);
  let deltaX = localX - nearestX, deltaY = localY - nearestY, deltaZ = localZ - nearestZ;
  const distanceSquared = deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ;
  if (distanceSquared >= radius * radius) return;
  let depth;
  if (distanceSquared > 1e-10) {
    const distance = Math.sqrt(distanceSquared);
    deltaX /= distance; deltaY /= distance; deltaZ /= distance;
    depth = radius - distance;
  } else {
    // The centre is inside the box: out through the nearest face.
    const insideX = prop.halfX - Math.abs(localX), insideY = prop.halfY - Math.abs(localY), insideZ = prop.halfZ - Math.abs(localZ);
    deltaX = 0; deltaY = 0; deltaZ = 0;
    if (insideY <= insideX && insideY <= insideZ) { deltaY = localY < 0 ? -1 : 1; depth = insideY + radius; }
    else if (insideX <= insideZ) { deltaX = localX < 0 ? -1 : 1; depth = insideX + radius; }
    else { deltaZ = localZ < 0 ? -1 : 1; depth = insideZ + radius; }
  }
  addLooseContact(deltaX * prop.cosineYaw - deltaZ * prop.sineYaw, deltaY, deltaX * prop.sineYaw + deltaZ * prop.cosineYaw, depth);
}

function addLooseContactsWithCylinderProp(prop, positionX, positionY, positionZ, radius) {
  // `along` runs down the cylinder's axis; `acrossA` and `acrossB` are the two directions across it.
  const offsetX = positionX - prop.centerX, offsetY = positionY - prop.centerY, offsetZ = positionZ - prop.centerZ;
  let along, acrossA, acrossB;
  if (prop.axis === AXIS_Y) { along = offsetY; acrossA = offsetX; acrossB = offsetZ; }
  else if (prop.axis === AXIS_X) { along = offsetX; acrossA = offsetY; acrossB = offsetZ; }
  else { along = offsetZ; acrossA = offsetX; acrossB = offsetY; }
  const across = Math.sqrt(acrossA * acrossA + acrossB * acrossB);
  const overEnd = Math.abs(along) - prop.halfLength, overSide = across - prop.radius;
  if (overEnd >= radius || overSide >= radius) return;
  let normalAlong = 0, normalA = 0, normalB = 0, depth;
  const sign = along < 0 ? -1 : 1;
  if (overEnd <= 0 && overSide <= 0) {
    // Inside: out through whichever is nearer, the end or the side.
    if (-overEnd < -overSide) { normalAlong = sign; depth = -overEnd + radius; }
    else if (across > 1e-6) { normalA = acrossA / across; normalB = acrossB / across; depth = -overSide + radius; }
    else { normalAlong = sign; depth = -overEnd + radius; }
  } else if (overEnd <= 0) {
    normalA = acrossA / across; normalB = acrossB / across; depth = radius - overSide;
  } else if (overSide <= 0) {
    normalAlong = sign; depth = radius - overEnd;
  } else {
    // Off the rim.
    const distance = Math.sqrt(overEnd * overEnd + overSide * overSide);
    if (distance >= radius) return;
    normalAlong = sign * overEnd / distance; normalA = acrossA / across * overSide / distance; normalB = acrossB / across * overSide / distance;
    depth = radius - distance;
  }
  if (prop.axis === AXIS_Y) addLooseContact(normalA, normalAlong, normalB, depth);
  else if (prop.axis === AXIS_X) addLooseContact(normalAlong, normalA, normalB, depth);
  else addLooseContact(normalA, normalB, normalAlong, depth);
}

// How much of your push a thing of this weight takes out of your stride: 0 for something you kick along without
// feeling it, 1 for something that does not move for your shins at all and stops you.
function getLooseShoveResistance(mass) {
  return clampNumber((mass - TUNING.looseShoveFreeMass) / (TUNING.looseShoveBlockMass - TUNING.looseShoveFreeMass), 0, 1);
}

// Something that walks (you, the Hollow), as an upright post. It shoves the object along. The Hollow is not
// held up by anything. You are, by as much as the thing weighs: `resistance` is 0 to 1 (see above).
function addLooseContactWithWalker(isPlayer, resistance, walkerX, walkerZ, walkerRadius, bottomY, topY, velocityX, velocityZ, positionX, positionY, positionZ, radius) {
  if (positionY < bottomY - radius * 0.5 || positionY > topY + radius * 0.5) return;
  const deltaX = positionX - walkerX, deltaZ = positionZ - walkerZ;
  const distanceSquared = deltaX * deltaX + deltaZ * deltaZ, reach = walkerRadius + radius;
  if (distanceSquared >= reach * reach || distanceSquared < 1e-8) return;
  const distance = Math.sqrt(distanceSquared);
  const contact = addLooseContact(deltaX / distance, 0, deltaZ / distance, reach - distance);
  if (!contact) return;
  // The heavier it is, the less of your speed it takes up ...
  contact.velocityX = velocityX * (1 - resistance); contact.velocityZ = velocityZ * (1 - resistance);
  contact.isSoft = true; contact.isPlayer = isPlayer;
  // ... and the more of the overlap is yours to give back.
  const pushBack = (reach - distance) * resistance;
  if (isPlayer && pushBack > looseState.shoveBackDepth) {
    looseState.shoveBackDepth = pushBack;
    looseState.shoveBackX = -deltaX / distance; looseState.shoveBackZ = -deltaZ / distance;
  }
}

// Fills `looseContacts` with everything one ball of `object`'s shell overlaps.
function collectLooseContacts(object, positionX, positionY, positionZ, radius) {
  looseContactCount = 0;
  const firstTileX = Math.floor(positionX - radius), lastTileX = Math.floor(positionX + radius);
  const firstTileZ = Math.floor(positionZ - radius), lastTileZ = Math.floor(positionZ + radius);
  const stamp = ++collisionStampCounter;
  for (let tileZ = firstTileZ; tileZ <= lastTileZ; tileZ++) {
    for (let tileX = firstTileX; tileX <= lastTileX; tileX++) {
      const nearestX = clampNumber(positionX, tileX, tileX + 1), nearestZ = clampNumber(positionZ, tileZ, tileZ + 1);
      const deltaX = positionX - nearestX, deltaZ = positionZ - nearestZ;
      const acrossSquared = deltaX * deltaX + deltaZ * deltaZ;
      if (acrossSquared >= radius * radius) continue;
      const isBeside = acrossSquared > 1e-10;
      const across = isBeside ? Math.sqrt(acrossSquared) : 0;
      const index = tileZ * GRID_WIDTH + tileX;
      if (!isInsideGrid(tileX, tileZ) || tileIsOpen[index] === 0) {
        // Rock, from top to bottom.
        if (isBeside) addLooseContact(deltaX / across, 0, deltaZ / across, radius - across);
        else addLooseContactOutOfTile(positionX, positionY, positionZ, radius, tileX, tileZ, 0, 0, 0, Infinity);
        continue;
      }
      const floorHeight = tileFloorHeight[index], ceilingHeight = tileCeilingHeight[index];
      if (positionY - radius < floorHeight) {
        if (positionY >= floorHeight) {
          // Above this floor and close to it: flat on it, or over the edge of a step.
          const deltaY = positionY - floorHeight;
          const distanceSquared = acrossSquared + deltaY * deltaY;
          if (distanceSquared < radius * radius) {
            const distance = Math.sqrt(distanceSquared);
            if (distance > 1e-6) addLooseContact(deltaX / distance, deltaY / distance, deltaZ / distance, radius - distance);
            else addLooseContact(0, 1, 0, radius);
          }
        } else if (isBeside) {
          addLooseContact(deltaX / across, 0, deltaZ / across, radius - across); // the side of a step
        } else {
          addLooseContactOutOfTile(positionX, positionY, positionZ, radius, tileX, tileZ, 0, 1, 0, floorHeight - positionY + radius);
        }
      }
      if (positionY + radius > ceilingHeight) {
        if (positionY <= ceilingHeight) {
          const deltaY = ceilingHeight - positionY;
          const distanceSquared = acrossSquared + deltaY * deltaY;
          if (distanceSquared < radius * radius) {
            const distance = Math.sqrt(distanceSquared);
            if (distance > 1e-6) addLooseContact(deltaX / distance, -deltaY / distance, deltaZ / distance, radius - distance);
            else addLooseContact(0, -1, 0, radius);
          }
        } else if (isBeside) {
          addLooseContact(deltaX / across, 0, deltaZ / across, radius - across); // the wall over a doorway or a vent
        } else {
          addLooseContactOutOfTile(positionX, positionY, positionZ, radius, tileX, tileZ, 0, -1, 0, positionY - ceilingHeight + radius);
        }
      }
      const list = tilePropLists[index];
      if (list === null) continue;
      for (let listIndex = 0; listIndex < list.length; listIndex++) {
        const prop = list[listIndex];
        if (prop.collisionStamp === stamp) continue;
        prop.collisionStamp = stamp;
        if (prop.isRemoved) continue;
        if (positionY - radius > prop.maximumY || positionY + radius < prop.minimumY) continue;
        if (prop.kind === PROP_KIND_BOX) addLooseContactsWithBoxProp(prop, positionX, positionY, positionZ, radius);
        else if (prop.kind === PROP_KIND_CYLINDER) addLooseContactsWithCylinderProp(prop, positionX, positionY, positionZ, radius);
        else {
          const offsetX = positionX - prop.centerX, offsetY = positionY - prop.centerY, offsetZ = positionZ - prop.centerZ;
          const distance = Math.sqrt(offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ);
          if (distance < radius + prop.radius && distance > 1e-6) addLooseContact(offsetX / distance, offsetY / distance, offsetZ / distance, radius + prop.radius - distance);
        }
      }
    }
  }

  // Other loose objects.
  for (let objectIndex = 0; objectIndex < looseObjects.length; objectIndex++) {
    const other = looseObjects[objectIndex];
    if (other === object) continue;
    const offsetX = positionX - other.x, offsetY = positionY - other.y, offsetZ = positionZ - other.z;
    const reach = radius + other.prepared.boundsRadius;
    if (offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ >= reach * reach) continue;
    const shell = other.prepared.shell, matrix = other.matrix;
    for (let ballIndex = 0; ballIndex < other.prepared.shellCount; ballIndex++) {
      const localX = shell[ballIndex * 4], localY = shell[ballIndex * 4 + 1], localZ = shell[ballIndex * 4 + 2], otherRadius = shell[ballIndex * 4 + 3];
      const otherX = other.x + matrix[0] * localX + matrix[1] * localY + matrix[2] * localZ;
      const otherY = other.y + matrix[3] * localX + matrix[4] * localY + matrix[5] * localZ;
      const otherZ = other.z + matrix[6] * localX + matrix[7] * localY + matrix[8] * localZ;
      const deltaX = positionX - otherX, deltaY = positionY - otherY, deltaZ = positionZ - otherZ;
      const distanceSquared = deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ, both = radius + otherRadius;
      if (distanceSquared >= both * both || distanceSquared < 1e-10) continue;
      const distance = Math.sqrt(distanceSquared);
      const contact = addLooseContact(deltaX / distance, deltaY / distance, deltaZ / distance, both - distance);
      if (!contact) break;
      contact.other = other;
    }
  }

  // You and the Hollow. What you are carrying passes through you: it is in your hands.
  if (!object.isHeld && game.mode === 'playing') {
    addLooseContactWithWalker(true, getLooseShoveResistance(object.kind.mass), player.x, player.z, TUNING.playerRadius, player.floorY, player.floorY + (player.isCrouching ? 1.0 : 1.7),
      looseState.playerStrideX, looseState.playerStrideZ, positionX, positionY, positionZ, radius);
  }
  if (hollow.isActive) {
    const figure = hollow.figure;
    addLooseContactWithWalker(false, 0, figure.x, figure.z, 0.34, figure.y, figure.y + 1.9,
      looseState.hollowVelocityX, looseState.hollowVelocityZ, positionX, positionY, positionZ, radius);
  }
}

// ---------------------------------------------------------------------------
// Pushes
// ---------------------------------------------------------------------------

// How readily the object turns when pushed about (x, y, z): the answer goes into `looseScratchVector`.
function applyLooseInverseInertia(object, x, y, z) {
  const matrix = object.matrix, prepared = object.prepared;
  const ownX = (matrix[0] * x + matrix[3] * y + matrix[6] * z) * prepared.inverseInertiaX;
  const ownY = (matrix[1] * x + matrix[4] * y + matrix[7] * z) * prepared.inverseInertiaY;
  const ownZ = (matrix[2] * x + matrix[5] * y + matrix[8] * z) * prepared.inverseInertiaZ;
  looseScratchVector.x = matrix[0] * ownX + matrix[1] * ownY + matrix[2] * ownZ;
  looseScratchVector.y = matrix[3] * ownX + matrix[4] * ownY + matrix[5] * ownZ;
  looseScratchVector.z = matrix[6] * ownX + matrix[7] * ownY + matrix[8] * ownZ;
  return looseScratchVector;
}

// How little a push along (directionX, Y, Z) at arm (armX, Y, Z) from the centre of mass moves that point.
function getLoosePushResistance(object, armX, armY, armZ, directionX, directionY, directionZ) {
  const turned = applyLooseInverseInertia(object,
    armY * directionZ - armZ * directionY, armZ * directionX - armX * directionZ, armX * directionY - armY * directionX);
  const crossX = turned.y * armZ - turned.z * armY, crossY = turned.z * armX - turned.x * armZ, crossZ = turned.x * armY - turned.y * armX;
  return object.prepared.inverseMass + crossX * directionX + crossY * directionY + crossZ * directionZ;
}

// A sudden push of (pushX, Y, Z) newton-seconds at arm (armX, Y, Z) from the centre of mass.
function pushLooseObject(object, armX, armY, armZ, pushX, pushY, pushZ) {
  const inverseMass = object.prepared.inverseMass;
  object.velocityX += pushX * inverseMass; object.velocityY += pushY * inverseMass; object.velocityZ += pushZ * inverseMass;
  const turned = applyLooseInverseInertia(object, armY * pushZ - armZ * pushY, armZ * pushX - armX * pushZ, armX * pushY - armY * pushX);
  object.spinX += turned.x; object.spinY += turned.y; object.spinZ += turned.z;
}

// Everything one object is touching at this moment, across all the balls of its shell. Worked out once per
// piece of a step and then settled together: taking the contacts one ball at a time makes a box that lands
// flat kick up on the corner that happened to be looked at first.
const LOOSE_MAXIMUM_TOUCHES = 96;
const LOOSE_SETTLE_PASSES = 6; // TWEAK: how many times the touches are gone over. More is steadier and slower.
const looseTouches = [];
for (let touchIndex = 0; touchIndex < LOOSE_MAXIMUM_TOUCHES; touchIndex++) {
  looseTouches.push({ normalX: 0, normalY: 0, normalZ: 0, depth: 0, armX: 0, armY: 0, armZ: 0, otherArmX: 0, otherArmY: 0, otherArmZ: 0,
    other: null, isSoft: false, isPlayer: false, velocityX: 0, velocityZ: 0, resistance: 1, wantedSpeed: 0, pushed: 0 });
}
let looseTouchCount = 0;

// How fast the touching point of the object is moving away from what it touches (negative: into it).
function getLooseTouchSpeed(object, touch, alongX, alongY, alongZ) {
  let speedX = object.velocityX + object.spinY * touch.armZ - object.spinZ * touch.armY - touch.velocityX;
  let speedY = object.velocityY + object.spinZ * touch.armX - object.spinX * touch.armZ;
  let speedZ = object.velocityZ + object.spinX * touch.armY - object.spinY * touch.armX - touch.velocityZ;
  const other = touch.other;
  if (other) {
    speedX -= other.velocityX + other.spinY * touch.otherArmZ - other.spinZ * touch.otherArmY;
    speedY -= other.velocityY + other.spinZ * touch.otherArmX - other.spinX * touch.otherArmZ;
    speedZ -= other.velocityZ + other.spinX * touch.otherArmY - other.spinY * touch.otherArmX;
  }
  if (alongX === undefined) { looseScratchSpeed.x = speedX; looseScratchSpeed.y = speedY; looseScratchSpeed.z = speedZ; return 0; }
  return speedX * alongX + speedY * alongY + speedZ * alongZ;
}
const looseScratchSpeed = { x: 0, y: 0, z: 0 };

function gatherLooseTouches(object) {
  looseTouchCount = 0;
  const shell = object.prepared.shell, matrix = object.matrix;
  for (let ballIndex = 0; ballIndex < object.prepared.shellCount; ballIndex++) {
    const localX = shell[ballIndex * 4], localY = shell[ballIndex * 4 + 1], localZ = shell[ballIndex * 4 + 2], radius = shell[ballIndex * 4 + 3];
    const ballX = object.x + matrix[0] * localX + matrix[1] * localY + matrix[2] * localZ;
    const ballY = object.y + matrix[3] * localX + matrix[4] * localY + matrix[5] * localZ;
    const ballZ = object.z + matrix[6] * localX + matrix[7] * localY + matrix[8] * localZ;
    collectLooseContacts(object, ballX, ballY, ballZ, radius);
    for (let contactIndex = 0; contactIndex < looseContactCount && looseTouchCount < LOOSE_MAXIMUM_TOUCHES; contactIndex++) {
      const contact = looseContacts[contactIndex], touch = looseTouches[looseTouchCount++];
      const normalX = contact.normalX, normalY = contact.normalY, normalZ = contact.normalZ;
      const pointX = ballX - normalX * radius, pointY = ballY - normalY * radius, pointZ = ballZ - normalZ * radius;
      touch.normalX = normalX; touch.normalY = normalY; touch.normalZ = normalZ; touch.depth = contact.depth;
      touch.armX = pointX - object.x; touch.armY = pointY - object.y; touch.armZ = pointZ - object.z;
      touch.other = contact.other; touch.isSoft = contact.isSoft; touch.isPlayer = contact.isPlayer;
      touch.velocityX = contact.velocityX; touch.velocityZ = contact.velocityZ;
      touch.pushed = 0;
      touch.resistance = getLoosePushResistance(object, touch.armX, touch.armY, touch.armZ, normalX, normalY, normalZ);
      let other = contact.other;
      if (other) {
        touch.otherArmX = pointX - other.x; touch.otherArmY = pointY - other.y; touch.otherArmZ = pointZ - other.z;
      }
      // How fast it came in. This is measured from how it was moving before this piece of the step began: your
      // hands pressing a carried object against a wall, and gravity pressing one into the floor, are pushes and
      // not hits, and must neither bounce nor be heard.
      let cameInX = object.beforeVelocityX + object.beforeSpinY * touch.armZ - object.beforeSpinZ * touch.armY - touch.velocityX;
      let cameInY = object.beforeVelocityY + object.beforeSpinZ * touch.armX - object.beforeSpinX * touch.armZ;
      let cameInZ = object.beforeVelocityZ + object.beforeSpinX * touch.armY - object.beforeSpinY * touch.armX - touch.velocityZ;
      if (other) {
        cameInX -= other.velocityX + other.spinY * touch.otherArmZ - other.spinZ * touch.otherArmY;
        cameInY -= other.velocityY + other.spinZ * touch.otherArmX - other.spinX * touch.otherArmZ;
        cameInZ -= other.velocityZ + other.spinX * touch.otherArmY - other.spinY * touch.otherArmX;
      }
      const closingSpeed = -(cameInX * normalX + cameInY * normalY + cameInZ * normalZ);
      // Another object that lies at rest is as good as part of the floor, until it is hit hard enough to shift it.
      // (Two things leaning on each other would otherwise keep each other awake for ever.)
      if (other && other.isAsleep) {
        if (closingSpeed > TUNING.looseWakeFromSpeed) wakeLooseObject(other);
        else { other = null; touch.other = null; }
      }
      if (other) touch.resistance += getLoosePushResistance(other, touch.otherArmX, touch.otherArmY, touch.otherArmZ, normalX, normalY, normalZ);
      // How fast it should be leaving once this is settled: not at all, or bouncing off if it came in fast.
      // In your hands it never bounces: your arms take that up.
      touch.wantedSpeed = !touch.isSoft && !object.isHeld && closingSpeed > TUNING.looseBounceFromSpeed ? closingSpeed * object.kind.bounce : 0;
      if (closingSpeed > object.knockSpeed) {
        object.knockSpeed = closingSpeed;
        object.knockX = pointX; object.knockY = pointY; object.knockZ = pointZ;
        // A knock is yours when it is in your hands, when you have just let go of it, or when you walked into it.
        object.knockIsOwn = object.isHeld || game.time - object.lastHandledTime < 4 || touch.isPlayer;
      }
    }
  }
  return looseTouchCount;
}

// Stops the object going into what it touches, lets it bounce and grip, and moves it back out.
function settleLooseTouches(object) {
  const count = looseTouchCount;
  if (count === 0) return;
  object.touchedThisStep = true;
  for (let pass = 0; pass < LOOSE_SETTLE_PASSES; pass++) {
    for (let touchIndex = 0; touchIndex < count; touchIndex++) {
      const touch = looseTouches[touchIndex];
      const leavingSpeed = getLooseTouchSpeed(object, touch, touch.normalX, touch.normalY, touch.normalZ);
      // A touch can only push, never pull: what counts is the total it has given so far.
      const before = touch.pushed;
      touch.pushed = Math.max(0, before + (touch.wantedSpeed - leavingSpeed) / touch.resistance);
      const push = touch.pushed - before;
      if (push === 0) continue;
      pushLooseObject(object, touch.armX, touch.armY, touch.armZ, touch.normalX * push, touch.normalY * push, touch.normalZ * push);
      if (touch.other) pushLooseObject(touch.other, touch.otherArmX, touch.otherArmY, touch.otherArmZ, -touch.normalX * push, -touch.normalY * push, -touch.normalZ * push);
    }
  }
  // Grip: a push against the slide, no stronger than the surface can give for how hard the two are pressed together.
  for (let touchIndex = 0; touchIndex < count; touchIndex++) {
    const touch = looseTouches[touchIndex];
    if (touch.isSoft || touch.pushed <= 0) continue;
    getLooseTouchSpeed(object, touch);
    let slideX = looseScratchSpeed.x, slideY = looseScratchSpeed.y, slideZ = looseScratchSpeed.z;
    const into = slideX * touch.normalX + slideY * touch.normalY + slideZ * touch.normalZ;
    slideX -= touch.normalX * into; slideY -= touch.normalY * into; slideZ -= touch.normalZ * into;
    const slide = Math.sqrt(slideX * slideX + slideY * slideY + slideZ * slideZ);
    if (slide < 1e-4) continue;
    slideX /= slide; slideY /= slide; slideZ /= slide;
    let slideResistance = getLoosePushResistance(object, touch.armX, touch.armY, touch.armZ, slideX, slideY, slideZ);
    if (touch.other) slideResistance += getLoosePushResistance(touch.other, touch.otherArmX, touch.otherArmY, touch.otherArmZ, slideX, slideY, slideZ);
    const grip = Math.min(object.kind.grip * touch.pushed, slide / slideResistance);
    pushLooseObject(object, touch.armX, touch.armY, touch.armZ, -slideX * grip, -slideY * grip, -slideZ * grip);
    if (touch.other) pushLooseObject(touch.other, touch.otherArmX, touch.otherArmY, touch.otherArmZ, slideX * grip, slideY * grip, slideZ * grip);
  }
  // Out again. Four corners resting on the floor all ask for the same move, so the moves are not added up:
  // along each direction the largest one asked for is made, and most of it, not all (all at once makes an
  // object at rest shiver).
  let moveEast = 0, moveWest = 0, moveUp = 0, moveDown = 0, moveSouth = 0, moveNorth = 0;
  for (let touchIndex = 0; touchIndex < count; touchIndex++) {
    const touch = looseTouches[touchIndex];
    if (touch.isSoft || touch.depth <= LOOSE_CONTACT_SLOP) continue;
    let amount = (touch.depth - LOOSE_CONTACT_SLOP) * 0.8;
    if (touch.other && !touch.other.isHeld) amount *= object.prepared.inverseMass / (object.prepared.inverseMass + touch.other.prepared.inverseMass);
    const x = touch.normalX * amount, y = touch.normalY * amount, z = touch.normalZ * amount;
    if (x > moveEast) moveEast = x; else if (x < moveWest) moveWest = x;
    if (y > moveUp) moveUp = y; else if (y < moveDown) moveDown = y;
    if (z > moveSouth) moveSouth = z; else if (z < moveNorth) moveNorth = z;
  }
  object.x += moveEast + moveWest; object.y += moveUp + moveDown; object.z += moveSouth + moveNorth;
}

// ---------------------------------------------------------------------------
// One step of one object
// ---------------------------------------------------------------------------

// Pulls the carried object towards your hands, and turns it to face the way you face.
function driveHeldLooseObject(object, stepSeconds) {
  const kind = object.kind;
  // TWEAK: these two lines are how carrying feels. `follow` is how fast it wants to close the gap to your hands
  // (per second); `response` how quickly it gets up to that speed. A heavy object is slower at both.
  const follow = TUNING.looseHoldFollowRate / (1 + kind.mass * TUNING.looseHoldLagPerKilogram);
  const response = Math.min(1, TUNING.looseHoldResponseRate / (1 + kind.mass * TUNING.looseHoldLagPerKilogram) * stepSeconds);
  let wantedX = (looseState.holdTargetX - object.x) * follow + looseState.playerVelocityX;
  let wantedY = (looseState.holdTargetY - object.y) * follow;
  let wantedZ = (looseState.holdTargetZ - object.z) * follow + looseState.playerVelocityZ;
  const wantedSpeed = Math.sqrt(wantedX * wantedX + wantedY * wantedY + wantedZ * wantedZ);
  if (wantedSpeed > TUNING.looseHoldFastestSpeed) {
    const scale = TUNING.looseHoldFastestSpeed / wantedSpeed;
    wantedX *= scale; wantedY *= scale; wantedZ *= scale;
  }
  object.velocityX += (wantedX - object.velocityX) * response;
  object.velocityY += (wantedY - object.velocityY) * response;
  object.velocityZ += (wantedZ - object.velocityZ) * response;

  // The turn still to make, from how it is to level and facing your way, as an axis times an angle.
  const targetY = Math.sin(-player.yaw / 2), targetW = Math.cos(-player.yaw / 2);
  const x = object.orientationX, y = object.orientationY, z = object.orientationZ, w = object.orientationW;
  // target * inverse(current), with target = (0, targetY, 0, targetW)
  let errorX = -targetW * x - targetY * z;
  let errorY = -targetW * y + targetY * w;
  let errorZ = -targetW * z + targetY * x;
  let errorW = targetW * w + targetY * y;
  if (errorW < 0) { errorX = -errorX; errorY = -errorY; errorZ = -errorZ; errorW = -errorW; }
  const sine = Math.sqrt(errorX * errorX + errorY * errorY + errorZ * errorZ);
  let turnX = 0, turnY = 0, turnZ = 0;
  if (sine > 1e-5) {
    const angle = 2 * Math.atan2(sine, errorW);
    const rate = angle * follow / sine;
    turnX = errorX * rate; turnY = errorY * rate; turnZ = errorZ * rate;
  }
  object.spinX += (turnX - object.spinX) * response;
  object.spinY += (turnY - object.spinY) * response;
  object.spinZ += (turnZ - object.spinZ) * response;
}

function integrateLooseObject(object, seconds) {
  object.x += object.velocityX * seconds; object.y += object.velocityY * seconds; object.z += object.velocityZ * seconds;
  const x = object.orientationX, y = object.orientationY, z = object.orientationZ, w = object.orientationW;
  const half = seconds * 0.5;
  object.orientationX = x + half * (object.spinX * w + object.spinY * z - object.spinZ * y);
  object.orientationY = y + half * (object.spinY * w + object.spinZ * x - object.spinX * z);
  object.orientationZ = z + half * (object.spinZ * w + object.spinX * y - object.spinY * x);
  object.orientationW = w - half * (object.spinX * x + object.spinY * y + object.spinZ * z);
  const length = Math.sqrt(object.orientationX * object.orientationX + object.orientationY * object.orientationY +
    object.orientationZ * object.orientationZ + object.orientationW * object.orientationW) || 1;
  object.orientationX /= length; object.orientationY /= length; object.orientationZ /= length; object.orientationW /= length;
  updateLooseObjectMatrix(object);
}

function stepLooseObject(object, stepSeconds) {
  // A fast object takes its step in pieces, so that it cannot be on one side of a shelf at the start of a
  // step and on the other at the end: no piece moves it further than half its smallest ball.
  const speed = Math.sqrt(object.velocityX * object.velocityX + object.velocityY * object.velocityY + object.velocityZ * object.velocityZ) +
    Math.sqrt(object.spinX * object.spinX + object.spinY * object.spinY + object.spinZ * object.spinZ) * object.prepared.boundsRadius;
  const pieces = clampNumber(Math.ceil(speed * stepSeconds / (object.prepared.smallestRadius * 0.5)), 1, 12);
  const seconds = stepSeconds / pieces;
  object.touchedThisStep = false;
  for (let piece = 0; piece < pieces; piece++) {
    object.beforeVelocityX = object.velocityX; object.beforeVelocityY = object.velocityY; object.beforeVelocityZ = object.velocityZ;
    object.beforeSpinX = object.spinX; object.beforeSpinY = object.spinY; object.beforeSpinZ = object.spinZ;
    if (object.isHeld) driveHeldLooseObject(object, seconds);
    else object.velocityY -= TUNING.looseGravity * seconds;
    integrateLooseObject(object, seconds);
    gatherLooseTouches(object);
    settleLooseTouches(object);
  }
  // Air and, on the ground, the small losses that bring a rolling thing to a stop.
  const drag = 1 - TUNING.looseAirDrag * stepSeconds;
  object.velocityX *= drag; object.velocityY *= drag; object.velocityZ *= drag;
  const spinDrag = 1 - (object.touchedThisStep ? TUNING.looseRollingDrag : TUNING.looseAirDrag) * stepSeconds;
  object.spinX *= spinDrag; object.spinY *= spinDrag; object.spinZ *= spinDrag;

  // Still in the station? An object that has got into the rock goes back to where it last was not.
  const tileX = Math.floor(object.x), tileZ = Math.floor(object.z);
  if (isLooseSpaceOpenAt(tileX, tileZ, object.y)) {
    object.lastGoodX = object.x; object.lastGoodY = object.y; object.lastGoodZ = object.z;
  } else if (!isInsideGrid(tileX, tileZ) || tileIsOpen[tileZ * GRID_WIDTH + tileX] === 0 ||
      object.y < tileFloorHeight[tileZ * GRID_WIDTH + tileX] - object.prepared.boundsRadius ||
      object.y > tileCeilingHeight[tileZ * GRID_WIDTH + tileX] + object.prepared.boundsRadius) {
    object.x = object.lastGoodX; object.y = object.lastGoodY; object.z = object.lastGoodZ;
    object.velocityX = 0; object.velocityY = 0; object.velocityZ = 0;
  }

  // Rest: slow, touching something, and for long enough.
  if (!object.isHeld && object.touchedThisStep &&
      object.velocityX * object.velocityX + object.velocityY * object.velocityY + object.velocityZ * object.velocityZ < TUNING.looseRestSpeed * TUNING.looseRestSpeed &&
      object.spinX * object.spinX + object.spinY * object.spinY + object.spinZ * object.spinZ < TUNING.looseRestSpin * TUNING.looseRestSpin) {
    object.restSeconds += stepSeconds;
    if (object.restSeconds >= TUNING.looseRestSeconds) {
      object.isAsleep = true;
      object.velocityX = 0; object.velocityY = 0; object.velocityZ = 0;
      object.spinX = 0; object.spinY = 0; object.spinZ = 0;
    }
  } else {
    object.restSeconds = 0;
  }
}

// Is someone walking into an object that is at rest? Then it is woken, and the next step does the rest.
function wakeLooseObjectIfWalkedInto(object, walkerX, walkerZ, walkerRadius, bottomY, topY) {
  const reach = walkerRadius + object.prepared.boundsRadius;
  const deltaX = object.x - walkerX, deltaZ = object.z - walkerZ;
  if (deltaX * deltaX + deltaZ * deltaZ > reach * reach) return;
  if (object.y + object.prepared.boundsRadius < bottomY || object.y - object.prepared.boundsRadius > topY) return;
  wakeLooseObject(object);
}

// ---------------------------------------------------------------------------
// Knocks: the sound, the noise the Hollow hears, the caption
// ---------------------------------------------------------------------------

function reportLooseObjectKnock(object) {
  const speed = object.knockSpeed;
  object.knockSpeed = 0;
  if (speed < TUNING.looseKnockFaintestSpeed) return;
  if (game.time - object.lastKnockTime < TUNING.looseKnockGapSeconds) return;
  object.lastKnockTime = game.time;
  // 0 at the speed below which the Hollow hears nothing, 1 at a full-blooded crash.
  const loudness = clampNumber((speed - TUNING.looseKnockQuietSpeed) / (TUNING.looseKnockLoudSpeed - TUNING.looseKnockQuietSpeed), 0, 1);
  const isHeard = speed >= TUNING.looseKnockQuietSpeed;
  const weight = clampNumber(0.55 + object.kind.mass / 14, 0.6, 1.5);
  playLooseObjectKnock(object.kind.material, isHeard ? 0.3 + loudness * 0.7 : 0.12, weight, object.knockX, object.knockY, object.knockZ);
  if (!isHeard) { looseState.statistics.knocksQuiet++; return; }
  looseState.statistics.knocksHeard++;
  const radius = interpolateLinear(TUNING.noiseRadiusKnockSoft, TUNING.noiseRadiusKnockHard, loudness) * weight;
  const lastKnock = looseState.lastKnock;
  lastKnock.x = object.knockX; lastKnock.z = object.knockZ; lastKnock.speed = speed; lastKnock.carries = radius; lastKnock.isOwn = object.knockIsOwn; lastKnock.time = game.time;
  emitNoise(object.knockX, object.knockZ, radius);
  if (object.knockIsOwn) {
    showCaption(loudness > 0.55 ? 'ownObjectCrash' : 'ownObjectKnock');
    if (!looseState.hasShownKnockHint && hollow.isActive) {
      looseState.hasShownKnockHint = true;
      showMessage('That carried. Move slowly with something in your hands and it will not knock.', 6, 'info');
    }
  } else {
    showCaption(loudness > 0.55 ? 'objectCrash' : 'objectKnock', { x: object.knockX, z: object.knockZ });
  }
}

// ---------------------------------------------------------------------------
// Carrying
// ---------------------------------------------------------------------------

function getHeldLooseObject() {
  return looseState.held;
}

// How much slower you walk with this in your hands: 1 is not at all.
function getCarrySpeedFactor() {
  const held = looseState.held;
  if (!held) return 1;
  return 1 / (1 + held.kind.mass * TUNING.carrySlowdownPerKilogram);
}

function canSprintWhileCarrying() {
  return !looseState.held || looseState.held.kind.hands < 2;
}

// With both arms full you cannot get down on your elbows: a vent is closed to you until you put it down.
function canCrawlWhileCarrying() {
  return !looseState.held || looseState.held.kind.hands < 2;
}

// Where the carried object wants to be: in front of you, lower than your eyes.
// Looking down, it goes down with your look and your arms reach out, so that from a crouch you can lower it
// all the way to the floor and let go of it there without a sound. Looking up, it follows only a little: that
// is how you see over a crate.
function computeLooseHoldTarget(eyeX, eyeY, eyeZ) {
  const held = looseState.held;
  if (!held) return;
  const hold = held.kind.hold;
  const pitch = player.pitch * (player.pitch < 0 ? TUNING.looseHoldPitchShareDown : TUNING.looseHoldPitchShareUp);
  const cosinePitch = Math.cos(pitch), sinePitch = Math.sin(pitch);
  const reach = hold.forward + Math.max(0, -sinePitch) * TUNING.looseHoldReachDown;
  const forwardX = Math.sin(player.yaw) * cosinePitch, forwardY = sinePitch, forwardZ = -Math.cos(player.yaw) * cosinePitch;
  const rightX = Math.cos(player.yaw), rightZ = Math.sin(player.yaw);
  const sag = held.kind.mass * TUNING.looseHoldSagPerKilogram;
  // Reaching down brings it in towards your feet: only the height gets the extra reach.
  looseState.holdTargetX = eyeX + forwardX * hold.forward + rightX * hold.right;
  looseState.holdTargetY = eyeY + forwardY * reach - hold.down - sag;
  looseState.holdTargetZ = eyeZ + forwardZ * hold.forward + rightZ * hold.right;
}

function pickUpLooseObject(object) {
  if (looseState.held || !object || object.isRemoved) return false;
  if (object.kind.hands === 2 && player.isInVent) {
    showMessage('There is no room in here to lift the ' + object.kind.label + '.', 3, 'info');
    return false;
  }
  wakeLooseObject(object);
  wakeLooseObjectsTouching(object);
  object.isHeld = true;
  object.restSeconds = 0;
  object.lastHandledTime = game.time;
  looseState.held = object;
  looseState.holdBreakTimer = 0;
  looseState.isLettingGo = false; // the press that picked it up is not also the press that lets go of it
  looseState.lettingGoSeconds = 0;
  playLooseObjectHandlingSound(object.kind.material, true);
  if (!looseState.hasShownCarryHint) {
    looseState.hasShownCarryHint = true;
    showMessage(input.isTouchDevice
      ? 'USE again lets go of it. Hold USE and let go to throw it.'
      : 'E again lets go of it. Hold E and let go to throw it.', 7, 'info');
  }
  return true;
}

// Lets go of what you carry. `throwStrength` is 0 for just letting go, up to 1 for a full throw.
function releaseHeldLooseObject(throwStrength) {
  const object = looseState.held;
  if (!object) return null;
  looseState.held = null;
  looseState.isLettingGo = false;
  looseState.lettingGoSeconds = 0;
  object.isHeld = false;
  object.lastHandledTime = game.time;
  if (throwStrength > 0) {
    const speed = TUNING.looseThrowSpeed * throwStrength / (1 + object.kind.mass * TUNING.looseThrowLossPerKilogram);
    const cosinePitch = Math.cos(player.pitch);
    const forwardX = Math.sin(player.yaw) * cosinePitch, forwardY = Math.sin(player.pitch), forwardZ = -Math.cos(player.yaw) * cosinePitch;
    object.velocityX = looseState.playerVelocityX + forwardX * speed;
    object.velocityY = forwardY * speed + TUNING.looseThrowLift * throwStrength;
    object.velocityZ = looseState.playerVelocityZ + forwardZ * speed;
    // It leaves your hands turning end over end, away from you.
    object.spinX += Math.cos(player.yaw) * -TUNING.looseThrowSpin * throwStrength;
    object.spinZ += Math.sin(player.yaw) * -TUNING.looseThrowSpin * throwStrength;
    playLooseObjectHandlingSound(object.kind.material, false);
  }
  return object;
}

// E was pressed with something in your hands and nothing in front of you to use (09-player.js calls this).
// What that press does is decided when the key comes up again: let go at once and it only lets go of the
// object; held, it winds up a throw.
function beginLettingGo() {
  if (!looseState.held) return;
  looseState.isLettingGo = true;
  looseState.lettingGoSeconds = 0;
}

function updateLooseCarryInput(dt) {
  if (!looseState.held || !looseState.isLettingGo) { looseState.isLettingGo = false; looseState.lettingGoSeconds = 0; return; }
  const isDown = input.keysDown.has('KeyE') || input.touchUseHeld;
  if (isDown) { looseState.lettingGoSeconds += dt; return; }
  // The key is up. (A tap shorter than one frame arrives here with no time counted at all: that is a tap.)
  const held = looseState.lettingGoSeconds;
  if (held < TUNING.looseThrowTapSeconds) releaseHeldLooseObject(0);
  else releaseHeldLooseObject(clampNumber(held / TUNING.looseThrowChargeSeconds, 0.25, 1));
}

// How far the throw is wound up, 0 to 1, for the screen. 0 while the key is only being tapped.
function getThrowWindUp() {
  if (!looseState.held || !looseState.isLettingGo || looseState.lettingGoSeconds < TUNING.looseThrowTapSeconds) return 0;
  return clampNumber(looseState.lettingGoSeconds / TUNING.looseThrowChargeSeconds, 0.25, 1);
}

// The loose object you are looking at and can reach, with how well it is lined up (0 to 1), or null.
let looseFocusScore = 0;
function findLooseObjectInFocus(eyeX, eyeY, eyeZ, betterThan) {
  let best = null;
  looseFocusScore = betterThan;
  for (let objectIndex = 0; objectIndex < looseObjects.length; objectIndex++) {
    const object = looseObjects[objectIndex];
    if (object.isHeld) continue;
    const deltaX = object.x - eyeX, deltaY = object.y - eyeY, deltaZ = object.z - eyeZ;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ);
    if (distance > TUNING.loosePickUpReach + object.prepared.boundsRadius) continue;
    const alignment = (deltaX * scannerBasis.forwardX + deltaY * scannerBasis.forwardY + deltaZ * scannerBasis.forwardZ) / Math.max(distance, 0.001);
    // A wide object does not need to be looked at dead centre.
    const score = Math.min(1, alignment + object.prepared.boundsRadius * 0.12);
    if (score <= looseFocusScore) continue;
    // Not through a wall or a closed door.
    if (distance > 0.3 && castRayAgainstWorld(eyeX, eyeY, eyeZ, deltaX / distance, deltaY / distance, deltaZ / distance, distance) &&
        rayHit.distance < distance - object.prepared.boundsRadius - 0.05) continue;
    looseFocusScore = score;
    best = object;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Every frame
// ---------------------------------------------------------------------------

// Notes how fast you really moved this frame, for the next one. A jump of metres is a teleport, not a speed.
function rememberPlayerMovement(dt) {
  const movedX = player.x - looseState.playerLastX, movedZ = player.z - looseState.playerLastZ;
  const isSpeed = looseState.playerWasThere && dt > 0 && movedX * movedX + movedZ * movedZ < 1;
  looseState.playerVelocityX = isSpeed ? movedX / dt : 0;
  looseState.playerVelocityZ = isSpeed ? movedZ / dt : 0;
  looseState.playerLastX = player.x; looseState.playerLastZ = player.z; looseState.playerWasThere = true;
}

function updateLooseObjects(dt, eyeX, eyeY, eyeZ) {
  updateLooseCarryInput(dt);
  if (looseObjects.length === 0) { rememberPlayerMovement(dt); return; }
  computeLooseHoldTarget(eyeX, eyeY, eyeZ);
  // How far you walked since the last frame, before anything you carry has had its say.
  let walkedX = player.x - looseState.playerLastX, walkedZ = player.z - looseState.playerLastZ;
  if (!looseState.playerWasThere || walkedX * walkedX + walkedZ * walkedZ > 1) { walkedX = 0; walkedZ = 0; }
  looseState.playerStrideX = dt > 0 ? walkedX / dt : 0; looseState.playerStrideZ = dt > 0 ? walkedZ / dt : 0;

  // How fast the Hollow is moving, from where it was a frame ago: it kicks what lies in its way.
  if (hollow.isActive) {
    if (looseState.hollowWasActive && dt > 0) {
      looseState.hollowVelocityX = clampNumber((hollow.figure.x - looseState.hollowLastX) / dt, -8, 8);
      looseState.hollowVelocityZ = clampNumber((hollow.figure.z - looseState.hollowLastZ) / dt, -8, 8);
    }
    looseState.hollowLastX = hollow.figure.x; looseState.hollowLastZ = hollow.figure.z;
  }
  looseState.hollowWasActive = hollow.isActive;

  for (let objectIndex = 0; objectIndex < looseObjects.length; objectIndex++) {
    const object = looseObjects[objectIndex];
    if (!object.isAsleep) continue;
    if (player.isMoving) wakeLooseObjectIfWalkedInto(object, player.x, player.z, TUNING.playerRadius, player.floorY, player.floorY + 1.7);
    if (hollow.isActive) wakeLooseObjectIfWalkedInto(object, hollow.figure.x, hollow.figure.z, 0.34, hollow.figure.y, hollow.figure.y + 1.9);
  }

  looseState.shoveBackDepth = 0;
  looseState.accumulator = Math.min(looseState.accumulator + dt, TUNING.looseStepSeconds * 8);
  while (looseState.accumulator >= TUNING.looseStepSeconds) {
    looseState.accumulator -= TUNING.looseStepSeconds;
    for (let objectIndex = 0; objectIndex < looseObjects.length; objectIndex++) {
      const object = looseObjects[objectIndex];
      if (!object.isAsleep) stepLooseObject(object, TUNING.looseStepSeconds);
    }
  }

  for (let objectIndex = looseObjects.length - 1; objectIndex >= 0; objectIndex--) {
    const object = looseObjects[objectIndex];
    if (object.knockSpeed > 0) reportLooseObjectKnock(object);
    if (object.y < PIT_NO_RETURN_DEPTH) {
      looseState.statistics.lostDownThePit++;
      removeLooseObject(object);
    }
  }

  // Something heavy on the floor that you walked into gives you back what it did not take.
  if (looseState.shoveBackDepth > 0) {
    const resolved = resolveBodyCollision(player.x + looseState.shoveBackX * looseState.shoveBackDepth, player.z + looseState.shoveBackZ * looseState.shoveBackDepth,
      TUNING.playerRadius, player.isCrouching ? 1.0 : 1.7, getFloorHeightAt(player.x, player.z));
    player.x = resolved.x; player.z = resolved.z;
  }

  const held = looseState.held;
  // What you carry is against something and you are walking on into it: it stops you, as a crate against a
  // wall would. It can only hold you back so fast, though. At a walk that is enough; at a run you carry on,
  // and a moment later it is out of your hands.
  if (held && held.touchedThisStep) {
    const gapX = looseState.holdTargetX - held.x, gapZ = looseState.holdTargetZ - held.z;
    const gap = Math.sqrt(gapX * gapX + gapZ * gapZ);
    // Only your own advance is taken back: it stops you walking on, it never pulls you towards it.
    const advance = gap > 0 ? (walkedX * gapX + walkedZ * gapZ) / gap : 0;
    if (gap > TUNING.looseHoldStopDistance && advance > 0) {
      const back = Math.min(gap - TUNING.looseHoldStopDistance, advance, TUNING.looseHoldStopSpeed * dt);
      const resolved = resolveBodyCollision(player.x - gapX / gap * back, player.z - gapZ / gap * back,
        TUNING.playerRadius, player.isCrouching ? 1.0 : 1.7, getFloorHeightAt(player.x, player.z));
      looseState.holdTargetX += resolved.x - player.x; looseState.holdTargetZ += resolved.z - player.z;
      player.x = resolved.x; player.z = resolved.z;
    }
  }

  rememberPlayerMovement(dt);

  // Left too far behind (round a door frame, under a lintel, on the other side of you): it comes out of your hands.
  if (held) {
    const deltaX = looseState.holdTargetX - held.x, deltaY = looseState.holdTargetY - held.y, deltaZ = looseState.holdTargetZ - held.z;
    // Only something that is caught on the station can be lost this way. In open air it is merely behind, however
    // fast you turn, and catches up; unless it is so far behind that it cannot be yours any more.
    const gapSquared = deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ;
    const breakDistance = held.touchedThisStep ? TUNING.looseHoldBreakDistance : TUNING.looseHoldBreakDistance * 2.5;
    if (gapSquared > breakDistance * breakDistance) {
      looseState.holdBreakTimer += dt;
      if (looseState.holdBreakTimer >= TUNING.looseHoldBreakSeconds) {
        releaseHeldLooseObject(0);
        looseState.statistics.pulledFromHands++;
        showMessage('The ' + held.kind.label + ' is pulled out of your hands.', 3, 'warning');
      }
    } else {
      looseState.holdBreakTimer = 0;
    }
  }
}
