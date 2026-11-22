// Checks the intercom (src/js/08-intercom.js): that a station has its consoles and its loudspeakers, hanging
// where loudspeakers can hang, in the same places every time; that the console is dead without the mains;
// that switching it on is a shriek from every loudspeaker which everything that listens hears, and which
// brings what has still to arrive nearer once and not once for every loudspeaker; that it is switched off at
// the console and goes off by itself when whoever switched it on leaves the desk or the mains go; that the
// Hollow goes to the loudspeaker nearest to it; and how loud a loudspeaker is by how far off it is.
//
// (A voice through it, and that it is one intercom for everybody down there: together-test.js.)
const { openGame, startGame } = require('./browser-harness.js');

const failures = [];
function check(description, condition, detail) {
  const line = (condition ? 'ok    ' : 'FAIL  ') + description + (detail !== undefined ? '  ' + JSON.stringify(detail) : '');
  console.log(line);
  if (!condition) failures.push(description);
}

// Helpers that run inside the page, kept on `window.lab`.
const labSource = String(function () {
  const d = window.lastReturnDebug, lab = {};
  lab.round = function (value) { return Math.round(value * 100) / 100; };
  lab.consoles = function () { return d.intercomObjectIds.map(function (id) { return d.findInteractable(id); }).filter(Boolean); };
  // What a station has of it, and whether each loudspeaker hangs where one can.
  lab.describe = function () {
    const speakers = d.level.intercomSpeakers, tuning = d.tuning, result = { consoles: lab.consoles().length, speakers: speakers.length, problems: [] };
    let nearestPair = 999;
    const zones = {};
    for (const speaker of speakers) {
      zones[speaker.zone] = (zones[speaker.zone] || 0) + 1;
      const under = d.findWalkableSpotNear(speaker.x, speaker.z);
      if (!under || Math.hypot(under.x - speaker.x, under.z - speaker.z) > 0.75) result.problems.push('no floor under the one at ' + lab.round(speaker.x) + ', ' + lab.round(speaker.z));
      else if (Math.abs(speaker.y - d.getFloorHeightAt(under.x, under.z) - tuning.intercomSpeakerHeight) > 0.02) result.problems.push('the one at ' + lab.round(speaker.x) + ', ' + lab.round(speaker.z) + ' hangs at the wrong height');
      for (const door of d.doors) if (Math.hypot(door.tileX + 0.5 - speaker.x, door.tileZ + 0.5 - speaker.z) < 1) result.problems.push('the one at ' + lab.round(speaker.x) + ', ' + lab.round(speaker.z) + ' hangs at a door');
      for (const other of speakers) if (other !== speaker) nearestPair = Math.min(nearestPair, Math.hypot(other.x - speaker.x, other.z - speaker.z));
    }
    // (Within arm's reach of somewhere you can stand: asked of the game's own audit, which walks up to it.)
    for (const console of lab.consoles()) {
      const wrong = d.describeIfOutOfReach(console.x, console.y, console.z, false);
      if (wrong !== '') result.problems.push('the console at ' + lab.round(console.x) + ', ' + lab.round(console.z) + ': ' + wrong);
    }
    result.partsWithOne = Object.keys(zones).length; result.mostInOnePart = Math.max.apply(null, Object.keys(zones).map(function (zone) { return zones[zone]; }).concat([0]));
    result.nearestPair = lab.round(nearestPair);
    result.places = speakers.map(function (speaker) { return [lab.round(speaker.x), lab.round(speaker.y), lab.round(speaker.z)].join(); }).join(' ');
    result.map = d.level.mapFingerprint;
    return result;
  };
  // Everything that listens, for the length of a check: what was heard, as { x, z, radius }.
  lab.listen = function () {
    lab.heard = [];
    d.creatureKinds.push({ key: 'testEars', update: function () {}, reset: function () {}, hear: function (x, z, radius) { lab.heard.push({ x: x, z: z, radius: radius }); } });
  };
  lab.stopListening = function () { const index = d.creatureKinds.findIndex(function (kind) { return kind.key === 'testEars'; }); if (index >= 0) d.creatureKinds.splice(index, 1); };
  // You, standing at a console, looking at it.
  lab.standAt = function (console) {
    const stand = d.findWalkableSpotNear(console.x, console.z);
    d.teleport(stand.x, stand.z, Math.atan2(console.x - stand.x, -(console.z - stand.z)));
    d.player.velocityX = 0; d.player.velocityZ = 0; d.player.pitch = -0.4;
    d.simulate(0.2);
    return Math.hypot(d.player.x - console.x, d.player.z - console.z);
  };
  lab.press = function (console) { d.askToAct({ what: 'use', objectId: console.objectId }); };
  lab.frames = function (seconds) { for (let time = 0; time < seconds; time += 0.05) { d.simulate(0.05); d.updateIntercom(0.05); } };
  window.lab = lab;
});

