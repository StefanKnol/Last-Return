// ---------------------------------------------------------------------------
// The Surveyor: the thing that scans.
//
// The Hollow is blind and hears. The Surveyor is the other way about: it is deaf, and it sees. It sees the way
// you do, by a cone of pulses out of its head, and it leaves points on everything that light lands on: in a
// colour of its own, fading after a few seconds, and not on your map (they are not your points). So you see
// where it is looking, from rooms away. If its light is on you, with nothing in between, it is seeing you.
//
//   - A glance is not enough. You have to be in its light for most of a second, in all, before it has made
//     you out; out of its light that count runs down again. Then it comes: faster than you walk, slower than
//     you run, with its light kept on you and many more pulses in it.
//   - It loses you when you have been out of its light for a few seconds. It goes to where it last saw you,
//     looks all round there, and takes up its rounds again.
//   - It strikes once and runs off, far away, and sees nobody until it has got there.
//   - Light in its eye dazzles it: yours (the beam held on it for half a second), a scan grenade's, a scanner
//     tripod's. Dazzled it stands still with its light out. Then it cannot be dazzled again for a while.
//   - It makes nothing of noise: run all you like. (Running is what the Hollow hears.)
//   - It is nearly two metres tall: it does not fit a vent, and it uses the ceiling hatches as the Hollow does.
//     The doors that open for the Hollow open for it. Above the ceiling its light is out.
//   - The Hollow pays its light no heed.
//   - On its rounds it goes by light: it is told nothing of where anybody is, but it knows where scanning has
//     been landing lately ("Light", 08-creatures.js), anybody's but its own, and goes to the brightest of it
//     for how far off that is. A scanner tripod or a scan grenade draws it as your beam does.
//   - The director paces it along with the Hollow (08-director.js), in its own way: closing in, it notices
//     lit places from further and further off; in a breather it turns its back on them and goes far away.
//
// It is one of the things that arrive (08-arrivals.js), in a generated station, on a threat level that has it
// (`surveyorEnabled`). Which of them comes first is drawn for every descent; the others come later.
//
// What it shares with the other creatures is 08-creatures.js (its way of getting around, walking, the list of
// kinds) and 08-crawlspace.js (the hatches). Its light is fireScanCone (09-scan-cone.js), the same cone a
// scanner tripod sends out. Down there with others it is the host's game's to run; every game shows its light
// for itself, as it does a tripod's.
// ---------------------------------------------------------------------------

const SURVEYOR_STATE_ROAM = 0;    // walking its rounds, its light swinging from side to side
const SURVEYOR_STATE_LOOK = 1;    // at the end of a leg: standing, turning, looking all round
const SURVEYOR_STATE_CHASE = 2;   // it has seen somebody and is after them
const SURVEYOR_STATE_SEARCH = 3;  // where it last saw them: looking all round
const SURVEYOR_STATE_FLEE = 4;    // it has struck, and is running off
const SURVEYOR_STATE_DAZZLED = 5; // light in its eye: standing, its own light out
const SURVEYOR_STATE_NAMES = ['on its rounds', 'looking round', 'after somebody', 'searching', 'running off', 'dazzled'];

// The doors that open for it: the ones that open for the Hollow.
function canSurveyorOpenDoor(door) {
  if (door.kind === DOOR_KIND_AUTOMATIC) return true;
  if (door.kind === DOOR_KIND_POWERED) return game.flags.powerOn;
  return false; // a keycard door, or the lift door
}
const SURVEYOR_WAY = createCreatureWay({ key: 'surveyor', canOpenDoor: canSurveyorOpenDoor, fitsVents: false, usesHatches: true });

// Its body, unless the workshop has made one (src/creatures/surveyor.json): a person's skeleton drawn out to
// nearly two metres. A scan shows it in the colour of a scanner's light.
if (!FIGURE_KINDS.surveyor) {
  const proportions = fitFigureProportionsToHeight(FIGURE_PROPORTIONS_DUMMY, 'person', 1.95);
  proportions.kind = 'surveyor';
  FIGURE_KINDS.surveyor = { label: 'Surveyor', proportions: proportions, proportionsName: '', bodyPlan: 'person',
    surfaceClass: SURFACE_SCANNER_LIGHT, imprintTuningKey: 'surveyorImprintSeconds', color: [0.9, 0.5, 1.0], isDesigned: true };
}

// What its light leaves (recordScanHit, 09-player.js): points of its own kind, that last so long. Set afresh
// from the tuning every time it shines, so that the number can be changed while the game runs.
const SURVEYOR_LIGHT = { surfaceClass: SURFACE_SURVEYOR_LIGHT, lifeCode: 28 };

