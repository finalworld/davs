const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d');
const $ = (sel) => document.querySelector(sel);
const LOCAL_SCORE_KEY = 'davina-jimmy-spenatstorm-scores-v1';

const ui = {
  hud: $('#hud'), start: $('#startScreen'), upgrade: $('#upgradeScreen'), pause: $('#pauseScreen'), result: $('#resultScreen'),
  nameInput: $('#nameInput'), confirmName: $('#confirmNameBtn'), nameStatus: $('#nameStatus'), startBtn: $('#startBtn'),
  startServerInfo: $('#startServerInfo'), startLeaderboard: $('#startLeaderboard'), resultLeaderboard: $('#resultLeaderboard'),
  hpBar: $('#hpBar'), hpText: $('#hpText'), levelText: $('#levelText'), timeText: $('#timeText'), killText: $('#killText'),
  xpBar: $('#xpBar'), xpText: $('#xpText'), xpOrbFill: $('#xpOrbFill'), xpOrbText: $('#xpOrbText'), jimmyText: $('#jimmyText'), jimmyBar: $('#jimmyBar'), serverBadge: $('#serverBadge'),
  pauseBtn: $('#pauseBtn'), soundBtn: $('#soundBtn'), fullscreenBtn: $('#fullscreenBtn'), resumeBtn: $('#resumeBtn'), quitBtn: $('#quitBtn'),
  upgradeLevel: $('#upgradeLevel'), upgradeChoices: $('#upgradeChoices'), resultTime: $('#resultTime'), resultLevel: $('#resultLevel'),
  resultKills: $('#resultKills'), resultSkills: $('#resultSkills'), saveStatus: $('#saveStatus'), rankStatus: $('#rankStatus'),
  againBtn: $('#againBtn'), joystick: $('#joystick'), joyKnob: $('#joyKnob'), toast: $('#toast')
};

const SKILLS = {
  kasta: { name: 'Turboarm', emoji: '⚡', desc: 'Davina anfaller 18 % oftare.', apply: s => s.player.attackCooldown = Math.max(.16, s.player.attackCooldown * 0.82) },
  fler: { name: 'Projektilfest', emoji: '✨', desc: 'Två extra projektiler per attack.', apply: s => s.player.projectileCount += 2 },
  kraft: { name: 'Riktigt kraftiga kast', emoji: '💫', desc: '40 % mer skada från Davinas projektiler.', apply: s => s.player.damage *= 1.40 },
  rackvidd: { name: 'Långkastare', emoji: '🎯', desc: '25 % längre räckvidd och 15 % snabbare projektiler.', apply: s => { s.player.range *= 1.25; s.player.projectileSpeed *= 1.15; } },
  storlek: { name: 'Jätteprojektiler', emoji: '🫧', desc: '30 % större träffyta och 18 % mer skada.', apply: s => { s.player.projectileSize *= 1.30; s.player.damage *= 1.18; } },
  genomslag: { name: 'Rakt igenom!', emoji: '🧵', desc: 'Projektilerna kan träffa en extra fiende innan de försvinner.', apply: s => s.player.projectilePierce += 1 },
  kritisk: { name: 'Turträffar', emoji: '🍀', desc: '+12 % chans att göra dubbel skada.', apply: s => s.player.critChance = Math.min(.60, s.player.critChance + .12) },
  dubbelstorm: { name: 'Spenatorkan', emoji: '🥬', desc: 'Spenatstormen blir större, starkare och kommer oftare.', apply: s => { s.player.stormRank += 2; s.player.stormPower *= 1.25; } },
  fart: { name: 'Riktigt lätta skor', emoji: '👟', desc: 'Davina rör sig 15 % snabbare.', apply: s => s.player.speed *= 1.15 },
  skydd: { name: 'Rejält mjukt skydd', emoji: '🧣', desc: 'Minskar skada med 10 procentenheter.', apply: s => s.player.armor = Math.min(0.65, s.player.armor + 0.10) },
  maxhalsa: { name: 'Extra mycket ork', emoji: '💜', desc: 'Ökar maxhälsan med 30 och läker 35.', apply: s => { s.player.maxHp += 30; s.player.hp = Math.min(s.player.maxHp, s.player.hp + 35); } },
  spenatstorm: { name: 'Spenatstorm', emoji: '🌿', desc: 'En stor grön områdespuff slår till regelbundet.', apply: s => { s.player.stormRank += 1; s.player.stormPower *= 1.12; } },
  jimmySkall: { name: 'Jimmys superskall', emoji: '📣', desc: 'Jimmy skäller 22 % oftare och når längre.', apply: s => { s.jimmy.barkCooldown = Math.max(1.5, s.jimmy.barkCooldown * 0.78); s.jimmy.barkRadius *= 1.12; } },
  jimmyNos: { name: 'Jimmys supernos', emoji: '👃', desc: 'Jimmy drar in erfarenhet från 35 % längre håll.', apply: s => s.jimmy.magnetRadius *= 1.35 },
  jimmyKraft: { name: 'Jimmys vrål', emoji: '🐾', desc: 'Jimmys skall gör 55 % mer skada.', apply: s => s.jimmy.barkDamage *= 1.55 }
};

