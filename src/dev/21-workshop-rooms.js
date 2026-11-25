// ---------------------------------------------------------------------------
// Workshop, room tool: build a room by placing things in it and looking at the result.
//
// The room on screen is the real thing: carved, furnished and given doors by the same code a generated
// station uses, standing alone on an empty map. Every change rebuilds it at once.
//
// Two kinds of room can be opened:
//   rooms made here   lists of things from ROOM_ITEM_TYPES (03-workshop-rooms.js), saved to src/rooms/<key>.json.
//                     These can be changed in every way, their shape too: "Paint tiles" turns the mouse into a
//                     brush that fills tiles in with rock, digs them out again, and sets the floor and the
//                     ceiling of each ("The shape of a room" in 03-workshop-rooms.js says what the file holds).
//   rooms written as code (03-layout.js, 03-levelgen.js). These can only be looked at here. Change the
//                     numbers in the source and save: with `npm run dev` this view reloads by itself.
// ---------------------------------------------------------------------------

const ROOM_WORKSHOP_KEY_PATTERN = /^[a-z][A-Za-z0-9]{1,30}$/;
const ROOM_WORKSHOP_TIER_LABELS = ['Open from the start', 'Behind a powered door', 'Behind the keycard door'];

const roomWorkshop = {
  key: '',               // which room is open
  savedKey: null,        // the file it was opened from; null for a room that has never been saved
  room: null,            // the working copy, when it is a room made here; null for a room written as code
  isDirty: false,        // the working copy differs from the file
  definition: null,      // the catalogue entry on screen
  selectedIndex: -1,     // which of room.items is selected
  seed: 1,               // for the things that come out a little different every time (shelf contents, crate stacks)
  previewLocation: '',   // which location the room is shown in: a key of LOCATIONS, or '' for the first one it belongs to
  showsAsAStationHasIt: false, // things that are only sometimes there are left out as a station would leave them out
  showUnwalkable: false,
  needsRebuild: false,
  itemRanges: [],        // per item: which worldProps it became
  itemShapes: [],        // per item: what can be clicked on and outlined
  problems: [],
  problemsElement: null, saveButton: null,
  selectedSetters: {},   // setValue functions of the selected thing's position fields
  undoStack: [], redoStack: [], lastEditLabel: '', lastEditTime: -9999,
  drag: null,
  // Painting the room's shape, tile by tile.
  isPainting: false,     // the mouse is a brush: a click paints a tile instead of selecting a thing
  brush: 'rock',         // a key of ROOM_WORKSHOP_BRUSHES
  brushFloor: 0.4,       // what the "floor height" brush sets, in metres above the room's own floor
  brushCeiling: 2,       // what the "ceiling height" brush sets
  brushSize: 1,          // tiles across
  hoverTile: null,       // [tileX, tileZ] of the tile under the mouse, while painting
  stroke: null,          // the mouse button is down: { lastTileX, lastTileZ, skippedDoor, outOfLetters }
  tileInfoElement: null,
  growNumber: 1,         // which cavern "Grow a cavern" grows next: every press is another one
  growFill: 0.44,        // how much of it starts as rock (growCavern, 04-caverns.js)
  distanceField: new Int16Array(TILE_COUNT)
};

// What the brush can do to a tile.
const ROOM_WORKSHOP_BRUSHES = [['rock', 'Fill in with rock'], ['plain', 'Dig out: plain floor'], ['floor', 'Set the floor height'], ['ceiling', 'Set the ceiling height']];

// ---------------------------------------------------------------------------
// Which room
// ---------------------------------------------------------------------------

function getRoomWorkshopChoices() {
  const state = roomWorkshop;
  const made = [], coded = [];
  for (const key in ROOM_CATALOGUE) {
    if (ROOM_CATALOGUE[key].isDesigned) { if (key !== state.savedKey) made.push([key, ROOM_CATALOGUE[key].name]); }
    else coded.push([key, ROOM_CATALOGUE[key].name]);
  }
  // The room being worked on is listed under its current name, even before it has a file.
  if (state.room) made.unshift([state.key, state.room.name + (state.savedKey ? (state.isDirty ? ' (changed)' : '') : ' (not saved yet)')]);
  return [['Made in the workshop', made], ['Written as code (to look at)', coded]];
}

function findFreeRoomWorkshopKey(wanted) {
  let key = wanted;
  for (let number = 2; ROOM_CATALOGUE[key]; number++) key = wanted + number;
  return key;
}

function resetRoomWorkshopEditing() {
  const state = roomWorkshop;
  state.selectedIndex = -1;
  state.undoStack.length = 0; state.redoStack.length = 0;
  state.lastEditLabel = '';
  state.drag = null;
  state.stroke = null; state.hoverTile = null;
  state.needsRebuild = true;
}

// Opens a room. `draft` (optional) is a working copy to carry on with instead of the room's file.
function openRoomInWorkshop(key, draft, savedKey) {
  const state = roomWorkshop;
  state.key = key;
  if (draft) {
    state.room = normalizeDesignedRoom(draft, key);
    state.savedKey = savedKey || null;
    state.isDirty = true;
  } else if (designedRooms[key]) {
    state.room = normalizeDesignedRoom(JSON.parse(JSON.stringify(designedRooms[key])), key);
    state.savedKey = key;
    state.isDirty = false;
  } else {
    state.room = null;
    state.savedKey = null;
    state.isDirty = false;
    state.isPainting = false; // a room written as code has no tiles to paint
  }
  resetRoomWorkshopEditing();
  rebuildRoomWorkshopWorld();
  showRoomWorkshopOverview();
  markWorkshopStateChanged();
}

function mayDiscardRoomWorkshopChanges() {
  const state = roomWorkshop;
  if (!state.room || !state.isDirty) return true;
  return window.confirm('"' + state.room.name + '" has changes that are not saved. Throw them away?');
}

function createNewWorkshopRoom(source) {
  if (!mayDiscardRoomWorkshopChanges()) return;
  const key = findFreeRoomWorkshopKey(source ? source.key + 'Copy' : 'newRoom');
  const draft = source ? JSON.parse(JSON.stringify(source)) : {
    name: 'NEW ROOM', width: 8, depth: 6, ceiling: 2.8, tiers: [0, 1], useInStations: false,
    doors: [{ wall: 'south', at: 4 }],
    items: [{ type: 'ceilingLamp', x: 4, z: 3, angle: 0 }, { type: 'sign', text: '{name}', wall: 'north', along: 4, centerY: 2.3, width: 2, height: 0.26 }]
  };
  if (source) { draft.name = (source.name + ' COPY').slice(0, 24); draft.useInStations = false; }
  openRoomInWorkshop(key, draft, null);
  renderWorkshopPanel();
  setWorkshopStatus(source ? 'A copy to work on. It becomes a file when you save it.' : 'A new room. It becomes a file when you save it.', 'info');
}

// ---------------------------------------------------------------------------
// Building the room on the empty map
// ---------------------------------------------------------------------------

// Which location the room on screen is shown in: the one chosen, if the room belongs there; otherwise the first
// it does belong to. (A room written as code: the one chosen, or the annex.)
function getRoomWorkshopLocation() {
  const state = roomWorkshop;
  const chosen = resolveLocationKey(state.previewLocation);
  if (!state.room) return chosen;
  return state.room.locations.indexOf(chosen) >= 0 ? chosen : state.room.locations[0];
}

function getRoomWorkshopSize() {
  const rect = roomWorkshop.definition.rect;
  return { width: rect[2] - rect[0], depth: rect[3] - rect[1], ceiling: roomWorkshop.definition.ceiling };
}

// The room's shape as it is built: what resolveDesignedRoomShape made of it, or null for a plain box (and for
// a room written as code).
function getRoomWorkshopShape() {
  return (roomWorkshop.definition && roomWorkshop.definition.shape) || null;
}

function createRoomWorkshopSignShape(room, item) {
  const shape = getRoomWorkshopShape();
  const spot = getDesignedSignSpot(room, item, shape);
  // Lettering is on a wall of one tile, and its height is measured from that tile's floor.
  const tile = spot.tileZ * room.width + spot.tileX;
  const floor = shape && shape.isOpen[tile] ? shape.floor[tile] : 0;
  const halfWidth = item.width / 2, bottom = floor + item.centerY - item.height / 2, top = floor + item.centerY + item.height / 2;
  const tileX = WORKSHOP_ORIGIN_X + spot.tileX, tileZ = WORKSHOP_ORIGIN_Z + spot.tileZ, thickness = 0.04;
  const alongX = WORKSHOP_ORIGIN_X + spot.along, alongZ = WORKSHOP_ORIGIN_Z + spot.along;
  if (spot.wall === WALL_NORTH) return createWorkshopBoxShape(alongX - halfWidth, bottom, tileZ, alongX + halfWidth, top, tileZ + thickness);
  if (spot.wall === WALL_SOUTH) return createWorkshopBoxShape(alongX - halfWidth, bottom, tileZ + 1 - thickness, alongX + halfWidth, top, tileZ + 1);
  if (spot.wall === WALL_WEST) return createWorkshopBoxShape(tileX, bottom, alongZ - halfWidth, tileX + thickness, top, alongZ + halfWidth);
  return createWorkshopBoxShape(tileX + 1 - thickness, bottom, alongZ - halfWidth, tileX + 1, top, alongZ + halfWidth);
}

