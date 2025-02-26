const _ = require('lodash');
const isSANB = require('is-string-and-not-blank');
const paginate = require('koa-ctx-paginate');

const Domains = require('#models/domains');

async function listDomains(ctx) {
  let { domains } = ctx.state;

  // if some of the domains were not global and need setup then toast notification
  if (!ctx.query.page || ctx.query.page === 1) {
    // let hasSomeSetup = false;
    let setupRequired = false;
    let setupRequiredMultiple = false;
    for (const domain of domains) {
      if (domain.group !== 'admin') continue;
      const { isGood, isDisposable, isRestricted } =
        Domains.getNameRestrictions(domain.name);

      if (domain.plan === 'free' && (!isGood || isDisposable || isRestricted)) {
        if (setupRequired) {
          setupRequiredMultiple = true;
          break;
        }

        setupRequired = domain.name;
        continue;
      }

      if (domain.has_mx_record && domain.has_txt_record) continue;

      if (setupRequired) {
        setupRequiredMultiple = true;
        break;
      }

      setupRequired = domain.name;
    }

    if (setupRequired) {
      const message = setupRequiredMultiple
        ? ctx.translate('SETUP_REQUIRED_MULTIPLE')
        : ctx.translate(
            'SETUP_REQUIRED',
            setupRequired,
            ctx.state.l(`/my-account/domains/${setupRequired}`)
          );
      ctx.flash('custom', {
        title: ctx.request.t('Warning'),
        // showConfirmButton: false,
        html: message,
        type: 'warning',
        toast: true,
        position: 'top'
      });
    }

    /*
    if (hasSomeSetup && ctx.state.user.plan !== 'free') {
      try {
        const domainIds = ctx.state.domains
          .filter((d) => d.group === 'admin')
          .map((d) => d._id);
        const [temporaryErrorCount, permanentErrorCount] = await Promise.all([
          Logs.countDocuments({
            domains: { $in: domainIds },
            'err.responseCode': {
              $gte: 400,
              $lt: 500
            }
          }),
          Logs.countDocuments({
            domains: { $in: domainIds },
            'err.responseCode': {
              $gte: 500
            }
          })
        ]);
        ctx.state.temporaryErrorCount = temporaryErrorCount;
        ctx.state.permanentErrorCount = permanentErrorCount;
      } catch (err) {
        ctx.logger.error(err);
      }
    }
    */
  }

  // hide global domain names if not admin of
  // the global domain and had zero aliases
  domains = domains.filter((domain) => {
    if (!domain.is_global) return true;
    const member = domain.members.find((m) => m.user.id === ctx.state.user.id);
    if (!member) return false;
    if (member.group === 'admin') return true;
    if (domain.has_global_aliases) return true;
    return false;
  });

  const itemCount = domains.length;
  const pageCount = Math.ceil(itemCount / ctx.query.limit);

  // sort domains
  let sortFn;
  if (isSANB(ctx.query.sort))
    sortFn = (d) => d[ctx.query.sort.replace(/^-/, '')];
  else {
    // use the default A-Z sort fn but put not verified at top, followed by mismatch
    sortFn = (d) =>
      !d.has_mx_record || !d.has_txt_record
        ? 0
        : d.is_global && d.group !== 'admin'
        ? 3
        : ctx.state.user.plan === d.plan
        ? 2
        : 1;
  }

  // store allDomains used for alias modal dropdown
  const allDomains = [...domains];

  // domains are already pre-sorted A-Z by 'name' so only use sortFn if passed
  if (sortFn) domains = _.sortBy(domains, [sortFn]);

  if (isSANB(ctx.query.sort) && ctx.query.sort.startsWith('-'))
    domains = _.reverse(domains);

  // slice for page
  domains = domains.slice(
    ctx.paginate.skip,
    ctx.query.limit + ctx.paginate.skip
  );

  if (ctx.accepts('html'))
    return ctx.render('my-account/domains', {
      allDomains,
      domains,
      pageCount,
      itemCount,
      pages: paginate.getArrayPages(ctx)(6, pageCount, ctx.query.page)
    });

  const table = await ctx.render('my-account/domains/_table', {
    allDomains,
    domains,
    pageCount,
    itemCount,
    pages: paginate.getArrayPages(ctx)(6, pageCount, ctx.query.page)
  });

  ctx.body = { table };
}

module.exports = listDomains;
