import fs from 'fs';
import path from 'path';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

async function fetchJson(url: string, options: RequestInit = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, headers: res.headers, data };
}

function imageToBase64Jpeg(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

function buildEvidenceFrames(challengeType: string) {
  let closed = 4;
  let action = 2;
  let post = 5;
  if (challengeType === 'BLINK_AND_HEAD_RIGHT') {
    closed = 4;
    action = 3;
    post = 5;
  } else if (challengeType === 'BLINK_AND_NOD') {
    closed = 2;
    action = 5;
    post = 4;
  }
  return {
    baselineOpenJpeg: imageToBase64Jpeg(path.resolve('./training/data/raw/2VX24CB069/sample_1.jpg')),
    blinkClosedJpeg: imageToBase64Jpeg(path.resolve(`./training/data/raw/2VX24CB069/sample_${closed}.jpg`)),
    challengeActionJpeg: imageToBase64Jpeg(path.resolve(`./training/data/raw/2VX24CB069/sample_${action}.jpg`)),
    postChallengeOpenJpeg: imageToBase64Jpeg(path.resolve(`./training/data/raw/2VX24CB069/sample_${post}.jpg`)),
  };
}

async function runEndToEndVerification() {
  console.log('================================================================');
  console.log('🚀 VTU SMART ATTENDANCE: MOBILE CAMERA & 1:N IDENTIFICATION E2E');
  console.log(`Target URL: ${BASE_URL}`);
  console.log('================================================================\n');

  // Step 1: Faculty Authentication
  console.log('--- Step 1: Faculty Authentication ---');
  const loginRes = await fetchJson(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    body: JSON.stringify({
      identifierOrEmail: 'rohit.kaliwal@vtu.ac.in',
      password: 'DemoPass@2026',
    }),
  });
  console.log(`Login status: ${loginRes.status}`);
  const setCookie = loginRes.headers.get('set-cookie') || '';
  const token = loginRes.data?.token || (loginRes.data?.user && loginRes.data.user.token);
  const facultyAuthHeaders: Record<string, string> = {
    ...(setCookie ? { Cookie: setCookie } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  console.log(`✅ Faculty authenticated: ${loginRes.data?.user?.name} (${loginRes.data?.user?.identifier})`);

  // Step 2: Faculty Starts Dynamic QR Attendance Session for CSBS Section B
  console.log('\n--- Step 2: Faculty Starts Dynamic QR Attendance Session ---');
  const bootRes = await fetchJson(`${BASE_URL}/api/bootstrap`, {
    headers: facultyAuthHeaders,
  });
  const assignments = bootRes.data?.facultyAssignments || [];
  const assignment =
    assignments.find((a: any) => a.sectionDisplayName?.includes('CSBS B') || a.sectionId === 'sec-csbs-b') ||
    assignments[0];
  console.log(`Selected assignment: ${assignment?.subjectCode} - ${assignment?.subjectName} (${assignment?.sectionDisplayName})`);

  const qrSessionRes = await fetchJson(`${BASE_URL}/api/qr-sessions`, {
    method: 'POST',
    headers: facultyAuthHeaders,
    body: JSON.stringify({
      subjectId: assignment.subjectId,
      sectionId: assignment.sectionId,
      classroom: 'VB G19',
      hostLatitude: 15.8858,
      hostLongitude: 74.5298,
      hostAccuracy: 5,
    }),
  });

  const qrSession = qrSessionRes.data?.session || qrSessionRes.data;
  console.log(`✅ Active QR Session created: ID=${qrSession.id}`);
  console.log(`Current QR Token: ${qrSession.currentQrToken}`);
  console.log(`QR Rotation Interval: ${qrSession.rotationIntervalSeconds || 5} seconds`);

  // Step 3: Verify Dynamic QR URL format for Native Phone Camera
  console.log('\n--- Step 3: Verify Native Mobile Camera QR URL ---');
  const scannedUrl = `${BASE_URL}/attend?sessionId=${encodeURIComponent(qrSession.id)}&token=${encodeURIComponent(qrSession.currentQrToken)}`;
  console.log(`Native Camera Scans QR -> Opens Webpage URL:`);
  console.log(`👉 ${scannedUrl}`);

  // Step 4: Public Scan Token Claim (NO Login / Unauthenticated Student)
  console.log('\n--- Step 4: Public Scan Claim Without Student Login ---');
  const claimRes = await fetchJson(`${BASE_URL}/api/qr-attendance/validate-scan-public`, {
    method: 'POST',
    body: JSON.stringify({
      sessionId: qrSession.id,
      qrToken: qrSession.currentQrToken,
    }),
  });

  console.log(`Claim status: ${claimRes.status}`);
  if (!claimRes.data?.success || !claimRes.data?.verificationSessionId) {
    throw new Error('Public scan validation failed: ' + JSON.stringify(claimRes.data));
  }
  const { verificationSessionId, sessionToken, sessionInfo } = claimRes.data;
  console.log(`✅ Public scan claimed successfully!`);
  console.log(`   Issued Verification Session ID: ${verificationSessionId}`);
  console.log(`   Session Token (signed): ${sessionToken.substring(0, 32)}...`);
  console.log(`   Course: ${sessionInfo?.subjectName} (${sessionInfo?.subjectCode})`);
  console.log(`   Section: ${sessionInfo?.sectionDisplayName}`);

  // Step 5: Test Unknown Face Rejection ("No User Found")
  console.log('\n--- Step 5: Test Unknown Face Rejection ("No User Found") ---');
  const unknownFacePath = path.resolve('./training/data/raw/2VX24CB060/sample_1.jpg');
  const unknownFaceBase64 = imageToBase64Jpeg(unknownFacePath);

  const unknownFaceRes = await fetchJson(`${BASE_URL}/api/verification/identify-live-face`, {
    method: 'POST',
    body: JSON.stringify({
      verificationSessionId,
      sessionToken,
      liveFrameJpeg: unknownFaceBase64,
    }),
  });

  console.log(`Unknown Face Result:`, unknownFaceRes.data);
  if (unknownFaceRes.data?.status === 'NO_USER_FOUND' && !unknownFaceRes.data?.matched) {
    console.log('✅ PASS: Unknown face correctly rejected with "NO_USER_FOUND" (No user match in enrolled roster).');
  } else {
    throw new Error(`FAIL: Expected NO_USER_FOUND but got ${JSON.stringify(unknownFaceRes.data)}`);
  }

  // Step 6: Test 1:N Facial Identification for Genuine Enrolled Student
  console.log('\n--- Step 6: Test 1:N Identification for Enrolled Student (Rahul Shirol - 2VX24CB069) ---');
  const rahulFacePath = path.resolve('./training/data/raw/2VX24CB069/sample_1.jpg');
  const rahulFaceBase64 = imageToBase64Jpeg(rahulFacePath);

  const identifyRes = await fetchJson(`${BASE_URL}/api/verification/identify-live-face`, {
    method: 'POST',
    body: JSON.stringify({
      verificationSessionId,
      sessionToken,
      liveFrameJpeg: rahulFaceBase64,
    }),
  });

  console.log(`Identification Result:`);
  console.log(`   Matched: ${identifyRes.data?.matched}`);
  console.log(`   Status: ${identifyRes.data?.status}`);
  console.log(`   Identified USN: ${identifyRes.data?.matchedUsn}`);
  console.log(`   Identified Name: ${identifyRes.data?.studentName}`);
  console.log(`   Similarity: ${identifyRes.data?.similarity}`);

  if (
    identifyRes.data?.matched &&
    identifyRes.data?.matchedUsn === '2VX24CB069' &&
    identifyRes.data?.studentName?.toUpperCase().includes('RAHUL')
  ) {
    console.log('✅ PASS: 1:N ArcFace identification automatically resolved USN 2VX24CB069 without manual credentials.');
  } else {
    throw new Error('FAIL: 1:N identification did not resolve expected student: ' + JSON.stringify(identifyRes.data));
  }

  // Step 7: Automatically Mark Attendance in Backend
  console.log('\n--- Step 7: Automatically Mark Attendance in Backend ---');
  const challengeType = claimRes.data?.challengeType || 'BLINK_AND_HEAD_LEFT';
  console.log(`Session Challenge Type: ${challengeType}`);
  const evidenceFrames = buildEvidenceFrames(challengeType);

  const finalizeRes = await fetchJson(`${BASE_URL}/api/qr-attendance/finalize-face-attendance`, {
    method: 'POST',
    body: JSON.stringify({
      verificationSessionId,
      sessionToken,
      qrSessionId: qrSession.id,
      evidenceFrames,
    }),
  });

  console.log(`Finalize Status: ${finalizeRes.status}`);
  console.log(`Response message: ${finalizeRes.data?.message}`);
  const record = finalizeRes.data?.record;
  const attempt = finalizeRes.data?.attempt;
  console.log(`✅ Attendance Marked:`);
  console.log(`   Record ID: ${record?.id}`);
  console.log(`   Student: ${attempt?.studentName} (${record?.studentIdentifier})`);
  console.log(`   Subject: ${attempt?.subjectName} (${attempt?.subjectCode})`);
  console.log(`   Status: ${record?.status}`);
  console.log(`   Method: ${record?.method || attempt?.method}`);

  if (finalizeRes.status !== 200 || !record || record.status !== 'Present') {
    throw new Error('FAIL: Attendance finalize did not create a valid Present record: ' + JSON.stringify(finalizeRes.data));
  }

  // Step 8: Verify Duplicate Rejection
  console.log('\n--- Step 8: Verify Duplicate Attendance Prevention ---');
  const secondClaim = await fetchJson(`${BASE_URL}/api/qr-attendance/validate-scan-public`, {
    method: 'POST',
    body: JSON.stringify({
      sessionId: qrSession.id,
      qrToken: qrSession.currentQrToken,
    }),
  });

  const dupChallengeType = secondClaim.data?.challengeType || 'BLINK_AND_HEAD_LEFT';
  const dupEvidenceFrames = buildEvidenceFrames(dupChallengeType);

  const dupRes = await fetchJson(`${BASE_URL}/api/qr-attendance/finalize-face-attendance`, {
    method: 'POST',
    body: JSON.stringify({
      verificationSessionId: secondClaim.data.verificationSessionId,
      sessionToken: secondClaim.data.sessionToken,
      qrSessionId: qrSession.id,
      evidenceFrames: dupEvidenceFrames,
    }),
  });

  console.log(`Duplicate Attempt Status: ${dupRes.status}`);
  console.log(`Duplicate Attempt Response: ${JSON.stringify(dupRes.data)}`);
  if (dupRes.status === 200 && dupRes.data?.alreadyMarked) {
    console.log(`✅ PASS: Duplicate attendance detected gracefully: "${dupRes.data?.message}"`);
  } else if (dupRes.status === 409) {
    console.log(`✅ PASS: Duplicate attendance rejected with HTTP 409: "${dupRes.data?.message}"`);
  } else {
    throw new Error(`FAIL: Expected alreadyMarked duplicate detection, got ${dupRes.status}: ${JSON.stringify(dupRes.data)}`);
  }

  // Step 9: Verify Attendance Record Persisted in Teacher Session Dashboard
  console.log('\n--- Step 9: Verify Attendance in Faculty Session View ---');
  const updatedQrSessionRes = await fetchJson(`${BASE_URL}/api/qr-sessions/${qrSession.id}`, {
    headers: facultyAuthHeaders,
  });
  const attempts = updatedQrSessionRes.data?.attempts || [];
  console.log(`Teacher session recorded attempts: ${attempts.length}`);
  const verifiedAttempt = attempts.find((a: any) => a.studentIdentifier === '2VX24CB069');
  console.log(`Verified attempt for 2VX24CB069:`, verifiedAttempt ? `Status: ${verifiedAttempt.classification}, Record: ${verifiedAttempt.attendanceRecordId}` : 'None');
  if (verifiedAttempt && verifiedAttempt.attendanceRecordCreated) {
    console.log('✅ PASS: Teacher live dashboard immediately reflects the marked student attendance.');
  } else {
    throw new Error('FAIL: Verified attempt not found in teacher session.');
  }

  console.log('\n================================================================');
  console.log('🎉 ALL END-TO-END MOBILE CAMERA & 1:N VERIFICATIONS PASSED!');
  console.log('================================================================\n');
}

runEndToEndVerification().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