// What is its own about a trip through the crawlspace (see `crawling` in 08-crawlspace.js).
const SURVEYOR_CRAWLING = {
  speed: function () { return TUNING.hollowCrawlSpeed; },
  reachUp: function (dt) {
    const pose = surveyor.figure.pose;
    pose.armRaise = approachValue(pose.armRaise, 2.6, dt * 4); // straight up
    pose.elbowBend = 0.1; pose.legSwing = 0; pose.armSwing = 0; pose.lean = 0; pose.squat = 0;
    updateFigureCapsules(surveyor.figure);
  },
  loudness: function () { return 0.7; },
  whileUp: function () { surveyor.currentSpeed = 0; surveyor.isLit = false; surveyor.pulseBudget = 0; },
  land: function () {
    const pose = surveyor.figure.pose;
    pose.squat = 0.6; pose.armRaise = 0.2; pose.kneeBend = 0.5;
    surveyor.blindSeconds = Math.max(surveyor.blindSeconds, TUNING.surveyorLandingBlindSeconds);
    surveyor.seenSeconds = 0;
  }
};

// There is one. `isActive` is false until it has arrived.
const surveyor = Object.assign(createCreatureLegs(SURVEYOR_WAY), {
  isActive: false,
  figure: createFigureOfKind('surveyor'),
  crawlspace: null,                 // while it is going through the crawlspace (08-crawlspace.js)
  crawling: SURVEYOR_CRAWLING,
  climbIntoHatch: function (fromHatch, toHatch) { beginCreatureCrawl(surveyor, fromHatch, toHatch); },
  isIgnoredByHollow: true,          // its light is nothing to the Hollow (recordScanHit, 09-player.js)
  state: SURVEYOR_STATE_ROAM,
  timer: 0,                         // seconds left of what it is doing, where that has an end
  goalX: 0, goalZ: 0,               // where it is walking to
  lightYaw: 0,                      // which way its light points, on the plan (its head turns; its body may not)
  sweepPhase: 0,                    // where its light is in its swing from side to side
  pulseBudget: 0,                   // parts of a pulse left over from the last frame
  isLit: false,                     // its light is on (not while it is dazzled, or above the ceiling)
  seenSeconds: 0,                   // how long, in all, somebody has been in its light: at surveyorNoticeSeconds it has seen them
  sinceSeen: 99,                    // seconds since its quarry was last in its light
  quarry: null,                     // the one of you it is after
  lastSeenX: 0, lastSeenZ: 0,       // where it last saw them
  blindSeconds: 0,                  // it makes nobody out for this long (running off, just landed)
  dazzle: 0,                        // how long light has been in its eye
  dazzleImmuneSeconds: 0,           // it cannot be dazzled again for this long
  isDrawnByLight: false,            // on its rounds, it is on its way to a lit place (and not to a room it was given)
  lightX: 0, lightZ: 0,             // ... the middle of the square that was lit
  lightCheckTimer: 0,               // seconds until it next looks for a brighter place
  walkPhase: 0, lastStepSign: 1, currentSpeed: 0, tickTimer: 0,
  fromX: 0, fromZ: 0, fromYaw: 0, fromLightYaw: 0, said: null, // (in a game that only shows it: where it was at the host's last telling)
  statistics: { litFrames: 0, pulses: 0, strikes: 0, timesDazzled: 0, timesSeen: 0, timesDrawn: 0 } // for the tests and the debug readout
});

function isSurveyorInTheStation() {
  return surveyor.isActive && !isCreatureInCrawlspace(surveyor);
}

// Puts it into the station at a place, on its rounds. (It arrives at the shaft: 08-arrivals.js.)
function activateSurveyor(x, z, graceSeconds) {
  if (isWorldTheHosts()) return; // the host's Surveyor: it is the host's game that brings it
  const figure = surveyor.figure;
  surveyor.isActive = true;
  cancelCreatureCrawl(surveyor);
  figure.x = x; figure.z = z; figure.yaw = Math.random() * TWO_PI;
  surveyor.lightYaw = figure.yaw; surveyor.sweepPhase = 0; surveyor.pulseBudget = 0; surveyor.isLit = true;
  surveyor.state = SURVEYOR_STATE_LOOK; surveyor.timer = 1.5;
  surveyor.goalX = x; surveyor.goalZ = z;
  surveyor.seenSeconds = 0; surveyor.sinceSeen = 99; surveyor.quarry = null;
  surveyor.blindSeconds = graceSeconds || 0; surveyor.dazzle = 0; surveyor.dazzleImmuneSeconds = 0;
  surveyor.fieldTargetIndex = -1; surveyor.currentSpeed = 0;
  surveyor.isDrawnByLight = false; surveyor.lightCheckTimer = 0;
  if (!isAnotherDirectedCreatureAbout(findDirectedCreature('surveyor'))) resetDirector(false); // (with another about already, the descent's rhythm goes on as it was)
  figure.hitsThisFrame = 0;
  poseSurveyor(0, 0);
  setFigureRaycastable(figure, true);
}

