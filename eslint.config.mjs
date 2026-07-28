import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import nextPlugin from '@next/eslint-plugin-next'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'src/generated/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },

  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
      '@typescript-eslint/no-explicit-any': 'warn',

      /**
       * Architectural guard rails — docs/01 §1.2 and docs/05 §5.1.
       * These encode two guarantees that would otherwise decay into convention.
       */

      // 1. Authorization never branches on role identity.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'BinaryExpression[operator=/^(===|!==|==|!=)$/] > MemberExpression[property.name=/^(role|roleKey|roleName)$/]',
          message:
            'Never branch on role identity. Use can(ctx, PERMISSIONS.x, scope) — see docs/05-authorization.md.',
        },
        {
          selector: 'CallExpression[callee.property.name="$queryRaw"]',
          message:
            'Raw queries are restricted to the migration runner and search service. Use Prisma query methods.',
        },
      ],

      // 2. Prisma is imported only where the data layer lives.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@prisma/client',
              importNames: ['PrismaClient'],
              message:
                'Import the shared client from @/lib/db/prisma instead of constructing a new PrismaClient.',
            },
          ],
        },
      ],
    },
  },

  // The data layer is allowed to construct the client.
  {
    files: ['src/lib/db/**', 'prisma/**', 'scripts/**'],
    rules: { 'no-restricted-imports': 'off' },
  },

  // The domain layer must stay pure: no framework, no database, no I/O.
  {
    files: ['src/domain/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@prisma/client', 'next', 'next/*', 'react', 'react-dom', '@/lib/db/*'],
              message:
                'src/domain must stay pure — no Prisma, React or Next imports. Move I/O to a service.',
            },
          ],
        },
      ],
    },
  },

  // Seeds, scripts and tests get more latitude.
  {
    files: ['prisma/**', 'scripts/**', 'tests/**', '*.config.{ts,mjs,js}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },

  prettier,
)
