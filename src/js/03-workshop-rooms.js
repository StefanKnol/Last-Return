// ---------------------------------------------------------------------------
// Rooms made in the workshop (`npm run dev`, then "Workshop" on the title screen).
//
// Such a room is not written as code. It is a list of things from the catalogue below (a table here,
// a pipe there), saved as one file in src/rooms/ and packed into the page by build.js. This file turns
// each of them into an ordinary entry of ROOM_CATALOGUE (03-levelgen.js), so a generated station can
// use it like any other extra room.
//
// In a room file, positions are metres from the room's north-west corner: x runs east, z runs south.
// Angles are degrees, clockwise seen from above. Heights are metres above the room's floor.
//
// A room is a plain box, `width` by `depth` under one `ceiling`, unless its file gives it a shape: see
// "The shape of a room" below.
// ---------------------------------------------------------------------------

const ROOM_WALL_NAMES = ['north', 'east', 'south', 'west']; // in the order of WALL_NORTH .. WALL_WEST

// TWEAK: how small and how large a workshop room may be, in tiles (metres), and how low and high its ceiling.
// The last four are about single tiles of a room with a shape: how far below and above the room's own floor the
// floor of a tile may be, the least room there is between a tile's floor and its ceiling (enough to walk under
// with anything that can be carried), and how high above the room's floor a tile's ceiling may be.
const DESIGNED_ROOM_LIMITS = { minimumSize: 3, maximumSize: 24, minimumCeiling: 2.4, maximumCeiling: 9,
  lowestFloor: -4, highestFloor: 4, minimumHeadroom: 1.5, highestTileCeiling: 13 };

const ROOM_SURFACE_CHOICES = [['plain', 'Plain'], ['metal', 'Metal'], ['reflective', 'Reflective (like lettering)']];
const ROOM_SURFACE_CLASSES = { plain: SURFACE_PROP, metal: SURFACE_METAL, reflective: SURFACE_SIGN };

function numberField(key, label, defaultValue, minimum, maximum, step) {
  return { key: key, label: label, kind: 'number', defaultValue: defaultValue, minimum: minimum, maximum: maximum, step: step };
}
function booleanField(key, label, defaultValue) {
  return { key: key, label: label, kind: 'boolean', defaultValue: defaultValue };
}
function choiceField(key, label, defaultValue, choices) {
  return { key: key, label: label, kind: 'choice', defaultValue: defaultValue, choices: choices };
}
function textField(key, label, defaultValue) {
  return { key: key, label: label, kind: 'text', defaultValue: defaultValue };
}

function designedShapeOptions(item) {
  return { surfaceClass: ROOM_SURFACE_CLASSES[item.surface], blocksMovement: item.isSolid };
}

