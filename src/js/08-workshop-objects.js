// ---------------------------------------------------------------------------
// Loose objects made in the workshop (`npm run dev`, then "Workshop" on the title screen, then "Objects").
//
// Such an object is not written as code. It is one file in src/objects/, packed into the page by build.js,
// and holds what an entry of LOOSE_OBJECT_KINDS (08-loose-objects.js) holds: what it is called, what it
// weighs, what it is worth and how badly a knock costs it, what it sounds like, and its shape as boxes, balls, capsules, cylinders and cones. This file turns
// each of them into an ordinary kind of loose object, and puts it among a station's litter or its valuables
// if the file asks for that.
//
// What a file cannot give an object is something of its own to do (`use`): that is code, and stays in
// 08-loose-objects.js. What it can do is say that it works like a kind that has something to do, and so be a
// better make of it: a mark ("Marks", 08-loose-objects.js). Such a file has three things more:
//   worksLike  the key of the kind it works like (one that has `markNumbers`): it does what that kind does
//   mark       which mark it is, from 2: how rare it is where a station puts that kind out (TUNING.itemMarkWeights)
//   numbers    the numbers of that kind that it has its own way: { "firstAidHeals": 25 }. What it leaves out
//              is as the plain one has it, also when that is tuned later.
//
// In an object file, as in LOOSE_OBJECT_KINDS, a part's numbers are metres as the object hangs in the beam:
// x to your right, y up, z towards you.
// ---------------------------------------------------------------------------

// TWEAK: how many parts a workshop object may have, how far from its own origin a part may be (metres), and
// how thin and how thick a part may be (a radius, or half the size of a box).
const DESIGNED_OBJECT_LIMITS = { maximumParts: 16, reach: 1, minimumRadius: 0.01, maximumRadius: 0.5, minimumHalf: 0.01, maximumHalf: 0.75 };

// What an object has besides its name and its shape. `defaultValue` is used when a file leaves one out.
// (numberField and the others are in 03-workshop-rooms.js, and so is normalizeDesignedPart, which cleans up one part.)
const DESIGNED_OBJECT_FIELDS = [
  numberField('mass', 'Weight (kg). Heavier swings wider, slows you more, throws shorter, knocks louder', 2, 0.05, 40, 0.05),
  numberField('value', 'Worth, in the station\'s credits. Everything loose is worth something, however little', 10, 1, 500, 1),
  numberField('fragile', 'Fragile: how much of its worth a ruinous knock takes off (an empty can 0, a pipe 0.3, a tool case 0.7, a jar 1)', 0.4, 0, 1, 0.05),
  numberField('shattersAt', 'Shatters when hit harder than this (m/s); 0 is never. Glass leaves broken glass on the floor, anything else nothing (a sample jar: 3.4)', 0, 0, 12, 0.1),
  choiceField('material', 'What it sounds like when it hits something', 'metal',
    [['metal', 'Metal'], ['glass', 'Glass'], ['case', 'A dull box with things in it'], ['tin', 'Tin (an empty can)'], ['card', 'Cardboard']]),
  numberField('loud', 'How far its knocks carry for its weight (1 is ordinary; over 1 it shows in the warning colour)', 1, 0.3, 2.5, 0.1),
  choiceField('lies', 'How a station puts it out', 'upright', [['upright', 'Upright, as its parts are given'], ['onItsSide', 'On its side (a quarter turn over)'], ['either', 'Either']]),
  booleanField('bulky', 'Bulky: you cannot run with it', false),
  numberField('bounce', 'Bounce: how much of its speed it keeps (a glass jar 0.2, a steel pipe 0.35)', 0.25, 0, 1, 0.05),
  numberField('grip', 'Grip: low slides like a puck, high stops and tips over', 0.5, 0, 1, 0.05)
];
// Where a generated station has it lying about, and how often among its sort: 0 is never. These are the weights
// in STATION_LITTER, STATION_VALUABLES_ON_THE_FLOOR and STATION_VALUABLES_ON_A_SURFACE (a canister is 4 on the floor).
const DESIGNED_OBJECT_STATION_FIELDS = [
  numberField('asLitter', 'As litter on the floor (a cardboard box is 5)', 0, 0, 10, 1),
  numberField('onTheFloor', 'Worth carrying out, on the floor (a canister is 4)', 0, 0, 10, 1),
  numberField('onASurface', 'Worth carrying out, on a table or shelf (a jar is 5)', 0, 0, 10, 1)
];

