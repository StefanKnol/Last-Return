// ---------------------------------------------------------------------------
// Workshop, creature tool: change a creature's proportions and watch its body change.
//
// The body on screen is built by the game's own code (04-figures.js) and posed by the game's own code
// (poseHollow and poseAdvancingStill in 08-entities.js, placeOtherPlayerFigure in 11-together.js), so it stands,
// walks and reaches as it will in play. A player is one of the creatures here: the body the others see of you
// when you are down there together, with the scanner in its hand.
// It can be shown as a solid body, or the way the game shows it: as nothing but the points a scan leaves.
//
// Two kinds of creature can be opened:
//   kinds written as code (FIGURE_KINDS in 04-figures.js: the Hollow, a Still, a player). Their proportions can
//                       be changed. The sliders change the FIGURE_PROPORTIONS_... objects themselves, so the
//                       whole game uses the new numbers at once. They are kept in the browser across reloads
//                       until they are written to 04-figures.js ("Write to file") or thrown away ("Back to the
//                       file"). A number changed by hand in the file wins over a slider that was set before.
//   creatures made here saved to src/creatures/<key>.json (04-workshop-creatures.js). These can be changed in
//                       every way: their skeleton, their proportions, which of the skeleton's own capsules they
//                       leave out, and the shapes that are fixed to their bones. That part of the tool is in
//                       22-workshop-creature-shapes.js.
// ---------------------------------------------------------------------------

const CREATURE_WORKSHOP_STAGE_SIZE = 13;      // the test room is this many metres square
const CREATURE_WORKSHOP_SCAN_RAYS = 2600;     // pulses fired at the creature every frame in the scanner views
// Scanner views: how long a point left on the body lasts when it is not set to last as long as in the game.
// Short, so the cloud is the shape of the body now and not a smear of where it has been.
TUNING.workshopImprintSeconds = 0.5;

// The kind the working copy of a creature made here is, for as long as it is open.
const CREATURE_WORKSHOP_DRAFT_KEY = 'workshopDraft';

// What a body can be set to be doing here, posed by the game's own code (updateCreatureWorkshopPose). The game
// has three ways of posing a body, and each creature is posed by the one that fits it: the Hollow's for a body
// on the Hollow's skeleton, a player's for a body that holds a scanner, a Still's for any other.
const CREATURE_WORKSHOP_BEHAVIOURS = {
  hollow: [['roam', 'Roaming'], ['investigate', 'Walking to a noise'], ['hunt', 'Hunting'], ['enraged', 'Enraged'],
    ['listen', 'Standing still, listening'], ['held', 'Held in the beam'], ['caught', 'Reaching you (the last thing you see)'], ['manual', 'Posed by hand']],
  dummy: [['standing', 'Standing in the store'], ['advancing', 'Advancing on you'], ['caught', 'Reaching you'], ['manual', 'Posed by hand']],
  player: [['standing', 'Standing, scanner at their side'], ['scanning', 'Standing, scanning'], ['walking', 'Walking'], ['walkingScanning', 'Walking, scanning'],
    ['crouched', 'Crouched'], ['crouchedScanning', 'Crouched, scanning'], ['crouchedWalking', 'Creeping along, crouched'], ['manual', 'Posed by hand']]
};

// What the tool goes by for one kind of FIGURE_KINDS.
function describeCreatureWorkshopKind(kindKey) {
  const kind = FIGURE_KINDS[kindKey];
  const actsLike = kind.bodyPlan === 'hollow' ? 'hollow' : (kind.holdsScanner ? 'player' : 'dummy');
  return {
    label: kind.label, proportions: kind.proportions, constantName: kind.proportionsName.replace(/^FIGURE_PROPORTIONS_/, ''),
    surfaceClass: kind.surfaceClass, imprintTuningKey: kind.imprintTuningKey, color: kind.color,
    hasHollowBody: kind.bodyPlan === 'hollow', bodyPlan: kind.bodyPlan, heightTuningKey: kind.heightTuningKey || '',
    isDesigned: kind.isDesigned === true, actsLike: actsLike,
    // The numbers in 00-config.js that are this creature's as well: how tall it is, standing and crouched.
    // (A body a player can wear is as tall as a player: those numbers are set at the player, not at each body.)
    settingKeys: kind.isDesigned ? [] : [kind.heightTuningKey, kind.crouchHeightTuningKey].filter(Boolean),
    behaviours: CREATURE_WORKSHOP_BEHAVIOURS[actsLike]
  };
}

// The kinds written as code: every such kind in FIGURE_KINDS (04-figures.js). One added there turns up here by
// itself. (The creature made here that is open joins them as CREATURE_WORKSHOP_DRAFT_KEY.)
const CREATURE_WORKSHOP_KINDS = {};
for (const kindKey in FIGURE_KINDS) {
  if (!FIGURE_KINDS[kindKey].isDesigned) CREATURE_WORKSHOP_KINDS[kindKey] = describeCreatureWorkshopKind(kindKey);
}

// Which creature is stood beside the one being worked on, for scale: a Still (person-sized) beside everything
// else, the Hollow beside a Still.
function getCreatureWorkshopOtherKindKey() {
  return creatureWorkshop.kind === 'dummy' ? 'hollow' : 'dummy';
}

// Which heading each proportion is listed under. One that is not named here goes under "Other".
const CREATURE_WORKSHOP_GROUPS = [
  ['Legs', ['thigh', 'shin', 'footLength', 'footRadius', 'hipWidth', 'legRadius']],
  ['Body', ['torsoLength', 'lowerSpine', 'upperSpine', 'shoulderWidth', 'torsoRadius']],
  ['Head', ['neckLength', 'headLength', 'headRadius', 'jawLength']],
  ['Arms and hands', ['upperArm', 'foreArm', 'handLength', 'fingerLengths', 'limbRadius', 'fingerRadius', 'jointRadius']]
];
const CREATURE_WORKSHOP_FINGER_NAMES = ['outer', 'middle', 'inner'];

// The pose sliders: key in figure.pose, label, lowest, highest (radians, or 0 to 1), and whether only a body of the Hollow's make has it.
const CREATURE_WORKSHOP_POSE_FIELDS = [
  ['legSwing', 'Legs: stride', -1, 1, false], ['kneeBend', 'Legs: knees bent', 0, 1.2, false], ['squat', 'Legs: down on its haunches', 0, 1.55, false],
  ['armSwing', 'Arms: swing', -1, 1, false], ['armRaise', 'Arms: raised forward', -0.3, 1.6, false], ['elbowBend', 'Arms: elbows bent', 0, 1.6, false],
  ['lean', 'Body: leaning forward', -0.3, 0.8, false], ['headTilt', 'Head: cocked sideways', -1, 1, false],
  ['stretch', 'Drawn up to full height', 0, 1, true], ['fingerSplay', 'Fingers spread', 0, 1, true],
  ['stoop', 'Stooped under a low ceiling', 0, 1, true], ['crawl', 'On knees and hands (in a vent)', 0, 1, true]
];

