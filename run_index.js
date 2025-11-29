const { exec } = require('child_process');

// Path to the Node.js script you want to run
const scriptPath = '/home/m3ucheck/index.js';

// Execute the script
exec(`node ${scriptPath}`, (error, stdout, stderr) => {
    if (error) {
        console.error(`Error executing script: ${error.message}`);
        return;
    }
    if (stderr) {
        console.error(`Script stderr: ${stderr}`);
    }
    console.log(`Script output: ${stdout}`);
});
