#!/usr/bin/env python3
"""
Step 4: Export Fine-Tuned PyTorch ArcFace Backbone to ONNX & Verify Parity

Exports input 'input.1' [1, 3, 112, 112] -> output '516' [1, 512] so the
exported file drops directly into public/models/arcface_w600k_mbf.onnx.
"""

import sys
import os

try:
    import torch
    import onnxruntime as ort
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
        print("[ERROR] Required packages (torch, onnxruntime, numpy) not found.")
        sys.exit(1)

import argparse
import importlib.util
from pathlib import Path


def load_backbone_class():
    spec = importlib.util.spec_from_file_location("finetune_mod", Path(__file__).parent / "2_finetune_arcface.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.MobileFaceNetBackbone


def main() -> None:
    parser = argparse.ArgumentParser(description="Export fine-tuned PyTorch ArcFace model to ONNX.")
    default_ckpt = Path("training/checkpoints/best_arcface_backbone.pt") if Path("training/checkpoints").exists() else Path("checkpoints/best_arcface_backbone.pt")
    default_onnx = Path("training/checkpoints/arcface_finetuned.onnx") if Path("training").exists() else Path("checkpoints/arcface_finetuned.onnx")
    parser.add_argument("--ckpt", type=Path, default=default_ckpt)
    parser.add_argument("--out-onnx", type=Path, default=default_onnx)
    args = parser.parse_args()

    if not args.ckpt.exists():
        raise SystemExit(f"Checkpoint not found: {args.ckpt}")

    BackboneCls = load_backbone_class()
    model = BackboneCls(embedding_dim=512)
    state = torch.load(args.ckpt, map_location="cpu")
    model.load_state_dict(state["backbone"])
    model.eval()

    dummy_input = torch.randn(1, 3, 112, 112)
    with torch.no_grad():
        pt_out = model(dummy_input).numpy()

    args.out_onnx.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        model,
        dummy_input,
        str(args.out_onnx),
        input_names=["input.1"],
        output_names=["516"],
        dynamic_axes={"input.1": {0: "batch_size"}, "516": {0: "batch_size"}},
        opset_version=17,
        do_constant_folding=True,
    )

    sess = ort.InferenceSession(str(args.out_onnx), providers=["CPUExecutionProvider"])
    ort_out = sess.run(["516"], {"input.1": dummy_input.numpy()})[0]
    max_diff = float(np.max(np.abs(pt_out - ort_out)))
    print(f"Exported ONNX: {args.out_onnx} | Max PyTorch vs ONNX diff: {max_diff:.2e}")
    if max_diff > 1e-4:
        raise RuntimeError("ONNX parity check failed!")
    print("To deploy, copy this file to ../public/models/arcface_w600k_mbf.onnx")


if __name__ == "__main__":
    main()
