// ---------------------------------------------------------------------------
// Workshop, creature tool: a creature of your own.
//
// A creature made here is a skeleton with shapes on it (04-figures.js, 04-workshop-creatures.js). The skeleton
// is one of the game's own, so the body stands, walks and reaches by the game's own code; what is yours is how
// it is proportioned, which of the skeleton's own capsules it leaves out, and the boxes, balls, capsules,
// cylinders and cones that are fixed to its bones and turn with them. A body a player can wear is made the
// same way.
//
// The body on screen is taken hold of the way an object is in the object tool: click a bone to choose it, click
// a shape to select it, drag a shape to move it. A shape's numbers are metres in the directions of the bone it
// is on, as the creature stands at rest: x to its right, y up, z to its front, from where the bone starts. The
// three short lines on the chosen bone show them: red is x, green is y, blue is z.
//
// The working copy is the kind CREATURE_WORKSHOP_DRAFT_KEY for as long as it is open, so the rest of the tool
// (22-workshop-creatures.js) shows it like any other creature. It becomes a file, src/creatures/<key>.json,
// when it is saved.
// ---------------------------------------------------------------------------

const CREATURE_WORKSHOP_KEY_PATTERN = /^[a-z][A-Za-z0-9]{1,30}$/;
const CREATURE_WORKSHOP_AXIS_NAMES = ['x: to its right', 'y: up', 'z: to its front'];

function getCreatureWorkshopBones() {
  return FIGURE_SKELETONS[creatureWorkshop.design.creature.skeleton].bones;
}

