// ---------------------------------------------------------------------------
// The Hollow: the thing that hears.
//
// It is blind. What it has is its ears, and its skin for the beam:
//
//   - It hears what is loud (hearNoiseAsHollow): a noise near enough and it knows where you are, one further
//     off and it comes to look. Close by it hears you walk. Every so often, with you not far away, it stops
//     dead and listens, and hears better for it.
//   - The beam slows it to a crawl and angers it. A touch makes it stop and turn; held on it, the beam tells it
//     where the light comes from; at full anger it is enraged, and the beam does nothing to it for a while.
//   - It hunts whoever it last sensed, to where it last sensed them. When it has lost them it searches, a
//     little ahead of where they were going, and sometimes it only pretends to give up.
//   - It strikes, stands where it struck for a moment, and goes on (09-health.js).
//   - The director paces it (08-director.js): its rounds close in on you and then it is sent off for a
//     breather. It is never told where you are.
//
// What is not in this file: how it gets round a door that is shut to it (the crawlspace above the ceilings, and
// pounding on a keycard door) is 08-crawlspace.js; when it comes into the station is 08-arrivals.js; what it
// does with the things that lie loose is 08-loose-objects.js; what it steps on is 03-noisy-floor.js. What it
// shares with the other creatures (its way of getting around, walking, the list of kinds) is 08-creatures.js.
// Down there with others it is the host's game's to run (11-together.js).
//
// Its body is one of the bodies there are for it (TUNING.hollowBodies: chooseHollowBody below): the one that
// is written as code (FIGURE_PROPORTIONS_HOLLOW, 04-figures.js), or a creature made in the workshop on the
// Hollow's skeleton (src/creatures/hollowAlt.json). Which one a station has goes by its seed.
// ---------------------------------------------------------------------------

const HOLLOW_STATE_ROAM = 0;
const HOLLOW_STATE_INVESTIGATE = 1;
const HOLLOW_STATE_HUNT = 2;
const HOLLOW_STATE_SEARCH = 3;
const HOLLOW_STATE_LISTEN = 4;   // standing still, listening harder than usual

// How the Hollow gets around (08-creatures.js): it goes down on knees and hands to get through a vent, it uses
// the ceiling hatches, and only some doors open for it (canHollowOpenDoor, 08-crawlspace.js).
const HOLLOW_WAY = createCreatureWay({ key: 'hollow', canOpenDoor: canHollowOpenDoor, fitsVents: true, usesHatches: true });

// (createCreatureLegs gives it what it walks by: its way, and how far it is to where it is going.)
const hollow = Object.assign(createCreatureLegs(HOLLOW_WAY), {
  figure: createFigureOfKind('hollow'),
  bodyKey: 'hollow',    // which body it has in this station: a key of FIGURE_KINDS (chooseHollowBody)
  isActive: false,
  state: HOLLOW_STATE_ROAM,
  targetX: 0, targetZ: 0,
  lastKnownPlayerX: 0, lastKnownPlayerZ: 0,
  timeSinceSensed: 99,
  timeSinceLastHunt: 0,
  searchTimer: 0,
  searchRetargetTimer: 0,
  searchCenterX: 0, searchCenterZ: 0,
  // Anger runs from 0 (calm) to 1 (enraged). The beam raises it, time lowers it slowly.
  // Below TUNING.hollowAngerNoticeLevel the beam only makes it stop and turn; above, it knows where you are.
  anger: 0,
  wasInBeam: false,
  isAfterAThing: false, // hunting, and what it is following is the light of a scanner that scans by itself, not one of you
  stunSeconds: 0,       // it stands stunned for this much longer (see stunHollow)
  recoverSeconds: 0,    // it has just struck somebody who is still on their feet: it stands there for this much longer, and strikes nobody
  turnCaptionCooldown: 0,
  enragedTimer: 0,
  listenTimer: 0,
  nextListenIn: 12,
  lastNoiseX: 0, lastNoiseZ: 0, hasHeardNoise: false,
  lastKnownVelocityX: 0, lastKnownVelocityZ: 0,
  doubleBackTimer: 0, doubleBackX: 0, doubleBackZ: 0,
  heldAmount: 0,
  walkPhase: 0,
  lastStepSign: 1,
  voiceTimer: 0,     // seconds until its next snarl or sniff
  trillCooldown: 0,  // seconds before it may make its "heard something" sound again
  graceTimer: 0,
  stingerCooldown: 0,
  armRaise: 0,
  climbIntoHatch: beginHollowCrawl,           // under a hatch that is its shortest way on (moveCreatureToward)
  crawling: HOLLOW_CRAWLING,                  // what is its own about a trip through the crawlspace (08-crawlspace.js)
  waitsBeforeHatch: chooseDoorBeforeCrawling, // ... unless there is a door it would rather go at first
  crawlspace: null,           // while it is going through the crawlspace: where from, where to, how far along (08-crawlspace.js)
  doorBang: null,             // while it is going at a door: which door, which side it stands on, how far along
  doorCheckTimer: 0,          // it looks for a door worth breaking a few times a second, not every frame
  currentSpeed: 0,
  knowsPlayerPositionAlways: false
});

