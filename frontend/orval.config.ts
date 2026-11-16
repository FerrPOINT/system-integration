import { defineConfig } from 'orval';
import { writeFile } from 'node:fs/promises';

let textRules: Record<string, { maxLength: number; pattern: string }> | undefined;

export default defineConfig({
  internalApi: {
    input: {
      target: '../contracts/internal-api.openapi.yaml',
      override: {
        transformer(spec) {
          textRules = {};
          for (const name of ['Title', 'ActionReason']) {
            const schema = spec.components?.schemas?.[name];
            if (
              !schema ||
              !('maxLength' in schema) ||
              typeof schema.maxLength !== 'number' ||
              !('pattern' in schema) ||
              typeof schema.pattern !== 'string'
            )
              throw new Error('Missing text constraints: ' + name);
            textRules[name] = { maxLength: schema.maxLength, pattern: schema.pattern };
          }
          return spec;
        },
      },
      parserOptions: {
        externalRefs: {
          allow: ['./external-exchange.openapi.yaml'],
        },
      },
    },
    hooks: {
      afterAllFilesWrite: async () => {
        if (!textRules) throw new Error('Text constraints were not read from OpenAPI');
        await writeFile(
          'build/generated/openapi/text-rules.ts',
          '// Generated from internal-api.openapi.yaml. Do not edit.\nexport const textRules = ' +
            JSON.stringify(textRules, null, 2) +
            ' as const;\n',
        );
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
