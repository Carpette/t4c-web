// Dialogues à mots-clés des PNJ — test d'intégration :
// un PNJ d'overrides (avec dialogues) est posé par l'API admin, puis un bot :
// 1. message sans mot-clé → silence ; mot-clé → réponse en chat local ;
// 2. conditions : « secret » répond différemment avant/après le drapeau ;
// 3. récompense (or) versée UNE seule fois (drapeau auto anti-farm) ;
// 4. condition d'objet avec consume : la potion est consommée, l'XP versée ;
// 5. overrides `npcs` sur les PNJ PAR DÉFAUT : edit (renommé + dialogues),
//    move (déplacé), remove (retiré) — appliqués à chaud par le PUT ;
// 6. mot-clé prononcé LOIN du PNJ → aucune réaction.
// À lancer sur une base FRAÎCHE (1er compte = admin). Usage : node tools/test-npc-keywords.js [url]
import WebSocket from 'ws';
import { PROTOCOL_VERSION, NPC_DIALOGUE_RANGE } from '../shared/constants.js';
import { decodeSnapshot, BIN_SNAPSHOT } from '../shared/protocol.js';
import { generateWorld } from '../shared/worldgen.js';
import { sleep } from './test-helpers.js';

const BASE = process.argv[2] || 'http://localhost:8090';
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? '  ✔' : '  ✘', name); };

// ---------- emplacement du PNJ : case praticable à ~3 tuiles du spawn ----------
const world = generateWorld(8281932, 'arakas'); // zone 0 (seed de zones.json)
const spawn = world.spawnPoint;
function walkableNearSpawn(min, max) {
  for (let r = min; r <= max; r += 0.5) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const x = Math.floor(spawn.x + Math.cos(a) * r) + 0.5;
      const z = Math.floor(spawn.z + Math.sin(a) * r) + 0.5;
      if (world.isWalkable(x, z)) return { x, z };
    }
  }
  throw new Error('aucune case praticable trouvée près du spawn');
}
const AT = walkableNearSpawn(2.5, 4.5);       // à portée d'oreille depuis le spawn
const FAR = walkableNearSpawn(NPC_DIALOGUE_RANGE + 24, 60); // hors de portée, large

const NPC_ID = 'pnj_test_ermite';
const NPC_NAME = 'Vieil Ermite';
const NPC_ADD = {
  id: NPC_ID, x: AT.x, z: AT.z,
  name: NPC_NAME, role: 'bavard',
  look: { chest: 'cloth_shirt', head: null, main: 'staff', off: null },
  greetings: ['Hum ? Un visiteur ?'],
  dialogues: [
    {
      keywords: ['travail', 'quête'],
      reponse: 'REPONSE_TRAVAIL : voilà cinquante pièces. Reviens me parler du secret.',
      reactions: [{ type: 'gold', amount: 50 }, { type: 'flag', key: 'ermite_travail' }],
    },
    { // version « initié » : prioritaire quand le drapeau est posé
      keywords: ['secret'],
      conditions: { flag: 'ermite_travail' },
      reponse: 'REPONSE_SECRET : le trésor dort sous le vieux chêne.',
    },
    { // repli sans condition : sert tant que le drapeau manque
      keywords: ['secret'],
      reponse: 'REPONSE_REFUS : fais d\'abord tes preuves.',
    },
    {
      keywords: ['offrande'],
      conditions: { item: 'potion_vie', consume: true },
      reponse: 'REPONSE_OFFRANDE : que les dieux te le rendent.',
      reactions: [{ type: 'xp', amount: 30 }],
    },
  ],
};

