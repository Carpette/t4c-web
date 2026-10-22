import { ITEMS, QUALITY } from '../../shared/defs.js';
import { STAT_NAMES } from '../../shared/constants.js';

export class Item {
  constructor(data) {
    this.iid = data.iid;
    this.defId = data.defId;
    this.q = data.q || 0;
    this.bonus = data.bonus || {};
    this.label = data.label || '';

    const def = ITEMS[this.defId] || {};
    this.name = def.name || 'Objet inconnu';
    this.slot = def.slot;
    this.price = def.price || 0;
    this.weight = def.weight || 0;
    this.req = def.req || null;
    this.dmgMin = def.dmgMin;
    this.dmgMax = def.dmgMax;
    this.dmg = def.dmg;
    this.speed = def.speed;
    this.def = def.def;
    this.heal = def.heal;
    this.mana = def.mana;
  }

  get qualityMultiplier() {
    const qualityDef = QUALITY[this.q];
    return qualityDef ? qualityDef.mult : 1.0;
  }

  get computedDmgText() {
    const mult = this.qualityMultiplier;
    if (this.dmgMin != null) {
      return `Dégâts : ${Math.round(this.dmgMin * mult)}-${Math.round(this.dmgMax * mult)} (vitesse ${this.speed}s)`;
    } else if (this.dmg) {
      return `Dégâts : ${Math.round(this.dmg * mult)} (vitesse ${this.speed}s)`;
    }
    return null;
  }

  get computedDefText() {
    if (this.def) {
      return `Défense : ${Math.round(this.def * this.qualityMultiplier)}`;
    }
    return null;
  }

  // dégâts moyens par coup (comparaison d'armes), défense (armures)
  get degatsMoyens() {
    const m = this.qualityMultiplier;
    if (this.dmgMin != null) return (this.dmgMin + this.dmgMax) / 2 * m;
    return this.dmg ? this.dmg * m : null;
  }
  get defense() { return this.def ? Math.round(this.def * this.qualityMultiplier) : null; }

  // Infobulle riche : nom à la couleur de la qualité, prérequis non remplis
  // en rouge (`stats` : caractéristiques effectives du joueur), et écart avec
  // l'objet porté au même emplacement (`porte`, un Item, ou null).
  getTooltipHtml({ stats = null, porte = null } = {}) {
    const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const out = [`<b class="tip-nom" style="color:${QUALITY[this.q]?.color || '#c8c8c8'}">${esc(this.label || this.name)}</b>`];
    const ecart = (v, unite) => {
      if (!v) return '<span class="tip-egal">(identique)</span>';
      const r = Math.round(v * 10) / 10;
      return `<span class="${v > 0 ? 'tip-mieux' : 'tip-moins'}">(${v > 0 ? '+' : ''}${String(r).replace('.', ',')} ${unite})</span>`;
    };
    const compare = porte && porte.iid !== this.iid;
    // armes : dégâts par seconde (les vitesses diffèrent) ; un emplacement
    // occupé par un objet sans dégâts ou sans défense compte pour 0
    const dps = (it) => (it.degatsMoyens && it.speed ? it.degatsMoyens / it.speed : 0);
    const dmgText = this.computedDmgText;
    if (dmgText) out.push(esc(dmgText) + (compare ? ' ' + ecart(dps(this) - dps(porte), 'dégâts/s') : ''));
    if (this.defense != null) {
      out.push(esc(this.computedDefText) + (compare ? ' ' + ecart(this.defense - (porte.defense || 0), 'déf.') : ''));
    }
    if (this.heal) out.push(`Rend ${this.heal} PV`);
    if (this.mana) out.push(`Rend ${this.mana} mana`);
    for (const [stat, val] of Object.entries(this.bonus)) out.push(`<span class="tip-bonus">+${val} ${esc(STAT_NAMES[stat] || stat)}</span>`);
    if (this.weight) out.push(`<span class="tip-discret">Poids : ${this.weight}</span>`);
    if (this.req && Object.keys(this.req).length) {
      const names = { str: 'For', end: 'End', agi: 'Agi', int: 'Int', wis: 'Sag' };
      const reqs = Object.entries(this.req).map(([st, v]) => {
        const manque = stats && (stats[st] || 0) < v;
        return manque ? `<span class="tip-moins">${names[st] || st} ${v} (vous : ${stats[st] || 0})</span>` : `${names[st] || st} ${v}`;
      });
      out.push(`Requis : ${reqs.join(', ')}`);
    }
    if (compare) out.push(`<span class="tip-discret">Porté : ${esc(porte.label || porte.name)}</span>`);
    return out.join('<br>');
  }

  getTooltip() {
    let lines = [this.label || this.name];
    const dmgText = this.computedDmgText;
    if (dmgText) lines.push(dmgText);
    const defText = this.computedDefText;
    if (defText) lines.push(defText);
    if (this.heal) lines.push(`Rend ${this.heal} PV`);
    if (this.mana) lines.push(`Rend ${this.mana} mana`);
    if (this.weight) lines.push(`Poids : ${this.weight}`);
    if (this.req) {
      const names = { str: 'For', agi: 'Agi', int: 'Int', wis: 'Sag' };
      const reqText = Object.entries(this.req).map(([stat, val]) => `${names[stat] || stat} ${val}`).join(', ');
      lines.push(`Requis : ${reqText}`);
    }
    for (const [stat, val] of Object.entries(this.bonus)) {
      lines.push(`+${val} ${STAT_NAMES[stat] || stat}`);
    }
    return lines.join('\n');
  }
}