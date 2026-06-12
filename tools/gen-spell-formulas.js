// Génère les expressions FormulaEngine de content/spells.json à partir des
// champs numériques EXISTANTS (dmg/heal et cast/castMin/castStep) : ce sont
// nos formules (Bible + référence française validée) qui font foi, converties
// telles quelles — pas les valeurs de la branche d'origine.
//
//   cooldown : récupération en ms, ex. "max(1000, 1520 - max(0, self.level - 2) * 20)"
//   effects  : [{ kind: 'damage'|'heal', target, formula }],
//              ex. "1d17 + 6 + self.buff_stats.int / 23"
//
// Les champs numériques sont CONSERVÉS : affichage client + repli si une
// expression est invalide (rétrocompatibilité). Relançable à volonté
// (idempotent). Usage : node tools/gen-spell-formulas.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FormulaEngine } from '../shared/formula-engine.js';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'content', 'spells.json');
const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const engine = new FormulaEngine(); // valide chaque expression générée

// 1dN + base + Int/k + Sag/k (rollSpellOutput) -> expression équivalente
function fieldToFormula(f) {
  const parts = [];
  if (f.dice) parts.push(`1d${f.dice}`);
  if (f.base) parts.push(String(f.base));
  if (f.int) parts.push(`self.buff_stats.int / ${f.int}`);
  if (f.wis) parts.push(`self.buff_stats.wis / ${f.wis}`);
  return parts.join(' + ') || '0';
}

let nCd = 0, nFx = 0;
for (const sp of data.spells) {
  // récupération (castTimeMs) : mêmes valeurs par défaut que le code
  const slow = Math.round((sp.cast ?? 1.5) * 1000);
  const fast = Math.round((sp.castMin ?? 1) * 1000);
  const step = Math.round((sp.castStep ?? 0.02) * 1000);
  sp.cooldown = `max(${fast}, ${slow} - max(0, self.level - ${sp.level || 1}) * ${step})`;
  engine.compile(sp.cooldown);
  nCd++;

  const effects = [];
  if (sp.dmg) effects.push({ kind: 'damage', target: 'target', formula: fieldToFormula(sp.dmg) });
  if (sp.heal) effects.push({ kind: 'heal', target: 'self', formula: fieldToFormula(sp.heal) });
  for (const ef of effects) engine.compile(ef.formula);
  if (effects.length) { sp.effects = effects; nFx += effects.length; }
  else delete sp.effects;
}

fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n');
console.log(`${nCd} expressions de récupération et ${nFx} effets générés dans content/spells.json`);
