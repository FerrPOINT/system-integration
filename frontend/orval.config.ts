import { defineConfig } from 'orval';

export default defineConfig({
  internalApi: {
    input: {
      target: '../contracts/internal-api.openapi.yaml',
      parserOptions: {
        externalRefs: {
          allow: ['./external-exchange.openapi.yaml'],
        },
      },
    },
    output: {
      target: 'build/generated/openapi/client.ts',
      client: 'fetch',
      headers: true,
      clean: true,
      override: {
        mutator: { path: './src/shared/api/http.ts', name: 'http' },
      },
    },
  },
});
