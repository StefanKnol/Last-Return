// ---------------------------------------------------------------------------
// Descending together: the lobby on the title screen, and the others who are in the station with you.
//
// This only exists on a page that was served by server/server.js, which keeps the lobbies and hands on what
// one browser says to the others (the page's `last-return-relay` line says where). Opened from a file, or
// served by anything else, the game is played alone and none of this is shown.
//
// How one station is everybody's:
//   - Everyone goes down into the same station, at the same threat level: the host's, as chosen on the host's
//     title screen when the host begins.
//   - Everyone says where they are and where their scanner points, TOGETHER_SENDS_PER_SECOND times a second.
//     The others are bodies that only show where a beam lands, like everything else down there, and what
//     their scanners light up is lit for you too.
//   - What walks down there, and the doors, are the host's. In the host's game the others are in `players`, so
//     its Hollow hears them, its Stills walk at them and its doors open for them. Every other browser decides
//     none of that: it is told how the creatures stand and which doors are open (the 'world' message,
//     WORLD_SENDS_PER_SECOND times a second) and shows it, and it hears the sounds the host's creatures make
//     ('sound'). Noise made in another browser is passed to the host for its Hollow to hear ('noise').
//   - What is done to the station (a thing used or taken, a room entered for the first time, the lift left,
//     the car going up) is done in every browser, in one order: the host's. A browser asks ('ask'), the host
//     says what was done and by whom ('did'), and each carries it out when it hears that, the one who asked
//     included. So the work order, the mains, the keycards and the lift are everybody's.
//   - Being caught is the host's to say ('caught'), and your own game's to carry out.
//   - Still each browser's own: the apparitions (on purpose), what you carry, and everything that lies loose.
// ---------------------------------------------------------------------------

const TOGETHER_SENDS_PER_SECOND = 15;    // how often you say where you are
const TOGETHER_ECHO_RAY_SHARE = 0.8;     // TWEAK: how much of another scanner's light is drawn here, as a share of your own scanner's pulses
                                         // (The host draws all of it: its Hollow and its Stills have to feel that light as they feel the host's.)
const WORLD_SENDS_PER_SECOND = 10;       // how often the host says how the creatures stand and which doors are open

const together = {
  relayAddress: '',      // where the lobbies are, or '' on a page that has none
  socket: null,
  code: '',              // the lobby you are in, or ''
  myId: 0, hostId: 0,
  memberIds: [],         // everyone in the lobby, you included
  hostMap: null,         // the number the host's station came to when it was built (level.mapFingerprint), once the host has said
  isInDescent: false,
  others: [],            // the others, while you are down there together
  statusText: '',
  sendTimer: 0,
  worldSendTimer: 0,
  world: null,           // not the host: how the host last said its station stands (see describeWorld), once it has said
  worldBlend: 1,         // and how far the creatures shown here have come towards that: 0 to 1
  hollowFrom: [],        // where and how the Hollow was shown when the host last said (describeFigure)
  isCarryingOut: false,  // while something done to the station is being carried out here (performActionFor)
  soundMode: '',         // 'share' while the host's creatures are being run, 'mute' while something is done here without a sound of its own
  asked: {}              // what you have asked the host to do and not yet seen done, so that it is asked once
};

// Are you down there with others at all, and whose station is it?
function isWorldShared() { return together.isInDescent; }
function isWorldTheHosts() { return together.isInDescent && !isLobbyHost(); }
function isWorldYoursToShare() { return together.isInDescent && isLobbyHost(); }

// Which build this is, as one text: a lobby only holds browsers that say the same.
function describeBuildForLobby() {
  return [BUILD_STAMP.version, BUILD_STAMP.number, BUILD_STAMP.commit, BUILD_STAMP.isDevBuild ? 'dev' : ''].join('/');
}

function initializeTogether() {
  wrapForTogether();
  const tag = document.querySelector('meta[name="last-return-relay"]');
  const place = tag ? tag.content.trim() : '';
  if (place === '' || typeof WebSocket === 'undefined') return;
  try {
    const address = new URL(place, window.location.href);
    if (address.protocol === 'http:') address.protocol = 'ws:';
    if (address.protocol === 'https:') address.protocol = 'wss:';
    if (address.protocol !== 'ws:' && address.protocol !== 'wss:') return;
    together.relayAddress = address.href;
  } catch (error) {
    return; // not an address: no lobbies
  }
  const elements = interfaceState.elements;
  elements['together-options'].hidden = false;
  elements['button-host-lobby'].addEventListener('click', function () { openLobbySocket({ t: 'host', build: describeBuildForLobby() }); });
  const join = function () {
    const code = elements['together-code'].value.trim().toUpperCase();
    if (code.length !== 4) { together.statusText = 'A lobby code is four letters.'; refreshTogetherControls(); return; }
    openLobbySocket({ t: 'join', code: code, build: describeBuildForLobby() });
  };
  elements['button-join-lobby'].addEventListener('click', join);
  elements['together-code'].addEventListener('keydown', function (event) { if (event.key === 'Enter') join(); });
  elements['button-leave-lobby'].addEventListener('click', function () { leaveLobby(''); });
  refreshTogetherControls();
}

