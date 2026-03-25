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

    let socket = null;
    let autoScroll = true;
    let currentFilter = '';

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
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        socket = new WebSocket(`${protocol}//${window.location.host}/ws?token=${token}`);

        socket.onopen = () => {
            console.log("WebSocket connected");
        };

        socket.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.event === 'log-data') {
                    appendLogContent(msg.data);
                } else if (msg.event === 'log-info') {
                    appendLogLine(`[SYSTEM] ${msg.data}`, 'info');
                } else if (msg.event === 'log-error') {
                    appendLogLine(`[ERROR] ${msg.data}`, 'error');
                }
            } catch (err) {
                appendLogContent(event.data);
            }
        };

        socket.onclose = (event) => {
            console.log('WebSocket closed');
            if (event.reason === 'Unauthorized') {
                logoutBtn.click();
            }
        };

        socket.onerror = (err) => {
            console.error('Socket error:', err);
        };
    }

    function selectLog(server, log) {
        currentServerBadge.textContent = server.name;
        currentLogTitle.textContent = log.name;
        logOutput.innerHTML = '';

        appendLogLine(`[SYSTEM] Initializing connection to ${server.name}...`, 'info');

        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                event: 'start-stream',
                serverId: server.id,
                logId: log.id
            }));
        } else {
            appendLogLine(`[ERROR] WebSocket not connected`, 'error');
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
            if (lowerText.includes('error') || lowerText.includes('fail') || lowerText.includes('exception')) {
                div.classList.add('error');
            } else if (lowerText.includes('warn')) {
                div.classList.add('warn');
            } else if (lowerText.includes('success') || lowerText.includes('ok')) {
                div.classList.add('success');
            }
        }

        div.textContent = text;

        // Apply filter immediately if active
        if (currentFilter && !text.toLowerCase().includes(currentFilter)) {
            div.style.display = 'none';
        }

        logOutput.appendChild(div);

        // Keep DOM clean - truncate after 5000 lines
        if (logOutput.children.length > 5000) {
            logOutput.removeChild(logOutput.firstChild);
        }

        if (autoScroll && div.style.display !== 'none') {
            logOutput.scrollTop = logOutput.scrollHeight;
        }
    }
});
