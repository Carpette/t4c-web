import { FormulaEngine } from "../shared/formula-engine.js";

const engine = new FormulaEngine();

const self = {
  level: 50,

  hp: 800,

  stats: {
    strength: 120,
    endurance: 90,
    wisdom: 45,
    agility: 75
  },

  skills: {
    sword: 80,
    archery: 20
  },

  magic: {
    firePower: 60
  }
};

const target = {
  hp: 1000,

  defense: 40,

  resists: {
    physical: 15,
    fire: 30
  }
};

const formula = "self.stats.strength * 2 + self.skills.sword + 2d6 - target.defense";
const damage = Math.floor( engine.evaluate(formula, { self, target }));

console.log(`Damage : ${damage}`);