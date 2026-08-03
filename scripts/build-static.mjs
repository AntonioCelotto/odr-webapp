import { build } from 'esbuild';
import { cp, mkdir, rm, copyFile, readFile, writeFile } from 'node:fs/promises';

const requiredFiles = ['index.html', 'styles.css', 'app.js', 'odr-logo.svg'];
const outputDirectories = ['dist', 'public'];
const appRouteFiles = [
  'dashboard',
  'shop',
  'profilo',
  'codici',
  'promozioni',
  'rete',
  'wordpress',
  'report',
  'utenti',
  'permessi',
  'impostazioni',
];
const publicConfig = {
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || '',
  wooBaseUrl: process.env.WOOCOMMERCE_STORE_URL || 'https://odr.ioxina.com',
};

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

  for (const file of ['index.html', 'styles.css', 'odr-logo.svg']) {
    await copyFile(file, `${directory}/${file}`);
  }
  await cp('product-images', `${directory}/product-images`, { recursive: true });
  for (const route of appRouteFiles) {
    await copyFile('index.html', `${directory}/${route}.html`);
  }

  await build({
    entryPoints: ['app.js'],
    bundle: true,
    format: 'iife',
    minify: true,
    outfile: `${directory}/app.js`,
    platform: 'browser',
    target: ['es2020'],
  });

  await writeFile(
    `${directory}/config.js`,
    `window.__ODR_CONFIG__ = ${JSON.stringify(publicConfig)};\n`,
    'utf8',
  );

  await writeFile(
    `${directory}/_redirects`,
    '/* /index.html 200\n',
    'utf8',
  );
}

console.log('ODR static build created in dist/ and public/.');
