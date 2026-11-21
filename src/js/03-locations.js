// ---------------------------------------------------------------------------
// Locations: where a generated station is. The pumping annex is one; a mine is another.
//
// The job is the same in every one of them (mains, cards, the shaft, the lift: planStation in 03-levelgen.js
// and the quests in 09-quests.js know nothing of this file). What a location decides is everything round the job:
//   label          what the title screen calls it
//   introLines     the first two lines on the black screen after "Begin descent": its name, and where it is.
//                  Left out: Kessel-9's (INTRO_LINES in 00-config.js)
//   noDrawingsLine the last of those lines. {seed} becomes the station's number
//   codeRooms      which of the extra rooms that are written as code (ROOM_CATALOGUE, 03-levelgen.js) it has:
//                  'all', or a list of their keys. The rooms made in the workshop say for themselves where they
//                  belong (`locations` in their files, 03-workshop-rooms.js).
//   roomNames      other names for rooms, by key: what is on their doors and on the map. Leave alone the rooms
//                  that dispatch names over the radio (RADIO_MESSAGES in 00-config.js: Pump Hall B, the
//                  calibration store, Shaft 9, the lobby), unless there is a line and a recording to go with
//                  the new name; and LIFT LOBBY and STAIRS, which the game knows by those names.
//   signTexts      other words for lettering that rooms written as code put on their own walls, by what it says
//   look           what its rooms are made of, where nothing else says: a key of LOOK_KEYS (02-world.js)
//   roomLooks      ... and what single rooms are made of, by key. A room made in the workshop can also say so
//                  itself, and then that goes.
//   corridorLook   what its corridors and service ducts are made of. (Vents are sheet metal everywhere.)
//   corridorStyle  what its corridors are: 'serviced' (pipes, lamps, frames), 'drift' (timber and track) or
//                  'passage' (no corridor at all: a way through the rock that winds, 04-caverns.js)
//   corridorWidth  how many tiles wide its corridors are planned. Left out: two. A passage wants three, to wind in.
//   corridorName   what its corridors are called on the map: CORRIDOR A, DRIFT A, PASSAGE A
//   roomDressing   what the place has done to the rooms that were built in it, on top of what they have in them
//                  everywhere: 'mine' (props under the roof, bars, what came down) or 'cave' (what grows from a
//                  roof and through a floor). Left out: nothing (dressBuiltRoom, 04-caverns.js)
//   scrawls        what may be scratched on its corridor walls
//
// To add a location: add an entry here, give it rooms (tick it for rooms in the workshop, or list rooms written
// as code), and it is on the title screen. A location needs at least one extra room that may stand behind a
// keycard and has a place to leave a card (`itemSpot`), or a station with two or three cards cannot be planned.
// ---------------------------------------------------------------------------

// The place a station is in where nothing says which: Kessel-9, a room file from before there were places, a
// station a test asks for by its seed alone, a descent somebody shares without saying where. It is not what
// the title screen starts on: that is ANY_LOCATION_KEY, below.
const DEFAULT_LOCATION_KEY = 'annex';

// What "Place" on the title screen can be besides one of the places: any of them. Which one a descent is in is
// then drawn from its seed, as everything else about it is: an empty seed box is somewhere else every time, and
// a seed that is typed in is the same station in the same place whenever it is typed.
const ANY_LOCATION_KEY = 'random';

