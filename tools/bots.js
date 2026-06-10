// Bots de test : se connectent, explorent, combattent, ramassent.
// Usage : node tools/bots.js [nb=3] [durée_s=20] [url=ws://localhost:8080]
import WebSocket from 'ws';
import { decodeSnapshot, BIN_SNAPSHOT } from '../shared/protocol.js';
import { KIND, ST } from '../shared/constants.js';

const NB = parseInt(process.argv[2] || '3', 10);
const DURATION = parseInt(process.argv[3] || '20', 10);
const URL = process.argv[4] || 'ws://localhost:8080';

let failures = 0;
const summaries = [];

function bot(n) {
  return new Promise((resolve) => {
    const name = `Bot_${n}_${Math.floor(Math.random() * 1e6)}`;
    const ws = new WebSocket(URL);
    const state = {
      name, id: null, metas: new Map(), pos: new Map(),
      dmgDealt: 0, dmgTaken: 0, loots: 0, xpMsgs: 0, level: 1, gold: 0,
      kills: 0, snapshots: 0, errors: [],
    };

    ws.on('open', () => ws.send(JSON.stringify({ t: 'register', name, pass: 'test1234' })));
    ws.on('error', (e) => { state.errors.push('ws: ' + e.message); });
    ws.on('message', (raw, isBinary) => {
      if (isBinary) {
        const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
        const v = new DataView(ab);
        if (v.getUint8(0) !== BIN_SNAPSHOT) return;
        let snap;
        try { snap = decodeSnapshot(ab); } catch (e) { state.errors.push('decode: ' + e.message); return; }
        state.snapshots++;
        for (const e of snap.entities) state.pos.set(e.id, e);
        for (const id of snap.gone) { state.pos.delete(id); state.metas.delete(id); }
        return;
      }
      const msg = JSON.parse(raw.toString());
      switch (msg.t) {
        case 'auth_error': state.errors.push('auth: ' + msg.error); break;
        case 'welcome': state.id = msg.id; break;
        case 'self': state.level = msg.level; state.gold = msg.gold; break;
        case 'meta': for (const m of msg.list) state.metas.set(m.id, m); break;
        case 'loot':
          state.loots++;
          if (msg.text.includes('XP')) { state.xpMsgs++; state.kills++; }
          break;
        case 'events':
          for (const ev of msg.list) {
            if (ev.t === 'dmg' && !ev.miss) {
              if (ev.from === state.id) state.dmgDealt += ev.amount;
              if (ev.to === state.id) state.dmgTaken += ev.amount;
            }
          }
          break;
        case 'died': ws.send(JSON.stringify({ t: 'respawn' })); break;
      }
    });

    // IA du bot : attaque le mob vivant le plus proche, sinon erre ; ramasse les drops
    const think = setInterval(() => {
      if (!state.id || ws.readyState !== 1) return;
      const me = state.pos.get(state.id);
      if (!me) return;
      let nearestMob = null, dMob = Infinity, nearestDrop = null, dDrop = Infinity;
      for (const [id, e] of state.pos) {
        if (e.state === ST.DEAD) continue;
        const meta = state.metas.get(id);
        if (!meta) continue;
        const d = Math.hypot(e.x - me.x, e.z - me.z);
        if (meta.kind === KIND.MOB && d < dMob) { dMob = d; nearestMob = id; }
        if (meta.kind === KIND.DROP && d < dDrop) { dDrop = d; nearestDrop = id; }
      }
      if (nearestDrop && dDrop < 8) ws.send(JSON.stringify({ t: 'pickup', id: nearestDrop }));
      else if (nearestMob) ws.send(JSON.stringify({ t: 'attack', id: nearestMob }));
      else {
        const a = Math.random() * Math.PI * 2, d = 8 + Math.random() * 15;
        ws.send(JSON.stringify({ t: 'move', x: me.x + Math.cos(a) * d, z: me.z + Math.sin(a) * d }));
      }
      if (Math.random() < 0.05) ws.send(JSON.stringify({ t: 'chat', text: `coucou depuis ${name}` }));
    }, 1200);

    setTimeout(() => {
      clearInterval(think);
      try { ws.close(); } catch {}
      const ok = state.id != null && state.snapshots > DURATION * 5 && state.errors.length === 0;
      if (!ok) failures++;
      summaries.push(
        `${name}: ${ok ? 'OK' : 'ÉCHEC'} — snapshots=${state.snapshots} niv=${state.level} ` +
        `dégâts infligés=${state.dmgDealt} subis=${state.dmgTaken} loots=${state.loots} kills=${state.kills} or=${state.gold}` +
        (state.errors.length ? ` ERREURS: ${state.errors.join('; ')}` : '')
      );
      resolve();
    }, DURATION * 1000);
  });
}

const bots = [];
for (let i = 0; i < NB; i++) bots.push(bot(i));
await Promise.all(bots);
console.log(summaries.join('\n'));
console.log(failures === 0 ? '\nTOUS LES BOTS OK' : `\n${failures} BOT(S) EN ÉCHEC`);
process.exit(failures === 0 ? 0 : 1);
