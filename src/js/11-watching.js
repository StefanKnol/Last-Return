// ---------------------------------------------------------------------------
// Watching the others: what you do while you are dead, down there with others.
//
// Dead, down there with others, you are not out of it: your scanner lies where you fell, and one of them can
// carry it into the lift car, where it restarts (11-together.js). Until then you watch. You see the station
// from where one of them stands, looking where they look: through their scanner, as it were. What their
// scanner lights up was lit in your game all along (every game shows the others' scanning for itself), so
// there is nothing more to be sent for this: only where they are and where they look, which they say anyway.
//
//   - The death screen comes first, as it always did, with what killed you. It offers "Watch the others", and
//     goes over to that by itself after WATCH_BEGINS_AFTER_SECONDS.
//   - You hear the station from where they stand: what is near them, the interference, the heartbeat.
//   - With more than one of them on their feet: A and D, the arrow keys, a click, or the two buttons, go
//     from one to the next. When the one you watch falls, you are moved to another.
//   - You can talk to them (11-chat.js).
//   - It ends when your scanner is restarted (you are on your feet in the car), when everyone is down or the
//     car has gone up without you (the death screen again, saying so), or when you leave.
//
// It is the game mode 'dead' still: everything that asks "are they dead" gets the answer it always got.
// Whether you are watching is `watching.isOn`.
// ---------------------------------------------------------------------------

const WATCH_BEGINS_AFTER_SECONDS = 4;  // how long the death screen stands before watching begins by itself
const WATCH_CAMERA_FOLLOW_RATE = 24;   // how fast your view closes on theirs: higher follows closer, lower is smoother

const watching = {
  isOn: false,
  id: 0,             // which of the others, by their number in the lobby (0: nobody is on their feet just now)
  offeredAt: -1,     // game.realTime at which the death screen offered it, or -1
  hasView: false,    // the view below has been set at least once since watching began or moved to somebody else
  x: 0, y: 0, z: 0, yaw: 0, pitch: 0, // your view: theirs, smoothed
  barText: ''
};

// The others who are on their feet: the ones there are to watch.
function listPlayersToWatch() {
  return together.others.filter(function (other) { return other.hasBeenHeardFrom && !other.isFallen; });
}

// Is there anything to watch, and any sense in it? (Not once the descent is over for you.)
function canWatchSomebody() {
  return isWorldShared() && game.mode === 'dead' && !game.isDescentLost && !game.isLeftBehind && listPlayersToWatch().length > 0;
}

// The one you are watching, or null.
function getWatchedPlayer() {
  if (!watching.isOn || watching.id === 0) return null;
  return findOtherPlayer(watching.id);
}

// Whose place you see and hear the station from: your own, or the one's you are watching. (It has x, z and
// yaw, which is all that is asked of it: 10-interface.js measures a caption's distance and direction from it.)
function getViewer() {
  return getWatchedPlayer() || player;
}

function beginWatching() {
  if (watching.isOn || !canWatchSomebody()) return;
  watching.isOn = true;
  watching.offeredAt = -1;
  watching.hasView = false;
  const candidates = listPlayersToWatch();
  if (!candidates.some(function (other) { return other.id === watching.id; })) watching.id = candidates[0].id;
  game.fade = 0; // their view comes up out of the dark
  showOnlyScreen(null);
  setHudVisible(true);
  interfaceState.elements['touch-controls'].hidden = true; // (the sticks and buttons of a touch screen are for somebody on their feet)
  interfaceState.elements['hud'].classList.add('is-watching');
  interfaceState.elements['watch-bar'].hidden = false;
  watching.barText = '';
  refreshWatchBar();
}

// Watching is over, for whatever reason. What comes next (the death screen, your own feet, the title screen)
// is the caller's to show, and the sounds of where they stood are the caller's to stop.
function endWatching() {
  watching.offeredAt = -1;
  if (!watching.isOn) return;
  watching.isOn = false;
  watching.id = 0;
  interfaceState.elements['hud'].classList.remove('is-watching');
  interfaceState.elements['watch-bar'].hidden = true;
}

// To the next of them (`step` 1) or the one before (-1).
function watchNext(step) {
  if (!watching.isOn) return;
  const candidates = listPlayersToWatch();
  if (candidates.length === 0) { watching.id = 0; refreshWatchBar(); return; }
  let index = -1;
  for (let position = 0; position < candidates.length; position++) if (candidates[position].id === watching.id) index = position;
  const next = candidates[((index < 0 ? 0 : index + step) % candidates.length + candidates.length) % candidates.length];
  if (next.id !== watching.id) { watching.id = next.id; watching.hasView = false; playInterfaceBlip(660); }
  refreshWatchBar();
}

