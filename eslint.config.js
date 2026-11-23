const expoConfig = require('eslint-config-expo/flat');
// Declared as a direct devDependency so this require is honest rather than
// reaching into eslint-config-expo's tree. Flat config requires the plugin to
// be registered in the *same* object that sets one of its rules.
const typescriptEslint = require('@typescript-eslint/eslint-plugin');

/**
 * Flat ESLint config (GAP-G2).
 *
 * `eslint-config-expo/flat` already carries the Expo/React/TypeScript rules,
 * the RN globals and the standard ignore list, so this file only adds the two
 * things it cannot know about:
 *
 *  - `proxy/` is a plain Node ESM program (not React Native), so it gets Node
 *    globals instead of browser ones.
 *  - generated output (`dist/`, `.expo/`) is never linted.
 */
module.exports = [
  ...expoConfig,
  {
    ignores: ['dist/**', '.expo/**', 'node_modules/**', 'assets/**'],
  },
  {
    plugins: { '@typescript-eslint': typescriptEslint },
    rules: {
      // The codebase's deliberate convention for "intentionally ignored":
      // `catch (_) {}` on best-effort cleanup, and `_` parameters.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['proxy/**/*.mjs'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        URL: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      // Test files use `any` for fixture objects.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
