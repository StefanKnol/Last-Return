// ---------------------------------------------------------------------------
// The looters.
//
// Small things, under a metre, that live in the vents and carry off what lies loose. They are not after you.
// The crew left them alone, and so can you: a looter does you no harm. What it does is take things: a jar from
// the floor, what you put down in a salvage bay while its door stands open, the fuel can you need, and the
// thing in your beam if you carry it low enough for it to reach. It takes them home, to its nest, which is a
// dead end off the side of a vent (or, in a station without one, the middle of a vent), and there they lie
// until you go and get them.
//
// What it likes best is what one of you has had in the beam: a thing you carry, a thing you have put down, and
// so what stands in a salvage bay. What nobody has touched it takes too, but it goes a long way round for yours.
//
// What it is afraid of is noise, by how loud the noise is where the looter stands (0 at the edge of its
// hearing, 1 right beside it). Far off or small, it lives with it. Louder than TUNING.looterStartledAt, it is
// startled: it stops what it is doing, turns to the noise and backs away from it for a few seconds, keeping
// what it has, and then goes on. Louder than TUNING.looterScaredAt, or startled a second time while it is still
// on edge, it is frightened: it drops what it has where it stands and runs home, where it stays for a while.
// So a thing is got back from one by being loud near it, or loud twice; and a thing held high, where it
// cannot reach, it only stands under and scolds.
//
// Take a thing out of its arms and it is not frightened, it is robbed: it stands there cross for a moment, and
// then it comes after you for it, quicker than you walk, and takes it again if it can reach it.
//
// And the vents are its own. With one of you in a vent near it or near its nest it does not run from anything:
// it goes for them, stands in front of them and scolds until they are out. And if they stay, it bites: not
// much of a bite, and never the death of anybody (09-health.js), but it goes on biting for as long as they do.
//
// How it gets around (08-creatures.js): it walks through a vent upright, it cannot reach a ceiling hatch, and
// the doors that open for anything open for it. So it has the run of whatever its vents join.
//
// Like everything that walks, the looters are run by one game: yours alone, or the host's. When one takes hold
// of a thing or lets go of it, that is done to the station ('looterTake', 'looterDrop': decided there, carried
// out in every browser), and where a looter stands is told with the rest of the host's station (`describe`).
// A thing in a looter's arms is nobody's to move: it is where the looter is.
//
// Its body is a creature made in the workshop: src/creatures/looter.json. (Without that file it gets a plain
// small one, so that the game does not depend on it.) How many there are is the threat level's `looterCount`
// (00-config.js), and never more than the station has nests for. Kessel-9 has no vents, and so none.
// ---------------------------------------------------------------------------

const LOOTER_STATE_NEST = 0;    // at home, sitting still
const LOOTER_STATE_FETCH = 1;   // on its way to a thing it wants
const LOOTER_STATE_REACH = 2;   // under a thing that is held too high for it, trying
const LOOTER_STATE_CARRY = 3;   // on its way home with a thing
const LOOTER_STATE_HOME = 4;    // on its way home with nothing
const LOOTER_STATE_FLEE = 5;    // frightened, running home
const LOOTER_STATE_WANDER = 6;  // out for a look, with nothing in mind
const LOOTER_STATE_CROSS = 7;   // a thing was taken out of its arms: standing there, about to go and get it back
const LOOTER_STATE_MAD = 8;     // one of you is in its vents: going for them, scolding
const LOOTER_STATE_STARTLED = 9; // it has heard something: backing away from it, not running yet
const LOOTER_STATE_NAMES = ['in its nest', 'after a thing', 'reaching for a thing', 'carrying a thing home', 'going home', 'frightened', 'wandering',
  'wanting a thing back', 'driving somebody out of its vents', 'startled'];

// Doors: the ones that open for anything that walks up to them, and the powered ones once the mains is on.
function canLooterOpenDoor(door) {
  if (door.kind === DOOR_KIND_AUTOMATIC) return true;
  if (door.kind === DOOR_KIND_POWERED) return game.flags.powerOn;
  return false;
}
const LOOTER_WAY = createCreatureWay({ key: 'looter', canOpenDoor: canLooterOpenDoor, fitsVents: true, usesHatches: false });

// Its body, if the workshop's file is not there: a person's, made 85 cm tall.
if (!FIGURE_KINDS.looter) {
  const proportions = fitFigureProportionsToHeight(FIGURE_PROPORTIONS_DUMMY, 'person', 0.85);
  proportions.kind = 'looter';
  FIGURE_KINDS.looter = { label: 'Looter', proportions: proportions, proportionsName: '', bodyPlan: 'person',
    surfaceClass: SURFACE_PLAYER, imprintTuningKey: 'playerImprintSeconds', color: [0.35, 0.9, 0.85], isDesigned: true };
}

