// Checks descending together: the server that serves the game and keeps the lobbies (server/server.js), and
// two browsers that go down into the same station through it and see each other.
const path = require('path');
const http = require('http');
const { WebSocket } = require('ws');
const { startServer } = require('../server/server.js');
const { openGame, startGame, countMouseMoves } = require('./browser-harness.js');
const { TEST_OBJECT_KINDS, installTestObjectKinds, removeTestObjectKinds } = require('./test-objects.js');

// The station the lobby goes down into. Any seed will do: the checks find in it what they need (a door, a stretch
// of floor) and put down their own things. The host types it into the title screen, so tools/browser-harness.js
// cannot add to it for `--other-stations`; that is done here, from the number run-tests.js passes on.
const lobbySeed = 4471 + Math.max(0, Math.floor(Number(process.env.TEST_OTHER_STATIONS || 0)));

// The loose things this suite puts down are the tests' own, from tools/test-objects.js: an open crate, a block of
// three kilograms that does not roll, two small light blocks, and a block exactly as heavy as the game says stops you.
const TEST_KINDS_OF_THIS_SUITE = ['testCrate', 'testWeight', 'testSmallBlock', 'testHeavyBlock'];
const installTogetherTestObjectKinds = (page) => installTestObjectKinds(page, TEST_KINDS_OF_THIS_SUITE);

const failures = [];
function check(description, condition, detail) {
  const line = (condition ? 'ok    ' : 'FAIL  ') + description + (detail !== undefined ? '  ' + JSON.stringify(detail) : '');
  console.log(line);
  if (!condition) failures.push(description);
}

const pagePath = path.join(__dirname, '..', 'index.html');

function listen(options) {
  return new Promise(function (resolve) {
    const server = startServer(Object.assign({ port: 0, pagePath: pagePath }, options));
    server.on('listening', function () { resolve({ server: server, host: '127.0.0.1:' + server.address().port }); });
  });
}

function fetchText(host, address) {
  return new Promise(function (resolve, reject) {
    http.get('http://' + host + address, function (response) {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', function (chunk) { body += chunk; });
      response.on('end', function () { resolve({ status: response.statusCode, body: body }); });
    }).on('error', reject);
  });
}

// A lobby member that is not a browser: it keeps what it hears, and `next()` waits for the next thing.
// `forwardedFor`: what a proxy in front of the server would say the browser's address is.
function connect(host, origin, forwardedFor) {
  return new Promise(function (resolve) {
    const socket = new WebSocket('ws://' + host + '/relay', { origin: origin || 'http://' + host, headers: forwardedFor ? { 'X-Forwarded-For': forwardedFor } : {} });
    const member = { socket: socket, heard: [], voices: [], waiting: [], isClosed: false, wasRefusedAtTheDoor: false };
    member.say = function (message) { socket.send(JSON.stringify(message)); };
    member.next = function () {
      if (member.heard.length > 0) return Promise.resolve(member.heard.shift());
      if (member.isClosed) return Promise.resolve({ t: 'gone' });
      return new Promise(function (hand) { member.waiting.push(hand); });
    };
    const give = function (message) { if (member.waiting.length > 0) member.waiting.shift()(message); else member.heard.push(message); };
    socket.on('message', function (data, isBinary) { if (isBinary) member.voices.push(Buffer.from(data)); else give(JSON.parse(data.toString())); }); // (what is not text is a piece of voice)
    socket.on('close', function () { member.isClosed = true; for (const hand of member.waiting.splice(0)) hand({ t: 'gone' }); });
    socket.on('open', function () { resolve(member); });
    socket.on('error', function () { member.wasRefusedAtTheDoor = true; member.isClosed = true; resolve(member); });
  });
}

const WINDOW_WIDTH = 640, WINDOW_HEIGHT = 360; // the browsers of this suite: see where the first two are opened
const pause = function (milliseconds) { return new Promise(function (resolve) { setTimeout(resolve, milliseconds); }); };

