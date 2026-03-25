const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const config = require('./config.json');
const auth = require('./auth');
const logService = require('./log-service');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Authentication Route
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const token = auth.authenticate(username, password, config);
    if (token) {
        res.json({ token });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

// Protected API Routes
app.get('/api/servers', auth.verifyTokenRest(config.jwtSecret), (req, res) => {
    // Return servers without sensitive data
    const safeServers = config.servers.map(s => ({
        id: s.id,
        name: s.name,
        logFiles: s.logFiles
    }));
    res.json(safeServers);
});

// WebSocket Configuration
io.use(auth.verifyTokenSocket(config.jwtSecret));

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.user.username}`);

    let sshStream = null;

    socket.on('start-stream', async (data) => {
        const { serverId, logId } = data;

        const serverConfig = config.servers.find(s => s.id === serverId);
        if (!serverConfig) {
            socket.emit('log-error', 'Server not found');
            return;
        }

        const logConfig = serverConfig.logFiles.find(l => l.id === logId);
        if (!logConfig) {
            socket.emit('log-error', 'Log file not found');
            return;
        }

        // Clean up existing stream if client switches logs
        if (sshStream) {
            sshStream.end();
        }

        try {
            sshStream = await logService.startTail(serverConfig, logConfig.path, (chunk) => {
                socket.emit('log-data', chunk);
            }, (err) => {
                socket.emit('log-error', err.message || err);
            });
            socket.emit('log-info', `Successfully connected to ${serverConfig.name} - ${logConfig.name}`);
        } catch (error) {
            socket.emit('log-error', `Failed to connect to ${serverConfig.name}: ${error.message}`);
        }
    });

    socket.on('stop-stream', () => {
        if (sshStream) {
            sshStream.end();
            sshStream = null;
        }
    });

    socket.on('disconnect', () => {
        if (sshStream) {
            sshStream.end();
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Log viewer server running securely on port ${PORT}`);
});