// Takes it out of the station (a new descent, or debug mode).
function removeSurveyor() {
  surveyor.isActive = false;
  cancelCreatureCrawl(surveyor);
  surveyor.isLit = false; surveyor.quarry = null; surveyor.seenSeconds = 0;
  const statistics = surveyor.statistics;
  statistics.litFrames = 0; statistics.pulses = 0; statistics.strikes = 0; statistics.timesDazzled = 0; statistics.timesSeen = 0; statistics.timesDrawn = 0;
  setFigureRaycastable(surveyor.figure, false);
}

// ---------------------------------------------------------------------------
// Its light, and what it sees by it
// ---------------------------------------------------------------------------

// Where its light comes out: the front of its head.
const surveyorLens = { x: 0, y: 0, z: 0, directionX: 0, directionY: 0, directionZ: 1 };
function getSurveyorLens() {
  const figure = surveyor.figure, lens = surveyorLens;
  const forwardX = Math.sin(surveyor.lightYaw), forwardZ = -Math.cos(surveyor.lightYaw);
  // A little down: it looks at the floor in front of it as much as at the far wall.
  const down = -0.16, flat = Math.sqrt(1 - down * down);
  lens.directionX = forwardX * flat; lens.directionY = down; lens.directionZ = forwardZ * flat;
  lens.x = figure.x + forwardX * 0.22; lens.y = figure.y + figure.headHeight; lens.z = figure.z + forwardZ * 0.22;
  return lens;
}

// One frame of its light: the pulses this frame is due, out of its head. Returns the list of those of you the
// light was on with nothing in between (fireScanCone's, good until the next cone), or null if no pulse was due.
function shineSurveyorLight(dt) {
  const perSecond = surveyor.state === SURVEYOR_STATE_CHASE ? TUNING.surveyorHuntPulsesPerSecond : TUNING.surveyorRoamPulsesPerSecond;
  surveyor.pulseBudget += perSecond * dt;
  const pulses = Math.min(600, Math.floor(surveyor.pulseBudget));
  surveyor.pulseBudget -= pulses;
  if (pulses <= 0) return null;
  const lens = getSurveyorLens();
  SURVEYOR_LIGHT.lifeCode = convertSecondsToPointLifeCode(TUNING.surveyorLightSeconds);
  surveyor.statistics.pulses += pulses;
  // Its light comes out of its own head: its own body is not in its way. (Taken out of what a pulse can land on
  // for as long as its own pulses are in the air, and put back.)
  const figure = surveyor.figure, wasThere = raycastableFigures.indexOf(figure) >= 0;
  if (wasThere) setFigureRaycastable(figure, false);
  const lit = fireScanCone(lens.x, lens.y, lens.z, lens.directionX, lens.directionY, lens.directionZ, TUNING.surveyorConeDegrees / 2, pulses, surveyor, SURVEYOR_LIGHT).litPlayers;
  if (wasThere) setFigureRaycastable(figure, true);
  return lit;
}

// Its ticking: quicker once it has seen somebody. Each game sounds it for itself.
function soundSurveyorLight(dt) {
  surveyor.tickTimer -= dt;
  if (surveyor.tickTimer > 0) return;
  const isHunting = surveyor.state === SURVEYOR_STATE_CHASE;
  surveyor.tickTimer = isHunting ? 0.11 : 0.34;
  asYoursAlone(function () {
    playSurveyorTick(surveyor.figure.x, surveyor.figure.z, isHunting);
    showCaption('surveyorScans', surveyor.figure);
  });
}

// Which way its light is to point: on its rounds it swings from side to side of the way it faces; after
// somebody it is kept on where they are, or were.
function aimSurveyorLight(dt) {
  const figure = surveyor.figure;
  let wanted = figure.yaw;
  if (surveyor.state === SURVEYOR_STATE_CHASE) {
    wanted = Math.atan2(surveyor.lastSeenX - figure.x, -(surveyor.lastSeenZ - figure.z));
  } else if (surveyor.state === SURVEYOR_STATE_ROAM) {
    surveyor.sweepPhase += dt * TWO_PI / Math.max(0.5, TUNING.surveyorSweepSeconds);
    wanted = figure.yaw + Math.sin(surveyor.sweepPhase) * TUNING.surveyorSweepDegrees * Math.PI / 180;
  }
  surveyor.lightYaw += clampNumber(wrapAngleToPi(wanted - surveyor.lightYaw), -dt * 4.5, dt * 4.5);
}

// ---------------------------------------------------------------------------
// What it does
// ---------------------------------------------------------------------------

