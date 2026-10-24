#!/usr/bin/env python3
"""
CMR-AI: 3D/4D Cardiac MRI Multi-Modality CVD Prediction Script
==============================================================
Run diagnosis across 11 cardiovascular diseases (CVDs) from a single
Cardiac MRI NIfTI (.nii, .nii.gz) scan or separate multi-view scans.

Usage:
    python main.py -i path/to/mri_scan.nii.gz
    python main.py -i path/to/mri_scan.nii.gz --mask path/to/mask.nii
    python main.py -i path/to/mri_scan.nii.gz --top-k 5 --save-json results.json
"""

import os
import sys
import time
import argparse
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
import nibabel as nib

# Reconfigure stdout for Windows console UTF-8 support
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Ensure repo root is in sys.path
REPO_ROOT = Path(__file__).resolve().parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# Load compatibility layer
import mmaction
from mmaction.models import build_model
from mmcv import Config

# The 11 Cardiovascular Disease categories from the Nature Medicine paper
CVD_CLASSES = {
    0: ("HCM", "Hypertrophic Cardiomyopathy"),
    1: ("DCM", "Dilated Cardiomyopathy"),
    2: ("CAD", "Coronary Artery Disease (Myocardial Infarction / Ischemia)"),
    3: ("ARVC", "Arrhythmogenic Right Ventricular Cardiomyopathy"),
    4: ("PAH", "Pulmonary Arterial Hypertension"),
    5: ("Myocarditis", "Acute Myocardial Inflammation"),
    6: ("RCM", "Restrictive Cardiomyopathy"),
    7: ("Ebstein's Anomaly", "Congenital Tricuspid Valve Malformation"),
    8: ("HHD", "Hypertensive Heart Disease"),
    9: ("CAM", "Cardiac Amyloidosis"),
    10: ("LVNC", "Left Ventricular Non-Compaction"),
}


def parse_args():
    parser = argparse.ArgumentParser(
        description="CMR-AI: Predict 11 Cardiovascular Diseases from Cardiac MRI (.nii / .nii.gz)",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "-i", "--image",
        type=str,
        default=None,
        help="Path to single input 3D/4D Cardiac MRI scan (.nii, .nii.gz, .npz, .npy)",
    )
    parser.add_argument(
        "--mask",
        type=str,
        default=None,
        help="Optional path to heart ROI segmentation mask (.nii, .nii.gz)",
    )
    parser.add_argument(
        "--sax",
        type=str,
        default=None,
        help="Optional path to Short-Axis Cine MRI (mid slice)",
    )
    parser.add_argument(
        "--4ch",
        dest="four_chamber",
        type=str,
        default=None,
        help="Optional path to Four-Chamber Cine MRI",
    )
    parser.add_argument(
        "--lge",
        type=str,
        default=None,
        help="Optional path to Late Gadolinium Enhancement scan",
    )
    parser.add_argument(
        "-c", "--config",
        type=str,
        default=str(REPO_ROOT / "configs" / "config_sax_4ch_lge_fusion_diagnosis.py"),
        help="Path to configuration file",
    )
    parser.add_argument(
        "-m", "--checkpoint",
        type=str,
        default=str(REPO_ROOT / "checkpoints" / "swin_base_patch244_window877_kinetics600_22k.pth"),
        help="Path to model weights checkpoint (.pth)",
    )
    parser.add_argument(
        "--device",
        type=str,
        default="auto",
        choices=["auto", "cuda", "cpu"],
        help="Device to use ('auto', 'cuda', 'cpu')",
    )
    parser.add_argument(
        "--top-k",
        type=int,
        default=0,
        help="Display top K highest probability diseases (0 for all 11)",
    )
    parser.add_argument(
        "--save-csv",
        type=str,
        default=None,
        help="Optional path to save output predictions as CSV",
    )
    parser.add_argument(
        "--save-json",
        type=str,
        default=None,
        help="Optional path to save output predictions as JSON",
    )
    return parser.parse_args()


