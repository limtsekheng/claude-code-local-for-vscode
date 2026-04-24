'use strict';

const fs = require('fs');
const path = require('path');

function copyRecursive(src, dest) {
    if (!fs.existsSync(src)) return;
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        for (const entry of fs.readdirSync(src)) {
            copyRecursive(path.join(src, entry), path.join(dest, entry));
        }
    } else {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
    }
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json"/>
  <Default Extension=".js" ContentType="application/javascript"/>
  <Default Extension=".css" ContentType="text/css"/>
  <Default Extension=".svg" ContentType="image/svg+xml"/>
  <Default Extension=".png" ContentType="image/png"/>
  <Default Extension=".md" ContentType="text/markdown"/>
  <Default Extension=".vsixmanifest" ContentType="text/xml"/>
  <Default Extension=".exe" ContentType="application/octet-stream"/>
</Types>`;

// --- CHANGED: cross-platform zip using adm-zip instead of shell `zip` command ---
function buildZip(stagingDir, outputPath) {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();

    function addDir(dirPath, zipBase) {
        for (const entry of fs.readdirSync(dirPath)) {
            const fullPath = path.join(dirPath, entry);
            const zipPath = zipBase ? `${zipBase}/${entry}` : entry;
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                addDir(fullPath, zipPath);
            } else {
                const content = fs.readFileSync(fullPath);
                zip.addFile(zipPath, content);
            }
        }
    }

    addDir(stagingDir, '');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    zip.writeZip(outputPath);
    const size = fs.statSync(outputPath).size;
    console.log(`  VSIX: ${outputPath} (${(size / 1024 / 1024).toFixed(1)} MB)`);
    return outputPath;
}

function buildVsix(opts) {
    // --- CHANGED: accept win32Dir ---
    const { darwinDir, linuxDir, win32Dir, repoDir, outputPath } = opts;

    const stagingDir = path.join(require('os').tmpdir(), 'vsix-build-' + Date.now());
    const extDir = path.join(stagingDir, 'extension');
    fs.mkdirSync(extDir, { recursive: true });

    console.log('Building VSIX...');
    console.log(`  Staging: ${stagingDir}`);

    // [Content_Types].xml
    fs.writeFileSync(path.join(stagingDir, '[Content_Types].xml'), CONTENT_TYPES_XML);

    // Copy extension.vsixmanifest from source VSIX
    const srcManifest = path.join(darwinDir, 'extension.vsixmanifest');
    if (fs.existsSync(srcManifest)) {
        let manifest = fs.readFileSync(srcManifest, 'utf8');
        manifest = manifest.replace(/Id="claude-code"/g, 'Id="claude-code-local"');
        manifest = manifest.replace(/DisplayName="Claude Code"/g, 'DisplayName="Claude Code Local for VS Code"');
        manifest = manifest.replace(/Publisher="Anthropic"/g, 'Publisher="justimyhxu"');
        fs.writeFileSync(path.join(stagingDir, 'extension.vsixmanifest'), manifest);
    }

    // Copy patched extension.js and package.json from repo
    fs.copyFileSync(path.join(repoDir, 'extension.js'), path.join(extDir, 'extension.js'));
    fs.copyFileSync(path.join(repoDir, 'package.json'), path.join(extDir, 'package.json'));

    // Copy src/remote-tools.js
    const srcDir = path.join(extDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.copyFileSync(path.join(repoDir, 'src', 'remote-tools.js'), path.join(srcDir, 'remote-tools.js'));

    // Copy webview from source VSIX
    const srcWebview = path.join(darwinDir, 'extension', 'webview');
    if (fs.existsSync(srcWebview)) {
        copyRecursive(srcWebview, path.join(extDir, 'webview'));
    }

    // Copy resources (icons, walkthrough, schema) from source VSIX
    const srcResources = path.join(darwinDir, 'extension', 'resources');
    if (fs.existsSync(srcResources)) {
        copyRecursive(srcResources, path.join(extDir, 'resources'));
    }

    // Override webview with repo's patched versions (emerald theme, etc.)
    const repoWebview = path.join(repoDir, 'webview');
    if (fs.existsSync(repoWebview)) {
        const destWebview = path.join(extDir, 'webview');
        for (const file of fs.readdirSync(repoWebview)) {
            const src = path.join(repoWebview, file);
            const dest = path.join(destWebview, file);
            if (fs.statSync(src).isFile()) {
                fs.copyFileSync(src, dest);
            }
        }
        console.log('  Webview overrides applied from repo');
    }

    // Override with custom branding from repo assets/
    const assetsDir = path.join(repoDir, 'assets');
    if (fs.existsSync(assetsDir)) {
        const destResources = path.join(extDir, 'resources');
        for (const file of fs.readdirSync(assetsDir)) {
            const src = path.join(assetsDir, file);
            const dest = path.join(destResources, file);
            if (fs.statSync(src).isFile()) {
                fs.copyFileSync(src, dest);
            }
        }
        console.log('  Custom branding applied from assets/');
    }

    // Copy settings schema
    const schemaFile = path.join(darwinDir, 'extension', 'claude-code-settings.schema.json');
    if (fs.existsSync(schemaFile)) {
        fs.copyFileSync(schemaFile, path.join(extDir, 'claude-code-settings.schema.json'));
    }

    // Extract and place CLI binaries
    const binDir = path.join(extDir, 'resources', 'native-binaries');

    // Darwin ARM64 binary
    const darwinBinSrc = path.join(darwinDir, 'extension', 'resources', 'native-binary', 'claude');
    const darwinBinAlt = path.join(darwinDir, 'extension', 'resources', 'native-binaries', 'darwin-arm64', 'claude');
    const darwinBinDest = path.join(binDir, 'darwin-arm64', 'claude');
    fs.mkdirSync(path.dirname(darwinBinDest), { recursive: true });
    if (fs.existsSync(darwinBinAlt)) {
        fs.copyFileSync(darwinBinAlt, darwinBinDest);
    } else if (fs.existsSync(darwinBinSrc)) {
        fs.copyFileSync(darwinBinSrc, darwinBinDest);
    }

    // Linux x64 binary
    const linuxBinSrc = path.join(linuxDir, 'extension', 'resources', 'native-binary', 'claude');
    const linuxBinAlt = path.join(linuxDir, 'extension', 'resources', 'native-binaries', 'linux-x64', 'claude');
    const linuxBinDest = path.join(binDir, 'linux-x64', 'claude');
    fs.mkdirSync(path.dirname(linuxBinDest), { recursive: true });
    if (fs.existsSync(linuxBinAlt)) {
        fs.copyFileSync(linuxBinAlt, linuxBinDest);
    } else if (fs.existsSync(linuxBinSrc)) {
        fs.copyFileSync(linuxBinSrc, linuxBinDest);
    }

    // --- NEW: Windows x64 binary ---
    if (win32Dir) {
        const win32BinSrc  = path.join(win32Dir, 'extension', 'resources', 'native-binary',  'claude.exe');
        const win32BinAlt  = path.join(win32Dir, 'extension', 'resources', 'native-binaries', 'win32-x64', 'claude.exe');
        const win32BinDest = path.join(binDir, 'win32-x64', 'claude.exe');
        fs.mkdirSync(path.dirname(win32BinDest), { recursive: true });
        if (fs.existsSync(win32BinAlt)) {
            fs.copyFileSync(win32BinAlt, win32BinDest);
            console.log('  win32-x64 binary: copied from native-binaries/');
        } else if (fs.existsSync(win32BinSrc)) {
            fs.copyFileSync(win32BinSrc, win32BinDest);
            console.log('  win32-x64 binary: copied from native-binary/');
        } else {
            console.warn('  WARNING: win32-x64 claude.exe not found in VSIX — Local Mode will not work on Windows');
        }
    }

    // Fallback binary (darwin-arm64 -> native-binary/claude, for legacy path)
    const fallbackDest = path.join(extDir, 'resources', 'native-binary', 'claude');
    fs.mkdirSync(path.dirname(fallbackDest), { recursive: true });
    if (fs.existsSync(darwinBinDest)) {
        fs.copyFileSync(darwinBinDest, fallbackDest);
    }

    // Set execute permissions on Unix binaries (no-op on Windows, fine)
    for (const binPath of [darwinBinDest, linuxBinDest, fallbackDest]) {
        if (fs.existsSync(binPath)) {
            try { fs.chmodSync(binPath, 0o755); } catch (e) {
                console.warn(`  Warning: could not chmod ${path.basename(binPath)}: ${e.message}`);
            }
        }
    }

    // --- CHANGED: use adm-zip (cross-platform) instead of shell `zip` ---
    try {
        console.log('  Creating VSIX archive...');
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        buildZip(stagingDir, outputPath);
        return outputPath;
    } finally {
        try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch (e) {}
    }
}

module.exports = { buildVsix };
