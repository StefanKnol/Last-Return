// Checks descending together: the server that serves the game and keeps the lobbies (server/server.js), and
// two browsers that go down into the same station through it and see each other.
const path = require('path');
const http = require('http');
const { WebSocket } = require('ws');
const { startServer } = require('../server/server.js');
const { openGame, startGame } = require('./browser-harness.js');

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
function connect(host, origin) {
  return new Promise(function (resolve) {
    const socket = new WebSocket('ws://' + host + '/relay', { origin: origin || 'http://' + host });
    const member = { socket: socket, heard: [], waiting: [], isClosed: false, wasRefusedAtTheDoor: false };
    member.say = function (message) { socket.send(JSON.stringify(message)); };
    member.next = function () {
      if (member.heard.length > 0) return Promise.resolve(member.heard.shift());
      if (member.isClosed) return Promise.resolve({ t: 'gone' });
      return new Promise(function (hand) { member.waiting.push(hand); });
    };
    const give = function (message) { if (member.waiting.length > 0) member.waiting.shift()(message); else member.heard.push(message); };
    socket.on('message', function (data) { give(JSON.parse(data.toString())); });
    socket.on('close', function () { member.isClosed = true; for (const hand of member.waiting.splice(0)) hand({ t: 'gone' }); });
    socket.on('open', function () { resolve(member); });
    socket.on('error', function () { member.wasRefusedAtTheDoor = true; member.isClosed = true; resolve(member); });
  });
}

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
  check('opening a lobby gives a four-letter code, and you are its host', /^[A-HJ-NP-Z]{4}$/.test(lobby.code) && lobby.you === 1 && lobby.host === 1 && lobby.players.length === 1, lobby);

  const lost = await connect(named.host);
  lost.say({ t: 'join', code: 'QQQQ' === lobby.code ? 'ZZZZ' : 'QQQQ', build: 'one' });
  const otherBuild = await connect(named.host);
  otherBuild.say({ t: 'join', code: lobby.code, build: 'two' });
  check('a code that is no lobby is refused, and so is another build of the game', (await lost.next()).why === 'unknown' && (await otherBuild.next()).why === 'build');

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
  fifth.say({ t: 'join', code: lobby.code, build: 'one' });
  check('nobody joins a lobby that has gone down', (await fifth.next()).why === 'started');

  guests[2].member.socket.close();
  let left = await host.next();
  while (left.t !== 'left') left = await host.next();
  check('the others hear of one who leaves', left.id === 4, left);
  host.socket.close();
  let closed = await guests[1].member.next();
  while (closed.t !== 'closed' && closed.t !== 'gone') closed = await guests[1].member.next();
  await pause(100);
  check('when the host leaves, the lobby is over for everyone', closed.t === 'closed' && named.server.lobbies.size === 0, [closed, named.server.lobbies.size]);

  const noisy = await connect(named.host);
  for (let count = 0; count < 200; count++) noisy.say({ t: 'say', d: {} });
  await pause(300);
  check('a member that says far too much is shown the door', noisy.isClosed);
  for (const member of [lost, otherBuild, fifth, guests[0].member, guests[1].member]) member.socket.close();

  // ---- Two browsers ----
  const address = 'http://' + named.host + '/';
  const first = await openGame({ address: address });
  const second = await openGame({ address: address });
  const a = first.page, b = second.page;

  check('the title screen offers a lobby when the page comes from the server', await a.isVisible('#button-host-lobby'));
  await a.evaluate(() => { const d = window.lastReturnDebug; d.settings.station = 'generated'; d.settings.seedText = '4471'; d.settings.stationSize = 'small'; d.settings.difficulty = 'standard'; d.settings.workOrders = { salvage: true, survey: false, recovery: false, restart: false }; });
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

  // The other's click on "Join" is forgotten by the browser after a few seconds. The host begins after that.
  await b.waitForFunction(() => !navigator.userActivation.isActive, null, { timeout: 15000 });
  await startGame(a, false);
  // The other has clicked nothing since joining. They go down all the same.
  const wentDown = await b.waitForFunction(() => window.lastReturnDebug.game.mode === 'intro', null, { timeout: 10000 }).then(() => true, () => false);
  check('when the host begins, the other goes down with them', wentDown, await b.evaluate(() => window.lastReturnDebug.game.mode));
  await b.keyboard.press('Enter'); // past the intro
  await b.waitForFunction(() => window.lastReturnDebug.game.mode === 'playing');
  check('and is not told that the mouse cannot be captured, for want of a click', !(await b.textContent('#hud-messages')).includes('Mouse capture is not available'));
  const station = async (page) => page.evaluate(() => { const d = window.lastReturnDebug; return { seed: d.level.seed, map: d.level.mapFingerprint, order: d.level.workOrder, difficulty: d.game.difficulty.label, players: d.players.length }; });
  const stationA = await station(a), stationB = await station(b);
  check('both are in the same station, built the same to the tile, at the host\'s threat level',
    stationA.seed === 4471 && stationA.map === stationB.map && stationA.order === stationB.order && stationA.difficulty === 'Standard' && stationB.difficulty === 'Standard', [stationA, stationB]);
  check('a descent together is never for salvage, which is about things that still lie loose in each browser alone', stationA.order !== 'salvage', stationA.order);
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

  // ---- One station: the host's creatures, doors and work order are everybody's ----
  // A stretch of play in one browser: its own game, and what it says to the others.
  const play = (page, seconds) => page.evaluate((seconds) => {
    const d = window.lastReturnDebug;
    for (let time = 0; time < seconds; time += 0.1) { d.simulate(0.1); d.updateTogether(0.1); }
  }, seconds);
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
  await both(0.6);
  const doorBefore = [await a.evaluate((index) => window.lastReturnDebug.doors[index].openFraction, doorIndex), await b.evaluate((index) => window.lastReturnDebug.doors[index].openFraction, doorIndex)];
  await b.evaluate((index) => { const d = window.lastReturnDebug, door = d.doors[index]; d.teleport(door.centerX, door.centerZ, 0); d.player.velocityX = 0; d.player.velocityZ = 0; }, doorIndex);
  await both(2.4);
  const doorAfter = [await a.evaluate((index) => window.lastReturnDebug.doors[index].openFraction, doorIndex), await b.evaluate((index) => window.lastReturnDebug.doors[index].openFraction, doorIndex)];
  check('a door opens for the other in the host\'s game, and the other\'s door follows it', doorBefore[0] === 0 && doorBefore[1] === 0 && doorAfter[0] === 1 && doorAfter[1] === 1, [doorBefore, doorAfter]);

  // The host's Hollow: shown to the other where the host has it, and it hears the other.
  const hollowAt = await a.evaluate(() => {
    const d = window.lastReturnDebug, other = d.together.others[0];
    let spot = null;
    for (const way of [[9, 0], [-9, 0], [0, 9], [0, -9], [6, 6], [-6, -6]]) { const tried = d.findWalkableSpotNear(other.x + way[0], other.z + way[1]); if (tried && Math.hypot(tried.x - other.x, tried.z - other.z) > 5) { spot = tried; break; } }
    d.spawnHollow(spot.x, spot.z);
    d.hollow.graceTimer = 0; d.hollow.state = 4; d.hollow.listenTimer = 30; // standing, listening
    return spot;
  });
  await both(1.2);
  const hollowSeen = await b.evaluate(() => { const d = window.lastReturnDebug; return { isActive: d.hollow.isActive, x: d.hollow.figure.x, z: d.hollow.figure.z, state: d.hollow.state, capsules: d.hollow.figure.capsuleCount }; });
  check('the other is shown the host\'s Hollow where the host has it, doing what it is doing', hollowSeen.isActive && Math.hypot(hollowSeen.x - hollowAt.x, hollowSeen.z - hollowAt.z) < 0.6 && hollowSeen.state === 4 && hollowSeen.capsules > 20, [hollowAt, hollowSeen]);
  const roarsBefore = await b.evaluate(() => { const d = window.lastReturnDebug; return (d.captionCounts.hollowFound || 0) + (d.captionCounts.hollowRoar || 0); });
  await b.evaluate(() => { const d = window.lastReturnDebug; d.emitNoise(d.player.x, d.player.z, 60); });
  await pause(150);
  await both(0.6);
  const heard = { host: await a.evaluate(() => { const d = window.lastReturnDebug; return { state: d.hollow.state, at: Math.hypot(d.hollow.lastKnownPlayerX - d.together.others[0].x, d.hollow.lastKnownPlayerZ - d.together.others[0].z) }; }),
    roars: await b.evaluate(() => { const d = window.lastReturnDebug; return (d.captionCounts.hollowFound || 0) + (d.captionCounts.hollowRoar || 0); }) - roarsBefore };
  check('noise the other makes is heard by the host\'s Hollow, which hunts them', heard.host.state === 2 && heard.host.at < 2.5, heard);
  check('and the other hears it roar', heard.roars >= 1, heard);

  // It reaches them. That is their death, in their own game; the host plays on, and the Hollow is sent away.
  await a.evaluate(() => { const d = window.lastReturnDebug, other = d.together.others[0]; d.hollow.figure.x = other.x + 0.3; d.hollow.figure.z = other.z; d.hollow.graceTimer = 0; });
  await play(a, 0.2);
  await b.waitForFunction(() => window.lastReturnDebug.game.mode === 'dying' || window.lastReturnDebug.game.mode === 'dead', null, { timeout: 5000 }).catch(() => {});
  const caught = { other: await b.evaluate(() => window.lastReturnDebug.game.mode),
    host: await a.evaluate(() => { const d = window.lastReturnDebug, other = d.together.others[0]; return { mode: d.game.mode, isDown: other.isDown, players: d.players.length, metresAway: Math.hypot(d.hollow.figure.x - other.x, d.hollow.figure.z - other.z) }; }) };
  check('the host\'s Hollow catching the other is the other\'s death and nobody else\'s', (caught.other === 'dying' || caught.other === 'dead') && caught.host.mode === 'playing', caught);
  check('and it does not stand over them: it is sent off, and they are not hunted while they are down', caught.host.isDown && caught.host.metresAway > 6, caught);
  // The station does not stop for the dead.
  await b.waitForFunction(() => window.lastReturnDebug.game.mode === 'dead', null, { timeout: 15000 });
  const timeBefore = await b.evaluate(() => window.lastReturnDebug.game.time);
  for (let count = 0; count < 4; count++) await b.screenshot({ type: 'jpeg', quality: 5 });
  check('the station goes on while you lie dead', await b.evaluate((before) => window.lastReturnDebug.game.time > before, timeBefore));
  await b.evaluate(() => window.lastReturnDebug.retryFromCheckpoint());
  await a.waitForFunction(() => !window.lastReturnDebug.together.others[0].isDown, null, { timeout: 5000 }).catch(() => {});
  await both(0.6);
  check('back on their feet, they are one of the players again', await a.evaluate(() => window.lastReturnDebug.players.length === 2 && !window.lastReturnDebug.together.others[0].isDown));
  await a.evaluate(() => { window.lastReturnDebug.hollow.isActive = false; });

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
    host: await a.evaluate(() => { const d = window.lastReturnDebug; return { level: d.game.flags.keycardLevel, gone: !d.findInteractable(d.keycardObjectIds[1]).isAvailable, told: document.getElementById('hud-messages').textContent.includes('eycard') }; }),
    other: await b.evaluate(() => { const d = window.lastReturnDebug; return { level: d.game.flags.keycardLevel, gone: !d.findInteractable(d.keycardObjectIds[1]).isAvailable, told: document.getElementById('hud-messages').textContent.includes('eycard') }; }) };
  check('a keycard one of you takes is taken in every game, once the host has said so', card.before === 0 && card.host.level === 1 && card.other.level === 1 && card.host.gone && card.other.gone, card);
  check('and only the one who took it is told so', card.other.told && !card.host.told, card);

  // The menu does not stop the host's station.
  await a.keyboard.press('Escape');
  const paused = await a.evaluate(() => ({ mode: window.lastReturnDebug.game.mode, time: window.lastReturnDebug.game.time }));
  for (let count = 0; count < 4; count++) await a.screenshot({ type: 'jpeg', quality: 5 });
  check('the host\'s station goes on while the host has the menu open', paused.mode === 'paused' && await a.evaluate((before) => window.lastReturnDebug.game.time > before, paused.time), paused);
  await a.keyboard.press('Escape');
  await a.waitForFunction(() => window.lastReturnDebug.game.mode === 'playing');

  // The car goes up when everyone is in it, and not before.
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
  await a.evaluate(() => { const d = window.lastReturnDebug; d.together.sendTimer = 1e9; d.together.socket.send(JSON.stringify({ t: 'say', d: { k: 'at', x: 1e300, z: -5, e: 1e9, w: 1e300, p: 9, c: 1, s: 1e9, vx: 1e300, vz: -1e300, r: 1e300 } })); });
  await b.waitForFunction(() => window.lastReturnDebug.together.others[0].spreadDegrees > 0);
  const wild = await b.evaluate(() => {
    const d = window.lastReturnDebug, other = d.together.others[0];
    for (let count = 0; count < 5; count++) d.updateTogether(0.1);
    return { x: other.x, z: other.z, eyeY: other.eyeY, yaw: other.yaw, pitch: other.pitch, spread: other.spreadDegrees };
  });
  check('a position no player could be at is held to the station, and nothing hangs on it',
    wild.x <= 512 && wild.z === 0 && wild.eyeY <= 100 && Math.abs(wild.yaw) <= Math.PI && wild.pitch <= 1.6 && wild.spread <= 60, wild);

  // The host leaves. The other stays down, alone.
  await first.browser.close();
  await b.waitForFunction(() => window.lastReturnDebug.together.code === '');
  const alone = await b.evaluate(() => { const d = window.lastReturnDebug; return { others: d.together.others.length, mode: d.game.mode, hit: d.fireScanPulse(d.player.x, d.getPlayerEyeY() - 0.4, d.player.z + 0.9, 0, 0, -1, false) && d.rayHit.figure !== null }; });
  check('when the host leaves, the other stays down there alone, and the host\'s body is gone', alone.others === 0 && alone.mode === 'playing' && !alone.hit, alone);
  check('no script errors were reported', first.problems.length === 0 && second.problems.length === 0, first.problems.concat(second.problems));

  await second.browser.close();
  named.server.close();
  if (failures.length > 0) {
    console.error('\n' + failures.length + ' check(s) failed.');
    process.exit(1);
  }
  console.log('\nAll checks passed.');
  process.exit(0);
})().catch((error) => { console.error('Together test crashed:', error); process.exit(1); });
