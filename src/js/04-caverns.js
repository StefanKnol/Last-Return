// ---------------------------------------------------------------------------
// What is grown instead of drawn: caverns, and passages that wind.
//
// A room of the catalogue is a rectangle with doors in fixed places, and a station is planned out of such
// rectangles (03-levelgen.js). That stays so. What changes here is what is dug inside the rectangle:
//
//   a grown cavern   has a rectangle and doors like any room, but no two of them are alike: its floor is grown
//                    afresh for every station, from the station's seed and which room of the plan it is. It
//                    comes out as the same thing a room painted in the workshop is (rows of tiles and what the
//                    letters in them mean: "The shape of a room", 03-workshop-rooms.js), so the same rules hold
//                    for it, and the workshop can grow one into a room of its own to be worked on by hand.
//   a winding passage  is planned as a straight band of rock, three tiles wide, and dug as a way through it that
//                    keeps to no line: one tile wide here, three there, with rock left standing on either side.
//                    It is open wherever something opens onto it (a door, a vent, a squeeze), and nowhere has to
//                    be anything more.
//
// Neither takes a number from the numbers a station is planned with: each has its own, drawn from the seed and
// its place in the plan. So what is grown never changes what is planned.
// ---------------------------------------------------------------------------

// How far apart two levels of a cavern's floor are. Two of them side by side can be walked (DESIGNED_TALLEST_STEP).
const CAVERN_FLOOR_STEP = 0.3;
// TWEAK: how many times a cavern is grown again before a plain one is dug instead. (One comes out wrong when
// too little of it is open; that is rare.)
const CAVERN_GROWTH_TRIES = 12;

// The numbers something that is grown is grown from: its own, from the station's seed and a number of its own.
function createGrowthRandom(seed, number) {
  return createSeededRandomGenerator((Math.imul(seed | 0, 2654435761) ^ Math.imul((number | 0) + 1, 40503) ^ 0x5bd1e995) >>> 0);
}

