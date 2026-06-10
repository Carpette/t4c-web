// Définitions d'objets et de monstres — partagées serveur/client
// Sprites : projet Flare (CC-BY-SA 3.0), voir client/assets/CREDITS.txt

export const SLOTS = ['weapon', 'shield', 'armor', 'helmet', 'ring'];
export const SLOT_NAMES = {
  weapon: 'Arme', shield: 'Bouclier', armor: 'Armure', helmet: 'Casque', ring: 'Anneau',
};

// Qualités (roll à la génération)
export const QUALITY = [
  { name: '', color: '#c8c8c8', bonusCount: 0, mult: 1 },
  { name: 'magique', color: '#5b9cff', bonusCount: 1, mult: 1.12 },
  { name: 'rare', color: '#ffd24a', bonusCount: 2, mult: 1.28 },
];

// layer = couche avatar (visuel porté) ; loot = sprite au sol
export const ITEMS = {
  // ---- Armes (dmg, speed en s) ----
  dague:        { name: 'Dague rouillée',      slot: 'weapon', tier: 0, dmg: 3,  speed: 1.1, layer: 'dagger',     loot: 'dagger',     price: 8 },
  epee_courte:  { name: 'Épée courte',          slot: 'weapon', tier: 1, dmg: 6,  speed: 1.5, layer: 'shortsword', loot: 'shortsword', price: 35 },
  hache:        { name: 'Hache de bûcheron',    slot: 'weapon', tier: 1, dmg: 9,  speed: 2.0, layer: 'hand_axe',   loot: 'hand_axe',   price: 50 },
  masse:        { name: 'Masse cloutée',        slot: 'weapon', tier: 2, dmg: 12, speed: 2.1, layer: 'mace',       loot: 'mace',       price: 110 },
  epee_large:   { name: 'Épée large',           slot: 'weapon', tier: 2, dmg: 14, speed: 1.9, layer: 'longsword',  loot: 'longsword',  price: 160 },
  lame_runique: { name: 'Lame runique',         slot: 'weapon', tier: 3, dmg: 19, speed: 1.7, layer: 'greatsword', loot: 'greatsword', price: 420 },

  // ---- Boucliers / armures (def) ----
  bouclier_bois:{ name: 'Bouclier en bois',     slot: 'shield', tier: 0, def: 3,  layer: 'buckler',     loot: 'buckler', price: 12 },
  bouclier_fer: { name: 'Bouclier en fer',      slot: 'shield', tier: 2, def: 8,  layer: 'kite_shield', loot: 'shield',  price: 130 },
  tunique:      { name: 'Tunique de toile',     slot: 'armor',  tier: 0, def: 2,  layer: 'cloth_shirt',   loot: 'clothes',       price: 10 },
  cuir:         { name: 'Armure de cuir',       slot: 'armor',  tier: 1, def: 6,  layer: 'leather_chest', loot: 'leather_armor', price: 60 },
  mailles:      { name: 'Cotte de mailles',     slot: 'armor',  tier: 2, def: 11, layer: 'chain_cuirass', loot: 'steel_armor',   price: 190 },
  plates:       { name: 'Armure de plates',     slot: 'armor',  tier: 3, def: 17, layer: 'plate_cuirass', loot: 'steel_armor',   price: 480 },
  capuche:      { name: 'Capuche de cuir',      slot: 'helmet', tier: 1, def: 3,  layer: 'leather_hood',  loot: 'clothes',       price: 40 },
  casque_fer:   { name: 'Casque de fer',        slot: 'helmet', tier: 2, def: 6,  layer: 'plate_helm',    loot: 'steel_armor',   price: 150 },
  anneau_os:    { name: 'Anneau en os',         slot: 'ring',   tier: 1, def: 0,  loot: 'ring', price: 70 },
  anneau_saphir:{ name: 'Anneau de saphir',     slot: 'ring',   tier: 3, def: 1,  loot: 'ring', price: 350 },

  // ---- Consommables ----
  potion_vie:   { name: 'Potion de vie',        slot: 'use', heal: 60,  loot: 'hp_potion', price: 15 },
  potion_mana:  { name: 'Potion de mana',       slot: 'use', mana: 50,  loot: 'mp_potion', price: 15 },

  // ---- Divers ----
  or:           { name: "Pièces d'or",          slot: 'gold', loot: 'coins25', price: 1 },
};

