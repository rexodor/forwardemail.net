const path = require('path');
const os = require('os');

const Axe = require('axe');
const Boom = require('@hapi/boom');
const _ = require('lodash');
const bytes = require('bytes');
const consolidate = require('@ladjs/consolidate');
const dayjs = require('dayjs-with-plugins');
const isSANB = require('is-string-and-not-blank');
const manifestRev = require('manifest-rev');
const ms = require('ms');
const nodemailer = require('nodemailer');
const zxcvbn = require('zxcvbn');
const { Iconv } = require('iconv');
const { boolean } = require('boolean');

const pkg = require('../package');
const env = require('./env');
const filters = require('./filters');
const i18n = require('./i18n');
const loggerConfig = require('./logger');
const meta = require('./meta');
const phrases = require('./phrases');
const utilities = require('./utilities');
const payments = require('./payments');
const metaConfig = require('./meta-config');

const config = {
  ...metaConfig,
  srs: {
    separator: '=',
    secret: env.SRS_SECRET,
    maxAge: 30
  },
  twilio: {
    accountSid: env.TWILIO_ACCOUNT_SID,
    authToken: env.TWILIO_AUTH_TOKEN,
    from: env.TWILIO_FROM_NUMBER,
    to: env.TWILIO_TO_NUMBER
  },
  // 60 items (50 MB * 60 = 3000 MB = 3 GB)
  smtpMaxQueue: 60,
  smtpQueueTimeout: ms('60s'),
  smtpLimitMessages: env.NODE_ENV === 'test' ? 10 : 300,
  smtpLimitAuth: env.NODE_ENV === 'test' ? Number.MAX_VALUE : 3,
  smtpLimitAuthDuration: ms('1d'),
  smtpLimitDuration: ms('1d'),
  smtpLimitNamespace: `smtp_auth_limit_${env.NODE_ENV.toLowerCase()}`,
  supportEmail: env.EMAIL_DEFAULT_FROM_EMAIL,
  maxRecipients: env.MAX_RECIPIENTS,
  paidPrefix: `${env.TXT_RECORD_PREFIX}-site-verification=`,
  freePrefix: `${env.TXT_RECORD_PREFIX}=`,
  webHost: env.WEB_HOST,
  // TODO: clean this config up everywhere for `previewEmailOptions`
  previewEmailOptions: {
    open: env.PREVIEW_EMAIL,
    openSimulator: false,
    simpleParser: {
      Iconv,
      skipHtmlToText: true,
      skipTextLinks: true,
      skipTextToHtml: true,
      maxHtmlLengthToParse: bytes('50MB')
    },
    returnHTML: true
  },
  maxRetryDuration: ms('5d'),
  concurrency:
    env.NODE_ENV === 'test' || env.NODE_ENV === 'development'
      ? 1
      : os.cpus().length,

  // truth sources (mirrors smtp)
  truthSources: new Set(
    _.isArray(env.TRUTH_SOURCES)
      ? env.TRUTH_SOURCES.map((key) => key.toLowerCase().trim())
      : isSANB(env.TRUTH_SOURCES)
      ? env.TRUTH_SOURCES.split(',').map((key) => key.toLowerCase().trim())
      : []
  ),

  emailRetention: env.EMAIL_RETENTION,
  logRetention: env.LOG_RETENTION,

  // custom rate limiting lookup for allowing whitelisted customers
  rateLimit: {
    id(ctx) {
      if (typeof ctx.isAuthenticated !== 'function' || !ctx.isAuthenticated())
        return ctx.ip;
      // return `false` if the user is whitelisted
      if (ctx.state.user[config.userFields.isRateLimitWhitelisted])
        return false;
      // in case user is abusing multiple IP addresses
      return ctx.state.user.id;
    },
    allowlist: env.RATELIMIT_ALLOWLIST
  },

  // package.json
  pkg,

  // paypal error threshold (e.g. for jobs)
  paypalErrorThreshold: 5,

  // stripe error threshold (e.g. for jobs)
  stripeErrorThreshold: 5,

  // max aliases per global domains
  maxAliasPerGlobalDomain: 50,

  // exchanges (matches SMTP)
  exchanges: (Array.isArray(env.SMTP_EXCHANGE_DOMAINS)
    ? env.SMTP_EXCHANGE_DOMAINS
    : env.SMTP_EXCHANGE_DOMAINS.split(',')
  ).map((exchange) => exchange.toLowerCase().trim()),

  // max recipients per alias (matches SMTP)
  maxForwardedAddresses: env.MAX_FORWARDED_ADDRESSES,

  // users that remove accounts get email
  // rewritten to `${user.id}@${removedEmailDomain}`
  removedEmailDomain: env.REMOVED_EMAIL_DOMAIN,

  // server
  env: env.NODE_ENV.toLowerCase(),
  urls: {
    web: env.WEB_URL.toLowerCase(),
    api: env.API_URL.toLowerCase()
  },

  // vanity domains
  vanityDomains: env.VANITY_DOMAINS.sort(),

  // record prefix (matches SMTP)
  recordPrefix: env.TXT_RECORD_PREFIX,

  // url options for validator (matches SMTP)
  isURLOptions: {
    protocols: ['http', 'https'],
    require_protocol: true
  },

  // app
  dkimKeySelector: 'forwardemail', // forwardemail._domainkey.example.com
  supportRequestMaxLength: env.SUPPORT_REQUEST_MAX_LENGTH,
  abuseEmail: env.EMAIL_ABUSE,
  email: {
    preview: {
      open: env.PREVIEW_EMAIL,
      openSimulator: false,
      simpleParser: {
        Iconv,
        maxHtmlLengthToParse: bytes('50MB')
      }
    },
    subjectPrefix: `${env.APP_NAME} – `,
    message: {
      from: env.EMAIL_DEFAULT_FROM
    },
    send: env.SEND_EMAIL,
    juiceResources: {},
    lastLocaleField: 'last_locale',
    i18n: {
      ...i18n,
      autoReload: false,
      updateFiles: true,
      syncFiles: true
    }
  },
  logger: loggerConfig,
  appColor: env.APP_COLOR,
  i18n,

  // paypal
  paypal: {
    clientID: env.PAYPAL_CLIENT_ID,
    secret: env.PAYPAL_SECRET
  },

  // build directory
  buildBase: 'build',

  // templating
  views: {
    // root is required by `koa-views`
    root: path.join(__dirname, '..', 'app', 'views'),
    // These are options passed to `koa-views`
    // <https://github.com/queckezz/koa-views>
    // They are also used by the email job rendering
    options: {
      extension: 'pug',
      map: {},
      engineSource: consolidate
    },
    // A complete reference of options for Pug (default):
    // <https://pugjs.org/api/reference.html>
    locals: {
      // i18n default locale
      defaultLocale: i18n.defaultLocale,
      // Even though pug deprecates this, we've added `pretty`
      // in `koa-views` package, so this option STILL works
      // <https://github.com/queckezz/koa-views/pull/111>
      pretty: env.NODE_ENV === 'development',
      cache: env.NODE_ENV !== 'development',
      // debug: env.NODE_ENV === 'development',
      // compileDebug: env.NODE_ENV === 'development',
      ...utilities,
      filters
    }
  },

  // user fields whose account updates create an action (e.g. email)
  accountUpdateFields: [
    'passport.fields.otpEnabled',
    'passport.fields.givenName',
    'passport.fields.familyName',
    'passportLocalMongoose.usernameField',
    'userFields.apiToken',
    'userFields.receiptEmail',
    'userFields.companyName',
    'userFields.addressLine1',
    'userFields.addressLine2',
    'userFields.addressCity',
    'userFields.addressState',
    'userFields.addressZip',
    'userFields.companyVAT',
    'userFields.addressCountry'
  ],

  // reference crypto random
  referenceOptions: {
    length: 6,
    type: 'alphanumeric'
  },

  // user fields (change these if you want camel case or whatever)
  userFields: {
    stripeTrialSentAt: 'stripe_trial_sent_at',
    paypalTrialSentAt: 'paypal_trial_sent_at',
    paymentReminderInitialSentAt: 'payment_reminder_initial_sent_at',
    paymentReminderFollowUpSentAt: 'payment_reminder_follow_up_sent_at',
    paymentReminderFinalNoticeSentAt: 'payment_reminder_final_notice_sent_at',
    paymentReminderTerminationNoticeSentAt:
      'payment_reminder_termination_notice_sent_at',
    apiPastDueSentAt: 'api_past_due_sent_at',
    apiRestrictedSentAt: 'api_restricted_sent_at',
    receiptEmail: 'receipt_email',
    isRateLimitWhitelisted: 'is_rate_limit_whitelisted',
    accountUpdates: 'account_updates',
    fullEmail: 'full_email',
    apiToken: 'api_token',
    otpRecoveryKeys: 'otp_recovery_keys',
    resetTokenExpiresAt: 'reset_token_expires_at',
    resetToken: 'reset_token',
    changeEmailTokenExpiresAt: 'change_email_token_expires_at',
    changeEmailToken: 'change_email_token',
    changeEmailNewAddress: 'change_email_new_address',
    hasSetPassword: 'has_set_password',
    hasVerifiedEmail: 'has_verified_email',
    pendingRecovery: 'pending_recovery',
    verificationPinExpiresAt: 'verification_pin_expires_at',
    verificationPinSentAt: 'verification_pin_sent_at',
    verificationPin: 'verification_pin',
    verificationPinHasExpired: 'verification_pin_has_expired',
    welcomeEmailSentAt: 'welcome_email_sent_at',
    launchEmailSentAt: 'launch_email_sent_at',
    isRemoved: 'is_removed',
    isBanned: 'is_banned',
    twoFactorReminderSentAt: 'two_factor_reminder_sent_at',
    planSetAt: 'plan_set_at',
    planExpiresAt: 'plan_expires_at',
    stripeCustomerID: 'stripe_customer_id',
    stripeSubscriptionID: 'stripe_subscription_id',
    paypalPayerID: 'paypal_payer_id',
    paypalSubscriptionID: 'paypal_subscription_id',
    defaultDomain: 'default_domain',
    companyName: 'company_name',
    addressLine1: 'address_line1',
    addressLine2: 'address_line2',
    addressCity: 'address_city',
    addressState: 'address_state',
    addressZip: 'address_zip',
    addressCountry: 'address_country',
    addressHTML: 'address_html',
    companyVAT: 'company_vat',
    hasDenylistRequests: 'has_denylist_requests',
    approvedDomains: 'approved_domains',
    smtpLimit: 'smtp_limit'
  },

  // dynamic otp routes
  otpRouteLoginPath: '/login',

  verificationPinTimeoutMs: ms(env.VERIFICATION_PIN_TIMEOUT_MS),
  verificationPinEmailIntervalMs: ms(env.VERIFICATION_PIN_EMAIL_INTERVAL_MS),
  verificationPin: { length: 6, type: 'numeric' },

  // reset token
  resetTokenTimeoutMs: ms(env.RESET_TOKEN_TIMEOUT_MS),

  // change email token
  changeEmailTokenTimeoutMs: ms(env.CHANGE_EMAIL_TOKEN_TIMEOUT_MS),
  changeEmailLimitMs: ms(env.CHANGE_EMAIL_LIMIT_MS),

  turnstileEnabled: env.TURNSTILE_ENABLED,
  turnstileSecretKey: env.TURNSTILE_SECRET_KEY,
  turnstileSiteKey: env.TURNSTILE_SITE_KEY,

  // @ladjs/passport configuration (see defaults in package)
  // <https://github.com/ladjs/passport>
  passport: {
    fields: {
      // you may want to make this "full_name" instead
      displayName: 'display_name',
      // you could make this "first_name"
      givenName: 'given_name',
      // you could make this "last_name"
      familyName: 'family_name',
      avatarURL: 'avatar_url',
      // apple
      appleProfileID: 'apple_profile_id',
      appleAccessToken: 'apple_access_token',
      appleRefreshToken: 'apple_refresh_token',
      // google
      googleProfileID: 'google_profile_id',
      googleAccessToken: 'google_access_token',
      googleRefreshToken: 'google_refresh_token',
      // github
      githubProfileID: 'github_profile_id',
      githubAccessToken: 'github_access_token',
      githubRefreshToken: 'github_refresh_token',
      // otp
      otpToken: 'otp_token',
      otpEnabled: 'otp_enabled'
    },
    phrases
  },

  // passport-local-mongoose options
  // <https://github.com/saintedlama/passport-local-mongoose>
  passportLocalMongoose: {
    usernameField: 'email',
    passwordField: 'password',
    attemptsField: 'login_attempts',
    lastLoginField: 'last_login_at',
    usernameLowerCase: true,
    // NOTE: we rate limit the /login endpoint
    // limitAttempts: true,
    // maxAttempts: env.NODE_ENV === 'development' ? Number.POSITIVE_INFINITY : 10,
    digestAlgorithm: 'sha256',
    encoding: 'hex',
    saltlen: 32,
    iterations: 25000,
    keylen: 512,
    passwordValidator(password, fn) {
      if (typeof password !== 'string') {
        const err = Boom.badRequest(phrases.INVALID_PASSWORD_STRENGTH);
        err.no_translate = true;
        return fn(err);
      }

      if (env.NODE_ENV === 'development') return fn();
      // TODO: new fork `zxcvbn3`
      // <https://github.com/hrueger/zxcvbn>
      // <https://github.com/dropbox/zxcvbn/issues/290
      const { score, feedback } = zxcvbn(password);
      if (score >= 2) return fn();
      let message = phrases.INVALID_PASSWORD_STRENGTH;
      if (_.isObject(feedback)) {
        if (isSANB(feedback.warning)) message += ` ${feedback.warning}.`;
        if (isSANB(feedback.suggestions))
          message += ` ${feedback.suggestions}.`;
      }

      const err = Boom.badRequest(message);
      err.no_translate = true;
      fn(err);
    },
    errorMessages: {
      MissingPasswordError: phrases.PASSPORT_MISSING_PASSWORD_ERROR,
      AttemptTooSoonError: phrases.PASSPORT_ATTEMPT_TOO_SOON_ERROR,
      TooManyAttemptsError: phrases.PASSPORT_TOO_MANY_ATTEMPTS_ERROR_,
      NoSaltValueStoredError: phrases.PASSPORT_NO_SALT_VALUE_STORED_ERROR,
      IncorrectPasswordError: phrases.PASSPORT_INCORRECT_PASSWORD_ERROR,
      IncorrectUsernameError: phrases.PASSPORT_INCORRECT_USERNAME_ERROR,
      MissingUsernameError: phrases.PASSPORT_MISSING_USERNAME_ERROR,
      UserExistsError: phrases.PASSPORT_USER_EXISTS_ERROR
    }
  },

  // passport callback options
  passportCallbackOptions: {
    successReturnToOrRedirect: '/my-account',
    failureRedirect: '/login',
    successFlash: true,
    failureFlash: true
  },

  // <https://github.com/ladjs/store-ip-address>
  storeIPAddress: false,

  // field name for a user's last locale
  // (this gets re-used by email-templates and @ladjs/i18n; see below)
  lastLocaleField: 'last_locale',

  // <https://symantec-enterprise-blogs.security.com/blogs/feature-stories/top-20-shady-top-level-domains>
  // <https://www.spamhaus.org/statistics/tlds/>
  // <https://krebsonsecurity.com/tag/top-20-shady-top-level-domains/>
  // <https://tld-list.com/free-downloads>
  // <https://publicsuffix.org/list/public_suffix_list.dat>
  //
  restrictedDomains: [
    // government
    'edu',
    'gov',
    'mil',

    // IANA
    'int',

    // 'arpa'
    'arpa',

    // us
    'dni.us',
    'fed.us',
    'isa.us',
    'kids.us',
    'nsn.us',

    // state abbreviations (includes k12)
    'ak.us',
    'al.us',
    'ar.us',
    'as.us',
    'az.us',
    'ca.us',
    'co.us',
    'ct.us',
    'dc.us',
    'de.us',
    'fl.us',
    'ga.us',
    'gu.us',
    'hi.us',
    'ia.us',
    'id.us',
    'il.us',
    'in.us',
    'ks.us',
    'ky.us',
    'la.us',
    'ma.us',
    'md.us',
    'me.us',
    'mi.us',
    'mn.us',
    'mo.us',
    'ms.us',
    'mt.us',
    'nc.us',
    'nd.us',
    'ne.us',
    'nh.us',
    'nj.us',
    'nm.us',
    'nv.us',
    'ny.us',
    'oh.us',
    'ok.us',
    'or.us',
    'pa.us',
    'pr.us',
    'ri.us',
    'sc.us',
    'sd.us',
    'tn.us',
    'tx.us',
    'ut.us',
    'va.us',
    'vi.us',
    'vt.us',
    'wa.us',
    'wi.us',
    'wv.us',
    'wy.us',

    // <https://en.wikipedia.org/wiki/Second-level_domain>
    'mil.tt',
    'edu.tt',
    'edu.tr',
    'edu.ua',
    'edu.au',
    'ac.at',
    'edu.br',
    'ac.nz',
    'school.nz',
    'cri.nz',
    'health.nz',
    'mil.nz',
    'parliament.nz',
    'ac.in',
    'edu.in',
    'mil.in',
    'ac.jp',
    'ed.jp',
    'lg.jp',
    'ac.za',
    'edu.za',
    'mil.za',
    'school.za',
    'mil.kr',
    'ac.kr',
    'hs.kr',
    'ms.kr',
    'es.kr',
    'sc.kr',
    'kg.kr',
    'edu.es',
    'ac.lk',
    'sch.lk',
    'edu.lk',
    'ac.th',
    'mi.th',

    // <https://en.wikipedia.org/wiki/.gov#International_equivalents>
    'admin.ch',
    'canada.ca',
    'gc.ca',
    'go.id',
    'go.jp',
    'go.ke',
    'go.kr',
    'go.th',
    'gob.ar',
    'gob.cl',
    'gob.es',
    'gob.mx',
    // 'gob.pe',
    'gob.ve',
    'gob.sv',
    'gouv.fr',
    'gouv.nc',
    'gouv.qc.ca',
    'gov.ad',
    'gov.af',
    'gov.ai',
    'gov.al',
    'gov.am',
    'gov.ao',
    'gov.au',
    'gov.aw',
    'gov.ax',
    'gov.az',
    'gov.bd',
    'gov.be',
    'gov.bg',
    'gov.bm',
    'gov.br',
    'gov.by',
    'gov.cl',
    'gov.cn',
    'gov.co',
    'gov.cy',
    'gov.cz',
    'gov.dz',
    'gov.eg',
    'gov.fi',
    'gov.fk',
    'gov.gg',
    'gov.gr',
    'gov.hk',
    'gov.hr',
    'gov.hu',
    'gov.ie',
    'gov.il',
    'gov.im',
    'gov.in',
    'gov.iq',
    'gov.ir',
    'gov.it',
    'gov.je',
    'gov.kp',
    'gov.krd',
    'gov.ky',
    'gov.kz',
    'gov.lb',
    'gov.lk',
    'gov.lt',
    'gov.lv',
    'gov.ma',
    'gov.mm',
    'gov.mo',
    'gov.mt',
    'gov.my',
    'gov.ng',
    'gov.np',
    'gov.ph',
    'gov.pk',
    'gov.pl',
    'gov.pt',
    'gov.py',
    'gov.ro',
    'gov.ru',
    'gov.scot',
    'gov.se',
    'gov.sg',
    'gov.si',
    'gov.sk',
    'gov.tr',
    'gov.tt',
    'gov.tw',
    'gov.ua',
    'gov.uk',
    'gov.vn',
    'gov.wales',
    'gov.za',
    'government.pn',
    'govt.nz',
    // NOTE: gub.uy removed due to spam from subdomains)
    // 'gub.uy',
    'gv.at',

    // <https://en.wikipedia.org/wiki/.uk#Second-level_domains>
    'ac.uk',
    'bl.uk',
    'judiciary.uk',
    'mod.uk',
    'nhs.uk',
    'parliament.uk',
    'police.uk',
    'rct.uk',
    'royal.uk',
    'sch.uk',
    'ukaea.uk'
  ],

  goodDomains: [
    'ac',
    'ad',
    'ag',
    'ai',
    'al',
    'am',
    'app',
    'as',
    'at',
    'au',
    'ba',
    'be',
    'br',
    'by',
    'ca',
    'cc',
    'cd',
    'ch',
    'ck',
    'co',
    'com',
    'de',
    'dev',
    'dj',
    'dk',
    'ee',
    'es',
    'eu',
    'family',
    'fi',
    'fm',
    'fr',
    'gg',
    'gl',
    'id',
    'ie',
    'im',
    'in',
    'io',
    'ir',
    'is',
    'it',
    'je',
    'jp',
    'kr',
    'la',
    'li',
    'lv',
    'ly',
    'md',
    'me',
    'mn',
    'ms',
    'mu',
    'mx',
    'net',
    'ni',
    'nl',
    'no',
    'nu',
    'nz',
    'org',
    'pl',
    'pr',
    'pw',
    'rs',
    'sc',
    'se',
    'sh',
    'si',
    'sm',
    'sr',
    'st',
    'tc',
    'tm',
    'to',
    'tv',
    'uk',
    'us',
    'uz',
    'vc',
    'vg',
    'vu',
    'ws',
    'xyz',
    'za'
  ],

  validDurations: [
    ms('30d'), // 1 mo
    ms('60d'), // 2 mo
    ms('90d'), // 3 mo
    ms('180d'), // 6 mo
    ms('1y'),
    ms('2y'),
    ms('3y')
  ],

  // this is used for calculating plan_expires_at
  // (there is probably a better way to implement this)
  durationMapping: {
    [ms('30d').toString()]: ['1', 'month'],
    [ms('60d').toString()]: ['2', 'months'],
    [ms('90d').toString()]: ['3', 'months'],
    [ms('180d').toString()]: ['6', 'months'],
    [ms('1y').toString()]: ['1', 'year'],
    [ms('2y').toString()]: ['2', 'years'],
    [ms('3y').toString()]: ['3', 'years']
  }
};

