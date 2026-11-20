// ---------------------------------------------------------------------------
// Creatures made in the workshop (`npm run dev`, then "Workshop" on the title screen, then "Creatures").
//
// Such a creature is not written as code. It is one file in src/creatures/, packed into the page by build.js,
// and holds a body: which skeleton it is put together by, the skeleton's proportions, which of the skeleton's
// own capsules are left out, and the shapes that are fixed to its bones instead of them or besides them: boxes,
// balls, capsules, cylinders and cones, the same basic forms a loose object is made of. This file turns each of
// them into an ordinary entry of FIGURE_KINDS (04-figures.js), so createFigureOfKind('<file name>') makes one.
//
// What a file cannot give a creature is something to do: that is code, the way the Hollow and the Stills are
// code in 08-entities.js. A creature that nothing in the game makes is in no station; it is kept, and stands in
// the workshop.
//
// A body a player can wear is such a file too (`playerSkin`): a person's skeleton that is made as tall as a
// player is, with the scanner in its hand, posed by the game the way it poses a player (11-together.js).
// getPlayerBodyKinds lists them.
//
// In a creature file, a part's numbers are metres in the directions of the bone it is on, as the creature
// stands at rest: x to its right, y up, z the way it faces, from where the bone starts (FIGURE_SKELETONS in
// 04-figures.js says which bones there are and how each is held).
// ---------------------------------------------------------------------------

// TWEAK: how far from its bone a shape may be (metres), and how thin and how thick a shape may be (a radius, or
// half the size of a box). How many shapes a creature may have is FIGURE_MAXIMUM_PARTS in 04-figures.js.
const DESIGNED_CREATURE_LIMITS = { reach: 1.5, minimumRadius: 0.005, maximumRadius: 0.6, minimumHalf: 0.005, maximumHalf: 0.8 };
// ... and how long a bone may be and how thick, in a creature's proportions.
const DESIGNED_PROPORTION_LIMITS = { maximumLength: 3, minimumRadius: 0.005, maximumRadius: 1 };

// What a scan makes of it: the colour its points have, and how long they stay. `color` is what the workshop
// and debug mode draw it in.
const DESIGNED_CREATURE_SCANS = {
  still: { label: 'As a Still does', surfaceClass: SURFACE_STILL, imprintTuningKey: 'stillImprintSeconds', color: FIGURE_KINDS.dummy.color },
  hollow: { label: 'As the Hollow does', surfaceClass: SURFACE_HOLLOW, imprintTuningKey: 'hollowImprintSeconds', color: FIGURE_KINDS.hollow.color },
  player: { label: 'As a player does', surfaceClass: SURFACE_PLAYER, imprintTuningKey: 'playerImprintSeconds', color: FIGURE_KINDS.player.color },
  plain: { label: 'As walls and crates do (like something that was never there)', surfaceClass: SURFACE_PROP, imprintTuningKey: 'phantomImprintSeconds', color: [0.72, 0.62, 0.95] }
};

// What a creature has besides its name, its proportions and its shapes. `defaultValue` is used when a file
// leaves one out. (numberField and the others are in 03-workshop-rooms.js.)
const DESIGNED_CREATURE_FIELDS = [
  choiceField('skeleton', 'Skeleton: what it is put together by, and so how it stands and moves', 'person',
    Object.keys(FIGURE_SKELETONS).map(function (key) { return [key, FIGURE_SKELETONS[key].label]; })),
  choiceField('scansAs', 'What a scan makes of it: the colour of its points and how long they stay', 'still',
    Object.keys(DESIGNED_CREATURE_SCANS).map(function (key) { return [key, DESIGNED_CREATURE_SCANS[key].label]; })),
  booleanField('playerSkin', 'A body a player can wear: made as tall as a player is, with the scanner in its hand (a person\'s skeleton only)', false)
];

// The proportions a new creature of this skeleton starts from, and the list of numbers its proportions have.
function getDesignedProportionsTemplate(skeleton, isPlayerSkin) {
  if (skeleton === 'hollow') return FIGURE_PROPORTIONS_HOLLOW;
  return isPlayerSkin ? FIGURE_PROPORTIONS_PLAYER : FIGURE_PROPORTIONS_DUMMY;
}