// Everything a workshop room can contain.
//   label, group  what the workshop calls it, and which heading it is listed under
//   placement     'floor' (stands somewhere: x, z, angle), 'wall' (lettering) or 'tiles' (a rectangle of floor tiles)
//   angleStep     0: turning it changes nothing, 90: quarter turns only, anything else: any angle
//   fields        the numbers and switches it has besides its position; `defaultValue` is used when a file leaves one out
//   build         puts it in the world. `context` holds: yaw (radians), random, ceiling, roomName, room
// To add something: write its builder next to the others in 02-world.js, then add an entry here.
const ROOM_ITEM_TYPES = {
  // ---- furniture ----
  table: { label: 'Table', group: 'Furniture', placement: 'floor', angleStep: 5,
    fields: [numberField('lengthX', 'Width', 1.4, 0.4, 5, 0.1), numberField('lengthZ', 'Depth', 0.7, 0.3, 3, 0.1), numberField('height', 'Height', 0.76, 0.3, 1.3, 0.02)],
    build: function (item, context) { addTable(item.x, item.z, context.yaw, item.lengthX, item.lengthZ, item.height); } },
  roundTable: { label: 'Round table', group: 'Furniture', placement: 'floor', angleStep: 0,
    fields: [numberField('radius', 'Radius', 0.55, 0.25, 1.5, 0.05)],
    build: function (item) { addRoundTable(item.x, item.z, item.radius); } },
  chair: { label: 'Chair', group: 'Furniture', placement: 'floor', angleStep: 5,
    fields: [booleanField('isToppled', 'Knocked over', false)],
    build: function (item, context) { addChair(item.x, item.z, context.yaw, item.isToppled); } },
  locker: { label: 'Locker', group: 'Furniture', placement: 'floor', angleStep: 5,
    fields: [booleanField('isDoorOpen', 'Door hanging open', false)],
    build: function (item, context) { addLocker(item.x, item.z, context.yaw, item.isDoorOpen); } },
  bunkBed: { label: 'Bunk bed', group: 'Furniture', placement: 'floor', angleStep: 90, fields: [],
    build: function (item) { addBunkBed(item.x - 0.45, item.z - 1.0, false); } },
  gurney: { label: 'Gurney', group: 'Furniture', placement: 'floor', angleStep: 5,
    fields: [booleanField('hasCoveredShape', 'Something under a sheet', false)],
    build: function (item, context) { addGurney(item.x, item.z, context.yaw, item.hasCoveredShape); } },
  shelfRack: { label: 'Shelf rack', group: 'Furniture', placement: 'floor', angleStep: 90,
    fields: [numberField('length', 'Length', 2.5, 0.8, 12, 0.1), numberField('height', 'Height', 2.3, 0.7, 2.3, 0.05), numberField('fillAmount', 'How full (0 to 1)', 0.6, 0, 1, 0.05)],
    build: function (item, context) { addShelfRackAlongZ(item.x, item.z - item.length / 2, item.z + item.length / 2, item.height, context.random, item.fillAmount); } },
  hangingSuit: { label: 'Suit on a hook', group: 'Furniture', placement: 'floor', angleStep: 5, fields: [],
    build: function (item, context) { addHangingSuit(item.x, item.z, context.yaw); } },

  // ---- stores ----
  crate: { label: 'Crate', group: 'Stores', placement: 'floor', angleStep: 5,
    fields: [numberField('size', 'Size', 0.7, 0.3, 1.6, 0.05), numberField('baseHeight', 'Stands on something this high', 0, 0, 3, 0.05)],
    build: function (item, context) { addCrate(item.x, item.z, item.size / 2, context.yaw, item.baseHeight); } },
  crateStack: { label: 'Stack of crates (random)', group: 'Stores', placement: 'floor', angleStep: 0, fields: [],
    build: function (item, context) { addCrateStack(item.x, item.z, context.random); } },
  barrel: { label: 'Barrel', group: 'Stores', placement: 'floor', angleStep: 0, fields: [],
    build: function (item) { addBarrel(item.x, item.z); } },

  // ---- machinery ----
  tank: { label: 'Tank with ladder', group: 'Machinery', placement: 'floor', angleStep: 90,
    fields: [numberField('radius', 'Radius', 1.2, 0.4, 3, 0.05), numberField('height', 'Height', 3, 1, 8, 0.1)],
    build: function (item) { addTank(item.x, item.z, item.radius, item.height); } },
  pumpUnit: { label: 'Pump unit', group: 'Machinery', placement: 'floor', angleStep: 90, fields: [],
    build: function (item, context) { addPumpUnit(item.x, item.z, context.ceiling); } },
  pipe: { label: 'Pipe (lying)', group: 'Machinery', placement: 'floor', angleStep: 90,
    fields: [numberField('length', 'Length', 4, 0.3, 24, 0.1), numberField('height', 'Height of its middle', 2.4, 0.05, 8.5, 0.05), numberField('radius', 'Radius', 0.1, 0.02, 0.5, 0.01)],
    build: function (item) { addPipeAlongX(item.x - item.length / 2, item.x + item.length / 2, item.height, item.z, item.radius); } },
  verticalPipe: { label: 'Pipe (upright)', group: 'Machinery', placement: 'floor', angleStep: 0,
    fields: [numberField('bottom', 'Bottom', 0, 0, 8, 0.05), numberField('top', 'Top', 2.6, 0.1, 9, 0.05), numberField('radius', 'Radius', 0.07, 0.01, 0.5, 0.01), booleanField('isSolid', 'Blocks the way', false)],
    build: function (item) { addVerticalPipe(item.x, item.z, Math.min(item.bottom, item.top), Math.max(item.bottom, item.top), item.radius, item.isSolid); } },
  ceilingLamp: { label: 'Ceiling lamp', group: 'Machinery', placement: 'floor', angleStep: 90, fields: [],
    build: function (item, context) { addCeilingLamp(item.x, item.z, context.ceiling, true); } },

  // ---- survey gear ----
  tripod: { label: 'Scanner tripod', group: 'Survey gear', placement: 'floor', angleStep: 0, fields: [],
    build: function (item) { addTripod(item.x, item.z); } },
  targetBoard: { label: 'Target board', group: 'Survey gear', placement: 'floor', angleStep: 5, fields: [],
    build: function (item, context) { addTargetBoard(item.x, item.z, context.yaw); } },
  registrationSphere: { label: 'Registration sphere', group: 'Survey gear', placement: 'floor', angleStep: 0, fields: [],
    build: function (item) { addRegistrationSphere(item.x, item.z); } },

  // ---- what a mine has ----
  timberSet: { label: 'Timber set (two posts and a cap)', group: 'Mine', placement: 'floor', angleStep: 5,
    fields: [numberField('span', 'Width', 2, 1, 8, 0.1), numberField('height', 'Height (no higher than the roof)', 2.4, 1.6, 8, 0.05)],
    build: function (item, context) { addTimberSet(item.x, item.z, context.yaw, item.span, Math.min(item.height, context.ceiling)); } },
  timberProp: { label: 'Timber prop (floor to roof)', group: 'Mine', placement: 'floor', angleStep: 0, fields: [],
    build: function (item, context) { addTimberProp(item.x, item.z, context.ceiling); } },
  railTrack: { label: 'Track', group: 'Mine', placement: 'floor', angleStep: 5,
    fields: [numberField('length', 'Length', 4, 0.6, 24, 0.1)],
    build: function (item, context) { addRailTrack(item.x, item.z, context.yaw, item.length); } },
  mineCart: { label: 'Tub (mine cart)', group: 'Mine', placement: 'floor', angleStep: 5,
    fields: [booleanField('isTipped', 'On its side', false)],
    build: function (item, context) { addMineCart(item.x, item.z, context.yaw, item.isTipped); } },
  rockPile: { label: 'Heap of rock (random)', group: 'Mine', placement: 'floor', angleStep: 0,
    fields: [numberField('size', 'Size', 1, 0.4, 2.5, 0.05)],
    build: function (item, context) { addRockPile(item.x, item.z, item.size, context.random); } },
  ladder: { label: 'Ladder', group: 'Mine', placement: 'floor', angleStep: 5,
    fields: [numberField('height', 'Height', 2.4, 1, 8, 0.1)],
    build: function (item, context) { addLadder(item.x, item.z, context.yaw, item.height); } },
  hangingLamp: { label: 'Lamp on a cable', group: 'Mine', placement: 'floor', angleStep: 0,
    fields: [numberField('drop', 'How far it hangs down', 0.4, 0.1, 3, 0.05)],
    build: function (item, context) { addHangingLamp(item.x, item.z, context.ceiling, Math.min(item.drop, context.ceiling - 0.3)); } },

  // ---- what a cave has ----
  stalagmite: { label: 'Stalagmite', group: 'Cave', placement: 'floor', angleStep: 0,
    fields: [numberField('height', 'Height (no higher than the roof)', 1.2, 0.8, 4, 0.05), numberField('radius', 'How thick at the foot', 0.22, 0.1, 0.6, 0.01)],
    build: function (item, context) { addStalagmite(item.x, item.z, Math.min(item.height, context.ceiling - 0.1), item.radius); } },
  stalactite: { label: 'Stalactite', group: 'Cave', placement: 'floor', angleStep: 0,
    fields: [numberField('length', 'Length', 0.6, 0.2, 3, 0.05), numberField('radius', 'How thick at the roof', 0.14, 0.05, 0.5, 0.01)],
    build: function (item, context) { addStalactite(item.x, item.z, context.ceiling, Math.min(item.length, context.ceiling - 0.3), item.radius); } },

  // ---- plain shapes, for anything the list above does not have ----
  box: { label: 'Box', group: 'Shapes', placement: 'floor', angleStep: 5,
    fields: [numberField('sizeX', 'Width', 1, 0.02, 24, 0.05), numberField('sizeZ', 'Depth', 1, 0.02, 24, 0.05), numberField('sizeY', 'Height', 1, 0.02, 9, 0.05),
      numberField('bottom', 'Underside above the floor', 0, 0, 8.9, 0.05), choiceField('surface', 'Surface', 'plain', ROOM_SURFACE_CHOICES), booleanField('isSolid', 'Blocks the way', true)],
    build: function (item, context) {
      const options = designedShapeOptions(item);
      options.yaw = context.yaw;
      addBoxProp(item.x, item.bottom + item.sizeY / 2, item.z, item.sizeX / 2, item.sizeY / 2, item.sizeZ / 2, options);
    } },
  cylinder: { label: 'Cylinder (upright)', group: 'Shapes', placement: 'floor', angleStep: 0,
    fields: [numberField('radius', 'Radius', 0.4, 0.01, 4, 0.01), numberField('sizeY', 'Height', 1, 0.02, 9, 0.05),
      numberField('bottom', 'Underside above the floor', 0, 0, 8.9, 0.05), choiceField('surface', 'Surface', 'metal', ROOM_SURFACE_CHOICES), booleanField('isSolid', 'Blocks the way', true)],
    build: function (item) { addCylinderProp(AXIS_Y, item.x, item.bottom + item.sizeY / 2, item.z, item.radius, item.sizeY / 2, designedShapeOptions(item)); } },
  sphere: { label: 'Sphere', group: 'Shapes', placement: 'floor', angleStep: 0,
    fields: [numberField('radius', 'Radius', 0.3, 0.02, 3, 0.01), numberField('centerHeight', 'Height of its middle', 1, 0, 8.9, 0.05),
      choiceField('surface', 'Surface', 'plain', ROOM_SURFACE_CHOICES), booleanField('isSolid', 'Blocks the way', false)],
    build: function (item) { addSphereProp(item.x, item.centerHeight, item.z, item.radius, designedShapeOptions(item)); } },

  // ---- walls and floor ----
  sign: { label: 'Wall lettering', group: 'Walls and floor', placement: 'wall',
    // {name} in the text becomes the room's name in the station it ends up in ("WORKSHOP 2").
    fields: [textField('text', 'Text ({name} = the room\'s name)', '{name}'), choiceField('wall', 'Wall', 'north', [['north', 'North'], ['east', 'East'], ['south', 'South'], ['west', 'West']]),
      numberField('along', 'Along the wall', 2, 0, 24, 0.1), numberField('centerY', 'Height of its middle', 2.3, 0.2, 8.5, 0.05),
      numberField('width', 'Width', 2, 0.3, 10, 0.1), numberField('height', 'Height', 0.26, 0.08, 1.2, 0.02), booleanField('isScrawled', 'Scratched by hand', false)],
    build: function (item, context) {
      const text = item.text.split('{name}').join(context.roomName);
      if (text.trim() === '') return;
      const spot = getDesignedSignSpot(context.room, item, context.shape);
      addWallSign(text, spot.tileX, spot.tileZ, spot.wall, { width: item.width, height: item.height, centerY: item.centerY, alongOffset: spot.alongOffset, isScrawled: item.isScrawled });
    } },
  floorArea: { label: 'Floor: water or hazard stripes', group: 'Walls and floor', placement: 'tiles',
    fields: [choiceField('kind', 'What', 'water', [['water', 'Standing water'], ['hazard', 'Hazard stripes']]), numberField('sizeX', 'Tiles east', 2, 1, 24, 1), numberField('sizeZ', 'Tiles south', 2, 1, 24, 1)],
    build: function (item) {
      setTileFlagInRectangle(item.x, item.z, item.x + item.sizeX, item.z + item.sizeZ, item.kind === 'hazard' ? TILE_FLAG_HAZARD : TILE_FLAG_WATER);
    } }
};

