'use strict';

/**
 * Patch 10A: Transform MCP tool names to built-in names for webview rendering.
 * Two parts:
 *  1. Insert the _transformForWebview function before the for-await loop
 *  2. Inject a reassignment line at the top of the loop body so all downstream
 *     code (system check, this.send, post-processor) sees transformed messages.
 *
 * v2.1.150 note: the loop body changed from a one-liner
 *   `for await (let A of q) this.send({...}), jP(A)`
 * to a multi-line block with a bridge_state filter before this.send. So we
 * no longer replace the loop body; we just inject one line at the top.
 */

const FOR_AWAIT_OPEN = /for await \(let \w+ of \w+\) \{?\s*$/;

const patch10aFunc = {
    id: 'patch-10a',
    name: 'io_message MCP→builtin name transform',

    appliedCheck: /_transformForWebview/,

    anchor: {
        // The for-await loop that sends io_messages in launchClaude.
        // In v2.1.150 the body is multi-line, so the opening is just `... ) {`.
        pattern: FOR_AWAIT_OPEN,
        context: /io_message/,
        contextRange: 30,
        hint: 'for-await loop in launchClaude that sends io_messages'
    },

    insertAt: {
        searchRange: 5,
        pattern: FOR_AWAIT_OPEN,
        relation: 'before'
    },

    detectVars: (ctx) => {
        const forMatch = ctx.match(/for await \(let (\w+) of (\w+)\)/);
        const chMatch = ctx.match(/channelId:\s*(\w+)/);
        return {
            iterVar: forMatch ? forMatch[1] : 'A',
            queryVar: forMatch ? forMatch[2] : 'M',
            channelVar: chMatch ? chMatch[1] : 'z'
        };
    },

    generate: (vars) => `                // --- forceLocal: transform MCP tool names to built-in names for webview rendering ---
                var _mcpToBuiltinName = {
                    "mcp__claude-vscode__read_file": "Read",
                    "mcp__claude-vscode__write_file": "Write",
                    "mcp__claude-vscode__edit_file": "Edit",
                    "mcp__claude-vscode__glob": "Glob",
                    "mcp__claude-vscode__grep": "Grep",
                    "mcp__claude-vscode__bash": "Bash"
                };
                var _transformForWebview = function(${vars.iterVar}) {
                    if (!isForceLocalMode()) return ${vars.iterVar};
                    // Primary path: transform assistant messages with tool_use content blocks
                    if (${vars.iterVar}.type === "assistant" && ${vars.iterVar}.message && Array.isArray(${vars.iterVar}.message.content)) {
                        var _changed = false;
                        var _newContent = ${vars.iterVar}.message.content.map(function(c) {
                            if (c.type === "tool_use" && c.name && _mcpToBuiltinName[c.name]) {
                                _changed = true;
                                var _transformed = Object.assign({}, c, { name: _mcpToBuiltinName[c.name] });
                                if (_transformed.input && _transformed.input.file_path) {
                                    try {
                                        var _rt_xf = require("./src/remote-tools");
                                        _transformed.input = Object.assign({}, _transformed.input, {
                                            file_path: _rt_xf.toRemotePath(_transformed.input.file_path)
                                        });
                                    } catch (_) {}
                                }
                                return _transformed;
                            }
                            return c;
                        });
                        if (_changed) return Object.assign({}, ${vars.iterVar}, { message: Object.assign({}, ${vars.iterVar}.message, { content: _newContent }) });
                    }
                    return ${vars.iterVar};
                };`
};

const patch10aLoop = {
    id: 'patch-10a-loop',
    name: 'io_message loop body transform',

    // After patch-10a-func runs, _transformForWebview exists. We further mark
    // that the reassignment is in place via a comment marker.
    appliedCheck: /_FL_XFORM_LOOP_/,

    anchor: {
        pattern: FOR_AWAIT_OPEN,
        context: /io_message/,
        contextRange: 30,
        hint: 'for-await loop sending io_messages'
    },

    insertAt: {
        searchRange: 5,
        pattern: FOR_AWAIT_OPEN,
        relation: 'after'
    },

    detectVars: (ctx) => {
        const forMatch = ctx.match(/for await \(let (\w+) of (\w+)\)/);
        return {
            iterVar: forMatch ? forMatch[1] : 'A'
        };
    },

    generate: (vars) => `                            /* _FL_XFORM_LOOP_ */ ${vars.iterVar} = _transformForWebview(${vars.iterVar});`
};

module.exports = [patch10aFunc, patch10aLoop];