// Every looter of this descent. One is its legs (createCreatureLegs) and:
//   index      which one it is: what a thing in its arms is marked with (looterIndex, 08-loose-objects.js)
//   figure     its body
//   nest       where it lives: one of level.ventNests
//   state      one of LOOTER_STATE_...; `timer` counts down what that state is waiting for
//   wanted     the thing it is after (FETCH, REACH), or null
//   carried    the thing in its arms, or null
//   goalX, goalZ  where it is walking to
//   ignored    things it has given up on, by their number: the time until which it leaves each alone
//   isRobbed   the thing it is after was taken out of its arms: it hurries
//   madAt      the one of you it is driving out of its vents (one of `players`), or null
const looters = [];

function createLooter(index, nest) {
  const looter = Object.assign(createCreatureLegs(LOOTER_WAY), {
    index: index, figure: createFigureOfKind('looter'), nest: nest,
    state: LOOTER_STATE_NEST, timer: 0, wanted: null, carried: null, goalX: nest.x, goalZ: nest.z, ignored: {},
    nestField: new Int16Array(TILE_COUNT), nestFieldVersion: -1, // how far it is on foot from its nest to everywhere, by its way
    isRobbed: false, madAt: null,
    startledX: 0, startledZ: 0, // startled: where the noise was
    onEdgeSeconds: 0,    // it has been startled, and for this much longer the next noise that would startle it frightens it
    scoldSeconds: 0,     // mad: until it scolds again
    biteSeconds: 0,      // mad, and in front of them: until it bites
    calmSeconds: 0,      // mad: how long it stays so once nobody is in its vents
    outSeconds: 0,       // how long it has been on its way to where it is going
    deafSeconds: 0,      // it has just put a thing down: what that sounds like does not frighten it
    walkPhase: 0, lastStepSign: 1, armRaise: 0, currentSpeed: 0,
    // (Only in a game that shows what the host says: where it was shown when that was last said, and what was said.)
    fromX: nest.x, fromZ: nest.z, fromYaw: 0, said: null
  });
  looter.figure.x = nest.x; looter.figure.z = nest.z; looter.figure.yaw = Math.random() * TWO_PI;
  poseLooter(looter, 0, 0);
  setFigureRaycastable(looter.figure, true);
  return looter;
}

// Whether a descent has looters at all. It does, always, in play. The checks in tools/ that are about something
// else switch them off through the test hook (browser-harness.js): what a looter goes for is chance, and a
// check that puts a fuel can down to pour it does not want it carried off meanwhile.
let areLootersWanted = true;

// A new descent: as many looters as the threat level says, each in a nest of its own, as far apart as the
// station's nests allow. (In a game that shows the host's station there are none until the host says so.)
function createLooters() {
  looters.length = 0;
  if (isWorldTheHosts() || level.kind !== 'generated' || !areLootersWanted) return;
  const wanted = Math.min(Math.max(0, Math.round(game.difficulty.looterCount || 0)), level.ventNests.length);
  const chosen = [];
  for (let count = 0; count < wanted; count++) {
    // The first takes the first nest there is (a dead end, if the station has one); each one after it takes
    // the nest that is furthest from the nests already taken, dead ends before the others.
    let best = null, bestScore = -Infinity;
    for (const nest of level.ventNests) {
      if (chosen.indexOf(nest) >= 0) continue;
      let apart = 1000;
      for (const taken of chosen) apart = Math.min(apart, distanceBetweenPoints(nest.x, nest.z, taken.x, taken.z));
      const score = (chosen.length === 0 ? -level.ventNests.indexOf(nest) : apart) + (nest.isPocket ? 1000 : 0);
      if (score > bestScore) { bestScore = score; best = nest; }
    }
    chosen.push(best);
    const looter = createLooter(looters.length, best);
    looter.timer = randomBetween(TUNING.looterRestSeconds[0], TUNING.looterRestSeconds[1]);
    looters.push(looter);
  }
}

// ---------------------------------------------------------------------------
// What it wants
// ---------------------------------------------------------------------------

// Is this a thing a looter carries off at all: small and light enough, and not the cover of a vent, the
// scanner of somebody who fell (which has to lie where the others can find it), or a survey spool or core
// sample that nobody has found yet.
function isLootable(object) {
  if (object.isRemoved || object.looterIndex >= 0 || object.fallenPlayerId) return false;
  if (object.kindKey === 'ventCover') return false;
  // A survey spool or a core sample stays where the crew left it until one of you has had it in the beam: they
  // are behind doors on purpose, and a looter's vents go round those doors. Once found, it is fair game.
  if ((object.kindKey === 'spool' || findQuestOfCarriedThing(object) !== null) && !object.wasFound) return false;
  return object.kind.mass <= TUNING.looterCarriesKilograms && object.prepared.boundsRadius <= TUNING.looterCarriesReach;
}

function isLooseObjectHeldBySomebody(object) {
  return object.isHeld || object.heldById !== 0;
}

// Does it lie in a looter's nest already (within a step of where one puts things down)?
function isLooseObjectInANest(object) {
  for (const looter of looters) if (distanceBetweenPoints(object.x, object.z, looter.nest.x, looter.nest.z) < 1.3) return true;
  return false;
}

// Can it take hold of this thing from where it stands: near enough, and low enough.
function canLooterReach(looter, object) {
  const figure = looter.figure;
  return distanceBetweenPoints(figure.x, figure.z, object.x, object.z) < TUNING.looterTakeMetres + object.prepared.boundsRadius * 0.5 &&
    object.y - figure.y <= TUNING.looterReachHeight;
}

