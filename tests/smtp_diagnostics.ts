import net from 'net';
import tls from 'tls';
import dotenv from 'dotenv';
import { sendPasswordResetEmail } from '../server/emailService.js';

dotenv.config();

async function runSmtpDiagnostics() {
  console.log('======================================================');
  console.log('VTU SMART ATTENDANCE - SMTP CONFIGURATION & DELIVERY AUDIT');
  console.log('======================================================\n');

  // 1. Variable Presence Check
  console.log('--- 1. Environment Variable Audit ---');
  const vars = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
    SMTP_FROM: process.env.SMTP_FROM,
    SMTP_SECURE: process.env.SMTP_SECURE,
  };

  const missing: string[] = [];
  for (const [key, val] of Object.entries(vars)) {
    const isSet = Boolean(val && val.trim().length > 0);
    console.log(`${key.padEnd(14)}: ${isSet ? 'CONFIGURED' : 'NOT CONFIGURED / MISSING'}`);
    if (!isSet && key !== 'SMTP_SECURE') {
      missing.push(key);
    }
  }

  const isConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  console.log(`\nOverall SMTP Configuration Status: ${isConfigured ? 'YES' : 'NO'}\n`);

  // 2. Outbound Network Connectivity Check
  console.log('--- 2. Network Port Connectivity Check ---');
  const testHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const testPort = Number(process.env.SMTP_PORT) || 587;

  const portCheck = await new Promise<{ ok: boolean; message: string }>((resolve) => {
    const sock = net.createConnection({ host: testHost, port: testPort, timeout: 5000 }, () => {
      sock.end();
      resolve({ ok: true, message: `Connected successfully to ${testHost}:${testPort}` });
    });
    sock.on('error', (err) => resolve({ ok: false, message: `Connection failed: ${err.message}` }));
    sock.on('timeout', () => {
      sock.destroy();
      resolve({ ok: false, message: `Timeout connecting to ${testHost}:${testPort}` });
    });
  });
  console.log(`Port ${testPort} Reachability: ${portCheck.ok ? 'REACHABLE' : 'UNREACHABLE'} (${portCheck.message})\n`);

  // 3. Email Dispatch Test to Authorized Address
  const targetEmail = 'rshirol958@gmail.com'; // Registered genuine student Rahul Shirol
  console.log(`--- 3. Live Dispatch Test to Authorized Address (${targetEmail}) ---`);
  const dispatchResult = await sendPasswordResetEmail(targetEmail, '987654', 'Rahul Shirol');
  console.log('Dispatch Outcome:', dispatchResult);

  // 4. Authentication Check
  let authStatus: 'SUCCESS' | 'FAILED' = 'FAILED';
  if (dispatchResult.sent) {
    authStatus = 'SUCCESS';
  } else {
    authStatus = 'FAILED';
  }

  console.log('\n======================================================');
  console.log('FINAL AUDIT VERDICT:');
  console.log(`* SMTP configured: ${isConfigured ? 'YES' : 'NO'}`);
  console.log(`* SMTP authentication: ${authStatus}`);
  console.log(`* Test email delivered: ${dispatchResult.sent ? 'YES' : 'NO'}`);
  console.log(`* Missing environment variables: ${missing.length > 0 ? missing.join(', ') : 'None'}`);
  console.log('======================================================');
}

runSmtpDiagnostics().catch(console.error);
