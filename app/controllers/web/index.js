const fs = require('node:fs');
const path = require('node:path');
const { Buffer } = require('node:buffer');

const Boom = require('@hapi/boom');
const Meta = require('koa-meta');
const _ = require('lodash');
const humanize = require('humanize-string');
const isSANB = require('is-string-and-not-blank');
const reservedEmailAddressesList = require('reserved-email-addresses-list');
const revHash = require('rev-hash');
const sharp = require('sharp');
const shortID = require('mongodb-short-id');
const titleize = require('titleize');
const { isEmail } = require('validator');

const admin = require('./admin');
const api = require('./api');
const auth = require('./auth');
const faq = require('./faq');
const help = require('./help');
const myAccount = require('./my-account');
const onboard = require('./onboard');
const otp = require('./otp');
const report = require('./report');
const denylist = require('./denylist');
const guides = require('./guides');
const sitemap = require('./sitemap');

const config = require('#config');
const i18n = require('#helpers/i18n');
const logger = require('#helpers/logger');
const { Domains, Aliases } = require('#models');
const { decrypt } = require('#helpers/encrypt-decrypt');

const meta = new Meta(config.meta, logger);

const SVG_STR = fs.readFileSync(
  config.env === 'development'
    ? path.join(__dirname, '..', '..', '..', 'assets', 'img', 'template.svg')
    : path.join(config.buildDir, 'img', 'template.svg'),
  'utf8'
);

function breadcrumbs(ctx, next) {
  const breadcrumbs = _.compact(ctx.path.split('/')).slice(1);
  ctx.state.breadcrumbs = breadcrumbs;

  // TODO: should this titleize(humanize( usage get wrapped with translation?
  // only override the title if the match was not accurate
  if (!config.meta[ctx.pathWithoutLocale])
    ctx.state.meta.title = ctx.request.t(
      breadcrumbs.length === 1
        ? titleize(humanize(breadcrumbs[0]))
        : `${titleize(humanize(breadcrumbs[0]))} - ${titleize(
            humanize(breadcrumbs[1])
          )}`
    );

  return next();
}

function reservedEmailAddresses(ctx, next) {
  ctx.state.reservedEmailAddressesList = reservedEmailAddressesList;
  return next();
}

async function recipientVerification(ctx) {
  //
  // note that we don't throw translated errors here because we never show them to the user
  // we only want them internally for logging purposes if we need to track down an issue
  //
  try {
    if (!isSANB(ctx.params.text))
      throw new Error(config.i18n.phrases.INVALID_EMAIL);

    const text = decrypt(ctx.params.text);
    const [aliasId, recipient] = text.split('|');

    // ensure recipient is a valid email address
    if (!isEmail(recipient)) throw new Error(config.i18n.phrases.INVALID_EMAIL);

    const alias = await Aliases.findById(shortID.shortToLong(aliasId));
    if (!alias) throw new Error(config.i18n.phrases.ALIAS_DOES_NOT_EXIST);

    const domain = await Domains.findById(alias.domain).lean().exec();
    if (!domain)
      throw new Error(config.i18n.phrases.DOMAIN_DOES_NOT_EXIST_ANYWHERE);

    // if the domain is not on a paid plan
    // or if the alias does not require verification then throw error
    if (domain.plan === 'free' || !alias.has_recipient_verification)
      throw new Error(
        config.i18n.phrases.PAID_PLAN_REQUIRED_FOR_RECIPIENT_VERIFICATION
      );

    // if the recipient is not listed in `recipients` then throw error
    if (!alias.recipients.includes(recipient))
      throw new Error(config.i18n.phrases.ALIAS_DOES_NOT_EXIST);

    // if the recipient is already verified just continue
    // if the recipient is not yet verified then save them as verified and remove from pending
    alias.pending_recipients = alias.pending_recipients.filter(
      (r) => r !== recipient
    );
    alias.verified_recipients.push(recipient);
    await alias.save();

    // handle custom redirect if it was set
    const redirectTo =
      domain.has_custom_verification && domain.custom_verification.redirect
        ? domain.custom_verification.redirect
        : ctx.state.l();

    const message = ctx.translate('EMAIL_VERIFICATION_SUCCESS');

    if (ctx.accepts('html')) {
      if (!ctx.api && redirectTo === ctx.state.l())
        ctx.flash('success', message);
      ctx.redirect(redirectTo);
    } else {
      ctx.body = {
        message,
        redirectTo
      };
    }
  } catch (err) {
    logger.warn(err);
    ctx.throw(
      Boom.badRequest(ctx.translateError('INVALID_RECIPIENT_VERIFICATION'))
    );
  }
}

