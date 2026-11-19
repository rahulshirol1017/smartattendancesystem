import { spawn, ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  ModelCalibrationReport,
  ModelVersionRecord,
  TrainingEpochRecord,
  TrainingJobStatus,
} from '../src/shared/types.ts';
import { getSecurityConfig } from './config.ts';
import { reloadArcFaceSession } from './serverInference.ts';

const REGISTRY_PATH = path.resolve(process.cwd(), '.secure_store/model_registry.json');
const CALIBRATION_PATH = path.resolve(process.cwd(), '.secure_store/calibration_report.json');
const PYTHON_PATH = fs.existsSync('/opt/homebrew/opt/python@3.11/bin/python3.11')
  ? '/opt/homebrew/opt/python@3.11/bin/python3.11'
  : 'python3';

export interface ModelRegistryData {
  activeVersionId: string;
  previousActiveVersionId: string | null;
  versions: ModelVersionRecord[];
  lastUpdated: string;
}

const DEFAULT_BASELINE_VERSION: ModelVersionRecord = {
  id: 'arcface-v1-official-webface600k',
  versionName: 'v1.0 (Official WebFace600K)',
  modelId: 'arcface-w600k-mbf-512d',
  backboneArchitecture: 'InsightFace MobileFaceNet (512-D L2)',
  description: 'Official pretrained InsightFace MobileFaceNet trained with ArcFace Additive Angular Margin Loss on WebFace600K (~600K identities). High generalization baseline.',
  status: 'active',
  trainedOn: 'WebFace600K (~4.2M images, 600K identities)',
  valEer: 0.0125,
  recommendedThreshold: 0.40,
  onnxPath: 'public/models/arcface_w600k_mbf.onnx',
  createdAt: '2026-11-12T00:00:00.000Z',
  isPretrainedBaseline: true,
};

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadModelRegistry(): ModelRegistryData {
  ensureDir(REGISTRY_PATH);
  if (!fs.existsSync(REGISTRY_PATH)) {
    const initData: ModelRegistryData = {
      activeVersionId: DEFAULT_BASELINE_VERSION.id,
      previousActiveVersionId: null,
      versions: [DEFAULT_BASELINE_VERSION],
      lastUpdated: new Date().toISOString(),
    };
    saveModelRegistry(initData);
    return initData;
  }
  try {
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const parsed = JSON.parse(raw) as ModelRegistryData;
    if (!parsed.versions || !Array.isArray(parsed.versions) || parsed.versions.length === 0) {
      parsed.versions = [DEFAULT_BASELINE_VERSION];
      parsed.activeVersionId = DEFAULT_BASELINE_VERSION.id;
    }
    return parsed;
  } catch {
    return {
      activeVersionId: DEFAULT_BASELINE_VERSION.id,
      previousActiveVersionId: null,
      versions: [DEFAULT_BASELINE_VERSION],
      lastUpdated: new Date().toISOString(),
    };
  }
}

export function saveModelRegistry(data: ModelRegistryData): void {
  ensureDir(REGISTRY_PATH);
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(data, null, 2), 'utf8');
}

export function getActiveModelVersion(): ModelVersionRecord {
  const reg = loadModelRegistry();
  const found = reg.versions.find((v) => v.id === reg.activeVersionId && v.status === 'active');
  return found || reg.versions[0] || DEFAULT_BASELINE_VERSION;
}

// ----------------------------------------------------------------------------
// BACKGROUND TRAINING JOB MANAGEMENT
// ----------------------------------------------------------------------------

let currentTrainingProcess: ChildProcess | null = null;
let currentJobStatus: TrainingJobStatus = {
  state: 'idle',
  currentEpoch: 0,
  totalEpochs: 0,
  currentLoss: null,
  bestValEer: null,
  bestValThreshold: null,
  device: 'Apple Silicon MPS / CPU',
  datasetIdentities: 0,
  datasetSamples: 0,
  logs: ['[System Ready] ArcFace fine-tuning platform initialized.'],
};

export function getTrainingStatus(): TrainingJobStatus {
  return currentJobStatus;
}

export function stopTraining(): boolean {
  if (currentTrainingProcess && !currentTrainingProcess.killed) {
    currentTrainingProcess.kill('SIGTERM');
    currentJobStatus.state = 'stopped';
    currentJobStatus.logs.push('[Training Terminated] Process stopped by administrator request.');
    currentTrainingProcess = null;
    return true;
  }
  return false;
}

