import { defineConfig } from 'vite';
import path from 'path';
import fs from 'fs';

const VOICE_DIR = path.resolve(__dirname, '..', 'voice');

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  plugins: [
    {
      name: 'voice-files',
      configureServer(server) {
        server.middlewares.use('/voice/', (req, res, next) => {
          let relPath;
          try { relPath = decodeURIComponent(req.url).replace(/^\/voice\//, ''); } catch { relPath = req.url.replace(/^\/voice\//, ''); }
          // Security: prevent path traversal
          const safePath = path.normalize(relPath).replace(/^[/\\]+/, '');
          const filePath = path.join(VOICE_DIR, safePath);
          if (!filePath.startsWith(VOICE_DIR)) {
            res.statusCode = 403;
            res.end('Forbidden');
            return;
          }
          if (fs.existsSync(filePath)) {
            const ext = path.extname(filePath).toLowerCase();
            const mime = ext === '.wav' ? 'audio/wav' : 'audio/wav';
            res.setHeader('Content-Type', mime);
            res.setHeader('Accept-Ranges', 'bytes');
            fs.createReadStream(filePath).pipe(res);
          } else {
            next();
          }
        });
      },
    },
  ],
});
