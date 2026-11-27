import path from 'path';
import http from 'http';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import express from 'express';
import { DataRepository } from '../server/store.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const LOCAL_DB_PATH = path.resolve(rootDir, '.local_db', 'vtu_attendance_store.json');
const PRIVATE_UPLOAD_DIR = path.resolve(rootDir, '.private_uploads');

async function testHttpEndpoints() {
  console.log('Testing Centralized Attendance HTTP Endpoints...');
  const repo = new DataRepository(LOCAL_DB_PATH, PRIVATE_UPLOAD_DIR);
  await repo.initialize();

  // Create an express app for route testing
  const app = express();
  app.use(express.json());

  // Mock authenticated user as faculty
  const mockFaculty = {
    id: 'fac-harish',
    name: 'Mr. Harish Kamble',
    role: 'faculty' as const,
  };

  // Mount test endpoints identically to server.ts
  app.get('/api/attendance/class/:classId', async (req, res) => {
    try {
      const data = await repo.getClassAttendanceRoster(req.params.classId);
      res.json(data);
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  app.post('/api/attendance/update-single', async (req, res) => {
    const { classId, studentId, status, reason } = req.body;
    try {
      const result = await repo.createOrUpdateAttendanceRecord({
        classId,
        studentId,
        status,
        recordSource: 'Faculty Register',
        actor: mockFaculty,
        reason,
      });
      const updated = await repo.getClassAttendanceRoster(classId);
      res.json({
        success: true,
        record: result.record,
        actionTaken: result.actionTaken,
        conflictDetected: result.conflictDetected,
        summary: updated.summary,
        roster: updated.roster,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/attendance/finalize-class', async (req, res) => {
    const { classId, reason } = req.body;
    try {
      const result = await repo.finalizeClassAttendance({
        classId,
        actor: mockFaculty,
        reason,
      });
      const updated = await repo.getClassAttendanceRoster(classId);
      res.json({
        success: true,
        finalizedCount: result.finalizedCount,
        summary: updated.summary,
        roster: updated.roster,
        classSession: result.classSession,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // Create test session
    const qr = await repo.createQrSession({
      sectionId: 'sec-csbs-b',
      subjectId: 'sub-bcs502',
      faculty: mockFaculty as any,
      classroom: 'VB G19',
    });
    const classId = qr.classId!;

    // 1. Test GET /api/attendance/class/:classId
    const getRes = await fetch(`${baseUrl}/api/attendance/class/${classId}`);
    const getData: any = await getRes.json();
    if (getRes.status !== 200 || !getData.roster || getData.roster.length !== 4) {
      throw new Error(`GET failed: status ${getRes.status}, data: ${JSON.stringify(getData)}`);
    }
    console.log('✅ GET /api/attendance/class/:classId succeeded with 4 students.');

    // 2. Test POST /api/attendance/update-single
    const updateRes = await fetch(`${baseUrl}/api/attendance/update-single`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        classId,
        studentId: 'stu-csbsb-069',
        status: 'Present',
      }),
    });
    const updateData: any = await updateRes.json();
    if (updateRes.status !== 200 || !updateData.success || updateData.summary.presentCount !== 1) {
      throw new Error(`POST update-single failed: ${JSON.stringify(updateData)}`);
    }
    console.log('✅ POST /api/attendance/update-single marked student Present.');

    // 3. Test POST /api/attendance/finalize-class
    const finalizeRes = await fetch(`${baseUrl}/api/attendance/finalize-class`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ classId }),
    });
    const finalizeData: any = await finalizeRes.json();
    if (finalizeRes.status !== 200 || finalizeData.summary.completionPercentage !== 100) {
      throw new Error(`POST finalize-class failed: ${JSON.stringify(finalizeData)}`);
    }
    console.log('✅ POST /api/attendance/finalize-class finalized class with 100% completion.');

    console.log('🎉 ALL HTTP ENDPOINTS FUNCTIONING PERFECTLY!');
  } finally {
    server.close();
  }
}

testHttpEndpoints().catch((err) => {
  console.error('HTTP Test failed:', err);
  process.exit(1);
});