const creatureWorkshop = {
  kind: 'hollow',
  behaviour: 'roam',
  view: 'solid',          // 'solid', 'scanned' (points only, as in the game) or 'both'
  showsOriginal: true,    // the shape from the file, in grey, beside the one being changed
  showsOther: false,      // the other creature, for scale
  isTurning: false,
  hasGameImprints: false, // scanner views: points on the body last as long as the game lets them (smeared), or briefly (sharp)
  ceiling: 4,             // of the test room. The Hollow only draws itself up as far as the ceiling allows.
  needsStage: false,
  needsProportionFields: false, // the height slider has changed every proportion: their sliders are to be put out again
  fileProportions: {},    // per kind: what 04-figures.js held when the page loaded
  overrides: {},          // per kind: key -> { base: the file's value when the slider was moved, value: the slider's }
  fileSettings: {},       // a creature's numbers in 00-config.js (how tall a player is): what that file held when the page loaded
  settingOverrides: {},   // ... and which of them a slider here has changed: key -> { base, value }, as above
  figure: null, originalFigure: null, otherFigure: null,
  // Stands in for the `hollow` object when the game's pose code is asked to pose the figure here.
  standIn: { figure: null, walkPhase: 0, currentSpeed: 0, armRaise: 0, heldAmount: 0 },
  // Stands in for one of the others down there with you when the game's pose code is asked to pose a player here.
  playerStandIn: { figure: null, x: 0, z: 0, yaw: 0, pitch: 0, isCrouching: false, walkPhase: 0, stride: 0, armRaise: 0.2 },
  playerPitch: 0,         // a player: how far up or down they look (radians). The scanner points where they look.
  walkedDistance: 0,
  orbit: { yaw: Math.PI + 0.5, pitch: -0.1, distance: 4.4, height: 1.15 },
  drag: null,
  readoutElement: null, readoutTimer: 0, saveButton: null,
  design: null            // a creature made here, when one is open: its working copy and what is selected on it (22-workshop-creature-shapes.js)
};

function cloneCreatureWorkshopValue(value) {
  return Array.isArray(value) ? value.slice() : value;
}

function isSameCreatureWorkshopValue(first, second) {
  return JSON.stringify(first) === JSON.stringify(second);
}

function getCreatureWorkshopStageCenter() {
  return [WORKSHOP_ORIGIN_X + CREATURE_WORKSHOP_STAGE_SIZE / 2, WORKSHOP_ORIGIN_Z + CREATURE_WORKSHOP_STAGE_SIZE / 2];
}

// The numbers of this kind in 00-config.js that a slider here has changed.
function getCreatureWorkshopChangedSettings(kindKey) {
  return CREATURE_WORKSHOP_KINDS[kindKey].settingKeys.filter(function (key) { return Boolean(creatureWorkshop.settingOverrides[key]); });
}

function hasCreatureWorkshopChanges(kindKey) {
  // (A creature made here: changed since it was saved. One that has no file yet has no file's shape to show.)
  if (kindKey === CREATURE_WORKSHOP_DRAFT_KEY) return creatureWorkshop.design.isDirty && Boolean(creatureWorkshop.design.savedKey);
  return Object.keys(creatureWorkshop.overrides[kindKey]).length > 0 || getCreatureWorkshopChangedSettings(kindKey).length > 0;
}

// ---------------------------------------------------------------------------
// Changing proportions
// ---------------------------------------------------------------------------

function refreshCreatureWorkshopSaveButton() {
  const state = creatureWorkshop;
  if (!state.saveButton) return;
  if (state.design) { state.saveButton.textContent = state.design.isDirty ? 'Save *' : 'Saved'; return; }
  const count = Object.keys(state.overrides[state.kind]).length + getCreatureWorkshopChangedSettings(state.kind).length;
  state.saveButton.textContent = count > 0 ? 'Write to file * (' + count + ')' : 'Same as the file';
}

// `fingerIndex` is only given for one entry of a list (fingerLengths).
function setCreatureWorkshopProportion(key, value, fingerIndex) {
  const state = creatureWorkshop;
  if (state.design) { setCreatureWorkshopDesignProportion(key, value, fingerIndex); return; }
  const live = CREATURE_WORKSHOP_KINDS[state.kind].proportions, file = state.fileProportions[state.kind], overrides = state.overrides[state.kind];
  if (fingerIndex !== undefined) {
    live[key] = live[key].slice();
    live[key][fingerIndex] = value;
  } else live[key] = value;
  if (isSameCreatureWorkshopValue(live[key], file[key])) delete overrides[key];
  else overrides[key] = { base: cloneCreatureWorkshopValue(file[key]), value: cloneCreatureWorkshopValue(live[key]) };
  refreshCreatureWorkshopSaveButton();
  markWorkshopStateChanged();
}

// One of a creature's numbers in 00-config.js: how tall it is. The whole game uses it at once, like the proportions.
function setCreatureWorkshopSetting(key, value) {
  const state = creatureWorkshop;
  TUNING[key] = value;
  if (value === state.fileSettings[key]) delete state.settingOverrides[key];
  else state.settingOverrides[key] = { base: state.fileSettings[key], value: value };
  refreshCreatureWorkshopSaveButton();
  markWorkshopStateChanged();
}

// How tall the body being worked on stands when it is doing nothing.
function getCreatureWorkshopStandingHeight() {
  const kind = CREATURE_WORKSHOP_KINDS[creatureWorkshop.kind];
  return kind.heightTuningKey ? TUNING[kind.heightTuningKey] : measureFigureHeight(kind.proportions, kind.bodyPlan);
}

// A creature whose height is not a number of its own (the Hollow, a Still): it is as tall as its proportions
// come to. So to make it this tall, every one of them is made larger or smaller by the same share. They are
// set like so many sliders moved at once, and written to the file like them.
function setCreatureWorkshopHeight(height) {
  const state = creatureWorkshop, kind = CREATURE_WORKSHOP_KINDS[state.kind];
  if (state.design) { setCreatureWorkshopDesignHeight(height); return; } // (what is fixed to its bones is made larger or smaller with it)
  const fitted = fitFigureProportionsToHeight(kind.proportions, kind.bodyPlan, height);
  const round = function (value) { return Math.round(value * 1000) / 1000; };
  for (const key in fitted) {
    if (typeof fitted[key] === 'number') setCreatureWorkshopProportion(key, round(fitted[key]));
    else if (Array.isArray(fitted[key])) fitted[key].forEach(function (value, index) { setCreatureWorkshopProportion(key, round(value), index); });
  }
}

