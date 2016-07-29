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
      console.log(p.join(' '));
    },
    error: function () {
      var p = [];
      for (var i = 0; i < arguments.length; i++) {
        p.push(arguments[i]);
      }
      console.error(p.join(' '));
    },
    verbose: function () {}
  };
} else {
  var winston = require('winston');
  logger = new (winston.Logger)({
    level: 'error',
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

  logger.transports.console.level = 'error';
  logger.transports.file.level = 'error';
}

module.exports = logger;
