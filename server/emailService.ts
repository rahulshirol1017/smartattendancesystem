import net from 'net';
import tls from 'tls';

export interface EmailDeliveryResult {
  sent: boolean;
  mode: 'smtp' | 'console_dev';
  messageId?: string;
  error?: string;
}

/**
 * Enterprise Email Delivery Service
 *
 * Configured via environment variables:
 * - SMTP_HOST: Hostname of the mail server (e.g. smtp.gmail.com, mail.vtu.ac.in)
 * - SMTP_PORT: Port (e.g. 587 or 465)
 * - SMTP_USER: Username / Email
 * - SMTP_PASS: Password / App Password
 * - SMTP_FROM: Sender email (defaults to VTU Smart Attendance <no-reply@vtu.ac.in>)
 * - SMTP_SECURE: "true" for implicit TLS (port 465)
 *
 * If SMTP_HOST is unset, safely logs the reset code to server console in dev mode.
 */
export async function sendPasswordResetEmail(
  toEmail: string,
  otpCode: string,
  userName?: string
): Promise<EmailDeliveryResult> {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = process.env.SMTP_FROM?.trim() || 'VTU Smart Attendance <no-reply@vtu.ac.in>';
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;

  const subject = 'VTU Smart Attendance — Password Reset Verification Code';
  const textBody = `Dear ${userName || 'Student/Faculty'},

You have requested to reset your password for the VTU Smart Attendance System.

Your 6-digit verification code is:

    ${otpCode}

This code will expire in 15 minutes. It can only be used once.
If you did not request a password reset, please ignore this email or contact your departmental administrator immediately.

Visvesvaraya Technological University, Jnana Sangama, Belagavi - 590018
Department of Computer Science & Business Systems
`;

  // If no SMTP server configured, safely log to console for development / offline operation
  if (!host) {
    console.log(
      '\n' +
        '='.repeat(78) +
        '\n' +
        `[VTU EMAIL NOTIFICATION · DEV MODE]\n` +
        `To: ${toEmail}\n` +
        `Subject: ${subject}\n` +
        `Verification Code: [ ${otpCode} ] (Valid for 15 minutes)\n` +
        '='.repeat(78) +
        '\n'
    );
    return { sent: true, mode: 'console_dev' };
  }

  // Live SMTP delivery over TLS / STARTTLS
  return new Promise<EmailDeliveryResult>((resolve) => {
    try {
      const socket = secure
        ? tls.connect({ host, port, rejectUnauthorized: false }, () => {})
        : net.connect({ host, port }, () => {});

      let buffer = '';
      let step = 0;

      const send = (cmd: string) => {
        socket.write(cmd + '\r\n');
      };

      socket.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\r\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const code = parseInt(line.substring(0, 3), 10);
          if (line.charAt(3) === '-') continue; // multiline response

          if (step === 0 && code === 220) {
            step++;
            send(`EHLO vtu.ac.in`);
          } else if (step === 1 && code === 250) {
            if (user && pass) {
              step++;
              send('AUTH LOGIN');
            } else {
              step = 4;
              send(`MAIL FROM:<${from}>`);
            }
          } else if (step === 2 && code === 334) {
            step++;
            send(Buffer.from(user || '').toString('base64'));
          } else if (step === 3 && code === 334) {
            step++;
            send(Buffer.from(pass || '').toString('base64'));
          } else if (step === 4 && (code === 235 || code === 250)) {
            step++;
            send(`MAIL FROM:<${from}>`);
          } else if (step === 5 && code === 250) {
            step++;
            send(`RCPT TO:<${toEmail}>`);
          } else if (step === 6 && code === 250) {
            step++;
            send('DATA');
          } else if (step === 7 && code === 354) {
            step++;
            const msg = [
              `From: ${from}`,
              `To: ${toEmail}`,
              `Subject: ${subject}`,
              'MIME-Version: 1.0',
              'Content-Type: text/plain; charset=UTF-8',
              '',
              textBody,
              '.',
            ].join('\r\n');
            send(msg);
          } else if (step === 8 && code === 250) {
            send('QUIT');
            socket.end();
            resolve({ sent: true, mode: 'smtp' });
          } else if (code >= 400) {
            socket.destroy();
            console.warn(`[VTU EMAIL ERROR] SMTP error at step ${step}: ${line}`);
            resolve({ sent: false, mode: 'smtp', error: line });
          }
        }
      });

      socket.on('error', (err) => {
        console.warn(`[VTU EMAIL ERROR] SMTP connection error: ${err.message}`);
        resolve({ sent: false, mode: 'smtp', error: err.message });
      });

      socket.setTimeout(10000, () => {
        socket.destroy();
        resolve({ sent: false, mode: 'smtp', error: 'SMTP Timeout after 10 seconds' });
      });
    } catch (err) {
      resolve({
        sent: false,
        mode: 'smtp',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