// ---------------------------------------------------------------------------
// Its body
// ---------------------------------------------------------------------------

// Which body it has in this station: one of TUNING.hollowBodies, those of them that there is a body for and
// that are put together by the Hollow's skeleton (how it holds itself, and how it fits itself under a ceiling
// and into a vent, is written for that skeleton: poseHollow). Which one is drawn by the station's seed: so the
// same station has the same Hollow every time, and every game that shows a station (yours, and those of
// whoever is down there with you) gives it the same body without being told. Kessel-9 has no seed, and is the
// descent as it was written: the first body of the list.
// (A body from the workshop is passed over in a station that is built from the code alone, like the rooms and
// the loose things from there: isWorkshopContentUsed, 03-levelgen.js. That is how the checks in tools/ have it.)
function chooseHollowBody() {
  const bodies = TUNING.hollowBodies.filter(function (key) {
    const kind = FIGURE_KINDS[key];
    return Boolean(kind) && kind.bodyPlan === 'hollow' && (isWorkshopContentUsed || kind.isDesigned !== true);
  });
  if (bodies.length === 0) return 'hollow';
  if (level.kind !== 'generated') return bodies[0];
  return bodies[Math.floor(createNamedRandomGenerator(level.seed, 'the body of the Hollow')() * bodies.length)];
}

// A new descent: it gets the body this station has for it. There is one Hollow, and it is the same figure all
// along: what changes is what that figure is made of (setFigureKind, 04-figures.js).
function dressHollow() {
  hollow.bodyKey = chooseHollowBody();
  setFigureKind(hollow.figure, hollow.bodyKey);
}

// The proportions of the body it has in this station: what an apparition of it is made of (08-phantoms.js), so
// that what was never there looks like what is.
function getHollowBody() {
  return hollow.figure.proportions;
}

// ---------------------------------------------------------------------------
// Noise: what the Hollow hears
// ---------------------------------------------------------------------------

// How much better than normal the Hollow hears right now: anger sharpens it, and so does standing still to listen.
function getHollowHearingBoost() {
  if (!hollow.isActive) return 1;
  return (1 + TUNING.hollowAngerHearingBonus * hollow.anger) *
    (hollow.state === HOLLOW_STATE_LISTEN ? TUNING.hollowListenHearingFactor : 1);
}

// What the Hollow makes of a noise (emitNoise and hearNoise are in 08-creatures.js: every kind of creature is told).
// `space` is where the noise was made. Above the ceiling a noise from the station reaches it through the
// ceiling, so from less far, and what it does about one is another thing altogether (hearNoiseFromAboveTheCeiling).
function hearNoiseAsHollow(x, z, radius, space) {
  const madeIn = space === undefined ? SPACE_STATION : space, isIn = getSpaceOf(hollow.figure);
  const effectiveRadius = radius * game.difficulty.hearingFactor * getHollowHearingBoost() * getNoiseCarryBetweenSpaces(madeIn, isIn);
  if (debugHooks.recordNoise) debugHooks.recordNoise(x, z, effectiveRadius);
  if (!hollow.isActive || hollow.graceTimer > 0 || debugState.options.creaturesIgnorePlayer) return;
  // The tick of a scanner it has been up to and knows for a thing: it pays that no heed (letHollowKnowScanner).
  if (Math.abs(radius - TUNING.noiseRadiusTripodPulse) < 0.001) {
    for (const object of looseObjects) {
      if (object.kind.scans && object.isOn && object.isIgnoredByHollow && distanceBetweenPoints(x, z, object.x, object.z) < 0.5) return;
    }
  }
  const distance = distanceBetweenPoints(x, z, hollow.figure.x, hollow.figure.z);
  // Too faint to act on, but close enough to make it turn its head that way.
  if (distance < effectiveRadius * 1.8) { hollow.lastNoiseX = x; hollow.lastNoiseZ = z; hollow.hasHeardNoise = true; }
  if (distance > effectiveRadius) return;
  if (hollow.state === HOLLOW_STATE_HUNT) {
    if (distance < effectiveRadius * 0.7) {
      hollow.lastKnownPlayerX = x; hollow.lastKnownPlayerZ = z;
      hollow.timeSinceSensed = Math.min(hollow.timeSinceSensed, 2.5);
    }
    return;
  }
  if (madeIn !== isIn) { hearNoiseFromAnotherSpace(x, z); return; }
  if (distance < effectiveRadius * 0.3) {
    beginHollowHunt(x, z);
  } else {
    if (hollow.state !== HOLLOW_STATE_INVESTIGATE && hollow.trillCooldown <= 0) { playHollowCuriousTrill(); showCaption('hollowTrill', hollow.figure); hollow.trillCooldown = 8; }
    hollow.state = HOLLOW_STATE_INVESTIGATE;
    hollow.targetX = x; hollow.targetZ = z;
    hollow.doubleBackTimer = 0;
  }
}

