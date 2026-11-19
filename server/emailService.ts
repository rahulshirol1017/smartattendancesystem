import net from 'net';
import tls from 'tls';
import crypto from 'crypto';

export interface EmailDeliveryResult {
  sent: boolean;
  mode: 'smtp' | 'console_dev';
  messageId?: string;
  error?: string;
}

function extractCleanEmail(rawFrom: string, fallbackUser?: string): string {
  const match = rawFrom.match(/<([^>]+)>/);
  if (match && match[1].includes('@')) {
    return match[1].trim();
  }
  if (rawFrom.includes('@')) {
    return rawFrom.trim();
  }
  return fallbackUser && fallbackUser.includes('@') ? fallbackUser.trim() : 'noreply@vtu.ac.in';
}

/**
 * Enterprise Email Delivery Service
 *
 * Configured via environment variables:
 * - SMTP_HOST: Hostname of the mail server (e.g. smtp.gmail.com, mail.vtu.ac.in)
 * - SMTP_PORT: Port (e.g. 587 for STARTTLS or 465 for SSL/TLS)
 * - SMTP_USER: Username / Email (e.g. your-email@gmail.com)
 * - SMTP_PASS: Password / App Password
 * - SMTP_FROM: Sender email (defaults to VTU Smart Attendance <no-reply@vtu.ac.in>)
 * - SMTP_SECURE: "true" for implicit TLS (port 465)
 *
 * Supports:
 * - RFC 5321 pure envelope return paths (MAIL FROM)
 * - RFC 5322 formatted display headers (From: "VTU Smart Attendance" <email>)
 * - RFC 3207 STARTTLS socket upgrade on Port 587
 * - SMTPS direct TLS handshake on Port 465
 * - Console development fallback with OTP visible when SMTP is unconfigured
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
  const rawFrom = process.env.SMTP_FROM?.trim() || 'VTU Smart Attendance <no-reply@vtu.ac.in>';
  const cleanFromEmail = extractCleanEmail(rawFrom, user);
  const fromHeader = rawFrom.includes('<') ? rawFrom : `"VTU Smart Attendance" <${cleanFromEmail}>`;
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

  // Always log the OTP to server console so administrators/developers can verify immediately
  console.log(
    '\n' +
      '='.repeat(78) +
      '\n' +
      `[VTU EMAIL DISPATCH] To: ${toEmail}\n` +
      `Subject: ${subject}\n` +
      `Verification Code: [ ${otpCode} ] (Valid for 15 minutes)\n` +
      (host ? `Delivery Provider: Live SMTP (${host}:${port})\n` : `Delivery Provider: Console Dev (Configure SMTP_HOST in Render)\n`) +
      '='.repeat(78) +
      '\n'
  );

  // If no SMTP server configured, return console_dev mode success
  if (!host) {
    return { sent: true, mode: 'console_dev' };
  }

  // Live SMTP delivery over TLS (Port 465) or STARTTLS (Port 587)
  return new Promise<EmailDeliveryResult>((resolve) => {
    let resolved = false;
    const safeResolve = (res: EmailDeliveryResult) => {
      if (!resolved) {
        resolved = true;
        resolve(res);
      }
    };

    try {
      const isStartTls = !secure && port === 587;
      let activeSocket: net.Socket | tls.TLSSocket;

      if (secure) {
        activeSocket = tls.connect({ host, port, rejectUnauthorized: false }, () => {});
      } else {
        activeSocket = net.connect({ host, port }, () => {});
      }

      let buffer = '';
      let step = 0; // 0: greeting, 1: EHLO, 2: STARTTLS/AUTH, 3: USER, 4: PASS, 5: MAIL FROM, 6: RCPT TO, 7: DATA, 8: Body, 9: QUIT
      const timeoutMs = 12000;

      const timeout = setTimeout(() => {
        activeSocket.destroy();
        safeResolve({
          sent: false,
          mode: 'smtp',
          error: `SMTP Timeout after ${timeoutMs / 1000}s connecting to ${host}:${port}`,
        });
      }, timeoutMs);

      const send = (sock: net.Socket, cmd: string) => {
        sock.write(cmd + '\r\n');
      };

      const attachSocketListeners = (sock: net.Socket) => {
        sock.on('data', (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split('\r\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const code = parseInt(line.substring(0, 3), 10);
            if (line.charAt(3) === '-') continue; // multiline SMTP code e.g. "250-SIZE"

            if (step === 0 && code === 220) {
              step = 1;
              send(sock, 'EHLO vtu.ac.in');
            } else if (step === 1 && code === 250) {
              if (isStartTls && !('encrypted' in sock)) {
                step = 2; // issue STARTTLS
                send(sock, 'STARTTLS');
              } else if (user && pass) {
                step = 3;
                send(sock, 'AUTH LOGIN');
              } else {
                step = 5;
                send(sock, `MAIL FROM:<${cleanFromEmail}>`);
              }
            } else if (step === 2 && code === 220) {
              // STARTTLS accepted, upgrade socket to TLS
              sock.removeAllListeners('data');
              const tlsSocket = tls.connect(
                {
                  socket: sock,
                  host,
                  rejectUnauthorized: false,
                },
                () => {
                  step = 1; // Resend EHLO after TLS handshake
                  buffer = '';
                  attachSocketListeners(tlsSocket);
                  send(tlsSocket, 'EHLO vtu.ac.in');
                }
              );
              tlsSocket.on('error', (err) => {
                clearTimeout(timeout);
                safeResolve({ sent: false, mode: 'smtp', error: `TLS Handshake error: ${err.message}` });
              });
              activeSocket = tlsSocket;
              return;
            } else if (step === 3 && code === 334) {
              // Username challenge
              step = 4;
              send(sock, Buffer.from(user || '').toString('base64'));
            } else if (step === 4 && code === 334) {
              // Password challenge
              step = 5;
              send(sock, Buffer.from(pass || '').toString('base64'));
            } else if (step === 5 && (code === 235 || code === 250)) {
              // Authentication succeeded or bypassed
              step = 6;
              send(sock, `MAIL FROM:<${cleanFromEmail}>`);
            } else if (step === 6 && code === 250) {
              step = 7;
              send(sock, `RCPT TO:<${toEmail.trim().toLowerCase()}>`);
            } else if (step === 7 && code === 250) {
              step = 8;
              send(sock, 'DATA');
            } else if (step === 8 && code === 354) {
              step = 9;
              const msgId = `<${Date.now()}.${crypto.randomBytes(6).toString('hex')}@vtu.ac.in>`;
              const msg = [
                `From: ${fromHeader}`,
                `To: ${toEmail}`,
                `Subject: ${subject}`,
                `Date: ${new Date().toUTCString()}`,
                `Message-ID: ${msgId}`,
                'MIME-Version: 1.0',
                'Content-Type: text/plain; charset=UTF-8',
                '',
                textBody,
                '.',
              ].join('\r\n');
              send(sock, msg);
            } else if (step === 9 && code === 250) {
              clearTimeout(timeout);
              send(sock, 'QUIT');
              sock.end();
              safeResolve({ sent: true, mode: 'smtp' });
            } else if (code >= 400) {
              clearTimeout(timeout);
              sock.destroy();
              console.warn(`[VTU EMAIL ERROR] SMTP error at step ${step}: ${line}`);
              safeResolve({ sent: false, mode: 'smtp', error: line });
            }
          }
        });

        sock.on('error', (err) => {
          clearTimeout(timeout);
          console.warn(`[VTU EMAIL ERROR] Socket error: ${err.message}`);
          safeResolve({ sent: false, mode: 'smtp', error: err.message });
        });
      };

      attachSocketListeners(activeSocket);
    } catch (err) {
      safeResolve({
        sent: false,
        mode: 'smtp',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
