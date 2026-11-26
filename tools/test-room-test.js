// Checks the rooms a test builds for itself (src/js/03-single-room.js, `lastReturnDebug.loadTestRoom`): one room
// on its own, written into the check as plain data, instead of a whole station. A check that is about a thing (a
// grenade, a tripod) and not about a station uses one, so that it knows exactly what is around that thing and
// never has to search a station for a clear spot.
//
// That such a room is what its data says: its size, its door, the things it is furnished with where they are
// said to be, the loose things lying where they are said to lie, at rest (on the floor or on a table), you where
// it says you start, facing the way it says, with empty pockets and no lift; that a kind of loose thing that does
// not exist is left out and said; that a room file from src/rooms/ can be loaded the same way, and a name that is
// no room file cannot; that the same room built twice is the same; that the game plays in it, a new run puts
// everything back where the room has it, and a station can be loaded again afterwards.
const { openGame, startGame } = require('./browser-harness.js');

const failures = [];
function check(description, condition, detail) {
  const line = (condition ? 'ok    ' : 'FAIL  ') + description + (detail !== undefined ? '  ' + JSON.stringify(detail) : '');
  console.log(line);
  if (!condition) failures.push(description);
}

// The room most of the checks use: ten metres by eight, a door in the south wall, a table, a box and some loose
// things, one of them on the table and one of a kind that does not exist.
const ROOM = {
  name: 'CHECK ROOM', width: 10, depth: 8, ceiling: 3, doors: [{ wall: 'south', at: 5 }],
  items: [
    { type: 'table', x: 2.5, z: 2.5, angle: 0, lengthX: 1.6, lengthZ: 0.8, height: 0.76 },
    { type: 'box', x: 8, z: 2, angle: 0, sizeX: 1, sizeZ: 1, sizeY: 1.2, bottom: 0, surface: 'plain', isSolid: true }
  ],
  looseObjects: [
    { kind: 'scanGrenade', x: 5, z: 4 },
    { kind: 'scannerTripod', x: 6.5, z: 5, angle: 90 },
    { kind: 'scanGrenade', x: 2.5, z: 2.5, height: 0.76 },
    { kind: 'noSuchThing', x: 1, z: 6 }
  ],
  playerStart: { x: 5, z: 6.5, angle: 90 }
};

