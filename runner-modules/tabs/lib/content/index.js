'use strict';
/* global window:false */
const EventEmitter = require('events').EventEmitter;

const ContentRPC = require('../../../../lib/contentRpc/ContentRPC');
const tabsMethods = require('./tabsMethods');
const log = require('../../../../lib/logger')({hostname: 'content', MODULE: 'tabs/content/index'});
const contentUnloadEvent = require('./contentUnloadEvent');
const ModuleRegister = require('../../../../lib/ModuleRegister');
const tabsModule = require('./tabsModule');

log.debug('Initializing...');

try {
    if (window.openRunnerRegisterRunnerModule) {
        throw Error('This tab has already had its content initialized!');
    }

    const moduleRegister = new ModuleRegister();
    // getModule is similar to include() in the other scopes, however it only supports modules which have already
    // been loaded (or are in the progress of loading)
    const getModule = name => moduleRegister.waitForModuleRegistration(name);
    const eventEmitter = new EventEmitter();
    const fireContentUnload = contentUnloadEvent(eventEmitter);
    let backgroundScriptInitData = null;
    const scriptApiVersion = () => backgroundScriptInitData && backgroundScriptInitData.scriptApiVersion;
    const initializedMainTabContent = async (data) => {
        // when we send 'tabs.mainContentInit' to the background script, the background script will then in turn send us
        // 'tabs.initializedMainTabContent', after which it will begin to load runner modules
        // backgroundScriptInitData = {scriptApiVersion}
        backgroundScriptInitData = data;
    };
    const rpc = new ContentRPC({
        browserRuntime: browser.runtime,
        context: 'runner-modules/tabs',
    });
    rpc.attach();
    rpc.methods(tabsMethods(moduleRegister, eventEmitter, scriptApiVersion));
    rpc.method('tabs.contentUnload', fireContentUnload);
    rpc.method('tabs.initializedMainTabContent', initializedMainTabContent);
    window.addEventListener('unload', fireContentUnload);
    eventEmitter.on('tabs.contentUnload', () => log.debug('Content is about to unload'));

    eventEmitter.on('tabs.contentUnload', () => {
        // eslint-disable-next-line camelcase, no-undef
        const myCoverage = typeof __runner_coverage__ === 'object' && __runner_coverage__;
        /* istanbul ignore else */
        if (myCoverage) {
            rpc.callAndForget('core.submitCodeCoverage', myCoverage);
        }
    });

    const openRunnerRegisterRunnerModule = async (moduleName, func) => {
        try {
            if (typeof func !== 'function') {
                throw Error('openRunnerRegisterRunnerModule(): Invalid `func`');
            }

            if (!backgroundScriptInitData) {
                throw Error(
                    'openRunnerRegisterRunnerModule(): Called too early. Background script has not yet sent ' +
                    '\'tabs.initializedMainTabContent\' to content script'
                );
            }

            const initModule = async () => {
                return await func({
                    eventEmitter,
                    getModule,
                    rpc,
                    scriptApiVersion: scriptApiVersion(),
                });
            };

            const promise = initModule();
            moduleRegister.registerModule(moduleName, promise);

            log.debug({moduleName}, 'Runner module has been initialized. Notifying the background script');
            await rpc.call('tabs.contentInit', {moduleName});
        }
        catch (err) {
            log.error({err}, 'Error during openRunnerRegisterRunnerModule()');
            throw err;
        }
    };

    const handleWindowMessage = event => {
        // Note!! These messages could come from anywhere (the web)!
        const {data} = event;
        if (typeof data !== 'object') {
            return;
        }

        const {openrunnerTabsFrameToken} = data;

        if (typeof openrunnerTabsFrameToken !== 'string' || Object.keys(data).length !== 1) {
            return;
        }

        const frameToken = String(openrunnerTabsFrameToken);
        event.stopImmediatePropagation();
        log.debug({frameToken}, 'Received frame token from parent frame');
        rpc.callAndForget('tabs.receivedFrameToken', frameToken);
    };

    moduleRegister.registerModule('tabs', Promise.resolve(tabsModule({eventEmitter, getModule, rpc})));

    window.openRunnerRegisterRunnerModule = openRunnerRegisterRunnerModule;
    window.addEventListener('message', handleWindowMessage, false);
    // Workaround for firefox bug (last tested to occur in v57 and v65)
    // it seems that sometimes this content script is executed so early that firefox still has to perform some kind of house keeping,
    // which causes our global variable to disappear. assigning the global variable again in a microtask works around this bug.
    Promise.resolve().then(() => {
        window.openRunnerRegisterRunnerModule = openRunnerRegisterRunnerModule;
    });
    window.addEventListener('openrunnerinitmoduleframework', e => {
        e.stopImmediatePropagation();
        window.openRunnerRegisterRunnerModule = openRunnerRegisterRunnerModule;
    });

    log.debug('Initialized... Notifying the background script');
    rpc.callAndForget('tabs.mainContentInit');
}
catch (err) {
    log.error({err}, 'Error during initialization');
}
