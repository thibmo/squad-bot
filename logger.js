/**
 * logger
 * logging class for SR Node.JS apps
 * © 2021 Smoking Rifles
 */
const chalk     = require('chalk'),
    fs          = require('fs'),
    path        = require('path'),
    { rotator } = require('logrotator');

/**
 * The log levels
 */
const LogLevel = {
    /**
     * Disables logging alltogether
     * @type {number}
     */
    OFF:   0,
    /**
     * Indicates a fatal log message
     * @type {number}
     */
    FATAL: 1,
    /**
     * Indicates a error log message
     * @type {number}
     */
    ERROR: 2,
    /**
     * Indicates a warning log message
     * @type {number}
     */
    WARN:  3,
    /**
     * Indicates an informational log message
     * @type {number}
     */
    INFO:  4,
    /**
     * Indicates a debug log message
     * @type {number}
     */
    DEBUG: 5
};

/**
 * The logger class
 */
class LoggerClass {
    constructor() {
        /**
         * The logging threshold
         * @type {LogLevel}
         * @private
         */
        this._logLevel = LogLevel.OFF;

        /**
         * The log directory
         * @type {string}
         * @private
         */
        this._logFile = path.join('.', 'logs', 'squad-bot.log');

        // check file rotation every 5 minutes, and rotate the file if its size exceeds 25 mb. Keep only 14 rotated files and compress (gzip) them.
        rotator.register(this._logFile, {
            schedule: '5m',
            size: '25m',
            compress: true,
            count: 14,
            format: (index) => {
                const d = new Date();
                return d.getDate() + "-" + d.getMonth() + "-" + d.getFullYear();
            }
        });
    }

    /**
     * Log a message
     * @param {string} module
     * @param {string} subModule
     * @param {LogLevel} level
     * @param {string} message
     * @param {...any} extras
     * @private
     */
    _log(module, subModule, level, message, ...extras) {
        let colorFunc = chalk[this._logLevelToColor(level)];

        if (typeof colorFunc !== 'function')
            colorFunc = chalk.white;

        if (this._logLevel >= level) {
            const msg = `${(new Date()).toUTCString()} [${module}][${subModule}] <${this._logLevelToText(level)}> ${message}`;
            console.log(`${colorFunc(msg)}`, ...extras);

            var fileMsg = `${msg}\n`;
            extras.forEach((item) => {
                fileMsg += `${item}\n`;
            });

            fs.appendFile(this._logFile, fileMsg, (err) => {
                if (err)
                    console.error(err);
            });
        }
    }

    /**
     * Log a fatal message
     * @param {string} module
     * @param {string} subModule
     * @param {string} message
     * @param {...any} extras
     */
    fatal(module, subModule, message, ...extras) {
        this._log(module, subModule, LogLevel.FATAL, message, ...extras);
    }

    /**
     * Log a error message
     * @param {string} module
     * @param {string} subModule
     * @param {string} message
     * @param {...any} extras
     */
    error(module, subModule, message, ...extras) {
        this._log(module, subModule, LogLevel.ERROR, message, ...extras);
    }

    /**
     * Log a warning message
     * @param {string} module
     * @param {string} subModule
     * @param {string} message
     * @param {...any} extras
     */
    warn(module, subModule, message, ...extras) {
        this._log(module, subModule, LogLevel.WARN, message, ...extras);
    }

    /**
     * Log an informational message
     * @param {string} module
     * @param {string} subModule
     * @param {string} message
     * @param {...any} extras
     */
    info(module, subModule, message, ...extras) {
        this._log(module, subModule, LogLevel.INFO, message, ...extras);
    }

    /**
     * Log a debug message
     * @param {string} module
     * @param {string} subModule
     * @param {string} message
     * @param {...any} extras
     */
    debug(module, subModule, message, ...extras) {
        this._log(module, subModule, LogLevel.DEBUG, message, ...extras);
    }

    /**
     * Set the logging threshold
     * @param {LogLevel} level
     */
    setLogLevel(level) {
        this._logLevel = level;
    }

    /**
     * Retrieve the textual representation of the log level
     * @param {LogLevel} level
     * @returns {string}
     * @private
     */
    _logLevelToText(level) {
        switch (level) {
            case LogLevel.OFF:   return 'Off';
            case LogLevel.FATAL: return 'Fatal';
            case LogLevel.ERROR: return 'Error';
            case LogLevel.WARN:  return 'Warn';
            case LogLevel.INFO:  return 'Info';
            case LogLevel.DEBUG: return 'Debug';
        }
    }

    /**
     * Retrieve the color for the log level
     * @param {LogLevel} level
     * @returns {string}
     * @private
     */
    _logLevelToColor(level) {
        switch (level) {
            case LogLevel.FATAL: return 'redBright';
            case LogLevel.ERROR: return 'redBright';
            case LogLevel.WARN:  return 'yellowBright';
            case LogLevel.INFO:  return 'blueBright';
            case LogLevel.DEBUG: return 'magentaBright';
            default: return 'white';
        }
    }
}

/**
 * Public instance of the logger
 * @type {LoggerClass}
 */
const Logger = new LoggerClass();

module.exports = { Logger, LogLevel };