function isLobbyHost() {
  return together.code !== '' && together.myId === together.hostId;
}

// The title screen as the lobby has it: the code, who is in it, and what "Begin descent" means now.
function refreshTogetherControls() {
  if (together.relayAddress === '') return;
  const elements = interfaceState.elements, begin = elements['button-begin'];
  const isInLobby = together.code !== '';
  elements['together-apart'].hidden = isInLobby;
  elements['together-lobby'].hidden = !isInLobby;
  elements['together-lobby-code'].textContent = together.code;
  let status = together.statusText;
  begin.disabled = false;
  begin.textContent = 'Begin descent';
  if (isInLobby) {
    const count = together.memberIds.length + ' of 4 in the lobby. ';
    if (isLobbyHost()) {
      begin.textContent = 'Begin descent together';
      status = count + 'Give the others the code. When you begin, everyone goes down with you: into the station and the threat level chosen here, ' +
        'with one Hollow and one work order between you.';
    } else {
      begin.disabled = true;
      begin.textContent = 'Waiting for the host';
      status = count + 'The host chooses the station and the threat level. When the host begins, you go down too.';
    }
  }
  elements['together-status'].textContent = status;
}

// ---- Talking to the server ----

function sendToRelay(message) {
  if (together.socket && together.socket.readyState === WebSocket.OPEN) together.socket.send(JSON.stringify(message));
}

// Says something to everyone else in the lobby. `data` is the game's own: { k: what it is, ... }.
function sayToOthers(data) {
  sendToRelay({ t: 'say', d: data });
}

function openLobbySocket(firstMessage) {
  if (together.socket) return;
  together.statusText = 'Reaching the server...';
  refreshTogetherControls();
  const socket = new WebSocket(together.relayAddress);
  together.socket = socket;
  socket.addEventListener('open', function () { socket.send(JSON.stringify(firstMessage)); });
  socket.addEventListener('message', function (event) {
    let message = null;
    try { message = JSON.parse(event.data); } catch (error) { return; }
    if (message && typeof message === 'object' && together.socket === socket) hearRelay(message);
  });
  socket.addEventListener('close', function () {
    if (together.socket !== socket) return; // one you left yourself
    together.socket = null;
    endLobby(together.code === '' ? 'The server could not be reached.' : 'The connection to the lobby was lost.');
  });
}

// You leave: the lobby if you are in one, and the others if you are down there with them.
function leaveLobby(statusText) {
  const socket = together.socket;
  together.socket = null;
  if (socket) socket.close();
  endLobby(statusText);
}

// The lobby is over for you, whoever ended it. If you are down in the station you stay there, alone.
function endLobby(statusText) {
  const wasInDescent = together.isInDescent;
  together.code = ''; together.myId = 0; together.hostId = 0; together.memberIds = [];
  together.hostMap = null;
  const wasTheHosts = isWorldTheHosts();
  together.isInDescent = false;
  for (const other of together.others) setFigureRaycastable(other.figure, false);
  together.others.length = 0;
  players.length = 0; players.push(player);
  together.world = null;
  if (wasTheHosts) {
    // The station is yours from here: what walks in it takes up thinking where the host's left off.
    cancelHollowCrawl(); hollow.doorBang = null; hollow.fieldTargetIndex = -1;
    setFigureRaycastable(hollow.figure, hollow.isActive);
  }
  together.statusText = statusText;
  refreshTogetherControls();
  if (wasInDescent && statusText !== '' && game.mode !== 'title') showMessage(statusText + ' You are on your own now.', 7, 'warning');
}

// Going back up to the title screen ends it too (11-game.js calls this).
function leaveDescentTogether() {
  if (together.isInDescent) leaveLobby('');
}

const LOBBY_REFUSALS = {
  unknown: 'There is no lobby with that code.',
  full: 'That lobby is full.',
  started: 'That lobby has already gone down.',
  build: 'That lobby is on another version of the game. Reload the page, and ask the host to do the same.',
  busy: 'The server has no room for another lobby just now.'
};

function hearRelay(message) {
  if (message.t === 'lobby' && Array.isArray(message.players)) {
    together.code = String(message.code); together.myId = message.you; together.hostId = message.host;
    together.memberIds = message.players.slice();
    together.statusText = '';
  } else if (message.t === 'refused') {
    leaveLobby(LOBBY_REFUSALS[message.why] || 'The lobby could not be joined.');
    return;
  } else if (message.t === 'joined') {
    if (together.memberIds.indexOf(message.id) < 0) together.memberIds.push(message.id);
  } else if (message.t === 'left') {
    together.memberIds = together.memberIds.filter(function (id) { return id !== message.id; });
    const other = findOtherPlayer(message.id);
    if (other) {
      setFigureRaycastable(other.figure, false);
      together.others.splice(together.others.indexOf(other), 1);
      if (game.mode !== 'title') showMessage('One of the others has gone back up.', 5, 'info');
    }
  } else if (message.t === 'closed') {
    leaveLobby('The host has left.');
    return;
  } else if (message.t === 'start' && !isLobbyHost() && !together.isInDescent) {
    // The host has begun, and takes everyone along.
    const descent = readSharedDescent(message.d);
    if (!descent) { leaveLobby('The host began a descent this game does not understand.'); return; }
    if (game.mode !== 'title') { leaveLobby('The host began while you were not at the title screen.'); return; }
    beginDescentTogether(descent);
    // You did not click for this, so the browser may be holding the sound back until you do something.
    for (const eventName of ['pointerdown', 'keydown']) window.addEventListener(eventName, function () { suspendAudio(false); }, { once: true });
  } else if (message.t === 'said' && message.d && typeof message.d === 'object') {
    hearOtherPlayer(message.from, message.d);
    return;
  }
  refreshTogetherControls();
}

