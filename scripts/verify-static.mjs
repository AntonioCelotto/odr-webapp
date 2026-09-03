import { access, readFile } from 'node:fs/promises';

const requiredFiles = ['index.html', 'styles.css', 'app.js', 'odr-logo.svg'];
const requiredRoutes = ['dashboard', 'shop', 'clienti', 'ordini', 'report'];

for (const file of requiredFiles) {
  await access(file);
}

for (const route of requiredRoutes) {
  await access(`public/${route}.html`);
}

const html = await readFile('index.html', 'utf8');
for (const expected of ['/styles.css', '/config.js', '/app.js', '/odr-logo.svg']) {
  if (!html.includes(expected)) {
    throw new Error(`index.html does not reference ${expected}`);
  }
}

console.log('ODR static build verified.');
