#!/usr/bin/env python3
# Injecte la trame « Les Murmures d'Arakas » dans content/npcs.json et LINT :
# objets existants, flags posés avant d'être exigés, mots-clés sans collision
# entre PNJ à portée d'oreille mutuelle (NPC_DIALOGUE_RANGE).
import json, re, math, subprocess

NPCS = 'content/npcs.json'

def D(keywords, reponse, conditions=None, reactions=None, repeatable=False):
    e = {'keywords': keywords, 'reponse': reponse}
    if conditions: e['conditions'] = conditions
    if reactions: e['reactions'] = reactions
    if repeatable: e['repeatable'] = True
    return e

QUESTS = {
# ---------- ÉTAPE 1 : Maître Aldric (village) ----------
'merchant': [
    D(['travail', 'quete'],
      "Du travail ? Hmph. Les temps sont sombres, petit. Si tu cherches plus qu'une paie, "
      "monte au nord voir Cathbad, le druide des pierres levées — parle-lui de la « prophetie ». "
      "Tiens, de quoi payer la route.",
      conditions={'notFlag': 'mq1'},
      reactions=[{'type': 'flag', 'key': 'mq1'}, {'type': 'gold', 'amount': 30}, {'type': 'xp', 'amount': 50}]),
    D(['travail', 'quete'],
      "Cathbad t'attend au nord, près des pierres levées. Ne le fais pas patienter, il parle aux corbeaux quand il s'ennuie.",
      conditions={'flag': 'mq1'}),
    D(['aldric'],
      "Maître Aldric, fournisseur d'Arakas depuis trente hivers. Tout ce que je vends a servi au moins une fois — c'est ce qui prouve que ça marche."),
],
# ---------- ÉTAPE 2 : Cathbad, druide du nord + FINAL ----------
'cathbad': [
    D(['elu'],
      "Ainsi l'Anneau est rendu et l'Ogre déchu... La Quatrième Prophétie s'écrit, et ton nom y figure. "
      "Va, Élu d'Arakas : l'obélisque du village mène aux Épreuves, et par-delà les mers, l'Île de Lumière attend. Mes bénédictions t'accompagnent.",
      conditions={'flag': 'mq9', 'notFlag': 'mq10'},
      reactions=[{'type': 'flag', 'key': 'mq10'}, {'type': 'xp', 'amount': 2000}, {'type': 'gold', 'amount': 1000}]),
    D(['elu'],
      "L'Élu d'Arakas n'a plus rien à prouver ici. Les mers t'appellent.",
      conditions={'flag': 'mq10'}),
    D(['valeur'],
      "Bien. La terre a bu assez de ton sueur pour te reconnaître. Descends au village : le garde Kilhiam "
      "s'inquiète des gobelins — parle-lui de « cuirs ».",
      conditions={'flag': 'mq1', 'level': 4, 'notFlag': 'mq2'},
      reactions=[{'type': 'flag', 'key': 'mq2'}, {'type': 'xp', 'amount': 150}, {'type': 'gold', 'amount': 40}]),
    D(['valeur'],
      "Ta valeur ? Elle se forge, elle ne se déclame pas. Reviens me voir quand les bêtes d'Arakas t'auront endurci (niveau 4).",
      conditions={'flag': 'mq1', 'notFlag': 'mq2'}),
    D(['prophetie'],
      "La Quatrième Prophétie... Trois se sont accomplies, et la dernière murmure — certains disent qu'elle murmure des noms. "
      "Peut-être le tien. Prouve d'abord ta « valeur », et nous verrons ce que les pierres disent de toi.",
      conditions={'flag': 'mq1', 'notFlag': 'mq10'}),
    D(['prophetie'],
      "Elle s'écrit, désormais. Et tu tiens la plume.",
      conditions={'flag': 'mq10'}),
    D(['druide'],
      "Les pierres levées sont plus vieilles que les dieux qu'on prie au village. Je ne fais que les écouter."),
],
# ---------- ÉTAPE 3 : Kilhiam, garde du village ----------
'kilhiam': [
    D(['cuirs'],
      "Un cuir de gobelin, encore chaud ! Voilà qui calmera leurs raids quelque temps. Porte la nouvelle à "
      "Moonrock : sa « forge » manque de bras... et d'os, à ce qu'il paraît.",
      conditions={'flag': 'mq2', 'notFlag': 'mq3', 'item': 'cuir', 'consume': True},
      reactions=[{'type': 'flag', 'key': 'mq3'}, {'type': 'gold', 'amount': 250}, {'type': 'xp', 'amount': 300}]),
    D(['cuirs'],
      "Les gobelins de l'est taillent leurs armures dans du cuir volé. Rapporte-m'en un comme preuve de chasse, et la garde saura te payer.",
      conditions={'flag': 'mq2', 'notFlag': 'mq3'}),
    D(['cuirs'],
      "La palissade tiendra, grâce à toi. Moonrock t'attend à sa forge.",
      conditions={'flag': 'mq3'}),
    D(['garde'],
      "Trois hommes pour garder tout un village. Alors quand un aventurier passe, je ne fais pas le difficile."),
],
# ---------- ÉTAPE 4 : Moonrock, forgeron ----------
'moonrock': [
    D(['forge'],
      "De l'os ancien ! Parfait pour tremper une lame qui mord les vivants ET les morts. Tiens — la Dague "
      "perceuse est à toi. Shovanis cherche quelqu'un pour un « contrat » un peu... discret.",
      conditions={'flag': 'mq3', 'notFlag': 'mq4', 'item': 'anneau_os', 'consume': True},
      reactions=[{'type': 'flag', 'key': 'mq4'}, {'type': 'item', 'defId': 'dague_perceuse'}, {'type': 'xp', 'amount': 400}]),
    D(['forge'],
      "Ma forge a besoin d'os ancien — celui des squelettes du cimetière, à l'ouest. Ils portent des anneaux d'os : rapporte-m'en un, je te forgerai quelque chose de spécial.",
      conditions={'flag': 'mq3', 'notFlag': 'mq4'}),
    D(['forge'],
      "Ta dague mord bien ? L'os ancien ne pardonne pas.",
      conditions={'flag': 'mq4'}),
    D(['marteau'],
      "Ce marteau a forgé des lames pour trois générations. Le fer se souvient de tout, petit. Surtout de qui l'a mal trempé."),
],
# ---------- ÉTAPE 5 : Shovanis ----------
'shovanis': [
    D(['contrat'],
      "Une dague rouillée de la côte... c'est bien leur acier de misère. Le contrat est rempli, et ma dette envers toi commence. "
      "Écoute : Uranos, le prêtre près du puits sud, perd le sommeil à cause des « morts ». Va le voir.",
      conditions={'flag': 'mq4', 'notFlag': 'mq5', 'level': 7, 'item': 'dague_rouillee', 'consume': True},
      reactions=[{'type': 'flag', 'key': 'mq5'}, {'type': 'gold', 'amount': 400}, {'type': 'xp', 'amount': 450}]),
    D(['contrat'],
      "Des brigands écument la côte ouest et je veux une preuve qu'on peut les saigner : rapporte-moi une de leurs dagues rouillées. "
      "Pas avant d'être aguerri (niveau 7) — ils ne ratent pas deux fois.",
      conditions={'flag': 'mq4', 'notFlag': 'mq5'}),
    D(['contrat'],
      "Le contrat est clos. Les brigands y réfléchiront à deux fois.",
      conditions={'flag': 'mq5'}),
    D(['rumeurs'],
      "Des rumeurs ? On dit que l'Ogre du pont collectionne ce qu'il vole. Et qu'il ne rend jamais rien... vivant."),
],
# ---------- Araknor : lore ----------
'araknor': [
    D(['venin'],
      "Les araignées géantes du bois ? Leur venin brûle, mais c'est la tarentule qu'il faut craindre. Bois une potion AVANT la morsure, pas après — après, tes mains tremblent trop."),
    D(['araknor'],
      "On m'appelle Araknor parce que j'ai survécu au nid. Personne ne demande combien nous étions en y entrant."),
],
# ---------- ÉTAPE 6 : Uranos, prêtre ----------
'uranos': [
    D(['morts'],
      "Un casque de fer... arraché à nos tombes, porté par nos propres morts. Tu l'as repris. Les dieux te voient, aventurier. "
      "Lothan, mon voisin, guette les feux orcs au nord-est — ses « eclaireurs » ne reviennent plus.",
      conditions={'flag': 'mq5', 'notFlag': 'mq6', 'item': 'casque_fer', 'consume': True},
      reactions=[{'type': 'flag', 'key': 'mq6'}, {'type': 'xp', 'amount': 600}, {'type': 'gold', 'amount': 300}]),
    D(['morts'],
      "Les squelettes du cimetière profanent nos défunts — ils portent les casques de fer volés dans les tombes. Reprends-en un, que je puisse le bénir et l'inhumer.",
      conditions={'flag': 'mq5', 'notFlag': 'mq6'}),
    D(['morts'],
      "Le casque repose en terre bénie. Les morts dorment un peu mieux, grâce à toi.",
      conditions={'flag': 'mq6'}),
    D(['priere'],
      "Je prie pour les vivants. Les morts d'Arakas, eux, n'écoutent plus — c'est bien le problème. "
      "Le temple offre ses « soins », sa « benediction » et la « purification » des maudits — les dieux acceptent l'or, moi aussi."),
    # ---- services du temple (rejouables, payants via conditions.gold) ----
    D(['soins'],
      "Que la lumière referme tes plaies, mon enfant. (-30 or)",
      conditions={'gold': 30, 'consumeGold': True, 'notCursed': True},
      reactions=[{'type': 'heal'}], repeatable=True),
    D(['soins'],
      "Une malédiction pèse sur toi : mes prières glissent sur elle. Demande la « purification » d'abord (100 or).",
      conditions={'cursed': True}),
    D(['soins'],
      "Les soins du temple coûtent 30 pièces, mon enfant. Les dieux nourrissent l'âme ; l'or nourrit le temple."),
    D(['purification'],
      "Par les Trois Prophéties accomplies... que ce mal te quitte ! (-100 or)",
      conditions={'gold': 100, 'consumeGold': True, 'cursed': True},
      reactions=[{'type': 'cleanse'}], repeatable=True),
    D(['purification'],
      "Une malédiction te ronge et il te manque des pièces... La purification coûte 100 or. Reviens vite, avant qu'elle ne t'achève.",
      conditions={'cursed': True}),
    D(['purification'],
      "Aucune malédiction ne pèse sur toi. Que les dieux t'en préservent — sinon, la purification coûte 100 or."),
    D(['benediction'],
      "Que les dieux marchent à tes côtés : leur bénédiction durcit ta chair. (+3 d'armure, 10 minutes) (-150 or)",
      conditions={'gold': 150, 'consumeGold': True},
      reactions=[{'type': 'buff', 'effect': 'defense_boost', 'power': 3, 'duration': 600}], repeatable=True),
    D(['benediction'],
      "La bénédiction des dieux (+3 d'armure, 10 minutes) coûte 150 pièces. Leur faveur n'a pas de prix ; leur temple, si."),
],
# ---------- ÉTAPE 7 : Lothan, éclaireur ----------
'lothan': [
    D(['eclaireurs'],
      "Un bouclier orque... alors c'est vrai, on peut les tuer. Tu viens de rendre espoir à mes hommes. Prends "
      "cette Épée de fureur, reprise sur leur chef il y a des années. Et file à l'ouest : l'érudit Liurn Clar comprend leurs « runes ».",
      conditions={'flag': 'mq6', 'notFlag': 'mq7', 'level': 12, 'item': 'bouclier_orque', 'consume': True},
      reactions=[{'type': 'flag', 'key': 'mq7'}, {'type': 'item', 'defId': 'epee_de_fureur'}, {'type': 'xp', 'amount': 800}]),
    D(['eclaireurs'],
      "Les orcs campent au nord-est et mes éclaireurs ne reviennent plus. Rapporte-moi un bouclier orque — pas avant le niveau 12, ils chassent en meute.",
      conditions={'flag': 'mq6', 'notFlag': 'mq7'}),
    D(['eclaireurs'],
      "Mes hommes reprennent les sentiers. On te doit ça.",
      conditions={'flag': 'mq7'}),
],
# ---------- Iraltok : chasse légendaire optionnelle ----------
'iraltok': [
    D(['amulette'],
      "Par tous les crocs... l'Amulette du loup. Vingt ans que je la traque. Tu es un chasseur, un vrai. "
      "Prends mon arc de frêne — il t'appartient plus qu'à moi désormais.",
      conditions={'item': 'amulette_loup', 'consume': True, 'notFlag': 'legende_loup'},
      reactions=[{'type': 'flag', 'key': 'legende_loup'}, {'type': 'item', 'defId': 'arc_droit_frene'}, {'type': 'xp', 'amount': 1000}]),
    D(['amulette'],
      "On raconte qu'un loup sur cent porte une amulette au cou — souvenir d'un maître dévoré, disent les anciens. "
      "Rapporte-la-moi et je te donnerai ce que j'ai de plus cher. Loups, loups noirs, ours : tous peuvent la porter.",
      conditions={'notFlag': 'legende_loup'}),
    D(['amulette'],
      "L'Amulette est entre de bonnes mains. Bonne chasse, l'ami.",
      conditions={'flag': 'legende_loup'}),
    D(['chasse'],
      "La chasse n'est pas une affaire de force. C'est une affaire de patience — et de savoir qui, du gibier ou de toi, en a le plus."),
],
# ---------- ÉTAPE 8 : Liurn Clar, érudit de l'ouest ----------
'liurn_clar': [
    D(['runes'],
      "Ces runes orques... elles parlent d'un tribut payé à « celui du pont ». L'Ogre ! Tout se recoupe. "
      "Porte mon « message » à Holenarbed, l'ermite des ruines du nord — lui seul connaît la bête.",
      conditions={'flag': 'mq7'}),
    D(['archives'],
      "Mes archives remontent aux Trois Prophéties. La Quatrième ? Elle n'est écrite nulle part — c'est bien ce qui m'inquiète."),
],
# ---------- Marsac Cred : économie répétable ----------
'marsac_cred': [
    D(['affaires'],
      "Une lame de gobelin ! Soixante pièces, comme convenu, et pas de questions. J'en reprends autant que tu en trouves.",
      conditions={'item': 'lame_de_gobelin', 'consume': True},
      reactions=[{'type': 'gold', 'amount': 60}], repeatable=True),
    D(['affaires'],
      "Je rachète les lames de gobelin : soixante pièces l'unité, sans questions ni reçu. Certains collectionneurs du continent ont des goûts... particuliers."),
],
# ---------- Ttayh Mark : lore ----------
'merchant_wh': [
    D(['entrepot'],
      "L'entrepôt de l'ouest, c'est moi. Les prix y sont doux et les questions rares — un peu comme chez mon voisin Marsac, mais en légal."),
],
# ---------- ÉTAPES 9-10 : Holenarbed, ermite des ruines ----------
'holenarbed': [
    D(['message'],
      "Liurn Clar... ce vieux rat de bibliothèque a donc enfin compris. Oui, je connais l'Ogre du pont. "
      "Il garde l'Anneau de saphir volé au sanctuaire. Reviens me parler de l'« ogre » quand tu seras de taille (niveau 15).",
      conditions={'flag': 'mq7', 'notFlag': 'mq8'},
      reactions=[{'type': 'flag', 'key': 'mq8'}, {'type': 'xp', 'amount': 500}]),
    D(['ogre'],
      "L'Anneau de saphir ! Le sanctuaire retrouvera son éclat... et toi, prends cette armure de plates — l'Ogre "
      "n'en aura plus besoin. Retourne voir Cathbad aux pierres levées : dis-lui que l'« elu » est arrivé.",
      conditions={'flag': 'mq8', 'notFlag': 'mq9', 'level': 15, 'item': 'anneau_saphir', 'consume': True},
      reactions=[{'type': 'flag', 'key': 'mq9'}, {'type': 'item', 'defId': 'plates'}, {'type': 'xp', 'amount': 1500}]),
    D(['ogre'],
      "L'Ogre hante le pont et porte l'Anneau de saphir sur lui. Ne l'affronte pas avant le niveau 15 — d'autres ont essayé, j'ai enterré ce qu'il en restait.",
      conditions={'flag': 'mq8', 'notFlag': 'mq9'}),
    D(['ogre'],
      "Le pont est libre. Les ruines s'en souviendront.",
      conditions={'flag': 'mq9'}),
    D(['ruines'],
      "Ces ruines étaient une cité avant les Prophéties. J'y vis pour me souvenir de ce que le monde oublie."),
],
}

