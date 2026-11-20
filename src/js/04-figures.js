// ---------------------------------------------------------------------------
// Figures: bodies built from capsules (a capsule is a rod with rounded ends).
// They are never drawn. The only trace of one is the points a scan leaves on it,
// frozen where it stood at that moment. Stop scanning and there is nothing to see.
//
// A body is a skeleton with shapes on it. The skeleton is one of the body plans below: it says where the joints
// are for a pose, and puts a capsule on every bone. That is all the Hollow, a Still and a player are made of.
// A creature made in the workshop (04-workshop-creatures.js) can have more: boxes, balls, capsules, cylinders
// and cones fixed to its bones, which turn with them, and any of the skeleton's own capsules left out.
// ---------------------------------------------------------------------------

const FIGURE_MAXIMUM_BONES = 26;   // the most capsules a skeleton puts on its own bones
const FIGURE_MAXIMUM_PARTS = 24;   // TWEAK: how many shapes a creature may have fixed to its bones. Each may have a mirror image.
const FIGURE_MAXIMUM_CAPSULES = FIGURE_MAXIMUM_BONES + FIGURE_MAXIMUM_PARTS * 2;
const FIGURE_CAPSULE_STRIDE = 7; // startX, startY, startZ, endX, endY, endZ, radius
// Shapes fixed to bones that are not capsules: a rod with flat ends (a cylinder, or a cone if it comes to a
// point), and a box that lies any way.
const FIGURE_ROD_STRIDE = 8;     // fromX, fromY, fromZ, toX, toY, toZ, radius at `from`, radius at `to`
const FIGURE_BOX_STRIDE = 15;    // centre (3), which way its own x, y and z point (3 each), half its size along each (3)

// TWEAK: body shapes, in metres. Lengths are bone lengths, radii are how thick each part is.
// The Hollow: a hunched thing with a long neck, a hanging jaw, arms that reach its knees and three long
// fingers on each hand. Standing hunched it is about 2.2 m tall; when it straightens up to listen, about 2.5 m.
const FIGURE_PROPORTIONS_HOLLOW = {
  kind: 'hollow',
  thigh: 0.749, shin: 0.824, footLength: 0.275, hipWidth: 0.295,
  lowerSpine: 0.396, upperSpine: 0.472, shoulderWidth: 0.28,
  neckLength: 0.332, headLength: 0.175, headRadius: 0.105, jawLength: 0.175,
  upperArm: 0.624, foreArm: 0.56, handLength: 0.09,
  fingerLengths: [0.195, 0.239, 0.239],   // outer, middle, inner finger
  torsoRadius: 0.09, limbRadius: 0.04, footRadius: 0.06, legRadius: 0.09, fingerRadius: 0.005
};

// The calibration dummy: an ordinary jointed shop mannequin, about 1.75 m tall.
const FIGURE_PROPORTIONS_DUMMY = {
  kind: 'dummy',
  torsoLength: 0.585, neckLength: 0.11, headRadius: 0.11, headLength: 0.05,
  shoulderWidth: 0.42, hipWidth: 0.205, upperArm: 0.31, foreArm: 0.285, handLength: 0.11,
  thigh: 0.575, shin: 0.45, footLength: 0.15, footRadius: 0.045, torsoRadius: 0.145, limbRadius: 0.04, legRadius: 0.065, jointRadius: 0.06
};

// Player model
const FIGURE_PROPORTIONS_PLAYER = {
  kind: 'player',
  torsoLength: 0.255, neckLength: 0.15, headRadius: 0.135, headLength: 0,
  shoulderWidth: 0.465, hipWidth: 0.265, upperArm: 0.14, foreArm: 0.125, handLength: 0.045,
  thigh: 0.23, shin: 0.12, footLength: 0.15, footRadius: 0.05, torsoRadius: 0.175, limbRadius: 0.055, legRadius: 0.08, jointRadius: 0.085
};

// ---------------------------------------------------------------------------
// The kinds of creature
//
// Everything that has a body is one entry here. To add a creature:
//   1. give it proportions: an object like the three above, with its own `kind`;
//   2. add an entry below under that same name.
// That is all it takes for it to have a body: createFigureOfKind('yourKind') makes one, and the workshop's
// creature tool lists it by itself, with a slider for every number, "Posed by hand", and "Write to file".
// Or make it in the workshop ("New creature"): such a creature is a file in src/creatures/, and joins this
// list when the page loads (04-workshop-creatures.js). It can have more than capsules on its bones.
// What it does in a station is not said here: that is code, the way the Hollow and the Stills are code in
// 08-entities.js and the other players in 11-together.js.
//
//   label             what the workshop calls it
//   proportions       its numbers, and `proportionsName`, what that object is called in this file (the workshop
//                     writes changed numbers back under that name)
//   bodyPlan          its skeleton: how the proportions are put together as capsules. 'person' (upright, two arms,
//                     two legs, a ball at every joint: a Still, a player) or 'hollow' (hunched, long neck, jaw,
//                     three fingers). A body of another make is a function like buildPersonCapsules, added to
//                     FIGURE_BODY_PLANS, and its bones in FIGURE_SKELETONS.
//   shape             (only creatures made in the workshop) what is fixed to its bones and which of the skeleton's
//                     own capsules are left out: see prepareFigureShape.
//   surfaceClass      the colour a scan gives it (02-world.js), and `imprintTuningKey`, the number in 00-config.js
//                     that says how long points left on it stay
//   color             what the workshop and debug mode draw it in: red, green, blue, each 0 to 1
//   holdsScanner      a 'person' with a scanner in its right hand (a player)
//   heightTuningKey   a kind that is as tall as that number in 00-config.js says, whatever its proportions come
//                     to: see getFigureBody. A player has it: how tall you are is said once, as `playerHeight`,
//                     and that is what you bump your head at, what you see from, and how tall the others see you.
//   crouchHeightTuningKey  ... and the number that says how tall it is crouched (getPlayerCrouchPose). Only named
//                     here so that the workshop can put a slider on it beside the other.
// ---------------------------------------------------------------------------

const FIGURE_BODY_PLANS = { hollow: buildHollowCapsules, person: buildPersonCapsules };

// The bones of each skeleton: every capsule a body plan puts down has a name, and that is what a shape is fixed
// to and what is left out. `rest` is which way a bone points when the creature stands straight with its arms
// hanging: up, down, forward (a foot), across (the bar between the shoulders or the hips, from its left to its
// right), or none (a joint: a ball).
// A shape on a bone is given in the bone's own directions, in metres from where the bone starts (from the
// middle of a bar): x, y and z. Standing straight these are the creature's own: x to its right, y up, z the way
// it faces. So a shape is put where it should be on a body that stands at rest, and when the bone turns (a knee
// bends, a head tilts) the shape turns with it. See computeFigureBoneFrame.
function listFigureBones(centreBones, sideBones) {
  const bones = {};
  for (const bone of centreBones) bones[bone[0]] = { label: bone[1], rest: bone[2], partner: '' };
  for (const side of ['Left', 'Right']) {
    for (const bone of sideBones) {
      bones[bone[0] + side] = { label: side.toLowerCase() + ' ' + bone[1], rest: bone[2], partner: bone[0] + (side === 'Left' ? 'Right' : 'Left') };
    }
  }
  return bones;
}
const FIGURE_SKELETONS = {
  person: {
    label: 'A person: upright, two arms, two legs, a ball at every joint',
    bones: listFigureBones(
      [['belly', 'belly', 'up'], ['chest', 'chest', 'up'], ['neck', 'neck', 'up'], ['head', 'head', 'up'],
        ['shoulders', 'shoulders (the bar between them)', 'across'], ['hips', 'hips (the bar between them)', 'across']],
      [['upperArm', 'upper arm', 'down'], ['foreArm', 'forearm', 'down'], ['hand', 'hand', 'down'],
        ['shoulderJoint', 'shoulder (the ball)', 'none'], ['elbowJoint', 'elbow (the ball)', 'none'],
        ['thigh', 'thigh', 'down'], ['shin', 'shin', 'down'], ['foot', 'foot', 'forward'], ['kneeJoint', 'knee (the ball)', 'none']])
  },
  hollow: {
    label: 'The Hollow\'s: hunched, a long neck, a hanging jaw, three long fingers',
    bones: listFigureBones(
      [['lowerBack', 'lower back', 'up'], ['upperBack', 'upper back', 'up'], ['neck', 'neck', 'up'], ['head', 'head', 'up'], ['jaw', 'jaw', 'down'],
        ['shoulders', 'shoulders (the bar between them)', 'across'], ['hips', 'hips (the bar between them)', 'across']],
      [['upperArm', 'upper arm', 'down'], ['foreArm', 'forearm', 'down'], ['hand', 'hand', 'down'],
        ['fingerOuter', 'outer finger', 'down'], ['fingerMiddle', 'middle finger', 'down'], ['fingerInner', 'inner finger', 'down'],
        ['thigh', 'thigh', 'down'], ['shin', 'shin', 'down'], ['foot', 'foot', 'forward']])
  }
};