// How far afield it notices a lit place just now: the director sets that. Just after a breather only near
// itself; the further the closing in has come, the further off (08-director.js).
function getSurveyorLightRange() {
  return interpolateLinear(TUNING.surveyorLightNoticeNearMetres, TUNING.surveyorLightNoticeFarMetres, getDirectorPressure());
}

// The lit place most worth a look from where it stands, or null: none in a breather (it has turned its back on
// all that), and none while it is not allowed to make anybody out.
function findLightForSurveyor(atLeast) {
  if (isDirectorInBreather() || debugState.options.creaturesIgnorePlayer) return null;
  return findBrightestLightNear(surveyor.figure.x, surveyor.figure.z, getSurveyorLightRange(), Math.max(TUNING.surveyorLightInterestPulses, atLeast || 0));
}

// Sets it walking to a lit place: the floor nearest to the middle of that square.
function goToLight(light) {
  const index = findNearestWalkableTileIndex(light.x, light.z);
  if (index < 0) return false;
  surveyor.goalX = index % GRID_WIDTH + 0.5; surveyor.goalZ = Math.floor(index / GRID_WIDTH) + 0.5;
  surveyor.lightX = light.x; surveyor.lightZ = light.z;
  surveyor.state = SURVEYOR_STATE_ROAM;
  surveyor.isDrawnByLight = true;
  surveyor.statistics.timesDrawn++;
  return true;
}

// The next place on its rounds. It is told nothing of where anybody is. It goes by light: to the place where
// the most scanning has been landing lately, for how far off that is. In a breather it turns its back on that
// and goes where the director sends it, far from everybody. And with nothing lit anywhere it notices, it is
// given a room from the director's band, as the Hollow is, so that it is not lost to the far end of a station.
function chooseSurveyorRound() {
  surveyor.state = SURVEYOR_STATE_ROAM;
  surveyor.isDrawnByLight = false;
  surveyor.isTargetOutOfReach = false;
  const light = findLightForSurveyor(0);
  if (light && goToLight(light)) return;
  if (roamingWaypoints.length === 0) return;
  const waypoint = pickDirectedWaypoint(surveyor.figure);
  surveyor.goalX = waypoint[0]; surveyor.goalZ = waypoint[1];
}

// On its way somewhere, every so often: has somewhere become a good deal brighter than where it is going? Then
// it turns aside for that, and you are told, if you are near: scanning draws it. (Not while it stands looking
// round: it finishes that first.)
function lookForBrighterLight(dt) {
  surveyor.lightCheckTimer -= dt;
  if (surveyor.lightCheckTimer > 0) return;
  surveyor.lightCheckTimer = TUNING.surveyorLightCheckSeconds;
  const goingTo = surveyor.isDrawnByLight ? getLightHeatAt(surveyor.lightX, surveyor.lightZ) : 0;
  const light = findLightForSurveyor(goingTo * TUNING.surveyorLightBrighterFactor);
  if (!light) return;
  if (surveyor.isDrawnByLight && getLightCellIndex(light.x, light.z) === getLightCellIndex(surveyor.lightX, surveyor.lightZ)) return; // (it is on its way there already)
  // Where it stands and has just looked is no news to it.
  if (distanceBetweenPoints(light.x, light.z, surveyor.figure.x, surveyor.figure.z) < LIGHT_CELL_METRES) return;
  if (!goToLight(light)) return;
  playSurveyorQuery(surveyor.figure.x, surveyor.figure.z);
  showCaption('surveyorDrawn', surveyor.figure);
}

// Where it runs off to after it has struck: of a few waypoints, the one furthest from whoever it struck.
function chooseSurveyorRetreat(from) {
  let best = null, bestMetres = -1;
  for (let tries = 0; tries < 6 && roamingWaypoints.length > 0; tries++) {
    const waypoint = roamingWaypoints[Math.floor(Math.random() * roamingWaypoints.length)];
    const metres = distanceBetweenPoints(waypoint[0], waypoint[1], from.x, from.z);
    if (metres > bestMetres) { bestMetres = metres; best = waypoint; }
  }
  if (best) { surveyor.goalX = best[0]; surveyor.goalZ = best[1]; }
  surveyor.state = SURVEYOR_STATE_FLEE;
  surveyor.timer = TUNING.surveyorAfterStrikeSeconds;
  surveyor.blindSeconds = Math.max(surveyor.blindSeconds, TUNING.surveyorAfterStrikeSeconds);
  surveyor.quarry = null; surveyor.seenSeconds = 0; surveyor.sinceSeen = 99;
  playSurveyorChirp(surveyor.figure.x, surveyor.figure.z, false);
  showCaption('surveyorRuns', surveyor.figure);
}

