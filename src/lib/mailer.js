import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_PORT === '465', // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const sendResetEmail = async (toEmail, resetLink) => {
  if (!process.env.SMTP_USER) {
    console.error('SMTP_USER missing. Please configure .env');
    return false;
  }
  
  try {
    const info = await transporter.sendMail({
      from: `"LeadFlow Admin" <${process.env.SMTP_USER}>`,
      to: toEmail,
      subject: "Password Reset Request",
      html: `
        <div style="font-family: sans-serif; max-w: 600px; margin: 0 auto;">
          <h2>LeadFlow Password Reset</h2>
          <p>We received a request to reset your password. Click the button below to choose a new one:</p>
          <div style="margin: 30px 0;">
            <a href="${resetLink}" style="background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Reset Password</a>
          </div>
          <p>If you did not request this, please ignore this email.</p>
          <p style="color: #64748b; font-size: 12px; margin-top: 40px;">This link will expire in 15 minutes.</p>
        </div>
      `,
    });
    console.log("Message sent: %s", info.messageId);
    return true;
  } catch (error) {
    console.error("Error sending email:", error);
    return false;
  }
};
