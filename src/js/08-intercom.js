// ---------------------------------------------------------------------------
// The intercom: a microphone on a desk, and loudspeakers through the station.
//
// A station that has a security office or a control room has a console there, on the desk: a base, a stalk and
// a microphone. And on a wall of nearly every room and corridor, up by the ceiling, a loudspeaker.
//
//   - It needs the mains. Without them the console is dead.
//   - [E] at a console switches it on. Every loudspeaker in the station shrieks with feedback as it comes on,
//     and hisses for as long as it is on. [E] again switches it off, and it goes off by itself when whoever
//     switched it on walks away from the desk, or falls.
//   - Descending together, with voice on (11-voice.js): what the one at the desk says comes out of every
//     loudspeaker, for everybody, thin and overdriven, a little late from the ones further off. Not for
//     themselves: your own voice back from a loudspeaker, into your own microphone, would be the real thing.
//   - A loudspeaker is heard the way a voice is (11-voice.js): straight if nothing is in between, round through
//     what stands open if there is a way round, and otherwise through the wall, muffled: duller and quieter.
//     So a shut door muffles the loudspeaker behind it, and opening it lets it through.
//   - Everything that listens hears the loudspeakers. The shriek is a noise at every one of them, and so is a
//     voice for as long as it talks. So alone, with no voice at all, it is still worth pressing: the Hollow
//     goes to the loudspeaker nearest to it. And together it is a way to talk to everybody at once that
//     everything else hears too.
//
// What is on, at which console and by whom is the station's, like a door: it is done in every game in the
// host's order (11-together.js). Switching on and off is "using" the console; going off by itself is the
// host's game's to say ('intercomOff'). The sounds each game makes for itself.
// ---------------------------------------------------------------------------

const OBJECT_INTERCOM_DESK = 17;     // the console in the security office
const OBJECT_INTERCOM_CONTROL = 18;  // ... and the one in the control room
const INTERCOM_OBJECT_IDS = [OBJECT_INTERCOM_DESK, OBJECT_INTERCOM_CONTROL];
const INTERCOM_PROMPT_OFF = 'Intercom: switch on', INTERCOM_PROMPT_ON = 'Intercom: switch off';
const INTERCOM_SLOTS = 3;            // how many loudspeakers you hear at once: the loudest ones, as they come to you (through a wall, or round)
const INTERCOM_SOUND_METRES_A_SECOND = 230; // how fast its sound seems to travel: slower than sound does, so that the echo between two loudspeakers is heard
const INTERCOM_SLOT_SECONDS = 0.2;   // how often which loudspeakers you hear, and how, is looked at again
const INTERCOM_CLEAR_HERTZ = 8000;   // a loudspeaker that is not muffled: everything it says comes through (it says nothing above 2600 anyway)
const INTERCOM_IN_THE_WAY_MARGIN = 0.5; // something nearer to a loudspeaker than this along the line to it is its own box and rim, or the wall it hangs on: not in between

const intercom = {
  isOn: false,
  objectId: 0,          // which console it was switched on at
  byId: 0,              // who switched it on: their number in the lobby (0: you, alone)
  seconds: 0,           // how long it has been on
  noiseTimer: 0,        // the host's game: until a voice through it is next a noise
  slotTimer: 0,
  captionTimer: 0,
  sound: null,          // the nodes it is heard through, once there is sound at all (buildIntercomSound)
  statistics: { shrieks: 0, noises: 0, switchedOffByItself: 0 } // for the tests
};

// ---- Building it into a station ----

// A console on a desk, at this place. (Called while a room is furnished: 03-layout.js. In a generated station
// the place is the room's own, and is moved and turned with it.)
function addIntercomConsole(objectId, x, deskTopY, z) {
  if (findInteractableByObjectId(objectId)) return; // (a station has each of them once)
  const options = { surfaceClass: SURFACE_INTERACTIVE, blocksMovement: false };
  const base = addBoxProp(x, deskTopY + 0.035, z, 0.11, 0.035, 0.08, options);
  const stalk = addBoxProp(x, deskTopY + 0.17, z, 0.012, 0.1, 0.012, options);
  const head = addBoxProp(x, deskTopY + 0.29, z, 0.03, 0.03, 0.045, options);
  registerInteractable(objectId, x, deskTopY + 0.2, z, INTERCOM_PROMPT_OFF, [base, stalk, head], { mapLabel: 'Intercom' });
}

