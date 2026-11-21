// ---------------------------------------------------------------------------
// Your health.
//
// Being caught used to be the end of you. It is being hit now: every creature's hit takes some of your health
// (how much is its own number in TUNING, times the threat level's damageFactor), and the hit that takes the
// last of it is your death, shown as it always was (triggerPlayerDeath, 11-game.js). On the standard threat
// level the Hollow's second hit kills; on Nightmare its first does, as before.
//
// A hit that does not kill gives you a chance:
//   - nothing can hit you again for TUNING.playerHurtGraceSeconds;
//   - what hit you holds off (11-game.js, recoilAfterHit): the Hollow stands where it struck for a few
//     seconds, a Still does not move again for a while.
//
// Nothing gives health back but a first aid kit: a thing that lies about the station like any other
// (08-loose-objects.js), used up with Q while it is in your beam. Back from a checkpoint, or on your feet again
// where the others restarted your scanner, you have at least TUNING.playerRetryHealth.
//
// A looter's bite (08-looter.js) is the one hit that never kills: it leaves you the last of your health.
//
// Down there with others your health is your own game's, as your death is. The host's game says that
// something has hit you ('caught', 11-together.js), yours works out what that does to you, and says so.
// ---------------------------------------------------------------------------

function resetPlayerHealth() {
  player.health = TUNING.playerMaxHealth;
  player.hurtGraceSeconds = 0;
  player.hurtFlash = 0;
}

// What a hit from this kind of creature takes off, before the threat level has its say.
function getHitDamage(kind) {
  if (kind === 'hollow') return TUNING.hollowHitDamage;
  if (kind === 'still') return TUNING.stillHitDamage;
  if (kind === 'surveyor') return TUNING.surveyorHitDamage;
  return TUNING.looterBiteDamage;
}

const HURT_TEXT = {
  hollow: 'It has hit you. Get away from it while it stands there.',
  still: 'One of them has hit you. Keep them in the scan.',
  looter: 'It has bitten you. Get out of its vents.',
  surveyor: 'It has struck you, and it is off. Stay out of its light.'
};

// Something has hit you: `kind` says what ('hollow', 'still', 'looter'), `figure` is its body. Returns what
// came of it:
//   'none'  you cannot be hit just now (hit a moment ago, not in play, or the debug switch)
//   'hurt'  it took some of your health
//   'dead'  it took the last of it: you are dying
function hitPlayer(kind, figure) {
  // Down there with others the station does not wait while you read or have the menu open, and neither does this.
  const isAway = isWorldShared() && (game.mode === 'paused' || game.mode === 'reading');
  if (game.mode !== 'playing' && !isAway) return 'none';
  if (debugState.options.invulnerable || debugState.options.flyMode || player.hurtGraceSeconds > 0) return 'none';
  const damage = getHitDamage(kind) * (game.difficulty.damageFactor || 1);
  if (kind !== 'looter' && player.health - damage < 0.5) {
    if (!triggerPlayerDeath(kind, figure)) return 'none';
    player.health = 0;
    return 'dead';
  }
  player.health = Math.max(1, player.health - damage);
  player.hurtGraceSeconds = TUNING.playerHurtGraceSeconds;
  player.hurtFlash = 1;
  game.interference = Math.max(game.interference, 0.9);
  playHurt();
  showMessage(HURT_TEXT[kind] || HURT_TEXT.hollow, 4, 'warning');
  return 'hurt';
}

// Gives health back, up to all of it. Returns how much it gave.
function healPlayer(points) {
  const before = player.health;
  player.health = Math.min(TUNING.playerMaxHealth, player.health + points);
  return player.health - before;
}

// Every frame the station runs, whether you are at the controls or not.
function updatePlayerHealth(dt) {
  player.hurtGraceSeconds = Math.max(0, player.hurtGraceSeconds - dt);
  player.hurtFlash = Math.max(0, player.hurtFlash - dt * 1.6);
}

// ---- The first aid kit ----

// Q with one in the beam: only if there is something to mend.
function canUseFirstAidKit() {
  if (player.health < TUNING.playerMaxHealth) return true;
  showMessage('You are not hurt. Keep it for when you are.', 3, 'info');
  return false;
}

// 'setOff', carried out in every browser: the kit is used up, and worth next to nothing. Whoever has it in the
// beam is the one it mends.
function useFirstAidKit(object) {
  object.isSpent = true;
  object.worth = Math.min(object.worth, 2);
  if (looseState.held !== object) return;
  healPlayer(getLooseNumber(object, 'firstAidHeals')); // (a better mark of kit gives back more: "Marks", 08-loose-objects.js)
  playFirstAid();
  showMessage(object.kind.label.charAt(0).toUpperCase() + object.kind.label.slice(1) + ' used.', 4, 'info');
}