function rebuildRoomWorkshopWorld() {
  const state = roomWorkshop;
  state.needsRebuild = false;
  // Built the way a test room is built (03-single-room.js), so what is seen here is what a test gets.
  state.definition = buildSingleRoom({ room: state.room, roomKey: state.key, locationKey: getRoomWorkshopLocation(), seed: state.seed,
    keepsEverything: !state.showsAsAStationHasIt, itemRanges: state.itemRanges, showsItemSpot: true,
    description: 'Workshop · ' + (state.room ? state.room.name : ROOM_CATALOGUE[state.key].name) });
  workshop.needsScanBurst = true;
  createStills(); // the calibration store comes with its dummies

  // What can be clicked on: the props each thing became, or a stand-in box for lettering and floor areas.
  state.itemShapes.length = 0;
  if (state.room) {
    state.room.items.forEach(function (item, itemIndex) {
      const type = ROOM_ITEM_TYPES[item.type];
      if (type.placement === 'wall') state.itemShapes.push([createRoomWorkshopSignShape(state.room, item)]);
      else if (type.placement === 'tiles') {
        state.itemShapes.push([createWorkshopBoxShape(WORKSHOP_ORIGIN_X + item.x, 0, WORKSHOP_ORIGIN_Z + item.z,
          WORKSHOP_ORIGIN_X + Math.min(state.room.width, item.x + item.sizeX), 0.03, WORKSHOP_ORIGIN_Z + Math.min(state.room.depth, item.z + item.sizeZ))]);
      } else state.itemShapes.push(worldProps.slice(state.itemRanges[itemIndex][0], state.itemRanges[itemIndex][1]));
    });
  }
  state.problems = findRoomWorkshopProblems();
  refreshRoomWorkshopProblems();
}

function describeRoomWorkshopItem(item, itemIndex) {
  const type = ROOM_ITEM_TYPES[item.type];
  let text = (itemIndex + 1) + '. ' + (item.type === 'sign' ? 'Lettering "' + item.text + '"' : type.label.replace(/ \(.*\)$/, ''));
  if (type.placement === 'wall') text += ' · ' + item.wall + ' wall';
  else text += ' · ' + formatWorkshopNumber(item.x) + ', ' + formatWorkshopNumber(item.z);
  if (item.chance !== undefined) text += ' · there ' + Math.round(item.chance * 100) + '% of the time';
  return text;
}

// The smallest upright box around everything a thing is made of, or null if it is made of nothing.
function getRoomWorkshopItemBounds(itemIndex) {
  const shapes = roomWorkshop.itemShapes[itemIndex];
  if (!shapes || shapes.length === 0) return null;
  const bounds = { minimumX: Infinity, minimumY: Infinity, minimumZ: Infinity, maximumX: -Infinity, maximumY: -Infinity, maximumZ: -Infinity };
  for (const shape of shapes) {
    bounds.minimumX = Math.min(bounds.minimumX, shape.centerX - shape.boundsHalfX); bounds.maximumX = Math.max(bounds.maximumX, shape.centerX + shape.boundsHalfX);
    bounds.minimumY = Math.min(bounds.minimumY, shape.minimumY); bounds.maximumY = Math.max(bounds.maximumY, shape.maximumY);
    bounds.minimumZ = Math.min(bounds.minimumZ, shape.centerZ - shape.boundsHalfZ); bounds.maximumZ = Math.max(bounds.maximumZ, shape.centerZ + shape.boundsHalfZ);
  }
  return bounds;
}

// Things that would go wrong in a station: a door that opens onto a cupboard, a spool nobody can reach.
function findRoomWorkshopProblems() {
  const state = roomWorkshop, room = state.room, problems = [];
  if (!room) return problems;
  if (!ROOM_WORKSHOP_KEY_PATTERN.test(state.key)) problems.push('The file name must start with a small letter and have only letters and digits.');
  else if (state.key !== state.savedKey && ROOM_CATALOGUE[state.key]) problems.push('There is already a room called "' + state.key + '". Choose another file name.');

  // Doors: the floor just inside each must be free, and every door must be reachable from every other.
  const doorIndexes = room.doors.map(function (door) {
    const tile = getDesignedDoorInsideTile(room, door);
    return tileIndexAt(WORKSHOP_ORIGIN_X + tile[0], WORKSHOP_ORIGIN_Z + tile[1]);
  });
  // The shape: floor that is drawn but cannot be walked to is not built, and a door behind it is no doorway.
  const shape = getRoomWorkshopShape();
  if (shape && shape.sealedCount > 0) {
    problems.push(shape.sealedCount + (shape.sealedCount === 1 ? ' tile of floor' : ' tiles of floor') + ' cannot be walked to from the first door (rock in between, or a step taller than ' +
      formatWorkshopNumber(DESIGNED_TALLEST_STEP) + ' m). Until it can, it stays solid rock.');
  }
  let firstFreeDoor = -1;
  room.doors.forEach(function (door, doorIndex) {
    if (shape && shape.cutOffDoors.indexOf(doorIndex) >= 0) problems.push('The door in the ' + door.wall + ' wall cannot be walked to from the first door. No station will use it.');
    else if (!tileIsWalkable[doorIndexes[doorIndex]]) problems.push('Something stands just inside the door in the ' + door.wall + ' wall. Nothing could get through it.');
    else if (firstFreeDoor < 0) firstFreeDoor = doorIndex;
  });
  if (firstFreeDoor >= 0) {
    computeDistanceField(state.distanceField, doorIndexes[firstFreeDoor], 0, [1]);
    room.doors.forEach(function (door, doorIndex) {
      if (doorIndex === firstFreeDoor || !tileIsWalkable[doorIndexes[doorIndex]]) return;
      if (state.distanceField[doorIndexes[doorIndex]] >= NAVIGATION_UNREACHABLE) {
        problems.push('There is no way across the room from the ' + room.doors[firstFreeDoor].wall + ' door to the ' + door.wall + ' door.');
      }
    });
  }

  // Things poking through a wall or the ceiling, or standing in the rock.
  room.items.forEach(function (item, itemIndex) {
    if (ROOM_ITEM_TYPES[item.type].placement !== 'floor') return;
    const bounds = getRoomWorkshopItemBounds(itemIndex);
    if (!bounds) return;
    const slack = 0.03;
    // In a room with a shape, a thing stands on the tile its middle is over, under that tile's ceiling.
    const tile = shape ? findDesignedShapeTile(shape, item.x, item.z) : -1;
    const ceiling = tile >= 0 ? shape.ceiling[tile] : room.ceiling;
    if (shape && tile < 0) problems.push(describeRoomWorkshopItem(item, itemIndex) + ' stands in solid rock.');
    else if (bounds.minimumX < WORKSHOP_ORIGIN_X - slack || bounds.minimumZ < WORKSHOP_ORIGIN_Z - slack ||
        bounds.maximumX > WORKSHOP_ORIGIN_X + room.width + slack || bounds.maximumZ > WORKSHOP_ORIGIN_Z + room.depth + slack) {
      problems.push(describeRoomWorkshopItem(item, itemIndex) + ' pokes through a wall.');
    } else if (bounds.maximumY > ceiling + slack) {
      problems.push(describeRoomWorkshopItem(item, itemIndex) + ' is taller than the ceiling (' + formatWorkshopNumber(tile >= 0 ? ceiling - shape.floor[tile] : ceiling) + ' m).');
    }
  });

  // The spot for a spool or the keycard must be within arm's reach of somewhere a player can stand, and on
  // something that is always there.
  if (room.itemSpot) {
    room.items.forEach(function (item, itemIndex) {
      const bounds = item.chance !== undefined ? getRoomWorkshopItemBounds(itemIndex) : null;
      if (!bounds || bounds.maximumY > room.itemSpot.y + (shape && findDesignedShapeTile(shape, room.itemSpot.x, room.itemSpot.z) >= 0 ? shape.floor[findDesignedShapeTile(shape, room.itemSpot.x, room.itemSpot.z)] : 0) + 0.1) return;
      const spotWorldX = WORKSHOP_ORIGIN_X + room.itemSpot.x, spotWorldZ = WORKSHOP_ORIGIN_Z + room.itemSpot.z;
      if (spotWorldX >= bounds.minimumX && spotWorldX <= bounds.maximumX && spotWorldZ >= bounds.minimumZ && spotWorldZ <= bounds.maximumZ && room.itemSpot.y > 0.1) {
        problems.push('The spool spot is on ' + describeRoomWorkshopItem(item, itemIndex) + ', which is not always there: the spool would hang in the air.');
      }
    });
    const spotX = WORKSHOP_ORIGIN_X + room.itemSpot.x, spotZ = WORKSHOP_ORIGIN_Z + room.itemSpot.z;
    const standIndex = findNearestWalkableTileIndex(spotX, spotZ);
    const standDistance = standIndex < 0 ? Infinity
      : distanceBetweenPoints(spotX, spotZ, standIndex % GRID_WIDTH + 0.5, Math.floor(standIndex / GRID_WIDTH) + 0.5);
    if (standDistance > TUNING.interactionReach - 0.4) {
      problems.push('The spool spot is out of reach: ' + formatWorkshopNumber(Math.round(standDistance * 100) / 100) + ' m from the nearest place to stand.');
    } else if (firstFreeDoor >= 0 && state.distanceField[standIndex] >= NAVIGATION_UNREACHABLE) {
      problems.push('The spool spot is in a part of the room that cannot be walked to.');
    }
  }
  return problems;
}

function refreshRoomWorkshopProblems() {
  const state = roomWorkshop;
  if (state.saveButton) state.saveButton.textContent = (state.isDirty ? 'Save *' : 'Saved');
  const list = state.problemsElement;
  if (!list) return;
  list.textContent = '';
  if (!state.room) return;
  if (state.problems.length === 0) list.appendChild(createDebugElement('li', 'is-fine', 'Doors are clear and everything fits.'));
  for (const problem of state.problems) list.appendChild(createDebugElement('li', '', problem));
}

// ---------------------------------------------------------------------------
// Changing the room
// ---------------------------------------------------------------------------

// Call before every change. Changes of the same kind in quick succession (a slider being dragged) are one step to undo.
function beginRoomWorkshopEdit(label) {
  const state = roomWorkshop;
  const now = window.performance.now();
  if (label !== state.lastEditLabel || now - state.lastEditTime > 700) {
    state.undoStack.push(JSON.stringify({ room: state.room, selectedIndex: state.selectedIndex }));
    if (state.undoStack.length > 120) state.undoStack.shift();
    state.redoStack.length = 0;
  }
  state.lastEditLabel = label;
  state.lastEditTime = now;
}

// Call after every change.
function finishRoomWorkshopEdit() {
  const state = roomWorkshop;
  state.isDirty = true;
  state.needsRebuild = true;
  markWorkshopStateChanged();
}

