import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { initDatabase } from './server/db.ts';
import { AuctionEngine } from './server/auctionEngine.ts';
import { createApiRouter } from './server/routes.ts';
import { attachSocketServer } from './server/socket.ts';

export async function createAppServer(options?: { dbPath?: string; attachVite?: boolean }) {
  const db = initDatabase(options?.dbPath);
  const engine = new AuctionEngine(db);

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));

  app.use('/api', createApiRouter(engine));

  const httpServer = http.createServer(app);
  const io = attachSocketServer(httpServer, engine);
  engine.startTimerLoop(250);

  const isProd = process.env.NODE_ENV === 'production';
  const shouldAttachVite = options?.attachVite ?? !isProd;

  if (shouldAttachVite) {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (isProd) {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return { app, httpServer, io, engine, db };
}

const isMainModule =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isMainModule) {
  const PORT = Number(process.env.PORT || 3000);
  createAppServer().then(({ httpServer }) => {
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`TECH AUCTION server listening on http://0.0.0.0:${PORT}`);
    });
  });
}