function describeCreatureWorkshopBone(bone) {
  const label = getCreatureWorkshopBones()[bone].label;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// A clean copy of one shape on a bone: the shape itself, and which bone it is on.
function normalizeCreatureWorkshopPart(source) {
  return Object.assign({ bone: source.bone, mirror: source.mirror === true }, normalizeDesignedPart(source, DESIGNED_CREATURE_LIMITS));
}

// ---------------------------------------------------------------------------
// Which creature
// ---------------------------------------------------------------------------

function getCreatureWorkshopChoices() {
  const state = creatureWorkshop, design = state.design;
  const made = [], coded = [];
  for (const key in designedCreatures) {
    if (!design || key !== design.savedKey) made.push([key, designedCreatures[key].label]);
  }
  // The creature being worked on is listed under its current name, even before it has a file.
  if (design) made.unshift([design.key, design.creature.label + (design.savedKey ? (design.isDirty ? ' (changed)' : '') : ' (not saved yet)')]);
  for (const key in CREATURE_WORKSHOP_KINDS) {
    if (key !== CREATURE_WORKSHOP_DRAFT_KEY) coded.push([key, CREATURE_WORKSHOP_KINDS[key].label]);
  }
  return [['Made in the workshop', made], ['Written as code', coded]];
}

function mayDiscardCreatureWorkshopChanges() {
  const design = creatureWorkshop.design;
  if (!design || !design.isDirty) return true;
  return window.confirm('"' + design.creature.label + '" has changes that are not saved. Throw them away?');
}

// The working copy becomes the body on screen: called when a creature is opened, and after every change to it.
function applyCreatureWorkshopDesign() {
  const state = creatureWorkshop, design = state.design;
  const kind = FIGURE_KINDS[CREATURE_WORKSHOP_DRAFT_KEY] = createDesignedCreatureKind(Object.assign({}, design.creature, { key: CREATURE_WORKSHOP_DRAFT_KEY }));
  kind.isWorkingCopy = true;
  CREATURE_WORKSHOP_KINDS[CREATURE_WORKSHOP_DRAFT_KEY] = describeCreatureWorkshopKind(CREATURE_WORKSHOP_DRAFT_KEY);
  state.kind = CREATURE_WORKSHOP_DRAFT_KEY;
  state.overrides[CREATURE_WORKSHOP_DRAFT_KEY] = {};
  if (state.figure) {
    state.figure.proportions = kind.proportions;
    state.figure.surfaceClass = kind.surfaceClass;
    state.figure.imprintTuningKey = state.hasGameImprints ? kind.imprintTuningKey : 'workshopImprintSeconds';
  }
}

// What it does on screen must be something a body of its make can do: a creature given another skeleton, or
// made into a body a player can wear, is posed by another part of the game.
function settleCreatureWorkshopBehaviour() {
  const state = creatureWorkshop, behaviours = CREATURE_WORKSHOP_KINDS[state.kind].behaviours;
  if (behaviours.some(function (choice) { return choice[0] === state.behaviour; })) return;
  // Standing still if it can: that is how a body is best shaped.
  state.behaviour = behaviours.some(function (choice) { return choice[0] === 'standing'; }) ? 'standing' : 'manual';
}

function closeCreatureWorkshopDesign() {
  const state = creatureWorkshop;
  state.design = null;
  delete FIGURE_KINDS[CREATURE_WORKSHOP_DRAFT_KEY];
  delete CREATURE_WORKSHOP_KINDS[CREATURE_WORKSHOP_DRAFT_KEY];
  if (state.kind === CREATURE_WORKSHOP_DRAFT_KEY) state.kind = Object.keys(CREATURE_WORKSHOP_KINDS)[0];
}

// Opens a creature made here. `draft` (optional) is a working copy to carry on with instead of the creature's file.
function openCreatureWorkshopDesign(key, draft, savedKey) {
  const state = creatureWorkshop;
  const creature = normalizeDesignedCreature(draft || JSON.parse(JSON.stringify(designedCreatures[key])), key);
  state.design = {
    key: key,                 // the file name it will be saved under
    savedKey: draft ? (savedKey || null) : key, // the file it was opened from; null for one that has never been saved
    creature: creature,       // the working copy
    isDirty: Boolean(draft),  // the working copy differs from the file
    selectedIndex: -1,        // which of creature.parts is selected
    bone: '',                 // which bone is chosen: what "Add" fixes a shape to
    bothSides: true,          // what is done to an arm or a leg is done to the other
    problems: [], problemsElement: null,
    selectedSetters: {},      // setValue functions of the selected shape's place fields
    undoStack: [], redoStack: [], lastEditLabel: '', lastEditTime: -9999
  };
  const saved = state.design.savedKey ? designedCreatures[state.design.savedKey] : null;
  state.fileProportions[CREATURE_WORKSHOP_DRAFT_KEY] = JSON.parse(JSON.stringify((saved || creature).proportions));
  applyCreatureWorkshopDesign();
  settleCreatureWorkshopBehaviour();
  state.design.problems = findCreatureWorkshopProblems();
  state.drag = null;
  state.needsStage = true;
  markWorkshopStateChanged();
}

// Opens a creature by its key: one made here, or a kind written as code.
function openCreatureInWorkshop(key) {
  const state = creatureWorkshop;
  if (designedCreatures[key]) { openCreatureWorkshopDesign(key); return; }
  closeCreatureWorkshopDesign();
  if (CREATURE_WORKSHOP_KINDS[key]) state.kind = key;
  state.behaviour = CREATURE_WORKSHOP_KINDS[state.kind].behaviours[0][0];
  state.needsStage = true;
  markWorkshopStateChanged();
}

// A new creature: a plain person, or a copy of the one that is open (which may be a kind written as code).
function createNewWorkshopCreature(isCopy) {
  const state = creatureWorkshop;
  if (!mayDiscardCreatureWorkshopChanges()) return;
  const baseKey = isCopy ? (state.design ? state.design.key : state.kind) + 'Copy' : 'newCreature';
  let key = baseKey;
  for (let number = 2; FIGURE_KINDS[key] || (state.design && state.design.key === key); number++) key = baseKey + number;
  let draft = { label: 'new creature', skeleton: 'person' };
  if (isCopy && state.design) {
    draft = JSON.parse(JSON.stringify(state.design.creature));
    draft.label = (draft.label + ' copy').slice(0, 40);
  } else if (isCopy) {
    // A kind written as code: its skeleton and its proportions as they are now, and nothing on its bones.
    const kind = FIGURE_KINDS[state.kind], proportions = JSON.parse(JSON.stringify(kind.proportions));
    delete proportions.kind;
    let scansAs = 'still';
    for (const scanKey in DESIGNED_CREATURE_SCANS) if (DESIGNED_CREATURE_SCANS[scanKey].surfaceClass === kind.surfaceClass) scansAs = scanKey;
    draft = { label: (kind.label + ' copy').slice(0, 40), skeleton: kind.bodyPlan, scansAs: scansAs, playerSkin: kind.holdsScanner === true, proportions: proportions };
  }
  openCreatureWorkshopDesign(key, draft, null);
  renderWorkshopPanel();
  setWorkshopStatus((isCopy ? 'A copy to work on.' : 'A new creature.') + ' It becomes a file when you save it.', 'info');
}

// ---------------------------------------------------------------------------
// Things that would go wrong
// ---------------------------------------------------------------------------

function findCreatureWorkshopProblems() {
  const design = creatureWorkshop.design, creature = design.creature, problems = [];
  if (!CREATURE_WORKSHOP_KEY_PATTERN.test(design.key)) problems.push('The file name must start with a small letter and have only letters and digits.');
  else if (design.key !== design.savedKey && FIGURE_KINDS[design.key]) problems.push('There is already a creature called "' + design.key + '". Choose another file name.');
  if (creature.parts.length === 0 && creature.hides.length >= Object.keys(getCreatureWorkshopBones()).length) {
    problems.push('All of the skeleton is left out and nothing is fixed to its bones: there is nothing of it for a scan to land on.');
  }
  return problems;
}

function refreshCreatureWorkshopProblems() {
  const design = creatureWorkshop.design, list = design.problemsElement;
  if (!list) return;
  list.textContent = '';
  if (design.problems.length === 0) list.appendChild(createDebugElement('li', 'is-fine', 'Nothing wrong with it.'));
  for (const problem of design.problems) list.appendChild(createDebugElement('li', '', problem));
}

// ---------------------------------------------------------------------------
// Changing the creature
// ---------------------------------------------------------------------------

// Call before every change. Changes of the same kind in quick succession (a slider being dragged) are one step to undo.
function beginCreatureWorkshopEdit(label) {
  const design = creatureWorkshop.design;
  const now = window.performance.now();
  if (label !== design.lastEditLabel || now - design.lastEditTime > 700) {
    design.undoStack.push(JSON.stringify({ key: design.key, creature: design.creature, selectedIndex: design.selectedIndex, bone: design.bone }));
    if (design.undoStack.length > 120) design.undoStack.shift();
    design.redoStack.length = 0;
  }
  design.lastEditLabel = label;
  design.lastEditTime = now;
}

// Call after every change.
function finishCreatureWorkshopEdit() {
  const design = creatureWorkshop.design;
  design.isDirty = true;
  applyCreatureWorkshopDesign();
  design.problems = findCreatureWorkshopProblems();
  refreshCreatureWorkshopProblems();
  refreshCreatureWorkshopSaveButton();
  markWorkshopStateChanged();
}

function stepCreatureWorkshopHistory(fromStack, toStack) {
  const state = creatureWorkshop, design = state.design;
  if (!design || fromStack.length === 0) return;
  toStack.push(JSON.stringify({ key: design.key, creature: design.creature, selectedIndex: design.selectedIndex, bone: design.bone }));
  const restored = JSON.parse(fromStack.pop());
  // (Another skeleton, or a body a player can wear or not: it is posed by another part of the game.)
  if (restored.creature.skeleton !== design.creature.skeleton || restored.creature.playerSkin !== design.creature.playerSkin) state.needsStage = true;
  design.key = restored.key; // the file name can be undone too
  design.creature = normalizeDesignedCreature(restored.creature, design.key);
  design.selectedIndex = Math.min(restored.selectedIndex, design.creature.parts.length - 1);
  design.bone = getCreatureWorkshopBones()[restored.bone] ? restored.bone : '';
  design.lastEditLabel = '';
  finishCreatureWorkshopEdit();
  settleCreatureWorkshopBehaviour();
  renderWorkshopPanel();
}

function setCreatureWorkshopDesignProportion(key, value, fingerIndex) {
  const proportions = creatureWorkshop.design.creature.proportions;
  beginCreatureWorkshopEdit('proportion ' + key + (fingerIndex === undefined ? '' : fingerIndex));
  if (fingerIndex === undefined) proportions[key] = value;
  else proportions[key][fingerIndex] = value;
  finishCreatureWorkshopEdit();
}

// Makes the whole creature larger or smaller until it stands this tall: every proportion by the same share,
// and everything on its bones with them, so it stays the shape it is.
function setCreatureWorkshopDesignHeight(height) {
  const design = creatureWorkshop.design, creature = design.creature;
  const share = findFigureShareForHeight(FIGURE_KINDS[CREATURE_WORKSHOP_DRAFT_KEY].proportions, creature.skeleton, height);
  const scale = function (value) { return Array.isArray(value) ? value.map(scale) : (typeof value === 'number' ? value * share : value); };
  beginCreatureWorkshopEdit('height');
  for (const key in creature.proportions) creature.proportions[key] = scale(creature.proportions[key]);
  for (const part of creature.parts) {
    for (const name of ['center', 'from', 'to', 'half', 'radius']) if (part[name] !== undefined) part[name] = scale(part[name]);
  }
  design.creature = normalizeDesignedCreature(creature, design.key); // to the tenth of a millimetre again, and within what a creature may be
  finishCreatureWorkshopEdit();
}

function selectCreatureWorkshopPart(partIndex, shouldScrollToIt) {
  const design = creatureWorkshop.design;
  design.selectedIndex = partIndex;
  if (design.creature.parts[partIndex]) design.bone = design.creature.parts[partIndex].bone;
  renderWorkshopPanel();
  if (shouldScrollToIt) {
    const heading = document.getElementById('workshop-selected');
    if (heading && heading.scrollIntoView) heading.scrollIntoView({ block: 'nearest' });
  }
}

function selectCreatureWorkshopBone(bone) {
  const design = creatureWorkshop.design;
  design.bone = bone;
  design.selectedIndex = -1;
  markWorkshopStateChanged();
  renderWorkshopPanel();
}

// Leaves the skeleton's own capsule on some bones out (`isLeftOut`), or puts it back.
function setCreatureWorkshopBonesLeftOut(bones, isLeftOut) {
  const design = creatureWorkshop.design, creature = design.creature;
  beginCreatureWorkshopEdit('leave out');
  const hidden = creature.hides.filter(function (bone) { return bones.indexOf(bone) < 0; });
  // (In the skeleton's own order, so that the file reads the same however it was arrived at.)
  creature.hides = Object.keys(getCreatureWorkshopBones()).filter(function (bone) { return hidden.indexOf(bone) >= 0 || (isLeftOut && bones.indexOf(bone) >= 0); });
  finishCreatureWorkshopEdit();
  renderWorkshopPanel();
}

// Where a bone of the body on screen is, in the station: where it is held (`origin`), which way its own x, y and
// z point (`axes`), where it starts and ends, how long it is, and by what share the body is larger than its
// numbers say (a body a player can wear). Null for a bone the body has not been built with yet.
function getCreatureWorkshopBoneFrame(boneName) {
  const figure = creatureWorkshop.figure, bone = figure ? figure.bones[boneName] : undefined;
  const entry = getCreatureWorkshopBones()[boneName];
  if (!bone || !entry) return null;
  const frame = computeFigureBoneFrame(bone, entry.rest, figureBoneFrame);
  const forwardX = Math.sin(figure.yaw), forwardZ = -Math.cos(figure.yaw), rightX = Math.cos(figure.yaw), rightZ = Math.sin(figure.yaw);
  const turn = function (local) { return [local[0] * rightX + local[2] * forwardX, local[1], local[0] * rightZ + local[2] * forwardZ]; };
  const place = function (local) { const turned = turn(local); return [figure.x + turned[0], figure.y + turned[1], figure.z + turned[2]]; };
  return {
    origin: place(frame.origin), axes: [turn(frame.x), turn(frame.y), turn(frame.z)], start: place(bone[0]), end: place(bone[1]),
    length: Math.hypot(bone[1][0] - bone[0][0], bone[1][1] - bone[0][1], bone[1][2] - bone[0][2]), share: getFigureBodyShare(figure)
  };
}

function addCreatureWorkshopPart(shape) {
  const design = creatureWorkshop.design, creature = design.creature, bones = getCreatureWorkshopBones();
  if (creature.parts.length >= FIGURE_MAXIMUM_PARTS) {
    setWorkshopStatus('A creature has at most ' + FIGURE_MAXIMUM_PARTS + ' shapes on its bones.', 'warning');
    return;
  }
  const bone = bones[design.bone] ? design.bone : 'head';
  // In the middle of the bone, lying along it: it can be seen, and it is joined on.
  const rest = bones[bone].rest, frame = getCreatureWorkshopBoneFrame(bone);
  const halfLength = frame ? frame.length / frame.share / 2 : 0.1;
  const along = rest === 'forward' ? 2 : (rest === 'across' ? 0 : 1);
  const middle = [0, 0, 0];
  if (rest === 'up' || rest === 'forward') middle[along] = halfLength;
  else if (rest === 'down') middle[along] = -halfLength;
  const from = middle.slice(), to = middle.slice();
  from[along] -= 0.08; to[along] += 0.08;
  beginCreatureWorkshopEdit('add');
  creature.parts.push(normalizeCreatureWorkshopPart({ bone: bone, mirror: design.bothSides && bones[bone].partner !== '', shape: shape,
    center: middle, half: [0.06, 0.06, 0.06], from: from, to: to, radius: shape === 'ball' ? 0.07 : (shape === 'cone' ? 0.06 : 0.04) }));
  finishCreatureWorkshopEdit();
  selectCreatureWorkshopPart(creature.parts.length - 1, true);
}

function deleteSelectedCreatureWorkshopPart() {
  const design = creatureWorkshop.design;
  if (!design.creature.parts[design.selectedIndex]) return;
  beginCreatureWorkshopEdit('delete');
  design.creature.parts.splice(design.selectedIndex, 1);
  design.selectedIndex = -1;
  finishCreatureWorkshopEdit();
  renderWorkshopPanel();
}

function duplicateSelectedCreatureWorkshopPart() {
  const design = creatureWorkshop.design, part = design.creature.parts[design.selectedIndex];
  if (!part || design.creature.parts.length >= FIGURE_MAXIMUM_PARTS) return;
  beginCreatureWorkshopEdit('duplicate');
  design.creature.parts.push(normalizeCreatureWorkshopPart(shiftWorkshopPart(part, [0.08, 0, 0]))); // beside the original, so the copy can be seen and taken hold of
  finishCreatureWorkshopEdit();
  selectCreatureWorkshopPart(design.creature.parts.length - 1, true);
}

// Puts another shape in the selected shape's place. Does nothing if it is the same.
function replaceSelectedCreatureWorkshopPart(part, editLabel) {
  const design = creatureWorkshop.design;
  if (JSON.stringify(part) === JSON.stringify(design.creature.parts[design.selectedIndex])) return;
  beginCreatureWorkshopEdit(editLabel);
  design.creature.parts[design.selectedIndex] = part;
  finishCreatureWorkshopEdit();
  for (const fieldKey in design.selectedSetters) design.selectedSetters[fieldKey].setValue(part[fieldKey.slice(0, -1)][Number(fieldKey.slice(-1))]);
}

function turnSelectedCreatureWorkshopPart(isTippedOver) {
  const design = creatureWorkshop.design, part = design.creature.parts[design.selectedIndex];
  if (!part || part.shape === 'ball') return;
  replaceSelectedCreatureWorkshopPart(normalizeCreatureWorkshopPart(turnWorkshopPart(part, isTippedOver)), 'turn');
  renderWorkshopPanel(); // a box's sizes have changed places
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

// The creature as it is written to its file: everything but the key, which is the file's name.
function getCreatureWorkshopFileContent() {
  const content = normalizeDesignedCreature(creatureWorkshop.design.creature, creatureWorkshop.design.key);
  delete content.key;
  return content;
}

function saveCreatureWorkshopDesign() {
  const state = creatureWorkshop, design = state.design, key = design.key;
  if (!CREATURE_WORKSHOP_KEY_PATTERN.test(key) || (key !== design.savedKey && FIGURE_KINDS[key])) {
    setWorkshopStatus('Not saved: ' + design.problems[0], 'warning');
    return;
  }
  const content = getCreatureWorkshopFileContent();
  if (!workshop.hasServer) {
    downloadWorkshopFile(key + '.json', JSON.stringify(content, null, 2) + '\n');
    setWorkshopStatus('No dev server, so the creature was downloaded instead. Put ' + key + '.json in src/creatures/.', 'warning');
    return;
  }
  const previousKey = design.savedKey;
  callWorkshopServer('/dev/save-creature', { key: key, creature: content }).then(function () {
    // Renamed: the old file goes, or the creature would exist twice.
    if (previousKey && previousKey !== key) return callWorkshopServer('/dev/delete-creature', { key: previousKey });
    return null;
  }).then(function () {
    if (state.design !== design) return; // another creature was opened meanwhile
    if (previousKey && previousKey !== key) { delete designedCreatures[previousKey]; delete FIGURE_KINDS[previousKey]; }
    design.isDirty = false;
    design.savedKey = key;
    // What was written is now what the file holds, for the game and for the grey shape beside it.
    designedCreatures[key] = normalizeDesignedCreature(content, key);
    FIGURE_KINDS[key] = createDesignedCreatureKind(designedCreatures[key]);
    state.fileProportions[CREATURE_WORKSHOP_DRAFT_KEY] = JSON.parse(JSON.stringify(designedCreatures[key].proportions));
    if (state.originalFigure) state.originalFigure.proportions = FIGURE_KINDS[key].proportions;
    saveWorkshopState();
    renderWorkshopPanel();
    setWorkshopStatus('Saved src/creatures/' + key + '.json' + (design.problems.length > 0 ? ', with ' + design.problems.length + ' thing(s) still to check.' : '.'), design.problems.length > 0 ? 'warning' : 'good');
  }).catch(function (error) {
    setWorkshopStatus('Not saved: ' + error.message, 'warning');
  });
}

function revertCreatureWorkshopDesign() {
  const design = creatureWorkshop.design;
  if (!design || !design.isDirty) return;
  if (!window.confirm('Throw away every change to "' + design.creature.label + '" since it was last saved?')) return;
  openCreatureInWorkshop(design.savedKey || '');
  renderWorkshopPanel();
}

function deleteCreatureWorkshopDesign() {
  const design = creatureWorkshop.design;
  if (!design) return;
  if (!window.confirm('Delete the creature "' + design.creature.label + '"' + (design.savedKey ? ' and its file src/creatures/' + design.savedKey + '.json?' : '?'))) return;
  const afterwards = function () {
    if (design.savedKey) { delete designedCreatures[design.savedKey]; delete FIGURE_KINDS[design.savedKey]; }
    openCreatureInWorkshop('');
    saveWorkshopState();
    renderWorkshopPanel();
  };
  if (!design.savedKey) { afterwards(); return; }
  if (!workshop.hasServer) { setWorkshopStatus('No dev server: delete src/creatures/' + design.savedKey + '.json by hand.', 'warning'); return; }
  callWorkshopServer('/dev/delete-creature', { key: design.savedKey }).then(afterwards).catch(function (error) {
    setWorkshopStatus('Not deleted: ' + error.message, 'warning');
  });
}

// What survives a reload: which creature was open, and the work on it that is not saved to a file yet.
function storeCreatureWorkshopDesign(stored) {
  const design = creatureWorkshop.design;
  stored.design = design ? { key: design.key, savedKey: design.savedKey, draft: design.isDirty ? design.creature : null,
    selectedIndex: design.selectedIndex, bone: design.bone, bothSides: design.bothSides } : null;
}

function restoreCreatureWorkshopDesign(stored) {
  closeCreatureWorkshopDesign();
  const kept = stored.design;
  if (!kept || typeof kept !== 'object' || typeof kept.key !== 'string') {
    if (designedCreatures[stored.kind]) openCreatureWorkshopDesign(stored.kind); // (asked for by its name, with no work on it kept)
    return;
  }
  let draft = kept.draft && typeof kept.draft === 'object' ? kept.draft : null;
  const savedKey = kept.savedKey && designedCreatures[kept.savedKey] ? kept.savedKey : null;
  // Work in progress that is the same as the file is not work in progress (it was saved just before a reload).
  if (draft && savedKey === kept.key && JSON.stringify(normalizeDesignedCreature(draft, kept.key)) === JSON.stringify(designedCreatures[kept.key])) draft = null;
  if (draft) openCreatureWorkshopDesign(kept.key, draft, savedKey);
  else if (designedCreatures[kept.key]) openCreatureWorkshopDesign(kept.key);
  else return;
  const design = creatureWorkshop.design;
  if (Number.isInteger(kept.selectedIndex)) design.selectedIndex = clampNumber(kept.selectedIndex, -1, design.creature.parts.length - 1);
  if (getCreatureWorkshopBones()[kept.bone]) design.bone = kept.bone;
  if (typeof kept.bothSides === 'boolean') design.bothSides = kept.bothSides;
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

function describeCreatureWorkshopPart(part, partIndex) {
  return (partIndex + 1) + '. ' + OBJECT_WORKSHOP_SHAPE_NAMES[part.shape] + ' · ' + getCreatureWorkshopBones()[part.bone].label +
    (part.mirror ? ' · and its mirror image' : '');
}

function renderCreatureWorkshopSelection(body) {
  const design = creatureWorkshop.design, bones = getCreatureWorkshopBones();
  const part = design.creature.parts[design.selectedIndex];
  design.selectedSetters = {};
  const heading = addWorkshopHeading(body, part ? 'Selected: ' + describeCreatureWorkshopPart(part, design.selectedIndex) : 'Selected: no shape');
  heading.id = 'workshop-selected';
  if (!part) { addWorkshopNote(body, 'Click a shape in the view, or in the list below.'); return; }
  const limits = DESIGNED_CREATURE_LIMITS;
  const selected = function () { return design.creature.parts[design.selectedIndex]; };
  addWorkshopSelect(body, 'Fixed to', part.bone, Object.keys(bones).map(function (bone) { return [bone, describeCreatureWorkshopBone(bone)]; }), function (bone) {
    beginCreatureWorkshopEdit('part bone'); selected().bone = bone; design.bone = bone; finishCreatureWorkshopEdit();
    renderWorkshopPanel();
  }).id = 'workshop-part-bone';
  addWorkshopCheckbox(body, bones[part.bone].partner ? 'And its mirror image on the ' + bones[bones[part.bone].partner].label : 'And its mirror image on the other side of the ' + bones[part.bone].label,
    part.mirror, function (isOn) {
      beginCreatureWorkshopEdit('part mirror'); selected().mirror = isOn; finishCreatureWorkshopEdit();
      renderWorkshopPanel();
    }).id = 'workshop-part-mirror';
  const addPlace = function (name, label) {
    for (let axis = 0; axis < 3; axis++) {
      const field = addWorkshopNumber(body, label + ', ' + CREATURE_WORKSHOP_AXIS_NAMES[axis], part[name][axis], -limits.reach, limits.reach, 0.005, function (value) {
        beginCreatureWorkshopEdit('part ' + name + axis); selected()[name][axis] = value; finishCreatureWorkshopEdit();
      });
      field.element.id = 'workshop-part-' + name + axis;
      design.selectedSetters[name + axis] = field;
    }
  };
  if (part.shape === 'cone') { addPlace('from', 'The flat end'); addPlace('to', 'The point'); }
  else if (isObjectWorkshopRod(part)) { addPlace('from', 'One end'); addPlace('to', 'The other end'); }
  else addPlace('center', 'Its middle');
  if (part.shape === 'box') {
    ['Width (x)', 'Height (y)', 'Depth (z)'].forEach(function (label, axis) {
      addWorkshopNumber(body, label, part.half[axis] * 2, limits.minimumHalf * 2, limits.maximumHalf * 2, 0.01, function (value) {
        beginCreatureWorkshopEdit('part size' + axis); selected().half[axis] = value / 2; finishCreatureWorkshopEdit();
      }).element.id = 'workshop-part-size' + axis;
    });
  } else {
    addWorkshopNumber(body, part.shape === 'ball' ? 'Radius' : (part.shape === 'cone' ? 'Radius of the flat end' : 'Thickness (radius)'), part.radius, limits.minimumRadius, limits.maximumRadius, 0.005, function (value) {
      beginCreatureWorkshopEdit('part radius'); selected().radius = value; finishCreatureWorkshopEdit();
    }).element.id = 'workshop-part-radius';
  }
  const row = addWorkshopRow(body);
  addWorkshopButton(row, 'Copy', duplicateSelectedCreatureWorkshopPart, 'Ctrl+D');
  addWorkshopButton(row, 'Delete', deleteSelectedCreatureWorkshopPart, 'Delete key');
  if (part.shape !== 'ball') {
    addWorkshopButton(row, 'Turn', function () { turnSelectedCreatureWorkshopPart(false); }, 'R: a quarter turn about the bone\'s upright line');
    addWorkshopButton(row, 'Tip over', function () { turnSelectedCreatureWorkshopPart(true); }, 'Shift+R: a quarter turn about the line that points to its front');
  }
}

// What a creature made here has besides its proportions: what is on its bones, and what it is.
function renderCreatureWorkshopDesignPanel(body) {
  const state = creatureWorkshop, design = state.design, creature = design.creature, bones = getCreatureWorkshopBones();

  addWorkshopHeading(body, 'Its bones, and what is on them');
  addWorkshopNote(body, 'Click the body to choose a bone, or a shape that is fixed to one; drag a shape to move it (Ctrl: 5 cm steps). Arrow keys nudge it right, left, up and down, Page Up and Page Down to its back and its front (Shift: 5 cm). R turns it, Shift+R tips it over. ' +
    'A shape turns with its bone, so a body is best shaped standing still: "Standing" or "Posed by hand" above, then try what it does.');
  addWorkshopCheckbox(body, 'Both sides alike: what is done to an arm or a leg is done to the other', design.bothSides, function (isOn) { design.bothSides = isOn; markWorkshopStateChanged(); },
    'A new shape on an arm or a leg gets a mirror image on the other one, and leaving a bone out leaves its partner out. Each shape can be given a mirror image, or lose it, by itself.').id = 'workshop-both-sides';
  const shapesOn = {};
  for (const part of creature.parts) shapesOn[part.bone] = (shapesOn[part.bone] || 0) + 1;
  const boneChoices = [['', 'None chosen']].concat(Object.keys(bones).map(function (bone) {
    return [bone, describeCreatureWorkshopBone(bone) + (creature.hides.indexOf(bone) >= 0 ? ' · left out' : '') + (shapesOn[bone] ? ' · ' + shapesOn[bone] + (shapesOn[bone] === 1 ? ' shape' : ' shapes') : '')];
  }));
  addWorkshopSelect(body, 'Bone', bones[design.bone] ? design.bone : '', boneChoices, selectCreatureWorkshopBone).id = 'workshop-creature-bone';
  if (bones[design.bone]) {
    const both = design.bothSides && bones[design.bone].partner ? [design.bone, bones[design.bone].partner] : [design.bone];
    addWorkshopCheckbox(body, 'The skeleton\'s own shape on it is part of the body' + (both.length > 1 ? ' (and on the ' + bones[both[1]].label + ')' : ''), creature.hides.indexOf(design.bone) < 0, function (isOn) {
      setCreatureWorkshopBonesLeftOut(both, !isOn);
    }, 'Off: the capsule the skeleton puts here is left out. The bone is still there, and what is fixed to it stays.').id = 'workshop-bone-shown';
  }
  let row = addWorkshopRow(body);
  addWorkshopButton(row, 'Leave out the whole skeleton', function () { setCreatureWorkshopBonesLeftOut(Object.keys(bones), true); },
    'Every capsule of the skeleton goes: the body is only what you fix to its bones').id = 'workshop-leave-out-all';
  addWorkshopButton(row, 'Put it all back', function () { setCreatureWorkshopBonesLeftOut(Object.keys(bones), false); });

  renderCreatureWorkshopSelection(body);

  addWorkshopHeading(body, 'Shapes on its bones (' + creature.parts.length + ' of at most ' + FIGURE_MAXIMUM_PARTS + ')');
  row = addWorkshopRow(body);
  const shapeSelect = addWorkshopSelect(row, '', workshop.stored.creatures.lastAddedShape || 'box', OBJECT_WORKSHOP_SHAPES, function (shape) { workshop.stored.creatures.lastAddedShape = shape; });
  shapeSelect.id = 'workshop-add-shape';
  addWorkshopButton(row, 'Add', function () { workshop.stored.creatures.lastAddedShape = shapeSelect.value; addCreatureWorkshopPart(shapeSelect.value); },
    'Fixes one to the chosen bone (to the head if none is chosen), in the middle of it').id = 'workshop-add-part';
  const list = body.appendChild(createDebugElement('div', 'workshop-list'));
  creature.parts.forEach(function (part, partIndex) {
    const entry = createDebugElement('button', 'workshop-list-entry' + (partIndex === design.selectedIndex ? ' is-current' : ''), describeCreatureWorkshopPart(part, partIndex));
    entry.type = 'button';
    entry.addEventListener('click', function () { entry.blur(); selectCreatureWorkshopPart(partIndex === design.selectedIndex ? -1 : partIndex, true); });
    list.appendChild(entry);
  });

  addWorkshopHeading(body, 'The creature');
  addWorkshopText(body, 'What the workshop calls it', creature.label, function (value) {
    beginCreatureWorkshopEdit('label'); design.creature.label = value.trim().slice(0, 40) || design.key; finishCreatureWorkshopEdit();
  }, 40).id = 'workshop-creature-label';
  const keyBox = addWorkshopText(body, 'File name: src/creatures/….json', design.key, function (value) {
    beginCreatureWorkshopEdit('key'); design.key = design.creature.key = value.trim(); finishCreatureWorkshopEdit();
  }, 31);
  keyBox.id = 'workshop-creature-key';
  keyBox.addEventListener('change', renderWorkshopPanel); // the list of creatures at the top shows the new name
  for (const field of DESIGNED_CREATURE_FIELDS) {
    if (field.key === 'playerSkin' && creature.skeleton !== 'person') continue;
    if (field.key === 'scansAs' && creature.playerSkin) continue; // a body a player wears scans as a player
    const change = function (value) {
      const shapesBefore = design.creature.parts.length;
      beginCreatureWorkshopEdit('field ' + field.key);
      design.creature[field.key] = value;
      // Another skeleton has other bones and other proportions: what has no place on it goes, what is new gets its usual size.
      design.creature = normalizeDesignedCreature(design.creature, design.key);
      if (!getCreatureWorkshopBones()[design.bone]) design.bone = '';
      design.selectedIndex = Math.min(design.selectedIndex, design.creature.parts.length - 1);
      finishCreatureWorkshopEdit();
      settleCreatureWorkshopBehaviour();
      state.needsStage = true;
      renderWorkshopPanel();
      const dropped = shapesBefore - design.creature.parts.length;
      if (dropped > 0) setWorkshopStatus(dropped + ' shape(s) were on bones this skeleton does not have, and are gone. Undo brings them back.', 'warning');
    };
    const control = field.kind === 'boolean' ? addWorkshopCheckbox(body, field.label, creature[field.key], change) : addWorkshopSelect(body, field.label, creature[field.key], field.choices, change);
    control.id = 'workshop-creature-' + field.key;
  }
  addWorkshopNote(body, creature.playerSkin
    ? 'A body a player can wear. The game poses it as it poses a player (11-together.js), and getPlayerBodyKinds (04-workshop-creatures.js) lists it with the others. Nothing chooses between them yet: down there everybody still wears the body written as code.'
    : 'A file gives a creature its body. What it does in a station is code, the way the Hollow is code in 08-hollow.js and the Stills in 08-entities.js: createFigureOfKind(\'' + design.key + '\') makes one. Until something does, it is kept, and in no station.');
}

// ---------------------------------------------------------------------------
// The mouse and the keyboard
// ---------------------------------------------------------------------------

// What a ray meets first of a body: { distance, bone, part }. `bone` is the name of one of the skeleton's own
// capsules, `part` one of the shapes fixed to its bones as the body was built with it (prepareFigureShape).
function findCreatureWorkshopShapeOnRay(figure, ray) {
  let found = null;
  const consider = function (distance, bone, part) {
    if (distance > 0 && (found === null || distance < found.distance)) found = { distance: distance, bone: bone, part: part };
  };
  for (let capsuleIndex = 0; capsuleIndex < figure.capsuleCount; capsuleIndex++) {
    consider(intersectRayWithCapsule(figure.capsules, capsuleIndex * FIGURE_CAPSULE_STRIDE, ray.originX, ray.originY, ray.originZ, ray.directionX, ray.directionY, ray.directionZ),
      figure.capsuleBones[capsuleIndex], figure.capsuleParts[capsuleIndex]);
  }
  for (let rodIndex = 0; rodIndex < figure.rodCount; rodIndex++) {
    const rods = figure.rods, offset = rodIndex * FIGURE_ROD_STRIDE;
    consider(intersectRayWithTaperedRod(rods[offset], rods[offset + 1], rods[offset + 2], rods[offset + 3], rods[offset + 4], rods[offset + 5], rods[offset + 6], rods[offset + 7],
      ray.originX, ray.originY, ray.originZ, ray.directionX, ray.directionY, ray.directionZ), '', figure.rodParts[rodIndex]);
  }
  for (let boxIndex = 0; boxIndex < figure.boxCount; boxIndex++) {
    consider(intersectRayWithTurnedBox(figure.boxes, boxIndex * FIGURE_BOX_STRIDE, ray.originX, ray.originY, ray.originZ, ray.directionX, ray.directionY, ray.directionZ), '', figure.boxParts[boxIndex]);
  }
  return found;
}

// A click on the body: on a shape that is fixed to a bone it selects the shape and takes hold of it, on one of
// the skeleton's own capsules it chooses that bone. Beside the body it does nothing: that drag circles it.
function takeHoldOfCreatureWorkshopDesign(event) {
  const state = creatureWorkshop, design = state.design;
  if (!state.figure || state.needsStage) return;
  const ray = computeWorkshopMouseRay(event);
  const hit = findCreatureWorkshopShapeOnRay(state.figure, ray);
  if (!hit) return;
  if (!hit.part) {
    if (getCreatureWorkshopBones()[hit.bone] && (hit.bone !== design.bone || design.selectedIndex >= 0)) selectCreatureWorkshopBone(hit.bone);
    return;
  }
  if (hit.part.partIndex !== design.selectedIndex) selectCreatureWorkshopPart(hit.part.partIndex, true);
  // It is dragged across the plane that faces the view, through the point where it was taken hold of.
  state.drag.grab = {
    startClientX: event.clientX, startClientY: event.clientY, isMoving: false,
    point: [ray.originX + ray.directionX * hit.distance, ray.originY + ray.directionY * hit.distance, ray.originZ + ray.directionZ * hit.distance],
    facing: [scannerBasis.forwardX, scannerBasis.forwardY, scannerBasis.forwardZ],
    part: JSON.stringify(design.creature.parts[hit.part.partIndex]),
    bone: hit.part.bone, isMirror: hit.part.isMirror // (taken hold of by its mirror image, it moves the other way across)
  };
}

function dragCreatureWorkshopPart(event) {
  const state = creatureWorkshop, grab = state.drag.grab;
  // A click that wobbles a pixel or two is still a click.
  if (!grab.isMoving && Math.abs(event.clientX - grab.startClientX) + Math.abs(event.clientY - grab.startClientY) < 4) return;
  grab.isMoving = true;
  const frame = getCreatureWorkshopBoneFrame(grab.bone);
  if (!frame) return;
  const ray = computeWorkshopMouseRay(event);
  const towards = ray.directionX * grab.facing[0] + ray.directionY * grab.facing[1] + ray.directionZ * grab.facing[2];
  if (towards < 0.05) return;
  const distance = ((grab.point[0] - ray.originX) * grab.facing[0] + (grab.point[1] - ray.originY) * grab.facing[1] + (grab.point[2] - ray.originZ) * grab.facing[2]) / towards;
  const moved = [ray.originX + ray.directionX * distance - grab.point[0], ray.originY + ray.directionY * distance - grab.point[1], ray.originZ + ray.directionZ * distance - grab.point[2]];
  // From the station's directions to the bone's own, in the numbers the shape is given in.
  const along = frame.axes.map(function (axis) { return (moved[0] * axis[0] + moved[1] * axis[1] + moved[2] * axis[2]) / frame.share; });
  if (grab.isMirror) along[0] = -along[0];
  // Its middle (or a rod's first end) lands on whole centimetres.
  const start = JSON.parse(grab.part), anchor = isObjectWorkshopRod(start) ? start.from : start.center;
  const snap = event.ctrlKey ? 0.05 : 0.01;
  replaceSelectedCreatureWorkshopPart(normalizeCreatureWorkshopPart(shiftWorkshopPart(start, along.map(function (amount, axis) {
    return Math.round((anchor[axis] + amount) / snap) * snap - anchor[axis];
  }))), 'drag');
}

function onCreatureWorkshopDesignKey(event) {
  const design = creatureWorkshop.design;
  const hasCommandKey = event.ctrlKey || event.metaKey;
  if (hasCommandKey && event.code === 'KeyZ') { if (event.shiftKey) stepCreatureWorkshopHistory(design.redoStack, design.undoStack); else stepCreatureWorkshopHistory(design.undoStack, design.redoStack); return true; }
  if (hasCommandKey && event.code === 'KeyY') { stepCreatureWorkshopHistory(design.redoStack, design.undoStack); return true; }
  if (hasCommandKey && event.code === 'KeyD') { duplicateSelectedCreatureWorkshopPart(); return true; }
  if (hasCommandKey || event.altKey) return false;
  const part = design.creature.parts[design.selectedIndex];
  if (part) {
    const step = event.shiftKey ? 0.05 : 0.01;
    const nudges = { ArrowRight: [step, 0, 0], ArrowLeft: [-step, 0, 0], ArrowUp: [0, step, 0], ArrowDown: [0, -step, 0], PageUp: [0, 0, -step], PageDown: [0, 0, step] };
    if (nudges[event.code]) { replaceSelectedCreatureWorkshopPart(normalizeCreatureWorkshopPart(shiftWorkshopPart(part, nudges[event.code])), 'nudge'); return true; }
    if (event.code === 'KeyR') { turnSelectedCreatureWorkshopPart(event.shiftKey); return true; }
  }
  if (event.repeat) return false;
  if (part && (event.code === 'Delete' || event.code === 'Backspace')) { deleteSelectedCreatureWorkshopPart(); return true; }
  if (event.code === 'Escape' && (part || design.bone)) { selectCreatureWorkshopBone(''); return true; }
  return false;
}

// ---------------------------------------------------------------------------
// What is drawn over the body
// ---------------------------------------------------------------------------

// The edges of the box round one shape, where its bone now is. `side` -1 is its mirror image.
function pushCreatureWorkshopPartLines(part, boneName, side, red, green, blue) {
  const frame = getCreatureWorkshopBoneFrame(boneName);
  if (!frame) return;
  const extents = getObjectWorkshopExtents([part]), margin = 0.006;
  const corner = function (cornerIndex) {
    const place = [0, 1, 2].map(function (axis) {
      return ((cornerIndex >> axis) & 1 ? extents.high[axis] + margin : extents.low[axis] - margin) * (axis === 0 ? side : 1) * frame.share;
    });
    return [0, 1, 2].map(function (axis) { return frame.origin[axis] + frame.axes[0][axis] * place[0] + frame.axes[1][axis] * place[1] + frame.axes[2][axis] * place[2]; });
  };
  for (let cornerIndex = 0; cornerIndex < 8; cornerIndex++) {
    for (let axis = 0; axis < 3; axis++) {
      if ((cornerIndex >> axis) & 1) continue; // each edge once: from the corner at its low end
      const from = corner(cornerIndex), to = corner(cornerIndex | (1 << axis));
      pushDebugLine(from[0], from[1], from[2], to[0], to[1], to[2], red, green, blue);
    }
  }
}

function addCreatureWorkshopDesignOverlays() {
  const design = creatureWorkshop.design, bones = getCreatureWorkshopBones();
  if (creatureWorkshop.needsStage) return;
  // The chosen bone: a line along it, and its own directions where it is held. Red x, green y, blue z.
  const frame = bones[design.bone] ? getCreatureWorkshopBoneFrame(design.bone) : null;
  if (frame) {
    pushDebugLine(frame.start[0], frame.start[1], frame.start[2], frame.end[0], frame.end[1], frame.end[2], 1.0, 1.0, 1.0);
    const colours = [[1.0, 0.3, 0.25], [0.3, 1.0, 0.35], [0.35, 0.5, 1.0]];
    for (let axis = 0; axis < 3; axis++) {
      pushDebugLine(frame.origin[0], frame.origin[1], frame.origin[2],
        frame.origin[0] + frame.axes[axis][0] * 0.18, frame.origin[1] + frame.axes[axis][1] * 0.18, frame.origin[2] + frame.axes[axis][2] * 0.18,
        colours[axis][0], colours[axis][1], colours[axis][2]);
    }
  }
  const part = design.creature.parts[design.selectedIndex];
  if (part && bones[part.bone]) {
    pushCreatureWorkshopPartLines(part, part.bone, 1, 1.0, 1.0, 1.0);
    if (part.mirror) pushCreatureWorkshopPartLines(part, bones[part.bone].partner || part.bone, -1, 0.55, 0.6, 0.7);
  }
}