// ---------- session WebSocket (self + chats + événements say) ----------
function session(name) {
  const S = { name, id: null, self: null, zone: null, pos: new Map(), metas: new Map(), chats: [], says: [], xpEvents: [] };
  const ws = new WebSocket(BASE.replace('http', 'ws'));
  ws.on('message', (raw, bin) => {
    if (bin) {
      const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
      if (new DataView(ab).getUint8(0) !== BIN_SNAPSHOT) return;
      const snap = decodeSnapshot(ab);
      for (const e of snap.entities) S.pos.set(e.id, e);
      for (const id of snap.gone) S.pos.delete(id);
      return;
    }
    const m = JSON.parse(raw.toString());
    switch (m.t) {
      case 'create_char': S.send({ t: 'create', stats: { str: 22, end: 18, agi: 14, int: 8, wis: 8 } }); break;
      case 'welcome': S.id = m.id; break;
      case 'self': S.self = m; break;
      case 'zone': S.zone = m; break;
      case 'meta': for (const e of m.list) S.metas.set(e.id, e); break;
      case 'chat': S.chats.push(m); break;
      case 'xp': S.xpEvents.push(m); break;
      case 'events':
        for (const ev of m.list) if (ev.t === 'say' && ev.npc) S.says.push(ev);
        break;
    }
  });
  S.ws = ws;
  S.send = (o) => ws.send(JSON.stringify(o));
  S.waitFor = (fn, timeout = 6000) => new Promise((res) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const v = fn();
      if (v) { clearInterval(iv); res(v); }
      else if (Date.now() - t0 > timeout) { clearInterval(iv); res(null); }
    }, 40);
  });
  S.open = new Promise(r => ws.on('open', r));
  return S;
}

// dit quelque chose et attend (ou non) la réplique d'un PNJ en chat local
async function sayAndListen(S, text, timeout = 2500, fromName = NPC_NAME) {
  const from = S.chats.length;
  S.send({ t: 'chat', text });
  const reply = await S.waitFor(() => S.chats.slice(from).find(c => c.from === fromName), timeout);
  await sleep(900); // anti-spam du chat : espace les messages suivants
  return reply;
}

// ---------- bot admin (1er compte de la base fraîche) ----------
const A = session('Parleur_' + Math.floor(Math.random() * 1e6));
await A.open;
A.send({ t: 'register', v: PROTOCOL_VERSION, name: A.name, pass: 'test1234' });
await A.waitFor(() => A.self && A.zone);
ok('connexion zone 0 (Arakas)', A.zone?.zoneId === 0);