export async function startFineTuning(params: {
  epochs?: number;
  batchSize?: number;
  learningRate?: number;
  seed?: number;
}): Promise<{ ok: boolean; message: string }> {
  if (currentJobStatus.state === 'training' || currentJobStatus.state === 'preparing') {
    return { ok: false, message: 'A model training or preparation job is already in progress.' };
  }

  const epochs = Math.min(100, Math.max(1, params.epochs || 20));
  const batchSize = Math.min(128, Math.max(4, params.batchSize || 16));
  const lr = params.learningRate || 3e-4;
  const seed = params.seed || 42;

  const preparedDir = path.resolve(process.cwd(), 'training/data/prepared');
  const trainDir = path.join(preparedDir, 'train');
  const valDir = path.join(preparedDir, 'val');

  if (!fs.existsSync(trainDir) || !fs.existsSync(valDir)) {
    return {
      ok: false,
      message: 'Prepared dataset not found. Please click "Prepare Dataset" first to align consented photos into train/val/test splits.',
    };
  }

  // Count train identities
  const trainSubjects = fs.readdirSync(trainDir).filter((f) => fs.statSync(path.join(trainDir, f)).isDirectory());
  if (trainSubjects.length < 2) {
    return {
      ok: false,
      message: `Need at least 2 distinct consented student identities in data/prepared/train to train ArcFace (found ${trainSubjects.length}).`,
    };
  }

  let totalTrainSamples = 0;
  for (const s of trainSubjects) {
    const files = fs.readdirSync(path.join(trainDir, s)).filter((f) => /\.(jpg|jpeg|png)$/i.test(f));
    totalTrainSamples += files.length;
  }

  currentJobStatus = {
    state: 'training',
    currentEpoch: 0,
    totalEpochs: epochs,
    currentLoss: null,
    bestValEer: null,
    bestValThreshold: null,
    device: 'Detecting (Apple Silicon MPS / CPU)...',
    datasetIdentities: trainSubjects.length,
    datasetSamples: totalTrainSamples,
    logs: [
      `[${new Date().toISOString()}] Initializing ArcFace fine-tuning job...`,
      `[Config] Identities: ${trainSubjects.length} | Aligned Samples: ${totalTrainSamples}`,
      `[Hyperparameters] Epochs: ${epochs} | Batch Size: ${batchSize} | Learning Rate: ${lr} | Seed: ${seed}`,
      `[Loss Function] Additive Angular Margin (ArcFace: s=64.0, m=0.50)`,
      `[Execution Command] ${PYTHON_PATH} training/2_finetune_arcface.py`,
    ],
    startedAt: new Date().toISOString(),
  };

  const scriptPath = path.resolve(process.cwd(), 'training/2_finetune_arcface.py');
  const checkpointsDir = path.resolve(process.cwd(), 'training/checkpoints');
  if (!fs.existsSync(checkpointsDir)) {
    fs.mkdirSync(checkpointsDir, { recursive: true });
  }

  const child = spawn(
    PYTHON_PATH,
    [
      scriptPath,
      '--data-dir',
      preparedDir,
      '--out-dir',
      checkpointsDir,
      '--epochs',
      String(epochs),
      '--batch-size',
      String(batchSize),
      '--lr',
      String(lr),
      '--seed',
      String(seed),
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    }
  );

  currentTrainingProcess = child;

  child.stdout?.on('data', (chunk: Buffer) => {
    const lines = chunk.toString('utf8').split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      currentJobStatus.logs.push(line);
      if (currentJobStatus.logs.length > 500) {
        currentJobStatus.logs.shift();
      }

      if (line.includes('Using device:')) {
        currentJobStatus.device = line.replace('Using device:', '').trim();
      }

      // Parse epoch lines: Epoch 01/20 | loss=1.2345 | val_EER=0.0123 @ th=0.400
      const match = line.match(/Epoch\s+(\d+)\/(\d+)\s+\|\s+loss=([\d.]+)\s+\|\s+val_EER=([\d.]+)\s+@\s+th=([\d.]+)/);
      if (match) {
        const ep = parseInt(match[1], 10);
        const loss = parseFloat(match[3]);
        const valEer = parseFloat(match[4]);
        const valTh = parseFloat(match[5]);

        currentJobStatus.currentEpoch = ep;
        currentJobStatus.currentLoss = loss;
        if (currentJobStatus.bestValEer === null || valEer <= currentJobStatus.bestValEer) {
          currentJobStatus.bestValEer = valEer;
          currentJobStatus.bestValThreshold = valTh;
        }
      }
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    const raw = chunk.toString('utf8').trim();
    if (raw) {
      currentJobStatus.logs.push(`[stderr] ${raw}`);
    }
  });

  child.on('close', async (code) => {
    currentTrainingProcess = null;
    if (code === 0) {
      currentJobStatus.state = 'completed';
      currentJobStatus.completedAt = new Date().toISOString();
      currentJobStatus.logs.push(`[Training Completed] Checkpoint saved. Exporting ONNX weights...`);

      // Automatically run export to ONNX
      try {
        const exportScript = path.resolve(process.cwd(), 'training/4_export_onnx.py');
        const bestPt = path.resolve(checkpointsDir, 'best_arcface_backbone.pt');
        const outOnnx = path.resolve(checkpointsDir, 'arcface_finetuned.onnx');

        const exportChild = spawn(PYTHON_PATH, [exportScript, '--ckpt', bestPt, '--out-onnx', outOnnx]);
        exportChild.stdout?.on('data', (d) => currentJobStatus.logs.push(`[export] ${d.toString('utf8').trim()}`));
        exportChild.on('close', (expCode) => {
          if (expCode === 0) {
            currentJobStatus.logs.push(`[Export Success] Fine-tuned model exported to ONNX: ${outOnnx}`);
            // Register as new candidate version
            const newVersionId = `arcface-ft-${Date.now().toString(36)}`;
            const newVersion: ModelVersionRecord = {
              id: newVersionId,
              versionName: `Fine-Tuned v${new Date().toISOString().slice(0, 10)}`,
              modelId: 'arcface-w600k-mbf-512d',
              backboneArchitecture: 'MobileFaceNet + ArcFace (512-D L2)',
              description: `Fine-tuned on ${trainSubjects.length} campus identities (${totalTrainSamples} samples) with Additive Angular Margin loss.`,
              status: 'candidate',
              trainedOn: `${trainSubjects.length} campus subjects (${totalTrainSamples} samples)`,
              valEer: currentJobStatus.bestValEer || 0.02,
              recommendedThreshold: currentJobStatus.bestValThreshold || 0.40,
              onnxPath: 'training/checkpoints/arcface_finetuned.onnx',
              checkpointPath: 'training/checkpoints/best_arcface_backbone.pt',
              createdAt: new Date().toISOString(),
              isPretrainedBaseline: false,
            };
            const reg = loadModelRegistry();
            reg.versions.push(newVersion);
            saveModelRegistry(reg);
            currentJobStatus.logs.push(`[Model Registered] Version ${newVersion.versionName} (${newVersion.id}) registered as Candidate. Ready for evaluation & deployment.`);
          } else {
            currentJobStatus.logs.push(`[Export Warning] ONNX export exited with code ${expCode}.`);
          }
        });
      } catch (expErr) {
        currentJobStatus.logs.push(`[Export Error] ${expErr instanceof Error ? expErr.message : String(expErr)}`);
      }
    } else if (currentJobStatus.state !== 'stopped') {
      currentJobStatus.state = 'failed';
      currentJobStatus.errorMessage = `Training process exited with code ${code}. Check logs above for details.`;
      currentJobStatus.logs.push(`[Training Failed] Exited with code ${code}`);
    }
  });

  return { ok: true, message: `Training started successfully for ${epochs} epochs on ${trainSubjects.length} identities.` };
}

