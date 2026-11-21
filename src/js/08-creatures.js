// ---------------------------------------------------------------------------
// What the creatures have in common.
//
// Every creature is its own piece of code: what it wants, what it does about a noise, how it holds itself, what
// happens when it reaches you. The Hollow and the Stills are in 08-entities.js, and there is no general
// "behaviour" that they are settings of: two creatures that want different things have little of that to share.
//
// What they do share is here, so that the next one does not have to bring it:
//
//   - A way of getting around (createCreatureWay). The station is the same for all of them, but not all of it
//     is open to each: one is small enough to walk through a vent and cannot reach a ceiling hatch, another the
//     other way about, and a door opens for some and not for others. A way says which, keeps count of the doors
//     that are shut to it at this moment, and works out the walk to anywhere by those rules
//     (computeWayDistanceField). moveCreatureToward then takes a creature one frame along it.
//
//   - Hearing (hearNoise). Anything loud that happens in the station is told to every kind of creature, and
//     each makes of it what it will: one comes to look, another runs.
//
//   - The list of kinds (CREATURE_KINDS). The game does not name its creatures when it runs them: every frame it
//     updates whatever is in this list, a new descent resets whatever is in it, and a door opens for whatever
//     of it stands in front of one. To add a creature, write its file and add its entry (addCreatureKind).
//
// What is not here: a creature's body is a kind of figure (04-figures.js, and the workshop's creature tool),
// when it comes into the station is 08-arrivals.js, and the ceiling hatches are 08-crawlspace.js.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Ways of getting around
// ---------------------------------------------------------------------------

// Every way there is, so that all of them can be told when a door opens or closes.
const CREATURE_WAYS = [];

// A way of getting around the station. `rules`:
//   key              its name, for debug mode and the tests
//   canOpenDoor      function (door): does this door open for it when it walks up to it?
//   fitsVents        can it go through a vent (crawl height: VENT_HEIGHT)? Left out: yes.
//   usesHatches      can it climb into a ceiling hatch and come out of another (08-crawlspace.js)? Left out: no.
//                    A creature with such a way has a `climbIntoHatch` (see moveCreatureToward).
//   keepsOutOfStore  does it stay out of the calibration store, which is the Stills'? Left out: yes.
// What it keeps:
//   tileBlocks       1 for the tile of every door that is shut to it at this moment
//   version          goes up by one whenever a door opens or closes to it, so that whoever goes by it knows to
//                    work out their way again
function createCreatureWay(rules) {
  const way = {
    key: rules.key,
    canOpenDoor: rules.canOpenDoor,
    fitsVents: rules.fitsVents !== false,
    usesHatches: rules.usesHatches === true,
    keepsOutOfStore: rules.keepsOutOfStore !== false,
    tileBlocks: new Uint8Array(TILE_COUNT),
    version: 0,
    isTileWalkable: null, isTileOpenGround: null
  };
  // A tile it can walk on right now: walkable, not the tile of a door that is shut to it, and not a vent if it
  // does not fit one.
  way.isTileWalkable = function (tileX, tileZ) {
    if (!isWalkableAt(tileX, tileZ)) return false;
    const index = tileIndexAt(tileX, tileZ);
    return way.tileBlocks[index] !== 1 && (way.fitsVents || (tileFlags[index] & TILE_FLAG_VENT) === 0);
  };
  // A tile that is neither wall nor a door shut to it. There may be furniture on it.
  way.isTileOpenGround = function (tileX, tileZ) {
    if (!isInsideGrid(tileX, tileZ)) return false;
    const index = tileIndexAt(tileX, tileZ);
    return tileIsOpen[index] === 1 && way.tileBlocks[index] !== 1;
  };
  CREATURE_WAYS.push(way);
  return way;
}

// True if something going this way can get through this door right now: it opens for it, or it is standing
// open anyway.
function isDoorPassableToWay(way, door) {
  return way.canOpenDoor(door) || door.openFraction > 0.6;
}

