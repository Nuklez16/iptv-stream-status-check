require('dotenv').config();
const mysql = require('mysql');
const { exec } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const nodemailer = require('nodemailer');

// MySQL connection configuration
const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
});

const PORT = process.env.PORT || 3000;
const statusChanges = []; // Array to store status change logs

// Function to parse fractional frame rates like "30000/1001"
function parseFrameRate(rateString) {
    if (!rateString || rateString === '0/0') {
        return null;
    }
    const [numerator, denominator] = rateString.split('/').map(Number);
    if (!numerator || !denominator) {
        return null;
    }
    return numerator / denominator;
}

// Fetch expected frame rate using ffprobe
async function getExpectedFrameRate(url) {
    const listenTimeoutInSeconds = 40;
    const ffprobeCommand = `ffprobe -v quiet -print_format json -show_streams -select_streams v:0 -listen_timeout ${listenTimeoutInSeconds} "${url}"`;

    return new Promise((resolve) => {
        exec(ffprobeCommand, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => {
            if (error) {
                resolve(null);
                return;
            }
            try {
                const parsed = JSON.parse(stdout);
                const rate = parsed?.streams?.[0]?.avg_frame_rate;
                resolve(parseFrameRate(rate));
            } catch {
                resolve(null);
            }
        });
    });
}

// Probe frames delivered over ~5 seconds to measure quality
async function probeStreamFrames(url) {
    const ffmpegCommand = `ffmpeg -v error -read_intervals 0%+5 -i "${url}" -map 0:v:0 -an -f null -`;
    return new Promise((resolve) => {
        exec(ffmpegCommand, { maxBuffer: 10 * 1024 * 1024, timeout: 70000 }, (error, stdout, stderr) => {
            const stderrOutput = stderr || '';
            const frameMatches = [...stderrOutput.matchAll(/frame=\s*(\d+)/g)];
            const frameCount = frameMatches.length ? parseInt(frameMatches[frameMatches.length - 1][1], 10) : 0;
            const isReachable = !error;
            resolve({ frameCount, isReachable });
        });
    });
}

async function checkStreamStatus(url) {
    const expectedFrameRate = await getExpectedFrameRate(url);
    const { frameCount, isReachable } = await probeStreamFrames(url);

    if (!isReachable) {
        return { isOnline: false, quality: 'unverified', frameCount, expectedFrameRate };
    }

    const durationSeconds = 5;
    const expectedFrames = expectedFrameRate ? expectedFrameRate * durationSeconds : 0;

    if (frameCount === 0) {
        return { isOnline: true, quality: 'stalled', frameCount, expectedFrameRate };
    }

    if (expectedFrames > 0) {
        const dropRatio = (expectedFrames - frameCount) / expectedFrames;
        const quality = dropRatio > 0.2 ? 'degraded' : 'good';
        return { isOnline: true, quality, frameCount, expectedFrameRate };
    }

    return { isOnline: true, quality: 'unverified', frameCount, expectedFrameRate };
}

async function updateStreamStatus(streamId, isOnline, quality) {
    const status = isOnline ? 'online' : 'offline';
    const query = 'UPDATE streams SET status = ?, quality = ? WHERE id = ?';

    return new Promise((resolve, reject) => {
        // Fetch current status and name from the database
        connection.query('SELECT status, name, quality FROM streams WHERE id = ?', [streamId], (error, results) => {
            if (error) {
                console.error('Error fetching current status:', error.message);
                reject(error);
                return;
            }

            if (results.length > 0) {
                const currentStatus = results[0].status;
                const currentQuality = results[0].quality;
                const name = results[0].name || 'Unnamed Stream'; // Default to 'Unnamed Stream' if name is null or undefined

                if (currentStatus !== status || currentQuality !== quality) {
                    connection.query(query, [status, quality, streamId], (error) => {
                        if (error) {
                            console.error('Error updating stream status:', error.message);
                            reject(error);
                        } else {
                            console.log(`Stream ${streamId} status updated to ${status}`);
                            logStatusChange(name, status, quality); // Log the status change with name
                            resolve(); // Resolve the promise after status update
                        }
                    });
                } else {
                    resolve(); // Resolve if no status change
                }
            } else {
                console.warn(`No results found for stream ID ${streamId}`);
                resolve(); // Resolve if no results
            }
        });
    });
}

// Function to log status changes
function logStatusChange(name, status, quality) {
    if (name && status) {
        const qualitySuffix = quality ? ` (quality: ${quality})` : '';
        statusChanges.push(`${name} - ${status}${qualitySuffix}`);
    } else {
        console.warn(`Invalid status change: Name - ${name}, Status - ${status}`);
    }
}

// Function to introduce a delay
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function disconnectFromDatabase() {
    return new Promise((resolve, reject) => {
        connection.end((error) => {
            if (error) {
                console.error('Error disconnecting from database:', error.message);
                reject(error);
            } else {
                console.log('Disconnected from database');
                resolve();
            }
        });
    });
}

