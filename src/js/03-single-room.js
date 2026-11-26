// ---------------------------------------------------------------------------
// One room on its own: built alone on an otherwise empty map, instead of a whole station.
//
// Two things use this:
//   - the workshop's room tool (src/dev/21-workshop-rooms.js), which shows the room being worked on;
//   - the test suites (tools/*-test.js), through `lastReturnDebug.loadTestRoom`, which build a room of their own,
//     written into the test as plain data, and play in it. A check that is about a thing (a grenade, a tripod)
//     and not about a station then knows exactly what is around it: no searching a station for a clear spot.
//
// A room built here is the real thing: carved, furnished and given doors by the same code a generated station
// uses (03-workshop-rooms.js for a room made in the workshop, 03-levelgen.js for one written as code). Every
// doorway gets a door and a few metres of corridor behind it, so it can be walked through.
//
// What a room built for play has besides what a station room has (see normalizeDesignedRoom in 03-workshop-rooms.js):
//   looseObjects  things lying loose in it, to pick up, carry, throw and use: a list of
//                 { "kind": a key of LOOSE_OBJECT_KINDS, "x", "z": metres from the north-west corner,
//                   "angle": degrees clockwise seen from above, "height": metres above the floor it stands on
//                   (0: on the floor; a table top is about 0.77), "onItsSide": true to lie it down }
//   playerStart   where you stand when it is loaded: { "x", "z", "angle" }. Left out: the middle of the room,
//                 facing north.
// A station does not put these out (yet): a room file that has them is a station room without them.
// ---------------------------------------------------------------------------

// Where on the empty map the room's north-west corner is put. (The workshop calls this WORKSHOP_ORIGIN_X/Z.)
const SINGLE_ROOM_ORIGIN_X = 40, SINGLE_ROOM_ORIGIN_Z = 40;

// The key a room built from data that is not a file gets: what a test hands in.
const SINGLE_ROOM_TEST_KEY = 'testRoom';

// Clears the map for one room. The room is then carved and furnished, and finishWorldForSingleRoom is called.
// (The workshop's other tools use this too, for the bare rooms they show a creature or an object in.)
function prepareWorldForSingleRoom(description) {
  resetWorldForNewLevel();
  stillSpawnPoints.length = 0; lateStillSpawnPoints.length = 0; phantomDefinitions.length = 0;
  stills.length = 0; phantoms.length = 0;
  stillsAreHunting = false;
  raycastableFigures.length = 0;
  hollow.isActive = false;
  liftDoor = null;
  generatedStationPlan = null; // (nothing here was planned as a station)
  stationLooseObjects.length = 0; // and nothing of the last station's is put out again (spawnStationLooseObjects)
  level.kind = 'generated';
  level.seed = 0;
  level.locationKey = DEFAULT_LOCATION_KEY;
  level.signTexts = null;
  level.description = description;
  level.storeZone = 0;
  level.stillZones.length = 0;
  level.unlabelledZones.length = 0;
  level.roomCount = 1; level.loopCount = 0; level.stairCount = 0; level.ventCount = 0;
  relocatedObjectives.spool1 = false; relocatedObjectives.keycard = false;
  game.scheduledEvents.length = 0;
  ZONE_NAMES.length = 0;
  placement.isGenerating = true; // rooms are placed the way a generated station places them
}

function finishWorldForSingleRoom() {
  placement.isGenerating = false;
  clearPlacement();
  computeNavigationGrid();
  computeLevelBounds();
  uploadWorldOccluderMesh(buildWorldOccluderVertices());
  // Points left by the scanner belong to the world as it was a moment ago.
  clearAllPoints();
}

