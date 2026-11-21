// ---------------------------------------------------------------------------
// Things that move: doors, the calibration dummies ("Stills")
// (The Hollow is in 08-hollow.js, the looters in 08-looter.js, the Surveyor in 08-surveyor.js. The apparitions
// that only ever exist as points are in 08-phantoms.js.)
// ---------------------------------------------------------------------------

const playerDistanceField = new Int16Array(TILE_COUNT);
let playerDistanceFieldAge = 99;

const stills = [];
let stillsAreHunting = false;
const stillDistanceField = new Int16Array(TILE_COUNT);
let stillDistanceFieldAge = 99;


// ---------------------------------------------------------------------------
// Everyone in the station (`players`, 09-player.js): who is nearest, and the tiles they stand on
// ---------------------------------------------------------------------------

// Whoever of `among` (everyone, if left out) is nearest to a place in a straight line. `among` is never empty.
function findNearestPlayer(x, z, among) {
  among = among || players;
  let nearest = among[0], nearestDistance = Infinity;
  for (const one of among) {
    const distance = distanceBetweenPoints(x, z, one.x, one.z);
    if (distance < nearestDistance) { nearestDistance = distance; nearest = one; }
  }
  return nearest;
}

// The tile under each of them, for a distance field that is to be measured from whoever is nearest.
function findPlayerTileIndexes(among) {
  return among.map(function (one) { return findNearestWalkableTileIndex(one.x, one.z); });
}

// Walking distance to the nearest of `players`, from everywhere.
function refreshPlayerDistanceField() {
  computeDistanceField(playerDistanceField, findPlayerTileIndexes(players), 0, null);
  playerDistanceFieldAge = 0;
}

// ---------------------------------------------------------------------------
// Doors
// ---------------------------------------------------------------------------

function canPlayerOpenDoor(door) {
  if (door.kind === DOOR_KIND_AUTOMATIC) return true;
  if (door.kind === DOOR_KIND_POWERED) return game.flags.powerOn;
  if (door.kind === DOOR_KIND_KEYCARD) return game.flags.powerOn && game.flags.keycardLevel >= (door.cardLevel || 1);
  return false;
}

// A door somewhere else opening or closing is worth a caption: nothing but you and what hunts you opens doors.
// The one you are standing at is your own doing and gets none.
function captionDoorSound(door, isOpening) {
  if (distanceBetweenPoints(door.centerX, door.centerZ, player.x, player.z) < TUNING.captionOwnDoorMetres) return;
  showCaption(isOpening ? 'doorOpens' : 'doorCloses', { x: door.centerX, z: door.centerZ });
}

// You are standing at a door that will not open for you: it says so, and why, every few seconds.
// Is somebody standing at this door on its inner side, where a keycard door has a release that needs no card
// and no mains (TUNING.keycardDoorsOpenFromInside: a temporary rule, see 00-config.js)? `one` is whoever is asked about.
// Only the doors of a generated station know which side is their inside (buildGeneratedStation, 03-levelgen.js).
function isAtInsideOfKeycardDoor(door, one) {
  if (!TUNING.keycardDoorsOpenFromInside || door.kind !== DOOR_KIND_KEYCARD || door.insideStepX === undefined) return false;
  if (distanceBetweenPoints(one.x, one.z, door.centerX, door.centerZ) >= 1.9) return false;
  return (one.x - door.centerX) * door.insideStepX + (one.z - door.centerZ) * door.insideStepZ > 0.3;
}

function tellPlayerOfShutDoor(door, dt) {
  door.deniedMessageCooldown -= dt;
  if (door.deniedMessageCooldown > 0 || canPlayerOpenDoor(door) || isAtInsideOfKeycardDoor(door, player)) return;
  if (distanceBetweenPoints(player.x, player.z, door.centerX, door.centerZ) >= 1.9) return;
  door.deniedMessageCooldown = 5;
  playDeniedSound();
  if (door.kind === DOOR_KIND_KEYCARD && game.flags.powerOn) {
    showMessage(level.keycardCount > 1 ? 'Door locked. Keycard ' + door.cardLevel + ' required.' : 'Door locked. Keycard required.', 3.5, 'warning');
  }
  else showMessage('Door has no power.', 3.5, 'warning');
}

