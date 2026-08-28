'use strict';

const js = require('@eslint/js');
const globals = require('globals');

/**
 * Flat ESLint config for the backend (Node/CommonJS). ESLint's flat config only
 * lints files under its own directory, so the browser frontend in ../web is
 * syntax-checked separately by `npm run lint:web`.
 */
module.exports = [
  { ignores: ['node_modules/**'] },

  // Backend — Node, CommonJS.
  {
    files: ['src/**/*.js', 'scripts/**/*.js', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
      'no-console': 'off', // the logger writes through console on purpose
    },
  },

  // ES-module test files use import/export.
  {
    files: ['test/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