// Which tile and wall a piece of lettering is on, and how far along that tile's wall its middle is.
// In a room with a shape (`shape`: what resolveDesignedRoomShape made of it) the wall may be rock standing in
// from the edge of the room: the lettering is on the face of that, on the first open tile going in from the
// edge. `inset` is how many tiles in that is.
function getDesignedSignSpot(room, item, shape) {
  const wall = Math.max(0, ROOM_WALL_NAMES.indexOf(item.wall));
  const runsAlongX = wall === WALL_NORTH || wall === WALL_SOUTH;
  const wallLength = runsAlongX ? room.width : room.depth;
  const along = clampNumber(item.along, 0.05, wallLength - 0.05);
  const tile = Math.min(wallLength - 1, Math.floor(along));
  const spot = {
    wall: wall, along: along, alongOffset: along - (tile + 0.5), inset: 0,
    tileX: runsAlongX ? tile : (wall === WALL_WEST ? 0 : room.width - 1),
    tileZ: runsAlongX ? (wall === WALL_NORTH ? 0 : room.depth - 1) : tile
  };
  if (shape) {
    const inward = WALL_DIRECTIONS[(wall + 2) % 4];
    for (let inset = 0; inset < (runsAlongX ? room.depth : room.width); inset++) {
      const tileX = spot.tileX + inward[0] * inset, tileZ = spot.tileZ + inward[1] * inset;
      if (!shape.isOpen[tileZ * room.width + tileX]) continue;
      spot.tileX = tileX; spot.tileZ = tileZ; spot.inset = inset;
      break;
    }
  }
  return spot;
}