async function fetchAndCheckStreams() {
    try {
        const results = await fetchStreamsFromDatabase();
        await checkStreamStatusAndUpdate(results);
    } catch (error) {
        console.error('Error fetching and checking streams:', error);
    }
}

async function fetchStreamsFromDatabase() {
    return new Promise((resolve, reject) => {
        const query = 'SELECT id, url FROM streams';
        connection.query(query, (error, results) => {
            if (error) {
                reject(error);
            } else {
                resolve(results);
            }
        });
    });
}

async function checkStreamStatusAndUpdate(streams) {
    const offlineStreams = [];
    for (const stream of streams) {
        console.log(`Checking stream ${stream.id}: ${stream.url}`);
        try {
            const { isOnline, quality, frameCount, expectedFrameRate } = await checkStreamStatus(stream.url);
            console.log(`Stream ${stream.id} status: ${isOnline ? 'online' : 'offline'}, quality: ${quality}, frames: ${frameCount}, fps: ${expectedFrameRate ?? 'unknown'}`);
            await updateStreamStatus(stream.id, isOnline, quality);
            if (!isOnline) {
                offlineStreams.push(stream); // Add offline stream for retry
            }
        } catch (error) {
            console.error(`Error checking stream ${stream.id}:`, error);
        }
        await sleep(15000); // Introduce a delay between each stream check
    }
    await retryOfflineStreams(offlineStreams);
}

async function retryOfflineStreams(offlineStreams) {
    console.log('Retrying status check for offline streams:');
    const retryStatusChanges = []; // Track changes during retry phase

    for (const stream of offlineStreams) {
        console.log(`Retrying stream ${stream.id}: ${stream.url}`);
        try {
            const { isOnline, quality, frameCount, expectedFrameRate } = await checkStreamStatus(stream.url);
            console.log(`Stream ${stream.id} status: ${isOnline ? 'online' : 'offline'}, quality: ${quality}, frames: ${frameCount}, fps: ${expectedFrameRate ?? 'unknown'}`);
            const oldStatus = isOnline ? 'offline' : 'online';

            // Fetch stream name before logging the status change
            const [result] = await new Promise((resolve, reject) => {
                connection.query('SELECT name FROM streams WHERE id = ?', [stream.id], (error, results) => {
                    if (error) {
                        console.error('Error fetching stream name:', error.message);
                        reject(error);
                    } else {
                        resolve(results);
                    }
                });
            });

                if (result && result.length > 0) {
                    const name = result[0].name || 'Unnamed Stream'; // Fallback to 'Unnamed Stream' if no name

                    if (isOnline !== (oldStatus === 'online')) {
                        await updateStreamStatus(stream.id, isOnline, quality); // Update status in the database
                        retryStatusChanges.push({
                            id: stream.id,
                            name: name, // Use the actual name
                            status: isOnline ? 'online' : 'offline',
                            quality
                        });
                    }
                }
        } catch (error) {
            console.error(`Error retrying stream ${stream.id}:`, error);
        }
    }

    // Combine retryStatusChanges with statusChanges
    retryStatusChanges.forEach(change => {
        logStatusChange(change.name, change.status, change.quality);
    });

    // Generate M3U playlist after retrying streams
    await generateM3UPlaylist();
}

async function generateM3UPlaylist() {
    // Query to fetch online streams
    const sql = "SELECT url, tvg_id, tvg_chno, tvg_logo, tvg_name FROM streams WHERE status = 'online'";
    connection.query(sql, (err, rows) => {
        if (err) throw err;

        // M3U header
        let m3u_content = "#EXTM3U\n";

        // Loop through the results and format the streams into M3U format
        for (const row of rows) {
            m3u_content += `#EXTINF:-1 tvg-id="${row.tvg_id}" tvg-chno="${row.tvg_chno}" tvg-name="${row.tvg_name}" tvg-logo="${row.tvg_logo}", ${row.tvg_name}\n`;
            m3u_content += `${row.url}\n`;
        }

        // Write the M3U content to a file
        const file_path = "/root/app/output.m3u";
        fs.writeFileSync(file_path, m3u_content);
        console.log(`M3U playlist generated and saved to ${file_path}`);
    });
}

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
}

function parseRequestBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', (chunk) => {
            data += chunk;
        });
        req.on('end', () => {
            if (!data) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(data));
            } catch (error) {
                reject(new Error('Invalid JSON payload'));
            }
        });
        req.on('error', reject);
    });
}

function serveStaticFile(pathname, res) {
    const publicDir = path.join(__dirname, 'public');
    const safePath = pathname === '/' ? '/index.html' : pathname;
    const requestedPath = path.resolve(publicDir, `.${safePath}`);

    if (!requestedPath.startsWith(publicDir)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
    }

    const contentTypeMap = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript'
    };
    const ext = path.extname(requestedPath);
    const contentType = contentTypeMap[ext] || 'text/plain';

    fs.readFile(requestedPath, (error, data) => {
        if (error) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
        }

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
}