// Grows the floor of a cavern in a rectangle. `doors` are doors as a room file has them ({ wall, at }); the
// first is the one everything else is reached from. Returns { tiles, tileKinds } as a room file has them, or
// null if what grew is too small to be a room. `options`:
//   ceiling    the height of its roof where it is neither low nor high
//   fill       how much of it starts as rock, from 0 to 1 (more: narrower, with more pillars)
//   isLevel    true: one floor level everywhere (for water to lie on)
//   rise       how much higher than `ceiling` the roof is where it is high
//   keepOpen   rectangles [startX, startZ, endX, endZ] that are plain floor whatever grows: for what stands in it
function growCavern(width, depth, doors, random, options) {
  const settings = Object.assign({ ceiling: 2.8, fill: 0.44, isLevel: false, rise: 0.9, keepOpen: [] }, options || {});
  const count = width * depth;
  const isInside = function (x, z) { return x >= 0 && z >= 0 && x < width && z < depth; };
  const doorTiles = doors.map(function (door) { return getDesignedDoorInsideTile({ width: width, depth: depth }, door); });
  let open = new Uint8Array(count);

  // 1. Scatter: open or rock by chance, with rock likelier toward the edges and likeliest in the corners.
  const centerX = (width - 1) / 2, centerZ = (depth - 1) / 2;
  for (let z = 0; z < depth; z++) {
    for (let x = 0; x < width; x++) {
      const awayX = (x - centerX) / (width / 2), awayZ = (z - centerZ) / (depth / 2);
      open[z * width + x] = random() > settings.fill + (awayX * awayX + awayZ * awayZ - 0.5) * 0.3 ? 1 : 0;
    }
  }
  // 2. Settle: a tile with rock most of the way round it becomes rock, one with little rock round it opens.
  for (let pass = 0; pass < 4; pass++) {
    const settled = new Uint8Array(count);
    for (let z = 0; z < depth; z++) {
      for (let x = 0; x < width; x++) {
        let rockAround = 0;
        for (let offsetZ = -1; offsetZ <= 1; offsetZ++) for (let offsetX = -1; offsetX <= 1; offsetX++) {
          if ((offsetX !== 0 || offsetZ !== 0) && (!isInside(x + offsetX, z + offsetZ) || !open[(z + offsetZ) * width + x + offsetX])) rockAround++;
        }
        settled[z * width + x] = rockAround >= 5 ? 0 : (rockAround <= 3 ? 1 : open[z * width + x]);
      }
    }
    open = settled;
  }
  // 3. What has to be floor: inside every door and two tiles on from it, and what is asked to be kept open.
  const mustBeOpen = new Uint8Array(count);
  doors.forEach(function (door, doorIndex) {
    const inward = WALL_DIRECTIONS[(ROOM_WALL_NAMES.indexOf(door.wall) + 2) % 4];
    for (let step = 0; step < 3; step++) {
      const x = doorTiles[doorIndex][0] + inward[0] * step, z = doorTiles[doorIndex][1] + inward[1] * step;
      if (isInside(x, z)) mustBeOpen[z * width + x] = 1;
    }
  });
  for (const kept of settings.keepOpen) {
    for (let z = kept[1]; z < kept[3]; z++) for (let x = kept[0]; x < kept[2]; x++) if (isInside(x, z)) mustBeOpen[z * width + x] = 1;
  }
  for (let index = 0; index < count; index++) if (mustBeOpen[index]) open[index] = 1;

  // 4. One cave, not several: every part that matters is joined to the part the first door is in by a way dug
  //    through the rock between them, and the scraps that do not matter are filled in.
  const part = new Int32Array(count).fill(-1);
  const parts = [];
  for (let start = 0; start < count; start++) {
    if (!open[start] || part[start] >= 0) continue;
    const tiles = [start];
    part[start] = parts.length;
    for (let position = 0; position < tiles.length; position++) {
      const x = tiles[position] % width, z = (tiles[position] - x) / width;
      for (const step of WALL_DIRECTIONS) {
        const nearX = x + step[0], nearZ = z + step[1];
        if (!isInside(nearX, nearZ) || !open[nearZ * width + nearX] || part[nearZ * width + nearX] >= 0) continue;
        part[nearZ * width + nearX] = parts.length;
        tiles.push(nearZ * width + nearX);
      }
    }
    parts.push(tiles);
  }
  const mainPart = part[doorTiles[0][1] * width + doorTiles[0][0]];
  const isInMain = new Uint8Array(count);
  for (const index of parts[mainPart]) isInMain[index] = 1;
  for (let number = 0; number < parts.length; number++) {
    if (number === mainPart) continue;
    const tiles = parts[number];
    const matters = tiles.length >= 6 || tiles.some(function (index) { return mustBeOpen[index] === 1; });
    if (!matters) { for (const index of tiles) open[index] = 0; continue; }
    // From the tile of it that is nearest the main part, toward the tile of the main part nearest that.
    let from = -1, to = -1, nearest = Infinity;
    for (const index of tiles) {
      const x = index % width, z = (index - x) / width;
      for (let other = 0; other < count; other++) {
        if (!isInMain[other]) continue;
        const distance = Math.abs(other % width - x) + Math.abs(Math.floor(other / width) - z);
        if (distance < nearest) { nearest = distance; from = index; to = other; }
      }
    }
    let x = from % width, z = (from - x) / width;
    const toX = to % width, toZ = (to - toX) / width;
    for (let guard = 0; guard < width + depth + 4 && !isInMain[z * width + x]; guard++) {
      const leftX = Math.abs(toX - x), leftZ = Math.abs(toZ - z);
      if (leftX > 0 && (leftZ === 0 || random() * (leftX + leftZ) < leftX)) x += toX > x ? 1 : -1;
      else if (leftZ > 0) z += toZ > z ? 1 : -1;
      open[z * width + x] = 1;
      // (Not a slot cut with a ruler: now and then a tile beside the way goes too.)
      if (random() < 0.35) {
        const side = WALL_DIRECTIONS[Math.floor(random() * 4)];
        if (isInside(x + side[0], z + side[1])) open[(z + side[1]) * width + x + side[0]] = 1;
      }
    }
    for (const index of tiles) isInMain[index] = 1;
    for (let index = 0; index < count; index++) if (open[index] && !isInMain[index] && part[index] < 0) isInMain[index] = 1; // (what was just dug)
  }
  let openCount = 0;
  for (let index = 0; index < count; index++) openCount += open[index];
  if (openCount < count * 0.34) return null;
  // And pillars: a tile of rock left standing where there is floor all round it, so that a big cavern cannot be
  // seen across from one end. (With floor all round it, it cuts nothing off; and no two stand side by side.)
  const pillars = [];
  for (let wanted = Math.floor(openCount / 34), guard = 0; pillars.length < wanted && guard < 200; guard++) {
    const x = 1 + Math.floor(random() * (width - 2)), z = 1 + Math.floor(random() * (depth - 2));
    let standsFree = !mustBeOpen[z * width + x] && !pillars.some(function (other) { return Math.abs(other[0] - x) <= 2 && Math.abs(other[1] - z) <= 2; });
    for (let offsetZ = -1; offsetZ <= 1 && standsFree; offsetZ++) for (let offsetX = -1; offsetX <= 1 && standsFree; offsetX++) if (!open[(z + offsetZ) * width + x + offsetX]) standsFree = false;
    if (!standsFree || doorTiles.some(function (tile) { return Math.abs(tile[0] - x) <= 2 && Math.abs(tile[1] - z) <= 2; })) continue;
    pillars.push([x, z]);
    open[z * width + x] = 0;
  }

  // 5. Its floor: mostly one level, with parts a step up and parts a step down. Never two steps at once, and
  //    level floor inside the doors.
  const offsetA = random() * 500, offsetB = random() * 500;
  const isNearDoor = function (x, z) {
    return mustBeOpen[z * width + x] === 1 || doorTiles.some(function (tile) { return Math.abs(tile[0] - x) <= 2 && Math.abs(tile[1] - z) <= 2; });
  };
  const level = new Int8Array(count);
  if (!settings.isLevel) {
    for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) {
      if (!open[z * width + x] || isNearDoor(x, z)) continue;
      const height = smoothNoise(x * 0.24 + offsetA, z * 0.24 + offsetA * 0.61);
      level[z * width + x] = height < 0.3 ? -1 : (height > 0.72 ? 1 : 0);
    }
    for (let hasChanged = true, pass = 0; hasChanged && pass < 20; pass++) {
      hasChanged = false;
      for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) {
        const own = level[z * width + x];
        if (own === 0) continue;
        for (const step of WALL_DIRECTIONS) {
          if (isInside(x + step[0], z + step[1]) && open[(z + step[1]) * width + x + step[0]] && level[(z + step[1]) * width + x + step[0]] === -own) { level[z * width + x] = 0; hasChanged = true; break; }
        }
      }
    }
  }
  // 6. Its roof: low in places, high in others. Its own height inside the doors.
  const tiles = [], room = { tileKinds: {} };
  for (let z = 0; z < depth; z++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      if (!open[z * width + x]) { row += DESIGNED_TILE_ROCK; continue; }
      const floor = level[z * width + x] * CAVERN_FLOOR_STEP;
      let ceiling;
      const roof = isNearDoor(x, z) ? 0.5 : smoothNoise(x * 0.2 - offsetB, z * 0.2 + offsetB * 0.37);
      if (roof < 0.3) ceiling = Math.max(2.2, settings.ceiling - 0.6);
      else if (roof > 0.7) ceiling = settings.ceiling + settings.rise;
      row += findDesignedTileCharacter(room, floor, ceiling) || DESIGNED_TILE_FLOOR;
    }
    tiles.push(row);
  }
  return { tiles: tiles, tileKinds: room.tileKinds };
}

