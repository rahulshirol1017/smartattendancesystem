import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { DataRepository } from '../server/store.ts';
import { UserProfile } from '../src/shared/types.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const LOCAL_DB_PATH = path.resolve(rootDir, '.local_db', 'vtu_attendance_store.json');
const PRIVATE_UPLOAD_DIR = path.resolve(rootDir, '.private_uploads');

async function runCentralizedAttendanceTests() {
  console.log('================================================================');
  console.log(' VTU SMART ATTENDANCE - CENTRALIZED ATTENDANCE VERIFICATION TEST ');
  console.log('================================================================\n');

  const repo = new DataRepository(LOCAL_DB_PATH, PRIVATE_UPLOAD_DIR);
  await repo.initialize();

  // 1. Identify Section CSBS B and Faculty
  const allUsers = await repo.listAllUsers();
  const csbsBStudents = allUsers.filter(
    (u) => u.role === 'student' && u.sectionId === 'sec-csbs-b' && u.accountStatus === 'Active'
  ).sort((a, b) => a.identifier.localeCompare(b.identifier));

  console.log(`[TEST 1] Enrolled Students in CSBS Section B (${csbsBStudents.length}):`);
  for (const s of csbsBStudents) {
    console.log(`  - ${s.identifier} (${s.name}) [ID: ${s.id}]`);
  }
  if (csbsBStudents.length !== 4) {
    throw new Error(`Expected exactly 4 enrolled students in CSBS Section B, found ${csbsBStudents.length}`);
  }
  console.log('✅ PASS: All 4 CSBS B students confirmed.\n');

  const facultyUsers = allUsers.filter((u) => u.role === 'faculty');
  const faculty = facultyUsers[0] as UserProfile;
  console.log(`[TEST 2] Using Faculty Member: ${faculty.name} (${faculty.id})`);

  // 2. Common Class Session Binding with QR Session
  console.log('\n[TEST 3] Creating Dynamic QR Attendance Session for CSBS B:');
  const qrSession = await repo.createQrSession({
    sectionId: 'sec-csbs-b',
    subjectId: 'sub-bcs502',
    faculty,
    durationMinutes: 5,
    classroom: 'VB G19',
  });

  console.log(`  - QR Session ID: ${qrSession.id}`);
  console.log(`  - Bound Common Class ID: ${qrSession.classId}`);
  console.log(`  - Current QR Token (5s): ${qrSession.currentQrToken}`);

  if (!qrSession.classId) {
    throw new Error('FAIL: QR Session did not bind to a common classId!');
  }

  const boundClass = await repo.getClassById(qrSession.classId);
  if (!boundClass) {
    throw new Error(`FAIL: ClassSession with ID ${qrSession.classId} not found!`);
  }
  console.log(`  - Confirmed ClassSession: ${boundClass.topic} (${boundClass.sectionDisplayName})`);
  console.log('✅ PASS: Common Class Session bound correctly.\n');

  // 3. Student 1 QR Scan with Facial Verification (Rahul Shirol 2VX24CB069)
  const rahul = csbsBStudents.find((s) => s.identifier === '2VX24CB069');
  if (!rahul) throw new Error('Rahul Shirol (2VX24CB069) not found in roster!');

  console.log(`[TEST 4] Simulating QR Scan for Student 1: ${rahul.name} (${rahul.identifier})`);
  const rahulAttempt = await repo.submitQrAttendanceAttempt({
    sessionId: qrSession.id,
    qrToken: qrSession.currentQrToken,
    student: rahul,
    latitude: 15.77671,
    longitude: 74.4664,
    accuracy: 10,
    deviceFingerprint: 'fp-rahul-iphone-14',
    devicePlatform: 'iOS',
    browserName: 'Safari Mobile',
  });

  console.log(`  - Classification: ${rahulAttempt.classification}`);
  console.log(`  - Success: ${rahulAttempt.success}`);
  console.log(`  - Message: ${rahulAttempt.message}`);
  console.log(`  - Created Record ID: ${rahulAttempt.record?.id}`);
  console.log(`  - Record Source: ${rahulAttempt.record?.recordSource}`);
  console.log(`  - Status: ${rahulAttempt.record?.status}`);

  if (rahulAttempt.classification !== 'VERIFIED' || rahulAttempt.record?.status !== 'Present') {
    throw new Error('FAIL: Rahul Shirol was not verified as Present!');
  }
  if (rahulAttempt.record.recordSource !== 'QR Geoverified') {
    throw new Error(`FAIL: Expected recordSource 'QR Geoverified', got '${rahulAttempt.record.recordSource}'`);
  }
  if (rahulAttempt.record.classId !== qrSession.classId) {
    throw new Error(`FAIL: Record classId ${rahulAttempt.record.classId} does not match QR session classId ${qrSession.classId}`);
  }
  console.log('✅ PASS: QR Scan verified and saved in attendancerecords with QR Geoverified badge.\n');

  // 4. Teacher Manual Roll-Call for Student 2 (Puttraj Galagi 2VX24CB067)
  const puttraj = csbsBStudents.find((s) => s.identifier === '2VX24CB067');
  if (!puttraj) throw new Error('Puttraj Galagi (2VX24CB067) not found in roster!');

  console.log(`[TEST 5] Teacher Manually Marks Student 2 as ABSENT: ${puttraj.name} (${puttraj.identifier})`);
  const puttrajManual = await repo.createOrUpdateAttendanceRecord({
    classId: qrSession.classId,
    studentId: puttraj.id,
    status: 'Absent',
    recordSource: 'Faculty Register',
    actor: {
      id: faculty.id,
      name: faculty.name,
      role: 'faculty',
    },
    reason: 'Student not physically in lecture hall during roll-call.',
  });

  console.log(`  - Action Taken: ${puttrajManual.actionTaken}`);
  console.log(`  - Status: ${puttrajManual.record.status}`);
  console.log(`  - Record Source: ${puttrajManual.record.recordSource}`);
  console.log(`  - Recorded By: ${puttrajManual.record.recordedByName}`);

  if (puttrajManual.record.status !== 'Absent' || puttrajManual.record.recordSource !== 'Faculty Register') {
    throw new Error('FAIL: Puttraj Galagi manual Absent mark failed!');
  }
  console.log('✅ PASS: Manual Absent status officially recorded in attendancerecords.\n');

  // 5. Conflict & Override Policy: Puttraj tries to scan QR after teacher marked Absent
  console.log(`[TEST 6] Testing Conflict Policy: ${puttraj.name} attempts QR scan after Teacher marked Absent:`);
  const puttrajQrAttempt = await repo.submitQrAttendanceAttempt({
    sessionId: qrSession.id,
    qrToken: qrSession.currentQrToken,
    student: puttraj,
    latitude: 15.77671,
    longitude: 74.4664,
    accuracy: 10,
    deviceFingerprint: 'fp-puttraj-android',
    devicePlatform: 'Android',
    browserName: 'Chrome Mobile',
  });

  console.log(`  - Classification: ${puttrajQrAttempt.classification}`);
  console.log(`  - Rejection / Review Reason: ${puttrajQrAttempt.attempt.rejectionOrReviewReason}`);
  console.log(`  - Suspicious Signals: ${puttrajQrAttempt.attempt.suspiciousSignals?.join(', ')}`);

  if (puttrajQrAttempt.classification !== 'REVIEW_REQUIRED') {
    throw new Error(`FAIL: Expected REVIEW_REQUIRED conflict, but got ${puttrajQrAttempt.classification}`);
  }

  // Verify that Puttraj's record in attendancerecords was NOT overwritten
  const puttrajCurrentRecord = (await repo.getRecordsForClass(qrSession.classId)).find((r) => r.studentId === puttraj.id);
  console.log(`  - Current Official Status in attendancerecords: ${puttrajCurrentRecord?.status}`);
  if (puttrajCurrentRecord?.status !== 'Absent') {
    throw new Error('FAIL: Student official status was silently overwritten by QR attempt!');
  }
  console.log('✅ PASS: Conflict detected! Teacher manual Absent status protected from silent overwrite.\n');

  // 6. Check Centralized Roster BEFORE finalization
  console.log('[TEST 7] Inspecting Centralized Attendance Register Before Finalization:');
  const rosterBefore = await repo.getClassAttendanceRoster(qrSession.classId);
  console.log(`  - Total Enrolled: ${rosterBefore.summary.totalEnrolled}`);
  console.log(`  - Present Count: ${rosterBefore.summary.presentCount}`);
  console.log(`  - Absent Count: ${rosterBefore.summary.absentCount}`);
  console.log(`  - Excused Count: ${rosterBefore.summary.excusedCount}`);
  console.log(`  - Pending Count: ${rosterBefore.summary.pendingCount}`);
  console.log(`  - Completion %: ${rosterBefore.summary.completionPercentage}%`);

  if (rosterBefore.summary.presentCount !== 1 || rosterBefore.summary.absentCount !== 1 || rosterBefore.summary.pendingCount !== 2) {
    throw new Error(`FAIL: Unexpected summary before finalization: ${JSON.stringify(rosterBefore.summary)}`);
  }
  console.log('✅ PASS: Summary before finalization matches expected counts (1 Present, 1 Absent, 2 Pending).\n');

  // 7. Teacher Finalizes Class Attendance
  console.log('[TEST 8] Finalizing Class Attendance (Marking remaining Pending students as Absent):');
  const finalizeRes = await repo.finalizeClassAttendance({
    classId: qrSession.classId,
    actor: {
      id: faculty.id,
      name: faculty.name,
      role: 'faculty',
    },
    reason: 'End of lecture: all unrecorded students marked Absent.',
  });

  console.log(`  - Finalized Count (Unrecorded -> Absent): ${finalizeRes.finalizedCount}`);
  console.log(`  - ClassSession Status: ${finalizeRes.classSession.status}`);
  console.log(`  - ClassSession Attendance Submitted: ${finalizeRes.classSession.attendanceSubmitted}`);

  if (finalizeRes.finalizedCount !== 2) {
    throw new Error(`FAIL: Expected 2 pending students to be finalized, got ${finalizeRes.finalizedCount}`);
  }
  if (!finalizeRes.classSession.attendanceSubmitted) {
    throw new Error('FAIL: ClassSession attendanceSubmitted flag not set to true!');
  }

  // Verify linked QR session is closed
  const updatedQrSession = await repo.getQrSessionById(qrSession.id);
  console.log(`  - Linked QR Session Status: ${updatedQrSession?.status}`);
  if (updatedQrSession?.status !== 'CLOSED') {
    throw new Error(`FAIL: Linked QR Session should be CLOSED, got ${updatedQrSession?.status}`);
  }
  console.log('✅ PASS: Class finalized and active QR session closed.\n');

  // 8. Centralized Roster & Summary AFTER Finalization
  console.log('[TEST 9] Final Centralized Attendance Register Roster:');
  const rosterAfter = await repo.getClassAttendanceRoster(qrSession.classId);
  console.log('---------------------------------------------------------------------------------------------------------');
  console.log('| USN        | Name            | Status  | Record Source    | Verification Method | Timestamp            |');
  console.log('---------------------------------------------------------------------------------------------------------');
  for (const item of rosterAfter.roster) {
    const timeStr = item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : 'N/A';
    console.log(
      `| ${item.studentIdentifier.padEnd(10)} | ${item.studentName.padEnd(15)} | ${item.status.padEnd(7)} | ${(item.recordSource || 'None').padEnd(16)} | ${item.verificationMethod.padEnd(19)} | ${timeStr.padEnd(20)} |`
    );
  }
  console.log('---------------------------------------------------------------------------------------------------------');

  console.log(`\nFinal Summary:`);
  console.log(`  - Total Enrolled: ${rosterAfter.summary.totalEnrolled}`);
  console.log(`  - Present Count: ${rosterAfter.summary.presentCount}`);
  console.log(`  - Absent Count: ${rosterAfter.summary.absentCount}`);
  console.log(`  - Excused Count: ${rosterAfter.summary.excusedCount}`);
  console.log(`  - Pending Count: ${rosterAfter.summary.pendingCount}`);
  console.log(`  - Completion Rate: ${rosterAfter.summary.completionPercentage}%`);

  if (rosterAfter.summary.totalEnrolled !== 4 || rosterAfter.summary.presentCount !== 1 || rosterAfter.summary.absentCount !== 3 || rosterAfter.summary.pendingCount !== 0 || rosterAfter.summary.completionPercentage !== 100) {
    throw new Error(`FAIL: Final summary did not reach 100% completion: ${JSON.stringify(rosterAfter.summary)}`);
  }

  console.log('\n================================================================');
  console.log(' 🎉 ALL 9 CENTRALIZED ATTENDANCE SYSTEM TESTS PASSED SUCCESSFULLY! ');
  console.log('================================================================');
}

runCentralizedAttendanceTests().catch((err) => {
  console.error('\n❌ CENTRALIZED ATTENDANCE TEST FAILED:', err);
  process.exit(1);
});
