import { mkdir, rm, copyFile, readFile, writeFile } from 'node:fs/promises';

const requiredFiles = ['index.html', 'styles.css', 'app.js', 'odr-logo.svg'];
const outputDirectories = ['dist', 'public'];

for (const file of requiredFiles) {
  await readFile(file, 'utf8');
}

const html = await readFile('index.html', 'utf8');
for (const expected of ['/styles.css', '/app.js', '/odr-logo.svg']) {
  if (!html.includes(expected)) {
    throw new Error(`index.html does not reference ${expected}`);
  }
}

for (const directory of outputDirectories) {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });

  for (const file of requiredFiles) {
    await copyFile(file, `${directory}/${file}`);
  }

  await writeFile(
    `${directory}/_redirects`,
    '/* /index.html 200\n',
    'utf8',
  );
}

console.log('ODR static build created in dist/ and public/.');