(async () => {
  // ---- The server by itself ----
  const named = await listen({ serverName: 'Test server' });
  const page = await fetchText(named.host, '/');
  check('the server serves the game, with where its lobbies are and what it calls itself written into the page',
    page.status === 200 && page.body.includes('<meta name="last-return-relay" content="/relay">') && page.body.includes('<meta name="last-return-server" content="Test server">'), page.status);
  check('it says it is well, and has nothing else to give', (await fetchText(named.host, '/healthz')).body === 'ok' && (await fetchText(named.host, '/build/bundle.js')).status === 404);
  const stranger = await connect(named.host, 'http://somewhere-else.example');
  check('a page from somewhere else cannot open a lobby here', stranger.wasRefusedAtTheDoor);

  const quiet = await listen({ lobbies: false });
  const quietPage = await fetchText(quiet.host, '/');
  const noLobby = await connect(quiet.host);
  check('with lobbies off, the page is told of none and there are none', quietPage.body.includes('<meta name="last-return-relay" content="">') && noLobby.wasRefusedAtTheDoor);
  quiet.server.close();

  // ---- The lobby rules, with members that are not browsers ----
  const host = await connect(named.host);
  host.say({ t: 'host', build: 'one' });
  const lobby = await host.next();
  check('opening a lobby gives a code of five letters and digits (none that read as each other), and you are its host',
    /^[A-HJ-NP-Z2-9]{5}$/.test(lobby.code) && lobby.you === 1 && lobby.host === 1 && lobby.players.length === 1 && lobby.locked === false, lobby);

  const lost = await connect(named.host);
  const askedAt = Date.now();
  lost.say({ t: 'join', code: 'QQQQQ' === lobby.code ? 'ZZZZZ' : 'QQQQQ', build: 'one' });
  lost.say({ t: 'join', code: lobby.code, build: 'one' }); // a second try on the same connection: not listened to
  const otherBuild = await connect(named.host);
  otherBuild.say({ t: 'join', code: lobby.code, build: 'two' });
  const lostHeard = await lost.next(), lostWaited = Date.now() - askedAt;
  check('a code that is no lobby is refused, and so is another build of the game', lostHeard.why === 'unknown' && (await otherBuild.next()).why === 'build');
  await pause(150);
  check('a refusal comes a second late and the server then hangs up, so a guess costs a connection and a second: the second try on that connection got nowhere',
    lostWaited >= 900 && lost.isClosed && otherBuild.isClosed && (await lost.next()).t === 'gone' && named.server.lobbies.get(lobby.code).members.size === 1, [lostWaited, lost.isClosed, otherBuild.isClosed]);

  const guests = [];
  for (let count = 0; count < 3; count++) {
    const guest = await connect(named.host);
    guest.say({ t: 'join', code: lobby.code.toLowerCase(), build: 'one' });
    guests.push({ member: guest, lobby: await guest.next() });
  }
  const joined = [await host.next(), await host.next(), await host.next()];
  check('three more can join, and the host hears of each', guests[2].lobby.players.length === 4 && guests[2].lobby.you === 4 && joined.every((message) => message.t === 'joined'), guests[2].lobby);
  const fifth = await connect(named.host);
  fifth.say({ t: 'join', code: lobby.code, build: 'one' });
  check('a fifth is told the lobby is full', (await fifth.next()).why === 'full');

  guests[0].member.say({ t: 'say', d: { k: 'hello' } });
  const said = await host.next();
  check('what one says, the others hear, with who said it', said.t === 'said' && said.from === 2 && said.d.k === 'hello', said);
  guests[1].member.say({ t: 'start', d: {} });
  host.say({ t: 'start', d: { kind: 'classic' } });
  await guests[0].member.next(); await guests[0].member.next(); // the two who joined after it
  const started = await guests[0].member.next();
  check('only the host can begin the descent', started.t === 'start' && started.d.kind === 'classic', started);

  guests[2].member.socket.close();
  let left = await host.next();
  while (left.t !== 'left') left = await host.next();
  check('the others hear of one who leaves', left.id === 4, left);
  const latecomer = await connect(named.host); // (the fifth was hung up on when it was refused)
  latecomer.say({ t: 'join', code: lobby.code, build: 'one' });
  const late = await latecomer.next();
  check('a lobby that has gone down can still be joined, by whoever will wait for the next descent', late.t === 'lobby' && late.players.length === 4, late);
  host.say({ t: 'start', d: { kind: 'classic', round: 2 } });
  let again = await latecomer.next();
  while (again.t !== 'start' && again.t !== 'gone') again = await latecomer.next();
  check('and the host can begin again, as often as the lobby likes', again.t === 'start' && again.d.round === 2, again);
  host.socket.close();
  let closed = await guests[1].member.next();
  while (closed.t !== 'closed' && closed.t !== 'gone') closed = await guests[1].member.next();
  await pause(100);
  check('when the host leaves, the lobby is over for everyone', closed.t === 'closed' && named.server.lobbies.size === 0, [closed, named.server.lobbies.size]);

  const noisy = await connect(named.host);
  for (let count = 0; count < 200; count++) noisy.say({ t: 'say', d: {} });
  await pause(300);
  check('a member that says far too much is shown the door', noisy.isClosed);
  for (const member of [lost, otherBuild, fifth, latecomer, guests[0].member, guests[1].member]) member.socket.close();

  // ---- Voices: what is not text is handed to the others with who said it in front, and nothing else is done with it ----
  const speaker = await connect(named.host);
  speaker.say({ t: 'host', build: 'one' });
  const voiceLobby = await speaker.next();
  const listeners = [];
  for (let count = 0; count < 2; count++) { const listener = await connect(named.host); listener.say({ t: 'join', code: voiceLobby.code, build: 'one' }); await listener.next(); listeners.push(listener); }
  const pieceOfVoice = Buffer.alloc(328, 7); pieceOfVoice[0] = 1;
  listeners[0].socket.send(pieceOfVoice);
  await pause(200);
  const carried = { toTheHost: speaker.voices.length, toTheOther: listeners[1].voices.length, backToThemselves: listeners[0].voices.length,
    from: speaker.voices[0] ? speaker.voices[0].readUInt16LE(0) : -1, same: speaker.voices[0] ? speaker.voices[0].subarray(2).equals(pieceOfVoice) : false };
  check('the lobby says it carries voices; a piece of voice goes to the others in the lobby, unchanged, with the number of who said it in front, and not back to them',
    voiceLobby.voice === true && carried.toTheHost === 1 && carried.toTheOther === 1 && carried.backToThemselves === 0 && carried.from === 2 && carried.same, [voiceLobby.voice, carried]);
  listeners[0].socket.send(Buffer.alloc(601, 1)); // too long
  const outsider = await connect(named.host);
  outsider.socket.send(pieceOfVoice); // from somebody in no lobby
  await pause(1100); // (a new second: the count of pieces starts again)
  const before = speaker.voices.length;
  for (let count = 0; count < 100; count++) listeners[0].socket.send(pieceOfVoice);
  await pause(300);
  const flooded = { tooLongOrFromOutside: before - 1, ofAHundred: speaker.voices.length - before, isShownTheDoor: listeners[0].isClosed, outsiderIsShownTheDoor: outsider.isClosed };
  listeners[0].say({ t: 'say', d: { k: 'still here' } });
  let afterTheFlood = await speaker.next();
  while (afterTheFlood.t !== 'said' && afterTheFlood.t !== 'gone') afterTheFlood = await speaker.next();
  check('a piece that is too long, or from somebody in no lobby, goes nowhere; of a hundred in one second forty are handed on, and nobody is shown the door for it',
    flooded.tooLongOrFromOutside === 0 && flooded.ofAHundred === 40 && !flooded.isShownTheDoor && !flooded.outsiderIsShownTheDoor && afterTheFlood.t === 'said', flooded);
  for (const member of [speaker, outsider].concat(listeners)) member.socket.close();
  const mute = await listen({ voice: false });
  const quietHost = await connect(mute.host);
  quietHost.say({ t: 'host', build: 'one' });
  const quietLobby = await quietHost.next();
  const quietGuest = await connect(mute.host);
  quietGuest.say({ t: 'join', code: quietLobby.code, build: 'one' });
  await quietGuest.next();
  quietGuest.socket.send(pieceOfVoice);
  await pause(200);
  check('a server told not to carry voices says so and hands none on; the lobby works as it did', quietLobby.voice === false && quietHost.voices.length === 0 && !quietGuest.isClosed && (await quietHost.next()).t === 'joined', [quietLobby.voice, quietHost.voices.length]);
  quietHost.socket.close(); quietGuest.socket.close(); mute.server.close();

  // ---- Locking a lobby: with everyone in, nobody else gets in, whatever code they try ----
  const keeper = await connect(named.host);
  keeper.say({ t: 'host', build: 'one' });
  const kept = await keeper.next();
  const friend = await connect(named.host);
  friend.say({ t: 'join', code: kept.code, build: 'one' });
  await friend.next(); await keeper.next(); // the lobby, and the host hearing of them
  friend.say({ t: 'lock', on: true }); // not the host's: nothing comes of it
  await pause(150);
  const lockedByAGuest = named.server.lobbies.get(kept.code).isLocked;
  keeper.say({ t: 'lock', on: true });
  const toldLocked = [await keeper.next(), await friend.next()];
  const shutOut = await connect(named.host);
  shutOut.say({ t: 'join', code: kept.code, build: 'one' });
  const shutOutHeard = await shutOut.next();
  keeper.say({ t: 'lock', on: false });
  const toldOpen = [await keeper.next(), await friend.next()];
  const letIn = await connect(named.host);
  letIn.say({ t: 'join', code: kept.code, build: 'one' });
  const letInHeard = await letIn.next();
  check('only the host can lock a lobby, and everyone in it is told; locked, the right code is refused; opened again, it lets somebody in',
    lockedByAGuest === false && toldLocked.every((message) => message.t === 'locked' && message.on === true) && shutOutHeard.t === 'refused' && shutOutHeard.why === 'locked' &&
    toldOpen.every((message) => message.t === 'locked' && message.on === false) && letInHeard.t === 'lobby' && letInHeard.players.length === 3 && letInHeard.locked === false,
    [lockedByAGuest, toldLocked, shutOutHeard, toldOpen, letInHeard]);
  for (const member of [keeper, friend, shutOut, letIn]) member.socket.close();

  // ---- Guessing at codes: an address that keeps being refused is refused unheard for a minute ----
  // (A server of its own, told that one proxy stands in front of it: the address is the one that proxy wrote.)
  const guarded = await listen({ proxies: 1 });
  const target = await connect(guarded.host, undefined, '203.0.113.5');
  target.say({ t: 'host', build: 'one' });
  const targetLobby = await target.next();
  const guessers = [];
  for (let count = 0; count < 12; count++) {
    // (What the caller puts in front of the proxy's entry is the caller's to make up, and is not gone by.)
    const guesser = await connect(guarded.host, undefined, '198.51.100.' + count + ', 203.0.113.9');
    guesser.say({ t: 'join', code: targetLobby.code === 'AAAAA' ? 'BBBBB' : 'AAAAA', build: 'one' });
    guessers.push(guesser);
  }
  await pause(100);
  const thirteenth = await connect(guarded.host, undefined, '203.0.113.9');
  thirteenth.say({ t: 'join', code: targetLobby.code, build: 'one' }); // the right code, this time: too late
  const fromElsewhere = await connect(guarded.host, undefined, '203.0.113.77');
  fromElsewhere.say({ t: 'join', code: targetLobby.code, build: 'one' });
  const guessed = { thirteenth: await thirteenth.next(), elsewhere: await fromElsewhere.next(), refusals: (await Promise.all(guessers.map((guesser) => guesser.next()))).map((message) => message.why).join() };
  check('twelve wrong codes from one address in a minute, and the thirteenth try is refused even with the right code; somebody at another address joins as ever',
    guessed.thirteenth.t === 'refused' && guessed.thirteenth.why === 'slow' && guessed.elsewhere.t === 'lobby' && guessed.refusals === new Array(12).fill('unknown').join(), guessed);
  for (const member of guessers.concat([target, thirteenth, fromElsewhere])) member.socket.close();
  guarded.server.close();

  // ---- Two browsers ----
  const address = 'http://' + named.host + '/';
  // (In small windows. Nothing in this suite looks at what is drawn: a page is only asked for a picture to make
  // it draw a frame, which is what runs its game. The browsers here draw in software, two and three of them at
  // once, and how long a frame takes goes by how many dots of screen it has. At the usual 1280 by 720, with three
  // browsers open, a frame of a page that is playing was measured at four to nineteen seconds; on the slower of
  // GitHub's machines a single picture then took longer than the thirty seconds it is given.)
  // (Those seconds were measured in Playwright's "headless shell", and most of them were not drawing: see "Which
  // browser the suites run in" in browser-harness.js. The windows have stayed small all the same. A frame still
  // costs what its dots cost, and there is still nothing here that looks at one.)
  const first = await openGame({ address: address, width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
  const second = await openGame({ address: address, width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
  const a = first.page, b = second.page;

  check('the title screen offers a lobby when the page comes from the server', await a.isVisible('#button-host-lobby'));
  check('outside a lobby there is nothing to talk in, and a place to type your name', await a.isHidden('#chat') && await a.isVisible('#together-name'));
  await a.evaluate((lobbySeed) => { const d = window.lastReturnDebug; d.settings.station = 'generated'; d.settings.seedText = String(lobbySeed); d.settings.stationSize = 'small'; d.settings.difficulty = 'standard'; d.settings.workOrders = { salvage: true, survey: false, recovery: false, restart: false }; }, lobbySeed);
  await a.click('#button-host-lobby');
  await a.waitForFunction(() => window.lastReturnDebug.together.code !== '');
  const code = await a.textContent('#together-lobby-code');
  await b.fill('#together-code', code.toLowerCase());
  await b.click('#button-join-lobby');
  await a.waitForFunction(() => window.lastReturnDebug.together.memberIds.length === 2);
  await b.waitForFunction(() => window.lastReturnDebug.together.memberIds.length === 2);
  check('one opens a lobby, the other joins it with the code, and both see two in it',
    (await a.textContent('#together-status')).startsWith('2 of 4') && (await b.textContent('#together-status')).startsWith('2 of 4'), code);
  check('the host can begin; the other waits', (await a.textContent('#button-begin')) === 'Begin descent together' && await b.isDisabled('#button-begin'));

  // ---- Names, and talking (src/js/11-chat.js) ----
  const linesIn = (page) => page.evaluate(() => window.lastReturnDebug.chat.lines.map((line) => ({ who: line.who, text: line.text, kind: line.kind, shown: !line.element.hidden })));
  const namesIn = (page) => page.evaluate(() => [1, 2].map((id) => window.lastReturnDebug.getPlayerName(id)));
  const namesAtFirst = [await namesIn(a), await namesIn(b)];
  check('without a name you are "Player" and your number in the lobby, in everybody\'s game', namesAtFirst.every((names) => names.join() === 'Player 1,Player 2'), namesAtFirst);
  // The host types a name: too long, and with spaces round it.
  // (Put into the box as a page could, past the box's own limit on typing: it is the game that cuts it.)
  await a.evaluate(() => { const box = document.getElementById('together-name'); box.value = '   Mara of the Third Shift   '; box.dispatchEvent(new Event('change')); });
  await b.waitForFunction(() => window.lastReturnDebug.getPlayerName(1) !== 'Player 1', null, { timeout: 5000 }).catch(() => {});
  const named1 = { host: await a.evaluate(() => ({ name: window.lastReturnDebug.getPlayerName(1), box: document.getElementById('together-name').value, kept: JSON.parse(window.localStorage.getItem('last-return-settings') || '{}').playerName })), other: (await namesIn(b))[0],
    most: await a.evaluate(() => window.lastReturnDebug.chat !== undefined && document.getElementById('together-name').maxLength) };
  check('a name typed on the title screen is cut to length, kept with your settings, and is what the others call you',
    named1.host.name === 'Mara of the Thir' && named1.host.box === named1.host.name && named1.host.kept === named1.host.name && named1.other === named1.host.name && named1.most === 16, named1);
  await a.fill('#together-name', 'Mara'); await a.press('#together-name', 'Enter');
  await b.waitForFunction(() => window.lastReturnDebug.getPlayerName(1) === 'Mara', null, { timeout: 5000 }).catch(() => {});
  // They talk, at the title screen: the box is simply there.
  const boxAtTheTitle = await b.evaluate(() => ({ chat: !document.getElementById('chat').hidden, box: !document.getElementById('chat-form').hidden, inTheLobbyBlock: document.getElementById('chat').parentNode.id }));
  await b.fill('#chat-input', 'ready when you are'); await b.press('#chat-input', 'Enter');
  await a.waitForFunction(() => window.lastReturnDebug.chat.lines.some((line) => line.kind === 'said'), null, { timeout: 5000 }).catch(() => {});
  await a.fill('#chat-input', '<img src=x onerror=alert(1)> going <b>down</b>'); await a.press('#chat-input', 'Enter');
  await b.waitForFunction(() => window.lastReturnDebug.chat.lines.some((line) => line.kind === 'said'), null, { timeout: 5000 }).catch(() => {});
  const talk = { host: await linesIn(a), other: await linesIn(b), boxAtTheTitle: boxAtTheTitle,
    markup: await b.evaluate(() => { const said = window.lastReturnDebug.chat.lines.filter((line) => line.kind === 'said')[0]; return said ? { elements: said.element.querySelectorAll('*').length, images: document.querySelectorAll('#chat img').length, text: said.element.textContent } : null; }) };
  const saidTo = (lines, who, text, kind) => lines.some((line) => line.who === who && line.text === text && line.kind === kind && line.shown);
  check('in a lobby the title screen has a box to talk in, in the lobby\'s own block; a line typed there is in everybody\'s log under the name of who said it',
    talk.boxAtTheTitle.chat && talk.boxAtTheTitle.box && talk.boxAtTheTitle.inTheLobbyBlock === 'together-options' &&
    saidTo(talk.host, 'Player 2', 'ready when you are', 'said') && saidTo(talk.other, 'Player 2', 'ready when you are', 'own') && saidTo(talk.other, 'Mara', '<img src=x onerror=alert(1)> going <b>down</b>', 'said'), talk);
  check('what is said is put on the page as text: markup in it is shown as it was typed, and makes nothing',
    talk.markup !== null && talk.markup.elements === 1 && talk.markup.images === 0 && /<img src=x onerror=alert\(1\)> going <b>down<\/b>/.test(talk.markup.text), talk.markup);
  check('the log also says who has joined, once, and when somebody takes another name',
    talk.host.filter((line) => line.kind === 'note' && /Player 2 has joined the lobby/.test(line.text)).length === 1 && !talk.other.some((line) => /has joined/.test(line.text)) &&
    talk.other.some((line) => line.kind === 'note' && /is now called Mara/.test(line.text)), [talk.host, talk.other]);
  // What comes in from another browser is not trusted (this is what their browser could send, whatever their game would).
  const hostile = await b.evaluate(() => {
    const d = window.lastReturnDebug, result = {}, count = () => d.chat.lines.filter((line) => line.kind === 'said').length;
    const before = count(), droppedBefore = d.chat.statistics.dropped;
    d.chat.heardAt = {};
    d.hearChat(1, { m: 'x'.repeat(900) });
    result.long = d.chat.lines[d.chat.lines.length - 1].text.length;
    d.hearChat(1, { m: 'one\u0007two\nthree\u202efour\u2028five     six' });
    result.cleaned = d.chat.lines[d.chat.lines.length - 1].text;
    const atTwo = count();
    d.hearChat(1, { m: 12345 }); d.hearChat(1, { m: '   ' }); d.hearChat(1, {}); d.hearChat(99, { m: 'I am not in this lobby' });
    result.notText = count() - atTwo;
    for (let line = 0; line < 12; line++) d.hearChat(1, { m: 'again ' + line });
    result.heardOfFourteen = count() - before; result.dropped = d.chat.statistics.dropped - droppedBefore; result.kept = d.chat.lines.length <= 40;
    d.chat.heardAt = {};
    result.cleanName = d.cleanChatText('  \u202eEvil\nName that goes on and on  ', 16);
    return result;
  });
  check('a line from another browser is cut to two hundred characters and to one line, with what cannot be shown taken out of it',
    hostile.long === 200 && hostile.cleaned === 'one two three four five six' && hostile.cleanName === 'Evil Name that g', hostile);
  check('what is not text, is empty, or comes from nobody in the lobby is not shown; nor is more than five lines in five seconds from one of them',
    hostile.notText === 0 && hostile.heardOfFourteen === 5 && hostile.dropped === 9 && hostile.kept, hostile);

  // ---- Voices (src/js/11-voice.js) ----
  // Packing a piece small and unpacking it: what comes back is the sound that went in, near enough.
  const packing = await a.evaluate(() => {
    const d = window.lastReturnDebug, count = d.voiceNumbers.pieceSamples, result = {};
    let signal = 0, noise = 0;
    d.voicePacking.value = 0; d.voicePacking.stepIndex = 0;
    for (let piece = 0; piece < 10; piece++) {
      const samples = new Float32Array(count);
      for (let index = 0; index < count; index++) { const time = (piece * count + index) / d.voiceNumbers.rate; samples[index] = 0.3 * Math.sin(2 * Math.PI * 220 * time) + 0.15 * Math.sin(2 * Math.PI * 1370 * time) + 0.05 * Math.sin(2 * Math.PI * 3100 * time); }
      const packed = d.packVoice(samples, 1, piece), back = d.unpackVoice(packed);
      result.bytes = packed.length;
      if (piece > 0) for (let index = 0; index < count; index++) { signal += samples[index] * samples[index]; noise += (samples[index] - back[index]) * (samples[index] - back[index]); }
      if (piece === 9) { result.tooShort = d.unpackVoice(packed.subarray(0, 300)); const other = packed.slice(); other[0] = 9; result.anotherKind = d.unpackVoice(other); }
    }
    result.decibels = Math.round(10 * Math.log10(signal / noise) * 10) / 10;
    result.secondsAPiece = count / d.voiceNumbers.rate;
    return result;
  });
  check('a piece of voice is a twenty-fifth of a second in 328 bytes, and unpacked it is the sound that went in to within a thirtieth; what is not such a piece is not unpacked',
    packing.bytes === 328 && Math.abs(packing.secondsAPiece - 0.04) < 0.0001 && packing.decibels > 24 && packing.tooShort === null && packing.anotherKind === null, packing);
  const voiceAtFirst = await b.evaluate(() => { const d = window.lastReturnDebug; return { mode: d.settings.voiceMode, control: document.getElementById('together-voice').value, isCarried: d.voice.isCarried, microphone: d.voice.microphone,
    status: document.getElementById('together-voice-status').textContent, players: Array.from(document.querySelectorAll('#together-players .together-player')).map((row) => row.textContent), sliders: document.querySelectorAll('#together-players input[type=range]').length }; });
  check('voice starts switched off: the microphone is not asked for; the lobby\'s block lists who is here, with a slider for how loud each of the others is',
    voiceAtFirst.mode === 'off' && voiceAtFirst.control === 'off' && voiceAtFirst.isCarried && voiceAtFirst.microphone === 'none' && /microphone is off/.test(voiceAtFirst.status) &&
    voiceAtFirst.players.length === 2 && /Mara \(host\)/.test(voiceAtFirst.players[0]) && /Player 2 \(you\)/.test(voiceAtFirst.players[1]) && voiceAtFirst.sliders === 1, voiceAtFirst);
  // The host opens their microphone (this browser's is made up: a tone that beeps). The other hears it, plainly: both are at the title screen.
  await a.selectOption('#together-voice', 'open');
  const wasHeard = await b.waitForFunction(() => window.lastReturnDebug.voice.statistics.heard >= 5, null, { polling: 200, timeout: 15000 }).then(() => true, () => false);
  const throughTheMicrophone = { host: await a.evaluate(() => { const d = window.lastReturnDebug; return { microphone: d.voice.microphone, sent: d.voice.statistics.sent, status: document.getElementById('together-voice-status').textContent, kept: JSON.parse(window.localStorage.getItem('last-return-settings') || '{}').voiceMode }; }),
    other: await b.evaluate(() => { const d = window.lastReturnDebug, talker = d.voice.talkers[1]; d.updateVoice(0.05);
      return { heard: d.voice.statistics.heard, refused: d.voice.statistics.refused, place: talker ? talker.place : -1, plain: talker ? talker.plainLevel : -1, placed: talker ? talker.placedLevel : -1, isPlayed: talker ? talker.node !== null || talker.pending.length > 0 : false }; }) };
  check('with the microphone open, what it hears is cut up, packed, carried by the server and unpacked in the other\'s game; at the title screen the other hears it plainly, from nowhere',
    wasHeard && throughTheMicrophone.host.microphone === 'on' && throughTheMicrophone.host.sent >= 5 && throughTheMicrophone.host.kept === 'open' && /microphone is open/.test(throughTheMicrophone.host.status) &&
    throughTheMicrophone.other.refused === 0 && throughTheMicrophone.other.place === 0 && throughTheMicrophone.other.plain === 1 && throughTheMicrophone.other.placed === 0 && throughTheMicrophone.other.isPlayed, throughTheMicrophone);
  // Switched off again, the microphone is let go of.
  await a.selectOption('#together-voice', 'off');
  await pause(300);
  const letGo = await a.evaluate(() => { const d = window.lastReturnDebug, sent = d.voice.statistics.sent; return new Promise((resolve) => setTimeout(() => resolve({ microphone: d.voice.microphone, stream: d.voice.stream, sentSince: d.voice.statistics.sent - sent }), 400)); });
  check('switched off again, the microphone is let go of and nothing more is sent', letGo.microphone === 'none' && letGo.stream === null && letGo.sentSince === 0, letGo);
  // From here voices are put in by hand: `speak` is what the microphone's program does with a piece, a tone of this pitch.
  const speak = (page, pieces, options) => page.evaluate(([pieces, options]) => {
    const d = window.lastReturnDebug, count = d.voiceNumbers.pieceSamples, modeBefore = d.settings.voiceMode;
    d.settings.voiceMode = options.mode || 'open';
    if (options.crouched !== undefined) d.player.isCrouching = options.crouched;
    let sent = 0;
    for (let piece = 0; piece < pieces; piece++) {
      const samples = new Float32Array(count);
      for (let index = 0; index < count; index++) samples[index] = (options.loudness === undefined ? 0.3 : options.loudness) * Math.sin(2 * Math.PI * 300 * (piece * count + index) / d.voiceNumbers.rate);
      if (d.handleCapturedVoice(samples)) sent++;
    }
    if (!options.keepMode) d.settings.voiceMode = modeBefore;
    return sent;
  }, [pieces, options || {}]);
  const heardBy = (page, id) => page.evaluate((id) => { const d = window.lastReturnDebug, talker = d.voice.talkers[id]; d.updateVoice(0.3);
    return { heard: d.voice.statistics.heard, place: talker ? talker.place : -1, whisper: talker ? talker.isWhispering : null, placed: talker ? Math.round(talker.placedLevel * 1000) / 1000 : -1, plain: talker ? talker.plainLevel : -1,
      muffled: talker ? talker.isMuffled : null, metres: talker ? Math.round(talker.metres * 100) / 100 : -1, shown: document.getElementById('voice-talkers').textContent,
      apart: (() => { const other = d.together.others.filter((one) => one.id === id)[0], viewer = d.getViewer(); return other ? Math.round(Math.hypot(other.x - viewer.x, other.z - viewer.z) * 100) / 100 : -1; })() }; }, id);
  const heardCount = (page) => page.evaluate(() => window.lastReturnDebug.voice.statistics.heard);
  // Push to talk sends only while the key is held; an open microphone only what is loud enough, and a moment after.
  await b.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }); // (the box they wrote in has the keys still: B would be typed into it)
  const gates = { heardBefore: await heardCount(a) };
  gates.pushNotHeld = await speak(b, 3, { mode: 'push' });
  await b.keyboard.down('KeyB');
  gates.pushHeld = await speak(b, 3, { mode: 'push' });
  await b.keyboard.up('KeyB');
  gates.pushLetGo = await speak(b, 3, { mode: 'push' });
  gates.off = await speak(b, 3, { mode: 'off' });
  await pause(600); // (an open microphone goes on for a moment after the last loud thing: that has to be over)
  gates.openTooQuiet = await speak(b, 3, { loudness: 0.004 });
  gates.openLoud = await speak(b, 3, {});
  gates.openJustAfter = await speak(b, 2, { loudness: 0.004 });
  await pause(600);
  gates.openLater = await speak(b, 2, { loudness: 0.004 });
  await a.waitForFunction((before) => window.lastReturnDebug.voice.statistics.heard >= before + 8, gates.heardBefore, { polling: 100, timeout: 5000 }).catch(() => {});
  gates.heard = (await heardCount(a)) - gates.heardBefore;
  check('push to talk sends only while B is held; an open microphone only what is loud enough, and for a moment after; switched off nothing is sent',
    gates.pushNotHeld === 0 && gates.pushHeld === 3 && gates.pushLetGo === 0 && gates.off === 0 && gates.openTooQuiet === 0 && gates.openLoud === 3 && gates.openJustAfter === 2 && gates.openLater === 0 && gates.heard === 8, gates);
  // Each of the others has a slider: how loud they are to you, down to not at all. It is kept under their name.
  // And a piece that is not from somebody in the lobby is not heard at all.
  const levels = await b.evaluate(() => {
    const d = window.lastReturnDebug, result = {};
    const piece = (from, flags) => { const packed = d.packVoice(new Float32Array(d.voiceNumbers.pieceSamples).fill(0.2), flags, 0), all = new Uint8Array(packed.length + 2); all[0] = from & 255; all[1] = from >> 8; all.set(packed, 2); return all.buffer; };
    const hearing = () => { const got = d.getVoiceHearing(d.getVoiceTalker(1), false); return { placed: got.placed, plain: got.plain }; };
    const slide = (value, isLetGo) => { const slider = document.querySelector('#together-players input[type=range]'); slider.value = String(value); slider.dispatchEvent(new Event('input')); if (isLetGo) slider.dispatchEvent(new Event('change')); };
    const said = () => document.querySelector('#together-players .together-player i').textContent;
    d.hearVoicePiece(piece(1, 0)); result.before = hearing(); result.saidBefore = said();
    slide(0.5, true); result.half = hearing(); result.saidHalf = said();
    result.kept = JSON.parse(window.localStorage.getItem('last-return-settings') || '{}').voiceLevels;
    result.inTheMenu = document.querySelector('#pause-players input[type=range]') ? document.querySelector('#pause-players input[type=range]').value : null;
    // In another lobby, where they have another number: the name is what it is kept under.
    delete d.voice.levels[1]; result.byName = d.getVoiceLevel(1);
    const nameBefore = d.chat.names[1]; d.chat.names[1] = ''; result.withoutAName = d.getVoiceLevel(1); d.chat.names[1] = nameBefore;
    slide(0, true); const heardBefore = d.voice.statistics.heard; d.hearVoicePiece(piece(1, 0)); result.muted = hearing(); result.saidMuted = said(); result.stillCounted = d.voice.statistics.heard - heardBefore;
    slide(2, true); result.loudest = hearing();
    slide(1, true); result.back = hearing(); result.keptAfter = JSON.parse(window.localStorage.getItem('last-return-settings') || '{}').voiceLevels;
    const refusedBefore = d.voice.statistics.refused;
    result.fromNobody = d.hearVoicePiece(piece(77, 0)); result.fromYourself = d.hearVoicePiece(piece(2, 0)); result.noSuchPlace = d.hearVoicePiece(piece(1, 3));
    result.tooShort = d.hearVoicePiece(new Uint8Array(40).buffer); result.notSound = d.hearVoicePiece('text');
    result.refused = d.voice.statistics.refused - refusedBefore;
    return result;
  });
  check('each of the others has a slider for how loud they are to you, from not at all to twice as loud; it says what it is set to, and the menu has the same list',
    levels.before.plain === 1 && levels.saidBefore === '100%' && levels.half.plain === 0.5 && levels.saidHalf === '50%' && levels.inTheMenu === '0.5' && levels.muted.plain === 0 && levels.saidMuted === 'muted' && levels.stillCounted === 1 &&
    levels.loudest.plain === 2 && levels.back.plain === 1, levels);
  check('what you set is kept under the name they gave, for the next lobby they are in; somebody without a name is as they come; back at 100% nothing is kept',
    levels.kept && levels.kept.Mara === 0.5 && levels.byName === 0.5 && levels.withoutAName === 1 && levels.keptAfter && levels.keptAfter.Mara === undefined, [levels.kept, levels.byName, levels.withoutAName, levels.keptAfter]);
  check('a piece from nobody in the lobby, from yourself, from no such place, or too short is not heard',
    !levels.fromNobody && !levels.fromYourself && !levels.noSuchPlace && !levels.tooShort && !levels.notSound && levels.refused === 4, levels);

  // The other's title screen shows what the host has chosen, and follows it when the host changes it.
  await b.waitForFunction(() => window.lastReturnDebug.settings.station === 'generated', null, { timeout: 5000 }).catch(() => {});
  const shownAtFirst = await b.evaluate(() => { const d = window.lastReturnDebug; return { station: d.settings.station, seed: d.settings.seedText, size: d.settings.stationSize, difficulty: d.settings.difficulty,
    sizeControl: document.getElementById('title-station-size').value, cannotChange: document.getElementById('title-station-size').disabled && document.getElementById('difficulty-nightmare').closest('fieldset').disabled }; });
  check('the other\'s title screen shows the station and the threat level the host has chosen, and cannot change them',
    shownAtFirst.station === 'generated' && shownAtFirst.seed === String(lobbySeed) && shownAtFirst.size === 'small' && shownAtFirst.sizeControl === 'small' && shownAtFirst.difficulty === 'standard' && shownAtFirst.cannotChange, shownAtFirst);
  await a.evaluate(() => { document.getElementById('station-generated').click(); }); // (the title screen was not told of the settings put in above: this shows the size and the seed)
  await a.selectOption('#title-station-size', 'large');
  await b.waitForFunction(() => window.lastReturnDebug.settings.stationSize === 'large', null, { timeout: 5000 }).catch(() => {});
  const followed = await b.evaluate(() => ({ size: window.lastReturnDebug.settings.stationSize, control: document.getElementById('title-station-size').value, kept: JSON.parse(window.localStorage.getItem('last-return-settings') || '{}').station }));
  check('when the host changes something, it changes there too; what the other chose for themselves is what is kept', followed.size === 'large' && followed.control === 'large' && followed.kept !== 'generated', followed);
  await a.selectOption('#title-station-size', 'small');
  await b.waitForFunction(() => window.lastReturnDebug.settings.stationSize === 'small', null, { timeout: 5000 });
  // Where the station is, is the host's to choose as well: the other's title screen follows that too, there and back.
  const otherPlace = await a.evaluate(() => Object.keys(window.lastReturnDebug.locations).filter((key) => key !== 'annex')[0]);
  await a.selectOption('#title-station-location', otherPlace);
  await b.waitForFunction((place) => window.lastReturnDebug.settings.stationLocation === place, otherPlace, { timeout: 5000 }).catch(() => {});
  const placeFollowed = await b.evaluate(() => ({ place: window.lastReturnDebug.settings.stationLocation, control: document.getElementById('title-station-location').value, cannotChange: document.getElementById('title-station-location').disabled }));
  check('the place the host chooses for the station shows on the other\'s title screen too', placeFollowed.place === otherPlace && placeFollowed.control === otherPlace && placeFollowed.cannotChange, placeFollowed);
  await a.selectOption('#title-station-location', 'annex');
  await b.waitForFunction(() => window.lastReturnDebug.settings.stationLocation === 'annex', null, { timeout: 5000 });

  // The other's click on "Join" is forgotten by the browser after a few seconds. The host begins after that.
  await b.waitForFunction(() => !navigator.userActivation.isActive, null, { timeout: 15000 });
  await startGame(a, false);
  // The other has clicked nothing since joining. They go down all the same.
  const wentDown = await b.waitForFunction(() => window.lastReturnDebug.game.mode === 'intro', null, { timeout: 10000 }).then(() => true, () => false);
  check('when the host begins, the other goes down with them', wentDown, await b.evaluate(() => window.lastReturnDebug.game.mode));
  await b.keyboard.press('Enter'); // past the intro
  await b.waitForFunction(() => window.lastReturnDebug.game.mode === 'playing');
  check('and is not told that the mouse cannot be captured, for want of a click', !(await b.textContent('#hud-messages')).includes('Mouse capture is not available'));
  // The host's page holds the mouse now: it took it on "Begin descent". Nobody is moving it, so nothing should
  // be arriving. This is a check on the browser the suite runs in, not on the game, and it is here because of
  // what it cost when it did not hold: Playwright's "headless shell" sends a page that holds the mouse 80,000
  // to 90,000 moves a second, and with three browsers playing at once this suite then took 14 GB and lost a
  // browser to the kernel. browser-harness.js has the whole of it, and starts the real browser instead.
  const stillMouse = await countMouseMoves(a, 1000);
  check('the host\'s page holds the mouse, and with nobody moving it no mouse moves arrive', stillMouse.isMouseHeld && stillMouse.moves < 100, stillMouse);
  const station = async (page) => page.evaluate(() => { const d = window.lastReturnDebug; return { seed: d.level.seed, map: d.level.mapFingerprint, order: d.level.workOrder, difficulty: d.game.difficulty.label, players: d.players.length }; });
  const stationA = await station(a), stationB = await station(b);
  check('both are in the same station, built the same to the tile, at the host\'s threat level',
    stationA.seed === lobbySeed && stationA.map === stationB.map && stationA.order === stationB.order && stationA.difficulty === 'Standard' && stationB.difficulty === 'Standard', [stationA, stationB]);
  check('a descent together can be for salvage', stationA.order === 'salvage' && stationB.order === 'salvage', [stationA.order, stationB.order]);
  const comparison = await b.evaluate(() => {
    const d = window.lastReturnDebug, result = { hostMap: d.together.hostMap, mine: d.level.mapFingerprint, saidWhenSame: document.getElementById('hud-messages').textContent.includes('not built the same') };
    return result;
  });
  check('the other knows what the host\'s station came to, and is told nothing while theirs is the same', comparison.hostMap === comparison.mine && !comparison.saidWhenSame, comparison);
  await a.evaluate(() => window.lastReturnDebug.together.socket.send(JSON.stringify({ t: 'say', d: { k: 'built', map: 12345 } }))); // as if the host had built something else
  const wasTold = await b.waitForFunction(() => document.getElementById('hud-messages').textContent.includes('not built the same'), null, { timeout: 5000 }).then(() => true, () => false);
  check('and is told when it is not', wasTold);

  // The host stands somewhere; the other is told, and stands three metres off looking at them.
  const where = await a.evaluate(() => {
    const d = window.lastReturnDebug;
    const spot = d.findWalkableSpotNear(d.playerStart.x, d.playerStart.z);
    d.teleport(spot.x, spot.z, 0);
    for (let count = 0; count < 4; count++) d.updateTogether(0.1);
    return { x: d.player.x, z: d.player.z, eyeY: d.getPlayerEyeY() };
  });
  await b.waitForFunction(() => window.lastReturnDebug.together.others[0].hasBeenHeardFrom);
  const seen = await b.evaluate((where) => {
    const d = window.lastReturnDebug, other = d.together.others[0];
    for (let count = 0; count < 5; count++) d.updateTogether(0.1);
    const result = { x: other.x, z: other.z };
    // A pulse from three metres to one side, at the height of their chest.
    const fromX = where.x, fromZ = where.z + 0.9;
    result.hit = d.fireScanPulse(fromX, where.eyeY - 0.4, fromZ, 0, 0, -1, false);
    result.hitTheirBody = d.rayHit.figure === other.figure;
    result.surfaceClass = d.rayHit.surfaceClass;
    return result;
  }, where);
  check('each is shown where the other says they are', Math.hypot(seen.x - where.x, seen.z - where.z) < 0.01, [where, seen]);
  check('the other is a body a pulse lands on', seen.hit && seen.hitTheirBody && seen.surfaceClass === 16, seen);

  // The host scans. The other's own scanner is off, and yet points arrive.
  await a.evaluate(() => { const d = window.lastReturnDebug; d.setScanHeld(true); d.simulate(0.3); for (let count = 0; count < 4; count++) d.updateTogether(0.1); });
  await b.waitForFunction(() => window.lastReturnDebug.together.others[0].spreadDegrees > 0);
  const echo = await b.evaluate(() => {
    const d = window.lastReturnDebug, before = d.pointCloud.totalReturns, hitsBefore = d.together.others[0].figure.totalHits;
    for (let count = 0; count < 5; count++) d.updateTogether(0.1);
    return { points: d.pointCloud.totalReturns - before, onTheirOwnBody: d.together.others[0].figure.totalHits - hitsBefore };
  });
  check('what the other\'s scanner lights up is lit here too, and their light is not in its own way', echo.points > 100 && echo.onTheirOwnBody === 0, echo);
  await a.evaluate(() => { const d = window.lastReturnDebug; d.setScanHeld(false); d.simulate(0.2); for (let count = 0; count < 4; count++) d.updateTogether(0.1); });
  await b.waitForFunction(() => window.lastReturnDebug.together.others[0].spreadDegrees === 0);
  const after = await b.evaluate(() => {
    const d = window.lastReturnDebug, before = d.pointCloud.totalReturns;
    for (let count = 0; count < 5; count++) d.updateTogether(0.1);
    return d.pointCloud.totalReturns - before;
  });
  check('and no longer when they stop', after === 0, after);

  // The map of light ("Light", 08-creatures.js: what the Surveyor goes by) is kept in the host's game, and the
  // other's scanning is in it without anything more being sent: the host's game shows their light for itself.
  await a.evaluate(() => { window.lastReturnDebug.clearLightHeat(); });
  await b.evaluate(() => { const d = window.lastReturnDebug; d.setScanHeld(true); d.simulate(0.3); for (let count = 0; count < 4; count++) d.updateTogether(0.1); });
  await a.waitForFunction(() => window.lastReturnDebug.together.others[0].spreadDegrees > 0);
  const lightOfTheOther = {
    inTheHostsMap: await a.evaluate(() => { const d = window.lastReturnDebug; for (let count = 0; count < 5; count++) d.updateTogether(0.1); return { counted: d.lightState.total, hostIsScanning: d.input.isScanHeld === true }; }),
    inTheirOwn: await b.evaluate(() => { const d = window.lastReturnDebug; return { counted: d.lightState.total, pointsOfTheirOwn: d.pointCloud.totalReturns > 0 }; })
  };
  await b.evaluate(() => { const d = window.lastReturnDebug; d.setScanHeld(false); d.simulate(0.2); for (let count = 0; count < 4; count++) d.updateTogether(0.1); });
  await a.waitForFunction(() => window.lastReturnDebug.together.others[0].spreadDegrees === 0);
  check('the other\'s scanning is on the host\'s map of light, though the host is not scanning; the other\'s own game keeps no such map',
    lightOfTheOther.inTheHostsMap.counted > 100 && !lightOfTheOther.inTheHostsMap.hostIsScanning && lightOfTheOther.inTheirOwn.counted === 0 && lightOfTheOther.inTheirOwn.pointsOfTheirOwn, lightOfTheOther);

  // Talking in play: Enter opens the box, and while it is open the keys are the box's.
  const boxInPlay = await b.evaluate(() => { const d = window.lastReturnDebug; d.updateChat(1); return { button: !document.getElementById('chat-open').hidden, box: !document.getElementById('chat-form').hidden, overTheScreen: document.getElementById('chat').parentNode.id }; });
  const stoodAt = await b.evaluate(() => ({ x: window.lastReturnDebug.player.x, z: window.lastReturnDebug.player.z }));
  await b.keyboard.press('Enter');
  const opened = await b.evaluate(() => ({ isOpen: window.lastReturnDebug.chat.isOpen, hasTheKeys: document.activeElement === document.getElementById('chat-input'), mode: window.lastReturnDebug.game.mode }));
  await b.keyboard.down('KeyW'); await b.keyboard.type('asd it is behind you');
  await b.evaluate(() => { window.lastReturnDebug.simulate(0.6); });
  const typed = await b.evaluate((stoodAt) => { const d = window.lastReturnDebug; return { box: document.getElementById('chat-input').value, moved: Math.hypot(d.player.x - stoodAt.x, d.player.z - stoodAt.z), keysDown: d.input.keysDown.size, scanning: d.input.isScanHeld }; }, stoodAt);
  await b.keyboard.up('KeyW');
  await b.keyboard.press('Enter');
  await a.waitForFunction(() => window.lastReturnDebug.chat.lines.some((line) => /behind you/.test(line.text)), null, { timeout: 5000 }).catch(() => {});
  const sent = { other: await b.evaluate(() => ({ isOpen: window.lastReturnDebug.chat.isOpen, box: document.getElementById('chat-input').value, boxShown: !document.getElementById('chat-form').hidden })),
    host: (await linesIn(a)).filter((line) => /behind you/.test(line.text)) };
  check('in play the box to talk in is shut until Enter opens it; then the keys are the box\'s, and you stand where you stood',
    boxInPlay.button && !boxInPlay.box && boxInPlay.overTheScreen === 'game-root' && opened.isOpen && opened.hasTheKeys && opened.mode === 'playing' &&
    typed.box === 'wasd it is behind you' && typed.moved < 0.01 && typed.keysDown === 0 && !typed.scanning, [boxInPlay, opened, typed]);
  check('Enter sends the line and shuts the box; the others read it under your name', !sent.other.isOpen && sent.other.box === '' && !sent.other.boxShown && sent.host.length === 1 && sent.host[0].who === 'Player 2' && sent.host[0].shown, sent);
  // T opens it too, without being typed into it; Esc shuts it, and is not the menu.
  await b.keyboard.press('KeyT');
  await b.keyboard.type('not sent');
  const withT = await b.evaluate(() => ({ isOpen: window.lastReturnDebug.chat.isOpen, box: document.getElementById('chat-input').value }));
  await b.keyboard.press('Escape');
  const afterEscape = await b.evaluate(() => ({ isOpen: window.lastReturnDebug.chat.isOpen, mode: window.lastReturnDebug.game.mode, box: document.getElementById('chat-input').value }));
  await b.evaluate(() => { document.getElementById('chat-input').value = ''; });
  check('T opens it as well and is not typed into it; Esc shuts it without opening the menu, and what was typed stays for the next time',
    withT.isOpen && withT.box === 'not sent' && !afterEscape.isOpen && afterEscape.mode === 'playing' && afterEscape.box === 'not sent', [withT, afterEscape]);
  // In play a line is shown for a few seconds; after that only while the box is open.
  const aging = await a.evaluate(() => {
    const d = window.lastReturnDebug, line = d.chat.lines.filter((one) => /behind you/.test(one.text))[0], result = {};
    d.updateChat(1); result.fresh = !line.element.hidden;
    line.at -= 60; d.updateChat(1); result.old = !line.element.hidden;
    d.openChat(); result.withTheBoxOpen = !line.element.hidden;
    d.closeChat(); d.updateChat(1); result.shutAgain = !line.element.hidden;
    return result;
  });
  check('in play a line is shown for a few seconds, and after that only while the box is open', aging.fresh && !aging.old && aging.withTheBoxOpen && !aging.shutAgain, aging);

  // ---- Voices in the station: from where they stand, by the way they have to come (src/js/11-voice.js) ----
  // The other talks. The host hears them from two metres off, with nothing in between.
  await a.evaluate(() => {
    const d = window.lastReturnDebug, other = d.together.others[0];
    for (const way of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
      const spot = d.findWalkableSpotNear(other.x + way[0], other.z + way[1]);
      if (spot && Math.abs(Math.hypot(spot.x - other.x, spot.z - other.z) - 2) < 0.3 && !d.castScannerRay(spot.x, 1.5, spot.z, (other.x - spot.x) / 2, 0, (other.z - spot.z) / 2, 1.2)) { d.teleport(spot.x, spot.z, 0); break; }
    }
    d.simulate(0.1);
  });
  const voicesBefore = await heardCount(a);
  const sentInPlay = await speak(b, 4, {});
  await a.waitForFunction((before) => window.lastReturnDebug.voice.statistics.heard >= before + 4, voicesBefore, { polling: 100, timeout: 5000 }).catch(() => {});
  const near = await heardBy(a, 2);
  const numbers = await a.evaluate(() => { const tuning = window.lastReturnDebug.tuning; return { full: tuning.voiceFullWithinMetres, carries: tuning.voiceCarriesMetres, whisper: tuning.voiceWhisperFactor, muffled: tuning.voiceMuffledFactor,
    noise: tuning.noiseRadiusVoice, noiseWhisper: tuning.noiseRadiusVoiceWhisper, walkStep: tuning.noiseRadiusWalkStep }; });
  check('down in the station a voice is heard from where the one talking stands: two metres off with nothing in between, at full, and the screen says who is talking',
    sentInPlay === 4 && near.place === 1 && near.plain === 0 && near.placed > 0.99 && near.muffled === false && near.apart <= numbers.full && Math.abs(near.metres - near.apart) < 0.3 && /Player 2/.test(near.shown), [near, numbers]);
  // How loud by how far: by the numbers, for a voice and for a whisper. (They are put at each distance by hand,
  // in the host's game alone and for the length of this: only the distance is asked about.)
  const byDistance = await a.evaluate(() => {
    const d = window.lastReturnDebug, tuning = d.tuning, other = d.together.others[0], talker = d.getVoiceTalker(2), was = { x: other.x, z: other.z, eyeY: other.eyeY, whisper: talker.isWhispering, muffled: talker.isMuffled, metres: talker.metres };
    const expected = (metres, reach) => { const full = tuning.voiceFullWithinMetres * reach, gone = tuning.voiceCarriesMetres * reach, nearness = Math.max(0, Math.min(1, 1 - (metres - full) / (gone - full))); return nearness * nearness; };
    const result = { voice: [], whisper: [] };
    other.eyeY = d.getPlayerEyeY(); talker.isMuffled = false; talker.metres = 0;
    for (const [name, reach] of [['voice', 1], ['whisper', tuning.voiceWhisperFactor]]) {
      talker.isWhispering = name === 'whisper';
      for (const share of [0.05, 0.3, 0.6, 0.9, 1.05]) {
        const metres = tuning.voiceCarriesMetres * reach * share;
        other.x = d.player.x + metres; other.z = d.player.z;
        result[name].push({ metres: Math.round(metres * 10) / 10, heard: d.getVoiceHearing(talker, false).placed, expected: expected(metres, reach) });
      }
    }
    other.x = was.x; other.z = was.z; other.eyeY = was.eyeY; talker.isWhispering = was.whisper; talker.isMuffled = was.muffled; talker.metres = was.metres;
    return result;
  });
  const follows = (rows) => rows.every((row) => Math.abs(row.heard - row.expected) < 0.001) && rows[0].heard === 1 && rows[4].heard === 0 && rows[1].heard > rows[2].heard && rows[2].heard > rows[3].heard && rows[3].heard > 0;
  check('a voice is at full close by, quieter with every metre, and gone where the number says; a whisper the same over a good deal less far',
    follows(byDistance.voice) && follows(byDistance.whisper) && byDistance.whisper[4].metres < byDistance.voice[4].metres * 0.5, byDistance);
  // Crouched, what you say is a whisper, and the others' games know it.
  const whisperBefore = await heardCount(a);
  await speak(b, 2, { crouched: true });
  await a.waitForFunction((before) => window.lastReturnDebug.voice.statistics.heard >= before + 2, whisperBefore, { polling: 100, timeout: 5000 }).catch(() => {});
  const whispered = await heardBy(a, 2);
  await speak(b, 1, { crouched: false });
  check('crouched, you whisper: the others\' games are told so with every piece', whispered.whisper === true && whispered.place === 1, whispered);
  // A door between them. Shut, the voice comes through the wall, muffled. Open, with the two of them not in line
  // with it, it comes round through the doorway: clear, and from as far as that way is long.
  const throughADoor = await a.evaluate(() => {
    const d = window.lastReturnDebug, other = d.together.others[0], talker = d.getVoiceTalker(2), result = { found: false };
    const was = { x: other.x, z: other.z, eyeY: other.eyeY, playerX: d.player.x, playerZ: d.player.z, place: talker.place, whisper: talker.isWhispering };
    const walkable = (x, z) => { const spot = d.findWalkableSpotNear(x + 0.5, z + 0.5); return spot && spot.x === x + 0.5 && spot.z === z + 0.5; };
    const setDoor = (door, isOpen) => { door.openFraction = isOpen ? 1 : 0; door.slab.isRemoved = isOpen; };
    const hear = () => { d.refreshVoiceWays(1); const got = d.getVoiceHearing(talker, true); return { placed: got.placed, muffled: got.isMuffled, metres: got.metres, straight: Math.hypot(other.x - d.player.x, other.z - d.player.z) }; };
    talker.place = 1; talker.isWhispering = false; other.eyeY = d.getPlayerEyeY();
    result.doors = d.doors.length; result.withFloorInLine = 0; result.withFloorAside = 0;
    const stand = (mine, theirs) => { d.teleport(mine[0] + 0.5, mine[1] + 0.5, 0); other.x = theirs[0] + 0.5; other.z = theirs[1] + 0.5; };
    for (const door of d.doors) {
      if (door === d.getLiftDoor() || door.isBroken) continue;
      const before = { openFraction: door.openFraction, isRemoved: door.slab.isRemoved };
      for (const [alongX, alongZ] of [[1, 0], [0, 1]]) {
        const sideX = alongZ, sideZ = alongX;
        // In line with the door, a few tiles to either side of it.
        for (const out of [3, 2, 4]) {
          const inLine = [[door.tileX - alongX * out, door.tileZ - alongZ * out], [door.tileX + alongX * out, door.tileZ + alongZ * out]];
          if (result.shut || !inLine.every((tile) => walkable(tile[0], tile[1]))) continue;
          result.withFloorInLine++;
          stand(inLine[0], inLine[1]);
          setDoor(door, true); const open = hear();
          setDoor(door, false); const shut = hear();
          if (!open.muffled && Math.abs(open.metres - open.straight) < 0.01) { result.shut = shut; result.open = open; }
        }
        // Round the corner from it: out from the door and then sideways, the two of them opposite ways, so that
        // the wall is in the way of the straight line and the doorway is the way round.
        for (const out of [2, 3, 1]) for (const aside of [2, 3, 1, 4]) for (const turn of [1, -1]) {
          const round = [[door.tileX - alongX * out + sideX * aside * turn, door.tileZ - alongZ * out + sideZ * aside * turn], [door.tileX + alongX * out - sideX * aside * turn, door.tileZ + alongZ * out - sideZ * aside * turn]];
          if (result.openAside || !round.every((tile) => walkable(tile[0], tile[1]))) continue;
          result.withFloorAside++;
          stand(round[0], round[1]);
          setDoor(door, true); const openAside = hear();
          setDoor(door, false); const shutAside = hear();
          if (!openAside.muffled && openAside.metres > openAside.straight + 0.5) { result.openAside = openAside; result.shutAside = shutAside; }
        }
      }
      door.openFraction = before.openFraction; door.slab.isRemoved = before.isRemoved;
    }
    result.found = Boolean(result.shut && result.openAside);
    d.teleport(was.playerX, was.playerZ, d.player.yaw); other.x = was.x; other.z = was.z; other.eyeY = was.eyeY; talker.place = was.place; talker.isWhispering = was.whisper;
    d.refreshVoiceWays(1);
    return result;
  });
  check('the station has a door with floor to both sides of it, and one with floor round the corner from it', throughADoor.found, throughADoor);
  if (throughADoor.found) {
    check('through a shut door a voice is muffled: quieter by the number, as far off as the two are apart; with the door open it is clear',
      throughADoor.shut.muffled && !throughADoor.open.muffled && Math.abs(throughADoor.shut.placed - throughADoor.open.placed * numbers.muffled) < 0.001 && Math.abs(throughADoor.shut.metres - throughADoor.shut.straight) < 0.01 && Math.abs(throughADoor.open.metres - throughADoor.open.straight) < 0.01, throughADoor);
    check('round the corner from an open door a voice is clear and comes the way round, from further off than the two are apart; shut the door and it is muffled again',
      !throughADoor.openAside.muffled && throughADoor.openAside.metres > throughADoor.openAside.straight + 0.5 && throughADoor.shutAside.muffled &&
      throughADoor.shutAside.placed < throughADoor.openAside.placed, throughADoor);
  }
  // Talking is a noise where you stand, twice a second, a little quieter than a walking step; a whisper a good deal quieter.
  await a.evaluate(() => { const d = window.lastReturnDebug; window.heardNoises = []; d.creatureKinds.push({ key: 'testEars', update: function () {}, reset: function () {}, hear: function (x, z, radius) { window.heardNoises.push({ x: x, z: z, radius: radius }); } }); });
  const noisy2 = { at: await b.evaluate(() => ({ x: window.lastReturnDebug.player.x, z: window.lastReturnDebug.player.z })) };
  for (let turn = 0; turn < 6; turn++) { await speak(b, 2, {}); await b.evaluate(() => { window.lastReturnDebug.updateVoice(0.26); }); await pause(120); }
  await pause(400);
  noisy2.talking = await a.evaluate(() => window.heardNoises.splice(0));
  await pause(400); // (they have stopped: no more of it)
  await b.evaluate(() => { for (let count = 0; count < 4; count++) window.lastReturnDebug.updateVoice(0.26); });
  await pause(300);
  noisy2.afterwards = await a.evaluate(() => window.heardNoises.splice(0));
  // (Crouched for real, with the key held: a frame of their game drawn in between would stand them up again otherwise.)
  await b.keyboard.down('KeyC');
  await b.evaluate(() => { window.lastReturnDebug.simulate(0.3); });
  noisy2.isCrouched = await b.evaluate(() => window.lastReturnDebug.player.isCrouching);
  await pause(700); // (and what was said standing is over)
  await a.evaluate(() => { window.heardNoises.splice(0); });
  for (let turn = 0; turn < 4; turn++) { await speak(b, 2, {}); await b.evaluate(() => { window.lastReturnDebug.updateVoice(0.26); }); await pause(120); }
  await pause(400);
  noisy2.whispering = await a.evaluate(() => window.heardNoises.splice(0));
  await b.keyboard.up('KeyC');
  await b.evaluate(() => { window.lastReturnDebug.simulate(0.3); });
  await a.evaluate(() => { const d = window.lastReturnDebug; d.creatureKinds.splice(d.creatureKinds.findIndex((kind) => kind.key === 'testEars'), 1); window.heardNoises = null; });
  check('talking is a noise where you stand for what listens in the host\'s game, about twice a second while you talk and not after: a little quieter than a walking step; a whisper a good deal quieter',
    noisy2.talking.length >= 2 && noisy2.talking.length <= 4 && noisy2.talking.every((noise) => noise.radius === numbers.noise && Math.hypot(noise.x - noisy2.at.x, noise.z - noisy2.at.z) < 0.1) && numbers.noise < numbers.walkStep && numbers.noise > numbers.walkStep * 0.6 &&
    noisy2.afterwards.length === 0 && noisy2.isCrouched && noisy2.whispering.length >= 1 && noisy2.whispering.every((noise) => noise.radius === numbers.noiseWhisper) && numbers.noiseWhisper < numbers.noise * 0.5, [noisy2, numbers]);

  // Your own body is in the way of the others' scanners, though you never see it. The host scans the other from
  // a metre and a half, with a narrow beam: on the other's screen none of that light gets past them, and none
  // is drawn on them. And the light on the host's scanner is simply there, scanning or not.
  await b.evaluate(() => { const d = window.lastReturnDebug; d.player.velocityX = 0; d.player.velocityZ = 0; for (let count = 0; count < 3; count++) d.updateTogether(0.1); });
  await a.evaluate(() => {
    const d = window.lastReturnDebug, other = d.together.others[0];
    // (Aimed at the middle of their body, wherever that is for the proportions a player has: a beam this narrow
    // aimed at a fixed angle went past a thin neck once the body was made shorter.)
    d.teleport(other.x, other.z + 1.5, 0); d.player.pitch = Math.atan2(other.figure.boundsCenterY - d.getPlayerEyeY(), 1.5);
    d.setScannerSpread(5); d.setScanHeld(true); d.simulate(0.3);
    for (let count = 0; count < 4; count++) d.updateTogether(0.1);
  });
  await b.waitForFunction(() => window.lastReturnDebug.together.others[0].spreadDegrees > 0);
  const blocked = await b.evaluate(() => {
    const d = window.lastReturnDebug, before = d.pointCloud.totalReturns, writtenBefore = d.pointCloud.writeIndex;
    for (let count = 0; count < 5; count++) d.updateTogether(0.1);
    return { points: d.pointCloud.totalReturns - before, written: (d.pointCloud.writeIndex - writtenBefore + d.pointCloud.capacity) % d.pointCloud.capacity }; // (the cloud starts again at 0 when it is full)
  });
  check('a scanner pointed at you lights nothing behind you on your own screen, and nothing on you', blocked.points === 0, blocked);
  check('the light on another scanner is always lit: a few points every frame that are not returns', blocked.written > 0, blocked);
  await a.evaluate(() => { const d = window.lastReturnDebug; d.setScanHeld(false); d.setScannerSpread(d.tuning.scannerSpreadDefaultDegrees); d.simulate(0.2); for (let count = 0; count < 4; count++) d.updateTogether(0.1); });
  await b.waitForFunction(() => window.lastReturnDebug.together.others[0].spreadDegrees === 0);

  // ---- One station: the host's creatures, doors and work order are everybody's ----
  // A stretch of play in one browser: its own game, and what it says to the others.
  const play = (page, seconds) => page.evaluate((seconds) => {
    const d = window.lastReturnDebug;
    for (let time = 0; time < seconds; time += 0.1) { d.simulate(0.1); d.updateTogether(0.1); }
  }, seconds);
  // Being caught takes 1.55 seconds of the game, at a twentieth of a second a frame at the most: thirty-one frames
  // or more. With two or three browsers drawing in software one frame can take seconds, so a death is waited for
  // in frames drawn and not in seconds. (Fifteen seconds was not always enough for it on GitHub's machine.)
  const drawUntilDead = async (page) => { for (let count = 0; count < 60 && await page.evaluate(() => window.lastReturnDebug.game.mode !== 'dead'); count++) await page.screenshot({ type: 'jpeg', quality: 5 }); };
  const both = async (seconds) => { for (let time = 0; time < seconds; time += 0.3) { await play(a, 0.3); await play(b, 0.3); await pause(170); } }; // (not faster than the clock: the server shows a browser the door for saying too much)
  await a.evaluate(() => { window.lastReturnDebug.settings.captions = 'all'; });
  await b.evaluate(() => { window.lastReturnDebug.settings.captions = 'all'; });

  // Both step out of the car. The one who is not the host does it first.
  await b.evaluate(() => {
    const d = window.lastReturnDebug;
    // The nearest walkable spot that is well outside the car.
    let best = null;
    for (let step = 3; step < 12 && !best; step++) for (const way of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const spot = d.findWalkableSpotNear(d.playerStart.x + way[0], d.playerStart.z + way[1]);
      if (spot && Math.hypot(spot.x - d.playerStart.x, spot.z - d.playerStart.z) > 3) { best = spot; break; }
    }
    d.teleport(best.x, best.z, 0);
  });
  await both(1.2);
  const leftLift = { host: await a.evaluate(() => ({ left: window.lastReturnDebug.game.flags.hasLeftLift, players: window.lastReturnDebug.players.length })),
    other: await b.evaluate(() => ({ left: window.lastReturnDebug.game.flags.hasLeftLift, players: window.lastReturnDebug.players.length })) };
  check('in the host\'s game the other is one of the players; in the other\'s own game nothing hunts or opens but as the host says', leftLift.host.players === 2 && leftLift.other.players === 1, leftLift);
  check('one of you leaving the lift is the descent leaving the lift, for everybody', leftLift.host.left && leftLift.other.left, leftLift);

  // A door far from the host opens because the other stands at it, in both games.
  const doorIndex = await a.evaluate(() => {
    const d = window.lastReturnDebug;
    for (let index = 0; index < d.doors.length; index++) {
      const door = d.doors[index];
      if (door.kind === d.doorKinds.automatic && Math.hypot(door.centerX - d.player.x, door.centerZ - d.player.z) > 10) return index;
    }
    return -1;
  });
  // (A station without such a door is told of in plain words, and the door is left out.)
  const openFractionOf = (page, index) => page.evaluate((index) => index >= 0 ? window.lastReturnDebug.doors[index].openFraction : null, index);
  await both(0.6);
  const doorBefore = [await openFractionOf(a, doorIndex), await openFractionOf(b, doorIndex)];
  if (doorIndex >= 0) await b.evaluate((index) => { const d = window.lastReturnDebug, door = d.doors[index]; d.teleport(door.centerX, door.centerZ, 0); d.player.velocityX = 0; d.player.velocityZ = 0; }, doorIndex);
  await both(2.4);
  const doorAfter = [await openFractionOf(a, doorIndex), await openFractionOf(b, doorIndex)];
  check('a door opens for the other in the host\'s game, and the other\'s door follows it', doorBefore[0] === 0 && doorBefore[1] === 0 && doorAfter[0] === 1 && doorAfter[1] === 1,
    doorIndex >= 0 ? [doorBefore, doorAfter] : 'no automatic door more than ten metres from the host in station ' + lobbySeed);

  // The host's Hollow above the ceiling: the other's game knows it is in another space ("Spaces", src/js/08-creatures.js),
  // so what that game asks about it for itself (how it weighs on you) is asked rightly there too.
  const crawlBegun = await a.evaluate(() => {
    const d = window.lastReturnDebug;
    let pair = null, most = 0;
    for (const first of d.hollowHatches) for (const second of d.hollowHatches) {
      const metres = Math.hypot(first.x - second.x, first.z - second.z);
      if (first !== second && metres > most) { most = metres; pair = [first, second]; }
    }
    if (!pair) return { hatches: d.hollowHatches.length };
    d.spawnHollow(pair[0].x, pair[0].z);
    d.hollow.graceTimer = 0;
    d.beginHollowCrawl(pair[0], pair[1]);
    return { hatches: d.hollowHatches.length, metres: Math.round(most * 10) / 10, climbSeconds: d.tuning.hollowCrawlClimbSeconds };
  });
  const spaceIn = (page) => page.evaluate(() => { const d = window.lastReturnDebug; return { space: d.getSpaceOf(d.hollow.figure), isActive: d.hollow.isActive, scannable: d.raycastableFigures.indexOf(d.hollow.figure) >= 0, crawlspace: d.spaces.crawlspace, station: d.spaces.station }; });
  let spaceWhileCrawling = null, spaceAfter = null;
  if (crawlBegun.metres) {
    await both(crawlBegun.climbSeconds + 0.9);
    spaceWhileCrawling = { host: await spaceIn(a), other: await spaceIn(b) };
    // Sent somewhere else (as the checks below do): it is in the station again, in both games.
    await a.evaluate(() => { const d = window.lastReturnDebug; d.spawnHollow(d.hollow.figure.x, d.hollow.figure.z); d.hollow.isActive = false; });
    await both(0.9);
    await a.evaluate(() => { const d = window.lastReturnDebug, spot = d.findWalkableSpotNear(d.player.x + 3, d.player.z); d.spawnHollow(spot.x, spot.z); d.hollow.graceTimer = 5; });
    await both(0.9);
    spaceAfter = { host: await spaceIn(a), other: await spaceIn(b) };
    await a.evaluate(() => { window.lastReturnDebug.hollow.isActive = false; });
    await both(0.6);
  }
  check('the host\'s Hollow crawling above the ceiling is above the ceiling in the other\'s game too, with nothing there for a scan; put back on the floor it is in the station in both',
    crawlBegun.metres > 0 && spaceWhileCrawling.host.space === spaceWhileCrawling.host.crawlspace && spaceWhileCrawling.other.space === spaceWhileCrawling.other.crawlspace && spaceWhileCrawling.other.isActive &&
    !spaceWhileCrawling.other.scannable && spaceAfter.host.space === spaceAfter.host.station && spaceAfter.other.space === spaceAfter.other.station && spaceAfter.other.scannable,
    crawlBegun.metres ? [crawlBegun, spaceWhileCrawling, spaceAfter] : ['fewer than two ceiling hatches in station ' + lobbySeed, crawlBegun]);

  // The host's Surveyor (src/js/08-surveyor.js): shown to the other where the host has it, with its light, and its strike is the other's own game's to take.
  const surveyorAt = await a.evaluate(() => {
    const d = window.lastReturnDebug, other = d.together.others[0];
    let spot = null;
    for (const way of [[7, 0], [-7, 0], [0, 7], [0, -7], [5, 5], [-5, -5]]) { const tried = d.findWalkableSpotNear(other.x + way[0], other.z + way[1]); if (tried && Math.hypot(tried.x - other.x, tried.z - other.z) > 4) { spot = tried; break; } }
    if (!spot) return null;
    d.tuning.surveyorLookTurnRate = 0;
    d.activateSurveyor(spot.x, spot.z, 60); // (it sees nobody for a minute: this is about what the others are shown)
    d.surveyor.state = 1; d.surveyor.timer = 999;
    return { x: spot.x, z: spot.z };
  });
  const surveyorIn = (page) => page.evaluate(() => { const d = window.lastReturnDebug, s = d.surveyor; return { isActive: s.isActive, x: s.figure.x, z: s.figure.z, state: s.state, pulses: s.statistics.pulses, lit: s.isLit, scannable: d.raycastableFigures.indexOf(s.figure) >= 0, health: d.player.health, mode: d.game.mode,
    takes: d.getHitDamage('surveyor') * d.game.difficulty.damageFactor, said: document.getElementById('hud-messages').textContent }; });
  let surveyorShown = null, surveyorStruck = null, surveyorGone = null;
  if (surveyorAt) {
    await both(1.2);
    const pulsesBefore = (await surveyorIn(b)).pulses;
    await both(0.9);
    surveyorShown = { host: await surveyorIn(a), other: await surveyorIn(b) };
    surveyorShown.otherPulses = surveyorShown.other.pulses - pulsesBefore;
    // It strikes the other: the host's game says so, and the other's own game takes it off their health.
    await b.evaluate(() => { window.lastReturnDebug.player.hurtGraceSeconds = 0; });
    await a.evaluate(() => { const d = window.lastReturnDebug; d.catchPlayer(d.together.others[0], 'surveyor', d.surveyor.figure); });
    await both(0.9);
    surveyorStruck = { before: surveyorShown.other.health, other: await surveyorIn(b) };
    await b.evaluate(() => { const d = window.lastReturnDebug; d.healPlayer(d.tuning.playerMaxHealth); d.clearMessages(); });
    // Taken out of the host's station, it is gone from the other's.
    await a.evaluate(() => { const d = window.lastReturnDebug; d.removeSurveyor(); d.tuning.surveyorLookTurnRate = 0.9; });
    await both(0.9);
    surveyorGone = await surveyorIn(b);
  }
  check('the host\'s Surveyor is in the other\'s game where the host has it, doing what it is doing, and the other\'s game shines its light for itself',
    surveyorAt !== null && surveyorShown.other.isActive && surveyorShown.other.scannable && Math.hypot(surveyorShown.other.x - surveyorAt.x, surveyorShown.other.z - surveyorAt.z) < 0.6 &&
    surveyorShown.other.state === surveyorShown.host.state && surveyorShown.other.lit && surveyorShown.otherPulses > 200, surveyorAt ? [surveyorAt, surveyorShown] : 'no walkable place a few metres from the other in station ' + lobbySeed);
  check('its strike on the other is taken off their health in their own game, and they are told; taken out of the host\'s station it is gone from theirs',
    surveyorAt !== null && Math.abs(surveyorStruck.other.health - (surveyorStruck.before - surveyorStruck.other.takes)) < 0.01 && surveyorStruck.other.mode === 'playing' && /struck you/.test(surveyorStruck.other.said) &&
    !surveyorGone.isActive && !surveyorGone.scannable, [surveyorStruck, surveyorGone]);

  // The host's Hollow: shown to the other where the host has it, and it hears the other.
  const hollowAt = await a.evaluate(() => {
    const d = window.lastReturnDebug, other = d.together.others[0];
    // (Somewhere more than five metres from them. Without such a place the check below says so; the Hollow is then
    // put at the farthest place found, so that what follows has a Hollow to go on with.)
    let spot = null, farthest = null;
    for (const way of [[9, 0], [-9, 0], [0, 9], [0, -9], [6, 6], [-6, -6], [6, -6], [-6, 6], [12, 0], [-12, 0], [0, 12], [0, -12]]) {
      const tried = d.findWalkableSpotNear(other.x + way[0], other.z + way[1]);
      if (!tried) continue;
      const metres = Math.hypot(tried.x - other.x, tried.z - other.z);
      if (!farthest || metres > farthest.metres) farthest = { x: tried.x, z: tried.z, metres: metres };
      if (metres > 5) { spot = tried; break; }
    }
    const at = spot || farthest || { x: other.x + 6, z: other.z }; // (no walkable place found at all: six metres off, wherever that is)
    d.spawnHollow(at.x, at.z);
    d.hollow.graceTimer = 0; d.hollow.state = 4; d.hollow.listenTimer = 30; // standing, listening
    return { x: at.x, z: at.z, isFarEnough: spot !== null, capsules: d.hollow.figure.capsuleCount };
  });
  await both(1.2);
  const hollowSeen = await b.evaluate(() => { const d = window.lastReturnDebug; return { isActive: d.hollow.isActive, x: d.hollow.figure.x, z: d.hollow.figure.z, state: d.hollow.state, capsules: d.hollow.figure.capsuleCount }; });
  check('the other is shown the host\'s Hollow where the host has it, doing what it is doing', hollowSeen.isActive && Math.hypot(hollowSeen.x - hollowAt.x, hollowSeen.z - hollowAt.z) < 0.6 && hollowSeen.state === 4 && hollowSeen.capsules > 0 && hollowSeen.capsules === hollowAt.capsules && hollowAt.isFarEnough,
    hollowAt.isFarEnough ? [hollowAt, hollowSeen] : ['no walkable place more than five metres from the other in twelve directions in station ' + lobbySeed, hollowAt, hollowSeen]);
  const roarsBefore = await b.evaluate(() => { const d = window.lastReturnDebug; return (d.captionCounts.hollowFound || 0) + (d.captionCounts.hollowRoar || 0); });
  await b.evaluate(() => { const d = window.lastReturnDebug; d.emitNoise(d.player.x, d.player.z, 60); });
  await pause(150);
  await both(0.6);
  const heard = { host: await a.evaluate(() => { const d = window.lastReturnDebug; return { state: d.hollow.state, at: Math.hypot(d.hollow.lastKnownPlayerX - d.together.others[0].x, d.hollow.lastKnownPlayerZ - d.together.others[0].z) }; }),
    roars: await b.evaluate(() => { const d = window.lastReturnDebug; return (d.captionCounts.hollowFound || 0) + (d.captionCounts.hollowRoar || 0); }) - roarsBefore };
  check('noise the other makes is heard by the host\'s Hollow, which hunts them', heard.host.state === 2 && heard.host.at < 2.5, heard);
  check('and the other hears it roar', heard.roars >= 1, heard);

  // It reaches them. That is a hit, in their own game: it takes some of their health, they are still on their
  // feet, and the host's Hollow stands where it struck. (09-health.js)
  const reach = () => a.evaluate(() => { const d = window.lastReturnDebug, other = d.together.others[0]; d.hollow.figure.x = other.x + 0.3; d.hollow.figure.z = other.z; d.hollow.graceTimer = 0; d.hollow.recoverSeconds = 0; });
  const healthBefore = await b.evaluate(() => { const d = window.lastReturnDebug; d.player.hurtGraceSeconds = 0; return d.player.health; });
  await reach();
  await both(0.6);
  const hit = { other: await b.evaluate(() => { const d = window.lastReturnDebug; return { mode: d.game.mode, health: d.player.health, of: d.tuning.playerMaxHealth, takes: d.getHitDamage('hollow') * d.game.difficulty.damageFactor }; }),
    host: await a.evaluate(() => { const d = window.lastReturnDebug, other = d.together.others[0]; return { mode: d.game.mode, health: d.player.health, isDown: other.isDown, standsFor: d.hollow.recoverSeconds, of: d.tuning.hollowAfterHitSeconds,
      metresAway: Math.hypot(d.hollow.figure.x - other.x, d.hollow.figure.z - other.z) }; }) };
  check('the host\'s Hollow reaching the other is a hit, worked out in the other\'s own game: it takes what a hit takes off their health and nobody else\'s, they are still on their feet and still hunted, and the Hollow stands where it struck',
    healthBefore === hit.other.of && hit.other.mode === 'playing' && Math.abs(hit.other.health - (healthBefore - hit.other.takes)) < 0.01 && hit.other.takes < hit.other.of &&
    hit.host.mode === 'playing' && hit.host.health === hit.other.of && !hit.host.isDown && hit.host.standsFor > 0 && hit.host.standsFor <= hit.host.of && hit.host.metresAway < 1, hit);
  // The hit that takes the last of it is their death, in their own game; the host plays on, and then the Hollow is sent away.
  await b.evaluate(() => { window.lastReturnDebug.player.hurtGraceSeconds = 0; });
  await reach();
  await play(a, 0.2);
  await b.waitForFunction(() => window.lastReturnDebug.game.mode === 'dying' || window.lastReturnDebug.game.mode === 'dead', null, { timeout: 5000 }).catch(() => {});
  await both(0.6); // (their game says they are down, and the host's sends it off)
  const caught = { other: await b.evaluate(() => window.lastReturnDebug.game.mode),
    host: await a.evaluate(() => { const d = window.lastReturnDebug, other = d.together.others[0]; return { mode: d.game.mode, isDown: other.isDown, players: d.players.length, metresAway: Math.hypot(d.hollow.figure.x - other.x, d.hollow.figure.z - other.z) }; }) };
  check('the hit that takes the last of their health is the other\'s death and nobody else\'s', (caught.other === 'dying' || caught.other === 'dead') && caught.host.mode === 'playing', caught);
  check('and it does not stand over them: it is sent off, and they are not hunted while they are down', caught.host.isDown && caught.host.metresAway > 6, caught);
  await a.evaluate(() => { window.lastReturnDebug.hollow.isActive = false; });
  // The station does not stop for the dead, and there is no checkpoint to come back from.
  await drawUntilDead(b);
  const timeBefore = await b.evaluate(() => window.lastReturnDebug.game.time);
  for (let count = 0; count < 4; count++) await b.screenshot({ type: 'jpeg', quality: 5 });
  check('the station goes on while you lie dead', await b.evaluate((before) => window.lastReturnDebug.game.time > before, timeBefore));
  const noWayBack = await b.evaluate(() => { const d = window.lastReturnDebug; d.retryFromCheckpoint(); return { mode: d.game.mode, retryHidden: document.getElementById('button-retry').hidden, told: document.getElementById('death-lines').textContent }; });
  check('down there with others there is no checkpoint to come back from: it is for the others to carry your scanner back',
    noWayBack.mode === 'dead' && noWayBack.retryHidden && /carries it into the lift car/.test(noWayBack.told), noWayBack);
  // Their scanner lies where they fell, in both games, lit; their body is gone.
  await b.evaluate(() => { for (let count = 0; count < 3; count++) window.lastReturnDebug.updateTogether(0.1); });
  await a.waitForFunction(() => window.lastReturnDebug.together.others[0].isFallen && window.lastReturnDebug.looseObjects.some((object) => object.fallenPlayerId > 0), null, { timeout: 5000 }).catch(() => {});
  const fallen = await a.evaluate(() => {
    const d = window.lastReturnDebug, other = d.together.others[0], scanner = d.looseObjects.filter((object) => object.fallenPlayerId === other.id)[0], writtenBefore = d.pointCloud.writeIndex;
    d.updateTogether(0.1);
    return { isFallen: other.isFallen, bodyHit: d.fireScanPulse(other.x, other.eyeY - 0.4, other.z + 0.9, 0, 0, -1, false) && d.rayHit.figure === other.figure, light: (d.pointCloud.writeIndex - writtenBefore + d.pointCloud.capacity) % d.pointCloud.capacity,
      scanner: scanner ? { id: scanner.id, metresFromThem: Math.hypot(scanner.x - other.x, scanner.z - other.z) } : null };
  });
  const scannerInTheirs = await b.evaluate((id) => window.lastReturnDebug.looseObjects.some((object) => object.id === id && object.fallenPlayerId === window.lastReturnDebug.together.myId), fallen.scanner ? fallen.scanner.id : -1);
  check('dead, their body is gone and their scanner lies where they fell, still lit, the same thing in both games',
    fallen.isFallen && !fallen.bodyHit && fallen.light > 0 && fallen.scanner !== null && fallen.scanner.metresFromThem < 0.5 && scannerInTheirs, fallen);
  // ---- Dead, they watch the host (src/js/11-watching.js) ----
  const offered = await b.evaluate(() => { const d = window.lastReturnDebug; return { button: !document.getElementById('button-watch').hidden, told: document.getElementById('death-lines').textContent,
    leave: document.getElementById('button-death-restart').textContent, offeredAt: d.watching.offeredAt >= 0, isOn: d.watching.isOn, canWatch: d.canWatchSomebody(), screen: !document.getElementById('screen-death').hidden }; });
  check('the death screen offers to watch the others, and its other button says what it does down there with others: you leave, they play on',
    offered.screen && offered.button && /through their scanners/.test(offered.told) && offered.leave === 'Leave the descent' && offered.offeredAt && !offered.isOn && offered.canWatch, offered);
  // The host goes and stands far from where they fell, looking some way or other.
  await a.evaluate(() => {
    const d = window.lastReturnDebug, other = d.together.others[0];
    let best = null, bestMetres = -1;
    for (const waypoint of d.roamingWaypoints) { const metres = Math.hypot(waypoint[0] - other.x, waypoint[1] - other.z); if (metres > bestMetres) { bestMetres = metres; best = waypoint; } }
    d.teleport(best[0], best[1], 1.1); d.player.pitch = -0.2;
  });
  await both(0.6);
  // It begins by itself when the death screen has stood its time. (The time is pushed on here: a frame of this
  // page takes long, and its clock goes by frames.)
  const began = await b.evaluate(() => {
    const d = window.lastReturnDebug, result = {};
    d.updateWatching(0.05); result.notAtOnce = !d.watching.isOn; result.counting = document.getElementById('button-watch').textContent;
    d.game.realTime += 10;
    d.updateWatching(0.05);
    const other = d.together.others[0];
    result.isOn = d.watching.isOn; result.id = d.watching.id; result.theirId = other.id; result.mode = d.game.mode;
    result.screen = !document.getElementById('screen-death').hidden; result.hud = !document.getElementById('hud').hidden; result.bar = !document.getElementById('watch-bar').hidden;
    result.name = document.getElementById('watch-name').textContent; result.note = document.getElementById('watch-note').textContent;
    result.nextButton = !document.getElementById('button-watch-next').hidden; result.leave = document.getElementById('button-watch-leave').textContent;
    result.ownInstruments = window.getComputedStyle(document.getElementById('hud-block-instruments')).display;
    result.viewerIsThem = d.getViewer() === other;
    d.aimCameraAtWatched(d.renderCamera, 0.016);
    result.metresFromTheirEyes = Math.hypot(d.renderCamera.x - other.x, d.renderCamera.y - other.eyeY, d.renderCamera.z - other.z);
    result.yawOff = Math.abs(Math.atan2(Math.sin(d.renderCamera.yaw - other.yaw), Math.cos(d.renderCamera.yaw - other.yaw))); result.pitchOff = Math.abs(d.renderCamera.pitch - other.pitch);
    result.metresFromYourBody = Math.hypot(d.renderCamera.x - d.player.x, d.renderCamera.z - d.player.z);
    // What is heard, and how far off, is measured from where they stand: a tick beside them, and one beside your body.
    d.settings.captions = 'all'; d.clearCaptions();
    result.heardBesideThem = d.showCaption('tripodPulse', { x: other.x + 1, z: other.z });
    d.clearCaptions();
    result.heardBesideYourBody = d.showCaption('tripodPulse', { x: d.player.x + 1, z: d.player.z });
    result.withinMetres = d.captions.tripodPulse.withinMetres;
    return result;
  });
  check('watching does not begin at once (the button counts down), and then begins by itself: the death screen goes, and a bar says whom you are watching and how you come back',
    began.notAtOnce && /Watch the others \(\d\)/.test(began.counting) && began.isOn && began.id === began.theirId && began.mode === 'dead' && !began.screen && began.hud && began.bar && began.name === 'Mara' &&
    /carries it into the lift car/.test(began.note) && !began.nextButton && began.leave === 'Leave the descent' && began.ownInstruments === 'none', began);
  check('you see from their eyes, looking where they look, far from where your own body lies; and what you hear is measured from where they stand',
    began.viewerIsThem && began.metresFromTheirEyes < 0.01 && began.yawOff < 0.01 && began.pitchOff < 0.01 && began.metresFromYourBody > began.withinMetres + 2 && began.heardBesideThem && !began.heardBesideYourBody, began);
  // They move and turn: your view goes with them, closing in rather than jumping.
  await a.evaluate(() => { const d = window.lastReturnDebug, spot = d.findWalkableSpotNear(d.player.x + 2, d.player.z + 1); d.teleport(spot.x, spot.z, -0.6); d.player.pitch = 0.25; });
  await both(0.6);
  const followed2 = await b.evaluate(() => {
    const d = window.lastReturnDebug, other = d.together.others[0], result = {};
    const off = () => Math.hypot(d.renderCamera.x - other.x, d.renderCamera.z - other.z) + Math.abs(Math.atan2(Math.sin(d.renderCamera.yaw - other.yaw), Math.cos(d.renderCamera.yaw - other.yaw)));
    // (Your view is put back to where they were, as if they had only just moved: a frame drawn meanwhile may
    // have followed them some of the way already, and how far is the clock's business.)
    d.watching.x = other.x - 2; d.watching.z = other.z - 1; d.watching.yaw = other.yaw + 1.7; d.watching.pitch = other.pitch - 0.45;
    d.aimCameraAtWatched(d.renderCamera, 0); result.before = off();
    d.aimCameraAtWatched(d.renderCamera, 1 / 60); result.afterOneFrame = off();
    for (let frame = 0; frame < 40; frame++) d.aimCameraAtWatched(d.renderCamera, 1 / 60);
    result.afterTwoThirdsOfASecond = off();
    // With nobody else to go to, the keys for the next of them leave you where you are.
    d.takeKeyForWatching('KeyD'); d.takeKeyForWatching('ArrowLeft');
    result.stillThem = d.watching.id === other.id;
    return result;
  });
  check('when they move and turn your view goes with them, closing in on theirs and not jumping to it',
    followed2.before > 1 && followed2.afterOneFrame < followed2.before && followed2.afterOneFrame > followed2.before * 0.3 && followed2.afterTwoThirdsOfASecond < 0.01 && followed2.stillThem, followed2);
  // Drawn, it is their view that is drawn, and not black as the dead see.
  for (let count = 0; count < 4; count++) await b.screenshot({ type: 'jpeg', quality: 5 });
  const drawn = await b.evaluate(() => { const d = window.lastReturnDebug, other = d.together.others[0]; return { fade: d.frameState.fade, metresFromTheirEyes: Math.hypot(d.renderCamera.x - other.x, d.renderCamera.z - other.z), mode: d.game.mode, isOn: d.watching.isOn }; });
  check('a frame drawn while you watch is drawn from where they stand, and it is not the black of the dead', drawn.isOn && drawn.mode === 'dead' && drawn.fade > 0 && drawn.metresFromTheirEyes < 0.5, drawn);
  // Dead, you can still talk, and the others see that it is somebody who is down talking.
  await b.evaluate(() => { window.lastReturnDebug.sendChat('carry me back'); });
  await a.waitForFunction(() => window.lastReturnDebug.chat.lines.some((line) => line.text === 'carry me back'), null, { timeout: 5000 }).catch(() => {});
  const fromTheDead = { host: (await linesIn(a)).filter((line) => line.text === 'carry me back' || /is down/.test(line.text)), own: (await linesIn(b)).filter((line) => line.text === 'carry me back') };
  check('the dead can talk: their line is marked as from somebody who is down, and the log said when they fell',
    fromTheDead.host.some((line) => line.who === 'Player 2 (down)' && line.kind === 'said') && fromTheDead.host.some((line) => line.kind === 'note' && /Player 2 is down/.test(line.text)) && fromTheDead.own.length === 1 && fromTheDead.own[0].who === 'Player 2 (down)', fromTheDead);
  // The dead are not heard by the living; they hear the living from where the one they are watching stands; and the dead hear the dead.
  const deadVoicesBefore = await heardCount(a);
  await speak(b, 3, {});
  await a.waitForFunction((before) => window.lastReturnDebug.voice.statistics.heard >= before + 3, deadVoicesBefore, { polling: 100, timeout: 5000 }).catch(() => {});
  const fromTheDown = await heardBy(a, 2);
  const livingBefore = await heardCount(b);
  await speak(a, 3, {});
  await b.waitForFunction((before) => window.lastReturnDebug.voice.statistics.heard >= before + 3, livingBefore, { polling: 100, timeout: 5000 }).catch(() => {});
  const fromTheLiving = await heardBy(b, 1);
  const amongTheDead = await b.evaluate(() => {
    const d = window.lastReturnDebug, talker = d.getVoiceTalker(1), placeBefore = talker.place;
    talker.place = 2; // (as if the host were down too)
    const got = d.getVoiceHearing(talker, false), result = { placed: got.placed, plain: got.plain, ownPlace: d.getOwnVoicePlace() };
    talker.place = placeBefore;
    return result;
  });
  check('the dead are not heard by the living, and are not shown as talking; they hear the living from where the one they are watching stands; and the dead hear the dead plainly',
    fromTheDown.place === 2 && fromTheDown.placed === 0 && fromTheDown.plain === 0 && !/Player 2/.test(fromTheDown.shown) &&
    fromTheLiving.place === 1 && fromTheLiving.placed > 0.99 && fromTheLiving.plain === 0 && fromTheLiving.metres < 0.5 && amongTheDead.ownPlace === 2 && amongTheDead.plain === 1 && amongTheDead.placed === 0, [fromTheDown, fromTheLiving, amongTheDead]);
  const stillDown = await a.evaluate(() => { const d = window.lastReturnDebug, other = d.together.others[0]; return { isFallen: other.isFallen, players: d.players.length }; });
  check('watching changes nothing for the others: you are as down as you were, and nothing hunts you', stillDown.isFallen && stillDown.players === 1, stillDown);

  // The host carries it into the lift car and puts it down. It restarts, and they are on their feet there.
  await a.evaluate((id) => {
    const d = window.lastReturnDebug, scanner = d.looseObjects.filter((object) => object.id === id)[0];
    const spot = d.findWalkableSpotNear(scanner.x + 1, scanner.z) || d.findWalkableSpotNear(scanner.x, scanner.z + 1);
    d.teleport(spot.x, spot.z, Math.atan2(scanner.x - spot.x, -(scanner.z - spot.z))); d.player.pitch = -0.6;
    d.simulate(0.1);
    d.pickUpLooseObject(scanner, false);
  }, fallen.scanner.id);
  await a.waitForFunction(() => window.lastReturnDebug.getHeldLooseObject() !== null, null, { timeout: 5000 }).catch(() => {});
  await both(0.6);
  const notYet = await b.evaluate(() => window.lastReturnDebug.game.mode);
  await a.evaluate(() => {
    const d = window.lastReturnDebug;
    // Into the lift car, which has stayed: that is where a scanner restarts.
    const best = { x: d.playerStart.x, z: d.playerStart.z };
    d.teleport(best.x, best.z, d.player.yaw); d.player.pitch = -0.4;
    // (The walk there is left out: what is in the beam is brought along, as it would have come.)
    const carried = d.getHeldLooseObject();
    carried.x = d.player.x; carried.y = d.getPlayerEyeY() - 0.3; carried.z = d.player.z; carried.velocityX = 0; carried.velocityY = 0; carried.velocityZ = 0;
    d.simulate(1.5);
    d.releaseHeldLooseObject(0);
  });
  for (let turn = 0; turn < 24; turn++) { await both(0.9); if (await b.evaluate(() => window.lastReturnDebug.game.mode === 'playing')) break; }
  // (The host counts them as a player again at its next turn, not in the moment it hears they are up.)
  await play(a, 0.1);
  const restarted = { other: await b.evaluate(() => { const d = window.lastReturnDebug; return { mode: d.game.mode, metresFromCar: Math.hypot(d.player.x - d.playerStart.x, d.player.z - d.playerStart.z), scanners: d.looseObjects.filter((object) => object.fallenPlayerId > 0).length }; }),
    host: await a.evaluate(() => { const d = window.lastReturnDebug; return { players: d.players.length, isDown: d.together.others[0].isDown, isFallen: d.together.others[0].isFallen, scanners: d.looseObjects.filter((object) => object.fallenPlayerId > 0).length }; }) };
  check('carried, it does nothing; put down in the lift car, it restarts and they are on their feet there, and one of the players again',
    notYet === 'dead' && restarted.other.mode === 'playing' && restarted.other.metresFromCar < 2.2 && restarted.other.scanners === 0 && restarted.host.scanners === 0 && restarted.host.players === 2 && !restarted.host.isDown, [notYet, restarted]);
  const ownEyes = await b.evaluate(() => { const d = window.lastReturnDebug; d.updateWatching(0.05); return { isOn: d.watching.isOn, bar: !document.getElementById('watch-bar').hidden, hud: !document.getElementById('hud').hidden,
    instruments: window.getComputedStyle(document.getElementById('hud-block-instruments')).display, viewerIsYou: d.getViewer() === d.player, screen: !document.getElementById('screen-death').hidden }; });
  const toldTheHost = (await linesIn(a)).some((line) => line.kind === 'note' && /Player 2 is back on their feet/.test(line.text));
  check('on their feet again they have their own eyes back: the bar is gone, their instruments are there, and the others\' log says they are up',
    !ownEyes.isOn && !ownEyes.bar && ownEyes.hud && ownEyes.instruments !== 'none' && ownEyes.viewerIsYou && !ownEyes.screen && toldTheHost, [ownEyes, toldTheHost]);

  // What one of you does to the station is done in every game: the other takes the first keycard.
  const taken = await b.evaluate(() => {
    const d = window.lastReturnDebug;
    d.clearMessages();
    d.askToAct({ what: 'use', objectId: d.keycardObjectIds[1] });
    return d.game.flags.keycardLevel; // not yet: it is the host's to say
  });
  await a.waitForFunction(() => window.lastReturnDebug.game.flags.keycardLevel >= 1, null, { timeout: 5000 }).catch(() => {});
  await b.waitForFunction(() => window.lastReturnDebug.game.flags.keycardLevel >= 1, null, { timeout: 5000 }).catch(() => {});
  const card = { before: taken,
    host: await a.evaluate(() => { const d = window.lastReturnDebug; return { level: d.game.flags.keycardLevel, gone: !d.findInteractable(d.keycardObjectIds[1]).isAvailable, told: /Keycard( \d)? taken/.test(document.getElementById('hud-messages').textContent) }; }),
    other: await b.evaluate(() => { const d = window.lastReturnDebug; return { level: d.game.flags.keycardLevel, gone: !d.findInteractable(d.keycardObjectIds[1]).isAvailable, told: /Keycard( \d)? taken/.test(document.getElementById('hud-messages').textContent) }; }) };
  check('a keycard one of you takes is taken in every game, once the host has said so', card.before === 0 && card.host.level === 1 && card.other.level === 1 && card.host.gone && card.other.gone, card);
  // ("Keycard taken", that is. What Dispatch says about the card a moment later is for everybody.)
  check('and only the one who took it is told so', card.other.told && !card.host.told, card);

  // ---- Things that lie loose have one place, in every game ----
  const lying = async (page) => page.evaluate(() => window.lastReturnDebug.looseObjects.map((object) => [object.id, object.kindKey, Math.round(object.x * 100), Math.round(object.z * 100)].join(':')).join(','));
  const lyingA = await lying(a), lyingB = await lying(b);
  check('at the start every loose thing has the same number and lies in the same place in both games', lyingA.length > 20 && lyingA === lyingB, lyingA.length);
  const about = (page, id) => page.evaluate((id) => {
    const d = window.lastReturnDebug, object = d.looseObjects.filter((candidate) => candidate.id === id)[0];
    return object ? { x: object.x, y: object.y, z: object.z, heldById: object.heldById, ownerId: object.ownerId, isAsleep: object.isAsleep, worth: object.worth } : null;
  }, id);
  // How far a thing gets from where it is now, measured along the floor: watched from now until `endWatchingFlight`,
  // after every stretch of the game a check plays and at every frame the browser draws by itself in between.
  // (This is what says a thing was thrown. Where it comes to lie does not: thrown hard, it lies wherever what it
  // met on the way left it, and that is another place every run.)
  const watchFlight = (page, id) => page.evaluate((id) => {
    const d = window.lastReturnDebug, object = d.looseObjects.filter((candidate) => candidate.id === id)[0];
    const flight = window.watchedFlight = { fromX: object.x, fromZ: object.z, furthestMetres: 0, isWatched: true };
    const look = () => { flight.furthestMetres = Math.max(flight.furthestMetres, Math.hypot(object.x - flight.fromX, object.z - flight.fromZ)); };
    const simulate = d.simulate;
    d.simulate = (seconds) => { simulate(seconds); look(); };
    const lookAtEveryFrame = () => { if (!flight.isWatched) return; look(); window.requestAnimationFrame(lookAtEveryFrame); };
    window.requestAnimationFrame(lookAtEveryFrame);
    flight.end = () => { look(); flight.isWatched = false; d.simulate = simulate; return { fromX: flight.fromX, fromZ: flight.fromZ, furthestMetres: flight.furthestMetres }; };
  }, id);
  const endWatchingFlight = (page) => page.evaluate(() => window.watchedFlight.end());
  // The other takes something light into their beam, and walks off with it. In the host's game it goes with them.
  // (What they take is this suite's own: the test weight, put down in both games, in the same place, so that it has
  // the same number in both. One of the station's own light things may be any shape, and roll on where it is thrown.)
  for (const page of [a, b]) await installTogetherTestObjectKinds(page);
  // (Where it is put: on a straight stretch of level floor with nothing in the way at the height it lies at, the
  // height it is carried at and the height it flies at, for eight metres, whichever way that is in this station.
  // The other stands at one end of it, with the weight a little way in front, carries it two and a half metres
  // along the stretch and throws it on from there: it leaves the beam a little under four metres from where
  // they stood, with four more to fly before anything can be in its way.)
  // (The stretch is looked along from where they stand. It used to be five metres looked along from 0.6 m behind
  // them, and with a wall right behind them that look began inside the wall and saw nothing at all, not even the
  // wall three metres on. So a dead end of three metres was taken for the stretch: they walked into its far wall,
  // the weight hung pressed between them and it, and the only way to throw it was back through their own body.)
  const stretch = await b.evaluate(() => {
    const d = window.lastReturnDebug, p = d.player;
    const ways = [[1, 0], [-1, 0], [0, 1], [0, -1], [Math.SQRT1_2, Math.SQRT1_2], [-Math.SQRT1_2, -Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2], [-Math.SQRT1_2, Math.SQRT1_2]];
    for (let reach = 1; reach < 30; reach++) {
      for (let tileZ = Math.floor(p.z) - reach; tileZ <= Math.floor(p.z) + reach; tileZ++) {
        for (let tileX = Math.floor(p.x) - reach; tileX <= Math.floor(p.x) + reach; tileX++) {
          if (Math.max(Math.abs(tileX - Math.floor(p.x)), Math.abs(tileZ - Math.floor(p.z))) !== reach) continue; // (the ring at this distance)
          const x = tileX + 0.5, z = tileZ + 0.5;
          const floor = d.getFloorHeightAt(x, z);
          if (!d.isSpaceOpenAt(x, floor + 1, z)) continue;
          for (const way of ways) {
            const there = d.findWalkableSpotNear(x + way[0] * 3.5, z + way[1] * 3.5); // (the middle of a tile: within three quarters of a metre of the aim)
            if (!there || Math.hypot(there.x - x - way[0] * 3.5, there.z - z - way[1] * 3.5) > 0.75 || Math.abs(d.getFloorHeightAt(there.x, there.z) - floor) > 0.01) continue;
            // (Along the middle and along either side of it: what they carry hangs a little to one side, in front of the scanner in their right hand.)
            const isClearAt = (height, aside) => !d.castScannerRay(x - way[1] * aside, floor + height, z + way[0] * aside, way[0], 0, way[1], 8);
            if (!isClearAt(0.15, 0) || !isClearAt(0.9, 0) || !isClearAt(0.9, -0.4) || !isClearAt(0.9, 0.4) || !isClearAt(1.2, 0)) continue;
            // (And floor all the way, at the height they stand on: a look along a stretch goes over a pit and over a step down.)
            let isLevelFloor = true;
            for (let metres = 1; metres <= 8 && isLevelFloor; metres++) {
              const alongX = x + way[0] * metres, alongZ = z + way[1] * metres;
              isLevelFloor = Math.abs(d.getFloorHeightAt(alongX, alongZ) - floor) < 0.01 && (d.getTileFlagsAt(alongX, alongZ) & d.tileFlagPit) === 0;
            }
            if (!isLevelFloor) continue;
            return { x: x + way[0] * 1.2, z: z + way[1] * 1.2, y: floor + 0.2, standX: x, standZ: z, isFound: true };
          }
        }
      }
    }
    // (None: the check below says so. The weight is put down near them all the same, at their feet if need be, so that what follows has something to go on.)
    const spot = d.findWalkableSpotNear(p.x + 2, p.z) || d.findWalkableSpotNear(p.x, p.z + 2) || { x: p.x, z: p.z };
    return { x: spot.x, z: spot.z, y: d.getFloorHeightAt(spot.x, spot.z) + 0.2, isFound: false };
  });
  const lightIds = [];
  for (const page of [a, b]) lightIds.push(await page.evaluate((spot) => window.lastReturnDebug.createLooseObject('testWeight', spot.x, spot.y, spot.z, 0).id, stretch));
  for (let turn = 0; turn < 10; turn++) { await both(0.9); if ((await about(b, lightIds[1])).isAsleep && (await about(a, lightIds[0])).isAsleep) break; }
  const carriedId = await b.evaluate((stretch) => {
    const d = window.lastReturnDebug;
    d.game.flags.hasLeftLift = true;
    const light = d.looseObjects.filter((object) => object.id === stretch.id)[0];
    const spot = stretch.isFound ? { x: stretch.standX, z: stretch.standZ } : d.findWalkableSpotNear(light.x + 1.2, light.z) || d.findWalkableSpotNear(light.x, light.z + 1.2) || { x: light.x + 1.2, z: light.z };
    d.teleport(spot.x, spot.z, Math.atan2(light.x - spot.x, -(light.z - spot.z))); d.player.pitch = -0.5;
    d.simulate(0.1);
    d.pickUpLooseObject(light, false);
    return light.id;
  }, Object.assign({ id: lightIds[1] }, stretch));
  await b.waitForFunction(() => window.lastReturnDebug.getHeldLooseObject() !== null, null, { timeout: 5000 }).catch(() => {});
  const startedAt = await about(a, carriedId);
  // (They look up from the floor first. Looking down, what they carry hangs low enough to catch on what stands between here and there, and the beam loses it.)
  // (Where they go: along the stretch the weight was put on. Without one (the check below then fails and says so), they
  // are put at a place two to four and a half metres off with nothing in between at the height it is carried at, if
  // there is one, so that what follows has something to go on. A place that is merely the nearest floor to "three
  // metres east" may be the next tile.)
  await b.evaluate((stretch) => {
    const d = window.lastReturnDebug, p = d.player;
    p.pitch = 0;
    if (stretch.isFound) return; // (they walk along it below)
    let best = null;
    for (const way of [[3, 0], [-3, 0], [0, 3], [0, -3], [2.2, 2.2], [-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2]]) {
      const spot = d.findWalkableSpotNear(p.x + way[0], p.z + way[1]);
      if (!spot) continue;
      const metres = Math.hypot(spot.x - p.x, spot.z - p.z);
      if (metres < 2 || metres > 4.5) continue;
      const isClear = !d.castScannerRay(p.x, d.getFloorHeightAt(p.x, p.z) + 0.9, p.z, (spot.x - p.x) / metres, 0, (spot.z - p.z) / metres, metres + 1.5) || d.rayHit.looseObject === d.getHeldLooseObject();
      if (isClear) { best = spot; break; }
      if (!best) best = spot;
    }
    if (best) d.teleport(best.x, best.z);
  }, stretch);
  // (They walk for 1.2 seconds of their game, about two and a half metres, and no more: W is held only inside these
  // steps, so the frames their browser draws in between, as many as the machine manages, do not walk them further.)
  if (stretch.isFound) {
    for (let step = 0; step < 4; step++) {
      await b.evaluate(() => { const d = window.lastReturnDebug; d.input.keysDown.add('KeyW'); for (let time = 0; time < 0.3 - 1e-9; time += 0.1) { d.simulate(0.1); d.updateTogether(0.1); } d.input.keysDown.delete('KeyW'); });
      await play(a, 0.3); await pause(170);
    }
    await both(1.2);
  } else await both(2.4);
  const carriedB = await about(b, carriedId), carriedA = await about(a, carriedId);
  const ids = { host: await a.evaluate(() => window.lastReturnDebug.together.myId), other: await b.evaluate(() => window.lastReturnDebug.together.myId) };
  check('what the other takes into their beam is theirs to move, and in the host\'s game it goes where they carry it',
    stretch.isFound && lightIds[0] === lightIds[1] && carriedA.heldById === ids.other && carriedA.ownerId === ids.other && Math.hypot(carriedA.x - startedAt.x, carriedA.z - startedAt.z) > 1 &&
    Math.hypot(carriedA.x - carriedB.x, carriedA.y - carriedB.y, carriedA.z - carriedB.z) < 0.5,
    stretch.isFound ? [lightIds, startedAt, carriedA, carriedB] : ['no straight stretch of eight metres of level floor with nothing in the way within thirty metres of the other in station ' + lobbySeed, carriedA]);
  // They throw it. Where it comes to lie is the same place in both games, and it is the host's to move again.
  // (That it was thrown is read from how far it flew in the game that threw it, not from where it lies: see watchFlight.)
  // (The host comes within earshot first: a knock is put on the screen from twenty metres at most, and where the
  // checks above left the host depends on the station. And not into the way of the throw: the host stands where
  // the other stood when they took the weight, which is behind them now. A thrown thing that meets somebody's
  // body stops there. Without a stretch, the host stands somewhere near them.)
  const thrower = await b.evaluate(() => ({ x: window.lastReturnDebug.player.x, z: window.lastReturnDebug.player.z }));
  await a.evaluate((thrower) => {
    const d = window.lastReturnDebug;
    if (thrower.isOnStretch) { d.teleport(thrower.standX, thrower.standZ, 0); return; }
    for (const way of [[-2.5, 0], [0, -2.5], [2.5, 0], [0, 2.5], [-4, 0], [0, -4]]) {
      const spot = d.findWalkableSpotNear(thrower.x + way[0], thrower.z + way[1]);
      if (spot && Math.hypot(spot.x - thrower.x, spot.z - thrower.z) > 1.2 && Math.hypot(spot.x - thrower.x, spot.z - thrower.z) < 8) { d.teleport(spot.x, spot.z, 0); return; }
    }
  }, Object.assign({ isOnStretch: stretch.isFound, standX: stretch.standX, standZ: stretch.standZ }, thrower));
  await both(0.3);
  const knocksBefore = await a.evaluate(() => { const d = window.lastReturnDebug; return (d.captionCounts.objectKnock || 0) + (d.captionCounts.objectCrash || 0); });
  // (Thrown on along the stretch, the way they face and the way it hangs in front of them, as hard as the beam
  // throws, and level, so that it flies no higher than the stretch was looked along. It used to be thrown
  // back the way they came, in the same moment as they turned round. It still hung on the far side of them then,
  // so it left at eight metres a second straight into their own body, was down to less than one a frame later,
  // and came to lie wherever it slid off them: now more than half a metre from where it had hung, now less.)
  for (const page of [a, b]) await watchFlight(page, carriedId);
  await b.evaluate(() => { const d = window.lastReturnDebug; d.player.pitch = 0; d.releaseHeldLooseObject(1); });
  for (let turn = 0; turn < 14; turn++) { await both(0.9); if ((await about(b, carriedId)).isAsleep && (await about(a, carriedId)).isAsleep) break; }
  const landedB = await about(b, carriedId), landedA = await about(a, carriedId);
  const flownB = await endWatchingFlight(b), flownA = await endWatchingFlight(a);
  // (Thrown: more than two metres from where it left the beam, at some moment, in the game that moves it. The
  // stretch gives it four. Only let go of, it falls where it hung. What the host's game saw of it is written
  // beside it and not asked for: that game is told where the thing is a few times a second, not at every step.)
  check('thrown, it comes to lie in the same place in both games, and is the host\'s again',
    landedA.isAsleep && landedB.isAsleep && Math.hypot(landedA.x - landedB.x, landedA.y - landedB.y, landedA.z - landedB.z) < 0.02 &&
    landedA.heldById === 0 && landedA.ownerId === ids.host && landedB.ownerId === ids.host && flownB.furthestMetres > 2, [landedA, landedB, { flownInTheOthersGame: flownB, flownInTheHostsGame: flownA }]);
  const knocksHeard = await a.evaluate((before) => { const d = window.lastReturnDebug; return (d.captionCounts.objectKnock || 0) + (d.captionCounts.objectCrash || 0) - before; }, knocksBefore);
  check('the host hears it land, though it was the other\'s browser that moved it', knocksHeard >= 1, knocksHeard);
  // Something too heavy to shove is put down in both games, in the same place (so it has the same number in both):
  // this suite's own heavy block, as heavy as the game says stops you. It is the host's to move. The other walks at
  // it for two seconds: it stops them, as it would stop the host.
  const heavyBlockSpot = await a.evaluate(() => { const d = window.lastReturnDebug; const spot = d.findWalkableSpotNear(d.player.x + 2, d.player.z) || d.findWalkableSpotNear(d.player.x, d.player.z + 2); return spot ? { x: spot.x, z: spot.z, y: d.getFloorHeightAt(spot.x, spot.z) + 0.5 } : null; });
  const heavyBlockIds = [];
  // (Without a walkable place near the host there is nothing put down: the check below says so.)
  if (heavyBlockSpot) for (const page of [a, b]) heavyBlockIds.push(await page.evaluate((spot) => window.lastReturnDebug.createLooseObject('testHeavyBlock', spot.x, spot.y, spot.z, 0).id, heavyBlockSpot));
  if (heavyBlockSpot) for (let turn = 0; turn < 10; turn++) { await both(0.9); if ((await about(b, heavyBlockIds[1])).isAsleep && (await about(a, heavyBlockIds[0])).isAsleep) break; }
  const walkedInto = await b.evaluate((id) => {
    const d = window.lastReturnDebug, heavy = d.looseObjects.filter((object) => object.id === id)[0];
    if (!heavy) return null;
    let from = null;
    for (const way of [[1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6]]) {
      const spot = d.findWalkableSpotNear(heavy.x + way[0], heavy.z + way[1]);
      if (spot && Math.hypot(spot.x - heavy.x, spot.z - heavy.z) > 1.1 && Math.hypot(spot.x - heavy.x, spot.z - heavy.z) < 2.2) { from = spot; break; }
    }
    if (!from) return null;
    d.teleport(from.x, from.z, Math.atan2(heavy.x - from.x, -(heavy.z - from.z))); d.player.pitch = 0;
    d.player.velocityX = 0; d.player.velocityZ = 0;
    const startMetres = Math.hypot(from.x - heavy.x, from.z - heavy.z);
    d.input.keysDown.add('KeyW');
    d.simulate(2);
    d.input.keysDown.delete('KeyW');
    return { isAsleep: heavy.isAsleep, playerRadius: d.tuning.playerRadius, startMetres: startMetres, endMetres: Math.hypot(d.player.x - heavy.x, d.player.z - heavy.z), isTheHosts: (heavy.ownerId || d.together.hostId) !== d.together.myId };
  }, heavyBlockIds[1]);
  // (Stopped means no nearer to its middle than half its width and their own radius, which is where they touch it,
  // less five centimetres: a step can press in that far before the push back is given. They walk at it square on,
  // and a block turned a little only keeps them further off.)
  const touchingMetres = TEST_OBJECT_KINDS.testHeavyBlock.parts[0].half[0] + (walkedInto ? walkedInto.playerRadius : 0);
  check('something heavy that the host\'s game moves stops the other walking through it',
    heavyBlockIds[0] === heavyBlockIds[1] && walkedInto !== null && walkedInto.isTheHosts && walkedInto.endMetres > touchingMetres - 0.05 && walkedInto.endMetres < walkedInto.startMetres - 0.3,
    heavyBlockSpot ? [heavyBlockIds, touchingMetres, walkedInto] : 'no walkable place near the host to put the heavy block in station ' + lobbySeed);
  // (Taken away again, so that it is not in the way of what comes next: a crate let go of further down landed on it.)
  for (const page of [a, b]) await page.evaluate((id) => { const d = window.lastReturnDebug, heavy = d.looseObjects.filter((object) => object.id === id)[0]; if (heavy) d.removeLooseObject(heavy); }, heavyBlockIds[0]);
  // A crate with things in it, carried by the other. While they carry it the crate is theirs to move, and what is
  // in it is the host's. So it is the host's game that has to keep those things in a crate that somebody else
  // moves, and the other's game that has to feel their weight on the beam. (The crate is this suite's own: five
  // boards. It is put down in both games, in the same place, and so is what goes in it.)
  // These turns are finer than the rest: a tenth of a second each, which is about how often a browser says
  // where its things are. In turns of a third of a second the crate would jump a stride at a time in the host's
  // game and leave what is in it standing in the air, and that would be the turns' doing, not the game's.
  const fine = async (seconds) => { for (let time = 0; time < seconds; time += 0.1) { await play(a, 0.1); await play(b, 0.1); await pause(60); } };
  // A straight stretch of plain floor, six metres of it with nothing on it and nobody in it: where to stand, and
  // which way to walk. What lies loose in it or near it is taken away, in both games.
  const lane = await a.evaluate(() => {
    const d = window.lastReturnDebug;
    const isPlain = (x, z, floor) => d.isSpaceOpenAt(x, floor + 0.3, z) && d.isSpaceOpenAt(x, floor + 1.6, z) && Math.abs(d.getFloorHeightAt(x, z) - floor) < 0.01 && d.getTileFlagsAt(x, z) === 0 && !d.isVentAt(x, z);
    for (let reach = 2; reach < 40; reach++) {
      for (let tileZ = Math.floor(d.player.z) - reach; tileZ <= Math.floor(d.player.z) + reach; tileZ++) {
        for (let tileX = Math.floor(d.player.x) - reach; tileX <= Math.floor(d.player.x) + reach; tileX++) {
          if (Math.max(Math.abs(tileX - Math.floor(d.player.x)), Math.abs(tileZ - Math.floor(d.player.z))) !== reach) continue; // (the ring at this distance)
          const x = tileX + 0.5, z = tileZ + 0.5;
          const floor = d.getFloorHeightAt(x, z);
          if (!d.isSpaceOpenAt(x, floor + 1, z)) continue;
          for (const way of [[1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2], [0, 1, Math.PI], [0, -1, 0]]) {
            let isClear = true;
            for (let step = -1; step <= 6 && isClear; step++) for (const aside of [-1, 0, 1]) if (!isPlain(x + way[0] * step - way[1] * aside, z + way[1] * step + way[0] * aside, floor)) isClear = false;
            // (Nothing standing in it or beside it, at whatever height below the ceiling: a shelf board at knee
            // height is what a carried crate catches on.)
            for (const prop of d.worldProps) {
              if (!isClear || prop.isRemoved || prop.minimumY > floor + 2 || prop.maximumY < floor + 0.02) continue;
              const along = (prop.centerX - x) * way[0] + (prop.centerZ - z) * way[1], across = Math.abs((prop.centerX - x) * way[1] - (prop.centerZ - z) * way[0]);
              const reach = Math.max(prop.boundsHalfX, prop.boundsHalfZ);
              if (along > -1.5 - reach && along < 7 + reach && across < 1.4 + reach) isClear = false;
            }
            // (Nothing lying near it, and the host not standing in it: a crate set down against somebody's legs does not come to rest.
            // What lies there is taken away below; the host is not.)
            const isNear = (object) => { const along = (object.x - x) * way[0] + (object.z - z) * way[1], across = Math.abs((object.x - x) * way[1] - (object.z - z) * way[0]); return along > -2 && along < 7.5 && across < 2; };
            if (isNear(d.player)) isClear = false;
            if (isClear) return { x: x, z: z, floor: floor, wayX: way[0], wayZ: way[1], yaw: way[2], lyingInIt: d.looseObjects.filter(isNear).map((object) => object.id) };
          }
        }
      }
    }
    return null;
  });
  const crateIds = [];
  if (lane === null) check('a crate with things in it is carried and set down the same in both games', false, 'no straight stretch of six metres of plain floor within forty metres of the host in station ' + lobbySeed);
  else {
    for (const page of [a, b]) await page.evaluate((ids) => { const d = window.lastReturnDebug; for (const object of d.looseObjects.filter((candidate) => ids.indexOf(candidate.id) >= 0)) d.removeLooseObject(object); }, lane.lyingInIt);
    // The heavy thing in it is this suite's own as well: the test weight, a block of three kilograms. (It used to be
    // the game's gas canister, which is the workshop's to reshape: made a rod with round ends, it rolled about in the
    // crate and never came to rest, and this check failed for a thing that has nothing to do with playing together.)
    // The two light things beside it are this suite's small blocks; they used to be two of the game's empty cans.
    for (const page of [a, b]) crateIds.push(await page.evaluate((lane) => {
      const d = window.lastReturnDebug;
      const x = lane.x + lane.wayX * 1.7, z = lane.z + lane.wayZ * 1.7;
      const crate = d.createLooseObject('testCrate', x, lane.floor + 0.24, z, 0);
      return [crate.id, d.createLooseObject('testSmallBlock', x - 0.12, lane.floor + 0.2, z - 0.1, 0).id, d.createLooseObject('testSmallBlock', x + 0.12, lane.floor + 0.2, z - 0.1, 1).id, d.createLooseObject('testWeight', x, lane.floor + 0.35, z + 0.1, 0).id];
    }, lane));
    // What the crate and its things are doing in one game: where each thing is in the crate's own frame (from the
    // middle of the top of its bottom board), and whether it is in it.
    const crateIn = (page) => page.evaluate((ids) => {
      const d = window.lastReturnDebug, find = (id) => d.looseObjects.filter((object) => object.id === id)[0];
      const crate = find(ids[0]), round = (value) => Math.round(value * 1000) / 1000;
      if (!crate) return null;
      const m = crate.matrix, board = crate.prepared.boxes[4];
      const things = ids.slice(1).map((id) => {
        const thing = find(id);
        if (!thing) return { isGone: true, isInIt: false, isAsleep: false };
        const x = thing.x - crate.x, y = thing.y - crate.y, z = thing.z - crate.z;
        const at = [m[0] * x + m[3] * y + m[6] * z - board.centerX, m[1] * x + m[4] * y + m[7] * z - board.centerY - board.halfY, m[2] * x + m[5] * y + m[8] * z - board.centerZ];
        return { at: at.map(round), isInIt: Math.abs(at[0]) < 0.24 && Math.abs(at[2]) < 0.24 && at[1] > -0.02 && at[1] < 0.6, isAsleep: thing.isAsleep, x: round(thing.x), y: round(thing.y), z: round(thing.z), ownerId: thing.ownerId, mass: thing.kind.mass };
      });
      return { x: round(crate.x), y: round(crate.y), z: round(crate.z), heldById: crate.heldById, ownerId: crate.ownerId, isAsleep: crate.isAsleep, things: things, inIt: things.filter((thing) => thing.isInIt).length,
        asleep: things.filter((thing) => thing.isAsleep).length, held: d.getHeldLooseObject() === crate, crateMass: crate.kind.mass, load: round(d.looseState.heldLoad), speedFactor: round(d.getCarrySpeedFactor()) };
    }, crateIds[0]);
    const crateAtRest = async (seconds) => {
      for (let time = 0; time < seconds; time += 0.5) {
        await fine(0.5);
        const inA = await crateIn(a), inB = await crateIn(b);
        if (inA && inB && inA.isAsleep && inB.isAsleep && inA.asleep === inA.things.length && inB.asleep === inB.things.length) return true;
      }
      return false;
    };
    const crateFilled = { atRest: await crateAtRest(8), host: await crateIn(a), other: await crateIn(b) };
    // The other takes the crate into their beam, lifts it, walks six strides with it, stops, and stands.
    // And over a slow line: everything the host says reaches the other six tenths of a second late. So the host's
    // word that the things in the crate are the other's to move ('carry') comes when their beam has long lifted
    // the crate clear of where it stood, and where the host says those things are is where the crate was more than
    // half a second ago. (Between two windows on one machine the answer comes at once, and what this is about
    // hardly showed: on a slow machine, or with any real distance between two browsers, the things were left
    // standing where the crate had been.)
    await a.evaluate(() => {
      const socket = window.lastReturnDebug.together.socket, send = socket.send.bind(socket);
      window.undoSlowLine = () => { socket.send = send; };
      socket.send = (text) => { setTimeout(() => send(text), 600); }; // (all of it by the same wait, so in the order it was said)
    });
    await b.evaluate((lane) => { const d = window.lastReturnDebug; d.input.keysDown.clear(); d.teleport(lane.x, lane.z, lane.yaw); d.player.pitch = -0.3; d.player.velocityX = 0; d.player.velocityZ = 0; d.simulate(0.1); }, lane);
    await b.evaluate((id) => { const d = window.lastReturnDebug; d.pickUpLooseObject(d.looseObjects.filter((object) => object.id === id)[0], false); }, crateIds[0][0]);
    await b.waitForFunction(() => window.lastReturnDebug.getHeldLooseObject() !== null, null, { timeout: 5000 }).catch(() => {});
    await fine(1.5);
    const crateLifted = { host: await crateIn(a), other: await crateIn(b) };
    let fewestInItForHost = 9, mostAsleepForHost = 0, fewestInItForOther = 9;
    const carryCrate = async (seconds) => {
      for (let time = 0; time < seconds; time += 0.3) {
        await fine(0.3);
        const inA = await crateIn(a), inB = await crateIn(b);
        fewestInItForHost = Math.min(fewestInItForHost, inA.inIt); mostAsleepForHost = Math.max(mostAsleepForHost, inA.asleep); fewestInItForOther = Math.min(fewestInItForOther, inB.inIt);
      }
    };
    await b.evaluate(() => window.lastReturnDebug.input.keysDown.add('KeyW'));
    await carryCrate(1.5);
    await b.evaluate(() => window.lastReturnDebug.input.keysDown.clear());
    await carryCrate(2.4);
    const crateCarried = { host: await crateIn(a), other: await crateIn(b), fewestInItForHost: fewestInItForHost, mostAsleepForHost: mostAsleepForHost, fewestInItForOther: fewestInItForOther };
    // They set it down: look at the floor, let go.
    await b.evaluate(() => { window.lastReturnDebug.player.pitch = -0.75; });
    await fine(1.2);
    await b.evaluate(() => window.lastReturnDebug.releaseHeldLooseObject(0));
    const crateSetDown = { atRest: await crateAtRest(12), host: await crateIn(a), other: await crateIn(b) };
    const crateWeight = crateFilled.host ? crateFilled.host.things.reduce((sum, thing) => sum + (thing.mass || 0), 0) : 0;
    const slowdownPerKilogram = await b.evaluate(() => window.lastReturnDebug.tuning.carrySlowdownPerKilogram);
    check('a crate with two small blocks and something heavy in it is the same crate in both games, with the same things in it',
      crateIds[0].length === 4 && crateIds[0].join() === crateIds[1].join() && crateFilled.atRest && crateFilled.host.inIt === 3 && crateFilled.other.inIt === 3, [lane, crateIds, crateFilled]);
    check('over a slow line, what is in the crate is kept in it until the host has said it is the other\'s: lifted, all of it is in the crate in both games, and theirs to move',
      crateLifted.other.inIt === 3 && crateLifted.host.inIt === 3 && crateLifted.other.things.every((thing) => thing.ownerId === ids.other) && crateLifted.host.things.every((thing) => thing.ownerId === ids.other),
      [crateLifted.other.things.map((thing) => [thing.isInIt, thing.ownerId]), crateLifted.host.things.map((thing) => [thing.isInIt, thing.ownerId])]);
    check('the other carries it: in the host\'s game, where what is in it is the host\'s to move, all of it stays in the crate and goes where the crate goes, and none of it comes to rest on the way',
      crateLifted.host.heldById === ids.other && crateLifted.host.inIt === 3 && crateCarried.fewestInItForHost === 3 && crateCarried.mostAsleepForHost === 0 &&
      Math.hypot(crateCarried.host.x - crateFilled.host.x, crateCarried.host.z - crateFilled.host.z) > 2 && Math.hypot(crateCarried.host.x - crateCarried.other.x, crateCarried.host.z - crateCarried.other.z) < 0.3,
      [crateLifted.host, crateCarried]);
    check('in the other\'s own game it is all in the crate too, the beam keeps hold, and the weight of what is in it is theirs: it slows them',
      crateCarried.other.held && crateCarried.fewestInItForOther === 3 && crateCarried.other.load > crateWeight * 0.5 && crateCarried.other.load < crateWeight * 1.5 && crateCarried.other.speedFactor < 1 / (1 + (crateCarried.other.crateMass + crateWeight * 0.5) * slowdownPerKilogram),
      [crateWeight, crateCarried.other]);
    check('set down, it all comes to rest in the crate, in the same places in both games, and the crate is the host\'s to move again',
      crateSetDown.atRest && crateSetDown.host.inIt === 3 && crateSetDown.other.inIt === 3 && crateSetDown.host.ownerId === ids.host && crateSetDown.host.heldById === 0 &&
      crateSetDown.host.things.every((thing, index) => Math.hypot(thing.x - crateSetDown.other.things[index].x, thing.y - crateSetDown.other.things[index].y, thing.z - crateSetDown.other.things[index].z) < 0.03) &&
      Math.hypot(crateSetDown.host.x - crateSetDown.other.x, crateSetDown.host.y - crateSetDown.other.y, crateSetDown.host.z - crateSetDown.other.z) < 0.03, crateSetDown);
    await a.evaluate(() => window.undoSlowLine());
    await pause(800); // (what was still on its way has arrived)
  }
  for (const page of [a, b]) await page.evaluate((ids) => { const d = window.lastReturnDebug; for (const id of ids) { const object = d.looseObjects.filter((candidate) => candidate.id === id)[0]; if (object) d.removeLooseObject(object); } }, crateIds[0] || []);
  for (const page of [a, b]) await removeTestObjectKinds(page, TEST_KINDS_OF_THIS_SUITE); // (what of them still lies about keeps working: it holds its kind itself)

  // ---- A fuel can: one can, one tank, in both games ----
  // (This station has no generator with an empty tank, so the tank is this suite's own: a place on the floor of
  // the lane that both games are told is the body of a generator with nothing in it. The can is the game's.)
  const fuelCanIds = [];
  for (const page of [a, b]) fuelCanIds.push(await page.evaluate((lane) => {
    const d = window.lastReturnDebug;
    if (!lane) return 0;
    const x = lane.x + lane.wayX * 4.5, z = lane.z + lane.wayZ * 4.5;
    window.testTank = { index: d.getFuelTanks().length, instance: { definition: { kind: 'activate' }, total: 1, done: 0 }, object: { objectId: 0, name: 'Test set', needsItem: true, isSupplied: false, isDone: false, fuel: 0 },
      name: 'Test set', minimumX: x - 0.46, maximumX: x + 0.46, minimumZ: z - 0.32, maximumZ: z + 0.32, x: x, z: z, splashes: 0 };
    d.getFuelTanks().push(window.testTank);
    d.hollow.isActive = false;
    return d.createLooseObject('fuelCan', lane.x + lane.wayX * 1.7, lane.floor + 0.2, lane.z + lane.wayZ * 1.7, 0).id;
  }, lane));
  const fuelIn = (page) => page.evaluate((id) => {
    const d = window.lastReturnDebug, can = d.looseObjects.filter((object) => object.id === id)[0], tank = window.testTank, round = (value) => Math.round(value * 1000) / 1000;
    return { can: round(can.fuel), tank: round(tank.object.fuel), isFull: tank.object.isSupplied, kind: can.kindKey, label: d.getLooseObjectLabel(can), worth: d.getLooseObjectValue(can), mass: can.kind.mass,
      heldById: can.heldById, ownerId: can.ownerId, metresFromTheSet: round(Math.hypot(Math.max(tank.minimumX - can.x, 0, can.x - tank.maximumX), Math.max(tank.minimumZ - can.z, 0, can.z - tank.maximumZ))),
      carrying: d.getCarriedCount('fuel'), onMap: d.getQuestItemKeyOfLooseObject(can) };
  }, fuelCanIds[0]);
  await fine(1.5);
  // The other takes it. Away from the set nothing pours, and pouring is not theirs to ask for: only the host's game says a can pours.
  await b.evaluate((lane) => { const d = window.lastReturnDebug; d.input.keysDown.clear(); d.teleport(lane.x, lane.z, lane.yaw); d.player.pitch = -0.3; d.player.velocityX = 0; d.player.velocityZ = 0; d.simulate(0.1); }, lane);
  await b.evaluate((id) => { const d = window.lastReturnDebug; d.pickUpLooseObject(d.looseObjects.filter((object) => object.id === id)[0], false); }, fuelCanIds[0]);
  await b.waitForFunction(() => window.lastReturnDebug.getHeldLooseObject() !== null, null, { timeout: 5000 }).catch(() => {});
  await fine(1);
  await b.evaluate((id) => { const d = window.lastReturnDebug; for (let count = 0; count < 3; count++) d.askToAct({ what: 'pour', id: id, tank: window.testTank.index }); }, fuelCanIds[0]);
  await fine(1);
  const fuelCarried = { host: await fuelIn(a), other: await fuelIn(b) };
  // They walk up to the set and hold the can against it until a tenth of it has gone in; then they step back.
  // (For this the can pours slowly, in both games: half a minute for a whole one. These browsers' games run by the
  // clock as well as by the steps this suite gives them, so "for a second and a half" would be anything.)
  const pourSecondsAsItWas = await a.evaluate(() => window.lastReturnDebug.tuning.fuelPourSeconds);
  for (const page of [a, b]) await page.evaluate(() => { window.lastReturnDebug.tuning.fuelPourSeconds = 30; });
  const standWithCanAt = (metresAlong) => b.evaluate(([lane, metresAlong, id]) => {
    const d = window.lastReturnDebug, can = d.looseObjects.filter((object) => object.id === id)[0];
    d.teleport(lane.x + lane.wayX * metresAlong, lane.z + lane.wayZ * metresAlong, lane.yaw); d.player.pitch = -0.25;
    can.x = d.player.x; can.y = d.getPlayerEyeY() - 0.3; can.z = d.player.z; can.velocityX = 0; can.velocityY = 0; can.velocityZ = 0;
  }, [lane, metresAlong, fuelCanIds[0]]);
  await standWithCanAt(2.9);
  for (let turn = 0; turn < 80 && (await fuelIn(a)).tank < 0.1; turn++) await fine(0.1);
  await standWithCanAt(0);
  await fine(1.2);
  const fuelPartly = { host: await fuelIn(a), other: await fuelIn(b) };
  await fine(0.9);
  const fuelPartlyLater = { host: await fuelIn(a), other: await fuelIn(b) };
  // Back at the set until the tank is full (at the can's own pace again).
  for (const page of [a, b]) await page.evaluate((seconds) => { window.lastReturnDebug.tuning.fuelPourSeconds = seconds; }, pourSecondsAsItWas);
  await standWithCanAt(2.9);
  for (let turn = 0; turn < 30 && !((await fuelIn(a)).isFull && (await fuelIn(b)).isFull); turn++) await fine(0.4);
  await fine(1);
  const fuelPoured = { host: await fuelIn(a), other: await fuelIn(b) };
  check('a fuel can in the other\'s beam is a full can in both games; away from a generator nothing pours, and a can pouring is not the other\'s to ask for',
    fuelCanIds[0] > 0 && fuelCanIds[0] === fuelCanIds[1] && fuelCarried.host.heldById === ids.other && fuelCarried.other.carrying === 1 && fuelCarried.host.carrying === 0 &&
    fuelCarried.host.can === 1 && fuelCarried.other.can === 1 && fuelCarried.host.tank === 0 && fuelCarried.other.tank === 0, fuelCarried);
  check('held against the set by the other for a moment and taken away again: the same part of it is in the tank in both games, the rest is still in the can in both, and no more goes in once it is away',
    fuelPartly.host.tank >= 0.1 && fuelPartly.host.tank < 0.9 && fuelPartly.host.tank === fuelPartly.other.tank && fuelPartly.host.can === fuelPartly.other.can && Math.abs(fuelPartly.host.tank + fuelPartly.host.can - 1) < 0.002 &&
    fuelPartlyLater.host.tank === fuelPartly.host.tank && fuelPartlyLater.other.tank === fuelPartly.other.tank && /fuel can, \d+ % full/.test(fuelPartly.other.label) && fuelPartly.other.label === fuelPartly.host.label,
    [fuelPartly, fuelPartlyLater]);
  check('brought back, the rest goes in: the tank is full in both games, and the can is an empty fuel can in both, a sixth of the weight, worth the same in both, still in the other\'s beam and nothing they carry for a job',
    fuelPoured.host.isFull && fuelPoured.other.isFull && fuelPoured.host.tank === 1 && fuelPoured.other.tank === 1 && fuelPoured.host.can === 0 && fuelPoured.other.can === 0 &&
    fuelPoured.host.kind === 'emptyFuelCan' && fuelPoured.other.kind === 'emptyFuelCan' && fuelPoured.host.mass < 2 && fuelPoured.host.worth > 0 && fuelPoured.host.worth === fuelPoured.other.worth &&
    fuelPoured.host.heldById === ids.other && fuelPoured.other.carrying === 0 && fuelPoured.other.onMap === '', fuelPoured);
  await b.evaluate(() => { const d = window.lastReturnDebug; if (d.getHeldLooseObject()) d.releaseHeldLooseObject(0); });
  await fine(0.6);
  for (const page of [a, b]) await page.evaluate((id) => { const d = window.lastReturnDebug, can = d.looseObjects.filter((object) => object.id === id)[0]; if (can) d.removeLooseObject(can); d.getFuelTanks().splice(d.getFuelTanks().indexOf(window.testTank), 1); }, fuelCanIds[0]);

  // ---- The looters are the host's too: where one stands, and what it has in its arms, is the same in every game ----
  // (This suite's pages have no looters: see browser-harness.js. For this check the host's game is given them
  // back, in whatever nests this station has, or in one made up where the host stands if it has none. They are
  // kept at home, but for the first, which is put beside a thing of this check's own: a test weight, put down
  // in both games in the same place, so that it has the same number in both.)
  const looterSpot = await a.evaluate(() => {
    const d = window.lastReturnDebug, p = d.player;
    for (const step of [[1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6]]) {
      const spot = d.findWalkableSpotNear(p.x + step[0], p.z + step[1]);
      if (spot && Math.hypot(spot.x - p.x, spot.z - p.z) > 1 && Math.abs(d.getFloorHeightAt(spot.x, spot.z) - p.floorY) < 0.01) return { x: spot.x, y: p.floorY + 0.15, z: spot.z };
    }
    return null;
  });
  const lootIds = [];
  for (const page of [a, b]) await installTogetherTestObjectKinds(page); // (a descent begun since the last time has the game's own kinds only)
  if (looterSpot) for (const page of [a, b]) lootIds.push(await page.evaluate((spot) => window.lastReturnDebug.createLooseObject('testWeight', spot.x, spot.y, spot.z, 0).id, looterSpot));
  await fine(1);
  const lootId = lootIds[0];
  await a.evaluate(([spot, id]) => {
    const d = window.lastReturnDebug;
    if (d.level.ventNests.length === 0) d.level.ventNests.push({ x: d.player.x, z: d.player.z, floorY: d.player.floorY, isPocket: false });
    d.setLootersWanted(true); d.createLooters(); d.setLootersWanted(false);
    for (const looter of d.looters) looter.timer = 9999;
    const looter = d.looters[0], thing = d.looseObjects.filter((object) => object.id === id)[0];
    looter.figure.x = spot.x + 0.5; looter.figure.z = spot.z;
    looter.wanted = thing; looter.state = 1; // after a thing
  }, [looterSpot, lootId]);
  await fine(1.5);
  const looterIn = (page, id) => page.evaluate((id) => {
    const d = window.lastReturnDebug, looter = d.looters[0], thing = d.looseObjects.filter((object) => object.id === id)[0];
    if (!looter || !thing) return { looters: d.looters.length, hasThing: Boolean(thing) };
    return { looters: d.looters.length, x: Math.round(looter.figure.x * 10) / 10, z: Math.round(looter.figure.z * 10) / 10, state: d.looterStates[looter.state],
      hasIt: looter.carried === thing, inItsArms: thing.looterIndex, thingMetresFromIt: Math.round(Math.hypot(thing.x - looter.figure.x, thing.z - looter.figure.z) * 10) / 10,
      thingAt: [Math.round(thing.x * 10) / 10, Math.round(thing.z * 10) / 10], thingLiesStill: thing.isAsleep };
  }, id);
  const looterTook = [await looterIn(a, lootId), await looterIn(b, lootId)];
  check('the host\'s looters are shown in the other game where the host has them; one that takes a thing has it in its arms in both games, and there it is where the looter is',
    Boolean(looterSpot) && lootIds.length === 2 && lootIds[0] === lootIds[1] && looterTook[0].looters >= 1 && looterTook[1].looters === looterTook[0].looters &&
    Math.hypot(looterTook[0].x - looterTook[1].x, looterTook[0].z - looterTook[1].z) < 1 && looterTook[0].state === 'carrying a thing home' && looterTook[1].state === looterTook[0].state &&
    looterTook[0].hasIt && looterTook[1].hasIt && looterTook[0].inItsArms === 0 && looterTook[1].inItsArms === 0 && looterTook[0].thingMetresFromIt < 0.7 && looterTook[1].thingMetresFromIt < 0.7, looterTook);
  // Frightened, it lets the thing fall: in both games it lies where it fell, nobody's.
  await a.evaluate(() => { const d = window.lastReturnDebug; d.frightenLooter(d.looters[0]); });
  await fine(1.5);
  const looterDropped = [await looterIn(a, lootId), await looterIn(b, lootId)];
  check('frightened, it lets the thing fall and runs: in both games the thing is out of its arms and lies in the same place',
    looterDropped[0].state === 'frightened' && looterDropped[1].state === 'frightened' && !looterDropped[0].hasIt && !looterDropped[1].hasIt && looterDropped[0].inItsArms === -1 && looterDropped[1].inItsArms === -1 &&
    Math.hypot(looterDropped[0].thingAt[0] - looterDropped[1].thingAt[0], looterDropped[0].thingAt[1] - looterDropped[1].thingAt[1]) < 0.3, looterDropped);
  // (And away with them again: the checks that follow are about other things.)
  await a.evaluate(() => { const d = window.lastReturnDebug; for (const looter of d.looters) d.setFigureRaycastable(looter.figure, false); d.looters.length = 0; });
  for (const page of [a, b]) await page.evaluate((id) => { const d = window.lastReturnDebug, thing = d.looseObjects.filter((object) => object.id === id)[0]; if (thing) d.removeLooseObject(thing); }, lootId);
  await fine(0.6);
  check('with the host\'s looters gone they are gone from the other game', (await b.evaluate(() => window.lastReturnDebug.looters.length)) === 0);

  // ---- A scanner tripod is switched on and off for everybody, and each game draws its light for itself ----
  // (One of this check's own, put down in both games in the same place, so that it has the same number in both.)
  const tripodIds = [];
  if (looterSpot) for (const page of [a, b]) tripodIds.push(await page.evaluate((spot) => window.lastReturnDebug.createLooseObject('scannerTripod', spot.x, spot.y + 0.2, spot.z, 0).id, looterSpot));
  await fine(1);
  const tripodIn = (page) => page.evaluate((id) => { const d = window.lastReturnDebug, tripod = d.looseObjects.filter((object) => object.id === id)[0]; return tripod ? { isOn: tripod.isOn, fired: tripod.pulsesFired } : null; }, tripodIds[0]);
  const switchTripodFrom = (page) => page.evaluate((id) => window.lastReturnDebug.askToAct({ what: 'setOff', id: id }), tripodIds[0]);
  await switchTripodFrom(b);
  await fine(2.4);
  const tripodOn = [await tripodIn(a), await tripodIn(b)];
  await switchTripodFrom(a);
  await fine(0.8);
  const tripodOff = [await tripodIn(a), await tripodIn(b)];
  check('a scanner tripod that one of you switches on is on in every game, each of which sends out its light for itself; switched off by another, it is off in every game',
    tripodIds.length === 2 && tripodIds[0] === tripodIds[1] && tripodOn.every((tripod) => tripod !== null && tripod.isOn && tripod.fired > 0) && tripodOff.every((tripod) => tripod !== null && !tripod.isOn), [tripodOn, tripodOff]);
  for (const page of [a, b]) await page.evaluate((id) => { const d = window.lastReturnDebug, tripod = d.looseObjects.filter((object) => object.id === id)[0]; if (tripod) d.removeLooseObject(tripod); }, tripodIds[0]);
  await fine(0.3);

  // ---- A scan grenade goes off in every game when the game that moves it says so ----
  // Only the browser that moves a thing knows when it landed, and a grenade goes off a moment after it lands. So
  // that browser says when each scan begins, and the others begin theirs then: not when the fuse runs out in
  // their own game, seconds later. The one thrown here is the bouncing betty, which jumps before each of its
  // scans: the other throws it, so it is theirs to move while it flies and the host's whenever it lies still.
  const bettyIds = [];
  for (const page of [a, b]) bettyIds.push(await page.evaluate((lane) => lane ? window.lastReturnDebug.createLooseObject('bouncingBetty', lane.x + lane.wayX * 1.7, lane.floor + 0.15, lane.z + lane.wayZ * 1.7, 0).id : 0, lane));
  await fine(1.5);
  const bettyIn = (page) => page.evaluate((id) => {
    const d = window.lastReturnDebug, betty = d.looseObjects.filter((object) => object.id === id)[0];
    return betty ? { isArmed: betty.armedTime >= 0, isScanning: betty.burstSeconds > 0 && !betty.isSpent, done: betty.burstsDone, isSpent: betty.isSpent, height: Math.round((betty.y - d.getFloorHeightAt(betty.x, betty.z)) * 100) / 100,
      wanted: d.getLooseNumber(betty, 'scanGrenadeBursts'), fuse: d.getLooseNumber(betty, 'scanGrenadeFuseSeconds') } : null;
  }, bettyIds[0]);
  await b.evaluate((lane) => { const d = window.lastReturnDebug; d.input.keysDown.clear(); d.teleport(lane.x, lane.z, lane.yaw); d.player.pitch = -0.5; d.player.velocityX = 0; d.player.velocityZ = 0; d.simulate(0.1); }, lane);
  await b.evaluate((id) => { const d = window.lastReturnDebug; d.pickUpLooseObject(d.looseObjects.filter((object) => object.id === id)[0], false); }, bettyIds[0]);
  await b.waitForFunction(() => window.lastReturnDebug.getHeldLooseObject() !== null, null, { timeout: 5000 }).catch(() => {});
  await fine(0.5);
  await b.evaluate((id) => window.lastReturnDebug.askToAct({ what: 'setOff', id: id }), bettyIds[0]);
  for (let turn = 0; turn < 20 && !([await bettyIn(a), await bettyIn(b)].every((betty) => betty !== null && betty.isArmed)); turn++) await fine(0.2);
  const bettyArmed = [await bettyIn(a), await bettyIn(b)];
  await b.evaluate(() => { const d = window.lastReturnDebug; d.player.pitch = 0; d.releaseHeldLooseObject(0.4); });
  // Watched a tenth of a second at a time, in both games: when each first saw it scan (in tenths of a second
  // since it was thrown), and the lowest it was above the floor in each while its light was on. (Spent, its light
  // is off: one game is done a moment before the other, and by the next look the thing has come down.)
  const bettySeen = [{ firstScanAt: -1, lowestScanning: 99, scansSeen: 0, wasScanning: false }, { firstScanAt: -1, lowestScanning: 99, scansSeen: 0, wasScanning: false }];
  let bettyNow = bettyArmed;
  for (let turn = 0; turn < 260 && !(bettyNow[0] && bettyNow[0].isSpent && bettyNow[1] && bettyNow[1].isSpent); turn++) {
    await fine(0.1);
    bettyNow = [await bettyIn(a), await bettyIn(b)];
    bettyNow.forEach((betty, index) => {
      if (!betty) return;
      const seen = bettySeen[index];
      if (betty.isScanning) { if (seen.firstScanAt < 0) seen.firstScanAt = turn; seen.lowestScanning = Math.min(seen.lowestScanning, betty.height); if (!seen.wasScanning) seen.scansSeen++; }
      seen.wasScanning = betty.isScanning;
    });
  }
  check('a scan grenade the other throws goes off in both games a moment after it lands, long before its fuse is out, and in both at the same moment',
    bettyIds[0] > 0 && bettyIds[0] === bettyIds[1] && bettyArmed.every((betty) => betty !== null && betty.isArmed) && bettySeen.every((seen) => seen.firstScanAt >= 0 && seen.firstScanAt < (bettyArmed[0].fuse - 2) * 10) &&
    Math.abs(bettySeen[0].firstScanAt - bettySeen[1].firstScanAt) <= 5, [bettyIds, bettySeen]);
  check('the bouncing betty scans as often as it says in both games, each time from the air in both, and is spent in both',
    bettyNow.every((betty) => betty !== null && betty.isSpent && betty.done === betty.wanted && betty.wanted >= 2) && bettySeen.every((seen) => seen.scansSeen >= bettyNow[0].wanted - 1 && seen.lowestScanning > 0.3), [bettyNow, bettySeen]);
  for (const page of [a, b]) await page.evaluate((id) => { const d = window.lastReturnDebug, betty = d.looseObjects.filter((object) => object.id === id)[0]; if (betty) d.removeLooseObject(betty); }, bettyIds[0]);
  await fine(0.3);

  // ---- Pockets: what is in whose pockets is the same in both games ----
  const pocketIds = [];
  for (const page of [a, b]) pocketIds.push(await page.evaluate((lane) => {
    const d = window.lastReturnDebug;
    if (!lane) return [0, 0];
    return [d.createLooseObject('scanGrenade', lane.x + lane.wayX * 1.7, lane.floor + 0.1, lane.z + lane.wayZ * 1.7, 0).id,
      d.createLooseObject('firstAidKit', lane.x + lane.wayX * 3.2, lane.floor + 0.1, lane.z + lane.wayZ * 3.2, 0).id];
  }, lane));
  const pocketsIn = (page) => page.evaluate(([ids, otherId]) => {
    const d = window.lastReturnDebug, find = (id) => d.looseObjects.filter((object) => object.id === id)[0] || null, round = (value) => Math.round(value * 100) / 100;
    const grenade = find(ids[0]), kit = find(ids[1]), pocketed = d.findPocketedObject(ids[0]);
    return { theirs: d.getPocketsOf(otherId).map((object) => object ? object.id : 0), own: d.getOwnPockets().map((object) => object ? object.id : 0),
      grenade: grenade ? { heldById: grenade.heldById, ownerId: grenade.ownerId, x: round(grenade.x), y: round(grenade.y), z: round(grenade.z), isAsleep: grenade.isAsleep } : null,
      kitIsThere: kit !== null, kitHeldById: kit ? kit.heldById : -1, pocketedBy: pocketed ? pocketed.playerId : 0, holding: d.getHeldLooseObject() ? d.getHeldLooseObject().id : 0 };
  }, [pocketIds[0], ids.other]);
  await fine(1.5);
  // Is it so in the host's game and in the other's? What the other does with a pocket is asked of the host, done in
  // the host's game at once, and done in the other's own game only when the host's word has come back to it. So
  // each step here waits until it is so in both, and never only in the host's: a moment later the other's game is
  // told to do the next thing, and until that word is in it still has the pockets it had before. (It was waited for
  // in the host's game alone. Now and then the other was then told to fall with a pocket their own game did not
  // know was full yet: nothing fell, the grenade never came back, and the suite stopped on reading where it lay.)
  const isSoInBothGames = async (lookIn, isSo) => isSo(await lookIn(a)) && isSo(await lookIn(b));
  // Not out of thin air: a thing that is not in their beam does not go into their pocket.
  await b.evaluate((id) => window.lastReturnDebug.askToAct({ what: 'stow', id: id, slot: 0 }), pocketIds[0][0]);
  await fine(0.8);
  const pocketNotHeld = { host: await pocketsIn(a), other: await pocketsIn(b) };
  // The other takes the grenade and puts it in a pocket.
  await b.evaluate((lane) => { const d = window.lastReturnDebug; d.input.keysDown.clear(); d.teleport(lane.x, lane.z, lane.yaw); d.player.pitch = -0.5; d.player.velocityX = 0; d.player.velocityZ = 0; d.simulate(0.1); }, lane);
  await b.evaluate((id) => { const d = window.lastReturnDebug; d.pickUpLooseObject(d.looseObjects.filter((object) => object.id === id)[0], false); }, pocketIds[0][0]);
  await b.waitForFunction(() => window.lastReturnDebug.getHeldLooseObject() !== null, null, { timeout: 5000 }).catch(() => {});
  await fine(0.5);
  await b.evaluate(() => { window.lastReturnDebug.input.wantsStow = true; });
  for (let turn = 0; turn < 20 && !(await isSoInBothGames(pocketsIn, (pockets) => pockets.pocketedBy === ids.other)); turn++) await fine(0.2);
  const pocketStowed = { host: await pocketsIn(a), other: await pocketsIn(b) };
  // Out again, by its key.
  await b.evaluate(() => { window.lastReturnDebug.input.wantsPocket = 0; });
  for (let turn = 0; turn < 20 && !(await isSoInBothGames(pocketsIn, (pockets) => pockets.grenade !== null)); turn++) await fine(0.2);
  await fine(0.6);
  const pocketTakenOut = { host: await pocketsIn(a), other: await pocketsIn(b) };
  // In again, and then they fall: what was in their pockets lies there, in both games.
  await b.evaluate(() => { window.lastReturnDebug.input.wantsStow = true; });
  for (let turn = 0; turn < 20 && !(await isSoInBothGames(pocketsIn, (pockets) => pockets.pocketedBy === ids.other)); turn++) await fine(0.2);
  await b.evaluate(() => { window.lastReturnDebug.spillOwnPockets(); });
  for (let turn = 0; turn < 20 && !(await isSoInBothGames(pocketsIn, (pockets) => pockets.grenade !== null)); turn++) await fine(0.2);
  // (Should it never come back, the check below says so: there is nothing to wait for here then, and nothing to read.)
  for (let turn = 0; turn < 16 && !(await isSoInBothGames(pocketsIn, (pockets) => pockets.grenade !== null && pockets.grenade.isAsleep)); turn++) await fine(0.4);
  const pocketSpilled = { host: await pocketsIn(a), other: await pocketsIn(b), fellAt: await b.evaluate(() => [window.lastReturnDebug.player.x, window.lastReturnDebug.player.z]) };
  check('a thing that is not in the other\'s beam does not go into their pocket for the asking',
    pocketIds[0][0] > 0 && pocketIds[0].join() === pocketIds[1].join() && pocketNotHeld.host.grenade !== null && pocketNotHeld.other.grenade !== null && pocketNotHeld.host.pocketedBy === 0 && pocketNotHeld.other.pocketedBy === 0, pocketNotHeld);
  check('the other puts a scan grenade from their beam into a pocket: it is out of the station in both games, and in their pocket in both',
    pocketStowed.host.grenade === null && pocketStowed.other.grenade === null && pocketStowed.host.pocketedBy === ids.other && pocketStowed.other.pocketedBy === ids.other &&
    pocketStowed.host.theirs[0] === pocketIds[0][0] && pocketStowed.other.own[0] === pocketIds[0][0] && pocketStowed.other.holding === 0 && pocketStowed.host.own.every((id) => id === 0), pocketStowed);
  check('taken out again, it is in the other\'s beam in both games, and in nobody\'s pocket',
    pocketTakenOut.host.grenade !== null && pocketTakenOut.host.grenade.heldById === ids.other && pocketTakenOut.other.holding === pocketIds[0][0] && pocketTakenOut.host.pocketedBy === 0 && pocketTakenOut.other.pocketedBy === 0 &&
    Math.hypot(pocketTakenOut.host.grenade.x - pocketTakenOut.other.grenade.x, pocketTakenOut.host.grenade.z - pocketTakenOut.other.grenade.z) < 0.6, pocketTakenOut);
  check('when the other falls, what was in their pockets lies where they fell, in the same place in both games, and is the host\'s to move',
    pocketSpilled.host.grenade !== null && pocketSpilled.other.grenade !== null && pocketSpilled.host.pocketedBy === 0 && pocketSpilled.other.own.every((id) => id === 0) && pocketSpilled.host.theirs.every((id) => id === 0) &&
    Math.hypot(pocketSpilled.host.grenade.x - pocketSpilled.fellAt[0], pocketSpilled.host.grenade.z - pocketSpilled.fellAt[1]) < 1.5 && pocketSpilled.host.grenade.heldById === 0 &&
    Math.hypot(pocketSpilled.host.grenade.x - pocketSpilled.other.grenade.x, pocketSpilled.host.grenade.y - pocketSpilled.other.grenade.y, pocketSpilled.host.grenade.z - pocketSpilled.other.grenade.z) < 0.1 &&
    pocketSpilled.other.grenade.ownerId === ids.host, pocketSpilled);
  for (const page of [a, b]) await page.evaluate((ids) => { const d = window.lastReturnDebug; for (const id of ids) { const object = d.looseObjects.filter((candidate) => candidate.id === id)[0]; if (object) d.removeLooseObject(object); } }, pocketIds[0]);

  // ---- Survey spools: found by whoever takes one, carried in their pocket, and loaded by the host's say ----
  const spoolsIn = (page) => page.evaluate((otherId) => {
    const d = window.lastReturnDebug, first = d.findSpool(3), second = d.findSpool(4);
    const all = d.looseObjects.concat(d.listPocketedObjects()).filter((object) => object.kindKey === 'spool');
    const firstAnywhere = all.filter((object) => object.questObjectId === 3)[0] || null, pocketed = firstAnywhere ? d.findPocketedObject(firstAnywhere.id) : null;
    return { found: d.game.flags.spoolsCollected, loaded: d.game.flags.spoolsLoaded, uploadStarted: d.game.flags.uploadStarted, mode: d.game.mode, count: all.length,
      firstId: firstAnywhere ? firstAnywhere.id : 0, firstWasFound: firstAnywhere ? firstAnywhere.wasFound : null, firstHeldById: first ? first.heldById : -1, firstPocketedBy: pocketed ? pocketed.playerId : 0,
      secondId: second ? second.id : 0, secondIsThere: second !== null, secondWasFound: second ? second.wasFound : null, theirPockets: d.getPocketsOf(otherId).filter((object) => object !== null).length };
  }, ids.other);
  const closeReaders = async () => { for (const page of [a, b]) await page.evaluate(() => { const d = window.lastReturnDebug; if (d.game.mode === 'reading') d.closeReader(); }); };
  // (The terminal takes spools only with the mains on. It is put back as it was afterwards: what follows is before the mains.)
  const hadPowerBeforeSpools = await a.evaluate(() => window.lastReturnDebug.game.flags.powerOn);
  for (const page of [a, b]) await page.evaluate(() => { const d = window.lastReturnDebug; d.grantPower(); d.clearMessages(); });
  const spoolsAtFirst = { host: await spoolsIn(a), other: await spoolsIn(b) };
  // The other goes to the first spool and takes it into their beam.
  await b.evaluate(() => {
    const d = window.lastReturnDebug, spool = d.findSpool(3), spot = d.findWalkableSpotNear(spool.x, spool.z);
    d.input.keysDown.clear(); d.teleport(spot.x, spot.z, Math.atan2(spool.x - spot.x, -(spool.z - spot.z))); d.player.velocityX = 0; d.player.velocityZ = 0; d.simulate(0.1);
    d.pickUpLooseObject(spool, false);
  });
  for (let turn = 0; turn < 25 && !((await spoolsIn(a)).found === 1 && (await spoolsIn(b)).found === 1); turn++) await fine(0.2);
  const spoolTaken = { host: await spoolsIn(a), other: await spoolsIn(b) };
  await closeReaders();
  await fine(0.5);
  // Into their pocket.
  await b.evaluate(() => { window.lastReturnDebug.input.wantsStow = true; });
  for (let turn = 0; turn < 25 && !(await isSoInBothGames(spoolsIn, (spools) => spools.firstPocketedBy === ids.other)); turn++) await fine(0.2);
  const spoolPocketed = { host: await spoolsIn(a), other: await spoolsIn(b) };
  // The host presses the lift terminal: there is no spool on the host, and none lies by it. Nothing is loaded.
  await a.evaluate(() => { const d = window.lastReturnDebug; d.clearMessages(); d.askToAct({ what: 'use', objectId: 1 }); });
  await fine(1);
  const spoolHostPressed = { host: await spoolsIn(a), other: await spoolsIn(b), hostRead: await a.evaluate(() => Array.from(document.querySelectorAll('#hud-messages .hud-message')).map((element) => element.textContent).join(' | ')) };
  // The other presses it, and says with it that the second spool is theirs to load as well, though it lies
  // in its room: which spools a terminal takes is the host's game's to say, and it says the one in their pocket.
  await b.evaluate((secondId) => { window.lastReturnDebug.askToAct({ what: 'use', objectId: 1, load: [secondId] }); }, spoolsAtFirst.other.secondId);
  for (let turn = 0; turn < 25 && !((await spoolsIn(a)).loaded === 1 && (await spoolsIn(b)).loaded === 1); turn++) await fine(0.2);
  await fine(0.5);
  const spoolLoaded = { host: await spoolsIn(a), other: await spoolsIn(b) };
  check('down there with others the spools are the same things in both games, found by nobody at the start',
    spoolsAtFirst.host.count === 3 && spoolsAtFirst.other.count === 3 && spoolsAtFirst.host.firstId > 0 && spoolsAtFirst.host.firstId === spoolsAtFirst.other.firstId && spoolsAtFirst.host.secondId === spoolsAtFirst.other.secondId &&
    spoolsAtFirst.host.found === 0 && spoolsAtFirst.other.found === 0, spoolsAtFirst);
  check('the other takes a spool into their beam: it is found in both games, once, and is theirs to carry',
    spoolTaken.host.found === 1 && spoolTaken.other.found === 1 && spoolTaken.host.firstWasFound === true && spoolTaken.other.firstWasFound === true && spoolTaken.host.firstHeldById === ids.other &&
    spoolTaken.host.loaded === 0 && spoolTaken.other.loaded === 0, spoolTaken);
  check('in their pocket it is in their pocket in both games, still found and not loaded',
    spoolPocketed.host.firstPocketedBy === ids.other && spoolPocketed.other.firstPocketedBy === ids.other && spoolPocketed.host.theirPockets === 1 && spoolPocketed.host.found === 1 && spoolPocketed.other.found === 1 &&
    spoolPocketed.host.loaded === 0, spoolPocketed);
  check('the host pressing the lift terminal loads nothing: what is in the other\'s pocket is not the host\'s to hand in',
    spoolHostPressed.host.loaded === 0 && spoolHostPressed.other.loaded === 0 && spoolHostPressed.host.firstPocketedBy === ids.other && /LIFT CONTROL/.test(spoolHostPressed.hostRead), spoolHostPressed);
  check('the other pressing it loads the spool from their pocket in both games, and no spool they only claim to have: that one still lies in its room, found by nobody',
    spoolLoaded.host.loaded === 1 && spoolLoaded.other.loaded === 1 && spoolLoaded.host.firstId === 0 && spoolLoaded.other.firstId === 0 && spoolLoaded.host.theirPockets === 0 && spoolLoaded.other.theirPockets === 0 &&
    spoolLoaded.host.secondIsThere && spoolLoaded.other.secondIsThere && spoolLoaded.host.secondWasFound === false && spoolLoaded.other.secondWasFound === false && spoolLoaded.host.found === 1 && spoolLoaded.other.found === 1 &&
    spoolLoaded.host.count === 2 && spoolLoaded.other.count === 2 && !spoolLoaded.host.uploadStarted && !spoolLoaded.other.uploadStarted, spoolLoaded);
  await closeReaders();
  if (lane) await b.evaluate((lane) => { const d = window.lastReturnDebug; d.input.keysDown.clear(); d.teleport(lane.x, lane.z, lane.yaw); d.player.velocityX = 0; d.player.velocityZ = 0; d.simulate(0.1); }, lane);
  for (const page of [a, b]) await page.evaluate((hadPower) => { const d = window.lastReturnDebug; d.game.flags.powerOn = hadPower; d.clearMessages(); }, hadPowerBeforeSpools);
  await fine(0.5);

  // ---- What lives down there arrives in its own time, and that is the host's game's to say ----
  // (This suite's pages keep it away until Generator 2 is started, like every suite's: see browser-harness.js.
  // For this check the host's game is given its say back, with half a minute of its wait left.)
  const readRadio = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#hud-messages .hud-message')).map((element) => element.textContent).join(' | '));
  const arrivalIn = (page) => page.evaluate(() => { const d = window.lastReturnDebug, wait = d.arrivals.waits.hollow; return { here: d.hollow.isActive, hasArrived: wait.hasArrived, cause: wait.cause, takenByNoise: Math.round(wait.takenByNoise * 10) / 10 }; });
  await a.evaluate(() => {
    const d = window.lastReturnDebug, wait = d.arrivals.waits.hollow;
    d.hollow.isActive = false;
    d.debugState.areArrivalsHeld = false;
    wait.hasArrived = false; wait.isDue = ''; wait.cause = ''; wait.takenByNoise = 0;
    wait.quietSeconds = wait.goneBy + 30;
  });
  // It is not the other's to say that it has come.
  await b.evaluate(() => window.lastReturnDebug.askToAct({ what: 'arrive', key: 'hollow', cause: 'time' }));
  await fine(1);
  const arrivalAsked = { host: await arrivalIn(a), other: await arrivalIn(b) };
  // The other is loud: seven full sweeps' worth of noise, where they stand. That is the host's wait run out.
  await b.evaluate(() => { const d = window.lastReturnDebug; for (let count = 0; count < 7; count++) d.emitNoise(d.player.x, d.player.z, d.tuning.noiseRadiusSweep); });
  for (let turn = 0; turn < 20 && !(await arrivalIn(b)).hasArrived; turn++) await fine(0.3);
  const arrivalHeard = { host: await arrivalIn(a), other: await arrivalIn(b) };
  let radioA = '', radioB = '';
  for (let turn = 0; turn < 30 && !(/Keep the noise down/.test(radioA) && /Keep the noise down/.test(radioB)); turn++) { await fine(0.3); radioA += await readRadio(a); radioB += await readRadio(b); }
  const arrivalShown = await b.evaluate(() => window.lastReturnDebug.hollow.isActive);
  check('the Hollow arriving is not the other\'s to say; noise the other makes runs the host\'s wait down, and when it is over it arrives in both games, woken by noise',
    !arrivalAsked.host.here && !arrivalAsked.host.hasArrived && !arrivalAsked.other.hasArrived && arrivalHeard.host.here && arrivalHeard.host.hasArrived && arrivalHeard.host.cause === 'noise' &&
    arrivalHeard.host.takenByNoise >= 30 && arrivalHeard.other.hasArrived && arrivalHeard.other.cause === 'noise' && arrivalShown, [arrivalAsked, arrivalHeard, arrivalShown]);
  check('and Dispatch tells both of you that the shaft sensor has tripped', /Keep the noise down/.test(radioA) && /Keep the noise down/.test(radioB), [radioA.slice(0, 160), radioB.slice(0, 160)]);
  await a.evaluate(() => { const d = window.lastReturnDebug; d.hollow.isActive = false; d.debugState.areArrivalsHeld = true; });
  await fine(0.5);

  // Something breaks: it is gone from both games.
  const brokenId = await a.evaluate(() => {
    const d = window.lastReturnDebug, thing = d.looseObjects.filter((object) => object.kind.shattersAt)[0] || d.looseObjects[d.looseObjects.length - 1];
    d.askToAct({ what: 'shatter', id: thing.id, x: thing.x, y: thing.y, z: thing.z });
    return thing.id;
  });
  await b.waitForFunction((id) => !window.lastReturnDebug.looseObjects.some((object) => object.id === id), brokenId, { timeout: 5000 }).catch(() => {});
  check('a thing that breaks is gone from both games', (await about(a, brokenId)) === null && (await about(b, brokenId)) === null);
  // Salvage: the host's bays take the same things out of both games, for the same worth.
  const sealed = await a.evaluate(() => { const d = window.lastReturnDebug; d.fillHaulBays(); return { taken: d.haulState.taken, left: d.looseObjects.length, bays: d.haulState.bays.map((bay) => bay.state).join(','), progress: d.getHaulProgress() }; });
  await b.waitForFunction((taken) => window.lastReturnDebug.haulState.taken === taken, sealed.taken, { timeout: 5000 }).catch(() => {});
  const sealedB = await b.evaluate(() => { const d = window.lastReturnDebug; return { taken: d.haulState.taken, left: d.looseObjects.length, bays: d.haulState.bays.map((bay) => bay.state).join(','), progress: d.getHaulProgress() }; });
  check('a salvage bay that seals takes the same things out of both games, for the same worth',
    sealed.taken > 0 && sealed.bays.includes('sealed') && JSON.stringify(sealed) === JSON.stringify(sealedB), [sealed, sealedB]);

  // The menu does not stop the host's station.
  await a.keyboard.press('Escape');
  const paused = await a.evaluate(() => ({ mode: window.lastReturnDebug.game.mode, time: window.lastReturnDebug.game.time }));
  for (let count = 0; count < 4; count++) await a.screenshot({ type: 'jpeg', quality: 5 });
  check('the host\'s station goes on while the host has the menu open', paused.mode === 'paused' && await a.evaluate((before) => window.lastReturnDebug.game.time > before, paused.time), paused);
  // Nor does it stop what lies loose, most of which is the host's to move: a crate let go of in the air while
  // the host has the menu open comes down, in both games. (It used to hang there until the menu was shut.)
  const dropSpot = await a.evaluate(() => {
    const d = window.lastReturnDebug;
    let spot = null;
    for (const way of [[1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6]]) { const near = d.findWalkableSpotNear(d.player.x + way[0], d.player.z + way[1]); if (near && Math.hypot(near.x - d.player.x, near.z - d.player.z) > 1) { spot = near; break; } }
    spot = spot || { x: d.player.x, z: d.player.z };
    return { x: spot.x, z: spot.z, y: d.getFloorHeightAt(spot.x, spot.z) + 1.5 };
  });
  const droppedIds = [];
  for (const page of [a, b]) await installTestObjectKinds(page, ['testCrate']); // (this suite's own crate: what falls is what the check is about, not the game's crate)
  for (const page of [a, b]) droppedIds.push(await page.evaluate((spot) => window.lastReturnDebug.createLooseObject('testCrate', spot.x, spot.y, spot.z, 0).id, dropSpot));
  // Frames are drawn until it is down in both games, and no more: with the menu open a frame takes about five
  // seconds on the machine GitHub runs this on, and forty-five of them every time came to nearly four minutes.
  const hasComeDown = async (page, id) => (await about(page, id)).y < dropSpot.y - 1;
  for (let count = 0; count < 45 && !(await hasComeDown(a, droppedIds[0]) && await hasComeDown(b, droppedIds[1])); count++) await a.screenshot({ type: 'jpeg', quality: 5 });
  await pause(200);
  const dropped = { mode: await a.evaluate(() => window.lastReturnDebug.game.mode), from: dropSpot.y, host: await about(a, droppedIds[0]), other: await about(b, droppedIds[1]) };
  check('nor does it stop what lies loose: a crate let go of in the air while the host has the menu open comes down, in both games',
    droppedIds[0] === droppedIds[1] && dropped.mode === 'paused' && dropped.host.y < dropSpot.y - 1 && dropped.other.y < dropSpot.y - 1, dropped);
  for (const page of [a, b]) await removeTestObjectKinds(page, ['testCrate']); // (the crate itself lies on, holding its kind)
  await a.keyboard.press('Escape');
  await a.waitForFunction(() => window.lastReturnDebug.game.mode === 'playing');

  // The menu does not stop what one of the others is shown of the station either. The other opens it, and the
  // host scans: what the host's scanner lights up is lit on the other's screen all the same, and is on their map
  // when they shut the menu. (It used to stay dark for anyone but the host who was not at the controls.)
  await b.keyboard.press('Escape');
  await b.waitForFunction(() => window.lastReturnDebug.game.mode === 'paused', null, { timeout: 5000 }).catch(() => {});
  await a.evaluate(() => { const d = window.lastReturnDebug; d.player.pitch = 0; d.setScanHeld(true); d.simulate(0.3); for (let count = 0; count < 4; count++) d.updateTogether(0.1); });
  await b.waitForFunction(() => window.lastReturnDebug.together.others[0].spreadDegrees > 0, null, { timeout: 5000 }).catch(() => {});
  const litInTheMenu = await b.evaluate(() => {
    const d = window.lastReturnDebug, before = d.pointCloud.totalReturns;
    for (let count = 0; count < 5; count++) d.updateTogether(0.1);
    return { mode: d.game.mode, points: d.pointCloud.totalReturns - before };
  });
  check('what another scanner lights up is lit for one who has the menu open', litInTheMenu.mode === 'paused' && litInTheMenu.points > 100, litInTheMenu);
  await a.evaluate(() => { const d = window.lastReturnDebug; d.setScanHeld(false); d.simulate(0.2); for (let count = 0; count < 4; count++) d.updateTogether(0.1); });
  await b.waitForFunction(() => window.lastReturnDebug.together.others[0].spreadDegrees === 0, null, { timeout: 5000 }).catch(() => {});
  await b.keyboard.press('Escape');
  await b.waitForFunction(() => window.lastReturnDebug.game.mode === 'playing', null, { timeout: 5000 }).catch(() => {});

  // Down there with others the car stays, and its door is yours to open and shut: the panel in the car and the
  // button outside it both do, in every game, for whoever presses.
  const wellAwayFromTheCar = () => {
    const d = window.lastReturnDebug;
    for (let step = 6; step < 20; step++) for (const way of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const spot = d.findWalkableSpotNear(d.playerStart.x + way[0], d.playerStart.z + way[1]);
      if (spot && Math.hypot(spot.x - d.playerStart.x, spot.z - d.playerStart.z) > 5) { d.teleport(spot.x, spot.z, 0); return; }
    }
  };
  const liftDoors = async () => [await a.evaluate(() => Math.round(window.lastReturnDebug.getLiftDoor().openFraction * 100) / 100), await b.evaluate(() => Math.round(window.lastReturnDebug.getLiftDoor().openFraction * 100) / 100)];
  const saidOfTheDoor = async (words) => [await a.evaluate((words) => document.getElementById('hud-messages').textContent.includes(words), words), await b.evaluate((words) => document.getElementById('hud-messages').textContent.includes(words), words)];
  await a.evaluate(wellAwayFromTheCar);
  await b.evaluate(() => { const d = window.lastReturnDebug; d.teleport(d.playerStart.x, d.playerStart.z, 0); d.clearMessages(); });
  await a.evaluate(() => window.lastReturnDebug.clearMessages());
  await both(1.2);
  const carDoor = { stays: await a.evaluate(() => window.lastReturnDebug.game.isCarStaying) && await b.evaluate(() => window.lastReturnDebug.game.isCarStaying), atFirst: await liftDoors() };
  await b.evaluate(() => { const d = window.lastReturnDebug; d.askToAct({ what: 'use', objectId: d.liftPanelObjectId }); });
  await both(2.1);
  carDoor.shut = await liftDoors();
  carDoor.toldOfShutting = await saidOfTheDoor('door closing');
  await both(3);
  carDoor.stillShut = await liftDoors(); // with somebody in the car: it is theirs to keep shut
  await a.evaluate(() => { const d = window.lastReturnDebug; d.askToAct({ what: 'use', objectId: d.liftButtonObjectId }); });
  await both(2.1);
  carDoor.openedFromOutside = await liftDoors();
  check('down there with others the car stays, its door open until somebody shuts it: the panel in the car shuts it in every game and it stays shut with them in it, and the button outside opens it again',
    carDoor.stays && carDoor.atFirst.join() === '1,1' && carDoor.shut.join() === '0,0' && carDoor.toldOfShutting[1] && !carDoor.toldOfShutting[0] && carDoor.stillShut.join() === '0,0' &&
    carDoor.openedFromOutside.join() === '1,1', carDoor);
  // It never comes down on anybody: asked to shut with one of you in the doorway, it waits, and comes down when they are out of it.
  await b.evaluate(() => { const d = window.lastReturnDebug; d.teleport(d.liftPosition.x, d.liftPosition.z, 0); });
  await both(0.6);
  await a.evaluate(() => { const d = window.lastReturnDebug; d.askToAct({ what: 'use', objectId: d.liftButtonObjectId }); });
  await both(2.4);
  carDoor.withOneInTheDoorway = await liftDoors();
  await b.evaluate(wellAwayFromTheCar);
  await both(3);
  carDoor.withTheDoorwayClear = await liftDoors();
  check('the car\'s door never comes down on anybody: asked to shut with one of you in the doorway it waits, and comes down once they are out of it',
    carDoor.withOneInTheDoorway.join() === '1,1' && carDoor.withTheDoorwayClear.join() === '0,0', carDoor);
  // Shut, it keeps the Hollow out for a while and no longer. One of you is in the car with the door shut and
  // the Hollow is after them: it pounds on the door, and then it finds the button. (All of it in the host's
  // game, which is where the Hollow is run, and in one go: see the note on slow machines further down.)
  await a.evaluate(() => { const d = window.lastReturnDebug; d.askToAct({ what: 'use', objectId: d.liftButtonObjectId }); });
  await both(2.1);
  await b.evaluate(() => { const d = window.lastReturnDebug; d.teleport(d.playerStart.x, d.playerStart.z, 0); });
  await both(0.9);
  await b.evaluate(() => { const d = window.lastReturnDebug; d.askToAct({ what: 'use', objectId: d.liftPanelObjectId }); });
  await both(2.1);
  carDoor.shutWithOneInside = await liftDoors();
  const atTheDoor = await a.evaluate(() => {
    const d = window.lastReturnDebug, door = d.getLiftDoor(), result = { poundedFor: 0, blows: 0, opened: false, pressed: 0 };
    const hadPower = d.game.flags.powerOn;
    d.game.flags.powerOn = true; // (it only goes at doors once the mains is on)
    d.captionCounts.liftButtonPressed = 0;
    // Outside the door, three metres off, straight out from it: on the lobby's side, whichever way this station's car faces.
    const carX = (d.liftCarBounds.minimumX + d.liftCarBounds.maximumX) / 2, carZ = (d.liftCarBounds.minimumZ + d.liftCarBounds.maximumZ) / 2;
    const outX = Math.sign(Math.round(d.liftPosition.x - carX)), outZ = Math.sign(Math.round(d.liftPosition.z - carZ));
    const spot = d.findWalkableSpotNear(d.liftPosition.x + outX * 3, d.liftPosition.z + outZ * 3);
    result.spot = spot ? [spot.x, spot.z, Math.round(Math.hypot(spot.x - d.liftPosition.x, spot.z - d.liftPosition.z) * 10) / 10] : null;
    // You, the host, a long way from all this: it goes for whoever is nearest, and that is to be the one in the car.
    for (let step = 14; step < 40; step++) {
      const far = d.findWalkableSpotNear(d.liftPosition.x + outX * step, d.liftPosition.z + outZ * step);
      if (far && Math.hypot(far.x - d.liftPosition.x, far.z - d.liftPosition.z) > 11) { d.teleport(far.x, far.z, 0); break; }
    }
    result.hostMetresOff = Math.round(Math.hypot(d.player.x - d.liftPosition.x, d.player.z - d.liftPosition.z));
    if (!spot) return result;
    for (let count = 0; count < 2; count++) d.updateTogether(0.05); // (who is on their feet, and where: the one in the car)
    result.inTheCar = d.players.filter((one) => one !== d.player && one.x > d.liftCarBounds.minimumX && one.x < d.liftCarBounds.maximumX && one.z > d.liftCarBounds.minimumZ && one.z < d.liftCarBounds.maximumZ).length;
    d.spawnHollow(spot.x, spot.z); d.hollow.graceTimer = 0; d.hollow.knowsPlayerPositionAlways = true;
    // (Until the moment it presses the button, and no further: it is taken away then, before the door is up and
    // it is in the car with the one who is standing there.)
    // (Nothing is said to the others meanwhile: thirty seconds of the host's talk in one go is more than the
    // server lets anybody say, and it would hang up on the host.)
    for (let tenth = 0; tenth < 300 && !d.game.isLiftDoorWantedOpen; tenth++) {
      d.simulate(0.1);
      if (d.hollow.doorBang && d.hollow.doorBang.isPounding && door.openFraction === 0) { result.poundedFor += 0.1; result.blows = Math.max(result.blows, d.hollow.doorBang.hits); }
    }
    result.opened = d.game.isLiftDoorWantedOpen; result.doorWhenItPressed = door.openFraction; result.pressed = d.captionCounts.liftButtonPressed; result.damageAfter = door.damage;
    result.poundedFor = Math.round(result.poundedFor * 10) / 10;
    result.hollowEndedAt = [Math.round(d.hollow.figure.x * 10) / 10, Math.round(d.hollow.figure.z * 10) / 10, d.hollow.state];
    d.hollow.knowsPlayerPositionAlways = false; d.hollow.isActive = false;
    d.game.flags.powerOn = hadPower;
    return result;
  });
  await both(2.1);
  carDoor.afterTheHollow = await liftDoors();
  check('shut with one of you inside and the Hollow after them, the door holds while it pounds on it; then it finds the button, the door goes up in every game, and the door is whole for the next time',
    carDoor.shutWithOneInside.join() === '0,0' && atTheDoor.poundedFor >= 1.5 && atTheDoor.blows >= 3 && atTheDoor.opened && atTheDoor.pressed === 1 && atTheDoor.damageAfter === 0 &&
    carDoor.afterTheHollow.join() === '1,1', [carDoor.shutWithOneInside, atTheDoor, carDoor.afterTheHollow]);
  await b.evaluate(wellAwayFromTheCar);
  await both(0.6);

  // What Dispatch says at the moment somebody does a thing is for everybody; the line that only says what was
  // done is for the one who did it. (His lines used to be held back with the rest, so the others heard his
  // radio click and read nothing, unless the line had a recording.)
  const radioForAll = await b.evaluate(() => {
    const d = window.lastReturnDebug, messages = () => Array.from(document.querySelectorAll('#hud-messages .hud-message')).map((element) => element.textContent).join(' | ');
    d.clearMessages();
    d.game.actor = { x: d.player.x, z: d.player.z }; // as while something one of the others did is being carried out here
    try { d.playRadioLine('uploadStartedCarWaiting'); d.showMessage('Keycard taken.', 3, 'info'); } finally { d.game.actor = null; }
    return { line: d.radioText('uploadStartedCarWaiting'), shown: messages() };
  });
  check('while something one of the others did is carried out in your game, Dispatch\'s line about it is shown to you, and the line that only says what they did is not',
    radioForAll.line.length > 20 && radioForAll.shown.indexOf(radioForAll.line) >= 0 && radioForAll.shown.indexOf('Keycard taken.') < 0, radioForAll);

  // The Hollow treading on glass, and flinging a thing, are heard by everybody: the host's game makes those
  // sounds and passes them on, as it does its footsteps. Your own step on glass is your own.
  await b.evaluate(() => {
    window.soundsHeard = [];
    window.lastReturnDebug.together.socket.addEventListener('message', (event) => { const message = JSON.parse(event.data); if (message.t === 'said' && message.d && message.d.k === 'sound') window.soundsHeard.push(message.d.f); });
  });
  await a.evaluate(() => {
    const d = window.lastReturnDebug, here = { x: d.player.x, z: d.player.z };
    d.playNoisyFloorSound('glass', 0.5, here); // your own step: nobody else's business
    d.together.soundMode = 'share';            // as while the host's creatures are being run
    try { d.playNoisyFloorSound('glass', 1.6, here); d.playLooseObjectFlingSound(here.x, 1, here.z); } finally { d.together.soundMode = ''; }
  });
  await b.waitForFunction(() => window.soundsHeard.indexOf('playLooseObjectFlingSound') >= 0, null, { timeout: 5000 }).catch(() => {});
  const soundsHeard = await b.evaluate(() => window.soundsHeard.filter((name) => name === 'playNoisyFloorSound' || name === 'playLooseObjectFlingSound').join());
  check('the Hollow on glass and the Hollow flinging a thing are passed on to the others, once each; your own step on glass is not',
    soundsHeard === 'playNoisyFloorSound,playLooseObjectFlingSound', soundsHeard);

  // The car goes up when everyone is in it, and not before.
  await b.evaluate(() => {
    const d = window.lastReturnDebug; // well away from the car, wherever the checks above left them
    for (let step = 6; step < 20; step++) for (const way of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const spot = d.findWalkableSpotNear(d.playerStart.x + way[0], d.playerStart.z + way[1]);
      if (spot && Math.hypot(spot.x - d.playerStart.x, spot.z - d.playerStart.z) > 5) { d.teleport(spot.x, spot.z, 0); return; }
    }
  });
  await both(0.6);
  await a.evaluate(() => { const d = window.lastReturnDebug; d.game.flags.liftArrived = true; d.teleport(d.playerStart.x, d.playerStart.z, 0); });
  await both(0.9);
  const waiting = [await a.evaluate(() => window.lastReturnDebug.game.mode), await b.evaluate(() => window.lastReturnDebug.game.mode)];
  await b.evaluate(() => { const d = window.lastReturnDebug; d.teleport(d.playerStart.x, d.playerStart.z, 0); });
  await both(0.9);
  await b.waitForFunction(() => window.lastReturnDebug.game.mode !== 'playing', null, { timeout: 5000 }).catch(() => {});
  const up = [await a.evaluate(() => window.lastReturnDebug.game.mode), await b.evaluate(() => window.lastReturnDebug.game.mode)];
  check('the car waits while one of you is still outside', waiting[0] === 'playing' && waiting[1] === 'playing', waiting);
  check('and goes up with everyone once all are in it', up[0] === 'ascending' && up[1] === 'ascending', up);
  // (Back to play, for what is left of this suite.)
  await a.evaluate(() => { const d = window.lastReturnDebug; d.game.mode = 'playing'; d.game.flags.liftArrived = false; });
  await b.evaluate(() => { const d = window.lastReturnDebug; d.game.mode = 'playing'; });

  // Numbers no player could be at. They come from somebody else's browser, so they are held to the station.
  // (The host's game is kept from saying where it really is straight afterwards, which would put it right again.)
  // (Which way they face is held to between -pi and pi as it comes in. The way they are shown facing is turned towards
  // that from where it was, over a tenth of a second, and need not stay between those: turned past the back, it is a
  // full turn further on, which is the same way. So what is checked is that, after half a second, they are shown
  // facing the way that came in, whole turns aside.)
  await a.evaluate(() => { const d = window.lastReturnDebug; d.together.sendTimer = 1e9; d.together.socket.send(JSON.stringify({ t: 'say', d: { k: 'at', x: 1e300, z: -5, e: 1e9, w: 1e300, p: 9, c: 1, s: 1e9, vx: 1e300, vz: -1e300, r: 1e300 } })); });
  await b.waitForFunction(() => window.lastReturnDebug.together.others[0].spreadDegrees > 0);
  const wild = await b.evaluate(() => {
    const d = window.lastReturnDebug, other = d.together.others[0];
    for (let count = 0; count < 5; count++) d.updateTogether(0.1);
    return { x: other.x, z: other.z, eyeY: other.eyeY, yaw: other.yaw, towardsYaw: other.toYaw, blend: other.blend, pitch: other.pitch, spread: other.spreadDegrees };
  });
  const yawApart = Math.atan2(Math.sin(wild.yaw - wild.towardsYaw), Math.cos(wild.yaw - wild.towardsYaw)); // (wrapped to plus or minus pi)
  check('a position no player could be at is held to the station, and nothing hangs on it: they are shown there, facing the way that came in',
    wild.x <= 512 && wild.z === 0 && wild.eyeY <= 100 && wild.blend === 1 && Math.abs(yawApart) < 1e-6 && wild.pitch <= 1.6 && wild.spread <= 60, [wild, yawApart]);

  // ---- Everyone down ----
  // (The host well away from the other first: it catches everyone within its reach, and both stood in the car.)
  await a.evaluate(() => {
    const d = window.lastReturnDebug;
    for (let step = 6; step < 20; step++) for (const way of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const spot = d.findWalkableSpotNear(d.playerStart.x + way[0], d.playerStart.z + way[1]);
      if (spot && Math.hypot(spot.x - d.playerStart.x, spot.z - d.playerStart.z) > 5) { d.teleport(spot.x, spot.z, 0); return; }
    }
  });
  await both(0.6);
  await a.evaluate(() => { const d = window.lastReturnDebug, other = d.together.others[0]; d.spawnHollow(other.x + 0.3, other.z); d.hollow.graceTimer = 0; });
  await play(a, 0.2);
  await b.waitForFunction(() => window.lastReturnDebug.game.mode === 'dying' || window.lastReturnDebug.game.mode === 'dead', null, { timeout: 5000 }).catch(() => {});

  // One of you is dead and nobody carried their scanner back: the car goes up with those on their feet, and
  // the dead one is left behind. (They used to be taken up too: the ending, and a best time for it.)
  await drawUntilDead(b);
  // They fell in the lift car, so their scanner lies where one restarts. It has not been moved from where they
  // fell: it does not restart for lying there, however long. Moved by anything at all (nobody's beam: as if
  // the Hollow had kicked it) and lying there again, its seconds start; out of reach again before they are up,
  // they start over. (All in one go in the host's game: on a slow machine the seconds would pass between two
  // steps of this check anyway, and did, which is how this was found.)
  await a.waitForFunction(() => window.lastReturnDebug.looseObjects.some((object) => object.fallenPlayerId), null, { timeout: 8000 }).catch(() => {});
  const fellAtTheLift = await a.evaluate(() => {
    const d = window.lastReturnDebug, scanner = d.looseObjects.filter((object) => object.fallenPlayerId)[0], other = d.together.others[0];
    if (!scanner) return null;
    const result = { metresFromTheCar: Math.hypot(scanner.x - d.playerStart.x, scanner.z - d.playerStart.z), wasHandled: scanner.wasHandled };
    d.hollow.isActive = false;
    for (let count = 0; count < 12; count++) d.updateTogether(0.5); // six seconds; one that counts takes three
    result.stillLies = d.looseObjects.indexOf(scanner) >= 0; result.ownerIsDown = other.isDown; result.restartSeconds = scanner.restartSeconds;
    // Kicked a metre and a half off and back to where it lay: nobody's beam has had it, and it counts now.
    const x = scanner.x;
    scanner.x = x + 1.5; d.updateTogether(0.5);
    scanner.x = x; d.updateTogether(0.5); d.updateTogether(0.5);
    result.afterBeingMoved = { hasBeenMoved: scanner.hasBeenMoved, wasHandled: scanner.wasHandled, restartSeconds: scanner.restartSeconds, stillLies: d.looseObjects.indexOf(scanner) >= 0 };
    // Out of reach of the car again before the three seconds are up: they start over.
    scanner.x = x + 40; d.updateTogether(0.5);
    result.takenOutAgain = scanner.restartSeconds;
    // (Back as it was, for the checks that follow: not moved, where its owner fell.)
    scanner.x = x; scanner.hasBeenMoved = false; scanner.restartSeconds = 0;
    return result;
  });
  check('a scanner that lies at the lift because its owner fell there does not restart, however long it lies',
    fellAtTheLift !== null && fellAtTheLift.metresFromTheCar < 2 && !fellAtTheLift.wasHandled && fellAtTheLift.stillLies && fellAtTheLift.ownerIsDown && fellAtTheLift.restartSeconds === 0, fellAtTheLift);
  check('moved from there by anything, with nobody\'s beam on it, and lying at the lift again, its seconds start; out of reach before they are up, they start over',
    fellAtTheLift !== null && fellAtTheLift.afterBeingMoved.hasBeenMoved && !fellAtTheLift.afterBeingMoved.wasHandled && fellAtTheLift.afterBeingMoved.stillLies &&
    fellAtTheLift.afterBeingMoved.restartSeconds > 0.4 && fellAtTheLift.afterBeingMoved.restartSeconds < 3 && fellAtTheLift.takenOutAgain === 0, fellAtTheLift);
  await a.evaluate(() => {
    const d = window.lastReturnDebug;
    d.hollow.isActive = false;
    d.together.asked = {}; // (the car went up once already in this suite, further up: it is asked for once a descent)
    d.game.flags.liftArrived = true; d.teleport(d.playerStart.x, d.playerStart.z, 0);
  });
  await play(a, 0.3);
  await b.waitForFunction(() => window.lastReturnDebug.game.isLeftBehind, null, { timeout: 5000 }).catch(() => {});
  const leftBehind = { host: await a.evaluate(() => window.lastReturnDebug.game.mode),
    other: await b.evaluate(() => ({ mode: window.lastReturnDebug.game.mode, isLeftBehind: window.lastReturnDebug.game.isLeftBehind, told: document.getElementById('death-lines').textContent,
      canRetry: !document.getElementById('button-retry').hidden })) };
  // With everyone down there is nobody for it to go up with: a host lying dead in the car does not send it up.
  const nobodyToGoUp = await a.evaluate(() => {
    const d = window.lastReturnDebug, mode = d.game.mode;
    d.game.mode = 'dead'; d.together.asked = {};
    d.players.length = 0; d.players.push(d.player); // the list of who is on their feet, as it is with everyone down: you alone, so as never to be empty
    const others = d.players.filter((one) => one !== d.player).length;
    d.updateGameProgress(0.1);
    const asked = Object.keys(d.together.asked).join();
    d.game.mode = mode;
    return { others: others, asked: asked, inTheCar: d.game.flags.liftArrived };
  });
  check('the car goes up with those on their feet: one who is dead, with their scanner not carried back, is left behind and told so',
    leftBehind.host === 'ascending' && leftBehind.other.mode === 'dead' && leftBehind.other.isLeftBehind && /gone up without you/.test(leftBehind.other.told) && !leftBehind.other.canRetry, leftBehind);
  check('and with nobody on their feet it does not go up at all', nobodyToGoUp.others === 0 && nobodyToGoUp.inTheCar && nobodyToGoUp.asked.indexOf('ascend') < 0, nobodyToGoUp);
  // (Back as it was, for the check that follows.)
  await a.evaluate(() => { const d = window.lastReturnDebug; d.game.mode = 'playing'; d.game.flags.liftArrived = false; });
  await b.evaluate(() => { window.lastReturnDebug.game.isLeftBehind = false; });

  // (The host has not been hit yet in this suite, and one hit is not the death of anybody who is whole: so the
  // host is down to the last of their health first, and this hit is the one that takes it. 09-health.js)
  await a.evaluate(() => {
    const d = window.lastReturnDebug;
    d.player.health = 1; d.player.hurtGraceSeconds = 0;
    d.hollow.isActive = true; d.hollow.figure.x = d.player.x + 0.3; d.hollow.figure.z = d.player.z; d.hollow.graceTimer = 0; d.hollow.recoverSeconds = 0; d.hollow.crawlspace = null;
  });
  await play(a, 0.2);
  await drawUntilDead(a);
  await drawUntilDead(b);
  await b.evaluate(() => { for (let count = 0; count < 3; count++) window.lastReturnDebug.updateTogether(0.1); });
  await pause(200);
  await a.evaluate(() => { for (let count = 0; count < 3; count++) window.lastReturnDebug.updateTogether(0.1); });
  await b.waitForFunction(() => window.lastReturnDebug.game.isDescentLost, null, { timeout: 5000 }).catch(() => {});
  const allDown = [await a.evaluate(() => ({ mode: window.lastReturnDebug.game.mode, lost: window.lastReturnDebug.game.isDescentLost, told: document.getElementById('death-lines').textContent })),
    await b.evaluate(() => ({ mode: window.lastReturnDebug.game.mode, lost: window.lastReturnDebug.game.isDescentLost, told: document.getElementById('death-lines').textContent }))];
  check('when every one of you is down, nobody is left to carry anybody back, and everyone is told the descent is over',
    allDown[0].mode === 'dead' && allDown[1].mode === 'dead' && allDown[0].lost && allDown[1].lost && /Nobody is left/.test(allDown[0].told) && /Nobody is left/.test(allDown[1].told), allDown);

  // ---- A lobby lasts longer than one descent ----
  // A third joins while the two are down. They wait at the title screen.
  const third = await openGame({ address: address, width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
  const c = third.page;
  await c.fill('#together-code', code);
  await c.click('#button-join-lobby');
  await c.waitForFunction(() => window.lastReturnDebug.together.memberIds.length === 3 && window.lastReturnDebug.together.isRoundOn, null, { timeout: 8000 }).catch(() => {});
  const waiting3 = await c.evaluate(() => ({ members: window.lastReturnDebug.together.memberIds.length, isRoundOn: window.lastReturnDebug.together.isRoundOn, mode: window.lastReturnDebug.game.mode,
    button: document.getElementById('button-begin').textContent, disabled: document.getElementById('button-begin').disabled, station: window.lastReturnDebug.settings.station }));
  check('somebody can join while the others are down, and waits at the title screen for the next descent',
    waiting3.members === 3 && waiting3.isRoundOn && waiting3.mode === 'title' && waiting3.disabled && waiting3.button === 'Waiting for the others' && waiting3.station === 'generated', waiting3);

  // The host goes back up. That is the end of the descent for everyone, and nobody leaves the lobby over it.
  await a.evaluate(() => window.lastReturnDebug.returnToTitle());
  await b.waitForFunction(() => window.lastReturnDebug.game.mode === 'title', null, { timeout: 8000 }).catch(() => {});
  await c.waitForFunction(() => !window.lastReturnDebug.together.isRoundOn, null, { timeout: 8000 }).catch(() => {});
  const backUp = { host: await a.evaluate(() => ({ code: window.lastReturnDebug.together.code, members: window.lastReturnDebug.together.memberIds.length, players: window.lastReturnDebug.players.length })),
    other: await b.evaluate(() => ({ code: window.lastReturnDebug.together.code, mode: window.lastReturnDebug.game.mode, status: document.getElementById('together-status').textContent })),
    third: await c.evaluate(() => ({ isRoundOn: window.lastReturnDebug.together.isRoundOn, button: document.getElementById('button-begin').textContent })) };
  check('when the host goes back up the descent is over for everyone, and all are still in the lobby',
    backUp.host.code === code && backUp.host.members === 3 && backUp.host.players === 1 && backUp.other.code === code && backUp.other.mode === 'title' && /host has gone back up/.test(backUp.other.status) && !backUp.third.isRoundOn && backUp.third.button === 'Waiting for the host', backUp);

  // The next descent takes all three.
  await a.waitForFunction(() => window.lastReturnDebug.game.mode === 'title');
  await startGame(a, false);
  await b.waitForFunction(() => window.lastReturnDebug.game.mode === 'intro' || window.lastReturnDebug.game.mode === 'playing', null, { timeout: 10000 }).catch(() => {});
  await c.waitForFunction(() => window.lastReturnDebug.game.mode === 'intro' || window.lastReturnDebug.game.mode === 'playing', null, { timeout: 10000 }).catch(() => {});
  const second2 = [await a.evaluate(() => window.lastReturnDebug.together.others.length), await b.evaluate(() => window.lastReturnDebug.game.mode), await c.evaluate(() => window.lastReturnDebug.game.mode)];
  // (On their way down or already there: the lines on the way down take nine seconds, and on a slow machine
  // the host's own start can take longer than that.)
  const isDown = (mode) => mode === 'intro' || mode === 'playing';
  check('the host begins again and everyone in the lobby goes down, the one who waited included', second2[0] === 2 && isDown(second2[1]) && isDown(second2[2]), second2);
  await b.keyboard.press('Enter'); await c.keyboard.press('Enter');
  await c.waitForFunction(() => window.lastReturnDebug.game.mode === 'playing');

  // ---- Three down there: the dead one goes from one of the others to the next (src/js/11-watching.js) ----
  await b.waitForFunction(() => window.lastReturnDebug.game.mode === 'playing', null, { timeout: 10000 }).catch(() => {});
  // Dying takes frames, and three browsers draw them slowly: it is played out by hand here. Then they say they are down.
  const dieNow = (page) => page.evaluate(() => {
    const d = window.lastReturnDebug;
    d.setDebugOption && d.setDebugOption('invulnerable', false);
    d.triggerPlayerDeath('hollow', d.hollow.figure);
    for (let step = 0; step < 80 && d.game.mode === 'dying'; step++) d.updateDying(0.05);
    for (let count = 0; count < 3; count++) d.updateTogether(0.1);
    return d.game.mode;
  });
  const sayWhere = async () => { for (const page of [a, b, c]) await page.evaluate(() => { const d = window.lastReturnDebug; for (let count = 0; count < 3; count++) d.updateTogether(0.1); }); await pause(250); };
  await sayWhere();
  const diedThird = await dieNow(c);
  await sayWhere(); await sayWhere();
  await c.waitForFunction(() => window.lastReturnDebug.together.others.filter((other) => other.hasBeenHeardFrom && !other.isFallen).length === 2, null, { polling: 200, timeout: 20000 }).catch(() => {});
  await c.evaluate(() => { const d = window.lastReturnDebug; d.updateWatching(0.05); }); // (the death screen offers it once it has heard from them)
  await c.click('#button-watch');
  const three = await c.evaluate(() => {
    const d = window.lastReturnDebug, result = { ids: d.together.others.map((other) => other.id), order: [] };
    d.updateWatching(0.05);
    result.isOn = d.watching.isOn; result.first = d.watching.id; result.nextButton = !document.getElementById('button-watch-next').hidden; result.note = document.getElementById('watch-note').textContent;
    result.names = [document.getElementById('watch-name').textContent];
    return result;
  });
  await c.keyboard.press('KeyD');
  three.afterD = await c.evaluate(() => { window.lastReturnDebug.updateWatching(0.05); return { id: window.lastReturnDebug.watching.id, name: document.getElementById('watch-name').textContent }; });
  await c.keyboard.press('ArrowLeft');
  three.afterLeft = await c.evaluate(() => window.lastReturnDebug.watching.id);
  await c.click('#button-watch-next');
  three.afterTheButton = await c.evaluate(() => window.lastReturnDebug.watching.id);
  await c.evaluate(() => { const d = window.lastReturnDebug; d.renderer.canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true })); });
  three.afterAClick = await c.evaluate(() => window.lastReturnDebug.watching.id);
  check('with two of them on their feet you go from one to the next: D, the left arrow, the button and a click each move you on, and the bar names who it is',
    diedThird === 'dead' && three.isOn && three.ids.length === 2 && three.ids.indexOf(three.first) >= 0 && three.nextButton && /the next of them/.test(three.note) &&
    three.afterD.id !== three.first && three.ids.indexOf(three.afterD.id) >= 0 && three.afterD.name !== three.names[0] && three.afterLeft === three.first && three.afterTheButton === three.afterD.id && three.afterAClick === three.first, three);
  // The one they are watching falls: they are moved to the one who is left.
  const watchedPage = three.first === 1 ? a : b, watchedId = three.first;
  await dieNow(watchedPage);
  await sayWhere(); await sayWhere();
  await c.waitForFunction((watchedId) => { const d = window.lastReturnDebug, other = d.together.others.filter((one) => one.id === watchedId)[0]; return other && other.isFallen; }, watchedId, { polling: 200, timeout: 20000 }).catch(() => {});
  const movedOn = await c.evaluate(() => { const d = window.lastReturnDebug; d.updateWatching(0.05); return { id: d.watching.id, isOn: d.watching.isOn, nextButton: !document.getElementById('button-watch-next').hidden, name: document.getElementById('watch-name').textContent,
    log: d.chat.lines.filter((line) => /is down/.test(line.text)).length }; });
  check('when the one you are watching falls you are moved to the one who is still on their feet, and with one left there is nobody to go on to',
    movedOn.isOn && movedOn.id !== watchedId && three.ids.indexOf(movedOn.id) >= 0 && !movedOn.nextButton && movedOn.log >= 1, [watchedId, movedOn]);
  // Both are put on their feet again, as the host's game does it when a scanner has been carried back: the rest of
  // this suite wants them there.
  for (let turn = 0; turn < 2; turn++) {
    await a.evaluate(() => { const d = window.lastReturnDebug, scanner = d.looseObjects.filter((object) => object.fallenPlayerId)[0]; if (scanner) d.askToAct({ what: 'restart', id: scanner.id }); });
    await sayWhere();
  }
  await c.waitForFunction(() => window.lastReturnDebug.game.mode === 'playing', null, { polling: 200, timeout: 20000 }).catch(() => {});
  await watchedPage.waitForFunction(() => window.lastReturnDebug.game.mode === 'playing', null, { polling: 200, timeout: 20000 }).catch(() => {});
  await sayWhere();
  const upAgain = { third: await c.evaluate(() => { const d = window.lastReturnDebug; d.updateWatching(0.05); return { mode: d.game.mode, isOn: d.watching.isOn, bar: !document.getElementById('watch-bar').hidden }; }), watched: await watchedPage.evaluate(() => window.lastReturnDebug.game.mode) };
  check('their scanners restarted, both are on their feet and the one who watched has their own eyes back', upAgain.third.mode === 'playing' && !upAgain.third.isOn && !upAgain.third.bar && upAgain.watched === 'playing', upAgain);

  // One of them goes back up alone. They wait for the others; the descent goes on.
  await b.evaluate(() => window.lastReturnDebug.returnToTitle());
  // (Asked on a timer and given time: with three browsers drawing in software, the host's page has been seen to
  // take longer than eight seconds to get round to what it was told.)
  await a.waitForFunction(() => window.lastReturnDebug.together.others.length === 1, null, { polling: 200, timeout: 30000 }).catch(() => {});
  const wentUp = { other: await b.evaluate(() => ({ code: window.lastReturnDebug.together.code, isRoundOn: window.lastReturnDebug.together.isRoundOn, button: document.getElementById('button-begin').textContent })),
    host: await a.evaluate(() => ({ others: window.lastReturnDebug.together.others.length, mode: window.lastReturnDebug.game.mode, members: window.lastReturnDebug.together.memberIds.length })) };
  check('one who goes back up alone stays in the lobby and waits; for the others the descent goes on without them',
    wentUp.other.code === code && wentUp.other.isRoundOn && wentUp.other.button === 'Waiting for the others' && wentUp.host.others === 1 && wentUp.host.mode === 'playing' && wentUp.host.members === 3, wentUp);

  // The host's tab is hidden. A browser stops drawing it, and with that the game's own frames: the station goes on all the same.
  await a.keyboard.press('Escape');
  const unseen = await a.evaluate(async () => {
    const d = window.lastReturnDebug;
    Object.defineProperty(document, 'hidden', { get: function () { return true; }, configurable: true });
    window.requestAnimationFrame = function () { return 0; }; // nothing is drawn from here on
    await new Promise(function (resolve) { setTimeout(resolve, 200); });
    const before = d.game.time;
    await new Promise(function (resolve) { setTimeout(resolve, 900); });
    return { mode: d.game.mode, seconds: d.game.time - before };
  });
  check('the host\'s station goes on while the host\'s tab is hidden', unseen.mode === 'paused' && unseen.seconds > 0.5 && unseen.seconds < 1.5, unseen);

  // The one who is still down there is caught, and waits for somebody to carry their scanner back.
  // (Well away from the host first: it catches everyone within its reach, and both stood in the car. The host's
  // page draws nothing by now, so it is asked on a timer whether it has heard where they went.
  // And they say where they are themselves, at once. Where you are is said from a frame of your game, and with
  // three browsers drawing in software a page that is playing draws one every few seconds: on a slow machine
  // not one in the time the host waited. The Hollow was then put where they had been, not where they were, and
  // had not caught them when this went on.)
  await c.evaluate(() => {
    const d = window.lastReturnDebug;
    findSpot: for (let step = 6; step < 20; step++) for (const way of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const spot = d.findWalkableSpotNear(d.playerStart.x + way[0], d.playerStart.z + way[1]);
      if (spot && Math.hypot(spot.x - d.playerStart.x, spot.z - d.playerStart.z) > 5) { d.teleport(spot.x, spot.z, 0); break findSpot; }
    }
    for (let count = 0; count < 3; count++) d.updateTogether(0.1);
  });
  const hasHostHeard = await a.waitForFunction(() => { const d = window.lastReturnDebug, other = d.together.others[0]; return other && Math.hypot(other.x - d.player.x, other.z - d.player.z) > 4; }, null, { polling: 200, timeout: 20000 }).then(() => true, () => false);
  await a.evaluate(() => { const d = window.lastReturnDebug, other = d.together.others[0]; d.spawnHollow(other.x + 0.3, other.z); d.hollow.graceTimer = 0; });
  await c.waitForFunction(() => window.lastReturnDebug.game.mode === 'dying' || window.lastReturnDebug.game.mode === 'dead', null, { timeout: 15000 }).catch(() => {});
  await drawUntilDead(c);
  const waitingDead = await c.evaluate(() => ({ mode: window.lastReturnDebug.game.mode, told: document.getElementById('death-lines').textContent, canRetry: !document.getElementById('button-retry').hidden }));
  // (Shown when the check fails: whether the host's game caught them at all, and where its Hollow went.)
  waitingDead.asTheHostHasIt = await a.evaluate(() => { const d = window.lastReturnDebug, other = d.together.others[0]; return { mode: d.game.mode, others: d.together.others.length, players: d.players.length, isDown: other && other.isDown, hasBeenHeardFrom: other && other.hasBeenHeardFrom,
    metresToHost: other ? Math.hypot(other.x - d.player.x, other.z - d.player.z) : null, hollow: { isActive: d.hollow.isActive, state: d.hollow.state, metresToThem: other ? Math.hypot(d.hollow.figure.x - other.x, d.hollow.figure.z - other.z) : null, graceTimer: d.hollow.graceTimer } }; }).catch(() => null);
  // Being caught is the host's to say, and is heard when it is said, drawn or not. Dying is their own game's to
  // carry out, a second and a half of it, and that takes frames: so their page is drawn until they are dead.
  // (Only once they are dying. A picture of a page that is still playing is the slowest there is, and has been
  // seen to take longer than the thirty seconds a picture is given, which ended the suite then and there.)
  const isCaught = await c.waitForFunction(() => window.lastReturnDebug.game.mode === 'dying' || window.lastReturnDebug.game.mode === 'dead', null, { polling: 200, timeout: 30000 }).then(() => true, () => false);
  if (isCaught) await drawUntilDead(c);

  // The host leaves altogether. The lobby is over: whoever is down there stays, alone, and whoever waited has their own title screen back.
  await first.browser.close();
  await b.waitForFunction(() => window.lastReturnDebug.together.code === '');
  await c.waitForFunction(() => window.lastReturnDebug.together.code === '');
  // Nobody is coming for that scanner now: the one who was dead has their checkpoint back, as alone.
  const onTheirOwn = await c.evaluate(() => {
    const d = window.lastReturnDebug, result = { told: document.getElementById('death-lines').textContent, canRetry: !document.getElementById('button-retry').hidden,
      scannersLeft: d.looseObjects.filter((object) => object.fallenPlayerId).length };
    document.getElementById('button-retry').click();
    result.modeAfterRetry = d.game.mode;
    return result;
  });
  check('one who is dead when the host leaves is not left waiting for a scanner nobody will carry: the death screen offers the last checkpoint again, and it works',
    waitingDead.mode === 'dead' && !waitingDead.canRetry && /one of the others carries it/.test(waitingDead.told) &&
    onTheirOwn.canRetry && !/one of the others/.test(onTheirOwn.told) && onTheirOwn.scannersLeft === 0 && onTheirOwn.modeAfterRetry === 'playing', [waitingDead, onTheirOwn]);
  const alone = await c.evaluate(() => { const d = window.lastReturnDebug; return { others: d.together.others.length, mode: d.game.mode, players: d.players.length }; });
  const ownAgain = await b.evaluate(() => ({ station: window.lastReturnDebug.settings.station, canChange: !document.getElementById('title-station-size').disabled, button: document.getElementById('button-begin').textContent }));
  check('when the host leaves, whoever is down there stays down there alone', alone.others === 0 && alone.mode === 'playing' && alone.players === 1, alone);
  check('and whoever was waiting has their own title screen back, as they had left it', ownAgain.station === 'classic' && ownAgain.canChange && ownAgain.button === 'Begin descent', ownAgain);
  check('no script errors were reported', first.problems.length === 0 && second.problems.length === 0 && third.problems.length === 0, first.problems.concat(second.problems, third.problems));
  await third.browser.close();

  await second.browser.close();
  named.server.close();
  if (failures.length > 0) {
    console.error('\n' + failures.length + ' check(s) failed.');
    process.exit(1);
  }
  console.log('\nAll checks passed.');
  process.exit(0);
})().catch((error) => { console.error('Together test crashed:', error); process.exit(1); });
