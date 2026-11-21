// Checks your pockets (src/js/08-pockets.js): which kinds of thing go into one, the keys that put a thing in
// and take it out, that a pocket takes a thing out of the station for as long as it is in there, that what
// is in your pockets weighs on you, that a thing is used by taking it out, that all of it lies where you fell
// when you die, and what the screen shows of it, on a keyboard and on a phone.
//
// (That what is in whose pockets is the same in every game down there with others: together-test.js.)
const { openGame, startGame, drawFrames } = require('./browser-harness.js');

const failures = [];
function check(description, condition, detail) {
  const line = (condition ? 'ok    ' : 'FAIL  ') + description + (detail !== undefined ? '  ' + JSON.stringify(detail) : '');
  console.log(line);
  if (!condition) failures.push(description);
}

(async () => {
  const { browser, page, problems } = await openGame({ dev: true });
  const inGame = (callback, argument) => page.evaluate(callback, argument);
  await startGame(page, false);

  // Helpers kept in the page.
  await inGame(() => {
    const d = window.lastReturnDebug, lab = {};
    lab.messages = function () { return Array.from(document.querySelectorAll('#hud-messages .hud-message')).map((element) => element.textContent).join(' | '); };
    // A new descent into Kessel-9, out of the lift, with nothing about.
    lab.fresh = function () {
      d.loadStation('classic', 0);
      d.game.flags.hasLeftLift = true;
      d.hollow.isActive = false;
      d.setDebugOption('freezeCreatures', true);
      d.clearMessages();
      d.teleport(d.playerStart.x, d.playerStart.z, 0);
      d.simulate(0.1);
    };
    // A thing of this kind, straight into your beam.
    lab.give = function (kindKey) {
      const object = d.createLooseObject(kindKey, d.player.x, d.getPlayerEyeY() - 0.3, d.player.z, 0);
      d.pickUpLooseObject(object, false);
      d.simulate(0.1);
      return object;
    };
    lab.press = function (key) {
      if (key === 'R') d.input.wantsStow = true; else d.input.wantsPocket = Number(key) - 4;
      d.simulate(0.1);
    };
    lab.pockets = function () { return d.getOwnPockets().map((object) => object ? object.kindKey : null); };
    lab.isInTheStation = function (object) { return d.looseObjects.indexOf(object) >= 0; };
    window.lab = lab;
  });

  // --- which kinds go into a pocket ---
  const kinds = await inGame(() => {
    const d = window.lastReturnDebug;
    return { pocketed: Object.keys(d.looseObjectKinds).filter((key) => d.looseObjectKinds[key].pocket === true).sort(), count: d.tuning.pocketCount, all: Object.keys(d.looseObjectKinds).length };
  });
  check('two kinds of thing go into a pocket, the scan grenade and the first aid kit, and you have four pockets',
    kinds.pocketed.join() === 'firstAidKit,scanGrenade' && kinds.count === 4 && kinds.all > 10, kinds);

  // --- in and out ---
  const inAndOut = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, result = {};
    lab.fresh();
    result.atFirst = { pockets: lab.pockets(), mass: d.getPocketMass() };
    // R: out of the beam, into the first free pocket.
    const grenade = lab.give('scanGrenade');
    result.inTheBeam = { held: d.getHeldLooseObject() === grenade, fits: d.canLooseObjectBePocketed(grenade) };
    lab.press('R');
    result.stowed = { pockets: lab.pockets(), held: d.getHeldLooseObject() === null, inTheStation: lab.isInTheStation(grenade), found: d.findPocketedObject(grenade.id) !== null,
      inFocus: d.findLooseObjectInFocus(d.player.x, d.getPlayerEyeY(), d.player.z, 0) === grenade };
    // R with nothing in the beam does nothing.
    lab.press('R');
    result.nothingToStow = lab.pockets();
    // Its key, with the beam empty: out into the beam.
    lab.press('4');
    result.takenOut = { pockets: lab.pockets(), held: d.getHeldLooseObject() === grenade, inTheStation: lab.isInTheStation(grenade), heldFlag: grenade.isHeld,
      metresFromYou: Math.hypot(grenade.x - d.player.x, grenade.z - d.player.z) };
    // Put away, walked off and turned round with the beam empty, and taken out again: it comes out in front of you there.
    lab.press('4');
    const off = d.findWalkableSpotNear(d.player.x + 5, d.player.z + 2);
    d.teleport(off.x, off.z, d.player.yaw + 2.5); d.simulate(0.3);
    lab.press('4');
    const ahead = { x: Math.sin(d.player.yaw), z: -Math.cos(d.player.yaw) }, toIt = { x: grenade.x - d.player.x, z: grenade.z - d.player.z };
    result.takenOutElsewhere = { held: d.getHeldLooseObject() === grenade, metresFromYou: Math.hypot(toIt.x, toIt.z), aheadOfYou: (toIt.x * ahead.x + toIt.z * ahead.z) / (Math.hypot(toIt.x, toIt.z) || 1) };
    // A pocket's own key with something in the beam: into that pocket.
    lab.press('6');
    result.intoTheThird = lab.pockets();
    // A second thing, and the two change places.
    const kit = lab.give('firstAidKit');
    lab.press('6');
    result.swapped = { pockets: lab.pockets(), held: d.getHeldLooseObject() === grenade, kitInTheStation: lab.isInTheStation(kit) };
    lab.press('R');
    result.both = lab.pockets();
    // What does not fit stays in the beam, and the screen says so.
    d.clearMessages();
    const jar = lab.give('jar');
    lab.press('R');
    result.jar = { held: d.getHeldLooseObject() === jar, pockets: lab.pockets(), said: /sample jar does not fit in a pocket/.test(lab.messages()), fits: d.canLooseObjectBePocketed(jar) };
    lab.press('5');
    result.jar.byItsKey = d.getHeldLooseObject() === jar && lab.pockets().join() === result.both.join();
    d.releaseHeldLooseObject(0);
    // Four pockets, and no more.
    lab.give('scanGrenade'); lab.press('R');
    lab.give('firstAidKit'); lab.press('R');
    result.full = lab.pockets();
    d.clearMessages();
    const fifth = lab.give('scanGrenade');
    lab.press('R');
    result.fifth = { held: d.getHeldLooseObject() === fifth, pockets: lab.pockets(), said: /Your pockets are full/.test(lab.messages()) };
    return result;
  });
  check('a descent starts with empty pockets that weigh nothing', inAndOut.atFirst.pockets.every((thing) => thing === null) && inAndOut.atFirst.pockets.length === 4 && inAndOut.atFirst.mass === 0, inAndOut.atFirst);
  check('R puts what the beam holds into the first free pocket: it is out of the beam and out of the station, and cannot be looked at or picked up',
    inAndOut.inTheBeam.held && inAndOut.inTheBeam.fits && inAndOut.stowed.pockets.join() === 'scanGrenade,,,' && inAndOut.stowed.held && !inAndOut.stowed.inTheStation && inAndOut.stowed.found &&
    !inAndOut.stowed.inFocus && inAndOut.nothingToStow.join() === 'scanGrenade,,,', inAndOut.stowed);
  check('a pocket\'s key with the beam empty takes the thing out into the beam, in front of you, back in the station',
    inAndOut.takenOut.pockets.every((thing) => thing === null) && inAndOut.takenOut.held && inAndOut.takenOut.heldFlag && inAndOut.takenOut.inTheStation && inAndOut.takenOut.metresFromYou > 0.3 && inAndOut.takenOut.metresFromYou < 2, inAndOut.takenOut);
  check('wherever you have gone meanwhile, it comes out in front of you, within reach',
    inAndOut.takenOutElsewhere.held && inAndOut.takenOutElsewhere.metresFromYou < 2 && inAndOut.takenOutElsewhere.aheadOfYou > 0.7, inAndOut.takenOutElsewhere);
  check('a pocket\'s key with something in the beam puts it into that pocket; into a pocket that is taken, and the two change places',
    inAndOut.intoTheThird.join() === ',,scanGrenade,' && inAndOut.swapped.pockets.join() === ',,firstAidKit,' && inAndOut.swapped.held && !inAndOut.swapped.kitInTheStation &&
    inAndOut.both.join() === 'scanGrenade,,firstAidKit,', [inAndOut.intoTheThird, inAndOut.swapped, inAndOut.both]);
  check('a thing that does not go into a pocket stays in the beam, by R and by a pocket\'s key, and the screen says it does not fit',
    inAndOut.jar.held && !inAndOut.jar.fits && inAndOut.jar.said && inAndOut.jar.byItsKey && inAndOut.jar.pockets.join() === inAndOut.both.join(), inAndOut.jar);
  check('four pockets hold four things; a fifth stays in the beam, and the screen says the pockets are full',
    inAndOut.full.every((thing) => thing !== null) && inAndOut.fifth.held && inAndOut.fifth.said && inAndOut.fifth.pockets.join() === inAndOut.full.join(), [inAndOut.full, inAndOut.fifth]);

  // --- what a pocket does and does not do ---
  const rules = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, result = {};
    lab.fresh();
    // Weight: what is in your pockets slows you as what is in the beam does.
    result.unladen = d.getCarrySpeedFactor();
    lab.give('firstAidKit'); lab.press('R');
    lab.give('firstAidKit'); lab.press('R');
    const kitMass = d.looseObjectKinds.firstAidKit.mass;
    result.twoKits = { mass: d.getPocketMass(), wanted: kitMass * 2, factor: d.getCarrySpeedFactor(), wantedFactor: 1 / (1 + kitMass * 2 * d.tuning.carrySlowdownPerKilogram), canRun: d.canSprintWhileCarrying() };
    // A grenade that has been armed does not go into a pocket.
    const grenade = lab.give('scanGrenade');
    d.input.wantsUseCarried = true; d.simulate(0.05);
    d.clearMessages();
    lab.press('R');
    result.armed = { isArmed: grenade.armedTime >= 0, held: d.getHeldLooseObject() === grenade, fits: d.canLooseObjectBePocketed(grenade), said: /Not while it is armed/.test(lab.messages()) };
    d.removeLooseObject(grenade);
    // A thing is used by taking it out: hurt, a kit comes out of its pocket, Q, and it has done its work. Used up, it does not go back in.
    d.player.health = d.tuning.playerMaxHealth - d.tuning.firstAidHeals - 5;
    const before = d.player.health;
    lab.press('4');
    const kit = d.getHeldLooseObject();
    d.input.wantsUseCarried = true; d.simulate(0.1);
    d.clearMessages();
    lab.press('R');
    result.used = { cameOut: kit !== null && kit.kindKey === 'firstAidKit', healed: d.player.health - before, heals: d.tuning.firstAidHeals, isSpent: kit.isSpent, staysInTheBeam: d.getHeldLooseObject() === kit,
      said: /used up/.test(lab.messages()), pockets: lab.pockets() };
    return result;
  });
  check('what is in your pockets weighs on you: two first aid kits slow you by what they weigh, and you can still run',
    rules.unladen === 1 && Math.abs(rules.twoKits.mass - rules.twoKits.wanted) < 1e-9 && Math.abs(rules.twoKits.factor - rules.twoKits.wantedFactor) < 1e-9 && rules.twoKits.factor < 1 && rules.twoKits.canRun, rules.twoKits);
  check('a grenade that has been armed does not go into a pocket', rules.armed.isArmed && rules.armed.held && !rules.armed.fits && rules.armed.said, rules.armed);
  check('a thing is used by taking it out: a first aid kit out of its pocket, Q, and you have what it gives; used up, it does not go back in',
    rules.used.cameOut && rules.used.healed === rules.used.heals && rules.used.isSpent && rules.used.staysInTheBeam && rules.used.said && rules.used.pockets.join() === ',firstAidKit,,', rules.used);

  // --- dying ---
  const dyingBefore = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, result = {};
    lab.fresh();
    d.setDebugOption('freezeCreatures', false);
    window.dropped = { grenade: lab.give('scanGrenade') }; lab.press('R');
    window.dropped.kit = lab.give('firstAidKit'); lab.press('7');
    d.saveCheckpoint();
    // Somewhere else, and killed there.
    const elsewhere = d.findWalkableSpotNear(d.player.x + 6, d.player.z);
    window.dropped.where = elsewhere;
    d.teleport(elsewhere.x, elsewhere.z, 0); d.simulate(0.1);
    result.pockets = lab.pockets();
    d.spawnHollow(d.player.x + 0.4, d.player.z);
    d.player.hurtGraceSeconds = 0; d.player.health = 1;
    result.hit = d.hitPlayer('hollow', d.hollow.figure);
    return result;
  });
  await page.waitForFunction(() => window.lastReturnDebug.game.mode === 'dead', null, { timeout: 20000 }).catch(() => {});
  const dying = await inGame((before) => {
    const d = window.lastReturnDebug, lab = window.lab, result = { before: before.pockets, hit: before.hit };
    const grenade = window.dropped.grenade, kit = window.dropped.kit, elsewhere = window.dropped.where;
    result.dead = { mode: d.game.mode, pockets: lab.pockets(), grenade: [lab.isInTheStation(grenade), Math.hypot(grenade.x - elsewhere.x, grenade.z - elsewhere.z)],
      kit: [lab.isInTheStation(kit), Math.hypot(kit.x - elsewhere.x, kit.z - elsewhere.z)], apart: Math.hypot(grenade.x - kit.x, grenade.z - kit.z) };
    // Back from the checkpoint: they are still where you fell, not with you.
    d.retryFromCheckpoint();
    d.hollow.isActive = false;
    d.simulate(2.5);
    result.back = { mode: d.game.mode, pockets: lab.pockets(), metresFromWhereYouFell: Math.hypot(d.player.x - elsewhere.x, d.player.z - elsewhere.z),
      grenadeStillThere: lab.isInTheStation(grenade) && Math.hypot(grenade.x - elsewhere.x, grenade.z - elsewhere.z) < 1.5, kitStillThere: lab.isInTheStation(kit) && Math.hypot(kit.x - elsewhere.x, kit.z - elsewhere.z) < 1.5,
      atRest: grenade.isAsleep && kit.isAsleep };
    // A new descent: nothing in anybody's pocket.
    lab.give('scanGrenade'); lab.press('R');
    const hadOne = lab.pockets().some((thing) => thing !== null);
    d.startOver();
    result.newDescent = { hadOne: hadOne, pockets: lab.pockets() };
    return result;
  }, dyingBefore);
  check('when you die, everything in your pockets lies where you fell, a little apart',
    dying.before.join() === 'scanGrenade,,,firstAidKit' && dying.hit === 'dead' && dying.dead.mode === 'dead' && dying.dead.pockets.every((thing) => thing === null) &&
    dying.dead.grenade[0] && dying.dead.grenade[1] < 1 && dying.dead.kit[0] && dying.dead.kit[1] < 1 && dying.dead.apart > 0.05, dying.dead);
  check('back from your checkpoint your pockets are empty, and what was in them is still where you fell, at rest',
    dying.back.mode === 'playing' && dying.back.pockets.every((thing) => thing === null) && dying.back.metresFromWhereYouFell > 3 && dying.back.grenadeStillThere && dying.back.kitStillThere && dying.back.atRest, dying.back);
  check('a new descent starts with empty pockets', dying.newDescent.hadOne && dying.newDescent.pockets.every((thing) => thing === null), dying.newDescent);

  // --- the screen ---
  await inGame(() => { const lab = window.lab; lab.fresh(); });
  await drawFrames(page, 3);
  const screenEmpty = await inGame(() => ({ rowHidden: document.getElementById('hud-pockets').hidden, buttonsHidden: document.getElementById('touch-pockets').hidden }));
  await inGame(() => { window.lab.give('scanGrenade'); });
  await drawFrames(page, 3);
  const screenCarrying = await inGame(() => ({ rowHidden: document.getElementById('hud-pockets').hidden, carrying: document.getElementById('chip-carrying').textContent, prompt: document.getElementById('hud-prompt').textContent,
    chips: [0, 1, 2, 3].map((slot) => document.getElementById('pocket-' + slot).textContent) }));
  await page.keyboard.press('KeyR');
  await drawFrames(page, 3);
  const screenStowed = await inGame(() => ({ rowHidden: document.getElementById('hud-pockets').hidden, carryingHidden: document.getElementById('chip-carrying').hidden,
    chips: [0, 1, 2, 3].map((slot) => document.getElementById('pocket-' + slot).textContent), lit: document.getElementById('pocket-0').classList.contains('is-on'),
    pockets: window.lab.pockets() }));
  await page.keyboard.press('Digit4');
  await drawFrames(page, 3);
  const screenOut = await inGame(() => ({ pockets: window.lab.pockets(), held: window.lastReturnDebug.getHeldLooseObject() !== null, rowHidden: document.getElementById('hud-pockets').hidden }));
  check('with empty pockets and nothing in the beam that would go in one, the screen shows no pockets', screenEmpty.rowHidden && screenEmpty.buttonsHidden, screenEmpty);
  check('with a scan grenade in the beam the screen shows the four pockets with their keys, and says how to put it away',
    !screenCarrying.rowHidden && screenCarrying.carrying === 'CARRYING: SCAN GRENADE' && /\[Q\]  Arm the scan grenade.*\[R\]  Pocket it/.test(screenCarrying.prompt) && screenCarrying.chips.join('|') === '[4] EMPTY|[5] EMPTY|[6] EMPTY|[7] EMPTY', screenCarrying);
  check('the R key puts it away, the screen names it in its pocket, and its key takes it out again',
    screenStowed.pockets.join() === 'scanGrenade,,,' && !screenStowed.rowHidden && screenStowed.carryingHidden && screenStowed.chips[0] === '[4] SCAN GRENADE' && screenStowed.lit &&
    screenOut.pockets.every((thing) => thing === null) && screenOut.held && !screenOut.rowHidden, [screenStowed, screenOut]);

  check('no script errors were reported', problems.length === 0, problems);
  await browser.close();

  // --- on a phone: a tap on a pocket is its key ---
  const phone = await openGame({ dev: true, width: 844, height: 390, isPhone: true });
  await startGame(phone.page, true);
  await phone.page.evaluate(() => {
    const d = window.lastReturnDebug;
    d.game.flags.hasLeftLift = true; d.hollow.isActive = false; d.setDebugOption('freezeCreatures', true);
    const object = d.createLooseObject('firstAidKit', d.player.x, d.getPlayerEyeY() - 0.3, d.player.z, 0);
    d.pickUpLooseObject(object, false);
    d.simulate(0.1);
  });
  await drawFrames(phone.page, 3);
  const phoneCarrying = await phone.page.evaluate(() => ({ mode: window.lastReturnDebug.game.mode, buttonsHidden: document.getElementById('touch-pockets').hidden,
    labels: [0, 1, 2, 3].map((slot) => document.getElementById('touch-pocket-' + slot).textContent), held: window.lastReturnDebug.getHeldLooseObject() !== null }));
  await phone.page.tap('#touch-pocket-1');
  await drawFrames(phone.page, 3);
  const phoneStowed = await phone.page.evaluate(() => ({ pockets: window.lastReturnDebug.getOwnPockets().map((object) => object ? object.kindKey : null), held: window.lastReturnDebug.getHeldLooseObject() !== null,
    labels: [0, 1, 2, 3].map((slot) => document.getElementById('touch-pocket-' + slot).textContent), buttonsHidden: document.getElementById('touch-pockets').hidden }));
  await phone.page.tap('#touch-pocket-1');
  await drawFrames(phone.page, 3);
  const phoneOut = await phone.page.evaluate(() => ({ pockets: window.lastReturnDebug.getOwnPockets().map((object) => object ? object.kindKey : null), held: window.lastReturnDebug.getHeldLooseObject() !== null }));
  check('on a phone, with a first aid kit in the beam, four buttons for the pockets appear',
    phoneCarrying.mode === 'playing' && phoneCarrying.held && !phoneCarrying.buttonsHidden && phoneCarrying.labels.join('|') === 'EMPTY|EMPTY|EMPTY|EMPTY', phoneCarrying);
  check('a tap on one puts the kit into that pocket, and a tap on it again takes it out',
    phoneStowed.pockets.join() === ',firstAidKit,,' && !phoneStowed.held && phoneStowed.labels[1] === 'FIRST AID KIT' && !phoneStowed.buttonsHidden &&
    phoneOut.pockets.every((thing) => thing === null) && phoneOut.held, [phoneStowed, phoneOut]);
  check('no script errors were reported on the phone', phone.problems.length === 0, phone.problems);
  await phone.browser.close();

  if (failures.length > 0) {
    console.log('\n' + failures.length + ' pocket check(s) failed:');
    for (const failure of failures) console.log('  - ' + failure);
    process.exit(1);
  }
  console.log('\nAll pocket checks passed.');
})().catch((error) => { console.error('Pockets test crashed:', error); process.exit(1); });