// How far it is on foot from its nest to everywhere it can go. Worked out again when a door has opened or shut to it.
function refreshLooterNestField(looter) {
  if (looter.nestFieldVersion === LOOTER_WAY.version) return;
  computeWayDistanceField(LOOTER_WAY, looter.nestField, findNearestWalkableTileIndex(looter.nest.x, looter.nest.z), true);
  looter.nestFieldVersion = LOOTER_WAY.version;
}

// How many steps from its nest a place is, or NAVIGATION_UNREACHABLE.
function getLooterStepsFromNest(looter, x, z) {
  const index = findNearestWalkableTileIndex(x, z);
  if (index < 0 || distanceBetweenPoints(x, z, index % GRID_WIDTH + 0.5, Math.floor(index / GRID_WIDTH) + 0.5) > 1.2) return NAVIGATION_UNREACHABLE;
  return looter.nestField[index];
}

// Time to go out. It goes for the thing that is worth most for the least walking, if there is one within its
// range that it can get at. What one of you has had in the beam is worth several times as much to it as what
// nobody has touched, what somebody is carrying about is worth more again, and so is what lies in a salvage
// bay that stands open. With nothing to go for it has a look round, or stays in.
function chooseLooterOuting(looter) {
  refreshLooterNestField(looter);
  let best = null, bestScore = 0;
  for (const object of looseObjects) {
    if (!isLootable(object) || isLooseObjectInANest(object) || (looter.ignored[object.id] || 0) > game.time) continue;
    if (looters.some(function (other) { return other !== looter && other.wanted === object; })) continue; // another one is on its way to it
    const steps = getLooterStepsFromNest(looter, object.x, object.z);
    if (steps > TUNING.looterRangeSteps) continue;
    const isHeld = isLooseObjectHeldBySomebody(object);
    // (Lying on a shelf out of its reach is out of its reach. In somebody's beam it may come down yet: it goes and sees.)
    if (!isHeld && object.y - getFloorHeightAt(object.x, object.z) > TUNING.looterReachHeight) continue;
    let appeal = Math.max(15, getLooseObjectValue(object));
    if (isHeld) appeal *= TUNING.looterLikesCarried;
    else if (object.wasHandled) appeal *= TUNING.looterLikesHandled;
    if (haulState.bays.some(function (bay) { return isLooseObjectInHaulBay(object, bay); })) appeal *= TUNING.looterLikesBay;
    const score = appeal / (steps + 15) * (0.6 + Math.random() * 0.8);
    if (score > bestScore) { bestScore = score; best = object; }
  }
  looter.outSeconds = 0;
  if (best) { looter.wanted = best; looter.state = LOOTER_STATE_FETCH; return; }
  // Nothing: a look round, at somewhere within its range, or another sit.
  const places = roamingWaypoints.filter(function (waypoint) { const steps = getLooterStepsFromNest(looter, waypoint[0], waypoint[1]); return steps > 3 && steps <= TUNING.looterRangeSteps; });
  if (places.length > 0 && Math.random() < 0.6) {
    const place = places[Math.floor(Math.random() * places.length)];
    looter.goalX = place[0]; looter.goalZ = place[1];
    looter.state = LOOTER_STATE_WANDER;
  } else looter.timer = randomBetween(TUNING.looterRestSeconds[0], TUNING.looterRestSeconds[1]);
}

// ---------------------------------------------------------------------------
// Taking hold of a thing and letting go of it: done to the station, in every browser (11-together.js)
// ---------------------------------------------------------------------------

// Where a thing in its arms is: in front of its chest, a little further out for a bigger thing.
function placeLooterLoad(looter) {
  const object = looter.carried, figure = looter.figure;
  if (!object) return;
  const out = 0.16 + object.prepared.boundsRadius * 0.7;
  object.x = figure.x + Math.sin(figure.yaw) * out;
  object.z = figure.z - Math.cos(figure.yaw) * out;
  object.y = figure.y + Math.max(object.prepared.boundsRadius + 0.05, figure.headHeight * 0.55);
  object.velocityX = 0; object.velocityY = 0; object.velocityZ = 0; object.spinX = 0; object.spinY = 0; object.spinZ = 0;
  object.isAsleep = true; // it is carried, not stepped: nothing moves it but the looter
  object.lastGoodX = object.x; object.lastGoodY = object.y; object.lastGoodZ = object.z;
  refreshLooseObjectTiles(object);
}

// 'looterTake': a looter has hold of this thing. Out of whoever's beam it was in, and nobody's to move from now.
function takeLooseObjectAsLooter(object, looterIndex) {
  if (looseState.held === object) {
    releaseHeldLooseObject(0);
    showMessage('It has been taken out of your beam.', 4, 'warning');
  }
  object.isHeld = false; object.heldById = 0;
  object.ownerId = isWorldShared() ? together.hostId : 0;
  wakeLooseObject(object); // what leaned on it loses its support, and the points a scan left on it stay behind
  object.isAsleep = false;
  object.looterIndex = looterIndex;
  const looter = looters[looterIndex];
  if (looter) { looter.carried = object; placeLooterLoad(looter); }
  else object.isAsleep = true; // (not shown here yet: it is put where its looter is as soon as that one is)
  refreshObjective(); // (what it has may be what a quest is waiting for)
}

