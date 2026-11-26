// ---------------------------------------------------------------------------
// Voices: talking to the others out loud, as part of the station.
//
// This is for a lobby (11-together.js), on a server that carries voices (server/server.js, "Voices"). It is not
// a telephone call laid over the game. A voice is a sound in the station like any other:
//
//   - It comes from where the one talking stands, and gets quieter with distance: full within
//     TUNING.voiceFullWithinMetres, gone at TUNING.voiceCarriesMetres.
//   - It comes round through what stands open: a doorway, an open door, a vent. With every way between you
//     shut it comes through the wall, muffled: duller and quieter. Open the door and it is clear.
//   - Crouched, you whisper: it carries a good deal less far, to the others and to the Hollow.
//   - The Hollow hears it. Talking is a noise where you stand, twice a second for as long as you talk: a little
//     quieter than a walking step. (The Surveyor is deaf.)
//   - The dead are heard by the dead, wherever they fell, and not by the living. The dead hear the living from
//     where the one they are watching stands (11-watching.js).
//   - At the title screen, waiting in the lobby, everybody there hears everybody there, plainly.
//
// How it is carried. Your microphone is cut into pieces of VOICE_PIECE_SECONDS; each is packed to a quarter of
// its size (packVoice: four bits a sample, the old telephone trick) and sent to the server, which hands it to
// the others without looking inside. Each of them unpacks it and plays it where you stand. Nothing goes from
// browser to browser, so nobody learns anybody's address, and it works wherever the game does. The price is
// some delay (the pieces queue for a moment before they are played, so that a late one does not leave a hole)
// and a plain, narrow sound: it is a voice in a concrete station, not a studio.
//
// When your microphone is on. Never outside a lobby. In one: "Push to talk" (hold B, or the button) keeps it
// open and sends nothing until you hold the key; "Open microphone" sends whenever it hears something louder
// than TUNING.voiceOpenLevel. "Off" (how it starts) does not ask for the microphone at all. You hear the
// others whatever yours is set to. How loud is yours to say: all of them together, and each of them by a
// slider of their own (getVoiceLevel), which is kept under their name.
//
// A browser only gives a page the microphone when the page came over HTTPS (or from this same machine).
//
// What comes in is somebody else's browser talking: a piece is checked for its length and its kind before
// anything is done with it, and what is unpacked from it is sound and nothing else.
// ---------------------------------------------------------------------------

const VOICE_RATE = 16000;            // samples a second, as sent
const VOICE_PIECE_SAMPLES = 640;     // one piece: a twenty-fifth of a second
const VOICE_PIECE_SECONDS = VOICE_PIECE_SAMPLES / VOICE_RATE;
const VOICE_HEAD_BYTES = 8;          // kind, where and how, number (2), where the packing starts (2), its step, spare
const VOICE_KIND = 1;                // the first byte of a piece: which packing this is
const VOICE_PLACE_LOBBY = 0, VOICE_PLACE_ON_FEET = 1, VOICE_PLACE_DOWN = 2;
const VOICE_WHISPER_BIT = 4;
const VOICE_INTERCOM_BIT = 8;        // said at the intercom's microphone, switched on: it comes out of every loudspeaker too (08-intercom.js)
const VOICE_MODES = ['off', 'push', 'open'];
const VOICE_TALK_KEY = 'KeyB';

const voice = {
  isCarried: false,       // the server of this lobby carries voices (it says so when you join)
  microphone: 'none',     // 'none', 'asking', 'on', 'refused' (you or the browser said no), 'unavailable' (no HTTPS, or a browser without it)
  stream: null, sourceNode: null, captureNode: null,
  hasWorklets: false, isLoadingWorklets: false, waiting: [], silentNode: null,
  outputGain: null,       // everybody's voices, before they join the game's own sound
  isButtonHeld: false,    // the "hold to talk" button on the screen
  openUntil: 0,           // open microphone: it goes on sending until this time (getVoiceClock), so that the end of a word is not cut off
  lastSentAt: -99,        // when you last sent a piece (getVoiceClock): you are talking for a moment after
  sequence: 0,
  noiseTimer: 0,
  level: 0,               // how loud your microphone is just now, 0 to 1 (for the tests and the status line)
  talkers: {},            // by number in the lobby: see getVoiceTalker
  levels: {},             // by number: how loud you have set them in this lobby (getVoiceLevel)
  shownText: '',
  statistics: { sent: 0, heard: 0, refused: 0, bytesSent: 0 } // for the tests
};

// ---- Packing a piece small, and unpacking it ----
//
// IMA ADPCM: each sample is sent as four bits that say how the sound moved since the last one, in steps that
// grow when it moves fast and shrink when it is still. A quarter of the size of the samples themselves.

const VOICE_STEPS = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230,
  253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026,
  4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767];
const VOICE_STEP_MOVES = [-1, -1, -1, -1, 2, 4, 6, 8];
const voicePacking = { value: 0, stepIndex: 0 }; // where your own packing has got to, from one piece to the next