function handleGetStreams(res) {
    const query = 'SELECT id, name, url, status, quality, tvg_id, tvg_chno, tvg_logo, tvg_name FROM streams ORDER BY id DESC';
    connection.query(query, (error, results) => {
        if (error) {
            console.error('Error fetching streams:', error.message);
            sendJson(res, 500, { message: 'Unable to fetch streams' });
            return;
        }

        sendJson(res, 200, results);
    });
}

async function handleCreateStream(req, res) {
    try {
        const { name, url: streamUrl, tvg_id, tvg_chno, tvg_logo, tvg_name } = await parseRequestBody(req);

        if (!streamUrl || !streamUrl.trim()) {
            sendJson(res, 400, { message: 'Stream URL is required.' });
            return;
        }

        const normalizedName = name?.trim() || null;
        const normalizedTvgName = tvg_name?.trim() || normalizedName;
        const normalizedChannelNumber = tvg_chno !== undefined && tvg_chno !== null && tvg_chno !== ''
            ? Number(tvg_chno)
            : null;

        const newStream = {
            name: normalizedName,
            url: streamUrl.trim(),
            status: 'offline',
            quality: 'unverified',
            tvg_id: tvg_id?.trim() || null,
            tvg_chno: Number.isNaN(normalizedChannelNumber) ? null : normalizedChannelNumber,
            tvg_logo: tvg_logo?.trim() || null,
            tvg_name: normalizedTvgName
        };

        connection.query('INSERT INTO streams SET ?', newStream, (error, result) => {
            if (error) {
                console.error('Error creating stream:', error.message);
                sendJson(res, 500, { message: 'Unable to create stream' });
                return;
            }

            sendJson(res, 201, { id: result.insertId, ...newStream });
        });
    } catch (error) {
        sendJson(res, 400, { message: error.message });
    }
}

function handleDeleteStream(pathname, res) {
    const id = Number(pathname.split('/')[3]);

    if (!Number.isInteger(id)) {
        sendJson(res, 400, { message: 'Invalid stream id' });
        return;
    }

    connection.query('DELETE FROM streams WHERE id = ?', [id], (error, result) => {
        if (error) {
            console.error('Error deleting stream:', error.message);
            sendJson(res, 500, { message: 'Unable to delete stream' });
            return;
        }

        if (result.affectedRows === 0) {
            sendJson(res, 404, { message: 'Stream not found' });
            return;
        }

        sendJson(res, 200, { message: 'Stream deleted' });
    });
}

function startServer() {
    const server = http.createServer((req, res) => {
        const parsedUrl = new URL(req.url, 'http://localhost');
        const pathname = parsedUrl.pathname;

        if (req.method === 'GET' && pathname === '/api/streams') {
            handleGetStreams(res);
            return;
        }

        if (req.method === 'POST' && pathname === '/api/streams') {
            handleCreateStream(req, res);
            return;
        }

        if (req.method === 'DELETE' && pathname.startsWith('/api/streams/')) {
            handleDeleteStream(pathname, res);
            return;
        }

        serveStaticFile(pathname, res);
    });

    server.listen(PORT, () => {
        console.log(`Web dashboard is available on port ${PORT}`);
    });
}

async function main({ skipConnect = false, disconnect = true } = {}) {
    try {
        // Connect to MySQL database if not already connected
        if (!skipConnect) {
            connection.connect((error) => {
                if (error) {
                    console.error('Error connecting to database:', error.message);
                } else {
                    console.log('Connected to database');
                }
            });
        }

        // Check streams immediately
        console.log('Checking streams...');
        await fetchAndCheckStreams();
        console.log('Stream check completed');
    } catch (error) {
        console.error('Error in main:', error);
    } finally {
        // Ensure disconnect happens only after all operations
        if (disconnect) {
            console.log('Disconnecting from database...');
            await disconnectFromDatabase();
            console.log('Script is now idle');

            // Send email after script completion
            try {
                await sendEmail();
                console.log('Email sent successfully.');
            } catch (emailError) {
                console.error('Error sending email:', emailError);
            }
        }
    }
}

console.log('Status changes to be sent in email:', statusChanges);

// Function to send email
async function sendEmail() {
    // Create an SMTP transporter object
    let transporter = nodemailer.createTransport({
          host: 'mail.gmx.com', // Your SMTP server hostname
        port: 587, // Your SMTP server port
        secure: false, // true for 465, false for other ports
        auth: {
            user: '', // Your email username
            pass: '' // Your email password
        }
    });

    // Define email options
    let mailOptions = {
        from: 'm3uchecker@gmx.com', // Sender address
        to: 'riot071@gmail.com', // List of recipients
        subject: 'Stream Status Changes',
        text: statusChanges.join('\n') // List status changes
    };

    // Send email
    return transporter.sendMail(mailOptions);
}

connection.connect((error) => {
    if (error) {
        console.error('Error connecting to database:', error.message);
    } else {
        console.log('Connected to database');
    }

    startServer();

    if (process.env.RUN_STATUS_CHECK === 'true') {
        main({ skipConnect: true, disconnect: false }).catch((err) => {
            console.error('Error during startup status check:', err);
        });
    }
});
