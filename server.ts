import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import { createApp, ensureReady } from './server/app.ts';
import { getUserById, verifyToken } from './server/auth.ts';

const PORT = Number(process.env.PORT) || 3000;
const userSockets = new Map<string, Set<WebSocket>>();

function pushToUser(userId: string, event: unknown) {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  const payload = JSON.stringify(event);
  for (const sock of sockets) {
    if (sock.readyState === WebSocket.OPEN) {
      sock.send(payload);
    }
  }
}

const app = createApp({ pushToUser, wsEnabled: true });
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (url.pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    if (process.env.NODE_ENV === 'production') {
      socket.destroy();
    }
  }
});

wss.on('connection', (ws) => {
  let authedUserId: string | null = null;

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as { type?: string; token?: string };
      if (msg.type === 'auth' && typeof msg.token === 'string') {
        const uid = verifyToken(msg.token);
        if (uid) {
          const user = await getUserById(uid);
          if (user && user.status === 'active') {
            authedUserId = uid;
            if (!userSockets.has(uid)) userSockets.set(uid, new Set());
            userSockets.get(uid)!.add(ws);
            ws.send(JSON.stringify({ type: 'auth:ok', userId: uid }));
          }
        }
      }
    } catch {
      // ignore malformed ws frames
    }
  });

  ws.on('close', () => {
    if (authedUserId && userSockets.has(authedUserId)) {
      userSockets.get(authedUserId)!.delete(ws);
      if (userSockets.get(authedUserId)!.size === 0) {
        userSockets.delete(authedUserId);
      }
    }
  });
});

async function startServer() {
  await ensureReady();

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.all('/api/*', (_req, res) => {
      res.status(404).json({ error: 'API route not found' });
    });
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Orvexa marketplace server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Orvexa server:', err);
  process.exit(1);
});
