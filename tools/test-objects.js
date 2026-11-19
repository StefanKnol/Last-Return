// Loose objects that belong to the tests, not to the game.
//
// The game's own loose objects are the game's to change: what a tool case weighs, what a jar is worth, and the
// gas canister, the crate to carry things in and the fire extinguisher are files in src/objects/ that the
// workshop writes. A check that is about a rule ("something heavy on the floor stops you", "what lies in a crate
// is carried with it") must not fail because one of those was reshaped. So such a check brings its own object,
// from this table: it has the shape and the weight the check needs, and nobody changes it but the check's author.
//
// (This happened: a check put the game's gas canister into a crate and waited for it to come to rest. The
// canister was made a rod with round ends in the workshop, rolled about in the crate, and a check about playing
// together failed.)
//
// A check that is about one of the game's own objects (an empty can is kicked as far as broken glass carries,
// a vent's cover is bigger than the vent) names that object, and reads its numbers from the game while it runs.
//
// Each entry holds what an entry of LOOSE_OBJECT_KINDS in src/js/08-loose-objects.js holds. A part's numbers are
// metres as the object hangs in the beam: x to your right, y up, z towards you.
const TEST_OBJECT_KINDS = {
  // An open crate of five thin boards, half a metre square and 40 cm high, light enough to carry with things in it.
  testCrate: {
    label: 'test crate', mass: 3, value: 10, fragile: 0.1, material: 'case', loud: 0.6, lies: 'upright', bulky: true, bounce: 0.15, grip: 0.6,
    parts: [{ shape: 'box', center: [0.25, 0, 0], half: [0.02, 0.2, 0.25] }, { shape: 'box', center: [-0.25, 0, 0], half: [0.02, 0.2, 0.25] },
      { shape: 'box', center: [0, 0, 0.25], half: [0.25, 0.2, 0.02] }, { shape: 'box', center: [0, 0, -0.25], half: [0.25, 0.2, 0.02] },
      { shape: 'box', center: [0, -0.2, 0], half: [0.25, 0.02, 0.25] }]
  },
  // A block of three kilograms that lies where it is put: nothing round about it, so it does not roll.
  testWeight: {
    label: 'test weight', mass: 3, value: 5, fragile: 0, material: 'metal', loud: 0.8, lies: 'upright', bulky: false, bounce: 0.1, grip: 0.7,
    parts: [{ shape: 'box', center: [0, 0, 0], half: [0.09, 0.07, 0.09] }]
  },
  // A small light block, a third of a kilogram: two of them go into the crate with the test weight in
  // together-test.js. (They used to be two of the game's empty cans, whose shape and weight are the game's to change.)
  testSmallBlock: {
    label: 'test small block', mass: 0.3, value: 2, fragile: 0, material: 'metal', loud: 0.8, lies: 'upright', bulky: false, bounce: 0.15, grip: 0.6,
    parts: [{ shape: 'box', center: [0, 0, 0], half: [0.04, 0.05, 0.04] }]
  },
  // A block too heavy to shove. What it weighs is not written here: it is as heavy as the game says stops you
  // (`looseShoveBlockMass` in src/js/00-config.js), read from the game when the block is put into it. Retune that
  // limit and this is still the lightest thing that stops you. (It used to be the game's pump motor, which is as
  // heavy as the game makes it.)
  testHeavyBlock: {
    label: 'test heavy block', massIsTheGamesSetting: 'looseShoveBlockMass', value: 5, fragile: 0, material: 'metal', loud: 1, lies: 'upright', bulky: true, bounce: 0.1, grip: 0.7,
    parts: [{ shape: 'box', center: [0, 0, 0], half: [0.2, 0.2, 0.2] }]
  },
  // The ones below are the stand-ins of loose-objects-test.js, each made the way the game's own thing of its sort
  // was made when that suite's checks were written, so that the checks' numbers still hold for them.
  //
  // A rod with round ends, 40 cm long and 14 across, of three kilograms: on its side it rolls. Light enough for the
  // Hollow to go after once it has kicked it, too heavy for it to throw back.
  testCapsule: {
    label: 'test capsule', mass: 3, value: 25, fragile: 0.5, material: 'metal', loud: 1, lies: 'either', bulky: false, bounce: 0.3, grip: 0.5,
    parts: [{ shape: 'capsule', from: [0, -0.13, 0], to: [0, 0.13, 0], radius: 0.07 }]
  },
  // A small glass jar, light, that shatters when it is let go of standing up (it lands at about 4.5 m/s).
  testJar: {
    label: 'test jar', mass: 0.8, value: 60, fragile: 1, shattersAt: 3.4, material: 'glass', loud: 1, lies: 'upright', bulky: false, bounce: 0.2, grip: 0.45,
    parts: [{ shape: 'capsule', from: [0, -0.05, 0], to: [0, 0.05, 0], radius: 0.06 }]
  },
  // A flat case of six kilograms, 42 by 30 by 16 cm, that a knock costs a good part of what it is worth.
  testCase: {
    label: 'test case', mass: 6, value: 80, fragile: 0.7, material: 'case', loud: 1, lies: 'onItsSide', bulky: false, bounce: 0.15, grip: 0.6,
    parts: [{ shape: 'box', center: [0, 0, 0], half: [0.21, 0.15, 0.08] }]
  },
  // A thin rod of four kilograms, 1.2 m long: it hangs across the beam, and is wider than a doorway or a vent (a metre).
  testRod: {
    label: 'test rod', mass: 4, value: 15, fragile: 0.3, material: 'metal', loud: 1, lies: 'upright', bulky: false, bounce: 0.35, grip: 0.4,
    parts: [{ shape: 'capsule', from: [-0.6, 0, 0], to: [0.6, 0, 0], radius: 0.03 }]
  },
  // A closed box of twelve kilograms, 50 by 44 by 44 cm: you cannot run with it.
  testBox: {
    label: 'test box', mass: 12, value: 40, fragile: 0.6, material: 'case', loud: 1, lies: 'upright', bulky: true, bounce: 0.12, grip: 0.7,
    parts: [{ shape: 'box', center: [0, 0, 0], half: [0.25, 0.22, 0.22] }]
  },
  // Eighteen kilograms of motor on a foot: too heavy to kick along, and you cannot run with it.
  testMotor: {
    label: 'test motor', mass: 18, value: 150, fragile: 0.6, material: 'metal', loud: 1, lies: 'upright', bulky: true, bounce: 0.1, grip: 0.65,
    parts: [
      { shape: 'capsule', from: [-0.12, 0, 0], to: [0.12, 0, 0], radius: 0.13 },
      { shape: 'capsule', from: [0.12, 0, 0], to: [0.3, 0, 0], radius: 0.035 },
      { shape: 'box', center: [-0.02, -0.14, 0], half: [0.16, 0.025, 0.13] }
    ]
  },
  // A small tin, 13 cm tall and 7 across, of 60 grams: light enough for the Hollow to throw back at you.
  testTin: {
    label: 'test tin', mass: 0.06, value: 3, fragile: 0.3, material: 'tin', loud: 1.7, lies: 'either', bulky: false, bounce: 0.35, grip: 0.4,
    stepRadius: 0.035,
    parts: [{ shape: 'cylinder', from: [0, -0.065, 0], to: [0, 0.065, 0], radius: 0.035 }]
  },
  // A drum and a cone, so that what is checked of every kind is checked of a cylinder and of a cone as well, and a
  // ball made to bounce.
  testDrum: {
    label: 'test drum', mass: 5, value: 10, fragile: 0.3, material: 'metal', loud: 1, lies: 'either', bulky: false, bounce: 0.25, grip: 0.5,
    parts: [{ shape: 'cylinder', from: [0, -0.15, 0], to: [0, 0.15, 0], radius: 0.12 }]
  },
  testCone: {
    label: 'test cone', mass: 2.5, value: 10, fragile: 0.3, material: 'case', loud: 1, lies: 'either', bulky: false, bounce: 0.2, grip: 0.6,
    parts: [{ shape: 'cone', from: [0, -0.15, 0], to: [0, 0.3, 0], radius: 0.15 }]
  },
  testBall: {
    label: 'test ball', mass: 1.5, value: 8, fragile: 0, material: 'card', loud: 1, lies: 'either', bulky: false, bounce: 0.95, grip: 0.25,
    parts: [{ shape: 'ball', center: [0, 0, 0], radius: 0.25 }]
  }
};

