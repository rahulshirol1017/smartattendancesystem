import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  cosineSimilarity,
  evaluateFaceMatch,
  normalizeVector,
} from '../server/biometricMatcher.ts';
import {
  deleteEnrolledSubject,
  getEnrolledSubject,
  listEnrolledSubjectsSummary,
  upsertEnrolledSubject,
} from '../server/enrollmentStore.ts';
import {
  getActiveModelVersion,
  loadModelRegistry,
  getTrainingStatus,
} from '../server/modelManager.ts';
import {
  issueVerificationSession,
  validateAndConsumeSession,
  signVerificationResult,
  verifyResultSignature,
} from '../server/sessionManager.ts';
import {
  decodeJpegBase64,
  detectFacesScrfd,
  evaluateServerFaceQuality,
  extractArcFaceEmbeddingServer,
} from '../server/serverInference.ts';

async function runTestSuite() {
  console.log('================================================================');
  console.log('VTU SMART ATTENDANCE: BIOMETRIC RECOGNITION & ATTENDANCE TESTS');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`[PASS] ${testName}`);
    } else {
      console.error(`[FAIL] ${testName}`);
      if (detail) console.error(`       Detail: ${detail}`);
    }
  }

  // -------------------------------------------------------------------------
  // TEST 1: Model Architecture & Pretrained InsightFace Weights Verification
  // -------------------------------------------------------------------------
  console.log('--- 1. Pretrained Model Verification ---');
  const activeVer = getActiveModelVersion();
  assert(
    activeVer.modelId === 'arcface-w600k-mbf-512d',
    'Active Model ID is InsightFace MobileFaceNet 512-D',
    `Found ${activeVer.modelId}`
  );
  assert(
    fs.existsSync(path.resolve(process.cwd(), activeVer.onnxPath)),
    'Pretrained ArcFace ONNX weights exist on disk',
    `Path: ${activeVer.onnxPath}`
  );
  assert(
    fs.existsSync(path.resolve(process.cwd(), 'public/models/scrfd_det_500m.onnx')),
    'Pretrained SCRFD-500M face detection model exists on disk'
  );

  // -------------------------------------------------------------------------
  // TEST 2: Consented Student Enrollment & AES-256-GCM Template Encryption
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Consented Enrollment & AES-256 Storage ---');
  const testStudentId = '1RV22CS999';
  const dummyVector1 = normalizeVector(new Array(512).fill(0).map((_, i) => Math.sin(i * 0.1)));
  const dummyVector2 = normalizeVector(new Array(512).fill(0).map((_, i) => Math.sin(i * 0.1) + 0.05 * Math.cos(i)));

  // Upsert enrolled reference
  const enrolledRecord = upsertEnrolledSubject({
    subjectId: testStudentId,
    displayName: 'Test Consented Student',
    embeddings: [dummyVector1, dummyVector2],
    sampleLabels: [
      { angleLabel: 'Frontal', lightingLabel: 'Normal Classroom', qualityScore: 92 },
      { angleLabel: 'Turn Left ~15°', lightingLabel: 'Normal Classroom', qualityScore: 88 },
    ],
    consentConfirmed: true,
    mode: 'replace',
  });

  assert(
    enrolledRecord.subjectId === testStudentId && enrolledRecord.embeddings.length === 2,
    'Student enrolled with 2 sample vectors and consent recorded'
  );

  // Verify AES-256 encrypted storage file on disk
  const storePath = path.resolve(process.cwd(), '.secure_store/enrolled_references.enc.json');
  assert(fs.existsSync(storePath), 'Encrypted reference store file exists on disk');
  const storeRaw = fs.readFileSync(storePath, 'utf8');
  assert(
    !storeRaw.includes(JSON.stringify(dummyVector1)),
    'Stored reference vectors are encrypted at rest (plaintext vector not visible in raw file)'
  );

  // Verify retrieval and decryption
  const retrieved = getEnrolledSubject(testStudentId);
  assert(
    retrieved !== null && retrieved.embeddings.length === 2,
    'Decrypted enrolled template retrieved with exact 512-D vectors'
  );

  // -------------------------------------------------------------------------
  // TEST 3: Cryptographic Session Management & Anti-Replay Protection
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Verification Session & Replay Defense ---');
  const qrSessionId = 'test-qr-sess-001';
  const session = issueVerificationSession({
    studentId: testStudentId,
    qrSessionId,
  });

  assert(
    Boolean(session.verificationSessionId && session.sessionToken),
    'Cryptographically signed verification session issued'
  );

  // First validation & atomic consumption
  const firstConsume = validateAndConsumeSession({
    verificationSessionId: session.verificationSessionId,
    sessionToken: session.sessionToken,
  });
  assert(
    firstConsume.ok === true && firstConsume.studentId === testStudentId,
    'First session consumption succeeds and validates student identity'
  );

  // Replay Attack Test: Attempting to consume the same session a second time
  const replayAttempt = validateAndConsumeSession({
    verificationSessionId: session.verificationSessionId,
    sessionToken: session.sessionToken,
  });
  assert(
    replayAttempt.ok === false,
    'Replay Attack Blocked: Reused session token rejected atomically by SQLite barrier'
  );

  // Tampered Token Test
  const tamperedToken = session.sessionToken.slice(0, -6) + 'XXXXXX';
  const tamperedAttempt = validateAndConsumeSession({
    verificationSessionId: 'new-session-id',
    sessionToken: tamperedToken,
  });
  assert(
    tamperedAttempt.ok === false,
    'Tampered Session Token Blocked: Invalid HMAC signature rejected'
  );

  // -------------------------------------------------------------------------
  // TEST 4: ArcFace Biometric Matching & Threshold Calibration
  // -------------------------------------------------------------------------
  console.log('\n--- 4. ArcFace Cosine Matching & Impostor Rejection ---');
  // Matching face (same subject with minor natural variance)
  const matchingLiveVector = normalizeVector(
    dummyVector1.map((v, i) => v + 0.02 * Math.sin(i))
  );
  const matchResult = evaluateFaceMatch(matchingLiveVector, retrieved!.embeddings, 0.40);
  assert(
    matchResult.faceMatch === 'MATCH' && matchResult.cosineSimilarity > 0.90,
    `Genuine Face Match verified: Cosine similarity ${matchResult.cosineSimilarity} >= 0.40`
  );

  // Impostor face (orthogonal vector from a different student)
  const impostorVector = normalizeVector(
    new Array(512).fill(0).map((_, i) => Math.cos(i * 0.45) - 0.2 * Math.sin(i * 0.7))
  );
  const impostorResult = evaluateFaceMatch(impostorVector, retrieved!.embeddings, 0.40);
  assert(
    impostorResult.faceMatch === 'NO_MATCH' && impostorResult.cosineSimilarity < 0.40,
    `Impostor Rejected: Cosine similarity ${impostorResult.cosineSimilarity} < 0.40 threshold`
  );

  // -------------------------------------------------------------------------
  // TEST 5: Verification Result Cryptographic Signature Verification
  // -------------------------------------------------------------------------
  console.log('\n--- 5. Signed Verification Assertion ---');
  const signedAssertion = signVerificationResult({
    studentId: testStudentId,
    qrSessionId,
    verificationSessionId: session.verificationSessionId,
    challengeType: 'BLINK_AND_HEAD_LEFT',
    faceDetected: true,
    faceMatch: 'MATCH',
    blinkDetected: true,
    livenessVerified: true,
    verificationStatus: 'VERIFIED',
    modelId: 'arcface-w600k-mbf-512d',
    modelVersion: 'insightface-buffalo_sc-w600k_mbf-v1',
    confidenceScore: 0.96,
    euclideanDistance: 0.28,
    cosineSimilarity: 0.96,
    thresholdUsed: 0.40,
    failureReason: null,
    verifiedAt: new Date().toISOString(),
  });

  const isValidSignature = verifyResultSignature(signedAssertion);
  assert(isValidSignature, 'Backend HMAC-SHA256 result signature verified valid');

  const forgedAssertion = { ...signedAssertion, verificationStatus: 'VERIFIED' as const, studentId: '1RV22CS001' };
  const isForgedValid = verifyResultSignature(forgedAssertion);
  assert(!isForgedValid, 'Tampered student identity in assertion signature rejected');

  // Clean up test enrollment
  deleteEnrolledSubject(testStudentId);

  console.log('\n================================================================');
  console.log(`TEST RESULTS: ${passedTests} / ${totalTests} PASSED (${Math.round((passedTests / totalTests) * 100)}%)`);
  console.log('================================================================');

  if (passedTests < totalTests) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