# ================= LINT =================
data = json.load(open(NPCS))
npc = data['npc']
errors = []

# 1. PNJ existants
for nid in QUESTS:
    if nid not in npc: errors.append(f'PNJ inconnu : {nid}')

# 2. objets existants (defs.js)
defs = open('shared/defs.js').read()
item_ids = set(re.findall(r'^\s{2}(\w+):\s*\{', defs.split('export const ITEMS')[1].split('\n};')[0], re.M))
for nid, dlgs in QUESTS.items():
    for d in dlgs:
        it = d.get('conditions', {}).get('item')
        if it and it not in item_ids: errors.append(f'{nid}: objet condition inconnu {it}')
        for r in d.get('reactions', []):
            if r['type'] == 'item' and r['defId'] not in item_ids:
                errors.append(f'{nid}: objet récompense inconnu {r["defId"]}')
            if r['type'] not in ('gold', 'item', 'xp', 'flag', 'teleport', 'heal', 'cleanse', 'buff'):
                errors.append(f'{nid}: type de réaction inconnu {r["type"]}')

# 3. chaîne de flags : tout flag exigé est posé quelque part
set_flags = {r['key'] for dl in QUESTS.values() for d in dl for r in d.get('reactions', []) if r['type'] == 'flag'}
for nid, dlgs in QUESTS.items():
    for d in dlgs:
        for k in ('flag',):
            f = d.get('conditions', {}).get(k)
            if f and f not in set_flags: errors.append(f'{nid}: flag exigé jamais posé {f}')