function stepRoomWorkshopHistory(fromStack, toStack) {
  const state = roomWorkshop;
  if (!state.room || fromStack.length === 0) return;
  toStack.push(JSON.stringify({ room: state.room, selectedIndex: state.selectedIndex }));
  const restored = JSON.parse(fromStack.pop());
  state.key = restored.room.key || state.key; // the file name can be undone too
  state.room = normalizeDesignedRoom(restored.room, state.key);
  state.selectedIndex = Math.min(restored.selectedIndex, state.room.items.length - 1);
  state.lastEditLabel = '';
  finishRoomWorkshopEdit();
  renderWorkshopPanel();
}

function selectRoomWorkshopItem(itemIndex, shouldScrollToIt) {
  roomWorkshop.selectedIndex = itemIndex;
  renderWorkshopPanel();
  if (shouldScrollToIt) {
    const heading = document.getElementById('workshop-selected');
    if (heading && heading.scrollIntoView) heading.scrollIntoView({ block: 'nearest' });
  }
}

// Where on the room's floor the middle of the view is looking, or the middle of the room if that is not in it.
function findRoomWorkshopSpotInView() {
  const room = roomWorkshop.room;
  computeScannerBasis(player.yaw, player.pitch);
  if (scannerBasis.forwardY < -0.05) {
    const distance = -getPlayerEyeY() / scannerBasis.forwardY;
    const x = player.x + scannerBasis.forwardX * distance - WORKSHOP_ORIGIN_X, z = player.z + scannerBasis.forwardZ * distance - WORKSHOP_ORIGIN_Z;
    if (x > 0.3 && z > 0.3 && x < room.width - 0.3 && z < room.depth - 0.3) return [Math.round(x * 10) / 10, Math.round(z * 10) / 10];
  }
  return [room.width / 2, room.depth / 2];
}

function addRoomWorkshopItem(typeKey) {
  const state = roomWorkshop;
  if (!state.room || !ROOM_ITEM_TYPES[typeKey]) return;
  const spot = findRoomWorkshopSpotInView();
  const item = createDesignedItem(typeKey, spot[0], spot[1]);
  if (item.type === 'sign') item.along = Math.round(state.room.width / 2);
  beginRoomWorkshopEdit('add');
  state.room.items.push(normalizeDesignedItem(item, state.room));
  finishRoomWorkshopEdit();
  selectRoomWorkshopItem(state.room.items.length - 1, true);
}

function deleteSelectedRoomWorkshopItem() {
  const state = roomWorkshop;
  if (!state.room || state.selectedIndex < 0) return;
  beginRoomWorkshopEdit('delete');
  state.room.items.splice(state.selectedIndex, 1);
  state.selectedIndex = -1;
  finishRoomWorkshopEdit();
  renderWorkshopPanel();
}

function duplicateSelectedRoomWorkshopItem() {
  const state = roomWorkshop;
  if (!state.room || state.selectedIndex < 0) return;
  const copy = JSON.parse(JSON.stringify(state.room.items[state.selectedIndex]));
  // Beside the original, so the copy can be seen and picked up.
  if (copy.x !== undefined) { copy.x += ROOM_ITEM_TYPES[copy.type].placement === 'tiles' ? 1 : 0.5; copy.z += ROOM_ITEM_TYPES[copy.type].placement === 'tiles' ? 1 : 0.5; }
  else copy.along += 1;
  beginRoomWorkshopEdit('duplicate');
  state.room.items.push(normalizeDesignedItem(copy, state.room));
  finishRoomWorkshopEdit();
  selectRoomWorkshopItem(state.room.items.length - 1, true);
}

function turnSelectedRoomWorkshopItem(direction) {
  const state = roomWorkshop;
  const item = state.room && state.room.items[state.selectedIndex];
  if (!item) return;
  const type = ROOM_ITEM_TYPES[item.type];
  if (type.placement !== 'floor' || type.angleStep === 0) return;
  const step = type.angleStep === 90 ? 90 : 15;
  beginRoomWorkshopEdit('turn');
  item.angle = (((Math.round(item.angle / step) + direction) * step) % 360 + 360) % 360;
  finishRoomWorkshopEdit();
  if (state.selectedSetters.angle) state.selectedSetters.angle.setValue(item.angle);
}

function moveSelectedRoomWorkshopItem(x, z, editLabel) {
  const state = roomWorkshop;
  const item = state.room && state.room.items[state.selectedIndex];
  if (!item || item.x === undefined) return;
  const isOnTiles = ROOM_ITEM_TYPES[item.type].placement === 'tiles';
  x = clampNumber(x, 0, isOnTiles ? state.room.width - 1 : state.room.width);
  z = clampNumber(z, 0, isOnTiles ? state.room.depth - 1 : state.room.depth);
  if (isOnTiles) { x = Math.round(x); z = Math.round(z); }
  else { x = Math.round(x * 100) / 100; z = Math.round(z * 100) / 100; }
  if (x === item.x && z === item.z) return;
  beginRoomWorkshopEdit(editLabel);
  item.x = x; item.z = z;
  finishRoomWorkshopEdit();
  if (state.selectedSetters.x) state.selectedSetters.x.setValue(x);
  if (state.selectedSetters.z) state.selectedSetters.z.setValue(z);
}

// The highest thing under a point of the room that a spool could lie on, in metres above the floor there.
function findRoomWorkshopSurfaceBelow(x, z) {
  const worldX = WORKSHOP_ORIGIN_X + x, worldZ = WORKSHOP_ORIGIN_Z + z;
  const shape = getRoomWorkshopShape(), tile = shape ? findDesignedShapeTile(shape, x, z) : -1;
  const floor = tile >= 0 ? shape.floor[tile] : 0;
  let highest = floor;
  for (const prop of worldProps) {
    if (prop.isDynamic || prop.maximumY > floor + 1.7 || prop.maximumY <= highest) continue;
    const offsetX = worldX - prop.centerX, offsetZ = worldZ - prop.centerZ;
    let isOver;
    if (prop.kind === PROP_KIND_BOX) {
      isOver = Math.abs(offsetX * prop.cosineYaw + offsetZ * prop.sineYaw) <= prop.halfX && Math.abs(-offsetX * prop.sineYaw + offsetZ * prop.cosineYaw) <= prop.halfZ;
    } else if (prop.kind === PROP_KIND_CYLINDER && prop.axis !== AXIS_Y) {
      isOver = Math.abs(offsetX) <= prop.boundsHalfX && Math.abs(offsetZ) <= prop.boundsHalfZ;
    } else isOver = offsetX * offsetX + offsetZ * offsetZ <= prop.radius * prop.radius;
    if (isOver) highest = prop.maximumY;
  }
  return highest - floor;
}

// ---------------------------------------------------------------------------
// The room's shape: painting tiles
// ---------------------------------------------------------------------------

function setRoomWorkshopPainting(isPainting) {
  const state = roomWorkshop;
  state.isPainting = isPainting && state.room !== null;
  state.stroke = null; state.hoverTile = null; state.drag = null;
  refreshRoomWorkshopTileInfo();
  markWorkshopStateChanged();
}

// The character of room.tiles for one tile.
function getRoomWorkshopTileCharacter(tileX, tileZ) {
  const room = roomWorkshop.room;
  return room.tiles ? room.tiles[tileZ].charAt(tileX) : DESIGNED_TILE_FLOOR;
}

// How high the top of a tile is, for pointing at it: its floor, or the room's own floor level if it is rock.
function getRoomWorkshopTileSurface(tileX, tileZ) {
  const kind = getDesignedTileKind(roomWorkshop.room, getRoomWorkshopTileCharacter(tileX, tileZ));
  return kind ? kind.floor : 0;
}

// The tile of the room the mouse points at: [tileX, tileZ], or null if it points at none.
// Floors are at different heights, so the ray is followed down through each height there is, highest first
// (lowest first, looking up): the tile it is over at a height counts if that tile's floor is at that height.
function findRoomWorkshopTileUnderRay(ray) {
  const room = roomWorkshop.room;
  if (Math.abs(ray.directionY) < 0.02) return null;
  const tileAtHeight = function (height) {
    const distance = (height - ray.originY) / ray.directionY;
    if (distance <= 0 || distance > 200) return null;
    const tileX = Math.floor(ray.originX + ray.directionX * distance - WORKSHOP_ORIGIN_X), tileZ = Math.floor(ray.originZ + ray.directionZ * distance - WORKSHOP_ORIGIN_Z);
    return tileX >= 0 && tileZ >= 0 && tileX < room.width && tileZ < room.depth ? [tileX, tileZ] : null;
  };
  const heights = [0];
  for (const letter in room.tileKinds) if (heights.indexOf(room.tileKinds[letter].floor) < 0) heights.push(room.tileKinds[letter].floor);
  heights.sort(function (a, b) { return ray.directionY < 0 ? b - a : a - b; });
  for (const height of heights) {
    const tile = tileAtHeight(height);
    if (tile && getRoomWorkshopTileSurface(tile[0], tile[1]) === height) return tile;
  }
  return tileAtHeight(0);
}

// The tiles the brush covers when its middle is on (tileX, tileZ), those of them that are in the room.
function getRoomWorkshopBrushTiles(tileX, tileZ) {
  const state = roomWorkshop, room = state.room, tiles = [];
  const first = -Math.floor((state.brushSize - 1) / 2);
  for (let offsetZ = first; offsetZ < first + state.brushSize; offsetZ++) {
    for (let offsetX = first; offsetX < first + state.brushSize; offsetX++) {
      const x = tileX + offsetX, z = tileZ + offsetZ;
      if (x >= 0 && z >= 0 && x < room.width && z < room.depth) tiles.push([x, z]);
    }
  }
  return tiles;
}