function dazzleSurveyor() {
  surveyor.state = SURVEYOR_STATE_DAZZLED;
  surveyor.timer = TUNING.surveyorDazzledSeconds;
  surveyor.dazzle = 0;
  surveyor.dazzleImmuneSeconds = TUNING.surveyorDazzledSeconds + TUNING.surveyorDazzleImmuneSeconds;
  surveyor.quarry = null; surveyor.seenSeconds = 0; surveyor.sinceSeen = 99;
  surveyor.statistics.timesDazzled++;
  playSurveyorWhine(surveyor.figure.x, surveyor.figure.z);
  showCaption('surveyorDazzled', surveyor.figure);
}

// One frame of it, in the game that runs the station.
function updateSurveyor(dt) {
  if (!surveyor.isActive) return;
  const figure = surveyor.figure;
  // Above the ceiling, on its way round a locked door: nothing else happens until it has dropped out again.
  if (isCreatureInCrawlspace(surveyor)) { updateCreatureInCrawlspace(surveyor, dt); return; }
  surveyor.blindSeconds = Math.max(0, surveyor.blindSeconds - dt);
  surveyor.dazzleImmuneSeconds = Math.max(0, surveyor.dazzleImmuneSeconds - dt);
  surveyor.timer -= dt;

  // ---- light in its eye ----
  const lightOnIt = figure.hitsThisFrame;
  figure.hitsThisFrame = 0;
  if (lightOnIt >= TUNING.surveyorDazzleHits) surveyor.dazzle += dt; else surveyor.dazzle = Math.max(0, surveyor.dazzle - dt * 0.5);
  if (surveyor.state !== SURVEYOR_STATE_DAZZLED && surveyor.dazzleImmuneSeconds <= 0 && surveyor.dazzle >= TUNING.surveyorDazzleAfterSeconds &&
      !debugState.options.creaturesIgnorePlayer) dazzleSurveyor();

  if (surveyor.state === SURVEYOR_STATE_DAZZLED) {
    surveyor.isLit = false; surveyor.currentSpeed = 0;
    poseSurveyor(0, dt);
    if (surveyor.timer <= 0) { surveyor.state = SURVEYOR_STATE_LOOK; surveyor.timer = 2; surveyor.blindSeconds = Math.max(surveyor.blindSeconds, 1); }
    return;
  }

  // ---- its light, and who is in it ----
  surveyor.isLit = true;
  aimSurveyorLight(dt);
  const lit = shineSurveyorLight(dt);
  soundSurveyorLight(dt);
  let seenNow = null;
  if (lit && surveyor.blindSeconds <= 0 && !debugState.options.creaturesIgnorePlayer) {
    // Of everybody in its light, near enough to make out: the nearest.
    let nearestMetres = TUNING.surveyorSightMetres;
    for (const one of lit) {
      if (one.isDown || !areInTheSameSpace(one, figure)) continue;
      const metres = distanceBetweenPoints(one.x, one.z, figure.x, figure.z);
      if (metres < nearestMetres) { nearestMetres = metres; seenNow = one; }
    }
  }
  if (lit) {
    // (Counted only in a frame that had a pulse in it: a frame without one says nothing either way.)
    if (seenNow) { surveyor.seenSeconds += dt; surveyor.statistics.litFrames++; }
    else surveyor.seenSeconds = Math.max(0, surveyor.seenSeconds - dt * TUNING.surveyorNoticeSeconds / Math.max(0.1, TUNING.surveyorForgetSeconds));
  }
  surveyor.sinceSeen += dt;
  const isAfterSomebody = surveyor.state === SURVEYOR_STATE_CHASE;
  if (seenNow && (isAfterSomebody || surveyor.seenSeconds >= TUNING.surveyorNoticeSeconds) && surveyor.state !== SURVEYOR_STATE_FLEE) {
    if (!isAfterSomebody) {
      surveyor.state = SURVEYOR_STATE_CHASE;
      surveyor.statistics.timesSeen++;
      playSurveyorChirp(figure.x, figure.z, true);
      showCaption('surveyorSees', figure);
    }
    surveyor.quarry = seenNow; surveyor.sinceSeen = 0;
    surveyor.lastSeenX = seenNow.x; surveyor.lastSeenZ = seenNow.z;
  }

  // ---- where it goes ----
  let speed = 0, isTurningOnTheSpot = false;
  if (surveyor.state === SURVEYOR_STATE_CHASE) {
    const quarry = surveyor.quarry;
    if (!quarry || quarry.isDown || surveyor.sinceSeen > TUNING.surveyorLoseSeconds) {
      surveyor.state = SURVEYOR_STATE_SEARCH; surveyor.timer = TUNING.surveyorSearchSeconds;
      surveyor.goalX = surveyor.lastSeenX; surveyor.goalZ = surveyor.lastSeenZ;
      surveyor.quarry = null; surveyor.seenSeconds = 0;
      showCaption('surveyorLoses', figure);
    } else {
      surveyor.goalX = surveyor.lastSeenX; surveyor.goalZ = surveyor.lastSeenZ;
      speed = TUNING.surveyorChaseSpeed;
      // Near enough: it strikes, once, and is off.
      if (distanceBetweenPoints(figure.x, figure.z, quarry.x, quarry.z) < TUNING.surveyorStrikeDistance && surveyor.sinceSeen < 1) {
        surveyor.statistics.strikes++;
        catchPlayer(quarry, 'surveyor', figure);
        chooseSurveyorRetreat(quarry);
        speed = TUNING.surveyorFleeSpeed;
      }
    }
  }
  if (surveyor.state === SURVEYOR_STATE_SEARCH) {
    // To where it last saw them, and then all round.
    if (distanceBetweenPoints(figure.x, figure.z, surveyor.goalX, surveyor.goalZ) > 0.9 && !surveyor.isTargetOutOfReach) speed = TUNING.surveyorChaseSpeed * 0.7;
    else isTurningOnTheSpot = true;
    if (surveyor.timer <= 0) chooseSurveyorRound();
  } else if (surveyor.state === SURVEYOR_STATE_ROAM) {
    speed = surveyor.isDrawnByLight ? TUNING.surveyorDrawnSpeed : TUNING.surveyorRoamSpeed;
    if (distanceBetweenPoints(figure.x, figure.z, surveyor.goalX, surveyor.goalZ) < 0.9 || surveyor.isTargetOutOfReach) {
      // There: it looks all round. A lit place it has been to and looked at counts for little from now.
      if (surveyor.isDrawnByLight) coolLightAround(surveyor.lightX, surveyor.lightZ, TUNING.surveyorLightCoolsTo);
      surveyor.isDrawnByLight = false;
      surveyor.state = SURVEYOR_STATE_LOOK;
      surveyor.timer = randomBetween(TUNING.surveyorLookSeconds[0], TUNING.surveyorLookSeconds[1]);
      surveyor.isTargetOutOfReach = false;
      speed = 0;
    } else lookForBrighterLight(dt);
  } else if (surveyor.state === SURVEYOR_STATE_LOOK) {
    isTurningOnTheSpot = true;
    if (surveyor.timer <= 0) chooseSurveyorRound(); // (it finishes looking round before it goes anywhere: that is when it sees you, or does not)
  } else if (surveyor.state === SURVEYOR_STATE_FLEE) {
    speed = TUNING.surveyorFleeSpeed;
    if (surveyor.timer <= 0 || distanceBetweenPoints(figure.x, figure.z, surveyor.goalX, surveyor.goalZ) < 0.9 || surveyor.isTargetOutOfReach) {
      surveyor.state = SURVEYOR_STATE_LOOK; surveyor.timer = 2; surveyor.isTargetOutOfReach = false;
      speed = 0;
    }
  }
  if (debugState.options.freezeCreatures) { speed = 0; isTurningOnTheSpot = false; }
  if (isTurningOnTheSpot) { figure.yaw += dt * TUNING.surveyorLookTurnRate; surveyor.lightYaw = figure.yaw; } // looking all round: its light goes with it
  const moved = speed > 0 ? moveCreatureToward(surveyor, surveyor.goalX, surveyor.goalZ, speed, dt) : 0;
  surveyor.currentSpeed = moved / Math.max(dt, 0.0001);
  poseSurveyor(moved, dt);
  soundSurveyorSteps();
}