function hasIntercom() {
  for (const objectId of INTERCOM_OBJECT_IDS) if (findInteractableByObjectId(objectId)) return true;
  return false;
}

// The loudspeakers: in every part of the station that is big enough to have one, on a wall, up by the ceiling.
// A station without a console has none. Where they hang goes by the station's own seed and by nothing else
// that is drawn from it, so that putting them up moves nothing that was there before.
function placeIntercomSpeakers() {
  level.intercomSpeakers.length = 0;
  if (!hasIntercom()) return;
  const random = createSeededRandomGenerator(((level.seed || 0) ^ 0x1c0ffee) >>> 0);
  // Every tile a loudspeaker could hang over, by the part of the station it is in: floor with a wall beside
  // it, room to stand under it, and nothing else there (a door, a vent, a pit, lettering on the wall, the lift car).
  const spotsByZone = {}, tilesByZone = {};
  for (let tileZ = level.boundsMinimumZ; tileZ <= level.boundsMaximumZ; tileZ++) {
    for (let tileX = level.boundsMinimumX; tileX <= level.boundsMaximumX; tileX++) {
      if (!isInsideGrid(tileX, tileZ)) continue;
      const index = tileIndexAt(tileX, tileZ), zone = tileZone[index];
      if (zone === 0 || tileIsWalkable[index] === 0) continue;
      tilesByZone[zone] = (tilesByZone[zone] || 0) + 1;
      if (tileCeilingHeight[index] - tileFloorHeight[index] < TUNING.intercomSpeakerHeight + 0.3) continue;
      if ((tileFlags[index] & (TILE_FLAG_VENT | TILE_FLAG_PIT)) !== 0 || tileSignLists[index]) continue;
      if (tileX + 0.5 > LIFT_CAR_BOUNDS.minimumX && tileX + 0.5 < LIFT_CAR_BOUNDS.maximumX && tileZ + 0.5 > LIFT_CAR_BOUNDS.minimumZ && tileZ + 0.5 < LIFT_CAR_BOUNDS.maximumZ && level.kind === 'classic') continue;
      let isAtADoor = false;
      for (const door of doors) if (Math.abs(door.tileX - tileX) <= 1 && Math.abs(door.tileZ - tileZ) <= 1) isAtADoor = true;
      if (isAtADoor) continue;
      for (const way of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const besideX = tileX + way[0], besideZ = tileZ + way[1];
        if (isInsideGrid(besideX, besideZ) && tileIsOpen[tileIndexAt(besideX, besideZ)] !== 0) continue; // (open: not a wall)
        if (!spotsByZone[zone]) spotsByZone[zone] = [];
        spotsByZone[zone].push({ tileX: tileX, tileZ: tileZ, wayX: way[0], wayZ: way[1], floorY: tileFloorHeight[index] });
        break;
      }
    }
  }
  for (const zone of Object.keys(spotsByZone).map(Number).sort(function (first, second) { return first - second; })) {
    const spots = spotsByZone[zone];
    if (tilesByZone[zone] < TUNING.intercomSpeakerSmallestTiles) continue;
    const wanted = Math.min(3, 1 + Math.floor(tilesByZone[zone] / TUNING.intercomSpeakerTilesEach));
    for (let count = 0; count < wanted && spots.length > 0; count++) {
      // (Of a few tries, the one furthest from the loudspeakers that hang already.)
      let best = null, bestMetres = -1;
      for (let attempt = 0; attempt < 6; attempt++) {
        const spot = spots[Math.floor(random() * spots.length)];
        let nearest = 999;
        for (const speaker of level.intercomSpeakers) nearest = Math.min(nearest, distanceBetweenPoints(speaker.x, speaker.z, spot.tileX + 0.5, spot.tileZ + 0.5));
        if (nearest > bestMetres) { bestMetres = nearest; best = spot; }
      }
      if (bestMetres < 5) continue;
      // The box, flat against the wall, and a rim round its front.
      const x = best.tileX + 0.5 + best.wayX * 0.43, z = best.tileZ + 0.5 + best.wayZ * 0.43, y = best.floorY + TUNING.intercomSpeakerHeight;
      const isAlongX = best.wayX !== 0;
      const wasPlacedAs = { turns: placement.turns, offsetX: placement.offsetX, offsetZ: placement.offsetZ, offsetY: placement.offsetY };
      placement.turns = 0; placement.offsetX = 0; placement.offsetZ = 0; placement.offsetY = 0; // (these are places on the map as it is, not in a room's own measure)
      addBoxProp(x, y, z, isAlongX ? 0.07 : 0.17, 0.15, isAlongX ? 0.17 : 0.07, { surfaceClass: SURFACE_METAL, blocksMovement: false });
      addBoxProp(x - best.wayX * 0.075, y, z - best.wayZ * 0.075, isAlongX ? 0.012 : 0.13, 0.11, isAlongX ? 0.13 : 0.012, { surfaceClass: SURFACE_PROP, blocksMovement: false });
      placement.turns = wasPlacedAs.turns; placement.offsetX = wasPlacedAs.offsetX; placement.offsetZ = wasPlacedAs.offsetZ; placement.offsetY = wasPlacedAs.offsetY;
      level.intercomSpeakers.push({ x: x - best.wayX * 0.1, y: y, z: z - best.wayZ * 0.1, zone: zone });
    }
  }
}

