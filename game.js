'use strict';

const TURSO_URL = "libsql://davs-finalworld.aws-eu-west-1.turso.io";
const TURSO_TOKEN = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODY5NjgyMzEsImlkIjoiMDFhMDBmOGYtNjMwMS03ZmQ4LTkyZTEtNTJiMmYzOTViMGQ3Iiwia2lkIjoiRXJvcGFScmFlRzI3M0c2N2x2Nl9SWFlhMHh5ck1SVU44cTl3Q1U2MkVCWSIsInJpZCI6ImM1MDllMTNmLWI3OWUtNDY1MS04MjlmLTI3MGQ0MzcwYmZlOCJ9.Et8scMglRybhHLXkob-I8Zzrxxpp5kNu_hcunSZRUDCvjN5wgouDyyiACkP8R5s76Rhb9uqRZL1YQgIMI1BPBQ";

// resten av game.js...

const TURSO_HTTP_URL = TURSO_URL.replace(/^libsql:\/\//, 'https://').replace(/\/+$/, '') + '/v2/pipeline';

function tursoArgText(value) {
  return { type: 'text', value: String(value ?? '') };
}
function tursoArgInt(value) {
  return { type: 'integer', value: String(Math.trunc(Number(value) || 0)) };
}
async function tursoExecute(sql, args = []) {
  const response = await fetch(TURSO_HTTP_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TURSO_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      requests: [
        { type: 'execute', stmt: { sql, args } },
        { type: 'close' }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Turso svarade ${response.status}`);
  }

  const data = await response.json();
  const first = data?.results?.[0];

  if (!first || first.type !== 'ok' || first.response?.type !== 'execute') {
    const message = first?.error?.message || first?.error || 'Okänt Turso-fel';
    throw new Error(String(message));
  }

  return first.response.result;
}

function tursoValue(cell) {
  if (!cell || cell.type === 'null') return null;
  if (cell.type === 'integer' || cell.type === 'float') return Number(cell.value);
  return cell.value ?? '';
}

function tursoRows(result) {
  const cols = (result?.cols || []).map(c => c.name);
  return (result?.rows || []).map(row => {
    const obj = {};
    cols.forEach((name, i) => obj[name] = tursoValue(row[i]));
    return obj;
  });
}

async function getOnlineScores(limit = 10) {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit) || 10));
  const result = await tursoExecute(
    `SELECT id, name, survival_ms, level, kills, skills, created_at
     FROM scores
     ORDER BY survival_ms DESC, level DESC, kills DESC, id ASC
     LIMIT ${safeLimit}`
  );

  return tursoRows(result).map((row, index) => {
    let skills = [];
    try { skills = JSON.parse(row.skills || '[]'); } catch {}
    return {
      onlineId: row.id,
      name: row.name,
      durationMs: Number(row.survival_ms) || 0,
      level: Number(row.level) || 1,
      kills: Number(row.kills) || 0,
      skills,
      createdAt: row.created_at,
      position: index + 1
    };
  });
}

async function saveOnlineScore(score) {
  const nameResult = validateNameClient(score.name);
  if (!nameResult.ok) throw new Error('Ogiltigt namn');

  const durationMs = Math.max(0, Math.min(86400000, Math.trunc(score.durationMs || 0)));
  const level = Math.max(1, Math.min(10000, Math.trunc(score.level || 1)));
  const kills = Math.max(0, Math.min(10000000, Math.trunc(score.kills || 0)));
  const skillsJson = JSON.stringify(Array.isArray(score.skills) ? score.skills : []);

  const result = await tursoExecute(
    `INSERT INTO scores (name, survival_ms, level, kills, skills)
     VALUES (?, ?, ?, ?, ?)`,
    [
      tursoArgText(nameResult.name),
      tursoArgInt(durationMs),
      tursoArgInt(level),
      tursoArgInt(kills),
      tursoArgText(skillsJson)
    ]
  );

  return Number(result?.last_insert_rowid || 0);
}

async function getOnlinePosition(rowId) {
  if (!rowId) return null;
  const result = await tursoExecute(
    `SELECT 1 + COUNT(*) AS position
     FROM scores
     WHERE survival_ms > (SELECT survival_ms FROM scores WHERE id = ?)
        OR (
          survival_ms = (SELECT survival_ms FROM scores WHERE id = ?)
          AND level > (SELECT level FROM scores WHERE id = ?)
        )
        OR (
          survival_ms = (SELECT survival_ms FROM scores WHERE id = ?)
          AND level = (SELECT level FROM scores WHERE id = ?)
          AND kills > (SELECT kills FROM scores WHERE id = ?)
        )
        OR (
          survival_ms = (SELECT survival_ms FROM scores WHERE id = ?)
          AND level = (SELECT level FROM scores WHERE id = ?)
          AND kills = (SELECT kills FROM scores WHERE id = ?)
          AND id < ?
        )`,
    Array.from({length: 10}, () => tursoArgInt(rowId))
  );
  const rows = tursoRows(result);
  return rows.length ? Number(rows[0].position) : null;
}



const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d');
const grassTile=new Image();grassTile.src='assets/grass-tile.png';
const $ = (sel) => document.querySelector(sel);
const LOCAL_SCORE_KEY = 'davina-jimmy-spenatstorm-scores-v1';

const PLAYER_NAME_KEY = 'spenatstorm_display_name_v2';

const PROFILE_DB_NAME = 'spenatstorm_profile_db';
const PROFILE_STORE = 'profile';

function openProfileDb(){
  return new Promise((resolve,reject)=>{
    if(!('indexedDB' in window)) return reject(new Error('IndexedDB saknas'));
    const req=indexedDB.open(PROFILE_DB_NAME,1);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(PROFILE_STORE)) db.createObjectStore(PROFILE_STORE);
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('IndexedDB-fel'));
  });
}
async function idbSavePlayerName(name){
  const result=validateNameClient(name);
  if(!result.ok) return '';
  const db=await openProfileDb();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(PROFILE_STORE,'readwrite');
    tx.objectStore(PROFILE_STORE).put(result.name,'playerName');
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(tx.error||new Error('IndexedDB skrivfel'));
  });
  db.close();
  return result.name;
}
async function idbLoadPlayerName(){
  try{
    const db=await openProfileDb();
    const value=await new Promise((resolve,reject)=>{
      const tx=db.transaction(PROFILE_STORE,'readonly');
      const req=tx.objectStore(PROFILE_STORE).get('playerName');
      req.onsuccess=()=>resolve(req.result||'');
      req.onerror=()=>reject(req.error||new Error('IndexedDB läsfel'));
    });
    db.close();
    const result=validateNameClient(value||'');
    return result.ok?result.name:'';
  }catch(e){ return ''; }
}


function savePlayerName(name) {
  const result = validateNameClient(name);
  if (!result.ok) return '';
  const clean = result.name;
  try {
    localStorage.setItem(PLAYER_NAME_KEY, clean);
    localStorage.setItem('spenatstorm_display_name', clean); // migrering från äldre version
  } catch(e) {}
  idbSavePlayerName(clean).catch(()=>{});
  try {
    const url = new URL(location.href);
    url.hash = 'spelare=' + encodeURIComponent(clean);
    history.replaceState(null, '', url.href);
  } catch(e) {}
  return clean;
}

function loadPlayerName() {
  const candidates = [];
  try {
    candidates.push(localStorage.getItem(PLAYER_NAME_KEY) || '');
    candidates.push(localStorage.getItem('spenatstorm_display_name') || '');
  } catch(e) {}
  try {
    const m = location.hash.match(/(?:^#|&)spelare=([^&]+)/);
    if (m) candidates.push(decodeURIComponent(m[1]));
  } catch(e) {}
  try {
    const scores = getLocalScores();
    if (scores.length) candidates.push(scores[0].name || '');
  } catch(e) {}
  for (const candidate of candidates) {
    const result = validateNameClient(candidate);
    if (result.ok) return result.name;
  }
  return '';
}

async function applySavedPlayerName() {
  let saved = await idbLoadPlayerName();
  if(!saved) saved = loadPlayerName();
  if (!saved) return false;
  confirmedName = saved;
  ui.nameInput.value = saved;
  ui.nameStatus.textContent = `✓ Sparat namn: ${saved}`;
  ui.nameStatus.classList.remove('bad');
  ui.startBtn.disabled = false;
  savePlayerName(saved);
  return true;
}


const ui = {
  hud: $('#hud'), start: $('#startScreen'), upgrade: $('#upgradeScreen'), pause: $('#pauseScreen'), result: $('#resultScreen'),
  nameInput: $('#nameInput'), confirmName: $('#confirmNameBtn'), nameStatus: $('#nameStatus'), startBtn: $('#startBtn'),
  startServerInfo: $('#startServerInfo'), startLeaderboard: $('#startLeaderboard'), resultLeaderboard: $('#resultLeaderboard'),
  hpBar: $('#hpBar'), hpText: $('#hpText'), levelText: $('#levelText'), timeText: $('#timeText'), killText: $('#killText'),
  xpBar: $('#xpBar'), xpText: $('#xpText'), xpOrbFill: $('#xpOrbFill'), xpOrbText: $('#xpOrbText'), jimmyText: $('#jimmyText'), jimmyBar: $('#jimmyBar'), serverBadge: $('#serverBadge'),
  pauseBtn: $('#pauseBtn'), settingsBtn: $('#settingsBtn'), fullscreenBtn: $('#fullscreenBtn'), resumeBtn: $('#resumeBtn'), quitBtn: $('#quitBtn'),
  upgradeLevel: $('#upgradeLevel'), upgradeChoices: $('#upgradeChoices'), resultTime: $('#resultTime'), resultLevel: $('#resultLevel'),
  resultKills: $('#resultKills'), resultSkills: $('#resultSkills'), saveStatus: $('#saveStatus'), rankStatus: $('#rankStatus'),
  againBtn: $('#againBtn'), joystick: $('#joystick'), joyKnob: $('#joyKnob'), toast: $('#toast'), settings: $('#settingsScreen'), settingsSoundBtn: $('#settingsSoundBtn'), joyLeftBtn: $('#joyLeftBtn'), joyRightBtn: $('#joyRightBtn'), closeSettingsBtn: $('#closeSettingsBtn'), zoomControls: $('#zoomControls'), zoomInBtn: $('#zoomInBtn'), zoomOutBtn: $('#zoomOutBtn'), zoomLabel: $('#zoomLabel'), dashBtn: $('#dashBtn'), dashCharges: $('#dashCharges'), dashCooldown: $('#dashCooldown'), zoomButtonsToggle: $('#zoomButtonsToggle'), desktopHpFill: $('#desktopHpFill'), desktopHpText: $('#desktopHpText'), desktopXpFill: $('#desktopXpFill'), desktopXpText: $('#desktopXpText')
};

const SKILLS = {
  kasta: { name: 'Turboarm', emoji: '⚡', desc: 'Davina anfaller 18 % oftare.', apply: s => s.player.attackCooldown = Math.max(.16, s.player.attackCooldown * 0.82) },
  fler: { name: 'Projektilfest', emoji: '✨', desc: 'Två extra projektiler per attack.', apply: s => s.player.projectileCount += 2 },
  kraft: { name: 'Riktigt kraftiga kast', emoji: '💫', desc: '40 % mer skada från Davinas projektiler.', apply: s => s.player.damage *= 1.40 },
  rackvidd: { name: 'Långkastare', emoji: '🎯', desc: '25 % längre räckvidd och 15 % snabbare projektiler.', apply: s => { s.player.range *= 1.25; s.player.projectileSpeed *= 1.15; } },
  storlek: { name: 'Jätteprojektiler', emoji: '🫧', desc: '70 % större projektiler och 18 % mer skada.', apply: s => { s.player.projectileSize *= 1.70; s.player.damage *= 1.18; } },
  genomslag: { name: 'Rakt igenom!', emoji: '🧵', desc: 'Projektilerna kan träffa en extra fiende innan de försvinner.', apply: s => s.player.projectilePierce += 1 },
  kritisk: { name: 'Turträffar', emoji: '🍀', desc: '+12 % chans att göra dubbel skada.', apply: s => s.player.critChance = Math.min(.60, s.player.critChance + .12) },
  dubbelstorm: { name: 'Spenatorkan', emoji: '🥬', desc: 'Spenatstormen blir större, starkare och kommer oftare.', apply: s => { s.player.stormRank += 2; s.player.stormPower *= 1.25; } },
  fart: { name: 'Riktigt lätta skor', emoji: '👟', desc: 'Davina rör sig 15 % snabbare.', apply: s => s.player.speed *= 1.15 },
  skydd: { name: 'Rejält mjukt skydd', emoji: '🧣', desc: 'Minskar skada med 10 procentenheter.', apply: s => s.player.armor = Math.min(0.65, s.player.armor + 0.10) },
  maxhalsa: { name: 'Extra mycket ork', emoji: '💜', desc: 'Ökar maxhälsan med 30 och läker 35.', apply: s => { s.player.maxHp += 30; s.player.hp = Math.min(s.player.maxHp, s.player.hp + 35); } },
  spenatstorm: { name: 'Spenatstorm', emoji: '🌿', desc: 'En stor grön områdespuff slår till regelbundet.', apply: s => { s.player.stormRank += 1; s.player.stormPower *= 1.12; } },
  jimmySkall: { name: 'Jimmys superskall', emoji: '📣', desc: 'Jimmy skäller 22 % oftare och når längre.', apply: s => { s.jimmy.barkCooldown = Math.max(1.5, s.jimmy.barkCooldown * 0.78); s.jimmy.barkRadius *= 1.12; } },
  jimmyNos: { name: 'Jimmys supernos', emoji: '👃', desc: 'Jimmy drar in erfarenhet från 35 % längre håll.', apply: s => s.jimmy.magnetRadius *= 1.35 },
  jimmyKraft: { name: 'Jimmys vrål', emoji: '🐾', desc: 'Jimmys skall gör 55 % mer skada.', apply: s => s.jimmy.barkDamage *= 1.55 },

  chainLightning:{name:'Chain Lightning',emoji:'⚡',kind:'AKTIV',desc:'Blixt hoppar mellan fiender och delar sig på högre nivå.',apply:s=>{}},
  shockwave:{name:'Shockvåg',emoji:'💥',kind:'AKTIV',desc:'Automatisk våg runt Davina skadar och knuffar bort fiender.',apply:s=>{}},
  jimmyZoomies:{name:'Jimmy Zoomies',emoji:'🐕',kind:'AKTIV',desc:'Jimmy får tokryck och rusar genom fiender.',apply:s=>{}},
  boneStorm:{name:'ONE STORM',emoji:'🦴',kind:'AKTIV',desc:'Ben skjuts åt alla håll. Högre nivå ger groteskt fler ben.',apply:s=>{}},
  jimmyAttack:{name:'Jimmy Attack',emoji:'🐶',kind:'AKTIV',desc:'Jimmy rusar, biter och studsar mellan fler mål.',apply:s=>{}},
  chicken:{name:'Emergency Chicken',emoji:'🐔',kind:'AKTIV',desc:'Planlös kyckling med enorm kontaktskada. Varför? Ingen vet.',apply:s=>{}},
  poopMines:{name:'Poop Mines',emoji:'💩',kind:'AKTIV',desc:'Davina lämnar minor som exploderar i spenat.',apply:s=>{}},
  unstableSpinach:{name:'Instabil Spenat',emoji:'💣',kind:'PASSIV',desc:'+1 % chans per nivå att en besegrad mob exploderar och skadar allt nära.',apply:s=>{}}
};

let dpr = 1, width = 0, height = 0;
let state = null;
let confirmedName = '';
let audioOn = true;
let joystickSide='left';
let cameraZoom=1;
let showZoomButtons=false;
const MIN_ZOOM=.5, MAX_ZOOM=1.25, ZOOM_STEP=.1;
const SETTINGS_KEY='spenatstorm_settings_v1';
let audioCtx = null;
let lastFrame = performance.now();
let toastTimer = 0;
const keys = new Set();
const joy = { active: false, pointerId: null, x: 0, y: 0 };

function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  width = window.innerWidth; height = window.innerHeight;
  canvas.width = Math.floor(width * dpr); canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize); resize();

function formatTime(ms) {
  const t = Math.floor(ms / 1000), m = Math.floor(t / 60), s = t % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function distSq(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; }
function rand(a, b) { return a + Math.random() * (b - a); }
function choose(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function showToast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 1800);
}

function ensureAudio() {
  if (!audioOn) return null;
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function loadSettings(){
  try{
    const saved=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}');
    if(typeof saved.audioOn==='boolean')audioOn=saved.audioOn;
    if(saved.joystickSide==='left'||saved.joystickSide==='right')joystickSide=saved.joystickSide;
    if(typeof saved.showZoomButtons==='boolean')showZoomButtons=saved.showZoomButtons;
    if(Number.isFinite(saved.cameraZoom))cameraZoom=clamp(saved.cameraZoom,MIN_ZOOM,MAX_ZOOM);
  }catch(e){}
  applySettingsUI();
}
function saveSettings(){
  try{localStorage.setItem(SETTINGS_KEY,JSON.stringify({audioOn,joystickSide,showZoomButtons,cameraZoom}));}catch(e){}
}
function applySettingsUI(){
  if(ui.settingsSoundBtn)ui.settingsSoundBtn.textContent=audioOn?'🔊 På':'🔇 Av';
  if(ui.zoomButtonsToggle)ui.zoomButtonsToggle.textContent=showZoomButtons?'🔍 På':'🚫 Av';
  if(ui.joyLeftBtn&&ui.joyRightBtn){
    ui.joyLeftBtn.classList.toggle('active',joystickSide==='left');
    ui.joyRightBtn.classList.toggle('active',joystickSide==='right');
  }
  if(ui.joystick)ui.joystick.classList.toggle('joy-right',joystickSide==='right');
  if(ui.dashBtn){ui.dashBtn.classList.toggle('dash-left',joystickSide==='right');ui.dashBtn.classList.toggle('dash-right',joystickSide!=='right');}
  if(ui.zoomControls){
    ui.zoomControls.classList.toggle('zoom-left',joystickSide==='right');
    const playing=!!(state&&state.running&&!state.over);
    ui.zoomControls.classList.toggle('zoom-hidden',!showZoomButtons||!playing);
  }
  if(ui.zoomLabel)ui.zoomLabel.textContent=`${Math.round(cameraZoom*100)}%`;
}
function setZoom(value,save=true){
  cameraZoom=clamp(value,MIN_ZOOM,MAX_ZOOM);
  if(ui.zoomLabel)ui.zoomLabel.textContent=`${Math.round(cameraZoom*100)}%`;
  if(save)saveSettings();
}
function openSettings(){if(state)state.paused=true;applySettingsUI();ui.settings.classList.add('show');}
function closeSettings(){ui.settings.classList.remove('show');if(state&&!state.over&&!state.choosing)state.paused=false;}

function beep(freq = 440, dur = .08, type = 'sine', gain = .03, slide = 0) {
  const a = ensureAudio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, a.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), a.currentTime + dur);
  g.gain.setValueAtTime(gain, a.currentTime); g.gain.exponentialRampToValueAtTime(.0001, a.currentTime + dur);
  o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + dur);
}


let lastSfx={};
function noiseBuffer(seconds=.12){
  const a=ensureAudio();if(!a)return null;const n=Math.max(1,Math.floor(a.sampleRate*seconds)),b=a.createBuffer(1,n,a.sampleRate),d=b.getChannelData(0);
  for(let i=0;i<n;i++)d[i]=Math.random()*2-1;return b;
}
function tone(freq,dur=.08,type='sine',gain=.05,slide=0,delay=0){
  const a=ensureAudio();if(!a)return;const t=a.currentTime+delay,o=a.createOscillator(),g=a.createGain();o.type=type;o.frequency.setValueAtTime(freq,t);
  if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(35,freq+slide),t+dur);
  g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(gain,t+.008);g.gain.exponentialRampToValueAtTime(.0001,t+dur);
  o.connect(g).connect(a.destination);o.start(t);o.stop(t+dur+.02);
}
function noise(dur=.1,gain=.04,delay=0){
  const a=ensureAudio(),b=noiseBuffer(dur);if(!a||!b)return;const t=a.currentTime+delay,s=a.createBufferSource(),g=a.createGain(),f=a.createBiquadFilter();
  s.buffer=b;f.type='bandpass';f.frequency.value=900;g.gain.setValueAtTime(gain,t);g.gain.exponentialRampToValueAtTime(.0001,t+dur);s.connect(f).connect(g).connect(a.destination);s.start(t);
}
function sfx(name){
  if(!audioOn)return;const now=performance.now(),limits={xp:45,hit:55,shot:80,mobDeath:65};if(limits[name]&&now-(lastSfx[name]||0)<limits[name])return;lastSfx[name]=now;
  switch(name){
    case'shot':tone(300,.045,'triangle',.035,130);break;
    case'hit':noise(.045,.035);tone(150,.045,'square',.018,-35);break;
    case'crit':tone(820,.08,'square',.055,-260);tone(1180,.06,'sine',.035,-180,.025);break;
    case'xp':tone(760,.035,'sine',.028,150);break;
    case'heal':tone(520,.10,'sine',.05,260);tone(780,.11,'sine',.04,180,.07);break;
    case'level':tone(440,.11,'triangle',.05,300);tone(660,.12,'triangle',.05,330,.09);tone(880,.15,'sine',.04,250,.18);break;
    case'lightning':noise(.12,.055);tone(1200,.10,'sawtooth',.045,-800);break;
    case'shock':tone(110,.22,'sine',.07,180);noise(.16,.045);break;
    case'bones':noise(.10,.035);tone(340,.12,'triangle',.045,-120);break;
    case'chicken':tone(720,.07,'square',.05,-250);tone(520,.08,'square',.04,150,.07);break;
    case'poop':tone(90,.08,'square',.035,-20);break;
    case'explosion':noise(.22,.08);tone(78,.22,'sawtooth',.055,-25);break;
    case'jimmy':tone(185,.13,'square',.055,-65);tone(125,.11,'sawtooth',.04,-25,.06);break;
    case'dash':noise(.11,.045);tone(260,.10,'sine',.05,420);break;
    case'dashReady':tone(680,.07,'sine',.035,180);break;
    case'mobDeath':tone(165,.045,'triangle',.025,70);break;
    case'damage':noise(.09,.05);tone(105,.10,'sawtooth',.045,-35);break;
    case'boss':tone(82,.32,'sawtooth',.07,-30);tone(55,.4,'square',.045,-12,.18);break;
    case'appz':tone(58,.38,'sawtooth',.08,-18);noise(.28,.07,.12);tone(42,.45,'square',.05,-8,.22);break;
    case'gameover':tone(220,.25,'triangle',.055,-120);tone(130,.35,'triangle',.05,-65,.2);break;
  }
}
function unlockAudio(){try{ensureAudio();}catch(e){}}
window.addEventListener('pointerdown',unlockAudio,{once:true});
window.addEventListener('keydown',unlockAudio,{once:true});

function getLocalScores() {
  try {
    const raw = localStorage.getItem(LOCAL_SCORE_KEY);
    const scores = raw ? JSON.parse(raw) : [];
    return Array.isArray(scores) ? scores : [];
  } catch {
    return [];
  }
}

function saveLocalScore(score) {
  const scores = getLocalScores();
  scores.push(score);
  scores.sort((a, b) => (b.durationMs - a.durationMs) || (b.level - a.level) || (b.kills - a.kills));
  // Spara de 100 bästa lokalt så listan inte växer för alltid.
  localStorage.setItem(LOCAL_SCORE_KEY, JSON.stringify(scores.slice(0, 100)));
  const saved = getLocalScores();
  const idx = saved.findIndex(s => s.id === score.id);
  return { position: idx >= 0 ? idx + 1 : null, top10: idx >= 0 && idx < 10 };
}

function validateNameClient(value) {
  const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (name.length < 2) return { ok: false, error: 'Skriv minst 2 tecken.' };
  if (name.length > 16) return { ok: false, error: 'Högst 16 tecken.' };
  if (!/^[A-Za-zÅÄÖåäöÉéÜü0-9 _-]+$/u.test(name)) return { ok: false, error: 'Använd bara bokstäver, siffror, mellanslag, - eller _.' };
  const blocked = ['nazi','hitler','heil','kkk','hora','horunge','fitta','kuk','neger','nigger','retard','pedofil','pedo'];
  const compact = name.toLocaleLowerCase('sv-SE').replace(/[ _-]/g, '');
  if (blocked.some(x => compact.includes(x))) return { ok: false, error: 'Välj ett annat visningsnamn.' };
  return { ok: true, name };
}

ui.confirmName.addEventListener('click', () => {
  const result = validateNameClient(ui.nameInput.value);
  if (!result.ok) {
    confirmedName = ''; ui.startBtn.disabled = true; ui.nameStatus.textContent = result.error; ui.nameStatus.classList.add('bad'); beep(180, .12, 'square', .025, -50); return;
  }
  confirmedName = result.name;
  ui.nameInput.value = result.name;
  savePlayerName(result.name);
  ui.startBtn.disabled = false;
  ui.nameStatus.textContent = `✓ Namnet “${confirmedName}” är bekräftat.`;
  ui.nameStatus.classList.remove('bad'); beep(620, .08, 'sine', .025, 180);
});
ui.nameInput.addEventListener('input', () => {
  if (confirmedName && ui.nameInput.value.trim() !== confirmedName) {
    confirmedName = ''; ui.startBtn.disabled = true; ui.nameStatus.textContent = 'Bekräfta namnet igen efter ändringen.';
  }
});
ui.nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') ui.confirmName.click(); });

function newState() {
  return {
    running: true, paused: false, choosing: false, over: false, quit: false, facingX:1, facingY:0, dashCharges:2, dashRecharge:0, dashTime:0, noEnemyTime:0,
    elapsedMs: 0,
    player: { x: 0, y: 0, radius: 17, hp: 110, maxHp: 110, speed: 225, armor: 0, level: 1, xp: 0, xpNeed: 6, damage: 28, attackCooldown: .60, attackTimer: .2, projectileCount: 2, projectileSpeed: 500, projectileSize: 7, projectilePierce: 0, critChance: .05, range: 660, invuln: 0, stormRank: 0, stormPower: 1, stormTimer: 4.2 },
    jimmy: { x: -44, y: 28, radius: 13, barkCooldown: 6, barkTimer: 2.2, barkRadius: 110, barkDamage: 25, magnetRadius: 135 },
    enemies: [], projectiles: [], enemyBullets: [], skillProjectiles: [], mines: [], chickens: [], lightningFx: [], zoomies: [], orbs: [], heals: [], particles: [], rings: [], popups: [], skills: new Map(), kills: 0,
    skillTimers:{chainLightning:2.2,shockwave:3.4,jimmyZoomies:7,boneStorm:4.5,jimmyAttack:3.8,chicken:9,poopMines:2.4},
    spawnTimer: .55, healSpawnTimer: rand(6, 11), enemyId: 0, nextBossAt: 50, bossCount: 0, nextAppzAt: 600, appzCount: 0, minuteTier: 0, backgroundVariant: Math.floor(Math.random()*6), camera: { x: 0, y: 0 }, shake: 0
  };
}

function startGame() {
  if (confirmedName) savePlayerName(confirmedName);
  const result = validateNameClient(confirmedName);
  if (!result.ok) return;
  ensureAudio();
  ui.startBtn.disabled = true;
  ui.startBtn.textContent = 'Startar…';
  state = newState();
  applySettingsUI();
  ui.serverBadge.textContent = '🌍 Världstopplista';
  ui.serverBadge.classList.remove('offline');
  ui.start.classList.remove('show');
  ui.result.classList.remove('show');
  ui.hud.classList.remove('hidden');
  if (matchMedia('(pointer: coarse)').matches){ui.joystick.classList.remove('hidden');ui.dashBtn.classList.remove('hidden');}
  applySettingsUI();
  ui.startBtn.textContent = 'Starta spelomgång';
  ui.startBtn.disabled = false;
  lastFrame = performance.now();
  beep(440,.08,'sine',.025,160);
  setTimeout(()=>beep(660,.09,'sine',.02,120),80);
}
ui.startBtn.addEventListener('click', startGame);

function movementVector() {
  let x = 0, y = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
  x += joy.x; y += joy.y;
  const len = Math.hypot(x,y); if (len > 1) { x/=len; y/=len; }
  if(state && Math.hypot(x,y)>.08){state.facingX=x;state.facingY=y;}
  return { x, y };
}
window.addEventListener('keydown', e => {
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if(e.code==='Space'&&state?.running&&!state.paused&&!state.choosing){e.preventDefault();doDash();return;}
  if(e.code==='Escape'&&ui.settings?.classList.contains('show')){closeSettings();return;}
  if (e.code === 'Escape' && state?.running && !state.over && !state.choosing) togglePause();
});
window.addEventListener('keyup', e => keys.delete(e.code));

function joyUpdate(e) {
  const r = ui.joystick.getBoundingClientRect(), cx = r.left+r.width/2, cy = r.top+r.height/2;
  let dx = e.clientX-cx, dy = e.clientY-cy; const max = 42, len = Math.hypot(dx,dy);
  if (len > max) { dx = dx/len*max; dy = dy/len*max; }
  joy.x = dx/max; joy.y = dy/max;
  ui.joyKnob.style.transform = `translate(${dx}px,${dy}px)`;
}
ui.joystick.addEventListener('pointerdown', e => { joy.active = true; joy.pointerId=e.pointerId; ui.joystick.setPointerCapture(e.pointerId); joyUpdate(e); });
ui.joystick.addEventListener('pointermove', e => { if (joy.active && e.pointerId===joy.pointerId) joyUpdate(e); });
function joyEnd(e) { if (e.pointerId!==joy.pointerId) return; joy.active=false; joy.pointerId=null; joy.x=joy.y=0; ui.joyKnob.style.transform='translate(0,0)'; }
ui.joystick.addEventListener('pointerup', joyEnd); ui.joystick.addEventListener('pointercancel', joyEnd);

let pinchStartDistance=0,pinchStartZoom=1;
function touchDistance(t){return t.length<2?0:Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);}
canvas.addEventListener('touchstart',e=>{if(e.touches.length===2){pinchStartDistance=touchDistance(e.touches);pinchStartZoom=cameraZoom;e.preventDefault();}},{passive:false});
canvas.addEventListener('touchmove',e=>{if(e.touches.length===2&&pinchStartDistance>10){setZoom(pinchStartZoom*(touchDistance(e.touches)/pinchStartDistance),false);e.preventDefault();}},{passive:false});
canvas.addEventListener('touchend',e=>{if(e.touches.length<2&&pinchStartDistance){pinchStartDistance=0;saveSettings();}},{passive:false});
canvas.addEventListener('touchcancel',()=>{pinchStartDistance=0;saveSettings();},{passive:false});
canvas.addEventListener('wheel',e=>{if(!state?.running)return;e.preventDefault();setZoom(cameraZoom+(e.deltaY<0?ZOOM_STEP:-ZOOM_STEP));},{passive:false});


function doDash(){
  if(!state||!state.running||state.paused||state.choosing||state.over||state.dashCharges<=0)return;
  let dx=state.facingX||1,dy=state.facingY||0,l=Math.hypot(dx,dy)||1;dx/=l;dy/=l;
  state.dashCharges--; if(state.dashCharges<2&&state.dashRecharge<=0)state.dashRecharge=4;
  state.dashTime=.20; state.player.x+=dx*185; state.player.y+=dy*185;
  state.shake=Math.max(state.shake,4);spinachBurst(state.player.x,state.player.y,10,.55);
  sfx('dash'); updateDashUI();
}
function updateDash(dt){
  if(!state)return;
  state.dashTime=Math.max(0,state.dashTime-dt);
  if(state.dashCharges<2){
    state.dashRecharge-=dt;
    if(state.dashRecharge<=0){state.dashCharges++;state.dashRecharge=state.dashCharges<2?4:0;sfx('dashReady');}
  }
  updateDashUI();
}
function updateDashUI(){
  if(!ui.dashBtn||!state)return;
  ui.dashCharges.textContent=`${state.dashCharges}/2`;
  const pct=state.dashCharges>=2?1:clamp(1-state.dashRecharge/4,0,1);
  ui.dashCooldown.style.height=`${pct*100}%`;
  ui.dashBtn.classList.toggle('empty',state.dashCharges<=0);
}

function togglePause() {
  if (!state || state.over || state.choosing) return;
  state.paused = !state.paused;
  ui.pause.classList.toggle('show', state.paused);
  if (state.paused) beep(260,.08,'triangle',.02,-40); else { lastFrame = performance.now(); beep(420,.06,'triangle',.02,80); }
}
ui.pauseBtn.addEventListener('click', togglePause); ui.resumeBtn.addEventListener('click', togglePause);
ui.quitBtn.addEventListener('click', () => { if (!state) return; state.quit = true; state.paused = false; ui.pause.classList.remove('show'); gameOver(); });
ui.settingsBtn.addEventListener('click',openSettings);
ui.settingsSoundBtn.addEventListener('click',()=>{audioOn=!audioOn;saveSettings();applySettingsUI();if(audioOn)beep(520,.08,'sine',.025,120);});
ui.joyLeftBtn.addEventListener('click',()=>{joystickSide='left';saveSettings();applySettingsUI();});
ui.joyRightBtn.addEventListener('click',()=>{joystickSide='right';saveSettings();applySettingsUI();});
ui.zoomButtonsToggle.addEventListener('click',()=>{showZoomButtons=!showZoomButtons;saveSettings();applySettingsUI();});
ui.dashBtn.addEventListener('pointerdown',e=>{e.preventDefault();doDash();});
ui.zoomInBtn.addEventListener('click',()=>setZoom(cameraZoom+ZOOM_STEP));
ui.zoomOutBtn.addEventListener('click',()=>setZoom(cameraZoom-ZOOM_STEP));
ui.closeSettingsBtn.addEventListener('click',closeSettings);
ui.settings.addEventListener('click',e=>{if(e.target===ui.settings)closeSettings();});
ui.fullscreenBtn.addEventListener('click', async () => { try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); else await document.exitFullscreen(); } catch(e) { showToast('Fullskärm stöds inte här.'); } });
document.addEventListener('fullscreenchange', () => { ui.fullscreenBtn.textContent = document.fullscreenElement ? '⤢' : '⛶'; ui.fullscreenBtn.title = document.fullscreenElement ? 'Avsluta fullskärm' : 'Fullskärm'; setTimeout(resize,50); });

function spawnEnemy() {
  const t=state.elapsedMs/1000, minute=Math.floor(t/60);
  const tiers=[
    {name:'Geléfnatt',color:'#d9a7d8',eye:'#65445f',hp:24,speed:48,damage:8,radius:14,xp:1,pack:1,shooter:0},
    {name:'Persikopuff',color:'#ffbf9d',eye:'#74483c',hp:28,speed:52,damage:9,radius:14,xp:1,pack:2,shooter:0},
    {name:'Blåbärsbuse',color:'#9fc9e5',eye:'#39586e',hp:34,speed:57,damage:10,radius:15,xp:1,pack:2,shooter:.08},
    {name:'Korallstök',color:'#e69a9a',eye:'#6e3f55',hp:40,speed:61,damage:11,radius:15,xp:2,pack:3,shooter:.13},
    {name:'Mintmarodör',color:'#86cfb3',eye:'#315f50',hp:48,speed:65,damage:12,radius:16,xp:2,pack:3,shooter:.18},
    {name:'Plommonpucko',color:'#b99adb',eye:'#513d6b',hp:58,speed:69,damage:13,radius:17,xp:2,pack:4,shooter:.23},
    {name:'Rosa rövare',color:'#ef9fbd',eye:'#704052',hp:70,speed:73,damage:14,radius:17,xp:3,pack:4,shooter:.28},
    {name:'Turkost trubbel',color:'#70c9c8',eye:'#285d60',hp:84,speed:77,damage:15,radius:18,xp:3,pack:4,shooter:.32}
  ];
  const tier=tiers[Math.min(minute,tiers.length-1)], late=Math.max(0,minute-(tiers.length-1));
  const hpScale=1+minute*.055+late*.045, dmgScale=1+minute*.035+late*.025, speedScale=1+Math.min(.32,minute*.025);
  const group=Math.min(10,(tier.pack+(late>=3?1:0))*2);
  const ang=Math.random()*Math.PI*2,halfView=Math.max(width,height)/(2*Math.max(.75,cameraZoom)),rad=halfView+rand(170,290),bx=state.player.x+Math.cos(ang)*rad,by=state.player.y+Math.sin(ang)*rad;
  for(let i=0;i<group;i++){
    const elite=t>100&&Math.random()<Math.min(.08,.012+t/2600), shooter=minute>=2&&Math.random()<tier.shooter;
    const hp=tier.hp*hpScale*(elite?2.25:1)*(shooter?1.08:1);
    let sx=bx+rand(-80,80),sy=by+rand(-80,80),rr=tier.radius*1.50*(elite?1.24:1);
    for(let tries=0;tries<10;tries++){let blocked=state.enemies.some(e=>!e.dead&&Math.hypot(e.x-sx,e.y-sy)<(e.radius*.72+rr*.72+8));if(!blocked)break;const aa=Math.random()*6.283,dd=rr*2.2+rand(12,48);sx=bx+Math.cos(aa)*dd+rand(-60,60);sy=by+Math.sin(aa)*dd+rand(-60,60);}
    state.enemies.push({id:++state.enemyId,x:sx,y:sy,type:shooter?'skytt':'minute',minuteTier:minute,enemyName:tier.name,radius:rr,hp,maxHp:hp,speed:tier.speed*speedScale*(elite?.94:1)*(shooter?.78:1),damage:tier.damage*dmgScale,color:tier.color,eye:tier.eye,xp:tier.xp*(elite?3:1),elite,shooter,shootTimer:shooter?rand(1.2,2.6):0,shootCooldown:Math.max(1.45,2.55-minute*.07),wobble:Math.random()*6.28,hit:0});
  }
}

function spawnBoss() {
  const t = state.elapsedMs / 1000;
  state.bossCount += 1;
  const n = state.bossCount;
  const ang = Math.random() * Math.PI * 2;
  const radius = Math.max(width, height) * .58 + 120;
  const x = state.player.x + Math.cos(ang) * radius;
  const y = state.player.y + Math.sin(ang) * radius;
  const hp = 945 * Math.pow(1.38, n - 1) * (1 + t / 310);
  const speed = Math.min(64, 36 + n * 3.5);
  const damage = Math.min(36, 15 + n * 2.4);
  // Kayvan läggs ovanpå det befintliga kaoset. Inga monster despawnar.
  state.enemies.push({
    id: ++state.enemyId, x, y, type: 'kayvan', radius: 78,
    hp, maxHp: hp, speed, damage, color: '#8a73c7', xp: (18 + n * 4) * 2,
    elite: false, boss: true, bossName: 'Den farliga Kayvan', wobble: 0, hit: 0
  });
  state.rings.push({ x, y, r: 20, max: 115, life: .8, total: .8, boss: true });
  showToast(`⚠️ DEN FARLIGA KAYVAN ÄR HÄR! Nu blev allt värre!`);
  popup(x, y - 58, 'DEN FARLIGA KAYVAN!', '#6a4f9e');
  sfx('boss');
}

function spawnAppz() {
  const t=state.elapsedMs/1000; state.appzCount++; const n=state.appzCount;
  const ang=Math.random()*Math.PI*2, sr=(Math.max(width,height)*.72)/cameraZoom+180;
  const x=state.player.x+Math.cos(ang)*sr, y=state.player.y+Math.sin(ang)*sr;
  const kayvanEquivalent=945*Math.pow(1.38,Math.max(0,state.bossCount-1))*(1+t/310);
  const hp=kayvanEquivalent*4, damage=Math.min(54,22+n*4), speed=Math.min(58,31+n*2.5);
  // APPZ kommer in som extra katastrof. Inga befintliga monster tas bort.
  state.enemies.push({id:++state.enemyId,x,y,type:'appz',radius:105,hp,maxHp:hp,speed,damage,color:'#4b3b56',xp:90+n*18,elite:false,boss:true,appz:true,bossName:'APPZ THE MIGHTY',wobble:0,hit:0});
  state.rings.push({x,y,r:25,max:180,life:1,total:1,boss:true});
  showToast('🦍 APPZ THE MIGHTY ÄR HÄR!'); sfx('appz');
}

function autoAttack(dt) {
  const p = state.player; p.attackTimer -= dt; if (p.attackTimer > 0) return;
  let target = null, best = p.range*p.range;
  for (const e of state.enemies) { const d = distSq(p,e); if (d < best) { best=d; target=e; } }
  if (!target) return;
  p.attackTimer += p.attackCooldown;
  const base = Math.atan2(target.y-p.y,target.x-p.x), count=p.projectileCount;
  for (let i=0;i<count;i++) {
    const spread = (i-(count-1)/2)*Math.min(.20, .75/Math.max(1,count));
    const a=base+spread;
    const crit = Math.random() < p.critChance;
    state.projectiles.push({ x:p.x, y:p.y, vx:Math.cos(a)*p.projectileSpeed, vy:Math.sin(a)*p.projectileSpeed, radius:p.projectileSize, damage:p.damage*(crit?2:1), crit, pierce:p.projectilePierce, hitIds:new Set(), life:p.range/p.projectileSpeed+0.25 });
  }
  sfx('shot');
}

function updateJimmy(dt) {
  const j=state.jimmy,p=state.player;
  const targetX=p.x-42, targetY=p.y+32;
  if(!state.zoomies.length){j.x += (targetX-j.x)*Math.min(1,dt*5.4); j.y += (targetY-j.y)*Math.min(1,dt*5.4);}
  j.barkTimer -= dt;
  if (j.barkTimer <= 0) {
    j.barkTimer += j.barkCooldown;
    state.rings.push({ x:j.x,y:j.y,r:18,max:j.barkRadius,life:.45,total:.45 });
    let hit=0;
    for (const e of state.enemies) {
      const dx=e.x-j.x,dy=e.y-j.y,d=Math.hypot(dx,dy);
      if (d < j.barkRadius+e.radius) { e.hp-=j.barkDamage; e.x += dx/(d||1)*24; e.y += dy/(d||1)*24; e.hit=.12; hit++; if (e.hp<=0) killEnemy(e); }
    }
    spinachBurst(j.x,j.y,8,0.7); beep(165,.16,'square',.025,-50); setTimeout(()=>beep(120,.12,'sawtooth',.018,-30),65);
    if(hit) popup(j.x,j.y-28,`VOV! ${hit} träff${hit===1?'':'ar'}`,'#5e4b78');
  }
  for (const o of state.orbs) {
    const dx=j.x-o.x,dy=j.y-o.y,d=Math.hypot(dx,dy);
    if (d < j.magnetRadius) { const f=(1-d/j.magnetRadius)*420; o.vx += dx/(d||1)*f*dt; o.vy += dy/(d||1)*f*dt; }
  }
}


function skillRank(id){return state.skills.get(id)||0;}
function nearestEnemies(x,y,n=1,exclude=new Set()){return state.enemies.filter(e=>!e.dead&&!exclude.has(e.id)).sort((a,b)=>((a.x-x)**2+(a.y-y)**2)-((b.x-x)**2+(b.y-y)**2)).slice(0,n);}
function activeSkills(dt){
 const T=state.skillTimers;for(const k in T)T[k]-=dt;let r;
 r=skillRank('chainLightning');if(r&&T.chainLightning<=0){T.chainLightning=Math.max(.65,2.6-r*.16);let cur=state.player,hit=new Set();for(let i=0;i<2+r*2;i++){let e=nearestEnemies(cur.x,cur.y,1,hit)[0];if(!e||Math.hypot(e.x-cur.x,e.y-cur.y)>390)break;hit.add(e.id);state.lightningFx.push({x1:cur.x,y1:cur.y,x2:e.x,y2:e.y,life:.24,total:.24});state.rings.push({x:e.x,y:e.y,r:3,max:22,life:.18,total:.18,lightning:true});e.hp-=20+r*9;if(e.hp<=0)killEnemy(e);if(r>=4&&i%2===1){for(const b of nearestEnemies(e.x,e.y,Math.min(2,1+Math.floor((r-4)/2)),hit)){hit.add(b.id);state.lightningFx.push({x1:e.x,y1:e.y,x2:b.x,y2:b.y,life:.20,total:.20});b.hp-=14+r*6;if(b.hp<=0)killEnemy(b);}}cur=e;}sfx('lightning');}
 r=skillRank('shockwave');if(r&&T.shockwave<=0){T.shockwave=Math.max(1.3,4-r*.22);sfx('shock');let rad=120+r*24,dmg=18+r*10;state.rings.push({x:state.player.x,y:state.player.y,r:8,max:rad,life:.5,total:.5,shock:true});for(const e of state.enemies){let dx=e.x-state.player.x,dy=e.y-state.player.y,d=Math.hypot(dx,dy)||1;if(d<rad+e.radius){e.hp-=dmg;e.x+=dx/d*(35+r*5);e.y+=dy/d*(35+r*5);if(e.hp<=0)killEnemy(e);}}}
 r=skillRank('boneStorm');if(r&&T.boneStorm<=0){T.boneStorm=Math.max(1.4,5-r*.25);sfx('bones');let n=Math.min(72,8+r*7);for(let i=0;i<n;i++){let a=i/n*6.283;state.skillProjectiles.push({x:state.player.x,y:state.player.y,vx:Math.cos(a)*(260+r*18),vy:Math.sin(a)*(260+r*18),radius:5+r*.35,damage:13+r*6,life:2.2,pierce:Math.floor(r/4),hitIds:new Set()});}}
 r=skillRank('poopMines');if(r&&T.poopMines<=0){T.poopMines=Math.max(.7,2.8-r*.18);state.mines.push({x:state.player.x,y:state.player.y,radius:10,damage:28+r*12,blast:65+r*9,life:14});}
 r=skillRank('chicken');if(r&&T.chicken<=0){T.chicken=Math.max(5.5,10-r*.35);sfx('chicken');for(let q=0;q<(r>=5?2:1);q++){let a=Math.random()*6.283;state.chickens.push({x:state.player.x,y:state.player.y,vx:Math.cos(a)*(210+r*14),vy:Math.sin(a)*(210+r*14),radius:13,damage:34+r*13,life:3.5+r*.25,turn:.4});}}
 r=skillRank('jimmyZoomies');if(r&&T.jimmyZoomies<=0){T.jimmyZoomies=Math.max(4.5,8-r*.3);state.zoomies.push({life:1.8+r*.12,angle:Math.random()*6.283,speed:520+r*28,damage:30+r*11,turn:rand(-5.5,5.5)});showToast('🐕 JIMMY ZOOMIES!');sfx('jimmy');}
 r=skillRank('jimmyAttack');if(r&&T.jimmyAttack<=0){T.jimmyAttack=Math.max(1.7,4.4-r*.2);let ts=nearestEnemies(state.jimmy.x,state.jimmy.y,1+Math.floor(r/2));if(ts.length)state.zoomies.push({life:1.5,attack:true,targets:ts.map(e=>e.id),i:0,damage:24+r*12,speed:720,hit:new Set()});}
}
function updateSkillObjects(dt){
 for(const f of state.lightningFx)f.life-=dt;state.lightningFx=state.lightningFx.filter(f=>f.life>0);
 for(const z of state.zoomies){z.life-=dt;if(z.attack){let e=state.enemies.find(q=>q.id===z.targets[z.i]&&!q.dead);if(e){let dx=e.x-state.jimmy.x,dy=e.y-state.jimmy.y,d=Math.hypot(dx,dy)||1;state.jimmy.x+=dx/d*z.speed*dt;state.jimmy.y+=dy/d*z.speed*dt;if(d<e.radius+20&&!z.hit.has(e.id)){z.hit.add(e.id);e.hp-=z.damage;spinachBurst(e.x,e.y,8,.7);if(e.hp<=0)killEnemy(e);z.i++;sfx('jimmy');}}else z.i++;}else{z.angle+=z.turn*dt;state.jimmy.x+=Math.cos(z.angle)*z.speed*dt;state.jimmy.y+=Math.sin(z.angle)*z.speed*dt;for(const e of state.enemies)if(!e.dead&&Math.hypot(e.x-state.jimmy.x,e.y-state.jimmy.y)<e.radius+20){e.hp-=z.damage*dt*7;if(e.hp<=0)killEnemy(e);}}}state.zoomies=state.zoomies.filter(z=>z.life>0&&(!z.attack||z.i<z.targets.length));
 for(const c of state.chickens){c.life-=dt;c.turn-=dt;if(c.turn<=0){let a=Math.atan2(c.vy,c.vx)+rand(-1.5,1.5),sp=Math.hypot(c.vx,c.vy);c.vx=Math.cos(a)*sp;c.vy=Math.sin(a)*sp;c.turn=rand(.25,.8);}c.x+=c.vx*dt;c.y+=c.vy*dt;for(const e of state.enemies)if(!e.dead&&Math.hypot(e.x-c.x,e.y-c.y)<e.radius+c.radius){e.hp-=c.damage*dt*6;if(e.hp<=0)killEnemy(e);}}state.chickens=state.chickens.filter(c=>c.life>0);
 for(const m of state.mines){m.life-=dt;let hit=state.enemies.find(e=>!e.dead&&Math.hypot(e.x-m.x,e.y-m.y)<e.radius+m.radius);if(hit){m.life=0;spinachBurst(m.x,m.y,24,1.2);state.rings.push({x:m.x,y:m.y,r:5,max:m.blast,life:.4,total:.4,boom:true});sfx('explosion');for(const e of state.enemies)if(!e.dead&&Math.hypot(e.x-m.x,e.y-m.y)<m.blast+e.radius){e.hp-=m.damage;if(e.hp<=0)killEnemy(e);}}}state.mines=state.mines.filter(m=>m.life>0);
 for(const pr of state.skillProjectiles){pr.x+=pr.vx*dt;pr.y+=pr.vy*dt;pr.life-=dt;if(pr.life<=0)continue;for(const e of state.enemies){if(e.dead||pr.hitIds.has(e.id))continue;let rr=pr.radius+e.radius;if((pr.x-e.x)**2+(pr.y-e.y)**2<rr*rr){pr.hitIds.add(e.id);e.hp-=pr.damage;if(e.hp<=0)killEnemy(e);if(pr.pierce>0)pr.pierce--;else{pr.life=0;break;}}}}state.skillProjectiles=state.skillProjectiles.filter(p=>p.life>0);
}

function storm(dt) {
  const p=state.player;if(!p.stormRank)return; p.stormTimer-=dt;if(p.stormTimer>0)return;
  p.stormTimer=Math.max(1.15,4.5-p.stormRank*.34);const r=(130+p.stormRank*19)*p.stormPower, dmg=(16+p.stormRank*11)*p.stormPower;
  state.rings.push({x:p.x,y:p.y,r:8,max:r,life:.5,total:.5,storm:true});spinachBurst(p.x,p.y,18+p.stormRank*2,1);
  for(const e of state.enemies){if(Math.hypot(e.x-p.x,e.y-p.y)<r+e.radius){e.hp-=dmg;e.hit=.12;if(e.hp<=0)killEnemy(e);}}
  beep(250,.18,'sine',.018,180);
}

function killEnemy(e) {
  if (e.dead) return; e.dead=true; e.countedKill=true; state.kills++; const boomRank=skillRank('unstableSpinach'); const shouldBoom=!e.boss&&boomRank&&Math.random()<Math.min(.25,boomRank*.01);
  spinachBurst(e.x,e.y,e.elite?26:12,e.elite?1.5:1);
  state.orbs.push({x:e.x,y:e.y,vx:rand(-30,30),vy:rand(-30,30),value:e.xp,radius:e.boss?15:(e.elite?12:10),pulse:Math.random()*6.28});
  if(e.boss){ if(e.appz){ popup(e.x,e.y-70,'APPZ THE MIGHTY BLEV SPENAT!','#5e4b78'); spinachBurst(e.x,e.y,72,2.7); state.shake=16; } else { popup(e.x,e.y-70,'KAYVAN BLEV SPENAT!','#6a4f9e'); spinachBurst(e.x,e.y,56,2.3); state.shake=13; const before=state.player.hp; state.player.hp=Math.min(state.player.maxHp,state.player.hp+20); const healed=Math.ceil(state.player.hp-before); if(healed>0) showToast(`🌿 Kayvan blev spenat! +${healed} HP`); } } else if(e.elite) popup(e.x,e.y-28,'STOR SPENATHÖG!','#4f9275');
  beep(e.boss?72:(e.elite?100:190),e.boss?.16:.05,e.boss?'square':'sine',e.boss?.026:.012,e.boss?-20:(e.elite?-40:80));
  if(shouldBoom){let blast=72+boomRank*5,damage=18+boomRank*7;spinachBurst(e.x,e.y,22,1.2);state.rings.push({x:e.x,y:e.y,r:5,max:blast,life:.4,total:.4,boom:true});sfx('explosion');for(const other of state.enemies){if(!other.dead&&other!==e&&Math.hypot(other.x-e.x,other.y-e.y)<blast+other.radius){other.hp-=damage;if(other.hp<=0)killEnemy(other);}}}
}
function spinachBurst(x,y,count=10,scale=1){
  for(let i=0;i<count;i++){const a=Math.random()*6.28,sp=rand(40,180)*scale;state.particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:rand(.35,.9),max:1,size:rand(3,8)*scale,rot:Math.random()*6.28,leaf:Math.random()<.45,color:choose(['#5fa66f','#7fbe72','#9dce7b','#4f9275'])});}
}
function tomatoBurst(x,y,count=8){
  for(let i=0;i<count;i++){const a=Math.random()*6.283,sp=rand(35,130);state.particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:rand(.3,.65),max:1,size:rand(3,6),rot:Math.random()*6.283,leaf:false,color:choose(['#e84242','#ff6b5f','#f8b1a8'])});}
}
function popup(x,y,text,color='#3d4051'){ showToast(text); }


function spawnHealingTomato() {
  if (!state || state.heals.length >= 10) return;
  const a = Math.random() * Math.PI * 2;
  const d = rand(260, 720);
  state.heals.push({
    x: state.player.x + Math.cos(a) * d,
    y: state.player.y + Math.sin(a) * d,
    radius: 11,
    heal: 9,
    pulse: Math.random() * 6.28,
    rot: Math.random() * 6.28
  });
}

function collectHealingTomato(h) {
  h.dead = true;
  const p = state.player;
  const before = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + h.heal);
  const healed = Math.ceil(p.hp - before);
  tomatoBurst(h.x,h.y,8);
  popup(h.x, h.y - 18, healed > 0 ? `🍅 +${healed} HP` : '🍅 TOMAT!', '#f7e6d5');
  sfx('heal');
}

function gainXp(v) {
  const p=state.player;p.xp+=v;
  while(p.xp>=p.xpNeed){p.xp-=p.xpNeed;p.level++;p.xpNeed=Math.floor(p.xpNeed*1.24+3);openUpgrade();break;}
}

function n1(v,d=0){return Number(v).toFixed(d);}
function upgradePreview(id,rank){
  const p=state.player,jm=state.jimmy;
  switch(id){
    case'kasta':{const after=Math.max(.16,p.attackCooldown*.82);return `Attackintervall: ${p.attackCooldown.toFixed(2)} s → ${after.toFixed(2)} s`;}
    case'fler':return `Projektiler per attack: ${p.projectileCount} → ${p.projectileCount+2}`;
    case'kraft':return `Projektilskada: ${Math.round(p.damage)} → ${Math.round(p.damage*1.40)}`;
    case'rackvidd':return `Räckvidd: ${Math.round(p.range)} → ${Math.round(p.range*1.25)} • fart: ${Math.round(p.projectileSpeed)} → ${Math.round(p.projectileSpeed*1.15)}`;
    case'storlek':return `Storlek: ${p.projectileSize.toFixed(1)} → ${(p.projectileSize*1.70).toFixed(1)} • skada: ${Math.round(p.damage)} → ${Math.round(p.damage*1.18)}`;
    case'genomslag':return `Genomslag: ${p.projectilePierce} → ${p.projectilePierce+1} extra Monsterjävel`;
    case'kritisk':return `Critchans: ${Math.round(p.critChance*100)} % → ${Math.round(Math.min(.60,p.critChance+.12)*100)} %`;
    case'dubbelstorm':return `Spenatstorm-rank: ${p.stormRank} → ${p.stormRank+2} • kraft ×1,25`;
    case'fart':return `Rörelsefart: ${Math.round(p.speed)} → ${Math.round(p.speed*1.15)}`;
    case'skydd':return `Skademinskning: ${Math.round(p.armor*100)} % → ${Math.round(Math.min(.65,p.armor+.10)*100)} %`;
    case'maxhalsa':return `Max-HP: ${p.maxHp} → ${p.maxHp+30} • läker dessutom 35 HP`;
    case'spenatstorm':return `Spenatstorm-rank: ${p.stormRank} → ${p.stormRank+1} • kraft ×1,12`;
    case'jimmySkall':return `Skall-cooldown: ${jm.barkCooldown.toFixed(2)} s → ${Math.max(1.5,jm.barkCooldown*.78).toFixed(2)} s • radie ${Math.round(jm.barkRadius)} → ${Math.round(jm.barkRadius*1.12)}`;
    case'jimmyNos':return `XP-magnet: ${Math.round(jm.magnetRadius)} → ${Math.round(jm.magnetRadius*1.35)}`;
    case'jimmyKraft':return `Jimmys skallskada: ${Math.round(jm.barkDamage)} → ${Math.round(jm.barkDamage*1.55)}`;
    case'chainLightning':{const cd=Math.max(.65,2.6-rank*.16),jumps=2+rank*2,dmg=20+rank*9;return `Nivå ${rank}: ${jumps} hopp • ${dmg} skada/hopp • ${cd.toFixed(2)} s cooldown${rank>=4?' • kan FÖRGRENA SIG':''}`;}
    case'shockwave':return `Nivå ${rank}: ${18+rank*10} skada • radie ${120+rank*24} • ${Math.max(1.3,4-rank*.22).toFixed(2)} s cooldown`;
    case'jimmyZoomies':return `Nivå ${rank}: ${30+rank*11} skada • fart ${520+rank*28} • ${(1.8+rank*.12).toFixed(1)} s tokryck • ${Math.max(4.5,8-rank*.3).toFixed(1)} s cooldown`;
    case'boneStorm':return `Nivå ${rank}: ${Math.min(72,8+rank*7)} ben • ${13+rank*6} skada • fart ${260+rank*18} • ${Math.max(1.4,5-rank*.25).toFixed(2)} s cooldown${Math.floor(rank/4)>0?` • ${Math.floor(rank/4)} genomslag`:''}`;
    case'jimmyAttack':return `Nivå ${rank}: ${1+Math.floor(rank/2)} mål • ${24+rank*12} skada/bett • ${Math.max(1.7,4.4-rank*.2).toFixed(2)} s cooldown`;
    case'chicken':return `Nivå ${rank}: ${rank>=5?2:1} kyckling${rank>=5?'ar':''} • ${34+rank*13} kontaktskada • ${(3.5+rank*.25).toFixed(1)} s liv • ${Math.max(5.5,10-rank*.35).toFixed(2)} s cooldown`;
    case'poopMines':return `Nivå ${rank}: ${28+rank*12} skada • explosionsradie ${65+rank*9} • ${Math.max(.7,2.8-rank*.18).toFixed(2)} s mellan minor`;
    case'unstableSpinach':return `Nivå ${rank}: ${Math.min(25,rank)} % explosionschans • ${18+rank*7} skada • radie ${72+rank*5}`;
    default:return `Nivå ${rank}: förbättrar skiten.`;
  }
}
function openUpgrade(){
  if(!state||state.over)return;state.choosing=true;ui.upgradeLevel.textContent=state.player.level;ui.upgradeChoices.innerHTML='';
  const ids=Object.keys(SKILLS),weighted=[...ids,...[...state.skills.keys()].filter(id=>SKILLS[id]?.kind==='AKTIV')];
  const picks=[];
  while(picks.length<3&&weighted.length){
    const i=Math.floor(Math.random()*weighted.length),id=weighted[i];
    if(!picks.includes(id))picks.push(id);
    for(let q=weighted.length-1;q>=0;q--)if(weighted[q]===id)weighted.splice(q,1);
  }
  for(const id of picks){
    const sk=SKILLS[id],rank=(state.skills.get(id)||0)+1,b=document.createElement('button');b.className='upgrade-choice';
    b.innerHTML=`<span class="emoji">${sk.emoji}</span><strong>${sk.name}</strong><span class="skill-kind ${sk.kind==='AKTIV'?'active-kind':'passive-kind'}">${sk.kind||'PASSIV'}</span><span>${sk.desc}</span><div class="upgrade-next">${upgradePreview(id,rank)}</div><small>Blir nivå ${rank}</small>`;
    b.addEventListener('click',()=>chooseUpgrade(id));ui.upgradeChoices.appendChild(b);
  }
  ui.upgrade.classList.add('show');sfx('level');
}
function chooseUpgrade(id){const sk=SKILLS[id];state.skills.set(id,(state.skills.get(id)||0)+1);sk.apply(state);ui.upgrade.classList.remove('show');state.choosing=false;lastFrame=performance.now();showToast(`${sk.emoji} ${sk.name} förbättrad!`);}


function separateEnemies(){
  const cell=72,grid=new Map();
  for(const e of state.enemies){if(e.dead)continue;const cx=Math.floor(e.x/cell),cy=Math.floor(e.y/cell),k=cx+','+cy;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(e);}
  for(const e of state.enemies){if(e.dead)continue;const cx=Math.floor(e.x/cell),cy=Math.floor(e.y/cell),er=e.radius*.72;
    for(let gx=cx-1;gx<=cx+1;gx++)for(let gy=cy-1;gy<=cy+1;gy++){const arr=grid.get(gx+','+gy);if(!arr)continue;
      for(const o of arr){if(o===e||o.dead||o.id<e.id)continue;let dx=o.x-e.x,dy=o.y-e.y,d=Math.hypot(dx,dy)||.001,min=er+o.radius*.72+(e.boss||o.boss?10:0);
        if(d<min){let push=(min-d)*.52,nx=dx/d,ny=dy/d;if(e.boss&&!o.boss){o.x+=nx*push*1.6;o.y+=ny*push*1.6;}else if(o.boss&&!e.boss){e.x-=nx*push*1.6;e.y-=ny*push*1.6;}else{e.x-=nx*push*.5;e.y-=ny*push*.5;o.x+=nx*push*.5;o.y+=ny*push*.5;}}
      }
    }
  }
}

function update(dt) {
  const p=state.player; state.elapsedMs += dt*1000; p.invuln=Math.max(0,p.invuln-dt); state.shake=Math.max(0,state.shake-dt*28);
  const mv=movementVector();const oldPX=p.x,oldPY=p.y;p.x+=mv.x*p.speed*dt;p.y+=mv.y*p.speed*dt;
  if(state.dashTime<=0){for(const e of state.enemies){if(e.dead)continue;const dx=p.x-e.x,dy=p.y-e.y,d=Math.hypot(dx,dy)||.001,min=p.radius+e.radius*.70;if(d<min){p.x=e.x+dx/d*min;p.y=e.y+dy/d*min;}}}
  updateDash(dt);
  autoAttack(dt);updateJimmy(dt);storm(dt);activeSkills(dt);updateSkillObjects(dt);

  const t=state.elapsedMs/1000;
  const minuteNow=Math.floor(t/60);
  if(minuteNow>state.minuteTier){state.minuteTier=minuteNow;showToast(`⏱ ${minuteNow} MINUTER: nya monster har vaknat!`);beep(390,.10,'triangle',.018,150);setTimeout(()=>beep(520,.08,'triangle',.012,100),80);}
  if (t >= state.nextBossAt) {
    spawnBoss();
    state.nextBossAt += 90;
  }
  while(t >= state.nextAppzAt){ spawnAppz(); state.nextAppzAt += 600; }
  const bossActive=state.enemies.some(e=>e.boss&&!e.dead);
  state.spawnTimer-=dt;
  const interval=bossActive?Math.max(.26,.56/(1+t/300)):Math.max(.085,.44/(1+t/95));
  let spawnSafety=0;
  while(state.spawnTimer<=0&&spawnSafety++<12){
    state.spawnTimer+=interval;
    const regularCount=state.enemies.reduce((n,e)=>n+(!e.boss&&!e.dead?1:0),0);
    const regularCap=bossActive?Math.min(90,40+Math.floor(t/180)*6):Math.min(360,150+Math.floor(t/60)*12);
    if(regularCount<regularCap)spawnEnemy();
    if(!bossActive&&t>180&&Math.random()<.08)spawnEnemy();
  }
  if(!Number.isFinite(state.spawnTimer)||state.spawnTimer>5)state.spawnTimer=Math.min(.5,interval);
  const aliveRegular=state.enemies.reduce((n,e)=>n+(!e.dead&&!e.boss?1:0),0);
  state.noEnemyTime=aliveRegular===0?state.noEnemyTime+dt:0;
  if(state.noEnemyTime>2.5){for(let q=0;q<3;q++)spawnEnemy();state.noEnemyTime=0;state.spawnTimer=Math.min(state.spawnTimer,.12);}

  state.healSpawnTimer -= dt;
  if(state.healSpawnTimer <= 0){ spawnHealingTomato(); state.healSpawnTimer = rand(6, 12); }
  // Inga levande monster kapas bort. Spawn-taken sköter belastningen utan falska 'kills'.

  for(const e of state.enemies){
    if(e.dead)continue; e.hit=Math.max(0,e.hit-dt);e.wobble+=dt*3;
    let dx=p.x-e.x,dy=p.y-e.y,d=Math.hypot(dx,dy)||1;
    if(e.shooter){const desired=245,dir=d>desired?1:(d<185?-.65:0);e.x+=dx/d*e.speed*dt*dir;e.y+=dy/d*e.speed*dt*dir;e.shootTimer-=dt;if(e.shootTimer<=0&&d<560){e.shootTimer+=e.shootCooldown;const a=Math.atan2(dy,dx);state.enemyBullets.push({x:e.x,y:e.y,vx:Math.cos(a)*145,vy:Math.sin(a)*145,radius:6,damage:e.damage*.62,life:4,color:'#8f79d8'});}} else {e.x+=dx/d*e.speed*dt;e.y+=dy/d*e.speed*dt;}
    if(d<e.radius+p.radius&&p.invuln<=0&&state.dashTime<=0){const damage=Math.max(1,e.damage*(1-p.armor));p.hp-=damage;p.invuln=.64;state.shake=7;popup(p.x,p.y-30,`-${Math.ceil(damage)} ork`,'#765a86');spinachBurst(p.x,p.y,6,.45);sfx('damage');if(p.hp<=0){p.hp=0;gameOver();return;}}
  }
  separateEnemies();
  state.enemies=state.enemies.filter(e=>!e.dead);
  for(const b of state.enemyBullets){b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;const d=Math.hypot(b.x-p.x,b.y-p.y);if(b.life>0&&d<p.radius+b.radius&&p.invuln<=0){const damage=Math.max(1,b.damage*(1-p.armor));p.hp-=damage;p.invuln=.50;b.life=0;state.shake=4;popup(p.x,p.y-28,`-${Math.ceil(damage)} ork`,'#765a86');if(p.hp<=0){p.hp=0;gameOver();return;}}}state.enemyBullets=state.enemyBullets.filter(b=>b.life>0);

  for(const pr of state.projectiles){
    pr.x+=pr.vx*dt;pr.y+=pr.vy*dt;pr.life-=dt;if(pr.life<=0)continue;
    for(const e of state.enemies){
      if(e.dead || pr.hitIds?.has(e.id))continue;
      const rr=pr.radius+e.radius;
      if((pr.x-e.x)**2+(pr.y-e.y)**2<rr*rr){
        e.hp-=pr.damage;e.hit=.10;pr.hitIds?.add(e.id);spinachBurst(pr.x,pr.y,pr.crit?8:4,pr.crit?.55:.35);sfx(pr.crit?'crit':'hit');
        if(pr.crit) popup(pr.x,pr.y-12,'KRITISK!','#a87900');
        if(e.hp<=0)killEnemy(e);
        if((pr.pierce||0)>0){pr.pierce-=1;}else{pr.life=0;break;}
      }
    }
  }
  state.projectiles=state.projectiles.filter(p=>p.life>0);

  for(const o of state.orbs){o.pulse=(o.pulse||0)+dt*6;o.x+=o.vx*dt;o.y+=o.vy*dt;o.vx*=Math.pow(.12,dt);o.vy*=Math.pow(.12,dt);const dx=p.x-o.x,dy=p.y-o.y,d=Math.hypot(dx,dy);if(d<95){const f=(1-d/95)*520;o.x+=dx/(d||1)*f*dt;o.y+=dy/(d||1)*f*dt;}if(d<p.radius+o.radius+5){o.dead=true;gainXp(o.value);sfx('xp');}}
  state.orbs=state.orbs.filter(o=>!o.dead);

  for(const h of state.heals){
    h.pulse += dt*4; h.rot += dt*.8;
    const dx=p.x-h.x,dy=p.y-h.y,d=Math.hypot(dx,dy);
    if(d < p.radius+h.radius+8) collectHealingTomato(h);
  }
  state.heals=state.heals.filter(h=>!h.dead);

  for(const q of state.particles){q.x+=q.vx*dt;q.y+=q.vy*dt;q.vx*=Math.pow(.08,dt);q.vy*=Math.pow(.08,dt);q.vy+=65*dt;q.life-=dt;q.rot+=dt*2;}
  state.particles=state.particles.filter(q=>q.life>0);
  for(const r of state.rings)r.life-=dt;state.rings=state.rings.filter(r=>r.life>0);
  state.popups.length=0;

  state.camera.x += (p.x-state.camera.x)*Math.min(1,dt*7);state.camera.y += (p.y-state.camera.y)*Math.min(1,dt*7);
  updateHud();heartbeat();
}

function heartbeat() {}
function updateHud(){
  const p=state.player;
  const hpPct=clamp(p.hp/p.maxHp,0,1);
  const xpPct=clamp(p.xp/p.xpNeed,0,1);
  ui.hpBar.style.width=`${hpPct*100}%`;
  ui.hpText.textContent=`${Math.ceil(p.hp)}/${p.maxHp}`;
  ui.levelText.textContent=p.level;
  ui.timeText.textContent=formatTime(state.elapsedMs);
  ui.killText.textContent=state.kills;
  ui.xpBar.style.width=`${xpPct*100}%`;
  ui.xpText.textContent=`${p.xp} / ${p.xpNeed} erfarenhet`;
  if(ui.xpOrbFill) ui.xpOrbFill.style.height=`${xpPct*100}%`;
  if(ui.xpOrbText) ui.xpOrbText.textContent=`${Math.round(xpPct*100)}%`;
  if(ui.desktopHpFill)ui.desktopHpFill.style.height=`${hpPct*100}%`;if(ui.desktopHpText)ui.desktopHpText.textContent=`${Math.ceil(p.hp)}/${p.maxHp}`;if(ui.desktopXpFill)ui.desktopXpFill.style.height=`${xpPct*100}%`;if(ui.desktopXpText)ui.desktopXpText.textContent=`${Math.round(xpPct*100)}%`;
  const pct=clamp(1-state.jimmy.barkTimer/state.jimmy.barkCooldown,0,1);
  ui.jimmyBar.style.width=`${pct*100}%`;
  ui.jimmyText.textContent=state.jimmy.barkTimer<=.05?'Skall redo!':`Skall om ${Math.max(0,state.jimmy.barkTimer).toFixed(1)} s`;
  updateDashUI();
}

function worldToScreen(x,y){return{x:x-state.camera.x+width/2,y:y-state.camera.y+height/2};}
function drawBackground(){
 ctx.fillStyle='#315f24';ctx.fillRect(0,0,width,height);if(!grassTile.complete||!grassTile.naturalWidth)return;
 const z=512,ox=(((-state.camera.x+width/2)%z)+z)%z-z,oy=(((-state.camera.y+height/2)%z)+z)%z-z;
 for(let x=ox;x<width+z;x+=z)for(let y=oy;y<height+z;y+=z)ctx.drawImage(grassTile,x,y,z,z);
 ctx.fillStyle='rgba(235,245,228,.04)';ctx.fillRect(0,0,width,height);
}
function drawDavina(){const s=worldToScreen(state.player.x,state.player.y),p=state.player;ctx.save();ctx.translate(s.x,s.y);if(p.invuln>0&&Math.floor(p.invuln*16)%2===0)ctx.globalAlpha=.45;ctx.fillStyle='#5e4b78';ctx.beginPath();ctx.arc(0,-4,15,0,6.28);ctx.fill();ctx.fillStyle='#f2c8aa';ctx.beginPath();ctx.arc(0,-8,10,0,6.28);ctx.fill();ctx.fillStyle='#6e4f3c';ctx.beginPath();ctx.arc(-4,-14,7,2.8,6.3);ctx.arc(5,-14,7,2.9,6.2);ctx.fill();ctx.fillStyle='#ffcf9f';ctx.fillRect(-10,3,20,18);ctx.fillStyle='#87bfa2';ctx.fillRect(-12,9,24,16);ctx.fillStyle='#b9a7e8';ctx.beginPath();ctx.arc(-7,31,6,0,6.28);ctx.arc(7,31,6,0,6.28);ctx.fill();ctx.restore();}
function drawJimmy(){
  const s=worldToScreen(state.jimmy.x,state.jimmy.y);
  const t=performance.now()/1000;
  ctx.save();ctx.translate(s.x,s.y);
  const bob=Math.sin(t*7)*1.2;ctx.translate(0,bob);
  // Svans
  ctx.strokeStyle='#16181b';ctx.lineWidth=6;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(-14,5);ctx.quadraticCurveTo(-27,-2,-24,-14);ctx.stroke();
  // Kropp: svart rygg, varmbruna ben och bröst som Jimmy på fotot.
  ctx.fillStyle='#17191c';ctx.beginPath();ctx.ellipse(-1,5,17,12,-.08,0,6.28);ctx.fill();
  ctx.fillStyle='#bd7b3e';ctx.beginPath();ctx.ellipse(-8,12,5,11,.12,0,6.28);ctx.ellipse(8,12,5,11,-.12,0,6.28);ctx.fill();
  ctx.fillStyle='#f1d5b7';ctx.beginPath();ctx.ellipse(3,6,7,8,0,0,6.28);ctx.fill();
  // Huvud
  ctx.fillStyle='#17191c';ctx.beginPath();ctx.arc(13,-7,11,0,6.28);ctx.fill();
  // Stora halvhängande öron
  ctx.beginPath();ctx.ellipse(3,-11,6,10,-.55,0,6.28);ctx.ellipse(22,-11,6,10,.55,0,6.28);ctx.fill();
  // Tan-teckning över ögon, kinder och nosparti
  ctx.fillStyle='#c88849';ctx.beginPath();ctx.ellipse(9,-10,4.5,3.2,-.2,0,6.28);ctx.ellipse(17,-10,4.5,3.2,.2,0,6.28);ctx.ellipse(13,-3,8,6,0,0,6.28);ctx.fill();
  ctx.fillStyle='#eee5dd';ctx.beginPath();ctx.ellipse(13,0,5.4,3.2,0,0,6.28);ctx.fill();
  // Ögon och nos
  ctx.fillStyle='#33271f';ctx.beginPath();ctx.arc(9,-9,1.7,0,6.28);ctx.arc(17,-9,1.7,0,6.28);ctx.fill();
  ctx.fillStyle='#090a0b';ctx.beginPath();ctx.ellipse(13,-2,3.2,2.5,0,0,6.28);ctx.fill();
  // Vitt bröst och tassar
  ctx.fillStyle='#f3eee7';ctx.beginPath();ctx.moveTo(0,3);ctx.lineTo(4,15);ctx.lineTo(8,4);ctx.closePath();ctx.fill();
  ctx.beginPath();ctx.ellipse(-8,20,4.5,3,0,0,6.28);ctx.ellipse(8,20,4.5,3,0,0,6.28);ctx.fill();
  // Turkost halsband
  ctx.strokeStyle='#48b6aa';ctx.lineWidth=3;ctx.beginPath();ctx.arc(13,-3,8,.15,2.95);ctx.stroke();
  ctx.restore();
}
function drawEnemy(e){
  const s=worldToScreen(e.x,e.y);
  ctx.save();ctx.translate(s.x,s.y);
  if(e.appz){
    const r=e.radius;ctx.fillStyle='rgba(72,55,84,.16)';ctx.beginPath();ctx.arc(0,0,r+15,0,6.28);ctx.fill();
    ctx.fillStyle=e.hit>0?'#a8dfbd':'#49404f';ctx.beginPath();ctx.ellipse(0,8,r*.72,r*.65,0,0,6.28);ctx.fill();ctx.beginPath();ctx.arc(0,-r*.45,r*.42,0,6.28);ctx.fill();
    ctx.fillStyle='#c9aa91';ctx.beginPath();ctx.ellipse(0,-r*.37,r*.23,r*.17,0,0,6.28);ctx.fill();
    ctx.strokeStyle='#6b4c36';ctx.lineWidth=9;ctx.beginPath();ctx.moveTo(r*.60,-r*.05);ctx.lineTo(r*.72,r*.72);ctx.stroke();
    ctx.fillStyle='#151419';ctx.beginPath();ctx.arc(-r*.13,-r*.48,4,0,6.28);ctx.arc(r*.13,-r*.48,4,0,6.28);ctx.fill();ctx.restore();
    const w=Math.min(300,width*.36),bx=s.x-w/2,by=s.y-r-36;ctx.fillStyle='#eee';ctx.fillRect(bx-3,by-3,w+6,14);ctx.fillStyle='#6d5878';ctx.fillRect(bx,by,w*clamp(e.hp/e.maxHp,0,1),8);ctx.font='900 15px Trebuchet MS';ctx.textAlign='center';const label='APPZ THE MIGHTY';const tw=ctx.measureText(label).width+20;ctx.fillStyle='rgba(20,18,25,.84)';ctx.fillRect(s.x-tw/2,by-29,tw,20);ctx.lineWidth=4;ctx.strokeStyle='#17151b';ctx.strokeText(label,s.x,by-14);ctx.fillStyle='#fff4dc';ctx.fillText(label,s.x,by-14);return;
  }
  if(e.boss&&!e.appz){
    const r=e.radius;ctx.fillStyle='rgba(126,88,190,.13)';ctx.beginPath();ctx.arc(0,0,r+12,0,6.28);ctx.fill();
    ctx.fillStyle=e.hit>0?'#a8dfbd':'#7968a7';ctx.beginPath();ctx.ellipse(0,5,r*.43,r*.58,0,0,6.28);ctx.fill();
    ctx.fillStyle='#e7c5a6';ctx.beginPath();ctx.arc(0,-r*.48,r*.30,0,6.28);ctx.fill();
    ctx.fillStyle='#d9d4cf';ctx.beginPath();ctx.arc(0,-r*.62,r*.31,3.2,6.15);ctx.fill();
    ctx.strokeStyle='#77777c';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(-r*.58,r*.05);ctx.lineTo(-r*.58,r*.72);ctx.lineTo(r*.58,r*.72);ctx.lineTo(r*.58,r*.05);ctx.moveTo(-r*.58,r*.32);ctx.lineTo(r*.58,r*.32);ctx.stroke();
    ctx.strokeStyle='#6c4b35';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(r*.22,-r*.39);ctx.lineTo(r*.55,-r*.27);ctx.stroke();
    ctx.fillStyle='#f0b8a0';ctx.beginPath();ctx.arc(r*.57,-r*.26,3,0,6.28);ctx.fill();ctx.restore();
    const w=Math.min(250,width*.32),bx=s.x-w/2,by=s.y-r-32;ctx.fillStyle='#eee';ctx.fillRect(bx-3,by-3,w+6,13);ctx.fillStyle='#7453aa';ctx.fillRect(bx,by,w*clamp(e.hp/e.maxHp,0,1),7);ctx.font='900 14px Trebuchet MS';ctx.textAlign='center';const label='DEN FARLIGA KAYVAN';const tw=ctx.measureText(label).width+18;ctx.fillStyle='rgba(20,18,25,.82)';ctx.fillRect(s.x-tw/2,by-27,tw,19);ctx.lineWidth=4;ctx.strokeStyle='#17151b';ctx.strokeText(label,s.x,by-13);ctx.fillStyle='#fff4dc';ctx.fillText(label,s.x,by-13);return;
  }
  const tier=e.minuteTier||0,r=e.radius;ctx.lineJoin='round';ctx.lineCap='round';ctx.strokeStyle='rgba(22,24,30,.9)';ctx.lineWidth=Math.max(3,r*.15);ctx.fillStyle=e.hit>0?'#c6f0d1':e.color;
  switch(tier%8){
   case 0:ctx.beginPath();for(let i=0;i<20;i++){let a=i/20*6.283,rr=i%2?r*.8:r*1.18;(i?ctx.lineTo(Math.cos(a)*rr,Math.sin(a)*rr):ctx.moveTo(Math.cos(a)*rr,Math.sin(a)*rr));}ctx.closePath();ctx.fill();ctx.stroke();break;
   case 1:ctx.beginPath();for(let i=0;i<7;i++)ctx.arc(Math.cos(i*.9)*r*.45,Math.sin(i*.9)*r*.32,r*.45,0,6.283);ctx.fill();ctx.stroke();break;
   case 2:ctx.beginPath();ctx.arc(0,-r*.2,r*.72,0,6.283);ctx.fill();ctx.stroke();for(let i=-2;i<=2;i++){ctx.beginPath();ctx.moveTo(i*r*.25,r*.3);ctx.quadraticCurveTo(i*r*.4+Math.sin(e.wobble+i)*r*.25,r*.85,i*r*.3,r*1.12);ctx.stroke();}break;
   case 3:ctx.beginPath();ctx.roundRect(-r*.42,-r*.85,r*.84,r*1.7,r*.35);ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(-r*.35,-r*.1);ctx.lineTo(-r*.82,-r*.35);ctx.lineTo(-r*.82,-r*.65);ctx.moveTo(r*.35,r*.1);ctx.lineTo(r*.82,-r*.1);ctx.stroke();break;
   case 4:ctx.fillStyle='#ead8c6';ctx.beginPath();ctx.roundRect(-r*.32,-r*.05,r*.64,r*.92,r*.22);ctx.fill();ctx.stroke();ctx.fillStyle=e.color;ctx.beginPath();ctx.arc(0,-r*.1,r*.92,3.14,6.283);ctx.closePath();ctx.fill();ctx.stroke();break;
   case 5:ctx.beginPath();ctx.moveTo(-r*.25,0);ctx.quadraticCurveTo(-r*1.25,-r*.9,-r*1.1,r*.25);ctx.moveTo(r*.25,0);ctx.quadraticCurveTo(r*1.25,-r*.9,r*1.1,r*.25);ctx.stroke();ctx.fillStyle='#eeeaf3';ctx.beginPath();ctx.arc(0,0,r*.65,0,6.283);ctx.fill();ctx.stroke();ctx.fillStyle=e.color;ctx.beginPath();ctx.arc(0,0,r*.28,0,6.283);ctx.fill();break;
   case 6:ctx.beginPath();ctx.roundRect(-r*.7,-r*.65,r*1.4,r*1.3,r*.18);ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(0,-r*.65);ctx.lineTo(0,-r*1.02);ctx.moveTo(-r*.7,-r*.1);ctx.lineTo(-r*1.02,r*.35);ctx.moveTo(r*.7,-r*.1);ctx.lineTo(r*1.02,r*.35);ctx.stroke();break;
   default:ctx.beginPath();for(let i=0;i<18;i++){let a=i/18*6.283,rr=r*(.8+(i%3===0?.28:.06));(i?ctx.lineTo(Math.cos(a)*rr,Math.sin(a)*rr):ctx.moveTo(Math.cos(a)*rr,Math.sin(a)*rr));}ctx.closePath();ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(-r*.3,r*.6);ctx.lineTo(-r*.48,r*1.05);ctx.moveTo(r*.3,r*.6);ctx.lineTo(r*.48,r*1.05);ctx.stroke();
  }
  ctx.fillStyle='#22242c';ctx.beginPath();ctx.arc(-r*.23,-r*.12,Math.max(2,r*.1),0,6.283);ctx.arc(r*.23,-r*.12,Math.max(2,r*.1),0,6.283);ctx.fill();
  if(e.shooter){ctx.strokeStyle='#a999ef';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(r*.55,r*.1);ctx.lineTo(r*1.08,r*.1);ctx.stroke();}
  if(e.elite){ctx.strokeStyle='#d9ccff';ctx.lineWidth=4;ctx.beginPath();ctx.arc(0,0,r+7,0,6.283);ctx.stroke();}ctx.restore();
}
function draw(){
  if(!state){ctx.fillStyle='#315f24';ctx.fillRect(0,0,width,height);return;}
  ctx.save();if(state.shake>0)ctx.translate(rand(-state.shake,state.shake),rand(-state.shake,state.shake));drawBackground();ctx.translate(width/2,height/2);ctx.scale(cameraZoom,cameraZoom);ctx.translate(-width/2,-height/2);
  for(const o of state.orbs){const s=worldToScreen(o.x,o.y),pulse=1+Math.sin(o.pulse||0)*.12,r=o.radius*pulse;ctx.save();ctx.shadowColor='#ffd83d';ctx.shadowBlur=18;ctx.fillStyle='#ffd83d';ctx.beginPath();ctx.arc(s.x,s.y,r+3,0,6.28);ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle='#fff7b0';ctx.lineWidth=3;ctx.beginPath();ctx.arc(s.x,s.y,r+1,0,6.28);ctx.stroke();ctx.fillStyle='#fffbe8';ctx.beginPath();ctx.arc(s.x-3,s.y-3,Math.max(3,r*.32),0,6.28);ctx.fill();ctx.restore();}
  for(const h of state.heals){const s=worldToScreen(h.x,h.y),pulse=1+Math.sin(h.pulse)*.10;ctx.save();ctx.translate(s.x,s.y);ctx.scale(pulse,pulse);ctx.shadowColor='#fff4e8';ctx.shadowBlur=18;ctx.fillStyle='#e83f3f';ctx.strokeStyle='#fff4e8';ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,2,11,0,6.283);ctx.fill();ctx.stroke();ctx.shadowBlur=0;ctx.fillStyle='#70b85a';ctx.beginPath();for(let q=0;q<5;q++){const a=q/5*6.283-1.57;ctx.lineTo(Math.cos(a)*7,Math.sin(a)*5-7);}ctx.closePath();ctx.fill();ctx.fillStyle='#fff';ctx.globalAlpha=.72;ctx.beginPath();ctx.arc(-4,-2,2.4,0,6.283);ctx.fill();ctx.restore();}
  for(const f of state.lightningFx){const a=worldToScreen(f.x1,f.y1),b=worldToScreen(f.x2,f.y2);ctx.save();ctx.globalAlpha=Math.max(0,f.life/f.total);ctx.strokeStyle='#d8c7ff';ctx.shadowColor='#8e72ff';ctx.shadowBlur=14;ctx.lineWidth=6;ctx.beginPath();ctx.moveTo(a.x,a.y);const n=7;for(let i=1;i<n;i++){let t=i/n;ctx.lineTo(a.x+(b.x-a.x)*t+rand(-9,9),a.y+(b.y-a.y)*t+rand(-9,9));}ctx.lineTo(b.x,b.y);ctx.stroke();ctx.strokeStyle='#ffffff';ctx.shadowBlur=0;ctx.lineWidth=2;ctx.stroke();ctx.restore();}
  for(const r of state.rings){const s=worldToScreen(r.x,r.y),t=1-r.life/r.total;ctx.strokeStyle=r.boss?`rgba(126,88,190,${1-t})`:(r.shock?`rgba(220,190,255,${1-t})`:(r.boom?`rgba(255,170,210,${1-t})`:(r.storm?`rgba(170,255,205,${1-t})`:`rgba(220,200,255,${1-t})`)));ctx.lineWidth=5*(1-t)+1;ctx.beginPath();ctx.arc(s.x,s.y,r.r+(r.max-r.r)*t,0,6.28);ctx.stroke();}
  for(const b of state.enemyBullets){const s=worldToScreen(b.x,b.y);ctx.save();ctx.shadowColor=b.color;ctx.shadowBlur=9;ctx.fillStyle=b.color;ctx.beginPath();ctx.arc(s.x,s.y,b.radius,0,6.28);ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();ctx.restore();}
  for(const pr of state.projectiles){const s=worldToScreen(pr.x,pr.y);ctx.save();if(pr.crit){ctx.shadowColor='#ffe35b';ctx.shadowBlur=12;}ctx.fillStyle=pr.crit?'#d8fff0':'#b9f1d2';ctx.beginPath();ctx.arc(s.x,s.y,pr.radius,0,6.28);ctx.fill();ctx.strokeStyle=pr.crit?'#2f8d67':'#5aa980';ctx.lineWidth=pr.crit?2.5:1;ctx.stroke();ctx.restore();}
  for(const m of state.mines){const s=worldToScreen(m.x,m.y);ctx.fillStyle='#6d4a36';ctx.beginPath();ctx.ellipse(s.x,s.y,11,7,0,0,6.28);ctx.fill();}
 for(const c of state.chickens){const s=worldToScreen(c.x,c.y);ctx.fillStyle='#f5f0df';ctx.beginPath();ctx.ellipse(s.x,s.y,13,10,0,0,6.28);ctx.fill();ctx.fillStyle='#d85f72';ctx.beginPath();ctx.arc(s.x+7,s.y-8,4,0,6.28);ctx.fill();}
 for(const pr of state.skillProjectiles){const s=worldToScreen(pr.x,pr.y);ctx.save();ctx.translate(s.x,s.y);ctx.rotate(Math.atan2(pr.vy,pr.vx));ctx.fillStyle='#f3eee0';ctx.fillRect(-8,-3,16,6);ctx.beginPath();ctx.arc(-8,0,4,0,6.28);ctx.arc(8,0,4,0,6.28);ctx.fill();ctx.restore();}
 for(const e of state.enemies)drawEnemy(e);drawJimmy();drawDavina();
  for(const q of state.particles){const s=worldToScreen(q.x,q.y);ctx.save();ctx.globalAlpha=clamp(q.life/.6,0,1);ctx.translate(s.x,s.y);ctx.rotate(q.rot);ctx.fillStyle=q.color;if(q.leaf){ctx.beginPath();ctx.ellipse(0,0,q.size,q.size*.45,0,0,6.28);ctx.fill();}else{ctx.beginPath();ctx.arc(0,0,q.size*.6,0,6.28);ctx.fill();}ctx.restore();}
  for(const p of state.popups){const s=worldToScreen(p.x,p.y);ctx.globalAlpha=clamp(p.life,0,1);ctx.fillStyle=p.color;ctx.font='800 14px Trebuchet MS';ctx.textAlign='center';ctx.fillText(p.text,s.x,s.y);ctx.globalAlpha=1;}
  ctx.restore();
}

function frame(now){const dt=Math.min(.033,(now-lastFrame)/1000);lastFrame=now;if(state?.running&&!state.paused&&!state.choosing&&!state.over)update(dt);draw();requestAnimationFrame(frame);}requestAnimationFrame(frame);

async function gameOver(){
  if(!state||state.over)return;
  state.over=true;state.running=false;
  ui.pause.classList.remove('show');ui.upgrade.classList.remove('show');ui.hud.classList.add('hidden');ui.joystick.classList.add('hidden');ui.zoomControls.classList.add('zoom-hidden');ui.dashBtn.classList.add('hidden');
  sfx('gameover');
  ui.resultTime.textContent=formatTime(state.elapsedMs);ui.resultLevel.textContent=state.player.level;ui.resultKills.textContent=state.kills;ui.resultSkills.innerHTML='';
  if(state.skills.size===0)ui.resultSkills.innerHTML='<span class="skill-chip">Inga förbättringar hann väljas</span>';
  for(const [id,rank] of state.skills){const sk=SKILLS[id];const chip=document.createElement('span');chip.className='skill-chip';chip.textContent=`${sk.emoji} ${sk.name} ×${rank}`;ui.resultSkills.appendChild(chip);}
  ui.result.classList.add('show');ui.rankStatus.textContent='';

  const skills=[...state.skills].map(([id,rank])=>({id,rank,name:SKILLS[id]?.name||id}));
  const score={
    id:`${Date.now()}-${Math.random().toString(36).slice(2,9)}`,
    name:confirmedName,
    durationMs:Math.floor(state.elapsedMs),
    level:state.player.level,
    kills:state.kills,
    skills,
    createdAt:new Date().toISOString()
  };

  // Behåll lokal lagring som reserv om nätet/Turso skulle ligga nere.
  try { saveLocalScore(score); } catch {}

  ui.saveStatus.textContent='🌍 Sparar resultat till världstopplistan…';
  ui.saveStatus.classList.remove('bad');
  ui.rankStatus.textContent='';

  try{
    const rowId = await saveOnlineScore(score);
    const position = await getOnlinePosition(rowId);
    ui.saveStatus.textContent='✓ Resultatet är sparat på världstopplistan!';
    ui.saveStatus.classList.remove('bad');
    ui.rankStatus.textContent = position
      ? (position <= 10 ? `🏆 Världsplacering ${position}!` : `Din världsplacering: ${position}.`)
      : 'Resultatet är sparat online.';
    await loadLeaderboard(ui.resultLeaderboard, confirmedName);
  }catch(e){
    console.error('Turso save failed:', e);
    ui.saveStatus.textContent='⚠ Kunde inte nå världstopplistan. Resultatet är sparat lokalt som reserv.';
    ui.saveStatus.classList.add('bad');
    ui.rankStatus.textContent='Försök igen när anslutningen fungerar.';
    loadLocalLeaderboard(ui.resultLeaderboard, confirmedName);
  }
}
ui.againBtn.addEventListener('click',async()=>{
  state=null;
  await applySavedPlayerName();
  ui.result.classList.remove('show');
  ui.start.classList.add('show');
  loadLeaderboard(ui.startLeaderboard,confirmedName);
});

function loadLocalLeaderboard(target, highlight=''){
  const scores=getLocalScores().slice(0,10).map((s,i)=>({...s,position:i+1}));
  renderLeaderboard(target,scores,highlight);
}

async function loadLeaderboard(target, highlight=''){
  if(target) target.innerHTML='<p style="padding:10px">🌍 Hämtar världstopplistan…</p>';
  try{
    const scores=await getOnlineScores(10);
    renderLeaderboard(target,scores,highlight);
    ui.startServerInfo.textContent='🌍 En jävla lista över fan alla som är typ bra i världen.';
    ui.startServerInfo.classList.remove('bad');
    if(ui.serverBadge){
      ui.serverBadge.textContent='🌍 Världstopplista';
      ui.serverBadge.classList.remove('offline');
    }
  }catch(e){
    console.error('Turso leaderboard failed:',e);
    loadLocalLeaderboard(target,highlight);
    ui.startServerInfo.textContent='⚠ Världstopplistan kunde inte nås. Visar lokal reservlista.';
    ui.startServerInfo.classList.add('bad');
    if(ui.serverBadge){
      ui.serverBadge.textContent='⚠ Offline – lokal reserv';
      ui.serverBadge.classList.add('offline');
    }
  }
}
function renderLeaderboard(target,scores,highlight=''){
  if(!scores.length){target.innerHTML='<p style="padding:10px">Inga sparade resultat ännu. Någon måste ju vara först. 🌿</p>';return;}
  target.innerHTML='<div class="leader-row leader-head"><span>#</span><span>Namn</span><span>Tid</span><span>Nivå</span><span>Monsterjävlar</span></div>';
  for(const s of scores){const row=document.createElement('div');row.className='leader-row'+(highlight&&s.name===highlight?' me':'');row.innerHTML=`<span class="pos">${s.position}</span><span class="name"></span><b>${formatTime(s.durationMs)}</b><span>${s.level}</span><span>${s.kills}</span>`;row.querySelector('.name').textContent=s.name;row.title=s.skills?.length?s.skills.map(x=>`${x.name} ×${x.rank}`).join(', '):'Inga förbättringar';target.appendChild(row);}
}
loadSettings();
(async()=>{
  await applySavedPlayerName();
  loadLeaderboard(ui.startLeaderboard, confirmedName);
})();