function createDesignedItem(typeKey, x, z) {
  const type = ROOM_ITEM_TYPES[typeKey];
  const item = { type: typeKey };
  if (type.placement !== 'wall') { item.x = x; item.z = z; }
  if (type.placement === 'floor' && type.angleStep !== 0) item.angle = 0;
  for (const field of type.fields) item[field.key] = field.defaultValue;
  return item;
}

function normalizeDesignedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(number)) return fallback;
  return clampNumber(number, minimum, maximum);
}

// Copies the `fields` of `source` into `target`, each present, in range and of the right kind.
function normalizeDesignedFields(target, source, fields) {
  for (const field of fields) {
    const value = source[field.key];
    if (field.kind === 'number') {
      target[field.key] = normalizeDesignedNumber(value, field.defaultValue, field.minimum, field.maximum);
      if (field.step === 1) target[field.key] = Math.round(target[field.key]);
    } else if (field.kind === 'boolean') {
      target[field.key] = value === undefined ? field.defaultValue : value === true;
    } else if (field.kind === 'choice') {
      const isKnown = field.choices.some(function (choice) { return choice[0] === value; });
      target[field.key] = isKnown ? value : field.defaultValue;
    } else {
      target[field.key] = typeof value === 'string' ? value.slice(0, 60) : field.defaultValue;
    }
  }
  return target;
}

// ---------------------------------------------------------------------------
// The basic forms that things made in the workshop are put together from: a loose object (08-workshop-objects.js)
// and what a creature has on its bones (04-workshop-creatures.js). A part is a box, a ball, or a rod from one
// place to another.
// ---------------------------------------------------------------------------

// The parts that are a rod from one place to another, `radius` thick: with round ends, with flat ends, and
// flat at `from` with a point at `to`.
const DESIGNED_ROD_SHAPES = ['capsule', 'cylinder', 'cone'];

// A place in a thing: three numbers within `reach` of its origin, to the tenth of a millimetre.
function normalizeDesignedPlace(source, fallback, reach) {
  return [0, 1, 2].map(function (axis) {
    return Math.round(normalizeDesignedNumber(Array.isArray(source) ? source[axis] : undefined, fallback[axis], -reach, reach) * 10000) / 10000;
  });
}

// Returns a clean copy of one part, or null if it is not a box, a ball, a capsule, a cylinder or a cone.
// `limits` says how far from the origin a part may be and how thin and thick: { reach, minimumRadius,
// maximumRadius, minimumHalf, maximumHalf }.
function normalizeDesignedPart(source, limits) {
  if (!source || typeof source !== 'object') return null;
  const radius = function (fallback) { return Math.round(normalizeDesignedNumber(source.radius, fallback, limits.minimumRadius, limits.maximumRadius) * 10000) / 10000; };
  if (source.shape === 'box') {
    return { shape: 'box', center: normalizeDesignedPlace(source.center, [0, 0, 0], limits.reach), half: [0, 1, 2].map(function (axis) {
      return Math.round(normalizeDesignedNumber(Array.isArray(source.half) ? source.half[axis] : undefined, 0.1, limits.minimumHalf, limits.maximumHalf) * 10000) / 10000;
    }) };
  }
  if (source.shape === 'ball') return { shape: 'ball', center: normalizeDesignedPlace(source.center, [0, 0, 0], limits.reach), radius: radius(0.08) };
  if (DESIGNED_ROD_SHAPES.indexOf(source.shape) < 0) return null;
  const part = { shape: source.shape, from: normalizeDesignedPlace(source.from, [0, -0.1, 0], limits.reach), to: normalizeDesignedPlace(source.to, [0, 0.1, 0], limits.reach), radius: radius(source.shape === 'cone' ? 0.08 : 0.05) };
  // A rod with no length has no direction to be drawn in: it gets a little.
  if (Math.abs(part.to[0] - part.from[0]) + Math.abs(part.to[1] - part.from[1]) + Math.abs(part.to[2] - part.from[2]) < 0.001) {
    part.to[1] = part.from[1] + (part.from[1] > 0 ? -0.02 : 0.02);
  }
  return part;
}

