# iptv-stream-status-check

Stream Status Checker and Notifier

This script monitors the status of streams in a database and sends email notifications when changes occur. It is designed to ensure that stream status updates are accurately captured and reported, helping maintain the reliability and availability of your streams.
Features

I initally created this script to assist with IPTV providers providing reliable streams to my clients on my emby server, the way its setup it ensures that the output.m3u file is all streams that are online so my viewers can watch them as ndeed

Features:

    Database Monitoring: Checks the status of streams by querying the database.
    Status Change Detection: Identifies changes in the stream status and logs them.
    M3U Playlist Generation: Creates an M3U playlist based on the current stream data.
    Email Notifications: Sends emails detailing status changes, including stream names and new statuses, confirming successful status checks.

Usage:

    Setup: Configure your database connection settings and email details in the script.
    Run the Script: Execute the script to start monitoring stream statuses.
    Check Emails: Review the email notifications for updates on stream status changes.

Installation:

    Clone the repository: git clone https://github.com/yourusername/stream-status-checker.git
    Navigate to the script directory: cd stream-status-checker
    Install dependencies: npm install
    Configure your settings in the script.
