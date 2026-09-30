'use strict';

/**
 * Patch 16: openFile() — open remote files in forceLocal mode.
 *
 * In forceLocal mode, clicking a file link in the webview calls openFile()
 * which tries Uri.file(localPath) + existsSync(). Files are on the remote
 * server, so this silently fails. Fix: add a forceLocal early-return branch
 * that uses getRemoteUri() to open the file via VS Code's remote FS.
 *
 * For relative paths (e.g. "checkpoint.py"), getRemoteUri() may produce the
 * wrong URI. A .catch() fallback uses a$() (workspace.findFiles) to locate
 * the file on the remote workspace and retries with the found URI.
 */
module.exports = {
    id: 'patch-16',
    name: 'openFile() remote file open',

    appliedCheck: /forceLocal: openFile/,

    anchor: {
        pattern: /async openFile\([\w$]+, [\w$]+, [\w$]+\) \{/,
        context: /existsSync|Uri\.file|showTextDocument/,
        contextRange: 80,
        hint: 'openFile() method in the main class'
    },

    insertAt: {
        searchRange: 3,
        pattern: /async openFile\([\w$]+, [\w$]+, [\w$]+\) \{/,
        relation: 'after'
    },

    detectVars: (ctx) => {
        // Detect openFile(path, location, options).
        const fnMatch = ctx.match(/async openFile\(([\w$]+), ([\w$]+), ([\w$]+)\)/);
        // Detect vscode alias from r.Uri.file or r.window.showTextDocument
        const vscMatch = ctx.match(/([\w$]+)\.Uri\.file\(/);
        // Detect path module alias from P4.isAbsolute
        const pathMatch = ctx.match(/([\w$]+)\.isAbsolute\(/);
        const findMatch = ctx.match(/await ([\w$]+)\([\w$]+,\s*!0\)/);
        const headingMatch = ctx.match(/let [\w$]+ = ([\w$]+)\([\w$]+\.document\.getText\(\), [\w$]+\.heading\)/);
        return {
            pathVar: fnMatch ? fnMatch[1] : 'z',
            locVar: fnMatch ? fnMatch[2] : 'v',
            optsVar: fnMatch ? fnMatch[3] : 'Q',
            vscAlias: vscMatch ? vscMatch[1] : 'r',
            pathAlias: pathMatch ? pathMatch[1] : 'P4',
            findFn: findMatch ? findMatch[1] : 'jr',
            headingFn: headingMatch ? headingMatch[1] : '$f1'
        };
    },

    generate: (vars) => `        // --- forceLocal: open remote file via VS Code remote FS ---
        if (isForceLocalMode()) {
            try {
                var _rt_of = require("./src/remote-tools");
                var _remoteUri = _rt_of.getRemoteUri(${vars.pathVar});
                var _openOpts = ${vars.optsVar}?.pinned ? { preview: !1 } : void 0;
                var _openAtLoc = function(U) {
                    if (${vars.locVar}?.searchText) {
                        let V = U.document,
                            x = V.getText().indexOf(${vars.locVar}.searchText);
                        if (x !== -1) {
                            let O = V.positionAt(x),
                                B = V.positionAt(x + ${vars.locVar}.searchText.length),
                                q = new ${vars.vscAlias}.Range(O, B);
                            U.revealRange(q, ${vars.vscAlias}.TextEditorRevealType.InCenter), U.selection = new ${vars.vscAlias}.Selection(O, B)
                        }
                    } else if (${vars.locVar}?.heading) {
                        let V = ${vars.headingFn}(U.document.getText(), ${vars.locVar}.heading);
                        if (V !== void 0) {
                            let x = new ${vars.vscAlias}.Position(V - 1, 0),
                                O = new ${vars.vscAlias}.Range(x, x);
                            U.revealRange(O, ${vars.vscAlias}.TextEditorRevealType.InCenter), U.selection = new ${vars.vscAlias}.Selection(x, x)
                        }
                    } else if (${vars.locVar}) {
                        let V = new ${vars.vscAlias}.Range(new ${vars.vscAlias}.Position((${vars.locVar}.startLine || 1) - 1, 0), new ${vars.vscAlias}.Position((${vars.locVar}.endLine || ${vars.locVar}.startLine || 1) - 1, 0));
                        U.revealRange(V, ${vars.vscAlias}.TextEditorRevealType.InCenter), U.selection = new ${vars.vscAlias}.Selection(V.start, V.end)
                    }
                };
                try {
                    let _editor_of = await ${vars.vscAlias}.window.showTextDocument(_remoteUri, _openOpts);
                    _openAtLoc(_editor_of);
                } catch (_err_of) {
                    if (!${vars.pathAlias}.isAbsolute(${vars.pathVar})) {
                        let _found = await ${vars.findFn}(${vars.pathVar}, !0);
                        if (_found.length > 0) {
                            let _foundUri = _rt_of.getRemoteUri(_found[0].path);
                            let _foundEditor = await ${vars.vscAlias}.window.showTextDocument(_foundUri, _openOpts);
                            _openAtLoc(_foundEditor);
                            return;
                        }
                    }
                    throw _err_of;
                }
                return;
            } catch (_e_of) {
                (this.output || this.logger).warn("forceLocal: openFile failed for", ${vars.pathVar}, _e_of.message || _e_of);
                return;
            }
        }
        // --- end forceLocal openFile ---`
};
