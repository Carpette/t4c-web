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