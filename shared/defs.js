// Définitions d'objets et de monstres — partagées serveur/client
// Armes : tables authentiques T4C (l4p.fr / wiki Fandom), prix divisés par 5.
// req = stats requises pour équiper (For/Int/Sag, comme dans T4C)
// weight = poids (capacité de port : 500×For/(For+100))
// zone = vendu chez Aldric à partir de cette zone ; drop = monstre ; chest = butin de coffre
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

export const ITEMS = {
  // ================= ARMES T4C — Lighthaven (zone 0) =================
  poignard_rouille:    { name: 'Poignard rouillé',        slot: 'weapon', zone: 0, fixed: true, dmgMin: 1,  dmgMax: 4,  speed: 1.1, weight: 1, req: {},                          layer: 'dagger',     loot: 'dagger',     price: 6 },
  gourdin:             { name: 'Gourdin',                 slot: 'weapon', zone: 0, fixed: true, dmgMin: 2,  dmgMax: 4,  speed: 1.6, weight: 3, req: {},                          layer: 'club',       loot: 'club',       price: 6 },
  sceptre_bois:        { name: 'Sceptre de bois',         slot: 'weapon', zone: 0, fixed: true, dmgMin: 2,  dmgMax: 4,  speed: 1.7, weight: 2, req: {},                          layer: 'staff',      loot: 'staff',      price: 6 },
  epee_courte_rouillee:{ name: 'Épée courte rouillée',    slot: 'weapon', zone: 0, fixed: true, dmgMin: 2,  dmgMax: 4,  speed: 1.4, weight: 3, req: {},                          layer: 'shortsword', loot: 'shortsword', price: 6 },
  sceptre_fer:         { name: 'Sceptre de fer',          slot: 'weapon', zone: 0, fixed: true, dmgMin: 5,  dmgMax: 9,  speed: 1.7, weight: 4, req: { str: 12, int: 21 },        layer: 'staff',      loot: 'staff',      price: 78 },
  baton_combat:        { name: 'Bâton de combat',         slot: 'weapon', zone: 0, fixed: true, dmgMin: 8,  dmgMax: 13, speed: 1.7, weight: 4, req: { str: 13, int: 30 },        layer: 'staff',      loot: 'staff',      price: 234 },
  sceptre_epine:       { name: "Sceptre d'épine",         slot: 'weapon', zone: 0, fixed: true, dmgMin: 11, dmgMax: 18, speed: 1.7, weight: 4, req: { str: 14, int: 39 },        layer: 'staff',      loot: 'staff',      price: 472 },
  bo:                  { name: 'Bô',                      slot: 'weapon', zone: 0, fixed: true, dmgMin: 14, dmgMax: 22, speed: 1.6, weight: 3, req: { str: 15, int: 47 },        layer: 'greatstaff', loot: 'greatstaff', price: 793 },
  rang_kwan:           { name: 'Rang-kwan',               slot: 'weapon', zone: 0, fixed: true, dmgMin: 17, dmgMax: 27, speed: 1.7, weight: 4, req: { str: 16, int: 56 },        layer: 'greatstaff', loot: 'greatstaff', price: 1197 },
  tetsubo:             { name: 'Tetsubo',                 slot: 'weapon', zone: 0, fixed: true, dmgMin: 21, dmgMax: 33, speed: 1.9, weight: 6, req: { str: 17, int: 68 },        layer: 'maul',       loot: 'maul',       price: 1865 },
  epee_longue_rouillee:{ name: 'Épée longue rouillée',    slot: 'weapon', zone: 0, fixed: true, dmgMin: 6,  dmgMax: 11, speed: 1.6, weight: 5, req: { str: 24 },                 layer: 'longsword',  loot: 'longsword',  price: 121 },
  dague_rouillee:      { name: 'Dague rouillée',          slot: 'weapon', zone: 0, fixed: true, dmgMin: 6,  dmgMax: 10, speed: 1.1, weight: 1, req: { str: 24 },                 layer: 'dagger',     loot: 'dagger',     price: 121 },
  gourdin_renforce:    { name: 'Gourdin renforcé',        slot: 'weapon', zone: 0, fixed: true, dmgMin: 13, dmgMax: 20, speed: 1.8, weight: 5, req: { str: 30, wis: 34 },        layer: 'reinforced_club', loot: 'reinforced_club', price: 472 },
  hachette_rouillee:   { name: 'Hachette rouillée',       slot: 'weapon', zone: 0, fixed: true, dmgMin: 16, dmgMax: 25, speed: 1.9, weight: 5, req: { str: 39 },                 layer: 'hand_axe',   loot: 'hand_axe',   price: 472 },
  marteau_guerre_renforce: { name: 'Marteau de guerre renforcé', slot: 'weapon', zone: 0, fixed: true, dmgMin: 21, dmgMax: 32, speed: 2.0, weight: 8, req: { str: 40, wis: 41 }, layer: 'war_hammer', loot: 'war_hammer', price: 1053 },

  // ================= ARMES T4C — Windhowl (zone 1) =================
  poignard_poli:       { name: 'Poignard poli',           slot: 'weapon', zone: 1, fixed: true, dmgMin: 20, dmgMax: 28, speed: 1.1, weight: 1, req: { str: 53 },                 layer: 'dagger',     loot: 'dagger',     price: 1053 },
  epee_courte_polie:   { name: 'Épée courte polie',       slot: 'weapon', zone: 1, fixed: true, dmgMin: 22, dmgMax: 31, speed: 1.4, weight: 3, req: { str: 53 },                 layer: 'shortsword', loot: 'shortsword', price: 1053 },
  marteau_acier_trempe:{ name: 'Marteau de guerre en acier trempé', slot: 'weapon', zone: 1, fixed: true, dmgMin: 36, dmgMax: 52, speed: 2.0, weight: 9, req: { str: 60, wis: 56 }, layer: 'war_hammer', loot: 'war_hammer', price: 2906 },
  dague_polie:         { name: 'Dague polie',             slot: 'weapon', zone: 1, fixed: true, dmgMin: 30, dmgMax: 42, speed: 1.1, weight: 1, req: { str: 68 },                 layer: 'dagger',     loot: 'dagger',     price: 1865 },
  epee_longue_polie:   { name: 'Épée longue polie',       slot: 'weapon', zone: 1, fixed: true, dmgMin: 31, dmgMax: 43, speed: 1.6, weight: 5, req: { str: 68 },                 layer: 'longsword',  loot: 'longsword',  price: 1865 },
  hache_argent:        { name: "Hache d'argent",          slot: 'weapon', zone: 1, fixed: true, dmgMin: 37, dmgMax: 53, speed: 1.9, weight: 6, req: { str: 71 },                 layer: 'battle_axe', loot: 'battle_axe', price: 2979 },
  glaive_poli:         { name: 'Glaive poli',             slot: 'weapon', zone: 1, fixed: true, dmgMin: 40, dmgMax: 56, speed: 1.8, weight: 7, req: { str: 82 },                 layer: 'greatsword', loot: 'greatsword', price: 2906 },
  masse_acier_trempe:  { name: 'Masse en acier trempé',   slot: 'weapon', zone: 1, fixed: true, dmgMin: 59, dmgMax: 83, speed: 2.1, weight: 10, req: { str: 90, wis: 79 },       layer: 'mace',       loot: 'mace',       price: 7411 },
  dague_acier_trempe:  { name: 'Dague en acier trempé',   slot: 'weapon', zone: 1, fixed: true, dmgMin: 46, dmgMax: 63, speed: 1.1, weight: 1, req: { str: 97 },                 layer: 'dagger',     loot: 'dagger',     price: 4177 },
  hachette_polie:      { name: 'Hachette polie',          slot: 'weapon', zone: 1, fixed: true, dmgMin: 53, dmgMax: 75, speed: 1.9, weight: 5, req: { str: 97 },                 layer: 'hand_axe',   loot: 'hand_axe',   price: 4177 },
  masse_qualite:       { name: 'Masse de qualité',        slot: 'weapon', zone: 1, fixed: true, dmgMin: 74, dmgMax: 103, speed: 2.1, weight: 10, req: { str: 110, wis: 94 },     layer: 'mace',       loot: 'mace',       price: 11564 },
  epee_courte_acier:   { name: 'Épée courte en acier trempé', slot: 'weapon', zone: 1, fixed: true, dmgMin: 54, dmgMax: 73, speed: 1.4, weight: 3, req: { str: 111 },            layer: 'shortsword', loot: 'shortsword', price: 5679 },
  epee_longue_acier:   { name: 'Épée longue en acier trempé', slot: 'weapon', zone: 1, fixed: true, dmgMin: 64, dmgMax: 87, speed: 1.6, weight: 5, req: { str: 126 },            layer: 'longsword',  loot: 'longsword',  price: 7411 },
  dague_qualite:       { name: 'Dague de qualité',        slot: 'weapon', zone: 1, fixed: true, dmgMin: 62, dmgMax: 84, speed: 1.1, weight: 1, req: { str: 126 },                layer: 'dagger',     loot: 'dagger',     price: 7411 },

  // ================= ARMES T4C — en drop sur les monstres =================
  dague_du_crane:      { name: 'Dague du crâne',          slot: 'weapon', fixed: true, dmgMin: 5,  dmgMax: 11, speed: 1.1, weight: 1, req: { str: 12, wis: 15, int: 43 },        layer: 'dagger',     loot: 'dagger',     price: 415 },
  dague_perceuse:      { name: "Dague perceuse d'armure", slot: 'weapon', fixed: true, dmgMin: 12, dmgMax: 19, speed: 1.1, weight: 1, req: { str: 39, int: 19, wis: 21 },        layer: 'dagger',     loot: 'dagger',     price: 949 },
  fleau_stabilite:     { name: 'Fléau de stabilité',      slot: 'weapon', fixed: true, dmgMin: 28, dmgMax: 29, speed: 2.0, weight: 8, req: { str: 40, wis: 41 },                 layer: 'mace',       loot: 'mace',       price: 1755 },
  lame_de_gobelin:     { name: 'Lame de gobelin',         slot: 'weapon', fixed: true, dmgMin: 22, dmgMax: 31, speed: 1.5, weight: 4, req: { str: 53 },                          layer: 'longsword',  loot: 'longsword',  price: 1755 },
  epee_de_fureur:      { name: 'Épée de fureur',          slot: 'weapon', fixed: true, dmgMin: 25, dmgMax: 36, speed: 1.5, weight: 4, req: { str: 59, int: 21, wis: 24 },        layer: 'shortsword', loot: 'shortsword', price: 2521 },
  pourfendeur_gobelins:{ name: 'Pourfendeur de gobelins', slot: 'weapon', fixed: true, dmgMin: 32, dmgMax: 60, speed: 1.6, weight: 5, req: { str: 97, int: 20, wis: 23 },        layer: 'greatsword', loot: 'greatsword', price: 6962 },
  sceptre_drachen:     { name: 'Sceptre de pouvoir du Drachen', slot: 'weapon', fixed: true, dmgMin: 14, dmgMax: 22, speed: 1.7, weight: 3, req: { str: 10, int: 135 },          layer: 'greatstaff', loot: 'greatstaff', price: 5741 },

  // ================= ARMES T4C — butin de coffres =================
  baton_marche_tordu:  { name: 'Bâton de marche tordu',   slot: 'weapon', chest: 0, fixed: true, dmgMin: 21, dmgMax: 33, speed: 1.7, weight: 3, req: { str: 17, int: 68 },       layer: 'staff',      loot: 'staff',      price: 3107 },
  scalpel_chirurgien:  { name: 'Scalpel du chirurgien',   slot: 'weapon', chest: 0, fixed: true, dmgMin: 18, dmgMax: 27, speed: 1.1, weight: 1, req: { str: 30, int: 30, wis: 50 }, layer: 'dagger',  loot: 'dagger',     price: 3217 },
  baton_langueur:      { name: 'Bâton de langueur',       slot: 'weapon', chest: 0, fixed: true, dmgMin: 35, dmgMax: 55, speed: 1.7, weight: 3, req: { str: 20, int: 83, wis: 35 }, layer: 'greatstaff', loot: 'greatstaff', price: 5741 },
  epee_du_chaos:       { name: 'Épée du chaos',           slot: 'weapon', chest: 1, fixed: true, dmgMin: 7,  dmgMax: 48, speed: 1.4, weight: 3, req: { str: 53 },                layer: 'shortsword', loot: 'shortsword', price: 1755 },
  casse_tete:          { name: 'Casse-tête',              slot: 'weapon', chest: 1, fixed: true, dmgMin: 42, dmgMax: 61, speed: 2.0, weight: 9, req: { str: 60, wis: 56 },       layer: 'maul',       loot: 'maul',       price: 4843 },
  marteau_revelation:  { name: 'Marteau de révélation',   slot: 'weapon', chest: 1, fixed: true, dmgMin: 36, dmgMax: 52, speed: 2.0, weight: 8, req: { str: 61, wis: 53 },       layer: 'war_hammer', loot: 'war_hammer', price: 4843 },
  epee_de_la_nuit:     { name: 'Épée de la nuit',         slot: 'weapon', chest: 1, fixed: true, dmgMin: 30, dmgMax: 42, speed: 1.5, weight: 4, req: { str: 65, int: 30, wis: 25 }, layer: 'longsword', loot: 'longsword', price: 3370 },
  defenderesse:        { name: 'Défenderesse',            slot: 'weapon', chest: 1, fixed: true, dmgMin: 40, dmgMax: 58, speed: 1.6, weight: 5, req: { str: 68, int: 25, wis: 30 }, layer: 'longsword', loot: 'longsword', price: 5189 },
  buveuse_de_sang:     { name: 'Buveuse de sang',         slot: 'weapon', chest: 1, fixed: true, dmgMin: 30, dmgMax: 42, speed: 1.1, weight: 1, req: { str: 68 },                layer: 'dagger',     loot: 'dagger',     price: 3107 },
  gourdin_du_troll:    { name: 'Gourdin du troll',        slot: 'weapon', chest: 1, fixed: true, dmgMin: 36, dmgMax: 50, speed: 1.9, weight: 9, req: { str: 79 },                layer: 'club',       loot: 'club',       price: 4465 },
  epee_large_ensanglantee: { name: 'Épée large ensanglantée', slot: 'weapon', chest: 1, fixed: true, dmgMin: 41, dmgMax: 57, speed: 1.7, weight: 6, req: { str: 82 },            layer: 'greatsword', loot: 'greatsword', price: 5982 },
  lame_acuite:         { name: "Lame d'acuité",           slot: 'weapon', chest: 1, fixed: true, dmgMin: 41, dmgMax: 57, speed: 1.6, weight: 5, req: { str: 82, int: 20, wis: 23 }, layer: 'longsword', loot: 'longsword', price: 5057 },
  lame_assassine:      { name: 'Lame assassine',          slot: 'weapon', chest: 1, fixed: true, dmgMin: 69, dmgMax: 96, speed: 1.1, weight: 1, req: { str: 110, agi: 65, int: 15 }, layer: 'dagger',  loot: 'dagger',     price: 19873 },
  lame_prismatique:    { name: 'Lame prismatique',        slot: 'weapon', chest: 1, fixed: true, dmgMin: 63, dmgMax: 85, speed: 1.6, weight: 5, req: { str: 126 },               layer: 'longsword',  loot: 'longsword',  price: 12351 },

  // ===== Armes héritées (anciens personnages — plus en boutique) =====
  dague:        { name: 'Vieille dague',          slot: 'weapon', legacy: true, dmg: 3,  speed: 1.1, weight: 1, layer: 'dagger',     loot: 'dagger',     price: 8 },
  epee_courte:  { name: 'Épée courte usée',       slot: 'weapon', legacy: true, dmg: 6,  speed: 1.5, weight: 3, layer: 'shortsword', loot: 'shortsword', price: 35 },
  baton:        { name: 'Bâton de novice',        slot: 'weapon', legacy: true, dmg: 5,  speed: 1.7, weight: 2, int: 3, layer: 'staff', loot: 'staff',   price: 45 },
  hache:        { name: 'Hache de bûcheron',      slot: 'weapon', legacy: true, dmg: 9,  speed: 2.0, weight: 5, layer: 'hand_axe',   loot: 'hand_axe',   price: 50 },
  masse:        { name: 'Masse cloutée',          slot: 'weapon', legacy: true, dmg: 12, speed: 2.1, weight: 8, layer: 'mace',       loot: 'mace',       price: 110 },
  epee_large:   { name: 'Épée large',             slot: 'weapon', legacy: true, dmg: 14, speed: 1.9, weight: 6, layer: 'longsword',  loot: 'longsword',  price: 160 },
  lame_runique: { name: 'Lame runique',           slot: 'weapon', legacy: true, dmg: 19, speed: 1.7, weight: 6, layer: 'greatsword', loot: 'greatsword', price: 420 },
  baton_arcane: { name: 'Bâton des arcanes',      slot: 'weapon', legacy: true, dmg: 14, speed: 1.8, weight: 4, int: 8, wis: 5, layer: 'greatstaff', loot: 'greatstaff', price: 520 },

  // ================= Boucliers / armures =================
  bouclier_bois:{ name: 'Bouclier en bois',     slot: 'shield', zone: 0, def: 3,  weight: 4,  layer: 'buckler',     loot: 'buckler', price: 12 },
  bouclier_fer: { name: 'Bouclier en fer',      slot: 'shield', zone: 2, def: 8,  weight: 9,  layer: 'kite_shield', loot: 'shield',  price: 130 },
  tunique:      { name: 'Tunique de toile',     slot: 'armor',  zone: 0, def: 2,  weight: 3,  layer: 'cloth_shirt',   loot: 'clothes',       price: 10 },
  robe_mage:    { name: 'Robe de mage',         slot: 'armor',  zone: 1, def: 4,  weight: 3,  int: 5, layer: 'mage_vest',  loot: 'clothes',  price: 90 },
  cuir:         { name: 'Armure de cuir',       slot: 'armor',  zone: 1, def: 6,  weight: 8,  layer: 'leather_chest', loot: 'leather_armor', price: 60 },
  mailles:      { name: 'Cotte de mailles',     slot: 'armor',  zone: 2, def: 11, weight: 18, layer: 'chain_cuirass', loot: 'steel_armor',   price: 190 },
  plates:       { name: 'Armure de plates',     slot: 'armor',  zone: 3, def: 17, weight: 35, layer: 'plate_cuirass', loot: 'steel_armor',   price: 480 },
  capuche:      { name: 'Capuche de cuir',      slot: 'helmet', zone: 1, def: 3,  weight: 1,  layer: 'leather_hood',  loot: 'clothes',       price: 40 },
  capuche_mage: { name: 'Capuche de mage',      slot: 'helmet', zone: 1, def: 2,  weight: 1,  wis: 4, layer: 'mage_hood', loot: 'clothes',   price: 75 },
  casque_fer:   { name: 'Casque de fer',        slot: 'helmet', zone: 2, def: 6,  weight: 4,  layer: 'plate_helm',    loot: 'steel_armor',   price: 150 },
  bottes_cuir:  { name: 'Bottes de cuir',       slot: 'boots',  zone: 0, def: 2,  weight: 2,  layer: 'leather_boots', loot: 'boots', price: 25 },
  bottes_mage:  { name: 'Bottes de mage',       slot: 'boots',  zone: 1, def: 2,  weight: 2,  wis: 3, layer: 'mage_boots', loot: 'boots', price: 80 },
  bottes_mailles:{ name: 'Bottes de mailles',   slot: 'boots',  zone: 2, def: 5,  weight: 4,  layer: 'chain_boots',   loot: 'boots', price: 140 },
  bottes_plates:{ name: 'Bottes de plates',     slot: 'boots',  zone: 3, def: 8,  weight: 5,  layer: 'plate_boots',   loot: 'boots', price: 320 },
  anneau_os:    { name: 'Anneau en os',         slot: 'ring',   zone: 1, def: 0,  weight: 0.1, loot: 'ring', price: 70 },
  anneau_saphir:{ name: 'Anneau de saphir',     slot: 'ring',   zone: 3, def: 1,  weight: 0.1, loot: 'ring', price: 350 },
  amulette_loup:{ name: 'Amulette du loup',     slot: 'amulet', zone: 1, weight: 0.2, str: 3, agi: 2, loot: 'ring', price: 120 },
  amulette_sage:{ name: 'Amulette du sage',     slot: 'amulet', zone: 3, weight: 0.2, int: 5, wis: 5, loot: 'ring', price: 400 },

  // ================= Consommables =================
  potion_vie:   { name: 'Potion de vie',        slot: 'use', zone: 0, heal: 20, weight: 0.5, loot: 'hp_potion', price: 10 },
  potion_mana:  { name: 'Potion de mana',       slot: 'use', zone: 0, mana: 50, weight: 0.5, loot: 'mp_potion', price: 15 },

  // ================= Divers =================
  or:           { name: "Pièces d'or",          slot: 'gold', weight: 0, loot: 'coins25', price: 1 },
};

