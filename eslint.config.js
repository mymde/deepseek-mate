import js from '@eslint/js'
import globals from 'globals'

export default [
  {
    ignores: ['node_modules/**', 'public/**', 'desktop/vendor/**', 'test/shots/**', '.npm-cache/**']
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      // Test scripts also run snippets inside a browser page (page.evaluate), so the
      // browser globals are available everywhere; the pet code relies on both.
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': 'off',
      'no-constant-condition': ['error', { checkLoops: false }]
    }
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' }
  }
]
