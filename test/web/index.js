const test = require('ava');

const utils = require('../utils');

const config = require('#config');

test.before(utils.setupMongoose);
test.after.always(utils.teardownMongoose);
test.beforeEach(utils.setupWebServer);

test('redirects to correct locale', async (t) => {
  const { web } = t.context;
  const res = await web.get('/');
  t.is(res.status, 301);
  t.is(res.headers.location, '/en');
});

test('returns English homepage', async (t) => {
  const { web } = t.context;
  const res = await web.get('/en').set({ Accept: 'text/html' });

  t.snapshot(res.text);
});

test('returns Spanish homepage', async (t) => {
  const { web } = t.context;
  const res = await web.get('/es').set({ Accept: 'text/html' });

  t.snapshot(res.text);
});

test('returns English ToS', async (t) => {
  const { web } = t.context;
  const res = await web.get('/en/terms').set({ Accept: 'text/html' });

  t.snapshot(res.text);
});

test('returns Spanish ToS', async (t) => {
  const { web } = t.context;
  const res = await web.get('/es/terms').set({ Accept: 'text/html' });

  t.snapshot(res.text);
});

test('GET /:locale/about', async (t) => {
  const { web } = t.context;
  const res = await web.get('/en/about');

  t.is(res.status, 200);
  t.assert(res.text.includes('About'));
});

test('GET /:locale/404', async (t) => {
  const { web } = t.context;
  const res = await web.get('/en/404');

  t.is(res.status, 404);
  t.assert(res.text.includes('Not Found'));
});

test('GET /:locale/privacy', async (t) => {
  const { web } = t.context;
  const res = await web.get('/en/privacy');

  t.is(res.status, 200);
  t.assert(res.text.includes('Privacy Policy'));
});

test('GET /:locale/help', async (t) => {
  const { web } = t.context;
  const res = await web.get('/en/help');
  t.is(res.status, 302);
  t.is(res.header.location, '/en/login');
});

// fetches all pages from sitemap
// TODO: if you change this then also change sitemap controller
const keys = Object.keys(config.meta).filter((key) => {
  // exclude certain pages from sitemap
  // (e.g. 401 not authorized)
  if (
    [
      '/admin',
      '/my-account',
      '/help',
      '/auth',
      '/logout',
      '/denylist',
      '/reset-password',
      config.verifyRoute,
      config.otpRoutePrefix
    ].includes(key)
  )
    return false;
  if (key.startsWith('/admin') || key.startsWith('/my-account')) return false;
  return key;
});

for (const key of keys) {
  const route = `/en${key === '/' ? '' : key}`;
  test(`GET ${route}`, async (t) => {
    const { web } = t.context;
    const res = await web.get(route);
    t.is(res.status, 200);
  });
}
