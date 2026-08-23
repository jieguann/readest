import path from 'node:path';
import { sites } from '@openai/sites-vite-plugin';
import vinext from 'vinext';
import { defineConfig } from 'vite';

const localBindingConfig = {
  main: './worker/index.ts',
};

export default defineConfig(async () => {
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
    ],
    environments: {
      rsc: {
        resolve: {
          external: [],
          noExternal: true,
        },
      },
      ssr: {
        resolve: {
          external: [],
          noExternal: true,
        },
      },
    },
    resolve: {
      alias: {
        '@/components/ui': path.resolve('src/components/primitives'),
        '@': path.resolve('src'),
        '@pdfjs': path.resolve('public/vendor/pdfjs'),
        '@simplecc': path.resolve('public/vendor/simplecc'),
        fflate: path.resolve('node_modules/fflate'),
        'js-mdict': path.resolve('../../packages/js-mdict/src/index.ts'),
        'tauri-plugin-turso': path.resolve('src-tauri/plugins/tauri-plugin-turso/guest-js'),
      },
    },
    build: {
      rollupOptions: {
        onwarn(warning, defaultHandler) {
          if (warning.message?.includes("Can't resolve original location of error")) return;
          defaultHandler(warning);
        },
      },
    },
    worker: {
      format: 'es',
    },
  };
});
