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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const game = new Game();
const wss = new WebSocketServer({ server, maxPayload: 4096 });

wss.on('connection', (ws) => {
  let player = null;

  ws.on('message', (raw, isBinary) => {
    if (isBinary) return;
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (!player) {
      if (msg.t === 'register' || msg.t === 'login') {
        const res = msg.t === 'register' ? db.register(msg.name, msg.pass) : db.login(msg.name, msg.pass);
        if (res.error) { ws.send(JSON.stringify({ t: 'auth_error', error: res.error })); return; }
        const joined = game.addPlayer(ws, res.accountId, res.name, res.isAdmin);
        if (joined.error) { ws.send(JSON.stringify({ t: 'auth_error', error: joined.error })); return; }
        player = joined.player;
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

process.on('SIGINT', () => { game.saveAll(); process.exit(0); });
