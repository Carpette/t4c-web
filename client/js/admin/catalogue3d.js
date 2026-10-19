// Catalogue des modèles 3D CC0 validés pour T4C (packs archivés hors dépôt,
// extraits par tools/atelier3d/extraire.py, servis sous /src3d/ par le serveur
// quand T4C_SRC3D est disponible). Partagé par l'onglet Atelier 3D de l'admin
// et la planche contact (tools/atelier3d/planche.js).
//
// Réglages par modèle : h = hauteur réelle (m) ou module = unités du fichier
// par case (kits modulaires) ; clip = motif du clip de pose ; anims = clips
// partagés à ajouter (bibliothèque UAL) ; texture = texture livrée à part.
// Packs écartés (style) : KayKit, Quaternius Ultimate Monsters, RPG Characters,
// personnages Kenney — voir docs/atelier3d-catalogue.md.

const ANI = 'ultimate_animated_animals/Ultimate Animated Animals - July 2021/glTF/';
const OUT = 'modular_character_outfits_fantasy/Modular Character Outfits - Fantasy[Standard]/Exports/glTF (Godot-Unreal)/Outfits/';
const UAL = ['universal_animation_library/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb'];
const PROPS = 'fantasy_props_megakit/Exports/glTF/';
const NAT = 'stylized_nature_megakit/glTF/';
const KG = 'kenney_graveyard_kit_5_0/Models/GLB format/';
const RUI = 'ultimate_modular_ruins_pack/Ultimate Modular Ruins Pack - Aug 2021/FBX/';
const ZOMBIE = 'zombie_by_quaternius/Zombie by @Quaternius/';

export const CATALOGUE3D = [
  ['Personnages (avatar / PNJ)', 'creature', [
    { nom: 'UBC Superhero ♂ + UAL', url: 'universal_base_characters/Universal Base Characters[Standard]/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf', anims: UAL, h: 1.8, clip: '^Idle_Loop$' },
    { nom: 'Outfit Rôdeur ♂', url: OUT + 'Male_Ranger.gltf', anims: UAL, h: 1.8, clip: '^Idle_Loop$' },
    { nom: 'Outfit Paysanne ♀', url: OUT + 'Female_Peasant.gltf', anims: UAL, h: 1.7, clip: '^Idle_Loop$' },
  ]],
  ['Créatures', 'creature', [
    { nom: 'Zombie (FBX)', url: ZOMBIE + 'FBX/Zombie.fbx', texture: ZOMBIE + 'Blends/ZombieTexture.png', h: 1.8, clip: 'ZombieIdle' },
    { nom: 'Loup', url: ANI + 'Wolf.gltf', h: 0.95, clip: '^idle$' },
    { nom: 'Cerf', url: ANI + 'Stag.gltf', h: 1.9, clip: '^idle$' },
    { nom: 'Taureau (sanglier ?)', url: ANI + 'Bull.gltf', h: 1.6, clip: '^idle$' },
  ]],
  ['Décors', 'decor', [
    { nom: 'Tonneau', url: PROPS + 'Barrel.gltf', h: 1.0 },
    { nom: 'Coffre', url: PROPS + 'Chest_Wood.gltf', h: 0.7 },
    { nom: 'Étal', url: PROPS + 'Stall_Empty.gltf', h: 2.4 },
    { nom: 'Kenney étal', url: 'kenney_fantasy_town_kit_2_0/Models/GLB format/stall-red.glb', module: 0.5 },
    { nom: 'Arbre', url: NAT + 'CommonTree_1.gltf', h: 5.5 },
    { nom: 'Pin', url: NAT + 'Pine_2.gltf', h: 6.5 },
    { nom: 'Arbre mort', url: NAT + 'DeadTree_1.gltf', h: 4.5 },
    { nom: 'Rocher', url: NAT + 'Rock_Medium_1.gltf', h: 1.1 },
    { nom: 'Mur village', url: 'medieval_village_megakit/Medieval Village MegaKit[Standard]/glTF/Wall_UnevenBrick_Window_Wide_Round.gltf', module: 2 },
    { nom: 'Kenney crypte', url: KG + 'crypt.glb', module: 0.75 },
    { nom: 'Kenney tombe', url: KG + 'gravestone-cross.glb', module: 0.75 },
    { nom: 'Kenney tour', url: 'kenney_castle_kit/Models/GLB format/tower-square.glb', module: 0.5 },
    { nom: 'Ruines arche', url: RUI + 'Arch_Gothic.fbx', h: 4.0 },
    { nom: 'Ruines statue', url: RUI + 'Statue_Stag.fbx', h: 2.5 },
  ]],
];
