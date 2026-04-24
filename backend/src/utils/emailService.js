const axios = require('axios');

async function sendStatusEmail(userEmail, userName, issueTitle, newStatus) {
  const brevoApiKey = process.env.BREVO_API_KEY;
  const brevoSender = process.env.BREVO_SENDER_EMAIL;

  if (!brevoApiKey || !brevoSender) {
    console.warn('BREVO_API_KEY or BREVO_SENDER_EMAIL is missing. Skipping email notification.');
    return;
  }

  // Formatting status to be more human readable
  const formattedStatus = newStatus.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());

  const data = {
    sender: {
      name: 'VoiceUp Updates',
      email: brevoSender
    },
    to: [
      {
        email: userEmail,
        name: userName
      }
    ],
    subject: `VoiceUp Update: Your report status is now ${formattedStatus}`,
    htmlContent: `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2 style="color: #6C3FC5;">VoiceUp Notification 📢</h2>
        <p>Hey <strong>${userName}</strong>,</p>
        <p>Your report <strong>"${issueTitle}"</strong> is now marked as <strong>${formattedStatus}</strong>.</p>
        <p>Thank you for helping keep your community safe and clean!</p>
        <br>
        <p style="font-size: 0.8rem; color: #888;">VoiceUp Team</p>
      </div>
    `
  };

  try {
    const response = await axios.post('https://api.brevo.com/v3/smtp/email', data, {
      headers: {
        'accept': 'application/json',
        'api-key': brevoApiKey,
        'content-type': 'application/json'
      }
    });
    console.log('Email sent successfully via Brevo:', response.data);
  } catch (error) {
    console.error('Failed to send email via Brevo:', error.response ? error.response.data : error.message);
  }
}

module.exports = {
  sendStatusEmail
};
