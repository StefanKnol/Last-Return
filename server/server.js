// The server: `npm start`, or `node server/server.js`. It does two things.
//
//   - It serves the game, which is the one page `node build.js` makes (index.html).
//   - It keeps the lobbies of players who descend together. A lobby is a four-letter code and up to four
//     browsers. The server plays no part in the game: it hands on what one browser in a lobby says to the
//     others in it, and that is all. The page only offers "Descend together" when it was served from here.
//
// Settings, all from the environment:
//   PORT                      where to listen (8080)
//   LAST_RETURN_PAGE          the page to serve (index.html beside this folder)
//   LAST_RETURN_SERVER_NAME   what this server calls itself in the bug reports filed from the game, for example
//                             "Official server". Letters, digits, spaces, dots, underscores and hyphens, 40 at most.
//   LAST_RETURN_LOBBIES       "off" serves the game alone, with no lobbies
//
// What a browser says to the server, and what it hears back (one JSON object per message):
//   { t: 'host', build }          ->  { t: 'lobby', code, you, host, players }
//   { t: 'join', code, build }    ->  the same, or { t: 'refused', why: 'unknown' | 'full' | 'started' | 'build' | 'busy' }
//   { t: 'start', d }             the host only, once: nobody can join after it. The others hear { t: 'start', d }.
//   { t: 'say', d }               the others hear { t: 'said', from, d }
// and what it hears when the others come and go:
//   { t: 'joined', id }   { t: 'left', id }   { t: 'closed' } (the host has gone, and the lobby with them)
// `d` is the game's own business and is handed on unread. `build` is which build of the game the browser has:
// a station is only the same station for two browsers with the same build, so a lobby holds one build.
const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const { WebSocketServer } = require('ws');

const MAXIMUM_PLAYERS = 4;
const MAXIMUM_LOBBIES = 200;
const MAXIMUM_MESSAGE_BYTES = 4096;
const MAXIMUM_MESSAGES_PER_SECOND = 60; // a browser in play says where it is 15 times a second
const SECONDS_BETWEEN_PINGS = 30;       // a browser that has not answered the last one by the next is gone
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I and no O: read aloud or typed from a screenshot they are 1 and 0
const RELAY_PATH = '/relay';

// The page as it is served: with this server's name in it, and with the place its lobbies are reached at.
// Both go into a line build.js left empty for the purpose. A page without those lines is served as it is.
// `page` is the text of the page; the text to serve is returned. (The dev server uses this too.)
function fillInPage(page, serverName, hasLobbies) {
  const fill = function (metaName, content) {
    const empty = '<meta name="' + metaName + '" content="">';
    if (page.indexOf(empty) < 0) { console.warn('last-return: the page has no "' + metaName + '" line to fill in (an older page). Left out.'); return; }
    page = page.replace(empty, '<meta name="' + metaName + '" content="' + content + '">');
  };
  if (serverName) {
    // The name goes into an HTML attribute, so it is held to characters that mean nothing there.
    if (/^[A-Za-z0-9 ._-]{1,40}$/.test(serverName)) fill('last-return-server', serverName);
    else console.warn('last-return: LAST_RETURN_SERVER_NAME may only hold letters, digits, spaces, dots, underscores and hyphens, 40 at most. Left out.');
  }
  if (hasLobbies) fill('last-return-relay', RELAY_PATH);
  return page;
}