// Packs VOICE_PIECE_SAMPLES samples (-1 to 1) into a piece, with `flags` (where you are, and whether you whisper).
function packVoice(samples, flags, sequence) {
  const piece = new Uint8Array(VOICE_HEAD_BYTES + VOICE_PIECE_SAMPLES / 2);
  let value = voicePacking.value, stepIndex = voicePacking.stepIndex;
  piece[0] = VOICE_KIND; piece[1] = flags; piece[2] = sequence & 255; piece[3] = (sequence >> 8) & 255;
  piece[4] = value & 255; piece[5] = (value >> 8) & 255; piece[6] = stepIndex; piece[7] = 0;
  for (let index = 0; index < VOICE_PIECE_SAMPLES; index++) {
    const sample = Math.max(-32768, Math.min(32767, Math.round(samples[index] * 32767)));
    const step = VOICE_STEPS[stepIndex];
    let difference = sample - value, code = 0;
    if (difference < 0) { code = 8; difference = -difference; }
    let moved = step >> 3;
    if (difference >= step) { code |= 4; difference -= step; moved += step; }
    if (difference >= step >> 1) { code |= 2; difference -= step >> 1; moved += step >> 1; }
    if (difference >= step >> 2) { code |= 1; moved += step >> 2; }
    value = Math.max(-32768, Math.min(32767, code & 8 ? value - moved : value + moved));
    stepIndex = Math.max(0, Math.min(VOICE_STEPS.length - 1, stepIndex + VOICE_STEP_MOVES[code & 7]));
    if (index & 1) piece[VOICE_HEAD_BYTES + (index >> 1)] |= code << 4; else piece[VOICE_HEAD_BYTES + (index >> 1)] = code;
  }
  voicePacking.value = value; voicePacking.stepIndex = stepIndex;
  return piece;
}

// Unpacks a piece into samples (-1 to 1), or returns null if it is not a piece this game knows.
function unpackVoice(piece) {
  if (!piece || piece.length !== VOICE_HEAD_BYTES + VOICE_PIECE_SAMPLES / 2 || piece[0] !== VOICE_KIND) return null;
  const samples = new Float32Array(VOICE_PIECE_SAMPLES);
  let value = piece[4] | (piece[5] << 8);
  if (value > 32767) value -= 65536;
  let stepIndex = Math.min(VOICE_STEPS.length - 1, piece[6]);
  for (let index = 0; index < VOICE_PIECE_SAMPLES; index++) {
    const packed = piece[VOICE_HEAD_BYTES + (index >> 1)], code = index & 1 ? packed >> 4 : packed & 15;
    const step = VOICE_STEPS[stepIndex];
    let moved = step >> 3;
    if (code & 4) moved += step;
    if (code & 2) moved += step >> 1;
    if (code & 1) moved += step >> 2;
    value = Math.max(-32768, Math.min(32767, code & 8 ? value - moved : value + moved));
    stepIndex = Math.max(0, Math.min(VOICE_STEPS.length - 1, stepIndex + VOICE_STEP_MOVES[code & 7]));
    samples[index] = value / 32768;
  }
  return samples;
}

// ---- The two small programs that run beside the sound itself ----
//
// A browser lets a page reach the samples of a sound only from a little program of its own kind (an "audio
// worklet"), which is loaded from a file. The game is one file, so these two are kept here as text and handed
// to the browser as if they were one.
//   the first  takes the microphone, at whatever rate the browser has it, and gives it back at VOICE_RATE in
//              pieces of VOICE_PIECE_SAMPLES
//   the second takes pieces at VOICE_RATE and plays them at the browser's rate, one after the other: it waits
//              until it has a couple before it starts, so that one arriving late does not leave a hole, and
//              when it has fallen far behind it drops the oldest and catches up
const VOICE_WORKLET_SOURCE = [
  'class LastReturnVoiceCapture extends AudioWorkletProcessor {',
  '  constructor() { super(); this.piece = new Float32Array(' + VOICE_PIECE_SAMPLES + '); this.filled = 0; this.position = 0; this.before = 0; this.lowA = 0; this.lowB = 0; }',
  '  process(inputs) {',
  '    const input = inputs[0] && inputs[0][0];',
  '    if (!input) return true;',
  '    const step = ' + VOICE_RATE + ' / sampleRate, keep = Math.exp(-2 * Math.PI * 6500 / sampleRate);',
  '    for (let index = 0; index < input.length; index++) {',
  '      // (What is above half the rate it is sent at is taken out first, twice over, or it would come back as a whistle.)',
  '      this.lowA += (input[index] - this.lowA) * (1 - keep); this.lowB += (this.lowA - this.lowB) * (1 - keep);',
  '      this.position += step;',
  '      if (this.position >= 1) {',
  '        this.position -= 1;',
  '        this.piece[this.filled++] = this.before + (this.lowB - this.before) * (1 - this.position / step);',
  '        if (this.filled === this.piece.length) { this.port.postMessage(this.piece.slice()); this.filled = 0; }',
  '      }',
  '      this.before = this.lowB;',
  '    }',
  '    return true;',
  '  }',
  '}',
  'class LastReturnVoicePlayback extends AudioWorkletProcessor {',
  '  constructor() {',
  '    super(); this.queue = []; this.current = null; this.at = 0; this.isPlaying = false; this.last = 0;',
  '    this.port.onmessage = (event) => {',
  '      this.queue.push(event.data);',
  '      while (this.queue.length > 8) this.queue.shift();',
  '    };',
  '  }',
  '  process(inputs, outputs) {',
  '    const output = outputs[0][0], step = ' + VOICE_RATE + ' / sampleRate;',
  '    for (let index = 0; index < output.length; index++) {',
  '      if (!this.isPlaying && this.queue.length >= 2) this.isPlaying = true;',
  '      if (this.isPlaying && (!this.current || this.at >= this.current.length)) {',
  '        if (this.current) this.at -= this.current.length;',
  '        this.current = this.queue.shift() || null;',
  '        if (!this.current) { this.isPlaying = false; this.at = 0; }',
  '      }',
  '      if (!this.isPlaying || !this.current) { this.last *= 0.98; output[index] = this.last; continue; }',
  '      const whole = Math.floor(this.at), part = this.at - whole;',
  '      const first = this.current[whole], second = whole + 1 < this.current.length ? this.current[whole + 1] : (this.queue.length > 0 ? this.queue[0][0] : first);',
  '      this.last = first + (second - first) * part;',
  '      output[index] = this.last;',
  '      this.at += step;',
  '    }',
  '    return true;',
  '  }',
  '}',
  'registerProcessor("last-return-voice-capture", LastReturnVoiceCapture);',
  'registerProcessor("last-return-voice-playback", LastReturnVoicePlayback);'
].join('\n');

