// Standalone trace to verify toRemotePath against the user's reported scenario.
// Mirrors the function in src/remote-tools.js — keep in sync.
const path = require('path');

const localPrefix = 'C:\\Users\\LinZexin\\.claude\\remote\\bev-e2e-zx\\a2000-APS-jenkins-bev-huiguan';
const remoteCwd = '/a2000-APS-jenkins-bev-huiguan';

function toRemotePath(filePath) {
    if (!filePath || filePath === "." || filePath === "./" || filePath === ".\\") {
        return remoteCwd;
    }
    const normalized = filePath.replace(/\\/g, "/");
    const normalizedPrefix = localPrefix.replace(/\\/g, "/");

    if (normalized === normalizedPrefix || normalized === normalizedPrefix + "/") return remoteCwd;
    if (normalized.startsWith(normalizedPrefix + "/")) {
        const rel = normalized.slice(normalizedPrefix.length + 1);
        return rel ? path.posix.join(remoteCwd, rel) : remoteCwd;
    }

    const safeBasename = path.posix.basename(normalizedPrefix);
    if (safeBasename) {
        const rooted = "/" + safeBasename;
        if (normalized === rooted || normalized === rooted + "/") return remoteCwd;
        if (normalized.startsWith(rooted + "/")) {
            const rel = normalized.slice(rooted.length + 1);
            return rel ? path.posix.join(remoteCwd, rel) : remoteCwd;
        }
    }

    if (/^[a-zA-Z]:\//.test(normalized)) {
        return path.posix.join(remoteCwd, path.posix.basename(normalized));
    }
    if (normalized.startsWith("/")) return normalized;
    return path.posix.join(remoteCwd, normalized);
}

const expectations = [
    ['\\a2000-APS-jenkins-bev-huiguan', '/a2000-APS-jenkins-bev-huiguan'],
    ['\\a2000-APS-jenkins-bev-huiguan\\src\\foo.py', '/a2000-APS-jenkins-bev-huiguan/src/foo.py'],
    ['/a2000-APS-jenkins-bev-huiguan', '/a2000-APS-jenkins-bev-huiguan'],
    ['/a2000-APS-jenkins-bev-huiguan/src/foo.py', '/a2000-APS-jenkins-bev-huiguan/src/foo.py'],
    ['C:\\Users\\LinZexin\\.claude\\remote\\bev-e2e-zx\\a2000-APS-jenkins-bev-huiguan\\README.md', '/a2000-APS-jenkins-bev-huiguan/README.md'],
    ['C:\\Users\\LinZexin\\.claude\\remote\\bev-e2e-zx\\a2000-APS-jenkins-bev-huiguan', '/a2000-APS-jenkins-bev-huiguan'],
    ['README.md', '/a2000-APS-jenkins-bev-huiguan/README.md'],
    ['.', '/a2000-APS-jenkins-bev-huiguan'],
    ['/etc/hosts', '/etc/hosts'],
    ['src/foo.py', '/a2000-APS-jenkins-bev-huiguan/src/foo.py'],
];
let failed = 0;
for (const [input, expected] of expectations) {
    const actual = toRemotePath(input);
    const ok = actual === expected;
    if (!ok) failed++;
    console.log((ok ? 'OK  ' : 'FAIL') + '  ' + JSON.stringify(input) + ' → ' + actual + (ok ? '' : '  (expected ' + expected + ')'));
}
console.log('\n' + (failed === 0 ? 'all pass' : failed + ' failed'));
process.exit(failed ? 1 : 0);
