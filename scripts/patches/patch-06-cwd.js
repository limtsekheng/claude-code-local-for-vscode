'use strict';

/**
 * Patch 06: Webview/panel cwd resolution.
 * Three locations in v2.1.150: resolveWebviewView(), setupPanel(), resolveSessionListView().
 * (v2.1.71 only had the first two.) Replaces RF.realpathSync(...) with
 * conditional getForceLocalCwd(). Each sub-patch's appliedCheck is method-scoped
 * so they don't false-skip each other on re-runs.
 */
module.exports = [
    {
        id: 'patch-06a',
        name: 'resolveWebviewView cwd',

        // Method-scoped check (was previously too loose — would match any
        // patched location and falsely skip this one on re-runs).
        appliedCheck: /resolveWebviewView[\s\S]{1,600}isForceLocalMode\(\) \? getForceLocalCwd\(\)/,

        anchor: {
            pattern: /resolveWebviewView\([\w$]+, [\w$]+, [\w$]+\) \{/,
            context: /getHtmlForWebview/,
            contextRange: 20,
            hint: 'resolveWebviewView method'
        },

        insertAt: {
            searchRange: 25,
            pattern: /[\w$]+ = cE\([\w$]+\)(?:,|;)/,
            relation: 'replace',
            replaceLines: 1
        },

        detectVars: (ctx) => {
            const match = ctx.match(/([\w$]+) = cE\(([\w$]+)\)(,|;)/);
            return {
                resultVar: match ? match[1] : 'Y',
                arrVar: match ? match[2] : 'X',
                terminator: match ? match[3] : ','
            };
        },

        generate: (vars) =>
            `            ${vars.resultVar} = isForceLocalMode() ? getForceLocalCwd() : cE(${vars.arrVar})${vars.terminator}`
    },
    {
        id: 'patch-06b',
        name: 'setupPanel cwd',

        // Use same check — both locations have realpathSync in unpatched code
        appliedCheck: /setupPanel[\s\S]{1,500}isForceLocalMode\(\) \? getForceLocalCwd\(\)/,

        anchor: {
            // setupPanel method definition (not call site)
            pattern: /^\s+setupPanel\([\w$]+, [\w$]+, [\w$]+, [\w$]+, [\w$]+\) \{/,
            context: /panelFullEditor\.set/,
            contextRange: 15,
            hint: 'setupPanel method definition with realpathSync inside'
        },

        insertAt: {
            searchRange: 25,
            pattern: /[\w$]+ = cE\([\w$]+\)(?:,|;)/,
            relation: 'replace',
            replaceLines: 1
        },

        detectVars: (ctx) => {
            const match = ctx.match(/([\w$]+) = cE\(([\w$]+)\)(,|;)/);
            return {
                resultVar: match ? match[1] : 'z',
                arrVar: match ? match[2] : 'W',
                terminator: match ? match[3] : ','
            };
        },

        generate: (vars) =>
            `            ${vars.resultVar} = isForceLocalMode() ? getForceLocalCwd() : cE(${vars.arrVar})${vars.terminator}`
    },
    {
        id: 'patch-06c',
        name: 'resolveSessionListView cwd',

        appliedCheck: /resolveSessionListView[\s\S]{1,600}isForceLocalMode\(\) \? getForceLocalCwd\(\)/,

        anchor: {
            // resolveSessionListView method definition.
            // Added in v2.1.150 (sidebar session list webview). On Windows, the
            // unpatched realpathSync('/a2000') resolves to 'C:\a2000' and fails
            // with ENOENT, blocking extension activation in forceLocal mode.
            pattern: /^\s+resolveSessionListView\([\w$]+, [\w$]+, [\w$]+\) \{/,
            context: /this\.sessionListView\s*=/,
            contextRange: 15,
            hint: 'resolveSessionListView method definition with realpathSync inside'
        },

        insertAt: {
            searchRange: 25,
            pattern: /[\w$]+ = cE\([\w$]+\)(?:,|;)/,
            relation: 'replace',
            replaceLines: 1
        },

        detectVars: (ctx) => {
            const match = ctx.match(/([\w$]+) = cE\(([\w$]+)\)(,|;)/);
            return {
                resultVar: match ? match[1] : 'Y',
                arrVar: match ? match[2] : 'X',
                terminator: match ? match[3] : ';'
            };
        },

        generate: (vars) =>
            `            ${vars.resultVar} = isForceLocalMode() ? getForceLocalCwd() : cE(${vars.arrVar})${vars.terminator}`
    }
];
