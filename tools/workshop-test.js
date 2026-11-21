// Checks the workshop (`npm run dev`): the room tool, the creature tool (and a creature made in it), the object tool, saving into src/ and reloading
// when the source changes. It works on a copy of src/ in a temporary folder, so nothing here touches the project.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchBrowser } = require('./browser-harness.js');
const { startDevServer, patchObjectNumbers, formatRoomFile } = require('./dev-server.js');

// The pages here are not opened by browser-harness.js, so its "other stations" is done here: the number from
// `--other-stations` of run-tests.js (or TEST_OTHER_STATIONS) is added to every seed a check builds.
const OTHER_STATIONS = Math.max(0, Math.floor(Number(process.env.TEST_OTHER_STATIONS || 0)) || 0);

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
  const shapedText = formatRoomFile({ key: 'x', name: 'X', width: 4, depth: 3, tiers: [0], doors: [{ wall: 'south', at: 1 }], tiles: ['##..', '.a..', '....'], tileKinds: { a: { floor: 0.4 } }, items: [] });
  check('a room\'s tiles are laid out one row per line, so the file shows the room as a map',
    JSON.parse(shapedText).tiles.join() === '##..,.a..,....' && JSON.parse(shapedText).tileKinds.a.floor === 0.4 &&
    shapedText.includes('  "tiles": [\n    "##..",\n    ".a..",\n    "...."\n  ]') && shapedText.split('\n').filter((line) => line.includes('"tiers"')).length === 1, shapedText);
  const objectText = formatRoomFile({ key: 'x', label: 'x', mass: 2, parts: [{ shape: 'box', center: [0, 0, 0], half: [0.1, 0.1, 0.1] }, { shape: 'ball', center: [0, 0.2, 0], radius: 0.05 }] });
  check('an object file is laid out the same way, one part per line',
    JSON.parse(objectText).parts[1].radius === 0.05 && objectText.split('\n').filter((line) => line.includes('"shape"')).length === 2, objectText);
  const creatureText = formatRoomFile({ key: 'x', label: 'x', skeleton: 'person', proportions: { thigh: 0.5, shin: 0.4 }, hides: ['head', 'neck'],
    parts: [{ bone: 'head', mirror: false, shape: 'box', center: [0, 0, 0], half: [0.1, 0.1, 0.1] }, { bone: 'thighLeft', mirror: true, shape: 'cone', from: [0, 0, 0], to: [0, -0.2, 0], radius: 0.05 }] });
  check('a creature file is laid out the same way, one shape on its bones per line, its proportions on one',
    JSON.parse(creatureText).parts[1].bone === 'thighLeft' && JSON.parse(creatureText).hides.length === 2 && creatureText.split('\n').filter((line) => line.includes('"bone"')).length === 2 &&
    creatureText.split('\n').filter((line) => line.includes('"thigh"')).length === 1, creatureText);
}