// How it holds itself: upright, long steps; arms over its face while it is dazzled.
function poseSurveyor(movedDistance, dt) {
  const figure = surveyor.figure, pose = figure.pose;
  const isDazzled = surveyor.state === SURVEYOR_STATE_DAZZLED, isRunning = surveyor.currentSpeed > TUNING.surveyorRoamSpeed * 1.8;
  surveyor.walkPhase += movedDistance * (isRunning ? 2.6 : 3.4);
  const swing = Math.sin(surveyor.walkPhase), stride = movedDistance > 0 ? (isRunning ? 0.75 : 0.45) : 0;
  pose.legSwing = swing * stride;
  pose.kneeBend = approachValue(pose.kneeBend, movedDistance > 0 ? 0.25 + Math.abs(swing) * 0.3 : 0.05, Math.max(dt, 0.016) * 6);
  pose.armSwing = isDazzled ? 0 : -swing * stride * 0.6;
  pose.armRaise = approachValue(pose.armRaise, isDazzled ? 2.1 : 0.08, Math.max(dt, 0.016) * 5);
  pose.elbowBend = approachValue(pose.elbowBend, isDazzled ? 1.9 : 0.15, Math.max(dt, 0.016) * 5);
  pose.lean = approachValue(pose.lean, isDazzled ? -0.25 : (isRunning ? 0.3 : 0.06), Math.max(dt, 0.016) * 4);
  pose.squat = approachValue(pose.squat, 0, Math.max(dt, 0.016) * 2);
  pose.headTilt = isDazzled ? 0.4 : -0.1;
  updateFigureCapsules(figure);
}

