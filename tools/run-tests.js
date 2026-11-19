// Runs the test suites one after another: `npm test` (after it has built the dev page), or by hand:
//
//   node tools/run-tests.js                     every suite
//   node tools/run-tests.js together players    only these
//   node tools/run-tests.js --no-second-try     a suite that fails has failed
//
// A suite that fails is run once more, by itself, when it has finished. These suites drive real browsers that
// draw in software, some of them two or three at once, and on a slow or busy machine a check that waits for
// something can come up short without anything being wrong with the game. One second try sorts that from a
// suite that is really broken, which fails both times.
//
// A second try is never silent. The summary at the end names every suite that needed one, and so does the
// summary of a run on GitHub. A suite that keeps needing one is telling you something: either a check in it
// waits on the clock where it should wait on the game, or the game has a fault that only shows now and then.
// Both are worth finding. (The whole suite is run again, not the one check: a check stands on what the checks
// before it left behind.)
//
// The run fails (exit code 1) if any suite failed twice, or failed once with --no-second-try.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// In the order they are run: the quick and general first, the ones that need a server and several browsers last.
const SUITES = ['playthrough', 'generated-station', 'generators', 'quests', 'custom-difficulty', 'locked-doors', 'noisy-floor', 'captions',
  'loose-objects', 'apparition', 'workshop', 'players', 'together'];

const givenNames = process.argv.slice(2).filter(function (argument) { return argument.indexOf('--') !== 0; });
const hasSecondTry = process.argv.indexOf('--no-second-try') < 0;
for (const name of givenNames) {
  if (SUITES.indexOf(name) < 0) { console.error('There is no suite called "' + name + '". The suites: ' + SUITES.join(', ') + '.'); process.exit(1); }
}
const suitesToRun = givenNames.length > 0 ? SUITES.filter(function (name) { return givenNames.indexOf(name) >= 0; }) : SUITES;

function formatSeconds(seconds) {
  return seconds >= 90 ? Math.floor(seconds / 60) + ' min ' + Math.round(seconds % 60) + ' s' : Math.round(seconds) + ' s';
}

// Runs one suite, with what it says going straight to the screen. Returns whether it passed and how long it took.
function runSuite(name) {
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [path.join(__dirname, name + '-test.js')], { stdio: 'inherit' });
  return { hasPassed: result.status === 0, seconds: (Date.now() - startedAt) / 1000 };
}

const results = []; // for each suite: { name, outcome: 'passed' | 'passed on the second try' | 'failed', seconds }
for (const name of suitesToRun) {
  console.log('\n===== ' + name + ' =====');
  const first = runSuite(name);
  let outcome = first.hasPassed ? 'passed' : 'failed', seconds = first.seconds;
  if (!first.hasPassed && hasSecondTry) {
    console.log('\n===== ' + name + ': failed, so once more =====');
    const second = runSuite(name);
    seconds += second.seconds;
    if (second.hasPassed) outcome = 'passed on the second try';
  }
  results.push({ name: name, outcome: outcome, seconds: seconds });
}

const failed = results.filter(function (result) { return result.outcome === 'failed'; });
const secondTries = results.filter(function (result) { return result.outcome === 'passed on the second try'; });
const totalSeconds = results.reduce(function (sum, result) { return sum + result.seconds; }, 0);

const lines = ['', '===== Summary ====='];
for (const result of results) lines.push('  ' + (result.name + '                    ').slice(0, 20) + (result.outcome + '                        ').slice(0, 26) + formatSeconds(result.seconds));
lines.push('  ' + results.length + ' suite(s) in ' + formatSeconds(totalSeconds) + '.');
if (secondTries.length > 0) {
  lines.push('');
  lines.push('  NEEDED A SECOND TRY: ' + secondTries.map(function (result) { return result.name; }).join(', ') + '.');
  lines.push('  That counts as passed, but look at what failed the first time (further up): a check that fails now and');
  lines.push('  then is either waiting on the clock, or has found a fault that only shows now and then.');
}
if (failed.length > 0) {
  lines.push('');
  lines.push('  FAILED' + (hasSecondTry ? ' TWICE' : '') + ': ' + failed.map(function (result) { return result.name; }).join(', ') + '.');
}
console.log(lines.join('\n'));

// On GitHub the same goes onto the run's own page, where it is seen without opening the log.
if (process.env.GITHUB_STEP_SUMMARY) {
  const markdown = ['### Tests', '', '| Suite | Outcome | Time |', '|---|---|---|'];
  for (const result of results) markdown.push('| ' + result.name + ' | ' + (result.outcome === 'passed' ? 'passed' : '**' + result.outcome + '**') + ' | ' + formatSeconds(result.seconds) + ' |');
  if (secondTries.length > 0) markdown.push('', 'Needed a second try: **' + secondTries.map(function (result) { return result.name; }).join(', ') + '**. The run passed, but the first failure is in the log and is worth a look.');
  try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown.join('\n') + '\n'); } catch (error) { /* the summary is a nicety */ }
}

process.exit(failed.length > 0 ? 1 : 0);
