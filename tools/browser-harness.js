// Shared helper for the scripts in this folder: opens the built game in Chromium without a window.
// `openGame({ dev: true })` opens the dev build instead (build/workshop.html), which has debug mode in it.
// Needs Playwright (npm install, then npx playwright install chromium).
const path = require('path');
const { chromium } = require('playwright');

// Which browser the suites run in: the real one, and not the one Playwright would pick by itself.
//
// Playwright comes with two Chromiums. Left to itself, with no window to show, it starts the "headless shell":
// a small build made for servers, with a windowing layer of its own. Asked for `channel: 'chromium'` it starts
// the browser itself, the one players have, only without a window. `npx playwright install chromium` fetches both.
//
// The shell has a fault that this game walks straight into. While a page holds the mouse (the game takes it
// on "Begin descent", and gives it back at the menu, when you die, when the lift goes up and at the title
// screen), the shell sends that page mouse moves without end: 80,000 to 90,000 a second, every one of them a
// move of nothing, with nobody touching anything. (Its main process makes up a mouse move, and dealing with
// that one makes up the next: a trace shows some 50,000 tasks a second there, all posted by
// `PostSynthesizeMouseMove`.) The page makes an object of every one of them, and they are handed to the game
// a frame's worth at a time.
//
// What that cost, measured on a machine with four cores:
//   - One browser: a core and more in the browser's main process and another in the page, for nothing, and
//     the game running at a quarter to four fifths of its speed.
//   - Three browsers playing at once, as in together-test.js: no page keeps up any more. The moves pile up
//     faster than they are dealt with, a frame takes seconds, and within three minutes the pages have grown
//     to 2.5 to 4 GB and the browsers' main processes to 1 to 2 GB each. (In together-test.js that came to
//     14 GB on a machine with 15, where the kernel then killed a browser: "Target crashed".) The same three
//     browsers with the mouse not held: 0.2 GB a page, and flat.
//   - It is let go the moment the mouse is: which is why the memory fell at the title screen, and why it
//     looked like something a descent left behind.
// The real browser sends a page that holds a still mouse nothing at all (the same version of Chromium, 158,
// was tried as both). In it together-test.js takes two minutes where it took six to eight, and its pages stay
// at 0.4 GB where they reached 2 to 3.7; most of the other suites are quicker as well, by a third to a half.
// together-test.js checks that no moves arrive, so that this cannot come back unnoticed.
//
// `launchBrowser()` is the one place a suite gets its browser from. The frames are drawn in software
// (SwiftShader), so a machine without a graphics card will do.
function launchBrowser() {
  return chromium.launch({
    channel: 'chromium',
    // (The last two give a page that asks for the microphone a made-up one, without asking anybody: a tone that
    // beeps. The two-player suite talks through it. No other suite asks for a microphone.)
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  });
}

// How many mouse moves reach a page in a stretch of time, with whether it holds the mouse. Every move the
// browser was sent is counted, also the ones it puts together into one event a frame.
function countMouseMoves(page, milliseconds) {
  return page.evaluate((milliseconds) => new Promise((resolve) => {
    let moves = 0;
    const countMove = (event) => { moves += Math.max(1, event.getCoalescedEvents().length); };
    window.addEventListener('pointermove', countMove, true);
    window.setTimeout(() => {
      window.removeEventListener('pointermove', countMove, true);
      resolve({ moves: moves, isMouseHeld: document.pointerLockElement !== null });
    }, milliseconds);
  }), milliseconds);
}