// Keeps the lobbies on an http server: browsers reach them at RELAY_PATH on it. Returns `lobbies` (the lobbies
// there are, by code) and `close`. `startServer` below uses it, and so does the dev server, so that
// `npm run dev` has lobbies too.
function keepLobbies(server) {
  const lobbies = new Map(); // by code: { code, build, hostId, isStarted, nextId, members: Map of id -> socket }

  const send = function (socket, message) {
    if (socket.readyState === socket.OPEN) socket.send(typeof message === 'string' ? message : JSON.stringify(message));
  };
  const sendToOthers = function (socket, message) {
    const text = JSON.stringify(message);
    for (const other of socket.lobby.members.values()) if (other !== socket) send(other, text);
  };
  const describeLobby = function (lobby, socket) {
    return { t: 'lobby', code: lobby.code, you: socket.playerId, host: lobby.hostId, players: Array.from(lobby.members.keys()) };
  };
  const enterLobby = function (lobby, socket) {
    socket.lobby = lobby;
    socket.playerId = lobby.nextId++;
    lobby.members.set(socket.playerId, socket);
    send(socket, describeLobby(lobby, socket));
    sendToOthers(socket, { t: 'joined', id: socket.playerId });
  };
  const leaveLobby = function (socket) {
    const lobby = socket.lobby;
    if (!lobby) return;
    socket.lobby = null;
    lobby.members.delete(socket.playerId);
    if (socket.playerId !== lobby.hostId) {
      for (const other of lobby.members.values()) send(other, { t: 'left', id: socket.playerId });
      return;
    }
    // The host has gone: the world was theirs, so the lobby goes with them.
    lobbies.delete(lobby.code);
    for (const other of lobby.members.values()) { other.lobby = null; send(other, { t: 'closed' }); other.close(1000, 'the host has left'); }
  };
  const makeCode = function () {
    for (;;) {
      let code = '';
      for (let position = 0; position < 4; position++) code += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
      if (!lobbies.has(code)) return code;
    }
  };

  const hear = function (socket, message) {
    const lobby = socket.lobby;
    if (message.t === 'host' && !lobby) {
      if (lobbies.size >= MAXIMUM_LOBBIES) { send(socket, { t: 'refused', why: 'busy' }); return; }
      const opened = { code: makeCode(), build: String(message.build).slice(0, 80), hostId: 1, isStarted: false, nextId: 1, members: new Map() };
      lobbies.set(opened.code, opened);
      enterLobby(opened, socket);
    } else if (message.t === 'join' && !lobby) {
      const wanted = lobbies.get(String(message.code).toUpperCase());
      let why = '';
      if (!wanted) why = 'unknown';
      else if (wanted.isStarted) why = 'started';
      else if (wanted.members.size >= MAXIMUM_PLAYERS) why = 'full';
      else if (wanted.build !== String(message.build).slice(0, 80)) why = 'build';
      if (why) send(socket, { t: 'refused', why: why });
      else enterLobby(wanted, socket);
    } else if (message.t === 'start' && lobby && socket.playerId === lobby.hostId && !lobby.isStarted) {
      lobby.isStarted = true;
      sendToOthers(socket, { t: 'start', d: message.d });
    } else if (message.t === 'say' && lobby) {
      sendToOthers(socket, { t: 'said', from: socket.playerId, d: message.d });
    }
    // Anything else is not something this server knows what to do with, and is let pass.
  };

  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAXIMUM_MESSAGE_BYTES });
  server.on('upgrade', function (request, connection, head) {
    // Only the page this server serves may open a lobby here: the browser says which page is asking.
    let isOwnPage = false;
    try { isOwnPage = new URL(request.headers.origin).host === request.headers.host; } catch (error) { /* no origin, or not an address */ }
    if (request.url !== RELAY_PATH || !isOwnPage) { connection.destroy(); return; }
    sockets.handleUpgrade(request, connection, head, function (socket) {
      socket.lobby = null; socket.playerId = 0; socket.hasAnswered = true; socket.messagesThisSecond = 0;
      socket.on('pong', function () { socket.hasAnswered = true; });
      socket.on('error', function () { /* it closes next, and that is where it is dealt with */ });
      socket.on('close', function () { leaveLobby(socket); });
      socket.on('message', function (data, isBinary) {
        if (isBinary || ++socket.messagesThisSecond > MAXIMUM_MESSAGES_PER_SECOND) { socket.close(1008, 'too much'); return; }
        let message = null;
        try { message = JSON.parse(data.toString('utf8')); } catch (error) { /* dealt with below */ }
        if (!message || typeof message !== 'object' || typeof message.t !== 'string') { socket.close(1007, 'not understood'); return; }
        hear(socket, message);
      });
    });
  });
  const everySecond = setInterval(function () { for (const socket of sockets.clients) socket.messagesThisSecond = 0; }, 1000);
  const pings = setInterval(function () {
    for (const socket of sockets.clients) {
      if (!socket.hasAnswered) { socket.terminate(); continue; }
      socket.hasAnswered = false;
      socket.ping();
    }
  }, SECONDS_BETWEEN_PINGS * 1000);
  // `close` ends them: call it before closing the http server, which waits for every connection to be gone.
  const close = function () { clearInterval(everySecond); clearInterval(pings); for (const socket of sockets.clients) socket.terminate(); };
  return { lobbies: lobbies, close: close };
}

// Starts the server. `options` are the settings above by another name (port, pagePath, serverName, lobbies);
// the tests use them. Returns the http server; `server.lobbies` is the lobbies there are, by code.
function startServer(options) {
  const settings = Object.assign({ port: 8080, pagePath: path.join(__dirname, '..', 'index.html'), serverName: '', lobbies: true }, options || {});
  const page = Buffer.from(fillInPage(fs.readFileSync(settings.pagePath, 'utf8'), settings.serverName, settings.lobbies), 'utf8');
  const pageZipped = zlib.gzipSync(page);

  const server = http.createServer(function (request, response) {
    const address = request.url.split('?')[0];
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405).end(); return; }
    if (address === '/healthz') { response.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok'); return; }
    if (address !== '/' && address !== '/index.html') { response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    const takesZipped = /\bgzip\b/.test(String(request.headers['accept-encoding'] || ''));
    const body = takesZipped ? pageZipped : page;
    const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-cache', 'Vary': 'Accept-Encoding' };
    if (takesZipped) headers['Content-Encoding'] = 'gzip';
    response.writeHead(200, headers).end(request.method === 'HEAD' ? undefined : body);
  });

  const kept = settings.lobbies ? keepLobbies(server) : null;
  server.lobbies = kept ? kept.lobbies : new Map();
  const closeServer = server.close.bind(server);
  server.close = function (done) { if (kept) kept.close(); return closeServer(done); }; // the lobbies go first, or it would wait for them for ever

  server.listen(settings.port);
  return server;
}

module.exports = { startServer, keepLobbies, fillInPage };

if (require.main === module) {
  const port = Number(process.env.PORT) || 8080;
  const hasLobbies = process.env.LAST_RETURN_LOBBIES !== 'off';
  startServer({
    port: port,
    pagePath: process.env.LAST_RETURN_PAGE || path.join(__dirname, '..', 'index.html'),
    serverName: (process.env.LAST_RETURN_SERVER_NAME || '').trim(),
    lobbies: hasLobbies
  });
  // Asked to stop (a container being replaced, Ctrl+C): stop now. A process that is first in its container is
  // not stopped by being asked unless it says so itself.
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, function () { process.exit(0); });
  console.log('last-return: serving the game on port ' + port + (hasLobbies ? ', with lobbies.' : ', without lobbies.'));
}