// Builds one room alone. `options`:
//   room            a room made in the workshop, as normalizeDesignedRoom gives it; or leave it out and give
//   roomKey         the key of a room written as code (ROOM_CATALOGUE, 03-levelgen.js)
//   locationKey     the place it is shown in (a key of LOCATIONS): what it is made of where the room does not
//                   say, and what is outside its doors. Left out: the first place the room belongs to.
//   seed            for the things that come out a little different every time (shelf contents, crate stacks)
//   keepsEverything true: every thing is there, also what is only sometimes there (the workshop, tests)
//   itemRanges      a list that receives, per thing in the room, which entries of worldProps it became
//   showsItemSpot   true: a spool lies on the room's spot for one (the workshop shows where it is)
//   description     what the level is called while it is loaded
// Returns the room's ROOM_CATALOGUE entry (its `definition`).
function buildSingleRoom(options) {
  const room = options.room || null;
  const definition = room ? createDesignedRoomDefinition(room) : ROOM_CATALOGUE[options.roomKey];
  const roomKey = room ? room.key : options.roomKey;
  const name = room ? room.name : definition.name;
  const rect = definition.rect;
  const originX = SINGLE_ROOM_ORIGIN_X, originZ = SINGLE_ROOM_ORIGIN_Z;
  prepareWorldForSingleRoom(options.description || name);
  ZONE_NAMES.push('UNSURVEYED', name, 'OUTSIDE', 'LIFT CAR');
  // The place it is shown in: that says what it is made of where the room does not, and what is outside its doors.
  let locationKey = resolveLocationKey(options.locationKey || '');
  if (room && room.locations.indexOf(locationKey) < 0) locationKey = room.locations[0];
  level.locationKey = locationKey;
  level.signTexts = getLocation(locationKey).signTexts;
  const roomLook = room ? LOOK_KEYS[room.look || getLocation(locationKey).look] || LOOK_PANEL : getLocationRoomLook(locationKey, roomKey);
  const placeRoom = function () {
    clearPlacement();
    setPlacement(0, rect[0], rect[1], originX, originZ);
    placement.zone = 1;
    placement.look = roomLook;
    placement.zoneMap = roomKey === 'liftLobby' ? { [ZONE_LIFT_CAR]: 3 } : null;
  };

  placeRoom();
  grownRoomPreviewSeed = options.seed === undefined ? 1 : options.seed; // (a cavern that is grown is grown from the number that shuffles everything else here)
  definition.carve();
  if (definition.isFlooded) setTileFlagInRectangle(rect[0], rect[1], rect[2], rect[3], TILE_FLAG_WATER);
  if (liftDoor) liftDoor.forcedState = true;

  // Every doorway gets a door and a few metres of corridor behind it, so it can be walked through.
  definition.sockets.forEach(function (socket, socketIndex) {
    placeRoom();
    const tile = placeTile(socket[0], socket[1]);
    const step = WALL_DIRECTIONS[placeWall(socket[2])];
    clearPlacement();
    placement.zone = 2;
    placement.look = getLocationRoomLook(locationKey, 'corridor');
    placement.offsetY = definition.socketDrops ? definition.socketDrops[socketIndex] : 0;
    const nearX = tile[0] + step[0], nearZ = tile[1] + step[1], farX = tile[0] + step[0] * 3, farZ = tile[1] + step[1] * 3;
    const sideX = step[0] === 0 ? 1 : 0, sideZ = step[1] === 0 ? 1 : 0;
    carveRoom(Math.min(nearX, farX) - sideX, Math.min(nearZ, farZ) - sideZ, Math.max(nearX, farX) + sideX + 1, Math.max(nearZ, farZ) + sideZ + 1, 2.8, ZONE_GENERATED_ROOM);
    addDoor(tile[0], tile[1], DOOR_KIND_AUTOMATIC);
  });

  placeRoom();
  const random = createSeededRandomGenerator(options.seed === undefined ? 1 : options.seed);
  if (options.itemRanges) options.itemRanges.length = 0;
  if (room) {
    furnishDesignedRoom(room, random, name, options.itemRanges || null, definition.shape, options.keepsEverything === true);
    // Show what a spool looks like on the spot it may be left on.
    if (options.showsItemSpot && definition.itemSpot) addSurveySpool(OBJECT_SPOOL_1, definition.itemSpot[0], definition.itemSpot[1], definition.itemSpot[2], 'SPOOL');
  } else {
    definition.furnish(random, name);
    // What the place it is shown in has done to it since it was built, as a station there would have it (04-caverns.js).
    const dressing = getLocation(locationKey).roomDressing;
    if (dressing && !definition.isGrown) {
      dressBuiltRoom({ key: roomKey, zone: 1, startX: originX, startZ: originZ, endX: originX + rect[2] - rect[0], endZ: originZ + rect[3] - rect[1] }, random, dressing);
    }
  }
  clearPlacement();
  if (roomKey !== 'liftLobby' && !definition.shape && !definition.isGrown) {
    addBeamsToLargeRoom({ startX: originX, startZ: originZ, endX: originX + rect[2] - rect[0], endZ: originZ + rect[3] - rect[1], ceiling: definition.ceiling });
  }
  finishWorldForSingleRoom();
  return definition;
}

// The loose things a room built for play has lying in it, put on the station's own list of what lies loose
// (stationLooseObjects, 08-loose-objects.js). A new run then puts them out where the room has them, at rest,
// and puts them back there on every retry, as a station does with its own. Returns a list of problems: a kind
// that does not exist is left out, and said.
function planSingleRoomLooseObjects(room) {
  const problems = [];
  stationLooseObjects.length = 0;
  for (const entry of room.looseObjects || []) {
    if (!LOOSE_OBJECT_KINDS[entry.kind]) { problems.push('there is no loose object called "' + entry.kind + '"'); continue; }
    const x = SINGLE_ROOM_ORIGIN_X + entry.x, z = SINGLE_ROOM_ORIGIN_Z + entry.z;
    addStationLooseObject(entry.kind, x, getFloorHeightAt(x, z) + entry.height, z, entry.angle * DEGREES_TO_RADIANS, entry.onItsSide, false, entry.height > 0 ? 'surface' : 'floor');
  }
  return problems;
}

// Where you stand in a room built for play: its `playerStart`, or the middle of it, facing north. In the
// world's own numbers: { x, z, yaw }.
function getSingleRoomPlayerStart(room) {
  const start = room.playerStart || { x: room.width / 2, z: room.depth / 2, angle: 0 };
  return { x: SINGLE_ROOM_ORIGIN_X + start.x, z: SINGLE_ROOM_ORIGIN_Z + start.z, yaw: wrapAngleToPi(start.angle * DEGREES_TO_RADIANS) };
}

// Builds a room alone for play: `source` is a room as a room file has it (see the top of this file and of
// 03-workshop-rooms.js), or the key of a room file in src/rooms/. Everything in it is there, also what is only
// sometimes there. The loose things are put on the station's list, and you start where the room says, once
// the run is started afresh (resetWorldState in 11-game.js does both).
// Returns { room, definition, problems }, or null if there is no such room file.
function buildSingleRoomForPlay(source, options) {
  options = options || {};
  let room;
  if (typeof source === 'string') {
    if (!designedRooms[source]) return null;
    room = designedRooms[source];
  } else room = normalizeDesignedRoom(source, SINGLE_ROOM_TEST_KEY);
  const definition = buildSingleRoom({ room: room, locationKey: options.locationKey, seed: options.seed, keepsEverything: true,
    description: 'Room on its own · ' + room.name });
  const problems = planSingleRoomLooseObjects(room);
  const start = getSingleRoomPlayerStart(room);
  PLAYER_START.x = start.x; PLAYER_START.z = start.z; PLAYER_START.yaw = start.yaw;
  return { room: room, definition: definition, problems: problems };
}