// ---- Going down ----

// What the host says the descent is (describeChosenDescent, 11-game.js), checked: it comes from somebody
// else's browser. Returns a descent this game can load, or null.
function readSharedDescent(data) {
  if (!data || typeof data !== 'object') return null;
  const has = function (table, key) { return typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key); };
  const descent = { kind: data.kind === 'generated' ? 'generated' : 'classic', seed: 0, sizeKey: '', layoutKey: '', levelsKey: '', workOrders: [],
    difficultyKey: 'standard', customDifficulty: sanitizeCustomDifficultyValues(data.customDifficulty) };
  if (data.difficultyKey === 'custom' || has(DIFFICULTY_PRESETS, data.difficultyKey)) descent.difficultyKey = data.difficultyKey;
  else return null;
  if (descent.kind === 'generated') {
    if (!Number.isInteger(data.seed) || data.seed < 1 || data.seed > 999999999) return null;
    if (!has(GENERATED_SIZE_PRESETS, data.sizeKey) || !has(GENERATED_LAYOUT_PRESETS, data.layoutKey) || !has(GENERATED_LEVEL_PRESETS, data.levelsKey)) return null;
    if (!Array.isArray(data.workOrders)) return null;
    descent.seed = data.seed; descent.sizeKey = data.sizeKey; descent.layoutKey = data.layoutKey; descent.levelsKey = data.levelsKey;
    descent.workOrders = data.workOrders.filter(function (key) { return findWorkOrder(key) !== null; });
    if (descent.workOrders.length === 0) return null;
  }
  return descent;
}

// "Begin descent" on the title screen. Alone, that is a new game. In a lobby it is the host's to press, and it
// takes everyone down at once (the others hear of it in hearRelay).
function beginFromTitle() {
  if (together.code === '') { beginNewGame(); return; }
  if (isLobbyHost()) {
    const descent = describeChosenDescent();
    // Salvage is a work order about things that lie loose, and those are still each browser's own.
    const orders = descent.workOrders.filter(function (key) { return key !== 'salvage'; });
    descent.workOrders = orders.length > 0 ? orders : WORK_ORDERS.map(function (order) { return order.key; }).filter(function (key) { return key !== 'salvage'; });
    sendToRelay({ t: 'start', d: descent });
    beginDescentTogether(descent);
  }
}

function beginDescentTogether(descent) {
  together.isInDescent = true;
  together.sendTimer = 0; together.worldSendTimer = 0;
  together.world = null; together.worldBlend = 1;
  together.asked = {};
  together.others.length = 0;
  for (const id of together.memberIds) if (id !== together.myId) together.others.push(createOtherPlayer(id));
  beginNewGame(descent);
  // The host says what its station came to. Yours should be the same to the tile: if it is not, better to know.
  if (isLobbyHost()) sayToOthers({ k: 'built', map: getBuiltMapNumber() });
  else compareStationWithHost();
}

// One number from everything that is the map's (03-levelgen.js). Kessel-9 is the same for everybody.
function getBuiltMapNumber() {
  return level.kind === 'generated' ? level.mapFingerprint : 0;
}

// Once you are down there and the host has said what its station came to, whichever comes last.
function compareStationWithHost() {
  if (!together.isInDescent || together.hostMap === null || together.hostMap === getBuiltMapNumber()) return;
  together.hostMap = null; // said once
  showMessage('This station was not built the same as the host\'s. What you see of each other will not fit.', 12, 'warning');
}

// ---- The others ----

function createOtherPlayer(id) {
  return {
    id: id,
    figure: createFigure(FIGURE_PROPORTIONS_PLAYER, SURFACE_PLAYER, 'playerImprintSeconds'),
    hasBeenHeardFrom: false,
    x: 0, z: 0, eyeY: 0, yaw: 0, pitch: 0,                    // where they are now, as shown here
    fromX: 0, fromZ: 0, fromEyeY: 0, fromYaw: 0, fromPitch: 0, // where they were shown when they last said where they are
    toX: 0, toZ: 0, toEyeY: 0, toYaw: 0, toPitch: 0,           // and where they said they were
    blend: 1,                                                  // how far from the one to the other: 0 to 1
    isCrouching: false,
    velocityX: 0, velocityZ: 0, audibleRadius: 0, // what the host's Hollow goes by, as they say it
    isDown: false,      // caught, and not back on their feet: nothing hunts them
    carried: {},        // what they carry for the quests (game.carried is yours)
    spreadDegrees: 0,   // how wide their scanner is firing, or 0 when it is not
    walkPhase: 0, stride: 0, armRaise: 0.1,
    rayBudget: 0
  };
}