const FIGURE_KINDS = {
  hollow: { label: 'The Hollow', proportions: FIGURE_PROPORTIONS_HOLLOW, proportionsName: 'FIGURE_PROPORTIONS_HOLLOW', bodyPlan: 'hollow',
    surfaceClass: SURFACE_HOLLOW, imprintTuningKey: 'hollowImprintSeconds', color: [1.0, 0.5, 0.42] },
  dummy: { label: 'A Still (calibration dummy)', proportions: FIGURE_PROPORTIONS_DUMMY, proportionsName: 'FIGURE_PROPORTIONS_DUMMY', bodyPlan: 'person',
    surfaceClass: SURFACE_STILL, imprintTuningKey: 'stillImprintSeconds', color: [1.0, 0.8, 0.42] },
  // The body the others see of a player (11-together.js). Nobody sees their own.
  player: { label: 'A player (as the others see one)', proportions: FIGURE_PROPORTIONS_PLAYER, proportionsName: 'FIGURE_PROPORTIONS_PLAYER', bodyPlan: 'person',
    surfaceClass: SURFACE_PLAYER, imprintTuningKey: 'playerImprintSeconds', color: [0.35, 0.9, 0.85], holdsScanner: true,
    heightTuningKey: 'playerHeight', crouchHeightTuningKey: 'playerHeightCrouching' }
};

// A new body of this kind, for the game: its own proportions, its colour in a scan, its points lasting as long as its kind's do.
function createFigureOfKind(kindKey) {
  const kind = FIGURE_KINDS[kindKey];
  return createFigure(kind.proportions, kind.surfaceClass, kind.imprintTuningKey);
}

// The proportions a body is really built from. For most kinds, the ones it has. For a kind with a
// `heightTuningKey` they are made to fit: every length and every thickness is made larger or smaller by the
// same share, so that the body standing up is exactly as tall as that number says. Its proportions then say
// what shape it is, and the number how big. (A player's height used to be said twice, as `playerHeight` and as
// whatever FIGURE_PROPORTIONS_PLAYER added up to, and the two had to be kept in step by hand.)
// Worked out again only when a number has changed (in the workshop, where they all have sliders).
const fittedFigureBodies = new WeakMap(); // proportions -> { madeFor, body }
let figureMeasuringFigure = null;          // the body the measuring is done on (measureFigureHeight)
function getFigureBody(figure) {
  const proportions = figure.proportions, kind = FIGURE_KINDS[proportions.kind];
  if (!kind || !kind.heightTuningKey || figure === figureMeasuringFigure) return proportions;
  const height = TUNING[kind.heightTuningKey], madeFor = height + JSON.stringify(proportions);
  let fitted = fittedFigureBodies.get(proportions);
  if (fitted && fitted.madeFor === madeFor) return fitted.body;
  if (!fitted) { fitted = { madeFor: '', body: null, share: 1 }; fittedFigureBodies.set(proportions, fitted); }
  fitted.madeFor = madeFor;
  fitted.share = findFigureShareForHeight(proportions, kind.bodyPlan, height);
  fitted.body = scaleFigureProportions(proportions, fitted.share);
  return fitted.body;
}

// By what share a body is larger or smaller than its proportions say: 1, unless it is made to fit a height
// (getFigureBody). The shapes fixed to its bones are made larger or smaller by the same share.
function getFigureBodyShare(figure) {
  const kind = FIGURE_KINDS[figure.proportions.kind];
  if (!kind || !kind.heightTuningKey || figure === figureMeasuringFigure) return 1;
  getFigureBody(figure);
  return fittedFigureBodies.get(figure.proportions).share;
}

// These proportions with every length and every thickness `share` times as big: the same shape, another size.
function scaleFigureProportions(proportions, share) {
  const scaled = {};
  for (const key in proportions) {
    const value = proportions[key];
    scaled[key] = typeof value === 'number' ? value * share : (Array.isArray(value) ? value.map(function (entry) { return entry * share; }) : value);
  }
  return scaled;
}

// How tall a body of these proportions stands, put together by this body plan: to the top of its head, as it
// stands when it is doing nothing. Measured on a body of its own, which is built exactly as it is given.
function measureFigureHeight(proportions, bodyPlan) {
  if (!figureMeasuringFigure) figureMeasuringFigure = createFigure(proportions, 0, 'playerImprintSeconds');
  const measured = figureMeasuringFigure, pose = measured.pose;
  pose.legSwing = 0; pose.kneeBend = bodyPlan === 'person' ? 0.05 : 0; pose.squat = 0; pose.armSwing = 0; pose.armRaise = 0; pose.elbowBend = 0.1;
  pose.lean = bodyPlan === 'person' ? 0.04 : 0; pose.headTilt = 0; pose.stretch = 0; pose.fingerSplay = 0.25; pose.stoop = 0; pose.crawl = 0;
  measured.proportions = proportions;
  return FIGURE_BODY_PLANS[bodyPlan](measured);
}

// These proportions, made larger or smaller as a whole until the body stands `height` tall. (Not simply by the
// share the two heights differ by: an ankle is always at least 7 cm off the floor, whatever size the leg is.)
function fitFigureProportionsToHeight(proportions, bodyPlan, height) {
  return scaleFigureProportions(proportions, findFigureShareForHeight(proportions, bodyPlan, height));
}

// ... and the share itself: how many times as big everything has to be.
function findFigureShareForHeight(proportions, bodyPlan, height) {
  let smaller = 0.05, larger = 20;
  for (let halving = 0; halving < 40; halving++) {
    const middle = (smaller + larger) / 2;
    if (measureFigureHeight(scaleFigureProportions(proportions, middle), bodyPlan) < height) smaller = middle; else larger = middle;
  }
  return (smaller + larger) / 2;
}

// How a player is bent when crouched, so that the body the others see is as tall as the game has you be then:
// TUNING.playerHeightCrouching, which is where you bump your head. The body goes down on its haunches and leans
// forward, both by as much as it takes to bring the top of its head to that height. (It used to be one fixed
// pose, knees bent and leaning, which came to whatever height the proportions gave it: 0.95 m for a body that
// crouches under 0.7.)
// TWEAK: how the two go together. It leans further forward the further down it goes, until it leans
// PLAYER_CROUCH_LEAN (radians) with its thighs PLAYER_CROUCH_DEEPEST_SQUAT forward. If that is not low enough
// for the height asked for, it goes on down on its haunches without leaning any further, as far as sitting on
// its heels (PLAYER_CROUCH_ON_ITS_HEELS: 1.57 would be thighs level). So these two give the crouch its look,
// and never stop the body getting down to the height the game has you be.
const PLAYER_CROUCH_LEAN = 0.5;
const PLAYER_CROUCH_DEEPEST_SQUAT = 0.75;
const PLAYER_CROUCH_ON_ITS_HEELS = 1.5;
const playerCrouchPoses = new WeakMap(); // proportions -> { madeFor, squat, lean, figure }

