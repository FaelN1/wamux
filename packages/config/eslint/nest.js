// @ts-check
import base from './base.js';

/**
 * ESLint flat config para NestJS (apps/api).
 */
export default [
  ...base,
  {
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      // Decorators + emitDecoratorMetadata quebram se um Service injetado virar
      // `import type` (o metadata some). Deixamos a regra desligada no back.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