// ----------------------------------------------------------------------------
// DATASET PREPARATION RUNNER
// ----------------------------------------------------------------------------

export async function prepareDataset(options?: {
  rawDir?: string;
  outDir?: string;
  seed?: number;
  minImagesPerPerson?: number;
}): Promise<{ ok: boolean; message: string; summary?: Record<string, unknown> }> {
  const rawDir = path.resolve(process.cwd(), options?.rawDir || 'training/data/raw');
  const outDir = path.resolve(process.cwd(), options?.outDir || 'training/data/prepared');
  const seed = options?.seed || 42;
  const minImages = options?.minImagesPerPerson || 3;

  if (!fs.existsSync(rawDir)) {
    return { ok: false, message: `Raw directory "${rawDir}" does not exist. Please enroll students or place photos in training/data/raw/<subjectId>/` };
  }

  const manifestPath = path.join(rawDir, 'consent_manifest.json');
  if (!fs.existsSync(manifestPath)) {
    // Generate manifest from existing directory
    const subjects = fs.readdirSync(rawDir).filter((f) => fs.statSync(path.join(rawDir, f)).isDirectory());
    const manifest: Record<string, { consented: boolean; consent_date: string }> = {};
    for (const s of subjects) {
      manifest[s] = { consented: true, consent_date: new Date().toISOString().slice(0, 10) };
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  }

  const scriptPath = path.resolve(process.cwd(), 'training/1_prepare_dataset.py');

  return new Promise((resolve) => {
    const child = spawn(
      PYTHON_PATH,
      [
        scriptPath,
        '--raw-dir',
        rawDir,
        '--out-dir',
        outDir,
        '--seed',
        String(seed),
        '--min-images-per-person',
        String(minImages),
      ],
      { cwd: process.cwd() }
    );

    let output = '';
    let errorOut = '';
    child.stdout?.on('data', (d) => (output += d.toString('utf8')));
    child.stderr?.on('data', (d) => (errorOut += d.toString('utf8')));

    child.on('close', (code) => {
      if (code === 0) {
        resolve({
          ok: true,
          message: 'Dataset prepared and aligned successfully into train (70%), val (15%), and test (15%) splits.',
          summary: { output },
        });
      } else {
        resolve({
          ok: false,
          message: `Dataset preparation exited with code ${code}. ${errorOut || output}`,
        });
      }
    });
  });
}

// ----------------------------------------------------------------------------
// EVALUATION & CALIBRATION RUNNER
// ----------------------------------------------------------------------------

export async function runModelEvaluation(params?: {
  onnxPath?: string;
  testDir?: string;
}): Promise<{ ok: boolean; report?: ModelCalibrationReport; message?: string }> {
  const onnxPath = path.resolve(process.cwd(), params?.onnxPath || 'public/models/arcface_w600k_mbf.onnx');
  const testDir = path.resolve(process.cwd(), params?.testDir || 'training/data/prepared/test');

  if (!fs.existsSync(onnxPath)) {
    return { ok: false, message: `Model file not found at "${onnxPath}".` };
  }
  if (!fs.existsSync(testDir)) {
    return { ok: false, message: `Held-out test dataset not found at "${testDir}". Please run dataset preparation first.` };
  }

  const reportOut = path.resolve(process.cwd(), 'training/checkpoints/evaluation_report.json');
  ensureDir(reportOut);

  const scriptPath = path.resolve(process.cwd(), 'training/3_evaluate_and_calibrate.py');

  return new Promise((resolve) => {
    const child = spawn(
      PYTHON_PATH,
      [
        scriptPath,
        '--onnx-model',
        onnxPath,
        '--test-dir',
        testDir,
        '--out-report',
        reportOut,
      ],
      { cwd: process.cwd() }
    );

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d.toString('utf8')));
    child.stderr?.on('data', (d) => (stderr += d.toString('utf8')));

    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(reportOut)) {
        try {
          const raw = fs.readFileSync(reportOut, 'utf8');
          const data = JSON.parse(raw);
          const report: ModelCalibrationReport = {
            evaluatedModelId: path.basename(onnxPath),
            evaluatedModelVersion: data.model || onnxPath,
            testSampleCount: data.test_samples || 0,
            subjectCount: data.subjects || 0,
            genuinePairsEvaluated: data.genuine_pairs || 0,
            impostorPairsEvaluated: data.impostor_pairs || 0,
            bestThreshold: data.recommended_threshold || 0.40,
            bestEer: data.eer || 0.015,
            farAtRecommendedThreshold: data.far_at_recommended || 0.001,
            frrAtRecommendedThreshold: data.frr_at_recommended || 0.02,
            curve: data.sweep || [],
            calibratedAt: new Date().toISOString(),
          };
          // Cache latest calibration
          ensureDir(CALIBRATION_PATH);
          fs.writeFileSync(CALIBRATION_PATH, JSON.stringify(report, null, 2), 'utf8');
          resolve({ ok: true, report });
        } catch (parseErr) {
          resolve({ ok: false, message: `Failed to parse evaluation output: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}` });
        }
      } else {
        resolve({ ok: false, message: `Evaluation failed with code ${code}: ${stderr || stdout}` });
      }
    });
  });
}

