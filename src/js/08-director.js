// ---------------------------------------------------------------------------
// The director: the rhythm of a descent.
//
// What hunts you down there is honest. The Hollow is blind and finds you by hearing you or by feeling the beam;
// the Surveyor is deaf and finds you by its own light. Left to wander at random in a big station neither would
// come near you often; told where you are either would be unbeatable. The director sits between the two.
//
// It keeps one hidden number for the whole descent, "menace", from 0 to 1, and a cycle of two phases:
//   CLOSING IN  whatever is about is brought nearer and nearer, each in its own way.
//   BREATHER    once menace has been full, and nothing is after anybody, everything is sent off and kept off
//               until menace has drained.
// One rhythm for all of them, so that a breather is a breather: two creatures each keeping their own time
// would take turns, and there would be no quiet at all.
//
// It paces the MAIN creatures: the ones that hunt (DIRECTED_CREATURES). Not the Stills, which keep to their
// room, and not the looters, which are not after you. Each main creature says how it is to be paced, because
// they are not paced alike:
//   - The Hollow is steered: its rounds are chosen from rooms in a band of walking distance from you, which
//     narrows as the director closes in (pickDirectedWaypoint). The director knows where you are; all it may
//     do with that is pick a room, never one closer than TUNING.directorNearRingMinimumSteps.
//   - The Surveyor is not told where anybody is. It goes by light: where scanning has been landing lately
//     ("Light", 08-creatures.js). What the director sets for it is how far afield it notices that
//     (getDirectorPressure), and in a breather it turns its back on it. Only with nothing lit anywhere is it
//     given a room from the band, like the Hollow, so that it is not lost to the far end of a station.
// The numbers are in 00-config.js under "The director".
// ---------------------------------------------------------------------------

const DIRECTOR_PHASE_CLOSING_IN = 0;
const DIRECTOR_PHASE_BREATHER = 1;
const DIRECTOR_PHASE_NAMES = ['CLOSING IN', 'BREATHER'];

// The creatures it paces, in the order they were added. What one says of itself:
//   key              its name, for debug mode and the tests
//   figure           its body (where it is)
//   isAbout          function (): is it in the station now?
//   isIdle           function (): is it on its rounds, after nobody and searching for nobody? A breather never
//                    begins while one of them is not: nothing is called off in the middle of a chase.
//   menaceRise       function (closeness): how fast what it is doing now fills menace, per second. `closeness`
//                    is 1 right beside you and 0 from TUNING.directorMenaceRangeSteps of walking away.
//   impatience       (optional) function (): 0 to 1, how much sooner the closing in is complete for the mood it
//                    is in (the Hollow's anger)
//   takeUpRounds     function (): choose where it goes next, now, by the phase the director is in
//   beginBreather    function (): a breather has begun: it leaves
//   sendAway         function (graceSeconds): put it far from everybody at once (you are back from a
//                    checkpoint, or it has killed somebody down there with others)
const DIRECTED_CREATURES = [];

function addDirectedCreature(creature) {
  DIRECTED_CREATURES.push(creature);
  return creature;
}

function findDirectedCreature(key) {
  for (const creature of DIRECTED_CREATURES) if (creature.key === key) return creature;
  return null;
}

// Is any main creature in the station besides this one?
function isAnotherDirectedCreatureAbout(creature) {
  for (const other of DIRECTED_CREATURES) if (other !== creature && other.isAbout()) return true;
  return false;
}

const director = {
  menace: 0,                 // 0 calm .. 1 full
  phase: DIRECTOR_PHASE_CLOSING_IN,
  phaseTime: 0,              // seconds spent in this phase
  hasPeaked: false,          // menace has been full since the last breather: a breather is owed
  stepsToPlayer: NAVIGATION_UNREACHABLE, // walking distance between you and the nearest of the creatures it paces
  stepsOf: {},               // ... and for each of them, by its key
  refreshTimer: 0,
  avoidTimer: 0,
  ringMinimumSteps: 0, ringMaximumSteps: 0 // the band of distances it last chose a room from (shown in debug mode)
};

