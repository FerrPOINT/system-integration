import babelParser from '@babel/eslint-parser';
import hooks from 'eslint-plugin-react-hooks';
import query from '@tanstack/eslint-plugin-query';
import importX from 'eslint-plugin-import-x';

const generatedClient = {
  regex: '(?:^|/)build/generated/',
  allowTypeImports: true,
  message: 'Use the feature API for requests; importing generated DTO types is allowed.',
};

export default [
  { ignores: ['build/**', 'dist/**', 'node_modules/**'] },
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}', 'architecture-fixtures/**/*.{ts,tsx}'],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: { babelrc: false, configFile: false, parserOpts: { plugins: ['typescript', 'jsx'] } },
      },
    },
    plugins: { 'react-hooks': hooks, '@tanstack/query': query, 'import-x': importX },
    settings: {
      'import-x/resolver': { node: { extensions: ['.js', '.ts', '.tsx'] } },
      'import-x/parsers': { '@babel/eslint-parser': ['.ts', '.tsx'] },
      'import-x/extensions': ['.js', '.ts', '.tsx'],
    },
    rules: {
      ...hooks.configs.flat.recommended.rules,
      '@tanstack/query/exhaustive-deps': 'error',
      '@tanstack/query/no-rest-destructuring': 'error',
      '@tanstack/query/stable-query-client': 'error',
      '@tanstack/query/no-unstable-deps': 'error',
      'import-x/no-cycle': 'error',
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/shared',
              from: ['./src/app', './src/features'],
              message: 'Shared cannot depend on application composition or scenarios.',
            },
            {
              target: './src/features',
              from: './src/app',
              message: 'Features own their behavior; app only composes them.',
            },
            { target: './src/features/tasks', from: './src/features/operations', except: ['./reconciliation.ts'] },
            {
              target: './src/features/operations',
              from: './src/features/tasks',
              except: ['./api/task-keys.ts', './model/task-labels.ts'],
            },
            { target: './src/features/auth', from: ['./src/features/tasks', './src/features/operations'] },
            { target: ['./src/features/tasks', './src/features/operations'], from: './src/features/auth' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/app/**/*.{ts,tsx}', 'src/shared/**/*.{ts,tsx}', 'src/features/*/{model,ui}/**/*.{ts,tsx}'],
    ignores: ['src/shared/api/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [generatedClient] }],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression[source.value=/build\\/generated\\//]',
          message: 'Dynamic generated requests also belong to the feature API.',
        },
      ],
    },
  },
  {
    // The URL parser reads the canonical enum; it still cannot call generated APIs.
    files: ['src/features/tasks/model/task-search.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ ...generatedClient, allowImportNames: ['BusinessStatus'] }] }],
    },
  },
];