// Returns a clean copy of one item, or null if it is not something the catalogue above knows.
function normalizeDesignedItem(source, room) {
  if (!source || !ROOM_ITEM_TYPES[source.type]) return null;
  const type = ROOM_ITEM_TYPES[source.type];
  const item = { type: source.type };
  if (type.placement === 'floor') {
    item.x = normalizeDesignedNumber(source.x, room.width / 2, 0, room.width);
    item.z = normalizeDesignedNumber(source.z, room.depth / 2, 0, room.depth);
    if (type.angleStep !== 0) {
      item.angle = ((Math.round(normalizeDesignedNumber(source.angle, 0, -3600, 3600)) % 360) + 360) % 360;
      if (type.angleStep === 90) item.angle = Math.round(item.angle / 90) % 4 * 90;
    }
  } else if (type.placement === 'tiles') {
    item.x = Math.floor(normalizeDesignedNumber(source.x, 0, 0, room.width - 1));
    item.z = Math.floor(normalizeDesignedNumber(source.z, 0, 0, room.depth - 1));
  }
  return normalizeDesignedFields(item, source, type.fields);
}

// Returns a clean copy of a room file: everything present, in range, and of the right kind.
// A file written by hand may leave things out; whatever is missing gets its default.
function normalizeDesignedRoom(source, key) {
  source = source && typeof source === 'object' ? source : {};
  const limits = DESIGNED_ROOM_LIMITS;
  const room = {
    key: key,
    name: (typeof source.name === 'string' && source.name.trim() !== '' ? source.name.trim() : key).toUpperCase().slice(0, 24),
    width: Math.round(normalizeDesignedNumber(source.width, 8, limits.minimumSize, limits.maximumSize)),
    depth: Math.round(normalizeDesignedNumber(source.depth, 6, limits.minimumSize, limits.maximumSize)),
    ceiling: normalizeDesignedNumber(source.ceiling, 2.8, limits.minimumCeiling, limits.maximumCeiling),
    // 0: can be reached at once, 1: behind a powered door, 2: behind the keycard. A room may allow several.
    tiers: [],
    isFlooded: source.isFlooded === true,
    // Off: the room exists (the workshop can open it) but no station is ever built with it.
    useInStations: source.useInStations === true,
    // Where a station must be to have this room: keys of LOCATIONS (03-locations.js). One at least.
    locations: [],
    // What it is made of: a key of LOOK_KEYS (02-world.js), or '' for whatever the place it is in is made of.
    look: typeof source.look === 'string' && Object.prototype.hasOwnProperty.call(LOOK_KEYS, source.look) ? source.look : '',
    doors: [],
    // The room's shape, if it is not a plain box: see "The shape of a room" below.
    tiles: null,
    tileKinds: {},
    itemSpot: null,
    items: []
  };
  for (const tier of Array.isArray(source.tiers) ? source.tiers : []) {
    if ((tier === 0 || tier === 1 || tier === 2) && room.tiers.indexOf(tier) < 0) room.tiers.push(tier);
  }
  if (room.tiers.length === 0) room.tiers.push(0);
  // (In the order the locations are listed in, whatever order the file has them in.)
  for (const locationKey in LOCATIONS) if (Array.isArray(source.locations) && source.locations.indexOf(locationKey) >= 0) room.locations.push(locationKey);
  if (room.locations.length === 0) room.locations.push(DEFAULT_LOCATION_KEY); // a file from before there were locations
  // Doors: which wall, and how many tiles along it (counted from its west or north end).
  for (const door of Array.isArray(source.doors) ? source.doors : []) {
    const wall = ROOM_WALL_NAMES.indexOf(door && door.wall);
    if (wall < 0) continue;
    const wallLength = wall === WALL_NORTH || wall === WALL_SOUTH ? room.width : room.depth;
    const at = Math.round(normalizeDesignedNumber(door.at, Math.floor(wallLength / 2), 0, wallLength - 1));
    if (!room.doors.some(function (other) { return other.wall === door.wall && other.at === at; })) room.doors.push({ wall: door.wall, at: at });
  }
  if (room.doors.length === 0) room.doors.push({ wall: 'south', at: Math.floor(room.width / 2) });
  normalizeDesignedTiles(room, source);
  // A table top (or anything else at hand height) where the first spool or the keycard may be left.
  if (source.itemSpot && typeof source.itemSpot === 'object') {
    room.itemSpot = {
      x: normalizeDesignedNumber(source.itemSpot.x, room.width / 2, 0, room.width),
      y: normalizeDesignedNumber(source.itemSpot.y, 0.77, 0, 2),
      z: normalizeDesignedNumber(source.itemSpot.z, room.depth / 2, 0, room.depth)
    };
  }
  for (const sourceItem of Array.isArray(source.items) ? source.items : []) {
    const item = normalizeDesignedItem(sourceItem, room);
    if (item) room.items.push(item);
  }
  return room;
}