// fetches all pages from sitemap
// TODO: if you change this then also change sitemap controller
const keys = new Set(
  Object.keys(config.meta).filter((key) => {
    // exclude certain pages from sitemap
    // (e.g. 401 not authorized)
    if (
      [
        '/admin',
        '/my-account',
        '/auth',
        '/logout',
        '/reset-password',
        config.verifyRoute,
        config.otpRoutePrefix
      ].includes(key)
    )
      return false;
    if (key.startsWith('/admin') || key.startsWith('/my-account')) return false;
    return key;
  })
);

// eslint-disable-next-line complexity
async function generateOpenGraphImage(ctx) {
  try {
    let url = (ctx.pathWithoutLocale || ctx.path)
      .replace('.png', '')
      .replace('.svg', '');
    if (url === '/index') url = '/';

    // ensure that the URL is in our sitemap otherwise redirect to generic
    if (!keys.has(url) && !i18n.config.locales.includes(url.slice(1))) {
      ctx.redirect(`/${ctx.locale}/index.png?v=${Date.now()}`);
      return;
    }

    // load seo metadata
    let data = {};
    let match = `/${ctx.locale}`;
    try {
      data = meta.getByPath(url, ctx.request.t);
      match = `/${ctx.locale}${url}`;
      if (match.length > 40)
        match = _.escape(_.unescape(match).slice(0, 40) + '...');
    } catch (err) {
      logger.error(err);
      data = meta.getByPath('/', ctx.request.t);
    }

    if (match === '/') match = `/${ctx.locale}`;
    else if (match.endsWith('/')) match = match.slice(0, -1);
    if (match === `/${i18n.config.defaultLocale}`) match = '';

    ctx.type = ctx.path.endsWith('.svg') ? 'image/svg+xml' : 'image/png';

    let [str] = data.title
      .replace(config.views.locals.striptags(config.metaTitleAffix), '')
      .replace(
        config.views.locals
          .striptags(config.metaTitleAffix)
          .replace('&#124;', '|'),
        ''
      )
      .split(' - ');
    str = str.trim();
    if (url.startsWith('/guides') && str.includes(' for '))
      str = str.split(' for ')[1].trim();
    if (str.length > 50) str = _.escape(_.unescape(str).slice(0, 50) + '...');
    let freeEmail = ctx.translate('FREE_EMAIL');
    if (url.startsWith('/guides') || url.startsWith('/how-to'))
      freeEmail = ctx.translate('TUTORIAL');

    // if it was a developer doc then parse the title
    const doc = config.views.locals.developerDocs.find((d) => d.slug === url);
    if (doc && isSANB(doc.ogBtnText)) freeEmail = doc.ogBtnText;

    // if it was a open source guide then parse the title
    const platform = config.views.locals.platforms.find(
      (p) =>
        `/open-source/${config.views.locals.dashify(p)}-email-server` === url
    );
    if (platform) freeEmail = platform;

    // fallback safeguard
    if (freeEmail.length > 20) freeEmail = i18n.translate('FREE_EMAIL', 'en');

    let noCreditCard = ctx.translate('NO_CREDIT_CARD');
    if (noCreditCard.length > 60)
      noCreditCard = i18n.translate('NO_CREDIT_CARD', 'en');

    const svgReplaced = SVG_STR.replace('NO_CREDIT_CARD', noCreditCard)
      .replace('PRIVATE_BUSINESS', str.trim())
      .replace('FREE_EMAIL', freeEmail)
      .replace(
        'font-size="85"',
        `font-size="${freeEmail.length >= 14 ? 65 : 85}"`
      )
      .replace('forwardemail.net', 'forwardemail.net' + match)
      .replace('font-size="56"', `font-size="${str.length >= 40 ? 40 : 56}"`);
    const svg = Buffer.from(svgReplaced, 'utf8');
    const hash = revHash(ctx.type + ':' + svgReplaced);

    const key = `og:${hash}`;
    const result = await ctx.client.get(key);

    if (result) {
      ctx.body = Buffer.from(result, 'hex');
      return;
    }

    if (ctx.type === 'image/svg+xml') {
      ctx.body = svg;
      ctx.client
        .set(key, svg.toString('hex'))
        .then()
        .catch((err) => ctx.logger.fatal(err));
    } else {
      const buffer = await sharp(svg).png({ quality: 100 }).toBuffer();
      ctx.body = buffer;
      ctx.client
        .set(key, buffer.toString('hex'))
        .then()
        .catch((err) => ctx.logger.fatal(err));
    }
  } catch (err) {
    ctx.logger.error(err);
    ctx.throw(Boom.clientTimeout(ctx.translateError('UNKNOWN_ERROR')));
  }
}

module.exports = {
  admin,
  api,
  auth,
  breadcrumbs,
  faq,
  help,
  myAccount,
  onboard,
  otp,
  report,
  reservedEmailAddresses,
  recipientVerification,
  denylist,
  guides,
  sitemap,
  generateOpenGraphImage
};
