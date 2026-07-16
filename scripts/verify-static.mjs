import { access, readFile } from 'node:fs/promises';

const requiredFiles = ['index.html', 'styles.css', 'app.js', 'odr-logo.svg'];

for (const file of requiredFiles) {
  await access(file);
}

const html = await readFile('index.html', 'utf8');
for (const expected of ['/styles.css', '/app.js', '/odr-logo.svg']) {
  if (!html.includes(expected)) {
    throw new Error(`index.html does not reference ${expected}`);
  }
}

console.log('ODR static build verified.');