// Returns a clean copy of a creature file: everything present, in range, and of the right kind.
// A file written by hand may leave things out; whatever is missing gets its default.
function normalizeDesignedCreature(source, key) {
  source = source && typeof source === 'object' ? source : {};
  const creature = { key: key, label: (typeof source.label === 'string' && source.label.trim() !== '' ? source.label.trim() : key).slice(0, 40) };
  normalizeDesignedFields(creature, source, DESIGNED_CREATURE_FIELDS);
  if (creature.skeleton !== 'person') creature.playerSkin = false;
  const bones = FIGURE_SKELETONS[creature.skeleton].bones;

  // Every number the skeleton's proportions have, and no others.
  const template = getDesignedProportionsTemplate(creature.skeleton, creature.playerSkin);
  const given = source.proportions && typeof source.proportions === 'object' ? source.proportions : {};
  const limits = DESIGNED_PROPORTION_LIMITS;
  const clean = function (proportionKey, value, fallback) {
    const isThickness = /Radius$/.test(proportionKey);
    return Math.round(normalizeDesignedNumber(value, fallback, isThickness ? limits.minimumRadius : 0, isThickness ? limits.maximumRadius : limits.maximumLength) * 10000) / 10000;
  };
  creature.proportions = {};
  for (const proportionKey in template) {
    const fallback = template[proportionKey];
    if (typeof fallback === 'number') creature.proportions[proportionKey] = clean(proportionKey, given[proportionKey], fallback);
    else if (Array.isArray(fallback)) {
      creature.proportions[proportionKey] = fallback.map(function (entry, index) {
        return clean(proportionKey, Array.isArray(given[proportionKey]) ? given[proportionKey][index] : undefined, entry);
      });
    }
  }

  // Bones whose own capsule is left out: in the skeleton's order, each once.
  const hidden = Array.isArray(source.hides) ? source.hides : [];
  creature.hides = Object.keys(bones).filter(function (bone) { return hidden.indexOf(bone) >= 0; });

  creature.parts = [];
  for (const sourcePart of Array.isArray(source.parts) ? source.parts : []) {
    const part = normalizeDesignedPart(sourcePart, DESIGNED_CREATURE_LIMITS);
    // (A shape on a bone this skeleton does not have is dropped: there is nowhere to put it.)
    if (!part || !bones[sourcePart.bone] || creature.parts.length >= FIGURE_MAXIMUM_PARTS) continue;
    creature.parts.push(Object.assign({ bone: sourcePart.bone, mirror: sourcePart.mirror === true }, part));
  }
  return creature;
}

// The FIGURE_KINDS entry for a workshop creature.
function createDesignedCreatureKind(creature) {
  const scan = DESIGNED_CREATURE_SCANS[creature.playerSkin ? 'player' : creature.scansAs];
  const proportions = JSON.parse(JSON.stringify(creature.proportions));
  proportions.kind = creature.key;
  const kind = {
    label: creature.label, proportions: proportions, proportionsName: '', bodyPlan: creature.skeleton,
    surfaceClass: scan.surfaceClass, imprintTuningKey: scan.imprintTuningKey, color: scan.color,
    isDesigned: true, shape: prepareFigureShape(creature.skeleton, creature.hides, creature.parts)
  };
  if (creature.playerSkin) {
    // What makes a body a player's (see FIGURE_KINDS.player): the scanner, and being as tall as the game has you be.
    kind.isPlayerSkin = true;
    kind.holdsScanner = true;
    kind.heightTuningKey = 'playerHeight';
    kind.crouchHeightTuningKey = 'playerHeightCrouching';
  }
  return kind;
}

// The creatures from src/creatures/, cleaned up, by key.
const designedCreatures = {};
for (const key in DESIGNED_CREATURES) {
  if (FIGURE_KINDS[key]) continue; // a file may not take the place of a kind that is written as code
  designedCreatures[key] = normalizeDesignedCreature(DESIGNED_CREATURES[key], key);
  FIGURE_KINDS[key] = createDesignedCreatureKind(designedCreatures[key]);
}

// Every body a player can be given: the one written as code first, then the ones made in the workshop.
// (Nothing chooses between them yet: createFigureOfKind('player') is what 11-together.js makes. To let players
// choose, make their figures with createFigureOfKind(<one of these>) and tell the others which.)
// (Not the working copy the workshop has open: that is nobody's body until it is saved.)
function getPlayerBodyKinds() {
  return Object.keys(FIGURE_KINDS).filter(function (key) { return FIGURE_KINDS[key].holdsScanner === true && FIGURE_KINDS[key].isWorkingCopy !== true; });
}