function updateDoors(dt) {
  const walkers = findCreatureWalkers(); // every creature that is on its feet in the station (08-creatures.js)
  for (const door of doors) {
    door.bangCooldown = Math.max(0, door.bangCooldown - dt);
    if (door.isBroken) continue; // broken down: it stays as it fell
    let wantsOpen = false;
    let openedByPlayer = false;
    if (door.kind === DOOR_KIND_BAY) {
      wantsOpen = isHaulBayDoorWantedOpen(door); // a salvage bay's door: open while the bay is being filled, and at no other time
    } else if (door.forcedState !== null) {
      wantsOpen = door.forcedState;
    } else {
      // TWEAK: doors notice you from 1.9 m away. They open for whoever is there; being told that one will not
      // open is for you alone, when it is you standing at it.
      const nearestPlayer = findNearestPlayer(door.centerX, door.centerZ);
      const isSomeoneNear = distanceBetweenPoints(nearestPlayer.x, nearestPlayer.z, door.centerX, door.centerZ) < 1.9;
      if (isSomeoneNear && canPlayerOpenDoor(door)) { wantsOpen = true; openedByPlayer = true; }
      // (Or one of them stands at its inner side, where a keycard door needs no card.)
      else if (door.kind === DOOR_KIND_KEYCARD && players.some(function (one) { return isAtInsideOfKeycardDoor(door, one); })) { wantsOpen = true; openedByPlayer = true; }
      tellPlayerOfShutDoor(door, dt);
      // What walks down there: a door opens for one of them only if its way of getting around says so (for the
      // Hollow, not a keycard door: see 08-crawlspace.js). A door that is already open for someone else never
      // closes on one.
      for (const walker of walkers) {
        const walkerDistance = distanceBetweenPoints(walker.figure.x, walker.figure.z, door.centerX, door.centerZ);
        if (walkerDistance < 1.8 && walker.way.canOpenDoor(door)) wantsOpen = true;
        else if (walkerDistance < 1.0 && door.openFraction > 0) wantsOpen = true;
      }
      if (stillsAreHunting && !wantsOpen) {
        for (const still of stills) {
          if (still.isPresent && distanceBetweenPoints(still.figure.x, still.figure.z, door.centerX, door.centerZ) < 1.5) { wantsOpen = true; break; }
        }
      }
    }
    // Something loose lying in the doorway: the door will not come down on it. It waits, open, for as long as
    // the thing is there. (Which wedges it open for the Hollow as much as for you.) The lift's own door, and
    // any door that is being told what to do, does as it is told.
    if (!wantsOpen && door.forcedState === null && door.openFraction > 0 && isLooseObjectInDoorway(door)) wantsOpen = true;
    moveDoor(door, wantsOpen, openedByPlayer, 1.3, dt);
  }
  refreshCreatureDoorBlocks();
}

// One frame of a door going where it is wanted: up while `wantsOpen`, and down again `holdSeconds` after it
// stops being wanted open. updateDoors decides what is wanted; down there with others the host's game decides,
// and everyone else's doors only follow (11-together.js), which is why the two are apart.
function moveDoor(door, wantsOpen, openedByPlayer, holdSeconds, dt) {
  if (wantsOpen) {
    door.closeDelay = holdSeconds;
    if (door.openFraction === 0) {
      wakeLooseObjectsNear(door.centerX, door.centerZ, 1.3); // what leans on the door is about to lose its support
      const slab = door.slab;
      fadePointsInsideBox(door.centerX - slab.halfX - 0.1, door.baseY, door.centerZ - slab.halfZ - 0.1,
        door.centerX + slab.halfX + 0.1, door.baseY + 2.5, door.centerZ + slab.halfZ + 0.1,
        convertSecondsToPointLifeCode(TUNING.doorImprintSeconds));
      playDoorSound(door.centerX, door.centerZ, true);
      captionDoorSound(door, true);
      if (openedByPlayer) emitNoise(door.centerX, door.centerZ, TUNING.noiseRadiusDoor);
    }
  } else {
    door.closeDelay -= dt;
  }
  const target = wantsOpen || door.closeDelay > 0 ? 1 : 0;
  door.isWantedOpen = target === 1; // what the host of others tells them (describeWorld, 11-together.js)
  const previousFraction = door.openFraction;
  door.openFraction = approachValue(door.openFraction, target, dt * 1.7); // TWEAK: 1.7 = a door takes about 0.6 s to open
  if (previousFraction === 1 && door.openFraction < 1) { playDoorSound(door.centerX, door.centerZ, false); captionDoorSound(door, false); }
  const slab = door.slab;
  slab.centerY = door.baseY + 1.15 + door.openFraction * DOOR_TRAVEL_HEIGHT;
  slab.minimumY = slab.centerY - slab.halfY;
  slab.maximumY = slab.centerY + slab.halfY;
  slab.isRemoved = door.openFraction > 0.97;
}

// ---------------------------------------------------------------------------
// The Stills: calibration dummies that only move while nothing is scanning them
// ---------------------------------------------------------------------------