// sanity test against validDurations and durationMapping length
if (config.validDurations.length !== Object.keys(config.durationMapping).length)
  throw new Error('validDurations and durationMapping must be aligned');

// set dynamic login otp route
config.loginOtpRoute = `${config.otpRoutePrefix}${config.otpRouteLoginPath}`;

// set build dir based off build base dir name
config.buildDir = path.join(__dirname, '..', config.buildBase);

// meta support for SEO
config.meta = meta(config);

// add i18n api to views
const logger = new Axe(config.logger);

// add manifest helper for rev-manifest.json support
config.manifest = path.join(config.buildDir, 'rev-manifest.json');
config.srimanifest = path.join(config.buildDir, 'sri-manifest.json');
config.views.locals.manifest = manifestRev({
  prepend: '/',
  manifest: config.srimanifest
});

// add selective `config` object to be used by views
config.views.locals.config = _.pick(config, [
  'smtpLimitMessages',
  'smtpLimitDuration',
  'supportEmail',
  'webHost',
  'appColor',
  'appName',
  'env',
  'turnstileEnabled',
  'turnstileSiteKey',
  'lastLocaleField',
  'loginRoute',
  'maxForwardedAddresses',
  'otpRoutePrefix',
  'passport',
  'passportCallbackOptions',
  'passportLocalMongoose',
  'paypal',
  'recordPrefix',
  'storeIPAddress',
  'supportRequestMaxLength',
  'urls',
  'userFields',
  'vanityDomains',
  'verificationPin',
  'verifyRoute',
  'goodDomains',
  'meta',
  'metaTitleAffix'
]);

// <https://nodemailer.com/transports/>
// <https://github.com/nodemailer/nodemailer/pull/1539>
config.email.transport = nodemailer.createTransport({
  host: env.SMTP_TRANSPORT_HOST,
  port: env.SMTP_TRANSPORT_PORT,
  secure: env.SMTP_TRANSPORT_SECURE,
  auth: {
    user: env.SMTP_TRANSPORT_USER,
    pass: env.SMTP_TRANSPORT_PASS
  },
  logger,
  debug: boolean(env.TRANSPORT_DEBUG)
});

// add `views` to `config.email`
config.email.views = { ...config.views };
config.email.views.root = path.join(__dirname, '..', 'emails');
config.email.juiceResources.webResources = {
  relativeTo: config.buildDir,
  images: false
};
config.email.views.locals.manifest = manifestRev({
  prepend: `${config.urls.web}/`,
  manifest: config.srimanifest
});

// launch date is 11/23/2020 at 10:00 AM
config.launchDate = dayjs('11/23/2020 10:00 AM', 'MM/DD/YYYY h:mm A').toDate();

config.payments = payments;

module.exports = config;
