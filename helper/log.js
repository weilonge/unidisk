var winston = require('winston');

var logger = new (winston.Logger)({
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

module.exports = logger;