// ---------------------------------------------------------------------------
// The shape of a room
//
// A room file may hold `tiles`: one line of text for every row of the room's tiles, the north row first, one
// character for every tile, the west tile first.
//   .         plain floor: the room's own floor and ceiling
//   #         solid rock
//   a letter  a tile with a floor or a ceiling of its own. What they are is in `tileKinds`, by letter:
//             { "a": { "floor": 0.4 }, "b": { "floor": -0.8, "ceiling": 2.1 } }. Both are heights above the
//             room's own floor, in steps of 5 cm. A kind that leaves `ceiling` out has the room's ceiling.
// A file without `tiles` is a plain box, as every room was before rooms had shapes.
//
// The rules that keep a station with such a room in it one that can be finished:
//   - The tile just inside every door is plain floor, whatever the file says.
//   - A step between two tiles can be walked if it is no taller than DESIGNED_TALLEST_STEP. Floor that cannot
//     be walked to from the first door is not built: it stays rock, so that nothing can be left where nobody
//     can come. (The file keeps it as it was drawn. Give it a way up and it is there.)
//   - A door that cannot be walked to from the first door is not a doorway of the room.
//   - There is always room to walk under a ceiling (DESIGNED_ROOM_LIMITS.minimumHeadroom).
// ---------------------------------------------------------------------------

const DESIGNED_TILE_FLOOR = '.', DESIGNED_TILE_ROCK = '#';
const DESIGNED_TILE_KIND_LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

// The tallest step from one tile to the next that a room counts on being walked. The world's own limit is
// MAXIMUM_STEP_HEIGHT, but the world keeps its heights as rounded numbers, and whether a step of exactly that
// passes depends on how high the room itself ends up. Heights here go in steps of 5 cm: one step under the
// limit always passes.
const DESIGNED_TALLEST_STEP = 0.4;

// Heights of tiles go in steps of 5 cm.
function roundDesignedHeight(value) {
  return Math.round(value * 20) / 20 + 0; // (+ 0: no "minus nought")
}

// The tile just inside a doorway, in the room's own coordinates.
function getDesignedDoorInsideTile(room, door) {
  if (door.wall === 'north') return [door.at, 0];
  if (door.wall === 'south') return [door.at, room.depth - 1];
  if (door.wall === 'west') return [0, door.at];
  return [room.width - 1, door.at];
}

// A clean copy of one entry of `tileKinds`.
function normalizeDesignedTileKind(source) {
  const limits = DESIGNED_ROOM_LIMITS;
  source = source && typeof source === 'object' ? source : {};
  const kind = { floor: roundDesignedHeight(normalizeDesignedNumber(source.floor, 0, limits.lowestFloor, limits.highestFloor)) };
  const ceiling = normalizeDesignedNumber(source.ceiling, NaN, kind.floor + limits.minimumHeadroom, limits.highestTileCeiling);
  if (Number.isFinite(ceiling)) kind.ceiling = roundDesignedHeight(ceiling);
  return kind;
}

// The floor and ceiling a character of `tiles` stands for, or null if it stands for rock.
function getDesignedTileKind(room, character) {
  if (character === DESIGNED_TILE_ROCK) return null;
  return room.tileKinds[character] || { floor: 0 };
}

// The character for a tile with this floor and ceiling (`ceiling` undefined: the room's own). A letter that
// already stands for it, or else a new one, which is added to room.tileKinds. Returns '' if every letter is taken.
function findDesignedTileCharacter(room, floor, ceiling) {
  const wanted = normalizeDesignedTileKind({ floor: floor, ceiling: ceiling });
  if (wanted.floor === 0 && wanted.ceiling === undefined) return DESIGNED_TILE_FLOOR;
  for (const letter in room.tileKinds) {
    if (room.tileKinds[letter].floor === wanted.floor && room.tileKinds[letter].ceiling === wanted.ceiling) return letter;
  }
  for (const letter of DESIGNED_TILE_KIND_LETTERS) {
    if (room.tileKinds[letter]) continue;
    room.tileKinds[letter] = wanted;
    return letter;
  }
  return '';
}