// Its feet. Each game sounds them for itself (the ones who are only shown it, too).
function soundSurveyorSteps() {
  const sign = Math.sin(surveyor.walkPhase) >= 0 ? 1 : -1;
  if (sign === surveyor.lastStepSign) return;
  surveyor.lastStepSign = sign;
  if (surveyor.currentSpeed < 0.2) return;
  const isRunning = surveyor.currentSpeed > TUNING.surveyorRoamSpeed * 1.8;
  asYoursAlone(function () {
    playSurveyorStep(surveyor.figure.x, surveyor.figure.z, isRunning);
    showCaption(isRunning && surveyor.state === SURVEYOR_STATE_FLEE ? 'surveyorRuns' : 'surveyorSteps', surveyor.figure);
  });
}

// ---------------------------------------------------------------------------
// Down there with others: the host says how it stands, and every game shows that, and its light, for itself
// ---------------------------------------------------------------------------

const SURVEYOR_NUMBERS = 6; // x, z, yaw, which way its light points, what it is doing, and where it is: 0 in the station, 1 above the ceiling

function describeSurveyor() {
  if (!surveyor.isActive) return [];
  const round = function (value) { return Math.round(value * 1000) / 1000; }, figure = surveyor.figure;
  return [round(figure.x), round(figure.z), round(figure.yaw), round(surveyor.lightYaw), surveyor.state, getSpaceOf(figure)];
}

function followHostSurveyor(numbers, blend, dt) {
  const figure = surveyor.figure;
  if (!numbers || numbers.length !== SURVEYOR_NUMBERS) {
    if (surveyor.isActive) { surveyor.isActive = false; setFigureRaycastable(figure, false); }
    return;
  }
  const isAbove = numbers[5] === SPACE_CRAWLSPACE;
  if (!surveyor.isActive) { surveyor.isActive = true; figure.x = numbers[0]; figure.z = numbers[1]; figure.yaw = numbers[2]; surveyor.lightYaw = numbers[3]; surveyor.said = null; }
  if (surveyor.said !== numbers) { surveyor.said = numbers; surveyor.fromX = figure.x; surveyor.fromZ = figure.z; surveyor.fromYaw = figure.yaw; surveyor.fromLightYaw = surveyor.lightYaw; }
  figure.space = isAbove ? SPACE_CRAWLSPACE : SPACE_STATION;
  setFigureRaycastable(figure, !isAbove);
  const beforeX = figure.x, beforeZ = figure.z;
  // Sent somewhere else at once: it is simply there, it does not slide across the station.
  const amount = distanceBetweenPoints(surveyor.fromX, surveyor.fromZ, numbers[0], numbers[1]) > 4 ? 1 : blend;
  figure.x = interpolateLinear(surveyor.fromX, numbers[0], amount);
  figure.z = interpolateLinear(surveyor.fromZ, numbers[1], amount);
  figure.yaw = surveyor.fromYaw + wrapAngleToPi(numbers[2] - surveyor.fromYaw) * amount;
  surveyor.lightYaw = surveyor.fromLightYaw + wrapAngleToPi(numbers[3] - surveyor.fromLightYaw) * amount;
  surveyor.state = clampNumber(Math.round(numbers[4]), SURVEYOR_STATE_ROAM, SURVEYOR_STATE_DAZZLED);
  const moved = distanceBetweenPoints(beforeX, beforeZ, figure.x, figure.z);
  surveyor.currentSpeed = moved / Math.max(dt, 0.0001);
  figure.hitsThisFrame = 0;
  surveyor.isLit = !isAbove && surveyor.state !== SURVEYOR_STATE_DAZZLED;
  if (isAbove) return;
  poseSurveyor(moved, dt);
  soundSurveyorSteps();
  // Its light, as this game sees it. (Who is in it is the host's game's to say.)
  if (surveyor.isLit) { shineSurveyorLight(dt); soundSurveyorLight(dt); }
}

