const { createLogger, format, transports } = require('winston');

const custom = format.printf((info) => {
	return `${info.level}: ${info.message} | ${info.timestamp}`;
});

const logger = createLogger({
	format: format.combine(
		format.timestamp({ format: '[on] DD MMMM, YYYY [at] hh:mm:ss.SSS' }),
		format(info => {
			info.level = info.level.toUpperCase();
			return info;
		})(),
		format.colorize(),
		custom,
	),
	transports: [new transports.Console()],
});


logger.info('Hello there!');
logger.error('Testing errors too!');