// Returns a clean copy of an object file: everything present, in range, and of the right kind.
// A file written by hand may leave things out; whatever is missing gets its default.
function normalizeDesignedObject(source, key) {
  source = source && typeof source === 'object' ? source : {};
  const object = { key: key, label: (typeof source.label === 'string' && source.label.trim() !== '' ? source.label.trim() : key).slice(0, 40) };
  normalizeDesignedFields(object, source, DESIGNED_OBJECT_FIELDS);
  normalizeDesignedFields(object, source, DESIGNED_OBJECT_STATION_FIELDS);
  object.parts = [];
  for (const sourcePart of Array.isArray(source.parts) ? source.parts : []) {
    const part = normalizeDesignedPart(sourcePart, DESIGNED_OBJECT_LIMITS);
    if (part && object.parts.length < DESIGNED_OBJECT_LIMITS.maximumParts) object.parts.push(part);
  }
  if (object.parts.length === 0) object.parts.push(normalizeDesignedPart({ shape: 'box' }, DESIGNED_OBJECT_LIMITS));
  // A mark: only of a kind that comes in marks, and only that kind's numbers, each within what it may be set to.
  // (A file that is no mark says nothing of any of this, as every file did before there were marks.)
  const base = getMarkableKinds().indexOf(source.worksLike) >= 0 ? LOOSE_OBJECT_KINDS[source.worksLike] : null;
  if (base) {
    object.worksLike = source.worksLike;
    object.mark = Math.round(normalizeDesignedNumber(source.mark, 2, 2, TUNING.itemMarkWeights.length - 1));
    object.numbers = {};
    for (const numberKey in base.markNumbers) {
      const range = base.markNumbers[numberKey];
      const value = normalizeDesignedNumber(source.numbers && typeof source.numbers === 'object' ? source.numbers[numberKey] : undefined, NaN, range[1], range[2]);
      if (Number.isFinite(value)) object.numbers[numberKey] = Math.round(Math.round(value / range[3]) * range[3] * 10000) / 10000;
    }
  }
  return object;
}

// The kinds an object file can be a mark of: those written as code that say which of their numbers a mark may change.
function getMarkableKinds() {
  return Object.keys(LOOSE_OBJECT_KINDS).filter(function (key) { return !LOOSE_OBJECT_KINDS[key].isDesigned && Boolean(LOOSE_OBJECT_KINDS[key].markNumbers); });
}

// The LOOSE_OBJECT_KINDS entry for a workshop object.
function createDesignedObjectKind(object) {
  const kind = JSON.parse(JSON.stringify(object));
  kind.isDesigned = true;
  // A mark does what the kind it works like does, and goes where that goes.
  if (kind.worksLike) {
    const base = LOOSE_OBJECT_KINDS[kind.worksLike];
    kind.use = base.use;
    if (base.update) kind.update = base.update;
    if (base.pocket === true) kind.pocket = true;
  }
  // In a file, 0 means never; a kind that never shatters has no `shattersAt` at all.
  if (!(kind.shattersAt > 0)) delete kind.shattersAt;
  // Something thin (a plate, a wire) is stepped as if it were a shelf board thick, as the steel plate is:
  // nothing in a station is thinner than that for it to pass through, and finer steps slow everything that moves with it.
  // How thin it is, is how small the smallest ball is that it touches with: for a box half its thinnest side, for
  // a cylinder or a cone the balls in the corners of its flat ends and at its point.
  let thinnest = Infinity;
  const balls = [];
  for (const part of kind.parts) addShellBallsForPart(part, balls);
  for (const ball of balls) thinnest = Math.min(thinnest, ball[3]);
  if (thinnest < 0.025) kind.stepRadius = 0.025;
  return kind;
}

// The objects from src/objects/, cleaned up, by key.
const designedObjects = {};
for (const key in DESIGNED_OBJECTS) {
  if (LOOSE_OBJECT_KINDS[key]) continue; // a file may not take the place of a kind that is written as code
  designedObjects[key] = normalizeDesignedObject(DESIGNED_OBJECTS[key], key);
  const kind = LOOSE_OBJECT_KINDS[key] = createDesignedObjectKind(designedObjects[key]);
  if (kind.asLitter > 0) STATION_LITTER.push([key, kind.asLitter]);
  if (kind.onTheFloor > 0) STATION_VALUABLES_ON_THE_FLOOR.push([key, kind.onTheFloor]);
  if (kind.onASurface > 0) STATION_VALUABLES_ON_A_SURFACE.push([key, kind.onASurface]);
  if (kind.worksLike) (LOOSE_OBJECT_MARKS[kind.worksLike] = LOOSE_OBJECT_MARKS[kind.worksLike] || []).push([key, kind.mark]);
}