// How the director paces it (08-director.js). Not as it paces the Hollow: this one is told nothing of where
// anybody is. What the rhythm does to it is in chooseSurveyorRound and getSurveyorLightRange: closing in, it
// notices lit places from further and further off; in a breather it turns its back on them and goes far away.
addDirectedCreature({
  key: 'surveyor',
  figure: surveyor.figure,
  isAbout: function () { return surveyor.isActive; },
  isIdle: function () { return surveyor.state === SURVEYOR_STATE_ROAM || surveyor.state === SURVEYOR_STATE_LOOK; },
  // After somebody fills menace fastest, searching where it lost them slower, on its rounds near you slowest;
  // running off, or dazzled, it fills nothing.
  menaceRise: function (closeness) {
    if (surveyor.state === SURVEYOR_STATE_CHASE) return 1 / TUNING.directorPeakAfterHuntSeconds;
    if (surveyor.state === SURVEYOR_STATE_SEARCH) return closeness / TUNING.directorPeakAfterSearchSeconds;
    if (surveyor.state === SURVEYOR_STATE_FLEE || surveyor.state === SURVEYOR_STATE_DAZZLED || isCreatureInCrawlspace(surveyor)) return 0;
    return closeness * closeness / TUNING.directorPeakAfterLoomSeconds;
  },
  takeUpRounds: chooseSurveyorRound,
  beginBreather: function () {
    chooseSurveyorRound();
    showCaption('surveyorMovingOff', surveyor.figure);
  },
  // Put far from everybody at once, seeing nobody for a while.
  sendAway: function (graceSeconds) {
    if (!surveyor.isActive || isWorldTheHosts()) return;
    const waypoint = pickFarthestWaypoint(surveyor.figure);
    cancelCreatureCrawl(surveyor);
    setFigureRaycastable(surveyor.figure, true);
    surveyor.figure.x = waypoint[0]; surveyor.figure.z = waypoint[1];
    surveyor.state = SURVEYOR_STATE_LOOK; surveyor.timer = 2;
    surveyor.quarry = null; surveyor.seenSeconds = 0; surveyor.sinceSeen = 99; surveyor.isDrawnByLight = false;
    surveyor.blindSeconds = Math.max(surveyor.blindSeconds, graceSeconds || 0);
    surveyor.fieldTargetIndex = -1;
    poseSurveyor(0, 0);
    beginBreatherAfterSendingAway();
  }
});

addCreatureKind({
  key: 'surveyor',
  update: updateSurveyor,
  holdStill: function () { if (isSurveyorInTheStation()) updateFigureCapsules(surveyor.figure); },
  reset: removeSurveyor,
  // (No `hear`: it is deaf.)
  walkers: function (into) { if (isSurveyorInTheStation()) into.push(surveyor); },
  describe: describeSurveyor,
  followHost: followHostSurveyor,
  debugFigures: function (into) {
    if (surveyor.isActive) into.push({ figure: surveyor.figure, red: surveyor.state === SURVEYOR_STATE_CHASE ? 1.0 : 0.75, green: 0.35, blue: 1.0 });
  },
  debugMarks: function (into) {
    if (surveyor.isActive) into.push({ x: surveyor.figure.x, z: surveyor.figure.z, color: isCreatureInCrawlspace(surveyor) ? '#6d3f8f' : '#d98cff' });
  },
  debugLines: function (lines) {
    if (!surveyor.isActive) { lines.push('SURVEYOR    not here'); return; }
    lines.push('SURVEYOR    ' + (isCreatureInCrawlspace(surveyor) ? 'above the ceiling' : SURVEYOR_STATE_NAMES[surveyor.state]) + '   ' +
      distanceBetweenPoints(surveyor.figure.x, surveyor.figure.z, player.x, player.z).toFixed(1) + ' m from you   seen for ' + surveyor.seenSeconds.toFixed(2) + ' of ' +
      TUNING.surveyorNoticeSeconds + ' s' + (surveyor.blindSeconds > 0 ? '   BLIND ' + surveyor.blindSeconds.toFixed(1) + ' s' : '') +
      (surveyor.dazzleImmuneSeconds > 0 ? '   cannot be dazzled for ' + surveyor.dazzleImmuneSeconds.toFixed(1) + ' s' : ''));
    const light = findLightForSurveyor(0);
    lines.push('  light     ' + (isDirectorInBreather() ? 'a breather: it has turned its back on it' : 'notices it within ' + getSurveyorLightRange().toFixed(0) + ' m') +
      (surveyor.isDrawnByLight ? '; ON ITS WAY to a lit place ' + distanceBetweenPoints(surveyor.lightX, surveyor.lightZ, surveyor.figure.x, surveyor.figure.z).toFixed(0) + ' m off (' + getLightHeatAt(surveyor.lightX, surveyor.lightZ).toFixed(0) + ' pulses lately)' :
        (light ? '; the brightest is ' + distanceBetweenPoints(light.x, light.z, surveyor.figure.x, surveyor.figure.z).toFixed(0) + ' m off (' + light.heat.toFixed(0) + ')' : '; nothing lit that it notices')) +
      '   where you stand: ' + getLightHeatAt(player.x, player.z).toFixed(0));
  }
});