// Paints the tiles under the brush. The first change of a stroke is where undo goes back to.
function paintRoomWorkshopTiles(tileX, tileZ) {
  const state = roomWorkshop, room = state.room, stroke = state.stroke;
  const rows = [];
  for (let z = 0; z < room.depth; z++) rows.push((room.tiles ? room.tiles[z] : DESIGNED_TILE_FLOOR.repeat(room.width)).split(''));
  // The kinds are worked out on a copy: the room is not touched until it is known that something changes.
  const draft = { tileKinds: JSON.parse(JSON.stringify(room.tileKinds)) };
  const doorTiles = room.doors.map(function (door) { return getDesignedDoorInsideTile(room, door); });
  let hasChanged = false;
  for (const tile of getRoomWorkshopBrushTiles(tileX, tileZ)) {
    const current = rows[tile[1]][tile[0]];
    let wanted = current;
    if (state.brush === 'plain') wanted = DESIGNED_TILE_FLOOR;
    else if (doorTiles.some(function (doorTile) { return doorTile[0] === tile[0] && doorTile[1] === tile[1]; })) { stroke.skippedDoor = true; continue; }
    else if (state.brush === 'rock') wanted = DESIGNED_TILE_ROCK;
    else {
      const kind = getDesignedTileKind(room, current);
      // The floor brush digs rock out as it goes; the ceiling brush leaves rock alone (rock has no ceiling).
      if (state.brush === 'floor') wanted = findDesignedTileCharacter(draft, state.brushFloor, kind ? kind.ceiling : undefined);
      else if (kind) wanted = findDesignedTileCharacter(draft, kind.floor, state.brushCeiling === room.ceiling ? undefined : state.brushCeiling);
      if (wanted === '') { stroke.outOfLetters = true; continue; }
    }
    if (wanted !== current) { rows[tile[1]][tile[0]] = wanted; hasChanged = true; }
  }
  if (!hasChanged) return;
  if (!stroke.hasBegun) { state.lastEditLabel = ''; beginRoomWorkshopEdit('paint'); stroke.hasBegun = true; }
  room.tiles = rows.map(function (row) { return row.join(''); });
  room.tileKinds = draft.tileKinds;
  finishRoomWorkshopEdit();
}

function finishRoomWorkshopStroke() {
  const state = roomWorkshop, stroke = state.stroke;
  state.stroke = null;
  state.lastEditLabel = ''; // the next stroke is its own step to undo
  if (!stroke) return;
  if (stroke.hasBegun) {
    // Tidies up: kinds no tile has any more go, and a room that is all plain floor again is a box again.
    state.room = normalizeDesignedRoom(state.room, state.key);
    state.needsRebuild = true;
  }
  if (stroke.outOfLetters) setWorkshopStatus('A room can have ' + DESIGNED_TILE_KIND_LETTERS.length + ' different kinds of tile, and this one has them all. Some tiles were left as they were.', 'warning');
  else if (stroke.skippedDoor) setWorkshopStatus('The tile just inside a door is always plain floor: the brush left it alone.', 'info');
}

// Gives the room the floor of a cavern, grown as a station grows them (04-caverns.js), in place of whatever
// shape it had: something to start from, and to go over with the brush. Every press grows another one.
function growRoomWorkshopCavern() {
  const state = roomWorkshop;
  if (!state.room) return;
  const grown = growCavernRoom(state.room.width, state.room.depth, state.room.ceiling, state.room.doors, state.growNumber * 613 + state.room.width * 31 + state.room.depth, { fill: state.growFill });
  state.growNumber++;
  markWorkshopStateChanged();
  if (!grown.tiles) { setWorkshopStatus('Nothing worth keeping grew this time. Press again for another, or start with less rock.', 'warning'); return; }
  beginRoomWorkshopEdit('grow ' + state.growNumber);
  state.room.tiles = grown.tiles; state.room.tileKinds = grown.tileKinds;
  state.room = normalizeDesignedRoom(state.room, state.key);
  finishRoomWorkshopEdit();
  renderWorkshopPanel();
  setWorkshopStatus('A cavern. Press again for another one, Ctrl+Z for the one before; paint over what you want otherwise.', 'info');
}

// Back to a plain box.
function clearRoomWorkshopShape() {
  const state = roomWorkshop;
  if (!state.room || !state.room.tiles) return;
  beginRoomWorkshopEdit('clear shape');
  state.room.tiles = null; state.room.tileKinds = {};
  finishRoomWorkshopEdit();
  renderWorkshopPanel();
}

// Says what the tile under the mouse is.
function refreshRoomWorkshopTileInfo() {
  const state = roomWorkshop, element = state.tileInfoElement;
  if (!element) return;
  if (!state.isPainting) { element.textContent = ''; return; }
  if (!state.hoverTile) { element.textContent = 'Point at a tile of the room.'; return; }
  const tileX = state.hoverTile[0], tileZ = state.hoverTile[1], room = state.room;
  const kind = getDesignedTileKind(room, getRoomWorkshopTileCharacter(tileX, tileZ));
  const shape = getRoomWorkshopShape();
  let text = 'Tile ' + tileX + ', ' + tileZ + ': ';
  if (!kind) text += 'rock';
  else {
    const ceiling = Math.max(kind.ceiling === undefined ? room.ceiling : kind.ceiling, kind.floor + DESIGNED_ROOM_LIMITS.minimumHeadroom);
    text += 'floor ' + formatWorkshopNumber(kind.floor) + ' m, ceiling ' + formatWorkshopNumber(ceiling) + ' m' + (kind.ceiling === undefined ? ' (the room\'s)' : '');
    if (shape && !state.needsRebuild && shape.isSealed[tileZ * room.width + tileX]) text += '. Not built: it cannot be walked to';
  }
  element.textContent = text;
}

