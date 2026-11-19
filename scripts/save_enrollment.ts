import fs from 'fs';
import path from 'path';
import { upsertEnrolledSubject } from '../server/enrollmentStore.ts';
import { EnrolledSubjectRecord } from '../src/shared/types.ts';

async function main() {
  const args = process.argv.slice(2);
  let inputPath = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      inputPath = args[i + 1];
    }
  }

  let raw = '';
  if (inputPath) {
    raw = fs.readFileSync(path.resolve(inputPath), 'utf8');
  } else {
    raw = fs.readFileSync(0, 'utf8');
  }

  const payload = JSON.parse(raw) as {
    subjectId: string;
    displayName: string;
    embeddings: number[][];
    samples?: Array<{ angleLabel: string; lightingLabel: string; qualityScore: number }>;
    consentConfirmed?: boolean;
    mode?: 'append' | 'replace';
  };

  if (!payload.subjectId || !Array.isArray(payload.embeddings) || payload.embeddings.length === 0) {
    throw new Error('Invalid enrollment payload: subjectId and embeddings array are required.');
  }

  const now = new Date().toISOString();
  const sampleLabels = (payload.samples || payload.embeddings.map((_, i) => ({
    angleLabel: i === 0 ? 'Frontal' : 'Angle',
    lightingLabel: 'Normal',
    qualityScore: 90,
  }))).map((s) => ({
    angleLabel: s.angleLabel || 'Frontal',
    lightingLabel: s.lightingLabel || 'Normal',
    qualityScore: s.qualityScore || 90,
  }));

  const stored = upsertEnrolledSubject({
    subjectId: payload.subjectId,
    displayName: payload.displayName || payload.subjectId,
    embeddings: payload.embeddings,
    sampleLabels,
    consentConfirmed: payload.consentConfirmed ?? true,
    mode: payload.mode || 'replace',
  });
  console.log(
    JSON.stringify({
      ok: true,
      subjectId: stored.subjectId,
      sampleCount: stored.samples.length,
      updatedAt: stored.updatedAt,
    })
  );
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
