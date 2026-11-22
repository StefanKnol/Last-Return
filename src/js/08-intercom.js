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
const INTERCOM_SLOTS = 3;            // how many loudspeakers you hear at once: the nearest ones
const INTERCOM_SOUND_METRES_A_SECOND = 230; // how fast its sound seems to travel: slower than sound does, so that the echo between two loudspeakers is heard

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
    showMessage('INTERCOM: dead. It runs off the mains.', 4, 'warning');
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
  showMessage(isWorldShared() ? 'Intercom on. Every loudspeaker carries what you say, and everything down here hears them.' : 'Intercom on. Every loudspeaker in the station shrieked, and everything down here heard them.', 6, 'warning');
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
// Everything it says goes into one place (`bus`) and from there to the few loudspeakers nearest to you, each as
// loud as it is near, and each a little late by how far off it is: that lateness is the echo of a hall with
// loudspeakers in it. Into the bus go the hiss and hum of it being on, the shriek of it coming on, and the
// voice of whoever is at the microphone (`voiceIn`: 11-voice.js joins a voice to it), squeezed thin and
// overdriven first.

function buildIntercomSound() {
  if (intercom.sound || !isAudioReady()) return intercom.sound;
  const context = audio.context, sound = { slots: [] };
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
    const slot = { delay: context.createDelay(0.5), gain: context.createGain(), panner: createPannerNode(0, 2.3, 0, 3, 0), speaker: null };
    slot.gain.gain.value = 0;
    sound.bus.connect(slot.delay); slot.delay.connect(slot.gain); slot.gain.connect(slot.panner);
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
}

// How loud a loudspeaker is from where you hear the station, 0 to 1.
function getIntercomSpeakerLevel(speaker, listener, earY) {
  const metres = Math.hypot(speaker.x - listener.x, speaker.y - earY, speaker.z - listener.z);
  const nearness = clampNumber(1 - (metres - TUNING.intercomSpeakerFullWithinMetres) / (TUNING.intercomSpeakerCarriesMetres - TUNING.intercomSpeakerFullWithinMetres), 0, 1);
  return nearness * nearness;
}

// The loudspeakers you hear: the nearest few, each from where it hangs.
function updateIntercomSound(dt) {
  const isHeard = intercom.isOn && game.mode !== 'title' && level.intercomSpeakers.length > 0;
  const sound = isHeard ? buildIntercomSound() : intercom.sound;
  if (!sound || !isAudioReady()) return;
  const now = audio.context.currentTime;
  sound.bedGain.gain.setTargetAtTime(isHeard ? SOUND_LEVELS.intercomBed : 0, now, 0.08);
  intercom.slotTimer -= dt;
  if (intercom.slotTimer > 0) return;
  intercom.slotTimer = 0.2;
  const listener = getViewer(), earY = listener === player ? getPlayerEyeY() : listener.eyeY;
  const nearest = level.intercomSpeakers.slice().sort(function (first, second) {
    return distanceBetweenPoints(first.x, first.z, listener.x, listener.z) - distanceBetweenPoints(second.x, second.z, listener.x, listener.z);
  });
  for (let index = 0; index < sound.slots.length; index++) {
    const slot = sound.slots[index], speaker = nearest[index] || null;
    slot.speaker = speaker;
    if (!speaker) { slot.gain.gain.setTargetAtTime(0, now, 0.05); continue; }
    setPannerPosition(slot.panner, speaker.x, speaker.y, speaker.z);
    const metres = Math.hypot(speaker.x - listener.x, speaker.y - earY, speaker.z - listener.z);
    slot.delay.delayTime.setTargetAtTime(Math.min(0.45, metres / INTERCOM_SOUND_METRES_A_SECOND), now, 0.05);
    slot.gain.gain.setTargetAtTime(getIntercomSpeakerLevel(speaker, listener, earY), now, 0.08);
  }
}

// It comes on: the loudspeakers feed the microphone for a moment. A howl that climbs, wavers and dies.
function playIntercomShriek() {
  const sound = buildIntercomSound();
  if (!sound) return;
  updateIntercomSound(1); // (so that it comes from the loudspeakers near you at once)
  const context = audio.context, now = context.currentTime, level = 0.5 * SOUND_LEVELS.intercomShriek;
  for (const [from, to, share] of [[700, 2850, 1], [1400, 3900, 0.35]]) {
    const howl = context.createOscillator(), gain = context.createGain(), waver = context.createOscillator(), waverDepth = context.createGain();
    howl.type = 'sine';
    howl.frequency.setValueAtTime(from, now);
    howl.frequency.exponentialRampToValueAtTime(to, now + 0.22);
    howl.frequency.setValueAtTime(to, now + 0.75);
    howl.frequency.exponentialRampToValueAtTime(to * 1.12, now + 1.15);
    waver.frequency.value = 9; waverDepth.gain.value = to * 0.012;
    waver.connect(waverDepth); waverDepth.connect(howl.frequency);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(level * share, now + 0.07);
    gain.gain.setValueAtTime(level * share, now + 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
    howl.connect(gain); gain.connect(sound.bus);
    howl.start(now); waver.start(now); howl.stop(now + 1.3); waver.stop(now + 1.3);
  }
  playNoiseBurst({ duration: 0.05, filterType: 'bandpass', frequency: 900, gain: 0.5 * SOUND_LEVELS.intercomShriek, destination: sound.bus }); // the click of the switch, through them all
}

// It goes off: a click and a thump from every loudspeaker.
function playIntercomClick() {
  const sound = intercom.sound;
  if (!sound || !isAudioReady()) return;
  playNoiseBurst({ duration: 0.04, filterType: 'bandpass', frequency: 1100, gain: 0.45 * SOUND_LEVELS.intercomShriek, destination: sound.bus });
  playTone({ waveform: 'sine', frequency: 140, frequencyEnd: 60, duration: 0.12, gain: 0.3 * SOUND_LEVELS.intercomShriek, destination: sound.bus });
}