// Returns { squat, lean } for the pose, for a body of these proportions: a player's own, or those of a body a
// player wears. Worked out again only when the body or the height asked for has changed (in the workshop, where
// both have sliders).
function getPlayerCrouchPose(proportions) {
  const body = proportions || FIGURE_PROPORTIONS_PLAYER;
  let crouch = playerCrouchPoses.get(body);
  if (!crouch) { crouch = { madeFor: '', squat: 0, lean: 0.04, figure: null }; playerCrouchPoses.set(body, crouch); }
  const madeFor = [TUNING.playerHeightCrouching, TUNING.playerHeight, body.thigh, body.shin, body.torsoLength, body.neckLength, body.headRadius, body.headLength, body.legRadius, body.jointRadius].join();
  if (madeFor === crouch.madeFor) return crouch;
  crouch.madeFor = madeFor;
  if (!crouch.figure) crouch.figure = createFigure(body, 0, 'playerImprintSeconds'); // (never shown: only measured)
  const figure = crouch.figure, pose = figure.pose;
  pose.legSwing = 0; pose.kneeBend = 0.05;
  // How tall the body is when it is this far down, from 0 (standing) to 1 (on its heels).
  const deepest = Math.max(PLAYER_CROUCH_ON_ITS_HEELS, PLAYER_CROUCH_DEEPEST_SQUAT);
  const heightAt = function (share) {
    pose.squat = share * deepest;
    pose.lean = 0.04 + Math.min(1, pose.squat / PLAYER_CROUCH_DEEPEST_SQUAT) * (PLAYER_CROUCH_LEAN - 0.04);
    return buildPersonCapsules(figure);
  };
  let standing = 0, down = 1;
  if (heightAt(0) <= TUNING.playerHeightCrouching) down = 0;        // it is no taller than that standing up
  else if (heightAt(1) >= TUNING.playerHeightCrouching) standing = 1; // it cannot get that low: as far down as it goes
  for (let halving = 0; halving < 24 && standing < down; halving++) {
    const middle = (standing + down) / 2;
    if (heightAt(middle) > TUNING.playerHeightCrouching) standing = middle; else down = middle;
  }
  heightAt(down);
  crouch.squat = pose.squat; crouch.lean = pose.lean;
  return crouch;
}

// Sets the legs and the back of a player's body for standing up or for crouching. (The arms and the walk are the caller's.)
function poseFigureAsPlayer(figure, isCrouching) {
  const crouch = isCrouching ? getPlayerCrouchPose(figure.proportions) : null;
  figure.pose.kneeBend = 0.05;
  figure.pose.squat = crouch ? crouch.squat : 0;
  figure.pose.lean = crouch ? crouch.lean : 0.04;
}

// The scanner a player's figure holds. TWEAK: its length and its thickness, in metres.
const PLAYER_SCANNER_LENGTH = 0.15;
const PLAYER_SCANNER_RADIUS = 0.04;

// Where the light on top of the scanner in a player's hand is: halfway along it, just above. `out` gets x, y, z.
function getFigureScannerLight(figure, out) {
  const offset = Math.max(0, figure.scannerCapsule) * FIGURE_CAPSULE_STRIDE, capsules = figure.capsules;
  out.x = (capsules[offset] + capsules[offset + 3]) / 2;
  out.y = (capsules[offset + 1] + capsules[offset + 4]) / 2 + PLAYER_SCANNER_RADIUS + (PLAYER_SCANNER_RADIUS * 0.045);
  out.z = (capsules[offset + 2] + capsules[offset + 5]) / 2;
  return out;
}

const raycastableFigures = [];

// Points store their lifetime in one byte, in quarter seconds: 1 = 0.25 s, 255 = 63.75 s. 0 means "forever".
function convertSecondsToPointLifeCode(seconds) {
  return clampNumber(Math.round(seconds / 0.25), 1, 255);
}

// `imprintTuningKey` names the TUNING value that says how long points left on this figure stay visible.
function createFigure(proportions, surfaceClass, imprintTuningKey) {
  return {
    x: 0, z: 0, yaw: 0,
    y: 0, // height of the floor it stands on; worked out from x and z whenever the body is rebuilt
    proportions: proportions,
    // Pose, all angles in radians:
    //   legSwing / armSwing  walking motion          armRaise     arms lifted forward (0 hanging, 1.4 reaching)
    //   squat                a person-shaped body going down on its haunches: thighs forward, shins back, by this much
    //   kneeBend / elbowBend extra bend              lean         whole body tipped forward
    //   headTilt             head cocked sideways
    //   stretch              Hollow only: 0 hunched, 1 drawn up to full height
    //   fingerSplay          Hollow only: 0 fingers together and curled, 1 spread wide
    //   stoop                Hollow only: 0 as it stands, 1 folded as low as it can go to get under a low ceiling
    //   crawl                Hollow only: 0 on its feet, 1 down on knees and hands, the way it goes through a vent
    pose: { legSwing: 0, kneeBend: 0, squat: 0, armSwing: 0, armRaise: 0, elbowBend: 0.1, lean: 0, headTilt: 0, stretch: 0, fingerSplay: 0.25, stoop: 0, crawl: 0 },
    capsules: new Float32Array(FIGURE_MAXIMUM_CAPSULES * FIGURE_CAPSULE_STRIDE),
    capsuleCount: 0,
    scannerCapsule: -1, // which capsule is the scanner in its hand, if it holds one
    // What a creature made in the workshop has besides capsules (addFigureParts): made when the first is needed.
    rods: null, rodCount: 0,
    boxes: null, boxCount: 0,
    // For the workshop, where a body is taken hold of bone by bone and shape by shape: which bone each capsule
    // is (or '' for a shape fixed to one), and which of its shape's parts (prepareFigureShape) each capsule, rod
    // and box is (or null).
    capsuleBones: [], capsuleParts: [], rodParts: [], boxParts: [],
    builtShape: null,   // the shape it was last built with (its kind's), or null
    // Where each bone was when the body was last built: name -> [start, end, direction]. Only kept for a body
    // with shapes on it, or one that asks for it (`keepsBones`, the workshop).
    bones: {}, keepsBones: false,
    headHeight: 1.6,
    boundsCenterY: 1,
    boundsRadius: 1.5,
    surfaceClass: surfaceClass,
    imprintTuningKey: imprintTuningKey,
    hitsThisFrame: 0,
    totalHits: 0,
    lastScannedTime: -999
  };
}

function setFigureRaycastable(figure, isRaycastable) {
  const position = raycastableFigures.indexOf(figure);
  if (isRaycastable && position < 0) raycastableFigures.push(figure);
  if (!isRaycastable && position >= 0) raycastableFigures.splice(position, 1);
}

function writeFigureCapsule(figure, capsuleIndex, startLocal, endLocal, radius) {
  // Local frame: X = the figure's right, Y = up, Z = the direction it faces.
  const forwardX = Math.sin(figure.yaw), forwardZ = -Math.cos(figure.yaw);
  const rightX = Math.cos(figure.yaw), rightZ = Math.sin(figure.yaw);
  const offset = capsuleIndex * FIGURE_CAPSULE_STRIDE;
  const capsules = figure.capsules;
  capsules[offset] = figure.x + startLocal[0] * rightX + startLocal[2] * forwardX;
  capsules[offset + 1] = startLocal[1];
  capsules[offset + 2] = figure.z + startLocal[0] * rightZ + startLocal[2] * forwardZ;
  capsules[offset + 3] = figure.x + endLocal[0] * rightX + endLocal[2] * forwardX;
  capsules[offset + 4] = endLocal[1];
  capsules[offset + 5] = figure.z + endLocal[0] * rightZ + endLocal[2] * forwardZ;
  capsules[offset + 6] = radius;
}

