import babelParser from '@babel/eslint-parser';
import hooks from 'eslint-plugin-react-hooks';
import query from '@tanstack/eslint-plugin-query';
import importX from 'eslint-plugin-import-x';

export default [
  { ignores: ['build/**', 'dist/**', 'node_modules/**'] },
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
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
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      '@tanstack/query/exhaustive-deps': 'error',
      '@tanstack/query/no-rest-destructuring': 'error',
      '@tanstack/query/stable-query-client': 'error',
      '@tanstack/query/no-unstable-deps': 'error',
      'import-x/no-cycle': 'error',
    },
  },
];
