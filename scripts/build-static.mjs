import { mkdir, rm, copyFile, readFile, writeFile } from 'node:fs/promises';

const requiredFiles = ['index.html', 'styles.css', 'app.js', 'odr-logo.svg'];

for (const file of requiredFiles) {
  await readFile(file, 'utf8');
}

const html = await readFile('index.html', 'utf8');
for (const expected of ['/styles.css', '/app.js', '/odr-logo.svg']) {
  if (!html.includes(expected)) {
    throw new Error(`index.html does not reference ${expected}`);
  }
}

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });

for (const file of requiredFiles) {
  await copyFile(file, `dist/${file}`);
}

await writeFile(
  'dist/_redirects',
  '/* /index.html 200\n',
  'utf8',
);

console.log('ODR static build created in dist/.');