// A room as a room file has it, grown: for resolveDesignedRoomShape to make a shape of, or for the workshop to
// work on. It is grown again, from the next numbers, until every door of it can be walked to and all of its
// floor is built. Should that never come (it does), it is a plain box.
function growCavernRoom(width, depth, ceiling, doors, seed, options) {
  const room = { width: width, depth: depth, ceiling: ceiling, doors: doors, tiles: null, tileKinds: {} };
  for (let attempt = 0; attempt < CAVERN_GROWTH_TRIES; attempt++) {
    const grown = growCavern(width, depth, doors, createGrowthRandom(seed, attempt * 7919), Object.assign({ ceiling: ceiling }, options || {}));
    if (!grown) continue;
    room.tiles = grown.tiles; room.tileKinds = grown.tileKinds;
    const shape = resolveDesignedRoomShape(room);
    if (shape.cutOffDoors.length === 0 && shape.sealedCount === 0) return room;
  }
  room.tiles = null; room.tileKinds = {};
  return room;
}

// ---------------------------------------------------------------------------
// Caverns as rooms of the catalogue
// ---------------------------------------------------------------------------

// The numbers the caverns of the workshop's room tool are grown from: there is no station there to take them from.
let grownRoomPreviewSeed = 1;

// The doors of a catalogue room, as a room file has them.
function getDoorsOfSockets(sockets, width, depth) {
  return sockets.map(function (socket) {
    if (socket[2] === WALL_NORTH) return { wall: 'north', at: socket[0] };
    if (socket[2] === WALL_SOUTH) return { wall: 'south', at: socket[0] };
    if (socket[2] === WALL_WEST) return { wall: 'west', at: socket[1] };
    return { wall: 'east', at: socket[1] };
  });
}