// ---------------------------------------------------------------------------
// Bones, and the shapes fixed to them
// ---------------------------------------------------------------------------

// A body plan calls this before it puts down its first bone.
function beginFigureBody(figure) {
  const kind = FIGURE_KINDS[figure.proportions.kind];
  figure.builtShape = (kind && kind.shape) || null;
  figure.capsuleCount = 0; figure.rodCount = 0; figure.boxCount = 0;
  figure.scannerCapsule = -1;
}

// One bone of the skeleton: a capsule from `start` to `end`, unless the creature leaves that one out. Where the
// bone is, is kept for the shapes that are fixed to it. `direction` is only given for a bone that may have no
// length to tell it by (a head that is a ball). Returns which capsule it became, or -1.
function addFigureBone(figure, bone, start, end, radius, direction) {
  const shape = figure.builtShape;
  if (figure.keepsBones === true || (shape !== null && shape.parts.length > 0)) figure.bones[bone] = [start, end, direction || null];
  if (shape !== null && shape.hides[bone] === true) return -1;
  const capsuleIndex = figure.capsuleCount++;
  figure.capsuleBones[capsuleIndex] = bone; figure.capsuleParts[capsuleIndex] = null;
  writeFigureCapsule(figure, capsuleIndex, start, end, radius);
  return capsuleIndex;
}

// What a creature has on its skeleton, made ready to be put on a body many times a second.
//   bodyPlan  which skeleton: its bones are the names that count
//   hides     names of bones whose own capsule is left out
//   parts     shapes as an object file has them (`shape`, and `center` with `half` or `radius`, or `from`, `to`
//             and `radius`: see 08-workshop-objects.js), each with the `bone` it is fixed to, in that bone's
//             own directions (FIGURE_SKELETONS), and `mirror`: true for one that has a mirror image. On an arm
//             or a leg that is the same shape on the other arm or leg; on the head or the body, the same shape
//             on its other side.
function prepareFigureShape(bodyPlan, hides, parts) {
  const bones = FIGURE_SKELETONS[bodyPlan].bones;
  const shape = { hides: {}, parts: [] };
  for (const bone of hides || []) if (bones[bone]) shape.hides[bone] = true;
  (parts || []).forEach(function (part, partIndex) {
    if (!bones[part.bone] || partIndex >= FIGURE_MAXIMUM_PARTS) return;
    const isRod = part.from !== undefined;
    const first = isRod ? part.from : part.center, second = isRod ? part.to : part.center;
    const put = function (bone, side) { // side -1: the mirror image
      shape.parts.push({ bone: bone, rest: bones[bone].rest, shape: part.shape, partIndex: partIndex, isMirror: side < 0,
        firstX: first[0] * side, firstY: first[1], firstZ: first[2], secondX: second[0] * side, secondY: second[1], secondZ: second[2],
        radius: part.radius || 0, halfX: part.half ? part.half[0] : 0, halfY: part.half ? part.half[1] : 0, halfZ: part.half ? part.half[2] : 0 });
    };
    put(part.bone, 1);
    // (In the middle of the head or the body its mirror image is itself.)
    if (part.mirror === true && (bones[part.bone].partner || first[0] !== 0 || second[0] !== 0)) put(bones[part.bone].partner || part.bone, -1);
  });
  // Bone by bone, so that where a bone is has to be worked out once for all that is on it.
  shape.parts.sort(function (one, other) { return one.bone < other.bone ? -1 : (one.bone > other.bone ? 1 : one.partIndex - other.partIndex); });
  return shape;
}

// The unit vector nearest to one of the figure's own directions (0: its right, 1: up, 2: the way it faces) that
// is square to `along`. If `along` points that very way there is none: then `otherwise` is tried instead.
function squareFigureDirection(out, along, wanted, otherwise) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const axis = attempt === 0 ? wanted : otherwise, dot = along[axis];
    out[0] = -dot * along[0]; out[1] = -dot * along[1]; out[2] = -dot * along[2];
    out[axis] += 1;
    const length = Math.sqrt(out[0] * out[0] + out[1] * out[1] + out[2] * out[2]);
    if (length > 0.001) { out[0] /= length; out[1] /= length; out[2] /= length; return out; }
  }
  return out;
}

function crossFigureDirections(out, first, second) {
  out[0] = first[1] * second[2] - first[2] * second[1];
  out[1] = first[2] * second[0] - first[0] * second[2];
  out[2] = first[0] * second[1] - first[1] * second[0];
  return out;
}

// Where a bone is and which way its own x, y and z point, in the figure's local frame (X its right, Y up, Z the
// way it faces). `bone` is [start, end, direction] as addFigureBone kept it, `rest` which way the bone points on
// a body standing at rest (FIGURE_SKELETONS). The bone's directions are the figure's own, turned as the bone is
// turned from there: a shin that hangs straight down has them exactly, and one bent back at the knee has its
// "up" along itself and its "front" tipped down with it. Its "right" stays as near the figure's right as it can.
// Fills and returns `frame`: { origin, x, y, z }.
const figureBoneFrame = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
function computeFigureBoneFrame(bone, rest, frame) {
  const start = bone[0], end = bone[1], given = bone[2];
  const origin = frame.origin, x = frame.x, y = frame.y, z = frame.z;
  let alongX = given ? given[0] : end[0] - start[0], alongY = given ? given[1] : end[1] - start[1], alongZ = given ? given[2] : end[2] - start[2];
  const length = Math.sqrt(alongX * alongX + alongY * alongY + alongZ * alongZ);
  // A bar is held by its middle, anything else by where it starts: the joint nearer the body.
  const isBar = rest === 'across';
  origin[0] = isBar ? (start[0] + end[0]) / 2 : start[0]; origin[1] = isBar ? (start[1] + end[1]) / 2 : start[1]; origin[2] = isBar ? (start[2] + end[2]) / 2 : start[2];
  if (rest === 'none' || length < 0.000001) {
    x[0] = 1; x[1] = 0; x[2] = 0; y[0] = 0; y[1] = 1; y[2] = 0; z[0] = 0; z[1] = 0; z[2] = 1;
    return frame;
  }
  alongX /= length; alongY /= length; alongZ /= length;
  if (isBar) {
    x[0] = alongX; x[1] = alongY; x[2] = alongZ;
    crossFigureDirections(z, x, squareFigureDirection(y, x, 1, 2));
  } else if (rest === 'forward') {
    z[0] = alongX; z[1] = alongY; z[2] = alongZ;
    crossFigureDirections(y, z, squareFigureDirection(x, z, 0, 1));
  } else {
    const sign = rest === 'down' ? -1 : 1;
    y[0] = alongX * sign; y[1] = alongY * sign; y[2] = alongZ * sign;
    crossFigureDirections(z, squareFigureDirection(x, y, 0, 2), y);
  }
  return frame;
}

