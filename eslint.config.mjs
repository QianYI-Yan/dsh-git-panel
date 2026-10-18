// Flat config for the architecture guardrails (see docs/adr/0017 + the plan's
// T0.2). Scope is deliberately narrow: the two classic hooks rules that the
// four pre-existing `eslint-disable-next-line react-hooks/exhaustive-deps`
// comments were suppressing, plus typescript-eslint's recommended set.
//
// `eslint-plugin-react-hooks@7` also ships React-Compiler rules
// (set-state-in-effect / refs / immutability / static-components …). They are
// NOT enabled here: adopting them is a separate, deliberate change with a large
// blast radius on a 166-useState codebase, and a lint gate that is red on day
// one is a gate nobody keeps.
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  {
    // `lib/` is committed build output; `test/e2e/*.js` are vendored fixtures
    // copied in by `test/e2e/setup.mjs`; `docs/` and `.agents/` are not code.
    ignores: [
      'lib/**',
      'node_modules/**',
      'docs/**',
      '.agents/**',
      'test/e2e/*.js',
      'test/e2e/harness.html',
    ],
  },

  // TypeScript sources: non-type-checked recommended set. Type-checked linting
  // would need a tsconfig that covers the .mjs tests too, and `npm run
  // typecheck` already covers src/ strictly (noUnusedLocals, noImplicitAny).
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    extends: [...tseslint.configs.recommended],
    rules: {
      // `_name` marks a value deliberately dropped by a rest-destructure
      // (`const { checkedAt: _checkedAt, ...state }`) — the idiom used to
      // exclude fields from the snapshot fingerprint.
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_' }],
    },
  },

  // Test scripts: ESM only, no TS surface. Keep them parseable but do not
  // impose TS rules on plain node:test files.
  {
    files: ['test/**/*.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
  },

  // The client half runs the hooks rules; host code has no React.
  {
    files: ['src/client/**/*.ts', 'src/client/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // Warn, not error: the project already suppresses 4 of these, and the
      // data-flow contract (AGENTS.md「数据流铁律」) requires some deps stay
      // out on purpose. Turning it into an error would push people to add
      // snapshot/checkedAt to dep arrays, which breaks the refresh contract.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
)