// What stands in a cavern: stalagmites where there is room all round one, stalactites where the roof is high
// enough to hang them out of the way, rubble, and its name chalked on the rock by whoever was here before.
// Nothing of it can cut the cavern in two: a stalagmite stands only where every tile round it is floor, and no
// two stand near each other.
function furnishGrownRoom(definition, shape, random, roomName) {
  const width = shape.width, depth = shape.depth, roomFloorY = placement.offsetY;
  const doors = getDoorsOfSockets(definition.sockets, width, depth);
  const doorTiles = doors.map(function (door) { return getDesignedDoorInsideTile({ width: width, depth: depth }, door); });
  const isOpenAt = function (x, z) { return x >= 0 && z >= 0 && x < width && z < depth && shape.isOpen[z * width + x] === 1; };
  const isKeptClear = function (x, z) {
    if (doorTiles.some(function (tile) { return Math.abs(tile[0] - x) <= 2 && Math.abs(tile[1] - z) <= 2; })) return true;
    return (definition.grow.keepOpen || []).some(function (kept) { return x >= kept[0] - 1 && x <= kept[2] && z >= kept[1] - 1 && z <= kept[3]; });
  };
  // Everything on a tile stands on that tile's floor, under that tile's roof.
  const onTile = function (x, z, build) {
    const index = z * width + x;
    placement.offsetY = roomFloorY + shape.floor[index];
    build(shape.ceiling[index] - shape.floor[index]);
    placement.offsetY = roomFloorY;
  };
  if (definition.furnishCamp) definition.furnishCamp(random);

  const openTiles = [];
  for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) if (isOpenAt(x, z)) openTiles.push([random(), x, z]);
  openTiles.sort(function (first, second) { return first[0] - second[0] || first[2] - second[2] || first[1] - second[1]; });

  const stalagmites = [];
  for (const entry of openTiles) {
    if (stalagmites.length >= Math.round(openTiles.length / 20)) break;
    const x = entry[1], z = entry[2], index = z * width + x;
    if (isKeptClear(x, z)) continue;
    let hasRoom = true;
    for (let offsetZ = -1; offsetZ <= 1 && hasRoom; offsetZ++) for (let offsetX = -1; offsetX <= 1 && hasRoom; offsetX++) {
      if (!isOpenAt(x + offsetX, z + offsetZ) || shape.floor[(z + offsetZ) * width + x + offsetX] !== shape.floor[index]) hasRoom = false;
    }
    if (!hasRoom || stalagmites.some(function (other) { return Math.abs(other[0] - x) <= 2 && Math.abs(other[1] - z) <= 2; })) continue;
    stalagmites.push([x, z]);
    onTile(x, z, function (headroom) { addStalagmite(x + 0.5, z + 0.5, Math.min(headroom - 0.3, 0.9 + random() * 1.1), 0.16 + random() * 0.1); });
  }
  let hung = 0, strewn = 0;
  for (const entry of openTiles) {
    const x = entry[1], z = entry[2];
    if (hung < openTiles.length / 7 && random() < 0.4) {
      onTile(x, z, function (headroom) {
        const length = Math.min(headroom - 1.95, 0.25 + random() * 0.9);
        if (length < 0.2) return;
        hung++;
        addStalactite(x + 0.2 + random() * 0.6, z + 0.2 + random() * 0.6, headroom, length, 0.07 + random() * 0.09);
      });
    }
    // Rubble lies at the foot of the walls.
    const isByRock = !isOpenAt(x + 1, z) || !isOpenAt(x - 1, z) || !isOpenAt(x, z + 1) || !isOpenAt(x, z - 1);
    if (isByRock && !isKeptClear(x, z) && strewn < openTiles.length / 9 && random() < 0.3) {
      strewn++;
      onTile(x, z, function () {
        const radius = 0.08 + random() * 0.14;
        addSphereProp(x + 0.25 + random() * 0.5, radius * 0.5, z + 0.25 + random() * 0.5, radius, CLUTTER);
      });
    }
  }
  // Its name, chalked on the first stretch of rock two tiles long that faces the first door's part of it.
  let isChalked = false;
  for (let reach = 1; reach <= 6 && !isChalked; reach++) {
    for (let z = doorTiles[0][1] - reach; z <= doorTiles[0][1] + reach && !isChalked; z++) for (let x = doorTiles[0][0] - reach; x <= doorTiles[0][0] + reach && !isChalked; x++) {
      if (!isOpenAt(x, z) || !isOpenAt(x + 1, z) || isOpenAt(x, z - 1) || isOpenAt(x + 1, z - 1) || z === 0) continue;
      if (shape.floor[z * width + x] !== shape.floor[z * width + x + 1]) continue;
      addWallSign(roomName, x, z, WALL_NORTH, { width: 1.8, height: 0.4, centerY: 1.5, alongOffset: 0.5, isScrawled: true });
      isChalked = true;
    }
  }
}

