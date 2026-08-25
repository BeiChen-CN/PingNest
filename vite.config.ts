import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'path'

export default defineConfig(({ mode }) => ({
  base: './',
  server: {
    port: 3000,
    strictPort: false
  },
  build: {
    chunkSizeWarningLimit: 900,
    commonjsOptions: {
      ignoreDynamicRequires: true
    }
  },
  plugins: [
    react(),
    ...(mode === 'web' ? [] : [electron([
      {
        entry: 'electron/main.ts',
        onstart: (options) => options.reload(),
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['koffi']
            }
          }
        }
      },
      {
        entry: 'electron/dbWorker.ts',
        onstart: (options) => options.reload(),
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['koffi']
            }
          }
        }
      },
      {
        entry: 'electron/keyWorker.ts',
        onstart: (options) => options.reload(),
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['koffi']
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        onstart: (options) => options.reload(),
        vite: {
          build: {
            outDir: 'dist-electron'
          }
        }
      }
    ]), renderer()])
  ],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
}))