function resetCreatureWorkshopProportions() {
  const state = creatureWorkshop;
  if (!hasCreatureWorkshopChanges(state.kind)) return;
  const live = CREATURE_WORKSHOP_KINDS[state.kind].proportions, file = state.fileProportions[state.kind];
  for (const key in file) live[key] = cloneCreatureWorkshopValue(file[key]);
  state.overrides[state.kind] = {};
  for (const key of CREATURE_WORKSHOP_KINDS[state.kind].settingKeys) { TUNING[key] = state.fileSettings[key]; delete state.settingOverrides[key]; }
  markWorkshopStateChanged();
  renderWorkshopPanel();
  setWorkshopStatus('Back to the numbers in 04-figures.js' + (CREATURE_WORKSHOP_KINDS[state.kind].settingKeys.length > 0 ? ' and 00-config.js.' : '.'), 'info');
}

function describeCreatureWorkshopChanges() {
  const overrides = creatureWorkshop.overrides[creatureWorkshop.kind];
  return Object.keys(overrides).map(function (key) {
    const value = overrides[key].value;
    return key + ': ' + (Array.isArray(value) ? '[' + value.map(formatWorkshopNumber).join(', ') + ']' : formatWorkshopNumber(value));
  }).concat(getCreatureWorkshopChangedSettings(creatureWorkshop.kind).map(function (key) {
    return key + ': ' + formatWorkshopNumber(creatureWorkshop.settingOverrides[key].value) + ' (in 00-config.js)';
  })).join(', ');
}

function saveCreatureWorkshop() {
  const state = creatureWorkshop;
  if (state.design) { saveCreatureWorkshopDesign(); return; }
  const kind = CREATURE_WORKSHOP_KINDS[state.kind], overrides = state.overrides[state.kind];
  const keys = Object.keys(overrides), settingKeys = getCreatureWorkshopChangedSettings(state.kind);
  if (keys.length === 0 && settingKeys.length === 0) { setWorkshopStatus('Nothing to write: the body is the same as in 04-figures.js.', 'info'); return; }
  if (!workshop.hasServer) {
    copyWorkshopText(describeCreatureWorkshopChanges(), 'changed values (no dev server to write them: paste them into FIGURE_PROPORTIONS_' + kind.constantName + ')');
    return;
  }
  const values = {}, settings = {};
  for (const key of keys) values[key] = overrides[key].value;
  for (const key of settingKeys) settings[key] = state.settingOverrides[key].value;
  callWorkshopServer('/dev/save-proportions', { figure: kind.constantName, values: values, settings: settings }).then(function (result) {
    // What was written is now what the file holds.
    for (const key of keys) {
      if (result.missingKeys.indexOf(key) >= 0) continue;
      state.fileProportions[state.kind][key] = cloneCreatureWorkshopValue(values[key]);
      delete overrides[key];
    }
    for (const key of settingKeys) {
      if ((result.missingSettings || []).indexOf(key) >= 0) continue;
      state.fileSettings[key] = settings[key];
      delete state.settingOverrides[key];
    }
    saveWorkshopState();
    renderWorkshopPanel();
    const missing = result.missingKeys.concat(result.missingSettings || []);
    if (missing.length > 0) setWorkshopStatus('Written, except ' + missing.join(', ') + ': not found in FIGURE_PROPORTIONS_' + kind.constantName + ' or in TUNING.', 'warning');
    else setWorkshopStatus('Wrote ' + keys.length + ' number(s) to FIGURE_PROPORTIONS_' + kind.constantName + ' in src/js/04-figures.js' +
      (settingKeys.length > 0 ? ' and ' + settingKeys.join(', ') + ' to TUNING in src/js/00-config.js.' : '.'), 'good');
  }).catch(function (error) {
    setWorkshopStatus('Not written: ' + error.message, 'warning');
  });
}

// ---------------------------------------------------------------------------
// The test room and the bodies in it
// ---------------------------------------------------------------------------

function rebuildCreatureWorkshopStage() {
  const state = creatureWorkshop;
  state.needsStage = false;
  const kind = CREATURE_WORKSHOP_KINDS[state.kind];
  prepareWorkshopWorld('Workshop · ' + kind.label);
  ZONE_NAMES.push('UNSURVEYED', 'TEST ROOM');
  clearPlacement();
  placement.zone = 1;
  carveRoom(WORKSHOP_ORIGIN_X, WORKSHOP_ORIGIN_Z, WORKSHOP_ORIGIN_X + CREATURE_WORKSHOP_STAGE_SIZE, WORKSHOP_ORIGIN_Z + CREATURE_WORKSHOP_STAGE_SIZE, state.ceiling, ZONE_GENERATED_ROOM);
  finishWorkshopWorld();

  const center = getCreatureWorkshopStageCenter();
  const otherKind = CREATURE_WORKSHOP_KINDS[getCreatureWorkshopOtherKindKey()];
  state.figure = createFigure(kind.proportions, kind.surfaceClass, state.hasGameImprints ? kind.imprintTuningKey : 'workshopImprintSeconds');
  state.figure.keepsBones = true; // a creature made here is taken hold of bone by bone
  // (The file's shape of a creature made here is the kind its file became: its proportions, and what is on its bones.
  // One that has no file yet has no other shape than its own.)
  state.originalFigure = createFigure(state.design ? FIGURE_KINDS[state.design.savedKey || CREATURE_WORKSHOP_DRAFT_KEY].proportions : state.fileProportions[state.kind], kind.surfaceClass, kind.imprintTuningKey);
  state.otherFigure = createFigure(otherKind.proportions, otherKind.surfaceClass, otherKind.imprintTuningKey);
  state.figure.x = center[0]; state.figure.z = center[1];
  state.originalFigure.x = center[0] + 1.5; state.originalFigure.z = center[1];
  state.otherFigure.x = center[0] - 1.5; state.otherFigure.z = center[1];
  state.otherFigure.pose.armRaise = 0.04;
  state.standIn.figure = state.figure;
  state.standIn.walkPhase = 0; state.standIn.currentSpeed = 0; state.standIn.armRaise = 0.06; state.standIn.heldAmount = 0;
  state.playerStandIn.figure = state.figure;
  state.playerStandIn.walkPhase = 0; state.playerStandIn.stride = 0; state.playerStandIn.armRaise = OTHER_PLAYER_ARM_AT_SIDE;
  state.walkedDistance = 0;
  // Only the body being worked on answers the scanner; the two beside it are there to compare shapes.
  setFigureRaycastable(state.figure, true);
  applyCreatureWorkshopStoredPose();
}