// A catalogue entry for a cavern. `spec` is what ROOM_CATALOGUE holds for any room (name, rect, ceiling, tiers,
// sockets, itemSpot) and `grow`: the options growCavern takes. It is a room of the cave, unless `locations`
// (keys of LOCATIONS, 03-locations.js) says where else; and a station may have three of a kind, since no two
// are alike (`mostInAStation`).
function createGrownRoomDefinition(spec) {
  const width = spec.rect[2], depth = spec.rect[3];
  const definition = Object.assign({ isFiller: true, isGrown: true, look: 'rock', mostInAStation: 3, locations: ['cave'] }, spec);
  const growShape = function (seed) {
    return resolveDesignedRoomShape(growCavernRoom(width, depth, spec.ceiling, getDoorsOfSockets(spec.sockets, width, depth), seed, spec.grow)) ||
      resolveDesignedRoomShape({ width: width, depth: depth, ceiling: spec.ceiling, doors: getDoorsOfSockets(spec.sockets, width, depth), tiles: new Array(depth).fill(DESIGNED_TILE_FLOOR.repeat(width - 1) + 'a'), tileKinds: { a: { floor: 0, ceiling: spec.ceiling } } });
  };
  // `room` is the room of the plan this is (and `plan` the plan): the workshop, which has neither, gets one of its own.
  definition.carve = function (room, plan) {
    const shape = room ? growShape(Math.imul(plan.seed, 31) + plan.rooms.indexOf(room)) : growShape(grownRoomPreviewSeed * 1009);
    if (room) room.grownShape = shape;
    definition.lastShape = shape;
    carveDesignedRoomShape(shape);
  };
  definition.furnish = function (random, roomName, room) { furnishGrownRoom(definition, room ? room.grownShape : definition.lastShape, random, roomName || spec.name); };
  return definition;
}

// The caverns a station can have. (Which places have them is the places' to say: 03-locations.js.)
ROOM_CATALOGUE.cavernGrotto = createGrownRoomDefinition({ name: 'GROTTO', rect: [0, 0, 8, 7], ceiling: 2.7, tiers: [0, 1, 2],
  sockets: [[4, 7, WALL_SOUTH], [-1, 3, WALL_WEST]], grow: { fill: 0.4 } });
