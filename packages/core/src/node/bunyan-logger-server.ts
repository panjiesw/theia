/*
 * Copyright (C) 2017 Ericsson and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import * as bunyan from 'bunyan';
import * as yargs from 'yargs';
import { inject, injectable } from 'inversify';
import { LogLevel, rootLoggerName } from '../common/logger';
import { ILoggerServer, ILoggerClient, LoggerServerOptions, LoggerInfo, ILogLevelChangedEvent } from '../common/logger-protocol';
import { CliContribution } from './cli';
import { LoggerWatcher } from '../common/logger-watcher';

@injectable()
export class LogLevelCliContribution implements CliContribution {

    logLevel: string;

    configure(conf: yargs.Argv): void {
        conf.option('log-level', {
            description: 'Sets the log level',
            default: 'info',
            choices: ['trace', 'debug', 'info', 'warn', 'error', 'fatal']
        });
    }

    setArguments(args: yargs.Arguments): void {
        this.logLevel = args['log-level'];
    }
}

@injectable()
export class BunyanLoggerServer implements ILoggerServer {

    /* Root logger and all child logger array.  */
    private loggers = new Map<string, bunyan>();

    /* Logger client to send notifications to.  */
    private client: ILoggerClient | undefined = undefined;

    constructor(
        @inject(LoggerServerOptions) options: object,
        @inject(LoggerWatcher) protected watcher: LoggerWatcher,
    ) {
        const opts: bunyan.LoggerOptions = <bunyan.LoggerOptions>options;
        opts['logger'] = rootLoggerName;

        this.loggers.set(rootLoggerName,
            bunyan.createLogger(opts));
    }

    dispose(): void {
        // no-op
    }

    /* Create a logger child of the root logger.  See the bunyan child
     * documentation.  */
    child(name: string): Promise<void> {
        if (name.length === 0) {
            return Promise.reject("Can't create a logger with an empty name.");
        }

        if (this.loggers.has(name)) {
            /* Logger already exists.  */
            return Promise.resolve();
        }

        const rootLogger = this.loggers.get(rootLoggerName);
        if (rootLogger === undefined) {
            throw new Error('No root logger.');
        }

        this.loggers.set(name, rootLogger.child({ 'logger': name }));
        return Promise.resolve();
    }

    /* Set the client to receive notifications on.  */
    setClient(client: ILoggerClient | undefined) {
        this.client = client;
    }

    /* Set the log level for a logger.  */
    setLogLevel(name: string, logLevel: number): Promise<void> {
        const logger = this.loggers.get(name);
        if (logger === undefined) {
            throw new Error(`No logger named ${name}.`);
        }

        const oldLogLevel = this.toLogLevel(logger.level());
        if (oldLogLevel === logLevel) {
            return Promise.resolve();
        }

        logger.level(this.toBunyanLevel(logLevel));

        const changedEvent: ILogLevelChangedEvent = {
            loggerName: name,
            oldLogLevel: oldLogLevel,
            newLogLevel: logLevel,
        };

        /* Notify the frontend.  */
        if (this.client !== undefined) {
            this.client.onLogLevelChanged(changedEvent);
        }

        /* Notify the backend.  */
        this.watcher.logLevelChanged(changedEvent);

        return Promise.resolve();
    }

    /* Get the log level for a logger.  */
    getLogLevel(name: string): Promise<number> {
        const logger = this.loggers.get(name);
        if (logger === undefined) {
            throw new Error(`No logger named ${name}.`);
        }

        return Promise.resolve(
            this.toLogLevel(logger.level())
        );
    }

    /* Log a message to a logger.  */
    log(name: string, logLevel: number, message: string, params: any[]): Promise<void> {
        const logger = this.loggers.get(name);
        if (logger === undefined) {
            throw new Error(`No logger named ${name}.`);
        }

        switch (logLevel) {
            case LogLevel.TRACE:
                logger.trace(message, params);
                break;
            case LogLevel.DEBUG:
                logger.debug(message, params);
                break;
            case LogLevel.INFO:
                logger.info(message, params);
                break;
            case LogLevel.WARN:
                logger.warn(message, params);
                break;
            case LogLevel.ERROR:
                logger.error(message, params);
                break;
            case LogLevel.FATAL:
                logger.fatal(message, params);
                break;
            default:
                logger.info(message, params);
                break;
        }
        return Promise.resolve();
    }

    /* Convert Theia's log levels to bunyan's.  */
    protected toBunyanLevel(logLevel: number): number {
        switch (logLevel) {
            case LogLevel.FATAL:
                return bunyan.FATAL;
            case LogLevel.ERROR:
                return bunyan.ERROR;
            case LogLevel.WARN:
                return bunyan.WARN;
            case LogLevel.INFO:
                return bunyan.INFO;
            case LogLevel.DEBUG:
                return bunyan.DEBUG;
            case LogLevel.TRACE:
                return bunyan.TRACE;
            default:
                return bunyan.INFO;
        }
    }

    protected toLogLevel(bunyanLogLevel: number | string): number {
        switch (Number(bunyanLogLevel)) {
            case bunyan.FATAL:
                return LogLevel.FATAL;
            case bunyan.ERROR:
                return LogLevel.ERROR;
            case bunyan.WARN:
                return LogLevel.WARN;
            case bunyan.INFO:
                return LogLevel.INFO;
            case bunyan.DEBUG:
                return LogLevel.DEBUG;
            case bunyan.TRACE:
                return LogLevel.TRACE;
            default:
                return LogLevel.INFO;
        }
    }

    getLoggers(): Promise<LoggerInfo[]> {
        const ret: LoggerInfo[] = [];

        this.loggers.forEach((logger, name) => {
            ret.push({
                name: name,
                level: logger.level(),
            });
        });

        return Promise.resolve(ret);
    }
}