// ---- Switching it ----

function findIntercomConsole() {
  return intercom.isOn ? findInteractableByObjectId(intercom.objectId) : null;
}

// Whoever switched it on, as somebody with a place: you, one of the others, or null if they have gone.
function findIntercomSpeaker() {
  if (!intercom.isOn) return null;
  if (!isWorldShared() || intercom.byId === together.myId) return player;
  return findOtherPlayer(intercom.byId);
}

// Are you the one at the microphone? Then what you say goes out through it (11-voice.js).
function isIntercomYours() {
  if (!intercom.isOn || (isWorldShared() && intercom.byId !== together.myId)) return false;
  const console = findIntercomConsole();
  return console !== null && (game.mode === 'playing' || game.mode === 'paused' || game.mode === 'reading') &&
    distanceBetweenPoints(player.x, player.z, console.x, console.z) <= TUNING.intercomReachMetres;
}

function setIntercomPrompts() {
  for (const objectId of INTERCOM_OBJECT_IDS) {
    const console = findInteractableByObjectId(objectId);
    if (console) console.prompt = intercom.isOn && intercom.objectId === objectId ? INTERCOM_PROMPT_ON : INTERCOM_PROMPT_OFF;
  }
}

// [E] at a console, by whoever is doing it (11-game.js, useInteractable). In every game alike.
function useIntercomConsole(console) {
  if (!game.flags.powerOn) {
    playDeniedSound();
    showMessage('No power', 4, 'warning');
    return;
  }
  if (intercom.isOn) {
    const wasAtThisOne = intercom.objectId === console.objectId;
    switchIntercomOff(false);
    if (wasAtThisOne) { showMessage('Intercom off.', 3, 'info'); return; }
    // (On at the other console: this one takes it over.)
  }
  intercom.isOn = true;
  intercom.objectId = console.objectId;
  intercom.byId = together.actingId;
  intercom.seconds = 0; intercom.noiseTimer = 0; intercom.captionTimer = 0;
  setIntercomPrompts();
  intercom.statistics.shrieks++;
  playIntercomShriek();
  showCaption('intercomShriek', findNearestIntercomSpeaker(getViewer()) || console);
  // Every loudspeaker shrieks: everything that listens hears the one it is near.
  makeIntercomNoise(TUNING.noiseRadiusIntercomShriek);
}

function switchIntercomOff(wasByItself) {
  if (!intercom.isOn) return;
  const console = findIntercomConsole();
  intercom.isOn = false;
  intercom.byId = 0; intercom.objectId = 0;
  setIntercomPrompts();
  if (wasByItself) intercom.statistics.switchedOffByItself++;
  playIntercomClick();
  showCaption('intercomOff', findNearestIntercomSpeaker(getViewer()) || console || player);
}

// A new descent: it is off.
function resetIntercom() {
  intercom.isOn = false; intercom.objectId = 0; intercom.byId = 0; intercom.seconds = 0;
  intercom.statistics.shrieks = 0; intercom.statistics.noises = 0; intercom.statistics.switchedOffByItself = 0;
  setIntercomPrompts();
  quietIntercomSound();
}

// ---- What hears it ----

function findNearestIntercomSpeaker(place) {
  let nearest = null, nearestMetres = Infinity;
  for (const speaker of level.intercomSpeakers) {
    const metres = distanceBetweenPoints(speaker.x, speaker.z, place.x, place.z);
    if (metres < nearestMetres) { nearestMetres = metres; nearest = speaker; }
  }
  return nearest;
}

