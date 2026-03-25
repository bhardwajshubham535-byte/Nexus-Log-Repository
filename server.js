const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const fs         = require('fs');
const config     = require('./config.json');
const auth       = require('./auth');
const logService = require('./log-service');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// Ensure logs directory exists (for any local file sources)
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth Route ───────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const token = auth.authenticate(username, password, config);
    if (token) {
        res.json({ token });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

// ─── Server List ──────────────────────────────────────────────────────────────
app.get('/api/servers', auth.verifyTokenRest(config.jwtSecret), (req, res) => {
    const safeServers = config.servers.map(s => ({
        id:       s.id,
        name:     s.name,
        logFiles: s.logFiles
    }));
    res.json(safeServers);
});

// ─── WebSocket / Socket.IO ────────────────────────────────────────────────────
io.use(auth.verifyTokenSocket(config.jwtSecret));

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.user.username}`);
    let activeStream = null;

    socket.on('start-stream', async (data) => {
        const { serverId, logId } = data;

        const serverConfig = config.servers.find(s => s.id === serverId);
        if (!serverConfig) { socket.emit('log-error', 'Server not found'); return; }

        const logConfig = serverConfig.logFiles.find(l => l.id === logId);
        if (!logConfig) { socket.emit('log-error', 'Log file not found'); return; }

        // Stop any existing stream before starting a new one
        if (activeStream) { activeStream.end(); activeStream = null; }

        try {
            // For Windows Event logs, pass the full logConfig so we get windowsLogName/maxEvents.
            // For local/SSH, pass the path string as before.
            const logTarget = serverConfig.type === 'windows-event'
                ? logConfig
                : logConfig.path;

            activeStream = await logService.startTail(serverConfig, logTarget,
                (chunk) => { socket.emit('log-data', chunk); },
                (err)   => { socket.emit('log-error', err.message || err); }
            );

            socket.emit('log-info', `Connected to ${serverConfig.name} — ${logConfig.name}`);
        } catch (error) {
            socket.emit('log-error', `Failed to connect to ${serverConfig.name}: ${error.message}`);
        }
    });

    socket.on('stop-stream', () => {
        if (activeStream) { activeStream.end(); activeStream = null; }
    });

    socket.on('disconnect', () => {
        if (activeStream) { activeStream.end(); }
    });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Nexus Log Viewer running on http://localhost:${PORT}`);
});