let dpr = 1, width = 0, height = 0;
let state = null;
let confirmedName = '';
let audioOn = true;
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
function beep(freq = 440, dur = .08, type = 'sine', gain = .03, slide = 0) {
  const a = ensureAudio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, a.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), a.currentTime + dur);
  g.gain.setValueAtTime(gain, a.currentTime); g.gain.exponentialRampToValueAtTime(.0001, a.currentTime + dur);
  o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + dur);
}

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
  localStorage.setItem('spenatstorm_display_name', result.name);
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
    running: true, paused: false, choosing: false, over: false, quit: false,
    elapsedMs: 0,
    player: { x: 0, y: 0, radius: 17, hp: 110, maxHp: 110, speed: 225, armor: 0, level: 1, xp: 0, xpNeed: 6, damage: 28, attackCooldown: .60, attackTimer: .2, projectileCount: 2, projectileSpeed: 500, projectileSize: 7, projectilePierce: 0, critChance: .05, range: 660, invuln: 0, stormRank: 0, stormPower: 1, stormTimer: 4.2 },
    jimmy: { x: -44, y: 28, radius: 13, barkCooldown: 6, barkTimer: 2.2, barkRadius: 110, barkDamage: 25, magnetRadius: 135 },
    enemies: [], projectiles: [], enemyBullets: [], orbs: [], heals: [], particles: [], rings: [], popups: [], skills: new Map(), kills: 0,
    spawnTimer: .55, healSpawnTimer: rand(6, 11), enemyId: 0, nextBossAt: 50, bossCount: 0, minuteTier: 0, camera: { x: 0, y: 0 }, shake: 0
  };
}

function startGame() {
  if (confirmedName) localStorage.setItem('spenatstorm_display_name', confirmedName);
  const result = validateNameClient(confirmedName);
  if (!result.ok) return;
  ensureAudio();
  ui.startBtn.disabled = true;
  ui.startBtn.textContent = 'Startar…';
  state = newState();
  ui.serverBadge.textContent = '💾 Lokal topplista';
  ui.serverBadge.classList.remove('offline');
  ui.start.classList.remove('show');
  ui.result.classList.remove('show');
  ui.hud.classList.remove('hidden');
  if (matchMedia('(pointer: coarse)').matches) ui.joystick.classList.remove('hidden');
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
  return { x, y };
}
window.addEventListener('keydown', e => {
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
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

function togglePause() {
  if (!state || state.over || state.choosing) return;
  state.paused = !state.paused;
  ui.pause.classList.toggle('show', state.paused);
  if (state.paused) beep(260,.08,'triangle',.02,-40); else { lastFrame = performance.now(); beep(420,.06,'triangle',.02,80); }
}
ui.pauseBtn.addEventListener('click', togglePause); ui.resumeBtn.addEventListener('click', togglePause);
ui.quitBtn.addEventListener('click', () => { if (!state) return; state.quit = true; state.paused = false; ui.pause.classList.remove('show'); gameOver(); });
ui.soundBtn.addEventListener('click', () => { audioOn = !audioOn; ui.soundBtn.textContent = audioOn ? '🔊' : '🔇'; if (audioOn) beep(520,.08,'sine',.025,120); });
ui.fullscreenBtn.addEventListener('click', async () => { try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); else await document.exitFullscreen(); } catch(e) { showToast('Fullskärm stöds inte här.'); } });
document.addEventListener('fullscreenchange', () => { ui.fullscreenBtn.textContent = document.fullscreenElement ? '⤢' : '⛶'; ui.fullscreenBtn.title = document.fullscreenElement ? 'Avsluta fullskärm' : 'Fullskärm'; setTimeout(resize,50); });

