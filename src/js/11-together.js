// ---------------------------------------------------------------------------
// Descending together: the lobby on the title screen, and the others who are in the station with you.
//
// This only exists on a page that was served by server/server.js, which keeps the lobbies and hands on what
// one browser says to the others (the page's `last-return-relay` line says where). Opened from a file, or
// served by anything else, the game is played alone and none of this is shown.
//
// What is shared so far, and what is not:
//   - Everyone goes down into the same station, at the same threat level: the host's, as chosen on the host's
//     title screen when the host begins.
//   - Everyone says where they are and where their scanner points, TOGETHER_SENDS_PER_SECOND times a second.
//     The others are bodies that only show where a beam lands, like everything else down there, and what
//     their scanners light up is lit for you too, more thinly than your own.
//   - Nothing else. Each browser still runs its own station: its own Hollow, its own doors, its own quests.
//     The others are not in `players`, so nothing of yours hunts them or opens for them.
// ---------------------------------------------------------------------------

const TOGETHER_SENDS_PER_SECOND = 15;    // how often you say where you are
const TOGETHER_ECHO_RAY_SHARE = 0.8;     // TWEAK: how much of another scanner's light is drawn here, as a share of your own scanner's pulses

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
  sendTimer: 0
};

// Which build this is, as one text: a lobby only holds browsers that say the same.
function describeBuildForLobby() {
  return [BUILD_STAMP.version, BUILD_STAMP.number, BUILD_STAMP.commit, BUILD_STAMP.isDevBuild ? 'dev' : ''].join('/');
}

function initializeTogether() {
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
      status = count + 'Give the others the code. They go down into the station and the threat level chosen here, when you begin. ' +
        'For now each of you has your own Hollow and your own work order, and you see each other only where a beam lands.';
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
  together.isInDescent = false;
  for (const other of together.others) setFigureRaycastable(other.figure, false);
  together.others.length = 0;
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
    sendToRelay({ t: 'start', d: descent });
    beginDescentTogether(descent);
  }
}

function beginDescentTogether(descent) {
  together.isInDescent = true;
  together.sendTimer = 0;
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
    figure: createFigure(FIGURE_PROPORTIONS_DUMMY, SURFACE_PLAYER, 'playerImprintSeconds'),
    hasBeenHeardFrom: false,
    x: 0, z: 0, eyeY: 0, yaw: 0, pitch: 0,                    // where they are now, as shown here
    fromX: 0, fromZ: 0, fromEyeY: 0, fromYaw: 0, fromPitch: 0, // where they were shown when they last said where they are
    toX: 0, toZ: 0, toEyeY: 0, toYaw: 0, toPitch: 0,           // and where they said they were
    blend: 1,                                                  // how far from the one to the other: 0 to 1
    isCrouching: false,
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
  const other = findOtherPlayer(id);
  if (!other || data.k !== 'at') return;
  for (const key of ['x', 'z', 'e', 'w', 'p', 's']) if (!Number.isFinite(data[key])) return;
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
    c: player.isCrouching ? 1 : 0, s: round(spreadDegrees) });
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
  other.rayBudget += QUALITY_PRESETS[settings.quality].raysPerSecond * TOGETHER_ECHO_RAY_SHARE * dt;
  const rayCount = Math.min(300, Math.floor(other.rayBudget));
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
    if (game.mode === 'playing') echoOtherScanner(other, dt);
  }
}
