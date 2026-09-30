'use strict';

/**
 * Patch 08: Register remote tools on in-process MCP server in launchClaude().
 * Includes _reviewEdit callback for review mode.
 * Inserted after AS() server creation and before getAdditionalMcpServers().
 */
module.exports = {
    id: 'patch-08',
    name: 'launchClaude in-process MCP + _reviewEdit',

    appliedCheck: /forceLocal: registered remote tools on in-process MCP server/,

    anchor: {
        // getAdditionalMcpServers() call in launchClaude — right after MCP server creation
        pattern: /\w+ = this\.getAdditionalMcpServers\(\)/,
        context: /file_updated|onExperimentGatesUpdated/,
        hint: 'getAdditionalMcpServers() call in launchClaude, after WP()/AS() MCP server creation'
    },

    insertAt: {
        searchRange: 5,
        // Find the }),  line (end of WP() call) that precedes getAdditionalMcpServers
        // Replace it + the getAdditionalMcpServers line to break the let chain
        pattern: /\}\),\s*$/,
        relation: 'replace',
        replaceLines: 2
    },

    detectVars: (ctx, fullCode) => {
        // Detect the MCP server variable (x in v2.1.71, j in v2.1.42)
        const serverMatch = ctx.match(/(\w+) = \w+\(\(\w+\) => \{\s*\n\s*this\.onExperimentGatesUpdated/);
        // Detect markdown plan check function (ev in v2.1.71, Dz in v2.1.42)
        const mdCheckMatch = ctx.match(/if \((\w+)\(\w+\)\)[\s\S]*?openMarkdownPreview/);
        // Permission mode = launchClaude's 4th parameter (x in v2.1.150). Must be in scope at the
        // patch site. Naive spawnClaude regex wrongly captures G from async (M, G, F).
        const code = fullCode || ctx;
        const launchMatch = code.match(/async launchClaude\(([\w$]+),\s*[\w$]+,\s*[\w$]+,\s*([\w$]+),/);
        // Detect the getAdditionalMcpServers result var (O in v2.1.71)
        const addMcpMatch = ctx.match(/([\w$]+) = this\.getAdditionalMcpServers\(\)/);
        // Detect module-level zod var compatible with MCP SDK (e in v2.1.71, O0 in v2.1.150).
        // Multiple zod bundles may exist (e.g. v4 at `j`, v3 at `O0`). The MCP SDK
        // needs the Zod v3 bundle. Find it via the MCP tool schema in Ri() —
        // anchored on the executeCode tool definition.
        let zodVar = 'e';
        if (fullCode) {
            const execMatch = fullCode.match(/executeCode[\s\S]{0,2000}?code:\s*([A-Za-z_$][\w$]*)\.string\(\)\.describe\(/);
            if (execMatch) {
                zodVar = execMatch[1];
            } else {
                // Fallback: first .string().describe usage in the file
                const useMatch = fullCode.match(/([A-Za-z_$][\w$]*)\.string\(\)\.describe\(/);
                if (useMatch) zodVar = useMatch[1];
            }
        }
        return {
            serverVar: serverMatch ? serverMatch[1] : 'x',
            // The first launchClaude parameter is the active channel id. Looking
            // for the first `channelId:` in a wide context is unsafe in 2.1.284
            // because an unrelated callback appears first.
            channelVar: launchMatch ? launchMatch[1] : 'z',
            mdCheckFn: mdCheckMatch ? mdCheckMatch[1] : 'ev',
            permVar: launchMatch ? launchMatch[2] : 'x',
            addMcpVar: addMcpMatch ? addMcpMatch[1] : 'O',
            zodVar: zodVar
        };
    },

    generate: (vars) => `                });
            // --- forceLocal: register remote file proxy tools on in-process MCP server ---
            if (isForceLocalMode()) {
                try {
                    var _remoteTools2 = require("./src/remote-tools");
                    var _fileUpdatedCb = (D, A, w) => {
                        if (${vars.mdCheckFn}(D)) return;
                        this.send({
                            type: "file_updated",
                            channelId: ${vars.channelVar},
                            filePath: D,
                            oldContent: A,
                            newContent: w
                        });
                    };
                    // --- forceLocal: _reviewEdit callback for review mode ---
                    // Sends tool_permission_request to webview, which triggers dialog + open_diff.
                    // RY() handles the diff tab natively (blocks until Accept/Reject).
                    // User modifications stored via setEditOverride() in RY(), consumed here.
                    var _selfIJ = this;
                    var _forceLocalAcceptAll = false;
                    // Initial permission mode from launch_claude (${vars.permVar} in v2.1.150); updated via setPermissionMode.
                    var _forceLocalPermMode = ${vars.permVar} || _selfIJ.settings.getInitialPermissionMode() || "default";
                    var _origSetPermissionMode = _selfIJ.setPermissionMode.bind(_selfIJ);
                    _selfIJ.setPermissionMode = async function(_v, _z) {
                        if (_v === ${vars.channelVar}) _forceLocalPermMode = _z;
                        return _origSetPermissionMode(_v, _z);
                    };
                    var _reviewEdit = async function(mcpToolName, toolInput, oldContent, newContent) {
                        var vsc = require("vscode");
                        var config = vsc.workspace.getConfiguration("claudeCode");
                        var diffMode = config.get("forceLocalDiffMode", "auto");
                        if (diffMode !== "review") return { accepted: true, finalContent: newContent };

                        // Bypass review if permission mode is "bypassPermissions" or "acceptEdits"
                        if (_forceLocalPermMode === "bypassPermissions" || _forceLocalPermMode === "acceptEdits") return { accepted: true, finalContent: newContent };
                        // Bypass review if user chose "allow all edits this session" (button 2)
                        if (_forceLocalAcceptAll) return { accepted: true, finalContent: newContent };

                        var _rt = require("./src/remote-tools");
                        var remotePath = _rt.toRemotePath(toolInput.file_path);

                        // Send tool_permission_request — triggers webview dialog AND open_diff → RY().
                        // RY() handles the diff tab natively (blocks until Accept/Reject).
                        var webviewToolName = mcpToolName === "edit_file" ? "Edit" : "Write";
                        var webviewInputs = Object.assign({}, toolInput, { file_path: remotePath });

                        try {
                            var response = await _selfIJ.sendRequest(${vars.channelVar}, {
                                type: "tool_permission_request",
                                toolName: webviewToolName,
                                inputs: webviewInputs,
                                suggestions: [{ type: "setMode", mode: "acceptEdits", destination: "session" }]
                            }, null);

                            var accepted = response.result.behavior === "allow";

                            if (accepted) {
                                // Check if user chose "allow all edits this session"
                                var perms = response.result.updatedPermissions;
                                if (perms && perms.length > 0) {
                                    for (var _p = 0; _p < perms.length; _p++) {
                                        if (perms[_p].type === "setMode" && perms[_p].mode === "acceptEdits") {
                                            _forceLocalAcceptAll = true;
                                            break;
                                        }
                                    }
                                }
                                // RY() stores user-modified content via setEditOverride() on Accept.
                                // Consume it here; falls back to original newContent if no override.
                                var override = _rt.consumeEditOverride(remotePath);
                                var finalContent = override !== null ? override : newContent;
                                return { accepted: true, finalContent: finalContent };
                            } else {
                                return { accepted: false };
                            }
                        } catch (e) {
                            (_selfIJ.output || _selfIJ.logger).warn("forceLocal: reviewEdit error", e.message || e);
                            return { accepted: false };
                        }
                    };
                    // zodVar is the module-level zod schema bundle (var X = {}; ... string: () => ...).
                    // Detected dynamically — was 'e' in v2.1.71, 'O0' in v2.1.150.
                    _remoteTools2.registerTools(${vars.serverVar}.instance, ${vars.zodVar}, this.output || this.logger, _fileUpdatedCb, _reviewEdit);
                    (this.output || this.logger).info("forceLocal: registered remote tools on in-process MCP server. Tools: " + Object.keys(${vars.serverVar}.instance._registeredTools).length);
                } catch (_rtErr2) {
                    (this.output || this.logger).error("forceLocal: FAILED to register remote tools on in-process MCP server: " + (_rtErr2.message || _rtErr2));
                }
            }
            let ${vars.addMcpVar} = this.getAdditionalMcpServers(),`
};