// 'looterDrop': it has let go of the thing, at this place. `isSetDown`: put down in its nest, where it lies
// still; otherwise dropped, and it falls from where it was.
function dropLooseObjectFromLooter(object, action) {
  const looter = looters[object.looterIndex];
  if (looter && looter.carried === object) looter.carried = null;
  object.looterIndex = -1;
  object.x = action.x; object.y = action.y; object.z = action.z;
  object.velocityX = 0; object.velocityY = 0; object.velocityZ = 0; object.spinX = 0; object.spinY = 0; object.spinZ = 0;
  object.lastGoodX = object.x; object.lastGoodY = object.y; object.lastGoodZ = object.z;
  refreshLooseObjectTiles(object);
  object.isAsleep = true;
  if (!action.isSetDown) wakeLooseObject(object);
  refreshObjective();
}

function letGoAsLooter(looter, isSetDown) {
  const object = looter.carried;
  if (!object) return;
  let x = object.x, y = object.y, z = object.z;
  if (isSetDown) {
    // In the nest, on the floor, a little to one side of the last thing: a hoard, not a pile.
    const turn = (object.id * 2.4) % TWO_PI, out = 0.12 + (object.id % 3) * 0.1;
    x = looter.nest.x + Math.cos(turn) * out; z = looter.nest.z + Math.sin(turn) * out;
    // As high as it lies when it lies the way it is turned now, so that it is put down and not let fall.
    y = getFloorHeightAt(x, z) + getLooseRestHeight(object.kindKey, [object.orientationX, object.orientationY, object.orientationZ, object.orientationW]) + 0.01;
  }
  askToAct({ what: 'looterDrop', id: object.id, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, z: Math.round(z * 1000) / 1000, isSetDown: isSetDown });
  looter.carried = null;
  if (isSetDown) wakeLooseObject(object); // it settles the last centimetres by itself
  looter.deafSeconds = 1.5;
}

// ---------------------------------------------------------------------------
// Fear
// ---------------------------------------------------------------------------

// Frightened: it lets fall what it has and runs home.
function frightenLooter(looter) {
  if (looter.state === LOOTER_STATE_FLEE) return;
  const wasAtHome = looter.state === LOOTER_STATE_NEST;
  letGoAsLooter(looter, false);
  looter.wanted = null; looter.isRobbed = false; looter.madAt = null; looter.onEdgeSeconds = 0;
  looter.state = LOOTER_STATE_FLEE;
  looter.outSeconds = 0;
  if (!wasAtHome) { playLooterSqueal(looter.figure.x, looter.figure.z); showCaption('looterScared', looter.figure); }
}

// Startled: it has heard something that is not loud enough to run from. It stops, turns to where that was and
// backs away from it, with what it has still in its arms; and it is on edge for a while after.
function startleLooter(looter, x, z) {
  looter.startledX = x; looter.startledZ = z;
  looter.onEdgeSeconds = TUNING.looterOnEdgeSeconds;
  looter.state = LOOTER_STATE_STARTLED;
  looter.timer = randomBetween(TUNING.looterStartledSeconds[0], TUNING.looterStartledSeconds[1]);
  playLooterChirp(looter.figure.x, looter.figure.z); showCaption('looterStartled', looter.figure);
}

// A noise, somewhere in the station. It hears further than a noise carries to the Hollow. How loud it is where
// the looter stands says what comes of it: nothing, startled, or frightened (see the top of this file). Small
// noises it never hears at all: a walking step, a thing set down. And a noise out of a vent with one of you
// in it is somebody in its vents, however faint: it goes for them.
function hearNoiseAsLooters(x, z, radius) {
  if (radius < TUNING.looterDeafMetres || debugState.options.creaturesIgnorePlayer) return;
  let whoIsInAVent = null;
  if ((getTileFlagsAtPosition(x, z) & TILE_FLAG_VENT) !== 0) {
    for (const one of players) if (isInAVent(one) && distanceBetweenPoints(x, z, one.x, one.z) < 1.5) whoIsInAVent = one;
  }
  for (const looter of looters) {
    if (looter.deafSeconds > 0 || looter.state === LOOTER_STATE_MAD || looter.state === LOOTER_STATE_FLEE) continue;
    const metres = distanceBetweenPoints(x, z, looter.figure.x, looter.figure.z), hearsTo = radius * TUNING.looterHearingFactor;
    if (metres > hearsTo) continue;
    if (whoIsInAVent) { maddenLooter(looter, whoIsInAVent); continue; }
    const loudness = 1 - metres / hearsTo;
    if (loudness < TUNING.looterStartledAt) continue; // far off: it lives with that
    // On edge, and past the first moment of it (one clatter is one fright, not two): this one is too much.
    const isOnEdge = looter.onEdgeSeconds > 0 && looter.onEdgeSeconds < TUNING.looterOnEdgeSeconds - TUNING.looterSteadySeconds;
    if (looter.state !== LOOTER_STATE_NEST && loudness < TUNING.looterScaredAt && !isOnEdge) {
      if (looter.onEdgeSeconds <= 0) startleLooter(looter, x, z);
      continue;
    }
    if (looter.state === LOOTER_STATE_NEST) looter.timer = Math.max(looter.timer, randomBetween(TUNING.looterFearSeconds[0], TUNING.looterFearSeconds[1])); // it stays in for longer
    else frightenLooter(looter);
  }
}

