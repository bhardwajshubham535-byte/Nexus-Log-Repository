const { Client } = require('ssh2');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── Windows Event Log Tail ────────────────────────────────────────────────────
// Streams real Windows Event Log entries using PowerShell.

async function startWindowsEventTail(logConfig, onData, onError) {
    return new Promise((resolve, reject) => {
        const logName   = logConfig.windowsLogName || 'System';
        const maxEvents = logConfig.maxEvents || 75;

        let active    = true;
        let pollTimer = null;
        let lastTime  = new Date(); // will be set after initial load

        // Run a PowerShell script and collect stdout
        function runPS(script, onOutput, onDone) {
            const ps = spawn('powershell.exe', [
                '-NoProfile', '-NonInteractive', '-Command', script
            ]);
            let buf = '';

            ps.stdout.on('data', d => { buf += d.toString('utf-8'); });
            ps.stderr.on('data', () => {}); // suppress PS errors (e.g. empty result)
            ps.on('close', () => {
                if (buf.trim()) onOutput(buf);
                if (onDone) onDone();
            });
            ps.on('error', err => onError('PowerShell error: ' + err.message));
        }

        // Build a PowerShell snippet that formats events into readable log lines
        function buildScript(filter) {
            return `
try {
    $events = Get-WinEvent ${filter} -ErrorAction SilentlyContinue
    if ($events) {
        $events | Sort-Object TimeCreated | ForEach-Object {
            $lvl = switch ($_.LevelDisplayName) {
                'Critical'    { 'CRIT   ' }
                'Error'       { 'ERROR  ' }
                'Warning'     { 'WARN   ' }
                'Information' { 'INFO   ' }
                default       { 'INFO   ' }
            }
            $ts  = $_.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss')
            $src = $_.ProviderName
            $msg = (($_.Message -split '[\\r\\n]')[0]).Trim()
            "[$ts] [$lvl] [ID:$($_.Id)] [$src] $msg"
        }
    }
} catch {}
            `.trim();
        }

        // ── Step 1: Dump the last N events on first connect ──
        const initScript = buildScript(`-LogName '${logName}' -MaxEvents ${maxEvents}`);

        runPS(initScript, output => { onData(output); }, () => {
            if (!active) return;

            lastTime = new Date(); // poll for events newer than now

            // ── Step 2: Poll every 5 s for new events ──
            pollTimer = setInterval(() => {
                if (!active) return;

                const since      = lastTime.toISOString();
                const pollStart  = new Date();
                const pollScript = buildScript(
                    `-FilterHashtable @{LogName='${logName}'; StartTime='${since}'}`
                );

                lastTime = pollStart; // move window forward before PS runs

                runPS(pollScript, output => { onData(output); }, null);
            }, 5000);

            resolve({
                end: () => {
                    active = false;
                    if (pollTimer) clearInterval(pollTimer);
                }
            });
        });
    });
}

// ─── Local File Tail ──────────────────────────────────────────────────────────
// Tails a file on this machine directly — no SSH needed.

async function startLocalTail(logPath, onData, onError) {
    return new Promise((resolve, reject) => {
        const absPath = path.resolve(__dirname, logPath);

        try {
            let startByte = 0;
            if (fs.existsSync(absPath)) {
                const stat = fs.statSync(absPath);
                startByte = Math.max(0, stat.size - 8192);
            } else {
                fs.mkdirSync(path.dirname(absPath), { recursive: true });
                fs.writeFileSync(absPath, '', 'utf-8');
            }

            const initStream = fs.createReadStream(absPath, { start: startByte });
            initStream.on('data', chunk => onData(chunk.toString('utf-8')));
            initStream.on('error', err => onError(err.message));

            let currentSize = fs.existsSync(absPath) ? fs.statSync(absPath).size : 0;

            const watcher = fs.watch(absPath, eventType => {
                if (eventType === 'change') {
                    try {
                        const stat = fs.statSync(absPath);
                        if (stat.size > currentSize) {
                            const s = fs.createReadStream(absPath, { start: currentSize });
                            s.on('data', chunk => onData(chunk.toString('utf-8')));
                            s.on('error', err => onError(err.message));
                            currentSize = stat.size;
                        }
                    } catch (e) { onError(e.message); }
                }
            });

            resolve({ end: () => { try { watcher.close(); } catch (_) {} } });
        } catch (err) {
            reject(err);
        }
    });
}

// ─── Remote SSH Tail ──────────────────────────────────────────────────────────

async function startRemoteTail(serverConfig, logPath, onData, onError) {
    return new Promise((resolve, reject) => {
        const conn = new Client();

        conn.on('ready', () => {
            conn.exec(`tail -n 100 -f ${logPath}`, (err, stream) => {
                if (err) { conn.end(); return reject(err); }

                stream
                    .on('close', () => conn.end())
                    .on('data', d => onData(d.toString('utf-8')))
                    .stderr.on('data', d => onError(d.toString('utf-8')));

                resolve({ end: () => { stream.close(); conn.end(); } });
            });
        }).on('error', err => reject(err));

        const cfg = {
            host: serverConfig.host,
            port: serverConfig.port || 22,
            username: serverConfig.username,
            readyTimeout: 10000
        };

        if (serverConfig.authType === 'privateKey') {
            cfg.privateKey = fs.readFileSync(serverConfig.privateKeyPath);
        } else {
            cfg.password = serverConfig.password;
        }

        conn.connect(cfg);
    });
}

// ─── Router ───────────────────────────────────────────────────────────────────

async function startTail(serverConfig, logPath, onData, onError) {
    if (serverConfig.type === 'windows-event') {
        // logPath is actually the logConfig object here for Windows
        return startWindowsEventTail(logPath, onData, onError);
    }
    if (serverConfig.type === 'local') {
        return startLocalTail(logPath, onData, onError);
    }
    return startRemoteTail(serverConfig, logPath, onData, onError);
}

module.exports = { startTail };
