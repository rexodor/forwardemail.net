if (process.env.NODE_ENV === 'production') {
  const logger = require('../../helpers/logger');
  // expose it to the global window object
  window.console = logger;
}

module.exports = window.console;
