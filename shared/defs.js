// Définitions d'objets et de monstres — partagées serveur/client
// Sprites : projet Flare (CC-BY-SA 3.0), voir client/assets/CREDITS.txt

export const SLOTS = ['weapon', 'shield', 'armor', 'helmet', 'boots', 'ring', 'amulet'];
export const SLOT_NAMES = {
  weapon: 'Arme', shield: 'Bouclier', armor: 'Armure', helmet: 'Casque',
  boots: 'Bottes', ring: 'Anneau', amulet: 'Amulette',
};

// Qualités (roll à la génération)
export const QUALITY = [
  { name: '', color: '#c8c8c8', bonusCount: 0, mult: 1 },
  { name: 'magique', color: '#5b9cff', bonusCount: 1, mult: 1.12 },
  { name: 'rare', color: '#ffd24a', bonusCount: 2, mult: 1.28 },
];

// layer = couche avatar (visuel porté) ; loot = sprite au sol ; zone = dispo chez le marchand à partir de cette zone
export const ITEMS = {
  // ---- Armes (dmg, speed en s) ----
  dague:        { name: 'Dague rouillée',      slot: 'weapon', zone: 0, dmg: 3,  speed: 1.1, layer: 'dagger',     loot: 'dagger',     price: 8 },
  epee_courte:  { name: 'Épée courte',          slot: 'weapon', zone: 0, dmg: 6,  speed: 1.5, layer: 'shortsword', loot: 'shortsword', price: 35 },
  baton:        { name: 'Bâton de novice',      slot: 'weapon', zone: 0, dmg: 5,  speed: 1.7, int: 3, layer: 'staff',      loot: 'clothes',    price: 45 },
  hache:        { name: 'Hache de bûcheron',    slot: 'weapon', zone: 1, dmg: 9,  speed: 2.0, layer: 'hand_axe',   loot: 'hand_axe',   price: 50 },
  masse:        { name: 'Masse cloutée',        slot: 'weapon', zone: 2, dmg: 12, speed: 2.1, layer: 'mace',       loot: 'mace',       price: 110 },
  epee_large:   { name: 'Épée large',           slot: 'weapon', zone: 2, dmg: 14, speed: 1.9, layer: 'longsword',  loot: 'longsword',  price: 160 },
  lame_runique: { name: 'Lame runique',         slot: 'weapon', zone: 3, dmg: 19, speed: 1.7, layer: 'greatsword', loot: 'greatsword', price: 420 },
  baton_arcane: { name: 'Bâton des arcanes',    slot: 'weapon', zone: 3, dmg: 14, speed: 1.8, int: 8, wis: 5, layer: 'greatstaff', loot: 'clothes', price: 520 },

  // ---- Boucliers / armures (def) ----
  bouclier_bois:{ name: 'Bouclier en bois',     slot: 'shield', zone: 0, def: 3,  layer: 'buckler',     loot: 'buckler', price: 12 },
  bouclier_fer: { name: 'Bouclier en fer',      slot: 'shield', zone: 2, def: 8,  layer: 'kite_shield', loot: 'shield',  price: 130 },
  tunique:      { name: 'Tunique de toile',     slot: 'armor',  zone: 0, def: 2,  layer: 'cloth_shirt',   loot: 'clothes',       price: 10 },
  robe_mage:    { name: 'Robe de mage',         slot: 'armor',  zone: 1, def: 4,  int: 5, layer: 'mage_vest',  loot: 'clothes',  price: 90 },
  cuir:         { name: 'Armure de cuir',       slot: 'armor',  zone: 1, def: 6,  layer: 'leather_chest', loot: 'leather_armor', price: 60 },
  mailles:      { name: 'Cotte de mailles',     slot: 'armor',  zone: 2, def: 11, layer: 'chain_cuirass', loot: 'steel_armor',   price: 190 },
  plates:       { name: 'Armure de plates',     slot: 'armor',  zone: 3, def: 17, layer: 'plate_cuirass', loot: 'steel_armor',   price: 480 },
  capuche:      { name: 'Capuche de cuir',      slot: 'helmet', zone: 1, def: 3,  layer: 'leather_hood',  loot: 'clothes',       price: 40 },
  capuche_mage: { name: 'Capuche de mage',      slot: 'helmet', zone: 1, def: 2,  wis: 4, layer: 'mage_hood', loot: 'clothes',   price: 75 },
  casque_fer:   { name: 'Casque de fer',        slot: 'helmet', zone: 2, def: 6,  layer: 'plate_helm',    loot: 'steel_armor',   price: 150 },
  bottes_cuir:  { name: 'Bottes de cuir',       slot: 'boots',  zone: 0, def: 2,  layer: 'leather_boots', loot: 'boots', price: 25 },
  bottes_mage:  { name: 'Bottes de mage',       slot: 'boots',  zone: 1, def: 2,  wis: 3, layer: 'mage_boots', loot: 'boots', price: 80 },
  bottes_mailles:{ name: 'Bottes de mailles',   slot: 'boots',  zone: 2, def: 5,  layer: 'chain_boots',   loot: 'boots', price: 140 },
  bottes_plates:{ name: 'Bottes de plates',     slot: 'boots',  zone: 3, def: 8,  layer: 'plate_boots',   loot: 'boots', price: 320 },
  anneau_os:    { name: 'Anneau en os',         slot: 'ring',   zone: 1, def: 0,  loot: 'ring', price: 70 },
  anneau_saphir:{ name: 'Anneau de saphir',     slot: 'ring',   zone: 3, def: 1,  loot: 'ring', price: 350 },
  amulette_loup:{ name: 'Amulette du loup',     slot: 'amulet', zone: 1, str: 3, agi: 2, loot: 'ring', price: 120 },
  amulette_sage:{ name: 'Amulette du sage',     slot: 'amulet', zone: 3, int: 5, wis: 5, loot: 'ring', price: 400 },

  // ---- Consommables ----
  potion_vie:   { name: 'Potion de vie',        slot: 'use', zone: 0, heal: 60,  loot: 'hp_potion', price: 15 },
  potion_mana:  { name: 'Potion de mana',       slot: 'use', zone: 0, mana: 50,  loot: 'mp_potion', price: 15 },

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