// ---------------------------------------------------------------------------
// Robbed, and mad
// ---------------------------------------------------------------------------

// A thing was taken out of its arms by one of you. It is not frightened: it wants it back. It stands there
// for a moment (so that it is not one long tug of war), and then goes after the thing, wherever it is by then.
function robLooter(looter, object) {
  looter.wanted = object; looter.isRobbed = true;
  delete looter.ignored[object.id];
  if (looter.state === LOOTER_STATE_MAD) return; // (it has somebody to drive out first: updateLooter comes back to this)
  looter.state = LOOTER_STATE_CROSS;
  looter.timer = randomBetween(TUNING.looterWantsBackSeconds[0], TUNING.looterWantsBackSeconds[1]);
  playLooterChitter(looter.figure.x, looter.figure.z, true); showCaption('looterRobbed', looter.figure);
}

function isInAVent(one) {
  return (getTileFlagsAtPosition(one.x, one.z) & TILE_FLAG_VENT) !== 0;
}

// The one of you that is in its vents: in a vent, and near it or near its nest. The nearest, or null.
function findLooterIntruder(looter) {
  if (debugState.options.creaturesIgnorePlayer) return null;
  let nearest = null, nearestMetres = Infinity;
  for (const one of players) {
    if (!isInAVent(one)) continue;
    const metres = distanceBetweenPoints(one.x, one.z, looter.figure.x, looter.figure.z);
    if (Math.min(metres, distanceBetweenPoints(one.x, one.z, looter.nest.x, looter.nest.z)) > TUNING.looterTerritoryMetres || metres >= nearestMetres) continue;
    nearest = one; nearestMetres = metres;
  }
  return nearest;
}

// Mad at one of you, who is in its vents. It keeps what it has in its arms, and nothing frightens it.
function maddenLooter(looter, one) {
  looter.madAt = one;
  looter.calmSeconds = TUNING.looterCalmSeconds;
  if (looter.state === LOOTER_STATE_MAD) return;
  if (!looter.isRobbed) looter.wanted = null;
  looter.state = LOOTER_STATE_MAD;
  looter.outSeconds = 0;
  looter.scoldSeconds = 0.3;
  looter.biteSeconds = TUNING.looterBiteAfterSeconds;
}

// ---------------------------------------------------------------------------
// Every frame
// ---------------------------------------------------------------------------

// Sets its pose from what it is doing. `movedDistance` is how far it came this frame.
function poseLooter(looter, movedDistance, dt) {
  const figure = looter.figure, pose = figure.pose;
  const isRunning = looter.state === LOOTER_STATE_FLEE, isMad = looter.state === LOOTER_STATE_MAD, isCross = looter.state === LOOTER_STATE_CROSS;
  const isStartled = looter.state === LOOTER_STATE_STARTLED;
  looter.walkPhase += movedDistance * (isRunning ? 9 : 11); // small legs: many steps to the metre
  const stride = dt > 0 ? Math.min(1, movedDistance / dt / 1.2) : 0;
  pose.legSwing = Math.sin(looter.walkPhase) * 0.6 * stride;
  // (Cross, it stamps where it stands.)
  pose.kneeBend = 0.1 + 0.25 * stride + (isCross ? Math.abs(Math.sin(game.time * 9)) * 0.3 : 0);
  // Arms: round what it carries, up over its head for what it cannot reach, flung back when it runs, and up
  // and shaking at whoever is in its vents or has its thing.
  const wantedArms = looter.carried ? 1.25 : (looter.state === LOOTER_STATE_REACH ? 2.7 : (isMad ? 2.2 : (isCross ? 1.0 : (isStartled ? 0.7 : (isRunning ? -0.5 : 0.1)))));
  looter.armRaise = dt > 0 ? approachValue(looter.armRaise, wantedArms, dt * 6) : wantedArms;
  const shake = looter.carried ? 0 : (looter.state === LOOTER_STATE_REACH ? Math.sin(game.time * 14) * 0.15 : (isMad ? Math.sin(game.time * 19) * 0.3 : (isCross ? Math.sin(game.time * 16) * 0.2 : 0)));
  pose.armRaise = looter.armRaise + shake;
  pose.armSwing = looter.carried || looter.state === LOOTER_STATE_REACH || isMad || isCross ? 0 : Math.sin(looter.walkPhase) * 0.5 * stride;
  pose.elbowBend = looter.carried ? 0.9 : 0.2;
  pose.lean = isRunning ? 0.35 : (isMad ? 0.25 : (isStartled ? -0.18 : (looter.carried ? -0.08 : 0.08))); // (startled, it leans away from what it heard)
  pose.headTilt = looter.state === LOOTER_STATE_NEST ? Math.sin(game.time * 0.7 + looter.index * 2) * 0.25 : 0;
  pose.squat = looter.state === LOOTER_STATE_NEST ? 0.5 : 0;
  updateFigureCapsules(figure);
  placeLooterLoad(looter);
}

