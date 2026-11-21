// ---------------------------------------------------------------------------
// Pockets: somewhere to put a small thing besides the beam.
//
// The scanner's beam holds one thing, out in front of you, where it is in the way of your scanning, slows you
// down and can be knocked out of your grip. That is how you carry, and it stays that way for nearly
// everything. But a first aid kit and a scan grenade are two things, and the beam is one: so you have pockets
// as well. Few of them (TUNING.pocketCount), and only for the few kinds of thing that say they go in one.
//
// What fits: a kind of loose object with `pocket: true` (LOOSE_OBJECT_KINDS, 08-loose-objects.js). Today that
// is the scan grenade, the first aid kit and the survey spool (which the lift terminal takes out of your
// pockets: loadSpoolsAtTheTerminal, 11-game.js). Everything else is carried in the beam, a sample jar included:
// what is worth something to Salvage is not got to a bay by the pocketful.
// Nor does a thing fit while it is doing something: a grenade that has been armed.
//
// How it goes: a thing gets into a pocket out of the beam, and out of a pocket into the beam.
//   - R puts what the beam holds into the first pocket that is free.
//   - 4, 5, 6 and 7 are the pockets. With the beam empty, a pocket's key takes what is in it into the beam.
//     With something small in the beam it goes into that pocket, and what was in the pocket comes out into
//     the beam in its place.
// So a thing in a pocket is used by taking it out: 5, then Q.
//
// What a pocket does to a thing: it is out of the station for as long as it is in there. Nothing can scan it,
// knock it, kick it or carry it off (a looter cannot get into a pocket), and it is in no salvage bay.
// It still weighs what it weighs: your pockets slow you as the beam does, by their load.
//
// What is in your pockets when you die: all of it lies where you fell. Alone you wake at your checkpoint
// without it and go back for it, or do not. Down there with others it lies by your scanner.
//
// Down there with others, what is in whose pockets is the same in every game: putting a thing in, taking one
// out and spilling them are done to the station ('stow', 'unstow', 'spill': asked of the host, done by all in
// the host's order).
// ---------------------------------------------------------------------------

// Whose pockets hold what: for each player (by their number in the lobby; 0 when you are alone), a list of
// TUNING.pocketCount places, each a loose object or null. A thing in a pocket is in no other list: it is not
// one of `looseObjects` until it comes out again.
const pocketsByPlayer = {};

function getPocketOwnerId() {
  return isWorldShared() ? together.myId : 0;
}

function getPocketsOf(playerId) {
  if (!pocketsByPlayer[playerId]) pocketsByPlayer[playerId] = new Array(TUNING.pocketCount).fill(null);
  return pocketsByPlayer[playerId];
}

function getOwnPockets() {
  return getPocketsOf(getPocketOwnerId());
}

// A new descent: every pocket is empty.
function resetPockets() {
  for (const playerId in pocketsByPlayer) delete pocketsByPlayer[playerId];
}

// Does this thing go into a pocket, as it is right now?
function canLooseObjectBePocketed(object) {
  const kind = object.kind;
  if (object.fallenPlayerId || object.isRemoved) return false;                      // somebody's scanner is carried, in the open
  if (object.isSpent) return false;                                                 // used up: it is litter now
  if (object.armedTime >= 0 || object.isOn) return false;                           // it is doing something
  return kind.pocket === true;
}

// The thing with this number, if it is in somebody's pocket: { object, playerId, slot }, or null.
function findPocketedObject(id) {
  for (const playerId in pocketsByPlayer) {
    const slots = pocketsByPlayer[playerId];
    for (let slot = 0; slot < slots.length; slot++) if (slots[slot] && slots[slot].id === id) return { object: slots[slot], playerId: Number(playerId), slot: slot };
  }
  return null;
}

// Everything that is in a pocket, anybody's.
function listPocketedObjects() {
  const all = [];
  for (const playerId in pocketsByPlayer) for (const object of pocketsByPlayer[playerId]) if (object) all.push(object);
  return all;
}

