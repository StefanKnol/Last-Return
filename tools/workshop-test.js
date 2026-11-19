// Checks the workshop (`npm run dev`): the room tool, the creature tool, the object tool, saving into src/ and reloading
// when the source changes. It works on a copy of src/ in a temporary folder, so nothing here touches the project.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { startDevServer, patchObjectNumbers, formatRoomFile } = require('./dev-server.js');

const failures = [];
function check(description, condition, detail) {
  const line = (condition ? 'ok    ' : 'FAIL  ') + description + (detail !== undefined ? '  ' + JSON.stringify(detail) : '');
  console.log(line);
  if (!condition) failures.push(description);
}

// --- writing numbers back into a source file, without a browser ---
function checkSourcePatching() {
  const source = [
    'const FIGURE_A = {',
    '  kind: \'a\',',
    '  thigh: 0.56, shin: 0.6, upperShin: 0.2, // shin: 9 in the old model',
    '  fingerLengths: [0.24, 0.3, 0.26],   // outer, middle, inner finger',
    '  legRadius: 0.052',
    '};',
    '',
    'const FIGURE_B = {',
    '  thigh: 0.45, shin: 0.44',
    '};',
    ''
  ].join('\n');
  const result = patchObjectNumbers(source, 'FIGURE_A', { thigh: 0.61234567, shin: 0.7, fingerLengths: [0.1, 0.25, 0.3], legRadius: 0.052, noSuchKey: 1 });
  check('patching changes the numbers it is given, to four decimals',
    result.source.includes('thigh: 0.6123, shin: 0.7, upperShin: 0.2,') && result.source.includes('fingerLengths: [0.1, 0.25, 0.3],   // outer, middle, inner finger'), result.source);
  check('patching leaves comments and the other block alone',
    result.source.includes('// shin: 9 in the old model') && result.source.includes('  thigh: 0.45, shin: 0.44'));
  check('patching reports what changed and what it could not find',
    result.changedKeys.join() === 'thigh,shin,fingerLengths' && result.missingKeys.join() === 'noSuchKey', result);
  const room = { key: 'x', name: 'X', width: 8, tiers: [0, 1], doors: [{ wall: 'south', at: 4 }], itemSpot: null, items: [{ type: 'table', x: 1 }, { type: 'barrel', x: 2 }] };
  const text = formatRoomFile(room);
  const parsed = JSON.parse(text);
  check('a room file is valid JSON without the key, one item per line',
    parsed.key === undefined && parsed.items.length === 2 && parsed.tiers.length === 2 && text.split('\n').filter((line) => line.includes('"type"')).length === 2, text);
  const objectText = formatRoomFile({ key: 'x', label: 'x', mass: 2, parts: [{ shape: 'box', center: [0, 0, 0], half: [0.1, 0.1, 0.1] }, { shape: 'ball', center: [0, 0.2, 0], radius: 0.05 }] });
  check('an object file is laid out the same way, one part per line',
    JSON.parse(objectText).parts[1].radius === 0.05 && objectText.split('\n').filter((line) => line.includes('"shape"')).length === 2, objectText);
}