function findOtherPlayer(id) {
  for (const other of together.others) if (other.id === id) return other;
  return null;
}

// Something one of the others said. It comes from somebody else's browser: every number is checked.
function hearOtherPlayer(id, data) {
  if (data.k === 'built') {
    // The host says this once it has built its own.
    if (id === together.hostId && Number.isFinite(data.map)) { together.hostMap = data.map; compareStationWithHost(); }
    return;
  }
  if (!together.isInDescent) return;
  if (data.k !== 'at') { hearOfTheStation(id, data); return; }
  const other = findOtherPlayer(id);
  if (!other) return;
  for (const key of ['x', 'z', 'e', 'w', 'p', 's', 'vx', 'vz', 'r']) if (!Number.isFinite(data[key])) return;
  other.velocityX = clampNumber(data.vx, -12, 12); other.velocityZ = clampNumber(data.vz, -12, 12);
  other.audibleRadius = clampNumber(data.r, 0, 40);
  other.fromX = other.x; other.fromZ = other.z; other.fromEyeY = other.eyeY; other.fromYaw = other.yaw; other.fromPitch = other.pitch;
  other.toX = clampNumber(data.x, 0, GRID_WIDTH); other.toZ = clampNumber(data.z, 0, GRID_DEPTH); other.toEyeY = clampNumber(data.e, -100, 100);
  other.toYaw = Math.atan2(Math.sin(data.w), Math.cos(data.w)); // between -pi and pi, whatever was sent
  other.toPitch = clampNumber(data.p, -1.6, 1.6);
  other.blend = 0;
  other.isCrouching = data.c === 1;
  other.spreadDegrees = clampNumber(data.s, 0, 60);
  if (!other.hasBeenHeardFrom) {
    // The first word from them: they are simply there, not on their way from nowhere.
    other.hasBeenHeardFrom = true;
    other.blend = 1;
    other.x = other.toX; other.z = other.toZ; other.eyeY = other.toEyeY; other.yaw = other.toYaw; other.pitch = other.toPitch;
    placeOtherPlayerFigure(other, 0);
    setFigureRaycastable(other.figure, true);
  }
}

// Where you are and where your scanner points, for the others.
function sayWhereYouAre() {
  const round = function (value) { return Math.round(value * 1000) / 1000; };
  let spreadDegrees = 0;
  if (game.mode === 'playing' && player.isPainting) spreadDegrees = player.spreadDegrees;
  else if (game.mode === 'playing' && player.sweepTimeRemaining > 0) spreadDegrees = TUNING.sweepHalfWidthDegrees;
  sayToOthers({ k: 'at', x: round(player.x), z: round(player.z), e: round(getPlayerEyeY()), w: round(player.yaw), p: round(player.pitch),
    c: player.isCrouching ? 1 : 0, s: round(spreadDegrees),
    vx: round(player.velocityX), vz: round(player.velocityZ), r: round(game.mode === 'playing' ? player.audibleRadius : 0) });
}

// Stands their body where they are shown, in the pose of what they are doing. `movedDistance` is how far they
// came since the last frame: their legs go with it.
function placeOtherPlayerFigure(other, movedDistance) {
  const figure = other.figure, pose = figure.pose;
  figure.x = other.x; figure.z = other.z; figure.yaw = other.yaw;
  other.walkPhase += movedDistance * 6;
  pose.legSwing = Math.sin(other.walkPhase) * 0.5 * other.stride;
  pose.armSwing = Math.sin(other.walkPhase) * 0.2 * other.stride * (1 - Math.min(1, other.armRaise));
  pose.kneeBend = other.isCrouching ? 1.2 : 0.05;
  pose.lean = other.isCrouching ? 0.5 : 0.04;
  pose.armRaise = other.armRaise; // the scanner arm comes up while they scan (a dummy has no way to raise only one)
  updateFigureCapsules(figure);
}

function advanceOtherPlayer(other, dt) {
  if (!other.hasBeenHeardFrom) return;
  const previousX = other.x, previousZ = other.z;
  other.blend = Math.min(1, other.blend + dt * TOGETHER_SENDS_PER_SECOND);
  other.x = interpolateLinear(other.fromX, other.toX, other.blend);
  other.z = interpolateLinear(other.fromZ, other.toZ, other.blend);
  other.eyeY = interpolateLinear(other.fromEyeY, other.toEyeY, other.blend);
  other.yaw = other.fromYaw + wrapAngleToPi(other.toYaw - other.fromYaw) * other.blend;
  other.pitch = interpolateLinear(other.fromPitch, other.toPitch, other.blend);
  const movedDistance = distanceBetweenPoints(previousX, previousZ, other.x, other.z);
  other.stride = approachValue(other.stride, movedDistance > dt * 0.3 ? 1 : 0, dt * 6);
  other.armRaise = approachValue(other.armRaise, other.spreadDegrees > 0 ? 1.2 : 0.1, dt * 5);
  placeOtherPlayerFigure(other, movedDistance);
}

