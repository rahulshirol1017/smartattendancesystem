import crypto from 'crypto';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || '';

async function testCryptoAndTokenLifecycle() {
  console.log('--- Verifying Secure Hashing & Verification Logic ---');

  const plainOtp = crypto.randomInt(100000, 1000000).toString();
  const sha256Hash = crypto.createHash('sha256').update(plainOtp, 'utf8').digest('hex');

  // Verify TimingSafeEqual
  const candidateCorrect = plainOtp;
  const candidateHash = crypto.createHash('sha256').update(candidateCorrect, 'utf8').digest('hex');
  const isCorrectMatch = crypto.timingSafeEqual(
    Buffer.from(candidateHash, 'hex'),
    Buffer.from(sha256Hash, 'hex')
  );
  console.log('Timing-safe match test (correct):', isCorrectMatch ? '✅ MATCHED' : '❌ FAILED');

  const candidateWrong = '999999';
  const candidateWrongHash = crypto.createHash('sha256').update(candidateWrong, 'utf8').digest('hex');
  const isWrongMatch = crypto.timingSafeEqual(
    Buffer.from(candidateWrongHash, 'hex'),
    Buffer.from(sha256Hash, 'hex')
  );
  console.log('Timing-safe match test (wrong):', !isWrongMatch ? '✅ CORRECTLY REJECTED' : '❌ FAILED');

  console.log('\n--- Verifying MongoDB Atlas User Model State ---');
  await mongoose.connect(MONGO_URI);
  const usersColl = mongoose.connection.collection('users');

  const students = await usersColl.find({ role: 'student' }).toArray();
  console.log(`Current active genuine students in Atlas (${students.length}):`);
  for (const stu of students) {
    console.log(`- USN: ${stu.identifier} | Name: ${stu.name} | Email: ${stu.email} | Active: ${stu.accountStatus} | Hash length: ${stu.passwordHash?.length}`);
  }

  const dummyCount = await usersColl.countDocuments({
    role: 'student',
    identifier: { $in: ['2VX24CB001', '2VX24CB002', '2VX24CB047', '2VX24CB068', '2VX24CB116'] }
  });
  console.log(`Dummy students in MongoDB Atlas: ${dummyCount} (Expected: 0)`);
  if (dummyCount === 0) {
    console.log('✅ PASS: Zero dummy students in database.');
  }

  // Check biometric enrollments
  const bioColl = mongoose.connection.collection('biometricenrollments');
  const bios = await bioColl.find().toArray();
  console.log(`\nBiometric profiles in Atlas: ${bios.length} enrolled subjects:`);
  for (const b of bios) {
    console.log(`- Subject ID: ${b.subjectId} | Vectors: ${b.embeddings?.length || 0} (512-D ArcFace)`);
  }

  // Check attendance records count
  const attColl = mongoose.connection.collection('attendancerecords');
  const attCount = await attColl.countDocuments();
  console.log(`\nAttendance records intact in Atlas: ${attCount} historical records.`);

  await mongoose.disconnect();
  console.log('\n✅ Verification of Database & Cryptographic Engine Complete.');
}

testCryptoAndTokenLifecycle().catch(console.error);