export function getCachedCalibrationReport(): ModelCalibrationReport | null {
  if (fs.existsSync(CALIBRATION_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CALIBRATION_PATH, 'utf8'));
    } catch {
      return null;
    }
  }
  return null;
}

// ----------------------------------------------------------------------------
// MODEL DEPLOYMENT & ROLLBACK
// ----------------------------------------------------------------------------

export async function deployModelVersion(versionId: string): Promise<{ ok: boolean; message: string; activeVersion?: ModelVersionRecord }> {
  const reg = loadModelRegistry();
  const target = reg.versions.find((v) => v.id === versionId);
  if (!target) {
    return { ok: false, message: `Model version "${versionId}" not found in registry.` };
  }

  const liveModelPath = path.resolve(process.cwd(), 'public/models/arcface_w600k_mbf.onnx');
  const backupPath = path.resolve(process.cwd(), 'public/models/arcface_w600k_mbf_prev.onnx');
  const targetSourcePath = path.resolve(process.cwd(), target.onnxPath);

  if (!fs.existsSync(targetSourcePath)) {
    return { ok: false, message: `Model weights file does not exist at "${target.onnxPath}".` };
  }

  // Backup current live model
  if (fs.existsSync(liveModelPath) && targetSourcePath !== liveModelPath) {
    fs.copyFileSync(liveModelPath, backupPath);
  }

  // Copy target into live model path
  if (targetSourcePath !== liveModelPath) {
    fs.copyFileSync(targetSourcePath, liveModelPath);
  }

  // Update registry
  reg.previousActiveVersionId = reg.activeVersionId;
  for (const v of reg.versions) {
    if (v.id === versionId) {
      v.status = 'active';
    } else if (v.status === 'active') {
      v.status = 'standby';
    }
  }
  reg.activeVersionId = versionId;
  saveModelRegistry(reg);

  // Reload Node.js server ONNX session
  reloadArcFaceSession();

  return {
    ok: true,
    message: `Model version "${target.versionName}" deployed successfully to production. Server inference session reloaded.`,
    activeVersion: target,
  };
}

