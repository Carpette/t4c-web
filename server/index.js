// Point d'entrée : serveur HTTP statique + WebSocket
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game } from './game/game.js';
import { handleAdmin } from './admin.js';
import * as db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url.startsWith('/api/admin/')) { handleAdmin(req, res, url, game); return; }
  if (url === '/') url = '/index.html';
  if (url === '/admin') url = '/admin.html';

  let file;
  if (url.startsWith('/shared/') || url.startsWith('/content/')) {
    file = path.join(ROOT, url);
  } else {
    file = path.join(ROOT, 'client', url);
  }
  // anti-traversée
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    const ext = path.extname(file);
    // code et contenu : jamais de cache (sinon un client périmé après une mise à
    // jour serveur génère la mauvaise carte -> écran vide au spawn) ;
    // assets lourds (sprites, musiques) : cache court.
    const cache = ['.js', '.html', '.css', '.json'].includes(ext)
      ? 'no-cache' : 'max-age=3600';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cache,
    });
    res.end(data);
  });
});

const game = new Game();
const wss = new WebSocketServer({ server, maxPayload: 4096 });

wss.on('connection', (ws) => {
  let player = null;
  let pendingAuth = null; // compte authentifié en attente de création de personnage

  const join = (res) => {
    const joined = game.addPlayer(ws, res.accountId, res.name, res.isAdmin);
    if (joined.error) { ws.send(JSON.stringify({ t: 'auth_error', error: joined.error })); return; }
    player = joined.player;
  };

  ws.on('message', (raw, isBinary) => {
    if (isBinary) return;
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (!player) {
      // toute erreur d'authentification/création remonte au client (jamais de
      // crash silencieux qui laisserait l'écran figé sans message)
      try {
        if (msg.t === 'register' || msg.t === 'login') {
          const res = msg.t === 'register' ? db.register(msg.name, msg.pass) : db.login(msg.name, msg.pass);
          if (res.error) { ws.send(JSON.stringify({ t: 'auth_error', error: res.error })); return; }
          if (!db.loadCharacter(res.accountId)) {
            // pas encore de personnage : le joueur répartit ses points (façon T4C)
            pendingAuth = res;
            ws.send(JSON.stringify({ t: 'create_char', ...game.creationInfo() }));
            return;
          }
          join(res);
        } else if (msg.t === 'create' && pendingAuth) {
          const data = game.buildCharacter(pendingAuth.name, msg.stats, msg.sex === 'female' ? 'female' : 'male');
          if (!data) { ws.send(JSON.stringify({ t: 'auth_error', error: 'Répartition de points invalide' })); return; }
          db.saveCharacter(pendingAuth.accountId, data);
          join(pendingAuth);
          pendingAuth = null;
        }
      } catch (e) {
        console.error('auth/création', e);
        try { ws.send(JSON.stringify({ t: 'auth_error', error: 'Erreur serveur : ' + e.message })); } catch {}
      }
      return;
    }
    try { game.onMessage(player, msg); } catch (e) { console.error('onMessage', e); }
  });

  ws.on('close', () => { if (player) game.removePlayer(player); });
  ws.on('error', () => {});
});

server.listen(PORT, () => {
  console.log(`T4C-Web : http://localhost:${PORT}  (max ${256} joueurs)`);
});

// Ctrl-C : arrêt gracieux avec décompte pour les joueurs (45 s par défaut).
// Un second Ctrl-C (volontaire) force l'arrêt immédiat, avec sauvegarde.
//
// Subtilité : lancé via `npm start`, un seul Ctrl-C délivre SIGINT à tout le
// groupe de processus (npm + node), et npm peut re-signaler son enfant en
// quittant. On ignore donc les signaux qui arrivent dans la foulée du premier
// (< 1,5 s) : seul un Ctrl-C humain ultérieur force vraiment.
let shutdownAskedAt = 0;
const gracefulOrForce = (signal) => {
  const now = Date.now();
  if (game.shuttingDown) {
    if (now - shutdownAskedAt < 1500) return; // doublon npm/groupe de processus
    console.log(`Arrêt forcé (${signal}).`);
    game.saveAll();
    process.exit(0);
  }
  shutdownAskedAt = now;
  game.beginShutdown(parseInt(process.env.T4C_SHUTDOWN_SECS || '45', 10));
};
process.on('SIGINT', () => gracefulOrForce('SIGINT'));
process.on('SIGTERM', () => gracefulOrForce('SIGTERM'));