function sendLooterHome(looter) {
  looter.wanted = null; looter.isRobbed = false;
  looter.state = LOOTER_STATE_HOME;
  looter.outSeconds = 0;
}

function updateLooter(looter, dt) {
  const figure = looter.figure;
  looter.deafSeconds -= dt;
  looter.onEdgeSeconds -= dt;
  looter.outSeconds += dt;
  // What it had is no longer in its arms. Taken out of them by one of you: it wants it back. Gone altogether
  // (broken, down the pit): that frightens it.
  if (looter.carried && (looter.carried.isRemoved || looter.carried.looterIndex !== looter.index)) {
    const lost = looter.carried;
    looter.carried = null;
    if (!lost.isRemoved && isLooseObjectHeldBySomebody(lost) && isLootable(lost)) robLooter(looter, lost);
    else if (looter.state === LOOTER_STATE_CARRY) frightenLooter(looter);
  }
  // One of you in its vents: it is mad at them for as long as they are, and a little longer.
  const intruder = findLooterIntruder(looter);
  if (intruder) maddenLooter(looter, intruder);
  const nest = looter.nest;
  const metresFromNest = distanceBetweenPoints(figure.x, figure.z, nest.x, nest.z);
  let speed = 0;

  if (looter.state === LOOTER_STATE_MAD) {
    const one = looter.madAt && players.indexOf(looter.madAt) >= 0 && isInAVent(looter.madAt) ? looter.madAt : null;
    if (one) {
      looter.calmSeconds = TUNING.looterCalmSeconds;
      looter.goalX = one.x; looter.goalZ = one.z;
      // Up to them, and no nearer than an arm's length: in front of them, in their way, turned to them.
      const isInFrontOfThem = distanceBetweenPoints(figure.x, figure.z, one.x, one.z) <= TUNING.looterMadMetres;
      if (!isInFrontOfThem) speed = TUNING.looterMadSpeed;
      else figure.yaw += clampNumber(wrapAngleToPi(Math.atan2(one.x - figure.x, -(one.z - figure.z)) - figure.yaw), -dt * 8, dt * 8);
      // In front of them, and they are still there: after a while it bites, and goes on biting.
      if (isInFrontOfThem || distanceBetweenPoints(figure.x, figure.z, one.x, one.z) < TUNING.looterMadMetres + 0.5) {
        looter.biteSeconds -= dt;
        if (looter.biteSeconds <= 0) {
          looter.biteSeconds = TUNING.looterBiteEverySeconds;
          looter.scoldSeconds = Math.max(looter.scoldSeconds, 1);
          playLooterChitter(figure.x, figure.z, true); showCaption('looterBites', figure);
          catchPlayer(one, 'looter', figure);
        }
      }
      looter.scoldSeconds -= dt;
      if (looter.scoldSeconds <= 0) {
        looter.scoldSeconds = randomBetween(TUNING.looterScoldSeconds[0], TUNING.looterScoldSeconds[1]);
        playLooterChitter(figure.x, figure.z, true); showCaption('looterMad', figure);
      }
    } else {
      // Nobody there any more: it stays where it is, bristling, and then goes back to what it was about.
      looter.calmSeconds -= dt;
      if (looter.calmSeconds <= 0) {
        looter.madAt = null; looter.outSeconds = 0;
        if (looter.carried) looter.state = LOOTER_STATE_CARRY;
        else if (looter.isRobbed && looter.wanted) { looter.state = LOOTER_STATE_CROSS; looter.timer = 0; }
        else sendLooterHome(looter);
      }
    }
  } else if (looter.state === LOOTER_STATE_STARTLED) {
    // Backing away from what it heard, a step at a time. Then on with what it was about.
    const awayX = figure.x - looter.startledX, awayZ = figure.z - looter.startledZ, away = Math.max(0.01, Math.sqrt(awayX * awayX + awayZ * awayZ));
    looter.goalX = figure.x + awayX / away * 2; looter.goalZ = figure.z + awayZ / away * 2;
    speed = TUNING.looterBackOffSpeed;
    looter.timer -= dt;
    if (looter.timer <= 0) {
      looter.outSeconds = 0; speed = 0;
      if (looter.carried) looter.state = LOOTER_STATE_CARRY;
      else if (looter.wanted && isLootable(looter.wanted) && !isLooseObjectInANest(looter.wanted)) looter.state = LOOTER_STATE_FETCH;
      else sendLooterHome(looter);
    }
  } else if (looter.state === LOOTER_STATE_CROSS) {
    // Robbed: turned to its thing, stamping, and then after it.
    const object = looter.wanted;
    looter.timer -= dt;
    if (!object || !isLootable(object) || isLooseObjectInANest(object)) sendLooterHome(looter);
    else {
      figure.yaw += clampNumber(wrapAngleToPi(Math.atan2(object.x - figure.x, -(object.z - figure.z)) - figure.yaw), -dt * 8, dt * 8);
      if (looter.timer <= 0) { looter.state = LOOTER_STATE_FETCH; looter.outSeconds = 0; }
    }
  } else if (looter.state === LOOTER_STATE_NEST) {
    looter.timer -= dt;
    if (looter.timer <= 0) chooseLooterOuting(looter);
  } else if (looter.state === LOOTER_STATE_FETCH || looter.state === LOOTER_STATE_REACH) {
    const object = looter.wanted;
    const isGone = !object || !isLootable(object) || isLooseObjectInANest(object);
    if (isGone || looter.isTargetOutOfReach || looter.outSeconds > 60) {
      if (object && !isGone) looter.ignored[object.id] = game.time + 40;
      sendLooterHome(looter);
    } else {
      looter.goalX = object.x; looter.goalZ = object.z;
      const isNear = distanceBetweenPoints(figure.x, figure.z, object.x, object.z) < TUNING.looterTakeMetres + object.prepared.boundsRadius * 0.5;
      speed = isNear ? 0 : (looter.isRobbed ? TUNING.looterChaseSpeed : TUNING.looterWalkSpeed);
      if (canLooterReach(looter, object)) {
        askToAct({ what: 'looterTake', id: object.id, looter: looter.index });
        looter.wanted = null; looter.isRobbed = false;
        if (looter.carried) {
          looter.state = LOOTER_STATE_CARRY; looter.outSeconds = 0;
          playLooterChitter(figure.x, figure.z, false); showCaption('looterTakes', figure);
        } else sendLooterHome(looter); // (it was not there to be taken after all)
      } else if (isNear && looter.state === LOOTER_STATE_FETCH) {
        // Near enough and it cannot reach: too high. In somebody's beam it may come down, so it stands under
        // it and tries for a while; on a shelf it will not, and it gives up at once.
        if (isLooseObjectHeldBySomebody(object)) { looter.state = LOOTER_STATE_REACH; looter.timer = TUNING.looterTriesSeconds; }
        else { looter.ignored[object.id] = game.time + 120; sendLooterHome(looter); }
      } else if (looter.state === LOOTER_STATE_REACH) {
        // Turned to the thing, arms up.
        const towards = Math.atan2(object.x - figure.x, -(object.z - figure.z));
        figure.yaw += clampNumber(wrapAngleToPi(towards - figure.yaw), -dt * 8, dt * 8);
        looter.timer -= dt;
        if (looter.timer <= 0) {
          playLooterChitter(figure.x, figure.z, true); showCaption('looterTries', figure);
          looter.ignored[object.id] = game.time + 30;
          sendLooterHome(looter);
        }
      }
    }
  } else if (looter.state === LOOTER_STATE_WANDER) {
    speed = TUNING.looterWalkSpeed;
    if (distanceBetweenPoints(figure.x, figure.z, looter.goalX, looter.goalZ) < 1.2 || looter.isTargetOutOfReach || looter.outSeconds > 45) sendLooterHome(looter);
  } else {
    // On its way home: with a thing, with nothing, or frightened.
    looter.goalX = nest.x; looter.goalZ = nest.z;
    speed = looter.state === LOOTER_STATE_CARRY ? TUNING.looterCarrySpeed : (looter.state === LOOTER_STATE_FLEE ? TUNING.looterFleeSpeed : TUNING.looterWalkSpeed);
    if (metresFromNest < 0.4 || (looter.isTargetOutOfReach && looter.outSeconds > 5)) {
      const wasFrightened = looter.state === LOOTER_STATE_FLEE;
      letGoAsLooter(looter, true);
      looter.state = LOOTER_STATE_NEST;
      looter.timer = wasFrightened ? randomBetween(TUNING.looterFearSeconds[0], TUNING.looterFearSeconds[1]) : randomBetween(TUNING.looterRestSeconds[0], TUNING.looterRestSeconds[1]);
      speed = 0;
    }
  }

  const yawBefore = figure.yaw;
  const movedDistance = speed > 0 ? moveCreatureToward(looter, looter.goalX, looter.goalZ, speed, dt) : 0;
  // (Startled, it walks backwards: whichever way its feet go, it keeps its face to the noise.)
  if (looter.state === LOOTER_STATE_STARTLED) {
    const towards = Math.atan2(looter.startledX - figure.x, -(looter.startledZ - figure.z));
    figure.yaw = yawBefore + clampNumber(wrapAngleToPi(towards - yawBefore), -dt * 9, dt * 9);
  }
  looter.currentSpeed = movedDistance / Math.max(dt, 0.0001);
  poseLooter(looter, movedDistance, dt);
  soundLooterSteps(looter);
}

