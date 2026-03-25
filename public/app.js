document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const loginView = document.getElementById('login-view');
    const dashboardView = document.getElementById('dashboard-view');
    const loginForm = document.getElementById('login-form');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const loginError = document.getElementById('login-error');
    const serverList = document.getElementById('server-list');
    const logoutBtn = document.getElementById('logout-btn');
    const logOutput = document.getElementById('log-output');
    const currentServerBadge = document.getElementById('current-server-badge');
    const currentLogTitle = document.getElementById('current-log-title');
    const logFilter = document.getElementById('log-filter');
    const scrollBottomBtn = document.getElementById('scroll-bottom-btn');
    const toggleDashboardBtn = document.getElementById('toggle-dashboard');
    const alertsDashboard = document.getElementById('alerts-dashboard');
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.getElementById('status-text');
    const stat5m = document.getElementById('stat-5m');
    const stat15m = document.getElementById('stat-15m');
    const stat30m = document.getElementById('stat-30m');
    const statAlerts = document.getElementById('stat-alerts');

    let socket = null;
    let socketConnected = false;
    let autoScroll = true;
    let currentFilter = '';
    
    // Log tracking
    let recentLogs = []; // Array of timestamps
    let recentAlerts = []; // Array of timestamps for errors
    let indicatorTimer = null;
    let lastLogDateCategory = null; // 'Today', 'Yesterday', or 'Historical'

    // Check token on load
    const token = localStorage.getItem('nexus_token');
    if (token) {
        showDashboard(token);
    }

    // Login logic
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = usernameInput.value;
        const password = passwordInput.value;

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();

            if (res.ok && data.token) {
                localStorage.setItem('nexus_token', data.token);
                showDashboard(data.token);
            } else {
                loginError.textContent = data.error || 'Login failed';
            }
        } catch (err) {
            loginError.textContent = 'Network error occurred';
        }
    });

    // Logout logic
    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('nexus_token');
        if (socket) {
            socket.close();
            socket = null;
        }
        logOutput.innerHTML = '';
        loginView.classList.remove('hidden');
        dashboardView.classList.add('hidden');
    });

    // Dashboard toggle
    toggleDashboardBtn.addEventListener('click', () => {
        alertsDashboard.classList.toggle('hidden');
        toggleDashboardBtn.classList.toggle('active');
    });

    // Dashboard Update Loop
    setInterval(updateDashboardStats, 3000);

    function updateDashboardStats() {
        const now = Date.now();
        const fiveMin = now - (5 * 60 * 1000);
        const fifteenMin = now - (15 * 60 * 1000);
        const thirtyMin = now - (30 * 60 * 1000);

        // Filter and count
        const count5m = recentLogs.filter(t => t > fiveMin).length;
        const count15m = recentLogs.filter(t => t > fifteenMin).length;
        const count30m = recentLogs.filter(t => t > thirtyMin).length;
        const alertsCount = recentAlerts.filter(t => t > thirtyMin).length;

        // Clean up old timestamps (keep only last 30m)
        recentLogs = recentLogs.filter(t => t > thirtyMin);
        recentAlerts = recentAlerts.filter(t => t > thirtyMin);

        // Update UI
        if (stat5m) stat5m.textContent = count5m;
        if (stat15m) stat15m.textContent = count15m;
        if (stat30m) stat30m.textContent = count30m;
        if (statAlerts) statAlerts.textContent = alertsCount;
    }

    async function showDashboard(token) {
        loginView.classList.add('hidden');
        dashboardView.classList.remove('hidden');
        loginError.textContent = '';

        // Fetch server list
        try {
            const res = await fetch('/api/servers', {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!res.ok) {
                throw new Error('Unauthorized');
            }

            const servers = await res.json();
            renderServerList(servers);

            // Connect WebSocket
            initWebSocket(token);
        } catch (err) {
            localStorage.removeItem('nexus_token');
            loginView.classList.remove('hidden');
            dashboardView.classList.add('hidden');
        }
    }

    function renderServerList(servers) {
        serverList.innerHTML = '';
        servers.forEach(server => {
            const group = document.createElement('div');
            group.className = 'server-group';

            const name = document.createElement('div');
            name.className = 'server-name';
            name.textContent = server.name;
            group.appendChild(name);

            server.logFiles.forEach(log => {
                const item = document.createElement('div');
                item.className = 'log-item';
                item.textContent = log.name;
                item.addEventListener('click', () => {
                    document.querySelectorAll('.log-item').forEach(el => el.classList.remove('active'));
                    item.classList.add('active');
                    selectLog(server, log);
                });
                group.appendChild(item);
            });

            serverList.appendChild(group);
        });
    }

    function initWebSocket(token) {
        // Use socket.io client — the server is a socket.io server, not a raw WebSocket server
        socket = io({
            auth: { token }
        });

        socket.on('connect', () => {
            socketConnected = true;
            console.log('Socket.IO connected:', socket.id);
        });

        socket.on('disconnect', (reason) => {
            socketConnected = false;
            console.log('Socket.IO disconnected:', reason);
            if (reason === 'Unauthorized') {
                logoutBtn.click();
            }
        });

        socket.on('connect_error', (err) => {
            socketConnected = false;
            console.error('Socket.IO connection error:', err.message);
            appendLogLine(`[ERROR] Connection failed: ${err.message}`, 'error');
        });

        // Listen for log events emitted by the server
        socket.on('log-data', (data) => {
            appendLogContent(data);
        });

        socket.on('log-info', (data) => {
            appendLogLine(`[SYSTEM] ${data}`, 'info');
        });

        socket.on('log-error', (data) => {
            appendLogLine(`[ERROR] ${data}`, 'error');
        });
    }

    function selectLog(server, log) {
        currentServerBadge.textContent = server.name;
        currentLogTitle.textContent = log.name;
        logOutput.innerHTML = '';
        lastLogDateCategory = null; 

        appendLogLine(`[SYSTEM] Initializing connection to ${server.name}...`, 'info');

        if (socket && socketConnected) {
            socket.emit('start-stream', {
                serverId: server.id,
                logId: log.id
            });
        } else {
            appendLogLine(`[ERROR] Not connected to server. Please refresh and log in again.`, 'error');
        }
    }

    // Scrolling logic
    logOutput.addEventListener('scroll', () => {
        const isAtBottom = logOutput.scrollHeight - logOutput.scrollTop <= logOutput.clientHeight + 50;
        autoScroll = isAtBottom;

        if (!isAtBottom) {
            scrollBottomBtn.classList.remove('hidden');
        } else {
            scrollBottomBtn.classList.add('hidden');
        }
    });

    scrollBottomBtn.addEventListener('click', () => {
        logOutput.scrollTop = logOutput.scrollHeight;
        autoScroll = true;
        scrollBottomBtn.classList.add('hidden');
    });

    // Filtering
    logFilter.addEventListener('input', (e) => {
        currentFilter = e.target.value.toLowerCase();
        applyFilter();
    });

    function applyFilter() {
        const lines = logOutput.querySelectorAll('.log-line');
        lines.forEach(line => {
            if (!currentFilter || line.textContent.toLowerCase().includes(currentFilter)) {
                line.style.display = 'block';
            } else {
                line.style.display = 'none';
            }
        });
        if (autoScroll) {
            logOutput.scrollTop = logOutput.scrollHeight;
        }
    }

    function appendLogContent(content) {
        // Split by newlines handling \r\n and \n
        const lines = content.split(/\r?\n/).filter(line => line.length > 0);
        lines.forEach(line => {
            appendLogLine(line, '');
        });
    }

    function appendLogLine(text, customClass) {
        const div = document.createElement('div');
        div.className = `log-line ${customClass}`;

        // Simple coloring based on content if not system message
        if (!customClass) {
            const lowerText = text.toLowerCase();
            // Highlight Error/Warning/Info patterns
            if (lowerText.includes('crit') || lowerText.includes('err') || lowerText.includes('fail') || lowerText.includes('exception')) {
                div.classList.add('error');
            } else if (lowerText.includes('warn')) {
                div.classList.add('warn');
            } else if (lowerText.includes('info')) {
                div.classList.add('info');
            } else if (lowerText.includes('success') || lowerText.includes('ok')) {
                div.classList.add('success');
            }
            
            // Categorize by date: Today, Yesterday, Old
            const dateMatch = text.match(/\[(\d{4}-\d{2}-\d{2})\s/);
            if (dateMatch) {
                const logDateStr = dateMatch[1];
                const logDate = new Date(logDateStr);
                const today = new Date();
                today.setHours(0,0,0,0);
                const yesterday = new Date(today);
                yesterday.setDate(yesterday.getDate() - 1);
                
                logDate.setHours(0,0,0,0);
                
                let currentCategory = '';
                if (logDate.getTime() === today.getTime()) {
                    currentCategory = 'Today';
                    div.classList.add('log-today');
                } else if (logDate.getTime() === yesterday.getTime()) {
                    currentCategory = 'Yesterday';
                    div.classList.add('log-yesterday');
                } else {
                    currentCategory = logDateStr; // Use actual date for old logs
                    div.classList.add('log-old');
                }

                // Append a date divider if the category changed
                if (lastLogDateCategory !== currentCategory) {
                    appendDateDivider(currentCategory);
                    lastLogDateCategory = currentCategory;
                }
            }
            
            // Highlight Timestamps [2024-...]
            if (text.startsWith('[')) {
                text = text.replace(/^(\[.*?\])/, '<span class="log-ts">$1</span>');
                div.innerHTML = text; // applies HTML
            } else {
                div.textContent = text; // plain text
            }
        } else {
            div.textContent = text; // custom class lines
        }

        // Apply filter immediately if active
        if (currentFilter && !text.toLowerCase().includes(currentFilter)) {
            div.style.display = 'none';
        }

        logOutput.appendChild(div);

        // Track stats
        const now = Date.now();
        recentLogs.push(now);
        if (customClass === 'error' || div.classList.contains('error')) {
            recentAlerts.push(now);
        }

        // Pulse status indicator
        if (statusDot) {
            statusDot.classList.add('active');
            if (statusText) statusText.textContent = 'Streaming Activity';
            
            if (indicatorTimer) clearTimeout(indicatorTimer);
            indicatorTimer = setTimeout(() => {
                statusDot.classList.remove('active');
                if (statusText) statusText.textContent = 'System Ready';
            }, 1000);
        }

        // Keep DOM clean - truncate after 5000 lines
        if (logOutput.children.length > 5000) {
            logOutput.removeChild(logOutput.firstChild);
        }

        if (autoScroll && div.style.display !== 'none') {
            logOutput.scrollTop = logOutput.scrollHeight;
        }
    }

    function appendDateDivider(label) {
        const div = document.createElement('div');
        div.className = 'date-divider';
        div.innerHTML = `<span>${label}</span>`;
        logOutput.appendChild(div);
    }
});