function createStills() {
  stills.length = 0;
  const poseRandom = createSeededRandomGenerator(4471);
  const addStill = function (point, isLateArrival) {
    const figure = createFigureOfKind('dummy');
    figure.x = point[0]; figure.z = point[1];
    figure.yaw = poseRandom() * TWO_PI;
    figure.pose.armRaise = poseRandom() < 0.3 ? 0.5 + poseRandom() * 0.9 : 0.04;
    figure.pose.headTilt = (poseRandom() - 0.5) * 0.3;
    figure.pose.elbowBend = 0.05 + poseRandom() * 0.2;
    updateFigureCapsules(figure);
    const still = {
      figure: figure,
      homeX: point[0], homeZ: point[1], homeYaw: figure.yaw, homeArmRaise: figure.pose.armRaise,
      isPresent: !isLateArrival,
      isLateArrival: isLateArrival,
      wakeDelay: 0,
      restSeconds: 0,      // it has just struck somebody: it does not move or strike again until this has run out
      restlessCooldown: 3 + poseRandom() * 6,
      distanceMovedSinceSound: 0
    };
    stills.push(still);
    if (still.isPresent) setFigureRaycastable(figure, true);
  };
  for (const point of stillSpawnPoints) addStill(point, false);
  for (const point of lateStillSpawnPoints) addStill(point, true);
  stillsAreHunting = false;
}

function resetStillsToHomePositions() {
  if (isWorldTheHosts()) return;
  for (const still of stills) {
    still.figure.x = still.homeX; still.figure.z = still.homeZ;
    still.figure.yaw = still.homeYaw;
    still.figure.pose.armRaise = still.homeArmRaise;
    still.figure.pose.legSwing = 0;
    still.figure.lastScannedTime = game.time;
    still.wakeDelay = 2 + Math.random() * 5;
    updateFigureCapsules(still.figure);
  }
}

function awakenStills() {
  if (!game.difficulty.stillsEnabled || isWorldTheHosts()) return;
  stillsAreHunting = true;
  for (const still of stills) {
    if (still.isLateArrival && !still.isPresent) {
      still.isPresent = true;
      const nearestPlayer = findNearestPlayer(still.figure.x, still.figure.z);
      still.figure.yaw = Math.atan2(nearestPlayer.x - still.figure.x, -(nearestPlayer.z - still.figure.z));
      still.figure.lastScannedTime = -999;
      updateFigureCapsules(still.figure);
      setFigureRaycastable(still.figure, true);
      still.wakeDelay = 5;
    } else {
      // TWEAK: each dummy waits between 2.5 and 8.5 seconds before it first moves, so they do not all start at once.
      still.wakeDelay = 2.5 + Math.random() * 6;
    }
  }
}

function isPositionCrowdedByOtherStill(still, x, z) {
  for (const other of stills) {
    if (other === still || !other.isPresent) continue;
    if (distanceBetweenPoints(x, z, other.figure.x, other.figure.z) < 0.6) return true;
  }
  return false;
}