// It has heard a noise that was made in another space than the one it is in: under it, while it crawls above
// the ceiling. However near that was on the map, it is not near: there is a ceiling in between, and it cannot
// get at whatever made it from where it is. So it does not find you (no roar, no hunt). It stops and listens
// (the crawling overhead goes quiet: that is how you know it heard), and when it is down it comes to look at
// where the noise was.
function hearNoiseFromAnotherSpace(x, z) {
  hollow.state = HOLLOW_STATE_INVESTIGATE;
  hollow.targetX = x; hollow.targetZ = z;
  hollow.doubleBackTimer = 0;
  if (isHollowInCrawlspace()) listenFromTheCrawlspace();
}

// Stuns the Hollow where it stands, for `seconds`. An enraged Hollow is past that. Returns whether it worked.
function stunHollow(seconds) {
  if (isWorldTheHosts()) { sayToOthers({ k: 'stun', s: seconds }); return hollow.isActive; } // the host's Hollow: the host's to stun
  if (!hollow.isActive || hollow.enragedTimer > 0 || hollow.graceTimer > 0 || isHollowInCrawlspace()) return false;
  hollow.stunSeconds = Math.max(hollow.stunSeconds, seconds);
  shareWorldSoundsDuring(function () { showCaption('hollowStunned', hollow.figure); });
  return true;
}

// The Hollow has come right up to a scanner that scans by itself (a tripod, a fallen scanner: called from
// updateLooseScanner, in the game that runs the Hollow). It came because the thing lit it, or ticked. Now it
// knows what it is: not one of you. It stands over it for a moment, sniffs, and goes back to its rounds. From
// now on that scanner's light is nothing to it (it does not anger it, hold it or draw it: recordScanHit,
// 09-player.js) and neither is its ticking (hearNoiseAsHollow), until one of you takes the scanner into the
// beam again: moved, it is a new thing to find out about.
function letHollowKnowScanner(object) {
  object.isIgnoredByHollow = true;
  const figure = hollow.figure;
  figure.hitsThisFrame = 0;
  hollow.wasInBeam = false; hollow.heldAmount = 0;
  // What that light made of its temper is gone with it, unless the light on it now is one of yours.
  const wasItsLight = figure.beamSourceObject === object;
  if (wasItsLight) { hollow.anger = Math.min(hollow.anger, TUNING.hollowAngerNoticeLevel * 0.4); hollow.enragedTimer = 0; figure.beamSourceObject = null; }
  // And if the thing is what it was after, it is after nothing now. (After one of you, it goes on.)
  const wasAfterIt = ((hollow.state === HOLLOW_STATE_HUNT || hollow.state === HOLLOW_STATE_SEARCH) && hollow.isAfterAThing) ||
    (hollow.state === HOLLOW_STATE_INVESTIGATE && distanceBetweenPoints(hollow.targetX, hollow.targetZ, object.x, object.z) < 2.5);
  if (wasAfterIt || hollow.state === HOLLOW_STATE_ROAM) {
    hollow.state = HOLLOW_STATE_LISTEN;
    hollow.listenTimer = TUNING.hollowAtScannerSeconds;
    hollow.doorBang = null; hollow.isAfterAThing = false; hollow.timeSinceSensed = 99;
  }
  shareWorldSoundsDuring(function () { playHollowSniff(); showCaption('hollowKnowsScanner', figure); });
}

// Draws the Hollow towards a place, the way a noise does, unless it is hunting. Used for a thing it has kicked.
function drawHollowTowards(x, z) {
  if (!hollow.isActive || hollow.graceTimer > 0 || hollow.state === HOLLOW_STATE_HUNT || debugState.options.creaturesIgnorePlayer) return false;
  hollow.state = HOLLOW_STATE_INVESTIGATE;
  hollow.targetX = x; hollow.targetZ = z;
  hollow.doubleBackTimer = 0;
  return true;
}

// ---------------------------------------------------------------------------
// Coming into the station, and being taken out of it
// ---------------------------------------------------------------------------

function activateHollow(x, z, graceSeconds) {
  if (isWorldTheHosts()) return; // the host's Hollow: it is the host's game that wakes it
  hollow.isActive = true;
  hollow.figure.x = x; hollow.figure.z = z;
  hollow.state = HOLLOW_STATE_ROAM;
  hollow.targetX = x; hollow.targetZ = z;
  hollow.timeSinceSensed = 99;
  hollow.timeSinceLastHunt = 0;
  hollow.anger = 0; hollow.wasInBeam = false; hollow.enragedTimer = 0; hollow.heldAmount = 0; hollow.stunSeconds = 0; hollow.recoverSeconds = 0;
  hollow.listenTimer = 0; hollow.nextListenIn = 12; hollow.doubleBackTimer = 0; hollow.hasHeardNoise = false;
  hollow.graceTimer = graceSeconds;
  hollow.fieldTargetIndex = -1;
  cancelHollowCrawl();
  hollow.doorBang = null;
  if (!isAnotherDirectedCreatureAbout(findDirectedCreature('hollow'))) resetDirector(false); // (with another about already, the descent's rhythm goes on as it was)
  updateFigureCapsules(hollow.figure);
  setFigureRaycastable(hollow.figure, true);
}