// Has the browser been given the two programs? `whenReady` is called when it has (at once, if it had already).
function loadVoiceWorklets(whenReady) {
  if (voice.hasWorklets) { whenReady(); return; }
  initializeAudioEngine();
  const context = audio.context;
  if (!context || !context.audioWorklet || typeof Blob === 'undefined') return; // a browser without them: no voices here
  if (voice.isLoadingWorklets) { voice.waiting.push(whenReady); return; }
  voice.isLoadingWorklets = true; voice.waiting = [whenReady];
  const address = URL.createObjectURL(new Blob([VOICE_WORKLET_SOURCE], { type: 'text/javascript' }));
  context.audioWorklet.addModule(address).then(function () {
    voice.hasWorklets = true; voice.isLoadingWorklets = false;
    for (const waiting of voice.waiting) waiting();
    voice.waiting = [];
  }, function () { voice.isLoadingWorklets = false; });
}

// Where everybody's voices go: past the game's own volume (voices have a slider of their own), into the same
// limiter as everything else.
function getVoiceOutput() {
  if (!voice.outputGain && audio.context) {
    voice.outputGain = audio.context.createGain();
    voice.outputGain.gain.value = settings.voiceVolume;
    voice.outputGain.connect(audio.compressor || audio.context.destination);
  }
  return voice.outputGain;
}

// ---- Your own microphone ----

// The time voices go by, in seconds: the machine's own clock, and not the game's, which stands still while the
// tab is hidden. (An open microphone that waited for the game's clock to move on would stay open for as long
// as you looked at another tab.)
function getVoiceClock() {
  return performance.now() / 1000;
}

// Where you are, as the others need to know it to decide whether they hear you.
function getOwnVoicePlace() {
  if (!together.isInDescent || game.mode === 'title' || game.mode === 'ending') return VOICE_PLACE_LOBBY;
  return game.mode === 'dead' || game.mode === 'dying' ? VOICE_PLACE_DOWN : VOICE_PLACE_ON_FEET;
}

function isWhispering() {
  return getOwnVoicePlace() === VOICE_PLACE_ON_FEET && player.isCrouching;
}

// May your voice go out at all just now? (In a lobby, on a server that carries it, and not switched off.)
function canSendVoice() {
  return canChat() && voice.isCarried && settings.voiceMode !== 'off';
}

// Are you holding the key or the button to talk?
function isTalkHeld() {
  return voice.isButtonHeld || (input.keysDown.has(VOICE_TALK_KEY) && !chat.isOpen);
}

// Have you just said something? (For the mark on the screen, and for what hears you.)
function isTalkingNow() {
  return getVoiceClock() - voice.lastSentAt < 0.3;
}

// A piece from your microphone (VOICE_PIECE_SAMPLES samples at VOICE_RATE). Sent, if you are talking.
function handleCapturedVoice(samples) {
  let sum = 0;
  for (let index = 0; index < samples.length; index++) sum += samples[index] * samples[index];
  const loudness = Math.sqrt(sum / samples.length);
  voice.level = Math.max(loudness, voice.level * 0.8);
  if (!canSendVoice() || samples.length !== VOICE_PIECE_SAMPLES) return false;
  let isTalking = false;
  if (settings.voiceMode === 'push') isTalking = isTalkHeld();
  else {
    if (loudness >= TUNING.voiceOpenLevel) voice.openUntil = getVoiceClock() + TUNING.voiceOpenHoldSeconds;
    isTalking = getVoiceClock() < voice.openUntil;
  }
  if (!isTalking) return false;
  const piece = packVoice(samples, getOwnVoicePlace() | (isWhispering() ? VOICE_WHISPER_BIT : 0) | (isIntercomYours() ? VOICE_INTERCOM_BIT : 0), voice.sequence);
  voice.sequence = (voice.sequence + 1) & 65535;
  if (!together.socket || together.socket.readyState !== WebSocket.OPEN) return false;
  together.socket.send(piece);
  voice.lastSentAt = getVoiceClock();
  voice.statistics.sent++; voice.statistics.bytesSent += piece.length;
  return true;
}