function renderRoomWorkshopShape(body) {
  const state = roomWorkshop, room = state.room, limits = DESIGNED_ROOM_LIMITS;
  addWorkshopHeading(body, 'The shape of the room');
  addWorkshopCheckbox(body, 'Paint tiles (P): click and drag in the view', state.isPainting, function (isOn) { setRoomWorkshopPainting(isOn); renderWorkshopPanel(); },
    'The mouse becomes a brush. Things in the room cannot be selected while it is one.').id = 'workshop-paint';
  const growRow = addWorkshopRow(body);
  addWorkshopButton(growRow, 'Grow a cavern', growRoomWorkshopCavern, 'Replaces the room\'s shape with a cavern grown the way a cave station grows them, round the doors it has. Every press is another one.').id = 'workshop-grow';
  addWorkshopNumber(body, 'How much of it starts as rock', state.growFill, 0.3, 0.55, 0.01, function (value) { state.growFill = value; markWorkshopStateChanged(); }).element.id = 'workshop-grow-fill';
  if (!state.isPainting) {
    addWorkshopNote(body, room.tiles ? 'This room has a shape of its own.' : 'A plain box. Paint tiles to fill parts of it in with rock, or to give them a floor or a ceiling of their own; or grow a cavern and paint over that.');
    return;
  }
  addWorkshopSelect(body, 'Brush', state.brush, ROOM_WORKSHOP_BRUSHES, function (brush) { state.brush = brush; markWorkshopStateChanged(); renderWorkshopPanel(); }).id = 'workshop-brush';
  if (state.brush === 'floor') {
    addWorkshopNumber(body, 'Floor height (m above the room\'s floor)', state.brushFloor, limits.lowestFloor, limits.highestFloor, 0.05,
      function (value) { state.brushFloor = roundDesignedHeight(value); markWorkshopStateChanged(); }).element.id = 'workshop-brush-floor';
  }
  if (state.brush === 'ceiling') {
    addWorkshopNumber(body, 'Ceiling height (m above the room\'s floor)', state.brushCeiling, limits.minimumHeadroom, limits.highestTileCeiling, 0.05,
      function (value) { state.brushCeiling = roundDesignedHeight(value); markWorkshopStateChanged(); }).element.id = 'workshop-brush-ceiling';
  }
  addWorkshopNumber(body, 'Brush size (tiles across)', state.brushSize, 1, 5, 1, function (value) { state.brushSize = value; markWorkshopStateChanged(); }).element.id = 'workshop-brush-size';
  state.tileInfoElement = addWorkshopNote(body, '');
  state.tileInfoElement.id = 'workshop-tile-info';
  refreshRoomWorkshopTileInfo();
  addWorkshopNote(body, 'A step of ' + formatWorkshopNumber(DESIGNED_TALLEST_STEP) + ' m or less can be walked, a taller one is a wall. Floor that cannot be walked to from the first door is not built ' +
    '(red crosses): it stays rock until it has a way up. A ceiling is never lower than ' + formatWorkshopNumber(limits.minimumHeadroom) + ' m over its floor. "From above" (T) is the view to paint in.');
  if (room.tiles) addWorkshopButton(addWorkshopRow(body), 'A plain box again', clearRoomWorkshopShape, 'Takes the shape away: every tile is plain floor again').id = 'workshop-clear-shape';
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

// The room as it is written to its file: everything but the key, which is the file's name.
function getRoomWorkshopFileContent() {
  const content = JSON.parse(JSON.stringify(roomWorkshop.room));
  delete content.key;
  // A plain box says nothing about its tiles, as before rooms had shapes.
  if (!content.tiles) { delete content.tiles; delete content.tileKinds; }
  return content;
}

function saveRoomWorkshop() {
  const state = roomWorkshop;
  if (!state.room) { setWorkshopStatus('This room is written as code. There is nothing here to save.', 'info'); return; }
  const key = state.key;
  if (!ROOM_WORKSHOP_KEY_PATTERN.test(key) || (key !== state.savedKey && ROOM_CATALOGUE[key])) {
    setWorkshopStatus('Not saved: ' + state.problems[0], 'warning');
    return;
  }
  const content = getRoomWorkshopFileContent();
  if (!workshop.hasServer) {
    downloadWorkshopFile(key + '.json', JSON.stringify(content, null, 2) + '\n');
    setWorkshopStatus('No dev server, so the room was downloaded instead. Put ' + key + '.json in src/rooms/.', 'warning');
    return;
  }
  const previousKey = state.savedKey;
  callWorkshopServer('/dev/save-room', { key: key, room: content }).then(function () {
    // Renamed: the old file goes, or the room would exist twice.
    if (previousKey && previousKey !== key) return callWorkshopServer('/dev/delete-room', { key: previousKey });
    return null;
  }).then(function () {
    state.isDirty = false;
    state.savedKey = key;
    designedRooms[key] = normalizeDesignedRoom(content, key);
    saveWorkshopState();
    refreshRoomWorkshopProblems();
    setWorkshopStatus('Saved src/rooms/' + key + '.json' + (state.problems.length > 0 ? ', with ' + state.problems.length + ' thing(s) still to check.' : '.'), state.problems.length > 0 ? 'warning' : 'good');
  }).catch(function (error) {
    setWorkshopStatus('Not saved: ' + error.message, 'warning');
  });
}

function revertRoomWorkshop() {
  const state = roomWorkshop;
  if (!state.room || !state.isDirty) return;
  if (!window.confirm('Throw away every change to "' + state.room.name + '" since it was last saved?')) return;
  if (state.savedKey) openRoomInWorkshop(state.savedKey);
  else openRoomInWorkshop(getDefaultRoomWorkshopKey());
  renderWorkshopPanel();
}

function deleteRoomWorkshopRoom() {
  const state = roomWorkshop;
  if (!state.room) return;
  if (!window.confirm('Delete the room "' + state.room.name + '"' + (state.savedKey ? ' and its file src/rooms/' + state.savedKey + '.json?' : '?'))) return;
  const afterwards = function () {
    if (state.savedKey) { delete designedRooms[state.savedKey]; delete ROOM_CATALOGUE[state.savedKey]; }
    openRoomInWorkshop(getDefaultRoomWorkshopKey());
    saveWorkshopState();
    renderWorkshopPanel();
  };
  if (!state.savedKey) { afterwards(); return; }
  if (!workshop.hasServer) { setWorkshopStatus('No dev server: delete src/rooms/' + state.savedKey + '.json by hand.', 'warning'); return; }
  callWorkshopServer('/dev/delete-room', { key: state.savedKey }).then(afterwards).catch(function (error) {
    setWorkshopStatus('Not deleted: ' + error.message, 'warning');
  });
}

function getDefaultRoomWorkshopKey() {
  for (const key in designedRooms) return key;
  return 'boilerRoom';
}

// ---------------------------------------------------------------------------
// The camera's set views
// ---------------------------------------------------------------------------

// From above and to the south, looking down into the room. Ceilings are not drawn from above.
function showRoomWorkshopOverview() {
  const size = getRoomWorkshopSize();
  const largest = Math.max(size.width, size.depth);
  setWorkshopWalking(false);
  placeWorkshopCamera(WORKSHOP_ORIGIN_X + size.width / 2, size.ceiling + largest * 0.75, WORKSHOP_ORIGIN_Z + size.depth + largest * 0.25, 0, -1.05);
}

function showRoomWorkshopTopView() {
  const size = getRoomWorkshopSize();
  const tangents = getWorkshopViewTangents();
  const height = Math.max((size.depth / 2 + 1.5) / tangents.vertical, (size.width / 2 + 1.5) / tangents.horizontal, size.ceiling + 1);
  setWorkshopWalking(false);
  placeWorkshopCamera(WORKSHOP_ORIGIN_X + size.width / 2, height, WORKSHOP_ORIGIN_Z + size.depth / 2 + height * 0.07, 0, -1.5);
}

// On your feet just inside the first door, looking into the room: how a player first sees it.
function showRoomWorkshopFromDoor() {
  const definition = roomWorkshop.definition, rect = definition.rect;
  const socket = definition.sockets[0];
  const step = WALL_DIRECTIONS[socket[2]];
  const x = WORKSHOP_ORIGIN_X + socket[0] - rect[0] + 0.5 - step[0] * 1.2, z = WORKSHOP_ORIGIN_Z + socket[1] - rect[1] + 0.5 - step[1] * 1.2;
  placeWorkshopCamera(x, (TUNING.playerHeight * TUNING.playerEyeHeightToBody), z, Math.atan2(-step[0], step[1]), 0);
  setWorkshopWalking(true);
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

function renderRoomWorkshopSelection(body) {
  const state = roomWorkshop, room = state.room;
  const item = room.items[state.selectedIndex];
  state.selectedSetters = {};
  const heading = addWorkshopHeading(body, item ? 'Selected: ' + describeRoomWorkshopItem(item, state.selectedIndex) : 'Selected: nothing');
  heading.id = 'workshop-selected';
  if (!item) { addWorkshopNote(body, 'Click something in the view, or in the list below.'); return; }
  const type = ROOM_ITEM_TYPES[item.type];
  const selected = function () { return roomWorkshop.room.items[roomWorkshop.selectedIndex]; };
  if (type.placement !== 'wall') {
    const isOnTiles = type.placement === 'tiles';
    state.selectedSetters.x = addWorkshopNumber(body, isOnTiles ? 'First tile, from the west wall' : 'From the west wall', item.x, 0, isOnTiles ? room.width - 1 : room.width, isOnTiles ? 1 : 0.05,
      function (value) { moveSelectedRoomWorkshopItem(value, selected().z, 'move'); });
    state.selectedSetters.x.element.id = 'workshop-item-x';
    state.selectedSetters.z = addWorkshopNumber(body, isOnTiles ? 'First tile, from the north wall' : 'From the north wall', item.z, 0, isOnTiles ? room.depth - 1 : room.depth, isOnTiles ? 1 : 0.05,
      function (value) { moveSelectedRoomWorkshopItem(selected().x, value, 'move'); });
    state.selectedSetters.z.element.id = 'workshop-item-z';
  }
  if (type.placement === 'floor' && type.angleStep !== 0) {
    state.selectedSetters.angle = addWorkshopNumber(body, type.angleStep === 90 ? 'Turned (quarter turns)' : 'Turned (degrees)', item.angle, 0, type.angleStep === 90 ? 270 : 355, type.angleStep,
      function (value) { beginRoomWorkshopEdit('angle'); selected().angle = value; finishRoomWorkshopEdit(); });
  }
  for (const field of type.fields) {
    const change = function (value) { beginRoomWorkshopEdit('field ' + field.key); selected()[field.key] = value; finishRoomWorkshopEdit(); };
    if (field.kind === 'number') {
      let maximum = field.maximum;
      if (item.type === 'sign' && field.key === 'along') maximum = item.wall === 'north' || item.wall === 'south' ? room.width : room.depth;
      addWorkshopNumber(body, field.label, Math.min(item[field.key], maximum), field.minimum, maximum, field.step, change);
    } else if (field.kind === 'boolean') addWorkshopCheckbox(body, field.label, item[field.key], change);
    else if (field.kind === 'choice') addWorkshopSelect(body, field.label, item[field.key], field.choices, function (value) { change(value); renderWorkshopPanel(); });
    else addWorkshopText(body, field.label, item[field.key], change);
  }
  // How often a station's room of this kind has it. (Always: the file says nothing about it.)
  state.selectedSetters.chance = addWorkshopNumber(body, 'How often it is there (%)', Math.round((item.chance === undefined ? 1 : item.chance) * 100), 5, 100, 5, function (value) {
    beginRoomWorkshopEdit('chance');
    if (value >= 100) delete selected().chance; else selected().chance = Math.round(value / 5) / 20;
    finishRoomWorkshopEdit();
  });
  state.selectedSetters.chance.element.id = 'workshop-item-chance';
  state.selectedSetters.chance.element.addEventListener('change', renderWorkshopPanel); // (the list below says how often, too)
  const row = addWorkshopRow(body);
  addWorkshopButton(row, 'Copy', duplicateSelectedRoomWorkshopItem, 'Ctrl+D');
  addWorkshopButton(row, 'Delete', deleteSelectedRoomWorkshopItem, 'Delete key');
  if (type.placement === 'floor' && type.angleStep !== 0) addWorkshopButton(row, 'Turn', function () { turnSelectedRoomWorkshopItem(1); }, 'R (Shift+R the other way)');
}

function renderRoomWorkshopPanel(body) {
  const state = roomWorkshop, room = state.room;
  state.problemsElement = null; state.saveButton = null; state.tileInfoElement = null;

  addWorkshopSelect(body, 'Room', state.key, getRoomWorkshopChoices(), function (key) {
    if (key !== state.key && mayDiscardRoomWorkshopChanges()) openRoomInWorkshop(key);
    renderWorkshopPanel();
  }).id = 'workshop-room';
  let row = addWorkshopRow(body);
  addWorkshopButton(row, 'New room', function () { createNewWorkshopRoom(null); }).id = 'workshop-new-room';
  if (room) {
    addWorkshopButton(row, 'Copy of this', function () { createNewWorkshopRoom(Object.assign({}, state.room, { key: state.key })); });
    addWorkshopButton(row, 'Delete', deleteRoomWorkshopRoom);
  }

  if (room) {
    row = addWorkshopRow(body);
    state.saveButton = addWorkshopButton(row, 'Save', saveRoomWorkshop, workshop.hasServer ? 'Ctrl+S: writes src/rooms/' + state.key + '.json' : 'No dev server: downloads the file instead');
    state.saveButton.id = 'workshop-save-room';
    state.saveButton.classList.add('workshop-main-button');
    addWorkshopButton(row, 'Undo', function () { stepRoomWorkshopHistory(state.undoStack, state.redoStack); }, 'Ctrl+Z');
    addWorkshopButton(row, 'Redo', function () { stepRoomWorkshopHistory(state.redoStack, state.undoStack); }, 'Ctrl+Y');
    addWorkshopButton(row, 'Revert', revertRoomWorkshop, 'Back to the last saved state');
    state.problemsElement = body.appendChild(createDebugElement('ul', 'workshop-problems'));
    state.problemsElement.id = 'workshop-problems';
    refreshRoomWorkshopProblems();
  } else {
    addWorkshopNote(body, 'This room is written as code: ' + (ROOM_CATALOGUE[state.key].isFiller ? 'src/js/03-levelgen.js' : 'src/js/03-layout.js') +
      '. It can be looked at here, not changed. Change its numbers in the source and save the file: with `npm run dev` running, this view reloads by itself and stays where it was.');
  }

  addWorkshopHeading(body, 'Look');
  addWorkshopCheckbox(body, 'Lights on (L). Off: what the scanner would show', workshop.isLit, function (isLit) { setWorkshopLights(isLit); });
  addWorkshopCheckbox(body, 'Walk instead of fly (G)', workshop.isWalking, function (isWalking) { setWorkshopWalking(isWalking); });
  addWorkshopCheckbox(body, 'Mark floor nothing can walk on (N)', state.showUnwalkable, function (isOn) { state.showUnwalkable = isOn; markWorkshopStateChanged(); });
  if (room) {
    addWorkshopCheckbox(body, 'Leave out what is only sometimes there, as a station might', state.showsAsAStationHasIt, function (isOn) { state.showsAsAStationHasIt = isOn; state.needsRebuild = true; markWorkshopStateChanged(); },
      'Each thing with "How often it is there" under 100% is left out as often as that says. "Shuffle the random bits" shows another station\'s room. What is left out cannot be clicked: switch this off to work on it.').id = 'workshop-as-a-station';
  }
  // A room looks different from place to place: what it is made of (unless it says so itself), and what is outside its doors.
  const locationChoices = Object.keys(LOCATIONS).filter(function (key) { return !room || room.locations.indexOf(key) >= 0; }).map(function (key) { return [key, LOCATIONS[key].label]; });
  if (locationChoices.length > 1) {
    addWorkshopSelect(body, 'Shown as it is in', getRoomWorkshopLocation(), locationChoices, function (key) { state.previewLocation = key; state.needsRebuild = true; markWorkshopStateChanged(); }).id = 'workshop-preview-location';
  }
  row = addWorkshopRow(body);
  addWorkshopButton(row, 'Overview', showRoomWorkshopOverview, 'H');
  addWorkshopButton(row, 'From above', showRoomWorkshopTopView, 'T');
  addWorkshopButton(row, 'From the door', showRoomWorkshopFromDoor, 'On foot, just inside the first door');
  addWorkshopNote(body, 'Hold the right mouse button to look. W A S D fly, E up, Q down, Shift faster. Space scans, F sweeps.' +
    (room ? ' Click a thing to select it, drag it to move it (Ctrl: half-metre steps), R turns it, arrow keys nudge it. P paints the room\'s shape.' : ''));
  if (!room) return;

  renderRoomWorkshopShape(body);
  renderRoomWorkshopSelection(body);

  addWorkshopHeading(body, 'Things in the room (' + room.items.length + ')');
  const typeChoices = [];
  for (const typeKey in ROOM_ITEM_TYPES) {
    const type = ROOM_ITEM_TYPES[typeKey];
    let group = typeChoices.find(function (choice) { return choice[0] === type.group; });
    if (!group) { group = [type.group, []]; typeChoices.push(group); }
    group[1].push([typeKey, type.label]);
  }
  row = addWorkshopRow(body);
  const typeSelect = addWorkshopSelect(row, '', workshop.stored.rooms.lastAddedType || 'table', typeChoices, function (typeKey) { workshop.stored.rooms.lastAddedType = typeKey; });
  typeSelect.id = 'workshop-add-type';
  addWorkshopButton(row, 'Add', function () { workshop.stored.rooms.lastAddedType = typeSelect.value; addRoomWorkshopItem(typeSelect.value); }, 'Puts one where the view is looking').id = 'workshop-add-item';
  const list = body.appendChild(createDebugElement('div', 'workshop-list'));
  room.items.forEach(function (item, itemIndex) {
    const entry = createDebugElement('button', 'workshop-list-entry' + (itemIndex === state.selectedIndex ? ' is-current' : ''), describeRoomWorkshopItem(item, itemIndex));
    entry.type = 'button';
    entry.addEventListener('click', function () { entry.blur(); selectRoomWorkshopItem(itemIndex === state.selectedIndex ? -1 : itemIndex, true); });
    list.appendChild(entry);
  });

  addWorkshopHeading(body, 'The room');
  addWorkshopText(body, 'Name (on doors and the map)', room.name, function (value) {
    beginRoomWorkshopEdit('name'); state.room.name = value.toUpperCase().slice(0, 24) || state.key.toUpperCase(); finishRoomWorkshopEdit();
  }, 24).id = 'workshop-room-name';
  const keyBox = addWorkshopText(body, 'File name: src/rooms/….json', state.key, function (value) {
    beginRoomWorkshopEdit('key'); state.key = state.room.key = value.trim(); finishRoomWorkshopEdit();
  }, 31);
  keyBox.id = 'workshop-room-key';
  keyBox.addEventListener('change', renderWorkshopPanel); // the list of rooms at the top shows the new name
  // Making the room smaller pulls its doors and things inside the new walls; the panel is redrawn when the slider is let go.
  const resize = function (property) {
    return function (value) {
      beginRoomWorkshopEdit('size');
      state.room[property] = value;
      state.room = normalizeDesignedRoom(state.room, state.key);
      state.selectedIndex = Math.min(state.selectedIndex, state.room.items.length - 1);
      finishRoomWorkshopEdit();
    };
  };
  const limits = DESIGNED_ROOM_LIMITS;
  addWorkshopNumber(body, 'Width, west to east (m)', room.width, limits.minimumSize, limits.maximumSize, 1, resize('width')).element.addEventListener('change', renderWorkshopPanel);
  addWorkshopNumber(body, 'Depth, north to south (m)', room.depth, limits.minimumSize, limits.maximumSize, 1, resize('depth')).element.addEventListener('change', renderWorkshopPanel);
  addWorkshopNumber(body, 'Ceiling height (m)', room.ceiling, limits.minimumCeiling, limits.maximumCeiling, 0.1, resize('ceiling'));
  addWorkshopSelect(body, 'Made of', room.look, [['', 'What the place it is in is made of'], ['panel', 'Panels (something built)'], ['rock', 'Bare rock'], ['masonry', 'Brick']], function (look) {
    beginRoomWorkshopEdit('look'); state.room.look = look; finishRoomWorkshopEdit();
  }).id = 'workshop-room-look';
  addWorkshopCheckbox(body, 'Flooded: the whole floor is under water', room.isFlooded, function (isOn) { beginRoomWorkshopEdit('flooded'); state.room.isFlooded = isOn; finishRoomWorkshopEdit(); });
  addWorkshopNumber(body, 'Shuffle the random bits (shelves, stacks)', state.seed, 1, 99, 1, function (value) { state.seed = value; state.needsRebuild = true; markWorkshopStateChanged(); });

  addWorkshopHeading(body, 'In generated stations');
  addWorkshopCheckbox(body, 'Use this room in generated stations', room.useInStations, function (isOn) { beginRoomWorkshopEdit('use'); state.room.useInStations = isOn; finishRoomWorkshopEdit(); },
    'Off: the room is kept, but no station is built with it. Switching it on changes which rooms existing seeds produce.');
  Object.keys(LOCATIONS).forEach(function (locationKey) {
    addWorkshopCheckbox(body, 'A room of: ' + LOCATIONS[locationKey].label.toLowerCase(), room.locations.indexOf(locationKey) >= 0, function (isOn) {
      beginRoomWorkshopEdit('locations');
      const kept = Object.keys(LOCATIONS).filter(function (other) { return other === locationKey ? isOn : state.room.locations.indexOf(other) >= 0; });
      state.room.locations = kept.length > 0 ? kept : [locationKey]; // a room must belong somewhere
      finishRoomWorkshopEdit();
      renderWorkshopPanel(); // (which place it can be shown in follows)
    }, 'A station only has this room if it is in a place that is ticked.').id = 'workshop-room-location-' + locationKey;
  });
  ROOM_WORKSHOP_TIER_LABELS.forEach(function (label, tier) {
    addWorkshopCheckbox(body, 'May be placed: ' + label.toLowerCase(), room.tiers.indexOf(tier) >= 0, function (isOn) {
      beginRoomWorkshopEdit('tiers');
      const tiers = state.room.tiers.filter(function (other) { return other !== tier; });
      if (isOn) tiers.push(tier);
      state.room.tiers = tiers.length > 0 ? tiers.sort() : [tier]; // a room must be allowed somewhere
      finishRoomWorkshopEdit();
      if (tiers.length === 0) renderWorkshopPanel();
    });
  });

  addWorkshopHeading(body, 'Doors (' + room.doors.length + ')');
  addWorkshopNote(body, 'A station joins rooms at these. One is always used; the others may stay plain wall. Keep the floor just inside each one clear.');
  room.doors.forEach(function (door, doorIndex) {
    const doorRow = addWorkshopRow(body);
    addWorkshopSelect(doorRow, '', door.wall, [['north', 'North wall'], ['east', 'East wall'], ['south', 'South wall'], ['west', 'West wall']], function (wall) {
      beginRoomWorkshopEdit('door wall');
      state.room.doors[doorIndex].wall = wall;
      state.room = normalizeDesignedRoom(state.room, state.key);
      finishRoomWorkshopEdit();
      renderWorkshopPanel();
    });
    if (room.doors.length > 1) {
      addWorkshopButton(doorRow, 'Remove', function () {
        beginRoomWorkshopEdit('door remove');
        state.room.doors.splice(doorIndex, 1);
        finishRoomWorkshopEdit();
        renderWorkshopPanel();
      });
    }
    const wallLength = door.wall === 'north' || door.wall === 'south' ? room.width : room.depth;
    addWorkshopNumber(body, door.wall === 'north' || door.wall === 'south' ? 'Tiles from the west corner' : 'Tiles from the north corner', door.at, 0, wallLength - 1, 1, function (value) {
      beginRoomWorkshopEdit('door at ' + doorIndex);
      state.room.doors[doorIndex].at = value;
      if (state.room.tiles) state.room = normalizeDesignedRoom(state.room, state.key); // the tile inside it is plain floor now
      finishRoomWorkshopEdit();
    });
  });
  addWorkshopButton(addWorkshopRow(body), 'Add a door', function () {
    // The first free place, going round the walls.
    for (const wall of ['north', 'east', 'south', 'west']) {
      const wallLength = wall === 'north' || wall === 'south' ? state.room.width : state.room.depth;
      const at = Math.floor(wallLength / 2);
      if (state.room.doors.some(function (door) { return door.wall === wall && door.at === at; })) continue;
      beginRoomWorkshopEdit('door add');
      state.room.doors.push({ wall: wall, at: at });
      if (state.room.tiles) state.room = normalizeDesignedRoom(state.room, state.key);
      finishRoomWorkshopEdit();
      renderWorkshopPanel();
      return;
    }
  });

  addWorkshopHeading(body, 'A place for a spool or the keycard');
  addWorkshopCheckbox(body, 'This room has one', room.itemSpot !== null, function (isOn) {
    beginRoomWorkshopEdit('spot');
    const spot = findRoomWorkshopSpotInView();
    state.room.itemSpot = isOn ? { x: spot[0], y: Math.round((findRoomWorkshopSurfaceBelow(spot[0], spot[1]) + 0.01) * 100) / 100, z: spot[1] } : null;
    finishRoomWorkshopEdit();
    renderWorkshopPanel();
  }, 'A station may leave the first spool or the keycard here instead of in its usual room. The amber spool in the view shows where.');
  if (room.itemSpot) {
    const moveSpot = function (property) {
      return function (value) { beginRoomWorkshopEdit('spot ' + property); state.room.itemSpot[property] = value; finishRoomWorkshopEdit(); };
    };
    addWorkshopNumber(body, 'From the west wall', room.itemSpot.x, 0, room.width, 0.05, moveSpot('x'));
    addWorkshopNumber(body, 'From the north wall', room.itemSpot.z, 0, room.depth, 0.05, moveSpot('z'));
    const heightField = addWorkshopNumber(body, 'Height above the floor', room.itemSpot.y, 0, 2, 0.01, moveSpot('y'));
    addWorkshopButton(addWorkshopRow(body), 'Set it down on what is below', function () {
      const height = Math.round((findRoomWorkshopSurfaceBelow(state.room.itemSpot.x, state.room.itemSpot.z) + 0.01) * 100) / 100;
      moveSpot('y')(height);
      heightField.setValue(height);
    });
  }
}

// ---------------------------------------------------------------------------
// The mouse and the keyboard
// ---------------------------------------------------------------------------

// The thing under the mouse that is nearest the camera: { index, distance }, or null.
function pickRoomWorkshopItem(ray) {
  let best = null;
  roomWorkshop.itemShapes.forEach(function (shapes, itemIndex) {
    for (const shape of shapes) {
      const distance = intersectWorkshopRayWithShape(ray, shape);
      if (distance > 0.02 && (best === null || distance < best.distance)) best = { index: itemIndex, distance: distance };
    }
  });
  return best;
}

function onRoomWorkshopPointerDown(event) {
  const state = roomWorkshop;
  if (event.button === 2) { workshop.isLooking = true; return; }
  if (event.button !== 0 || !state.room) return;
  if (state.needsRebuild) rebuildRoomWorkshopWorld();
  const ray = computeWorkshopMouseRay(event);
  if (state.isPainting) {
    state.stroke = { hasBegun: false, skippedDoor: false, outOfLetters: false };
    state.hoverTile = findRoomWorkshopTileUnderRay(ray);
    if (state.hoverTile) paintRoomWorkshopTiles(state.hoverTile[0], state.hoverTile[1]);
    refreshRoomWorkshopTileInfo();
    return;
  }
  const hit = pickRoomWorkshopItem(ray);
  if (!hit) { if (state.selectedIndex !== -1) selectRoomWorkshopItem(-1); return; }
  if (hit.index !== state.selectedIndex) selectRoomWorkshopItem(hit.index, true);
  const item = state.room.items[hit.index];
  if (item.x === undefined) return; // lettering is moved with its sliders
  // It is dragged across the level plane through the point where it was taken hold of.
  state.drag = {
    startClientX: event.clientX, startClientY: event.clientY, isMoving: false,
    planeY: ray.originY + ray.directionY * hit.distance,
    offsetX: item.x - (ray.originX + ray.directionX * hit.distance - WORKSHOP_ORIGIN_X),
    offsetZ: item.z - (ray.originZ + ray.directionZ * hit.distance - WORKSHOP_ORIGIN_Z)
  };
}

function onRoomWorkshopPointerMove(event) {
  const state = roomWorkshop;
  if (workshop.isLooking) {
    input.lookDeltaX += event.movementX || 0;
    input.lookDeltaY += event.movementY || 0;
    return;
  }
  if (state.isPainting && state.room) {
    // The brush follows the mouse while it is over the view (and wherever it goes, with the button held).
    const tile = state.stroke || event.target === renderer.canvas ? findRoomWorkshopTileUnderRay(computeWorkshopMouseRay(event)) : null;
    const hasMoved = (tile === null) !== (state.hoverTile === null) || (tile !== null && (tile[0] !== state.hoverTile[0] || tile[1] !== state.hoverTile[1]));
    state.hoverTile = tile;
    if (hasMoved && tile && state.stroke) paintRoomWorkshopTiles(tile[0], tile[1]);
    if (hasMoved) refreshRoomWorkshopTileInfo();
    return;
  }
  const drag = state.drag;
  if (!drag) return;
  // A click that wobbles a pixel or two is still a click.
  if (!drag.isMoving && Math.abs(event.clientX - drag.startClientX) + Math.abs(event.clientY - drag.startClientY) < 4) return;
  drag.isMoving = true;
  const ray = computeWorkshopMouseRay(event);
  if (Math.abs(ray.directionY) < 0.02) return;
  const distance = (drag.planeY - ray.originY) / ray.directionY;
  if (distance <= 0 || distance > 90) return;
  const snap = event.ctrlKey ? 0.5 : 0.05;
  const x = Math.round((ray.originX + ray.directionX * distance - WORKSHOP_ORIGIN_X + drag.offsetX) / snap) * snap;
  const z = Math.round((ray.originZ + ray.directionZ * distance - WORKSHOP_ORIGIN_Z + drag.offsetZ) / snap) * snap;
  moveSelectedRoomWorkshopItem(x, z, 'drag');
}

function onRoomWorkshopPointerUp(event) {
  const state = roomWorkshop;
  if (event.button === 2) workshop.isLooking = false;
  if (event.button === 0 && state.stroke) finishRoomWorkshopStroke();
  if (event.button === 0 && state.drag) {
    const wasMoving = state.drag.isMoving;
    state.drag = null;
    state.lastEditLabel = ''; // the next drag is its own step to undo
    if (wasMoving) renderWorkshopPanel(); // the list shows where things are
  }
}

function onRoomWorkshopWheel(event) {
  if (workshop.isWalking) return;
  const distance = event.deltaY > 0 ? -0.6 : 0.6;
  computeScannerBasis(player.yaw, player.pitch);
  player.x += scannerBasis.forwardX * distance; player.z += scannerBasis.forwardZ * distance;
  player.eyeHeight = clampNumber(player.eyeHeight + scannerBasis.forwardY * distance, -6, 40);
}

function onRoomWorkshopKey(event) {
  const state = roomWorkshop;
  const hasCommandKey = event.ctrlKey || event.metaKey;
  if (hasCommandKey && event.code === 'KeyZ') { if (event.shiftKey) stepRoomWorkshopHistory(state.redoStack, state.undoStack); else stepRoomWorkshopHistory(state.undoStack, state.redoStack); return true; }
  if (hasCommandKey && event.code === 'KeyY') { stepRoomWorkshopHistory(state.redoStack, state.undoStack); return true; }
  if (hasCommandKey && event.code === 'KeyD') { duplicateSelectedRoomWorkshopItem(); return true; }
  if (hasCommandKey || event.altKey) return false;
  const hasSelection = state.room !== null && state.selectedIndex >= 0;
  if (hasSelection && event.code.indexOf('Arrow') === 0) {
    const item = state.room.items[state.selectedIndex];
    if (item.x === undefined) return false;
    const step = ROOM_ITEM_TYPES[item.type].placement === 'tiles' ? 1 : (event.shiftKey ? 0.5 : 0.05);
    input.keysDown.delete(event.code); // or the walking camera would turn as well
    moveSelectedRoomWorkshopItem(item.x + (event.code === 'ArrowRight' ? step : (event.code === 'ArrowLeft' ? -step : 0)),
      item.z + (event.code === 'ArrowDown' ? step : (event.code === 'ArrowUp' ? -step : 0)), 'nudge');
    return true;
  }
  if (hasSelection && event.code === 'KeyR') { turnSelectedRoomWorkshopItem(event.shiftKey ? -1 : 1); return true; }
  if (event.repeat) return false;
  if (hasSelection && (event.code === 'Delete' || event.code === 'Backspace')) { deleteSelectedRoomWorkshopItem(); return true; }
  if (state.isPainting && event.code === 'Escape') { setRoomWorkshopPainting(false); renderWorkshopPanel(); return true; }
  if (hasSelection && event.code === 'Escape') { selectRoomWorkshopItem(-1); return true; }
  if (state.room !== null && event.code === 'KeyP') { setRoomWorkshopPainting(!state.isPainting); renderWorkshopPanel(); return true; }
  if (event.code === 'KeyT') { showRoomWorkshopTopView(); renderWorkshopPanel(); return true; }
  if (event.code === 'KeyH') { showRoomWorkshopOverview(); renderWorkshopPanel(); return true; }
  if (event.code === 'KeyG') { setWorkshopWalking(!workshop.isWalking); renderWorkshopPanel(); return true; }
  if (event.code === 'KeyN') { state.showUnwalkable = !state.showUnwalkable; renderWorkshopPanel(); return true; }
  return false;
}

// ---------------------------------------------------------------------------
// Every frame
// ---------------------------------------------------------------------------

function updateRoomWorkshop(dt) {
  if (roomWorkshop.needsRebuild) rebuildRoomWorkshopWorld();
  if (workshop.isWalking) updatePlayerMovement(dt);
  else updateWorkshopFlight(dt);
}

function addRoomWorkshopOverlays(data) {
  const state = roomWorkshop, room = state.room;
  const size = getRoomWorkshopSize();
  // The store's dummies are never drawn in the game; here they are, so the room can be judged with them in it.
  if (workshop.isLit) {
    for (const still of stills) {
      if (still.isPresent) data.figures.push({ figure: still.figure, red: 1.0, green: 0.75, blue: 0.3 });
    }
  }
  if (state.showUnwalkable) {
    for (let tileZ = 0; tileZ < size.depth; tileZ++) {
      for (let tileX = 0; tileX < size.width; tileX++) {
        const worldX = WORKSHOP_ORIGIN_X + tileX, worldZ = WORKSHOP_ORIGIN_Z + tileZ;
        if (!isTileOpenAt(worldX, worldZ) || isWalkableAt(worldX, worldZ)) continue;
        const y = tileFloorHeight[tileIndexAt(worldX, worldZ)] + 0.04;
        pushDebugLine(worldX + 0.12, y, worldZ + 0.12, worldX + 0.88, y, worldZ + 0.88, 1.0, 0.25, 0.2);
        pushDebugLine(worldX + 0.88, y, worldZ + 0.12, worldX + 0.12, y, worldZ + 0.88, 1.0, 0.25, 0.2);
      }
    }
  }
  if (!room) return;
  if (state.isPainting) addRoomWorkshopShapeOverlays();
  room.items.forEach(function (item, itemIndex) {
    const bounds = getRoomWorkshopItemBounds(itemIndex);
    if (!bounds) return;
    const isSelected = itemIndex === state.selectedIndex;
    // Lettering and floor areas cannot be seen with the lights on, so they are always outlined.
    if (item.type === 'sign' && (workshop.isLit || isSelected)) pushWorkshopBoxLines(bounds.minimumX, bounds.minimumY, bounds.minimumZ, bounds.maximumX, bounds.maximumY, bounds.maximumZ, 0.3, 0.85, 1.0);
    if (item.type === 'floorArea' && (workshop.isLit || isSelected)) {
      const isHazard = item.kind === 'hazard';
      pushWorkshopBoxLines(bounds.minimumX + 0.03, 0.02, bounds.minimumZ + 0.03, bounds.maximumX - 0.03, 0.02, bounds.maximumZ - 0.03, isHazard ? 1.0 : 0.2, isHazard ? 0.85 : 0.5, isHazard ? 0.1 : 1.0);
    }
    if (isSelected) pushWorkshopBoxLines(bounds.minimumX - 0.02, bounds.minimumY - 0.02, bounds.minimumZ - 0.02, bounds.maximumX + 0.02, bounds.maximumY + 0.02, bounds.maximumZ + 0.02, 1.0, 1.0, 1.0);
  });
  if (room.isFlooded && workshop.isLit) {
    pushWorkshopBoxLines(WORKSHOP_ORIGIN_X + 0.05, 0.02, WORKSHOP_ORIGIN_Z + 0.05, WORKSHOP_ORIGIN_X + room.width - 0.05, 0.02, WORKSHOP_ORIGIN_Z + room.depth - 0.05, 0.2, 0.5, 1.0);
  }
}

// While painting: what every tile is, drawn on the tile, and the brush.
//   grey cross      rock
//   red cross       floor that is drawn but not built, because it cannot be walked to
//   amber square    a floor above the room's own; blue: below it
//   small cyan one  a ceiling of its own
//   green corners   the tile just inside a door, which stays plain floor
//   white           the brush
function addRoomWorkshopShapeOverlays() {
  const state = roomWorkshop, room = state.room, shape = getRoomWorkshopShape();
  const square = function (tileX, tileZ, y, inset, red, green, blue) {
    const x = WORKSHOP_ORIGIN_X + tileX, z = WORKSHOP_ORIGIN_Z + tileZ;
    pushDebugLine(x + inset, y, z + inset, x + 1 - inset, y, z + inset, red, green, blue);
    pushDebugLine(x + 1 - inset, y, z + inset, x + 1 - inset, y, z + 1 - inset, red, green, blue);
    pushDebugLine(x + 1 - inset, y, z + 1 - inset, x + inset, y, z + 1 - inset, red, green, blue);
    pushDebugLine(x + inset, y, z + 1 - inset, x + inset, y, z + inset, red, green, blue);
  };
  const cross = function (tileX, tileZ, y, red, green, blue) {
    const x = WORKSHOP_ORIGIN_X + tileX, z = WORKSHOP_ORIGIN_Z + tileZ;
    pushDebugLine(x + 0.15, y, z + 0.15, x + 0.85, y, z + 0.85, red, green, blue);
    pushDebugLine(x + 0.85, y, z + 0.15, x + 0.15, y, z + 0.85, red, green, blue);
  };
  pushWorkshopBoxLines(WORKSHOP_ORIGIN_X, 0.02, WORKSHOP_ORIGIN_Z, WORKSHOP_ORIGIN_X + room.width, 0.02, WORKSHOP_ORIGIN_Z + room.depth, 0.45, 0.45, 0.5);
  for (let tileZ = 0; tileZ < room.depth; tileZ++) {
    for (let tileX = 0; tileX < room.width; tileX++) {
      const kind = getDesignedTileKind(room, getRoomWorkshopTileCharacter(tileX, tileZ));
      if (!kind) { cross(tileX, tileZ, 0.03, 0.5, 0.5, 0.55); continue; }
      const y = kind.floor + 0.03;
      if (shape && !state.needsRebuild && shape.isSealed[tileZ * room.width + tileX]) cross(tileX, tileZ, y, 1.0, 0.25, 0.2);
      if (kind.floor !== 0) square(tileX, tileZ, y, 0.06, kind.floor > 0 ? 1.0 : 0.3, kind.floor > 0 ? 0.75 : 0.55, kind.floor > 0 ? 0.2 : 1.0);
      if (kind.ceiling !== undefined) square(tileX, tileZ, y, 0.3, 0.3, 0.9, 0.9);
    }
  }
  for (const door of room.doors) {
    const tile = getDesignedDoorInsideTile(room, door);
    square(tile[0], tile[1], 0.03, 0.2, 0.3, 0.9, 0.4);
  }
  if (state.hoverTile) {
    for (const tile of getRoomWorkshopBrushTiles(state.hoverTile[0], state.hoverTile[1])) {
      const y = getRoomWorkshopTileSurface(tile[0], tile[1]);
      pushWorkshopBoxLines(WORKSHOP_ORIGIN_X + tile[0] + 0.02, y + 0.02, WORKSHOP_ORIGIN_Z + tile[1] + 0.02, WORKSHOP_ORIGIN_X + tile[0] + 0.98, y + 0.12, WORKSHOP_ORIGIN_Z + tile[1] + 0.98, 1.0, 1.0, 1.0);
    }
  }
}

workshop.tools.rooms = {
  label: 'Rooms',
  initialize: function () { /* nothing to prepare */ },
  open: function (stored) {
    const state = roomWorkshop;
    state.seed = Number.isFinite(stored.seed) ? clampNumber(Math.round(stored.seed), 1, 99) : 1;
    state.showUnwalkable = stored.showUnwalkable === true;
    state.previewLocation = typeof stored.previewLocation === 'string' ? stored.previewLocation : '';
    state.showsAsAStationHasIt = stored.showsAsAStationHasIt === true;
    if (Number.isFinite(stored.growNumber)) state.growNumber = Math.max(1, Math.round(stored.growNumber));
    if (Number.isFinite(stored.growFill)) state.growFill = clampNumber(stored.growFill, 0.3, 0.55);
    if (ROOM_WORKSHOP_BRUSHES.some(function (brush) { return brush[0] === stored.brush; })) state.brush = stored.brush;
    if (Number.isFinite(stored.brushFloor)) state.brushFloor = roundDesignedHeight(clampNumber(stored.brushFloor, DESIGNED_ROOM_LIMITS.lowestFloor, DESIGNED_ROOM_LIMITS.highestFloor));
    if (Number.isFinite(stored.brushCeiling)) state.brushCeiling = roundDesignedHeight(clampNumber(stored.brushCeiling, DESIGNED_ROOM_LIMITS.minimumHeadroom, DESIGNED_ROOM_LIMITS.highestTileCeiling));
    if (Number.isFinite(stored.brushSize)) state.brushSize = clampNumber(Math.round(stored.brushSize), 1, 5);
    let hasDraft = stored.draft && typeof stored.draft === 'object' && typeof stored.key === 'string';
    // Work in progress that is the same as the file is not work in progress (it was saved just before a reload).
    if (hasDraft && stored.savedKey === stored.key && designedRooms[stored.key] &&
        JSON.stringify(normalizeDesignedRoom(stored.draft, stored.key)) === JSON.stringify(designedRooms[stored.key])) hasDraft = false;
    if (hasDraft) openRoomInWorkshop(stored.key, stored.draft, stored.savedKey && designedRooms[stored.savedKey] ? stored.savedKey : null);
    else openRoomInWorkshop(ROOM_CATALOGUE[stored.key] ? stored.key : getDefaultRoomWorkshopKey());
    if (state.room && Number.isInteger(stored.selectedIndex)) state.selectedIndex = clampNumber(stored.selectedIndex, -1, state.room.items.length - 1);
    // Back where the camera was, if this is the room it was looking at.
    if (stored.cameraKey === state.key) restoreWorkshopCamera('rooms');
    state.isPainting = stored.isPainting === true && state.room !== null;
  },
  close: function () { roomWorkshop.drag = null; roomWorkshop.stroke = null; roomWorkshop.hoverTile = null; },
  storeState: function (stored) {
    const state = roomWorkshop;
    stored.key = state.key;
    stored.cameraKey = state.key;
    stored.savedKey = state.savedKey;
    stored.draft = state.room && state.isDirty ? state.room : null;
    stored.selectedIndex = state.selectedIndex;
    stored.seed = state.seed;
    stored.showUnwalkable = state.showUnwalkable;
    stored.previewLocation = state.previewLocation;
    stored.showsAsAStationHasIt = state.showsAsAStationHasIt;
    stored.growNumber = state.growNumber; stored.growFill = state.growFill;
    stored.isPainting = state.isPainting;
    stored.brush = state.brush; stored.brushFloor = state.brushFloor; stored.brushCeiling = state.brushCeiling; stored.brushSize = state.brushSize;
  },
  save: saveRoomWorkshop,
  moveCameraInside: function () {
    showRoomWorkshopFromDoor();
    setWorkshopStatus('Lights off shows what the scanner returns, so the view has moved inside the room.', 'info');
  },
  update: updateRoomWorkshop,
  addOverlays: addRoomWorkshopOverlays,
  renderPanel: renderRoomWorkshopPanel,
  onPointerDown: onRoomWorkshopPointerDown,
  onPointerMove: onRoomWorkshopPointerMove,
  onPointerUp: onRoomWorkshopPointerUp,
  onWheel: onRoomWorkshopWheel,
  onKey: onRoomWorkshopKey
};
