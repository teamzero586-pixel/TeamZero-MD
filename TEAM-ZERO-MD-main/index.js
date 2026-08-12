const fs = require('fs');
const path = require('path');
const { execSync, spawn, exec } = require('child_process');
const https = require('https');
const http = require('http');
const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);

// ==================== MANUAL CONFIGURATION (EDIT THESE) ====================
const SESSION_ID = '';        // Optional – creates/updates session.txt
const KEY = 'TEAM ZERO USMAN';               // Optional (at least one of SESSION_ID or KEY required)
const BOT_LINK = 'https://proboy.vercel.app/bot/team-zero-trace-intelligence/';          // Optional – creates/updates bot.txt
// ===========================================================================

// ---------- Progress indicator (silent except percentage) ----------
let currentProgress = 0;
const totalSteps = 10; // We'll increment in steps of 10%
function updateProgress(stepPercent) {
    if (stepPercent > currentProgress) {
        currentProgress = stepPercent;
        process.stdout.write(`\rProcessing ${currentProgress}%`);
        if (currentProgress === 100) console.log(); // newline after 100%
    }
}

// ---------- Silent logging to file only ----------
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
let logNumber = 1;
let logFilePath = path.join(logDir, `log${logNumber}.txt`);
while (fs.existsSync(logFilePath)) {
    logNumber++;
    logFilePath = path.join(logDir, `log${logNumber}.txt`);
}
const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });

// Override console methods to write to file only (no console output)
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
console.log = (...args) => { logStream.write(args.join(' ') + '\n'); };
console.error = (...args) => { logStream.write('[ERROR] ' + args.join(' ') + '\n'); };
console.warn = (...args) => { logStream.write('[WARN] ' + args.join(' ') + '\n'); };

// Helper to log to file without console
function fileLog(msg) { console.log(msg); } // now goes to file only

// ---------- Helper functions ----------
function createFile(filePath, content) {
    try {
        fs.writeFileSync(filePath, content);
        fileLog(`✅ Created/Updated: ${filePath}`);
    } catch (error) {
        fileLog(`❌ Error writing ${filePath}: ${error.message}`);
    }
}

function downloadFileWithRedirects(url, outputPath, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
        const download = (currentUrl, redirectCount) => {
            const client = currentUrl.startsWith('https') ? https : http;
            const options = { headers: { 'User-Agent': 'Mozilla/5.0' } };
            const request = client.get(currentUrl, options, async (response) => {
                if (response.statusCode === 301 || response.statusCode === 302) {
                    if (redirectCount >= maxRedirects) {
                        reject(new Error(`Too many redirects`));
                        return;
                    }
                    const location = response.headers.location;
                    if (!location) {
                        reject(new Error('Redirect without Location header'));
                        return;
                    }
                    const redirectUrl = new URL(location, currentUrl).href;
                    download(redirectUrl, redirectCount + 1);
                    return;
                }
                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP ${response.statusCode}`));
                    return;
                }
                const fileStream = fs.createWriteStream(outputPath);
                try {
                    await streamPipeline(response, fileStream);
                    resolve();
                } catch (err) { reject(err); }
            });
            request.on('error', reject);
        };
        download(url, 0);
    });
}

function extractZip(zipPath, targetDir) {
    return new Promise((resolve, reject) => {
        exec(`unzip -o "${zipPath}" -d "${targetDir}"`, (error, stdout, stderr) => {
            if (error) reject(error);
            else resolve();
        });
    });
}

function installDependencies() {
    try {
        execSync('npm install', { stdio: 'pipe' }); // silent
        return true;
    } catch (error) {
        fileLog(`npm install failed: ${error.message}`);
        return false;
    }
}

async function fullSetup() {
    updateProgress(10); // starting
    // Download
    const zipUrl = 'https://github.com/proboy315/ProBoy-MD/archive/refs/heads/main.zip';
    const zipPath = path.join(__dirname, 'ProBoy-MD-main.zip');
    try {
        await downloadFileWithRedirects(zipUrl, zipPath);
    } catch (err) {
        fileLog(`Download failed: ${err.message}`);
        process.exit(1);
    }
    updateProgress(30);

    // Extract to temp
    const tempExtractDir = path.join(__dirname, `temp_extract_${Date.now()}`);
    fs.mkdirSync(tempExtractDir, { recursive: true });
    try {
        await extractZip(zipPath, tempExtractDir);
    } catch (err) {
        fileLog(`Extraction failed: ${err.message}`);
        process.exit(1);
    }
    updateProgress(50);

    // Find inner folder
    const items = fs.readdirSync(tempExtractDir);
    let repoRoot = null;
    for (const item of items) {
        const itemPath = path.join(tempExtractDir, item);
        if (fs.statSync(itemPath).isDirectory()) {
            repoRoot = itemPath;
            break;
        }
    }
    if (!repoRoot) {
        fileLog('Could not find repository folder inside ZIP');
        process.exit(1);
    }

    // Move files to root
    const files = fs.readdirSync(repoRoot);
    for (const file of files) {
        const source = path.join(repoRoot, file);
        const dest = path.join(__dirname, file);
        if (!fs.existsSync(dest)) {
            fs.renameSync(source, dest);
        }
    }
    updateProgress(70);

    // Cleanup
    fs.rmSync(tempExtractDir, { recursive: true, force: true });
    fs.unlinkSync(zipPath);
    updateProgress(80);

    // Install dependencies
    if (!installDependencies()) process.exit(1);
    updateProgress(90);
}

async function start() {
    // Validate at least one of SESSION_ID or KEY
    if ((!SESSION_ID || SESSION_ID.trim() === '') && (!KEY || KEY.trim() === '')) {
        fileLog('Error: Must provide SESSION_ID or KEY');
        process.exit(1);
    }

    // Create config files (no progress for these small steps)
    if (SESSION_ID && SESSION_ID.trim() !== '') {
        createFile(path.join(__dirname, 'session.txt'), SESSION_ID);
    }
    if (KEY && KEY.trim() !== '') {
        createFile(path.join(__dirname, 'key.txt'), KEY);
    }
    if (BOT_LINK && BOT_LINK.trim() !== '') {
        createFile(path.join(__dirname, 'bot.txt'), BOT_LINK);
    }

    const proboyExists = fs.existsSync(path.join(__dirname, 'proboy.js'));
    const nodeModulesExists = fs.existsSync(path.join(__dirname, 'node_modules'));

    if (proboyExists) {
        fileLog('proboy.js found – skipping download');
        if (!nodeModulesExists) {
            if (!installDependencies()) process.exit(1);
        }
        updateProgress(100);
    } else {
        await fullSetup();
        updateProgress(100);
    }

    // Restore original console methods so bot logs appear normally
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;

    // Launch the bot
    const bot = spawn('node', ['proboy.js'], { stdio: 'inherit' });
    bot.on('error', (err) => console.error(`Bot error: ${err.message}`));
    bot.on('exit', (code) => {
        if (code !== 0) console.error(`Bot exited with code ${code}`);
    });
}

// Start the process – only progress bar is visible, no other console output
start().catch(err => {
    fileLog(`Startup error: ${err.message}`);
    process.exit(1);
});