(async () => {
  checkSourcePatching();

  const projectRoot = path.join(__dirname, '..');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'last-return-workshop-'));
  fs.cpSync(path.join(projectRoot, 'src'), path.join(root, 'src'), { recursive: true });
  fs.rmSync(path.join(root, 'src', 'rooms'), { recursive: true, force: true }); // start without workshop rooms
  fs.rmSync(path.join(root, 'src', 'objects'), { recursive: true, force: true }); // and without workshop objects
  fs.rmSync(path.join(root, 'src', 'creatures'), { recursive: true, force: true }); // and without workshop creatures
  fs.mkdirSync(path.join(root, 'assets'));
  const figuresPath = path.join(root, 'src', 'js', '04-figures.js');
  const roomPath = path.join(root, 'src', 'rooms', 'testRoom.json');
  const objectPath = path.join(root, 'src', 'objects', 'testThing.json');
  const creaturePath = path.join(root, 'src', 'creatures', 'testCreature.json');

  const server = await startDevServer({ root: root, port: 0, quiet: true });
  const browser = await launchBrowser(); // (the same browser as every other suite: browser-harness.js says which, and why)
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
    // With no rooms made in the workshop it opens on the boiler room. How many doors that has is read from where the
    // room is written (its "sockets" in 03-levelgen.js), so that a door added there does not break this check.
    const boilerRoomSockets = /\n  boilerRoom: \{[\s\S]*?sockets: (\[\[[^\n]*?\]\])/.exec(fs.readFileSync(path.join(root, 'src', 'js', '03-levelgen.js'), 'utf8'));
    opened.doorsWritten = boilerRoomSockets ? (boilerRoomSockets[1].match(/WALL_/g) || []).length : -1;
    check('the workshop opens on a room written as code, with its doors, beside the panel',
      opened.mode === 'workshop' && opened.key === 'boilerRoom' && opened.doors === opened.doorsWritten && opened.doors > 0 && !opened.hasRoom && opened.canvasWidth === 1400 - 380, opened);

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

    // --- a thing that is only sometimes there: in one station's room of this kind and not in the next one's ---
    await page.click('.workshop-list-entry:has-text("Table")');
    await setNumber('workshop-item-chance', 50);
    await page.locator('#workshop-as-a-station').check();
    const sometimes = await inPage((index) => {
      const debug = window.lastReturnDebug, state = debug.roomWorkshop;
      const there = [];
      // (Twenty of the workshop's shuffles: each is another station's room.)
      for (let seed = 1; seed <= 20; seed++) {
        state.seed = seed;
        debug.rebuildRoomWorkshop();
        there.push(state.itemRanges[index][1] > state.itemRanges[index][0] ? 1 : 0);
      }
      state.seed = 1;
      return { chance: state.room.items[index].chance, there: there.join(''), problems: state.problems.slice() };
    }, tableIndex);
    await page.locator('#workshop-as-a-station').uncheck();
    await frames();
    const allThere = await inPage((index) => { const state = window.lastReturnDebug.roomWorkshop; return state.itemRanges[index][1] > state.itemRanges[index][0]; }, tableIndex);
    check('a thing set to be there half the time is in some stations\' rooms and not in others, and is always there to be worked on',
      sometimes.chance === 0.5 && sometimes.there.includes('1') && sometimes.there.includes('0') && sometimes.problems.length === 0 && allThere, sometimes);
    await page.keyboard.press('Escape');

    // --- the shape of the room: the mouse as a brush ---
    // Where the workshop puts the room it shows (its north-west corner), read from where that is written.
    const workshopOrigin = /WORKSHOP_ORIGIN_X = (\d+), WORKSHOP_ORIGIN_Z = (\d+)/.exec(fs.readFileSync(path.join(root, 'src', 'dev', '20-workshop.js'), 'utf8')).slice(1).map(Number);
    // What the tool knows of the tile under the mouse, and what the world has there: 99 m of headroom is rock.
    const underTheBrush = () => inPage((origin) => {
      const debug = window.lastReturnDebug, state = debug.roomWorkshop, tile = state.hoverTile;
      return {
        isPainting: state.isPainting, tile: tile, tiles: state.room.tiles, kinds: state.room.tileKinds, problems: state.problems.slice(), undoSteps: state.undoStack.length,
        character: tile && state.room.tiles ? state.room.tiles[tile[1]].charAt(tile[0]) : '.',
        headroom: tile ? debug.getHeadroomAt(origin[0] + tile[0] + 0.5, origin[1] + tile[1] + 0.5) : null,
        floor: tile ? debug.getFloorHeightAt(origin[0] + tile[0] + 0.5, origin[1] + tile[1] + 0.5) : null
      };
    }, workshopOrigin);
    await page.keyboard.press('KeyT');
    await page.keyboard.press('KeyP');
    await frames();
    // (From above, a metre of floor is some ninety pixels: these are places on the floor well apart from one
    // another, from the table and from the door. Which tile each is on is asked, not assumed.)
    await page.mouse.move(middleX + 228, middleY + 137);
    await frames(1);
    const beforeRock = await underTheBrush();
    await page.mouse.down();
    await page.mouse.up();
    await frames();
    const afterRock = await underTheBrush();
    check('P makes the mouse a brush, and a click fills the tile under it with rock, in the file and in the world',
      beforeRock.isPainting && beforeRock.tile !== null && beforeRock.tiles === null && beforeRock.headroom < 90 &&
      afterRock.character === '#' && afterRock.headroom === 99 && afterRock.undoSteps === beforeRock.undoSteps + 1, { before: beforeRock, after: afterRock });

    const doorTile = await inPage(() => { const room = window.lastReturnDebug.roomWorkshop.room; return [room.doors[0].at, room.depth - 1]; });
    await page.mouse.move(middleX + (doorTile[0] + 0.5 - 4) * 91, middleY + (doorTile[1] + 0.5 - 3) * 91);
    await frames(1);
    await page.mouse.down();
    await page.mouse.up();
    await frames();
    const atDoor = await underTheBrush();
    check('the tile just inside the door stays plain floor, whatever the brush',
      atDoor.tile !== null && atDoor.tile.join() === doorTile.join() && atDoor.character === '.' && atDoor.headroom < 90 && atDoor.undoSteps === afterRock.undoSteps, atDoor);

    await page.selectOption('#workshop-brush', 'floor');
    await setNumber('workshop-brush-floor', 0.4);
    await page.mouse.move(middleX - 228, middleY + 46);
    await page.mouse.down();
    await page.mouse.move(middleX - 137, middleY + 46, { steps: 5 });
    await page.mouse.up();
    await frames();
    const raised = await underTheBrush();
    const raisedLetters = Object.keys(raised.kinds).filter((letter) => raised.kinds[letter].floor === 0.4);
    check('a drag with the floor brush raises the tiles it passes, as one step to undo, and they can still be walked',
      raisedLetters.length === 1 && raised.tiles.join('').split(raisedLetters[0]).length - 1 >= 2 && raised.character === raisedLetters[0] && Math.abs(raised.floor - 0.4) < 0.0001 &&
      raised.undoSteps === atDoor.undoSteps + 1 && raised.problems.length === 0, raised);

    await setNumber('workshop-brush-floor', 2);
    await page.mouse.move(middleX - 228, middleY - 137);
    await frames(1);
    await page.mouse.down();
    await page.mouse.up();
    await frames();
    const tooHigh = await underTheBrush();
    check('floor that cannot be walked to is kept in the file, reported, and left as rock in the world',
      tooHigh.tile !== null && tooHigh.kinds[tooHigh.character] && tooHigh.kinds[tooHigh.character].floor === 2 && tooHigh.headroom === 99 &&
      tooHigh.problems.some((problem) => problem.includes('cannot be walked to')), tooHigh);
    await page.keyboard.press('Control+z');
    await frames();
    const takenBack = await underTheBrush();
    check('Ctrl+Z takes that stroke back', takenBack.character === '.' && takenBack.headroom < 90 && takenBack.problems.length === 0 && takenBack.tiles.join() === raised.tiles.join(), takenBack);
    await page.keyboard.press('KeyP');
    await frames();
    check('P again gives the mouse back to the things in the room', (await inPage(() => window.lastReturnDebug.roomWorkshop.isPainting)) === false);

    // --- a cavern, grown: a shape to start from. Whatever grows, it is a room a station could have ---
    const beforeGrowing = await underTheBrush();
    await page.click('#workshop-grow');
    await frames();
    const grownOnce = await inPage(() => { const state = window.lastReturnDebug.roomWorkshop; return { tiles: state.room.tiles, problems: state.problems.slice(), doorways: state.definition.sockets.length, doors: state.room.doors.length, sealed: state.definition.shape ? state.definition.shape.sealedCount : -1 }; });
    await page.click('#workshop-grow');
    await frames();
    const grownTwice = await inPage(() => window.lastReturnDebug.roomWorkshop.room.tiles);
    check('"Grow a cavern" gives the room a floor that is no box, with every door of it still a doorway and all of its floor built; every press grows another',
      grownOnce.tiles !== null && grownOnce.tiles.join('').includes('#') && grownOnce.doorways === grownOnce.doors && grownOnce.sealed === 0 &&
      !grownOnce.problems.some((problem) => problem.includes('cannot be walked to')) && grownTwice !== null && grownTwice.join() !== grownOnce.tiles.join(), { once: grownOnce, twice: grownTwice });
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await frames();
    const ungrown = await inPage(() => window.lastReturnDebug.roomWorkshop.room.tiles);
    check('and Ctrl+Z goes back through them to the shape that was painted', ungrown !== null && ungrown.join() === beforeGrowing.tiles.join(), ungrown);
    const paintedTiles = raised.tiles;

    // --- where the room belongs, and what it is made of ---
    // (The places are the game's own, src/js/03-locations.js: the annex and whichever comes after it in that list.
    // What each makes of a room is read from its entry there.)
    const places = await inPage(() => {
      const locations = window.lastReturnDebug.locations, other = Object.keys(locations).filter((key) => key !== 'annex')[0];
      return { other: other, annex: locations.annex, there: locations[other] };
    });
    const madeOf = () => inPage(([origin, door]) => {
      const debug = window.lastReturnDebug, state = debug.roomWorkshop;
      return { locations: state.room.locations, look: state.room.look, shownIn: debug.level.locationKey, canChoosePlace: document.getElementById('workshop-preview-location') !== null,
        room: debug.getLookAt(origin[0] + 0.5, origin[1] + 0.5), outsideTheDoor: debug.getLookAt(origin[0] + door[0] + 0.5, origin[1] + door[1] + 2.5) };
    }, [workshopOrigin, doorTile]);
    const atFirst = await madeOf();
    check('a new room belongs to the annex and is made of what the annex is made of',
      atFirst.locations.join() === 'annex' && atFirst.look === '' && atFirst.shownIn === 'annex' && !atFirst.canChoosePlace && atFirst.room === places.annex.look && atFirst.outsideTheDoor === places.annex.corridorLook, atFirst);
    await page.locator('#workshop-room-location-' + places.other).check();
    await frames();
    await page.selectOption('#workshop-preview-location', places.other);
    await frames();
    const shownThere = await madeOf();
    check('ticked for another place, it can be shown as it is there: made of what that place is made of, with that place outside its doors',
      shownThere.locations.join() === 'annex,' + places.other && shownThere.shownIn === places.other && shownThere.room === places.there.look && shownThere.outsideTheDoor === places.there.corridorLook, shownThere);
    const ownLook = ['rock', 'masonry', 'panel'].filter((look) => look !== places.there.look)[0];
    await page.selectOption('#workshop-room-look', ownLook);
    await frames();
    const withOwnLook = await madeOf();
    check('a room can say itself what it is made of, wherever it is', withOwnLook.look === ownLook && withOwnLook.room === ownLook && withOwnLook.outsideTheDoor === places.there.corridorLook, withOwnLook);

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
    check('and with how often the table is there, which the lettering says nothing of because it always is',
      savedFile !== null && savedFile.items.find((item) => item.type === 'table').chance === 0.5 && savedFile.items.every((item) => item.type === 'table' || item.chance === undefined), savedFile && savedFile.items);
    check('and with where it belongs and what it is made of', savedFile !== null && Array.isArray(savedFile.locations) && savedFile.locations.join() === 'annex,' + places.other && savedFile.look === ownLook, savedFile && { locations: savedFile.locations, look: savedFile.look });
    check('and with the room\'s shape in it, as it was painted',
      savedFile !== null && Array.isArray(savedFile.tiles) && savedFile.tiles.join() === paintedTiles.join() && Object.keys(savedFile.tileKinds).length === 1, savedFile && { tiles: savedFile.tiles, tileKinds: savedFile.tileKinds });
    const afterSave = await inPage(() => {
      const debug = window.lastReturnDebug, state = debug.roomWorkshop;
      return { mode: debug.game.mode, key: state.key, savedKey: state.savedKey, isDirty: state.isDirty, items: state.room ? state.room.items.length : -1, props: debug.interactables.length,
        tiles: state.room ? state.room.tiles : null };
    });
    check('after the reload the workshop is open on the saved room, with nothing unsaved',
      afterSave.mode === 'workshop' && afterSave.key === 'testRoom' && afterSave.savedKey === 'testRoom' && !afterSave.isDirty && afterSave.items === 2 &&
      afterSave.tiles !== null && afterSave.tiles.join() === paintedTiles.join(), afterSave);

    // --- the saved room turns up in generated stations, and those can still be finished ---
    const gamePage = await context.newPage();
    gamePage.on('pageerror', (error) => problems.push('page error (game): ' + error.message));
    await gamePage.goto(server.address + 'game');
    await gamePage.waitForFunction(() => Boolean(window.lastReturnDebug));
    const inStations = await gamePage.evaluate(([otherStations, otherPlace]) => {
      const debug = window.lastReturnDebug;
      const found = [], audits = [], shapes = [];
      for (let seed = 1 + otherStations; seed <= 12 + otherStations; seed++) {
        if (!debug.loadStation('generated', seed, 'large', 'mixed', 'two')) continue;
        const zone = debug.zoneNames.findIndex((name) => name.indexOf('TEST ROOM') === 0);
        if (zone < 0) continue;
        found.push(seed); audits.push(debug.auditProgression().length);
        // The room's tiles as the station has them (seven numbers a tile: where, open, floor, ceiling, flags, zone):
        // how many there are, and how many at each height above the lowest. (Not the tile a door stands in,
        // flag 16, which may be counted as the room's: that is the doorway, outside the room's own rectangle.)
        const parts = { tiles: [] };
        debug.computeMapFingerprint(parts);
        const floors = [];
        for (let index = 0; index < parts.tiles.length; index += 7) {
          if (parts.tiles[index + 2] === 1 && parts.tiles[index + 6] === zone && (parts.tiles[index + 5] & 16) === 0) floors.push(parts.tiles[index + 3]);
        }
        const lowest = Math.min.apply(null, floors), steps = {};
        for (const floor of floors) { const step = (Math.round((floor - lowest) * 100) / 100).toFixed(2); steps[step] = (steps[step] || 0) + 1; }
        shapes.push(steps);
      }
      // And in the other place it was ticked for: there too, and made of what it says it is made of.
      const elsewhere = [];
      for (let seed = 1 + otherStations; seed <= 12 + otherStations; seed++) {
        if (!debug.loadStation('generated', seed, 'large', 'mixed', 'two', undefined, undefined, otherPlace)) continue;
        const zone = debug.zoneNames.findIndex((name) => name.indexOf('TEST ROOM') === 0);
        if (zone < 0) continue;
        const looks = {};
        for (let z = debug.level.boundsMinimumZ; z < debug.level.boundsMaximumZ; z++) for (let x = debug.level.boundsMinimumX; x < debug.level.boundsMaximumX; x++) {
          if (debug.getZoneAt(x + 0.5, z + 0.5) === zone && debug.getLookAt(x + 0.5, z + 0.5) !== '') looks[debug.getLookAt(x + 0.5, z + 0.5)] = true;
        }
        elsewhere.push({ seed: seed, place: debug.level.locationKey, looks: Object.keys(looks).join(), problems: debug.auditProgression().length });
      }
      return { found: found, audits: audits, shapes: shapes, elsewhere: elsewhere, searched: found.length > 0 ? '' : 'the room is in none of twelve large stations' };
    }, [OTHER_STATIONS, places.other]);
    await gamePage.close();
    check('the room is built into generated stations, which can still be finished',
      inStations.found.length > 0 && inStations.audits.every((count) => count === 0), inStations);
    // Wherever a station puts the room and whichever way it turns it: every tile but the rock, the raised ones raised.
    const paintedText = paintedTiles.join(''), raisedCount = paintedText.split(raisedLetters[0]).length - 1, rockCount = paintedText.split('#').length - 1;
    check('and it has its shape there: rock where rock was painted, the raised floor raised',
      inStations.shapes.length > 0 && rockCount === 1 && inStations.shapes.every((steps) => steps['0.00'] === paintedText.length - rockCount - raisedCount && steps['0.40'] === raisedCount && Object.keys(steps).length === 2),
      { shapes: inStations.shapes, rockCount: rockCount, raisedCount: raisedCount });
    check('and it turns up in the other place it was ticked for, made of what it says it is made of, in stations that can be finished',
      inStations.elsewhere.length > 0 && inStations.elsewhere.every((station) => station.place === places.other && station.looks === ownLook && station.problems === 0), inStations.elsewhere);

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

    // --- a shape written by hand, and not carefully: what is wrong with it is put right, what would break a station is not built ---
    //   row 0: a character that means nothing, and one whose kind is not in the file: both plain floor
    //   row 1: too short: the rest is plain floor. "c" is a ceiling too low to walk under: it is raised to the least there may be
    //   row 2: "b" is floor a metre up with no way up to it: not built
    //   row 3: the tile inside the east door is plain floor, as inside every door, but rock all round: not a doorway
    //   row 4: rock just inside the south door (the first): plain floor all the same
    //   and "z", which no tile has, is dropped
    const handRoom = { name: 'by hand', width: 6, depth: 5, ceiling: 3, tiers: [1], useInStations: false,
      doors: [{ wall: 'south', at: 2 }, { wall: 'east', at: 3 }],
      tiles: ['?q....', '.c', '.b..##', '....##', '######'],
      tileKinds: { b: { floor: 1 }, c: { floor: 0.2, ceiling: 0.5 }, z: { floor: 3 } }, items: [] };
    await waitForReload(() => fs.writeFileSync(path.join(root, 'src', 'rooms', 'handRoom.json'), JSON.stringify(handRoom)));
    await page.selectOption('#workshop-room', 'handRoom');
    await frames();
    const byHand = await inPage((origin) => {
      const debug = window.lastReturnDebug, state = debug.roomWorkshop;
      const headroom = (tileX, tileZ) => debug.getHeadroomAt(origin[0] + tileX + 0.5, origin[1] + tileZ + 0.5);
      return { key: state.key, tiles: state.room.tiles, kinds: state.room.tileKinds, doorways: state.definition.sockets.length, problems: state.problems.slice(),
        ledge: headroom(1, 2), lowCeiling: Math.round(headroom(1, 1) * 100) / 100, insideFirstDoor: headroom(2, 4), insideEastDoor: headroom(5, 3), rock: headroom(4, 3) };
    }, workshopOrigin);
    check('a shape written by hand is cleaned up when it is read',
      byHand.key === 'handRoom' && byHand.tiles !== null && byHand.tiles.join() === '......,.c....,.b..##,....#.,##.###' &&
      JSON.stringify(byHand.kinds) === JSON.stringify({ b: { floor: 1 }, c: { floor: 0.2, ceiling: 1.7 } }), byHand);
    check('and what would break a station is not built: no floor nobody can walk to, no door behind rock, no ceiling too low to walk under',
      byHand.ledge === 99 && byHand.rock === 99 && byHand.insideEastDoor === 99 && byHand.insideFirstDoor === 3 && byHand.lowCeiling === 1.5 && byHand.doorways === 1 &&
      byHand.problems.some((problem) => problem.includes('cannot be walked to from the first door (')) && byHand.problems.some((problem) => problem.includes('east wall')), byHand);

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
    // Every kind of creature there is: the kinds in FIGURE_KINDS (04-figures.js), read from the file, in its order.
    const figureKindsWritten = /const FIGURE_KINDS = \{([\s\S]*?)\n\};/.exec(fs.readFileSync(figuresPath, 'utf8'));
    const creatureKinds = figureKindsWritten ? Array.from(figureKindsWritten[1].matchAll(/^  (\w+): \{/gm)).map((found) => found[1]) : [];
    check('a player is as tall as the game says you are, standing and crouched, whatever its proportions: with longer thighs it is another shape and the same height; and the tool lists every kind of creature there is',
      playerLongLegged.thigh === playerThigh && Math.abs(playerLongLegged.height - playerLongLegged.heightCrouching) < 0.015 && Math.abs(playerStanding.height - playerStanding.heightStanding) < 0.011 &&
      creaturesListed.length > 0 && creaturesListed.join() === creatureKinds.join(), [playerLongLegged, creaturesListed, creatureKinds]);
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

    // --- a creature of your own: a skeleton with shapes fixed to its bones ---
    // (With the lights on and as a solid body, for the same reason as above.)
    await turnLightsOn();
    await page.selectOption('#workshop-creature-view', 'solid');
    await page.selectOption('#workshop-creature', 'dummy');
    await frames(4);
    // What the body on screen is made of, and where its shapes are as the body itself sees them: to its right,
    // up, and to its front, from where it stands. (So that a check does not hang on which way it happens to face.)
    const creatureBody = () => inPage(() => {
      const debug = window.lastReturnDebug, state = debug.creatureWorkshop, figure = state.figure, design = state.design;
      const rightX = Math.cos(figure.yaw), rightZ = Math.sin(figure.yaw), forwardX = Math.sin(figure.yaw), forwardZ = -Math.cos(figure.yaw);
      const seenByItself = (x, y, z) => [(x - figure.x) * rightX + (z - figure.z) * rightZ, y - figure.y, (x - figure.x) * forwardX + (z - figure.z) * forwardZ].map((value) => Math.round(value * 1000) / 1000);
      const rods = [], boxes = [];
      for (let index = 0; index < figure.rodCount; index++) rods.push({ from: seenByItself(figure.rods[index * 8], figure.rods[index * 8 + 1], figure.rods[index * 8 + 2]), to: seenByItself(figure.rods[index * 8 + 3], figure.rods[index * 8 + 4], figure.rods[index * 8 + 5]), farRadius: figure.rods[index * 8 + 7] });
      for (let index = 0; index < figure.boxCount; index++) boxes.push({ center: seenByItself(figure.boxes[index * 15], figure.boxes[index * 15 + 1], figure.boxes[index * 15 + 2]) });
      return {
        kind: state.kind, behaviour: state.behaviour, capsules: figure.capsuleCount, rods: rods, boxes: boxes,
        height: Math.round((figure.boundsCenterY - figure.y) * 200) / 100, holdsScanner: figure.scannerCapsule >= 0, squat: Math.round(figure.pose.squat * 100) / 100,
        key: design ? design.key : null, savedKey: design ? design.savedKey : null, isDirty: design ? design.isDirty : null, selected: design ? design.selectedIndex : null, bone: design ? design.bone : null,
        skeleton: design ? design.creature.skeleton : null, parts: design ? design.creature.parts : null, hides: design ? design.creature.hides : null,
        thigh: figure.proportions.thigh, behaviours: Array.from(document.querySelectorAll('#workshop-creature-behaviour option')).map((option) => option.value)
      };
    });
    const stillBody = await creatureBody();
    await page.click('#workshop-new-creature');
    await frames(4);
    const newCreature = await creatureBody();
    check('"New creature" opens a creature of your own: the skeleton of a person, standing, with every bone of it and nothing fixed to them yet, and no file',
      newCreature.kind === 'workshopDraft' && newCreature.skeleton === 'person' && newCreature.behaviour === 'standing' && newCreature.capsules === stillBody.capsules && stillBody.capsules > 10 &&
      newCreature.parts.length === 0 && newCreature.hides.length === 0 && newCreature.savedKey === null && newCreature.isDirty, [stillBody.capsules, newCreature]);

    // A box for a head: fixed to the head bone, and the skeleton's own head left out.
    await page.selectOption('#workshop-creature-bone', 'head');
    await page.selectOption('#workshop-add-shape', 'box');
    await page.click('#workshop-add-part');
    await frames(2);
    await page.click('#workshop-bone-shown');
    await frames(2);
    const boxHeaded = await creatureBody();
    check('a box is fixed to the head and the skeleton\'s own head is left out: the body has a box where its head was, and one capsule fewer',
      boxHeaded.boxes.length === 1 && boxHeaded.capsules === newCreature.capsules - 1 && boxHeaded.hides.join() === 'head' && boxHeaded.parts[0].bone === 'head' && boxHeaded.selected === 0 &&
      boxHeaded.boxes[0].center[1] > boxHeaded.height * 0.8 && Math.abs(boxHeaded.boxes[0].center[0]) < 0.01, boxHeaded);
    // The scanner lands on it: a pulse from the camera at the middle of the box is stopped by the body, short of that middle.
    const scanOfBox = await inPage(() => {
      const debug = window.lastReturnDebug, figure = debug.creatureWorkshop.figure, player = debug.player;
      const eye = [player.x, player.floorY + player.eyeHeight, player.z], to = [figure.boxes[0], figure.boxes[1], figure.boxes[2]];
      const away = Math.hypot(to[0] - eye[0], to[1] - eye[1], to[2] - eye[2]);
      const wasHit = debug.castScannerRay(eye[0], eye[1], eye[2], (to[0] - eye[0]) / away, (to[1] - eye[1]) / away, (to[2] - eye[2]) / away, 40);
      return { wasHit: wasHit, isTheBody: debug.rayHit.figure === figure, distance: debug.rayHit.distance, away: away, half: figure.boxes[12] };
    });
    check('a scanner pulse at the box lands on it: a box on a bone is as much the body as a capsule is',
      scanOfBox.wasHit && scanOfBox.isTheBody && scanOfBox.distance < scanOfBox.away && scanOfBox.distance > scanOfBox.away - scanOfBox.half * 2, scanOfBox);

    // A cone on the left forearm, with both sides alike: the right forearm gets its mirror image.
    await page.selectOption('#workshop-creature-bone', 'foreArmLeft');
    await page.selectOption('#workshop-add-shape', 'cone');
    await page.click('#workshop-add-part');
    await frames(2);
    const coned = await creatureBody();
    const leftCone = coned.rods.filter((rod) => rod.from[0] < 0)[0], rightCone = coned.rods.filter((rod) => rod.from[0] > 0)[0];
    check('a cone fixed to the left forearm has its mirror image on the right one: the same height, as far to the other side',
      coned.rods.length === 2 && Boolean(leftCone && rightCone) && leftCone.farRadius === 0 && coned.parts[1].mirror === true && coned.parts[1].bone === 'foreArmLeft' &&
      Math.abs(leftCone.from[0] + rightCone.from[0]) < 0.002 && Math.abs(leftCone.from[1] - rightCone.from[1]) < 0.002 && Math.abs(leftCone.to[1] - rightCone.to[1]) < 0.002, coned);
    // A shape turns with its bone: with the arms raised by hand, the cones are where the forearms now are.
    await page.selectOption('#workshop-creature-behaviour', 'manual');
    await frames(2);
    await inPage(() => { window.lastReturnDebug.creatureWorkshop.figure.pose.armRaise = 1.5; });
    await frames(2);
    const armsRaised = await creatureBody();
    const raisedCone = armsRaised.rods.filter((rod) => rod.from[0] < 0)[0];
    check('a shape turns with its bone: with the arms raised forward the cones are higher and out in front, and still as long',
      Boolean(raisedCone) && raisedCone.from[1] > leftCone.from[1] + 0.1 && raisedCone.from[2] > leftCone.from[2] + 0.1 &&
      Math.abs(Math.hypot(raisedCone.to[0] - raisedCone.from[0], raisedCone.to[1] - raisedCone.from[1], raisedCone.to[2] - raisedCone.from[2]) -
        Math.hypot(leftCone.to[0] - leftCone.from[0], leftCone.to[1] - leftCone.from[1], leftCone.to[2] - leftCone.from[2])) < 0.003, [leftCone, raisedCone]);
    await page.selectOption('#workshop-creature-behaviour', 'standing');
    await frames(2);

    // Taking hold of a shape in the view: a click on the box selects it, a drag moves it along its bone's own directions.
    const boxOnScreen = await inPage(() => {
      const debug = window.lastReturnDebug, figure = debug.creatureWorkshop.figure, matrix = debug.renderer.viewProjectionMatrix, bounds = debug.renderer.canvas.getBoundingClientRect();
      const x = figure.boxes[0], y = figure.boxes[1], z = figure.boxes[2];
      const clipX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12], clipY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13], clipW = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
      return [bounds.left + (clipX / clipW * 0.5 + 0.5) * bounds.width, bounds.top + (0.5 - clipY / clipW * 0.5) * bounds.height];
    });
    await page.mouse.click(boxOnScreen[0], boxOnScreen[1]);
    await frames(2);
    const boxClicked = await creatureBody();
    await page.mouse.move(boxOnScreen[0], boxOnScreen[1]);
    await page.mouse.down();
    await page.mouse.move(boxOnScreen[0] + 5, boxOnScreen[1] - 20, { steps: 3 });
    await page.mouse.move(boxOnScreen[0] + 10, boxOnScreen[1] - 70, { steps: 5 });
    await page.mouse.up();
    await frames(2);
    const boxDragged = await creatureBody();
    check('a click on the box in the view selects it, and dragging it upwards moves it up its bone, on whole centimetres',
      boxClicked.selected === 0 && boxClicked.bone === 'head' && boxDragged.selected === 0 && boxDragged.parts[0].center[1] > boxHeaded.parts[0].center[1] + 0.03 &&
      boxDragged.boxes[0].center[1] > boxHeaded.boxes[0].center[1] + 0.03 && Math.abs(boxDragged.parts[0].center[1] * 100 - Math.round(boxDragged.parts[0].center[1] * 100)) < 1e-6,
      [boxHeaded.parts[0], boxDragged.parts[0], boxOnScreen]);
    await page.keyboard.press('Control+z');
    await frames(2);
    const dragUndone = await creatureBody();
    check('Ctrl+Z puts the box back where it was', dragUndone.parts[0].center[1] === boxHeaded.parts[0].center[1] && dragUndone.parts.length === 2, dragUndone.parts[0]);

    // Its proportions are its own: a longer thigh is a taller body, and the game's creatures are not touched.
    const ownThigh = Math.round((dragUndone.thigh + 0.2) * 1000) / 1000;
    await setNumber('workshop-proportion-thigh', ownThigh);
    await frames(2);
    const longLegged = await creatureBody();
    longLegged.stillThigh = await inPage(() => window.lastReturnDebug.figureKinds.dummy.proportions.thigh);
    check('a proportion slider changes the creature\'s own body and nobody else\'s', longLegged.thigh === ownThigh && longLegged.height > dragUndone.height + 0.1 && longLegged.stillThigh === stillBody.thigh,
      [dragUndone.height, longLegged.height, longLegged.stillThigh]);

    // --- saving: a file appears, the page reloads into the saved creature, and it is a kind of figure like any other ---
    await page.fill('#workshop-creature-key', 'testCreature');
    await page.locator('#workshop-creature-key').blur();
    await page.fill('#workshop-creature-label', 'test creature');
    await waitForReload(() => page.click('#workshop-save-creature'));
    await frames(4);
    const savedCreature = fs.existsSync(creaturePath) ? JSON.parse(fs.readFileSync(creaturePath, 'utf8')) : null;
    check('saving writes src/creatures/testCreature.json: its skeleton, its proportions, the bone that is left out and the two shapes with the bones they are on',
      savedCreature !== null && savedCreature.label === 'test creature' && savedCreature.skeleton === 'person' && savedCreature.playerSkin === false && savedCreature.proportions.thigh === ownThigh &&
      savedCreature.hides.join() === 'head' && savedCreature.parts.length === 2 && savedCreature.parts[0].shape === 'box' && savedCreature.parts[0].bone === 'head' &&
      savedCreature.parts[1].shape === 'cone' && savedCreature.parts[1].bone === 'foreArmLeft' && savedCreature.parts[1].mirror === true && savedCreature.key === undefined, savedCreature);
    const afterCreatureSave = await creatureBody();
    afterCreatureSave.made = await inPage(() => {
      // The game's own way of making one: a body of that kind, built where it stands.
      const debug = window.lastReturnDebug, kind = debug.figureKinds.testCreature;
      if (!kind) return null;
      const figure = debug.createFigureOfKind('testCreature');
      figure.x = 46; figure.z = 46;
      debug.updateFigureCapsules(figure);
      return { isDesigned: kind.isDesigned === true, capsules: figure.capsuleCount, rods: figure.rodCount, boxes: figure.boxCount, listed: Array.from(document.querySelectorAll('#workshop-creature option')).map((option) => option.value) };
    });
    check('after the reload the workshop is open on the saved creature, with nothing unsaved, and the game makes one like any other kind: createFigureOfKind gives the same body',
      afterCreatureSave.key === 'testCreature' && afterCreatureSave.savedKey === 'testCreature' && afterCreatureSave.isDirty === false && afterCreatureSave.made !== null && afterCreatureSave.made.isDesigned &&
      afterCreatureSave.made.capsules === afterCreatureSave.capsules && afterCreatureSave.made.rods === 2 && afterCreatureSave.made.boxes === 1 &&
      afterCreatureSave.made.listed.indexOf('testCreature') === 0 && afterCreatureSave.made.listed.indexOf('hollow') > 0, afterCreatureSave);

    // --- a body a player can wear: the same creature, made as tall as a player is, with the scanner in its hand ---
    await page.click('#workshop-creature-playerSkin');
    await frames(8);
    const wornStanding = await creatureBody();
    await page.selectOption('#workshop-creature-behaviour', 'crouchedScanning');
    await frames(30);
    const wornCrouched = await creatureBody();
    const playerHeights = await inPage(() => ({ standing: window.lastReturnDebug.tuning.playerHeight, crouching: window.lastReturnDebug.tuning.playerHeightCrouching }));
    check('made a body a player can wear, it is posed as a player is: as tall as the game has you be standing and crouched, the scanner in its hand, its box and its cones still on it and made smaller with it',
      wornStanding.holdsScanner && wornStanding.behaviours.indexOf('crouchedScanning') >= 0 && Math.abs(wornStanding.height - playerHeights.standing) < 0.011 &&
      wornCrouched.squat > 0.2 && Math.abs(wornCrouched.height - playerHeights.crouching) < 0.015 &&
      wornStanding.boxes.length === 1 && wornStanding.rods.length === 2 && wornStanding.boxes[0].center[1] < afterCreatureSave.boxes[0].center[1] - 0.1 && wornStanding.boxes[0].center[1] > playerHeights.standing * 0.7,
      [playerHeights, wornStanding, wornCrouched, afterCreatureSave.boxes]);
    await page.selectOption('#workshop-creature-behaviour', 'standing');
    await waitForStoredWork('the unsaved change to the creature is written to the browser\'s storage',
      (storedWork) => Boolean(storedWork.creatures && storedWork.creatures.design && storedWork.creatures.design.draft) && storedWork.creatures.design.draft.playerSkin === true && storedWork.creatures.behaviour === 'standing');
    await waitForReload(() => page.reload());
    await frames(4);
    const wornAfterReload = await creatureBody();
    check('a reload keeps the creature and the unsaved change to it', wornAfterReload.key === 'testCreature' && wornAfterReload.isDirty === true && wornAfterReload.holdsScanner, wornAfterReload);
    await waitForReload(() => page.click('#workshop-save-creature'));
    await frames(4);
    const playerBodies = await inPage(() => window.lastReturnDebug.getPlayerBodyKinds());
    check('saved, it is one of the bodies a player can be given, after the one written as code', playerBodies.join() === 'player,testCreature', playerBodies);

    // --- a copy of a kind written as code: the Hollow's skeleton and proportions, to make another creature from ---
    await page.selectOption('#workshop-creature', 'hollow');
    await frames(4);
    const theHollow = await creatureBody();
    await page.click('#workshop-copy-creature');
    await frames(4);
    const hollowCopy = await creatureBody();
    await page.selectOption('#workshop-creature-bone', 'jaw');
    await page.click('#workshop-bone-shown');
    await frames(2);
    await page.click('#workshop-leave-out-all');
    await frames(2);
    const hollowBare = await creatureBody();
    check('"Copy of this" on the Hollow makes a creature with its skeleton and its proportions; it can be given something to do the Hollow does, and all of its skeleton can be left out',
      hollowCopy.kind === 'workshopDraft' && hollowCopy.skeleton === 'hollow' && hollowCopy.capsules === theHollow.capsules && hollowCopy.thigh === theHollow.thigh &&
      hollowCopy.behaviours.indexOf('hunt') >= 0 && hollowCopy.savedKey === null && hollowBare.capsules === 0 && hollowBare.hides.length === theHollow.capsules, [theHollow.capsules, hollowCopy, hollowBare.hides.length]);
    // (Back to a kind written as code, throwing the copy away: the checks below leave the tool as they found it.)
    await page.selectOption('#workshop-creature', 'hollow');
    await frames(4);
    check('the copy is thrown away when another creature is chosen', (await creatureBody()).kind === 'hollow');

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
    // With no objects made in the workshop it opens on the first kind written as code, whichever that is.
    objectOpened.firstKindWrittenAsCode = await inPage(() => Object.keys(window.lastReturnDebug.looseObjectKinds)[0]);
    check('the object tool opens on a kind written as code, hanging at rest over the bench',
      objectOpened.key === objectOpened.firstKindWrittenAsCode && objectOpened.parts === null && objectOpened.isAtRest && objectOpened.origin.join() === '43.5,1.1,43.5', objectOpened);

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
    // Four stations at least, and more until one has it lying about: where it lies is a draw, which seeds win it is not known.
    const objectInStations = await objectGamePage.evaluate((otherStations) => {
      const debug = window.lastReturnDebug;
      const result = { lying: 0, stations: 0, badPlaces: [], audits: 0 };
      for (let seed = 1 + otherStations; seed <= 20 + otherStations && (result.stations < 4 || result.lying === 0); seed++) {
        if (!debug.loadStation('generated', seed, 'large', 'mixed', 'two')) continue;
        result.stations++;
        result.lying += debug.stationLooseObjects.filter((entry) => entry.kindKey === 'testThing').length;
        result.badPlaces = result.badPlaces.concat(debug.auditStationLooseObjects());
        result.audits += debug.auditProgression().length;
      }
      if (result.lying === 0) result.searched = 'the object lies in none of ' + result.stations + ' large stations';
      return result;
    }, OTHER_STATIONS);
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
