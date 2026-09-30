'use strict';

/**
 * Patch 11: RY() and Ac() — diff tab reads remote content in forceLocal mode.
 * Two locations: RY() for SDK open_diff, Ac() for MCP openDiff tool.
 */
module.exports = [
    {
        id: 'patch-11a',
        name: 'RY() remote content read',

        appliedCheck: /forceLocal: RY remote read failed/,

        anchor: {
            // rV1()/Jk()/RY() function with the [Claude Code] diff tab.
            // The function grew from 9 to 12 parameters in 2.1.284.
            pattern: /^async function [\w$]+\(/,
            context: /✻ \[Claude Code\]/,
            contextRange: 20,
            hint: 'Diff tab function (Jk/RY) — 9 params, creates [Claude Code] diff tab'
        },

        insertAt: {
            searchRange: 30,
            // Find the original file-reading block: G = V4.Uri.file(K), or D = a0.Uri.file(V);
            pattern: /[\w$]+ = [\w$]+\.Uri\.file\([\w$]+\)[,;]/,
            relation: 'replace-region',
            // Replace from Uri.file() through the leftTempFileProvider.createFile line
            regionEnd: /leftTempFileProvider\.createFile/,
            regionEndOffset: 1
        },

        detectVars: (ctx) => {
            // Detect vscode alias from Uri.file usage (V4 in v2.1.71, a0 in v2.1.42)
            const vscMatch = ctx.match(/([\w$]+)\.Uri\.file\([\w$]+\)/);
            // Detect logger from "diff from" log
            const logMatch = ctx.match(/([\w$]+)\.info\("diff from"/);
            // Detect left provider from createFile("", ...)
            const provMatch = ctx.match(/([\w$]+)\.createFile\([\w$]+, ""\)\.uri/);
            // Detect URI variable from let X = *.Uri.file(Y)
            const uriMatch = ctx.match(/let ([\w$]+) = [\w$]+\.Uri\.file/);
            // Detect content variable: X = "" after the let declaration
            const contentMatch = ctx.match(/(?:let [\w$]+ = [\w$]+\.Uri\.file\([\w$]+\),\s*)([\w$]+) = ""/);
            // Fallback: look for standalone X = "" pattern
            const contentFallback = ctx.match(/([\w$]+) = ""/);
            // Detect fs module alias from readFileSync
            const fsMatch = ctx.match(/([\w$]+)\.readFileSync\([\w$]+, "utf8"\)/);
            // Detect file path from Uri.file(X)
            const fpMatch = ctx.match(/\.Uri\.file\(([\w$]+)\)/);
            // Detect createFile path from readFileSync(X, ...) — may differ from Uri.file path
            const cpMatch = ctx.match(/\.readFileSync\(([\w$]+),/);
            return {
                vscAlias: vscMatch ? vscMatch[1] : 'V4',
                logVar: logMatch ? logMatch[1] : 'z',
                provVar: provMatch ? provMatch[1] : 'j',
                uriVar: uriMatch ? uriMatch[1] : 'G',
                contentVar: contentMatch ? contentMatch[1] : (contentFallback ? contentFallback[1] : '$'),
                fsAlias: fsMatch ? fsMatch[1] : 'bk',
                filePathVar: fpMatch ? fpMatch[1] : 'K',
                createPathVar: cpMatch ? cpMatch[1] : (fpMatch ? fpMatch[1] : 'K')
            };
        },

        generate: (vars) => `    let ${vars.uriVar}, ${vars.contentVar} = "";
    if (isForceLocalMode()) {
        try {
            var _rt_ry = require("./src/remote-tools");
            var _remUri_ry = _rt_ry.getRemoteUri(${vars.filePathVar});
            var _remData_ry = await ${vars.vscAlias}.workspace.fs.readFile(_remUri_ry);
            ${vars.contentVar} = Buffer.from(_remData_ry).toString("utf8");
            ${vars.uriVar} = ${vars.provVar}.createFile(${vars.createPathVar}, ${vars.contentVar}).uri;
        } catch (_e_ry) {
            ${vars.logVar}.info("forceLocal: RY remote read failed", ${vars.filePathVar}, _e_ry.message || _e_ry);
            ${vars.contentVar} = "";
            ${vars.uriVar} = ${vars.provVar}.createFile(${vars.createPathVar}, "").uri;
        }
    } else {
        ${vars.uriVar} = ${vars.vscAlias}.Uri.file(${vars.filePathVar});
        try {
            let F6 = await ${vars.vscAlias}.workspace.openTextDocument(${vars.uriVar});
            if (F6.isDirty) ${vars.contentVar} = ${vars.fsAlias}.readFileSync(${vars.createPathVar}, "utf8"), ${vars.uriVar} = ${vars.provVar}.createFile(${vars.createPathVar}, ${vars.contentVar}).uri;
            else ${vars.contentVar} = F6.getText()
        } catch (F6) {
            ${vars.logVar}.info("leftTempFileProvider.createFile", ${vars.createPathVar}), ${vars.uriVar} = ${vars.provVar}.createFile(${vars.createPathVar}, "").uri
        }
    }`
    },
    {
        id: 'patch-11a-accept',
        name: 'RY() Accept override for forceLocal',

        appliedCheck: /setEditOverride.*toRemotePath/,

        anchor: {
            pattern: /if \([\w$]+\.accepted\) \{/,
            context: /diff_accepted[\s\S]*?"multiple"[\s\S]*?"single"/,
            contextRange: 8,
            hint: 'Accept handler in Jk()/RY() diff flow with "multiple"/"single"'
        },

        insertAt: {
            searchRange: 6,
            // 2.1.284 expanded the accepted handler into a seven-line block.
            pattern: /if \([\w$]+\.accepted\) \{/,
            relation: 'replace',
            replaceLines: 7
        },

        detectVars: (ctx) => {
            const acceptMatch = ctx.match(/if \(([\w$]+)\.accepted\) \{/);
            const logMatch = ctx.match(/([\w$]+)\.info\("diff_accepted", ([\w$]+)\)/);
            const unchangedMatch = ctx.match(/if \([\w$]+\.info\("diff_accepted"[\s\S]*?,\s*([\w$]+) === ([\w$]+)\) return ([\w$]+);/);
            const applyMatch = ctx.match(/return ([\w$]+)\(([\w$]+), ([\w$]+), ([\w$]+), ([\w$]+) \? "multiple" : "single"/);
            return {
                acceptVar: acceptMatch ? acceptMatch[1] : 't',
                logVar: logMatch ? logMatch[1] : '$',
                diffLabel: logMatch ? logMatch[2] : 'F',
                currentContentVar: unchangedMatch ? unchangedMatch[1] : 'C',
                proposedContentVar: unchangedMatch ? unchangedMatch[2] : 'j',
                unchangedResultVar: unchangedMatch ? unchangedMatch[3] : 'W',
                applyFn: applyMatch ? applyMatch[1] : 'bm',
                filePathVar: applyMatch ? applyMatch[2] : 'Y',
                oldContentVar: applyMatch ? applyMatch[3] : 'D',
                modeVar: applyMatch ? applyMatch[5] : 'z'
            };
        },

        generate: (vars) => `            if (${vars.acceptVar}.accepted) {
                ${vars.logVar}.info("diff_accepted", ${vars.diffLabel});
                var _userText = ${vars.currentContentVar};
                if (isForceLocalMode()) {
                    try {
                        var _rt_acc = require("./src/remote-tools");
                        _rt_acc.setEditOverride(_rt_acc.toRemotePath(${vars.filePathVar}), _userText);
                        ${vars.logVar}.info("forceLocal: user modified diff, stored override for", ${vars.filePathVar});
                    } catch (_e_acc) {}
                }
                if (${vars.currentContentVar} === ${vars.proposedContentVar}) return ${vars.unchangedResultVar};
                return ${vars.applyFn}(${vars.filePathVar}, ${vars.oldContentVar}, _userText, ${vars.modeVar} ? "multiple" : "single", {
                    normalizeLineEndings: L
                });
            }
            return`
    },
    {
        id: 'patch-11b',
        name: 'Ac() remote content read',

        appliedCheck: /forceLocal: Ac remote read failed/,

        anchor: {
            // ug1()/Hi()/Ac() — MCP openDiff handler.
            pattern: /^async function [\w$]+\(/,
            context: /registerCommand\("type"/,
            contextRange: 60,
            hint: 'Second diff function (Hi/Ac) near TabInputTextDiff, NOT the ✻ [Claude Code] diff'
        },

        insertAt: {
            searchRange: 30,
            // Find the Uri.file() assignment after the "diff from" log
            pattern: /let [\w$]+ = [\w$]+\.Uri\.file\([\w$]+\);/,
            relation: 'replace-region',
            regionEnd: /leftTempFileProvider\.createFile/,
            regionEndOffset: 1
        },

        detectVars: (ctx) => {
            // Match: let B = $4.Uri.file(K);
            const uriAssignMatch = ctx.match(/let ([\w$]+) = ([\w$]+)\.Uri\.file\(([\w$]+)\);/);
            const logMatch = ctx.match(/([\w$]+)\.info\("diff from"/);
            const provMatch = ctx.match(/([\w$]+)\.createFile\([\w$]+, ""\)\.uri/);
            const fsMatch = ctx.match(/([\w$]+)\.readFileSync\([\w$]+, "utf8"\)/);
            return {
                vscAlias: uriAssignMatch ? uriAssignMatch[2] : '$4',
                logVar: logMatch ? logMatch[1] : 'z',
                provVar: provMatch ? provMatch[1] : 'v',
                uriVar: uriAssignMatch ? uriAssignMatch[1] : 'B',
                fsAlias: fsMatch ? fsMatch[1] : 'qi',
                filePathVar: uriAssignMatch ? uriAssignMatch[3] : 'K'
            };
        },

        generate: (vars) => `    let ${vars.uriVar};
    if (isForceLocalMode()) {
        // forceLocal: read old content from remote, fall back to empty
        var _oldContent_ac = "";
        try {
            var _rt_ac = require("./src/remote-tools");
            var _remoteUri_ac = _rt_ac.getRemoteUri(${vars.filePathVar});
            var _remoteData_ac = await ${vars.vscAlias}.workspace.fs.readFile(_remoteUri_ac);
            _oldContent_ac = Buffer.from(_remoteData_ac).toString("utf8");
        } catch (_err_ac) {
            ${vars.logVar}.info("forceLocal: Ac remote read failed", ${vars.filePathVar}, _err_ac.message || _err_ac);
        }
        ${vars.uriVar} = ${vars.provVar}.createFile(${vars.filePathVar}, _oldContent_ac).uri;
    } else {
        ${vars.uriVar} = ${vars.vscAlias}.Uri.file(${vars.filePathVar});
        try {
            if ((await ${vars.vscAlias}.workspace.openTextDocument(${vars.uriVar})).isDirty) {
                let _localContent_ac = ${vars.fsAlias}.readFileSync(${vars.filePathVar}, "utf8");
                ${vars.uriVar} = ${vars.provVar}.createFile(${vars.filePathVar}, _localContent_ac).uri
            }
        } catch (T) {
            ${vars.logVar}.info("leftTempFileProvider.createFile", ${vars.filePathVar}), ${vars.uriVar} = ${vars.provVar}.createFile(${vars.filePathVar}, "").uri
        }
    }`
    }
];