// What another scanner lights up is lit here too. Nothing is sent for it: this browser fires pulses of its
// own from where their scanner is, the way it points, and fewer of them than they fire themselves.
function echoOtherScanner(other, dt) {
  if (!other.hasBeenHeardFrom || other.spreadDegrees <= 0) { other.rayBudget = 0; return; }
  other.rayBudget += QUALITY_PRESETS[settings.quality].raysPerSecond * (isLobbyHost() ? 1 : TOGETHER_ECHO_RAY_SHARE) * dt;
  const rayCount = Math.min(700, Math.floor(other.rayBudget));
  other.rayBudget -= rayCount;
  const cosinePitch = Math.cos(other.pitch), sinePitch = Math.sin(other.pitch), cosineYaw = Math.cos(other.yaw), sineYaw = Math.sin(other.yaw);
  const forwardX = sineYaw * cosinePitch, forwardY = sinePitch, forwardZ = -cosineYaw * cosinePitch;
  const rightX = cosineYaw, rightZ = sineYaw;
  const upX = -sineYaw * sinePitch, upY = cosinePitch, upZ = cosineYaw * sinePitch;
  const spreadTangent = Math.tan(other.spreadDegrees * DEGREES_TO_RADIANS);
  setFigureRaycastable(other.figure, false); // their light starts inside their own head: it is not in its own way
  for (let rayIndex = 0; rayIndex < rayCount; rayIndex++) {
    const radius = Math.pow(Math.random(), 0.62) * spreadTangent, angle = Math.random() * TWO_PI;
    const horizontal = Math.cos(angle) * radius, vertical = Math.sin(angle) * radius;
    const directionX = forwardX + rightX * horizontal + upX * vertical;
    const directionY = forwardY + upY * vertical;
    const directionZ = forwardZ + rightZ * horizontal + upZ * vertical;
    const length = Math.sqrt(directionX * directionX + directionY * directionY + directionZ * directionZ);
    fireScanPulse(other.x, other.eyeY, other.z, directionX / length, directionY / length, directionZ / length, false);
  }
  setFigureRaycastable(other.figure, true);
}

// Every frame, whatever the game is doing (11-game.js calls this).
function updateTogether(dt) {
  if (!together.isInDescent) return;
  together.sendTimer -= dt;
  if (together.sendTimer <= 0) {
    together.sendTimer = Math.max(together.sendTimer + 1 / TOGETHER_SENDS_PER_SECOND, 0);
    sayWhereYouAre();
  }
  for (const other of together.others) {
    advanceOtherPlayer(other, dt);
    if (game.mode === 'playing' || (isLobbyHost() && game.mode !== 'intro')) echoOtherScanner(other, dt); // the host's creatures feel it whatever the host is doing
  }
  if (isLobbyHost()) {
    // Who is on their feet down here, for what hunts and what opens. (Never nobody: with everyone down it is you.)
    players.length = 0;
    if (game.mode !== 'dying' && game.mode !== 'dead') players.push(player);
    for (const other of together.others) if (other.hasBeenHeardFrom && !other.isDown) players.push(other);
    if (players.length === 0) players.push(player);
    together.worldSendTimer -= dt;
    if (together.worldSendTimer <= 0 && game.mode !== 'intro') {
      together.worldSendTimer = Math.max(together.worldSendTimer + 1 / WORLD_SENDS_PER_SECOND, 0);
      sayToOthers(describeWorld());
    }
  }
}

// ---------------------------------------------------------------------------
// One station for everybody (see the top of this file for how the parts fit)
// ---------------------------------------------------------------------------

// ---- The sounds of what walks down there ----
//
// The host's game runs the creatures, so it is the host's game that makes their sounds: a roar, a footstep, a
// blow on a door, the caption that goes with each. Everyone else has to hear them too. So each of those
// functions is wrapped once, here: called while the host's creatures are being run (shareWorldSoundsDuring),
// it also tells the others, who call the same function with the same arguments.

const worldSounds = {}; // by name: the function as it was before it was wrapped

function shareWorldSound(name, original) {
  worldSounds[name] = original;
  return function () {
    if (together.soundMode === 'mute') return false;
    if (together.soundMode === 'share') {
      // A place (a figure, a door) is sent as its x and z; everything else as it is.
      const sent = Array.prototype.map.call(arguments, function (value) {
        return value && typeof value === 'object' ? [Math.round(value.x * 100) / 100, Math.round(value.z * 100) / 100] : value;
      });
      sayToOthers({ k: 'sound', f: name, a: sent });
    }
    return original.apply(null, arguments);
  };
}

// What is only for the one who did a thing: the line that says so, the click of taking it, the page that opens.
function onlyForWhoeverActs(original) {
  return function () { return game.actor ? undefined : original.apply(null, arguments); };
}

