#!/usr/bin/env python3
"""
Step 3: Evaluate FAR, FRR, TAR, and EER on Real Unseen Test Data Using ONNX Runtime

Works directly on:
- The shipped pretrained model (../public/models/arcface_w600k_mbf.onnx), OR
- Your own fine-tuned exported model (checkpoints/arcface_finetuned.onnx).

Outputs real pairwise metrics (no synthetic/simulated data) and recommends
ARCFACE_COSINE_THRESHOLD for .env.
"""

import sys
import os

try:
    import onnxruntime as ort
    from PIL import Image
    import numpy as np
except ImportError:
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    venv_py = os.path.join(base_dir, ".venv", "bin", "python3")
    py311 = "/opt/homebrew/opt/python@3.11/bin/python3.11"
    if os.path.exists(venv_py) and sys.executable != venv_py:
        os.execv(venv_py, [venv_py] + sys.argv)
    elif os.path.exists(py311) and sys.executable != py311:
        os.execv(py311, [py311] + sys.argv)
    else:
        print("[ERROR] Required packages (onnxruntime, PIL, numpy) not found.")
        sys.exit(1)

import argparse
import json
from pathlib import Path
from typing import List, Tuple


def load_aligned_112_tensor(img_path: Path) -> np.ndarray:
    img = Image.open(img_path).convert("RGB").resize((112, 112), Image.Resampling.BILINEAR)
    arr = np.asarray(img, dtype=np.float32)
    arr = (arr - 127.5) / 127.5
    return np.transpose(arr, (2, 0, 1))[None, ...]  # [1, 3, 112, 112]


def l2_normalize(vec: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vec))
    return vec / max(norm, 1e-8)


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate ONNX ArcFace model on real held-out test set.")
    candidates = [
        Path("public/models/arcface_w600k_mbf.onnx"),
        Path("../public/models/arcface_w600k_mbf.onnx"),
        Path(__file__).parent.parent / "public/models/arcface_w600k_mbf.onnx",
    ]
    default_model = next((p for p in candidates if p.exists()), Path("public/models/arcface_w600k_mbf.onnx"))
    default_test = Path("training/data/prepared/test") if Path("training/data/prepared/test").exists() else Path("data/prepared/test")
    default_report = Path("training/checkpoints/evaluation_report.json") if Path("training").exists() else Path("checkpoints/evaluation_report.json")
    parser.add_argument("--onnx-model", type=Path, default=default_model)
    parser.add_argument("--test-dir", type=Path, default=default_test)
    parser.add_argument("--out-report", type=Path, default=default_report)
    args = parser.parse_args()

    if not args.onnx_model.exists():
        raise SystemExit(f"ONNX model not found: {args.onnx_model}")
    if not args.test_dir.exists():
        raise SystemExit(f"Test dataset directory not found: {args.test_dir}")

    sess = ort.InferenceSession(str(args.onnx_model), providers=["CPUExecutionProvider"])
    input_name = sess.get_inputs()[0].name
    output_name = sess.get_outputs()[0].name

    samples: List[Tuple[str, np.ndarray]] = []
    for person_dir in sorted(p for p in args.test_dir.iterdir() if p.is_dir()):
        for img_path in sorted(person_dir.iterdir()):
            if img_path.suffix.lower() not in {".png", ".jpg", ".jpeg"}:
                continue
            tensor = load_aligned_112_tensor(img_path)
            raw_emb = sess.run([output_name], {input_name: tensor})[0][0]
            samples.append((person_dir.name, l2_normalize(raw_emb)))

    if len(samples) < 4:
        raise SystemExit("Need at least 4 real aligned test images across >= 2 subjects.")

    genuine, impostor = [], []
    for i in range(len(samples)):
        for j in range(i + 1, len(samples)):
            sim = float(np.dot(samples[i][1], samples[j][1]))
            if samples[i][0] == samples[j][0]:
                genuine.append(sim)
            else:
                impostor.append(sim)

    if not genuine or not impostor:
        raise SystemExit("Test split must contain both same-subject (genuine) and cross-subject (impostor) pairs.")

    g_arr = np.array(genuine)
    imp_arr = np.array(impostor)

    sweep = []
    best_diff = 1e9
    eer = 1.0
    recommended_th = 0.40

    print("\nThreshold |   FAR   |   FRR   |   TAR")
    print("-" * 40)
    for t in np.arange(0.20, 0.76, 0.02):
        th = round(float(t), 2)
        far = round(float(np.mean(imp_arr >= th)), 4)
        frr = round(float(np.mean(g_arr < th)), 4)
        tar = round(1.0 - frr, 4)
        sweep.append({"threshold": th, "far": far, "frr": frr, "tar": tar})
        print(f"  {th:0.2f}    | {far:0.4f} | {frr:0.4f} | {tar:0.4f}")

        if abs(far - frr) < best_diff:
            best_diff = abs(far - frr)
            eer = round((far + frr) / 2.0, 4)
            recommended_th = th

    report = {
        "model": str(args.onnx_model),
        "test_samples": len(samples),
        "genuine_pairs": len(genuine),
        "impostor_pairs": len(impostor),
        "mean_genuine_cosine": round(float(np.mean(g_arr)), 4),
        "mean_impostor_cosine": round(float(np.mean(imp_arr)), 4),
        "equal_error_rate": eer,
        "recommended_ARCFACE_COSINE_THRESHOLD": recommended_th,
        "sweep": sweep,
    }

    args.out_report.parent.mkdir(parents=True, exist_ok=True)
    args.out_report.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nEvaluation Summary -> EER: {eer:.4f} | Recommended ARCFACE_COSINE_THRESHOLD={recommended_th}")
    print(f"Full report saved to {args.out_report}")


if __name__ == "__main__":
    main()
