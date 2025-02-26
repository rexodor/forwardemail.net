const path = require('node:path');

const Router = require('@koa/router');
const dashify = require('dashify');
const pug = require('pug');
const render = require('koa-views-render');
const { parse } = require('node-html-parser');

const admin = require('./admin');
const auth = require('./auth');
const myAccount = require('./my-account');
const otp = require('./otp');

const config = require('#config');
const policies = require('#helpers/policies');
const rateLimit = require('#helpers/rate-limit');
const { web } = require('#controllers');
const { developerDocs, nsProviders, platforms } = require('#config/utilities');

const router = new Router();

router
  // status page crawlers often send `HEAD /` requests
  .get('/', (ctx, next) => {
    if (ctx.method === 'HEAD') {
      ctx.body = 'OK';
      return;
    }

    return next();
  })
  // sitemap
  .get('/sitemap.xml', web.sitemap)
  // report URI support (not locale specific)
  .post('/report', web.report);

const localeRouter = new Router({ prefix: '/:locale' });

localeRouter
  // add HTTP Link header to GET requests
  // for canonical urls for search engines
  // <https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls#rel-canonical-header-method>
  .use((ctx, next) => {
    if (ctx.method === 'GET')
      ctx.set('Link', `<${config.urls.web}${ctx.path}>; rel="canonical"`);

    return next();
  })
  // svg dynamically generated og images
  // .get('(.*).(png|svg)', web.generateOpenGraphImage)
  .get('(.*).(png)', web.generateOpenGraphImage)
  .get('/', web.auth.homeOrDomains)
  .post(
    '/',
    web.myAccount.retrieveDomains,
    policies.ensureTurnstile,
    rateLimit(50, 'onboard'),
    web.onboard
  )
  // denylist removal (only 5 requests per 24 hours and removal is instant for paid users)
  .get(
    '/denylist',
    policies.ensureLoggedIn,
    policies.ensureOtp,
    web.myAccount.ensureNotBanned,
    render('denylist')
  )
  .post(
    '/denylist',
    policies.ensureLoggedIn,
    policies.ensureOtp,
    web.myAccount.ensureNotBanned,
    policies.ensureTurnstile,
    web.denylist.validate,
    rateLimit(5, 'denylist'),
    web.denylist.remove
  )
  // recipient verification
  .get('/v/:text', web.recipientVerification)
  .get('/dashboard', (ctx) => {
    ctx.status = 301;
    ctx.redirect(ctx.state.l('/my-account'));
  })
  .get('/features', (ctx) => {
    ctx.status = 301;
    ctx.redirect(ctx.state.l('/private-business-email'));
  })
  .get('/pricing', (ctx) => {
    ctx.status = 301;
    ctx.redirect(ctx.state.l('/private-business-email'));
  })
  .get(
    '/private-business-email',
    web.myAccount.retrieveDomains,
    web.myAccount.sortedDomains,
    render('pricing')
  )
  .get('/faq', web.myAccount.retrieveDomains, web.onboard, web.faq)
  .post(
    '/faq',
    web.myAccount.retrieveDomains,
    policies.ensureTurnstile,
    rateLimit(50, 'onboard'),
    web.onboard,
    web.auth.parseReturnOrRedirectTo,
    web.faq
  )
  .get('/api', (ctx) => {
    ctx.status = 301;
    ctx.redirect(ctx.state.l('/email-api'));
  })
  .get('/email-forwarding-api', (ctx) => {
    ctx.status = 301;
    ctx.redirect(ctx.state.l('/email-api'));
  })
  .get('/email-api', web.myAccount.retrieveDomains, web.api)
  .get(
    '/help',
    policies.ensureLoggedIn,
    policies.ensureOtp,
    web.myAccount.ensureNotBanned,
    render('help')
  )
  .post(
    '/help',
    policies.ensureLoggedIn,
    policies.ensureOtp,
    web.myAccount.ensureNotBanned,
    policies.ensureTurnstile,
    rateLimit(3, 'help'),
    web.help
  )
  .get('/about', render('about'))
  .get(
    '/domain-registration',
    web.myAccount.retrieveDomains,
    web.onboard,
    render('domain-registration')
  )
  .get('/free-disposable-addresses', (ctx) => {
    ctx.status = 301;
    ctx.redirect(ctx.state.l('/disposable-addresses'));
  })
  .get(
    '/disposable-addresses',
    web.myAccount.retrieveDomains,
    web.onboard,
    render('disposable-addresses')
  )
  .get(
    '/reserved-email-addresses',
    web.reservedEmailAddresses,
    web.myAccount.retrieveDomains,
    web.onboard,
    render('reserved-email-addresses')
  )
  .get(
    '/free-email-webhooks',
    web.myAccount.retrieveDomains,
    web.onboard,
    render('free-email-webhooks')
  )
  .get(
    '/email-forwarding-regex-pattern-filter',
    web.myAccount.retrieveDomains,
    web.onboard,
    render('email-forwarding-regex-pattern-filter')
  )
  .get('/resources', render('resources'))
  .get('/guides', render('guides'))
  .get('/docs', render('docs'))
  .get('/guides/send-mail-as-using-gmail', (ctx) => {
    ctx.status = 301;
    ctx.redirect(ctx.state.l('/guides/send-mail-as-gmail-custom-domain'));
  })
  .get(
    '/guides/send-email-with-custom-domain-smtp',
    web.guides.sendEmailWithCustomDomainSMTP,
    render('guides/send-email-with-custom-domain-smtp')
  )
  .get(
    '/guides/send-mail-as-gmail-custom-domain',
    web.guides.sendMailAs,
    render('guides/send-mail-as-using-gmail')
  )
  .get(
    '/guides/port-25-blocked-by-isp-workaround',
    web.onboard,
    render('guides/port-25-blocked-by-isp-workaround')
  )
  .get('/donate', (ctx) => {
    ctx.status = 301;
    ctx.redirect(ctx.state.l('/'));
  })
  .get('/terms', render('terms'))
  .get('/report-abuse', render('report-abuse'))
  .get('/privacy', render('privacy'))
  .get('/open-startup', (ctx) => {
    ctx.status = 301;
    ctx.redirect(ctx.state.l('/'));
  })
  .get('/forgot-password', policies.ensureLoggedOut, render('forgot-password'))
  .post(
    '/forgot-password',
    policies.ensureLoggedOut,
    policies.ensureTurnstile,
    rateLimit(10, 'forgot password'),
    web.auth.forgotPassword
  )
  .get(
    '/reset-password/:token',
    policies.ensureLoggedOut,
    render('reset-password')
  )
  .post(
    '/reset-password/:token',
    policies.ensureLoggedOut,
    policies.ensureTurnstile,
    rateLimit(10, 'reset password'),
    web.auth.resetPassword
  )
  .get(
    config.verifyRoute,
    policies.ensureLoggedIn,
    web.auth.parseReturnOrRedirectTo,
    web.auth.verify
  )
  .post(
    config.verifyRoute,
    policies.ensureLoggedIn,
    web.auth.parseReturnOrRedirectTo,
    rateLimit(10, 'verify'),
    web.auth.verify
  )
  .get('/logout', web.auth.logout)
  .get(
    config.loginRoute,
    web.auth.parseReturnOrRedirectTo,
    web.auth.registerOrLogin
  )
  .post(
    config.loginRoute,
    policies.ensureTurnstile,
    rateLimit(50, 'login'),
    web.auth.login
  )
  .get(
    '/register',
    policies.ensureLoggedOut,
    web.auth.parseReturnOrRedirectTo,
    web.auth.registerOrLogin
  )
  .post(
    '/register',
    policies.ensureLoggedOut,
    policies.ensureTurnstile,
    rateLimit(5, 'create user'),
    web.auth.register
  );