function wrapForTogether() {
  playHollowRoar = shareWorldSound('playHollowRoar', playHollowRoar);
  playHollowSnarl = shareWorldSound('playHollowSnarl', playHollowSnarl);
  playHollowSniff = shareWorldSound('playHollowSniff', playHollowSniff);
  playHollowCuriousTrill = shareWorldSound('playHollowCuriousTrill', playHollowCuriousTrill);
  playHollowLostHiss = shareWorldSound('playHollowLostHiss', playHollowLostHiss);
  playHollowFootstep = shareWorldSound('playHollowFootstep', playHollowFootstep);
  playHollowVentStep = shareWorldSound('playHollowVentStep', playHollowVentStep);
  playHollowCeilingStep = shareWorldSound('playHollowCeilingStep', playHollowCeilingStep);
  playStillShuffleSound = shareWorldSound('playStillShuffleSound', playStillShuffleSound);
  playHatchRattle = shareWorldSound('playHatchRattle', playHatchRattle);
  playHatchBurst = shareWorldSound('playHatchBurst', playHatchBurst);
  playDoorBang = shareWorldSound('playDoorBang', playDoorBang);
  playDoorBreak = shareWorldSound('playDoorBreak', playDoorBreak);
  playStinger = shareWorldSound('playStinger', playStinger);
  showCaption = shareWorldSound('showCaption', showCaption);
  showMessage = onlyForWhoeverActs(showMessage);
  playPickupSound = onlyForWhoeverActs(playPickupSound);
  playDeniedSound = onlyForWhoeverActs(playDeniedSound);
  playInterfaceBlip = onlyForWhoeverActs(playInterfaceBlip);
  openReader = onlyForWhoeverActs(openReader);
}

// Runs the host's creatures (11-game.js): what they sound like in there is everybody's.
function shareWorldSoundsDuring(run) {
  const before = together.soundMode;
  if (isWorldYoursToShare()) together.soundMode = 'share';
  try { run(); } finally { together.soundMode = before; }
}

// Does something to the station that would make a sound, without the sound.
function withoutWorldSounds(run) {
  const before = together.soundMode;
  together.soundMode = 'mute';
  try { run(); } finally { together.soundMode = before; }
}

// A sound that is yours alone though it is made while the creatures are being run (the sting of your own death).
function asYoursAlone(run) {
  const before = together.soundMode;
  together.soundMode = '';
  try { run(); } finally { together.soundMode = before; }
}

function hearWorldSound(data) {
  if (typeof data.f !== 'string' || !Object.prototype.hasOwnProperty.call(worldSounds, data.f) || !Array.isArray(data.a) || data.a.length > 6) return;
  const given = [];
  for (const value of data.a) {
    if (Array.isArray(value) && value.length === 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) given.push({ x: value[0], z: value[1] });
    else if (Number.isFinite(value) || typeof value === 'boolean' || (typeof value === 'string' && value.length <= 40)) given.push(value);
    else return;
  }
  worldSounds[data.f].apply(null, given);
}

// ---- Noise, for the host's Hollow ----

function tellHostOfNoise(x, z, radius) {
  if (together.isCarryingOut) return; // something done in every browser: the host's own carrying out makes the noise
  sayToOthers({ k: 'noise', x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, r: radius });
}

// ---- How the host's station stands ----

const WORLD_POSE_KEYS = ['legSwing', 'kneeBend', 'armSwing', 'armRaise', 'elbowBend', 'lean', 'headTilt', 'stretch', 'fingerSplay', 'stoop', 'crawl'];
const WORLD_HOLLOW_NUMBERS = 6 + 3 + WORLD_POSE_KEYS.length; // what `h` holds, below
const WORLD_STILL_NUMBERS = 6;                               // and what `s` holds for each Still

// A figure as numbers: where it stands, which way it faces, and its pose.
function describeFigure(figure, into) {
  const round = function (value) { return Math.round(value * 1000) / 1000; };
  into.push(round(figure.x), round(figure.z), round(figure.yaw));
  for (const key of WORLD_POSE_KEYS) into.push(round(figure.pose[key]));
  return into;
}

// The host's station, for everyone else:
//   h   the Hollow, or null while there is none: what it is doing, how angry, enraged or not, how held, whether
//       a scan can find it (not while it is above the ceiling), its speed, and then its figure
//   s   whether the Stills are hunting, and for each: there or not, where, facing where, arms, legs
//   d   one letter for each door: 1 wanted open, 0 not, b broken down
//   c   one letter for each ceiling hatch: 1 forced open, 0 still shut
function describeWorld() {
  const round = function (value) { return Math.round(value * 1000) / 1000; };
  const world = { k: 'world', h: null, s: [stillsAreHunting ? 1 : 0], d: '', c: '' };
  if (hollow.isActive) {
    world.h = describeFigure(hollow.figure, [hollow.state, round(hollow.anger), hollow.enragedTimer > 0 ? 1 : 0, round(hollow.heldAmount),
      raycastableFigures.indexOf(hollow.figure) >= 0 ? 1 : 0, round(hollow.currentSpeed)]);
  }
  for (const still of stills) {
    const figure = still.figure;
    world.s.push(still.isPresent ? 1 : 0, round(figure.x), round(figure.z), round(figure.yaw), round(figure.pose.armRaise), round(figure.pose.legSwing));
  }
  for (const door of doors) world.d += door.isBroken ? 'b' : (door.isWantedOpen ? '1' : '0');
  for (const hatch of hollowHatches) world.c += hatch.isOpen ? '1' : '0';
  return world;
}

