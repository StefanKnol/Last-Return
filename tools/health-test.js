// Checks your health (src/js/09-health.js): that being caught is a hit and not the end of you, what a hit takes
// off on each threat level, that what hit you holds off and nothing hits you twice in a moment, that the hit
// which takes the last of it is your death, that a looter's bite never is, what a first aid kit gives back and
// when, what you have when you come back from a checkpoint, and what the HUD shows of it.
//
// (That every station has first aid kits is checked with the other things that lie loose: loose-objects-test.js.
// That a hit on somebody else is worked out in their own game: together-test.js. The looter's bite in its
// vents: looter-test.js.)
const { openGame, startGame } = require('./browser-harness.js');

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

  // A quiet station to stand in: nothing arrives by itself, and you are out of the car.
  const prepare = () => inGame(() => {
    const d = window.lastReturnDebug;
    d.game.difficulty = d.difficultyPresets.standard;
    if (d.game.mode === 'dead') d.retryFromCheckpoint(); // (on your feet again after the last check)
    d.loadStation('classic', 0);
    d.game.flags.hasLeftLift = true;
    d.setDebugOption('holdArrivals', true); d.setDebugOption('invulnerable', false);
    d.game.difficulty = d.difficultyPresets.standard;
    const spot = d.findWalkableSpotNear(d.playerStart.x, d.playerStart.z + 6) || { x: d.playerStart.x, z: d.playerStart.z };
    d.teleport(spot.x, spot.z, 0); d.player.velocityX = 0; d.player.velocityZ = 0;
    d.simulate(0.2);
    return { health: d.player.health, of: d.tuning.playerMaxHealth, mode: d.game.mode };
  });

  // --- what a hit takes, on each threat level ---
  const start = await prepare();
  check('a descent begins with all of your health', start.health === start.of && start.of > 0 && start.mode === 'playing', start);
  const levels = await inGame(() => {
    const d = window.lastReturnDebug, seen = { of: d.tuning.playerMaxHealth, hollow: d.getHitDamage('hollow'), still: d.getHitDamage('still'), looter: d.getHitDamage('looter'), factors: {}, hollowHitsToKill: {} };
    for (const key of ['survey', 'standard', 'nightmare']) {
      seen.factors[key] = d.difficultyPresets[key].damageFactor;
      seen.hollowHitsToKill[key] = Math.ceil((seen.of - 0.5) / (seen.hollow * seen.factors[key]));
    }
    seen.customOption = d.customDifficultyOptions.filter((option) => option.key === 'damageFactor').map((option) => option.choices.map((choice) => choice[0]))[0] || null;
    return seen;
  });
  // (How many hits that comes to is the numbers' to say, hollowHitDamage and each level's damageFactor in
  // src/js/00-config.js, and they are tuned by playing. What has to hold whatever they are: a harder threat level
  // never takes more hits than an easier one, and Nightmare takes fewer than Survey only.)
  check('what a hit takes is its creature\'s number times the threat level\'s: the Hollow needs the most hits on Survey only and the fewest on Nightmare, and never more on a harder level than on an easier one; a Still takes less than the Hollow and a looter\'s bite least of all; a custom level chooses',
    levels.factors.survey < levels.factors.standard && levels.factors.standard === 1 && levels.factors.nightmare > 1 && levels.hollowHitsToKill.nightmare >= 1 &&
    levels.hollowHitsToKill.survey >= levels.hollowHitsToKill.standard && levels.hollowHitsToKill.standard >= levels.hollowHitsToKill.nightmare && levels.hollowHitsToKill.survey > levels.hollowHitsToKill.nightmare &&
    levels.still < levels.hollow && levels.looter < levels.still && levels.customOption !== null && levels.customOption.indexOf(1) >= 0 && levels.customOption.length >= 3, levels);

  // --- the Hollow reaches you: a hit, and a chance ---
  const hit = await inGame(() => {
    const d = window.lastReturnDebug, p = d.player, seen = { of: d.tuning.playerMaxHealth, takes: d.getHitDamage('hollow') * d.game.difficulty.damageFactor,
      grace: d.tuning.playerHurtGraceSeconds, standsFor: d.tuning.hollowAfterHitSeconds };
    d.spawnHollow(p.x + 0.25, p.z);
    d.hollow.graceTimer = 0; d.hollow.state = 2; // hunting
    d.simulate(0.2);
    seen.afterTheHit = { mode: d.game.mode, health: p.health, graceLeft: p.hurtGraceSeconds, hollowStands: d.hollow.recoverSeconds, flash: p.hurtFlash,
      told: document.getElementById('hud-messages').textContent };
    // It stands where it struck: it does not come on, and it strikes nobody.
    const at = [d.hollow.figure.x, d.hollow.figure.z];
    d.simulate(seen.standsFor - 0.6);
    seen.whileItStands = { moved: Math.hypot(d.hollow.figure.x - at[0], d.hollow.figure.z - at[1]), health: p.health, mode: d.game.mode, graceLeft: p.hurtGraceSeconds };
    // The bar on the HUD: as long as what is left, and not red yet.
    d.updateHud(0.016);
    seen.bar = { width: parseFloat(document.getElementById('bar-health').style.width), isRed: document.getElementById('bar-health').classList.contains('is-critical'),
      isShown: !document.getElementById('meter-health').classList.contains('is-faded') };
    // Then it comes on again, and again: each hit takes what a hit takes, and the one that takes the last of it
    // is your death. How many that is, the numbers say (hollowHitDamage and the level's damageFactor).
    seen.hitsItShouldTake = Math.ceil((seen.of - 0.5) / seen.takes);
    let hits = 1, healthWas = p.health;
    for (let time = 0; time < seen.hitsItShouldTake * (seen.standsFor + 2) + 3 && d.game.mode === 'playing'; time += 0.1) {
      d.simulate(0.1);
      if (p.health < healthWas - 0.01) { hits++; healthWas = p.health; }
    }
    seen.atTheEnd = { mode: d.game.mode, health: p.health, hits: hits };
    return seen;
  });
  check('the Hollow reaching you is a hit: it takes what its hit takes, you are still on your feet, and you are told',
    hit.afterTheHit.mode === 'playing' && Math.abs(hit.afterTheHit.health - (hit.of - hit.takes)) < 0.01 && hit.afterTheHit.flash > 0 && /hit you/.test(hit.afterTheHit.told), hit);
  check('and a chance: nothing hits you again for a moment, and the Hollow stands where it struck for longer than that, moving nowhere and striking nobody',
    hit.afterTheHit.graceLeft > 0 && hit.afterTheHit.graceLeft <= hit.grace && hit.afterTheHit.hollowStands > hit.grace && hit.afterTheHit.hollowStands <= hit.standsFor &&
    hit.whileItStands.moved < 0.05 && hit.whileItStands.health === hit.afterTheHit.health && hit.whileItStands.mode === 'playing' && hit.whileItStands.graceLeft === 0, hit);
  check('the bar on the HUD is as long as what is left of you, and stays on the screen while you are hurt',
    Math.abs(hit.bar.width - (hit.of - hit.takes) / hit.of * 100) < 0.2 && hit.bar.isShown, hit.bar);
  check('still within its reach when it comes on again, it hits again, and the hit that takes the last of your health is your death: as many hits as the numbers say, and no fewer',
    hit.atTheEnd.mode === 'dying' && hit.atTheEnd.health === 0 && hit.atTheEnd.hits === hit.hitsItShouldTake && hit.hitsItShouldTake >= 1, [hit.atTheEnd, hit.hitsItShouldTake]);
  await page.waitForFunction(() => window.lastReturnDebug.game.mode === 'dead', null, { timeout: 15000 }).catch(() => {});

  // --- back from the checkpoint ---
  const retry = await inGame(() => {
    const d = window.lastReturnDebug, p = d.player, seen = { mode: d.game.mode, atLeast: d.tuning.playerRetryHealth, of: d.tuning.playerMaxHealth };
    d.retryFromCheckpoint();
    seen.back = { mode: d.game.mode, health: p.health }; // (the checkpoint was passed unhurt)
    // A checkpoint passed badly hurt: back from it you have the least there is to come back with. Passed lightly hurt: what you had.
    const dieNow = function () { p.hurtGraceSeconds = 0; p.health = 1; d.hollow.recoverSeconds = 0; d.hitPlayer('hollow', d.hollow.figure); };
    p.health = 10; d.saveCheckpoint(); dieNow();
    seen.dying = d.game.mode;
    return seen;
  });
  check('back from a checkpoint you passed unhurt you have all of your health', retry.mode === 'dead' && retry.back.mode === 'playing' && retry.back.health === retry.of && retry.dying === 'dying', retry);
  await page.waitForFunction(() => window.lastReturnDebug.game.mode === 'dead', null, { timeout: 15000 }).catch(() => {});
  const retryHurt = await inGame(() => {
    const d = window.lastReturnDebug, p = d.player, seen = { atLeast: d.tuning.playerRetryHealth, of: d.tuning.playerMaxHealth };
    d.retryFromCheckpoint();
    seen.fromABadOne = { mode: d.game.mode, health: p.health };
    return seen;
  });
  check('back from one you passed badly hurt you have the least there is to come back with, not what you had', retryHurt.fromABadOne.mode === 'playing' && retryHurt.fromABadOne.health === retryHurt.atLeast &&
    retryHurt.atLeast > 10 && retryHurt.atLeast < retryHurt.of, retryHurt);

  // --- the rules of a hit, one at a time ---
  await prepare();
  const rules = await inGame(() => {
    const d = window.lastReturnDebug, p = d.player, seen = { of: d.tuning.playerMaxHealth, grace: d.tuning.playerHurtGraceSeconds };
    d.spawnHollow(p.x + 8, p.z); d.hollow.graceTimer = 99; // (there, and not about to do anything by itself)
    const figure = d.hollow.figure;
    const fresh = function () { p.health = seen.of; p.hurtGraceSeconds = 0; };
    // Twice in a moment: the second does nothing. After the moment it does.
    fresh();
    seen.first = d.hitPlayer('still', figure);
    const afterOne = p.health;
    seen.secondAtOnce = d.hitPlayer('still', figure);
    seen.unchanged = p.health === afterOne;
    d.simulate(seen.grace + 0.1);
    seen.afterTheMoment = d.hitPlayer('still', figure);
    seen.stillTakes = (seen.of - afterOne) / d.game.difficulty.damageFactor;
    seen.stillNumber = d.getHitDamage('still');
    // The debug switch: nothing hurts you.
    fresh(); d.setDebugOption('invulnerable', true);
    seen.withTheSwitch = [d.hitPlayer('hollow', figure), p.health];
    d.setDebugOption('invulnerable', false);
    // A looter's bite never kills: it leaves you the last of your health, however little you had.
    fresh(); p.health = 3;
    seen.bitten = [d.hitPlayer('looter', figure), p.health, d.game.mode];
    p.hurtGraceSeconds = 0;
    seen.bittenAgain = [d.hitPlayer('looter', figure), p.health, d.game.mode];
    // On Nightmare a hit takes more: you are dead in as many hits as the numbers say, which is fewer than on Standard
    // (or as few, if Standard is already one).
    const hitsOn = function (levelKey) { return Math.ceil((seen.of - 0.5) / (d.getHitDamage('hollow') * d.difficultyPresets[levelKey].damageFactor)); };
    fresh(); d.game.difficulty = d.difficultyPresets.nightmare;
    seen.onNightmare = { shouldTake: hitsOn('nightmare'), onStandard: hitsOn('standard'), hits: 0, outcomes: [] };
    for (let count = 0; count < 20 && d.game.mode === 'playing'; count++) {
      p.hurtGraceSeconds = 0;
      seen.onNightmare.outcomes.push(d.hitPlayer('hollow', figure));
      seen.onNightmare.hits++;
    }
    seen.onNightmare.mode = d.game.mode;
    return seen;
  });
  check('nothing hits you twice in a moment; after it, the next hit counts again. A Still\'s hit takes what a Still\'s hit takes',
    rules.first === 'hurt' && rules.secondAtOnce === 'none' && rules.unchanged && rules.afterTheMoment === 'hurt' && Math.abs(rules.stillTakes - rules.stillNumber) < 0.01, rules);
  check('with "Cannot be caught" on in debug mode nothing hurts you', rules.withTheSwitch[0] === 'none' && rules.withTheSwitch[1] === rules.of, rules.withTheSwitch);
  check('a looter\'s bite is never the death of you: it leaves you the last of your health, and you are still on your feet',
    rules.bitten[0] === 'hurt' && rules.bitten[1] >= 1 && rules.bitten[1] < 3 && rules.bitten[2] === 'playing' && rules.bittenAgain[0] === 'hurt' && rules.bittenAgain[1] >= 1 && rules.bittenAgain[2] === 'playing', rules);
  check('on Nightmare the Hollow kills in as many hits as the numbers say, which is not more than on Standard: every hit before the last hurts, and the last is your death',
    rules.onNightmare.hits === rules.onNightmare.shouldTake && rules.onNightmare.shouldTake <= rules.onNightmare.onStandard && rules.onNightmare.mode === 'dying' &&
    rules.onNightmare.outcomes[rules.onNightmare.outcomes.length - 1] === 'dead' && rules.onNightmare.outcomes.slice(0, -1).every((outcome) => outcome === 'hurt'), rules.onNightmare);
  await page.waitForFunction(() => window.lastReturnDebug.game.mode === 'dead', null, { timeout: 15000 }).catch(() => {});

  // --- a Still's hit, and what it does afterwards ---
  await prepare();
  const still = await inGame(() => {
    const d = window.lastReturnDebug, p = d.player, seen = { restsFor: d.tuning.stillAfterHitSeconds, count: d.stills.length };
    if (d.stills.length === 0) return seen;
    const one = d.stills[0];
    d.catchPlayer(p, 'still', one.figure);
    seen.afterTheHit = { mode: d.game.mode, lost: d.tuning.playerMaxHealth - p.health, takes: d.getHitDamage('still') * d.game.difficulty.damageFactor, rests: one.restSeconds, othersRest: d.stills.slice(1).some((other) => other.restSeconds > 0) };
    return seen;
  });
  check('a Still that has hit you does not move or strike again for a while; the others are not held up by it',
    still.count > 0 && still.afterTheHit.mode === 'playing' && Math.abs(still.afterTheHit.lost - still.afterTheHit.takes) < 0.01 && still.afterTheHit.rests === still.restsFor && !still.afterTheHit.othersRest, still);

  // --- the first aid kit ---
  await prepare();
  const kit = await inGame(() => {
    const d = window.lastReturnDebug, p = d.player, seen = { of: d.tuning.playerMaxHealth, heals: d.tuning.firstAidHeals };
    const useIt = function () { d.input.wantsUseCarried = true; d.simulate(0.15); };
    const first = d.createLooseObject('firstAidKit', p.x, p.floorY + 0.4, p.z - 0.8, 0);
    seen.worthNew = d.getLooseObjectValue(first);
    d.pickUpLooseObject(first, false); d.simulate(0.3);
    seen.held = d.getHeldLooseObject() === first;
    // Unhurt: Q does nothing, and the kit is kept.
    useIt();
    seen.unhurt = { health: p.health, isSpent: first.isSpent, told: document.getElementById('hud-messages').textContent };
    // Hurt: it gives back what it gives, and is used up.
    p.health = 30;
    useIt();
    seen.used = { health: p.health, isSpent: first.isSpent, label: d.getLooseObjectLabel(first), worth: d.getLooseObjectValue(first), stillHeld: d.getHeldLooseObject() === first };
    // A used one does nothing more.
    p.health = 30;
    useIt();
    seen.usedAgain = p.health;
    // And never more than all of it: nearly whole, a second kit fills you up and no further.
    d.releaseHeldLooseObject(0); d.simulate(0.3);
    const second = d.createLooseObject('firstAidKit', p.x, p.floorY + 0.4, p.z - 0.8, 0);
    d.pickUpLooseObject(second, false); d.simulate(0.3);
    p.health = seen.of - 5;
    useIt();
    seen.toTheBrim = { health: p.health, isSpent: second.isSpent };
    d.updateHud(0.016);
    seen.bar = { width: parseFloat(document.getElementById('bar-health').style.width) };
    // The bar goes red when little is left.
    p.health = seen.of * d.tuning.healthCriticalShare; d.updateHud(0.016);
    seen.barWhenLow = document.getElementById('bar-health').classList.contains('is-critical');
    p.health = seen.of * d.tuning.healthCriticalShare + 10; d.updateHud(0.016);
    seen.barWhenNotSoLow = document.getElementById('bar-health').classList.contains('is-critical');
    return seen;
  });
  check('a first aid kit in your beam does nothing while you are unhurt, and you keep it', kit.held && kit.unhurt.health === kit.of && !kit.unhurt.isSpent && /not hurt/.test(kit.unhurt.told), kit);
  check('hurt, Q with it in the beam gives back what a kit gives and uses it up: it is a spent kit, worth next to nothing, and does nothing more',
    kit.used.health === 30 + kit.heals && kit.used.isSpent && kit.used.label === 'spent first aid kit' && kit.used.worth < kit.worthNew && kit.used.worth <= 2 && kit.usedAgain === 30, kit);
  check('it never gives more than all of your health; and the bar on the HUD is red when little is left, and only then',
    kit.toTheBrim.health === kit.of && kit.toTheBrim.isSpent && Math.abs(kit.bar.width - 100) < 0.2 && kit.barWhenLow && !kit.barWhenNotSoLow, kit);

  // --- marks: a better make of a thing does what the plain one does, with some of its numbers its own way ---
  // (Which marks there are is whatever src/objects/ holds: what is asked of them is what each file says of itself.)
  await prepare();
  const marks = await inGame(() => {
    const d = window.lastReturnDebug, p = d.player, seen = { plainHeals: d.tuning.firstAidHeals, weights: d.tuning.itemMarkWeights, kinds: [], kits: [] };
    for (const baseKey in d.looseObjectMarks) {
      for (const entry of d.looseObjectMarks[baseKey]) {
        const kind = d.looseObjectKinds[entry[0]], base = d.looseObjectKinds[baseKey];
        seen.kinds.push({ key: entry[0], mark: entry[1], isOfACodedKind: kind.worksLike === baseKey && kind.isDesigned === true && !base.isDesigned,
          doesWhatItDoes: kind.use === base.use && kind.update === base.update && kind.pocket === base.pocket,
          onlyItsNumbers: Object.keys(kind.numbers).every((key) => Boolean(base.markNumbers[key])), hasANameOfItsOwn: kind.label !== base.label, isAMark: entry[1] >= 2 && entry[1] === kind.mark });
      }
    }
    // Every make of first aid kit, used at the same health: each gives back what it says it gives, and is used up.
    for (const entry of [['firstAidKit', 1]].concat(d.looseObjectMarks.firstAidKit || [])) {
      const kit = d.createLooseObject(entry[0], p.x, p.floorY + 0.4, p.z - 0.8, 0);
      d.pickUpLooseObject(kit, false); d.simulate(0.3);
      p.health = 20;
      d.input.wantsUseCarried = true; d.simulate(0.15);
      seen.kits.push({ key: entry[0], mark: entry[1], says: d.getLooseNumber(kit, 'firstAidHeals'), gave: p.health - 20, isSpent: kit.isSpent, told: document.getElementById('hud-messages').textContent.indexOf(kit.kind.label.slice(1)) >= 0 });
      d.releaseHeldLooseObject(0); d.simulate(0.3);
      d.clearLooseObjects();
    }
    // What stations put out, with what the workshop made and without: a kit is a kit of some mark, the plain one most often.
    const count = function (isWithWorkshop) {
      d.setWorkshopContentUsed(isWithWorkshop);
      const found = {};
      let stations = 0;
      for (let seed = 1; seed <= 30; seed++) {
        if (!d.loadStation('generated', seed, 'large', 'mixed', 'two')) continue;
        stations++;
        for (const baseKey of ['firstAidKit', 'scanGrenade', 'scannerTripod']) {
          const makes = [baseKey].concat((d.looseObjectMarks[baseKey] || []).map((entry) => entry[0]));
          let here = 0;
          for (const object of d.looseObjects) if (makes.indexOf(object.kindKey) >= 0) { found[object.kindKey] = (found[object.kindKey] || 0) + 1; here++; }
          const said = baseKey === 'firstAidKit' ? d.level.firstAidKitCount : (baseKey === 'scanGrenade' ? d.level.scanGrenadeCount : d.level.scannerTripodCount);
          // (A mark whose file also has it lying about as a thing to carry, "In generated stations" above 0, is put out
          // that way on top: then there may be more of that kind than the station put out as such, never fewer.)
          const liesAboutToo = (d.looseObjectMarks[baseKey] || []).some((entry) => { const kind = d.looseObjectKinds[entry[0]]; return kind.asLitter > 0 || kind.onTheFloor > 0 || kind.onASurface > 0; });
          if (liesAboutToo && isWithWorkshop ? here < said : here !== said) found['miscounted ' + baseKey] = (found['miscounted ' + baseKey] || 0) + 1;
        }
      }
      return { stations: stations, found: found };
    };
    seen.withWorkshop = count(true);
    seen.fromCodeAlone = count(false);
    return seen;
  });
  check('every mark there is works like a kind that is written as code: it does what that does and goes where that goes, changes only numbers that kind lets a mark change, and has a name of its own',
    marks.kinds.every((kind) => kind.isOfACodedKind && kind.doesWhatItDoes && kind.onlyItsNumbers && kind.hasANameOfItsOwn && kind.isAMark), marks.kinds);
  check('every make of first aid kit gives back what it says it gives and is used up; a higher mark gives more',
    marks.kits.every((kit) => kit.gave === kit.says && kit.isSpent && kit.told) && marks.kits[0].says === marks.plainHeals &&
    marks.kits.slice().sort((first, second) => first.mark - second.mark).every((kit, index, all) => index === 0 || kit.says > all[index - 1].says), marks.kits);
  const makesOf = (found, baseKey) => Object.keys(found).filter((key) => key === baseKey || marks.kinds.some((kind) => kind.key === key && kind.isOfACodedKind && key.indexOf(baseKey) === 0));
  const plainKits = marks.withWorkshop.found.firstAidKit || 0, markedKits = makesOf(marks.withWorkshop.found, 'firstAidKit').reduce((sum, key) => sum + (key === 'firstAidKit' ? 0 : marks.withWorkshop.found[key]), 0);
  check('a station puts out marks in place of some of the plain ones, never more things for it, and the plain one most often; a station built from the code alone has only plain ones',
    marks.withWorkshop.stations >= 20 && !Object.keys(marks.withWorkshop.found).some((key) => key.indexOf('miscounted') === 0) &&
    (marks.kinds.length === 0 || (markedKits > 0 && plainKits > markedKits)) &&
    Object.keys(marks.fromCodeAlone.found).sort().join() === 'firstAidKit,scanGrenade,scannerTripod', { withWorkshop: marks.withWorkshop.found, fromCodeAlone: marks.fromCodeAlone.found });

  check('no script errors were reported', problems.length === 0, problems);
  await browser.close();

  if (failures.length > 0) {
    console.log('\n' + failures.length + ' check(s) failed.');
    process.exit(1);
  }
  console.log('\nAll health checks passed.');
})().catch((error) => { console.error('Health test crashed:', error); process.exit(1); });
