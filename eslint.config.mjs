import fs from 'node:fs';
import { Linter } from 'eslint';
import globals from 'globals';

// Classic scripts, in the order loaded by each active HTML page.
const script = (file) => `web/scripts/${file}`;
const pages = [
  [
    'editor_groups.js', 'draft_manager.js', 'editor_recovery.js', 'common.js', 'inventory_ui.js',
    'map_geometry.js', 'shelf_model.js', 'explorer.js', 'map_editor.js',
    'lab_tools.js', 'map_elements.js', 'lab.js',
  ].map(script),
  [
    'shelf_model.js', 'editor_groups.js', 'draft_manager.js', 'editor_recovery.js',
    'common.js', 'inventory_ui.js', 'map_geometry.js', 'explorer.js', 'shelf_decor.js', 'shelf.js',
  ].map(script),
];
pages.push(['editor_groups.js', 'draft_manager.js', 'editor_recovery.js', 'common.js', 'shelf_model.js', 'inventory_ui.js', 'inventory_list.js'].map(script));
pages.push(['dashboards.js'].map(script));
const files = [...new Set(pages.flat())];

// Derive only actual top-level declarations, never unresolved references.
// This keeps no-undef useful without a hand-maintained list of shared names.
const parser = new Linter();
const declarations = Object.fromEntries(files.map((file) => {
  const messages = parser.verify(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'script' },
  });
  if (messages.some((message) => message.fatal)) {
    throw new Error(`Cannot read shared declarations from ${file}: ${messages[0].message}`);
  }
  const variables = parser.getSourceCode().scopeManager.globalScope.variables;
  return [file, Object.fromEntries(variables.filter((variable) => variable.defs.length).map((variable) => [
    variable.name,
    variable.defs[0].parent?.kind === 'const' ? 'readonly' : 'writable',
  ]))];
}));

const rules = {
  'no-undef': 'error',
  'no-global-assign': 'error',
  'no-dupe-args': 'error',
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-unreachable': 'error',
  'no-invalid-regexp': 'error',
  'valid-typeof': 'error',
};

export default [
  {
    ignores: [
      'data/**', 'defaults/**', 'web/pages/shelf_inventory_editor.html',
      '.venv/**', 'node_modules/**', '**/__pycache__/**',
      'vendor/**', 'dist/**', 'coverage/**',
    ],
  },
  ...files.map((file) => ({
    files: [file],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globals.browser,
        // Shared helpers may execute in either page; page-specific scripts
        // receive declarations only from scripts loaded alongside them.
        ...Object.assign({}, ...pages.filter((page) => page.includes(file))
          .flatMap((page) => page.filter((peer) => peer !== file))
          .map((peer) => declarations[peer])),
        // Local lexical declarations can shadow browser properties (history).
        ...declarations[file],
      },
    },
    rules,
  })),
  {
    files: ['eslint.config.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
    rules,
  },
];