ROOM_CATALOGUE.cavernChamber = createGrownRoomDefinition({ name: 'CAVERN', rect: [0, 0, 12, 10], ceiling: 3.1, tiers: [0, 1, 2],
  sockets: [[-1, 5, WALL_WEST], [12, 4, WALL_EAST], [6, 10, WALL_SOUTH]], grow: { fill: 0.43, rise: 1.2 } });
ROOM_CATALOGUE.cavernGreat = createGrownRoomDefinition({ name: 'GREAT CHAMBER', rect: [0, 0, 17, 13], ceiling: 3.6, tiers: [1, 2],
  sockets: [[8, 13, WALL_SOUTH], [-1, 6, WALL_WEST], [17, 6, WALL_EAST], [9, -1, WALL_NORTH]], grow: { fill: 0.42, rise: 2.2 } });
ROOM_CATALOGUE.cavernGallery = createGrownRoomDefinition({ name: 'GALLERY', rect: [0, 0, 18, 6], ceiling: 2.6, tiers: [0, 1, 2],
  sockets: [[-1, 2, WALL_WEST], [18, 3, WALL_EAST], [9, 6, WALL_SOUTH]], grow: { fill: 0.47, rise: 0.7 } });
ROOM_CATALOGUE.cavernLake = createGrownRoomDefinition({ name: 'SUMP LAKE', rect: [0, 0, 11, 9], ceiling: 2.9, tiers: [1, 2], isFlooded: true,
  sockets: [[-1, 4, WALL_WEST], [5, 9, WALL_SOUTH]], grow: { fill: 0.4, isLevel: true, rise: 1.4 } });
// Where Crew 2 stopped: a table and what they left round it, on a patch of floor that is always there. The
// table top is a place for a spool or a keycard.
ROOM_CATALOGUE.cavernCamp = createGrownRoomDefinition({ name: 'SURVEY CAMP', rect: [0, 0, 10, 8], ceiling: 2.8, tiers: [0, 1, 2],
  // (The patch is a tile wider all round than what stands on it: so whichever way the cave comes to it, there is a way round the table.)
  sockets: [[5, 8, WALL_SOUTH], [10, 3, WALL_EAST]], itemSpot: [4.6, 0.77, 3.35], grow: { fill: 0.42, keepOpen: [[2, 1, 8, 6]] },
  furnishCamp: function (random) {
    addTable(4.6, 3.35, 0, 1.4, 0.7, 0.76);
    addChair(4.2, 4.15, Math.PI, false);
    addChair(5.5, 4.2, Math.PI + 0.6, true);
    addCrate(3.45, 2.5, 0.3, 0.3, 0);
    addTripod(6.3, 2.55);
    addTargetBoard(6.4, 4.4, -0.7);
  } });

// ---------------------------------------------------------------------------
// Passages that wind
// ---------------------------------------------------------------------------

