// Définitions d'objets et de monstres — partagées serveur/client
// Armes : tables authentiques T4C (l4p.fr / wiki Fandom), prix divisés par 5.
// req = stats requises pour équiper (For/Int/Sag, comme dans T4C)
// weight = poids (capacité de port : 500×For/(For+100))
// zone = vendu chez Aldric à partir de cette zone ; drop = monstre ; chest = butin de coffre
// Sprites : projet Flare (CC-BY-SA 3.0), voir client/assets/CREDITS.txt

export const SLOTS = ['weapon', 'shield', 'armor', 'helmet', 'legs', 'gloves', 'belt', 'boots', 'ring', 'ring2', 'amulet'];
export const SLOT_NAMES = {
  weapon: 'Arme', shield: 'Bouclier', armor: 'Armure', helmet: 'Casque',
  legs: 'Jambières', gloves: 'Gants', belt: 'Ceinture',
  boots: 'Bottes', ring: 'Anneau', ring2: 'Anneau 2', amulet: 'Amulette',
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

  // ================= ARCS T4C (l4p.fr VoirArcs) — ranged: true, range en tuiles =================
  // Lighthaven : vendus par Sigfried (zone 0)
  arc_droit_frene:     { name: 'Arc droit en frêne',      slot: 'weapon', zone: 0, fixed: true, ranged: true, range: 8, dmgMin: 1,  dmgMax: 3,  speed: 1.8, weight: 7, req: {},                          layer: 'shortbow', loot: 'shortbow', price: 6 },
  grand_arc_frene:     { name: 'Grand arc en frêne',      slot: 'weapon', zone: 0, fixed: true, ranged: true, range: 9, dmgMin: 5,  dmgMax: 11, speed: 2.0, weight: 8, req: { str: 13, agi: 24 },        layer: 'longbow',  loot: 'longbow',  price: 121 },
  arc_courbe_frene:    { name: 'Arc courbé en frêne',     slot: 'weapon', zone: 0, fixed: true, ranged: true, range: 9, dmgMin: 12, dmgMax: 18, speed: 2.1, weight: 8, req: { str: 17, agi: 39 },        layer: 'greatbow', loot: 'greatbow', price: 526 },
  // Windhowl : vendus par Ttayh Mark (zone 1)
  arc_droit_orme:      { name: 'Arc droit en orme',       slot: 'weapon', zone: 1, fixed: true, ranged: true, range: 8, dmgMin: 18, dmgMax: 26, speed: 1.8, weight: 8, req: { str: 15, agi: 53 },        layer: 'shortbow', loot: 'shortbow', price: 1053 },
  grand_arc_orme:      { name: 'Grand arc en orme',       slot: 'weapon', zone: 1, fixed: true, ranged: true, range: 9, dmgMin: 28, dmgMax: 39, speed: 2.0, weight: 8, req: { str: 18, agi: 68 },        layer: 'longbow',  loot: 'longbow',  price: 1865 },
  arc_courbe_orme:     { name: 'Arc courbé en orme',      slot: 'weapon', zone: 1, fixed: true, ranged: true, range: 9, dmgMin: 33, dmgMax: 50, speed: 2.1, weight: 9, req: { str: 22, agi: 82 },        layer: 'greatbow', loot: 'greatbow', price: 2906 },
  arc_recourbe_orme:   { name: 'Arc recourbé en orme',    slot: 'weapon', zone: 1, fixed: true, ranged: true, range: 9, dmgMin: 42, dmgMax: 56, speed: 2.1, weight: 9, req: { str: 29, agi: 97 },        layer: 'greatbow', loot: 'greatbow', price: 4177 },
  // Arcs en drop / quête / coffre du palier Arakas (LH/WH)
  arc_en_os_du_desert: { name: 'Arc en os du désert',     slot: 'weapon', chest: 0, fixed: true, ranged: true, range: 8, dmgMin: 17, dmgMax: 27, speed: 1.8, weight: 7, req: { str: 17, agi: 39 },       layer: 'shortbow', loot: 'shortbow', price: 3148 },
  arc_pourfendeur_centaures: { name: 'Arc pourfendeur des centaures', slot: 'weapon', chest: 1, fixed: true, ranged: true, range: 9, dmgMin: 64, dmgMax: 87, speed: 2.0, weight: 8, req: { str: 27, agi: 140 }, layer: 'longbow', loot: 'longbow', price: 15620 },
  arc_des_arachnides:  { name: 'Arc des arachnides',      slot: 'weapon', chest: 1, fixed: true, ranged: true, range: 9, dmgMin: 86, dmgMax: 115, speed: 2.0, weight: 8, req: { str: 31, agi: 184 },     layer: 'greatbow', loot: 'greatbow', price: 23310 },
  arc_primitif_skraugh:{ name: 'Arc primitif skraugh',    slot: 'weapon', drop: 'orc', fixed: true, ranged: true, range: 8, dmgMin: 78, dmgMax: 104, speed: 1.9, weight: 8, req: { str: 40, end: 35, agi: 169, wis: 25, int: 20 }, layer: 'shortbow', loot: 'shortbow', price: 23310 },

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

  // ================= ARMURES T4C (l4p.fr) — prérequis : ENDURANCE, malus d'esquive =================
  veste_toile: { name: 'Veste en Toile', slot: 'armor', zone: 0, fixed: true, def: 0.0, malus: 0, weight: 1, layer: 'cloth_shirt', loot: 'clothes', price: 3 },
  jambieres_toile: { name: 'Pantalon en Toile', slot: 'legs', zone: 0, fixed: true, def: 0.0, malus: 0, weight: 1, layer: 'cloth_pants', loot: 'clothes', price: 3 },
  armure_cuir: { name: 'Armure de Cuir', slot: 'armor', zone: 0, fixed: true, def: 1.45, malus: 3, weight: 8, req: { end: 25 }, layer: 'leather_chest', loot: 'leather_armor', price: 121 },
  ceinture_cuir: { name: 'Ceinture de Cuir', slot: 'belt', zone: 0, fixed: true, def: 0.3, malus: 1, weight: 1, req: { end: 25 }, loot: 'leather_armor', price: 42 },
  bottes_cuir: { name: 'Bottes de Cuir', slot: 'boots', zone: 0, fixed: true, def: 0.405, malus: 1, weight: 2, req: { end: 25 }, layer: 'leather_boots', loot: 'leather_armor', price: 49 },
  gants_cuir: { name: 'Gants de Cuir', slot: 'gloves', zone: 0, fixed: true, def: 0.405, malus: 1, weight: 1, req: { end: 25 }, layer: 'leather_gloves', loot: 'leather_armor', price: 50 },
  casque_cuir: { name: 'Casque de Cuir', slot: 'helmet', zone: 0, fixed: true, def: 0.39, malus: 1, weight: 2, req: { end: 25 }, layer: 'leather_hood', loot: 'leather_armor', price: 52 },
  jambieres_cuir: { name: 'Jambières de Cuir', slot: 'legs', zone: 0, fixed: true, def: 0.45, malus: 2, weight: 4, req: { end: 25 }, layer: 'leather_pants', loot: 'leather_armor', price: 54 },
  armure_cuir_cloute: { name: 'Armure de Cuir Clouté', slot: 'armor', zone: 0, fixed: true, def: 2.8, malus: 7, weight: 10, req: { end: 45 }, layer: 'leather_chest', loot: 'leather_armor', price: 908 },
  ceinture_cuir_cloute: { name: 'Ceinture de Cuir Clouté', slot: 'belt', zone: 0, fixed: true, def: 0.6, malus: 2, weight: 1, req: { end: 45 }, loot: 'leather_armor', price: 217 },
  bottes_cuir_cloute: { name: 'Bottes de Cuir Clouté', slot: 'boots', zone: 0, fixed: true, def: 0.81, malus: 3, weight: 3, req: { end: 45 }, layer: 'leather_boots', loot: 'leather_armor', price: 274 },
  gants_cuir_cloute: { name: 'Gants de Cuir Clouté', slot: 'gloves', zone: 0, fixed: true, def: 0.81, malus: 3, weight: 1, req: { end: 45 }, layer: 'leather_gloves', loot: 'leather_armor', price: 280 },
  casque_cuir_cloute: { name: 'Casque de Cuir Clouté', slot: 'helmet', zone: 0, fixed: true, def: 0.78, malus: 3, weight: 2, req: { end: 45 }, layer: 'leather_hood', loot: 'leather_armor', price: 302 },
  jambieres_cuir_cloute: { name: 'Jambières de Cuir Clouté', slot: 'legs', zone: 0, fixed: true, def: 0.9, malus: 5, weight: 5, req: { end: 45 }, layer: 'leather_pants', loot: 'leather_armor', price: 316 },
  armure_anneaux: { name: 'Armure d\'Anneaux', slot: 'armor', zone: 1, fixed: true, def: 4.15, malus: 11, weight: 14, req: { end: 60 }, layer: 'chain_cuirass', loot: 'steel_armor', price: 2008 },
  ceinture_anneaux: { name: 'Ceinture d\'Anneaux', slot: 'belt', zone: 1, fixed: true, def: 0.9, malus: 2, weight: 2, req: { end: 60 }, loot: 'steel_armor', price: 462 },
  bottes_anneaux: { name: 'Bottes d\'Anneaux', slot: 'boots', zone: 1, fixed: true, def: 1.215, malus: 4, weight: 3, req: { end: 60 }, layer: 'chain_boots', loot: 'steel_armor', price: 590 },
  gants_anneaux: { name: 'Gants d\'Anneaux', slot: 'gloves', zone: 1, fixed: true, def: 1.215, malus: 4, weight: 2, req: { end: 60 }, layer: 'chain_gloves', loot: 'steel_armor', price: 603 },
  casque_anneaux: { name: 'Casque d\'Anneaux', slot: 'helmet', zone: 1, fixed: true, def: 1.17, malus: 4, weight: 3, req: { end: 60 }, layer: 'chain_coif', loot: 'steel_armor', price: 652 },
  jambieres_anneaux: { name: 'Jambières d\'Anneaux', slot: 'legs', zone: 1, fixed: true, def: 1.35, malus: 7, weight: 6, req: { end: 60 }, layer: 'chain_greaves', loot: 'steel_armor', price: 683 },
  armure_cuir_elfique: { name: 'Armure de Cuir Elfique', slot: 'armor', chest: 1, fixed: true, def: 5.5, malus: 5, weight: 6, req: { end: 75 }, layer: 'leather_chest', loot: 'leather_armor', price: 1182 },
  ceinture_cuir_elfique: { name: 'Ceinture de Cuir Elfique', slot: 'belt', chest: 1, fixed: true, def: 1.2, malus: 1, weight: 1, req: { end: 75 }, loot: 'leather_armor', price: 268 },
  bottes_cuir_elfique: { name: 'Bottes de Cuir Elfique', slot: 'boots', chest: 1, fixed: true, def: 1.62, malus: 2, weight: 2, req: { end: 75 }, layer: 'leather_boots', loot: 'leather_armor', price: 344 },
  gants_cuir_elfique: { name: 'Gants de Cuir Elfique', slot: 'gloves', chest: 1, fixed: true, def: 1.62, malus: 2, weight: 1, req: { end: 75 }, layer: 'leather_gloves', loot: 'leather_armor', price: 351 },
  casque_cuir_elfique: { name: 'Casque de Cuir Elfique', slot: 'helmet', chest: 1, fixed: true, def: 1.56, malus: 2, weight: 1, req: { end: 75 }, layer: 'leather_hood', loot: 'leather_armor', price: 380 },
  jambieres_cuir_elfique: { name: 'Jambières de Cuir Elfique', slot: 'legs', chest: 1, fixed: true, def: 1.8, malus: 3, weight: 3, req: { end: 75 }, layer: 'leather_pants', loot: 'leather_armor', price: 398 },
  armure_mailles: { name: 'Armure de Mailles', slot: 'armor', zone: 1, fixed: true, def: 5.95, malus: 13, weight: 18, req: { end: 80 }, layer: 'chain_cuirass', loot: 'steel_armor', price: 4155 },
  ceinture_mailles: { name: 'Ceinture de Mailles', slot: 'belt', zone: 1, fixed: true, def: 1.3, malus: 3, weight: 2, req: { end: 80 }, loot: 'steel_armor', price: 939 },
  bottes_mailles: { name: 'Bottes de Mailles', slot: 'boots', zone: 1, fixed: true, def: 1.755, malus: 5, weight: 4, req: { end: 80 }, layer: 'chain_boots', loot: 'steel_armor', price: 1214 },
  gants_mailles: { name: 'Gants de Mailles', slot: 'gloves', zone: 1, fixed: true, def: 1.755, malus: 5, weight: 2, req: { end: 80 }, layer: 'chain_gloves', loot: 'steel_armor', price: 1233 },
  casque_mailles: { name: 'Casque de Mailles', slot: 'helmet', zone: 1, fixed: true, def: 1.69, malus: 5, weight: 4, req: { end: 80 }, layer: 'chain_coif', loot: 'steel_armor', price: 1334 },
  jambieres_mailles: { name: 'Jambières de Mailles', slot: 'legs', zone: 1, fixed: true, def: 1.95, malus: 9, weight: 8, req: { end: 80 }, layer: 'chain_greaves', loot: 'steel_armor', price: 1398 },
  armure_ecailles: { name: 'Armure d\'Écailles', slot: 'armor', zone: 2, fixed: true, def: 8.65, malus: 11, weight: 22, req: { end: 100 }, layer: 'chain_cuirass', loot: 'steel_armor', price: 7081 },
  ceinture_ecailles: { name: 'Ceinture d\'Écailles', slot: 'belt', zone: 2, fixed: true, def: 1.9, malus: 3, weight: 2, req: { end: 100 }, loot: 'steel_armor', price: 1589 },
  bottes_ecailles: { name: 'Bottes d\'Écailles', slot: 'boots', zone: 2, fixed: true, def: 2.565, malus: 4, weight: 4, req: { end: 100 }, layer: 'chain_boots', loot: 'steel_armor', price: 2044 },
  gants_ecailles: { name: 'Gants d\'Écailles', slot: 'gloves', zone: 2, fixed: true, def: 2.565, malus: 4, weight: 2, req: { end: 100 }, layer: 'chain_gloves', loot: 'steel_armor', price: 2091 },
  casque_ecailles: { name: 'Casque d\'Écailles', slot: 'helmet', zone: 2, fixed: true, def: 2.47, malus: 4, weight: 4, req: { end: 100 }, layer: 'chain_coif', loot: 'steel_armor', price: 2264 },
  jambieres_ecailles: { name: 'Jambières d\'Écailles', slot: 'legs', zone: 2, fixed: true, def: 2.85, malus: 7, weight: 9, req: { end: 100 }, layer: 'chain_greaves', loot: 'steel_armor', price: 2374 },
  armure_mailles_elfique: { name: 'Armure de Mailles Elfique', slot: 'armor', chest: 2, fixed: true, def: 10.0, malus: 10, weight: 12, req: { end: 110 }, layer: 'chain_cuirass', loot: 'steel_armor', price: 2945 },
  ceinture_mailles_elfique: { name: 'Ceinture de Mailles Elfique', slot: 'belt', chest: 2, fixed: true, def: 2.2, malus: 2, weight: 1, req: { end: 110 }, loot: 'steel_armor', price: 660 },
  bottes_mailles_elfique: { name: 'Bottes de Mailles Elfique', slot: 'boots', chest: 2, fixed: true, def: 2.97, malus: 3, weight: 3, req: { end: 110 }, layer: 'chain_boots', loot: 'steel_armor', price: 849 },
  gants_mailles_elfique: { name: 'Gants de Mailles Elfique', slot: 'gloves', chest: 2, fixed: true, def: 2.97, malus: 3, weight: 1, req: { end: 110 }, layer: 'chain_gloves', loot: 'steel_armor', price: 869 },
  casque_mailles_elfique: { name: 'Casque de Mailles Elfique', slot: 'helmet', chest: 2, fixed: true, def: 2.86, malus: 3, weight: 2, req: { end: 110 }, layer: 'chain_coif', loot: 'steel_armor', price: 940 },
  jambieres_mailles_elfique: { name: 'Jambières de Mailles Elfique', slot: 'legs', chest: 2, fixed: true, def: 3.3, malus: 6, weight: 5, req: { end: 110 }, layer: 'chain_greaves', loot: 'steel_armor', price: 986 },
  armure_plaques: { name: 'Armure de Plaques', slot: 'armor', drop: 'orc', fixed: true, def: 12.25, malus: 21, weight: 35, req: { end: 125 }, layer: 'plate_cuirass', loot: 'steel_armor', price: 3944 },
  ceinture_plaques: { name: 'Ceinture de Plaques', slot: 'belt', drop: 'orc', fixed: true, def: 2.7, malus: 5, weight: 3, req: { end: 125 }, loot: 'steel_armor', price: 881 },
  bottes_plaques: { name: 'Bottes de Plaques', slot: 'boots', drop: 'orc', fixed: true, def: 3.645, malus: 7, weight: 6, req: { end: 125 }, layer: 'plate_boots', loot: 'steel_armor', price: 1135 },
  gants_plaques: { name: 'Gants de Plaques', slot: 'gloves', drop: 'orc', fixed: true, def: 3.645, malus: 7, weight: 4, req: { end: 125 }, layer: 'plate_gauntlets', loot: 'steel_armor', price: 1162 },
  casque_plaques: { name: 'Casque de Plaques', slot: 'helmet', drop: 'orc', fixed: true, def: 3.51, malus: 7, weight: 6, req: { end: 125 }, layer: 'plate_helm', loot: 'steel_armor', price: 1258 },
  jambieres_plaques: { name: 'Jambières de Plaques', slot: 'legs', drop: 'orc', fixed: true, def: 4.05, malus: 14, weight: 12, req: { end: 125 }, layer: 'plate_greaves', loot: 'steel_armor', price: 1319 },

  // ================= BOUCLIERS T4C (l4p.fr VoirBoucliers) — prérequis END (sauf Écu : For/End/Agi) =================
  // CA décimale, aucun malus d'esquive (tables l4p) ; malus négatif = BONUS d'esquive (Bouclier de Windhowl)
  bouclier_en_bois:    { name: 'Bouclier en Bois',      slot: 'shield', zone: 0, fixed: true, def: 1.0,  weight: 8,  req: { end: 45 },                    layer: 'buckler',      loot: 'buckler', price: 671 },
  bouclier_rond:       { name: 'Bouclier Rond',         slot: 'shield', zone: 1, fixed: true, def: 2.0,  weight: 8,  req: { end: 60 },                    layer: 'iron_buckler', loot: 'buckler', price: 1478 },
  bouclier_de_windhowl:{ name: 'Bouclier de Windhowl',  slot: 'shield', chest: 1, fixed: true, def: 3.0, malus: -19, weight: 8, req: { end: 60, wis: 23, int: 26 }, layer: 'shield', loot: 'shield', price: 3920 },
  bouclier_orque:      { name: 'Bouclier Orque',        slot: 'shield', drop: 'orc', fixed: true, def: 4.0, weight: 9, req: { end: 80 },                  layer: 'shield',       loot: 'shield',  price: 5088 },
  grand_bouclier:      { name: 'Grand Bouclier',        slot: 'shield', zone: 2, fixed: true, def: 6.0,  weight: 10, req: { end: 100 },                   layer: 'kite_shield',  loot: 'shield',  price: 5198 },
  bouclier_de_la_tour: { name: 'Bouclier de la Tour',   slot: 'shield', zone: 2, fixed: true, def: 8.0,  weight: 11, req: { end: 125 },                   layer: 'kite_shield',  loot: 'shield',  price: 7240 },
  ecu_de_drachen:      { name: 'Écu de Drachen',        slot: 'shield', drop: 'ogre', fixed: true, def: 12.0, weight: 12, req: { str: 40, end: 125, agi: 30 }, att: 50, layer: 'kite_shield', loot: 'shield', price: 19100 },

  // ===== Boucliers / bijoux / armures héritées =====
  bouclier_bois:{ name: 'Vieux bouclier de bois', slot: 'shield', legacy: true, def: 3,  weight: 4,  layer: 'buckler',     loot: 'buckler', price: 12 },
  bouclier_fer: { name: 'Vieux bouclier de fer',  slot: 'shield', legacy: true, def: 8,  weight: 9,  layer: 'kite_shield', loot: 'shield',  price: 130 },
  tunique:      { name: 'Tunique de toile',     slot: 'armor', legacy: true, def: 2,  weight: 3,  layer: 'cloth_shirt',   loot: 'clothes',       price: 10 },
  robe_mage:    { name: 'Robe de mage',         slot: 'armor', legacy: true, def: 4,  weight: 3,  int: 5, layer: 'mage_vest',  loot: 'clothes',  price: 90 },
  cuir:         { name: 'Armure de cuir',       slot: 'armor', legacy: true, def: 6,  weight: 8,  layer: 'leather_chest', loot: 'leather_armor', price: 60 },
  mailles:      { name: 'Cotte de mailles',     slot: 'armor', legacy: true, def: 11, weight: 18, layer: 'chain_cuirass', loot: 'steel_armor',   price: 190 },
  plates:       { name: 'Armure de plates',     slot: 'armor', legacy: true, def: 17, weight: 35, layer: 'plate_cuirass', loot: 'steel_armor',   price: 480 },
  capuche:      { name: 'Capuche de cuir',      slot: 'helmet', legacy: true, def: 3,  weight: 1,  layer: 'leather_hood',  loot: 'clothes',       price: 40 },
  capuche_mage: { name: 'Capuche de mage',      slot: 'helmet', legacy: true, def: 2,  weight: 1,  wis: 4, layer: 'mage_hood', loot: 'clothes',   price: 75 },
  casque_fer:   { name: 'Casque de fer',        slot: 'helmet', legacy: true, def: 6,  weight: 4,  layer: 'plate_helm',    loot: 'steel_armor',   price: 150 },
  bottes_mage:  { name: 'Bottes de mage',       slot: 'boots', legacy: true, def: 2,  weight: 2,  wis: 3, layer: 'mage_boots', loot: 'boots', price: 80 },
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

// Coffre personnel (banque du village) : nombre d'emplacements par personnage
export const BANK_SIZE = 30;

// ================= Coffres =================
// Or généreux (justifie le déplacement) OU objet rare du palier.
export const CHESTS = {
  itemChance: 0.45,
  gold: [60, 150],      // multiplié par l'économie de la zone
  respawn: 480,         // secondes
  perIsland: 7,
};
export function chestPool(zoneId) {
  const tier = Math.min(zoneId, 2);
  return Object.entries(ITEMS)
    .filter(([, d]) => d.chest === tier)
    .map(([id]) => id);
}

// sprite = clé du manifest d'animations Flare
export const MOBS = {
  rat: {
    name: 'Fourmilion', level: 1, hp: 12, dmg: 2, def: 0, speed: 3.4,
    aggro: 6, leash: 16, atkRange: 1.3, atkSpeed: 1.4,
    resist: { feu: -0.25 },
    sprite: 'antlion_small', respawn: 12,
    drops: [['or', 0.9, 2, 5], ['potion_vie', 0.10, 1, 1], ['poignard_rouille', 0.05, 1, 1]],
  },
  serpent: {
    name: 'Fourmi de feu', level: 3, hp: 22, dmg: 3, def: 2, speed: 3.8,
    aggro: 7, leash: 18, atkRange: 1.4, atkSpeed: 1.2,
    element: 'feu', // morsure brûlante : les résistances au feu du joueur s'appliquent
    resist: { feu: 0.75, eau: -0.5 },
    sprite: 'fire_ant', respawn: 16,
    drops: [['or', 0.9, 3, 9], ['potion_vie', 0.12, 1, 1], ['tunique', 0.08, 1, 1], ['epee_courte_rouillee', 0.05, 1, 1]],
  },
  gobelin: {
    name: 'Gobelin', level: 5, hp: 40, dmg: 5, def: 4, speed: 4.2,
    aggro: 9, leash: 22, atkRange: 1.5, atkSpeed: 1.5,
    resist: { terre: -0.5, arcane: 0.2 },
    sprite: 'goblin', respawn: 20,
    drops: [['or', 0.95, 5, 16], ['potion_vie', 0.15, 1, 2], ['cuir', 0.08, 1, 1], ['lame_de_gobelin', 0.025, 1, 1], ['gourdin', 0.05, 1, 1], ['capuche', 0.06, 1, 1], ['bouclier_en_bois', 0.07, 1, 1]],
  },
  squelette: {
    name: 'Squelette', level: 8, hp: 70, dmg: 8, def: 7, speed: 3.6,
    aggro: 10, leash: 24, atkRange: 1.5, atkSpeed: 1.7,
    resist: { feu: -0.3, lumiere: -0.5, eau: 0.3, arcane: 0.5 }, undead: true,
    sprite: 'skeleton', respawn: 26,
    drops: [['or', 0.95, 10, 25], ['potion_vie', 0.15, 1, 2], ['mailles', 0.06, 1, 1], ['dague_du_crane', 0.02, 1, 1], ['dague_perceuse', 0.025, 1, 1], ['anneau_os', 0.07, 1, 1], ['casque_fer', 0.05, 1, 1]],
  },
  zombie: {
    name: 'Zombie', level: 10, hp: 95, dmg: 10, def: 8, speed: 2.8,
    aggro: 9, leash: 22, atkRange: 1.5, atkSpeed: 2.0,
    resist: { feu: -0.4, lumiere: -0.5, terre: 0.3, arcane: 0.5 }, undead: true,
    sprite: 'zombie', respawn: 30,
    drops: [['or', 0.95, 12, 32], ['potion_vie', 0.18, 1, 2], ['mailles', 0.07, 1, 1], ['sceptre_drachen', 0.015, 1, 1], ['casque_fer', 0.06, 1, 1], ['anneau_os', 0.08, 1, 1]],
  },
  orc: {
    name: 'Hobgobelin', level: 12, hp: 130, dmg: 12, def: 11, speed: 4.0,
    aggro: 10, leash: 26, atkRange: 1.6, atkSpeed: 1.8,
    resist: { air: -0.25, terre: 0.3 },
    sprite: 'hobgoblin', respawn: 35,
    drops: [['or', 0.95, 18, 45], ['potion_vie', 0.2, 1, 2], ['epee_de_fureur', 0.025, 1, 1], ['fleau_stabilite', 0.02, 1, 1], ['pourfendeur_gobelins', 0.01, 1, 1], ['arc_primitif_skraugh', 0.01, 1, 1], ['bouclier_orque', 0.06, 1, 1], ['armure_plaques', 0.008, 1, 1], ['jambieres_plaques', 0.008, 1, 1], ['casque_plaques', 0.008, 1, 1], ['gants_plaques', 0.008, 1, 1], ['bottes_plaques', 0.008, 1, 1], ['ceinture_plaques', 0.008, 1, 1]],
  },
  ogre: {
    name: 'Minotaure', level: 18, hp: 280, dmg: 18, def: 16, speed: 3.2,
    aggro: 11, leash: 30, atkRange: 2.0, atkSpeed: 2.4,
    resist: { feu: 0.3, arcane: -0.25 },
    // la planche Flare du minotaure est en ~25x42 px/frame (4x plus petite
    // que les autres monstres) : on compense au rendu
    sprite: 'minotaur', spriteScale: 3.2, respawn: 90,
    drops: [['or', 1.0, 50, 130], ['potion_vie', 0.4, 2, 3], ['epee_large_ensanglantee', 0.05, 1, 1], ['plates', 0.08, 1, 1], ['anneau_saphir', 0.10, 1, 1], ['ecu_de_drachen', 0.01, 1, 1]],
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