// Brings every way's `tileBlocks` up to date with the doors. Called every frame after the doors have moved; cheap.
function refreshCreatureDoorBlocks() {
  for (const way of CREATURE_WAYS) {
    let hasChanged = false;
    for (const door of doors) {
      const index = tileIndexAt(door.tileX, door.tileZ);
      const isBlocked = isDoorPassableToWay(way, door) ? 0 : 1;
      if (way.tileBlocks[index] !== isBlocked) { way.tileBlocks[index] = isBlocked; hasChanged = true; }
    }
    if (hasChanged) way.version++;
  }
}

// A new station: no door is shut to anything yet, and every way that was worked out is for a station that is gone.
function clearCreatureDoorBlocks() {
  for (const way of CREATURE_WAYS) { way.tileBlocks.fill(0); way.version++; }
}

// True when a straight walk between two points stays on tiles this way can walk on.
function hasClearWalkingLineForWay(way, fromX, fromZ, toX, toZ) {
  return isLineClearOfTiles(fromX, fromZ, toX, toZ, way.isTileWalkable, false);
}

// True when a straight line from where something stands to a point crosses no wall and no door that is shut to
// its way. It is for getting a creature back onto walkable floor when it has ended up standing where it cannot
// path from, so unlike the function above it does not mind furniture, and it does not mind what the creature is
// standing in either: a doorway that has shut on it, or a wall, is exactly what it has to be let out of.
function isOpenGroundBetweenForWay(way, fromX, fromZ, toX, toZ) {
  return isLineClearOfTiles(fromX, fromZ, toX, toZ, way.isTileOpenGround, true);
}

// ---------------------------------------------------------------------------
// Path finding: walking, plus the crawlspace for a way that uses the hatches
// ---------------------------------------------------------------------------

// What a crawl between two hatches costs, in steps of walking. See hollowCrawlFixedSteps in 00-config.js.
function getHatchCrawlSteps(firstHatch, secondHatch) {
  return Math.round(TUNING.hollowCrawlFixedSteps +
    distanceBetweenPoints(firstHatch.x, firstHatch.z, secondHatch.x, secondHatch.z) * TUNING.hollowCrawlStepsPerMetre);
}

// Spreads walking distance outward from one tile that already has its distance in `field`, lowering any tile
// it can reach more cheaply. By the way's rules: not through a door shut to it, not through a vent it does not
// fit, not into the calibration store if it keeps out of that.
function spreadWayDistance(way, field, startIndex) {
  const tileBlocks = way.tileBlocks, fitsVents = way.fitsVents;
  const storeZone = way.keepsOutOfStore ? level.storeZone : 0;
  let queueHead = 0, queueTail = 0;
  navigationQueue[queueTail++] = startIndex;
  while (queueHead < queueTail) {
    const index = navigationQueue[queueHead++];
    const nextDistance = field[index] + 1;
    const tileX = index % GRID_WIDTH, tileZ = (index - tileX) / GRID_WIDTH;
    for (let direction = 0; direction < 4; direction++) {
      const neighbourX = tileX + (direction === 0 ? 1 : direction === 1 ? -1 : 0);
      const neighbourZ = tileZ + (direction === 2 ? 1 : direction === 3 ? -1 : 0);
      if (!isInsideGrid(neighbourX, neighbourZ)) continue;
      const neighbourIndex = neighbourZ * GRID_WIDTH + neighbourX;
      if (tileIsWalkable[neighbourIndex] === 0 || field[neighbourIndex] <= nextDistance) continue;
      if (tileBlocks[neighbourIndex] === 1) continue;
      if (!fitsVents && (tileFlags[neighbourIndex] & TILE_FLAG_VENT) !== 0) continue;
      if (Math.abs(tileFloorHeight[neighbourIndex] - tileFloorHeight[index]) > MAXIMUM_STEP_HEIGHT) continue;
      if (storeZone && tileZone[neighbourIndex] === storeZone) continue;
      field[neighbourIndex] = nextDistance;
      navigationQueue[queueTail++] = neighbourIndex;
    }
  }
}