// ================= Coffres =================
// Or généreux (justifie le déplacement) OU objet rare du palier.
export const CHESTS = {
  itemChance: 0.45,
  gold: [60, 150],      // multiplié par l'économie de la zone
  respawn: 480,         // secondes
  perIsland: 7,
};
export function chestPool(zoneId) {
  const tier = Math.min(zoneId, 1);
  return Object.entries(ITEMS)
    .filter(([, d]) => d.chest === tier)
    .map(([id]) => id);
}

// sprite = clé du manifest d'animations Flare
export const MOBS = {
  rat: {
    name: 'Fourmilion', level: 1, hp: 12, dmg: 2, def: 0, speed: 3.4,
    aggro: 6, leash: 16, atkRange: 1.3, atkSpeed: 1.4,
    sprite: 'antlion_small', respawn: 12,
    drops: [['or', 0.9, 2, 5], ['potion_vie', 0.10, 1, 1], ['poignard_rouille', 0.05, 1, 1]],
  },
  serpent: {
    name: 'Fourmi de feu', level: 3, hp: 22, dmg: 3, def: 2, speed: 3.8,
    aggro: 7, leash: 18, atkRange: 1.4, atkSpeed: 1.2,
    sprite: 'fire_ant', respawn: 16,
    drops: [['or', 0.9, 3, 9], ['potion_vie', 0.12, 1, 1], ['tunique', 0.08, 1, 1], ['epee_courte_rouillee', 0.05, 1, 1]],
  },
  gobelin: {
    name: 'Gobelin', level: 5, hp: 40, dmg: 5, def: 4, speed: 4.2,
    aggro: 9, leash: 22, atkRange: 1.5, atkSpeed: 1.5,
    sprite: 'goblin', respawn: 20,
    drops: [['or', 0.95, 5, 16], ['potion_vie', 0.15, 1, 2], ['cuir', 0.08, 1, 1], ['lame_de_gobelin', 0.025, 1, 1], ['gourdin', 0.05, 1, 1], ['capuche', 0.06, 1, 1], ['bouclier_bois', 0.07, 1, 1]],
  },
  squelette: {
    name: 'Squelette', level: 8, hp: 70, dmg: 8, def: 7, speed: 3.6,
    aggro: 10, leash: 24, atkRange: 1.5, atkSpeed: 1.7,
    sprite: 'skeleton', respawn: 26,
    drops: [['or', 0.95, 10, 25], ['potion_vie', 0.15, 1, 2], ['mailles', 0.06, 1, 1], ['dague_du_crane', 0.02, 1, 1], ['dague_perceuse', 0.025, 1, 1], ['anneau_os', 0.07, 1, 1], ['casque_fer', 0.05, 1, 1]],
  },
  zombie: {
    name: 'Zombie', level: 10, hp: 95, dmg: 10, def: 8, speed: 2.8,
    aggro: 9, leash: 22, atkRange: 1.5, atkSpeed: 2.0,
    sprite: 'zombie', respawn: 30,
    drops: [['or', 0.95, 12, 32], ['potion_vie', 0.18, 1, 2], ['mailles', 0.07, 1, 1], ['sceptre_drachen', 0.015, 1, 1], ['casque_fer', 0.06, 1, 1], ['anneau_os', 0.08, 1, 1]],
  },
  orc: {
    name: 'Hobgobelin', level: 12, hp: 130, dmg: 12, def: 11, speed: 4.0,
    aggro: 10, leash: 26, atkRange: 1.6, atkSpeed: 1.8,
    sprite: 'hobgoblin', respawn: 35,
    drops: [['or', 0.95, 18, 45], ['potion_vie', 0.2, 1, 2], ['epee_de_fureur', 0.025, 1, 1], ['fleau_stabilite', 0.02, 1, 1], ['pourfendeur_gobelins', 0.01, 1, 1], ['bouclier_fer', 0.06, 1, 1]],
  },
  ogre: {
    name: 'Minotaure', level: 18, hp: 280, dmg: 18, def: 16, speed: 3.2,
    aggro: 11, leash: 30, atkRange: 2.0, atkSpeed: 2.4,
    sprite: 'minotaur', respawn: 90,
    drops: [['or', 1.0, 50, 130], ['potion_vie', 0.4, 2, 3], ['epee_large_ensanglantee', 0.05, 1, 1], ['plates', 0.08, 1, 1], ['anneau_saphir', 0.10, 1, 1]],
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
