import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'))

export default defineConfig(({ mode }) => ({
  base: './',
  define: {
    // 渲染层读取应用版本（如"关于"页），与 package.json 保持同源
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
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
