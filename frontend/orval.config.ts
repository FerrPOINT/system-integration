import { defineConfig } from 'orval';
import { writeFile } from 'node:fs/promises';

type TextRule = { maxLength: number; pattern: string };
let formRules:
  | {
      Title: TextRule;
      ActionReason: TextRule;
      Reference: { prefix: string; numberPattern: string };
      Quantity: { minimum: number; maximum: number };
      Username: TextRule;
    }
  | undefined;

export default defineConfig({
  internalApi: {
    input: {
      target: '../contracts/internal-api.openapi.yaml',
      override: {
        transformer(spec) {
          const textRules: Record<string, TextRule> = {};
          for (const name of ['Title', 'ActionReason']) {
            const schema = spec.components?.schemas?.[name];
            if (
              !schema ||
              !('maxLength' in schema) ||
              typeof schema.maxLength !== 'number' ||
              !('pattern' in schema) ||
              typeof schema.pattern !== 'string'
            )
              throw new Error('Missing form constraints: ' + name);
            textRules[name] = { maxLength: schema.maxLength, pattern: schema.pattern };
          }
          const input = spec.components?.schemas?.OperationInput;
          if (!input || !('properties' in input)) throw new Error('Missing OperationInput constraints');
          const reference = input.properties?.reference;
          const quantity = input.properties?.quantity;
          const referenceParts =
            reference && 'pattern' in reference && typeof reference.pattern === 'string'
              ? /^\^([A-Z]+-)(\[0-9\]\{[1-9][0-9]*\})\$$/.exec(reference.pattern)
              : null;
          if (!referenceParts) throw new Error('Expected a fixed request reference prefix and a digit pattern');
          const [, prefix, numberPattern] = referenceParts;
          if (
            !quantity ||
            !('minimum' in quantity) ||
            !('maximum' in quantity) ||
            typeof quantity.minimum !== 'number' ||
            typeof quantity.maximum !== 'number'
          )
            throw new Error('Missing request quantity bounds');
          const body = spec.paths?.['/api/login']?.post?.requestBody;
          if (!body || !('content' in body)) throw new Error('Missing login request');
          const login = body.content['application/x-www-form-urlencoded']?.schema;
          if (!login || !('properties' in login)) throw new Error('Missing login schema');
          const username = login.properties?.username;
          if (
            !username ||
            !('maxLength' in username) ||
            !('pattern' in username) ||
            typeof username.maxLength !== 'number' ||
            typeof username.pattern !== 'string'
          )
            throw new Error('Missing username constraints');
          formRules = {
            Title: textRules.Title,
            ActionReason: textRules.ActionReason,
            Reference: { prefix, numberPattern },
            Quantity: { minimum: quantity.minimum, maximum: quantity.maximum },
            Username: { maxLength: username.maxLength, pattern: username.pattern },
          };
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
        if (!formRules) throw new Error('Form constraints were not read from OpenAPI');
        await writeFile(
          'build/generated/openapi/form-rules.ts',
          '// Generated from internal-api.openapi.yaml. Do not edit.\nexport const formRules = ' +
            JSON.stringify(formRules, null, 2) +
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
