import { defineConfig } from 'vitest/config'

// better-sqlite3 v13 ships N-API prebuilds, which load under plain Node as well as Electron,
// so no separate Node-ABI copy is needed. Tests are plain Node (no Electron imports).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/main/**/*.test.ts']
  }
})