const LOCATIONS = {
  annex: {
    label: 'Pumping annex',
    noDrawingsLine: 'No drawings survive for this annex. Survey reference {seed}.',
    codeRooms: 'all',
    roomNames: {},
    signTexts: {},
    look: 'panel', roomLooks: {}, corridorLook: 'panel',
    corridorStyle: 'serviced', corridorName: 'CORRIDOR',
    scrawls: CORRIDOR_SCRAWLS
  },
  mine: {
    label: 'Mine',
    introLines: ['CORVEN DEEP · No. 2 LEVEL', '340 m below grade. Worked out 1974. Pumped until 1987.'],
    noDrawingsLine: 'No plans survive for these workings. Survey reference {seed}.',
    codeRooms: ['workshop', 'washroom', 'electricalRoom', 'storageHall', 'floodedRoom', 'infirmary', 'pipeGallery', 'coreStore', 'batteryRoom', 'dryingRoom', 'oldWorkings'],
    roomNames: { securityOffice: 'SHIFT OFFICE', messRoom: 'CRIB ROOM', storeCloset: 'TOOL STORE', workshop: 'FITTING SHOP', infirmary: 'FIRST AID STATION', batteryRoom: 'LAMP ROOM' },
    signTexts: { 'KESSEL-9 · INTAKE LEVEL': 'CORVEN DEEP · No. 2 LEVEL', 'SECURITY': 'SHIFT OFFICE' },
    // What was built down there is brick; what was only dug is the rock itself.
    look: 'masonry', roomLooks: { pumpHall: 'rock', shaftChamber: 'rock', stairwell: 'rock', floodedRoom: 'rock', oldWorkings: 'rock', pipeGallery: 'rock', storageHall: 'rock' }, corridorLook: 'rock',
    corridorStyle: 'drift', corridorName: 'DRIFT', roomDressing: 'mine',
    scrawls: CORRIDOR_SCRAWLS.concat(['IT CAME UP THE SHAFT', 'LAMPS OUT', 'NOT THE ROOF. LISTEN'])
  },
  // A cave that somebody built a works into: what was built is still what the job is about (the lift, the pumps,
  // the generator, the shaft), and between those rooms there is only the cave. Its own rooms are grown afresh
  // for every station (the caverns of 04-caverns.js, which say themselves that they belong here).
  cave: {
    label: 'Cave',
    introLines: ['VESPER POT · INTAKE WORKS', '190 m under the moor. The works were given up in 1987.'],
    noDrawingsLine: 'Nobody surveyed the cave past the works. Survey reference {seed}.',
    codeRooms: ['electricalRoom', 'storageHall', 'floodedRoom', 'pipeGallery', 'coreStore', 'oldWorkings'],
    roomNames: {},
    signTexts: { 'KESSEL-9 · INTAKE LEVEL': 'VESPER POT · INTAKE WORKS' },
    look: 'panel', roomLooks: { pumpHall: 'rock', shaftChamber: 'rock', stairwell: 'rock', floodedRoom: 'rock', oldWorkings: 'rock', pipeGallery: 'rock' }, corridorLook: 'rock',
    corridorStyle: 'passage', corridorWidth: 3, corridorName: 'PASSAGE', roomDressing: 'cave',
    scrawls: CORRIDOR_SCRAWLS.concat(['THIS WAY OUT', 'IT KNOWS THE CAVE', 'NO ECHO HERE'])
  }
};

function getLocation(locationKey) {
  return Object.prototype.hasOwnProperty.call(LOCATIONS, locationKey) ? LOCATIONS[locationKey] : LOCATIONS[DEFAULT_LOCATION_KEY];
}

// The place the title screen is set to, as it is kept: one of the places, or any of them. Anything else (nothing
// kept yet, or a place this game no longer has) is any of them.
function resolvePlaceSetting(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LOCATIONS, value) ? value : ANY_LOCATION_KEY;
}

// Which place a seed is in, when the title screen leaves that to the seed.
function chooseLocationForSeed(seed) {
  const keys = Object.keys(LOCATIONS);
  const draw = createSeededRandomGenerator((Math.imul(seed | 0, 2246822519) ^ 0x51ed270b) >>> 0);
  draw(); // (the first number of two seeds that are next to each other is too much alike)
  return keys[Math.floor(draw() * keys.length)];
}

// The key of a location this game has: the one given, or the annex.
function resolveLocationKey(locationKey) {
  return typeof locationKey === 'string' && Object.prototype.hasOwnProperty.call(LOCATIONS, locationKey) ? locationKey : DEFAULT_LOCATION_KEY;
}

// Whether an extra room of the catalogue belongs in a location.
function isRoomOfLocation(roomKey, locationKey) {
  const definition = ROOM_CATALOGUE[roomKey];
  // (A room that says itself where it belongs: one made in the workshop, or one that is grown.)
  if (definition.locations) return definition.locations.indexOf(locationKey) >= 0;
  if (definition.isDesigned) return locationKey === DEFAULT_LOCATION_KEY;
  const codeRooms = getLocation(locationKey).codeRooms;
  return codeRooms === 'all' || codeRooms.indexOf(roomKey) >= 0;
}

// What a room of the catalogue is called there.
function getLocationRoomName(locationKey, roomKey, ownName) {
  return getLocation(locationKey).roomNames[roomKey] || ownName;
}

// What a room is made of there: a LOOK_ number. `roomKey` may also be 'corridor', 'duct', 'bay' or 'vent'.
function getLocationRoomLook(locationKey, roomKey) {
  const location = getLocation(locationKey);
  if (roomKey === 'vent') return LOOK_PANEL;
  if (roomKey === 'corridor' || roomKey === 'duct' || roomKey === 'bay') return LOOK_KEYS[location.corridorLook] || LOOK_PANEL;
  const definition = ROOM_CATALOGUE[roomKey];
  const lookKey = (definition && definition.look) || location.roomLooks[roomKey] || location.look;
  return LOOK_KEYS[lookKey] || LOOK_PANEL;
}
