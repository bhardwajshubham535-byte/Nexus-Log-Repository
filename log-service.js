const { Client } = require('ssh2');

async function startTail(serverConfig, logPath, onData, onError) {
    return new Promise((resolve, reject) => {
        const conn = new Client();

        conn.on('ready', () => {
            conn.exec(`tail -n 100 -f ${logPath}`, (err, stream) => {
                if (err) {
                    conn.end();
                    return reject(err);
                }

                stream.on('close', (code, signal) => {
                    conn.end();
                }).on('data', (data) => {
                    onData(data.toString('utf-8'));
                }).stderr.on('data', (data) => {
                    onError(data.toString('utf-8'));
                });

                // Return an object that has an end() method to stop the stream
                resolve({
                    end: () => {
                        stream.close();
                        conn.end();
                    }
                });
            });
        }).on('error', (err) => {
            reject(err);
        });

        const sshConnectConfig = {
            host: serverConfig.host,
            port: serverConfig.port || 22,
            username: serverConfig.username,
        };

        if (serverConfig.authType === 'privateKey') {
            sshConnectConfig.privateKey = require('fs').readFileSync(serverConfig.privateKeyPath);
        } else {
            sshConnectConfig.password = serverConfig.password;
        }

        conn.connect(sshConnectConfig);
    });
}

module.exports = {
    startTail
};