// Fills in room.tiles and room.tileKinds from a room file: every row present and as long as the room is wide,
// every character one that means something, only the kinds that are used. A room whose tiles are all plain
// floor has no `tiles` at all: it is a box. (The room's size and doors must be settled before this is called.)
function normalizeDesignedTiles(room, source) {
  room.tiles = null;
  room.tileKinds = {};
  if (!Array.isArray(source.tiles)) return;
  const sourceKinds = source.tileKinds && typeof source.tileKinds === 'object' ? source.tileKinds : {};
  const kinds = {};
  const rows = [];
  for (let tileZ = 0; tileZ < room.depth; tileZ++) {
    const sourceRow = typeof source.tiles[tileZ] === 'string' ? source.tiles[tileZ] : '';
    const row = [];
    for (let tileX = 0; tileX < room.width; tileX++) {
      let character = sourceRow.charAt(tileX) || DESIGNED_TILE_FLOOR;
      if (character !== DESIGNED_TILE_ROCK && character !== DESIGNED_TILE_FLOOR) {
        if (DESIGNED_TILE_KIND_LETTERS.indexOf(character) < 0 || !Object.prototype.hasOwnProperty.call(sourceKinds, character)) character = DESIGNED_TILE_FLOOR;
        else {
          if (!kinds[character]) kinds[character] = normalizeDesignedTileKind(sourceKinds[character]);
          if (kinds[character].floor === 0 && kinds[character].ceiling === undefined) character = DESIGNED_TILE_FLOOR;
        }
      }
      row.push(character);
    }
    rows.push(row);
  }
  for (const door of room.doors) {
    const tile = getDesignedDoorInsideTile(room, door);
    rows[tile[1]][tile[0]] = DESIGNED_TILE_FLOOR;
  }
  const used = {};
  let isPlainBox = true;
  for (const row of rows) {
    for (const character of row) {
      if (character === DESIGNED_TILE_FLOOR) continue;
      isPlainBox = false;
      if (character !== DESIGNED_TILE_ROCK) used[character] = true;
    }
  }
  if (isPlainBox) return;
  room.tiles = rows.map(function (row) { return row.join(''); });
  for (const letter of Object.keys(used).sort()) room.tileKinds[letter] = kinds[letter];
}

// What a room's tiles come to when it is built. Null for a plain box; otherwise, for every tile (row by row,
// index = tileZ * width + tileX):
//   isOpen    1 if it is carved, 0 if it is rock
//   floor, ceiling   of the carved ones, in metres above the room's own floor
//   isSealed  1 for floor the file has that is not built, because nobody could walk to it (see the rules above)
// and `sealedCount`, how many of those there are, and `cutOffDoors`, the indexes of the doors that cannot be
// walked to from the first door.
function resolveDesignedRoomShape(room) {
  if (!room.tiles) return null;
  const limits = DESIGNED_ROOM_LIMITS, width = room.width, depth = room.depth, count = width * depth;
  const shape = { width: width, depth: depth, isOpen: new Uint8Array(count), floor: new Array(count).fill(0), ceiling: new Array(count).fill(room.ceiling),
    isSealed: new Uint8Array(count), sealedCount: 0, cutOffDoors: [] };
  const isDrawnOpen = new Uint8Array(count);
  for (let tileZ = 0; tileZ < depth; tileZ++) {
    for (let tileX = 0; tileX < width; tileX++) {
      const kind = getDesignedTileKind(room, room.tiles[tileZ].charAt(tileX));
      if (!kind) continue;
      const index = tileZ * width + tileX;
      isDrawnOpen[index] = 1;
      shape.floor[index] = kind.floor;
      // The room's own ceiling, unless the tile has one, and never too low to walk under.
      shape.ceiling[index] = Math.max(kind.ceiling === undefined ? room.ceiling : kind.ceiling, roundDesignedHeight(kind.floor + limits.minimumHeadroom));
    }
  }
  // The tile just inside a door is plain floor. (A file that has been through normalizeDesignedRoom says so
  // itself; this is for a room that is being worked on, whose door has just been moved.)
  const indexOfDoor = function (door) { const tile = getDesignedDoorInsideTile(room, door); return tile[1] * width + tile[0]; };
  for (const door of room.doors) {
    const index = indexOfDoor(door);
    isDrawnOpen[index] = 1; shape.floor[index] = 0; shape.ceiling[index] = room.ceiling;
  }
  // What can be walked to from the first door.
  const queue = [indexOfDoor(room.doors[0])];
  shape.isOpen[queue[0]] = 1;
  for (let position = 0; position < queue.length; position++) {
    const index = queue[position], tileX = index % width, tileZ = (index - tileX) / width;
    for (const step of WALL_DIRECTIONS) {
      const nearX = tileX + step[0], nearZ = tileZ + step[1];
      if (nearX < 0 || nearZ < 0 || nearX >= width || nearZ >= depth) continue;
      const nearIndex = nearZ * width + nearX;
      if (!isDrawnOpen[nearIndex] || shape.isOpen[nearIndex]) continue;
      if (Math.abs(shape.floor[nearIndex] - shape.floor[index]) > DESIGNED_TALLEST_STEP + 0.001) continue;
      shape.isOpen[nearIndex] = 1;
      queue.push(nearIndex);
    }
  }
  for (let index = 0; index < count; index++) {
    if (isDrawnOpen[index] && !shape.isOpen[index]) { shape.isSealed[index] = 1; shape.sealedCount++; }
  }
  room.doors.forEach(function (door, doorIndex) { if (!shape.isOpen[indexOfDoor(door)]) shape.cutOffDoors.push(doorIndex); });
  return shape;
}

// Carves a room that has a shape, tile by tile.
function carveDesignedRoomShape(shape) {
  for (let tileZ = 0; tileZ < shape.depth; tileZ++) {
    for (let tileX = 0; tileX < shape.width; tileX++) {
      const index = tileZ * shape.width + tileX;
      if (shape.isOpen[index]) carveTile(tileX, tileZ, shape.floor[index], shape.ceiling[index], ZONE_GENERATED_ROOM);
    }
  }
}

