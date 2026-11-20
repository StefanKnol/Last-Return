// ---------------------------------------------------------------------------
// Arrivals: when what lives down there comes for you.
//
// It used to come when Generator 2 was started, and not before. So everything you can do without power you
// could do in peace, and on a work order that asks for little else (Salvage, with a bay near the lift) there
// was nothing to be afraid of for most of the descent.
//
// Now it comes in its own time. From the moment you step out of the lift a wait runs down:
//   - with nothing making a sound, a number of seconds drawn afresh for every descent
//     (TUNING.hollowArrivalQuietSeconds), so you never know how long you have;
//   - every noise louder than a walking step takes time off it, by how far it carries
//     (TUNING.arrivalSecondsPerNoiseMetre): a door, a knock, a running step, a full sweep, fuel going into a
//     tank. Any noise, whoever or whatever made it. Walk and paint quietly and it costs you nothing.
// When the wait is over it wakes, at the shaft, as it always did. Woken by a noise it comes to look at where
// that noise was; woken by nothing in particular it starts to roam.
// Starting Generator 2 still wakes it if it is asleep by then, a few seconds after, and it comes to the generator.
//
// Before the mains is on the powered doors are shut to it, so it comes through the crawlspace above the
// ceilings, and out of a hatch in the part of the station you can reach (08-crawlspace.js).
//
// Where this holds: in every generated station, on a threat level that has the Hollow and lets it come by
// itself (`arrivalFactor` above 0; see DIFFICULTY_PRESETS in 00-config.js). Kessel-9 is the descent as it was
// written, and there it comes with the mains and no sooner.
//
// This file is about arriving and nothing else, and it is written for more than one creature: what it needs to
// know of one is in CREATURE_ARRIVALS below. The Hollow is the only entry, because it is the only creature that
// arrives; the Stills are in their room from the start, and the apparitions are not there at all.
// Down there with others the wait is the host's game's to keep, like everything else that walks: an arrival is
// done to the station ('arrive'), decided by the host and carried out in every browser.
// ---------------------------------------------------------------------------

// What can arrive.
//   key            its name, in this file, the tests and debug mode
//   isWanted       is it to come at all in this descent?
//   isHere         has it arrived (by whatever way)?
//   quietSeconds   [fewest, most]: how long it waits if nothing makes a sound, before the threat level's say
//   arrive         function (cause): puts it into the station. `cause` is 'time', 'noise' or 'mains'.
const CREATURE_ARRIVALS = [
  {
    key: 'hollow',
    isWanted: function () { return game.difficulty.hollowEnabled; },
    isHere: function () { return hollow.isActive; },
    quietSeconds: function () { return TUNING.hollowArrivalQuietSeconds; },
    arrive: function (cause) {
      activateHollow(HOLLOW_SPAWN_POSITION.x, HOLLOW_SPAWN_POSITION.z, 3);
      if (cause === 'mains') {
        hollow.state = HOLLOW_STATE_INVESTIGATE;
        hollow.targetX = level.generatorApproachX; hollow.targetZ = level.generatorApproachZ;
      } else if (cause === 'noise') {
        hollow.state = HOLLOW_STATE_INVESTIGATE;
        hollow.targetX = arrivals.noiseX; hollow.targetZ = arrivals.noiseZ;
      } // ('time': it roams, and the director brings it nearer in its own time)
    }
  }
];

// How the wait stands, for each creature that arrives, by its key: see resetArrivals for what is in one.
// And where the last noise that counted was made.
const arrivals = { waits: {}, noiseX: 0, noiseZ: 0 };

// Does anything come by itself in this descent, or only when the mains comes on?
function doCreaturesArriveByThemselves() {
  if (debugState.areArrivalsHeld || debugState.options.holdArrivals) return false; // (the tests, and a switch in debug mode)
  return level.kind === 'generated' && game.difficulty.arrivalFactor > 0;
}

