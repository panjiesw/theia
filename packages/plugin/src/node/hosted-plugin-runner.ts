/*
 * Copyright (C) 2015-2018 Red Hat, Inc.
 * All rights reserved. This program and the accompanying materials
 * are made available under the terms of the Eclipse Public License v1.0
 * which accompanies this distribution, and is available at
 * http://www.eclipse.org/legal/epl-v10.html
 *
 * Contributors:
 *   Red Hat, Inc. - initial API and implementation
 */
import { injectable } from "inversify";
import * as cp from "child_process";
import * as fs from "fs";
import * as net from "net";
import URI from '@theia/core/lib/common/uri';

const THEIA_INSTANCE_REGEX = /.*Theia app listening on (.*)\. \[\].*/;

/**
 * This class is responsible for running and handling separate Theia instance with given plugin.
 * Singleton.
 */
@injectable()
export class HostedPluginRunner {
    protected process: cp.ChildProcess;
    protected processOptions: cp.SpawnOptions;
    protected uri: URI;
    protected port: number;
    protected isPluginRunnig: boolean = false;
    protected instanceUri: URI;

    constructor() {
        this.isPluginRunnig = false;

        this.processOptions = {
            cwd: process.cwd(),
            env: process.env
        };
        delete this.processOptions.env.ELECTRON_RUN_AS_NODE;
    }

    isRunning(): boolean {
        return this.isPluginRunnig;
    }

    /**
     * Runs specified by the given uri plugin in separate Theia instance.
     *
     * @param pluginUri uri to the plugin
     * @param port port on which new instance of Theia should be run
     * @returns port on which new Theia instance is run
     */
    async run(pluginUri: URI, port?: number): Promise<URI> {
        if (this.isPluginRunnig) {
            throw new Error('Hosted plugin instance is already running.');
        }

        this.port = await this.getValidPort(port);

        if (pluginUri.scheme === 'file') {
            this.instanceUri = await this.runHostedPluginTheiaInstance(pluginUri, this.port);
            return this.instanceUri;
        }
        throw new Error('Not supported plugin location: ' + pluginUri.toString());
    }

    terminate(): void {
        if (this.isPluginRunnig) {
            this.process.kill();
        } else {
            throw new Error('Hosted plugin instance is not running.');
        }
    }

    getInstanceURI(): URI {
        if (this.isPluginRunnig) {
            return this.instanceUri;
        }
        throw new Error('Hosted plugin instance is not running.');
    }

    isValidPlugin(uri: URI): boolean {
        const packageJsonPath = uri.path.toString() + '/package.json';
        if (fs.existsSync(packageJsonPath)) {
            const packageJson = require(packageJsonPath);
            const extensions = packageJson['theiaPlugin'];
            if (extensions && (extensions['worker'] || extensions['node'])) {
                return true;
            }
        }
        return false;
    }

    protected runHostedPluginTheiaInstance(pluginPathUri: URI, port: number): Promise<URI> {
        const options = { ...this.processOptions };
        options.env.HOSTED_PLUGIN = pluginPathUri.path.toString();

        this.isPluginRunnig = true;
        return new Promise((resolve, reject) => {
            let started = false;
            const outputListener = (data: string | Buffer) => {
                const line = data.toString();
                const match = THEIA_INSTANCE_REGEX.exec(line);
                if (match) {
                    this.process.stdout.removeListener('data', outputListener);
                    started = true;
                    resolve(new URI(match[1]));
                }
            };

            this.process = cp.spawn('yarn', ['theia', 'start', '--port=' + port], options);
            this.process.on('error', () => { this.isPluginRunnig = false; });
            this.process.on('exit', () => { this.isPluginRunnig = false; });
            this.process.stdout.addListener('data', outputListener);
            setTimeout(() => {
                if (!started) {
                    this.process.kill();
                    this.isPluginRunnig = false;
                    reject('Timeout.');
                }
            }, 30000);
        });
    }

    protected async getValidPort(suggestedPort: number | undefined): Promise<number> {
        if (!suggestedPort) {
            suggestedPort = 3030;
        }

        if (suggestedPort < 1 || suggestedPort > 65535) {
            throw new Error('Port value is incorrect.');
        }

        if (await this.isPortFree(suggestedPort)) {
            return suggestedPort;
        }
        throw new Error('Port ' + suggestedPort + ' is already in use.');
    }

    /**
     * Checks whether given port is free.
     *
     * @param port port to check
     */
    protected isPortFree(port: number): Promise<boolean> {
        return new Promise(resolve => {
            const server = net.createServer();
            server.listen(port, '0.0.0.0');
            server.on('error', () => {
                resolve(false);
            });
            server.on('listening', () => {
                server.close();
                resolve(true);
            });
        });
    }

}
