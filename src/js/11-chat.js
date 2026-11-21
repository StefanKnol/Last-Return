// ---------------------------------------------------------------------------
// Talking to the others: names, and a line of text.
//
// This is for a lobby (11-together.js) and only there: at the title screen while you wait, down in the station,
// and while you are dead and watching (11-watching.js).
//
//   - A name. Yours is typed on the title screen and kept with your settings; without one you are "Player 2",
//     by your number in the lobby. Everyone says their name to the lobby when they join it, when somebody else
//     joins, and when they change it.
//   - A line of text, to everybody in the lobby. In play: Enter or T opens the box, Enter sends, Esc shuts it.
//     While the box is open the keys are the box's: you stand still. At the title screen the box is simply
//     there.
//   - The log shows what was said, and a few things that happened (somebody joined, left, fell). In play a
//     line is shown for a few seconds and then only while the box is open.
//
// Nothing here goes through the game's own order of things ('ask' and 'did'): a line of text changes nothing
// in the station. It is handed on by the server as everything else is, unread.
//
// What comes in is somebody else's browser talking: it is text and nothing else. It is cut to length, control
// characters are taken out of it, it is put on the page as text (never as markup), and somebody who says more
// than CHAT_MOST_IN_FIVE_SECONDS lines in five seconds is not heard until they slow down.
// ---------------------------------------------------------------------------

const CHAT_MOST_CHARACTERS = 200;       // a line is no longer than this
const CHAT_NAME_MOST_CHARACTERS = 16;   // ... and a name no longer than this
const CHAT_LINES_KEPT = 40;             // the log forgets what is older
const CHAT_LINES_SHOWN_OPEN = 10;       // with the box open, or at a screen that is not play: the last so many
const CHAT_LINE_SHOWN_SECONDS = 9;      // in play, with the box shut, a line is shown this long
const CHAT_MOST_IN_FIVE_SECONDS = 5;    // more lines than this in five seconds, from you or from anybody, are not passed on

const chat = {
  lines: [],          // { who, text, kind, at, element }: `kind` is 'said' (one of the others), 'own' (you) or 'note' (something that happened)
  isOpen: false,      // the box is open and has the keys
  names: {},          // by a player's number in the lobby: the name they gave, '' for none
  isKnown: {},        // by number: they have been said to be here (so that it is said once)
  hasSaidName: {},    // by number: they have said what they are called at least once (a name that changes after that is news)
  sentAt: [],         // when you said your last few lines (game.realTime)
  heardAt: {},        // by number: when they said theirs
  statistics: { sent: 0, heard: 0, dropped: 0 } // for the tests
};

// What is taken out of text that comes from outside: control characters, the two line breaks that are not a
// line feed, and the marks that turn the direction of writing round. (Written as code points, so that this
// file has none of them in it.)
const CHAT_UNSHOWABLE = new RegExp('[' + ['0000-\\u001f', '007f-\\u009f', '2028', '2029', '200e', '200f', '202a-\\u202e', '2066-\\u2069'].map(function (range) { return '\\u' + range; }).join('') + ']', 'g');

// Text from outside, made fit to show: one line, no control characters (nor the ones that turn the direction
// of writing round), no longer than `most`.
function cleanChatText(text, most) {
  if (typeof text !== 'string') return '';
  return text.replace(CHAT_UNSHOWABLE, ' ').replace(/\s+/g, ' ').trim().slice(0, most);
}

// What somebody is called: the name they gave, or "Player" and their number in the lobby.
function getPlayerName(id) {
  const given = id === together.myId ? settings.playerName : chat.names[id];
  return given ? given : 'Player ' + id;
}

function canChat() {
  return together.code !== '';
}

// Your name, to everybody in the lobby.
function sayYourName() {
  if (canChat()) sayToOthers({ k: 'name', n: settings.playerName });
}

