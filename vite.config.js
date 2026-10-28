import { defineConfig } from 'vite';

// 相対baseにより、GitHub Pagesの /birthday-calendar-demo/ 配下でも
// HTML、JS、CSS、画像、Manifest、Service Workerを同じサブパスから読み込みます。
export default defineConfig(async ({mode}) => ({
  base: './',
  build: { outDir: mode === 'font-lab' ? 'test-artifacts/font-lab' : 'dist', emptyOutDir: true,
    sourcemap: false },
  // 明示的な比較モードのみ有効。本番クライアントのimportグラフに入れない。
  plugins: mode === 'font-lab' ? [(await import('./dev/font-lab/vite-plugin.mjs')).fontLabPlugin()] : [],
}));
