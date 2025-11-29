// emailService.js
const nodemailer = require('nodemailer');

async function sendEmail(statusChanges) {
  if (!statusChanges || statusChanges.length === 0) {
    console.log('No status changes, skipping email.');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: 'mail.gmx.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.M3U_MAIL_USER || '', // put your credentials in .env
      pass: process.env.M3U_MAIL_PASS || '',
    },
  });

  const mailOptions = {
    from: 'm3uchecker@gmx.com',
    to: 'riot071@gmail.com',
    subject: 'Stream Status Changes',
    text: statusChanges.join('\n'),
  };

  return transporter.sendMail(mailOptions);
}

module.exports = {
  sendEmail,
};