function spawnEnemy() {
  const t=state.elapsedMs/1000, minute=Math.floor(t/60);
  const tiers=[
    {name:'Geléfnatt',color:'#d9a7d8',eye:'#65445f',hp:24,speed:48,damage:8,radius:14,xp:1,pack:1,shooter:0},
    {name:'Persikopuff',color:'#ffbf9d',eye:'#74483c',hp:28,speed:52,damage:9,radius:14,xp:1,pack:2,shooter:0},
    {name:'Blåbärsbuse',color:'#9fc9e5',eye:'#39586e',hp:34,speed:57,damage:10,radius:15,xp:1,pack:2,shooter:.08},
    {name:'Citronstök',color:'#f5d978',eye:'#6d5c27',hp:40,speed:61,damage:11,radius:15,xp:2,pack:3,shooter:.13},
    {name:'Mintmarodör',color:'#86cfb3',eye:'#315f50',hp:48,speed:65,damage:12,radius:16,xp:2,pack:3,shooter:.18},
    {name:'Plommonpucko',color:'#b99adb',eye:'#513d6b',hp:58,speed:69,damage:13,radius:17,xp:2,pack:4,shooter:.23},
    {name:'Rosa rövare',color:'#ef9fbd',eye:'#704052',hp:70,speed:73,damage:14,radius:17,xp:3,pack:4,shooter:.28},
    {name:'Turkost trubbel',color:'#70c9c8',eye:'#285d60',hp:84,speed:77,damage:15,radius:18,xp:3,pack:4,shooter:.32}
  ];
  const tier=tiers[Math.min(minute,tiers.length-1)], late=Math.max(0,minute-(tiers.length-1));
  const hpScale=1+minute*.055+late*.045, dmgScale=1+minute*.035+late*.025, speedScale=1+Math.min(.32,minute*.025);
  const group=Math.min(5,tier.pack+(late>=3?1:0));
  const ang=Math.random()*Math.PI*2,rad=Math.max(width,height)*.68+rand(80,180),bx=state.player.x+Math.cos(ang)*rad,by=state.player.y+Math.sin(ang)*rad;
  for(let i=0;i<group;i++){
    const elite=t>100&&Math.random()<Math.min(.08,.012+t/2600), shooter=minute>=2&&Math.random()<tier.shooter;
    const hp=tier.hp*hpScale*(elite?2.25:1)*(shooter?1.08:1);
    state.enemies.push({id:++state.enemyId,x:bx+rand(-34,34),y:by+rand(-34,34),type:shooter?'skytt':'minute',minuteTier:minute,enemyName:tier.name,radius:tier.radius*(elite?1.24:1),hp,maxHp:hp,speed:tier.speed*speedScale*(elite?.94:1)*(shooter?.78:1),damage:tier.damage*dmgScale,color:tier.color,eye:tier.eye,xp:tier.xp*(elite?3:1),elite,shooter,shootTimer:shooter?rand(1.2,2.6):0,shootCooldown:Math.max(1.45,2.55-minute*.07),wobble:Math.random()*6.28,hit:0});
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
  const hp = 315 * Math.pow(1.38, n - 1) * (1 + t / 310);
  const speed = Math.min(64, 36 + n * 3.5);
  const damage = Math.min(36, 15 + n * 2.4);
  // När Kayvan dyker upp flyr merparten av småfienderna så bossen blir huvudproblemet.
  const regular = state.enemies.filter(e => !e.boss && !e.dead);
  regular.sort((a,b) => distSq(a, state.player) - distSq(b, state.player));
  const keep = new Set(regular.slice(0, Math.min(18, regular.length)).map(e => e.id));
  state.enemies = state.enemies.filter(e => e.boss || e.dead || keep.has(e.id));
  state.enemies.push({
    id: ++state.enemyId, x, y, type: 'kayvan', radius: 39,
    hp, maxHp: hp, speed, damage, color: '#8a73c7', xp: 18 + n * 4,
    elite: false, boss: true, bossName: 'Den farliga Kayvan', wobble: 0, hit: 0
  });
  state.rings.push({ x, y, r: 20, max: 115, life: .8, total: .8, boss: true });
  showToast(`⚠️ DEN FARLIGA KAYVAN ÄR HÄR! Småttingarna flyr!`);
  popup(x, y - 58, 'DEN FARLIGA KAYVAN!', '#6a4f9e');
  beep(95, .28, 'sawtooth', .035, -25);
  setTimeout(() => beep(72, .32, 'square', .025, -15), 180);
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
  beep(330,.035,'triangle',.009,80);
}

function updateJimmy(dt) {
  const j=state.jimmy,p=state.player;
  const targetX=p.x-42, targetY=p.y+32;
  j.x += (targetX-j.x)*Math.min(1,dt*5.4); j.y += (targetY-j.y)*Math.min(1,dt*5.4);
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

function storm(dt) {
  const p=state.player;if(!p.stormRank)return; p.stormTimer-=dt;if(p.stormTimer>0)return;
  p.stormTimer=Math.max(1.15,4.5-p.stormRank*.34);const r=(130+p.stormRank*19)*p.stormPower, dmg=(16+p.stormRank*11)*p.stormPower;
  state.rings.push({x:p.x,y:p.y,r:8,max:r,life:.5,total:.5,storm:true});spinachBurst(p.x,p.y,18+p.stormRank*2,1);
  for(const e of state.enemies){if(Math.hypot(e.x-p.x,e.y-p.y)<r+e.radius){e.hp-=dmg;e.hit=.12;if(e.hp<=0)killEnemy(e);}}
  beep(250,.18,'sine',.018,180);
}

function killEnemy(e) {
  if (e.dead) return; e.dead=true; state.kills++;
  spinachBurst(e.x,e.y,e.elite?26:12,e.elite?1.5:1);
  state.orbs.push({x:e.x,y:e.y,vx:rand(-30,30),vy:rand(-30,30),value:e.xp,radius:e.boss?15:(e.elite?12:10),pulse:Math.random()*6.28});
  if(e.boss){ popup(e.x,e.y-46,'KAYVAN BLEV SPENAT!','#6a4f9e'); spinachBurst(e.x,e.y,48,2.1); state.shake=12; } else if(e.elite) popup(e.x,e.y-28,'STOR SPENATHÖG!','#4f9275');
  beep(e.boss?72:(e.elite?100:190),e.boss?.16:.05,e.boss?'square':'sine',e.boss?.026:.012,e.boss?-20:(e.elite?-40:80));
}
function spinachBurst(x,y,count=10,scale=1){
  for(let i=0;i<count;i++){const a=Math.random()*6.28,sp=rand(40,180)*scale;state.particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:rand(.35,.9),max:1,size:rand(3,8)*scale,rot:Math.random()*6.28,leaf:Math.random()<.45,color:choose(['#5fa66f','#7fbe72','#9dce7b','#4f9275'])});}
}
function popup(x,y,text,color='#3d4051'){ showToast(text); }


