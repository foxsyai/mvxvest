import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig, Plugin } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import svgrPlugin from 'vite-plugin-svgr';

// Which commit and which network a bundle is, written into it so that deploy.sh
// can refuse a build that is not what it is about to publish, and anyone can
// match the live site to a commit (ops audit OPS-03 and OPS-10, 7 Oct 2026).
// The network is read from the config file this very build compiles.
const commit = (() => {
  try {
    return execSync('git rev-parse HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
})();
const network =
  readFileSync('src/config/index.ts', 'utf8').match(
    /environment = EnvironmentsEnum\.(mainnet|devnet|testnet)/
  )?.[1] ?? 'unknown';

// Only mainnet is the public site. Any other build is a test bed and asks
// search engines to leave it out; robots.txt stays open so they can read that.
const buildMarker = (): Plugin => ({
  name: 'mvxvest-build-marker',
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { name: 'mvxvest-commit', content: commit }, injectTo: 'head' },
    { tag: 'meta', attrs: { name: 'mvxvest-network', content: network }, injectTo: 'head' },
    ...(network === 'mainnet'
      ? []
      : [{ tag: 'meta', attrs: { name: 'robots', content: 'noindex, nofollow' }, injectTo: 'head' as const }])
  ],
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.txt', source: `${commit} ${network}\n` });
  }
});

export default defineConfig({
  define: {
    __MVXVEST_COMMIT__: JSON.stringify(commit)
  },
  server: {
    port: Number(process.env.PORT) || 3000,
    strictPort: true,
    host: true,
    https: true,
    watch: {
      usePolling: false,
      useFsEvents: false,
      ignored: ['**/.cache/**']
    },
    hmr: {
      overlay: false
    }
  },
  plugins: [
    buildMarker(),
    react(),
    basicSsl(),
    svgrPlugin({
      svgrOptions: {
        exportType: 'named',
        ref: true,
        titleProp: true,
        svgo: false
      },
      include: '**/*.svg'
    }),
    nodePolyfills({
      globals: { Buffer: true, global: true, process: true }
    })
  ],
  resolve: {    
    tsconfigPaths: true
  },
  css: {
    postcss: './postcss.config.js'
  },
  build: {
    outDir: 'build'
  },
  preview: {
    port: 3002,
    https: true,
    host: 'localhost',
    strictPort: true
  }
});
