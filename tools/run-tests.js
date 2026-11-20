// Runs the test suites one after another: `npm test` (after it has built the dev page), or by hand:
//
//   node tools/run-tests.js                     every suite
//   node tools/run-tests.js together players    only these
//   node tools/run-tests.js --no-second-try     a suite that fails has failed
//   node tools/run-tests.js --other-stations=1000   every seed builds another station than it usually does
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
// --other-stations is for finding checks that hang on what one particular seed happens to build. It adds its
// number (1000 if none is given) to every seed a check asks for, so every check gets stations it has never
// seen: as it would after a new room, a new kind of loose thing or a change to how stations are planned.
// A check that passes as usual and fails like this was written against one station, not against a rule of
// the game. (tools/browser-harness.js does the adding.)
//
// The run fails (exit code 1) if any suite failed twice, or failed once with --no-second-try.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// In the order they are run: the quick and general first, the ones that need a server and several browsers last.
const SUITES = ['playthrough', 'generated-station', 'generators', 'quests', 'arrivals', 'custom-difficulty', 'locked-doors', 'creatures', 'looter', 'health', 'tripod', 'noisy-floor', 'captions',
  'loose-objects', 'apparition', 'workshop', 'players', 'together'];

// `--plan` runs nothing. It reads the names of the files a pull request changes (one a line) and prints, as JSON,
// the suites worth running for them: .github/workflows/ci.yml gives each of those a machine of its own.
//   - a file that neither the build nor any suite reads (the README, docs/, what deploys the game): none for it
//   - a suite's own file: that suite
//   - anything else: every suite. The game is one page, so a change in src/ can reach any of them.
// To see what a change would run: git diff --name-only main | node tools/run-tests.js --plan
const IS_BESIDE_THE_TESTS = /\.md$|^(docs|chart|cluster|\.idea)\/|^(deploy\.sh|Dockerfile|\.dockerignore|\.gitignore|LICENSE|\.github\/workflows\/docker\.yml)$/;
function planSuites(changedFiles) {
  const planned = [];
  for (const file of changedFiles) {
    if (IS_BESIDE_THE_TESTS.test(file)) continue;
    const ownSuite = (/^tools\/(.+)-test\.js$/.exec(file) || [])[1];
    if (SUITES.indexOf(ownSuite) < 0) return SUITES;
    planned.push(ownSuite);
  }
  return SUITES.filter(function (name) { return planned.indexOf(name) >= 0; });
}
if (process.argv.indexOf('--plan') >= 0) {
  console.log(JSON.stringify(planSuites(fs.readFileSync(0, 'utf8').split('\n').filter(Boolean))));
  process.exit(0);
}

const givenNames = process.argv.slice(2).filter(function (argument) { return argument.indexOf('--') !== 0; });
const hasSecondTry = process.argv.indexOf('--no-second-try') < 0;
const otherStationsArgument = process.argv.slice(2).filter(function (argument) { return argument.indexOf('--other-stations') === 0; })[0];
if (otherStationsArgument !== undefined) {
  const givenNumber = otherStationsArgument.indexOf('=') >= 0 ? Math.floor(Number(otherStationsArgument.split('=')[1])) : 1000;
  if (!(givenNumber > 0)) { console.error('--other-stations wants a whole number above 0, for example --other-stations=1000.'); process.exit(1); }
  process.env.TEST_OTHER_STATIONS = String(givenNumber); // the suites are started with this in their environment
  console.log('Every seed builds another station than it usually does: ' + givenNumber + ' is added to each.');
}
for (const name of givenNames) {
  if (SUITES.indexOf(name) < 0) { console.error('There is no suite called "' + name + '". The suites: ' + SUITES.join(', ') + '.'); process.exit(1); }
}
const suitesToRun = givenNames.length > 0 ? SUITES.filter(function (name) { return givenNames.indexOf(name) >= 0; }) : SUITES;

function formatSeconds(seconds) {
  const whole = Math.round(seconds);
  return whole >= 90 ? Math.floor(whole / 60) + ' min ' + (whole % 60) + ' s' : whole + ' s';
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