function spawnHealingSpinach() {
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

function collectHealingSpinach(h) {
  h.dead = true;
  const p = state.player;
  const before = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + h.heal);
  const healed = Math.ceil(p.hp - before);
  spinachBurst(h.x, h.y, 10, .6);
  popup(h.x, h.y - 18, healed > 0 ? `+${healed} ork` : 'SPENAT!', '#3d8f5b');
  beep(610, .07, 'sine', .018, 180);
}

function gainXp(v) {
  const p=state.player;p.xp+=v;
  while(p.xp>=p.xpNeed){p.xp-=p.xpNeed;p.level++;p.xpNeed=Math.floor(p.xpNeed*1.24+3);openUpgrade();break;}
}
function openUpgrade(){
  if(!state||state.over)return;state.choosing=true;ui.upgradeLevel.textContent=state.player.level;ui.upgradeChoices.innerHTML='';
  const ids=Object.keys(SKILLS), pool=[...ids]; const picks=[];
  while(picks.length<3&&pool.length){const i=Math.floor(Math.random()*pool.length);picks.push(pool.splice(i,1)[0]);}
  for(const id of picks){const sk=SKILLS[id],rank=(state.skills.get(id)||0)+1;const b=document.createElement('button');b.className='upgrade-choice';b.innerHTML=`<span class="emoji">${sk.emoji}</span><strong>${sk.name}</strong><span>${sk.desc}</span><small>Nivå ${rank}</small>`;b.addEventListener('click',()=>chooseUpgrade(id));ui.upgradeChoices.appendChild(b);}
  ui.upgrade.classList.add('show');beep(520,.1,'sine',.02,250);setTimeout(()=>beep(780,.12,'sine',.018,160),90);
}
function chooseUpgrade(id){const sk=SKILLS[id];state.skills.set(id,(state.skills.get(id)||0)+1);sk.apply(state);ui.upgrade.classList.remove('show');state.choosing=false;lastFrame=performance.now();showToast(`${sk.emoji} ${sk.name} förbättrad!`);}

