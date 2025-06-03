// vite.config.js
import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  // Carrega variáveis de ambiente com base no modo
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    // Define diretório base para build
    base: '/',
    
    // Aliasing para facilitar importações
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@core': resolve(__dirname, 'src/core'),
        '@ui': resolve(__dirname, 'src/ui'),
        '@wasm': resolve(__dirname, 'src/wasm'),
        '@services': resolve(__dirname, 'src/services'),
        '@utils': resolve(__dirname, 'src/utils')
      }
    },
    
    // Define entrada principal
    build: {
      outDir: 'dist',
      sourcemap: mode !== 'production',
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          'service-worker': resolve(__dirname, 'src/service-worker.js')
        },
        output: {
          manualChunks: {
            vendor: ['src/vendor/markdown-it.js', 'src/vendor/dompurify.js'],
            wasm: ['src/wasm/indexeddb-bridge.js']
          }
        }
      },
      minify: mode === 'production',
      target: 'es2018'
    },
    
    // Servidor de desenvolvimento
    server: {
      port: 3000,
      strictPort: true,
      proxy: {
        // Proxy requests para APIs e WebSockets
        '/api': {
          target: env.API_BASE_URL || 'http://localhost:8000',
          changeOrigin: true,
          secure: false
        },
        '/ws': {
          target: env.WS_BASE_URL || 'ws://localhost:8080',
          ws: true,
          changeOrigin: true
        }
      }
    },
    
    // Plugins para otimização
    plugins: [
      // Plugin para substituir variáveis de ambiente
      {
        name: 'html-env-vars',
        transformIndexHtml: {
          enforce: 'pre',
          transform(html) {
            return html.replace(/\{\{([^}]+)\}\}/g, (match, p1) => {
              return env[p1] || '';
            });
          }
        }
      },
      // Helper para Service Worker
      {
        name: 'service-worker',
        apply: 'build',
        enforce: 'post',
        generateBundle(options, bundle) {
          // Adiciona versão de build ao SW para facilitar invalidação
          const buildVersion = new Date().toISOString().replace(/[^0-9]/g, '');
          const html = bundle['index.html'];
          
          if (html) {
            html.source = html.source.toString()
              .replace(/\{\{BUILD_VERSION\}\}/g, buildVersion);
          }
        }
      }
    ],
    
    // Optimizações para produção
    optimizeDeps: {
      exclude: ['wasm/rust_vm']
    },
    
    // Variáveis de ambiente expostas ao cliente
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode),
      'process.env.API_BASE_URL': JSON.stringify(env.API_BASE_URL),
      'process.env.WS_BASE_URL': JSON.stringify(env.WS_BASE_URL),
      'process.env.FLIPAPP_VERSION': JSON.stringify(env.FLIPAPP_VERSION || '1.0.0'),
    }
  };
});