const login = await (await fetch(`${BASE}/api/admin/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: A.name, pass: 'test1234' }),
})).json();
ok('connexion admin', !!login.token);
const api = async (url, method = 'GET', body = null) => {
  const r = await fetch(BASE + url, {
    method,
    headers: { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : null,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
};

// ---------- pose du PNJ par les overrides (appliqué à chaud : respawn) ----------
const before = await api('/api/admin/overrides/0');
await api('/api/admin/overrides/0', 'PUT', { ...before, npcs: { add: [NPC_ADD] } });
ok('PNJ d\'overrides posé par l\'API admin (PUT à chaud)', true);
await sleep(400); // le respawn des PNJ et l'entrée en AOI

// le bot est au spawn, à ~3 tuiles du PNJ : à portée d'oreille
// --- 1. message sans mot-clé : silence ---
const silence = await sayAndListen(A, 'Belle journée, n\'est-ce pas ?', 1500);
ok('message sans mot-clé : le PNJ reste muet', !silence);

// --- 2. condition flag : « secret » répond le REFUS tant que le drapeau manque ---
const refus = await sayAndListen(A, 'Connais-tu un secret ?');
ok('« secret » sans drapeau : la version repli répond', !!refus?.text.includes('REPONSE_REFUS'));

// --- 3. mot-clé avec récompense : or versé, drapeau posé ---
const gold0 = A.self.gold;
const travail = await sayAndListen(A, 'Aurais-tu du TRAVAIL pour moi ?'); // casse ignorée
ok('« travail » : le PNJ répond (chat local)', !!travail?.text.includes('REPONSE_TRAVAIL'));
ok('« travail » : bulle au-dessus du PNJ', A.says.some(s => s.text.includes('REPONSE_TRAVAIL')));
await A.waitFor(() => A.self.gold === gold0 + 50, 3000);
ok(`récompense versée (+50 or : ${gold0} → ${A.self.gold})`, A.self.gold === gold0 + 50);

// --- 4. anti-farm : la réplique rejoue, la récompense NE retombe PAS ---
const travail2 = await sayAndListen(A, 'Encore du travail ?');
await sleep(600);
ok('mot-clé répété : la réplique rejoue', !!travail2?.text.includes('REPONSE_TRAVAIL'));
ok(`anti-farm : l'or n'est versé qu'une fois (${A.self.gold} = ${gold0 + 50})`, A.self.gold === gold0 + 50);

// --- 5. condition flag remplie : « secret » répond la version initié ---
const secret = await sayAndListen(A, 'Et maintenant, ce secret ?');
ok('« secret » avec drapeau : la version conditionnée répond', !!secret?.text.includes('REPONSE_SECRET'));

// --- 6. condition d'objet avec consume : potion consommée, XP versée ---
const potions0 = A.self.inventory.filter(i => i.defId === 'potion_vie').length;
const xpFrom = A.xpEvents.length;
const offrande = await sayAndListen(A, 'Accepte cette offrande.');
ok('« offrande » : le PNJ répond', !!offrande?.text.includes('REPONSE_OFFRANDE'));
await A.waitFor(() => A.self.inventory.filter(i => i.defId === 'potion_vie').length === potions0 - 1, 3000);
const potions1 = A.self.inventory.filter(i => i.defId === 'potion_vie').length;
ok(`l'objet exigé est consommé (potions : ${potions0} → ${potions1})`, potions1 === potions0 - 1);
await A.waitFor(() => A.xpEvents.slice(xpFrom).reduce((s, e) => s + e.gain, 0) >= 30, 3000);
ok('la réaction XP est versée (+30)',
  A.xpEvents.slice(xpFrom).reduce((s, e) => s + e.gain, 0) >= 30);

// --- 7. retouches des PNJ PAR DÉFAUT : edit / move / remove, à chaud ---
// Autour du spawn de Lighthaven : Kilhiam, Moonrock et Shovanis (parvis du
// temple, à ~5 tuiles) sont visibles. On renomme Kilhiam et on lui donne un
// dialogue, on déplace Shovanis, on retire Moonrock.
const MOVE_AT = walkableNearSpawn(5.5, 8);
await api('/api/admin/overrides/0', 'PUT', {
  ...before,
  npcs: {
    add: [NPC_ADD],
    edit: { kilhiam: { name: 'Kilhiam le Sage', dialogues: [{ keywords: ['lumière'], reponse: 'REPONSE_LUMIERE : elle brille pour tous.' }] } },
    move: [{ npcId: 'shovanis', x: MOVE_AT.x, z: MOVE_AT.z }],
    remove: ['moonrock'],
  },
});
A.send({ t: 'admin', cmd: 'goto', x: spawn.x, z: spawn.z }); // retour au spawn
await sleep(600); // respawn des PNJ + snapshots
const liveNpc = (name) => [...A.pos.keys()].find(id => A.metas.get(id)?.name === name) || null;
ok('edit : Kilhiam renommé « Kilhiam le Sage » (à chaud)', !!liveNpc('Kilhiam le Sage'));
ok('remove : Moonrock a disparu', !liveNpc('Moonrock'));
const shovanisId = liveNpc('Shovanis');
const shovanisPos = shovanisId && A.pos.get(shovanisId);
ok('move : Shovanis déplacé à l\'endroit voulu',
  !!shovanisPos && Math.hypot(shovanisPos.x - MOVE_AT.x, shovanisPos.z - MOVE_AT.z) < 1.5);
const lumiere = await sayAndListen(A, 'Parle-moi de la lumiere.', 2500, 'Kilhiam le Sage'); // accents ignorés
ok('edit : le dialogue ajouté à Kilhiam répond', !!lumiere?.text.includes('REPONSE_LUMIERE'));

// --- 8. trop loin : le PNJ n'entend pas ---
// (le goto admin échoue en silence sur une case bloquée : on vérifie la position)
A.send({ t: 'admin', cmd: 'goto', x: FAR.x, z: FAR.z });
const moved = await A.waitFor(() => {
  const p = A.pos.get(A.id);
  return p && Math.hypot(p.x - AT.x, p.z - AT.z) > NPC_DIALOGUE_RANGE + 5;
}, 3000);
ok('le bot s\'est éloigné du PNJ', !!moved);
const loin = await sayAndListen(A, 'Du travail, ohé !', 1500);
ok(`mot-clé à ${Math.hypot(FAR.x - AT.x, FAR.z - AT.z).toFixed(0)} tuiles du PNJ : aucune réaction`, !loin);

// ---------- restauration ----------
await api('/api/admin/overrides/0', 'PUT', before);
const restored = await api('/api/admin/overrides/0');
ok('restauration des overrides initiaux', JSON.stringify(restored) === JSON.stringify(before));

A.ws.close();
const failed = checks.filter(([, c]) => !c);
console.log(failed.length === 0 ? '\nTOUT EST OK' : `\n${failed.length} ÉCHEC(S): ${failed.map(([n]) => n).join(', ')}`);
process.exit(failed.length === 0 ? 0 : 1);