// Digs a corridor of the plan as a way through the band of rock it was planned as. Everything else is dug by
// now, so where it has to be open is known: wherever a tile beside the band is open, or will hold a door.
function carveWindingPassage(corridor, plan) {
  const random = createGrowthRandom(plan.seed, 5000 + plan.rooms.indexOf(corridor));
  const runsAlongX = corridor.runsAlongX;
  const length = runsAlongX ? corridor.endX - corridor.startX : corridor.endZ - corridor.startZ;
  const width = runsAlongX ? corridor.endZ - corridor.startZ : corridor.endX - corridor.startX;
  const tileAt = function (along, lane) { return runsAlongX ? [corridor.startX + along, corridor.startZ + lane] : [corridor.startX + lane, corridor.startZ + along]; };
  const doorTiles = {};
  for (const door of plan.doors) doorTiles[tileIndexAt(door.tileX, door.tileZ)] = true;
  const open = [], isOpenedOnto = [];
  for (let along = 0; along < length; along++) { open.push(new Uint8Array(width)); isOpenedOnto.push(new Uint8Array(width)); }
  let firstLane = -1;
  for (let along = 0; along < length; along++) {
    for (let lane = 0; lane < width; lane++) {
      const tile = tileAt(along, lane);
      for (const step of WALL_DIRECTIONS) {
        const besideX = tile[0] + step[0], besideZ = tile[1] + step[1];
        if (besideX >= corridor.startX && besideX < corridor.endX && besideZ >= corridor.startZ && besideZ < corridor.endZ) continue;
        if (isTileOpenAt(besideX, besideZ) || doorTiles[tileIndexAt(besideX, besideZ)]) isOpenedOnto[along][lane] = 1;
      }
      if (isOpenedOnto[along][lane] && along === 0 && firstLane < 0) firstLane = lane;
    }
  }
  // The way: it keeps to a lane and drifts to the next now and then. Mostly it is two tiles wide; now and then
  // it pinches to one, or opens out to all the band has. (TWEAK: the two numbers are how often.)
  let lane = firstLane >= 0 ? firstLane : Math.floor(width / 2);
  for (let along = 0; along < length; along++) {
    open[along][lane] = 1;
    const howWide = random();
    if (howWide > 0.25) open[along][lane > 0 && (lane === width - 1 || random() < 0.5) ? lane - 1 : lane + 1] = 1;
    if (howWide > 0.82) open[along].fill(1);
    if (along === length - 1) break;
    const drift = random();
    const next = drift < 0.3 && lane > 0 ? lane - 1 : (drift > 0.7 && lane < width - 1 ? lane + 1 : lane);
    open[along][next] = 1; // (the turn is made on this tile, so that the way is never joined only corner to corner)
    lane = next;
  }
  // And a way from it to everything that opens onto the band.
  for (let along = 0; along < length; along++) {
    for (let target = 0; target < width; target++) {
      if (!isOpenedOnto[along][target] || open[along][target]) continue;
      let nearest = -1;
      for (let other = 0; other < width; other++) if (open[along][other] && (nearest < 0 || Math.abs(other - target) < Math.abs(nearest - target))) nearest = other;
      for (let between = Math.min(target, nearest); between <= Math.max(target, nearest); between++) open[along][between] = 1;
    }
  }
  // Its roof goes up and down along the way. Where a door is, it is high enough for the door and its lettering.
  const offset = random() * 500;
  for (let along = 0; along < length; along++) {
    let ceiling = roundDesignedHeight(corridor.ceiling - 0.5 + smoothNoise(along * 0.33 + offset, 3.3) * 1.1);
    let hasOpening = false;
    for (let near = Math.max(0, along - 1); near <= Math.min(length - 1, along + 1); near++) for (let other = 0; other < width; other++) if (isOpenedOnto[near][other]) hasOpening = true;
    ceiling = Math.max(hasOpening ? 2.7 : 2.2, ceiling);
    for (let other = 0; other < width; other++) {
      if (!open[along][other]) continue;
      const tile = tileAt(along, other);
      carveTile(tile[0], tile[1], 0, ceiling, ZONE_GENERATED_ROOM);
    }
  }
}

// What a winding passage has in it: what hangs from its roof and what has come down from it. All of it can be
// walked through or under.
function furnishWindingPassage(corridor, random, location) {
  for (let tileZ = corridor.startZ; tileZ < corridor.endZ; tileZ++) {
    for (let tileX = corridor.startX; tileX < corridor.endX; tileX++) {
      if (!isTileOpenAt(tileX, tileZ)) continue;
      const headroom = tileCeilingHeight[tileIndexAt(tileX, tileZ)] - tileFloorHeight[tileIndexAt(tileX, tileZ)];
      if (random() < 0.16 && headroom > 2.3) addStalactite(tileX + 0.2 + random() * 0.6, tileZ + 0.2 + random() * 0.6, headroom, Math.min(headroom - 1.95, 0.2 + random() * 0.5), 0.06 + random() * 0.07);
      if (random() < 0.12) {
        const radius = 0.07 + random() * 0.12;
        addSphereProp(tileX + 0.2 + random() * 0.6, radius * 0.5, tileZ + 0.2 + random() * 0.6, radius, CLUTTER);
      }
    }
  }
  if (random() < 0.4) {
    const text = location.scrawls[Math.floor(random() * location.scrawls.length)];
    const wall = corridor.runsAlongX ? WALL_NORTH : WALL_WEST;
    const firstTile = findBlankCorridorWall(corridor, wall, 5);
    if (firstTile >= 0) addCorridorWallSign(corridor, wall, firstTile, 5, text, { width: 4.4, height: 0.5, centerY: 1.45, isScrawled: true });
  }
}