function applyCreatureWorkshopStoredPose() {
  const stored = workshop.stored.creatures.manualPose;
  if (!stored || creatureWorkshop.behaviour !== 'manual') return;
  for (const field of CREATURE_WORKSHOP_POSE_FIELDS) {
    if (Number.isFinite(stored[field[0]])) creatureWorkshop.figure.pose[field[0]] = clampNumber(stored[field[0]], field[2], field[3]);
  }
}

// Poses the body for what it is set to be doing, using the game's own pose code wherever there is any.
function updateCreatureWorkshopPose(dt) {
  const state = creatureWorkshop;
  const figure = state.figure, pose = figure.pose, standIn = state.standIn;
  const actsLike = CREATURE_WORKSHOP_KINDS[state.kind].actsLike;
  const center = getCreatureWorkshopStageCenter();
  const towardCamera = Math.atan2(player.x - figure.x, -(player.z - figure.z));
  const behaviour = state.behaviour;
  let facesCamera = false;
  figure.x = center[0]; figure.z = center[1];
  standIn.currentSpeed = 0;

  if (behaviour === 'manual') {
    // Left exactly as the sliders put it.
  } else if (actsLike === 'player') {
    // What 11-together.js does with one of the others: the arm with the scanner goes out while they scan, the
    // legs go with how far they came, crouched they are bent at the knees and lean, and the forearm (and the
    // scanner on it) points where they look.
    const other = state.playerStandIn;
    const isScanning = /canning$/.test(behaviour), isWalking = /alking$/.test(behaviour) || behaviour.indexOf('walking') === 0;
    other.figure = figure; other.x = figure.x; other.z = figure.z; other.yaw = figure.yaw; other.pitch = state.playerPitch;
    other.isCrouching = behaviour.indexOf('crouched') === 0;
    const speed = !isWalking ? 0 : (other.isCrouching ? TUNING.crouchSpeed : TUNING.walkSpeed);
    standIn.currentSpeed = speed; // (for the readout)
    other.stride = approachValue(other.stride, isWalking ? 1 : 0, dt * 6);
    other.armRaise = approachValue(other.armRaise, isScanning ? OTHER_PLAYER_ARM_SCANNING : OTHER_PLAYER_ARM_AT_SIDE, dt * 5);
    if (state.isTurning) other.yaw = wrapAngleToPi(other.yaw + dt * 0.6);
    placeOtherPlayerFigure(other, speed * dt); // (it walks on the spot)
  } else if (behaviour === 'caught') {
    // What updateDying (11-game.js) does to whichever of them reaches you.
    pose.armRaise = approachValue(pose.armRaise, 1.45, dt * 3);
    pose.fingerSplay = 1;
    pose.headTilt = (Math.random() - 0.5) * 1.1;
    facesCamera = true;
  } else if (actsLike === 'hollow') { // (posed as the Hollow itself is: by what it is doing)
    const isHunting = behaviour === 'hunt' || behaviour === 'enraged' || behaviour === 'held';
    const isListening = behaviour === 'listen';
    standIn.heldAmount = approachValue(standIn.heldAmount, behaviour === 'held' ? 1 : 0, dt * 5);
    let speed = 0;
    if (behaviour === 'roam') speed = TUNING.hollowRoamSpeed;
    else if (behaviour === 'investigate') speed = TUNING.hollowInvestigateSpeed;
    else if (behaviour === 'hunt' || behaviour === 'held') speed = TUNING.hollowHuntSpeed;
    else if (behaviour === 'enraged') speed = TUNING.hollowEnragedSpeed;
    speed *= interpolateLinear(1, TUNING.hollowHeldSpeedFactor, standIn.heldAmount);
    // It walks on the spot: the stride comes from the speed it would be moving at.
    standIn.currentSpeed = speed;
    standIn.walkPhase += speed * dt * 2.3;
    poseHollow(standIn, isHunting, isListening, dt);
    facesCamera = standIn.heldAmount > 0.3; // held in the beam it turns its whole body toward the emitter
  } else if (behaviour === 'advancing') {
    // It walks at the camera from a few metres back, again and again, posed by its position as in the game.
    state.walkedDistance += TUNING.stillSpeed * dt;
    if (state.walkedDistance > 4.2) { state.walkedDistance = 0; pose.armRaise = 0.04; }
    const offsetX = player.x - center[0], offsetZ = player.z - center[1];
    const cameraDistance = Math.max(0.5, Math.sqrt(offsetX * offsetX + offsetZ * offsetZ));
    const along = state.walkedDistance - 2.6;
    figure.x = center[0] + offsetX / cameraDistance * along; figure.z = center[1] + offsetZ / cameraDistance * along;
    standIn.currentSpeed = TUNING.stillSpeed;
    poseAdvancingStill(figure, distanceBetweenPoints(figure.x, figure.z, player.x, player.z));
    facesCamera = true;
  } else {
    // A dummy as it stands in the store.
    pose.legSwing = 0; pose.kneeBend = 0; pose.squat = 0; pose.armSwing = 0; pose.armRaise = 0.04; pose.elbowBend = 0.1; pose.lean = 0; pose.headTilt = 0;
  }

  if (facesCamera) figure.yaw += clampNumber(wrapAngleToPi(towardCamera - figure.yaw), -dt * 6, dt * 6);
  else if (state.isTurning && !(actsLike === 'player' && behaviour !== 'manual')) figure.yaw = wrapAngleToPi(figure.yaw + dt * 0.6); // (a player was turned above, with the rest of its pose)
  updateFigureCapsules(figure);

  // The file's shape stands beside it in the same pose, so the two can be compared limb for limb.
  const original = state.originalFigure;
  for (const key in pose) original.pose[key] = pose[key];
  original.yaw = figure.yaw;
  updateFigureCapsules(original);
  state.otherFigure.yaw = figure.yaw;
  updateFigureCapsules(state.otherFigure);
}

function getCreatureWorkshopHeight(figure) {
  return (figure.boundsCenterY - figure.y) * 2;
}