// A noise at every loudspeaker at once, in the game that runs the station. What has still to arrive is brought
// nearer by it once, and not once for every loudspeaker. And the one nearest to the Hollow is said last: it
// goes to the last noise it hears, and the one it would turn to is the one beside it.
function makeIntercomNoise(radius) {
  if (isWorldTheHosts() || level.intercomSpeakers.length === 0) return;
  intercom.statistics.noises++;
  const speakers = level.intercomSpeakers.slice().sort(function (first, second) {
    return distanceBetweenPoints(second.x, second.z, hollow.figure.x, hollow.figure.z) - distanceBetweenPoints(first.x, first.z, hollow.figure.x, hollow.figure.z);
  });
  noteNoiseForArrivals(speakers[speakers.length - 1].x, speakers[speakers.length - 1].z, radius);
  shareWorldSoundsDuring(function () {
    for (const speaker of speakers) for (const kind of CREATURE_KINDS) if (kind.hear) kind.hear(speaker.x, speaker.z, radius, SPACE_STATION);
  });
}

// ---- Every frame (11-game.js) ----

function updateIntercom(dt) {
  if (intercom.isOn) {
    intercom.seconds += dt;
    if (!isWorldTheHosts()) {
      // In the game that runs the station: it goes off by itself when whoever switched it on is no longer at
      // the desk (gone, fallen, walked off), or the mains are.
      const console = findIntercomConsole(), speaker = findIntercomSpeaker();
      const isSpeakerYou = speaker === player;
      const isThere = console && speaker && (isSpeakerYou ? game.mode !== 'dead' && game.mode !== 'dying' && game.mode !== 'title' : !speaker.isFallen) &&
        distanceBetweenPoints(speaker.x, speaker.z, console.x, console.z) <= TUNING.intercomReachMetres;
      if (!isThere || !game.flags.powerOn) {
        if (isWorldShared()) decideAction(together.myId, { what: 'intercomOff' }); else switchIntercomOff(true);
      } else if (isIntercomCarryingVoice()) {
        // A voice through it is a noise at every loudspeaker, for as long as it talks.
        intercom.noiseTimer -= dt;
        if (intercom.noiseTimer <= 0) { intercom.noiseTimer = TUNING.voiceNoiseEverySeconds; makeIntercomNoise(TUNING.noiseRadiusIntercomVoice); }
      } else intercom.noiseTimer = 0;
    }
    if (intercom.isOn) {
      intercom.captionTimer -= dt;
      const nearest = findNearestIntercomSpeaker(getViewer());
      if (nearest && intercom.captionTimer <= 0) {
        intercom.captionTimer = 1;
        showCaption(isIntercomCarryingVoice() && !isIntercomYours() ? 'intercomVoice' : 'intercomHiss', nearest);
      }
    }
  }
  updateIntercomSound(dt);
}

// ---- Its sound ----
//
// Everything it says goes into one place (`bus`) and from there to the few loudspeakers you hear best, each as
// loud as it is near, each a little late by how far off it is (that lateness is the echo of a hall with
// loudspeakers in it), and each muffled if it comes through a wall ("Through a wall", below). Into the bus go
// the hiss and hum of it being on, the shriek of it coming on, and the voice of whoever is at the microphone
// (`voiceIn`: 11-voice.js joins a voice to it), squeezed thin and overdriven first.