(async () => {
  const { browser, page, problems } = await openGame({ dev: true });
  const inGame = (callback, argument) => page.evaluate(callback, argument);
  await startGame(page, false);

  // --- a room from data ---
  const built = await inGame((room) => {
    const d = window.lastReturnDebug, round = (value) => Math.round(value * 100) / 100;
    d.setDebugOption('holdArrivals', true);
    const loaded = d.loadTestRoom(room);
    const origin = loaded.origin;
    // Where the scanner meets something, level at waist height, from the middle of the room towards each wall.
    const reach = function (directionX, directionZ) {
      const x = origin.x + 5, z = origin.z + 4.6, y = d.getFloorHeightAt(x, z) + 1;
      return d.castScannerRay(x, y, z, directionX, 0, directionZ, 30) ? round(d.rayHit.distance) : -1;
    };
    return {
      problems: loaded.problems, origin: origin, start: loaded.start,
      player: { x: d.player.x, z: d.player.z, yaw: round(d.player.yaw) },
      zone: d.zoneNames[1], lift: d.getLiftDoor(), doors: d.doors.length,
      pockets: d.listPocketedObjects().length, held: d.getHeldLooseObject() === null,
      // From x = 5, z = 4.6 in the room: 5 m to the west and east walls, 4.6 to the north wall; the box is in the way to the north-east.
      walls: { west: reach(-1, 0), east: reach(1, 0), north: reach(0, -1) },
      boxInTheWay: (function () {
        const x = origin.x + 6, z = origin.z + 2, y = d.getFloorHeightAt(x, z) + 0.6;
        return d.castScannerRay(x, y, z, 1, 0, 0, 5) ? round(d.rayHit.distance) : -1; // the box's west face is at x = 7.5
      })(),
      loose: d.looseObjects.map((object) => ({ kind: object.kindKey, x: round(object.x - origin.x), z: round(object.z - origin.z),
        aboveTheFloor: round(object.y - d.getFloorHeightAt(object.x, object.z)), isAsleep: object.isAsleep, id: object.id })),
      props: d.worldProps.length,
      mode: d.game.mode
    };
  }, ROOM);
  check('a room from data loads, and says what in it could not be built: the loose thing of a kind that does not exist, and nothing else',
    built.problems.length === 1 && built.problems[0].indexOf('noSuchThing') >= 0, built.problems);
  check('you start where the room says, facing the way it says (90 degrees: east), with nothing in your pockets or your beam',
    Math.abs(built.player.x - (built.origin.x + 5)) < 0.01 && Math.abs(built.player.z - (built.origin.z + 6.5)) < 0.01 && Math.abs(built.player.yaw - Math.PI / 2) < 0.01 &&
      built.pockets === 0 && built.held, built.player);
  check('it is the room it says it is: its name, ten by eight metres between its walls, one door and no lift',
    built.zone === 'CHECK ROOM' && Math.abs(built.walls.west - 5) < 0.1 && Math.abs(built.walls.east - 5) < 0.1 && Math.abs(built.walls.north - 4.6) < 0.1 &&
      built.doors === 1 && built.lift === null, built);
  check('what it is furnished with stands where the room says: the box is in the way a metre and a half east of where the check looks from',
    Math.abs(built.boxInTheWay - 1.5) < 0.05, built.boxInTheWay);
  check('its loose things lie where the room says, at rest: the grenade and the tripod on the floor, the other grenade on the table, and nothing else',
    built.loose.length === 3 && built.loose.every((object) => object.isAsleep) &&
      built.loose.some((object) => object.kind === 'scanGrenade' && object.x === 5 && object.z === 4 && object.aboveTheFloor < 0.2) &&
      built.loose.some((object) => object.kind === 'scannerTripod' && object.x === 6.5 && object.z === 5 && object.aboveTheFloor < 0.6) &&
      built.loose.some((object) => object.kind === 'scanGrenade' && object.x === 2.5 && object.z === 2.5 && object.aboveTheFloor > 0.76 && object.aboveTheFloor < 0.95), built.loose);

  // --- the game plays in it, and a new run puts everything back ---
  const played = await inGame(() => {
    const d = window.lastReturnDebug, round = (value) => Math.round(value * 100) / 100;
    const grenade = d.looseObjects.filter((object) => object.kindKey === 'scanGrenade')[0];
    const lyingAt = [grenade.x, grenade.y, grenade.z], startedAt = [d.player.x, d.player.z];
    // Walk forward for two seconds, and knock the grenade across the room.
    d.input.keysDown.add('KeyW');
    d.simulate(2);
    d.input.keysDown.delete('KeyW');
    grenade.velocityX = 3; grenade.isAsleep = false;
    d.simulate(2);
    const moved = { playerMetres: round(Math.hypot(d.player.x - startedAt[0], d.player.z - startedAt[1])), grenadeMetres: round(Math.hypot(grenade.x - lyingAt[0], grenade.z - lyingAt[2])), mode: d.game.mode };
    // A new run in the same room, as "Begin descent" starts one.
    d.startOver();
    d.simulate(1);
    const again = d.looseObjects.filter((object) => object.kindKey === 'scanGrenade' && Math.abs(object.y - lyingAt[1]) < 0.05)
      .map((object) => round(Math.hypot(object.x - lyingAt[0], object.z - lyingAt[2])));
    return { moved: moved, afterStartOver: { mode: d.game.mode, things: d.looseObjects.length, grenadeBackWithin: again.length ? Math.min.apply(null, again) : -1,
      player: [round(d.player.x), round(d.player.z)] } };
  });
  check('the game plays in it: you walk, a knocked grenade rolls, and it is still being played',
    played.moved.mode === 'playing' && played.moved.playerMetres > 1 && played.moved.grenadeMetres > 0.5, played.moved);
  check('a new run in it puts everything back where the room has it: the same three loose things, the grenade where it lay, and it is still being played',
    played.afterStartOver.mode === 'playing' && played.afterStartOver.things === 3 && played.afterStartOver.grenadeBackWithin >= 0 && played.afterStartOver.grenadeBackWithin < 0.05, played.afterStartOver);

  // --- the same room twice is the same ---
  const twice = await inGame((room) => {
    const d = window.lastReturnDebug;
    const describe = function () {
      return JSON.stringify({ props: d.worldProps.map((prop) => [Math.round(prop.centerX * 1000), Math.round(prop.centerY * 1000), Math.round(prop.centerZ * 1000)]),
        loose: d.looseObjects.map((object) => [object.id, object.kindKey, Math.round(object.x * 1000), Math.round(object.y * 1000), Math.round(object.z * 1000)]) });
    };
    d.loadTestRoom(room); const first = describe();
    d.loadStation('classic', 0);
    d.loadTestRoom(room); const second = describe();
    return { same: first === second, length: first.length };
  }, ROOM);
  check('the same room built twice, with a station built in between, is the same: every prop and every loose thing in the same place, with the same number',
    twice.same && twice.length > 100, twice);

  // --- a room file, and a name that is no room file ---
  const fromFiles = await inGame(() => {
    const d = window.lastReturnDebug, keys = Object.keys(d.designedRooms);
    if (keys.length === 0) return { keys: 0 };
    const key = keys[0], room = d.designedRooms[key];
    const loaded = d.loadTestRoom(key);
    return { keys: keys.length, key: key, zone: d.zoneNames[1], name: room.name, problems: loaded.problems, doors: d.doors.length, wantedDoors: room.doors.length,
      isInside: d.player.x > loaded.origin.x && d.player.x < loaded.origin.x + room.width && d.player.z > loaded.origin.z && d.player.z < loaded.origin.z + room.depth,
      noSuchRoom: d.loadTestRoom('noSuchRoomFile') };
  });
  check('a room file from src/rooms/ loads the same way, by its name, with you inside it; a name that is no room file loads nothing',
    fromFiles.keys > 0 && fromFiles.zone === fromFiles.name && fromFiles.problems.length === 0 && fromFiles.isInside && fromFiles.doors >= 1 && fromFiles.noSuchRoom === null, fromFiles);

  // --- a station afterwards ---
  const station = await inGame(() => {
    const d = window.lastReturnDebug;
    d.loadStation('classic', 0);
    d.game.flags.hasLeftLift = true;
    d.simulate(1);
    return { lift: d.getLiftDoor() !== null, loose: d.looseObjects.length, mode: d.game.mode, zones: d.zoneNames.length };
  });
  check('a station loads again after a room on its own, with its lift and its own loose things, and is played',
    station.lift && station.loose > 10 && station.mode === 'playing' && station.zones > 5, station);

  check('no script errors were reported', problems.length === 0, problems);
  await browser.close();

  if (failures.length > 0) {
    console.log('\n' + failures.length + ' check(s) failed.');
    process.exit(1);
  }
  console.log('\nAll test room checks passed.');
})().catch((error) => { console.error('Test room test crashed:', error); process.exit(1); });