// The bar across the top: who you are watching, and how you get back.
function refreshWatchBar() {
  const elements = interfaceState.elements;
  if (!watching.isOn || !elements['watch-bar']) return;
  const watched = getWatchedPlayer(), others = listPlayersToWatch().length;
  const text = (watched ? getPlayerName(watched.id) : '') + '|' + others;
  if (text === watching.barText) return;
  watching.barText = text;
  elements['watch-name'].textContent = watched ? getPlayerName(watched.id) : 'nobody';
  elements['watch-note'].textContent = watched
    ? 'Your scanner lies where you fell, still lit. If one of them carries it into the lift car, it restarts.' + (others > 1 ? ' A and D, or a click: the next of them.' : '')
    : 'Nobody is on their feet.';
  elements['button-watch-previous'].hidden = others < 2;
  elements['button-watch-next'].hidden = others < 2;
  elements['button-watch-leave'].textContent = isLobbyHost() ? 'End the descent for everyone' : 'Leave the descent';
}

// Every frame, whatever the game is doing (11-game.js): begins it when its time has come, ends it when it has
// no business going on, keeps it on somebody who is on their feet, and makes the station sound as it does
// where they stand.
function updateWatching(dt) {
  if (watching.isOn && (game.mode !== 'dead' || !isWorldShared())) endWatching();
  if (!watching.isOn) {
    if (game.mode !== 'dead' || !isWorldShared()) { watching.offeredAt = -1; return; }
    // The death screen is up. Somebody to watch may have turned up since it was shown (they were only just
    // heard from): it is shown again, with the offer.
    if (watching.offeredAt < 0 && canWatchSomebody() && game.deathSequence) showDeathScreen(game.deathSequence.kind);
    if (watching.offeredAt >= 0) {
      const left = WATCH_BEGINS_AFTER_SECONDS - (game.realTime - watching.offeredAt);
      interfaceState.elements['button-watch'].textContent = 'Watch the others' + (left > 0 ? ' (' + Math.ceil(left) + ')' : '');
      if (left <= 0) beginWatching();
    }
    return;
  }
  let watched = getWatchedPlayer();
  if (!watched || watched.isFallen || !watched.hasBeenHeardFrom) { watchNext(1); watched = getWatchedPlayer(); } // (to somebody on their feet, or to nobody)
  refreshWatchBar();
  if (!watched) { silenceGameplaySounds(); game.interference = approachValue(game.interference, 0, dt); game.danger = approachValue(game.danger, 0, dt); return; }
  // The station as it sounds and weighs where they stand (11-game.js). Their scanner hums when it fires.
  updateAtmosphereAt(watched.x, watched.eyeY, watched.z, watched.yaw, SPACE_STATION, dt, false);
  setScannerSound(watched.spreadDegrees > 0 ? 1 : 0);
}

// Your view, this frame: theirs, closed in on rather than jumped to, so that the steps in which they say
// where they look do not show. (11-game.js calls this with the camera it is about to draw with.)
function aimCameraAtWatched(camera, dt) {
  const watched = getWatchedPlayer();
  if (watched) {
    const share = watching.hasView ? 1 - Math.exp(-dt * WATCH_CAMERA_FOLLOW_RATE) : 1;
    watching.x += (watched.x - watching.x) * share;
    watching.y += (watched.eyeY - watching.y) * share;
    watching.z += (watched.z - watching.z) * share;
    watching.yaw += wrapAngleToPi(watched.yaw - watching.yaw) * share;
    watching.pitch += (watched.pitch - watching.pitch) * share;
    watching.hasView = true;
  }
  if (!watching.hasView) return; // (nobody to watch yet: your own view, in the dark)
  camera.x = watching.x; camera.y = watching.y; camera.z = watching.z;
  camera.yaw = watching.yaw; camera.pitch = watching.pitch;
}

// A key went down while you are dead (09-player.js). Returns whether it was for this.
function takeKeyForWatching(code) {
  if (!watching.isOn) return false;
  if (code === 'KeyA' || code === 'ArrowLeft') watchNext(-1);
  else if (code === 'KeyD' || code === 'ArrowRight' || code === 'Space') watchNext(1);
  else return false;
  return true;
}

function initializeWatching() {
  const elements = interfaceState.elements;
  for (const elementId of ['watch-bar', 'watch-name', 'watch-note', 'button-watch', 'button-watch-previous', 'button-watch-next', 'button-watch-leave']) elements[elementId] = getElement(elementId);
  elements['button-watch'].addEventListener('click', function () { beginWatching(); });
  elements['button-watch-previous'].addEventListener('click', function () { watchNext(-1); });
  elements['button-watch-next'].addEventListener('click', function () { watchNext(1); });
  elements['button-watch-leave'].addEventListener('click', function () { returnToTitle(); });
}