function deactivateHollow() {
  hollow.isActive = false;
  cancelHollowCrawl();
  hollow.doorBang = null;
  setFigureRaycastable(hollow.figure, false);
}

// ---------------------------------------------------------------------------
// The Hollow and the director (08-director.js): how it is paced.
//
// It is steered. Its rounds are chosen from rooms in a band of walking distance from you, which narrows as the
// director closes in, and in a breather it is sent to the far side of the station. The director never tells it
// where you are: it still has to hear you or feel the beam to find you.
// ---------------------------------------------------------------------------

// Picks the next room to wander to: one whose walking distance from you is inside the director's band.
function chooseHollowRoamTarget() {
  const choice = pickDirectedWaypoint(hollow.figure);
  hollow.targetX = choice[0]; hollow.targetZ = choice[1];
}

addDirectedCreature({
  key: 'hollow',
  figure: hollow.figure,
  isAbout: function () { return hollow.isActive; },
  isIdle: function () { return hollow.state === HOLLOW_STATE_ROAM; },
  // A chase fills menace fastest, searching or listening beside you slower, merely wandering near you slowest.
  menaceRise: function (closeness) {
    if (hollow.state === HOLLOW_STATE_HUNT) return 1 / TUNING.directorPeakAfterHuntSeconds;
    if (hollow.state === HOLLOW_STATE_ROAM) return closeness * closeness / TUNING.directorPeakAfterLoomSeconds;
    return closeness / TUNING.directorPeakAfterSearchSeconds;
  },
  impatience: function () { return hollow.anger; },
  takeUpRounds: chooseHollowRoamTarget,
  beginBreather: function () {
    hollow.doubleBackTimer = 0; // a breather is a real one: no pretending to leave and coming straight back
    chooseHollowRoamTarget();
    showCaption('hollowMovingOff', hollow.figure);
  },
  sendAway: function (graceSeconds) { relocateHollowAwayFromPlayer(graceSeconds); }
});

// Moves the Hollow somewhere far from the player (after a death, or to give breathing room).
function relocateHollowAwayFromPlayer(graceSeconds) {
  if (!hollow.isActive || isWorldTheHosts()) return;
  refreshPlayerDistanceField();
  let best = roamingWaypoints[0], bestSteps = -1;
  for (const waypoint of roamingWaypoints) {
    const index = findNearestWalkableTileIndex(waypoint[0], waypoint[1]);
    if (index < 0) continue;
    const steps = playerDistanceField[index];
    if (steps < NAVIGATION_UNREACHABLE && steps > bestSteps && tileZone[index] !== level.storeZone) { bestSteps = steps; best = waypoint; }
  }
  cancelHollowCrawl();
  hollow.doorBang = null;
  setFigureRaycastable(hollow.figure, true);
  hollow.figure.x = best[0]; hollow.figure.z = best[1];
  hollow.state = HOLLOW_STATE_ROAM;
  hollow.timeSinceSensed = 99;
  hollow.timeSinceLastHunt = 0;
  hollow.anger *= 0.5; hollow.wasInBeam = false; hollow.enragedTimer = 0; hollow.heldAmount = 0;
  hollow.listenTimer = 0; hollow.doubleBackTimer = 0; hollow.recoverSeconds = 0;
  hollow.graceTimer = graceSeconds;
  beginBreatherAfterSendingAway(); // being sent away always comes with a breather, for everything the director paces (it chooses the Hollow's next room)
  updateFigureCapsules(hollow.figure);
}

function beginHollowHunt(x, z) {
  hollow.lastKnownPlayerX = x; hollow.lastKnownPlayerZ = z;
  hollow.timeSinceSensed = 0;
  const quarry = findNearestPlayer(x, z); // whoever it sensed there: the one standing nearest to the place
  hollow.lastKnownVelocityX = quarry.velocityX; hollow.lastKnownVelocityZ = quarry.velocityZ;
  hollow.doubleBackTimer = 0;
  if (hollow.state !== HOLLOW_STATE_HUNT) {
    hollow.state = HOLLOW_STATE_HUNT;
    hollow.timeSinceLastHunt = 0;
    // The roar is its own voice and comes every time. The stinger is the game's, and is rationed.
    playHollowRoar();
    hollow.voiceTimer = randomBetween(2.0, 3.2);
    if (hollow.stingerCooldown <= 0) {
      playStinger('spotted');
      showCaption('hollowFound', hollow.figure);
      hollow.stingerCooldown = 14;
    } else {
      showCaption('hollowRoar', hollow.figure); // without the stinger there is still the roar to put into words
    }
  }
}