(async () => {
  const { browser, page, problems } = await openGame({ dev: true, arrivals: true });
  const inGame = (callback, argument) => page.evaluate(callback, argument);
  await startGame(page, false);
  await page.evaluate('(' + labSource + ')()');

  // --- what a station has of it ---
  const built = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, result = { stations: [] };
    d.loadStation('classic', 0);
    result.kessel = lab.describe();
    d.loadStation('generated', 7, 'small', 'mixed', 'two');
    d.loadStation('classic', 0);
    result.kesselAgain = lab.describe();
    for (const [seed, size, place] of [[7, 'small', 'annex'], [7, 'medium', 'annex'], [11, 'large', 'annex'], [5, 'medium', 'mine'], [23, 'small', 'mine']]) {
      d.loadStation('generated', seed, size, 'mixed', 'two', undefined, undefined, place);
      const first = lab.describe();
      d.loadStation('classic', 0);
      d.loadStation('generated', seed, size, 'mixed', 'two', undefined, undefined, place);
      const second = lab.describe();
      result.stations.push({ name: place + ' ' + size + ' ' + seed, consoles: first.consoles, speakers: first.speakers, partsWithOne: first.partsWithOne, mostInOnePart: first.mostInOnePart, nearestPair: first.nearestPair, problems: first.problems,
        sameAgain: first.places === second.places && first.map === second.map });
    }
    result.numbers = { height: d.tuning.intercomSpeakerHeight };
    return result;
  });
  check('Kessel-9 has a console in the security office and one in the control room, each within reach of the floor, and loudspeakers through the station: on a wall, over floor, at their height, none at a door',
    built.kessel.consoles === 2 && built.kessel.speakers >= 12 && built.kessel.partsWithOne >= 10 && built.kessel.problems.length === 0, { consoles: built.kessel.consoles, speakers: built.kessel.speakers, parts: built.kessel.partsWithOne, problems: built.kessel.problems });
  check('no part of it has more than three, no two hang within five metres of each other, and they hang in the same places every time', built.kessel.mostInOnePart <= 3 && built.kessel.nearestPair >= 5 && built.kessel.places === built.kesselAgain.places,
    [built.kessel.mostInOnePart, built.kessel.nearestPair]);
  check('generated stations have theirs too, hanging where loudspeakers can, and the same seed puts them in the same places and gives the same map',
    built.stations.every((station) => station.consoles >= 1 && station.speakers >= 8 && station.problems.length === 0 && station.mostInOnePart <= 3 && station.nearestPair >= 5 && station.sameAgain), built.stations);

  // --- switching it ---
  const switched = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, result = {}, tuning = d.tuning;
    d.loadStation('generated', 7, 'medium', 'mixed', 'two');
    d.game.difficulty = d.difficultyPresets.standard;
    d.startOver(); d.game.flags.hasLeftLift = true;
    d.setDebugOption('invulnerable', true);
    d.settings.captions = 'all'; d.clearMessages();
    const consoles = lab.consoles(), desk = consoles[0], other = consoles[1];
    result.speakers = d.level.intercomSpeakers.length;
    result.numbers = { shriek: tuning.noiseRadiusIntercomShriek, reach: tuning.intercomReachMetres, quiet: tuning.arrivalQuietNoiseRadius, secondsAMetre: tuning.arrivalSecondsPerNoiseMetre };
    result.metresFromTheDesk = lab.round(lab.standAt(desk));
    result.promptAtFirst = desk.prompt;
    // Without the mains it is dead.
    lab.listen();
    lab.press(desk);
    result.dead = { isOn: d.intercom.isOn, heard: lab.heard.length, told: document.getElementById('hud-messages').textContent };
    // With them: on. Every loudspeaker shrieks, and everything that listens hears every one of them.
    d.grantPower(); d.clearMessages(); d.clearCaptions();
    for (const key of ['intercomShriek', 'intercomHiss', 'intercomOff', 'intercomVoice']) d.captionCounts[key] = 0;
    const wait = d.arrivals.waits[d.arrivals.order[0]];
    wait.quietSeconds = 99999; // (what comes by itself is not to come in the middle of this)
    const takenBefore = wait.takenByNoise;
    lab.press(desk);
    result.on = { isOn: d.intercom.isOn, at: d.intercom.objectId === desk.objectId, prompt: desk.prompt, otherPrompt: other ? other.prompt : null, shrieks: d.intercom.statistics.shrieks, heard: lab.heard.length,
      everyOneOfThem: lab.heard.length === d.level.intercomSpeakers.length && lab.heard.every((noise) => noise.radius === tuning.noiseRadiusIntercomShriek && d.level.intercomSpeakers.some((speaker) => speaker.x === noise.x && speaker.z === noise.z)),
      caption: d.captionCounts.intercomShriek, told: document.getElementById('hud-messages').textContent, yours: d.isIntercomYours(), carriesAVoice: d.isIntercomCarryingVoice(),
      takenOffTheWait: lab.round(wait.takenByNoise - takenBefore), onceWouldBe: lab.round((tuning.noiseRadiusIntercomShriek - tuning.arrivalQuietNoiseRadius) * tuning.arrivalSecondsPerNoiseMetre) };
    // On, it hisses, and makes no more noise for what listens while nobody talks.
    lab.heard.length = 0;
    lab.frames(2.5);
    result.whileOn = { isOn: d.intercom.isOn, heard: lab.heard.length, hiss: d.captionCounts.intercomHiss, seconds: lab.round(d.intercom.seconds) };
    // [E] again: off.
    lab.press(desk);
    result.off = { isOn: d.intercom.isOn, prompt: desk.prompt, caption: d.captionCounts.intercomOff, byItself: d.intercom.statistics.switchedOffByItself };
    // On again, and you walk away from the desk: it goes off by itself.
    lab.press(desk);
    lab.frames(0.3);
    const stillOnAtTheDesk = d.intercom.isOn;
    const away = d.findWalkableSpotNear(d.playerStart.x, d.playerStart.z);
    d.teleport(away.x, away.z, 0);
    result.metresAway = lab.round(Math.hypot(away.x - desk.x, away.z - desk.z));
    lab.frames(0.2);
    result.walkedAway = { wasOn: stillOnAtTheDesk, isOn: d.intercom.isOn, byItself: d.intercom.statistics.switchedOffByItself, prompt: desk.prompt };
    // On at one console, and somebody presses the other: that one takes it over, with a shriek of its own.
    if (other) {
      lab.standAt(desk); lab.press(desk);
      const shrieksBefore = d.intercom.statistics.shrieks;
      lab.standAt(other); lab.press(other);
      result.takenOver = { isOn: d.intercom.isOn, atTheOther: d.intercom.objectId === other.objectId, shrieks: d.intercom.statistics.shrieks - shrieksBefore, prompts: [desk.prompt, other.prompt] };
      // The mains go: off.
      d.game.flags.powerOn = false;
      lab.frames(0.2);
      result.mainsGone = { isOn: d.intercom.isOn };
      d.game.flags.powerOn = true;
    }
    // A new descent: off.
    lab.standAt(desk); lab.press(desk);
    const onBeforeANewDescent = d.intercom.isOn;
    d.startOver();
    result.newDescent = { wasOn: onBeforeANewDescent, isOn: d.intercom.isOn, prompt: desk.prompt };
    lab.stopListening();
    d.setDebugOption('invulnerable', false);
    return result;
  });
  check('without the mains the console is dead: nothing is switched on, nothing is heard, and you are told why',
    switched.promptAtFirst === 'Intercom: switch on' && !switched.dead.isOn && switched.dead.heard === 0 && /No power/.test(switched.dead.told), switched.dead);
  check('with them, [E] at the console switches it on: every loudspeaker shrieks, with a caption, and everything that listens hears every one of them as far as the number says',
    switched.on.isOn && switched.on.at && switched.on.prompt === 'Intercom: switch off' && switched.on.shrieks === 1 && switched.on.heard === switched.speakers && switched.on.everyOneOfThem && switched.on.caption === 1,
    [switched.on, switched.speakers, switched.numbers]);
  check('what has still to arrive is brought nearer by it once, and not once for every loudspeaker', switched.on.onceWouldBe > 0 && Math.abs(switched.on.takenOffTheWait - switched.on.onceWouldBe) < 0.02, [switched.on.takenOffTheWait, switched.on.onceWouldBe, switched.speakers]);
  check('you are the one at the microphone; with nobody talking it carries no voice, hisses, and is no more noise to what listens',
    switched.on.yours && !switched.on.carriesAVoice && switched.whileOn.isOn && switched.whileOn.heard === 0 && switched.whileOn.hiss >= 1 && switched.whileOn.seconds > 2, [switched.on.yours, switched.whileOn]);
  check('[E] again switches it off, with a click from the loudspeakers', !switched.off.isOn && switched.off.prompt === 'Intercom: switch on' && switched.off.caption === 1 && switched.off.byItself === 0, switched.off);
  check('it goes off by itself when whoever switched it on walks away from the desk', switched.walkedAway.wasOn && !switched.walkedAway.isOn && switched.walkedAway.byItself === 1 && switched.metresAway > switched.numbers.reach && switched.walkedAway.prompt === 'Intercom: switch on',
    [switched.walkedAway, switched.metresAway]);
  if (switched.takenOver) {
    check('pressed at the other console while it is on, that one takes it over with a shriek of its own; and when the mains go, it goes off',
      switched.takenOver.isOn && switched.takenOver.atTheOther && switched.takenOver.shrieks === 1 && switched.takenOver.prompts[0] === 'Intercom: switch on' && switched.takenOver.prompts[1] === 'Intercom: switch off' && !switched.mainsGone.isOn, [switched.takenOver, switched.mainsGone]);
  }
  check('a new descent starts with it off', switched.newDescent.wasOn && !switched.newDescent.isOn && switched.newDescent.prompt === 'Intercom: switch on', switched.newDescent);

  // --- the Hollow, and how loud a loudspeaker is ---
  const heard = await inGame(() => {
    const d = window.lastReturnDebug, lab = window.lab, result = {}, tuning = d.tuning;
    d.loadStation('generated', 7, 'medium', 'mixed', 'two');
    d.game.difficulty = d.difficultyPresets.standard;
    d.startOver(); d.game.flags.hasLeftLift = true; d.grantPower();
    d.setDebugOption('invulnerable', true);
    const desk = lab.consoles()[0];
    lab.standAt(desk);
    // The Hollow stands listening, a few metres from a loudspeaker that is a long way from you and the desk.
    let far = null, farMetres = -1;
    for (const speaker of d.level.intercomSpeakers) { const metres = Math.hypot(speaker.x - desk.x, speaker.z - desk.z); if (metres > farMetres) { farMetres = metres; far = speaker; } }
    let at = null;
    for (const way of [[5, 0], [-5, 0], [0, 5], [0, -5], [4, 4], [-4, -4], [4, -4], [-4, 4]]) {
      const spot = d.findWalkableSpotNear(far.x + way[0], far.z + way[1]);
      if (spot && Math.hypot(spot.x - far.x, spot.z - far.z) > 3.5 && Math.hypot(spot.x - far.x, spot.z - far.z) < 7 && d.findNearestIntercomSpeaker(spot) === far) { at = spot; break; }
    }
    result.hasAPlace = at !== null;
    if (!at) return result;
    d.spawnHollow(at.x, at.z);
    d.hollow.graceTimer = 0; d.hollow.state = 4; d.hollow.listenTimer = 60; d.hollow.anger = 0;
    result.metresFromYou = lab.round(Math.hypot(at.x - d.player.x, at.z - d.player.z));
    result.metresFromTheLoudspeaker = lab.round(Math.hypot(at.x - far.x, at.z - far.z));
    lab.press(desk);
    const wentFor = d.hollow.state === 2 ? { x: d.hollow.lastKnownPlayerX, z: d.hollow.lastKnownPlayerZ } : { x: d.hollow.targetX, z: d.hollow.targetZ };
    result.hollow = { state: d.hollow.state, goesToTheNearestLoudspeaker: lab.round(Math.hypot(wentFor.x - far.x, wentFor.z - far.z)), goesToYou: lab.round(Math.hypot(wentFor.x - d.player.x, wentFor.z - d.player.z)) };
    d.hollow.isActive = false;
    lab.press(desk);
    // How loud a loudspeaker is by how far off it is.
    const speaker = { x: 50, y: 2, z: 50 }, level = (metres) => d.getIntercomSpeakerLevel(speaker, { x: 50 + metres, z: 50 }, 2);
    const full = tuning.intercomSpeakerFullWithinMetres, carries = tuning.intercomSpeakerCarriesMetres, half = (full + carries) / 2;
    result.loudness = { close: level(full * 0.5), atFull: level(full), half: lab.round(level(half)), nearlyGone: level(carries * 0.95), gone: level(carries), beyond: level(carries * 2) };
    d.setDebugOption('invulnerable', false);
    return result;
  });
  check('the station has a place for the Hollow a few metres from a loudspeaker far from the desk', heard.hasAPlace, heard.hasAPlace);
  if (heard.hasAPlace) {
    check('the Hollow, far from you, hears the loudspeaker beside it shriek and goes to that one, and not to you',
      (heard.hollow.state === 1 || heard.hollow.state === 2) && heard.hollow.goesToTheNearestLoudspeaker < 0.01 && heard.hollow.goesToYou > 8 && heard.metresFromYou > 10, heard);
  }
  check('a loudspeaker is at full close by, a quarter as loud half way out, and gone where the number says',
    heard.loudness.close === 1 && heard.loudness.atFull === 1 && Math.abs(heard.loudness.half - 0.25) < 0.01 && heard.loudness.nearlyGone > 0 && heard.loudness.nearlyGone < 0.02 && heard.loudness.gone === 0 && heard.loudness.beyond === 0, heard.loudness);

  check('no script errors were reported', problems.length === 0, problems);
  await browser.close();

  if (failures.length > 0) {
    console.log('\n' + failures.length + ' intercom check(s) failed:');
    for (const failure of failures) console.log('  - ' + failure);
    process.exit(1);
  }
  console.log('\nAll intercom checks passed.');
})().catch((error) => { console.error('Intercom test crashed:', error); process.exit(1); });