// Which tile of a room's shape a point of the room is over: its index, or -1 if that tile is rock.
function findDesignedShapeTile(shape, x, z) {
  const tileX = clampNumber(Math.floor(x), 0, shape.width - 1), tileZ = clampNumber(Math.floor(z), 0, shape.depth - 1);
  const index = tileZ * shape.width + tileX;
  return shape.isOpen[index] ? index : -1;
}

// A room's doorways in the form ROOM_CATALOGUE uses: the tile just outside the room, and the wall it is on.
// `shape` (optional) is what resolveDesignedRoomShape made of the room: a door it found cut off is left out.
function getDesignedRoomSockets(room, shape) {
  const doors = shape ? room.doors.filter(function (door, doorIndex) { return shape.cutOffDoors.indexOf(doorIndex) < 0; }) : room.doors;
  return doors.map(function (door) {
    if (door.wall === 'north') return [door.at, -1, WALL_NORTH];
    if (door.wall === 'south') return [door.at, room.depth, WALL_SOUTH];
    if (door.wall === 'west') return [-1, door.at, WALL_WEST];
    return [room.width, door.at, WALL_EAST];
  });
}

// Runs `action` with everything it builds turned by quarter turns about one point of the room being built,
// on top of however the room itself is placed. This is how a builder that only knows one direction
// (a shelf rack runs north-south) can be used all four ways.
function withQuarterTurnsAbout(pivotX, pivotZ, quarterTurns, action) {
  if (quarterTurns === 0) { action(); return; }
  const savedTurns = placement.turns, savedOffsetX = placement.offsetX, savedOffsetZ = placement.offsetZ;
  const turnedPivot = rotatePointByTurns(pivotX, pivotZ, quarterTurns);
  const shift = rotatePointByTurns(pivotX - turnedPivot[0], pivotZ - turnedPivot[1], savedTurns);
  placement.turns = (savedTurns + quarterTurns) % 4;
  placement.offsetX = savedOffsetX + shift[0]; placement.offsetZ = savedOffsetZ + shift[1];
  action();
  placement.turns = savedTurns; placement.offsetX = savedOffsetX; placement.offsetZ = savedOffsetZ;
}

// Puts everything in a workshop room into the world. `builtRanges` is only used by the workshop: when given,
// it receives one [first, end] pair per item, saying which entries of worldProps that item turned into.
// `shape` is what resolveDesignedRoomShape made of the room (null for a plain box). In a room with a shape, a
// thing stands on the floor of the tile its middle is over, and under that tile's ceiling.
function furnishDesignedRoom(room, random, roomName, builtRanges, shape) {
  const context = { yaw: 0, random: random, ceiling: room.ceiling, roomName: roomName || room.name, room: room, shape: shape || null };
  const roomFloorY = placement.offsetY;
  for (const item of room.items) {
    const type = ROOM_ITEM_TYPES[item.type];
    const firstProp = worldProps.length;
    const tile = shape && type.placement === 'floor' ? findDesignedShapeTile(shape, item.x, item.z) : -1;
    context.ceiling = tile >= 0 ? shape.ceiling[tile] - shape.floor[tile] : room.ceiling;
    if (tile >= 0) placement.offsetY = roomFloorY + shape.floor[tile];
    if (type.placement === 'floor' && type.angleStep === 90) {
      context.yaw = 0;
      withQuarterTurnsAbout(item.x, item.z, Math.round((item.angle || 0) / 90) % 4, function () { type.build(item, context); });
    } else {
      context.yaw = (item.angle || 0) * DEGREES_TO_RADIANS;
      type.build(item, context);
    }
    placement.offsetY = roomFloorY;
    if (builtRanges) builtRanges.push([firstProp, worldProps.length]);
  }
}

// The ROOM_CATALOGUE entry for a workshop room.
function createDesignedRoomDefinition(room) {
  const shape = resolveDesignedRoomShape(room);
  const definition = {
    name: room.name, rect: [0, 0, room.width, room.depth], ceiling: room.ceiling, tiers: room.tiers.slice(),
    carve: shape ? function () { carveDesignedRoomShape(shape); } : carveSimpleRoom(room.width, room.depth, room.ceiling),
    furnish: function (random, roomName) { furnishDesignedRoom(room, random, roomName, null, shape); },
    sockets: getDesignedRoomSockets(room, shape),
    isFiller: room.useInStations,
    isDesigned: true,
    locations: room.locations.slice()
  };
  if (room.look !== '') definition.look = room.look;
  if (shape) definition.shape = shape; // (a room with one gets no ceiling beams: 03-levelgen.js)
  if (room.isFlooded) definition.isFlooded = true;
  if (room.itemSpot) {
    // The spot's height is above the floor it is over.
    const tile = shape ? findDesignedShapeTile(shape, room.itemSpot.x, room.itemSpot.z) : -1;
    definition.itemSpot = [room.itemSpot.x, room.itemSpot.y + (tile >= 0 ? shape.floor[tile] : 0), room.itemSpot.z];
  }
  return definition;
}

// The rooms from src/rooms/, cleaned up, by key.
const designedRooms = {};
for (const key in DESIGNED_ROOMS) {
  // A file may not take the place of a room that is written as code.
  if (ROOM_CATALOGUE[key] && !ROOM_CATALOGUE[key].isDesigned) continue;
  designedRooms[key] = normalizeDesignedRoom(DESIGNED_ROOMS[key], key);
  ROOM_CATALOGUE[key] = createDesignedRoomDefinition(designedRooms[key]);
}