// Puts the shapes that are fixed to the bones where the bones now are. A ball and a capsule join the body's
// capsules; a cylinder and a cone are kept as rods, a box as a box.
function addFigureParts(figure, shape) {
  const share = getFigureBodyShare(figure), frame = figureBoneFrame;
  const origin = frame.origin, x = frame.x, y = frame.y, z = frame.z;
  // From the figure's local frame to the station, as writeFigureCapsule does it.
  const forwardX = Math.sin(figure.yaw), forwardZ = -Math.cos(figure.yaw), rightX = Math.cos(figure.yaw), rightZ = Math.sin(figure.yaw);
  const first = [0, 0, 0], second = [0, 0, 0];
  let framedBone = '';
  for (let index = 0; index < shape.parts.length; index++) {
    const part = shape.parts[index], bone = figure.bones[part.bone];
    if (bone === undefined) continue;
    if (part.bone !== framedBone) { computeFigureBoneFrame(bone, part.rest, frame); framedBone = part.bone; }
    for (let axis = 0; axis < 3; axis++) {
      first[axis] = origin[axis] + (part.firstX * x[axis] + part.firstY * y[axis] + part.firstZ * z[axis]) * share;
      second[axis] = origin[axis] + (part.secondX * x[axis] + part.secondY * y[axis] + part.secondZ * z[axis]) * share;
    }
    if (part.shape === 'ball' || part.shape === 'capsule') {
      const capsuleIndex = figure.capsuleCount++;
      figure.capsuleBones[capsuleIndex] = ''; figure.capsuleParts[capsuleIndex] = part;
      writeFigureCapsule(figure, capsuleIndex, first, second, part.radius * share);
    } else if (part.shape === 'box') {
      if (figure.boxes === null) figure.boxes = new Float32Array(FIGURE_MAXIMUM_PARTS * 2 * FIGURE_BOX_STRIDE);
      const boxes = figure.boxes, offset = figure.boxCount * FIGURE_BOX_STRIDE;
      figure.boxParts[figure.boxCount++] = part;
      boxes[offset] = figure.x + first[0] * rightX + first[2] * forwardX; boxes[offset + 1] = first[1]; boxes[offset + 2] = figure.z + first[0] * rightZ + first[2] * forwardZ;
      boxes[offset + 3] = x[0] * rightX + x[2] * forwardX; boxes[offset + 4] = x[1]; boxes[offset + 5] = x[0] * rightZ + x[2] * forwardZ;
      boxes[offset + 6] = y[0] * rightX + y[2] * forwardX; boxes[offset + 7] = y[1]; boxes[offset + 8] = y[0] * rightZ + y[2] * forwardZ;
      boxes[offset + 9] = z[0] * rightX + z[2] * forwardX; boxes[offset + 10] = z[1]; boxes[offset + 11] = z[0] * rightZ + z[2] * forwardZ;
      boxes[offset + 12] = part.halfX * share; boxes[offset + 13] = part.halfY * share; boxes[offset + 14] = part.halfZ * share;
    } else {
      if (figure.rods === null) figure.rods = new Float32Array(FIGURE_MAXIMUM_PARTS * 2 * FIGURE_ROD_STRIDE);
      const rods = figure.rods, offset = figure.rodCount * FIGURE_ROD_STRIDE;
      figure.rodParts[figure.rodCount++] = part;
      rods[offset] = figure.x + first[0] * rightX + first[2] * forwardX; rods[offset + 1] = first[1]; rods[offset + 2] = figure.z + first[0] * rightZ + first[2] * forwardZ;
      rods[offset + 3] = figure.x + second[0] * rightX + second[2] * forwardX; rods[offset + 4] = second[1]; rods[offset + 5] = figure.z + second[0] * rightZ + second[2] * forwardZ;
      rods[offset + 6] = part.radius * share; rods[offset + 7] = part.shape === 'cone' ? 0 : part.radius * share;
    }
  }
}

// Builds the whole body as it is posed: the skeleton by its body plan, then what is fixed to the bones.
// It stands at height 0, where the figure is and facing the way it faces. Returns how high the top of its head is.
function buildFigureBody(figure) {
  // (A body whose proportions name no kind, such as an apparition's, is a person unless it says it is a Hollow.)
  const kind = FIGURE_KINDS[figure.proportions.kind];
  const topHeight = FIGURE_BODY_PLANS[kind ? kind.bodyPlan : (figure.proportions.kind === 'hollow' ? 'hollow' : 'person')](figure);
  const shape = figure.builtShape;
  if (shape !== null && shape.parts.length > 0) addFigureParts(figure, shape);
  return topHeight;
}

// How high the highest point of a body is, of everything it is made of: its head, or a horn on it.
function getFigureTop(figure) {
  let top = 0;
  const capsules = figure.capsules, rods = figure.rods, boxes = figure.boxes;
  for (let capsuleIndex = 0; capsuleIndex < figure.capsuleCount; capsuleIndex++) {
    const offset = capsuleIndex * FIGURE_CAPSULE_STRIDE, radius = capsules[offset + 6];
    top = Math.max(top, capsules[offset + 1] + radius, capsules[offset + 4] + radius);
  }
  for (let rodIndex = 0; rodIndex < figure.rodCount; rodIndex++) {
    const offset = rodIndex * FIGURE_ROD_STRIDE;
    top = Math.max(top, rods[offset + 1] + rods[offset + 6], rods[offset + 4] + rods[offset + 7]);
  }
  for (let boxIndex = 0; boxIndex < figure.boxCount; boxIndex++) {
    const offset = boxIndex * FIGURE_BOX_STRIDE;
    top = Math.max(top, boxes[offset + 1] + Math.abs(boxes[offset + 4]) * boxes[offset + 12] + Math.abs(boxes[offset + 7]) * boxes[offset + 13] + Math.abs(boxes[offset + 10]) * boxes[offset + 14]);
  }
  return top;
}

function addLocalPoints(point, direction, length) {
  return [point[0] + direction[0] * length, point[1] + direction[1] * length, point[2] + direction[2] * length];
}

