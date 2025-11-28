require('dotenv').config();
const mysql = require('mysql');
const { exec } = require('child_process');
const fs = require('fs');
const nodemailer = require('nodemailer');

// MySQL connection configuration
const connection = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
});

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

async function main() {
    try {
        // Connect to MySQL database
        connection.connect();

        // Check streams immediately
        console.log('Checking streams...');
        await fetchAndCheckStreams();
        console.log('Stream check completed');
    } catch (error) {
        console.error('Error in main:', error);
    } finally {
        // Ensure disconnect happens only after all operations
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

// Run the main function
main();