// One of the others says what they are called. The first time, that is also how you know they are here.
function hearName(id, data) {
  const name = cleanChatText(data.n, CHAT_NAME_MOST_CHARACTERS);
  const wasKnown = chat.isKnown[id] === true, hadSaidName = chat.hasSaidName[id] === true, before = getPlayerName(id);
  chat.names[id] = name;
  chat.isKnown[id] = true; chat.hasSaidName[id] = true;
  if (!wasKnown) addChatLine('', getPlayerName(id) + ' has joined the lobby.', 'note');
  else if (hadSaidName && before !== getPlayerName(id)) addChatLine('', before + ' is now called ' + getPlayerName(id) + '.', 'note');
  refreshWatchBar(); // (11-watching.js: it may be showing their name)
  refreshVoiceControls(); // (11-voice.js: the list of who is here)
}

// Is this one more line than they may say in five seconds? (`times` is their last few; this one is added to it.)
function isChatTooFast(times) {
  const now = game.realTime;
  while (times.length > 0 && now - times[0] > 5) times.shift();
  if (times.length >= CHAT_MOST_IN_FIVE_SECONDS) return true;
  times.push(now);
  return false;
}

// One of the others says a line.
function hearChat(id, data) {
  const text = cleanChatText(data.m, CHAT_MOST_CHARACTERS);
  if (text === '' || together.memberIds.indexOf(id) < 0) return;
  if (!chat.heardAt[id]) chat.heardAt[id] = [];
  if (isChatTooFast(chat.heardAt[id])) { chat.statistics.dropped++; return; }
  chat.statistics.heard++;
  const other = findOtherPlayer(id);
  addChatLine(getPlayerName(id) + (other && other.isFallen ? ' (down)' : ''), text, 'said');
  playInterfaceBlip(880);
}

// You say a line. Returns whether it was said.
function sendChat(text) {
  const line = cleanChatText(text, CHAT_MOST_CHARACTERS);
  if (line === '' || !canChat()) return false;
  if (isChatTooFast(chat.sentAt)) { addChatLine('', 'Not so fast: that one was not sent.', 'note'); return false; }
  chat.statistics.sent++;
  sayToOthers({ k: 'chat', m: line });
  addChatLine(getPlayerName(together.myId) + (game.mode === 'dead' || game.mode === 'dying' ? ' (down)' : ''), line, 'own');
  return true;
}

// Puts a line in the log. `who` is '' for something that happened and was not said by anybody.
function addChatLine(who, text, kind) {
  const log = interfaceState.elements['chat-log'];
  if (!log) return;
  const element = document.createElement('div');
  element.className = 'chat-line chat-line-' + kind;
  if (who !== '') {
    const name = document.createElement('b');
    name.textContent = who + ': ';
    element.appendChild(name);
  }
  element.appendChild(document.createTextNode(text)); // as text: whatever it says, it is not markup
  log.appendChild(element);
  chat.lines.push({ who: who, text: text, kind: kind, at: game.realTime, element: element });
  while (chat.lines.length > CHAT_LINES_KEPT) chat.lines.shift().element.remove();
  refreshChat();
}

function clearChat() {
  for (const line of chat.lines) line.element.remove();
  chat.lines.length = 0;
  chat.names = {}; chat.isKnown = {}; chat.hasSaidName = {}; chat.sentAt.length = 0; chat.heardAt = {};
  closeChat();
  refreshChat();
}

// In play the box takes the keys away from the game: is this a screen where it has to be opened first?
function isChatBoxOpenedByKey() {
  return game.mode !== 'title';
}

// The box is opened: the keys are its own from here. (You stop walking and scanning.)
function openChat() {
  if (!canChat() || chat.isOpen) return;
  chat.isOpen = true;
  input.keysDown.clear();
  input.isScanHeld = false; input.isGrabHeld = false; input.isLookDragging = false;
  refreshChat();
  interfaceState.elements['chat-input'].focus({ preventScroll: true });
}

function closeChat() {
  if (!chat.isOpen) return;
  chat.isOpen = false;
  const box = interfaceState.elements['chat-input'];
  if (document.activeElement === box) box.blur();
  refreshChat();
  if (game.mode === 'playing') focusGameView();
}