function resetDirector(startsWithBreather) {
  director.phase = startsWithBreather ? DIRECTOR_PHASE_BREATHER : DIRECTOR_PHASE_CLOSING_IN;
  director.menace = startsWithBreather ? 0.6 : 0;
  director.phaseTime = 0;
  director.hasPeaked = false;
  director.refreshTimer = 0;
  director.avoidTimer = 0;
}

// The lift is on its way, or it has been told exactly where you are: the ending is not paced, it is survived.
function isDirectorOverruled() {
  return hollow.knowsPlayerPositionAlways || game.flags.uploadStarted;
}

// How much faster than normal the whole cycle runs: the threat level sets a base, and every spool you carry adds to it.
function getDirectorPaceFactor() {
  // What counts is how far along the work order you are: with all of it done it presses as hard as holding all
  // three spools used to, whatever the order is and however many things it has. (09-quests.js)
  return game.difficulty.pressureFactor * (1 + TUNING.directorPressurePerSpool * 3 * getWorkOrderProgressShare());
}

// How far the closing in has come since the last breather: 0 not at all, 1 fully.
function getDirectorPressure() {
  if (isDirectorOverruled()) return 1;
  if (director.phase !== DIRECTOR_PHASE_CLOSING_IN) return 0;
  let impatience = 0;
  for (const creature of DIRECTED_CREATURES) if (creature.impatience && creature.isAbout()) impatience = Math.max(impatience, creature.impatience());
  const buildSeconds = TUNING.directorBuildSeconds / getDirectorPaceFactor() * (1 - 0.5 * impatience);
  return clampNumber(director.phaseTime / Math.max(1, buildSeconds), 0, 1);
}

function isDirectorInBreather() {
  return director.phase === DIRECTOR_PHASE_BREATHER && !isDirectorOverruled();
}

// The band of walking distances from you that the next room is picked from.
function updateDirectorRoamRing() {
  if (isDirectorInBreather()) {
    director.ringMinimumSteps = TUNING.directorReliefSteps;
    director.ringMaximumSteps = NAVIGATION_UNREACHABLE - 1;
    return;
  }
  const pressure = getDirectorPressure();
  director.ringMinimumSteps = Math.round(interpolateLinear(TUNING.directorFarRingMinimumSteps, TUNING.directorNearRingMinimumSteps, pressure));
  director.ringMaximumSteps = Math.round(interpolateLinear(TUNING.directorFarRingMaximumSteps, TUNING.directorNearRingMaximumSteps, pressure));
}

// Picks the next room for a creature to wander to: one whose walking distance from you is inside the director's
// band, and not the one it is standing in. Returns the waypoint, [x, z].
function pickDirectedWaypoint(figure) {
  refreshPlayerDistanceField();
  updateDirectorRoamRing();
  const floorSteps = TUNING.directorNearRingMinimumSteps;
  const candidates = [];
  let nearestMiss = null, nearestMissGap = Infinity, farthest = null, farthestSteps = -1;
  for (const waypoint of roamingWaypoints) {
    const index = findNearestWalkableTileIndex(waypoint[0], waypoint[1]);
    if (index < 0) continue;
    const steps = playerDistanceField[index];
    if (steps >= NAVIGATION_UNREACHABLE) continue;
    if (steps > farthestSteps) { farthestSteps = steps; farthest = waypoint; }
    if (steps >= director.ringMinimumSteps && steps <= director.ringMaximumSteps) {
      // Not the room it is already standing in, or it would just stand there.
      if (distanceBetweenPoints(waypoint[0], waypoint[1], figure.x, figure.z) > 2.5) candidates.push(waypoint);
    } else if (steps >= floorSteps) {
      const gap = steps < director.ringMinimumSteps ? director.ringMinimumSteps - steps : steps - director.ringMaximumSteps;
      if (gap < nearestMissGap) { nearestMissGap = gap; nearestMiss = waypoint; }
    }
  }
  // Nothing inside the band (a small station, or you are in a far corner): the room that misses it by least,
  // and failing that the one furthest from you. Never simply "any room", which could be the one you are in.
  return candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : (nearestMiss || farthest || roamingWaypoints[0]);
}

