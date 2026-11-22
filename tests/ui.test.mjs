// Static checks that keep the HUD markup, the controller and the shipped assets in step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf8');

const html = read('index.html');
const main = read('src/main.js');
const css = read('src/style.css');
const icons = read('src/icons.js');

test('every element id the controller looks up exists in index.html', () => {
  const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const wanted = new Set([...main.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
  assert.ok(wanted.size > 20, 'expected the controller to reference many ids');
  for (const id of wanted) {
    assert.ok(htmlIds.has(id), `index.html is missing #${id}`);
  }
});

test('every data-icon and icon() call names a defined icon', () => {
  const defined = new Set([...icons.matchAll(/^\s{2}(\w+): '/gm)].map((m) => m[1]));
  const used = new Set([
    ...[...html.matchAll(/data-icon="([^"]+)"/g)].map((m) => m[1]),
    ...[...main.matchAll(/icon\(([^)]+)\)/g)].flatMap((m) => [...m[1].replace(/===\s*'\w+'/g, '').matchAll(/'(\w+)'/g)].map((n) => n[1])),
  ]);
  assert.ok(used.size > 8);
  for (const name of used) {
    assert.ok(defined.has(name), `icons.js has no "${name}" icon`);
  }
});

test('self-hosted fonts referenced by the stylesheet and preloads are shipped', () => {
  const cssFonts = [...css.matchAll(/url\("\.\/(fonts\/[^"]+)"\)/g)].map((m) => `src/${m[1]}`);
  const preloads = [...html.matchAll(/href="\.\/(src\/fonts\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(cssFonts.length >= 4);
  for (const rel of [...cssFonts, ...preloads]) {
    assert.ok(existsSync(new URL(rel, root)), `missing font file ${rel}`);
  }
});

test('the diagonal pad covers the four isometric directions', () => {
  const vecs = [...html.matchAll(/class="dir-btn" data-sx="(-?1)" data-sy="(-?1)"/g)].map((m) => `${m[1]},${m[2]}`);
  assert.deepEqual(new Set(vecs), new Set(['-1,-1', '1,-1', '-1,1', '1,1']));
});