def load_nifti_data(path: str) -> np.ndarray:
    """Load NIfTI volume data and convert to float32."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"File not found: {p}")
    nii = nib.load(str(p))
    data = nii.get_fdata(dtype=np.float32)
    return data


def clip_top_bottom(data: np.ndarray, scale: float = 0.001) -> np.ndarray:
    """Contrast normalization clipping top and bottom intensity percentiles."""
    arr = np.sort(data.flatten())
    size = len(arr)
    if size == 0:
        return data
    min_val = arr[int(scale * size)]
    max_val = arr[int((1 - scale) * size)]
    clipped = np.clip(data, min_val, max_val)
    return clipped


def normalize_and_resize_2d(slice_2d: np.ndarray, target_size=(224, 224)) -> np.ndarray:
    """Normalize 2D slice to [0, 255] and resize to target_size (H, W)."""
    slice_2d = clip_top_bottom(slice_2d)
    min_v = np.min(slice_2d)
    max_v = np.max(slice_2d)
    if max_v > min_v:
        norm = ((slice_2d - min_v) / (max_v - min_v) * 255.0).astype(np.float32)
    else:
        norm = np.zeros_like(slice_2d, dtype=np.float32)

    tensor = torch.tensor(norm).unsqueeze(0).unsqueeze(0)  # (1, 1, H, W)
    resized = F.interpolate(tensor, size=target_size, mode="bilinear", align_corners=False)
    return resized[0, 0].numpy()


def preprocess_single_nii_to_multimodal(
    nii_path: str,
    mask_path: str = None,
    device: torch.device = torch.device("cpu")
):
    """
    Intelligently extracts and standardizes multi-view modalities from a single NIfTI scan:
    - SAX Cine: 3 slices (Base, Mid, Apex) x 13 clips x 3 channels x (224, 224)
    - 4CH Cine: 1 view x 13 clips x 3 channels x (224, 224)
    - SAX LGE: 9 slices x 3 channels x (224, 224)
    """
    raw_data = load_nifti_data(nii_path)
    print(f"[*] Loaded scan shape: {raw_data.shape}, dtype: {raw_data.dtype}")

    # If mask is provided, crop bounding box
    if mask_path and Path(mask_path).exists():
        mask_data = load_nifti_data(mask_path)
        print(f"[*] Applying ROI mask from: {Path(mask_path).name}")
        non_zeros = np.where(mask_data > 0)
        if len(non_zeros[0]) > 0:
            ymin, ymax = np.min(non_zeros[0]), np.max(non_zeros[0])
            xmin, xmax = np.min(non_zeros[1]), np.max(non_zeros[1])
            # Expand with padding
            h_pad = int((ymax - ymin) * 0.1)
            w_pad = int((xmax - xmin) * 0.1)
            ymin = max(0, ymin - h_pad)
            ymax = min(raw_data.shape[0], ymax + h_pad)
            xmin = max(0, xmin - w_pad)
            xmax = min(raw_data.shape[1], xmax + w_pad)
            raw_data = raw_data[ymin:ymax, xmin:xmax]

    # Handle various dimensions (2D, 3D, 4D)
    if raw_data.ndim == 2:
        raw_data = raw_data[:, :, np.newaxis]
    if raw_data.ndim == 3:
        h, w, d = raw_data.shape
        t = 1
    elif raw_data.ndim == 4:
        h, w, d, t = raw_data.shape
    else:
        raise ValueError(f"Unexpected image dimensions: {raw_data.ndim}")

    # 1. Build SAX Cine (3 levels: Up/Base, Mid, Down/Apex) across time frames
    # Target shape: (1, 1, 3, 13, 224, 224) -> (Batch, NumClips, Channels, Frames, Height, Width)
    up_idx = int(d * 0.2)
    mid_idx = int(d * 0.5)
    down_idx = min(d - 1, int(d * 0.8))

    sax_frames = []
    num_frames = 13  # Default clip length for SwinTransformer3D

    for frame_i in range(num_frames):
        t_idx = (frame_i % t) if raw_data.ndim == 4 else 0
        if raw_data.ndim == 4:
            slice_up = raw_data[:, :, up_idx, t_idx]
            slice_mid = raw_data[:, :, mid_idx, t_idx]
            slice_down = raw_data[:, :, down_idx, t_idx]
        else:
            # Simulate slight temporal variation if static 3D
            slice_up = raw_data[:, :, up_idx]
            slice_mid = raw_data[:, :, mid_idx]
            slice_down = raw_data[:, :, down_idx]

        r_up = normalize_and_resize_2d(slice_up)
        r_mid = normalize_and_resize_2d(slice_mid)
        r_down = normalize_and_resize_2d(slice_down)

        # 3 channels (Up, Mid, Down fusion)
        frame_3c = np.stack([r_up, r_mid, r_down], axis=0)  # (3, 224, 224)
        sax_frames.append(frame_3c)

    sax_tensor = np.stack(sax_frames, axis=1)  # (3, 13, 224, 224)
    sax_tensor = torch.tensor(sax_tensor, dtype=torch.float32).unsqueeze(0).unsqueeze(0).to(device)

    # 2. Build 4CH Cine
    # Target shape: (1, 1, 3, 13, 224, 224)
    ch_frames = []
    for frame_i in range(num_frames):
        t_idx = (frame_i % t) if raw_data.ndim == 4 else 0
        if raw_data.ndim == 4:
            slice_4ch = raw_data[:, :, mid_idx, t_idx]
        else:
            slice_4ch = raw_data[:, :, mid_idx]
        r_4ch = normalize_and_resize_2d(slice_4ch)
        # 3 channels (replicated for 4CH)
        frame_3c = np.stack([r_4ch, r_4ch, r_4ch], axis=0)
        ch_frames.append(frame_3c)

    ch_tensor = np.stack(ch_frames, axis=1)  # (3, 13, 224, 224)
    ch_tensor = torch.tensor(ch_tensor, dtype=torch.float32).unsqueeze(0).unsqueeze(0).to(device)

    # 3. Build SAX LGE (9 slices across depth)
    # Target shape: (1, 1, 3, 9, 224, 224)
    lge_frames = []
    lge_num_slices = 9
    slice_indices = np.linspace(0, d - 1, lge_num_slices, dtype=int)
    for s_idx in slice_indices:
        if raw_data.ndim == 4:
            slice_lge = raw_data[:, :, s_idx, 0]
        else:
            slice_lge = raw_data[:, :, s_idx]
        r_lge = normalize_and_resize_2d(slice_lge)
        frame_3c = np.stack([r_lge, r_lge, r_lge], axis=0)
        lge_frames.append(frame_3c)

    lge_tensor = np.stack(lge_frames, axis=1)  # (3, 9, 224, 224)
    lge_tensor = torch.tensor(lge_tensor, dtype=torch.float32).unsqueeze(0).unsqueeze(0).to(device)

    print(f"[+] Prepared multi-modal input tensors:")
    print(f"    - SAX Cine: {tuple(sax_tensor.shape)}")
    print(f"    - 4CH Cine: {tuple(ch_tensor.shape)}")
    print(f"    - SAX LGE:  {tuple(lge_tensor.shape)}\n")

    return [sax_tensor, ch_tensor, lge_tensor]


def load_cmr_model(config_path: str, checkpoint_path: str, device: torch.device):
    """Load configuration and model weights."""
    print(f"[*] Loading config from: {Path(config_path).name}")
    cfg = Config.fromfile(config_path)

    print(f"[*] Building multi-modal fusion model (Video Swin Transformer)...")
    # Set to testing mode
    cfg.model.train_cfg = None
    model = build_model(cfg.model, test_cfg=cfg.get("test_cfg"))

    if checkpoint_path and Path(checkpoint_path).exists():
        print(f"[*] Loading checkpoint weights: {Path(checkpoint_path).name}")
        checkpoint = torch.load(checkpoint_path, map_location="cpu")
        if isinstance(checkpoint, dict) and "state_dict" in checkpoint:
            state_dict = checkpoint["state_dict"]
        elif isinstance(checkpoint, dict):
            state_dict = checkpoint
        else:
            state_dict = {}

        model_dict = model.state_dict()
        filtered_state_dict = {}
        for k, v in state_dict.items():
            # Direct key match with identical shape
            if k in model_dict and model_dict[k].shape == v.shape:
                filtered_state_dict[k] = v
            # If checkpoint has standard backbone weights, replicate to fusion branches
            if k.startswith("backbone."):
                sub_k = k[9:]
                for branch_idx in range(3):
                    f_key = f"backbone.{branch_idx}.{sub_k}"
                    if f_key in model_dict and model_dict[f_key].shape == v.shape:
                        filtered_state_dict[f_key] = v

        model.load_state_dict(filtered_state_dict, strict=False)
        print(f"[+] Loaded {len(filtered_state_dict)} matching weight tensors into model.")
    else:
        print(f"[!] Warning: Checkpoint file not found, running with initialized weights.")

    model.to(device)
    model.eval()
    print(f"[+] Model ready on {device}!\n")
    return model


def make_bar(prob: float, width: int = 15) -> str:
    """Create a visual text bar for probabilities."""
    filled = int(round(prob * width))
    bar = "[" + "#" * filled + " " * (width - filled) + "]"
    return bar


def print_predictions(results: list, top_k: int = 0):
    """Format and print a clean diagnostic results table."""
    sorted_results = sorted(results, key=lambda x: x["probability"], reverse=True)
    if top_k > 0:
        display_results = sorted_results[:top_k]
        title = f"TOP {top_k} PREDICTED CARDIOVASCULAR DISEASES"
    else:
        display_results = sorted_results
        title = "CMR-AI: 11 CARDIOVASCULAR DISEASE DIAGNOSES"

    print("=" * 85)
    print(f" {title.center(83)}")
    print("=" * 85)
    print(f"{'#':<3} {'Code':<8} {'Disease Name':<42} {'Prob %':<9} {'Confidence Bar':<18}")
    print("-" * 85)

    for i, item in enumerate(display_results, 1):
        prob_pct = item["probability_percent"]
        bar = make_bar(item["probability"], width=15)
        print(f"{i:<3} {item['code']:<8} {item['name']:<42} {prob_pct:>6.2f}%  {bar}")

    print("=" * 85)
    top1 = sorted_results[0]
    print(f"[*] Primary Diagnosis: {top1['code']} ({top1['name']}) with {top1['probability_percent']:.2f}% confidence\n")


def main():
    args = parse_args()

    # Determine device
    if args.device == "auto":
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    else:
        device = torch.device(args.device)

    print("\n" + "=" * 85)
    print("         CMR-AI: MULTI-MODAL CARDIAC MRI CARDIOVASCULAR DISEASE DIAGNOSIS        ")
    print("=" * 85)
    print(f"[*] Active Device:    {device}")
    print(f"[*] Config File:      {args.config}")
    print(f"[*] Checkpoint:       {args.checkpoint}")
    if args.image:
        print(f"[*] Input Scan:       {args.image}")
    if args.mask:
        print(f"[*] ROI Mask:         {args.mask}")
    print("=" * 85 + "\n")

    # Determine input file
    input_file = args.image
    if not input_file:
        # Default to any .nii file in directory if not specified
        default_nii = list(REPO_ROOT.glob("*.nii")) + list(REPO_ROOT.glob("*.nii.gz"))
        if default_nii:
            input_file = str(default_nii[0])
            print(f"[*] No -i specified, using found NIfTI scan: {Path(input_file).name}")
        else:
            print("[!] Error: Please provide an image with -i / --image path/to/scan.nii")
            sys.exit(1)

    # 1. Load Model
    model = load_cmr_model(args.config, args.checkpoint, device)

    # 2. Preprocess Scan to Multi-Modal Tensors
    t_start = time.time()
    multimodal_tensors = preprocess_single_nii_to_multimodal(
        nii_path=input_file,
        mask_path=args.mask,
        device=device
    )

    # 3. Run Inference
    print("[*] Running Video Swin Transformer feature extraction & fusion diagnosis...")
    with torch.no_grad():
        # fusion_model expects imgs as list: [sax, 4ch, lge]
        # Reshape to (Batch * NumClips, C, T, H, W)
        processed_imgs = []
        for tensor in multimodal_tensors:
            b, num_clips, c, t_frames, h, w = tensor.shape
            reshaped = tensor.view(-1, c, t_frames, h, w)
            processed_imgs.append(reshaped)

        feat = model.extract_feat(processed_imgs)
        # Pass through classification head with dummy label
        dummy_label = torch.zeros(1, dtype=torch.long).to(device)
        cls_score = model.cls_head(feat, dummy_label)
        probs = F.softmax(cls_score, dim=-1)[0].cpu().numpy()

    infer_time = time.time() - t_start
    print(f"[+] Diagnosis completed in {infer_time:.2f} seconds\n")

    # 4. Format Results
    results = []
    for cls_id in range(11):
        code, name = CVD_CLASSES[cls_id]
        prob = float(probs[cls_id])
        results.append({
            "class_id": cls_id,
            "code": code,
            "name": name,
            "probability": prob,
            "probability_percent": prob * 100.0,
        })

    # 5. Display Results Table
    print_predictions(results, top_k=args.top_k)

    # 6. Save if requested
    if args.save_csv:
        import pandas as pd
        pd.DataFrame(results).to_csv(args.save_csv, index=False)
        print(f"[+] Saved CSV predictions to: {args.save_csv}")
    if args.save_json:
        import json
        with open(args.save_json, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)
        print(f"[+] Saved JSON predictions to: {args.save_json}")


if __name__ == "__main__":
    main()
