import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { gzipSync } from 'node:zlib';

export default defineConfig({
  plugins: [react(), {
    name: 'gzip-static-assets',
    apply: 'build',
    enforce: 'post',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        for (const [fileName, asset] of Object.entries(bundle)) {
          if (!fileName.endsWith('.js') && !fileName.endsWith('.css')) continue;
          const source = asset.type === 'chunk' ? asset.code : asset.source;
          this.emitFile({ type: 'asset', fileName: fileName + '.gz', source: gzipSync(source, { level: 9 }) });
        }
      },
    },
  }],
  server: {
    port: 19673,
    proxy: {
      '/api': 'http://127.0.0.1:19680',
    },
  },
});
