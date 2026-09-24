import { build } from 'esbuild';
import { cp, mkdir, rm, copyFile, readFile, writeFile } from 'node:fs/promises';

const requiredFiles = ['index.html', 'styles.css', 'app.js', 'odr-logo.svg', 'auth-molecule-bg.webp', 'italy-map.svg'];
const outputDirectories = ['dist', 'public'];
const appRouteFiles = [
  'dashboard',
  'gestione-store-locator',
  'shop',
  'profilo',
  'codici',
  'promozioni',
  'rete',
  'clienti',
  'clienti-fatturato',
  'ordini',
  'wordpress',
  'report',
  'utenti',
  'permessi',
  'impostazioni',
  'recupera-password',
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

  for (const file of ['index.html', 'styles.css', 'odr-logo.svg', 'auth-molecule-bg.webp', 'italy-map.svg']) {
    await copyFile(file, `${directory}/${file}`);
  }
  await copyFile('manifest.webmanifest', `${directory}/manifest.webmanifest`);
  await cp('app-icons', `${directory}/app-icons`, { recursive: true });
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

  await copyFile('store-locator/public.html', `${directory}/store-locator.html`);
  await build({entryPoints:['store-locator/public.js'],bundle:true,format:'iife',minify:true,outfile:`${directory}/locator-public.js`,platform:'browser',target:['es2020']});
  const mapCss = await Promise.all(['node_modules/leaflet/dist/leaflet.css','node_modules/leaflet.markercluster/dist/MarkerCluster.css','node_modules/leaflet.markercluster/dist/MarkerCluster.Default.css','store-locator/styles.css'].map(path=>readFile(path,'utf8')));
  await writeFile(`${directory}/locator.css`,mapCss.join('\n'));
  await cp('node_modules/leaflet/dist/images',`${directory}/images`,{recursive:true});

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