// The microphone is asked for, and listened to from then on. (Only in a lobby, and only when voice is not off.)
function startMicrophone() {
  if (voice.microphone === 'on' || voice.microphone === 'asking') return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.isSecureContext) { voice.microphone = 'unavailable'; refreshVoiceControls(); return; }
  voice.microphone = 'asking';
  refreshVoiceControls();
  navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false }).then(function (stream) {
    // (Meanwhile you may have left the lobby, or switched it off.)
    if (!canSendVoice()) { for (const track of stream.getTracks()) track.stop(); voice.microphone = 'none'; refreshVoiceControls(); return; }
    voice.stream = stream;
    loadVoiceWorklets(function () {
      if (voice.stream !== stream) return;
      const context = audio.context;
      suspendAudio(false);
      voice.sourceNode = context.createMediaStreamSource(stream);
      voice.captureNode = new AudioWorkletNode(context, 'last-return-voice-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      voice.captureNode.port.onmessage = function (event) { handleCapturedVoice(event.data); };
      voice.sourceNode.connect(voice.captureNode);
      // (Joined to the output through nothing: a program that leads nowhere is not run by every browser.)
      const nowhere = context.createGain();
      nowhere.gain.value = 0;
      voice.captureNode.connect(nowhere); nowhere.connect(context.destination);
      voice.silentNode = nowhere;
      voice.microphone = 'on';
      refreshVoiceControls();
    });
    if (!audio.context || !audio.context.audioWorklet) { stopMicrophone(); voice.microphone = 'unavailable'; refreshVoiceControls(); }
  }, function () { voice.microphone = 'refused'; refreshVoiceControls(); });
}

// The microphone is let go of: the browser's own mark that a page is listening goes out.
function stopMicrophone() {
  if (voice.stream) for (const track of voice.stream.getTracks()) track.stop();
  for (const node of [voice.sourceNode, voice.captureNode, voice.silentNode]) if (node) { try { node.disconnect(); } catch (error) { /* it was not joined to anything */ } }
  voice.stream = null; voice.sourceNode = null; voice.captureNode = null; voice.silentNode = null;
  if (voice.microphone === 'on' || voice.microphone === 'asking') voice.microphone = 'none';
  voice.isButtonHeld = false; voice.openUntil = 0;
}

// The microphone is on exactly when it should be: in a lobby that carries voices, with voice not switched off.
function keepMicrophoneAsItShouldBe() {
  if (canSendVoice()) startMicrophone();
  else { stopMicrophone(); if (voice.microphone !== 'unavailable') voice.microphone = 'none'; }
  refreshVoiceControls();
}

function setVoiceMode(mode) {
  if (VOICE_MODES.indexOf(mode) < 0) return;
  settings.voiceMode = mode;
  saveSettings();
  if (mode !== 'off' && voice.microphone === 'refused') voice.microphone = 'none'; // (asked again: you may have changed your mind in the browser)
  keepMicrophoneAsItShouldBe();
}

function setVoiceVolume(volume) {
  settings.voiceVolume = clampNumber(volume, 0, 1.5);
  if (voice.outputGain) voice.outputGain.gain.setTargetAtTime(settings.voiceVolume, audio.context.currentTime, 0.05);
}

// ---- The others' voices ----

// How loud you have one of the others: 1 as they come, 0 not at all, up to VOICE_LEVEL_MOST. Microphones differ,
// so each of them has a slider. What you set is kept under the name they gave, for the next lobby they are in
// (somebody without a name is "Player 2" to you, and whoever is Player 2 next time is somebody else).
const VOICE_LEVEL_MOST = 2;
const VOICE_LEVELS_KEPT = 40;
function getVoiceLevel(id) {
  if (voice.levels[id] !== undefined) return voice.levels[id];
  const name = chat.names[id];
  if (name && typeof settings.voiceLevels[name] === 'number') return clampNumber(settings.voiceLevels[name], 0, VOICE_LEVEL_MOST);
  return 1;
}

function setVoiceLevel(id, level, shouldKeep) {
  voice.levels[id] = clampNumber(level, 0, VOICE_LEVEL_MOST);
  if (!shouldKeep) return;
  const name = chat.names[id];
  if (!name) return;
  delete settings.voiceLevels[name]; // (set again: it is the newest now, and the last to be forgotten)
  if (voice.levels[id] !== 1) settings.voiceLevels[name] = voice.levels[id];
  const names = Object.keys(settings.voiceLevels);
  for (let index = 0; index < names.length - VOICE_LEVELS_KEPT; index++) delete settings.voiceLevels[names[index]];
  saveSettings();
}

// What is kept about one of the others' voices: the nodes it is played through, and what is known of it.
function getVoiceTalker(id) {
  let talker = voice.talkers[id];
  if (!talker) {
    talker = voice.talkers[id] = { id: id, node: null, muffle: null, placedGain: null, panner: null, plainGain: null, lastHeardAt: -99, place: VOICE_PLACE_LOBBY, isWhispering: false,
      level: 0, placedLevel: 0, plainLevel: 0, isMuffled: false, metres: 0, lookTimer: 0, pending: [], isOnIntercom: false, intercomGain: null, intercomLevel: 0 };
  }
  return talker;
}