// Its steps: small and quick. In a vent they ring. Every game makes these for itself, from how it shows the
// looter walking: there are ten of them a second when it runs, far too many to tell the others one by one.
function soundLooterSteps(looter) {
  const figure = looter.figure, stepSign = Math.sin(looter.walkPhase) >= 0 ? 1 : -1;
  if (stepSign === looter.lastStepSign) return;
  looter.lastStepSign = stepSign;
  asYoursAlone(function () {
    playLooterStep(figure.x, figure.z, (getTileFlagsAtPosition(figure.x, figure.z) & TILE_FLAG_VENT) !== 0);
    showCaption('looterSteps', figure);
  });
}

function updateLooters(dt) {
  for (const looter of looters) updateLooter(looter, dt);
}

// ---------------------------------------------------------------------------
// Down there with others: how the host's looters stand, and showing them
// ---------------------------------------------------------------------------

const LOOTER_NUMBERS = 6; // for each: x, z, which way it faces, what it is doing, the number of the thing in its arms (0: none), which nest

function describeLooters() {
  const numbers = [], round = function (value) { return Math.round(value * 1000) / 1000; };
  for (const looter of looters) {
    numbers.push(round(looter.figure.x), round(looter.figure.z), round(looter.figure.yaw), looter.state, looter.carried ? looter.carried.id : 0, level.ventNests.indexOf(looter.nest));
  }
  return numbers;
}

