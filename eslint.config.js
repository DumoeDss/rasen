import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    files: [
      'src/**/*.ts',
      'test/**/*.ts',
      'vitest.config.ts',
      'vitest.setup.ts',
    ],
    extends: [...tseslint.configs.recommended],
    rules: {
      // Disable rules that need broader cleanup - focus on critical issues only
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-empty': 'off',
      'prefer-const': 'off',
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      // Prevent static imports of @inquirer modules to avoid pre-commit hook hangs.
      // These modules have side effects that can keep the Node.js event loop alive
      // when stdin is piped. Use dynamic import() instead.
      // See: https://github.com/Fission-AI/OpenSpec/issues/367
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@inquirer/*'],
              message:
                'Use dynamic import() for @inquirer modules to prevent pre-commit hook hangs. See #367.',
            },
          ],
        },
      ],
    },
  },
  {
    // init.ts is dynamically imported from cli/index.ts, so static @inquirer
    // imports there are safe - they won't be loaded at CLI startup
    files: ['src/core/init.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', '*.js', '*.mjs'],
  }
);
