import tseslint from 'typescript-eslint';
import globals from 'globals';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default [
  {
    ignores: [
      'node_modules/',
      'dist/',
      'logs/',
      'coverage/',
      'dashboard/**',
      'dashboard/.next/',
      'dashboard/node_modules/',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'scripts/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
];