// sprite = clé du manifest d'animations Flare
export const MOBS = {
  rat: {
    name: 'Fourmilion', level: 1, hp: 28, dmg: 4, def: 0, speed: 3.4,
    aggro: 6, leash: 16, atkRange: 1.3, atkSpeed: 1.4,
    sprite: 'antlion_small', respawn: 12,
    drops: [['or', 0.8, 1, 4], ['potion_vie', 0.10, 1, 1], ['dague', 0.06, 1, 1]],
  },
  serpent: {
    name: 'Fourmi de feu', level: 3, hp: 55, dmg: 8, def: 2, speed: 3.8,
    aggro: 7, leash: 18, atkRange: 1.4, atkSpeed: 1.2,
    sprite: 'fire_ant', respawn: 16,
    drops: [['or', 0.85, 2, 8], ['potion_vie', 0.12, 1, 1], ['tunique', 0.08, 1, 1], ['epee_courte', 0.05, 1, 1]],
  },
  gobelin: {
    name: 'Gobelin', level: 5, hp: 90, dmg: 12, def: 4, speed: 4.2,
    aggro: 9, leash: 22, atkRange: 1.5, atkSpeed: 1.5,
    sprite: 'goblin', respawn: 20,
    drops: [['or', 0.9, 4, 14], ['potion_vie', 0.15, 1, 2], ['cuir', 0.08, 1, 1], ['hache', 0.06, 1, 1], ['capuche', 0.06, 1, 1], ['bouclier_bois', 0.07, 1, 1]],
  },
  squelette: {
    name: 'Squelette', level: 8, hp: 150, dmg: 17, def: 7, speed: 3.6,
    aggro: 10, leash: 24, atkRange: 1.5, atkSpeed: 1.7,
    sprite: 'skeleton', respawn: 26,
    drops: [['or', 0.9, 8, 22], ['potion_vie', 0.15, 1, 2], ['mailles', 0.06, 1, 1], ['epee_large', 0.05, 1, 1], ['anneau_os', 0.07, 1, 1], ['casque_fer', 0.05, 1, 1]],
  },
  zombie: {
    name: 'Zombie', level: 10, hp: 200, dmg: 20, def: 8, speed: 2.8,
    aggro: 9, leash: 22, atkRange: 1.5, atkSpeed: 2.0,
    sprite: 'zombie', respawn: 30,
    drops: [['or', 0.9, 10, 28], ['potion_vie', 0.18, 1, 2], ['mailles', 0.07, 1, 1], ['casque_fer', 0.06, 1, 1], ['anneau_os', 0.08, 1, 1]],
  },
  orc: {
    name: 'Hobgobelin', level: 12, hp: 260, dmg: 24, def: 11, speed: 4.0,
    aggro: 10, leash: 26, atkRange: 1.6, atkSpeed: 1.8,
    sprite: 'hobgoblin', respawn: 35,
    drops: [['or', 0.95, 15, 40], ['potion_vie', 0.2, 1, 2], ['masse', 0.07, 1, 1], ['bouclier_fer', 0.06, 1, 1], ['plates', 0.03, 1, 1]],
  },
  ogre: {
    name: 'Minotaure', level: 18, hp: 600, dmg: 40, def: 16, speed: 3.2,
    aggro: 11, leash: 30, atkRange: 2.0, atkSpeed: 2.4,
    sprite: 'minotaur', respawn: 90,
    drops: [['or', 1.0, 40, 110], ['potion_vie', 0.4, 2, 3], ['lame_runique', 0.10, 1, 1], ['plates', 0.08, 1, 1], ['anneau_saphir', 0.10, 1, 1]],
  },
};

// Bonus possibles sur objets magiques/rares
export const AFFIXES = [
  ['str', 1, 4, 'de force'],
  ['end', 1, 4, "d'endurance"],
  ['agi', 1, 4, "d'agilité"],
  ['int', 1, 4, "d'intelligence"],
  ['wis', 1, 4, 'de sagesse'],
];