// What your pockets weigh, in kilograms.
function getPocketMass() {
  let mass = 0;
  for (const object of getOwnPockets()) if (object) mass += object.kind.mass;
  return mass;
}

// ---------------------------------------------------------------------------
// The keys (09-player.js sets what was pressed; this is called every frame you are at the controls)
// ---------------------------------------------------------------------------

function updatePocketInput() {
  const wantsStow = input.wantsStow, wantedPocket = input.wantsPocket;
  input.wantsStow = false; input.wantsPocket = -1;
  const slots = getOwnPockets(), held = getHeldLooseObject();
  if (wantsStow) {
    if (!held) return;
    if (!canLooseObjectBePocketed(held)) { showMessage(describeWhyNotPocketed(held), 3, 'info'); return; }
    const free = slots.indexOf(null);
    if (free < 0) { showMessage('Your pockets are full.', 3, 'info'); return; }
    askToAct({ what: 'stow', id: held.id, slot: free });
    return;
  }
  if (wantedPocket < 0 || wantedPocket >= slots.length) return;
  const inPocket = slots[wantedPocket];
  if (held) {
    // Into that pocket; what was in it comes out into the beam.
    if (!canLooseObjectBePocketed(held)) { showMessage(describeWhyNotPocketed(held), 3, 'info'); return; }
    askToAct({ what: 'stow', id: held.id, slot: wantedPocket });
  } else if (inPocket) {
    askToAct({ what: 'unstow', id: inPocket.id });
  }
}

function describeWhyNotPocketed(object) {
  if (object.kind.pocket === true && object.isSpent) return 'It is used up. Not worth a pocket.';
  if (object.kind.pocket === true && (object.armedTime >= 0 || object.isOn)) return 'Not while it is armed.';
  return 'The ' + object.kind.label + ' does not fit in a pocket.';
}

// ---------------------------------------------------------------------------
// What is done to the station (11-together.js: performAction)
// ---------------------------------------------------------------------------

function isPocketAction(what) {
  return what === 'stow' || what === 'unstow' || what === 'spill';
}

// Whoever is doing this: their number, and where they stand.
function getPocketActor() {
  const actor = game.actor || player;
  return { id: isWorldShared() ? together.actingId : 0, isYou: !game.actor, x: actor.x, z: actor.z };
}

// Takes a thing out of the station and into a pocket's keeping. (Not out of anybody's beam: that is done before.)
function takeLooseObjectOutOfTheStation(object) {
  changePointsOnLooseObject(object, 0); // its points do not stay behind in the air
  wakeLooseObjectsTouching(object);
  forgetLooseObjectInTiles(object);
  const index = looseObjects.indexOf(object);
  if (index >= 0) looseObjects.splice(index, 1);
  object.isHeld = false; object.heldById = 0; object.ownerId = 0; object.rideCrateId = 0;
  object.velocityX = 0; object.velocityY = 0; object.velocityZ = 0; object.spinX = 0; object.spinY = 0; object.spinZ = 0;
  object.isAsleep = true; object.wasMovingWhenSaid = false; object.hasRestPoints = false;
}

// Puts a thing that was in a pocket back into the station at a place, awake, in nobody's beam.
function putLooseObjectBackIntoTheStation(object, x, y, z) {
  object.x = x; object.y = y; object.z = z;
  object.lastGoodX = x; object.lastGoodY = y; object.lastGoodZ = z;
  object.settleX = x; object.settleY = y; object.settleZ = z; object.settleSeconds = 0; object.restSeconds = 0;
  object.velocityX = 0; object.velocityY = 0; object.velocityZ = 0;
  object.isAsleep = false; object.isMoving = true; object.isLost = false;
  updateLooseObjectMatrix(object);
  looseObjects.push(object);
  noteLooseObjectInTiles(object);
}