// How far something going this way has to go from every tile to reach the target tile, in steps: on foot where
// it can, and (for a way that uses the hatches) through the crawlspace where that is cheaper or the only way.
// `useCrawlspace` false leaves the crawlspace out whatever the way (used to check that the locks really do stop it).
function computeWayDistanceField(way, field, targetIndex, useCrawlspace) {
  field.fill(NAVIGATION_UNREACHABLE);
  if (targetIndex < 0) return;
  field[targetIndex] = 0;
  spreadWayDistance(way, field, targetIndex);
  if (useCrawlspace === false || !way.usesHatches) return;
  // A hatch can also be reached from any other hatch, at the price of the crawl. Each time that turns out
  // cheaper than what a hatch had, the saving is spread outward from it on foot. Repeated until nothing improves.
  for (let pass = 0; pass <= hollowHatches.length; pass++) {
    let hasImproved = false;
    for (const hatch of hollowHatches) {
      let best = field[hatch.index];
      for (const other of hollowHatches) {
        if (other === hatch || field[other.index] >= NAVIGATION_UNREACHABLE) continue;
        best = Math.min(best, field[other.index] + getHatchCrawlSteps(hatch, other));
      }
      if (best < field[hatch.index]) {
        field[hatch.index] = best;
        spreadWayDistance(way, field, hatch.index);
        hasImproved = true;
      }
    }
    if (!hasImproved) break;
  }
}

function findHatchAtTile(tileIndex) {
  for (const hatch of hollowHatches) if (hatch.index === tileIndex) return hatch;
  return null;
}

// Standing on a hatch tile: if the shortest way on from here is up through the hatch, returns the hatch to
// crawl to. Otherwise (walking on is as good or better) returns null. `field` is the distance field of whoever asks.
function findCrawlFromHatch(hatch, field) {
  const tileX = hatch.index % GRID_WIDTH, tileZ = (hatch.index - tileX) / GRID_WIDTH;
  let bestOnFoot = NAVIGATION_UNREACHABLE;
  for (const step of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (isInsideGrid(tileX + step[0], tileZ + step[1])) bestOnFoot = Math.min(bestOnFoot, field[tileIndexAt(tileX + step[0], tileZ + step[1])]);
  }
  let bestHatch = null, bestThroughCeiling = NAVIGATION_UNREACHABLE;
  for (const other of hollowHatches) {
    if (other === hatch || field[other.index] >= NAVIGATION_UNREACHABLE) continue;
    const steps = field[other.index] + getHatchCrawlSteps(hatch, other);
    if (steps < bestThroughCeiling) { bestThroughCeiling = steps; bestHatch = other; }
  }
  return bestThroughCeiling < bestOnFoot + 1 ? bestHatch : null;
}

// ---------------------------------------------------------------------------
// Walking
// ---------------------------------------------------------------------------

// What a creature that walks has, for moveCreatureToward to go by. Put these among its own fields
// (`const looter = Object.assign(createCreatureLegs(LOOTER_WAY), { ... })`), with its `figure`.
//   way                 how it gets around
//   distanceField       how far it is from every tile to where it is going, by its way
//   fieldTargetIndex    the tile that field was worked out for (-1: none; set it to -1 to have it worked out again)
//   fieldVersion        the value of way.version it was worked out for
//   isTargetOutOfReach  where it was last sent is behind a door it cannot pass, with no way round
// A creature whose way uses the hatches also has:
//   climbIntoHatch      function (fromHatch, toHatch): it stands right under a hatch and its way on is through it
//   waitsBeforeHatch    (optional) function (): true if it has something to do first; asked every frame under the hatch
function createCreatureLegs(way) {
  return { way: way, distanceField: new Int16Array(TILE_COUNT), fieldTargetIndex: -1, fieldVersion: -1, isTargetOutOfReach: false };
}

