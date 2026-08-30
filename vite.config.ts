import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'))

// 渲染层 CSP：dev 放行 HMR 与 React 快速刷新内联引导；构建产物收紧为白名单。
// 头像经由微信 CDN（http/https）加载，img-src 必须放行远程来源。
const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: http: data:",
  "font-src 'self'",
  "connect-src 'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*"
].join('; ')
const PROD_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // 打包后页面运行在 file:// 协议：显式放行 file: 与远程头像来源
  "img-src 'self' file: https: http: data:",
  "font-src 'self' file:",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'none'"
].join('; ')

/** 按构建模式注入 Content-Security-Policy meta（prod 严格白名单，dev 兼容 HMR） */
function cspMetaPlugin(): Plugin {
  return {
    name: 'pingnest-csp-meta',
    transformIndexHtml(_html, ctx) {
      return [{
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: ctx.server ? DEV_CSP : PROD_CSP },
        injectTo: 'head'
      }]
    }
  }
}

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
    cspMetaPlugin(),
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