function update(dt) {
  const p=state.player; state.elapsedMs += dt*1000; p.invuln=Math.max(0,p.invuln-dt); state.shake=Math.max(0,state.shake-dt*28);
  const mv=movementVector();p.x+=mv.x*p.speed*dt;p.y+=mv.y*p.speed*dt;
  autoAttack(dt);updateJimmy(dt);storm(dt);

  const t=state.elapsedMs/1000;
  const minuteNow=Math.floor(t/60);
  if(minuteNow>state.minuteTier){state.minuteTier=minuteNow;showToast(`⏱ MINUT ${minuteNow+1}: nya monster har vaknat!`);beep(390,.10,'triangle',.018,150);}
  if (t >= state.nextBossAt) {
    spawnBoss();
    state.nextBossAt += 90;
  }
  const bossActive = state.enemies.some(e => e.boss && !e.dead);
  state.spawnTimer-=dt;
  const interval = bossActive ? Math.max(.75, 1.35/(1+t/220)) : Math.max(.17,.90/(1+t/82));
  while(state.spawnTimer<=0){
    state.spawnTimer+=interval;
    const regularCount = state.enemies.reduce((n,e)=>n+(!e.boss&&!e.dead?1:0),0);
    if(!bossActive || regularCount < 26) spawnEnemy();
    if(!bossActive && t>180 && Math.random()<.08) spawnEnemy();
  }
  state.healSpawnTimer -= dt;
  if(state.healSpawnTimer <= 0){ spawnHealingSpinach(); state.healSpawnTimer = rand(6, 12); }
  if(state.enemies.length>260) {
    const bosses=state.enemies.filter(e=>e.boss&&!e.dead);
    const regular=state.enemies.filter(e=>!e.boss&&!e.dead).slice(-Math.max(0,260-bosses.length));
    state.enemies=[...regular,...bosses];
  }

  for(const e of state.enemies){
    if(e.dead)continue; e.hit=Math.max(0,e.hit-dt);e.wobble+=dt*3;
    let dx=p.x-e.x,dy=p.y-e.y,d=Math.hypot(dx,dy)||1;
    if(e.shooter){const desired=245,dir=d>desired?1:(d<185?-.65:0);e.x+=dx/d*e.speed*dt*dir;e.y+=dy/d*e.speed*dt*dir;e.shootTimer-=dt;if(e.shootTimer<=0&&d<560){e.shootTimer+=e.shootCooldown;const a=Math.atan2(dy,dx);state.enemyBullets.push({x:e.x,y:e.y,vx:Math.cos(a)*145,vy:Math.sin(a)*145,radius:6,damage:e.damage*.62,life:4,color:e.color});}} else {e.x+=dx/d*e.speed*dt;e.y+=dy/d*e.speed*dt;}
    if(d<e.radius+p.radius&&p.invuln<=0){const damage=Math.max(1,e.damage*(1-p.armor));p.hp-=damage;p.invuln=.64;state.shake=7;popup(p.x,p.y-30,`-${Math.ceil(damage)} ork`,'#765a86');spinachBurst(p.x,p.y,6,.45);beep(125,.09,'sawtooth',.022,-40);if(p.hp<=0){p.hp=0;gameOver();return;}}
  }
  state.enemies=state.enemies.filter(e=>!e.dead);
  for(const b of state.enemyBullets){b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;const d=Math.hypot(b.x-p.x,b.y-p.y);if(b.life>0&&d<p.radius+b.radius&&p.invuln<=0){const damage=Math.max(1,b.damage*(1-p.armor));p.hp-=damage;p.invuln=.50;b.life=0;state.shake=4;popup(p.x,p.y-28,`-${Math.ceil(damage)} ork`,'#765a86');if(p.hp<=0){p.hp=0;gameOver();return;}}}state.enemyBullets=state.enemyBullets.filter(b=>b.life>0);

  for(const pr of state.projectiles){
    pr.x+=pr.vx*dt;pr.y+=pr.vy*dt;pr.life-=dt;if(pr.life<=0)continue;
    for(const e of state.enemies){
      if(e.dead || pr.hitIds?.has(e.id))continue;
      const rr=pr.radius+e.radius;
      if((pr.x-e.x)**2+(pr.y-e.y)**2<rr*rr){
        e.hp-=pr.damage;e.hit=.10;pr.hitIds?.add(e.id);spinachBurst(pr.x,pr.y,pr.crit?8:4,pr.crit?.55:.35);
        if(pr.crit) popup(pr.x,pr.y-12,'KRITISK!','#a87900');
        if(e.hp<=0)killEnemy(e);
        if((pr.pierce||0)>0){pr.pierce-=1;}else{pr.life=0;break;}
      }
    }
  }
  state.projectiles=state.projectiles.filter(p=>p.life>0);

  for(const o of state.orbs){o.pulse=(o.pulse||0)+dt*6;o.x+=o.vx*dt;o.y+=o.vy*dt;o.vx*=Math.pow(.12,dt);o.vy*=Math.pow(.12,dt);const dx=p.x-o.x,dy=p.y-o.y,d=Math.hypot(dx,dy);if(d<95){const f=(1-d/95)*520;o.x+=dx/(d||1)*f*dt;o.y+=dy/(d||1)*f*dt;}if(d<p.radius+o.radius+5){o.dead=true;gainXp(o.value);beep(720,.025,'sine',.006,100);}}
  state.orbs=state.orbs.filter(o=>!o.dead);

  for(const h of state.heals){
    h.pulse += dt*4; h.rot += dt*.8;
    const dx=p.x-h.x,dy=p.y-h.y,d=Math.hypot(dx,dy);
    if(d < p.radius+h.radius+8) collectHealingSpinach(h);
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
  const pct=clamp(1-state.jimmy.barkTimer/state.jimmy.barkCooldown,0,1);
  ui.jimmyBar.style.width=`${pct*100}%`;
  ui.jimmyText.textContent=state.jimmy.barkTimer<=.05?'Skall redo!':`Skall om ${Math.max(0,state.jimmy.barkTimer).toFixed(1)} s`;
}

function worldToScreen(x,y){return{x:x-state.camera.x+width/2,y:y-state.camera.y+height/2};}
function drawBackground(){
  ctx.fillStyle='#dff2d8';ctx.fillRect(0,0,width,height);
  const tile=130,ox=((-state.camera.x%tile)+tile)%tile,oy=((-state.camera.y%tile)+tile)%tile;
  for(let x=ox-tile;x<width+tile;x+=tile){for(let y=oy-tile;y<height+tile;y+=tile){const n=Math.sin((x+state.camera.x)*.013)*Math.cos((y+state.camera.y)*.017);ctx.fillStyle=n>0?'rgba(255,246,180,.22)':'rgba(177,220,190,.18)';ctx.beginPath();ctx.arc(x+25*Math.sin(y*.02),y,28+12*n,0,6.28);ctx.fill();}}
  // Små blommor som flyter med världen.
  const spacing=180, sx=Math.floor((state.camera.x-width/2)/spacing), ex=Math.ceil((state.camera.x+width/2)/spacing), sy=Math.floor((state.camera.y-height/2)/spacing), ey=Math.ceil((state.camera.y+height/2)/spacing);
  for(let gx=sx;gx<=ex;gx++)for(let gy=sy;gy<=ey;gy++){const seed=Math.abs((gx*73856093)^(gy*19349663));const wx=gx*spacing+(seed%95),wy=gy*spacing+((seed>>4)%100);const s=worldToScreen(wx,wy);ctx.fillStyle=['#ffd5df','#fff0a6','#c6b5e8'][seed%3];ctx.beginPath();ctx.arc(s.x,s.y,2.5,0,6.28);ctx.arc(s.x+5,s.y+2,2.5,0,6.28);ctx.arc(s.x-4,s.y+3,2.5,0,6.28);ctx.fill();}
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
  if(e.boss){
    const pulse=1+Math.sin(performance.now()/170)*.045;
    ctx.scale(pulse,pulse);
    ctx.fillStyle='rgba(126,88,190,.16)';ctx.beginPath();ctx.arc(0,0,e.radius+13,0,6.28);ctx.fill();
    ctx.strokeStyle='#ffe789';ctx.lineWidth=5;ctx.beginPath();ctx.arc(0,0,e.radius+7,0,6.28);ctx.stroke();
    ctx.fillStyle=e.hit>0?'#a8dfbd':'#8a73c7';ctx.beginPath();ctx.arc(0,0,e.radius,0,6.28);ctx.fill();
    ctx.fillStyle='#f6dfbf';ctx.beginPath();ctx.arc(0,-5,e.radius*.58,0,6.28);ctx.fill();
    ctx.fillStyle='#4f3a67';ctx.beginPath();ctx.arc(-11,-9,4,0,6.28);ctx.arc(11,-9,4,0,6.28);ctx.fill();
    ctx.strokeStyle='#4f3a67';ctx.lineWidth=4;ctx.beginPath();ctx.arc(0,6,13,.15,Math.PI-.15);ctx.stroke();
    ctx.restore();
    const barW=Math.min(220,width*.30), bx=s.x-barW/2, by=s.y-e.radius-34;
    ctx.fillStyle='rgba(255,255,255,.9)';ctx.fillRect(bx-3,by-3,barW+6,13);
    ctx.fillStyle='#d7c7f1';ctx.fillRect(bx,by,barW,7);
    ctx.fillStyle='#7453aa';ctx.fillRect(bx,by,barW*clamp(e.hp/e.maxHp,0,1),7);
    ctx.fillStyle='#4b3b61';ctx.font='900 13px Trebuchet MS';ctx.textAlign='center';ctx.fillText('DEN FARLIGA KAYVAN',s.x,by-7);
    return;
  }
  const tier=e.minuteTier||0;ctx.fillStyle=e.hit>0?'#a8dfbd':e.color;ctx.beginPath();if(tier%3===0)ctx.arc(0,0,e.radius,0,6.28);else if(tier%3===1){ctx.moveTo(0,-e.radius);ctx.lineTo(e.radius*.9,e.radius*.72);ctx.lineTo(-e.radius*.9,e.radius*.72);ctx.closePath();}else{ctx.roundRect(-e.radius,-e.radius,e.radius*2,e.radius*2,Math.max(4,e.radius*.45));}ctx.fill();if(tier>=3){ctx.strokeStyle='rgba(255,255,255,.55)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,e.radius*.62,0,6.28);ctx.stroke();}ctx.fillStyle=e.eye||'rgba(61,64,81,.75)';ctx.beginPath();ctx.arc(-e.radius*.3,-2,2.2,0,6.28);ctx.arc(e.radius*.3,-2,2.2,0,6.28);ctx.fill();if(e.shooter){ctx.strokeStyle=e.eye||'#4b3b61';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(e.radius*.55,1);ctx.lineTo(e.radius+8,1);ctx.stroke();ctx.fillStyle='#fff7c7';ctx.beginPath();ctx.arc(e.radius+8,1,3,0,6.28);ctx.fill();}else{ctx.strokeStyle='rgba(61,64,81,.45)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,5,e.radius*.28,0,Math.PI);ctx.stroke();}if(e.elite){ctx.strokeStyle='#ffe79a';ctx.lineWidth=4;ctx.beginPath();ctx.arc(0,0,e.radius+5,0,6.28);ctx.stroke();}ctx.restore();
}
function draw(){
  if(!state){ctx.fillStyle='#dff2d8';ctx.fillRect(0,0,width,height);return;}
  ctx.save();if(state.shake>0)ctx.translate(rand(-state.shake,state.shake),rand(-state.shake,state.shake));drawBackground();
  for(const o of state.orbs){const s=worldToScreen(o.x,o.y),pulse=1+Math.sin(o.pulse||0)*.12,r=o.radius*pulse;ctx.save();ctx.shadowColor='#ffd83d';ctx.shadowBlur=18;ctx.fillStyle='#ffd83d';ctx.beginPath();ctx.arc(s.x,s.y,r+3,0,6.28);ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle='#fff7b0';ctx.lineWidth=3;ctx.beginPath();ctx.arc(s.x,s.y,r+1,0,6.28);ctx.stroke();ctx.fillStyle='#fffbe8';ctx.beginPath();ctx.arc(s.x-3,s.y-3,Math.max(3,r*.32),0,6.28);ctx.fill();ctx.restore();}
  for(const h of state.heals){
    const s=worldToScreen(h.x,h.y), pulse=1+Math.sin(h.pulse)*.10;
    ctx.save();ctx.translate(s.x,s.y);ctx.rotate(h.rot);ctx.scale(pulse,pulse);
    ctx.shadowColor='#65c97c';ctx.shadowBlur=14;
    ctx.fillStyle='#55ae69';ctx.beginPath();ctx.ellipse(-5,0,9,4,-.55,0,6.28);ctx.fill();
    ctx.fillStyle='#86d68d';ctx.beginPath();ctx.ellipse(5,0,9,4,.55,0,6.28);ctx.fill();
    ctx.strokeStyle='#387f50';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,-6);ctx.lineTo(0,8);ctx.stroke();
    ctx.shadowBlur=0;ctx.fillStyle='#fffbe8';ctx.font='900 10px Trebuchet MS';ctx.textAlign='center';ctx.fillText('+',0,3);
    ctx.restore();
  }
  for(const r of state.rings){const s=worldToScreen(r.x,r.y),t=1-r.life/r.total;ctx.strokeStyle=r.boss?`rgba(126,88,190,${1-t})`:(r.storm?`rgba(79,146,117,${1-t})`:`rgba(94,75,120,${1-t})`);ctx.lineWidth=5*(1-t)+1;ctx.beginPath();ctx.arc(s.x,s.y,r.r+(r.max-r.r)*t,0,6.28);ctx.stroke();}
  for(const b of state.enemyBullets){const s=worldToScreen(b.x,b.y);ctx.save();ctx.shadowColor=b.color;ctx.shadowBlur=9;ctx.fillStyle=b.color;ctx.beginPath();ctx.arc(s.x,s.y,b.radius,0,6.28);ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();ctx.restore();}
  for(const pr of state.projectiles){const s=worldToScreen(pr.x,pr.y);ctx.save();if(pr.crit){ctx.shadowColor='#ffe35b';ctx.shadowBlur=12;}ctx.fillStyle=pr.crit?'#fff06f':'#fff2a8';ctx.beginPath();ctx.arc(s.x,s.y,pr.radius,0,6.28);ctx.fill();ctx.strokeStyle=pr.crit?'#b78d00':'#d7ba60';ctx.lineWidth=pr.crit?2.5:1;ctx.stroke();ctx.restore();}
  for(const e of state.enemies)drawEnemy(e);drawJimmy();drawDavina();
  for(const q of state.particles){const s=worldToScreen(q.x,q.y);ctx.save();ctx.globalAlpha=clamp(q.life/.6,0,1);ctx.translate(s.x,s.y);ctx.rotate(q.rot);ctx.fillStyle=q.color;if(q.leaf){ctx.beginPath();ctx.ellipse(0,0,q.size,q.size*.45,0,0,6.28);ctx.fill();}else{ctx.beginPath();ctx.arc(0,0,q.size*.6,0,6.28);ctx.fill();}ctx.restore();}
  for(const p of state.popups){const s=worldToScreen(p.x,p.y);ctx.globalAlpha=clamp(p.life,0,1);ctx.fillStyle=p.color;ctx.font='800 14px Trebuchet MS';ctx.textAlign='center';ctx.fillText(p.text,s.x,s.y);ctx.globalAlpha=1;}
  ctx.restore();
}

function frame(now){const dt=Math.min(.033,(now-lastFrame)/1000);lastFrame=now;if(state?.running&&!state.paused&&!state.choosing&&!state.over)update(dt);draw();requestAnimationFrame(frame);}requestAnimationFrame(frame);

function gameOver(){
  if(!state||state.over)return;
  state.over=true;state.running=false;
  ui.pause.classList.remove('show');ui.upgrade.classList.remove('show');ui.hud.classList.add('hidden');ui.joystick.classList.add('hidden');
  beep(220,.22,'triangle',.03,-120);setTimeout(()=>beep(140,.28,'triangle',.025,-70),180);
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
  try{
    const result=saveLocalScore(score);
    ui.saveStatus.textContent='✓ Resultatet är sparat lokalt på den här enheten.';
    ui.saveStatus.classList.remove('bad');
    ui.rankStatus.textContent=result.top10?`🏆 Ny lokal topp 10! Placering ${result.position}.`:`Din lokala placering: ${result.position ?? 'utanför topp 100'}.`;
  }catch(e){
    ui.saveStatus.textContent='⚠ Resultatet kunde inte sparas lokalt i webbläsaren.';
    ui.saveStatus.classList.add('bad');
  }
  loadLeaderboard(ui.resultLeaderboard,confirmedName);
}
ui.againBtn.addEventListener('click',()=>{
  state=null;
  const saved=localStorage.getItem('spenatstorm_display_name')||'';
  const result=validateNameClient(saved);
  if(result.ok){
    confirmedName=result.name;
    ui.nameInput.value=result.name;
    ui.nameStatus.textContent=`✓ Sparat namn: ${result.name}`;
    ui.nameStatus.classList.remove('bad');
    ui.startBtn.disabled=false;
  }
  ui.result.classList.remove('show');
  ui.start.classList.add('show');
  loadLeaderboard(ui.startLeaderboard,confirmedName);
});

function loadLeaderboard(target, highlight=''){
  const scores=getLocalScores().slice(0,10).map((s,i)=>({...s,position:i+1}));
  renderLeaderboard(target,scores,highlight);
  ui.startServerInfo.textContent='💾 Topplistan sparas bara lokalt på den här enheten och i den här webbläsaren.';
  ui.startServerInfo.classList.remove('bad');
}
function renderLeaderboard(target,scores,highlight=''){
  if(!scores.length){target.innerHTML='<p style="padding:10px">Inga sparade resultat ännu. Någon måste ju vara först. 🌿</p>';return;}
  target.innerHTML='<div class="leader-row leader-head"><span>#</span><span>Namn</span><span>Tid</span><span>Nivå</span><span>Fiender</span></div>';
  for(const s of scores){const row=document.createElement('div');row.className='leader-row'+(highlight&&s.name===highlight?' me':'');row.innerHTML=`<span class="pos">${s.position}</span><span class="name"></span><b>${formatTime(s.durationMs)}</b><span>${s.level}</span><span>${s.kills}</span>`;row.querySelector('.name').textContent=s.name;row.title=s.skills?.length?s.skills.map(x=>`${x.name} ×${x.rank}`).join(', '):'Inga förbättringar';target.appendChild(row);}
}
const savedDisplayName = localStorage.getItem('spenatstorm_display_name') || '';
const savedNameResult = validateNameClient(savedDisplayName);
if (savedNameResult.ok) {
  confirmedName = savedNameResult.name;
  ui.nameInput.value = savedNameResult.name;
  ui.nameStatus.textContent = `✓ Sparat namn: ${savedNameResult.name}`;
  ui.nameStatus.classList.remove('bad');
  ui.startBtn.disabled = false;
}
loadLeaderboard(ui.startLeaderboard, confirmedName);