// What the host said, checked: it comes from somebody else's browser. Kept for followHostStation.
function hearWorld(data) {
  const isNumbers = function (list, length) { return Array.isArray(list) && list.length === length && list.every(Number.isFinite); };
  if (data.h !== null && !isNumbers(data.h, WORLD_HOLLOW_NUMBERS)) return;
  if (!isNumbers(data.s, 1 + stills.length * WORLD_STILL_NUMBERS)) return;
  if (typeof data.d !== 'string' || data.d.length !== doors.length || typeof data.c !== 'string' || data.c.length !== hollowHatches.length) return;
  if (data.h !== null && (!Number.isInteger(data.h[0]) || data.h[0] < HOLLOW_STATE_ROAM || data.h[0] > HOLLOW_STATE_LISTEN)) return;
  // The Hollow is shown on its way from where it is shown now to where the host says it is.
  together.hollowFrom = describeFigure(hollow.figure, []);
  together.world = data;
  together.worldBlend = 0;
}

// One frame of the host's station being shown here: nothing is decided, everything follows.
function followHostStation(dt) {
  hollow.figure.hitsThisFrame = 0; // the host's game counts the light on it (it fires your scanner too)
  const world = together.world;
  if (!world) return;
  together.worldBlend = Math.min(1, together.worldBlend + dt * WORLD_SENDS_PER_SECOND);
  // What has hold of you is yours for that moment: your game shows it coming for you (updateDying).
  const yourCatcher = game.mode === 'dying' && game.deathSequence ? game.deathSequence.figure : null;

  for (let index = 0; index < doors.length; index++) {
    const door = doors[index], letter = world.d[index];
    if (letter === 'b') { if (!door.isBroken) withoutWorldSounds(function () { breakDoor(door); }); }
    else if (!door.isBroken) {
      moveDoor(door, letter === '1', false, 0, dt);
      if (door.forcedState === null && door.kind !== DOOR_KIND_BAY) tellPlayerOfShutDoor(door, dt); // which doors refuse you is the same everywhere: the mains and the cards are everybody's
    }
  }
  for (let index = 0; index < hollowHatches.length; index++) {
    const hatch = hollowHatches[index];
    if (world.c[index] === '1' && !hatch.isOpen) withoutWorldSounds(function () { forceHollowHatchOpen(hatch, false); });
  }

  const figure = hollow.figure, given = world.h;
  if (given === null) {
    if (hollow.isActive) { hollow.isActive = false; setFigureRaycastable(figure, false); }
  } else {
    hollow.isActive = true;
    hollow.state = given[0]; hollow.anger = given[1]; hollow.enragedTimer = given[2] === 1 ? 1 : 0; hollow.heldAmount = given[3]; hollow.currentSpeed = given[5];
    if (figure !== yourCatcher) {
      setFigureRaycastable(figure, given[4] === 1);
      const from = together.hollowFrom, at = 6;
      // Sent somewhere else at once (after it has caught somebody): it is simply there, it does not slide across the station.
      const amount = distanceBetweenPoints(from[0], from[1], given[at], given[at + 1]) > 4 ? 1 : together.worldBlend;
      figure.x = interpolateLinear(from[0], given[at], amount);
      figure.z = interpolateLinear(from[1], given[at + 1], amount);
      figure.yaw = from[2] + wrapAngleToPi(Math.atan2(Math.sin(given[at + 2] - from[2]), Math.cos(given[at + 2] - from[2]))) * amount;
      for (let position = 0; position < WORLD_POSE_KEYS.length; position++) {
        figure.pose[WORLD_POSE_KEYS[position]] = interpolateLinear(from[3 + position], given[at + 3 + position], amount);
      }
      updateFigureCapsules(figure);
    }
  }

  stillsAreHunting = world.s[0] === 1;
  for (let index = 0; index < stills.length; index++) {
    const still = stills[index], body = still.figure, at = 1 + index * WORLD_STILL_NUMBERS;
    if (body === yourCatcher) continue;
    const isPresent = world.s[at] === 1;
    if (isPresent !== still.isPresent) { still.isPresent = isPresent; setFigureRaycastable(body, isPresent); }
    // They do not glide: nobody sees one move. It stands where the host says it stands.
    if (body.x !== world.s[at + 1] || body.z !== world.s[at + 2] || body.yaw !== world.s[at + 3] || body.pose.armRaise !== world.s[at + 4] || body.pose.legSwing !== world.s[at + 5]) {
      body.x = world.s[at + 1]; body.z = world.s[at + 2]; body.yaw = world.s[at + 3]; body.pose.armRaise = world.s[at + 4]; body.pose.legSwing = world.s[at + 5];
      updateFigureCapsules(body);
    }
  }

  // The apparitions are your own, and ask how far things are from you on foot. Alone the Hollow's director keeps that up.
  playerDistanceFieldAge += dt;
  if (playerDistanceFieldAge > 0.5) refreshPlayerDistanceField();
}