// A long stretch of script, and the browser's own housekeeping.
//
// While a script of the page runs, the browser does nothing else in that page. Memory the script has let go
// of is not handed back, sounds that have ended are not cleared away, timers do not fire: all of that waits
// until the script has finished. A check that plays minutes of the game inside one `page.evaluate` is one
// such script, and what waits can come to gigabytes. The 520 chases through doorways in locked-doors-test.js
// (about 125,000 frames) left the page holding 1.8 to 2.3 GB. (Before the game put a limit on its own sounds,
// MAXIMUM_PLACED_SOUNDS and MAXIMUM_SHORT_SOUNDS in src/js/07-audio.js, they came to 9.7 GB: sounds that
// could not end.)
//
// So a long check hands the page back to the browser now and then. Inside the page, in a function marked
// `async`:
//     await window.letTheBrowserCatchUp();
// With one of those after every door, the chases stay at 1.1 to 1.4 GB. quests-test.js and generators-test.js
// take one before every station they build, 286 and 64 of them: 2.6 and 2.3 GB came down to 1.1 to 1.6.
// (All of those figures were measured in Playwright's headless shell, where a page that holds the mouse was
// being sent mouse moves by the ten thousand as well: see "Which browser the suites run in" above. They piled
// up during a long stretch of script like everything else. In the real browser, with the pauses in, the three
// suites peak at 0.5 to 1.0 GB.)
//
// The game draws nothing in such a pause, and does not move on in it. Left alone it would: a frame of its own
// comes up in nearly every pause, and drawing one is slow in these tests. With those frames drawn, the pauses
// added a minute to quests-test.js on a fast machine and nine minutes on the one GitHub runs the tests on.
// So a frame that comes up during a pause is kept waiting and asked for again afterwards; it is drawn once
// the check has finished. A pause then takes about a twentieth of a second, and both suites finish sooner
// than they did with no pauses at all.
// To see what a suite holds at the most: `node tools/measure-memory.js tools/<suite>-test.js`.
// Every page `openGame` opens has the function, also after the page is loaded again.
function installLetTheBrowserCatchUp() {
  // The game asks for each of its frames through this, so that one that comes up during a pause can be kept waiting.
  const askBrowserForFrame = window.requestAnimationFrame.bind(window);
  const framesKeptWaiting = [];
  let isCatchingUp = false;
  window.requestAnimationFrame = function (drawFrame) {
    return askBrowserForFrame(function (timestamp) {
      if (isCatchingUp) framesKeptWaiting.push(drawFrame);
      else drawFrame(timestamp);
    });
  };
  window.letTheBrowserCatchUp = function () {
    isCatchingUp = true;
    return new Promise(function (resolve) {
      window.setTimeout(function () {
        isCatchingUp = false;
        // What was kept waiting is asked for again, and is drawn once the check has finished.
        for (const drawFrame of framesKeptWaiting.splice(0)) window.requestAnimationFrame(drawFrame);
        resolve();
      }, 0);
    });
  };
}

const gamePagePath = path.join(__dirname, '..', 'index.html');
const devPagePath = path.join(__dirname, '..', 'build', 'workshop.html');

// Runs in the page before any of its own script, and settles four things about the stations the checks build.
// The game is told as soon as it puts out its test hook, so that both hold after a reload too.
//
// From the code alone. The checks are made on stations that are built without the rooms in src/rooms/ and the
// loose things in src/objects/, which the workshop makes. Whatever anybody makes there, a check that needs a
// particular situation (a cover lying where it can be walked over, a crate behind a door) finds the same
// stations to look for it in. (What the workshop makes is checked where that is the point:
// generated-station-test.js builds its hundred and twenty stations with all of it, and workshop-test.js makes
// a room and an object of its own.)
//
// Other stations. No check may hang on what one particular seed happens to build: a new room in the catalogue,
// a new kind of loose thing, a change to how stations are planned, and every seed builds another station from
// then on. To try that without changing the game, `otherStations` (a whole number) is added to every seed a
// check asks the test hook for, so that every check gets stations it has never seen:
//     node tools/run-tests.js --other-stations=1000
// A check that passes as usual and fails like this was written against one station, not against a rule. (Only
// the stations a check builds through the test hook are other ones. A seed typed into the menu is taken as it is.)
//
// In the annex. The title screen leaves where a station is to its seed, unless a place is chosen there
// (src/js/03-locations.js). A check that looks a station up through the test hook, which builds the pumping
// annex unless it is told another place, and then goes down into that seed from the title screen, has to find
// the station it looked up: so in these pages "Place" is set to the annex, unless the suite opens its page with
// `anyPlace: true` (generated-station-test.js, for the checks that are about exactly this).
//
// Nothing arrives by itself. In a generated station the Hollow comes in its own time: after some minutes drawn
// by chance, sooner for every noise (src/js/08-arrivals.js). A check about doors or fuel that plays a few
// minutes of a descent would be walked in on, now and then, and fail for it. So in these pages it only comes
// when Generator 2 is started, as it always did, unless the suite opens its page with `arrivals: true`
// (arrivals-test.js, which is about exactly this, and one check of together-test.js).
function installTestStations(testStations) {
  let hook;
  Object.defineProperty(window, 'lastReturnDebug', {
    configurable: true,
    get: function () { return hook; },
    set: function (value) {
      hook = value;
      if (!value) return;
      if (testStations.areFromCodeAlone && value.setWorkshopContentUsed) value.setWorkshopContentUsed(false);
      if (testStations.areArrivalsHeld && value.debugState) value.debugState.areArrivalsHeld = true;
      if (testStations.isInTheAnnex && value.settings) {
        value.settings.stationLocation = 'annex';
        const control = document.getElementById('title-station-location');
        if (control) control.value = 'annex';
      }
      if (!testStations.hasLooters && value.setLootersWanted) value.setLootersWanted(false);
      if (testStations.otherStations && value.loadStation) {
        const loadStationAsAsked = value.loadStation;
        value.loadStation = function (kind, seed) {
          const asked = Array.prototype.slice.call(arguments);
          if (kind === 'generated' && typeof seed === 'number') asked[1] = seed + testStations.otherStations;
          return loadStationAsAsked.apply(null, asked);
        };
      }
    }
  });
}