// The waypoint furthest from all of you on foot (not in the Stills' store): where a creature is put when it is
// sent away. Not one that another of the creatures the director paces is standing at: two of them sent away
// together are not put on top of each other.
function pickFarthestWaypoint(figure) {
  refreshPlayerDistanceField();
  let best = roamingWaypoints[0], bestSteps = -1;
  for (const waypoint of roamingWaypoints) {
    const index = findNearestWalkableTileIndex(waypoint[0], waypoint[1]);
    if (index < 0) continue;
    let isTaken = false;
    for (const other of DIRECTED_CREATURES) if (other.figure !== figure && other.isAbout() && distanceBetweenPoints(other.figure.x, other.figure.z, waypoint[0], waypoint[1]) < 6) isTaken = true;
    if (isTaken) continue;
    const steps = playerDistanceField[index];
    if (steps < NAVIGATION_UNREACHABLE && steps > bestSteps && tileZone[index] !== level.storeZone) { bestSteps = steps; best = waypoint; }
  }
  return best;
}

// Everything it paces that is about, sent far from everybody at once, with a breather to follow.
function sendDirectedCreaturesAway(graceSeconds) {
  for (const creature of DIRECTED_CREATURES) if (creature.isAbout()) creature.sendAway(graceSeconds);
}

// One of them has been sent away. That always comes with a breather, and the breather is everybody's: the
// others that are on their rounds turn away now too. One that is after somebody is left to finish.
function beginBreatherAfterSendingAway() {
  resetDirector(true);
  for (const creature of DIRECTED_CREATURES) if (creature.isAbout() && creature.isIdle()) creature.takeUpRounds();
}

function beginDirectorBreather() {
  director.phase = DIRECTOR_PHASE_BREATHER;
  director.phaseTime = 0;
  director.hasPeaked = false;
  director.avoidTimer = 4;
  for (const creature of DIRECTED_CREATURES) if (creature.isAbout()) creature.beginBreather();
}