// A new descent: nothing has arrived, and how long each will wait in silence is drawn afresh.
function resetArrivals() {
  arrivals.waits = {};
  for (const creature of CREATURE_ARRIVALS) {
    const range = creature.quietSeconds(), factor = Math.max(0.01, game.difficulty.arrivalFactor || 1);
    arrivals.waits[creature.key] = {
      quietSeconds: (range[0] + (range[1] - range[0]) * Math.random()) / factor, // how long it waits if nothing makes a sound
      goneBy: 0,          // how much of that is over: the seconds since you left the lift, and what noise has taken off
      takenByNoise: 0,    // ... of which by noise
      isDue: '',          // the wait is over, and why ('time' or 'noise'): it arrives at the next turn of the station
      hasArrived: false,  // it has come in this descent (it comes once)
      cause: ''           // and what brought it: 'time', 'noise' or 'mains'
    };
  }
}

function findCreatureArrival(key) {
  for (const creature of CREATURE_ARRIVALS) if (creature.key === key) return creature;
  return null;
}

// Is this one still waiting, with a wait that runs by itself?
function isCreatureStillToCome(creature) {
  const wait = arrivals.waits[creature.key];
  return Boolean(wait) && !wait.hasArrived && !creature.isHere() && creature.isWanted() && doCreaturesArriveByThemselves() && game.flags.hasLeftLift;
}

// Every frame of the station (11-game.js), where the station is yours to run: time goes by, and whatever is due arrives.
function updateArrivals(dt) {
  for (const creature of CREATURE_ARRIVALS) {
    if (!isCreatureStillToCome(creature)) continue;
    const wait = arrivals.waits[creature.key];
    wait.goneBy += dt;
    if (wait.isDue === '' && wait.goneBy >= wait.quietSeconds) wait.isDue = 'time';
    if (wait.isDue !== '') askToAct({ what: 'arrive', key: creature.key, cause: wait.isDue });
  }
}

// A noise was made somewhere in the station (hearNoise, 08-creatures.js): it takes time off every wait. `radius`
// is how far it carries as it was made, before anybody's hearing has a say.
// (It only notes that a wait is over. The arriving is done at the next turn of the station, and not in the
// middle of whatever made the noise.)
function noteNoiseForArrivals(x, z, radius) {
  const carriesBeyondAStep = radius - TUNING.arrivalQuietNoiseRadius;
  if (carriesBeyondAStep <= 0 || debugState.options.freezeCreatures) return;
  for (const creature of CREATURE_ARRIVALS) {
    if (!isCreatureStillToCome(creature)) continue;
    const wait = arrivals.waits[creature.key], seconds = carriesBeyondAStep * TUNING.arrivalSecondsPerNoiseMetre;
    wait.goneBy += seconds; wait.takenByNoise += seconds;
    arrivals.noiseX = x; arrivals.noiseZ = z;
    if (wait.isDue === '' && wait.goneBy >= wait.quietSeconds) wait.isDue = 'noise';
  }
}

// The mains has come on (startGenerator, 11-game.js, a few seconds after): whatever is still asleep wakes.
function letCreaturesArriveWithTheMains() {
  if (isWorldTheHosts()) return; // the host's game says so
  for (const creature of CREATURE_ARRIVALS) {
    if (creature.isWanted() && !creature.isHere()) askToAct({ what: 'arrive', key: creature.key, cause: 'mains' });
  }
}

// It arrives ('arrive': done in every browser down there, in the host's order). The creature itself is put into
// the station where the station is run; everybody hears what Dispatch makes of it.
function performArrival(action) {
  const creature = findCreatureArrival(action.key), wait = arrivals.waits[action.key];
  if (!creature || !wait) return;
  const wasHere = creature.isHere();
  wait.hasArrived = true; wait.isDue = ''; wait.cause = action.cause;
  if (!isWorldTheHosts() && !wasHere && creature.isWanted()) creature.arrive(action.cause);
  // (With the mains, Dispatch's line about the generator covers it: DISPATCH_CUES, 'mainsOn'.)
  if (action.cause !== 'mains' && !wasHere) fireGameEvent(creature.key + 'Arrives');
}

// For the debug readout and the tests: how long until it comes if nothing more makes a sound, or -1 if it is
// not waiting (it is here, it is not coming, or it only comes with the mains).
function getSecondsUntilArrival(key) {
  const creature = findCreatureArrival(key), wait = arrivals.waits[key];
  if (!creature || !wait || wait.hasArrived || creature.isHere() || !creature.isWanted() || !doCreaturesArriveByThemselves()) return -1;
  return Math.max(0, wait.quietSeconds - wait.goneBy);
}