// The number to add to every seed (see "Other stations" above), or 0: from `--other-stations` of run-tests.js,
// or set by hand as TEST_OTHER_STATIONS when one suite is run by itself.
function readOtherStations() {
  const number = Math.floor(Number(process.env.TEST_OTHER_STATIONS || 0));
  return number > 0 ? number : 0;
}

// `workshopContent: true` leaves the stations as the game builds them, with what the workshop made.
// `arrivals: true` lets the Hollow come by itself, as it does in the game.
// `anyPlace: true` leaves "Place" on the title screen as the game has it: anywhere, the seed says where. Without
// it a descent begun from the title screen is in the pumping annex, where the stations a check has looked up by
// their seed are (the test hook builds the annex unless it is told another place).
// `looters: true` leaves the looters in the stations (src/js/08-looter.js). Without it a station has none: what a
// looter carries off is chance, and the checks that are about something else are not to have their things taken.
async function openGame(options) {
  const settings = Object.assign({ width: 1280, height: 720, deviceScaleFactor: 1, isPhone: false, dev: false, address: '', workshopContent: false, arrivals: false, looters: false, anyPlace: false }, options || {});
  const browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: settings.width, height: settings.height },
    deviceScaleFactor: settings.deviceScaleFactor,
    hasTouch: settings.isPhone,
    isMobile: settings.isPhone
  });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push('console error: ' + message.text());
  });
  page.on('pageerror', (error) => problems.push('page error: ' + error.message));
  await page.addInitScript(installLetTheBrowserCatchUp);
  await page.addInitScript(installTestStations, { areFromCodeAlone: !settings.workshopContent, otherStations: readOtherStations(), areArrivalsHeld: !settings.arrivals, hasLooters: settings.looters,
    isInTheAnnex: !settings.anyPlace });
  // `address` opens the game where a server has it (together-test.js); otherwise it is opened from its file.
  await page.goto(settings.address || 'file://' + (settings.dev ? devPagePath : gamePagePath));
  await page.waitForFunction((needsDebugMode) => Boolean(window.lastReturnDebug && (!needsDebugMode || window.lastReturnDebug.setDebugOption)), settings.dev);
  return { browser, page, problems };
}

// Starts a new game and skips the intro text.
async function startGame(page, isPhone) {
  if (isPhone) {
    await page.tap('#button-begin');
    await page.waitForTimeout(400);
    await page.tap('#button-skip-intro');
  } else {
    await page.click('#button-begin');
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
  }
  // An upright phone goes straight to the "turn your phone sideways" screen instead of play.
  await page.waitForFunction(() => ['playing', 'rotate'].includes(window.lastReturnDebug.game.mode));
}

// Headless Chromium only draws new frames when asked, so this nudges it to draw a few.
// A frame is drawn in software, and on a machine that is busy with other work one frame has been seen to
// take seven seconds where it usually takes a tenth of one. So a frame gets two minutes, not the usual
// thirty seconds, before the test gives up on it: a slow machine is not a fault in the game.
async function drawFrames(page, frameCount) {
  for (let frameIndex = 0; frameIndex < (frameCount || 2); frameIndex++) {
    await page.screenshot({ type: 'jpeg', quality: 5, timeout: 120000 });
  }
}

// Does with a fuel can what a player does: stands by the can that a quest put out (known by the number the
// quest gave it), takes it into the beam, goes and stands at the generator facing it, and holds the can against
// it until the tank is full, or `mostSeconds` have gone by (twelve, if left out). `machineObjectId` is the
// generator's own object number; 0, or left out, is Generator 2. Returns what happened, for the test to look at.
// (The doing of it is one of the game's own test hooks, so that a test can also call it from inside the page.)
async function carryFuelToTank(page, canQuestObjectId, machineObjectId, mostSeconds) {
  return page.evaluate((given) => window.lastReturnDebug.carryFuelToTank(given[0], given[1], given[2]), [canQuestObjectId, machineObjectId || 0, mostSeconds || 12]);
}

module.exports = { launchBrowser, openGame, startGame, drawFrames, countMouseMoves, carryFuelToTank };
