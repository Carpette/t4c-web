// Interface : connexion, HUD, inventaire, fiche perso, chat, dégâts flottants
import { STAT_NAMES, STATS } from '../../shared/constants.js';
import { ITEMS, QUALITY, SLOTS, SLOT_NAMES } from '../../shared/defs.js';

const SLOT_ICONS = { weapon: '⚔️', shield: '🛡️', armor: '🥋', helmet: '⛑️', ring: '💍', use: '🧪', gold: '🟡' };
const $ = (id) => document.getElementById(id);

export class UI {
  constructor(net) {
    this.net = net;
    this.self = null;

    // Connexion
    const submit = (type) => {
      const name = $('login-name').value.trim();
      const pass = $('login-pass').value;
      if (!name || !pass) { this.loginError('Pseudo et mot de passe requis'); return; }
      net.send({ t: type, name, pass });
    };
    $('btn-login').onclick = () => submit('login');
    $('btn-register').onclick = () => submit('register');
    $('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') submit('login'); });

    // Panneaux
    document.querySelectorAll('#hotbuttons button').forEach(b => {
      b.onclick = () => this.togglePanel(b.dataset.panel);
    });

    // Chat
    this.chatInput = $('chat-input');
    this.chatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const text = this.chatInput.value.trim();
        if (text) net.send({ t: 'chat', text });
        this.chatInput.value = '';
        this.chatInput.blur();
      }
      if (e.key === 'Escape') this.chatInput.blur();
      e.stopPropagation();
    });

    $('btn-respawn').onclick = () => net.send({ t: 'respawn' });
  }

  isTyping() { return document.activeElement === this.chatInput || document.activeElement?.tagName === 'INPUT'; }
  focusChat() { this.chatInput.focus(); }

  loginError(text) { $('login-error').textContent = text; }
  enterGame() {
    $('login').classList.add('hidden');
    $('hud').classList.remove('hidden');
  }

  togglePanel(name) {
    for (const p of ['inventory', 'character', 'help']) {
      if (p === name) $(p).classList.toggle('hidden');
      else $(p).classList.add('hidden');
    }
  }

  setClock(daylight, frac) {
    $('clock').textContent = daylight > 0.45 ? '🌞' : daylight > 0.12 ? '🌅' : '🌙';
    $('clock').title = `Heure du monde : ${Math.floor(frac * 24)}h`;
  }

  updateVitals(hp, mana) {
    if (!this.self) return;
    this.self.hp = hp; this.self.mana = mana;
    this.renderBars();
  }

  renderBars() {
    const s = this.self;
    $('hp-fill').style.width = `${(s.hp / s.maxHp) * 100}%`;
    $('hp-text').textContent = `${s.hp} / ${s.maxHp}`;
    $('mana-fill').style.width = `${(s.mana / s.maxMana) * 100}%`;
    $('mana-text').textContent = `${s.mana} / ${s.maxMana}`;
    const span = Math.max(1, s.xpNext - s.xpCur);
    const into = s.xp - s.xpCur;
    $('xp-fill').style.width = `${Math.min(100, (into / span) * 100)}%`;
    $('xp-text').textContent = `Niv. ${s.level} — ${into} / ${span} XP`;
    $('gold-text').textContent = s.gold;
  }

  updateSelf(msg) {
    this.self = msg;
    this.renderBars();
    this.renderInventory();
    this.renderCharacter();
  }

  renderInventory() {
    const s = this.self;
    const eq = $('equip-slots');
    eq.innerHTML = '';
    for (const slot of SLOTS) {
      const div = document.createElement('div');
      div.className = 'equip-slot';
      const iid = s.equip[slot];
      const item = iid && s.inventory.find(i => i.iid === iid);
      if (item) {
        div.classList.add('filled');
        div.innerHTML = `<span style="font-size:17px">${SLOT_ICONS[slot]}</span>`;
        div.title = item.label;
        div.oncontextmenu = (e) => { e.preventDefault(); this.net.send({ t: 'unequip', slot }); };
        this.bindTooltip(div, () => this.itemTooltip(item));
      } else {
        div.textContent = SLOT_NAMES[slot];
      }
      eq.appendChild(div);
    }
    const grid = $('inv-grid');
    grid.innerHTML = '';
    const equippedIids = new Set(Object.values(s.equip));
    for (const item of s.inventory) {
      const div = document.createElement('div');
      div.className = 'inv-item' + (item.q ? ` q${item.q}` : '') + (equippedIids.has(item.iid) ? ' equipped' : '');
      div.textContent = SLOT_ICONS[item.slot] || '❓';
      div.onclick = () => {
        if (item.slot === 'use') this.net.send({ t: 'use', iid: item.iid });
        else if (equippedIids.has(item.iid)) this.net.send({ t: 'unequip', slot: item.slot });
        else this.net.send({ t: 'equip', iid: item.iid });
      };
      this.bindTooltip(div, () => this.itemTooltip(item));
      grid.appendChild(div);
    }
    for (let i = s.inventory.length; i < 24; i++) {
      const div = document.createElement('div');
      div.className = 'inv-item';
      div.style.opacity = 0.35;
      grid.appendChild(div);
    }
  }

  itemTooltip(item) {
    const def = ITEMS[item.defId];
    const q = QUALITY[item.q || 0];
    const mult = q.mult;
    let lines = [item.label];
    if (def.dmg) lines.push(`Dégâts : ${Math.round(def.dmg * mult)} (vitesse ${def.speed}s)`);
    if (def.def) lines.push(`Défense : ${Math.round(def.def * mult)}`);
    if (def.heal) lines.push(`Rend ${def.heal} PV`);
    if (def.mana) lines.push(`Rend ${def.mana} mana`);
    for (const [st, v] of Object.entries(item.bonus || {})) lines.push(`+${v} ${STAT_NAMES[st] || st}`);
    return lines.join('\n');
  }

  renderCharacter() {
    const s = this.self;
    $('char-name').textContent = `Niveau ${s.level}`;
    $('char-info').innerHTML =
      `PV : <b>${s.hp} / ${s.maxHp}</b> — Mana : <b>${s.mana} / ${s.maxMana}</b><br>` +
      `Dégâts : <b>${s.dmg}</b> — Défense : <b>${s.defense}</b><br>` +
      `Or : <b>${s.gold}</b><br>` +
      (s.statPoints > 0 ? `<span style="color:#8ae88a">Points à répartir : <b>${s.statPoints}</b></span>` : '');
    const div = $('char-stats');
    div.innerHTML = '';
    for (const st of STATS) {
      const row = document.createElement('div');
      row.className = 'stat-row';
      const eff = s.eff[st] !== s.stats[st] ? ` <span style="color:#5b9cff">(${s.eff[st]})</span>` : '';
      row.innerHTML = `<span>${STAT_NAMES[st]}</span><span>${s.stats[st]}${eff}</span>`;
      if (s.statPoints > 0) {
        const btn = document.createElement('button');
        btn.textContent = '+';
        btn.onclick = () => this.net.send({ t: 'alloc', stat: st });
        row.appendChild(btn);
      }
      div.appendChild(row);
    }
  }

  addChat(from, text) {
    const div = document.createElement('div');
    if (from === 'sys') {
      div.className = 'sys';
      div.textContent = `✦ ${text}`;
    } else {
      div.innerHTML = `<span class="from"></span> : `;
      div.querySelector('.from').textContent = from;
      div.appendChild(document.createTextNode(text));
    }
    const box = $('chat-messages');
    box.appendChild(div);
    while (box.children.length > 60) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  floater(screen, text, cls = '') {
    if (!screen.visible) return;
    const div = document.createElement('div');
    div.className = `floater ${cls}`;
    div.textContent = text;
    div.style.left = `${screen.x + (Math.random() - 0.5) * 30}px`;
    div.style.top = `${screen.y - 30}px`;
    $('floaters').appendChild(div);
    setTimeout(() => div.remove(), 1100);
  }

  showDeath(by) {
    $('death-by').textContent = by ? `Tué par ${by}` : '';
    $('death-screen').classList.remove('hidden');
  }
  hideDeath() { $('death-screen').classList.add('hidden'); }

  // Tooltip générique
  bindTooltip(el, fn) {
    el.addEventListener('mouseenter', () => this.showTooltip(fn()));
    el.addEventListener('mousemove', (e) => this.moveTooltip(e.clientX, e.clientY));
    el.addEventListener('mouseleave', () => this.hideTooltip());
  }
  showTooltip(text) {
    const t = $('tooltip');
    t.textContent = text;
    t.classList.remove('hidden');
  }
  moveTooltip(x, y) {
    const t = $('tooltip');
    t.style.left = `${Math.min(x + 14, window.innerWidth - 220)}px`;
    t.style.top = `${y + 14}px`;
  }
  hideTooltip() { $('tooltip').classList.add('hidden'); }

  setTarget(name, hpPct) {
    if (!name) { $('target-frame').classList.add('hidden'); return; }
    $('target-frame').classList.remove('hidden');
    $('target-name').textContent = name;
    $('target-hp').style.width = `${hpPct}%`;
  }
}