(async () => {
  checkSourcePatching();

  const projectRoot = path.join(__dirname, '..');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'last-return-workshop-'));
  fs.cpSync(path.join(projectRoot, 'src'), path.join(root, 'src'), { recursive: true });
  fs.rmSync(path.join(root, 'src', 'rooms'), { recursive: true, force: true }); // start without workshop rooms
  fs.rmSync(path.join(root, 'src', 'objects'), { recursive: true, force: true }); // and without workshop objects
  fs.mkdirSync(path.join(root, 'assets'));
  const figuresPath = path.join(root, 'src', 'js', '04-figures.js');
  const roomPath = path.join(root, 'src', 'rooms', 'testRoom.json');
  const objectPath = path.join(root, 'src', 'objects', 'testThing.json');

  const server = await startDevServer({ root: root, port: 0, quiet: true });
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
  });
  const context = await browser.newContext({ viewport: { width: 1400, height: 820 } });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (message) => { if (message.type() === 'error') problems.push('console error: ' + message.text()); });
  page.on('pageerror', (error) => problems.push('page error: ' + error.message));
  page.on('dialog', (dialog) => dialog.accept());
  const inPage = (callback, argument) => page.evaluate(callback, argument);
  // Headless Chromium only draws (and so only runs the game loop) when asked.
  const frames = async (count) => { for (let index = 0; index < (count || 3); index++) await page.screenshot({ type: 'jpeg', quality: 5, timeout: 120000 }); }; // a slow machine takes a while to draw a frame (as in browser-harness.js)
  // The lights on, if they are not. The creature tool's scanner view turns them off, and with them off its
  // scanner fires every frame and the points stay, close to the camera, more with every frame: without a
  // graphics card that comes to many seconds a frame, and more as it goes on. A check that is not about what a
  // scan shows has no need of that. (Asked for with nothing in the page holding the keyboard: L is a key.)
  const turnLightsOn = async () => {
    if (await inPage(() => window.lastReturnDebug.workshop.isLit)) return;
    await page.keyboard.press('KeyL');
    await frames();
  };
  const workshopIsReady = () => page.waitForFunction(() => Boolean(window.lastReturnDebug && window.lastReturnDebug.roomWorkshop));
  const waitForReload = async (action) => {
    await inPage(() => { window.pageMarker = true; });
    await action();
    await page.waitForFunction(() => !window.pageMarker && Boolean(window.lastReturnDebug && window.lastReturnDebug.roomWorkshop), null, { timeout: 15000 });
  };
  // The workshop writes its unsaved work to the browser's storage from its own frame loop, once every 0.7
  // seconds of game time, and a drawn frame counts for 0.05 seconds at most: so at most fourteen frames after a
  // change. This draws one frame at a time and stops at the first one after which the stored work holds what
  // was just changed, which is often none at all.
  const STORED_WORK_FRAME_LIMIT = 40;
  const readStoredWork = () => inPage(() => {
    try { return JSON.parse(window.localStorage.getItem('last-return-workshop') || 'null'); } catch (error) { return null; }
  });
  const waitForStoredWork = async (description, holdsTheChange) => {
    let storedWork = await readStoredWork();
    let framesDrawn = 0;
    while (!(storedWork && holdsTheChange(storedWork)) && framesDrawn < STORED_WORK_FRAME_LIMIT) {
      await frames(1);
      framesDrawn++;
      storedWork = await readStoredWork();
    }
    const isStored = Boolean(storedWork && holdsTheChange(storedWork));
    check(description, isStored, isStored ? { framesDrawn: framesDrawn } : { framesDrawn: framesDrawn, storedWork: storedWork });
  };
  const setNumber = async (fieldId, value) => {
    await page.fill('#' + fieldId + ' input[type="number"]', String(value));
    await frames(2);
  };

  try {
    await page.goto(server.address);
    await workshopIsReady();
    const plainPage = fs.readFileSync(path.join(root, 'index.html'), 'utf8'), devPage = fs.readFileSync(path.join(root, 'build', 'workshop.html'), 'utf8');
    check('the plain game page has no workshop in it', !plainPage.includes('initializeWorkshop') && devPage.includes('initializeWorkshop'));
    check('the plain game page has no debug mode in it', !plainPage.includes('initializeDebugMode') && devPage.includes('initializeDebugMode'));

    // --- the room tool, on a room written as code ---
    await page.click('#button-workshop');
    await frames();
    const opened = await inPage(() => {
      const debug = window.lastReturnDebug;
      return { mode: debug.game.mode, key: debug.roomWorkshop.key, doors: debug.doors.length, hasRoom: debug.roomWorkshop.room !== null, canvasWidth: debug.renderer.canvas.clientWidth };
    });
    check('the workshop opens on a room written as code, with its doors, beside the panel',
      opened.mode === 'workshop' && opened.key === 'boilerRoom' && opened.doors === 2 && !opened.hasRoom && opened.canvasWidth === 1400 - 380, opened);

    // --- a new room: add, select by clicking, drag, turn, undo ---
    await page.click('#workshop-new-room');
    await page.click('.workshop-list-entry >> nth=0'); // the ceiling lamp, which hangs right where the test will click
    await page.keyboard.press('Delete');
    await page.keyboard.press('KeyT');
    await frames();
    await page.selectOption('#workshop-add-type', 'table');
    await page.click('#workshop-add-item');
    await frames();
    const tableIndex = await inPage(() => window.lastReturnDebug.roomWorkshop.room.items.findIndex((item) => item.type === 'table'));
    const added = await inPage(() => {
      const state = window.lastReturnDebug.roomWorkshop;
      return { count: state.room.items.length, selected: state.selectedIndex, table: state.room.items[state.selectedIndex], isDirty: state.isDirty };
    });
    check('a table is added in the middle of the view and selected',
      added.count === 2 && added.selected === tableIndex && Math.abs(added.table.x - 4) < 0.3 && Math.abs(added.table.z - 3) < 0.3 && added.isDirty, added);

    const canvasBox = await page.locator('#view-canvas').boundingBox();
    const middleX = canvasBox.x + canvasBox.width / 2, middleY = canvasBox.y + canvasBox.height / 2;
    await page.keyboard.press('Escape');
    await page.mouse.click(middleX + 300, middleY + 250); // bare floor
    check('clicking bare floor selects nothing', (await inPage(() => window.lastReturnDebug.roomWorkshop.selectedIndex)) === -1);
    await page.mouse.click(middleX, middleY);
    check('clicking the table selects it', (await inPage(() => window.lastReturnDebug.roomWorkshop.selectedIndex)) === tableIndex);

    await page.mouse.move(middleX, middleY);
    await page.mouse.down();
    await page.mouse.move(middleX + 60, middleY + 10, { steps: 4 });
    await page.mouse.move(middleX + 150, middleY + 40, { steps: 6 });
    await page.mouse.up();
    await frames();
    const dragged = await inPage((index) => window.lastReturnDebug.roomWorkshop.room.items[index], tableIndex);
    check('dragging moves it across the floor (east and south here)', dragged.x > added.table.x + 0.5 && dragged.z > added.table.z + 0.1 && dragged.x < 8, dragged);

    await page.keyboard.press('KeyR');
    check('R turns it', (await inPage((index) => window.lastReturnDebug.roomWorkshop.room.items[index].angle, tableIndex)) === 15);
    await page.keyboard.press('Control+z');
    check('Ctrl+Z takes the turn back', (await inPage((index) => window.lastReturnDebug.roomWorkshop.room.items[index].angle, tableIndex)) === 0);

    // --- the checks: a table in the doorway is reported, and no longer once it is moved away ---
    await setNumber('workshop-item-x', 4.5);
    await setNumber('workshop-item-z', 5.5);
    const blocked = await inPage(() => window.lastReturnDebug.roomWorkshop.problems.slice());
    check('a table just inside the door is reported', blocked.some((problem) => problem.includes('south wall')), blocked);
    await setNumber('workshop-item-z', 1.5);
    check('and not once it is moved away', (await inPage(() => window.lastReturnDebug.roomWorkshop.problems.length)) === 0, await inPage(() => window.lastReturnDebug.roomWorkshop.problems));

    // --- a pump unit's pipe stops at the ceiling of a low room, and is not reported as too tall ---
    await page.selectOption('#workshop-add-type', 'pumpUnit');
    await page.click('#workshop-add-item');
    await frames();
    const pumpUnit = await inPage(() => {
      const state = window.lastReturnDebug.roomWorkshop;
      const shapes = state.itemShapes[state.selectedIndex] || [];
      return { type: state.room.items[state.selectedIndex].type, ceiling: state.room.ceiling, shapeCount: shapes.length,
        highestPoint: Math.max.apply(null, shapes.map((shape) => shape.maximumY)), problems: state.problems.slice() };
    });
    check('a pump unit in a low room has its pipe end at the ceiling',
      pumpUnit.type === 'pumpUnit' && pumpUnit.shapeCount > 0 && Math.abs(pumpUnit.highestPoint - pumpUnit.ceiling) < 0.001 &&
      !pumpUnit.problems.some((problem) => problem.includes('ceiling')), pumpUnit);
    await page.keyboard.press('Delete');
    await frames();
    check('and the room is as it was once the pump unit is removed', (await inPage(() => window.lastReturnDebug.roomWorkshop.room.items.length)) === 2);

    // --- saving: a file appears, the page reloads into the saved room ---
    await page.fill('#workshop-room-key', 'testRoom');
    await page.locator('#workshop-room-key').blur();
    await page.fill('#workshop-room-name', 'test room');
    await page.locator('label.debug-option:has-text("Use this room in generated stations") input').check();
    await frames();
    await waitForReload(() => page.click('#workshop-save-room'));
    await frames();
    const savedFile = fs.existsSync(roomPath) ? JSON.parse(fs.readFileSync(roomPath, 'utf8')) : null;
    check('saving writes src/rooms/testRoom.json with the table in it',
      savedFile !== null && savedFile.name === 'TEST ROOM' && savedFile.useInStations === true && savedFile.items.some((item) => item.type === 'table' && item.z === 1.5), savedFile);
    const afterSave = await inPage(() => {
      const debug = window.lastReturnDebug, state = debug.roomWorkshop;
      return { mode: debug.game.mode, key: state.key, savedKey: state.savedKey, isDirty: state.isDirty, items: state.room ? state.room.items.length : -1, props: debug.interactables.length };
    });
    check('after the reload the workshop is open on the saved room, with nothing unsaved',
      afterSave.mode === 'workshop' && afterSave.key === 'testRoom' && afterSave.savedKey === 'testRoom' && !afterSave.isDirty && afterSave.items === 2, afterSave);

    // --- the saved room turns up in generated stations, and those can still be finished ---
    const gamePage = await context.newPage();
    gamePage.on('pageerror', (error) => problems.push('page error (game): ' + error.message));
    await gamePage.goto(server.address + 'game');
    await gamePage.waitForFunction(() => Boolean(window.lastReturnDebug));
    const inStations = await gamePage.evaluate(() => {
      const debug = window.lastReturnDebug;
      const found = [], audits = [];
      for (let seed = 1; seed <= 12; seed++) {
        if (!debug.loadStation('generated', seed, 'large', 'mixed', 'two')) continue;
        if (debug.zoneNames.some((name) => name.indexOf('TEST ROOM') === 0)) { found.push(seed); audits.push(debug.auditProgression().length); }
      }
      return { found: found, audits: audits };
    });
    await gamePage.close();
    check('the room is built into generated stations, which can still be finished',
      inStations.found.length > 0 && inStations.audits.every((count) => count === 0), inStations);

    // --- an unsaved change survives a reload caused by a change to the source ---
    if ((await inPage(() => window.lastReturnDebug.roomWorkshop.selectedIndex)) < 0) await page.click('.workshop-list-entry:has-text("Table")');
    await setNumber('workshop-item-x', 2);
    await waitForStoredWork('the moved table is written to the browser\'s storage as unsaved work', (storedWork) => {
      const draft = storedWork.rooms && storedWork.rooms.draft;
      const storedTable = draft && Array.isArray(draft.items) ? draft.items.find((item) => item.type === 'table') : null;
      return Boolean(storedTable) && storedTable.x === 2;
    });
    await waitForReload(() => fs.appendFileSync(path.join(root, 'src', 'js', '01-math.js'), '\n// touched by the workshop test\n'));
    await frames();
    const afterSourceChange = await inPage(() => {
      const state = window.lastReturnDebug.roomWorkshop;
      return { key: state.key, isDirty: state.isDirty, tableX: state.room.items.find((item) => item.type === 'table').x };
    });
    check('a change to the source reloads the page and keeps unsaved work', afterSourceChange.key === 'testRoom' && afterSourceChange.isDirty && afterSourceChange.tableX === 2, afterSourceChange);

    // --- a source file that does not parse: the page stays, with the reason on screen ---
    const mathPath = path.join(root, 'src', 'js', '01-math.js');
    const goodMath = fs.readFileSync(mathPath, 'utf8');
    await inPage(() => { window.pageMarker = true; });
    fs.writeFileSync(mathPath, goodMath + '\nfunction broken( {\n');
    await page.waitForFunction(() => !document.getElementById('workshop-banner').hidden, null, { timeout: 15000 });
    const banner = await inPage(() => ({ text: document.getElementById('workshop-banner').textContent, stillHere: window.pageMarker === true }));
    check('a broken source file is named on screen and the last good build stays', banner.stillHere && banner.text.includes('01-math.js'), banner);
    await waitForReload(() => fs.writeFileSync(mathPath, goodMath));
    check('fixing it reloads', (await inPage(() => document.getElementById('workshop-banner').hidden)) === true);

    // --- the creature tool ---
    await page.click('#workshop-tab-creatures');
    await frames(4);
    // The body walks on the spot, and its height rises and falls some twenty centimetres with every stride.
    // So "how tall" is the tallest it gets at eight places round the stride. The stride is put at each place by
    // hand, one drawn frame each: letting it walk there by itself took ninety frames, which is minutes on a
    // machine that draws slowly.
    const tallestOverAStride = async () => {
      let tallest = 0;
      for (let place = 0; place < 8; place++) {
        await inPage((phase) => { window.lastReturnDebug.creatureWorkshop.standIn.walkPhase = phase; }, place * Math.PI / 4);
        await frames(1);
        tallest = Math.max(tallest, await inPage(() => { const figure = window.lastReturnDebug.creatureWorkshop.figure; return (figure.boundsCenterY - figure.y) * 2; }));
      }
      return Math.round(tallest * 1000) / 1000;
    };
    const before = await inPage(() => {
      const state = window.lastReturnDebug.creatureWorkshop;
      return { thigh: state.figure.proportions.thigh, capsules: state.figure.capsuleCount };
    });
    before.tallest = await tallestOverAStride();
    // Whatever the file holds today, a thigh 30 cm longer makes a taller body.
    const longThigh = Math.round((before.thigh + 0.3) * 1000) / 1000;
    await setNumber('workshop-proportion-thigh', longThigh);
    await frames(1);
    const after = await inPage(() => {
      const debug = window.lastReturnDebug, state = debug.creatureWorkshop;
      return {
        thigh: state.figure.proportions.thigh,
        gameThigh: debug.hollow.figure.proportions.thigh, changes: Object.keys(state.overrides.hollow),
        originalThigh: state.originalFigure.proportions.thigh
      };
    });
    after.tallest = await tallestOverAStride();
    check('a proportion slider changes the body at once, for the whole game, and keeps the file\'s shape to compare',
      after.thigh === longThigh && after.tallest > before.tallest + 0.1 && after.gameThigh === longThigh && after.changes.join() === 'thigh' && after.originalThigh === before.thigh, { before: before, after: after });

    await page.selectOption('#workshop-creature-behaviour', 'hunt');
    await frames(40);
    const hunting = await inPage(() => window.lastReturnDebug.creatureWorkshop.figure.pose.armRaise);
    check('"Hunting" poses it with the game\'s own code: the arms come up', hunting > 0.3, hunting);

    await page.selectOption('#workshop-creature-view', 'scanned');
    await frames(6);
    const scanned = await inPage(() => ({ hits: window.lastReturnDebug.creatureWorkshop.figure.totalHits, isLit: window.lastReturnDebug.workshop.isLit }));
    check('the scanner view turns the lights off and leaves points on the body', scanned.hits > 200 && !scanned.isLit, scanned);

    await waitForStoredWork('the tool, the pose and the changed proportion are written to the browser\'s storage', (storedWork) => {
      const storedCreatures = storedWork.creatures || {};
      const storedThigh = storedCreatures.overrides && storedCreatures.overrides.hollow && storedCreatures.overrides.hollow.thigh;
      return storedWork.tool === 'creatures' && storedCreatures.behaviour === 'hunt' && Boolean(storedThigh) && storedThigh.value === longThigh;
    });
    await waitForReload(() => page.reload());
    await frames(4);
    const reloaded = await inPage(() => {
      const state = window.lastReturnDebug.creatureWorkshop;
      return { tool: window.lastReturnDebug.workshop.tool, thigh: state.figure.proportions.thigh, behaviour: state.behaviour };
    });
    check('a reload keeps the tool, the pose and the changed proportion', reloaded.tool === 'creatures' && reloaded.thigh === longThigh && reloaded.behaviour === 'hunt', reloaded);

    const dummyThigh = /FIGURE_PROPORTIONS_DUMMY = \{[^}]*thigh: ([0-9.]+)/.exec(fs.readFileSync(figuresPath, 'utf8'))[1];
    await waitForReload(() => page.click('#workshop-save-creature'));
    await frames(4);
    const figuresSource = fs.readFileSync(figuresPath, 'utf8');
    const written = await inPage(() => {
      const state = window.lastReturnDebug.creatureWorkshop;
      return { thigh: state.figure.proportions.thigh, fileThigh: state.fileProportions.hollow.thigh, changes: Object.keys(state.overrides.hollow).length };
    });
    const thighIn = (figureName, value) => new RegExp('FIGURE_PROPORTIONS_' + figureName + ' = \\{[^}]*thigh: ' + String(value).replace('.', '\\.') + ',').test(figuresSource);
    check('"Write to file" puts the number into FIGURE_PROPORTIONS_HOLLOW and nowhere else', thighIn('HOLLOW', longThigh) && thighIn('DUMMY', dummyThigh));
    check('after that the body is the same as the file', written.thigh === longThigh && written.fileThigh === longThigh && written.changes === 0, written);

    // --- a player is one of the creatures: the body the others see of you down there ---
    const playerLook = () => inPage(() => {
      const state = window.lastReturnDebug.creatureWorkshop, figure = state.figure, readout = document.getElementById('workshop-creature-readout');
      return { kind: state.kind, isAPlayer: figure.proportions.kind === 'player', thigh: figure.proportions.thigh, height: Math.round((figure.boundsCenterY - figure.y) * 200) / 100,
        armRaise: Math.round(figure.pose.armRaise * 100) / 100, squat: Math.round(figure.pose.squat * 100) / 100, readout: readout ? readout.textContent : '',
        heightStanding: window.lastReturnDebug.tuning.playerHeight, heightCrouching: window.lastReturnDebug.tuning.playerHeightCrouching };
    });
    // (As a solid body with the lights on: these checks are about how the body stands and how tall it is, and
    // there are a hundred frames of them. In the scanner view left on above, the tool fires 2,600 pulses at the
    // body every frame, lights or no lights, and the ones that miss it stay on the walls for good: drawn without
    // a graphics card, that made these the longest silence of the whole run, by many minutes.)
    await turnLightsOn();
    await page.selectOption('#workshop-creature-view', 'solid');
    await frames();
    const viewForBodies = await inPage(() => ({ view: window.lastReturnDebug.creatureWorkshop.view, isLit: window.lastReturnDebug.workshop.isLit, points: window.lastReturnDebug.pointCloud.count }));
    check('back to a solid body with the lights on, no pulses are fired at it', viewForBodies.view === 'solid' && viewForBodies.isLit, viewForBodies);
    await page.selectOption('#workshop-creature', 'player');
    await frames(8);
    const playerStanding = await playerLook();
    await page.selectOption('#workshop-creature-behaviour', 'crouchedScanning');
    await frames(30);
    const playerCrouched = await playerLook();
    check('a player is one of the creatures in the tool: standing with the scanner at its side; crouched and scanning it is down on its haunches, as tall as the game has you be when you crouch, with the scanner held out; and the readout says where the game has you bump your head and see from',
      playerStanding.kind === 'player' && playerStanding.isAPlayer && playerStanding.armRaise < 0.4 && playerStanding.squat === 0 && Math.abs(playerStanding.height - playerStanding.heightStanding) < 0.011 &&
      playerCrouched.squat > 0.2 && Math.abs(playerCrouched.height - playerCrouched.heightCrouching) < 0.015 && playerCrouched.armRaise > 0.9 &&
      /you bump at/.test(playerStanding.readout) && /you see from/.test(playerStanding.readout) && /Crouching/.test(playerCrouched.readout), [playerStanding, playerCrouched]);
    const playerThigh = Math.round((playerStanding.thigh + 0.1) * 1000) / 1000;
    await setNumber('workshop-proportion-thigh', playerThigh);
    await frames(6);
    const playerLongLegged = await playerLook();
    const creaturesListed = await inPage(() => Array.from(document.querySelectorAll('#workshop-creature option')).map((option) => option.value));
    check('a player is as tall as the game says you are, standing and crouched, whatever its proportions: with longer thighs it is another shape and the same height; and the tool lists every kind of creature there is',
      playerLongLegged.thigh === playerThigh && Math.abs(playerLongLegged.height - playerLongLegged.heightCrouching) < 0.015 && Math.abs(playerStanding.height - playerStanding.heightStanding) < 0.011 &&
      creaturesListed.join() === 'hollow,dummy,player', [playerLongLegged, creaturesListed]);
    // How tall a creature is can be set here too. A player's height is a number in 00-config.js, and the slider
    // is on that number; a Still is as tall as its proportions come to, so all of them are changed together.
    const configPath = path.join(root, 'src', 'js', '00-config.js');
    const tallPlayer = Math.round((playerStanding.heightStanding + 0.25) * 100) / 100;
    await page.selectOption('#workshop-creature-behaviour', 'standing');
    await setNumber('workshop-creature-height', tallPlayer);
    await frames(30);
    const playerTaller = await playerLook();
    await page.selectOption('#workshop-creature', 'dummy');
    await frames(6);
    const stillBefore = await inPage(() => { const state = window.lastReturnDebug.creatureWorkshop, figure = state.figure; return { height: (figure.boundsCenterY - figure.y) * 2, thigh: figure.proportions.thigh, shin: figure.proportions.shin }; });
    await setNumber('workshop-creature-height', 1.5);
    await frames(6);
    const stillAfter = await inPage(() => { const state = window.lastReturnDebug.creatureWorkshop, figure = state.figure; return { height: (figure.boundsCenterY - figure.y) * 2, thigh: figure.proportions.thigh, shin: figure.proportions.shin, changes: Object.keys(state.overrides.dummy).length }; });
    await page.click('#workshop-reset-creature');
    await frames(4);
    const stillBack = await inPage(() => { const state = window.lastReturnDebug.creatureWorkshop; return { thigh: state.figure.proportions.thigh, changes: Object.keys(state.overrides.dummy).length }; });
    check('a creature\'s height can be set: a player\'s is the number the game goes by, and the body follows it at once; a Still is made smaller as a whole, the same shape, and "Back to the file" undoes that',
      Math.abs(playerTaller.height - tallPlayer) < 0.011 && playerTaller.heightStanding === tallPlayer &&
      Math.abs(stillAfter.height - 1.5) < 0.02 && stillAfter.thigh < stillBefore.thigh && Math.abs(stillAfter.thigh / stillAfter.shin - stillBefore.thigh / stillBefore.shin) < 0.02 && stillAfter.changes > 10 &&
      stillBack.thigh === stillBefore.thigh && stillBack.changes === 0, [tallPlayer, playerTaller.height, stillBefore, stillAfter, stillBack]);
    await page.selectOption('#workshop-creature', 'player');
    await frames(4);
    await waitForReload(() => page.click('#workshop-save-creature'));
    await frames(4);
    const configWithPlayer = fs.readFileSync(configPath, 'utf8');
    check('"Write to file" puts a player\'s height into TUNING in 00-config.js, beside the comment that was there',
      new RegExp('\\n  playerHeight: ' + String(tallPlayer).replace('.', '\\.') + ',\\s*//').test(configWithPlayer) && await inPage(() => window.lastReturnDebug.tuning.playerHeight) === tallPlayer, tallPlayer);
    const figuresWithPlayer = fs.readFileSync(figuresPath, 'utf8');
    const thighNowIn = (figureName, value) => new RegExp('FIGURE_PROPORTIONS_' + figureName + ' = \\{[^}]*thigh: ' + String(value).replace('.', '\\.') + ',').test(figuresWithPlayer);
    check('"Write to file" puts a player\'s number into FIGURE_PROPORTIONS_PLAYER and nowhere else',
      thighNowIn('PLAYER', playerThigh) && thighNowIn('HOLLOW', longThigh) && thighNowIn('DUMMY', dummyThigh), playerThigh);

    // --- the object tool: a kind written as code to look at, then a new object put together from basic forms ---
    await page.click('#workshop-tab-objects');
    await frames();
    // The page was loaded again when the player was written to its file, and came back in the scanner view with
    // the lights off. The object checks need no scanner, so the lights go back on (see turnLightsOn).
    await turnLightsOn();
    check('L puts the lights back on', await inPage(() => window.lastReturnDebug.workshop.isLit));
    const objectState = () => inPage(() => {
      const state = window.lastReturnDebug.objectWorkshop, body = state.body;
      return {
        key: state.key, savedKey: state.savedKey, isDirty: state.isDirty, selected: state.selectedIndex, isTrying: state.isTrying,
        label: state.object ? state.object.label : null, parts: state.object ? state.object.parts : null,
        // Where the object's own origin hangs: wherever its parts are moved to, that stays over the bench.
        origin: [body.x - body.prepared.centreX, body.y - body.prepared.centreY, body.z - body.prepared.centreZ].map((value) => Math.round(value * 1000) / 1000),
        y: body.y, isAtRest: body.isAsleep
      };
    });
    const objectOpened = await objectState();
    check('the object tool opens on a kind written as code, hanging at rest over the bench',
      objectOpened.key === 'jar' && objectOpened.parts === null && objectOpened.isAtRest && objectOpened.origin.join() === '43.5,1.1,43.5', objectOpened);

    await page.click('#workshop-new-object');
    await page.selectOption('#workshop-add-shape', 'capsule');
    await page.click('#workshop-add-part');
    await frames();
    const withRod = await objectState();
    check('a new object is a box, and a capsule is added on top of it and selected',
      withRod.parts.length === 2 && withRod.parts[0].shape === 'box' && withRod.parts[1].shape === 'capsule' && withRod.selected === 1 &&
      withRod.parts[1].from[1] === withRod.parts[0].half[1] && withRod.isDirty, withRod);

    await page.keyboard.press('Escape');
    await page.mouse.click(middleX, middleY); // the bench is in the middle of the view, and the box is on it
    check('clicking the box selects it', (await objectState()).selected === 0);
    await page.mouse.move(middleX, middleY);
    await page.mouse.down();
    await page.mouse.move(middleX + 40, middleY + 5, { steps: 4 });
    await page.mouse.move(middleX + 110, middleY - 30, { steps: 6 });
    await page.mouse.up();
    await frames();
    const draggedPart = await objectState();
    check('dragging moves the part (to the right and up here), and the object still hangs by its own origin',
      draggedPart.parts[0].center[0] > 0.03 && draggedPart.parts[0].center[1] > 0.01 && draggedPart.parts[1].from.join() === withRod.parts[1].from.join() &&
      draggedPart.origin.join() === '43.5,1.1,43.5', draggedPart);

    await page.keyboard.press('KeyR');
    const turnedPart = (await objectState()).parts[0];
    check('R turns the box a quarter turn: its width and depth change places',
      turnedPart.half[0] === withRod.parts[0].half[2] && turnedPart.half[2] === withRod.parts[0].half[0], turnedPart);
    await page.keyboard.press('Control+z');
    check('Ctrl+Z takes the turn back', (await objectState()).parts[0].half.join() === withRod.parts[0].half.join());
    await setNumber('workshop-part-size1', 0.3);
    check('a size typed in is the size of the box', (await objectState()).parts[0].half[1] === 0.15);

    // --- the other basic forms: a cylinder (a rod with flat ends) and a cone ---
    const shapeChoices = await page.$$eval('#workshop-add-shape option', (options) => options.map((option) => option.value));
    check('a box, a ball, a capsule, a cylinder or a cone can be added', shapeChoices.join() === 'box,ball,capsule,cylinder,cone', shapeChoices);
    await page.selectOption('#workshop-add-shape', 'cylinder');
    await page.click('#workshop-add-part');
    await frames();
    const withCylinder = await objectState();
    await page.selectOption('#workshop-add-shape', 'cone');
    await page.click('#workshop-add-part');
    await frames();
    const withCone = await objectState();
    const cylinderPart = withCylinder.parts[2], conePart = withCone.parts[3];
    check('a cylinder is added standing on top of what is there, and a cone on the flat end of the cylinder: nothing is left for a round end that is not there',
      withCylinder.parts.length === 3 && cylinderPart.shape === 'cylinder' && withCylinder.selected === 2 && Math.abs(cylinderPart.to[1] - cylinderPart.from[1] - 0.2) < 1e-6 &&
      Math.abs(cylinderPart.from[1] - (withRod.parts[1].to[1] + withRod.parts[1].radius)) < 1e-6 &&
      withCone.parts.length === 4 && conePart.shape === 'cone' && withCone.selected === 3 && conePart.from[1] === cylinderPart.to[1] && conePart.to[1] > conePart.from[1] && conePart.radius > 0, withCone.parts);
    const selectedHeading = await page.$eval('#workshop-selected', (heading) => heading.textContent);
    check('the selected cone says which end is flat and which is the point', /Cone/.test(selectedHeading) &&
      (await page.locator('#workshop-part-from1').count()) === 1 && (await page.locator('#workshop-part-to1').count()) === 1 && (await page.locator('#workshop-part-radius').count()) === 1 &&
      /The flat end/.test(await page.locator('#workshop-part-from1').textContent()) && /The point/.test(await page.locator('#workshop-part-to1').textContent()), selectedHeading);
    await setNumber('workshop-part-radius', 0.06);
    await page.locator('#workshop-part-radius input[type="number"]').blur(); // keys typed into a field are the field's
    await page.keyboard.press('Shift+KeyR');
    const tippedCone = (await objectState()).parts[3];
    check('its flat end can be made wider or narrower, and Shift+R tips it over about its middle: it lies along x, as long as it was',
      tippedCone.radius === 0.06 && Math.abs(Math.abs(tippedCone.to[0] - tippedCone.from[0]) - (conePart.to[1] - conePart.from[1])) < 1e-6 && Math.abs(tippedCone.to[1] - tippedCone.from[1]) < 1e-6, tippedCone);
    await page.keyboard.press('Control+z');
    const shell = await inPage(() => {
      const body = window.lastReturnDebug.objectWorkshop.body, prepared = body.prepared, shell = prepared.shell;
      let allFinite = true;
      for (let index = 0; index < prepared.shellCount * 4; index++) if (!Number.isFinite(shell[index])) allFinite = false;
      return { balls: prepared.shellCount, allFinite: allFinite, reach: Math.round(prepared.boundsRadius * 1000) / 1000 };
    });
    check('with a cylinder and a cone on it the object still touches with a modest number of balls', shell.allFinite && shell.balls > 20 && shell.balls < 120 && shell.reach < 1, shell);

    // --- trying it: let go of, it falls by the game's own steps ---
    await page.click('#workshop-drop-object');
    await frames(6);
    const falling = await objectState();
    check('"Drop it" lets go of it, and it falls', falling.isTrying && falling.y < draggedPart.y - 0.1 && falling.y > 0, { before: draggedPart.y, after: falling.y });
    await page.click('#workshop-bench-object');
    await frames(1);
    check('"Back on the bench" hangs it up again', (await objectState()).origin.join() === '43.5,1.1,43.5' && (await objectState()).isAtRest);

    // --- what a knock costs: the readout prices it, and trying the object does it to the thing itself ---
    const knockState = () => inPage(() => {
      const d = window.lastReturnDebug, state = d.objectWorkshop, body = state.body;
      const readout = state.readoutElement ? state.readoutElement.textContent : '';
      const priced = function (title) { const found = new RegExp(title + ' +(shatters|worth (\\d+))').exec(readout); return found ? (found[2] ? Number(found[2]) : 'shatters') : null; };
      return { whole: priced('whole'), intoAWall: priced('into a wall'), letGoOf: priced('let go of'), thrownHard: priced('thrown hard'), saysShattered: /shattered: gone/.test(readout), saysBroken: /broken apart: gone/.test(readout),
        isGone: body.isRemoved === true, worth: body.isRemoved ? 0 : d.getLooseObjectValue(body), y: Math.round(body.y * 100) / 100, isTrying: state.isTrying,
        glass: d.noisyFloorPatches.filter((patch) => patch.isFromPlay).length, problems: state.problems.filter((problem) => /shatter/.test(problem)), kindShattersAt: body.kind.shattersAt === undefined ? null : body.kind.shattersAt };
    });
    // Lets go of it and draws frames until `isDone` says so (or for long enough that it should have), and a few
    // more for whatever follows the landing. It hangs 1.1 m up and lies at about 0.2: under 0.45 it has landed.
    const hasLanded = (state) => state.y < 0.45 || state.isGone;
    const dropUntil = async (isDone) => {
      await page.click('#workshop-drop-object');
      let state = await knockState();
      for (let round = 0; round < 40 && !isDone(state); round++) { await frames(3); state = await knockState(); }
      await frames(4);
      return knockState();
    };
    await setNumber('workshop-object-value', 100);
    await setNumber('workshop-object-fragile', 1);
    await frames(8);
    const pricedWhole = await knockState();
    check('the readout says what a knock would cost it: nothing whole, more let go of than walked into a wall, most thrown hard',
      pricedWhole.whole === 100 && pricedWhole.intoAWall <= 100 && pricedWhole.letGoOf < pricedWhole.intoAWall && pricedWhole.thrownHard < pricedWhole.letGoOf && pricedWhole.thrownHard >= 5, pricedWhole);
    const dropped = await dropUntil((state) => state.worth < 100 || state.isGone);
    check('dropped from the bench it lands worth less than it was, and not gone', hasLanded(dropped) && !dropped.isGone && dropped.worth < 100 && dropped.worth >= 10 && dropped.glass === 0, dropped);
    await setNumber('workshop-object-fragile', 0);
    const droppedTough = await dropUntil(hasLanded);
    check('with "fragile" at 0 the same drop costs it nothing', hasLanded(droppedTough) && !droppedTough.isGone && droppedTough.worth === 100, droppedTough);
    await setNumber('workshop-object-shattersAt', 3);
    await frames(8);
    const notGlass = await knockState();
    const droppedNotGlass = await dropUntil((state) => state.isGone);
    check('set to shatter, anything does, not only glass: of metal it breaks apart when dropped, is gone, and leaves no glass',
      notGlass.problems.length === 0 && notGlass.kindShattersAt === 3 && notGlass.letGoOf === 'shatters' && droppedNotGlass.isGone && droppedNotGlass.glass === 0, [notGlass, droppedNotGlass]);
    await page.click('#workshop-bench-object');
    await frames(2);
    await page.selectOption('#workshop-object-material', 'glass');
    await frames(8);
    const glass = await knockState();
    const droppedGlass = await dropUntil((state) => state.isGone);
    await frames(4); // the readout is brought up to date five times a second
    const afterShatter = await knockState();
    check('made of glass it shatters when dropped: it is gone, broken glass lies where it hit',
      glass.problems.length === 0 && glass.kindShattersAt === 3 && glass.letGoOf === 'shatters' && glass.thrownHard === 'shatters' && glass.intoAWall === 100 &&
      droppedGlass.isGone && afterShatter.glass === 1, [glass, droppedGlass, afterShatter]);
    await page.click('#workshop-bench-object');
    await frames(2);
    const wholeAgain = await knockState();
    check('"Back on the bench" has it whole again and the glass swept up', !wholeAgain.isGone && wholeAgain.worth === 100 && wholeAgain.glass === 0 && !wholeAgain.isTrying, wholeAgain);
    // As it is saved below: a dull thing again, that a knock costs something.
    await page.selectOption('#workshop-object-material', 'case');
    await setNumber('workshop-object-shattersAt', 0);
    await setNumber('workshop-object-fragile', 0.6);

    // --- saving: a file appears, the page reloads into the saved object, and it is a kind like any other ---
    await page.fill('#workshop-object-key', 'testThing');
    await page.locator('#workshop-object-key').blur();
    await page.fill('#workshop-object-label', 'test thing');
    await setNumber('workshop-object-mass', 3);
    await setNumber('workshop-object-onTheFloor', 10);
    await waitForReload(() => page.click('#workshop-save-object'));
    await frames();
    const savedObject = fs.existsSync(objectPath) ? JSON.parse(fs.readFileSync(objectPath, 'utf8')) : null;
    check('saving writes src/objects/testThing.json with all four parts in it, the cylinder and the cone among them',
      savedObject !== null && savedObject.label === 'test thing' && savedObject.mass === 3 && savedObject.onTheFloor === 10 &&
      savedObject.value === 100 && savedObject.fragile === 0.6 && savedObject.shattersAt === 0 && savedObject.material === 'case' &&
      savedObject.parts.length === 4 && savedObject.parts[0].half[1] === 0.15 && savedObject.parts[2].shape === 'cylinder' && savedObject.parts[3].shape === 'cone' &&
      savedObject.parts[3].radius === 0.06 && savedObject.key === undefined, savedObject);
    const afterObjectSave = await objectState();
    afterObjectSave.kind = await inPage(() => { const kind = window.lastReturnDebug.looseObjectKinds.testThing; return kind ? { label: kind.label, mass: kind.mass, parts: kind.parts.length, fragile: kind.fragile, shatters: kind.shattersAt !== undefined } : null; });
    check('after the reload the workshop is open on the saved object, with nothing unsaved, and the game knows the kind',
      afterObjectSave.key === 'testThing' && afterObjectSave.savedKey === 'testThing' && !afterObjectSave.isDirty &&
      afterObjectSave.kind !== null && afterObjectSave.kind.label === 'test thing' && afterObjectSave.kind.mass === 3 && afterObjectSave.kind.parts === 4 &&
      afterObjectSave.kind.fragile === 0.6 && afterObjectSave.kind.shatters === false, afterObjectSave);

    // --- the saved object lies about in generated stations, where it should, and those can still be finished ---
    const objectGamePage = await context.newPage();
    objectGamePage.on('pageerror', (error) => problems.push('page error (game): ' + error.message));
    await objectGamePage.goto(server.address + 'game');
    await objectGamePage.waitForFunction(() => Boolean(window.lastReturnDebug));
    const objectInStations = await objectGamePage.evaluate(() => {
      const debug = window.lastReturnDebug;
      const result = { lying: 0, badPlaces: [], audits: 0 };
      for (let seed = 1; seed <= 4; seed++) {
        if (!debug.loadStation('generated', seed, 'large', 'mixed', 'two')) continue;
        result.lying += debug.stationLooseObjects.filter((entry) => entry.kindKey === 'testThing').length;
        result.badPlaces = result.badPlaces.concat(debug.auditStationLooseObjects());
        result.audits += debug.auditProgression().length;
      }
      return result;
    });
    await objectGamePage.close();
    check('generated stations have the object lying about, in good places, and can still be finished',
      objectInStations.lying > 0 && objectInStations.badPlaces.length === 0 && objectInStations.audits === 0, objectInStations);

    // --- an unsaved change to an object survives a reload ---
    await page.fill('#workshop-object-label', 'changed thing');
    await waitForStoredWork('the renamed object is written to the browser\'s storage as unsaved work',
      (storedWork) => Boolean(storedWork.objects && storedWork.objects.draft) && storedWork.objects.draft.label === 'changed thing');
    await waitForReload(() => page.reload());
    await frames();
    const objectAfterReload = await objectState();
    check('a reload keeps the tool and the unsaved object', objectAfterReload.key === 'testThing' && objectAfterReload.isDirty && objectAfterReload.label === 'changed thing', objectAfterReload);

    // --- leaving ---
    await waitForReload(() => page.click('#workshop-leave'));
    await frames();
    const left = await inPage(() => ({ mode: window.lastReturnDebug.game.mode, isOpen: window.lastReturnDebug.workshop.isOpen, titleShown: !document.getElementById('screen-title').hidden }));
    check('"Leave" goes back to the title screen', left.mode === 'title' && !left.isOpen && left.titleShown, left);

    // --- lobbies: the dev server keeps them too, so two windows on this machine can descend together ---
    const secondPage = await context.newPage();
    await secondPage.goto(server.address);
    await secondPage.waitForFunction(() => Boolean(window.lastReturnDebug));
    await page.click('#button-host-lobby');
    await page.waitForFunction(() => window.lastReturnDebug.together.code !== '');
    await secondPage.fill('#together-code', await page.textContent('#together-lobby-code'));
    await secondPage.click('#button-join-lobby');
    const bothIn = await page.waitForFunction(() => window.lastReturnDebug.together.memberIds.length === 2, null, { timeout: 10000 }).then(() => true, () => false);
    check('two windows of the dev page can open a lobby and join it', bothIn, await secondPage.textContent('#together-status'));
    await secondPage.close();

    check('no script errors along the way', problems.length === 0, problems);
  } catch (error) {
    console.log('Test run crashed:', error);
    failures.push('crash');
  }

  await browser.close();
  await server.close();
  fs.rmSync(root, { recursive: true, force: true });
  if (failures.length > 0) {
    console.log('\n' + failures.length + ' check(s) failed.');
    process.exitCode = 1;
  } else {
    console.log('\nAll workshop checks passed.');
  }
})();