function updateStills(dt) {
  if (!game.difficulty.stillsEnabled) return;
  // They only stir for those who are in the rooms they keep to. Each goes for whoever of those is nearest to it.
  let isPlayerInStore = false;
  const playersInReach = [];
  for (const one of players) {
    const zone = getZoneAtPosition(one.x, one.z);
    if (zone === level.storeZone) isPlayerInStore = true;
    if (level.stillZones.indexOf(zone) >= 0) playersInReach.push(one);
  }
  if (playersInReach.length === 0 || debugState.options.creaturesIgnorePlayer) return;
  stillDistanceFieldAge += dt;
  if (stillsAreHunting && stillDistanceFieldAge > 0.3) {
    computeDistanceField(stillDistanceField, findPlayerTileIndexes(playersInReach), 0, level.stillZones);
    stillDistanceFieldAge = 0;
  }
  for (const still of stills) {
    if (!still.isPresent) continue;
    const figure = still.figure;
    const isObserved = game.time - figure.lastScannedTime < TUNING.stillObservedHoldSeconds;
    const quarry = findNearestPlayer(figure.x, figure.z, playersInReach);
    const distanceToPlayer = distanceBetweenPoints(figure.x, figure.z, quarry.x, quarry.z);

    if (!stillsAreHunting) {
      // Not hostile yet. They just never stand quite where you left them.
      still.restlessCooldown -= dt;
      if (!isPlayerInStore || isObserved || still.restlessCooldown > 0 || game.time - figure.lastScannedTime < 3.5) continue;
      still.restlessCooldown = randomBetween(4, 10); // TWEAK: seconds between a dormant dummy's small shifts
      figure.yaw = Math.atan2(quarry.x - figure.x, -(quarry.z - figure.z));
      if (Math.random() < 0.4 && distanceToPlayer > 4.2) {
        const shift = randomBetween(0.4, 0.9);
        const newX = figure.x + (quarry.x - figure.x) / distanceToPlayer * shift;
        const newZ = figure.z + (quarry.z - figure.z) / distanceToPlayer * shift;
        if (isWalkableAt(Math.floor(newX), Math.floor(newZ)) && !isPositionCrowdedByOtherStill(still, newX, newZ) &&
            getZoneAtPosition(newX, newZ) === level.storeZone) {
          figure.x = newX; figure.z = newZ;
        }
      }
      updateFigureCapsules(figure);
      continue;
    }

    if (still.restSeconds > 0) { still.restSeconds -= dt; continue; } // it has just struck somebody
    if (distanceToPlayer < TUNING.stillKillDistance) {
      catchPlayer(quarry, 'still', figure);
      if (quarry === player && game.mode !== 'playing') return; // your death: nothing moves on
      continue;                      // a hit, or somebody else's: the others keep coming
    }
    if (still.wakeDelay > 0) { still.wakeDelay -= dt; continue; }
    if (isObserved) continue;

    // Unobserved: walk toward the player along the flood-filled distance field.
    let goalX = quarry.x, goalZ = quarry.z;
    if (!(distanceToPlayer < 6 && hasClearWalkingLine(figure.x, figure.z, quarry.x, quarry.z))) {
      const tileX = Math.floor(figure.x), tileZ = Math.floor(figure.z);
      let bestValue = NAVIGATION_UNREACHABLE, bestX = -1, bestZ = -1;
      for (let offsetZ = -1; offsetZ <= 1; offsetZ++) {
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          const nearX = tileX + offsetX, nearZ = tileZ + offsetZ;
          if (!isInsideGrid(nearX, nearZ)) continue;
          if (offsetX !== 0 && offsetZ !== 0 && (!isWalkableAt(tileX + offsetX, tileZ) || !isWalkableAt(tileX, tileZ + offsetZ))) continue;
          const value = stillDistanceField[tileIndexAt(nearX, nearZ)];
          if (value < bestValue) { bestValue = value; bestX = nearX; bestZ = nearZ; }
        }
      }
      if (bestX < 0) continue;
      goalX = bestX + 0.5; goalZ = bestZ + 0.5;
    }
    const deltaX = goalX - figure.x, deltaZ = goalZ - figure.z;
    const goalDistance = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
    if (goalDistance < 0.02) continue;
    const step = Math.min(goalDistance, TUNING.stillSpeed * dt);
    const newX = figure.x + deltaX / goalDistance * step, newZ = figure.z + deltaZ / goalDistance * step;
    if (isPositionCrowdedByOtherStill(still, newX, newZ)) continue;
    figure.x = newX; figure.z = newZ;
    figure.yaw = Math.atan2(quarry.x - figure.x, -(quarry.z - figure.z));
    poseAdvancingStill(figure, distanceToPlayer);
    updateFigureCapsules(figure);
    still.distanceMovedSinceSound += step;
    if (still.distanceMovedSinceSound > 0.7) {
      still.distanceMovedSinceSound = 0;
      playStillShuffleSound(figure.x, figure.z);
      showCaption('stillShifts', figure);
    }
  }
}

// The pose of a dummy that is walking at you: its arms come up as it closes in, and its legs are wherever
// its position puts them, so every glimpse catches it mid-step. The workshop shows the same pose.
function poseAdvancingStill(figure, distanceToPlayer) {
  figure.pose.armRaise = Math.max(figure.pose.armRaise, clampNumber(1.5 - distanceToPlayer * 0.22, 0, 1.35));
  figure.pose.legSwing = Math.sin((figure.x + figure.z) * 5) * 0.3;
}

// (From where you stand, or from the place given: where the one you are watching stands, 11-watching.js.)
function getNearestHuntingStillDistance(x, z) {
  if (!stillsAreHunting) return Infinity;
  if (x === undefined) { x = player.x; z = player.z; }
  let nearest = Infinity;
  for (const still of stills) {
    if (!still.isPresent) continue;
    nearest = Math.min(nearest, distanceBetweenPoints(still.figure.x, still.figure.z, x, z));
  }
  return nearest;
}

// ---------------------------------------------------------------------------
// The kind, for the game to run (CREATURE_KINDS, 08-creatures.js)
// ---------------------------------------------------------------------------

// (The Stills hear nothing, and a door opens for them by a rule of their own: see updateDoors.)
addCreatureKind({ key: 'stills', update: updateStills, reset: createStills });