// The nodes one voice is played through, made when the first piece of it comes:
//   the pieces -> duller when muffled -> as loud as the distance makes it -> from where they stand -> out
//   the pieces -> as it is (the lobby, the dead among themselves) -------------------------------------> out
function buildVoiceTalkerNodes(talker) {
  const context = audio.context, output = getVoiceOutput();
  talker.node = new AudioWorkletNode(context, 'last-return-voice-playback', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
  talker.muffle = context.createBiquadFilter();
  talker.muffle.type = 'lowpass'; talker.muffle.frequency.value = 8000; talker.muffle.Q.value = 0.5;
  talker.placedGain = context.createGain(); talker.placedGain.gain.value = 0;
  talker.plainGain = context.createGain(); talker.plainGain.gain.value = 0;
  talker.panner = context.createPanner();
  talker.panner.panningModel = 'HRTF'; talker.panner.distanceModel = 'inverse'; talker.panner.rolloffFactor = 0; // (how loud it is by distance is worked out here, not by the browser)
  talker.node.connect(talker.muffle); talker.muffle.connect(talker.placedGain); talker.placedGain.connect(talker.panner); talker.panner.connect(output);
  if (audio.reverbInput) { const send = context.createGain(); send.gain.value = 0.25; talker.panner.connect(send); send.connect(audio.reverbInput); talker.reverbSend = send; }
  talker.node.connect(talker.plainGain); talker.plainGain.connect(output);
  for (const samples of talker.pending) talker.node.port.postMessage(samples);
  talker.pending.length = 0;
}

function forgetVoiceTalker(id) {
  const talker = voice.talkers[id];
  if (!talker) return;
  for (const node of [talker.node, talker.muffle, talker.placedGain, talker.panner, talker.plainGain, talker.reverbSend, talker.intercomGain]) if (node) { try { node.disconnect(); } catch (error) { /* not joined */ } }
  delete voice.talkers[id];
  delete voice.levels[id];
}

function forgetAllVoices() {
  for (const id of Object.keys(voice.talkers)) forgetVoiceTalker(Number(id));
  voice.levels = {};
}

// ---- Which way a voice comes to you ----
//
// A voice does not go through a wall as if it were not there, and it does not stop at one either. So:
//   - with nothing in a straight line between you, it comes straight: as far as you are apart;
//   - otherwise, if there is a way round through what stands open (a doorway, an open door, a vent), it comes
//     that way, clear, and from as far as that way is long;
//   - with no way round near enough (every door between you is shut), it comes through the wall: muffled.
// So a shut door muffles whoever is behind it, and opening it lets their voice through.
//
// The way round is worked out as the Hollow's walking distance is, tile by tile, from where you hear the
// station (voiceWays.steps: 0 for a tile it does not reach, otherwise steps and one). It goes through any tile
// that can be stood in whatever its height, and not through the tile of a door that is not open. It is only
// taken as far as a voice carries at all, or a loudspeaker of the intercom, whichever is further: the intercom
// asks it the same question of each loudspeaker (08-intercom.js, "Through a wall").
const VOICE_METRES_A_STEP = 0.85; // a way round is counted in steps along the grid, which overstate a slanting one
const voiceWays = { steps: new Uint16Array(TILE_COUNT), reached: new Int32Array(8192), reachedCount: 0, fromIndex: -1, timer: 0, doorTiles: [] };

function refreshVoiceWays(dt) {
  const ways = voiceWays, listener = getViewer();
  const fromIndex = isInsideGrid(Math.floor(listener.x), Math.floor(listener.z)) ? tileIndexAt(Math.floor(listener.x), Math.floor(listener.z)) : -1;
  ways.timer -= dt;
  if (fromIndex === ways.fromIndex && ways.timer > 0) return;
  ways.timer = 0.25; ways.fromIndex = fromIndex;
  for (let position = 0; position < ways.reachedCount; position++) ways.steps[ways.reached[position]] = 0;
  ways.reachedCount = 0;
  if (fromIndex < 0) return;
  // The doors that are not open stand in the way. (Marked on the map for the length of this, and taken off again.)
  ways.doorTiles.length = 0;
  for (const door of doors) if (door.openFraction < 0.5) ways.doorTiles.push(tileIndexAt(door.tileX, door.tileZ));
  for (const index of ways.doorTiles) if (index !== fromIndex) ways.steps[index] = 65535;
  const mostSteps = Math.ceil(Math.max(TUNING.voiceCarriesMetres, TUNING.intercomSpeakerCarriesMetres) / VOICE_METRES_A_STEP) + 1;
  let head = 0;
  ways.steps[fromIndex] = 1; ways.reached[ways.reachedCount++] = fromIndex;
  while (head < ways.reachedCount) {
    const index = ways.reached[head++], next = ways.steps[index] + 1;
    if (next > mostSteps + 1) continue;
    const tileX = index % GRID_WIDTH, tileZ = (index - tileX) / GRID_WIDTH;
    for (let direction = 0; direction < 4; direction++) {
      const neighbourX = tileX + (direction === 0 ? 1 : direction === 1 ? -1 : 0), neighbourZ = tileZ + (direction === 2 ? 1 : direction === 3 ? -1 : 0);
      if (!isInsideGrid(neighbourX, neighbourZ)) continue;
      const neighbourIndex = neighbourZ * GRID_WIDTH + neighbourX;
      if (tileIsWalkable[neighbourIndex] === 0 || ways.steps[neighbourIndex] !== 0 || ways.reachedCount >= ways.reached.length) continue;
      ways.steps[neighbourIndex] = next; ways.reached[ways.reachedCount++] = neighbourIndex;
    }
  }
  for (const index of ways.doorTiles) if (ways.steps[index] === 65535) ways.steps[index] = 0;
}

// How long the way round to a place is, in metres, or -1 if there is none near enough.
function getVoiceWayMetres(x, z) {
  if (!isInsideGrid(Math.floor(x), Math.floor(z))) return -1;
  const steps = voiceWays.steps[tileIndexAt(Math.floor(x), Math.floor(z))];
  return steps === 0 || steps === 65535 ? -1 : (steps - 1) * VOICE_METRES_A_STEP;
}

// How you hear one of the others just now: { placed, plain, isMuffled, metres }. `placed` is how loud their
// voice is from where they stand (0 to 1), `plain` how loud it is with no place at all (the lobby, the dead
// among themselves). One of the two is 0, or both. `metres` is how far their voice has to come.
const voiceHearing = { placed: 0, plain: 0, isMuffled: false, metres: 0 };
function getVoiceHearing(talker, shouldLook) {
  const hearing = voiceHearing, own = getOwnVoicePlace();
  hearing.placed = 0; hearing.plain = 0; hearing.isMuffled = talker.isMuffled; hearing.metres = talker.metres;
  const level = getVoiceLevel(talker.id);
  if (level <= 0) return hearing;
  if (talker.place === VOICE_PLACE_LOBBY) { if (own === VOICE_PLACE_LOBBY) hearing.plain = level; return hearing; }
  if (talker.place === VOICE_PLACE_DOWN) { if (own === VOICE_PLACE_DOWN) hearing.plain = level; return hearing; }
  // On their feet: heard from where they stand, by whoever is down there, from where that one hears the station.
  const other = findOtherPlayer(talker.id);
  if (own === VOICE_PLACE_LOBBY || !other || !other.hasBeenHeardFrom) return hearing;
  const listener = getViewer(), earY = listener === player ? getPlayerEyeY() : listener.eyeY;
  const offsetX = other.x - listener.x, offsetY = other.eyeY - earY, offsetZ = other.z - listener.z;
  const straight = Math.sqrt(offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ);
  if (shouldLook) {
    talker.isMuffled = false; talker.metres = straight;
    if (straight > 0.8 && listener !== other) {
      // Is anything in a straight line between you? (The line starts inside the head of whoever is listening:
      // your own body, or that of the one you are watching. Neither is something in between, and nor is the
      // body of the one talking, at the end of it.)
      const inTheWay = [together.ownFigure];
      if (listener !== player && listener.figure) inTheWay.push(listener.figure);
      const wasThere = inTheWay.map(function (figure) { return raycastableFigures.indexOf(figure) >= 0; });
      for (const figure of inTheWay) setFigureRaycastable(figure, false);
      const isSomethingBetween = castScannerRay(listener.x, earY, listener.z, offsetX / straight, offsetY / straight, offsetZ / straight, straight) && rayHit.figure !== other.figure && rayHit.distance < straight - 0.5;
      for (let index = 0; index < inTheWay.length; index++) if (wasThere[index]) setFigureRaycastable(inTheWay[index], true);
      if (isSomethingBetween) {
        const round = getVoiceWayMetres(other.x, other.z);
        if (round < 0) talker.isMuffled = true;                // no way round: through the wall
        else talker.metres = Math.max(straight, round);        // round through what stands open
      }
    }
  }
  const metres = talker.isMuffled ? straight : Math.max(straight, talker.metres);
  const reach = talker.isWhispering ? TUNING.voiceWhisperFactor : 1;
  const full = TUNING.voiceFullWithinMetres * reach, gone = Math.max(full + 0.1, TUNING.voiceCarriesMetres * reach);
  const nearness = clampNumber(1 - (metres - full) / (gone - full), 0, 1);
  hearing.metres = metres; hearing.isMuffled = talker.isMuffled;
  hearing.placed = nearness * nearness * (talker.isMuffled ? TUNING.voiceMuffledFactor : 1) * level;
  return hearing;
}

// A piece of somebody's voice has come from the server: who said it (two bytes), and the piece.
function hearVoicePiece(data) {
  if (!(data instanceof ArrayBuffer) || data.byteLength < 2 + VOICE_HEAD_BYTES) return false;
  const bytes = new Uint8Array(data), id = bytes[0] | (bytes[1] << 8);
  if (id === together.myId || together.memberIds.indexOf(id) < 0) { voice.statistics.refused++; return false; }
  const piece = bytes.subarray(2), samples = unpackVoice(piece);
  const place = piece[1] & 3;
  if (!samples || place > VOICE_PLACE_DOWN) { voice.statistics.refused++; return false; }
  const talker = getVoiceTalker(id);
  talker.place = place;
  talker.isWhispering = (piece[1] & VOICE_WHISPER_BIT) !== 0;
  // Through the intercom: only if your own game has it that they are the one at the microphone.
  talker.isOnIntercom = (piece[1] & VOICE_INTERCOM_BIT) !== 0 && place === VOICE_PLACE_ON_FEET && intercom.isOn && intercom.byId === id;
  talker.lastHeardAt = getVoiceClock();
  let sum = 0;
  for (let index = 0; index < samples.length; index++) sum += samples[index] * samples[index];
  talker.level = Math.sqrt(sum / samples.length);
  voice.statistics.heard++;
  if (settings.voiceVolume <= 0 || getVoiceLevel(id) <= 0) return true; // (heard, and not played)
  if (talker.node) talker.node.port.postMessage(samples);
  else {
    talker.pending.push(samples);
    while (talker.pending.length > 4) talker.pending.shift();
    loadVoiceWorklets(function () { if (voice.talkers[id] === talker && !talker.node) { suspendAudio(false); buildVoiceTalkerNodes(talker); } });
  }
  return true;
}

// Every frame (11-game.js): each voice is as loud, as dull and from where it should be; what hears you hears
// you talk; and the screen says who is talking.
function updateVoice(dt) {
  const now = getVoiceClock();
  let isAnyoneHeardLately = false;
  for (const key of Object.keys(voice.talkers)) if (now - voice.talkers[key].lastHeardAt < 1) isAnyoneHeardLately = true;
  if (isAnyoneHeardLately) refreshVoiceWays(dt); // which way a voice can come round to you, through what stands open
  for (const key of Object.keys(voice.talkers)) {
    const talker = voice.talkers[key];
    if (together.memberIds.indexOf(talker.id) < 0) { forgetVoiceTalker(talker.id); continue; }
    talker.lookTimer -= dt;
    const shouldLook = talker.lookTimer <= 0 && now - talker.lastHeardAt < 1;
    if (shouldLook) talker.lookTimer = 0.2;
    const hearing = getVoiceHearing(talker, shouldLook);
    talker.placedLevel = hearing.placed; talker.plainLevel = hearing.plain;
    if (!talker.node) continue;
    const time = audio.context.currentTime;
    talker.placedGain.gain.setTargetAtTime(hearing.placed, time, 0.06);
    talker.plainGain.gain.setTargetAtTime(hearing.plain, time, 0.06);
    talker.muffle.frequency.setTargetAtTime(hearing.isMuffled ? TUNING.voiceMuffledHertz : 8000, time, 0.08);
    const other = findOtherPlayer(talker.id);
    if (other) setPannerPosition(talker.panner, other.x, other.eyeY, other.z);
    // Said at the intercom's microphone: it also goes to the loudspeakers (08-intercom.js), for whoever is down there.
    talker.intercomLevel = talker.isOnIntercom && intercom.isOn && intercom.byId === talker.id && now - talker.lastHeardAt < 0.5 && getOwnVoicePlace() !== VOICE_PLACE_LOBBY
      ? getVoiceLevel(talker.id) * settings.voiceVolume : 0;
    if (!talker.intercomGain && intercom.sound) {
      talker.intercomGain = audio.context.createGain(); talker.intercomGain.gain.value = 0;
      talker.node.connect(talker.intercomGain); talker.intercomGain.connect(intercom.sound.voiceIn);
    }
    if (talker.intercomGain) talker.intercomGain.gain.setTargetAtTime(talker.intercomLevel, time, 0.04);
  }
  // Talking is a noise where you stand, for as long as you talk (08-creatures.js: what listens hears it).
  if (isTalkingNow() && getOwnVoicePlace() === VOICE_PLACE_ON_FEET && (game.mode === 'playing' || game.mode === 'paused' || game.mode === 'reading')) {
    voice.noiseTimer -= dt;
    if (voice.noiseTimer <= 0) {
      voice.noiseTimer = TUNING.voiceNoiseEverySeconds;
      emitNoise(player.x, player.z, isWhispering() ? TUNING.noiseRadiusVoiceWhisper : TUNING.noiseRadiusVoice, getSpaceOf(player));
    }
  } else voice.noiseTimer = 0;
  refreshVoiceTalkers();
}

// Is somebody's voice going through the intercom just now? (You at the microphone and talking, or the one of
// the others who is, as far as your game has heard.)
function isIntercomCarryingVoice() {
  if (!intercom.isOn) return false;
  if (isIntercomYours()) return isTalkingNow();
  const talker = voice.talkers[intercom.byId];
  return Boolean(talker) && talker.isOnIntercom && getVoiceClock() - talker.lastHeardAt < 0.5;
}

// Is this one of the others talking, and do you hear them?
function isVoiceHeard(talker) {
  return getVoiceClock() - talker.lastHeardAt < 0.4 && (talker.placedLevel > 0.03 || talker.plainLevel > 0);
}

// ---- On the screen ----

// Who is talking, for as long as they are: the ones you hear, and yourself.
function refreshVoiceTalkers() {
  const element = interfaceState.elements['voice-talkers'];
  if (!element) return;
  const names = [];
  if (canChat()) {
    if (isTalkingNow()) names.push('You' + (isIntercomYours() ? ' (intercom)' : (isWhispering() ? ' (whispering)' : '')));
    for (const key of Object.keys(voice.talkers)) {
      const talker = voice.talkers[key];
      if (talker.intercomLevel > 0) names.push(getPlayerName(talker.id) + ' (intercom)');
      else if (isVoiceHeard(talker)) names.push(getPlayerName(talker.id) + (talker.plainLevel === 0 && talker.isMuffled ? ' (muffled)' : ''));
    }
  }
  const text = names.join('|');
  if (text === voice.shownText) return;
  voice.shownText = text;
  element.textContent = '';
  for (const name of names) {
    const line = document.createElement('div');
    line.className = 'voice-talker';
    line.textContent = name;
    element.appendChild(line);
  }
  element.hidden = names.length === 0;
}

const VOICE_MICROPHONE_TEXT = {
  none: '', asking: 'The browser is asking you for the microphone.', on: '',
  refused: 'The browser was not given the microphone. You hear the others all the same.',
  unavailable: 'A browser only gives the microphone to a page that came over HTTPS. You hear the others all the same.'
};

// The lobby's block on the title screen: how voice is set, what state the microphone is in, and who is here
// (each with a box to mute them).
function refreshVoiceControls() {
  const elements = interfaceState.elements;
  if (!elements['together-voice']) return;
  elements['together-voice'].value = settings.voiceMode;
  elements['together-voice-volume'].value = String(settings.voiceVolume);
  let status = '';
  if (!canChat()) status = settings.voiceMode === 'off' ? '' : 'Your microphone is only on while you are in a lobby.';
  else if (!voice.isCarried) status = 'This server does not carry voices.';
  else if (settings.voiceMode === 'off') status = 'Your microphone is off. You hear the others.';
  else if (voice.microphone === 'on') status = settings.voiceMode === 'push' ? 'Hold B to talk, or the button under what has been said.' : 'Your microphone is open: the others hear what it hears.';
  else status = VOICE_MICROPHONE_TEXT[voice.microphone];
  elements['together-voice-status'].textContent = status;
  elements['voice-talk'].hidden = !(canSendVoice() && settings.voiceMode === 'push' && voice.microphone === 'on');
  // Who is here, each of the others with a slider for how loud they are: in the lobby's block, and in the menu
  // (so that it can be set while you are down there).
  elements['pause-voices'].hidden = !canChat();
  elements['pause-voice-volume'].value = String(settings.voiceVolume);
  for (const list of [elements['together-players'], elements['pause-players']]) {
    list.textContent = '';
    list.hidden = !canChat();
    if (!canChat()) continue;
    for (const id of together.memberIds) {
      const row = document.createElement('label');
      row.className = 'together-player';
      const name = document.createElement('span');
      name.textContent = getPlayerName(id) + (id === together.hostId ? ' (host)' : '') + (id === together.myId ? ' (you)' : '');
      row.appendChild(name);
      if (id !== together.myId) {
        const slider = document.createElement('input'), said = document.createElement('i');
        slider.type = 'range'; slider.min = '0'; slider.max = String(VOICE_LEVEL_MOST); slider.step = '0.05'; slider.value = String(getVoiceLevel(id));
        slider.setAttribute('aria-label', 'How loud ' + getPlayerName(id) + ' is');
        const say = function () { const level = Number(slider.value); said.textContent = level <= 0 ? 'muted' : Math.round(level * 100) + '%'; };
        slider.addEventListener('input', function () { setVoiceLevel(id, Number(slider.value), false); say(); });
        slider.addEventListener('change', function () { setVoiceLevel(id, Number(slider.value), true); refreshVoiceControls(); });
        say();
        row.appendChild(slider); row.appendChild(said);
      }
      list.appendChild(row);
    }
  }
}

// You have joined a lobby, or left one (11-together.js).
function noteLobbyForVoice(isCarried) {
  voice.isCarried = isCarried === true;
  if (!canChat()) forgetAllVoices();
  keepMicrophoneAsItShouldBe();
}

function initializeVoice() {
  const elements = interfaceState.elements;
  for (const elementId of ['together-voice', 'together-voice-volume', 'together-voice-status', 'together-players', 'voice-talkers', 'voice-talk', 'pause-voices', 'pause-voice-volume', 'pause-players']) elements[elementId] = getElement(elementId);
  elements['pause-voice-volume'].addEventListener('input', function () { setVoiceVolume(Number(elements['pause-voice-volume'].value)); elements['together-voice-volume'].value = elements['pause-voice-volume'].value; });
  elements['pause-voice-volume'].addEventListener('change', function () { saveSettings(); });
  elements['together-voice'].addEventListener('change', function () { setVoiceMode(elements['together-voice'].value); });
  elements['together-voice-volume'].addEventListener('input', function () { setVoiceVolume(Number(elements['together-voice-volume'].value)); });
  elements['together-voice-volume'].addEventListener('change', function () { saveSettings(); });
  const talk = elements['voice-talk'];
  const hold = function (event) { event.preventDefault(); voice.isButtonHeld = true; talk.classList.add('is-held'); };
  const release = function () { voice.isButtonHeld = false; talk.classList.remove('is-held'); };
  talk.addEventListener('pointerdown', hold);
  for (const eventName of ['pointerup', 'pointercancel', 'pointerleave']) talk.addEventListener(eventName, release);
  refreshVoiceControls();
}