for (const doc of developerDocs) {
  localeRouter.get(doc.slug, render(doc.slug.slice(1)));
}

localeRouter.get('/docs/nodejs-spam-filter-contact-form', (ctx) => {
  ctx.status = 301;
  ctx.redirect(ctx.state.l('/docs/best-email-spam-protection-filter'));
});

if (platforms.length > 0)
  localeRouter.get('/open-source', render('open-source'));
for (const platform of platforms) {
  localeRouter.get(
    `/open-source/${dashify(platform)}-email-server`,
    (ctx, next) => {
      ctx.state.platform = platform;
      return next();
    },
    render('open-source')
  );
}

// YouTube warns "site may be harmful" if it has a dot extension
// (e.g. "domains.com" -> "domains-com")
localeRouter.get('/guides/domains.com', (ctx) => {
  ctx.status = 301;
  ctx.redirect(ctx.state.l('/guides/domains-com'));
});
localeRouter.get('/guides/name.com', (ctx) => {
  ctx.status = 301;
  ctx.redirect(ctx.state.l('/guides/name-com'));
});

for (const provider of nsProviders) {
  localeRouter.get(
    `/guides/${provider.slug}`,
    (ctx, next) => {
      // set open graph data
      if (provider.video) ctx.state.video = provider.video;
      if (provider.gif) ctx.state.gif = provider.gif;

      // dynamically load the DNS Management by Registrar table from FAQ
      try {
        const html = pug.renderFile(
          path.join(config.views.root, 'faq', 'index.pug'),
          // make flash a noop so we don't interfere with messages/session
          {
            ...ctx.state,
            flash() {
              return {};
            }
          }
        );

        // expose it to the view
        const root = parse(html);
        ctx.state.modalFAQTable = root.querySelector(
          '#table-dns-management-by-registrar'
        ).outerHTML;
      } catch (err) {
        ctx.logger.error(err);
      }

      return next();
    },
    render('guides/provider')
  );
}

localeRouter.use(myAccount.routes()).use(admin.routes()).use(otp.routes());

router.use(auth.routes()).use(localeRouter.routes());

module.exports = router;