function normalizeLocalVector(vector) {
  const length = Math.sqrt(vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

// The Hollow. Local frame: X = its right, Y = up, Z = the way it faces.
function buildHollowCapsules(figure) {
  const body = figure.proportions, pose = figure.pose;
  const stretch = clampNumber(pose.stretch, 0, 1), hunch = 1 - stretch;
  const splay = clampNumber(pose.fingerSplay, 0, 1);
  // Stooping folds the legs further and tips the back and neck over, the way a tall man goes through a low door.
  // TWEAK: the four STOOP numbers say how much each joint gives. Larger = it can get under lower ceilings.
  const stoop = clampNumber(pose.stoop || 0, 0, 1);
  const STOOP_THIGH = 0.5, STOOP_KNEE = 1.0, STOOP_LOWER_BACK = 0.3, STOOP_UPPER_BACK = 0.55;
  // Crawling: knees on the floor under the hips, shins lying back, the back level, the neck stuck out, and the
  // long arms reaching ahead with the elbows cocked out to the sides. Every joint moves from where it would be
  // standing to where it is crawling as `crawl` goes from 0 to 1.
  // TWEAK: the CRAWL numbers are joint angles in radians (0 = straight down or straight up, 1.57 = level).
  const crawl = clampNumber(pose.crawl || 0, 0, 1);
  const CRAWL_THIGH = 0.55, CRAWL_SHIN = -1.5, CRAWL_LOWER_BACK = 1.5, CRAWL_UPPER_BACK = 1.62, CRAWL_NECK = 1.45;
  const CRAWL_ELBOW_OUT = 0.26, CRAWL_ELBOW_DROP = 0.22; // metres the elbow sits out from and below the shoulder
  beginFigureBody(figure);
  const add = function (bone, start, end, radius, direction) { return addFigureBone(figure, bone, start, end, radius, direction); };

  // Legs: knees pushed forward, shins sloping back, like something that was not built to stand upright.
  const legs = [];
  let lowestAnkle = 0;
  for (let side = -1; side <= 1; side += 2) {
    const swing = pose.legSwing * (side < 0 ? 1 : -1);
    const standingThighAngle = swing + 0.38 * hunch + pose.kneeBend * 0.5 + STOOP_THIGH * stoop;
    const standingShinAngle = standingThighAngle - (0.8 * hunch + pose.kneeBend + Math.max(0, -swing) * 0.6 + STOOP_KNEE * stoop);
    const thighAngle = interpolateLinear(standingThighAngle, CRAWL_THIGH + swing * 0.6, crawl);
    const shinAngle = interpolateLinear(standingShinAngle, CRAWL_SHIN, crawl);
    const hip = [side * body.hipWidth / 2, 0, 0];
    const knee = [hip[0], -Math.cos(thighAngle) * body.thigh, Math.sin(thighAngle) * body.thigh];
    const ankle = [knee[0], knee[1] - Math.cos(shinAngle) * body.shin, knee[2] + Math.sin(shinAngle) * body.shin];
    lowestAnkle = Math.min(lowestAnkle, ankle[1]);
    legs.push({ hip: hip, knee: knee, ankle: ankle, side: side });
  }
  const pelvisHeight = -lowestAnkle + 0.07;
  for (const leg of legs) { leg.hip[1] += pelvisHeight; leg.knee[1] += pelvisHeight; leg.ankle[1] += pelvisHeight; }

  // Spine in two pieces, so the back curves instead of tipping like a plank.
  const pelvis = [0, pelvisHeight, 0];
  const lowerLean = interpolateLinear(pose.lean * 0.7 + 0.25 * hunch + STOOP_LOWER_BACK * stoop, CRAWL_LOWER_BACK, crawl);
  const upperLean = interpolateLinear(pose.lean * 1.5 + 0.6 * hunch + STOOP_UPPER_BACK * stoop, CRAWL_UPPER_BACK, crawl);
  const midSpine = addLocalPoints(pelvis, [0, Math.cos(lowerLean), Math.sin(lowerLean)], body.lowerSpine);
  const chest = addLocalPoints(midSpine, [0, Math.cos(upperLean), Math.sin(upperLean)], body.upperSpine);
  add('lowerBack', pelvis, midSpine, body.torsoRadius);
  add('upperBack', midSpine, chest, body.torsoRadius * 1.08);

  // Neck jutting forward, head cocked hard to one side, jaw hanging.
  const neckLean = interpolateLinear(upperLean * 0.6 + 0.55 * hunch, CRAWL_NECK, crawl);
  const neckDirection = normalizeLocalVector([Math.sin(pose.headTilt) * 0.45, Math.cos(neckLean), Math.sin(neckLean)]);
  const headBase = addLocalPoints(chest, neckDirection, body.neckLength);
  const headDirection = normalizeLocalVector([Math.sin(pose.headTilt), Math.cos(pose.headTilt) * Math.cos(neckLean * 0.6), Math.sin(neckLean * 0.6)]);
  const headTop = addLocalPoints(headBase, headDirection, body.headLength);
  add('neck', chest, headBase, body.limbRadius * 1.15);
  add('head', headBase, headTop, body.headRadius, headDirection);
  const jawStart = [headBase[0], headBase[1] - 0.02, headBase[2] + 0.07];
  add('jaw', jawStart, [jawStart[0] - Math.sin(pose.headTilt) * 0.03, jawStart[1] - body.jawLength - 0.06 * splay, jawStart[2] + 0.05], 0.028);
  figure.headHeight = (headBase[1] + headTop[1]) / 2;

  // Shoulders, one hanging lower than the other.
  const droop = 0.07 * hunch;
  const shoulderLeft = [-body.shoulderWidth / 2, chest[1] - 0.02 - droop, chest[2] + 0.02];
  const shoulderRight = [body.shoulderWidth / 2, chest[1] - 0.02 + droop * 0.3, chest[2] + 0.02];
  add('shoulders', shoulderLeft, shoulderRight, body.limbRadius * 1.3);
  add('hips', legs[0].hip, legs[1].hip, body.legRadius * 1.1);

  // Arms that reach its knees, ending in three long fingers.
  for (let side = -1; side <= 1; side += 2) {
    const shoulder = side < 0 ? shoulderLeft : shoulderRight, sideName = side < 0 ? 'Left' : 'Right';
    const armAngle = pose.armRaise + upperLean * 0.5 + pose.armSwing * (side < 0 ? -1 : 1);
    const elbow = [shoulder[0] + side * 0.08 * (1 + stretch), shoulder[1] - Math.cos(armAngle) * body.upperArm, shoulder[2] + Math.sin(armAngle) * body.upperArm];
    const foreArmAngle = armAngle + pose.elbowBend + (side < 0 ? 0.14 * hunch : 0);
    const wrist = [elbow[0] + side * 0.03, elbow[1] - Math.cos(foreArmAngle) * body.foreArm, elbow[2] + Math.sin(foreArmAngle) * body.foreArm];
    if (crawl > 0) {
      // Crawling: the elbow out to the side and a little below the shoulder, the hand flat on the floor ahead.
      // The two arms reach in turn, opposite to the legs.
      const reach = pose.legSwing * (side < 0 ? -1 : 1) * 0.25;
      const elbowForward = Math.sqrt(Math.max(0.01, body.upperArm * body.upperArm - CRAWL_ELBOW_OUT * CRAWL_ELBOW_OUT - CRAWL_ELBOW_DROP * CRAWL_ELBOW_DROP));
      const crawlElbow = [shoulder[0] + side * CRAWL_ELBOW_OUT, shoulder[1] - CRAWL_ELBOW_DROP, shoulder[2] + elbowForward + reach];
      const drop = Math.max(0, crawlElbow[1] - 0.06);
      const crawlWrist = [crawlElbow[0] + side * 0.03, 0.06, crawlElbow[2] + Math.sqrt(Math.max(0.01, body.foreArm * body.foreArm - drop * drop))];
      for (let axis = 0; axis < 3; axis++) {
        elbow[axis] = interpolateLinear(elbow[axis], crawlElbow[axis], crawl);
        wrist[axis] = interpolateLinear(wrist[axis], crawlWrist[axis], crawl);
      }
    }
    // The hand follows the forearm, except when crawling, where it lies along the floor.
    const foreArmDirection = normalizeLocalVector([wrist[0] - elbow[0], (wrist[1] - elbow[1]) * (1 - 0.9 * crawl), wrist[2] - elbow[2] + crawl * 0.4]);
    const knuckles = addLocalPoints(wrist, foreArmDirection, body.handLength);
    add('upperArm' + sideName, shoulder, elbow, body.limbRadius);
    add('foreArm' + sideName, elbow, wrist, body.limbRadius * 0.9);
    add('hand' + sideName, wrist, knuckles, body.limbRadius * 0.8);
    for (let finger = -1; finger <= 1; finger++) {
      const fingerDirection = normalizeLocalVector([
        foreArmDirection[0] + finger * 0.42 * (0.3 + 0.7 * splay),
        foreArmDirection[1],
        foreArmDirection[2] + 0.2 * (1 - splay)]);
      // (The fingers are named for where they are: the one furthest from the body is the outer one, on either hand.)
      add((finger === 0 ? 'fingerMiddle' : (finger === side ? 'fingerOuter' : 'fingerInner')) + sideName,
        knuckles, addLocalPoints(knuckles, fingerDirection, body.fingerLengths[finger + 1]), body.fingerRadius);
    }
  }

  for (const leg of legs) {
    const sideName = leg.side < 0 ? 'Left' : 'Right';
    add('thigh' + sideName, leg.hip, leg.knee, body.legRadius);
    add('shin' + sideName, leg.knee, leg.ankle, body.legRadius * 0.85);
    add('foot' + sideName, leg.ankle, [leg.ankle[0] + leg.side * 0.03, 0.035, leg.ankle[2] + body.footLength * (1 - 2 * crawl)], body.footRadius); // crawling, the toes trail behind
  }
  return headTop[1] + body.headRadius;
}

// A person-shaped body: the calibration dummy, stiff, symmetrical, with a ball at every joint; and a player, who
// is the same make with a scanner in one hand.
function buildPersonCapsules(figure) {
  const body = getFigureBody(figure), pose = figure.pose;
  beginFigureBody(figure);
  const add = function (bone, start, end, radius, direction) { return addFigureBone(figure, bone, start, end, radius, direction); };

  const legs = [];
  let lowestFoot = 0;
  // How far an ankle is above the floor: 7 cm, or more for a leg too thick for that.
  const ankleHeight = Math.max(0.07, body.legRadius * 0.85);
  for (let side = -1; side <= 1; side += 2) {
    const swing = pose.legSwing * (side < 0 ? 1 : -1);
    const bend = pose.kneeBend + Math.max(0, -swing) * 0.7;
    const hip = [side * body.hipWidth / 2, 0, 0];
    // Squatting: both thighs go forward and both shins back by as much, so the hips come down over the feet.
    // (A bent knee alone only lifts the foot behind: it does not bring a body down far.)
    const squat = pose.squat || 0, thighAngle = swing + squat;
    const knee = [hip[0], -Math.cos(thighAngle) * body.thigh, Math.sin(thighAngle) * body.thigh];
    const shinAngle = swing - bend - squat;
    const ankle = [knee[0], knee[1] - Math.cos(shinAngle) * body.shin, knee[2] + Math.sin(shinAngle) * body.shin];
    lowestFoot = Math.min(lowestFoot, ankle[1]);
    // (Far down on its haunches and in mid-stride, the knee of the leg behind is lower than its foot: then it is
    // the knee that is on the floor. 0.07 is how far an ankle is above the floor.)
    if (squat > 0) lowestFoot = Math.min(lowestFoot, knee[1] + ankleHeight - body.jointRadius);
    legs.push({ hip: hip, knee: knee, ankle: ankle, sideName: side < 0 ? 'Left' : 'Right' });
  }
  const pelvisHeight = -lowestFoot + ankleHeight;
  for (const leg of legs) { leg.hip[1] += pelvisHeight; leg.knee[1] += pelvisHeight; leg.ankle[1] += pelvisHeight; }

  const pelvis = [0, pelvisHeight, 0];
  const waist = [0, pelvisHeight + Math.cos(pose.lean) * body.torsoLength * 0.45, Math.sin(pose.lean) * body.torsoLength * 0.45];
  const chest = [0, pelvisHeight + Math.cos(pose.lean) * body.torsoLength, Math.sin(pose.lean) * body.torsoLength];
  const neckLean = pose.lean * 1.5;
  const neckDirection = [Math.sin(pose.headTilt), Math.cos(neckLean) * Math.cos(pose.headTilt), Math.sin(neckLean)];
  const headBase = addLocalPoints(chest, neckDirection, body.neckLength + body.headRadius);
  const headTop = addLocalPoints(headBase, neckDirection, body.headLength);
  add('belly', pelvis, waist, body.torsoRadius * 0.9);
  add('chest', waist, chest, body.torsoRadius * 1.1);
  add('neck', chest, headBase, body.limbRadius);
  add('head', headBase, headTop, body.headRadius, neckDirection); // (a head may have no length: it points the way the neck does)
  figure.headHeight = (headBase[1] + headTop[1]) / 2;

  const shoulderLeft = [-body.shoulderWidth / 2, chest[1] - 0.03, chest[2]];
  const shoulderRight = [body.shoulderWidth / 2, chest[1] - 0.03, chest[2]];
  add('shoulders', shoulderLeft, shoulderRight, body.limbRadius * 1.3);
  add('hips', legs[0].hip, legs[1].hip, body.legRadius);

  // A player holds a scanner in the right hand. That arm goes by armRaise and elbowBend, and is held steady;
  // the other hangs at their side and swings as they walk.
  const isPlayer = Boolean(FIGURE_KINDS[body.kind] && FIGURE_KINDS[body.kind].holdsScanner);
  let scannerHand = null, scannerAngle = 0;
  for (let side = -1; side <= 1; side += 2) {
    const shoulder = side < 0 ? shoulderLeft : shoulderRight, sideName = side < 0 ? 'Left' : 'Right';
    const isScannerArm = isPlayer && side > 0, isFreeArm = isPlayer && side < 0;
    // (A player's free arm comes forward as they go down on their haunches, to lie along the thigh: hanging
    // straight down from a shoulder that low, the hand would be in the floor.)
    const squat = pose.squat || 0;
    const armAngle = (isFreeArm ? 0.06 + squat * 0.5 : pose.armRaise) + pose.lean * 0.4 + (isScannerArm ? 0 : pose.armSwing * (side < 0 ? -1 : 1));
    const elbow = [shoulder[0], shoulder[1] - Math.cos(armAngle) * body.upperArm, shoulder[2] + Math.sin(armAngle) * body.upperArm];
    const foreArmAngle = armAngle + (isFreeArm ? 0.15 + squat * 0.4 : pose.elbowBend);
    const wrist = [elbow[0], elbow[1] - Math.cos(foreArmAngle) * body.foreArm, elbow[2] + Math.sin(foreArmAngle) * body.foreArm];
    const hand = [wrist[0], wrist[1] - Math.cos(foreArmAngle) * body.handLength, wrist[2] + Math.sin(foreArmAngle) * body.handLength];
    if (isScannerArm) { scannerHand = hand; scannerAngle = foreArmAngle; }
    add('upperArm' + sideName, shoulder, elbow, body.limbRadius);
    add('foreArm' + sideName, elbow, wrist, body.limbRadius * 0.9);
    add('hand' + sideName, wrist, hand, body.limbRadius * 1.15);
    add('shoulderJoint' + sideName, shoulder, shoulder, body.jointRadius);
    add('elbowJoint' + sideName, elbow, elbow, body.jointRadius * 0.85);
  }
  for (const leg of legs) {
    add('thigh' + leg.sideName, leg.hip, leg.knee, body.legRadius);
    add('shin' + leg.sideName, leg.knee, leg.ankle, body.legRadius * 0.85);
    add('foot' + leg.sideName, leg.ankle, [leg.ankle[0], 0.04, leg.ankle[2] + body.footLength], body.footRadius);
    add('kneeJoint' + leg.sideName, leg.knee, leg.knee, body.jointRadius);
  }
  if (isPlayer) {
    // The scanner: it goes on from the hand the way the forearm points. It is not a bone: it is what they
    // carry, and no body a player wears can leave it out. getFigureScannerLight finds it by `scannerCapsule`.
    figure.scannerCapsule = add('scanner', scannerHand, [scannerHand[0], scannerHand[1] - Math.cos(scannerAngle) * PLAYER_SCANNER_LENGTH, scannerHand[2] + Math.sin(scannerAngle) * PLAYER_SCANNER_LENGTH], PLAYER_SCANNER_RADIUS);
  }
  return headTop[1] + body.headRadius;
}

function updateFigureCapsules(figure) {
  const topHeight = buildFigureBody(figure);

  // The body is built standing at height 0; lift or lower it onto the floor it is really on.
  const capsules = figure.capsules, rods = figure.rods, boxes = figure.boxes;
  figure.y = getFloorHeightAt(figure.x, figure.z);
  if (figure.y !== 0) {
    for (let capsuleIndex = 0; capsuleIndex < figure.capsuleCount; capsuleIndex++) {
      capsules[capsuleIndex * FIGURE_CAPSULE_STRIDE + 1] += figure.y;
      capsules[capsuleIndex * FIGURE_CAPSULE_STRIDE + 4] += figure.y;
    }
    for (let rodIndex = 0; rodIndex < figure.rodCount; rodIndex++) {
      rods[rodIndex * FIGURE_ROD_STRIDE + 1] += figure.y;
      rods[rodIndex * FIGURE_ROD_STRIDE + 4] += figure.y;
    }
    for (let boxIndex = 0; boxIndex < figure.boxCount; boxIndex++) boxes[boxIndex * FIGURE_BOX_STRIDE + 1] += figure.y;
  }

  // Bounding sphere for quick rejection in the ray caster: round the middle of the body, and as far out as
  // the furthest thing it is made of reaches.
  figure.boundsCenterY = figure.y + topHeight / 2;
  let reach = 0;
  for (let capsuleIndex = 0; capsuleIndex < figure.capsuleCount; capsuleIndex++) {
    const offset = capsuleIndex * FIGURE_CAPSULE_STRIDE;
    for (let endIndex = 0; endIndex < 2; endIndex++) {
      const deltaX = capsules[offset + endIndex * 3] - figure.x;
      const deltaY = capsules[offset + endIndex * 3 + 1] - figure.boundsCenterY;
      const deltaZ = capsules[offset + endIndex * 3 + 2] - figure.z;
      reach = Math.max(reach, Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ) + capsules[offset + 6]);
    }
  }
  for (let rodIndex = 0; rodIndex < figure.rodCount; rodIndex++) {
    const offset = rodIndex * FIGURE_ROD_STRIDE;
    for (let endIndex = 0; endIndex < 2; endIndex++) {
      const deltaX = rods[offset + endIndex * 3] - figure.x;
      const deltaY = rods[offset + endIndex * 3 + 1] - figure.boundsCenterY;
      const deltaZ = rods[offset + endIndex * 3 + 2] - figure.z;
      reach = Math.max(reach, Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ) + rods[offset + 6]);
    }
  }
  for (let boxIndex = 0; boxIndex < figure.boxCount; boxIndex++) {
    const offset = boxIndex * FIGURE_BOX_STRIDE;
    const deltaX = boxes[offset] - figure.x, deltaY = boxes[offset + 1] - figure.boundsCenterY, deltaZ = boxes[offset + 2] - figure.z;
    const halfX = boxes[offset + 12], halfY = boxes[offset + 13], halfZ = boxes[offset + 14];
    reach = Math.max(reach, Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ) + Math.sqrt(halfX * halfX + halfY * halfY + halfZ * halfZ));
  }
  figure.boundsRadius = reach + 0.02;
}