// Runs in the page: makes the given kinds known to the game, each as a fresh copy (the game writes what it has
// worked out about a kind into the kind itself). A kind that is already there is put back as it is written here.
// A kind that names one of the game's settings as its weight (`massIsTheGamesSetting`) is given that weight here.
function putTestObjectKindsIntoTheGame(kinds) {
  const table = window.lastReturnDebug.looseObjectKinds, tuning = window.lastReturnDebug.tuning;
  for (const kindKey of Object.keys(kinds)) {
    const kind = JSON.parse(JSON.stringify(kinds[kindKey]));
    if (kind.massIsTheGamesSetting) kind.mass = tuning[kind.massIsTheGamesSetting];
    table[kindKey] = kind;
  }
}

// Runs in the page: takes the given kinds out again, so that a check which goes over "every kind there is" goes
// over the game's own and no others. (An object of such a kind that still lies about keeps working: it holds its kind itself.)
function takeTestObjectKindsOutOfTheGame(kindKeys) {
  const table = window.lastReturnDebug.looseObjectKinds;
  for (const kindKey of kindKeys) delete table[kindKey];
}

// The entries of the table with these keys (all of them if no keys are given), as one object.
function pickTestObjectKinds(kindKeys) {
  const picked = {};
  for (const kindKey of kindKeys || Object.keys(TEST_OBJECT_KINDS)) {
    if (!TEST_OBJECT_KINDS[kindKey]) throw new Error('There is no test object called "' + kindKey + '" in tools/test-objects.js.');
    picked[kindKey] = TEST_OBJECT_KINDS[kindKey];
  }
  return picked;
}

// Makes test objects known to the game in one page: `await installTestObjectKinds(page)` for all of them, or
// `await installTestObjectKinds(page, ['testCrate', 'testWeight'])` for some. After that
// `window.lastReturnDebug.createLooseObject('testCrate', x, y, z, yaw)` makes one. A page that is loaded again
// has forgotten them.
async function installTestObjectKinds(page, kindKeys) {
  await page.evaluate(putTestObjectKindsIntoTheGame, pickTestObjectKinds(kindKeys));
}

// Takes them out again (all of them, or the ones named).
async function removeTestObjectKinds(page, kindKeys) {
  await page.evaluate(takeTestObjectKindsOutOfTheGame, Object.keys(pickTestObjectKinds(kindKeys)));
}

module.exports = { TEST_OBJECT_KINDS, installTestObjectKinds, removeTestObjectKinds, putTestObjectKindsIntoTheGame, takeTestObjectKindsOutOfTheGame };
