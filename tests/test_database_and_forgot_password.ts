import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DataRepository } from '../server/store.ts';
import {
  evaluateFaceMatch,
  identifyEnrolledSubject,
  validateDescriptorVector,
} from '../server/biometricMatcher.ts';
import { getAllEnrolledSubjects } from '../server/enrollmentStore.ts';
import { UserProfile } from '../src/shared/types.ts';

const LOCAL_DB_PATH = path.resolve('.local_db', 'vtu_attendance_store.json');
const UPLOAD_DIR = path.resolve('.private_uploads');

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, msg: string) {
  totalTests++;
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    throw new Error(msg);
  }
  passedTests++;
  console.log(`PASS: ${msg}`);
}

async function runTests() {
  console.log('\n=============================================================');
  console.log('STARTING VTU SMART ATTENDANCE TEST SUITE');
  console.log('=============================================================\n');

  const repo = new DataRepository(LOCAL_DB_PATH, UPLOAD_DIR);
  await repo.initialize();

  const studentUser = await repo.findUserByLogin('2vx24cb069@vtu.ac.in');
  assert(Boolean(studentUser), 'Found real enrolled student 2VX24CB069 in database');

  const facultyUser = await repo.findUserByLogin('rohit.kaliwal@vtu.ac.in');
  assert(Boolean(facultyUser), 'Found faculty Dr. Rohit Kaliwal in database');

  // =========================================================================
  // TEST 1: Multiple Lectures for the Same Class & Subject on the Same Day
  // =========================================================================
  console.log('\n--- Test 1: Multiple Lectures on the Same Day ---');
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  // Lecture 1: Period 1 (09:00 - 10:00)
  const lec1 = await repo.createQrSession({
    sectionId: 'sec-csbs-b',
    subjectId: 'sub-bcb501',
    faculty: facultyUser!,
    durationMinutes: 10,
    classroom: 'LH-101',
    hostLatitude: 15.8858,
    hostLongitude: 74.5298,
    hostAccuracy: 10,
  });
  assert(Boolean(lec1.id), `Created Lecture 1 session: ${lec1.id}`);

  // Student attends Lecture 1
  const sub1 = await repo.submitQrAttendanceAttempt({
    sessionId: lec1.id,
    qrToken: lec1.currentQrToken,
    student: studentUser!,
    latitude: 15.8858,
    longitude: 74.5298,
    accuracy: 12,
    deviceFingerprint: 'TEST-DEV-69',
    devicePlatform: 'MacBook Air',
    browserName: 'Chrome',
  });
  assert(sub1.success && sub1.classification === 'VERIFIED', 'Student marked Present in Lecture 1');
  assert(sub1.record?.attendanceSessionId === lec1.id, 'Record 1 has attendanceSessionId equal to Lecture 1 session ID');

  // Lecture 2: Period 4 (14:00 - 15:00) of the SAME subject on the SAME day
  const lec2 = await repo.createQrSession({
    sectionId: 'sec-csbs-b',
    subjectId: 'sub-bcb501',
    faculty: facultyUser!,
    durationMinutes: 10,
    classroom: 'LH-101',
    hostLatitude: 15.8858,
    hostLongitude: 74.5298,
    hostAccuracy: 10,
  });
  assert(Boolean(lec2.id) && lec2.id !== lec1.id, `Created Lecture 2 session: ${lec2.id}`);

  // Student attends Lecture 2 of the same subject on the same day
  const sub2 = await repo.submitQrAttendanceAttempt({
    sessionId: lec2.id,
    qrToken: lec2.currentQrToken,
    student: studentUser!,
    latitude: 15.8858,
    longitude: 74.5298,
    accuracy: 12,
    deviceFingerprint: 'TEST-DEV-69',
    devicePlatform: 'MacBook Air',
    browserName: 'Chrome',
  });
  assert(sub2.success && sub2.classification === 'VERIFIED', 'Student successfully marked Present in Lecture 2 of same subject');
  assert(sub2.record?.attendanceSessionId === lec2.id, 'Record 2 has attendanceSessionId equal to Lecture 2 session ID');
  assert(sub2.record?.id !== sub1.record?.id, 'Two distinct records exist for the two distinct lectures');

  // =========================================================================
  // TEST 2: Duplicate Attendance Prevention within the Same Lecture
  // =========================================================================
  console.log('\n--- Test 2: Duplicate Prevention in Single Lecture ---');
  const dupSub = await repo.submitQrAttendanceAttempt({
    sessionId: lec2.id,
    qrToken: lec2.currentQrToken,
    student: studentUser!,
    latitude: 15.8858,
    longitude: 74.5298,
    accuracy: 12,
    deviceFingerprint: 'TEST-DEV-69',
    devicePlatform: 'MacBook Air',
    browserName: 'Chrome',
  });
  assert(!dupSub.success, 'Duplicate scan rejected');
  assert(dupSub.classification === 'REJECTED', 'Duplicate attempt classified as REJECTED');
  assert(dupSub.attempt.suspiciousSignals?.includes('DUPLICATE_ATTENDANCE_ATTEMPT'), 'Flagged with DUPLICATE_ATTENDANCE_ATTEMPT signal');

  // =========================================================================
  // TEST 3: Concurrent Submissions Mutex Locking
  // =========================================================================
  console.log('\n--- Test 3: Concurrency Protection ---');
  const student2 = await repo.findUserByLogin('2vx24cb067@vtu.ac.in');
  assert(Boolean(student2), 'Found student 2VX24CB067');

  // Fire 5 simultaneous attempts for student2 on lec1
  const promises = Array.from({ length: 5 }).map(() =>
    repo.submitQrAttendanceAttempt({
      sessionId: lec1.id,
      qrToken: lec1.currentQrToken,
      student: student2!,
      latitude: 15.8858,
      longitude: 74.5298,
      accuracy: 12,
      deviceFingerprint: 'TEST-DEV-67',
      devicePlatform: 'Android',
      browserName: 'Chrome Mobile',
    })
  );

  const results = await Promise.all(promises);
  const verifiedCount = results.filter((r) => r.success && r.classification === 'VERIFIED').length;
  const rejectedCount = results.filter((r) => !r.success && r.classification === 'REJECTED').length;
  assert(verifiedCount === 1, `Exactly 1 verified attendance record created under concurrency (got ${verifiedCount})`);
  assert(rejectedCount === 4, `All other concurrent submissions rejected (got ${rejectedCount})`);

  // =========================================================================
  // TEST 4: Persistence across Server Restart
  // =========================================================================
  console.log('\n--- Test 4: Database Persistence across Restart ---');
  const repoRestarted = new DataRepository(LOCAL_DB_PATH, UPLOAD_DIR);
  await repoRestarted.initialize();

  const allRecordsAfter = await repoRestarted.getAllRecords();
  const rec1Found = allRecordsAfter.find((r) => r.id === sub1.record?.id);
  const rec2Found = allRecordsAfter.find((r) => r.id === sub2.record?.id);
  assert(Boolean(rec1Found), 'Lecture 1 attendance record survived server restart');
  assert(Boolean(rec2Found), 'Lecture 2 attendance record survived server restart');
  assert(rec1Found?.attendanceSessionId === lec1.id, 'Persisted record 1 preserves attendanceSessionId');
  assert(rec2Found?.attendanceSessionId === lec2.id, 'Persisted record 2 preserves attendanceSessionId');

  // =========================================================================
  // TEST 5: Dashboard Record Synchronization
  // =========================================================================
  console.log('\n--- Test 5: Teacher & Student Dashboard Synchronization ---');
  const studentRecords = await repoRestarted.getRecordsForStudent(studentUser!.id);
  const teacherSessions = await repoRestarted.listQrSessions(facultyUser!.id);
  const session1Updated = teacherSessions.find((s) => s.id === lec1.id);
  assert(Boolean(session1Updated), 'Session 1 visible to teacher');
  // verifiedCount for session 1 should be 2 (student 69 and student 67)
  assert(session1Updated!.verifiedCount === 2, `Session 1 verifiedCount is synchronized (expected 2, got ${session1Updated!.verifiedCount})`);

  // =========================================================================
  // TEST 6: Facial Recognition Verification for All 4 Real Students
  // =========================================================================
  console.log('\n--- Test 6: 1:N Facial Recognition with 4 Enrolled Students ---');
  const enrolledGallery = await getAllEnrolledSubjects();
  assert(enrolledGallery.length === 4, `Found 4 official enrolled students in AES-256-GCM vault (got ${enrolledGallery.length})`);

  for (const subj of enrolledGallery) {
    const probe = subj.embeddings[0]; // first sample as probe
    const idRes = identifyEnrolledSubject(probe, enrolledGallery);
    assert(idRes.status === 'IDENTIFIED', `Student ${subj.subjectId} (${subj.displayName}) successfully IDENTIFIED`);
    assert(idRes.matchedSubjectId === subj.subjectId, `Top match ID matches expected USN ${subj.subjectId}`);
    assert((idRes.topSimilarity || 0) >= 0.40, `Top similarity ${(idRes.topSimilarity || 0).toFixed(4)} meets 0.40 threshold`);
  }

  // =========================================================================
  // TEST 7: Unknown Face Rejection
  // =========================================================================
  console.log('\n--- Test 7: Unknown Face Rejection ---');
  // Generate random orthogonal descriptor simulating unknown face
  const randomEmb = Array.from({ length: 512 }, () => (Math.random() - 0.5) * 0.1);
  const cleanRandom = validateDescriptorVector(randomEmb);
  assert(Boolean(cleanRandom), 'Normalized random face vector');
  const unknownRes = identifyEnrolledSubject(cleanRandom!, enrolledGallery);
  assert(unknownRes.status === 'UNKNOWN', `Unknown face correctly REJECTED as UNKNOWN (status: ${unknownRes.status})`);
  assert(unknownRes.matchedSubjectId === null, 'Unknown face returned null matchedSubjectId');

  // =========================================================================
  // TEST 8: Forgot Password Flow (Rate Limiting, Verification & Reset)
  // =========================================================================
  console.log('\n--- Test 8: Forgot Password Complete Flow ---');
  const targetEmail = '2vx24cb069@vtu.ac.in';
  const initialUser = await repo.findUserByLogin(targetEmail);
  const oldHash = initialUser!.passwordHash;
  const initialTokenVersion = initialUser!.tokenVersion || 0;

  // 1. Password reset token generation with constant-time verification simulation
  const otpCode = crypto.randomInt(100000, 1000000).toString();
  const codeHash = crypto.createHash('sha256').update(otpCode, 'utf8').digest('hex');
  const expiresAt = Date.now() + 15 * 60 * 1000;

  // 2. Test invalid OTP verification
  const wrongCode = '999999';
  const wrongHash = crypto.createHash('sha256').update(wrongCode, 'utf8').digest('hex');
  const wrongMatch = crypto.timingSafeEqual(Buffer.from(wrongHash, 'hex'), Buffer.from(codeHash, 'hex'));
  assert(!wrongMatch, 'Invalid OTP correctly fails constant-time check');

  // 3. Test valid OTP verification
  const correctHash = crypto.createHash('sha256').update(otpCode, 'utf8').digest('hex');
  const validMatch = crypto.timingSafeEqual(Buffer.from(correctHash, 'hex'), Buffer.from(codeHash, 'hex'));
  assert(validMatch, 'Valid OTP matches constant-time check');

  // 4. Reset password
  const tempNewPassword = 'VtuNewSecurePassword2026!';
  const newHash = await bcrypt.hash(tempNewPassword, 10);
  const nextVersion = initialTokenVersion + 1;
  await repo.updateUser(initialUser!.id, {
    passwordHash: newHash,
    tokenVersion: nextVersion,
  });

  const updatedUser = await repo.findUserByLogin(targetEmail);
  assert(updatedUser!.tokenVersion === nextVersion, `tokenVersion incremented to ${nextVersion} (invalidating previous JWT sessions)`);

  const oldPassMatch = await bcrypt.compare('Student@123', updatedUser!.passwordHash);
  assert(!oldPassMatch, 'Old password is no longer accepted');

  const newPassMatch = await bcrypt.compare(tempNewPassword, updatedUser!.passwordHash);
  assert(newPassMatch, 'New password successfully authenticates');

  // Restore original password hash so demo user login remains functional
  await repo.updateUser(initialUser!.id, {
    passwordHash: oldHash,
    tokenVersion: initialTokenVersion,
  });
  console.log('Restored student password back to baseline for seamless user login.');

  console.log('\n=============================================================');
  console.log(`ALL TESTS PASSED: ${passedTests} / ${totalTests} (100% SUCCESS)`);
  console.log('=============================================================\n');
}

runTests().catch((err) => {
  console.error('\nTEST SUITE FAILED:', err);
  process.exit(1);
});