// One frame of it, in the game that runs the station, before the creatures themselves.
function updateDirector(dt) {
  let isAnyAbout = false;
  for (const creature of DIRECTED_CREATURES) if (creature.isAbout()) isAnyAbout = true;
  if (!isAnyAbout) return;
  director.phaseTime += dt;
  director.refreshTimer -= dt;
  if (director.refreshTimer <= 0) {
    director.refreshTimer = 0.5;
    refreshPlayerDistanceField();
    director.stepsToPlayer = NAVIGATION_UNREACHABLE;
    for (const creature of DIRECTED_CREATURES) {
      if (!creature.isAbout()) { director.stepsOf[creature.key] = NAVIGATION_UNREACHABLE; continue; }
      const index = findNearestWalkableTileIndex(creature.figure.x, creature.figure.z);
      const steps = index < 0 ? NAVIGATION_UNREACHABLE : playerDistanceField[index];
      director.stepsOf[creature.key] = steps;
      if (steps < director.stepsToPlayer) director.stepsToPlayer = steps;
    }
  }

  // ---- menace: up while one of them is near you or after you, down while they are away ----
  let risePerSecond = 0, isEveryOneIdle = true;
  for (const creature of DIRECTED_CREATURES) {
    if (!creature.isAbout()) continue;
    const steps = director.stepsOf[creature.key] === undefined ? NAVIGATION_UNREACHABLE : director.stepsOf[creature.key];
    const closeness = clampNumber(1 - steps / TUNING.directorMenaceRangeSteps, 0, 1);
    risePerSecond = Math.max(risePerSecond, creature.menaceRise(closeness));
    if (!creature.isIdle()) isEveryOneIdle = false;
  }
  if (risePerSecond > 0) director.menace = Math.min(1, director.menace + risePerSecond * dt);
  else director.menace = Math.max(0, director.menace - dt * getDirectorPaceFactor() / TUNING.directorCalmSeconds);
  if (director.menace >= 1) director.hasPeaked = true;
  if (isDirectorOverruled()) return;

  if (director.phase === DIRECTOR_PHASE_CLOSING_IN) {
    // A breather is owed once menace has been full, but it only starts when every one of them has, by its own
    // lights, finished: it is never called off in the middle of a chase or a search.
    if (director.hasPeaked && isEveryOneIdle) beginDirectorBreather();
  } else {
    const minimumSeconds = Math.max(TUNING.directorReliefShortestSeconds, TUNING.directorReliefMinimumSeconds / getDirectorPaceFactor());
    if (director.phaseTime >= minimumSeconds && director.menace <= TUNING.directorReliefEndsBelowMenace) {
      director.phase = DIRECTOR_PHASE_CLOSING_IN;
      director.phaseTime = 0;
      director.hasPeaked = false;
      for (const creature of DIRECTED_CREATURES) if (creature.isAbout() && creature.isIdle()) creature.takeUpRounds();
    } else {
      // If you follow one of them during a breather, it keeps its distance.
      director.avoidTimer -= dt;
      if (director.avoidTimer <= 0) {
        for (const creature of DIRECTED_CREATURES) {
          if (!creature.isAbout() || !creature.isIdle() || director.stepsOf[creature.key] >= TUNING.directorReliefSteps * 0.6) continue;
          director.avoidTimer = 4;
          creature.takeUpRounds();
        }
      }
    }
  }
}

// It is one of the things the game runs every frame: first of them, so that what it decides is what they go by.
// (It says so itself, below: a creature whose file comes before this one is still run after it.)
addCreatureKind({
  key: 'director',
  update: function (dt) { updateLightHeat(dt); updateDirector(dt); }, // (the light of a while ago fades: "Light", 08-creatures.js)
  reset: function () { resetDirector(false); director.stepsToPlayer = NAVIGATION_UNREACHABLE; director.stepsOf = {}; clearLightHeat(); },
  debugLines: function (lines) {
    let isAnyAbout = false;
    for (const creature of DIRECTED_CREATURES) if (creature.isAbout()) isAnyAbout = true;
    if (!isAnyAbout) return;
    lines.push('DIRECTOR    ' + (isDirectorOverruled() ? 'OVERRULED (the ending)' : DIRECTOR_PHASE_NAMES[director.phase]) + '   menace ' + director.menace.toFixed(2) + (director.hasPeaked ? ' (breather owed)' : '') +
      '   pace x' + getDirectorPaceFactor().toFixed(2) + '   closed in ' + Math.round(getDirectorPressure() * 100) + '%');
    lines.push('  steering  to rooms ' + director.ringMinimumSteps + ' to ' + (director.ringMaximumSteps > 9000 ? 'any' : director.ringMaximumSteps) + ' steps from you; the nearest of them is ' +
      (director.stepsToPlayer >= NAVIGATION_UNREACHABLE ? 'unreachable' : director.stepsToPlayer + ' steps') + ' away');
    for (const creature of DIRECTED_CREATURES) {
      if (!creature.isAbout()) continue;
      const steps = director.stepsOf[creature.key];
      lines.push('  paces     ' + creature.key + ': ' + (steps === undefined || steps >= NAVIGATION_UNREACHABLE ? 'unreachable' : steps + ' steps away') + (creature.isIdle() ? ', on its rounds' : ', busy'));
    }
  }
}, true);
