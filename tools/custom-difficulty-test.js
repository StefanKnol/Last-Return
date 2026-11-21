// Checks the "Custom" threat level: the panel on the title screen, that what is set there is what the
// game then plays by, that each setting really changes the thing it says it changes, and that a custom
// descent is named as such at the end and keeps its best times to itself.
const { openGame, startGame, drawFrames } = require('./browser-harness.js');

const failures = [];
function check(description, condition, detail) {
  const line = (condition ? 'ok    ' : 'FAIL  ') + description + (detail !== undefined ? '  ' + JSON.stringify(detail) : '');
  console.log(line);
  if (!condition) failures.push(description);
}

(async () => {
  const { browser, page, problems } = await openGame(); // the game as shipped: no debug mode needed for any of this
  const inGame = (callback, argument) => page.evaluate(callback, argument);
  // Sets one control in the custom panel the way a hand would: change it, and let the page hear about it.
  const setControl = (key, value) => page.evaluate(([id, wanted]) => {
    const control = document.getElementById(id);
    if (control.type === 'checkbox') control.checked = wanted; else control.value = String(wanted);
    control.dispatchEvent(new Event('input', { bubbles: true }));
  }, ['custom-' + key, value]);
  const readRow = (key) => page.evaluate((id) => {
    const row = document.getElementById(id).closest('.custom-row');
    return { value: row.querySelector('.custom-value').textContent, note: row.querySelector('.custom-note').textContent, changed: row.classList.contains('is-changed') };
  }, 'custom-' + key);
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => Boolean(window.lastReturnDebug));

  // --- the presets and the list of settings agree with each other ---
  const shape = await inGame(() => {
    const d = window.lastReturnDebug, missing = [];
    for (const presetKey in d.difficultyPresets) {
      for (const option of d.customDifficultyOptions) {
        const value = d.difficultyPresets[presetKey][option.key];
        const isRightKind = option.kind === 'switch' ? typeof value === 'boolean' : typeof value === 'number';
        if (!isRightKind) missing.push(presetKey + '.' + option.key);
      }
    }
    const notAsStandard = d.customDifficultyOptions.filter((option) => d.settings.customDifficulty[option.key] !== d.difficultyPresets.standard[option.key]).map((option) => option.key);
    return { missing: missing, options: d.customDifficultyOptions.map((option) => option.key), notAsStandard: notAsStandard, startsAs: d.describeCustomDifficulty(d.settings.customDifficulty),
      table: d.customDifficultyOptions, standard: d.difficultyPresets.standard, huntSpeed: d.tuning.hollowHuntSpeed, sprintSpeed: d.tuning.sprintSpeed };
  });
  check('every preset has a value of the right kind for everything a custom threat level can set', shape.missing.length === 0, shape.missing);
  check('a custom threat level starts out the same as Standard', shape.notAsStandard.length === 0, { differs: shape.notAsStandard, says: shape.startsAs });
  // The values the controls are set to below come out of the table of settings, so that they are always ones the
  // panel offers whatever it is retuned to: the top or the bottom end of a setting, whichever is not Standard's.
  const valueOtherThanStandard = (key, wantsTopEnd) => {
    const option = shape.table.find((candidate) => candidate.key === key), standardValue = shape.standard[key];
    if (option.kind === 'switch') return !standardValue;
    const ends = option.kind === 'choice' ? [option.choices[0][0], option.choices[option.choices.length - 1][0]] : [option.minimum, option.maximum];
    const preferred = wantsTopEnd ? ends[1] : ends[0];
    return preferred !== standardValue ? preferred : (wantsTopEnd ? ends[0] : ends[1]);
  };
  const labelOf = (key) => shape.table.find((option) => option.key === key).label;
  // How a changed setting is named in the line that says how a custom level differs from Standard: its label, then
  // "on" or "off" for a switch, the name of the choice, or the percentage, as the panel's row shows it.
  const shownInSummary = (key, value) => {
    const option = shape.table.find((candidate) => candidate.key === key);
    if (option.kind === 'switch') return option.label + ' ' + (value ? 'on' : 'off');
    if (option.kind === 'choice') return option.label + ' ' + option.choices.find((choice) => choice[0] === value)[1].toLowerCase();
    return option.label + ' ' + Math.round(value * 100) + ' %';
  };

  // --- the title screen: choosing Custom opens the panel, with a row for each setting ---
  const beforeChoosing = await page.evaluate(() => ({ panelHidden: document.getElementById('screen-custom').hidden, adjustHidden: document.getElementById('button-custom-difficulty').hidden }));
  await page.evaluate(() => document.getElementById('difficulty-custom').click());
  const opened = await page.evaluate(() => ({
    panelHidden: document.getElementById('screen-custom').hidden, adjustHidden: document.getElementById('button-custom-difficulty').hidden,
    rows: document.querySelectorAll('#custom-options .custom-row').length, titleStillThere: !document.getElementById('screen-title').hidden,
    setting: window.lastReturnDebug.settings.difficulty
  }));
  check('choosing Custom opens its panel over the title screen, with one row for each setting',
    beforeChoosing.panelHidden && beforeChoosing.adjustHidden && !opened.panelHidden && !opened.adjustHidden && opened.titleStillThere &&
    opened.rows === shape.options.length && opened.setting === 'custom', { before: beforeChoosing, opened: opened });

  const firstChoice = { hollowSpeedFactor: valueOtherThanStandard('hollowSpeedFactor', true), hearingFactor: valueOtherThanStandard('hearingFactor', false),
    checkpointsEnabled: valueOtherThanStandard('checkpointsEnabled'), phantomFactor: valueOtherThanStandard('phantomFactor', true) };
  for (const key in firstChoice) await setControl(key, firstChoice[key]);
  const afterSetting = await inGame(() => JSON.parse(JSON.stringify(window.lastReturnDebug.settings.customDifficulty)));
  const speedRow = await readRow('hollowSpeedFactor'), heatRow = await readRow('heatFactor'), lifeRow = await readRow('checkpointsEnabled');
  // What the rows should say is what the game works out for those values (a percentage, and its sentence).
  const expectedNotes = await inGame((values) => ({ speed: window.lastReturnDebug.explainCustomDifficultyValue('hollowSpeedFactor', values.hollowSpeedFactor),
    life: window.lastReturnDebug.explainCustomDifficultyValue('checkpointsEnabled', values.checkpointsEnabled) }), firstChoice);
  // The speed row warns "You cannot outrun it." exactly when its hunt is at least as fast as your sprint. That is
  // tried at both ends of the setting's range. The top end must be over that line: if no value of the range is,
  // the table has made the warning one that can never be shown, and the check fails saying so.
  const speedOption = shape.table.find((option) => option.key === 'hollowSpeedFactor');
  const outrun = await inGame((ends) => ends.map((value) => ({ value: value, note: window.lastReturnDebug.explainCustomDifficultyValue('hollowSpeedFactor', value) })),
    [speedOption.minimum, speedOption.maximum]);
  outrun.forEach((end) => { end.isOverTheLine = shape.huntSpeed * end.value >= shape.sprintSpeed; end.warns = /You cannot outrun it\./.test(end.note); });
  const outrunDetail = outrun[1].isOverTheLine ? outrun : { outrun: outrun, problem: 'no Hollow speed in the range makes its hunt as fast as your sprint, so "You cannot outrun it." can never be shown' };
  check('moving a control changes the setting, and the row says what it now comes to; the speed row says you cannot outrun it exactly when its hunt is as fast as your sprint',
    Object.keys(firstChoice).every((key) => afterSetting[key] === firstChoice[key]) &&
    speedRow.value === Math.round(firstChoice.hollowSpeedFactor * 100) + ' %' && speedRow.note === expectedNotes.speed && expectedNotes.speed.length > 0 &&
    lifeRow.note === expectedNotes.life && expectedNotes.life.length > 0 &&
    outrun[1].isOverTheLine && outrun.every((end) => end.warns === end.isOverTheLine),
    { settings: afterSetting, speedRow: speedRow, lifeRow: lifeRow, expectedNotes: expectedNotes, outrun: outrunDetail });
  check('rows that differ from Standard are marked, rows that do not are not', speedRow.changed && lifeRow.changed && !heatRow.changed, [speedRow.changed, lifeRow.changed, heatRow.changed]);
  const summary = await page.evaluate(() => [document.getElementById('custom-summary').textContent, document.getElementById('difficulty-description').textContent]);
  check('the panel and the title screen both say how it differs from Standard',
    summary[0] === summary[1] && Object.keys(firstChoice).every((key) => summary[0].indexOf(shownInSummary(key, firstChoice[key])) >= 0) && summary[0].indexOf(labelOf('heatFactor')) < 0,
    { says: summary, shouldName: Object.keys(firstChoice).map((key) => shownInSummary(key, firstChoice[key])) });

  await page.evaluate(() => document.getElementById('button-custom-done').click());
  const closed = await page.evaluate(() => document.getElementById('screen-custom').hidden);
  await page.evaluate(() => document.getElementById('button-custom-difficulty').click());
  const reopened = await page.evaluate((speed) => !document.getElementById('screen-custom').hidden && document.getElementById('custom-hollowSpeedFactor').value === String(speed), firstChoice.hollowSpeedFactor);
  check('Done closes the panel, and Adjust opens it again with the values as they were left', closed && reopened, [closed, reopened]);

  // --- it is remembered: close the page, open it again ---
  await page.reload();
  await page.waitForFunction(() => Boolean(window.lastReturnDebug));
  const remembered = await inGame(() => ({
    difficulty: window.lastReturnDebug.settings.difficulty, values: window.lastReturnDebug.settings.customDifficulty,
    pill: document.getElementById('difficulty-custom').checked, panelHidden: document.getElementById('screen-custom').hidden,
    description: document.getElementById('difficulty-description').textContent
  }));
  check('after closing and reopening the page, Custom is still chosen with the same values, and the panel does not pop open by itself',
    remembered.difficulty === 'custom' && remembered.pill && remembered.panelHidden && Object.keys(firstChoice).every((key) => remembered.values[key] === firstChoice[key]) &&
    remembered.description === summary[0], remembered);

  // --- "Start from" copies a preset; values that are no good are put right ---
  // What a copy holds is compared with the preset itself, value by value. The summary must name the preset, and
  // name none of the settings: a copy differs from it in nothing.
  const copyOf = (presetKey) => page.evaluate((key) => {
    const d = window.lastReturnDebug, preset = d.difficultyPresets[key];
    document.getElementById('custom-from-' + key).click();
    return { summary: document.getElementById('custom-summary').textContent, label: preset.label,
      differs: d.customDifficultyOptions.filter((option) => d.settings.customDifficulty[option.key] !== preset[option.key]).map((option) => option.key) };
  }, presetKey);
  await page.evaluate(() => document.getElementById('button-custom-difficulty').click());
  const fromNightmare = await copyOf('nightmare');
  const fromStandard = await copyOf('standard');
  check('"Start from" copies a preset exactly',
    [fromNightmare, fromStandard].every((copy) => copy.differs.length === 0 && copy.summary.indexOf(copy.label) >= 0 && shape.table.every((option) => copy.summary.indexOf(option.label) < 0)),
    [fromNightmare, fromStandard]);
  // Values that are no good, made for each setting from its own range in the table: above its top, below its
  // bottom, between two of its steps, of the wrong kind, between two of its choices; a switch set to something
  // that is no switch, and one set rightly that must be kept; and one that is no setting at all. The kinds of bad
  // value go round the settings they can apply to, and the check makes sure every kind was really tried.
  const repaired = await inGame(() => {
    const d = window.lastReturnDebug, standard = d.difficultyPresets.standard, stored = { somethingElse: 5 }, expected = {}, tried = {};
    const kindsOfBadValue = {
      percent: [
        ['above its top', (option) => [option.maximum + 99, option.maximum]],
        ['below its bottom', (option) => [option.minimum - 3, option.minimum]],
        ['between two steps', (option) => [option.minimum + option.step * 1.3, Math.round((option.minimum + option.step) * 1000) / 1000]],
        ['of the wrong kind', (option) => ['fast', standard[option.key]]]
      ],
      switch: [
        ['a switch set to no switch', (option) => ['yes', standard[option.key]]],
        ['a switch set rightly', (option) => [!standard[option.key], !standard[option.key]]]
      ],
      choice: [
        ['between two choices', (option) => [option.choices[0][0] + (option.choices[1][0] - option.choices[0][0]) * 0.3, option.choices[0][0]]]
      ]
    };
    const turnOfKind = { percent: 0, switch: 0, choice: 0 };
    for (const option of d.customDifficultyOptions) {
      const kinds = kindsOfBadValue[option.kind];
      const kindOfBadValue = kinds[turnOfKind[option.kind]++ % kinds.length];
      const pair = kindOfBadValue[1](option);
      stored[option.key] = pair[0]; expected[option.key] = pair[1];
      tried[kindOfBadValue[0]] = option.key;
    }
    const allKinds = [].concat(kindsOfBadValue.percent, kindsOfBadValue.switch, kindsOfBadValue.choice).map((kind) => kind[0]);
    const result = d.sanitizeCustomDifficultyValues(stored);
    return { stored: stored, result: result, tried: tried, notTried: allKinds.filter((kind) => !(kind in tried)),
      wrong: Object.keys(expected).filter((key) => result[key] !== expected[key]), kept: Object.keys(result).filter((key) => !(key in expected)) };
  });
  check('stored values that are out of range, of the wrong kind or between steps are put right',
    repaired.notTried.length === 0 && repaired.wrong.length === 0 && repaired.kept.length === 0 && repaired.result.somethingElse === undefined, repaired);

  // --- what is set is what the game plays by ---
  const secondChoice = { hollowSpeedFactor: valueOtherThanStandard('hollowSpeedFactor', false), staminaFactor: valueOtherThanStandard('staminaFactor', true),
    heatFactor: valueOtherThanStandard('heatFactor', false), angerFactor: valueOtherThanStandard('angerFactor', true), phantomFactor: valueOtherThanStandard('phantomFactor', true),
    checkpointsEnabled: false }; // one life: what the checks further down are about
  for (const key in secondChoice) await setControl(key, secondChoice[key]);
  await page.evaluate(() => document.getElementById('button-custom-done').click());
  await startGame(page, false);
  const playing = await inGame(() => {
    const d = window.lastReturnDebug, difficulty = d.game.difficulty;
    return { label: difficulty.label, key: difficulty.key, isCustom: difficulty.isCustom, speed: difficulty.hollowSpeedFactor, stamina: difficulty.staminaFactor,
      heat: difficulty.heatFactor, anger: difficulty.angerFactor, phantoms: difficulty.phantomFactor, checkpoints: difficulty.checkpointsEnabled, hearing: difficulty.hearingFactor,
      standardHearing: d.difficultyPresets.standard.hearingFactor, panelHidden: document.getElementById('screen-custom').hidden };
  });
  check('a descent begun on Custom plays by the custom values, and by Standard for whatever was left alone',
    playing.label === 'Custom' && playing.isCustom && /^custom-/.test(playing.key) && playing.speed === secondChoice.hollowSpeedFactor && playing.stamina === secondChoice.staminaFactor &&
    playing.heat === secondChoice.heatFactor && playing.anger === secondChoice.angerFactor && playing.phantoms === secondChoice.phantomFactor && playing.checkpoints === false &&
    playing.hearing === playing.standardHearing && playing.panelHidden, playing);

  // --- each new setting changes the thing it says it changes (measured against the same thing at 100 %) ---
  const effects = await inGame(() => {
    const d = window.lastReturnDebug, tuning = d.tuning, result = {};
    const withDifficulty = function (changes, measure) {
      const kept = d.game.difficulty;
      d.game.difficulty = Object.assign({}, d.difficultyPresets.standard, changes);
      const value = measure();
      d.game.difficulty = kept;
      return value;
    };
    // Heat: two seconds of painting from cold.
    const heatAfterPainting = function () {
      d.loadStation('classic', 0);
      d.teleport(10.5, 53.5, Math.PI / 2); d.player.heat = 0; d.player.isOverheated = false;
      d.setScanHeld(true); d.simulate(2); d.setScanHeld(false);
      return d.player.heat;
    };
    result.heat = [withDifficulty({ heatFactor: 0.5 }, heatAfterPainting), withDifficulty({}, heatAfterPainting), withDifficulty({ heatFactor: 2 }, heatAfterPainting)];
    result.heatExpectedAtStandard = tuning.heatPerSecondWhilePainting * 2 * d.difficultyPresets.standard.heatFactor;
    // Anger: the Hollow six metres down the corridor, half a second in the beam from calm.
    const angerAfterBeam = function () {
      d.loadStation('classic', 0);
      d.game.flags.hasLeftLift = true;
      d.teleport(14.5, 53.5, Math.PI / 2); d.player.pitch = 0; d.simulate(0.1);
      d.spawnHollow(20.5, 53.5);
      d.hollow.anger = 0; d.hollow.graceTimer = 0;
      // (The beam is held on the middle of its body. Held level, from as low as a player's eyes may be set, it
      // is at the height of its legs, and half of it goes between them.)
      d.player.pitch = Math.atan2(d.hollow.figure.boundsCenterY - d.getPlayerEyeY(), 6);
      d.setScanHeld(true); d.simulate(0.5); d.setScanHeld(false);
      const anger = d.hollow.anger;
      d.hollow.isActive = false;
      return anger;
    };
    result.anger = [withDifficulty({ angerFactor: 0.5 }, angerAfterBeam), withDifficulty({}, angerAfterBeam), withDifficulty({ angerFactor: 2 }, angerAfterBeam)];
    // Apparitions: how many a descent of Kessel-9 may have, how many stand at fixed places, and the wait after one.
    const apparitions = function () {
      d.loadStation('classic', 0);
      const answer = { budget: d.phantomDirector.budget, placed: d.phantoms.length, reason: d.getPhantomHoldReason() };
      d.game.flags.hasLeftLift = true;
      // one watcher, scanned until it goes: what is the wait for the next?
      let phantom = null;
      for (let attempt = 0; attempt < 300 && !phantom; attempt++) {
        const spot = d.findWalkableSpotNear(6 + Math.random() * 60, 10 + Math.random() * 50);
        if (!spot || /LIFT CAR|SHAFT/.test(d.zoneNames[d.getZoneAt(spot.x, spot.z)])) continue;
        d.teleport(spot.x, spot.z, Math.random() * 6.28); d.player.pitch = 0; d.simulate(0.07);
        phantom = d.summonPhantom('watcher');
      }
      if (phantom) {
        d.player.yaw = Math.atan2(phantom.figure.x - d.player.x, -(phantom.figure.z - d.player.z));
        // (Looked at where it stands, not straight ahead: from low eyes a level beam is on its legs.)
        d.player.pitch = Math.atan2(phantom.figure.boundsCenterY - d.getPlayerEyeY(), Math.max(0.5, Math.hypot(phantom.figure.x - d.player.x, phantom.figure.z - d.player.z)));
        d.player.heat = 0; d.player.isOverheated = false;
        d.setScanHeld(true);
        for (let elapsed = 0; elapsed < 5 && d.phantomDirector.current === phantom; elapsed += 0.1) d.simulate(0.1);
        d.setScanHeld(false);
        answer.waitAfterOne = d.phantomDirector.current === null ? d.phantomDirector.timer : -1;
      }
      return answer;
    };
    result.apparitions = { none: withDifficulty({ phantomFactor: 0 }, apparitions), few: withDifficulty({ phantomFactor: 0.5 }, apparitions),
      normal: withDifficulty({}, apparitions), many: withDifficulty({ phantomFactor: 2 }, apparitions) };
    result.gap = [tuning.phantomGapShortestSeconds, tuning.phantomGapLongestSeconds];
    d.loadStation('classic', 0);
    return result;
  });
  const heat = effects.heat, anger = effects.anger, apparitions = effects.apparitions;
  check('scanner heat: half the heat at 50 %, twice at 200 %',
    Math.abs(heat[1] - effects.heatExpectedAtStandard) < 0.02 && Math.abs(heat[0] - heat[1] / 2) < 0.02 && Math.abs(heat[2] - heat[1] * 2) < 0.03, heat);
  check('its temper in the beam: half the anger at 50 %, twice at 200 %',
    anger[1] > 0.05 && Math.abs(anger[0] - anger[1] / 2) < 0.03 && Math.abs(anger[2] - anger[1] * 2) < 0.06, anger);
  check('apparitions "None": none may come, and the ones that stand at fixed places are gone too',
    apparitions.none.budget === 0 && apparitions.none.placed === 0 && /all of its apparitions/.test(apparitions.none.reason), apparitions.none);
  // (How many is the usual number comes from tuning and the size of the station; what is checked is what the setting does to it.)
  check('apparitions "Few", "Normal" and "Many": half as many, the usual number, twice as many; Kessel-9 keeps its placed ones on all three',
    apparitions.normal.budget > 0 && apparitions.few.budget === Math.round(apparitions.normal.budget * 0.5) && apparitions.many.budget === apparitions.normal.budget * 2 &&
    apparitions.normal.placed > 0 && apparitions.few.placed === apparitions.normal.placed && apparitions.many.placed === apparitions.normal.placed, [apparitions.few, apparitions.normal, apparitions.many]);
  check('with "Many" the wait after one is half as long, with "Few" twice as long',
    apparitions.normal.waitAfterOne >= effects.gap[0] && apparitions.normal.waitAfterOne <= effects.gap[1] &&
    apparitions.many.waitAfterOne >= effects.gap[0] / 2 && apparitions.many.waitAfterOne <= effects.gap[1] / 2 &&
    apparitions.few.waitAfterOne >= effects.gap[0] * 2 && apparitions.few.waitAfterOne <= effects.gap[1] * 2,
    [apparitions.few.waitAfterOne, apparitions.normal.waitAfterOne, apparitions.many.waitAfterOne, effects.gap]);

  // Stamina, through the keyboard: sprint along the main corridor for three seconds on 50 %, 100 % and 200 %.
  const staminaLeft = [];
  for (const factor of [0.5, 1, 2]) {
    await inGame((value) => {
      const d = window.lastReturnDebug;
      d.game.difficulty = Object.assign({}, d.difficultyPresets.standard, { staminaFactor: value });
      d.teleport(10.5, 53.5, Math.PI / 2); d.player.stamina = 1; d.player.isStaminaLocked = false; d.simulate(0.1);
    }, factor);
    await page.keyboard.down('ShiftLeft');
    await page.keyboard.down('KeyW');
    staminaLeft.push(await inGame(() => { const d = window.lastReturnDebug; d.simulate(3); return d.player.stamina; }));
    await page.keyboard.up('KeyW');
    await page.keyboard.up('ShiftLeft');
  }
  const staminaSeconds = await inGame(() => window.lastReturnDebug.tuning.staminaSeconds);
  const used = staminaLeft.map((left) => 1 - left);
  check('your stamina: three seconds of sprinting uses twice as much of the bar at 50 % and half as much at 200 %',
    // The page goes on running between the key going down and the measurement, so "three seconds" is three and a
    // bit, and not the same bit every time. What must hold is the proportion between the three.
    Math.abs(used[1] - 3 / staminaSeconds) < 0.12 && Math.abs(used[0] - Math.min(1, used[1] * 2)) < 0.1 && Math.abs(used[2] / used[1] - 0.5) < 0.06, { left: staminaLeft, used: used });

  // --- one life ---
  const die = async () => {
    await inGame(() => {
      const d = window.lastReturnDebug;
      d.game.flags.hasLeftLift = true;
      // In the open, in the middle of the main corridor, with the Hollow two metres off and told where the player is.
      d.teleport(30.5, 52.5, Math.PI / 2); d.simulate(0.1);
      d.spawnHollow(32.5, 52.5);
      d.hollow.graceTimer = 0; d.hollow.knowsPlayerPositionAlways = true;
      for (let step = 0; step < 100 && d.game.mode === 'playing'; step++) d.simulate(0.1);
    });
    await page.waitForFunction(() => window.lastReturnDebug.game.mode === 'dead', null, { timeout: 60000 });
  };
  await inGame(() => { const d = window.lastReturnDebug; d.game.difficulty = d.getChosenDifficulty(); }); // back to the custom values, which have checkpoints off
  await die();
  const oneLife = await page.evaluate(() => {
    const before = { retryHidden: document.getElementById('button-retry').hidden, startOverThere: !document.getElementById('button-death-restart').hidden, text: document.getElementById('death-lines').textContent };
    window.lastReturnDebug.retryFromCheckpoint();
    before.modeAfterTryingAnyway = window.lastReturnDebug.game.mode;
    return before;
  });
  check('one life: caught, there is no way to resume, only to start over',
    oneLife.retryHidden && oneLife.startOverThere && /One life/.test(oneLife.text) && oneLife.modeAfterTryingAnyway === 'dead', oneLife);
  await page.evaluate(() => document.getElementById('button-death-restart').click());
  // With checkpoints on, everything is as it always was.
  await page.evaluate(() => document.getElementById('button-custom-difficulty').click());
  await setControl('checkpointsEnabled', true);
  await page.evaluate(() => document.getElementById('button-custom-done').click());
  await startGame(page, false);
  await die();
  const withCheckpoints = await page.evaluate(() => ({ retryHidden: document.getElementById('button-retry').hidden, text: document.getElementById('death-lines').textContent }));
  await page.evaluate(() => document.getElementById('button-retry').click());
  const resumed = await inGame(() => window.lastReturnDebug.game.mode);
  check('with checkpoints on, being caught offers the checkpoint as before', !withCheckpoints.retryHidden && !/One life/.test(withCheckpoints.text) && resumed === 'playing', { withCheckpoints: withCheckpoints, resumed: resumed });

  // --- the end of a custom descent: named as custom, with its own best time ---
  await inGame(() => {
    const d = window.lastReturnDebug;
    d.hollow.isActive = false;
    d.game.flags.powerOn = true; d.grantSpools(); // (every spool found and loaded at the terminal, without the walking)
    d.teleport(10.2, 55.3, -Math.PI / 2); d.use(1);
    d.hollow.isActive = false;
    d.simulate(d.tuning.liftArrivalSeconds + 1);
    d.hollow.isActive = false;
    d.teleport(d.playerStart.x, d.playerStart.z, Math.PI / 2); d.simulate(0.2);
  });
  await page.waitForFunction(() => window.lastReturnDebug.game.mode === 'ending', null, { timeout: 90000 });
  await drawFrames(page, 1);
  const ending = await page.evaluate(() => {
    const rows = {};
    const terms = document.querySelectorAll('#ending-stats dt');
    for (const term of terms) rows[term.textContent] = term.nextElementSibling.textContent;
    const bestKeys = [];
    for (let index = 0; index < window.localStorage.length; index++) if (/^last-return-best-/.test(window.localStorage.key(index))) bestKeys.push(window.localStorage.key(index));
    return { rows: rows, bestKeys: bestKeys, key: window.lastReturnDebug.game.difficulty.key, description: window.lastReturnDebug.describeCustomDifficulty(window.lastReturnDebug.settings.customDifficulty) };
  });
  check('the ending screen says Custom and lists what was changed',
    ending.rows['Threat level'] === 'Custom' && ending.rows['Custom settings'] === ending.description &&
    ending.description.indexOf(shownInSummary('hollowSpeedFactor', secondChoice.hollowSpeedFactor)) >= 0 && ending.description.indexOf(shownInSummary('staminaFactor', secondChoice.staminaFactor)) >= 0,
    { rows: ending.rows, description: ending.description, shouldName: [shownInSummary('hollowSpeedFactor', secondChoice.hollowSpeedFactor), shownInSummary('staminaFactor', secondChoice.staminaFactor)] });
  check('its best time is kept under its own values, apart from Standard',
    ending.bestKeys.length === 1 && ending.bestKeys[0] === 'last-return-best-' + ending.key && ending.bestKeys[0] !== 'last-return-best-standard', ending.bestKeys);

  // --- the presets still work, and the panel stays out of the way ---
  await page.evaluate(() => document.getElementById('button-ending-restart').click());
  await page.evaluate(() => document.getElementById('difficulty-nightmare').click());
  const backOnPreset = await page.evaluate(() => ({ adjustHidden: document.getElementById('button-custom-difficulty').hidden, panelHidden: document.getElementById('screen-custom').hidden, description: document.getElementById('difficulty-description').textContent,
    customDescription: window.lastReturnDebug.describeCustomDifficulty(window.lastReturnDebug.settings.customDifficulty) }));
  await startGame(page, false);
  const nightmare = await inGame(() => ({ label: window.lastReturnDebug.game.difficulty.label, same: window.lastReturnDebug.game.difficulty === window.lastReturnDebug.difficultyPresets.nightmare }));
  check('choosing a preset again hides Adjust, and the descent plays on that preset untouched',
    backOnPreset.adjustHidden && backOnPreset.panelHidden && backOnPreset.description !== backOnPreset.customDescription && nightmare.label === 'Nightmare' && nightmare.same, { backOnPreset: backOnPreset, nightmare: nightmare });

  check('no script errors were reported', problems.length === 0, problems);
  await browser.close();

  if (failures.length > 0) {
    console.log('\n' + failures.length + ' check(s) failed.');
    process.exit(1);
  }
  console.log('\nAll custom threat level checks passed.');
})().catch((error) => { console.error('Custom threat level test crashed:', error); process.exit(1); });