// One frame of a creature walking to a place, by its way: straight there if that is a clear walk of a few
// metres, and otherwise from tile to tile down its distance field. Under a ceiling hatch that is its shortest
// way on, it climbs in. Turns it the way it goes. Returns how far it went (0 if it could not, or had no need).
function moveCreatureToward(creature, targetX, targetZ, speed, dt) {
  const figure = creature.figure, way = creature.way;
  const targetIndex = findNearestWalkableTileIndex(targetX, targetZ);
  // Its way is worked out again when it is sent somewhere else, and when a door opens or closes to it.
  if (targetIndex !== creature.fieldTargetIndex || creature.fieldVersion !== way.version) {
    computeWayDistanceField(way, creature.distanceField, targetIndex, true);
    creature.fieldTargetIndex = targetIndex;
    creature.fieldVersion = way.version;
  }
  creature.isTargetOutOfReach = false;
  let goalX = targetX, goalZ = targetZ;
  const directDistance = distanceBetweenPoints(figure.x, figure.z, targetX, targetZ);
  const canWalkStraight = directDistance < 8 && hasClearWalkingLineForWay(way, figure.x, figure.z, targetX, targetZ) &&
    !(way.keepsOutOfStore && getZoneAtPosition(targetX, targetZ) === level.storeZone);
  if (!canWalkStraight) {
    const tileX = Math.floor(figure.x), tileZ = Math.floor(figure.z);
    const currentIndex = isInsideGrid(tileX, tileZ) ? tileIndexAt(tileX, tileZ) : -1;
    const field = creature.distanceField;
    const hatch = way.usesHatches && currentIndex >= 0 && field[currentIndex] > 0 && field[currentIndex] < NAVIGATION_UNREACHABLE ? findHatchAtTile(currentIndex) : null;
    const hatchToCrawlTo = hatch ? findCrawlFromHatch(hatch, field) : null;
    if (currentIndex < 0 || field[currentIndex] >= NAVIGATION_UNREACHABLE) {
      // Standing somewhere it cannot path from: drift to the nearest tile it can.
      let bestIndex = -1, bestDistance = Infinity;
      for (let offsetZ = -3; offsetZ <= 3; offsetZ++) {
        for (let offsetX = -3; offsetX <= 3; offsetX++) {
          const nearX = tileX + offsetX, nearZ = tileZ + offsetZ;
          if (!isInsideGrid(nearX, nearZ)) continue;
          const nearIndex = tileIndexAt(nearX, nearZ);
          if (field[nearIndex] >= NAVIGATION_UNREACHABLE) continue;
          // Not one on the far side of a wall or of a door that is shut to it: it would drift straight through.
          if (!isOpenGroundBetweenForWay(way, figure.x, figure.z, nearX + 0.5, nearZ + 0.5)) continue;
          const nearDistance = distanceBetweenPoints(figure.x, figure.z, nearX + 0.5, nearZ + 0.5);
          if (nearDistance < bestDistance) { bestDistance = nearDistance; bestIndex = nearIndex; }
        }
      }
      if (bestIndex < 0) { creature.isTargetOutOfReach = true; return 0; } // behind a door it cannot pass, with no way round
      goalX = bestIndex % GRID_WIDTH + 0.5; goalZ = Math.floor(bestIndex / GRID_WIDTH) + 0.5;
    } else if (hatchToCrawlTo) {
      // Under a ceiling hatch, and the shortest way on is up through it: stand right under it, then climb in.
      if (creature.waitsBeforeHatch && creature.waitsBeforeHatch()) return 0;
      if (distanceBetweenPoints(figure.x, figure.z, hatch.x, hatch.z) < 0.25) {
        creature.climbIntoHatch(hatch, hatchToCrawlTo);
        return 0;
      }
      goalX = hatch.x; goalZ = hatch.z;
    } else if (field[currentIndex] > 0) {
      let bestValue = field[currentIndex], bestX = tileX, bestZ = tileZ, bestIsDiagonal = false;
      for (let offsetZ = -1; offsetZ <= 1; offsetZ++) {
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          if (offsetX === 0 && offsetZ === 0) continue;
          const nearX = tileX + offsetX, nearZ = tileZ + offsetZ;
          if (!isInsideGrid(nearX, nearZ)) continue;
          const value = field[tileIndexAt(nearX, nearZ)];
          if (value >= NAVIGATION_UNREACHABLE) continue;
          const isDiagonal = offsetX !== 0 && offsetZ !== 0;
          if (isDiagonal && (!isWalkableAt(tileX + offsetX, tileZ) || !isWalkableAt(tileX, tileZ + offsetZ))) continue;
          if (value < bestValue || (value === bestValue && bestIsDiagonal && !isDiagonal && value < field[currentIndex])) {
            bestValue = value; bestX = nearX; bestZ = nearZ; bestIsDiagonal = isDiagonal;
          }
        }
      }
      goalX = bestX + 0.5; goalZ = bestZ + 0.5;
    }
  }
  const deltaX = goalX - figure.x, deltaZ = goalZ - figure.z;
  const distance = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
  if (distance < 0.05) return 0;
  const step = Math.min(distance, speed * dt);
  figure.x += deltaX / distance * step;
  figure.z += deltaZ / distance * step;
  const desiredYaw = Math.atan2(deltaX, -deltaZ);
  figure.yaw += clampNumber(wrapAngleToPi(desiredYaw - figure.yaw), -dt * 5, dt * 5);
  return step;
}