// Height of the head above the lift's floor level (not above the figure's own feet).
// How high the top of the Hollow's body would be, standing on flat ground, with a given stretch and stoop and
// otherwise posed as `figure` is now. Worked out on a spare body, so `figure` itself is not touched.
let hollowFittingFigure = null;
function measureHollowTop(figure, stretch, stoop, crawl) {
  if (!hollowFittingFigure) hollowFittingFigure = createFigure(figure.proportions, figure.surfaceClass, figure.imprintTuningKey);
  const spare = hollowFittingFigure;
  spare.proportions = figure.proportions;
  Object.assign(spare.pose, figure.pose);
  spare.pose.stretch = stretch; spare.pose.stoop = stoop; spare.pose.crawl = crawl || 0;
  spare.pose.legSwing = 0; // or the answer would bob up and down with every step
  spare.x = 0; spare.z = 0; spare.yaw = 0;
  buildFigureBody(spare); // with whatever is fixed to its bones: it ducks its horns too
  return getFigureTop(spare);
}

// Decides how the Hollow must hold itself to fit under a ceiling `headroom` metres above its feet:
// as drawn up as it wants to be if there is room, less so if not, stooping if it is too tall even hunched,
// and down on knees and hands if stooping is not enough (a vent).
// The heights come from the body itself, so this stays right whatever FIGURE_PROPORTIONS_HOLLOW is changed to.
// `gap` is how far below the ceiling the top of it must stay. Returns the same object every time: { stretch, stoop, crawl }.
const hollowFit = { stretch: 0, stoop: 0, crawl: 0 };
function fitHollowUnderCeiling(figure, headroom, wantedStretch, gap) {
  const limit = headroom - gap;
  hollowFit.stretch = wantedStretch; hollowFit.stoop = 0; hollowFit.crawl = 0;
  if (measureHollowTop(figure, wantedStretch, 0) <= limit) return hollowFit;
  if (measureHollowTop(figure, 0, 0) <= limit) {
    // Somewhere between hunched and what it wanted: close in on the most that fits.
    let low = 0, high = wantedStretch;
    for (let step = 0; step < 6; step++) {
      const middle = (low + high) / 2;
      if (measureHollowTop(figure, middle, 0) <= limit) low = middle; else high = middle;
    }
    hollowFit.stretch = low;
    return hollowFit;
  }
  // Too tall even hunched: stoop as little as will do.
  hollowFit.stretch = 0;
  if (measureHollowTop(figure, 0, 1) <= limit) {
    let low = 0, high = 1;
    for (let step = 0; step < 6; step++) {
      const middle = (low + high) / 2;
      if (measureHollowTop(figure, 0, middle) <= limit) high = middle; else low = middle;
    }
    hollowFit.stoop = high;
    return hollowFit;
  }
  // Too low even for that: down on knees and hands, as far as it takes. Crawling it only needs a finger's
  // width over its back, whatever gap it keeps when it is on its feet.
  const crawlLimit = headroom - Math.min(gap, 0.05);
  let low = 0, high = 1;
  for (let step = 0; step < 6; step++) {
    const middle = (low + high) / 2;
    if (measureHollowTop(figure, 0, 0, middle) <= crawlLimit) high = middle; else low = middle;
  }
  hollowFit.crawl = high;
  return hollowFit;
}

