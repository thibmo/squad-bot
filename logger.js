const chalk = require('chalk');

const LogLevel = {
    OFF:   0,
    FATAL: 1,
    ERROR: 2,
    WARN:  3,
    INFO:  4,
    DEBUG: 5
};

class LoggerClass {
    constructor() {
        /**
         * The logging threshold
         * @private
         */
        this._logLevel = LogLevel.OFF;
    }

    /**
     * @param {string} module
     * @param {string} subModule
     * @param {LogLevel} level
     * @param {string} message
     * @param  {...any} extras
     */
    log(module, subModule, level, message, ...extras) {
        let colorFunc = chalk[this._logLevelToColor(level)];

        if (typeof colorFunc !== 'function')
            colorFunc = chalk.white;

        if (this._logLevel >= level) {
            const msg = `${(new Date()).toUTCString()} [${module}][${subModule}] <${this._logLevelToText(level)}> ${message}`;
            console.log(`${colorFunc(msg)}`, ...extras);
        }
    }

    /**
     * @param {string} module
     * @param {string} subModule
     * @param {string} message
     * @param  {...any} extras
     */
    fatal(module, subModule, message, ...extras) {
        this.log(module, subModule, LogLevel.FATAL, message, ...extras);
    }

    /**
     * @param {string} module
     * @param {string} subModule
     * @param {string} message
     * @param  {...any} extras
     */
    error(module, subModule, message, ...extras) {
        this.log(module, subModule, LogLevel.ERROR, message, ...extras);
    }

    /**
     * @param {string} module
     * @param {string} subModule
     * @param {string} message
     * @param  {...any} extras
     */
    warn(module, subModule, message, ...extras) {
        this.log(module, subModule, LogLevel.WARN, message, ...extras);
    }

    /**
     * @param {string} module
     * @param {string} subModule
     * @param {string} message
     * @param  {...any} extras
     */
    info(module, subModule, message, ...extras) {
        this.log(module, subModule, LogLevel.INFO, message, ...extras);
    }

    /**
     * @param {string} module
     * @param {string} subModule
     * @param {string} message
     * @param  {...any} extras
     */
    debug(module, subModule, message, ...extras) {
        this.log(module, subModule, LogLevel.DEBUG, message, ...extras);
    }

    /**
     * @param {LogLevel} level
     */
    setLogLevel(level) {
        this._logLevel = level;
    }

    /**
     * @param {LogLevel} level
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
     * @param {LogLevel} level
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

const Logger = new LoggerClass();

module.exports = { Logger, LogLevel };