// One frame of the host's looters being shown here. Each walks from where it is shown to where the host last
// said it is, and holds itself by the same rules as there.
function followHostLooters(numbers, blend, dt) {
  const count = numbers && numbers.length % LOOTER_NUMBERS === 0 ? numbers.length / LOOTER_NUMBERS : 0;
  while (looters.length > count) setFigureRaycastable(looters.pop().figure, false);
  for (let index = 0; index < count; index++) {
    const at = index * LOOTER_NUMBERS;
    const nest = level.ventNests[numbers[at + 5]] || { x: numbers[at], z: numbers[at + 1], floorY: 0, isPocket: false };
    if (!looters[index]) { looters.push(createLooter(index, nest)); looters[index].figure.x = numbers[at]; looters[index].figure.z = numbers[at + 1]; looters[index].figure.yaw = numbers[at + 2]; }
    const looter = looters[index], figure = looter.figure;
    if (looter.said !== numbers) { looter.said = numbers; looter.fromX = figure.x; looter.fromZ = figure.z; looter.fromYaw = figure.yaw; }
    const beforeX = figure.x, beforeZ = figure.z;
    // (Sent somewhere else at once, it is simply there.)
    const amount = distanceBetweenPoints(looter.fromX, looter.fromZ, numbers[at], numbers[at + 1]) > 4 ? 1 : blend;
    figure.x = interpolateLinear(looter.fromX, numbers[at], amount);
    figure.z = interpolateLinear(looter.fromZ, numbers[at + 1], amount);
    figure.yaw = looter.fromYaw + wrapAngleToPi(numbers[at + 2] - looter.fromYaw) * amount;
    looter.state = clampNumber(Math.round(numbers[at + 3]), LOOTER_STATE_NEST, LOOTER_STATE_STARTLED);
    // What it has in its arms is what the host says it has (the taking and the letting go are told as they
    // happen; this is for a game that came to it late).
    const carried = numbers[at + 4] > 0 ? findLooseObjectById(numbers[at + 4]) : null;
    if (carried && carried.looterIndex === index) looter.carried = carried;
    else if (!carried || carried.looterIndex !== index) looter.carried = null;
    poseLooter(looter, distanceBetweenPoints(beforeX, beforeZ, figure.x, figure.z), dt);
    soundLooterSteps(looter);
  }
}

// ---------------------------------------------------------------------------
// The kind, for the game to run (CREATURE_KINDS, 08-creatures.js)
// ---------------------------------------------------------------------------

addCreatureKind({
  key: 'looters',
  update: updateLooters,
  holdStill: function () { for (const looter of looters) placeLooterLoad(looter); },
  reset: createLooters,
  hear: hearNoiseAsLooters,
  walkers: function (into) { for (const looter of looters) into.push(looter); },
  describe: describeLooters,
  followHost: followHostLooters,
  debugFigures: function (into) {
    for (const looter of looters) into.push({ figure: looter.figure, red: looter.state === LOOTER_STATE_FLEE || looter.state === LOOTER_STATE_MAD ? 1.0 : 0.3, green: looter.state === LOOTER_STATE_MAD ? 0.35 : 0.9, blue: looter.carried ? 0.3 : 0.75 });
  },
  debugMarks: function (into) {
    for (const looter of looters) {
      into.push({ x: looter.figure.x, z: looter.figure.z, color: looter.carried ? '#b6ff5c' : '#5cf0d2' });
      into.push({ x: looter.nest.x, z: looter.nest.z, color: '#2f7f73' });
    }
  },
  debugLines: function (lines) {
    lines.push('LOOTERS     ' + looters.length + ' (the station has nests for ' + level.ventNests.length + ')');
    for (const looter of looters) {
      lines.push('  ' + (looter.index + 1) + '  ' + LOOTER_STATE_NAMES[looter.state] + (looter.carried ? ': a ' + looter.carried.kind.label : (looter.wanted ? ': a ' + looter.wanted.kind.label : '')) +
        '   ' + distanceBetweenPoints(looter.figure.x, looter.figure.z, player.x, player.z).toFixed(1) + ' m from you');
    }
  }
});
