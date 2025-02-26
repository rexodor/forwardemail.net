const users = require('./users');
const domains = require('./domains');
const dashboard = require('./dashboard');
const logs = require('./logs');
const allowlist = require('./allowlist');
const denylist = require('./denylist');
const emails = require('./emails');

module.exports = {
  dashboard,
  users,
  domains,
  logs,
  allowlist,
  denylist,
  emails
};