function buildIntercomSound() {
  if (intercom.sound || !isAudioReady()) return intercom.sound;
  const context = audio.context, sound = { slots: [], shriekLevel: null }; // (shriekLevel: the shriek of it coming on, while that is still heard)
  sound.bus = context.createGain();
  sound.voiceIn = context.createGain();
  const lowCut = context.createBiquadFilter(); lowCut.type = 'highpass'; lowCut.frequency.value = 480;
  const highCut = context.createBiquadFilter(); highCut.type = 'lowpass'; highCut.frequency.value = 2600;
  const peak = context.createBiquadFilter(); peak.type = 'peaking'; peak.frequency.value = 1500; peak.Q.value = 1.2; peak.gain.value = 9;
  const drive = context.createWaveShaper(); drive.curve = createOverdriveCurve(5);
  const voiceLevel = context.createGain(); voiceLevel.gain.value = 0.9 * SOUND_LEVELS.intercomVoice;
  sound.voiceIn.connect(lowCut); lowCut.connect(peak); peak.connect(highCut); highCut.connect(drive); drive.connect(voiceLevel); voiceLevel.connect(sound.bus);
  // On: a hiss, and the hum of the mains under it.
  sound.bedGain = context.createGain(); sound.bedGain.gain.value = 0;
  const hiss = context.createBufferSource(); hiss.buffer = audio.whiteNoiseBuffer; hiss.loop = true;
  const hissBand = context.createBiquadFilter(); hissBand.type = 'bandpass'; hissBand.frequency.value = 2100; hissBand.Q.value = 0.6;
  const hissLevel = context.createGain(); hissLevel.gain.value = 0.05;
  hiss.connect(hissBand); hissBand.connect(hissLevel); hissLevel.connect(sound.bedGain);
  const hum = context.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 100;
  const humBand = context.createBiquadFilter(); humBand.type = 'lowpass'; humBand.frequency.value = 420;
  const humLevel = context.createGain(); humLevel.gain.value = 0.035;
  hum.connect(humBand); humBand.connect(humLevel); humLevel.connect(sound.bedGain);
  sound.bedGain.connect(sound.bus);
  hiss.start(); hum.start();
  for (let index = 0; index < INTERCOM_SLOTS; index++) {
    // bus -> a little late by how far -> duller when through a wall -> as loud as it comes to you -> from where it hangs
    const slot = { delay: context.createDelay(0.5), muffle: context.createBiquadFilter(), gain: context.createGain(), panner: createPannerNode(0, 2.3, 0, 3, 0),
      speaker: null, level: 0, metres: 0, isMuffled: false };
    slot.muffle.type = 'lowpass'; slot.muffle.frequency.value = INTERCOM_CLEAR_HERTZ; slot.muffle.Q.value = 0.5;
    slot.gain.gain.value = 0;
    sound.bus.connect(slot.delay); slot.delay.connect(slot.muffle); slot.muffle.connect(slot.gain); slot.gain.connect(slot.panner);
    sound.slots.push(slot);
  }
  intercom.sound = sound;
  return sound;
}

function quietIntercomSound() {
  const sound = intercom.sound;
  if (!sound || !isAudioReady()) return;
  const now = audio.context.currentTime;
  sound.bedGain.gain.cancelScheduledValues(now); sound.bedGain.gain.setTargetAtTime(0, now, 0.05);
  cutIntercomShriek();
}

// How loud a loudspeaker is from this far away, 0 to 1, with nothing in between.
function getIntercomSpeakerLevelAtMetres(metres) {
  const nearness = clampNumber(1 - (metres - TUNING.intercomSpeakerFullWithinMetres) / (TUNING.intercomSpeakerCarriesMetres - TUNING.intercomSpeakerFullWithinMetres), 0, 1);
  return nearness * nearness;
}

// How loud a loudspeaker is from where you hear the station, 0 to 1, as the crow flies (walls left out).
function getIntercomSpeakerLevel(speaker, listener, earY) {
  return getIntercomSpeakerLevelAtMetres(Math.hypot(speaker.x - listener.x, speaker.y - earY, speaker.z - listener.z));
}

// ---- Through a wall ----
//
// A loudspeaker comes to you the way a voice does (11-voice.js, "Which way a voice comes to you"):
//   - with nothing in a straight line between you and it, it comes straight: as far as it is;
//   - otherwise, if there is a way round through what stands open (a doorway, an open door, a vent), it comes
//     that way, clear, and from as far as that way is long: quieter, and a little later;
//   - with no way round near enough (every door between you is shut), it comes through the wall: muffled.
//     TUNING.intercomSpeakerMuffledFactor as loud, and nothing of it above TUNING.intercomSpeakerMuffledHertz.
// What counts as in between is the station itself: walls, floors, ceilings, doors and what stands about.
// Bodies do not: yours, the others' and the creatures' are not a wall.
// The way round is the voices' own (refreshVoiceWays, 11-voice.js), worked out from where you hear the station.
//
// How you hear one loudspeaker just now: { level, metres, isMuffled }. `level` is 0 to 1, `metres` is how far
// its sound has to come (straight, or the way round), `isMuffled` is whether it comes through the wall.
const intercomSpeakerHearing = { level: 0, metres: 0, isMuffled: false };
function getIntercomSpeakerHearing(speaker, listener, earY) {
  const hearing = intercomSpeakerHearing;
  const offsetX = speaker.x - listener.x, offsetY = speaker.y - earY, offsetZ = speaker.z - listener.z;
  const straight = Math.sqrt(offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ);
  hearing.level = 0; hearing.metres = straight; hearing.isMuffled = false;
  if (straight >= TUNING.intercomSpeakerCarriesMetres) return hearing; // (too far to hear even straight: no need to look)
  if (straight > INTERCOM_IN_THE_WAY_MARGIN) {
    const isSomethingBetween = castRayAgainstWorld(listener.x, earY, listener.z, offsetX / straight, offsetY / straight, offsetZ / straight, straight) &&
      rayHit.distance < straight - INTERCOM_IN_THE_WAY_MARGIN;
    if (isSomethingBetween) {
      const round = getVoiceWayMetres(speaker.x, speaker.z);
      if (round < 0) hearing.isMuffled = true;                // no way round: through the wall
      else hearing.metres = Math.max(straight, round);        // round through what stands open
    }
  }
  hearing.level = getIntercomSpeakerLevelAtMetres(hearing.metres) * (hearing.isMuffled ? TUNING.intercomSpeakerMuffledFactor : 1);
  return hearing;
}