# 4. collisions de mots-clés entre PNJ à portée d'oreille (12 tuiles = 2 x range)
SPOTS = {'merchant': (325, 241), 'merchant_wh': (74, 274), 'kilhiam': (330, 240), 'moonrock': (335, 240),
         'shovanis': (333, 239), 'araknor': (338, 238), 'iraltok': (327, 255), 'lothan': (327, 257),
         'uranos': (327, 259), 'liurn_clar': (55, 272), 'marsac_cred': (55, 274), 'cathbad': (327, 60),
         'holenarbed': (333, 61)}
kw_of = {nid: {k for d in dlgs for k in d['keywords']} for nid, dlgs in QUESTS.items()}
for a in QUESTS:
    for b in QUESTS:
        if a >= b: continue
        ax, az = SPOTS[a]; bx, bz = SPOTS[b]
        if math.hypot(ax - bx, az - bz) <= 12 and kw_of[a] & kw_of[b]:
            errors.append(f'collision de mots-clés {a}/{b} : {kw_of[a] & kw_of[b]}')

if errors:
    print('\n'.join('✘ ' + e for e in errors)); exit(1)

# ================= INJECTION =================
for nid, dlgs in QUESTS.items():
    npc[nid]['dialogues'] = dlgs
json.dump(data, open(NPCS, 'w'), ensure_ascii=False, indent=2)
n = sum(len(d) for d in QUESTS.values())
print(f'✔ lint OK — {n} dialogues injectés sur {len(QUESTS)} PNJ')
