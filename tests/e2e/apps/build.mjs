/**
 * Bundles the framework test apps into `tests/e2e/apps/dist/`.
 *
 * These are real framework builds, not mock-ups: React 19 with controlled
 * components, Vue 3 with the runtime template compiler so `v-model` codegen runs,
 * and Angular 18 JIT-compiled in the browser. The point is to exercise each
 * framework's own value-tracking and change-detection path against FormPilot's
 * DOM writes, which jsdom fixtures cannot do.
 *
 * Run: node tests/e2e/apps/build.mjs
 */
import { build } from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'dist');

/** Shared page chrome. Plain and unstyled; the engine reads structure, not CSS. */
function shell(title, bundle, notes, mount = '<div id="root"></div>') {
  return `<!doctype html>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; }
  label { display: block; margin-top: 0.75rem; font-weight: 500; }
  input[type="text"], input[type="email"], input[type="tel"], select, textarea {
    display: block; width: 100%; padding: 0.4rem; margin-top: 0.2rem;
  }
  fieldset { margin-top: 1rem; }
  fieldset label, label > input[type="checkbox"], label > input[type="radio"] { display: inline-block; font-weight: 400; }
  .note { background: #fffbe6; border-left: 4px solid #d4a017; padding: 0.75rem; margin-bottom: 1.5rem; font-size: 0.9rem; }
  /* Custom widgets: enough layout that options are visible and clickable, and no more. */
  .field { margin-top: 0.75rem; }
  .field .label { display: block; font-weight: 500; }
  [role="listbox"] { border: 1px solid #999; padding: 0.4rem; cursor: pointer; }
  .options { border: 1px solid #ccc; border-top: 0; }
  [role="option"] { padding: 0.3rem 0.4rem; cursor: pointer; }
  [role="option"]:hover { background: #eef; }
  [role="checkbox"], [role="radio"] { display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0; cursor: pointer; }
  [role="checkbox"] .box, [role="radio"] .box { width: 14px; height: 14px; border: 2px solid #555; display: inline-block; }
  [role="radio"] .box { border-radius: 50%; }
  [aria-checked="true"] .box { background: #4f7cff; border-color: #4f7cff; }
</style>
<p class="note">${notes}</p>
${mount}
<script type="module" src="./${bundle}"></script>
`;
}

const common = {
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"development"' },
};

await mkdir(outDir, { recursive: true });

await build({
  ...common,
  entryPoints: [join(here, 'react/app.jsx')],
  outfile: join(outDir, 'react.js'),
  jsx: 'automatic',
});

await build({
  ...common,
  entryPoints: [join(here, 'react-widgets/app.jsx')],
  outfile: join(outDir, 'react-widgets.js'),
  jsx: 'automatic',
});

await build({
  ...common,
  entryPoints: [join(here, 'vue/app.js')],
  outfile: join(outDir, 'vue.js'),
  define: {
    ...common.define,
    __VUE_OPTIONS_API__: 'true',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
});

await build({
  ...common,
  entryPoints: [join(here, 'angular/app.ts')],
  outfile: join(outDir, 'angular.js'),
  tsconfig: join(here, 'tsconfig.apps.json'),
});

const NOTE =
  'Local test app built for FormPilot end-to-end validation. Not a real application and not connected to any service; ' +
  'it never submits anywhere.';

await writeFile(
  join(outDir, 'react.html'),
  shell('React controlled form', 'react.js', `React 19, every input controlled by component state. ${NOTE}`),
);
await writeFile(
  join(outDir, 'react-widgets.html'),
  shell(
    'React custom widgets',
    'react-widgets.js',
    'React 19: uncontrolled inputs, a select and boolean controls built from divs, and fields whose ' +
      `label and input live in different components. ${NOTE}`,
  ),
);
await writeFile(
  join(outDir, 'vue.html'),
  shell('Vue controlled form', 'vue.js', `Vue 3 with <code>v-model</code> on every control. ${NOTE}`),
);
await writeFile(
  join(outDir, 'angular.html'),
  shell(
    'Angular controlled form',
    'angular.js',
    `Angular 18, JIT-compiled: template-driven <code>ngModel</code> plus a reactive <code>FormGroup</code>. ${NOTE}`,
    // Angular bootstraps into its component's own selector, not an arbitrary div.
    '<app-root></app-root>',
  ),
);

const sizes = await Promise.all(
  ['react.js', 'react-widgets.js', 'vue.js', 'angular.js'].map(async (name) => {
    const bytes = (await readFile(join(outDir, name))).byteLength;
    return `${name} ${(bytes / 1024).toFixed(0)} KiB`;
  }),
);
console.log(`built ${sizes.join(', ')} into tests/e2e/apps/dist`);
