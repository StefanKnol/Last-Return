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
//   - What lies loose has one place: each thing is moved by one browser, which tells the others ("Things that
//     lie loose", further down).
//   - Still each browser's own: the apparitions (on purpose), and what you carry for a job.
// ---------------------------------------------------------------------------

const TOGETHER_SENDS_PER_SECOND = 15;    // how often you say where you are
const WORLD_SENDS_PER_SECOND = 10;       // how often the host says how the creatures stand and which doors are open

const together = {
  relayAddress: '',      // where the lobbies are, or '' on a page that has none
  socket: null,
  code: '',              // the lobby you are in, or ''
  myId: 0, hostId: 0,
  memberIds: [],         // everyone in the lobby, you included
  isRoundOn: false,      // the host is down in a station right now (with whoever went along)
  isLocked: false,       // the host has locked the lobby: nobody else can join until it is opened again
  ownChoices: null,      // in somebody else's lobby: what you had chosen on the title screen yourself, to be put back when you leave
  ownFigure: null,       // your own body, which nobody sees: it is only in the way of the others' scanners (echoOtherScanner)
  hostMap: null,         // the number the host's station came to when it was built (level.mapFingerprint), once the host has said
  isInDescent: false,
  others: [],            // the others, while you are down there together
  statusText: '',
  sendTimer: 0,
  worldSendTimer: 0,
  world: null,           // not the host: how the host last said its station stands (see describeWorld), once it has said
  worldBlend: 1,         // and how far the creatures shown here have come towards that: 0 to 1
  hollowFrom: [],        // where and how the Hollow was shown when the host last said (describeFigure)
  actingId: 0,           // ... and which of you is doing it
  looseSayTimer: 0,
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
  together.ownFigure = createFigureOfKind('player');
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
  startUnseenTicks();
  const elements = interfaceState.elements;
  elements['together-options'].hidden = false;
  elements['button-host-lobby'].addEventListener('click', function () { openLobbySocket({ t: 'host', build: describeBuildForLobby() }); });
  const join = function () {
    const code = elements['together-code'].value.trim().toUpperCase();
    if (code.length !== 5) { together.statusText = 'A lobby code is five letters and digits.'; refreshTogetherControls(); return; }
    openLobbySocket({ t: 'join', code: code, build: describeBuildForLobby() });
  };
  elements['button-join-lobby'].addEventListener('click', join);
  elements['together-code'].addEventListener('keydown', function (event) { if (event.key === 'Enter') join(); });
  elements['button-leave-lobby'].addEventListener('click', function () { leaveLobby(''); });
  // The host's alone: with everyone in, nobody else gets in, whatever code they try. The server keeps it.
  elements['button-lock-lobby'].addEventListener('click', function () { if (isLobbyHost()) sendToRelay({ t: 'lock', on: !together.isLocked }); });
  refreshTogetherControls();
}