// Where it starts looking once it has lost you: a little ahead of where you were last sensed,
// in the direction you were moving, if it can walk there in a straight line.
function chooseHollowSearchCenter() {
  const figure = hollow.figure;
  const leadX = hollow.lastKnownPlayerX + hollow.lastKnownVelocityX * TUNING.hollowSearchLeadSeconds;
  const leadZ = hollow.lastKnownPlayerZ + hollow.lastKnownVelocityZ * TUNING.hollowSearchLeadSeconds;
  if (isWalkableAt(Math.floor(leadX), Math.floor(leadZ)) && hasClearWalkingLineForWay(HOLLOW_WAY, hollow.lastKnownPlayerX, hollow.lastKnownPlayerZ, leadX, leadZ) &&
      getZoneAtPosition(leadX, leadZ) !== level.storeZone) {
    hollow.searchCenterX = leadX; hollow.searchCenterZ = leadZ;
    hollow.targetX = leadX; hollow.targetZ = leadZ;
    hollow.searchRetargetTimer = randomBetween(2, 3.5);
  } else {
    hollow.searchCenterX = figure.x; hollow.searchCenterZ = figure.z;
    hollow.searchRetargetTimer = 0;
  }
}

function updateHollow(dt) {
  if (!hollow.isActive) return;
  const figure = hollow.figure;
  hollow.graceTimer -= dt;
  hollow.stingerCooldown -= dt;
  hollow.turnCaptionCooldown -= dt;
  hollow.timeSinceLastHunt += dt;
  hollow.trillCooldown -= dt;
  // Its voice says what it is doing: snarls while it is after you, pulls of breath while it searches.
  // TWEAK: the pairs of numbers are the shortest and longest gap between two of them, in seconds.
  hollow.voiceTimer -= dt;
  if (hollow.voiceTimer <= 0) {
    if (hollow.state === HOLLOW_STATE_HUNT) { playHollowSnarl(); showCaption('hollowSnarl', figure); hollow.voiceTimer = randomBetween(2.2, 4.0); }
    else if (hollow.state === HOLLOW_STATE_SEARCH) { playHollowSniff(); showCaption('hollowSniff', figure); hollow.voiceTimer = randomBetween(2.8, 5.0); }
    else hollow.voiceTimer = 1;
  }
  // Above the ceiling, on its way round a locked door: nothing else happens until it has dropped out again.
  if (isHollowInCrawlspace()) { updateHollowInCrawlspace(dt); return; }
  // Standing at a door, pounding on it: the same.
  if (hollow.doorBang && hollow.doorBang.isPounding) { updateHollowDoorBang(dt); return; }
  const nearestPlayer = findNearestPlayer(figure.x, figure.z);
  const distanceToPlayer = distanceBetweenPoints(figure.x, figure.z, nearestPlayer.x, nearestPlayer.z);
  const beamHits = figure.hitsThisFrame;
  figure.hitsThisFrame = 0;
  const canSense = hollow.graceTimer <= 0 && !debugState.options.creaturesIgnorePlayer;
  const isInBeam = canSense && beamHits >= TUNING.hollowBeamHitsToNotice;
  const isEnraged = hollow.enragedTimer > 0;

  // ---- anger: the beam raises it, time lowers it. A tap is survivable; holding is not. ----
  if (isInBeam && !isEnraged) {
    hollow.anger = Math.min(1, hollow.anger + dt * TUNING.hollowAngerPerBeamSecond * game.difficulty.angerFactor);
    if (!hollow.wasInBeam && hollow.turnCaptionCooldown <= 0 && hollow.state !== HOLLOW_STATE_HUNT) {
      showCaption('hollowTurns', figure);
      hollow.turnCaptionCooldown = 12;
    }
  } else if (!isEnraged && hollow.state !== HOLLOW_STATE_HUNT) {
    hollow.anger = Math.max(0, hollow.anger - dt * TUNING.hollowAngerCoolingPerSecond);
  }

  // ---- senses: it is blind. It hears, and once angry enough it can follow the light back to where it comes from. ----
  // That is you, when it is your scanner. Something else that scans (a scan grenade) draws it to itself.
  const beamSourceX = figure.beamSourceX === undefined ? player.x : figure.beamSourceX;
  const beamSourceZ = figure.beamSourceZ === undefined ? player.z : figure.beamSourceZ;
  let heardPlayer = null, heardDistance = Infinity, isLightFollowed = false;
  if (canSense) {
    if (isInBeam && hollow.anger >= TUNING.hollowAngerNoticeLevel) isLightFollowed = true;
    // Of everyone it can hear, it goes for the nearest.
    for (const one of players) {
      const distance = distanceBetweenPoints(figure.x, figure.z, one.x, one.z);
      const proximityRadius = one.audibleRadius * game.difficulty.hearingFactor * getHollowHearingBoost();
      if (distance < proximityRadius && distance < heardDistance &&
          (distance < 1.6 || hasClearWalkingLine(figure.x, figure.z, one.x, one.z))) { heardPlayer = one; heardDistance = distance; }
    }
    if (!heardPlayer && hollow.knowsPlayerPositionAlways) heardPlayer = nearestPlayer;
  }
  if (heardPlayer) { beginHollowHunt(heardPlayer.x, heardPlayer.z); hollow.isAfterAThing = false; }
  else if (isLightFollowed) { beginHollowHunt(beamSourceX, beamSourceZ); hollow.isAfterAThing = Boolean(figure.beamSourceObject); } // (the light of a tripod: it is after a thing, and does not know it yet)
  else hollow.timeSinceSensed += dt;

  // The beam has just left it and it was not sure where the light came from: it comes over to look.
  if (hollow.wasInBeam && !isInBeam && canSense && hollow.state !== HOLLOW_STATE_HUNT &&
      hollow.anger >= TUNING.hollowAngerNoticeLevel * 0.5) {
    hollow.state = HOLLOW_STATE_INVESTIGATE;
    hollow.targetX = beamSourceX; hollow.targetZ = beamSourceZ;
    hollow.doubleBackTimer = 0;
  }
  hollow.wasInBeam = isInBeam;

  // ---- full anger: enraged. The beam stops working on it for a while. ----
  if (hollow.anger >= 1 && !isEnraged) {
    hollow.enragedTimer = TUNING.hollowEnragedDurationSeconds;
    playStinger('enraged');
    showCaption('hollowEnraged', figure);
  }
  if (hollow.enragedTimer > 0) {
    hollow.enragedTimer -= dt;
    if (hollow.enragedTimer <= 0) hollow.anger = TUNING.hollowAngerAfterEnraged;
  }
  const isHeld = isInBeam && hollow.enragedTimer <= 0;
  hollow.heldAmount = approachValue(hollow.heldAmount, isHeld ? 1 : 0, dt * 5);

  // ---- decide where to go ----
  let speed = TUNING.hollowRoamSpeed;
  if (hollow.state !== HOLLOW_STATE_HUNT) hollow.doorBang = null; // it only goes at doors while it is after you
  if (hollow.state === HOLLOW_STATE_HUNT) {
    hollow.targetX = hollow.lastKnownPlayerX; hollow.targetZ = hollow.lastKnownPlayerZ;
    // A door shut in its face that it thinks it can get through: it goes and stands at it (see 08-crawlspace.js).
    updateHollowDoorChoice(dt);
    if (hollow.doorBang) { hollow.targetX = hollow.doorBang.standX; hollow.targetZ = hollow.doorBang.standZ; }
    speed = TUNING.hollowHuntSpeed * (1 + TUNING.hollowAngerSpeedBonus * hollow.anger);
    const reachedLastKnown = distanceBetweenPoints(figure.x, figure.z, hollow.targetX, hollow.targetZ) < 1.2;
    if (hollow.timeSinceSensed > TUNING.hollowMemorySeconds && (reachedLastKnown || hollow.timeSinceSensed > TUNING.hollowMemorySeconds + 7)) {
      hollow.state = HOLLOW_STATE_SEARCH;
      hollow.searchTimer = TUNING.hollowSearchSeconds;
      chooseHollowSearchCenter();
      showCaption('hollowLost', figure);
      playHollowLostHiss();
      hollow.voiceTimer = randomBetween(2.5, 4);
    }
  } else if (hollow.state === HOLLOW_STATE_INVESTIGATE) {
    speed = TUNING.hollowInvestigateSpeed;
    if (distanceBetweenPoints(figure.x, figure.z, hollow.targetX, hollow.targetZ) < 1.4) {
      hollow.state = HOLLOW_STATE_SEARCH;
      hollow.searchTimer = TUNING.hollowSearchSeconds * 0.75;
      hollow.searchCenterX = figure.x; hollow.searchCenterZ = figure.z;
      hollow.searchRetargetTimer = 0;
    }
  } else if (hollow.state === HOLLOW_STATE_SEARCH) {
    speed = TUNING.hollowRoamSpeed * 1.25;
    hollow.searchTimer -= dt;
    hollow.searchRetargetTimer -= dt;
    if (hollow.searchRetargetTimer <= 0) {
      hollow.searchRetargetTimer = randomBetween(1.5, 3);
      for (let attempt = 0; attempt < 8; attempt++) {
        const candidateX = hollow.searchCenterX + randomBetween(-5, 5), candidateZ = hollow.searchCenterZ + randomBetween(-5, 5);
        if (isWalkableAt(Math.floor(candidateX), Math.floor(candidateZ)) && getZoneAtPosition(candidateX, candidateZ) !== level.storeZone) {
          hollow.targetX = candidateX; hollow.targetZ = candidateZ;
          break;
        }
      }
    }
    if (hollow.searchTimer <= 0) {
      hollow.state = HOLLOW_STATE_ROAM;
      chooseHollowRoamTarget();
      // Sometimes it only pretends to give up: it walks off, then comes straight back to the same spot.
      if (!director.hasPeaked && Math.random() < TUNING.hollowDoubleBackChance) {
        hollow.doubleBackTimer = randomBetween(6, 11);
        hollow.doubleBackX = hollow.searchCenterX; hollow.doubleBackZ = hollow.searchCenterZ;
      }
    }
  } else if (hollow.state === HOLLOW_STATE_LISTEN) {
    // Standing still. Nothing to hear from it but the clicking, and it hears you better than usual.
    speed = 0;
    hollow.listenTimer -= dt;
    if (hollow.listenTimer <= 0) hollow.state = HOLLOW_STATE_ROAM;
  } else {
    // Somewhere new once it has arrived, or if where it was sent turns out to be behind a door it cannot pass.
    if (distanceBetweenPoints(figure.x, figure.z, hollow.targetX, hollow.targetZ) < 1.5 || hollow.isTargetOutOfReach) chooseHollowRoamTarget();
    if (hollow.doubleBackTimer > 0) {
      hollow.doubleBackTimer -= dt;
      if (hollow.doubleBackTimer <= 0) {
        hollow.state = HOLLOW_STATE_INVESTIGATE;
        hollow.targetX = hollow.doubleBackX; hollow.targetZ = hollow.doubleBackZ;
      }
    }
    // Every so often, when you are not far away, it stops dead and listens.
    hollow.nextListenIn -= dt;
    if (hollow.nextListenIn <= 0 && hollow.state === HOLLOW_STATE_ROAM) {
      hollow.nextListenIn = randomBetween(TUNING.hollowListenEverySecondsMinimum, TUNING.hollowListenEverySecondsMaximum);
      if (distanceToPlayer < TUNING.hollowListenWithinMetres) {
        hollow.state = HOLLOW_STATE_LISTEN;
        hollow.listenTimer = randomBetween(TUNING.hollowListenSecondsMinimum, TUNING.hollowListenSecondsMaximum);
        hollow.hasHeardNoise = false;
      }
    }
  }

  speed *= game.difficulty.hollowSpeedFactor * (getWorkOrderProgressShare() >= 1 ? TUNING.hollowSpeedBonusWithAllSpools : 1);
  const isHollowInVent = (getTileFlagsAtPosition(figure.x, figure.z) & TILE_FLAG_VENT) !== 0;
  if (isHollowInVent) speed *= TUNING.hollowVentSpeedFactor;
  if (hollow.enragedTimer > 0) speed = TUNING.hollowEnragedSpeed * game.difficulty.hollowSpeedFactor;
  else speed *= interpolateLinear(1, TUNING.hollowHeldSpeedFactor, hollow.heldAmount);
  // Stunned (by a scan grenade going off in its face): it does not move at all until that has worn off.
  if (hollow.stunSeconds > 0) {
    hollow.stunSeconds -= dt;
    if (hollow.enragedTimer > 0) hollow.stunSeconds = 0; else speed = 0;
  }
  // It has just struck somebody and they are still on their feet: it stands where it struck, enraged or not.
  // That is their chance to get away (09-health.js).
  if (hollow.recoverSeconds > 0) { hollow.recoverSeconds -= dt; speed = 0; }

  const movedDistance = speed > 0 ? moveCreatureToward(hollow, hollow.targetX, hollow.targetZ, speed, dt) : 0;
  hollow.currentSpeed = movedDistance / Math.max(dt, 0.0001);

  // ---- pose ----
  const isHunting = hollow.state === HOLLOW_STATE_HUNT;
  const isListening = hollow.state === HOLLOW_STATE_LISTEN;
  hollow.walkPhase += movedDistance * 2.3;
  poseHollow(hollow, isHunting, isListening, dt);
  if (hollow.heldAmount > 0.3) {
    // Held in the beam it turns its whole body toward the emitter.
    const towardPlayer = Math.atan2(beamSourceX - figure.x, -(beamSourceZ - figure.z));
    figure.yaw += clampNumber(wrapAngleToPi(towardPlayer - figure.yaw), -dt * 6, dt * 6);
  } else if (isListening && hollow.hasHeardNoise) {
    // While listening it slowly turns to face the last thing it heard, however faint.
    const towardNoise = Math.atan2(hollow.lastNoiseX - figure.x, -(hollow.lastNoiseZ - figure.z));
    figure.yaw += clampNumber(wrapAngleToPi(towardNoise - figure.yaw), -dt * 1.2, dt * 1.2);
  }
  updateFigureCapsules(figure);

  updateHollowOnNoisyFloor(figure.x, figure.z, isHunting); // it gives itself away on glass and loose plates as you would
  const stepSign = Math.sin(hollow.walkPhase) >= 0 ? 1 : -1;
  if (stepSign !== hollow.lastStepSign) {
    hollow.lastStepSign = stepSign;
    if (isHollowInVent) playHollowVentStep(figure.x, figure.z, isHunting ? 1 : 0.8);
    else playHollowFootstep(figure.x, figure.z, isHunting ? 1 : 0.7);
    showCaption(isHollowInVent ? 'hollowVentSteps' : (isHunting ? 'hollowStepsHunting' : 'hollowSteps'), figure);
    stepHollowOnNoisyFloor(figure.x, figure.z, isHunting); // glass and loose plates give it away as they would you
  }

  if (distanceToPlayer < TUNING.hollowKillDistance && hollow.graceTimer <= 0 && hollow.recoverSeconds <= 0) {
    // Everyone within its reach, not only the nearest: two who stand together are caught together.
    for (const one of players.slice()) {
      if (distanceBetweenPoints(figure.x, figure.z, one.x, one.z) < TUNING.hollowKillDistance) catchPlayer(one, 'hollow', figure);
    }
  }
}

