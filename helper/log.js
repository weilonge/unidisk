var _IS_WEB = typeof document !== 'undefined' &&
    typeof window !== 'undefined';
var logger;

if (_IS_WEB) {
  logger = {
    info: function () {
      var p = [];
      for (var i = 0; i < arguments.length; i++) {
        p.push(arguments[i]);
      }
      /* eslint-disable no-console */
      console.log(p.join(' '));
      /* eslint-enable no-console */
    },
    error: function () {
      var p = [];
      for (var i = 0; i < arguments.length; i++) {
        p.push(arguments[i]);
      }
      /* eslint-disable no-console */
      console.error(p.join(' '));
      /* eslint-enable no-console */
    },
    verbose: function () {}
  };
} else {
  var winston = require('winston');
  logger = new (winston.Logger)({
    level: 'silly',
    transports: [
      new winston.transports.Console({
        json: false,
        timestamp: true,
        level: 'error'
      }),
      new winston.transports.File({
        filename: process.cwd() + '/debug.log',
        json: true,
        level: 'error'
      })
    ],
    exceptionHandlers: [
      new winston.transports.Console({
        json: false,
        timestamp: true,
        level: 'error'
      }),
      new winston.transports.File({
        filename: process.cwd() + '/exceptions.log',
        json: true,
        level: 'error'
      })
    ],
    exitOnError: false
  });

  logger.transports.console.level = 'info';
  logger.transports.file.level = 'verbose';
}

module.exports = logger;