// A browser stops drawing a tab that is hidden, and the game is run from its drawing. For the host of others
// that would stop the station for everyone. So while the host's tab is hidden its station is run from here
// instead: a worker keeps time (a hidden page's own timers are slowed to one a second or worse; a worker's are
// not), and each tick runs what a frame would have run, without drawing it (runFrameUnseen, 11-game.js).
// This does not help when the browser puts the whole tab to sleep, or the machine sleeps.
function startUnseenTicks() {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined') return;
  try {
    const worker = new Worker(URL.createObjectURL(new Blob(['setInterval(function () { postMessage(0); }, 33);'], { type: 'text/javascript' })));
    let lastTick = performance.now();
    worker.onmessage = function () {
      const now = performance.now();
      let seconds = Math.min(1, (now - lastTick) / 1000); // (if the ticks come late all the same, the station catches up in steps)
      lastTick = now;
      if (!document.hidden || !isWorldYoursToShare()) return;
      while (seconds > 0.001) { const step = Math.min(0.05, seconds); runFrameUnseen(step); seconds -= step; }
    };
  } catch (error) { /* no workers here: a hidden host stops the station, as before */ }
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
  elements['button-lock-lobby'].hidden = !isLobbyHost();
  elements['button-lock-lobby'].textContent = together.isLocked ? 'Open it again' : 'Lock it';
  let status = together.statusText;
  begin.disabled = false;
  begin.textContent = 'Begin descent';
  // In somebody else's lobby the station and the threat level are the host's to choose: you see them, and
  // cannot change them.
  const isHostsToChoose = isInLobby && !isLobbyHost();
  for (const group of document.querySelectorAll('#screen-title .title-block fieldset')) if (group !== elements['together-options']) group.disabled = isHostsToChoose;
  for (const control of elements['station-options'].querySelectorAll('select, input')) control.disabled = isHostsToChoose;
  if (isInLobby) {
    const count = together.isLocked ? together.memberIds.length + ' in the lobby, and it is locked: nobody else can join. ' : together.memberIds.length + ' of 4 in the lobby. ';
    if (!isLobbyHost() && together.isRoundOn) {
      begin.disabled = true;
      begin.textContent = 'Waiting for the others';
      status = count + (together.statusText ? together.statusText + ' ' : '') + 'The others are down there. You go down with them on the next descent.';
    } else if (isLobbyHost()) {
      begin.textContent = 'Begin descent together';
      status = count + (together.isLocked ? '' : 'Give the others the code, and lock it when they are all in. ') +
        'When you begin, everyone goes down with you: into the station and the threat level chosen here, with one Hollow and one work order between you.';
    } else {
      begin.disabled = true;
      begin.textContent = 'Waiting for the host';
      status = count + (together.statusText ? together.statusText + ' ' : '') + 'The host chooses the station and the threat level, shown above. When the host begins, you go down too.';
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
  endDescentTogether();
  together.code = ''; together.myId = 0; together.hostId = 0; together.memberIds = [];
  together.isRoundOn = false; together.isLocked = false;
  if (together.ownChoices) {
    // The title screen is yours again: back to what you had chosen yourself.
    Object.assign(settings, together.ownChoices);
    together.ownChoices = null;
    refreshChoiceControls();
  }
  together.statusText = statusText;
  refreshTogetherControls();
  if (wasInDescent && statusText !== '' && game.mode !== 'title') showMessage(statusText + ' You are on your own now.', 7, 'warning');
}

// You are no longer down there with the others (you may still be down there, and still in the lobby).
function endDescentTogether() {
  const wasTheHosts = isWorldTheHosts();
  together.isInDescent = false;
  together.hostMap = null;
  for (const other of together.others) setFigureRaycastable(other.figure, false);
  together.others.length = 0;
  for (const object of looseObjects) { object.ownerId = 0; if (!object.isHeld) object.heldById = 0; } // every loose thing is yours to move again
  players.length = 0; players.push(player);
  together.world = null;
  // The scanners of the fallen were waiting to be carried back by somebody. Nobody is coming now.
  for (const object of looseObjects.slice()) if (object.fallenPlayerId) removeLooseObject(object);
  // Dead, and waiting for that: you are alone now, and it is as it is alone. The death screen says so again,
  // with the way back from the last checkpoint if this threat level has one. (It used to go on saying that one
  // of the others could carry your scanner back, with no button but the one to the title screen.)
  if (game.mode === 'dead' && game.deathSequence) { game.isDescentLost = false; game.isLeftBehind = false; showDeathScreen(game.deathSequence.kind); }
  if (wasTheHosts) {
    // The station is yours from here: what walks in it takes up thinking where the host's left off.
    cancelHollowCrawl(); hollow.doorBang = null; hollow.fieldTargetIndex = -1;
    setFigureRaycastable(hollow.figure, hollow.isActive);
  }
}

// Going back up to the title screen (11-game.js calls this). You stay in the lobby, for the next descent. If
// you are the host, the descent is over for everyone: the station was yours.
function leaveDescentTogether() {
  if (!together.isInDescent) return;
  if (isLobbyHost()) { together.isRoundOn = false; sayToOthers({ k: 'over' }); }
  else sayToOthers({ k: 'gone' });
  endDescentTogether();
  refreshTogetherControls();
}

// ---- What the host has chosen on the title screen, for the others to see ----

const LOBBY_CHOICES = ['station', 'stationSize', 'stationLayout', 'stationLevels', 'seedText', 'workOrders', 'difficulty', 'customDifficulty'];

function refreshChoiceControls() {
  interfaceState.refreshSettingControls();
  interfaceState.refreshStationControls();
  interfaceState.refreshDifficulty();
}

// As the host: said whenever a setting changes (saveSettings, 09-player.js), and to whoever joins. It also
// says whether you are down there right now, which somebody who joins meanwhile has no other way to know.
function tellLobbyWhatIsChosen() {
  if (together.code === '' || !isLobbyHost()) return;
  sayToOthers({ k: 'chosen', on: together.isInDescent ? 1 : 0, station: settings.station, stationSize: settings.stationSize, stationLayout: settings.stationLayout,
    stationLevels: settings.stationLevels, seedText: settings.seedText, workOrders: getAllowedWorkOrders(), difficulty: settings.difficulty, customDifficulty: settings.customDifficulty });
}

// As anyone else: the title screen shows it. It comes from somebody else's browser, so it is checked; anything
// that is not a choice this game has is left as it was.
function hearLobbyChoices(data) {
  const has = function (table, key) { return typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key); };
  if (!together.ownChoices) {
    together.ownChoices = {};
    for (const key of LOBBY_CHOICES) together.ownChoices[key] = settings[key];
    together.ownChoices.workOrders = Object.assign({}, settings.workOrders);
  }
  if (data.station === 'classic' || data.station === 'generated') settings.station = data.station;
  if (has(GENERATED_SIZE_PRESETS, data.stationSize)) settings.stationSize = data.stationSize;
  if (has(GENERATED_LAYOUT_PRESETS, data.stationLayout)) settings.stationLayout = data.stationLayout;
  if (has(GENERATED_LEVEL_PRESETS, data.stationLevels)) settings.stationLevels = data.stationLevels;
  if (typeof data.seedText === 'string') settings.seedText = data.seedText.slice(0, 24);
  if (Array.isArray(data.workOrders)) {
    settings.workOrders = {};
    for (const order of WORK_ORDERS) settings.workOrders[order.key] = data.workOrders.indexOf(order.key) >= 0;
  }
  if (data.difficulty === 'custom' || has(DIFFICULTY_PRESETS, data.difficulty)) settings.difficulty = data.difficulty;
  settings.customDifficulty = sanitizeCustomDifficultyValues(data.customDifficulty);
  together.isRoundOn = data.on === 1;
  refreshChoiceControls();
  refreshTogetherControls();
}

const LOBBY_REFUSALS = {
  unknown: 'There is no lobby with that code.',
  full: 'That lobby is full.',
  build: 'That lobby is on another version of the game. Reload the page, and ask the host to do the same.',
  busy: 'The server has no room for another lobby just now.',
  locked: 'That lobby is locked. Ask the host to open it again.',
  slow: 'Too many codes that were not right. Wait a minute before trying another.'
};

function hearRelay(message) {
  if (message.t === 'lobby' && Array.isArray(message.players)) {
    together.code = String(message.code); together.myId = message.you; together.hostId = message.host;
    together.memberIds = message.players.slice();
    together.isLocked = message.locked === true;
    together.statusText = '';
  } else if (message.t === 'locked') {
    together.isLocked = message.on === true;
  } else if (message.t === 'refused') {
    leaveLobby(LOBBY_REFUSALS[message.why] || 'The lobby could not be joined.');
    return;
  } else if (message.t === 'joined') {
    if (together.memberIds.indexOf(message.id) < 0) together.memberIds.push(message.id);
    tellLobbyWhatIsChosen(); // as the host: so that their title screen shows it
  } else if (message.t === 'left') {
    together.memberIds = together.memberIds.filter(function (id) { return id !== message.id; });
    handBackLooseThingsOf(message.id);
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
    together.isRoundOn = true;
    together.statusText = '';
    if (game.mode === 'ending' || game.mode === 'dead') { stopVoiceLine(); silenceGameplaySounds(); } // still looking at how the last one ended
    else if (game.mode !== 'title') {
      // Somewhere else altogether (the workshop): this one goes without you.
      together.statusText = 'The host began while you were not at the title screen.';
      refreshTogetherControls();
      return;
    }
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
    together.isRoundOn = true;
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
    figure: createFigureOfKind('player'),
    hasBeenHeardFrom: false,
    x: 0, z: 0, eyeY: 0, yaw: 0, pitch: 0,                    // where they are now, as shown here
    fromX: 0, fromZ: 0, fromEyeY: 0, fromYaw: 0, fromPitch: 0, // where they were shown when they last said where they are
    toX: 0, toZ: 0, toEyeY: 0, toYaw: 0, toPitch: 0,           // and where they said they were
    blend: 1,                                                  // how far from the one to the other: 0 to 1
    isCrouching: false,
    velocityX: 0, velocityZ: 0, audibleRadius: 0, // what the host's Hollow goes by, as they say it
    isDown: false,      // caught, and not back on their feet: nothing hunts them (the host's game keeps this)
    isFallen: false,    // dead, as they say themselves: their body is gone and their scanner lies where they fell
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
  if (data.k === 'chosen') { if (id === together.hostId) hearLobbyChoices(data); return; }
  if (data.k === 'over') {
    // The host is back at the title screen. The station was the host's: the descent is over for everyone.
    if (id !== together.hostId) return;
    together.isRoundOn = false;
    if (together.isInDescent && game.mode !== 'ending' && game.mode !== 'title') {
      together.statusText = 'The host has gone back up, and the descent is over.';
      returnToTitle();
    } else endDescentTogether(); // looking at how it ended: go on looking
    refreshTogetherControls();
    return;
  }
  if (data.k === 'gone') {
    // One of the others is back at the title screen. They are still in the lobby.
    const gone = findOtherPlayer(id);
    handBackLooseThingsOf(id);
    if (gone) {
      setFigureRaycastable(gone.figure, false);
      together.others.splice(together.others.indexOf(gone), 1);
      if (together.isInDescent && game.mode !== 'title') showMessage('One of the others has gone back up.', 5, 'info');
    }
    return;
  }
  if (!together.isInDescent) return;
  if (data.k === 'loose') { hearWhereLooseThingsAre(id, data); return; }
  if (data.k === 'knock') { hearKnock(data); return; }
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
  if (other.hasBeenHeardFrom && (data.d === 1) !== other.isFallen) setFigureRaycastable(other.figure, data.d !== 1);
  other.isFallen = data.d === 1;
  if (!other.hasBeenHeardFrom) {
    // The first word from them: they are simply there, not on their way from nowhere.
    other.hasBeenHeardFrom = true;
    other.blend = 1;
    other.x = other.toX; other.z = other.toZ; other.eyeY = other.toEyeY; other.yaw = other.toYaw; other.pitch = other.toPitch;
    placeOtherPlayerFigure(other, 0);
    setFigureRaycastable(other.figure, !other.isFallen);
  }
}

// Where you are and where your scanner points, for the others.
function sayWhereYouAre() {
  const round = function (value) { return Math.round(value * 1000) / 1000; };
  let spreadDegrees = 0;
  if (game.mode === 'playing' && player.isPainting) spreadDegrees = player.spreadDegrees;
  else if (game.mode === 'playing' && player.sweepTimeRemaining > 0) spreadDegrees = TUNING.sweepHalfWidthDegrees;
  sayToOthers({ k: 'at', x: round(player.x), z: round(player.z), e: round(getPlayerEyeY()), w: round(player.yaw), p: round(player.pitch),
    c: player.isCrouching ? 1 : 0, s: round(spreadDegrees), d: game.mode === 'dying' || game.mode === 'dead' ? 1 : 0,
    vx: round(player.velocityX), vz: round(player.velocityZ), r: round(game.mode === 'playing' ? player.audibleRadius : 0) });
}

// TWEAK: how far forward the arm with the scanner is raised (radians): held out while they scan, and at their side.
const OTHER_PLAYER_ARM_SCANNING = 1.1, OTHER_PLAYER_ARM_AT_SIDE = 0.2;

// Stands their body where they are shown, in the pose of what they are doing. `movedDistance` is how far they
// came since the last frame: their legs go with it.
function placeOtherPlayerFigure(other, movedDistance) {
  const figure = other.figure, pose = figure.pose;
  figure.x = other.x; figure.z = other.z; figure.yaw = other.yaw;
  other.walkPhase += movedDistance * 6;
  pose.legSwing = Math.sin(other.walkPhase) * (other.isCrouching ? 0.2 : 0.5) * other.stride; // (crouched: short steps, or the knee behind would be on the floor)
  pose.armSwing = Math.sin(other.walkPhase) * 0.2 * other.stride;
  poseFigureAsPlayer(figure, other.isCrouching); // crouched it is as tall as TUNING.playerHeightCrouching (04-figures.js)
  // The scanner arm (04-figures.js): at their side with the elbow bent while they only carry it, held out while
  // they scan. Either way the forearm, and the scanner with it, points where they look.
  pose.armRaise = other.armRaise;
  pose.elbowBend = clampNumber(1.5 + other.pitch - other.armRaise - pose.lean * 0.4, 0, 2.2);
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
  other.armRaise = approachValue(other.armRaise, other.spreadDegrees > 0 ? OTHER_PLAYER_ARM_SCANNING : OTHER_PLAYER_ARM_AT_SIDE, dt * 5);
  placeOtherPlayerFigure(other, movedDistance);
}

// The light on top of a scanner is the one thing down there that is simply lit: you see it without scanning,
// unless something is in the way. On their feet it is in their hand. Dead, their body is gone and the scanner
// lies where they fell, still lit.
const scannerLight = { x: 0, y: 0, z: 0 };
function showScannerLight(other) {
  if (!other.hasBeenHeardFrom) return;
  if (other.isFallen) return; // their scanner is a thing that lies somewhere now, and is lit there (showFallenScannerLights)
  getFigureScannerLight(other.figure, scannerLight);
  // A few points that last a quarter of a second, put down again every frame. They are not returns of anything.
  for (let count = 0; count < 3; count++) {
    addScanPoint(scannerLight.x + (Math.random() - 0.5) * 0.03, scannerLight.y + (Math.random() - 0.5) * 0.02, scannerLight.z + (Math.random() - 0.5) * 0.03,
      1, SURFACE_SCANNER_LIGHT, 1, true);
  }
  pointCloud.totalReturns -= 3;
}

// The scanners of the fallen, wherever they lie or are being carried: lit.
function showFallenScannerLights() {
  for (const object of looseObjects) {
    if (!object.fallenPlayerId) continue;
    for (let count = 0; count < 3; count++) {
      addScanPoint(object.x + (Math.random() - 0.5) * 0.03, object.y + 0.07 + (Math.random() - 0.5) * 0.02, object.z + (Math.random() - 0.5) * 0.03, 1, SURFACE_SCANNER_LIGHT, 1, true);
    }
    pointCloud.totalReturns -= 3;
  }
}

// One of the others, for one frame: where they are now, their light, and what their scanner shows.
// (Debug mode's walking player goes through here too: src/dev/10-debug.js.)
function presentOtherPlayer(other, dt, isScannerShown) {
  advanceOtherPlayer(other, dt);
  if (game.mode !== 'intro') showScannerLight(other);
  if (isScannerShown && !other.isFallen) echoOtherScanner(other, dt);
}

// What another scanner lights up is lit here too, as much of it as they see themselves. Nothing is sent for it:
// this browser fires pulses of its own from where their scanner is, the way it points. Your own body is in the
// way of them, as theirs is in the way of yours: nothing is lit behind you, and nothing is drawn on you.
function echoOtherScanner(other, dt) {
  if (!other.hasBeenHeardFrom || other.spreadDegrees <= 0) { other.rayBudget = 0; return; }
  other.rayBudget += QUALITY_PRESETS[settings.quality].raysPerSecond * dt;
  const rayCount = Math.min(700, Math.floor(other.rayBudget));
  other.rayBudget -= rayCount;
  const cosinePitch = Math.cos(other.pitch), sinePitch = Math.sin(other.pitch), cosineYaw = Math.cos(other.yaw), sineYaw = Math.sin(other.yaw);
  const forwardX = sineYaw * cosinePitch, forwardY = sinePitch, forwardZ = -cosineYaw * cosinePitch;
  const rightX = cosineYaw, rightZ = sineYaw;
  const upX = -sineYaw * sinePitch, upY = cosinePitch, upZ = cosineYaw * sinePitch;
  const spreadTangent = Math.tan(other.spreadDegrees * DEGREES_TO_RADIANS);
  setFigureRaycastable(other.figure, false); // their light starts inside their own head: it is not in its own way
  const ownBody = together.ownFigure, isOwnBodyThere = game.mode === 'playing' || game.mode === 'paused' || game.mode === 'reading';
  if (isOwnBodyThere) setFigureRaycastable(ownBody, true);
  scanSource.x = other.x; scanSource.z = other.z;
  for (let rayIndex = 0; rayIndex < rayCount; rayIndex++) {
    const radius = Math.pow(Math.random(), 0.62) * spreadTangent, angle = Math.random() * TWO_PI;
    const horizontal = Math.cos(angle) * radius, vertical = Math.sin(angle) * radius;
    const directionX = forwardX + rightX * horizontal + upX * vertical;
    const directionY = forwardY + upY * vertical;
    const directionZ = forwardZ + rightZ * horizontal + upZ * vertical;
    const length = Math.sqrt(directionX * directionX + directionY * directionY + directionZ * directionZ);
    if (castScannerRay(other.x, other.eyeY, other.z, directionX / length, directionY / length, directionZ / length, TUNING.scannerMaximumRange) &&
        rayHit.figure !== ownBody) recordScanHit(false);
  }
  setFigureRaycastable(ownBody, false);
  setFigureRaycastable(other.figure, true);
}

// Your own body, where you stand. Nobody sees it here; it is what the others' scanners cannot reach past.
function placeOwnBody() {
  const figure = together.ownFigure;
  figure.x = player.x; figure.z = player.z; figure.yaw = player.yaw;
  poseFigureAsPlayer(figure, player.isCrouching);
  figure.pose.armRaise = 0.2; figure.pose.elbowBend = 1.2;
  updateFigureCapsules(figure);
}

// The host's game: has one of those who came down with you not said where they are yet? Then their browser is
// still building the station, and they are in the lift car, where everyone starts. (The car's door waits for them.)
function isSomebodyStillOnTheirWayDown() {
  if (!isWorldYoursToShare()) return false;
  for (const other of together.others) if (!other.hasBeenHeardFrom && !other.isDown) return true;
  return false;
}

// Every frame, whatever the game is doing (11-game.js calls this).
function updateTogether(dt) {
  if (!together.isInDescent) return;
  together.sendTimer -= dt;
  if (together.sendTimer <= 0) {
    together.sendTimer = Math.max(together.sendTimer + 1 / TOGETHER_SENDS_PER_SECOND, 0);
    sayWhereYouAre();
  }
  together.looseSayTimer -= dt;
  if (together.looseSayTimer <= 0 && game.mode !== 'intro') {
    together.looseSayTimer = Math.max(together.looseSayTimer + 1 / LOOSE_SAYS_PER_SECOND, 0);
    claimWhatRidesInYourBeam();
    sayWhereLooseThingsAre();
  }
  placeOwnBody();
  if (game.mode !== 'intro') showFallenScannerLights();
  for (const other of together.others) {
    // What their scanners light up is lit here whatever you are doing yourself: with the menu open, reading a
    // page, or dead. It goes onto your map, and the host's creatures feel their light. (It used to stop for
    // anyone but the host who was not at the controls, so a room scanned while you had the menu open stayed dark.)
    presentOtherPlayer(other, dt, game.mode !== 'intro');
  }
  if (isLobbyHost()) {
    // Who is on their feet down here, for what hunts and what opens. (Never nobody: with everyone down it is you.)
    players.length = 0;
    if (game.mode !== 'dying' && game.mode !== 'dead') players.push(player);
    for (const other of together.others) if (other.hasBeenHeardFrom && !other.isDown) players.push(other);
    if (players.length === 0) players.push(player);
    if (game.mode !== 'intro') updateFallenScanners(dt);
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
  // The Hollow treading on glass, cans or a loose plate, and flinging a thing: your warning, and so the others' too.
  // (Shared only while the host's creatures are being run, like the rest: your own step on glass is your own.)
  playNoisyFloorSound = shareWorldSound('playNoisyFloorSound', playNoisyFloorSound);
  playLooseObjectFlingSound = shareWorldSound('playLooseObjectFlingSound', playLooseObjectFlingSound);
  showCaption = shareWorldSound('showCaption', showCaption);
  // (A line from Dispatch is for everybody, whoever did what he speaks of: it is let through. It used to be held
  // back with the rest, so the others heard his radio click and read nothing, unless the line had a recording,
  // which puts the words up again when the voice starts.)
  const showMessageAsItWas = showMessage;
  showMessage = function (text, seconds, kind) { return game.actor && kind !== 'radio' ? undefined : showMessageAsItWas.apply(null, arguments); };
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
  if (action.what === 'enter' || action.what === 'leaveLift' || action.what === 'ascend') {
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
  if (action.what === 'fall') action.id = looseState.nextId; // a new thing: it gets the same number in every browser, the host's next
  sayToOthers({ k: 'did', p: actorId, a: action });
  performActionFor(actorId, action);
}

// An action as somebody else's browser sent it, checked. Returns it clean, or null.
function readAction(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.what === 'use' && Number.isInteger(data.objectId)) return { what: 'use', objectId: data.objectId };
  if (data.what === 'enter' && typeof data.place === 'string' && ZONE_NAMES.indexOf(data.place) >= 0 && data.place !== '') return { what: 'enter', place: data.place };
  if (data.what === 'leaveLift' || data.what === 'ascend' || data.what === 'allDown') return { what: data.what };
  // A scanner where somebody fell, and its restarting.
  if (data.what === 'fall' && Number.isFinite(data.x) && Number.isFinite(data.y) && Number.isFinite(data.z)) {
    return { what: 'fall', x: clampNumber(data.x, 0, GRID_WIDTH), y: clampNumber(data.y, -100, 100), z: clampNumber(data.z, 0, GRID_DEPTH), id: Number.isInteger(data.id) ? data.id : 0 };
  }
  if (data.what === 'restart' && Number.isInteger(data.id)) return { what: 'restart', id: data.id };
  // Things that lie loose (see further down).
  if ((data.what === 'take' || data.what === 'release' || data.what === 'carry' || data.what === 'lose' || data.what === 'setOff') && Number.isInteger(data.id)) return { what: data.what, id: data.id, isByButton: data.isByButton === true };
  if (data.what === 'shatter' && Number.isInteger(data.id) && Number.isFinite(data.x) && Number.isFinite(data.y) && Number.isFinite(data.z)) {
    return { what: 'shatter', id: data.id, x: clampNumber(data.x, 0, GRID_WIDTH), y: clampNumber(data.y, -100, 100), z: clampNumber(data.z, 0, GRID_DEPTH) };
  }
  if (data.what === 'bayState' && Number.isInteger(data.index) && (data.state === 'open' || data.state === 'sealing')) return { what: 'bayState', index: data.index, state: data.state };
  if (data.what === 'sealBay' && Number.isInteger(data.index) && Array.isArray(data.ids) && data.ids.length <= 400 && data.ids.every(Number.isInteger) && Number.isFinite(data.value)) {
    return { what: 'sealBay', index: data.index, ids: data.ids, value: data.value };
  }
  return null;
}

// Carries an action out as the doing of one of you. If that is somebody else, it is done with what they carry,
// the noise of it is where they stand, and what is only for the one who did it (see wrapForTogether) is left out.
function performActionFor(actorId, action) {
  // What simply happens to the station (a thing breaks, a bay seals) is nobody's doing: everyone is told alike.
  const isNobodys = action.what === 'shatter' || action.what === 'lose' || action.what === 'bayState' || action.what === 'sealBay' || action.what === 'allDown';
  const other = actorId === together.myId || isNobodys ? null : (findOtherPlayer(actorId) || { x: player.x, z: player.z, carried: {} }); // (gone since: it is still done)
  const yours = game.carried;
  game.actor = other;
  if (other) game.carried = other.carried;
  together.isCarryingOut = true;
  together.actingId = actorId;
  try { performAction(action); } finally { game.actor = null; game.carried = yours; together.isCarryingOut = false; together.actingId = together.myId; }
}

function performAction(action) {
  if (action.what === 'use') {
    const interactable = findInteractableByObjectId(action.objectId);
    if (interactable && interactable.isAvailable) useInteractable(interactable); // (gone already: somebody was quicker)
  } else if (action.what === 'enter') notePlaceEntered(action.place);
  else if (action.what === 'leaveLift') noteLiftLeft();
  else if (action.what === 'ascend') beginAscent();
  else if (action.what === 'fall') dropFallenScanner(action);
  else if (action.what === 'restart') restartFallenScanner(action.id);
  else if (action.what === 'allDown') {
    game.isDescentLost = true;
    if (game.mode === 'dead' && game.deathSequence) showDeathScreen(game.deathSequence.kind); // it says so
  }
  else performLooseAction(action);
}

// ---- Being caught, and being carried back ----
//
// Down there with others there are no checkpoints. Whoever is caught leaves their scanner where they fell: a
// loose thing like any other, with its light still on. One of the others carries it to the lift (to within
// TOGETHER_RESTART_METRES of the car) or into a salvage bay that stands open, and puts it down. When it has
// lain there for TOGETHER_RESTART_SECONDS it restarts, loudly, and its owner is on their feet where it lay.
// It has to have been carried: somebody must have had it in their beam. Falling at the lift is not a way back.
// A scanner lost down the shaft is lost, and so is its owner, for this descent. When every one of you is down,
// nobody is left to carry anybody, and the descent is over.

const TOGETHER_RESTART_METRES = 2.5; // TWEAK: how near the lift car counts as "at the lift"
const TOGETHER_RESTART_SECONDS = 3;  // TWEAK: how long it lies there before it restarts

function dropFallenScanner(action) {
  const actingId = together.actingId;
  for (const object of looseObjects) if (object.fallenPlayerId === actingId) return; // theirs lies somewhere already
  const scanner = createLooseObject('scanner', action.x, action.y, action.z, 0);
  if (action.id > 0) { scanner.id = action.id; looseState.nextId = Math.max(looseState.nextId, action.id + 1); }
  scanner.fallenPlayerId = actingId;
  scanner.wasHandled = false;
}

function restartFallenScanner(id) {
  const scanner = findLooseObjectById(id);
  if (!scanner || !scanner.fallenPlayerId) return;
  const x = scanner.x, z = scanner.z, ownerId = scanner.fallenPlayerId;
  removeLooseObject(scanner);
  playLiftBell();
  if (!isWorldTheHosts()) emitNoise(x, z, TUNING.noiseRadiusDoor);
  const other = findOtherPlayer(ownerId);
  if (other) { other.isDown = false; other.isFallen = false; }
  if (ownerId === together.myId) standUpAgainAt(x, z);
  else if (game.mode !== 'title') showMessage('A scanner restarts. One of the others is back on their feet.', 5, 'info');
}

// The host's game: is a fallen scanner lying where it can be restarted, and has it lain there long enough? And
// is anybody still on their feet?
function updateFallenScanners(dt) {
  let isAnyoneUp = game.mode !== 'dying' && game.mode !== 'dead';
  for (const other of together.others) if (other.hasBeenHeardFrom && !other.isDown && !other.isFallen) isAnyoneUp = true;
  if (!isAnyoneUp && !game.isDescentLost && game.mode === 'dead') decideAction(together.myId, { what: 'allDown' });
  if (game.isDescentLost) return;
  for (const object of looseObjects) {
    if (!object.fallenPlayerId) continue;
    // Carried there: one that somebody has had in their beam. A scanner that simply lies where its owner fell
    // does not restart for lying near the lift, or dying within reach of the car would cost three seconds.
    let canRestart = object.wasHandled && !object.heldById && distanceOutsideLiftCar(object.x, object.z) < TOGETHER_RESTART_METRES;
    const bay = findOpenHaulBay();
    if (object.wasHandled && !object.heldById && bay && isLooseObjectInHaulBay(object, bay)) canRestart = true;
    object.restartSeconds = canRestart ? object.restartSeconds + dt : 0;
    if (object.restartSeconds >= TOGETHER_RESTART_SECONDS) { decideAction(together.myId, { what: 'restart', id: object.id }); return; }
  }
}

// ---- Things that lie loose ----
//
// Every browser has every loose thing, and at the start they all lie in the same places. What has to be agreed
// from then on is what moves. Each thing has one browser that moves it, its `ownerId`: the host's, unless one
// of the others has taken it into their beam, and then theirs until it lies still again. Only that browser
// runs it (08-loose-objects.js leaves everybody else's alone: isLooseObjectAnothers), and it says where its
// moving things are LOOSE_SAYS_PER_SECOND times a second ('loose'). Everyone else puts them there.
// So carrying and throwing feel as they do alone, and a thing has one place.
// Who has what in their beam, a thing breaking, a thing lost down the shaft, a grenade set off and a salvage bay
// sealing are done to the station like everything else: asked of the host, done by all in the host's order.

const LOOSE_SAYS_PER_SECOND = 12;
const LOOSE_NUMBERS = 13; // id, x, y, z, the four of how it is turned, how fast it goes (3), moving or not, worth

function performLooseAction(action) {
  const actingId = isWorldShared() ? together.actingId : 0;
  if (action.what === 'bayState' || action.what === 'sealBay') {
    const bay = haulState.bays[action.index];
    if (!bay || bay.state === 'sealed') return;
    if (action.what === 'sealBay') sealHaulBayNow(bay, action.ids, action.value);
    else if (bay.state === 'open' || bay.state === 'sealing') bay.state = action.state;
    return;
  }
  const object = findLooseObjectById(action.id);
  if (!object) return; // gone already
  if (action.what === 'take') {
    if (object.heldById && isWorldShared()) return; // somebody was quicker
    object.heldById = actingId; object.ownerId = actingId;
    object.wasHandled = true; object.isIgnoredByHollow = false; object.lastHandledTime = game.time;
    // Somebody else's: awake here, and so is what rests on it, as when you take a thing yourself. What is in a
    // crate has to be awake to go on riding in it: asleep, it is counted as riding for a fifth of a second and
    // then left standing where it was, unless the crate's first move happened to arrive sooner than that. Between
    // two windows on one machine it did; with a real distance between the two browsers it would not have.
    if (game.actor) { wakeLooseObject(object); wakeLooseObjectsTouching(object); }
    else if (!pickUpLooseObjectNow(object, action.isByButton)) askToAct({ what: 'release', id: object.id }); // (your beam has something else by now)
    if (object.heldById) noteWhatRestsOnLooseObject(object); // what is in a crate goes where the crate goes, from now
    // Yours, and with things in it that another browser moves: they are asked for now, while they count as
    // riding, and not at the next turn of the clock that asks (claimWhatRidesInYourBeam).
    if (!game.actor && object.heldById && isWorldShared()) claimWhatRidesInYourBeam();
  } else if (action.what === 'release') {
    if (object.heldById === actingId) object.heldById = 0;
  } else if (action.what === 'carry') {
    // What rides in what one of you carries is theirs to move, like the thing in their beam itself (see
    // claimWhatRidesInYourBeam). Only for one who has something in their beam, and only what is at it.
    if (object.heldById) return;
    let isAtTheirs = !isWorldShared();
    for (const other of looseObjects) {
      if (other.heldById !== actingId) continue;
      const reach = other.prepared.boundsRadius + object.prepared.boundsRadius + 0.5;
      if (Math.hypot(other.x - object.x, other.y - object.y, other.z - object.z) < reach) isAtTheirs = true;
    }
    if (!isAtTheirs) return;
    object.ownerId = actingId;
    wakeLooseObject(object);
  } else if (action.what === 'shatter') {
    object.x = action.x; object.y = action.y; object.z = action.z;
    shatterLooseObjectNow(object);
  } else if (action.what === 'lose') {
    looseState.statistics.lostDownThePit++;
    removeLooseObject(object);
  } else if (action.what === 'setOff') {
    if (object.kind.use && !object.isSpent && object.armedTime < 0) object.kind.use.activate(object);
  }
}

// A thing this browser moves has knocked against something. The others hear it where it happened; only the
// browser that moves a thing knows it knocked. `loudness` is 0 to 1, or -1 for one too faint to be worth words.
function tellOthersOfKnock(material, volume, weight, x, y, z, loudness) {
  if (!isWorldShared()) return;
  const round = function (value) { return Math.round(value * 100) / 100; };
  sayToOthers({ k: 'knock', m: material, v: round(volume), w: round(weight), x: round(x), y: round(y), z: round(z), l: round(loudness) });
}

function hearKnock(data) {
  for (const key of ['v', 'w', 'x', 'y', 'z', 'l']) if (!Number.isFinite(data[key])) return;
  let isMaterial = false; // (one that some kind of loose thing is made of: it names a sound)
  for (const kindKey in LOOSE_OBJECT_KINDS) if (LOOSE_OBJECT_KINDS[kindKey].material === data.m) isMaterial = true;
  if (!isMaterial) return;
  const x = clampNumber(data.x, 0, GRID_WIDTH), z = clampNumber(data.z, 0, GRID_DEPTH);
  playLooseObjectKnock(data.m, clampNumber(data.v, 0, 1), clampNumber(data.w, 0.3, 3), x, clampNumber(data.y, -100, 100), z);
  if (data.l >= 0) showCaption(data.l > 0.55 ? 'objectCrash' : 'objectKnock', { x: x, z: z });
}

// A crate in your beam, with things in it: they ride in it (isLooseObjectRiding in 08-loose-objects.js), and
// they are yours to move for as long as they do, like the crate. A crate and what is in it have to be moved by
// one browser: told about twelve times a second where somebody else's crate is, no browser can keep its own cans
// in it, and the one who carries it could not feel what they weigh. So each thing that rides in what you carry
// and is not yours yet is asked for ('carry'). It is the host's again when it lies still, like anything else
// (sayWhereLooseThingsAre).
function claimWhatRidesInYourBeam() {
  const held = getHeldLooseObject();
  if (!held) return;
  for (const object of looseObjects) {
    if (object.heldLinkId !== held.id || !isLooseObjectAnothers(object) || !isLooseObjectRiding(object)) continue;
    if (game.time - (object.carryAskedTime || -10) < 0.5) continue; // (asked a moment ago: the host's answer is on its way)
    object.carryAskedTime = game.time;
    askToAct({ what: 'carry', id: object.id });
  }
}

// The things this browser moves that are moving, or have just stopped: where they are, for the others.
function sayWhereLooseThingsAre() {
  const round = function (value) { return Math.round(value * 1000) / 1000; };
  let said = [];
  for (const object of looseObjects) {
    if (isLooseObjectAnothers(object)) continue;
    const isMoving = !object.isAsleep;
    if (!isMoving && !object.wasMovingWhenSaid) continue;
    object.wasMovingWhenSaid = isMoving;
    said.push(object.id, round(object.x), round(object.y), round(object.z), round(object.orientationX), round(object.orientationY), round(object.orientationZ), round(object.orientationW),
      round(object.velocityX), round(object.velocityY), round(object.velocityZ), isMoving ? 1 : 0, round(object.worth));
    // It lies still, and it was only yours while it moved: from here it is the host's again.
    if (!isMoving && !object.isHeld) object.ownerId = together.hostId;
    if (said.length >= LOOSE_NUMBERS * 16) { sayToOthers({ k: 'loose', o: said }); said = []; }
  }
  if (said.length > 0) sayToOthers({ k: 'loose', o: said });
}

// Where one of the others says its things are. Each is only believed about what is its to move.
function hearWhereLooseThingsAre(id, data) {
  const numbers = data.o;
  if (!Array.isArray(numbers) || numbers.length % LOOSE_NUMBERS !== 0 || numbers.length > LOOSE_NUMBERS * 16 || !numbers.every(Number.isFinite)) return;
  for (let at = 0; at < numbers.length; at += LOOSE_NUMBERS) {
    const object = findLooseObjectById(numbers[at]);
    if (!object || (object.ownerId || together.hostId) !== id || object.isHeld) continue;
    // What rides in the crate in your own beam stays where your game has it. It has been asked for
    // (claimWhatRidesInYourBeam) and is about to be yours; where its mover had it a moment ago is where your
    // crate was a moment ago, and put back there it would be under the board by now.
    if (looseState.held && object.heldLinkId === looseState.held.id && isLooseObjectRiding(object)) continue;
    const isMoving = numbers[at + 11] === 1;
    if (isMoving) wakeLooseObject(object); // (what its points do when it leaves where it lay, and what lay on it)
    const fromX = object.x, fromY = object.y, fromZ = object.z, fromTurnX = object.orientationX, fromTurnY = object.orientationY, fromTurnZ = object.orientationZ, fromTurnW = object.orientationW;
    object.x = clampNumber(numbers[at + 1], 0, GRID_WIDTH); object.y = clampNumber(numbers[at + 2], -200, 200); object.z = clampNumber(numbers[at + 3], 0, GRID_DEPTH);
    const length = Math.hypot(numbers[at + 4], numbers[at + 5], numbers[at + 6], numbers[at + 7]) || 1;
    object.orientationX = numbers[at + 4] / length; object.orientationY = numbers[at + 5] / length; object.orientationZ = numbers[at + 6] / length; object.orientationW = numbers[at + 7] / length;
    object.velocityX = isMoving ? clampNumber(numbers[at + 8], -60, 60) : 0; object.velocityY = isMoving ? clampNumber(numbers[at + 9], -60, 60) : 0; object.velocityZ = isMoving ? clampNumber(numbers[at + 10], -60, 60) : 0;
    object.spinX = 0; object.spinY = 0; object.spinZ = 0;
    object.worth = clampNumber(numbers[at + 12], 0, object.kind.value);
    updateLooseObjectMatrix(object);
    refreshLooseObjectTiles(object);
    // It is in somebody's beam: what rides in it here goes with it (until it is theirs to move as well).
    if (object.heldById) carryLooseRidersAlong(object, fromX, fromY, fromZ, fromTurnX, fromTurnY, fromTurnZ, fromTurnW);
    if (!isMoving) { object.isAsleep = true; object.ownerId = together.hostId; }
  }
}

// One of the others is no longer down here: what was theirs to move, or in their beam, is the host's.
function handBackLooseThingsOf(id) {
  for (const object of looseObjects) {
    if (object.heldById === id) object.heldById = 0;
    if (object.ownerId === id) { object.ownerId = together.hostId; if (isLobbyHost()) wakeLooseObject(object); }
  }
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
      // When the car goes up, when a scanner is restarted, when everyone is down, and what a salvage bay does and
      // takes are the host's game's to say: nobody else's browser ever asks for those, and one that does is not heard.
      const isTheHostsToSay = action && ['ascend', 'restart', 'allDown', 'bayState', 'sealBay'].indexOf(action.what) >= 0;
      if (action && !isTheHostsToSay) decideAction(id, action);
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
