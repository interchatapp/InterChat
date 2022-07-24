const { createLogger, format, transports } = require('winston');

const custom = format.printf((info) => {
	if (!info.stack) return `${info.level}: ${info.message} | ${info.timestamp}`;

	return `${info.level}: ${info.message} | ${info.timestamp}\n${info.stack}`;
});

const infoFormat = format.combine(
	format.timestamp({ format: '[on] DD MMMM, YYYY [at] hh:mm:ss.SSS' }),
	format(info => {
		if (info.level === 'ERROR') return;
		info.level = info.level.toUpperCase();
		return info;
	})(),
	custom,
);

const logger = createLogger({
	format: format.combine(
		format.errors({ stack: true }),
		format.timestamp({ format: '[on] DD MMMM, YYYY [at] hh:mm:ss.SSS' }),
		format(info => {
			info.level = info.level.toUpperCase();
			return info;
		})(),
		custom,
	),
	transports: [
		new transports.File({ filename: 'logs/discord.log', format: infoFormat }),
		new transports.File({ filename: 'logs/error.log', level: 'error' }),

		new transports.Console({
			format: format.combine(
				format.timestamp({ format: '[on] DD MMMM, YYYY [at] hh:mm:ss.SSS' }),
				format(info => {
					info.level = info.level.toUpperCase();
					return info;
				})(),
				format.colorize(),
				custom,
			),
		}),
	],
});

module.exports = logger;