// What of it is on the screen: none of it outside a lobby; in play the box only while it is open, and the
// older lines only then too.
function refreshChat() {
  const elements = interfaceState.elements, root = elements['chat'];
  if (!root) return;
  root.hidden = !canChat();
  if (!canChat()) return;
  // At the title screen it is part of the lobby's own block there, and not laid over the screen as it is in play.
  const home = game.mode === 'title' ? elements['together-options'] : getElement('game-root');
  if (home && root.parentNode !== home) home.appendChild(root);
  root.classList.toggle('is-on-title', game.mode === 'title');
  const isByKey = isChatBoxOpenedByKey();
  if (!isByKey && chat.isOpen && document.activeElement !== elements['chat-input']) chat.isOpen = false; // (at the title screen "open" is only: it has the keys)
  elements['chat-form'].hidden = isByKey && !chat.isOpen;
  elements['chat-open'].hidden = !isByKey || chat.isOpen;
  root.classList.toggle('is-open', chat.isOpen || !isByKey);
  root.classList.toggle('is-in-play', game.mode === 'playing');
  // Which lines show: the last few while it is open (or there is no play to be in the way of), and otherwise
  // the ones just said.
  const now = game.realTime, showsAll = chat.isOpen || game.mode !== 'playing';
  for (let index = 0; index < chat.lines.length; index++) {
    const line = chat.lines[index], isAmongTheLast = index >= chat.lines.length - CHAT_LINES_SHOWN_OPEN;
    line.element.hidden = !(isAmongTheLast && (showsAll || now - line.at < CHAT_LINE_SHOWN_SECONDS));
  }
}

// Every frame (11-game.js): lines grow old.
let chatRefreshTimer = 0, chatModeBefore = '';
function updateChat(realDt) {
  chatRefreshTimer -= realDt;
  if (chatRefreshTimer > 0 && game.mode === chatModeBefore) return;
  chatRefreshTimer = 0.5; chatModeBefore = game.mode;
  // (Somewhere the box has no business being open: the intro, the lift going up.)
  if (chat.isOpen && (game.mode === 'intro' || game.mode === 'ascending')) closeChat();
  refreshChat();
}

// A key went down that was not typed into a box (09-player.js asks, before it does anything else with it).
// Returns whether it was the chat's.
function takeKeyForChat(event) {
  if (!canChat() || chat.isOpen || !isChatBoxOpenedByKey()) return false;
  if (event.code !== 'Enter' && event.code !== 'KeyT') return false;
  if (game.mode !== 'playing' && game.mode !== 'dead' && game.mode !== 'paused') return false;
  event.preventDefault(); // (or the T would be typed into the box it opens)
  openChat();
  return true;
}

function initializeChat() {
  const elements = interfaceState.elements;
  for (const elementId of ['chat', 'chat-log', 'chat-form', 'chat-input', 'chat-open', 'together-name']) elements[elementId] = getElement(elementId);
  const box = elements['chat-input'], nameBox = elements['together-name'];
  box.maxLength = CHAT_MOST_CHARACTERS;
  elements['chat-form'].addEventListener('submit', function (event) {
    event.preventDefault();
    if (sendChat(box.value) || cleanChatText(box.value, CHAT_MOST_CHARACTERS) === '') box.value = '';
    if (isChatBoxOpenedByKey()) closeChat();
  });
  box.addEventListener('keydown', function (event) {
    if (event.code === 'Escape') { event.preventDefault(); event.stopPropagation(); if (isChatBoxOpenedByKey()) closeChat(); else box.blur(); }
  });
  box.addEventListener('focus', function () { if (!chat.isOpen) { chat.isOpen = true; input.keysDown.clear(); refreshChat(); } });
  // Anything that takes the keys away from the box shuts it: a click in the station, the menu. What was typed stays in it.
  box.addEventListener('blur', function () { if (chat.isOpen) { chat.isOpen = false; refreshChat(); } });
  elements['chat-open'].addEventListener('click', function () { openChat(); });

  nameBox.maxLength = CHAT_NAME_MOST_CHARACTERS;
  nameBox.value = settings.playerName;
  nameBox.addEventListener('change', function () {
    const before = getPlayerName(together.myId);
    settings.playerName = cleanChatText(nameBox.value, CHAT_NAME_MOST_CHARACTERS);
    nameBox.value = settings.playerName;
    saveSettings();
    sayYourName();
    if (canChat() && before !== getPlayerName(together.myId)) addChatLine('', 'You are now called ' + getPlayerName(together.myId) + '.', 'note');
  });
  nameBox.addEventListener('keydown', function (event) { if (event.code === 'Enter') nameBox.blur(); });
  refreshChat();
}