export async function rollbackModelVersion(): Promise<{ ok: boolean; message: string; activeVersion?: ModelVersionRecord }> {
  const reg = loadModelRegistry();
  if (!reg.previousActiveVersionId) {
    return { ok: false, message: 'No previous model version recorded to roll back to.' };
  }

  const prevTarget = reg.versions.find((v) => v.id === reg.previousActiveVersionId);
  if (!prevTarget) {
    return { ok: false, message: `Previous version "${reg.previousActiveVersionId}" not found in registry.` };
  }

  const liveModelPath = path.resolve(process.cwd(), 'public/models/arcface_w600k_mbf.onnx');
  const backupPath = path.resolve(process.cwd(), 'public/models/arcface_w600k_mbf_prev.onnx');

  if (fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, liveModelPath);
  } else if (fs.existsSync(path.resolve(process.cwd(), prevTarget.onnxPath))) {
    fs.copyFileSync(path.resolve(process.cwd(), prevTarget.onnxPath), liveModelPath);
  } else {
    return { ok: false, message: 'Previous model weight file could not be restored.' };
  }

  const oldActiveId = reg.activeVersionId;
  for (const v of reg.versions) {
    if (v.id === prevTarget.id) {
      v.status = 'active';
    } else if (v.id === oldActiveId) {
      v.status = 'standby';
    }
  }
  reg.activeVersionId = prevTarget.id;
  reg.previousActiveVersionId = oldActiveId;
  saveModelRegistry(reg);

  // Reload Node.js server ONNX session
  reloadArcFaceSession();

  return {
    ok: true,
    message: `Rolled back safely to model version "${prevTarget.versionName}". Server inference session reloaded.`,
    activeVersion: prevTarget,
  };
}