// The loudspeakers you hear: the loudest few, each from where it hangs, as loud, as late and as dull as the way
// its sound comes to you makes it. Looked at every INTERCOM_SLOT_SECONDS while it is on (and at once when
// `shouldChooseNow` says so: it has just come on, or the workshop's sound board plays it).
function updateIntercomSound(dt, shouldChooseNow) {
  const isHeard = intercom.isOn && game.mode !== 'title' && level.intercomSpeakers.length > 0;
  const sound = isHeard || shouldChooseNow ? buildIntercomSound() : intercom.sound;
  if (!sound || !isAudioReady()) return;
  const now = audio.context.currentTime;
  sound.bedGain.gain.setTargetAtTime(isHeard ? SOUND_LEVELS.intercomBed : 0, now, 0.08);
  if (!isHeard && !shouldChooseNow) return; // (off: the slots stay where they were, for the click of it going off)
  intercom.slotTimer -= dt;
  if (intercom.slotTimer > 0 && !shouldChooseNow) return;
  intercom.slotTimer = INTERCOM_SLOT_SECONDS;
  chooseHeardIntercomSpeakers(sound, now);
}

function chooseHeardIntercomSpeakers(sound, now) {
  const listener = getViewer(), earY = listener === player ? getPlayerEyeY() : listener.eyeY;
  refreshVoiceWays(1); // which way a sound can come round to you, through what stands open, as it is now
  // How each loudspeaker within hearing comes to you, loudest first.
  const heard = [];
  for (const speaker of level.intercomSpeakers) {
    const hearing = getIntercomSpeakerHearing(speaker, listener, earY);
    if (hearing.level > 0) heard.push({ speaker: speaker, level: hearing.level, metres: hearing.metres, isMuffled: hearing.isMuffled });
  }
  heard.sort(function (first, second) { return second.level - first.level; });
  const chosen = heard.slice(0, sound.slots.length);
  // Each loudspeaker that is still heard keeps the slot it had, so that a slot is not swung across the station
  // from one loudspeaker to another while it is loud; the others take what slots are left.
  const slotFor = new Map();
  for (const slot of sound.slots) for (const one of chosen) if (one.speaker === slot.speaker && !slotFor.has(one)) slotFor.set(one, slot);
  const takenSlots = new Set(slotFor.values());
  for (const one of chosen) {
    if (slotFor.has(one)) continue;
    const freeSlot = sound.slots.find(function (slot) { return !takenSlots.has(slot); });
    slotFor.set(one, freeSlot); takenSlots.add(freeSlot);
  }
  for (const slot of sound.slots) {
    if (takenSlots.has(slot)) continue;
    slot.speaker = null; slot.level = 0; slot.isMuffled = false;
    slot.gain.gain.setTargetAtTime(0, now, 0.05);
  }
  for (const one of chosen) {
    const slot = slotFor.get(one), speaker = one.speaker;
    slot.speaker = speaker; slot.level = one.level; slot.isMuffled = one.isMuffled; slot.metres = one.metres;
    setPannerPosition(slot.panner, speaker.x, speaker.y, speaker.z);
    slot.delay.delayTime.setTargetAtTime(Math.min(0.45, one.metres / INTERCOM_SOUND_METRES_A_SECOND), now, 0.05);
    slot.muffle.frequency.setTargetAtTime(one.isMuffled ? TUNING.intercomSpeakerMuffledHertz : INTERCOM_CLEAR_HERTZ, now, 0.08);
    slot.gain.gain.setTargetAtTime(one.level, now, 0.08);
  }
}