// ---------------------------------------------------------------------------
// The kinds of creature
// ---------------------------------------------------------------------------

// Everything that walks about down there, one entry for each kind. In the order they are updated.
//   key        its name, in debug mode and the tests
//   update     function (dt): one frame of it. Only ever called in the game that decides the station: yours
//              alone, or the host's. (Everybody else is shown what the host's game says: 11-together.js.)
//   holdStill  (optional) function (): a frame in which nothing that walks moves, because one of them has hold
//              of somebody, or debug mode has them frozen
//   reset      function (): a new descent. It is as it is before anything has happened.
//   hear       (optional) function (x, z, radius, space): a noise was made there, in that space (see "Spaces"),
//              and carries that far within it
//   walkers    (optional) function (into): adds to the list `into` each of this kind that is on its feet in the
//              station now, as something with a `figure` and a `way`: a door opens for it as its way says
// Down there with others (11-together.js), for a kind that is to be seen by the others:
//   describe   (optional) function (): how every one of this kind stands now, as a list of numbers. The host's
//              game says it WORLD_SENDS_PER_SECOND times a second.
//   followHost (optional) function (numbers, blend, dt): one frame in a game that only shows what the host says.
//              `numbers` is what `describe` gave there (or null), `blend` runs from 0 to 1 between two tellings.
// For debug mode (10-debug.js), so that a new kind shows up there by itself:
//   debugFigures (optional) function (into): adds { figure, red, green, blue } for each body to draw
//   debugMarks   (optional) function (into): adds { x, z, color } for each to mark on the map
//   debugLines   (optional) function (lines): adds its lines to the readout
const CREATURE_KINDS = [];

function addCreatureKind(kind) {
  CREATURE_KINDS.push(kind);
  return kind;
}

function findCreatureKind(key) {
  for (const kind of CREATURE_KINDS) if (kind.key === key) return kind;
  return null;
}

function updateCreatures(dt) {
  for (const kind of CREATURE_KINDS) kind.update(dt);
}

function holdCreaturesStill() {
  for (const kind of CREATURE_KINDS) if (kind.holdStill) kind.holdStill();
}

function resetCreatures() {
  for (const kind of CREATURE_KINDS) kind.reset();
}

// Everything that is on its feet in the station now, of every kind: see `walkers` above. The same list every
// time: it is only good until the next call.
const creatureWalkers = [];
function findCreatureWalkers() {
  creatureWalkers.length = 0;
  for (const kind of CREATURE_KINDS) if (kind.walkers) kind.walkers(creatureWalkers);
  return creatureWalkers;
}