function buildCreatureWorkshopReadout() {
  const state = creatureWorkshop;
  const lines = [];
  lines.push('height now     ' + getCreatureWorkshopHeight(state.figure).toFixed(2) + ' m');
  if (hasCreatureWorkshopChanges(state.kind)) lines.push('with the file  ' + getCreatureWorkshopHeight(state.originalFigure).toFixed(2) + ' m  (grey, beside it)');
  const fittedTo = CREATURE_WORKSHOP_KINDS[state.kind].heightTuningKey;
  if (fittedTo) lines.push('made to be     ' + TUNING[fittedTo].toFixed(2) + ' m  (' + fittedTo + ', 00-config.js: the sliders give it its shape, not its height)');
  if (CREATURE_WORKSHOP_KINDS[state.kind].actsLike === 'player') {
    // The body is what the others see. Where you bump your head and where you see from are numbers of their
    // own, in 00-config.js: these lines are for keeping the three in step. (Marked on the pole as well.)
    const isCrouched = state.behaviour.indexOf('crouched') === 0, figure = state.figure;
    const light = getFigureScannerLight(figure, { x: 0, y: 0, z: 0 });
    lines.push('you bump at    ' + (isCrouched ? TUNING.playerHeightCrouching : TUNING.playerHeight).toFixed(2) + ' m  (' + (isCrouched ? 'playerHeightCrouching' : 'playerHeight') + ', 00-config.js: red)');
    lines.push('you see from   ' + (isCrouched ? (TUNING.playerHeightCrouching * TUNING.playerEyeHeightToCrouchedBody) : (TUNING.playerHeight * TUNING.playerEyeHeightToBody)).toFixed(2) + ' m  (' + (isCrouched ? 'playerEyeHeightToCrouchedBody' : 'playerEyeHeightToBody') + ' of that: teal. Your light starts there for the others)');
    lines.push('head, middle   ' + (getFigureHeadHeight(figure) - figure.y).toFixed(2) + ' m');
    lines.push('scanner light  ' + (light.y - figure.y).toFixed(2) + ' m');
  }
  const onItsBones = state.figure.builtShape ? state.figure.builtShape.parts.length : 0;
  lines.push('made of        ' + (state.figure.capsuleCount + state.figure.rodCount + state.figure.boxCount) + ' shapes' + (onItsBones > 0 ? ', ' + onItsBones + ' of them fixed to its bones' : ''));
  lines.push('moving at      ' + state.standIn.currentSpeed.toFixed(1) + ' m/s  (you sprint ' + TUNING.sprintSpeed + ')');
  lines.push('pole           a mark every 0.5 m');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The camera: it circles the body
// ---------------------------------------------------------------------------

function placeCreatureWorkshopCamera() {
  const state = creatureWorkshop, orbit = state.orbit;
  const center = getCreatureWorkshopStageCenter();
  orbit.distance = clampNumber(orbit.distance, 1.1, CREATURE_WORKSHOP_STAGE_SIZE / 2 - 0.6);
  orbit.pitch = clampNumber(orbit.pitch, -1.25, 0.6);
  orbit.height = clampNumber(orbit.height, 0.1, state.ceiling - 0.2);
  const cosinePitch = Math.cos(orbit.pitch);
  const x = center[0] - Math.sin(orbit.yaw) * cosinePitch * orbit.distance;
  const z = center[1] + Math.cos(orbit.yaw) * cosinePitch * orbit.distance;
  const y = clampNumber(orbit.height - Math.sin(orbit.pitch) * orbit.distance, 0.12, state.ceiling - 0.12);
  placeWorkshopCamera(x, y, z, orbit.yaw, orbit.pitch);
}

function updateCreatureWorkshop(dt) {
  const state = creatureWorkshop, orbit = state.orbit, keys = input.keysDown;
  if (state.needsStage) rebuildCreatureWorkshopStage();
  // (Not while a hand is still on a slider or in a number box: putting the panel out again would take it away.)
  if (state.needsProportionFields && !(document.activeElement && document.activeElement.tagName === 'INPUT')) { state.needsProportionFields = false; renderWorkshopPanel(); }
  orbit.yaw = wrapAngleToPi(orbit.yaw + ((keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0)) * dt * 1.4);
  orbit.distance += ((keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0)) * dt * 2.5;
  orbit.height += ((keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0)) * dt * 1.2;
  input.lookDeltaX = 0; input.lookDeltaY = 0;
  placeCreatureWorkshopCamera();
  updateCreatureWorkshopPose(dt);

  // The scanner views: pulses are fired at the body all the time, and each point lasts as long as the game lets it.
  if (state.view !== 'solid') {
    const figure = state.figure;
    computeScannerBasis(player.yaw, player.pitch);
    const basis = scannerBasis;
    const offsetX = figure.x - player.x, offsetY = figure.boundsCenterY - getPlayerEyeY(), offsetZ = figure.z - player.z;
    const ahead = offsetX * basis.forwardX + offsetY * basis.forwardY + offsetZ * basis.forwardZ;
    if (ahead > 0.3) {
      const spread = figure.boundsRadius * 1.1 / ahead;
      fireWorkshopScan(CREATURE_WORKSHOP_SCAN_RAYS,
        (offsetX * basis.rightX + offsetY * basis.rightY + offsetZ * basis.rightZ) / ahead,
        (offsetX * basis.upX + offsetY * basis.upY + offsetZ * basis.upZ) / ahead, spread, spread);
    }
  }

  state.readoutTimer -= dt;
  if (state.readoutTimer <= 0 && state.readoutElement) {
    state.readoutTimer = 0.2;
    state.readoutElement.textContent = buildCreatureWorkshopReadout();
  }
}

function addCreatureWorkshopOverlays(data) {
  const state = creatureWorkshop;
  const kind = CREATURE_WORKSHOP_KINDS[state.kind];
  if (state.view !== 'scanned') data.figures.push({ figure: state.figure, red: kind.color[0], green: kind.color[1], blue: kind.color[2] });
  if (state.showsOriginal && hasCreatureWorkshopChanges(state.kind)) data.figures.push({ figure: state.originalFigure, red: 0.42, green: 0.5, blue: 0.62 });
  if (state.showsOther) {
    const other = CREATURE_WORKSHOP_KINDS[getCreatureWorkshopOtherKindKey()];
    data.figures.push({ figure: state.otherFigure, red: other.color[0] * 0.6, green: other.color[1] * 0.6, blue: other.color[2] * 0.6 });
  }
  // A measuring pole behind the body: a mark every half metre, a longer one every metre,
  // and a line across at the height of the top of its head.
  const center = getCreatureWorkshopStageCenter();
  const poleX = center[0] + 0.75, poleZ = center[1] + 0.75;
  pushDebugLine(poleX, 0, poleZ, poleX, 3, poleZ, 0.45, 0.6, 0.7);
  for (let mark = 1; mark <= 6; mark++) {
    const length = mark % 2 === 0 ? 0.16 : 0.08;
    pushDebugLine(poleX - length, mark * 0.5, poleZ, poleX + length, mark * 0.5, poleZ, 0.45, 0.6, 0.7);
    pushDebugLine(poleX, mark * 0.5, poleZ - length, poleX, mark * 0.5, poleZ + length, 0.45, 0.6, 0.7);
  }
  const top = getCreatureWorkshopHeight(state.figure);
  pushDebugLine(poleX, top, poleZ, state.figure.x, top, state.figure.z, 1.0, 0.8, 0.2);
  if (kind.actsLike === 'player') {
    // A player: where the game has you bump your head (red) and where it has you see from (teal), for this pose.
    const isCrouched = state.behaviour.indexOf('crouched') === 0;
    const bump = isCrouched ? TUNING.playerHeightCrouching : TUNING.playerHeight, eye = isCrouched ? (TUNING.playerHeightCrouching * TUNING.playerEyeHeightToCrouchedBody) : (TUNING.playerHeight * TUNING.playerEyeHeightToBody);
    pushDebugLine(poleX, bump, poleZ, state.figure.x, bump, state.figure.z, 1.0, 0.35, 0.3);
    pushDebugLine(poleX, eye, poleZ, state.figure.x, eye, state.figure.z, 0.3, 0.9, 0.85);
  }
  if (state.design) addCreatureWorkshopDesignOverlays();
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

function describeCreatureWorkshopKey(key) {
  return key.replace(/([A-Z])/g, ' $1').toLowerCase();
}

function addCreatureWorkshopProportionField(body, key, value, fingerIndex) {
  const file = creatureWorkshop.fileProportions[creatureWorkshop.kind][key];
  // (A creature made here that has just been given another skeleton has numbers its file does not.)
  const fileValue = file === undefined ? value : (fingerIndex === undefined ? file : file[fingerIndex]);
  const isThickness = /Radius$/.test(key);
  const label = describeCreatureWorkshopKey(key).replace(/ radius$/, ' thickness (radius)') +
    (fingerIndex === undefined ? '' : ': ' + CREATURE_WORKSHOP_FINGER_NAMES[fingerIndex] + ' finger');
  // Room to at least double anything, and never less than a sensible span for its kind.
  const maximum = Math.max(isThickness ? 0.4 : 1.2, Math.ceil(fileValue * 2.5 * 10) / 10);
  const field = addWorkshopNumber(body, label, value, isThickness ? 0.005 : 0, maximum, 0.005, function (newValue) {
    setCreatureWorkshopProportion(key, newValue, fingerIndex);
  });
  field.element.title = (creatureWorkshop.design ? 'In its file: ' : 'In 04-figures.js: ') + formatWorkshopNumber(fileValue);
  field.element.id = 'workshop-proportion-' + key + (fingerIndex === undefined ? '' : '-' + fingerIndex);
}

function renderCreatureWorkshopPanel(body) {
  const state = creatureWorkshop;
  const kind = CREATURE_WORKSHOP_KINDS[state.kind];

  addWorkshopSelect(body, 'Creature', state.design ? state.design.key : state.kind, getCreatureWorkshopChoices(), function (key) {
    if (key !== (state.design ? state.design.key : state.kind) && mayDiscardCreatureWorkshopChanges()) openCreatureInWorkshop(key);
    renderWorkshopPanel();
  }).id = 'workshop-creature';
  let row = addWorkshopRow(body);
  addWorkshopButton(row, 'New creature', function () { createNewWorkshopCreature(false); }, 'A body of your own: a skeleton, and the shapes you fix to its bones').id = 'workshop-new-creature';
  addWorkshopButton(row, 'Copy of this', function () { createNewWorkshopCreature(true); }, 'A new creature that starts out as this one').id = 'workshop-copy-creature';
  if (state.design) addWorkshopButton(row, 'Delete', deleteCreatureWorkshopDesign);
  row = addWorkshopRow(body);
  if (state.design) {
    state.saveButton = addWorkshopButton(row, 'Save', saveCreatureWorkshop, workshop.hasServer ? 'Ctrl+S: writes src/creatures/' + state.design.key + '.json' : 'No dev server: downloads the file instead');
    addWorkshopButton(row, 'Undo', function () { stepCreatureWorkshopHistory(state.design.undoStack, state.design.redoStack); }, 'Ctrl+Z');
    addWorkshopButton(row, 'Redo', function () { stepCreatureWorkshopHistory(state.design.redoStack, state.design.undoStack); }, 'Ctrl+Y');
    addWorkshopButton(row, 'Revert', revertCreatureWorkshopDesign, 'Back to the last saved state');
    state.design.problemsElement = body.appendChild(createDebugElement('ul', 'workshop-problems'));
    state.design.problemsElement.id = 'workshop-problems';
    refreshCreatureWorkshopProblems();
  } else {
    state.saveButton = addWorkshopButton(row, 'Write to file', saveCreatureWorkshop,
      workshop.hasServer ? 'Ctrl+S: writes the changed numbers into FIGURE_PROPORTIONS_' + kind.constantName + ' in src/js/04-figures.js' : 'No dev server: copies the changed numbers instead');
    addWorkshopButton(row, 'Copy changes', function () {
      if (hasCreatureWorkshopChanges(state.kind)) copyWorkshopText(describeCreatureWorkshopChanges(), 'changed values');
      else setWorkshopStatus('Nothing has been changed.', 'info');
    }, 'The changed numbers as text, to paste into the source');
    addWorkshopButton(row, 'Back to the file', resetCreatureWorkshopProportions, 'Throws the changes away').id = 'workshop-reset-creature';
    addWorkshopNote(body, 'This kind is written as code: its proportions can be changed here, and are written to 04-figures.js. To leave parts of it out or to fix other shapes to its bones, make a creature of your own from it: "Copy of this".');
  }
  state.saveButton.id = 'workshop-save-creature';
  state.saveButton.classList.add('workshop-main-button');
  refreshCreatureWorkshopSaveButton();
  state.readoutElement = body.appendChild(createDebugElement('pre', 'debug-readout'));
  state.readoutElement.id = 'workshop-creature-readout';
  state.readoutTimer = 0;

  // How tall it is. A kind that has a number for that in 00-config.js gets a slider on the number (and one on how
  // tall it is crouched, if it has that too); any other is made larger or smaller as a whole.
  addWorkshopHeading(body, 'Height');
  if (kind.heightTuningKey) {
    for (const key of kind.settingKeys) {
      const field = addWorkshopNumber(body, (key === kind.heightTuningKey ? 'Standing' : 'Crouched') + ' (m): ' + key + ' in 00-config.js', TUNING[key], 0.3, 3, 0.01, function (value) { setCreatureWorkshopSetting(key, value); });
      field.element.title = 'In 00-config.js: ' + formatWorkshopNumber(state.fileSettings[key]);
      field.element.id = key === kind.heightTuningKey ? 'workshop-creature-height' : 'workshop-creature-height-crouched';
    }
    addWorkshopNote(body, state.design
      ? 'A body a player can wear is as tall as a player is: playerHeight in 00-config.js, and playerHeightCrouching crouched (both are set at "A player"). The whole body is made to fit, with everything on its bones, so its proportions and the sizes of its shapes are shares of one another.'
      : 'The body is made to fit these, whatever its proportions are: they give it its shape.');
  } else {
    const field = addWorkshopNumber(body, 'Standing (m): every number below, larger or smaller by the same share', Math.round(getCreatureWorkshopStandingHeight() * 100) / 100, 0.3, 4, 0.01, function (value) {
      setCreatureWorkshopHeight(value);
      state.needsProportionFields = true; // the sliders below have all moved: they are put out again (updateCreatureWorkshop), once the hand is off this one
    });
    field.element.id = 'workshop-creature-height';
  }

  addWorkshopHeading(body, 'Look');
  addWorkshopSelect(body, 'Shown as', state.view, [['solid', 'A solid body'], ['scanned', 'What the scanner shows (as in the game)'], ['both', 'Both at once']], function (view) {
    state.view = view;
    // The game's own look needs the dark; a solid body is easier to judge with the lights on.
    if (view === 'scanned') setWorkshopLights(false);
    if (view === 'solid') setWorkshopLights(true);
    markWorkshopStateChanged();
    renderWorkshopPanel();
  }).id = 'workshop-creature-view';
  addWorkshopCheckbox(body, 'Lights on (L)', workshop.isLit, function (isLit) { setWorkshopLights(isLit); });
  if (state.view !== 'solid') {
    addWorkshopCheckbox(body, 'Points on it last as long as in the game (' + TUNING[kind.imprintTuningKey] + ' s)', state.hasGameImprints, function (isOn) {
      state.hasGameImprints = isOn;
      state.figure.imprintTuningKey = isOn ? kind.imprintTuningKey : 'workshopImprintSeconds';
      markWorkshopStateChanged();
    }, 'Off: they fade in half a second, so the cloud shows the body as it is now. On: every place it has stood in the last seconds stays lit, as in play.');
  }
  addWorkshopCheckbox(body, 'The file\'s shape beside it, in grey (once something is changed)', state.showsOriginal, function (isOn) { state.showsOriginal = isOn; markWorkshopStateChanged(); });
  addWorkshopCheckbox(body, getCreatureWorkshopOtherKindKey() === 'dummy' ? 'A Still beside it, for scale (person-sized)' : 'The Hollow beside it, for scale', state.showsOther, function (isOn) { state.showsOther = isOn; markWorkshopStateChanged(); });
  addWorkshopCheckbox(body, 'Turn it slowly', state.isTurning, function (isOn) { state.isTurning = isOn; markWorkshopStateChanged(); });
  addWorkshopNumber(body, 'Ceiling of the test room (m)', state.ceiling, 2.4, 9, 0.1, function (value) { state.ceiling = value; state.needsStage = true; markWorkshopStateChanged(); });
  addWorkshopNote(body, 'Drag to circle it, wheel to come closer. A and D also circle, E and Q raise and lower the view. Space scans it by hand.');

  addWorkshopHeading(body, 'What it is doing');
  addWorkshopSelect(body, '', state.behaviour, kind.behaviours, function (behaviour) {
    state.behaviour = behaviour;
    markWorkshopStateChanged();
    renderWorkshopPanel();
  }).id = 'workshop-creature-behaviour';
  if (state.behaviour === 'manual') {
    for (const field of CREATURE_WORKSHOP_POSE_FIELDS) {
      if (field[4] && !kind.hasHollowBody) continue;
      addWorkshopNumber(body, field[1], clampNumber(state.figure.pose[field[0]], field[2], field[3]), field[2], field[3], 0.01, function (value) {
        state.figure.pose[field[0]] = value;
        markWorkshopStateChanged();
      });
    }
  } else if (kind.actsLike === 'player') {
    addWorkshopNumber(body, 'Looking up or down (radians: the scanner points there)', state.playerPitch, -1.45, 1.45, 0.01, function (value) { state.playerPitch = value; markWorkshopStateChanged(); }).element.id = 'workshop-creature-pitch';
    addWorkshopNote(body, 'The pose is the game\'s own, from 11-together.js: what the others see of you down there. How tall you are is said once, in 00-config.js: playerHeight standing, playerHeightCrouching crouched (and playerEyeHeightToBody and playerEyeHeightToCrouchedBody for how far up those your eyes are). The body is made to fit both. Standing, all of it is made larger or smaller until it is playerHeight tall, so the sliders below give it its shape and not its height. Crouched, it goes down on its haunches as far as it takes. Red and teal on the pole are where you bump your head and where you see from. Choose "Posed by hand" to set every joint yourself.');
  } else {
    addWorkshopNote(body, 'The pose is the game\'s own, from 08-entities.js. Choose "Posed by hand" to set every joint yourself.');
  }

  // A creature made here: what is on its bones, and what it is.
  if (state.design) renderCreatureWorkshopDesignPanel(body);

  // Every number of the proportions object gets a slider, so one added to 04-figures.js shows up here by itself.
  const live = kind.proportions;
  const listed = {};
  const addGroup = function (title, keys) {
    const present = keys.filter(function (key) { return typeof live[key] === 'number' || Array.isArray(live[key]); });
    if (present.length === 0) return;
    addWorkshopHeading(body, title + (kind.heightTuningKey ? ' (as shares of one another: the whole is made ' + TUNING[kind.heightTuningKey] + ' m tall)' : ' (metres)'));
    for (const key of present) {
      listed[key] = true;
      if (Array.isArray(live[key])) live[key].forEach(function (value, index) { addCreatureWorkshopProportionField(body, key, value, index); });
      else addCreatureWorkshopProportionField(body, key, live[key]);
    }
  };
  for (const group of CREATURE_WORKSHOP_GROUPS) addGroup(group[0], group[1]);
  addGroup('Other', Object.keys(live).filter(function (key) { return !listed[key]; }));
}

// ---------------------------------------------------------------------------
// The mouse and the keyboard
// ---------------------------------------------------------------------------

function onCreatureWorkshopPointerDown(event) {
  creatureWorkshop.drag = { lastClientX: event.clientX, lastClientY: event.clientY, grab: null };
  // A creature made here: a click on it takes hold of a bone, or of a shape that is fixed to one.
  if (creatureWorkshop.design && event.button === 0) takeHoldOfCreatureWorkshopDesign(event);
}

function onCreatureWorkshopPointerMove(event) {
  const state = creatureWorkshop;
  if (!state.drag) return;
  if (state.drag.grab) { dragCreatureWorkshopPart(event); return; }
  state.orbit.yaw = wrapAngleToPi(state.orbit.yaw + (event.clientX - state.drag.lastClientX) * 0.007);
  state.orbit.pitch -= (event.clientY - state.drag.lastClientY) * 0.005;
  state.drag.lastClientX = event.clientX; state.drag.lastClientY = event.clientY;
}

function onCreatureWorkshopPointerUp() {
  const state = creatureWorkshop;
  if (!state.drag) return;
  const wasMoving = state.drag.grab && state.drag.grab.isMoving;
  state.drag = null;
  if (state.design) state.design.lastEditLabel = ''; // the next drag is its own step to undo
  markWorkshopStateChanged();
  if (wasMoving) renderWorkshopPanel(); // the list shows where the shapes are
}

function onCreatureWorkshopWheel(event) {
  creatureWorkshop.orbit.distance *= event.deltaY > 0 ? 1.1 : 0.9;
  markWorkshopStateChanged();
}

workshop.tools.creatures = {
  label: 'Creatures',
  // Runs when the page loads, workshop open or not: sliders set before a reload apply to the whole game again.
  initialize: function (stored) {
    const state = creatureWorkshop;
    const storedOverrides = stored.overrides && typeof stored.overrides === 'object' ? stored.overrides : {};
    // The creatures' numbers in 00-config.js, the same way: only if the file still holds what it held when the slider was moved.
    const storedSettings = stored.settings && typeof stored.settings === 'object' ? stored.settings : {};
    for (const kindKey in CREATURE_WORKSHOP_KINDS) {
      for (const key of CREATURE_WORKSHOP_KINDS[kindKey].settingKeys) {
        state.fileSettings[key] = TUNING[key];
        const override = storedSettings[key];
        if (!override || !Number.isFinite(override.value) || override.base !== TUNING[key] || override.value === TUNING[key]) continue;
        TUNING[key] = override.value;
        state.settingOverrides[key] = { base: state.fileSettings[key], value: override.value };
      }
    }
    for (const kindKey in CREATURE_WORKSHOP_KINDS) {
      const live = CREATURE_WORKSHOP_KINDS[kindKey].proportions;
      const file = {};
      for (const key in live) file[key] = cloneCreatureWorkshopValue(live[key]);
      state.fileProportions[kindKey] = file;
      state.overrides[kindKey] = {};
      const kindOverrides = storedOverrides[kindKey] && typeof storedOverrides[kindKey] === 'object' ? storedOverrides[kindKey] : {};
      for (const key in kindOverrides) {
        const override = kindOverrides[key];
        // Only if the file still holds what it held when the slider was moved: a number changed by hand since then wins.
        if (!override || !(key in file) || !isSameCreatureWorkshopValue(override.base, file[key]) || isSameCreatureWorkshopValue(override.value, file[key])) continue;
        if (typeof override.value !== typeof file[key] || Array.isArray(override.value) !== Array.isArray(file[key])) continue;
        live[key] = cloneCreatureWorkshopValue(override.value);
        state.overrides[kindKey][key] = { base: cloneCreatureWorkshopValue(file[key]), value: cloneCreatureWorkshopValue(override.value) };
      }
    }
  },
  open: function (stored) {
    const state = creatureWorkshop;
    // The creature that was open: a kind written as code, a creature made here, or work on one that is not saved yet.
    restoreCreatureWorkshopDesign(stored);
    if (!state.design && CREATURE_WORKSHOP_KINDS[stored.kind] && stored.kind !== CREATURE_WORKSHOP_DRAFT_KEY) state.kind = stored.kind;
    const kind = CREATURE_WORKSHOP_KINDS[state.kind];
    state.behaviour = kind.behaviours.some(function (choice) { return choice[0] === stored.behaviour; }) ? stored.behaviour : kind.behaviours[0][0];
    if (stored.view === 'solid' || stored.view === 'scanned' || stored.view === 'both') state.view = stored.view;
    if (typeof stored.showsOriginal === 'boolean') state.showsOriginal = stored.showsOriginal;
    if (typeof stored.showsOther === 'boolean') state.showsOther = stored.showsOther;
    if (typeof stored.isTurning === 'boolean') state.isTurning = stored.isTurning;
    if (typeof stored.hasGameImprints === 'boolean') state.hasGameImprints = stored.hasGameImprints;
    if (Number.isFinite(stored.ceiling)) state.ceiling = clampNumber(stored.ceiling, 2.4, 9);
    if (Number.isFinite(stored.playerPitch)) state.playerPitch = clampNumber(stored.playerPitch, -1.45, 1.45);
    if (stored.orbit && Number.isFinite(stored.orbit.yaw + stored.orbit.pitch + stored.orbit.distance + stored.orbit.height)) {
      state.orbit.yaw = stored.orbit.yaw; state.orbit.pitch = stored.orbit.pitch; state.orbit.distance = stored.orbit.distance; state.orbit.height = stored.orbit.height;
    }
    rebuildCreatureWorkshopStage();
    placeCreatureWorkshopCamera();
  },
  close: function () {
    creatureWorkshop.drag = null; creatureWorkshop.readoutElement = null; creatureWorkshop.saveButton = null;
    if (creatureWorkshop.design) creatureWorkshop.design.problemsElement = null;
  },
  storeState: function (stored) {
    const state = creatureWorkshop;
    stored.kind = state.design ? state.design.key : state.kind;
    storeCreatureWorkshopDesign(stored);
    stored.behaviour = state.behaviour;
    stored.view = state.view;
    stored.showsOriginal = state.showsOriginal;
    stored.showsOther = state.showsOther;
    stored.isTurning = state.isTurning;
    stored.hasGameImprints = state.hasGameImprints;
    stored.ceiling = state.ceiling;
    stored.playerPitch = state.playerPitch;
    stored.orbit = state.orbit;
    stored.overrides = state.overrides;
    stored.settings = state.settingOverrides;
    if (state.figure && state.behaviour === 'manual') stored.manualPose = Object.assign({}, state.figure.pose);
  },
  save: saveCreatureWorkshop,
  moveCameraInside: placeCreatureWorkshopCamera, // it always is: the camera circles inside the test room
  update: updateCreatureWorkshop,
  addOverlays: addCreatureWorkshopOverlays,
  renderPanel: renderCreatureWorkshopPanel,
  onPointerDown: onCreatureWorkshopPointerDown,
  onPointerMove: onCreatureWorkshopPointerMove,
  onPointerUp: onCreatureWorkshopPointerUp,
  onWheel: onCreatureWorkshopWheel,
  onKey: function (event) { return creatureWorkshop.design ? onCreatureWorkshopDesignKey(event) : false; }
};