// Out of a pocket and into its owner's beam.
function bringOutIntoTheBeam(object, actor) {
  if (actor.isYou) {
    // Where the beam would hold it right now: straight out from the scanner's lens (as computeLooseHoldTarget
    // has it, 08-loose-objects.js, which only keeps that up to date while the beam holds something).
    computeHeldScannerBasis();
    updateScanEmitterAtLens(player.x, getPlayerEyeY(), player.z);
    const distance = TUNING.looseHoldDistance + object.prepared.partsRadius;
    putLooseObjectBackIntoTheStation(object, scanEmitter.x + scannerBasis.forwardX * distance, scanEmitter.y + scannerBasis.forwardY * distance, scanEmitter.z + scannerBasis.forwardZ * distance);
    object.heldById = actor.id; object.ownerId = actor.id;
    pickUpLooseObjectNow(object, false);
  } else {
    // Somebody else's: it is in their beam from now, and their game says where that is.
    putLooseObjectBackIntoTheStation(object, actor.x, getFloorHeightAt(actor.x, actor.z) + 1.2, actor.z);
    object.heldById = actor.id; object.ownerId = actor.id;
  }
  object.wasHandled = true; object.isIgnoredByHollow = false; object.lastHandledTime = game.time; object.hasBeenTaken = true;
}

function performPocketAction(action) {
  const actor = getPocketActor(), slots = getPocketsOf(actor.id);
  if (action.what === 'stow') {
    const object = findLooseObjectById(action.id);
    if (!object || action.slot < 0 || action.slot >= slots.length || !canLooseObjectBePocketed(object)) return;
    // Only out of their own beam.
    if (actor.isYou ? looseState.held !== object : object.heldById !== actor.id) return;
    if (actor.isYou) { looseState.held = null; looseState.isLettingGo = false; looseState.lettingGoSeconds = 0; looseState.holdBreakTimer = 0; }
    takeLooseObjectOutOfTheStation(object);
    const before = slots[action.slot];
    slots[action.slot] = object;
    if (before) bringOutIntoTheBeam(before, actor); // the two change places
    if (actor.isYou) { playLooseObjectHandlingSound(object.kind.material, true); refreshObjective(); }
  } else if (action.what === 'unstow') {
    const found = findPocketedObject(action.id);
    if (!found || found.playerId !== actor.id) return;
    // Their beam has to be free.
    if (actor.isYou ? looseState.held !== null : looseObjects.some(function (other) { return other.heldById === actor.id; })) return;
    slots[found.slot] = null;
    bringOutIntoTheBeam(found.object, actor);
  } else if (action.what === 'spill') {
    spillPocketsOf(actor.id, action.x, action.y, action.z);
  }
}

// Everything in one player's pockets, on the floor round a place.
function spillPocketsOf(playerId, x, y, z) {
  const slots = getPocketsOf(playerId);
  let count = 0;
  for (let slot = 0; slot < slots.length; slot++) {
    const object = slots[slot];
    if (!object) continue;
    slots[slot] = null;
    // In a small ring, so that they do not all start in the same spot. One that would start in a wall is put
    // back where the middle is by the next step (lastGood, 08-loose-objects.js).
    const turn = slot / slots.length * TWO_PI, reach = 0.22;
    putLooseObjectBackIntoTheStation(object, x, y + 0.15 * count, z);
    object.x = x + Math.cos(turn) * reach; object.z = z + Math.sin(turn) * reach;
    if (!isLooseSpaceOpenAt(Math.floor(object.x), Math.floor(object.z), object.y)) { object.x = x; object.z = z; }
    refreshLooseObjectTiles(object);
    count++;
  }
  return count;
}

// You have died (11-game.js): what was in your pockets lies where you fell.
function spillOwnPockets() {
  if (!getOwnPockets().some(function (object) { return object !== null; })) return;
  askToAct({ what: 'spill', x: Math.round(player.x * 1000) / 1000, y: Math.round((getFloorHeightAt(player.x, player.z) + 0.3) * 1000) / 1000, z: Math.round(player.z * 1000) / 1000 });
}
