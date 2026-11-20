// ---------------------------------------------------------------------------
// A cone of light from something that scans by itself.
//
// Your scanner is aimed with your eyes and has refinements of its own (09-player.js). Anything else that
// scans fires from where it is, the way it faces: the scanner tripod (08-loose-objects.js) does, and so will
// whatever scans with its face one day. `fireScanCone` is what they all call. Its pulses are ordinary pulses
// (fireScanPulse's own steps): they leave scan points, they count as light on a creature, and a creature that
// is lit takes the place they came from for where to go.
//
// It also says what the light fell on, which is how something that hunts by its own light finds you:
//   scanConeResult.fired        how many pulses were fired
//   scanConeResult.landed       how many of them landed on anything
//   scanConeResult.onCreatures  how many landed on a creature (anything with a body a scan can find)
//   scanConeResult.litPlayers   each of `players` that a pulse passed through before it landed, once each
//
// One of you has no body in your own scan (your light would stop on yourself), so whether a pulse falls on
// one of `players` is worked out here: through the upright of their body, between the floor and the top of
// their head, before the pulse has gone as far as it went.
// ---------------------------------------------------------------------------

const scanConeResult = { fired: 0, landed: 0, onCreatures: 0, litPlayers: [] };

// Does a pulse from the origin along the direction (of length one) pass through this one's body before it has
// gone `reach` metres?
function isBodyInScanPulse(one, originX, originY, originZ, directionX, directionY, directionZ, reach) {
  const flat = directionX * directionX + directionZ * directionZ;
  // The point of the pulse that is nearest their upright, on the plan.
  let along = flat > 0.000001 ? ((one.x - originX) * directionX + (one.z - originZ) * directionZ) / flat : 0;
  if (along <= 0 || along > reach) return false;
  const atX = originX + directionX * along, atZ = originZ + directionZ * along, atY = originY + directionY * along;
  if (distanceBetweenPoints(atX, atZ, one.x, one.z) > TUNING.playerRadius) return false;
  const top = (one === player ? getPlayerEyeY() : one.eyeY) + 0.12;
  return atY <= top && atY >= getFloorHeightAt(one.x, one.z);
}

// Fires `pulses` pulses from (originX, Y, Z), spread evenly over a cone about the direction (of length one)
// that opens `halfAngleDegrees` to every side. `skippedObject` is the loose object the light comes out of, if
// it is one: its own light does not stop on its own case. Returns scanConeResult (the same object every time).
function fireScanCone(originX, originY, originZ, directionX, directionY, directionZ, halfAngleDegrees, pulses, skippedObject) {
  const result = scanConeResult;
  result.fired = 0; result.landed = 0; result.onCreatures = 0; result.litPlayers.length = 0;
  // Two directions square to the cone's own and to each other.
  let rightX = directionZ, rightY = 0, rightZ = -directionX;
  let rightLength = Math.sqrt(rightX * rightX + rightZ * rightZ);
  if (rightLength < 0.001) { rightX = 1; rightZ = 0; rightLength = 1; } // (straight up or down: any will do)
  rightX /= rightLength; rightZ /= rightLength;
  const upX = rightY * directionZ - rightZ * directionY, upY = rightZ * directionX - rightX * directionZ, upZ = rightX * directionY - rightY * directionX;
  const cosineOfEdge = Math.cos(halfAngleDegrees * Math.PI / 180);
  const range = TUNING.scannerMaximumRange;
  const before = looseRaySkipped;
  looseRaySkipped = skippedObject || null;
  scanSource.x = originX; scanSource.z = originZ;
  for (let pulse = 0; pulse < pulses; pulse++) {
    // Evenly over the cap of the sphere that the cone cuts out: as much light at its edge as in its middle.
    const cosine = 1 - Math.random() * (1 - cosineOfEdge), sine = Math.sqrt(Math.max(0, 1 - cosine * cosine)), turn = Math.random() * TWO_PI;
    const acrossRight = Math.cos(turn) * sine, acrossUp = Math.sin(turn) * sine;
    const x = directionX * cosine + rightX * acrossRight + upX * acrossUp;
    const y = directionY * cosine + rightY * acrossRight + upY * acrossUp;
    const z = directionZ * cosine + rightZ * acrossRight + upZ * acrossUp;
    const hasLanded = castScannerRay(originX, originY, originZ, x, y, z, range);
    const reach = hasLanded ? rayHit.distance : range;
    result.fired++;
    if (hasLanded) {
      result.landed++;
      if (rayHit.figure !== null) result.onCreatures++;
      recordScanHit(false);
    }
    for (const one of players) {
      if (result.litPlayers.indexOf(one) < 0 && isBodyInScanPulse(one, originX, originY, originZ, x, y, z, reach)) result.litPlayers.push(one);
    }
  }
  looseRaySkipped = before;
  return result;
}