// ---- Being caught ----

// The host's game: something of its has got hold of one of the others (catchPlayer, 11-game.js).
function catchOtherPlayer(caught, kind, figure) {
  if (!isWorldYoursToShare() || caught.isDown) return;
  caught.isDown = true; // nothing hunts them until they say they are back on their feet
  let stillIndex = -1;
  for (let index = 0; index < stills.length; index++) if (stills[index].figure === figure) stillIndex = index;
  sayToOthers({ k: 'caught', p: caught.id, kind: kind, s: stillIndex });
  sendCreaturesAwayAfterCatch(kind);
}

// The host's game, when somebody has been caught: what caught them does not stand over them while the others
// play on. The Hollow is sent far off, with a breather, as it is when you come back from a checkpoint alone;
// the Stills go back to where they stood.
function sendCreaturesAwayAfterCatch(kind) {
  if (!isWorldYoursToShare()) return;
  if (kind === 'hollow') relocateHollowAwayFromPlayer(12);
  else if (stillsAreHunting) resetStillsToHomePositions();
}

// ---- What is done to the station, in one order ----

// Something that happens to the whole descent is to be done (11-game.js says what each is):
//   { what: 'use', objectId }   { what: 'enter', place }   { what: 'leaveLift' }   { what: 'ascend' }
// Alone it is done now. Down there with others it is asked of the host, and done when the host says so.
function askToAct(action) {
  if (!isWorldShared()) { performAction(action); return; }
  if (action.what !== 'use') {
    // These are noticed again every frame until they have been done: asked once is enough.
    const key = action.what + ':' + (action.place || '');
    if (together.asked[key]) return;
    together.asked[key] = true;
  }
  if (isLobbyHost()) decideAction(together.myId, action);
  else sayToOthers({ k: 'ask', a: action });
}

// The host's game: this is done now, by this one of you. Everyone is told, and it is carried out here.
function decideAction(actorId, action) {
  sayToOthers({ k: 'did', p: actorId, a: action });
  performActionFor(actorId, action);
}

// An action as somebody else's browser sent it, checked. Returns it clean, or null.
function readAction(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.what === 'use' && Number.isInteger(data.objectId)) return { what: 'use', objectId: data.objectId };
  if (data.what === 'enter' && typeof data.place === 'string' && ZONE_NAMES.indexOf(data.place) >= 0 && data.place !== '') return { what: 'enter', place: data.place };
  if (data.what === 'leaveLift' || data.what === 'ascend') return { what: data.what };
  return null;
}

// Carries an action out as the doing of one of you. If that is somebody else, it is done with what they carry,
// the noise of it is where they stand, and what is only for the one who did it (see wrapForTogether) is left out.
function performActionFor(actorId, action) {
  const other = actorId === together.myId ? null : (findOtherPlayer(actorId) || { x: player.x, z: player.z, carried: {} }); // (gone since: it is still done)
  const yours = game.carried;
  game.actor = other;
  if (other) game.carried = other.carried;
  together.isCarryingOut = true;
  try { performAction(action); } finally { game.actor = null; game.carried = yours; together.isCarryingOut = false; }
}

function performAction(action) {
  if (action.what === 'use') {
    const interactable = findInteractableByObjectId(action.objectId);
    if (interactable && interactable.isAvailable) useInteractable(interactable); // (gone already: somebody was quicker)
  } else if (action.what === 'enter') notePlaceEntered(action.place);
  else if (action.what === 'leaveLift') noteLiftLeft();
  else if (action.what === 'ascend') beginAscent();
}

// ---- Everything else one browser says to the others about the station ----

function hearOfTheStation(id, data) {
  const isFromHost = id === together.hostId, other = findOtherPlayer(id);
  if (isLobbyHost()) {
    // What the others say to the host.
    if (data.k === 'noise' && Number.isFinite(data.x) && Number.isFinite(data.z) && Number.isFinite(data.r)) emitNoise(data.x, data.z, clampNumber(data.r, 0, 80));
    else if (data.k === 'stun' && Number.isFinite(data.s)) stunHollow(clampNumber(data.s, 0, 20));
    else if (data.k === 'back' && other) other.isDown = false;
    else if (data.k === 'ask') {
      const action = readAction(data.a);
      if (action && action.what !== 'ascend') decideAction(id, action); // when the car goes up is the host's to say
    }
    return;
  }
  if (!isFromHost) return;
  // What the host says to the others.
  if (data.k === 'world') hearWorld(data);
  else if (data.k === 'sound') hearWorldSound(data);
  else if (data.k === 'did') {
    const action = readAction(data.a);
    if (action && Number.isInteger(data.p)) performActionFor(data.p, action);
  } else if (data.k === 'caught' && data.p === together.myId) {
    const figure = data.kind === 'still' ? (stills[data.s] ? stills[data.s].figure : null) : hollow.figure;
    // If it does not kill you after all (you cannot be caught just now), the host is told you are still on your feet.
    if (!figure || !triggerPlayerDeath(data.kind === 'still' ? 'still' : 'hollow', figure)) sayToOthers({ k: 'back' });
  }
}