function getFigureHeadHeight(figure) {
  return figure.y + figure.headHeight;
}

// Sprays points straight onto a figure's surface. Used for the moment it reaches you.
function emitFigureRevealPoints(figure, pointCount, surfaceClass, lifeCode) {
  const capsules = figure.capsules, rods = figure.rods, boxes = figure.boxes;
  const shapeCount = figure.capsuleCount + figure.rodCount + figure.boxCount;
  if (shapeCount === 0) return; // a creature with all of its skeleton left out and nothing on its bones
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
    const shapeIndex = Math.floor(Math.random() * shapeCount);
    const along = Math.random();
    let directionX = Math.random() - 0.5, directionY = Math.random() - 0.5, directionZ = Math.random() - 0.5;
    const length = Math.sqrt(directionX * directionX + directionY * directionY + directionZ * directionZ) || 1;
    if (shapeIndex < figure.capsuleCount) {
      const offset = shapeIndex * FIGURE_CAPSULE_STRIDE, radius = capsules[offset + 6];
      addScanPoint(
        capsules[offset] + (capsules[offset + 3] - capsules[offset]) * along + directionX / length * radius,
        capsules[offset + 1] + (capsules[offset + 4] - capsules[offset + 1]) * along + directionY / length * radius,
        capsules[offset + 2] + (capsules[offset + 5] - capsules[offset + 2]) * along + directionZ / length * radius,
        0.6 + Math.random() * 0.4, surfaceClass, lifeCode);
    } else if (shapeIndex < figure.capsuleCount + figure.rodCount) {
      // A cylinder or a cone: as thick as it is at that place along it.
      const offset = (shapeIndex - figure.capsuleCount) * FIGURE_ROD_STRIDE, radius = rods[offset + 6] + (rods[offset + 7] - rods[offset + 6]) * along;
      addScanPoint(
        rods[offset] + (rods[offset + 3] - rods[offset]) * along + directionX / length * radius,
        rods[offset + 1] + (rods[offset + 4] - rods[offset + 1]) * along + directionY / length * radius,
        rods[offset + 2] + (rods[offset + 5] - rods[offset + 2]) * along + directionZ / length * radius,
        0.6 + Math.random() * 0.4, surfaceClass, lifeCode);
    } else {
      // A box: somewhere on one of its six sides.
      const offset = (shapeIndex - figure.capsuleCount - figure.rodCount) * FIGURE_BOX_STRIDE;
      const place = [Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1];
      place[Math.floor(Math.random() * 3)] = Math.random() < 0.5 ? -1 : 1;
      const alongX = place[0] * boxes[offset + 12], alongY = place[1] * boxes[offset + 13], alongZ = place[2] * boxes[offset + 14];
      addScanPoint(
        boxes[offset] + boxes[offset + 3] * alongX + boxes[offset + 6] * alongY + boxes[offset + 9] * alongZ,
        boxes[offset + 1] + boxes[offset + 4] * alongX + boxes[offset + 7] * alongY + boxes[offset + 10] * alongZ,
        boxes[offset + 2] + boxes[offset + 5] * alongX + boxes[offset + 8] * alongY + boxes[offset + 11] * alongZ,
        0.6 + Math.random() * 0.4, surfaceClass, lifeCode);
    }
  }
}