// ---------------------------------------------------------------------------
// Spaces: where a thing is, besides its x and its z
//
// A station is drawn on one sheet: every tile has one floor and one ceiling, and "how far is this from that" is
// measured across the sheet, in x and z. That is true for nearly everything, because nearly everything is in
// the rooms and corridors. But not all of it. The Hollow above the ceilings, on its way from one hatch to
// another, has an x and a z that put it "half a metre from you" while there is a ceiling between you.
//
// So a thing is also in a SPACE, and whatever asks how near two things are asks this section what being in two
// different spaces does to the answer. There are three questions, and each is asked here and nowhere else:
//
//   reach      Can the one touch the other: catch it, kick it, wake it, stand in its way, be hit by its light?
//              Only in the same space (areInTheSameSpace).
//   noise      How much of the distance a noise carries is left when it has to get from the one space into
//              the other (getNoiseCarryBetweenSpaces)? All of it within a space. Through a ceiling, a part
//              (TUNING.noiseThroughCeilingFactor).
//   presence   How much does the one weigh on the other from there: the scanner's interference, the
//              heartbeat (getPresenceBetweenSpaces)? Through a ceiling, a part (TUNING.presenceThroughCeilingFactor).
//
// Today there are two spaces. A thing says which it is in with a `space` of its own (a creature's figure has
// one); a thing that says nothing is in the station, which is where you, the loose things and every noise you
// make are.
//
// This is not levels one above the other, and it is half of what those would need. Stacked levels need the
// station itself kept as several floors to a tile (walls, path finding, what a scan hits: none of that is
// here), and they need every "how near" question to know that a floor is in between. The second half is this
// section: a level above would be one more space, and the three questions would be asked of it as they are of
// the crawlspace.
// ---------------------------------------------------------------------------

const SPACE_STATION = 0;    // the rooms, corridors and vents: where you walk
const SPACE_CRAWLSPACE = 1; // above the ceilings: where the Hollow goes from hatch to hatch (08-crawlspace.js)
const SPACE_NAMES = ['in the station', 'above the ceiling'];

// The space a thing is in: a figure, a player, a loose object, anything with or without a `space`.
function getSpaceOf(thing) {
  return thing && thing.space !== undefined ? thing.space : SPACE_STATION;
}

function areInTheSameSpace(first, second) {
  return getSpaceOf(first) === getSpaceOf(second);
}

// How much of the distance a noise carries is left on the way from one space into another: 1 for all of it.
function getNoiseCarryBetweenSpaces(fromSpace, toSpace) {
  return fromSpace === toSpace ? 1 : TUNING.noiseThroughCeilingFactor;
}

// How much something in one space weighs on somebody in another: 1 for all of it.
function getPresenceBetweenSpaces(fromSpace, toSpace) {
  return fromSpace === toSpace ? 1 : TUNING.presenceThroughCeilingFactor;
}

// ---------------------------------------------------------------------------
// Noise: anything loud that happens in the station is reported here
// ---------------------------------------------------------------------------

// `space` is the space the noise is made in (see "Spaces"). Left out: the station, which is where everything
// that makes a noise today is. (Down there with others a noise is told to the host without it, for that reason.)
function emitNoise(x, z, radius, space) {
  // Down there with others, in the host's station: the creatures that hear this are the host's (11-together.js).
  if (isWorldTheHosts()) { tellHostOfNoise(x, z, radius); return; }
  shareWorldSoundsDuring(function () { hearNoise(x, z, radius, space); }); // what it sounds like when one of them hears this is everybody's
}

// A noise, in the game that decides the station: what is not here yet comes sooner for it, and every kind of
// creature that listens is told, with the space it was made in. How far it carries to a creature in another
// space is that creature's to work out, with getNoiseCarryBetweenSpaces: it knows where it is.
function hearNoise(x, z, radius, space) {
  noteNoiseForArrivals(x, z, radius); // (08-arrivals.js)
  const madeIn = space === undefined ? SPACE_STATION : space;
  for (const kind of CREATURE_KINDS) if (kind.hear) kind.hear(x, z, radius, madeIn);
}
