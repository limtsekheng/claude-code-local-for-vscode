'use strict';

/**
 * Patch 03+09: spawnClaude — disable built-in tools, set cwd, add MCP hooks.
 * Also includes CLAUDECODE env deletion.
 *
 * Inserted after the options object closing `};` that contains settingSources.
 * Also patches the env line to delete CLAUDECODE.
 */
module.exports = [
    {
        id: 'patch-03',
        name: 'spawnClaude disallowedTools + cwd + hooks',

        appliedCheck: /forceLocal: CLI will run locally/,

        anchor: {
            pattern: /settingSources:\s*\["user",\s*"project",\s*"local"\]/,
            context: /hooks:\s*\{[\s\S]*?PreToolUse|PostToolUse/,
            hint: 'settingSources in spawnClaude options object'
        },

        insertAt: {
            searchRange: 30,
            // Find the line that assigns env to H (the options object)
            pattern: /\w+\.pathToClaudeCodeExecutable\s*=\s*\w+.*\w+\.executableArgs\s*=\s*\w+.*\w+\.env\s*=/,
            fallbackPattern: /\.pathToClaudeCodeExecutable\s*=\s*\w+/,
            relation: 'before',
            contextRange: 200
        },

        detectVars: (ctx) => {
            // Detect the diagnostics tracker variable (used for captureBaseline)
            const diagMatch = ctx.match(/(\w+)\.captureBaseline\(/);
            // Detect the options object variable name (H in v2.1.71, q in v2.1.42)
            const optsMatch = ctx.match(/let (\w+) = \{\s*\n\s*cwd:/);
            return {
                diagVar: diagMatch ? diagMatch[1] : 'B',
                optsVar: optsMatch ? optsMatch[1] : 'H'
            };
        },

        generate: (vars) => `        // --- forceLocal: disable built-in file tools, use local cwd ---
        if (isForceLocalMode()) {
            ${vars.optsVar}.cwd = getForceLocalCwd();
            // additionalDirectories is populated by the unpatched code from
            // workspaceFolders[1..].uri.fsPath — those are REMOTE paths handed
            // to a LOCAL CLI, which on Windows interprets them against the
            // current drive (C:\<remote-path>) and gets ENOENT. Wipe them.
            // Multi-root remote workspaces would otherwise leak local-looking
            // paths to the agent's "additional dirs" prompt.
            ${vars.optsVar}.additionalDirectories = [];
            // SDK toolAliases: when the model (or a Task subagent) calls the familiar
            // built-in names Read/Write/Edit/..., route to our remote MCP proxies.
            // Disabling Read outright makes subagents fall back to WebFetch(file://...).
            ${vars.optsVar}.toolAliases = Object.assign({}, ${vars.optsVar}.toolAliases, {
                Read: "mcp__claude-vscode__read_file",
                Write: "mcp__claude-vscode__write_file",
                Edit: "mcp__claude-vscode__edit_file",
                Glob: "mcp__claude-vscode__glob",
                Grep: "mcp__claude-vscode__grep",
                Bash: "mcp__claude-vscode__bash"
            });
            ${vars.optsVar}.disallowedTools = [
                "MultiEdit",
                "NotebookEdit", "NotebookRead",
                "WebFetch"
            ];
            ${vars.optsVar}.allowedTools = [
                "Read", "Write", "Edit", "Glob", "Grep", "Bash",
                "mcp__claude-vscode__read_file",
                "mcp__claude-vscode__glob",
                "mcp__claude-vscode__grep",
                "mcp__claude-vscode__bash",
                "mcp__claude-vscode__write_file",
                "mcp__claude-vscode__edit_file"
            ];
            // Task subagents under web-search isolation cannot see MCP tools unless exempted.
            var _flMcpExempt = ${vars.optsVar}.webSearchIsolationExemptMcpServers;
            if (!Array.isArray(_flMcpExempt)) _flMcpExempt = _flMcpExempt ? [_flMcpExempt] : [];
            if (_flMcpExempt.indexOf("claude-vscode") < 0) _flMcpExempt.push("claude-vscode");
            ${vars.optsVar}.webSearchIsolationExemptMcpServers = _flMcpExempt;
            // --- forceLocal: tell the agent (and any subagents it spawns via Task) that
            // the CWD it sees is a LOCAL PROXY, and that file ops must go through MCP. ---
            // Without this, the agent sees a Windows path like
            //   C:\\Users\\<user>\\.claude\\remote\\<host>\\<encoded>\\...
            // and assumes it's a real local workspace — leading it to call WebFetch with
            // file:// URLs, or to invent Windows-absolute paths that don't map to anything.
            try {
                var _rtCfg = require("./src/remote-tools");
                var _proxyCwd = getForceLocalCwd();
                var _realRemoteCwd = "";
                try { _realRemoteCwd = _rtCfg.getRemoteCwd ? _rtCfg.getRemoteCwd() : ""; } catch (_) {}
                var _sshHost = "";
                try { _sshHost = _rtCfg.getSshHost ? _rtCfg.getSshHost() : ""; } catch (_) {}
                var _forceLocalPrompt =
                    "\\n\\n<force-local-mode>\\n" +
                    "You are running in Claude Code Local force-local mode. The CLI runs on the user's local " +
                    "machine but the actual workspace lives on a remote server (SSH host: \\"" + _sshHost + "\\").\\n" +
                    "\\n" +
                    "Apparent working directory (LOCAL PROXY, no real files here):\\n  " + _proxyCwd + "\\n" +
                    "Real remote workspace root:\\n  " + _realRemoteCwd + "\\n" +
                    "\\n" +
                    "Tool usage rules — STRICT:\\n" +
                    "  * For ALL file reads / writes / edits / globs / greps / shell commands, use the standard tools Read, Write, Edit, Glob, Grep, and Bash.\\n" +
                    "    They are wired to proxy to the remote server (not the empty local proxy cwd).\\n" +
                    "  * NEVER use WebFetch to read workspace files — WebFetch is disabled here. Do NOT use file:// URLs.\\n" +
                    "  * ALWAYS address files by their REAL remote absolute path, which starts at the remote root:\\n" +
                    "      " + (_realRemoteCwd || "/remote/path") + "/src/foo.py\\n" +
                    "    A bare relative path (e.g. \\"src/foo.py\\" or \\"score_threshold.py\\") resolves against that remote root — that is also fine.\\n" +
                    "  * CRITICAL: do NOT prepend a Windows drive letter to a remote path. The CLI's apparent cwd lives on a\\n" +
                    "    local drive (e.g. C:\\\\...), but the files do NOT. Paths like \\"C:/" + (_realRemoteCwd ? _realRemoteCwd.replace(/^\\//, "") : "remote/path") + "/...\\"\\n" +
                    "    or \\"C:\\\\\\\\...\\" are WRONG and will fail. Use forward-slash posix paths only (e.g. " + (_realRemoteCwd || "/remote/path") + "/...).\\n" +
                    "  * NEVER pass file_path under .claude\\\\remote\\\\ or the proxy cwd — those directories are empty on disk.\\n" +
                    "    Always use the real remote path (e.g. " + (_realRemoteCwd || "/remote/path") + "/filename).\\n" +
                    "  * NEVER spawn an Agent (Task) subagent to read or explain a file — call Read yourself. Subagents cannot reach the remote filesystem in this mode.\\n" +
                    "  * Task subagents are often read-only (Read/Glob/Grep only, no Bash). Do not use PowerShell or Bash as a Read substitute.\\n" +
                    "</force-local-mode>";
                // Attach to the main agent's system prompt (existing preset has an 'append' slot).
                if (${vars.optsVar}.systemPrompt && typeof ${vars.optsVar}.systemPrompt === "object") {
                    ${vars.optsVar}.systemPrompt.append =
                        (${vars.optsVar}.systemPrompt.append ? ${vars.optsVar}.systemPrompt.append : "") + _forceLocalPrompt;
                }
                // Also propagate to subagents spawned via the Task tool — they inherit a separate
                // system prompt and otherwise wouldn't know about the proxy setup.
                ${vars.optsVar}.appendSubagentSystemPrompt =
                    (${vars.optsVar}.appendSubagentSystemPrompt ? ${vars.optsVar}.appendSubagentSystemPrompt : "") + _forceLocalPrompt;
            } catch (_pErr) {
                this.output.warn("forceLocal: failed to inject system prompt: " + (_pErr.message || _pErr));
            }
            // Review mode logic is handled inside the MCP tool handlers themselves
            // (remote-tools.js), so all tools are always auto-approved here.
            // --- forceLocal: rewrite file paths before tool execution (PreToolUse updatedInput) ---
            // Agents often pass proxy paths (.../.claude/remote/<host>/<encoded>/<remote-path>/file)
            // which toRemotePath must map to a single remote absolute path, not double-prefix.
            var _forceLocalRewritePaths = function(F) {
                try {
                    var ti = F && F.tool_input;
                    if (!ti || typeof ti !== "object") return { continue: true };
                    var _rt = require("./src/remote-tools");
                    var updated = Object.assign({}, ti);
                    var changed = false;
                    if (typeof updated.file_path === "string") {
                        var fp = _rt.toRemotePath(updated.file_path);
                        if (fp !== updated.file_path) { updated.file_path = fp; changed = true; }
                    }
                    if (typeof updated.path === "string") {
                        var pp = _rt.toRemotePath(updated.path);
                        if (pp !== updated.path) { updated.path = pp; changed = true; }
                    }
                    if (typeof updated.cwd === "string") {
                        var cw = _rt.toRemotePath(updated.cwd);
                        if (cw !== updated.cwd) { updated.cwd = cw; changed = true; }
                    }
                    if (!changed) return { continue: true };
                    return {
                        continue: true,
                        hookSpecificOutput: {
                            hookEventName: "PreToolUse",
                            updatedInput: updated
                        }
                    };
                } catch (_) {}
                return { continue: true };
            };
            ${vars.optsVar}.hooks.PreToolUse.push({
                matcher: "Read|Write|Edit|Glob|Grep|Bash|mcp__claude-vscode__read_file|mcp__claude-vscode__write_file|mcp__claude-vscode__edit_file|mcp__claude-vscode__glob|mcp__claude-vscode__grep|mcp__claude-vscode__bash",
                hooks: [_forceLocalRewritePaths]
            });
            // --- forceLocal: block Agent subagent for file-read tasks; prefetch remote content ---
            // Logs show tool=Agent subagents lack working Read/MCP (Bash/PowerShell hit local disk).
            // Deny the spawn and inject prefetched file text so the parent can answer immediately.
            var _forceLocalBlockAgentRead = async function(F) {
                try {
                    var ti = F && F.tool_input;
                    var prompt = "";
                    if (ti) {
                        prompt = (ti.prompt || ti.description || ti.task || ti.instructions || "");
                        if (typeof prompt !== "string") prompt = JSON.stringify(prompt);
                    }
                    var isReadTask = /\\b(read|读取|查看|explain|解释|inspect|分析)\\b/i.test(prompt) &&
                        (/\\b(file|文件|script|脚本)\\b/i.test(prompt) || /\\.(sh|py|js|ts|tsx|jsx|md|json|yaml|yml|toml|xml|txt|cfg|ini)\\b/i.test(prompt) ||
                         /\\b(full contents|verbatim|逐行|完整内容|contents of)\\b/i.test(prompt));
                    if (!isReadTask) return { continue: true };
                    var _rt = require("./src/remote-tools");
                    var _rrc = "";
                    try { _rrc = _rt.getRemoteCwd(); } catch (_) {}
                    var filePath = null;
                    var absM = prompt.match(/(\\/[A-Za-z0-9_.\\-]+\\.[A-Za-z0-9]{1,10})/);
                    if (absM) filePath = absM[1].replace(/\\\\/g, "/");
                    else {
                        var baseM = prompt.match(/\\b([\\w\\-.]+\\.[A-Za-z0-9]{1,10})\\b/);
                        if (baseM) filePath = baseM[1];
                    }
                    var prefetch = "";
                    if (filePath) {
                        try {
                            var vsc = require("vscode");
                            var uri = _rt.getRemoteUri(filePath);
                            var data = await vsc.workspace.fs.readFile(uri);
                            var text = Buffer.from(data).toString("utf8");
                            var max = 50000;
                            if (text.length > max) text = text.slice(0, max) + "\\n\\n...[truncated at " + max + " chars]";
                            prefetch = "\\n\\n<file-contents path=\\"" + _rt.toRemotePath(filePath) + "\\">\\n" + text + "\\n</file-contents>";
                        } catch (readErr) {
                            prefetch = "\\n\\n(file prefetch failed for " + filePath + ": " + (readErr.message || readErr) + ")";
                        }
                    }
                    return {
                        continue: true,
                        hookSpecificOutput: {
                            hookEventName: "PreToolUse",
                            permissionDecision: "deny",
                            permissionDecisionReason:
                                "Agent subagents cannot read remote files in force-local mode. Use the Read tool directly" +
                                (_rrc ? " (paths under " + _rrc + " or a basename like file.sh)" : "") +
                                ", not Bash/PowerShell/WebFetch.",
                            additionalContext: "Blocked Agent spawn for remote file read." + prefetch
                        }
                    };
                } catch (_) {}
                return { continue: true };
            };
            ${vars.optsVar}.hooks.PreToolUse.push({
                matcher: "Agent|Task",
                hooks: [_forceLocalBlockAgentRead]
            });
            if (!${vars.optsVar}.hooks.SubagentStart) ${vars.optsVar}.hooks.SubagentStart = [];
            ${vars.optsVar}.hooks.SubagentStart.push({
                hooks: [(F) => {
                    var _rrc2 = "";
                    try { _rrc2 = require("./src/remote-tools").getRemoteCwd(); } catch (_) {}
                    return {
                        continue: true,
                        hookSpecificOutput: {
                            hookEventName: "SubagentStart",
                            additionalContext:
                                "Force-local mode: files are on remote SSH workspace" +
                                (_rrc2 ? " root " + _rrc2 : "") +
                                ". Use Read with that posix path (not .claude/remote proxy paths, not PowerShell/Bash). Read-only subagents have no Bash."
                        }
                    };
                }]
            });
            // --- forceLocal: add MCP-aware hooks for diagnostics tracking ---
            var _adaptMcpEvent = function(F) {
                var _a = Object.assign({}, F);
                if (_a.tool_name && _a.tool_name.startsWith("mcp__claude-vscode__")) {
                    var _n = _a.tool_name.replace("mcp__claude-vscode__", "");
                    if (_n === "edit_file") _a.tool_name = "Edit";
                    else if (_n === "write_file") _a.tool_name = "Write";
                    else if (_n === "read_file") _a.tool_name = "Read";
                }
                if (_a.tool_input && _a.tool_input.file_path) {
                    try {
                        var _rt = require("./src/remote-tools");
                        var _remUri = _rt.getRemoteUri(_a.tool_input.file_path);
                        _a.tool_input = Object.assign({}, _a.tool_input, { file_path: _remUri.toString(true) });
                    } catch(_e) {}
                }
                return _a;
            };
            ${vars.optsVar}.hooks.PreToolUse.push({
                matcher: "mcp__claude-vscode__edit_file|mcp__claude-vscode__write_file",
                hooks: [(F) => ${vars.diagVar}.captureBaseline(_adaptMcpEvent(F))]
            });
            // --- forceLocal: replace the official saveFileIfNeeded hook ---
            // The official hook (this.saveFileIfNeeded) runs the file_path through
            // Pj() which on Windows is Uri.file(...) — that doesn't parse
            // vscode-remote:// URIs and silently fails. Result: if the user has
            // unsaved changes to a remote file open in VS Code, the agent's edit
            // would overwrite them. Implement our own that uses getRemoteUri() so
            // openTextDocument() lands on the correct remote document and we can
            // save its dirty buffer before the MCP tool writes.
            var _forceLocalSaveDirty = async function(F) {
                try {
                    var _vp = F && F.tool_input && F.tool_input.file_path;
                    if (!_vp || typeof _vp !== "string") return { continue: true };
                    var _vsc2 = require("vscode");
                    var _rt3 = require("./src/remote-tools");
                    var _ruri = _rt3.getRemoteUri(_vp);
                    var _doc = await _vsc2.workspace.openTextDocument(_ruri);
                    if (_doc.isDirty) await _doc.save();
                } catch (_) { /* silent — best-effort autosave */ }
                return { continue: true };
            };
            ${vars.optsVar}.hooks.PreToolUse.push({
                matcher: "Read|Write|Edit|mcp__claude-vscode__edit_file|mcp__claude-vscode__write_file|mcp__claude-vscode__read_file",
                hooks: [_forceLocalSaveDirty]
            });
            ${vars.optsVar}.hooks.PostToolUse.push({
                matcher: "mcp__claude-vscode__edit_file|mcp__claude-vscode__write_file",
                hooks: [(F) => ${vars.diagVar}.findDiagnosticsProblems(_adaptMcpEvent(F))]
            });
            // --- forceLocal: block WebFetch on file:// URLs ---
            // The agent (especially Task subagents, whose system prompt the model
            // may ignore) likes to "read" a workspace file by calling WebFetch with
            // a file:// URL. In force-local mode that URL resolves to the empty
            // LOCAL proxy (or is rejected as "Invalid URL"), never the remote file.
            // Deny those calls and redirect to the MCP tools. Real http(s) fetches
            // are left untouched — the LOCAL side has internet, so they still work.
            ${vars.optsVar}.hooks.PreToolUse.push({
                matcher: "WebFetch",
                hooks: [(F) => {
                    try {
                        var _u = F && F.tool_input && (F.tool_input.url || F.tool_input.uri || "");
                        if (typeof _u === "string" && /^\\s*file:/i.test(_u)) {
                            var _rrc = "";
                            try { _rrc = require("./src/remote-tools").getRemoteCwd(); } catch (_) {}
                            return {
                                continue: true,
                                hookSpecificOutput: {
                                    hookEventName: "PreToolUse",
                                    permissionDecision: "deny",
                                    permissionDecisionReason:
                                        "WebFetch cannot read workspace files in Claude Code Local force-local mode: a file:// URL points at the empty local proxy, not the remote server. " +
                                        "Use the Read tool with file_path set to the remote absolute path" +
                                        (_rrc ? " (e.g. " + _rrc + "/path/to/file)" : "") + ". " +
                                        "WebFetch is disabled in force-local mode."
                                }
                            };
                        }
                    } catch (_) {}
                    return { continue: true };
                }]
            });
            this.output.info("forceLocal: CLI will run locally, file tools aliased to remote MCP, WebFetch disabled");
            this.output.info(\`forceLocal: cwd=\${${vars.optsVar}.cwd}, disallowedTools=\${${vars.optsVar}.disallowedTools.join(",")}, allowedTools=\${${vars.optsVar}.allowedTools.join(",")}, permissionMode=\${V}, canUseTool=\${!!j}\`);
        } else {
            this.output.info(\`forceLocal: NOT active. forceLocal=\${require("vscode").workspace.getConfiguration("claudeCode").get("forceLocal")}, remoteName=\${require("vscode").env.remoteName}, remoteAuthority=\${require("vscode").env.remoteAuthority}, folderScheme=\${(require("vscode").workspace.workspaceFolders||[])[0]?.uri?.scheme}\`);
        }`
    },
    {
        id: 'patch-03b',
        name: 'delete CLAUDECODE env var',

        appliedCheck: /delete \w+\.env\.CLAUDECODE/,

        anchor: {
            pattern: /pathToClaudeCodeExecutable:\s*\w+/,
            context: /usePythonEnvironment/,
            hint: 'Destructuring of getClaudeBinary() in spawnClaude, near usePythonEnvironment'
        },

        insertAt: {
            // Patch-03 grew substantially; env assignment is ~180 lines below the anchor.
            searchRange: 400,
            pattern: /\w+\.pathToClaudeCodeExecutable\s*=\s*\w+.*\w+\.executableArgs\s*=\s*\w+.*\w+\.env\s*=\s*\w+/,
            fallbackPattern: /\.env\s*=\s*\w+/,
            relation: 'after'
        },

        detectVars: (ctx, fullCode) => {
            // Detect the options variable (q in v2.1.150, H in v2.1.71). In v2.1.150
            // the assignment `q.pathToClaudeCodeExecutable = U, q.executableArgs = M,
            // q.env = A` sits ~140 lines after the destructuring anchor and is OUTSIDE
            // the default context window, so we must scan the full file. Picking the
            // wrong var (e.g. `H`, which is spawnClaude's 9th arg with default `{}`)
            // makes `delete H.env.CLAUDECODE` throw at every spawn attempt.
            let optsVar = 'q';
            const code = fullCode || ctx;
            // First try the comma-chained assignment form (v2.1.150):
            //   if (q.pathToClaudeCodeExecutable = U, q.executableArgs = M, q.env = A, F) ...
            let m = code.match(/(\w+)\.pathToClaudeCodeExecutable\s*=\s*\w+\s*,\s*\1\.executableArgs\s*=/);
            if (!m) {
                // Fallback: standalone assignment form (older versions)
                m = code.match(/(\w+)\.pathToClaudeCodeExecutable\s*=\s*\w+/);
            }
            if (m) optsVar = m[1];
            return { optsVar };
        },

        generate: (vars) => `        // Prevent "nested session" detection when another Claude Code instance is running
        delete ${vars.optsVar}.env.CLAUDECODE;`
    }
];