// It comes on: for a moment the loudspeakers feed the microphone, and the microphone the loudspeakers.
//
// What that sounds like is one note, the one the room and the loudspeakers pass best. It does not slide and
// it does not waver. It comes up out of nothing, every trip round a little louder than the last, so that it
// swells the way a thing does that keeps doubling. Then the amplifier can give no more and cuts the top off
// the wave, and there it screams, with an edge on it. Then the circuit gets hold of it, and it rings away,
// clean again as it goes.
//
// (A real loop was tried: a delay fed back into itself does all of this unasked. But it settles on another
// pitch and swells at another speed at every sample rate, and a browser adds delay of its own inside a loop.
// So this is one note, steered the way the loop's grew when it was measured, into the same overdriven amplifier.)
function playIntercomShriek() {
  const sound = buildIntercomSound();
  if (!sound) return;
  updateIntercomSound(0, true); // (so that it comes from the loudspeakers you hear at once)
  cutIntercomShriek();
  const pitch = 2400;        // TWEAK: Hz. 2000 to 3500 is the squeal of a PA; under 1000 it is a howl
  const pitchCreep = 1.04;   // TWEAK: how far it has crept up by the time it is caught. 1 is dead steady
  const swellSeconds = 0.5;  // TWEAK: from next to nothing to all the amplifier has
  const screamSeconds = 0.45; // TWEAK: how long it stays there
  const ringSeconds = 0.65;  // TWEAK: how long it takes to ring away
  const overdrive = 3.5;     // TWEAK: how hard the amplifier is driven at the top. 1 stays a clean whistle, 6 is nearly a square wave
  const faintest = 0.01;    // where the swell starts, of full: just heard, right behind the click of the switch
  const context = audio.context, now = context.currentTime, caught = now + swellSeconds + screamSeconds, over = caught + ringSeconds;
  const note = context.createOscillator(), swell = context.createGain(), amplifier = context.createWaveShaper(), loudness = context.createGain();
  note.type = 'sine';
  note.frequency.setValueAtTime(pitch, now);
  note.frequency.exponentialRampToValueAtTime(pitch * pitchCreep, caught);
  swell.gain.setValueAtTime(faintest, now);
  swell.gain.exponentialRampToValueAtTime(1, now + swellSeconds);
  swell.gain.setValueAtTime(1, caught);
  swell.gain.exponentialRampToValueAtTime(faintest / 10, over);
  amplifier.curve = createOverdriveCurve(overdrive);
  amplifier.oversample = '4x';
  loudness.gain.value = 0.52 * SOUND_LEVELS.intercomShriek;
  note.connect(swell); swell.connect(amplifier); amplifier.connect(loudness); loudness.connect(sound.bus);
  note.start(now); note.stop(over);
  sound.shriekLevel = loudness;
  note.onended = function () { loudness.disconnect(); if (sound.shriekLevel === loudness) sound.shriekLevel = null; };
  playNoiseBurst({ duration: 0.05, filterType: 'bandpass', frequency: 900, gain: 0.7 * SOUND_LEVELS.intercomShriek, destination: sound.bus }); // the click of the switch, through them all
}

// The amplifier goes off under it (or it comes on anew): what was still shrieking stops there.
function cutIntercomShriek() {
  const sound = intercom.sound;
  if (!sound || !sound.shriekLevel || !isAudioReady()) return;
  sound.shriekLevel.gain.setTargetAtTime(0, audio.context.currentTime, 0.006);
  sound.shriekLevel = null;
}

// It goes off: a click and a thump from every loudspeaker.
function playIntercomClick() {
  const sound = intercom.sound;
  if (!sound || !isAudioReady()) return;
  cutIntercomShriek();
  playNoiseBurst({ duration: 0.04, filterType: 'bandpass', frequency: 1100, gain: 0.65 * SOUND_LEVELS.intercomShriek, destination: sound.bus });
  playTone({ waveform: 'sine', frequency: 140, frequencyEnd: 60, duration: 0.12, gain: 0.3 * SOUND_LEVELS.intercomShriek, destination: sound.bus });
}