// Sets the Hollow's pose from what it is doing. `creature` is the Hollow, or a stand-in with the same fields
// (figure, walkPhase, currentSpeed, armRaise, heldAmount): that is how the workshop shows these same poses.
function poseHollow(creature, isHunting, isListening, dt) {
  const figure = creature.figure;
  const stride = Math.min(1, creature.currentSpeed / 1.4);
  const pose = figure.pose;
  pose.legSwing = Math.sin(creature.walkPhase) * 0.55 * stride;
  pose.armSwing = Math.sin(creature.walkPhase) * 0.22 * stride;
  pose.kneeBend = 0.16;
  creature.armRaise = approachValue(creature.armRaise, isHunting ? 1.0 : 0.06, dt * 1.4);
  pose.armRaise = creature.armRaise;
  pose.elbowBend = 0.15 + creature.armRaise * 0.25;
  pose.lean = (isListening ? 0.0 : 0.06) + creature.armRaise * 0.25;
  // Listening, it draws itself up to its full height (as far as the ceiling allows) and spreads its fingers.
  // Hunting, it reaches. Otherwise it goes hunched, hands hanging by its knees.
  // It fits itself to the lowest ceiling over it and just ahead of it, so it starts to duck before a doorway
  // and not halfway through it. If it is too tall for the room even hunched, it stoops.
  const headroom = Math.min(getHeadroomAt(figure.x, figure.z),
    getHeadroomAt(figure.x + Math.sin(figure.yaw) * 0.9, figure.z - Math.cos(figure.yaw) * 0.9));
  const wantedStretch = isListening ? 1 : (isHunting ? 0.3 : 0);
  // Drawn up to listen, it stops only just short of the ceiling. Otherwise it keeps its usual gap.
  const fit = fitHollowUnderCeiling(figure, headroom, wantedStretch, isListening ? Math.min(0.05, TUNING.hollowCeilingGap) : TUNING.hollowCeilingGap);
  // TWEAK: it ducks quickly (3 and 4) and unfolds slowly (0.7 and 1.2). Units are "whole range per second".
  pose.stretch = approachValue(pose.stretch, fit.stretch, dt * (fit.stretch < pose.stretch ? 3 : 0.7));
  // On top of what the ceiling demands it is always a little bent, except while it is drawing itself up.
  const wantedStoop = fit.crawl > 0 ? 0 : Math.max(fit.stoop, TUNING.hollowBaseStoop * (1 - fit.stretch));
  pose.stoop = approachValue(pose.stoop, wantedStoop, dt * (wantedStoop > pose.stoop ? 4 : 1.2));
  // Into a vent it drops to knees and hands quickly, and gets up again more slowly.
  pose.crawl = approachValue(pose.crawl, fit.crawl, dt * (fit.crawl > pose.crawl ? 5 : 2));
  pose.fingerSplay = approachValue(pose.fingerSplay, (isHunting || creature.heldAmount > 0.3) ? 1 : (isListening ? 0.75 : 0.2), dt * 2.5);
  pose.headTilt = 0.28 + Math.sin(game.time * (isListening ? 0.35 : 0.8)) * (isListening ? 0.45 : 0.2) +
    (creature.heldAmount > 0.3 ? (Math.random() - 0.5) * 0.9 : 0);
}

function getHollowAggression() {
  if (!hollow.isActive) return 0;
  if (hollow.enragedTimer > 0) return 1;
  if (hollow.state === HOLLOW_STATE_HUNT) return 0.8;
  if (hollow.state === HOLLOW_STATE_INVESTIGATE || hollow.state === HOLLOW_STATE_SEARCH) return 0.35;
  if (hollow.state === HOLLOW_STATE_LISTEN) return 0.2;
  return 0.1;
}

// ---------------------------------------------------------------------------
// The kind, for the game to run (CREATURE_KINDS, 08-creatures.js)
// ---------------------------------------------------------------------------

addCreatureKind({
  key: 'hollow',
  update: updateHollow,
  holdStill: function () { hollow.figure.hitsThisFrame = 0; }, // what the beam put on it meanwhile is not counted up for later
  reset: function () { deactivateHollow(); hollow.knowsPlayerPositionAlways = false; dressHollow(); },
  hear: hearNoiseAsHollow,
  // Above the ceilings it is at no door.
  walkers: function (into) { if (hollow.isActive && !isHollowInCrawlspace()) into.push(hollow); }
});
