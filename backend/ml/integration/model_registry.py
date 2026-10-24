"""
Central Model Registry & Router
================================
Centralized configuration mapping modality categories to medical AI models,
immutable pretrained base checkpoints, and execution adapters.
"""

from pathlib import Path
from typing import Dict, Any, Optional, List
from .xray_adapter import XRayAdapter, CHEXNET_CLASSES
from .ctscan_adapter import CTScanAdapter, CT_PATHOLOGIES
from .mri_adapter import MRIAdapter, CMR_CVD_CLASSES

ML_ROOT = Path(__file__).resolve().parent.parent

MODEL_REGISTRY: Dict[str, Dict[str, Any]] = {
    "xray": {
        "category": "xray",
        "id": "cxr-pneumo-cnn",
        "name": "CheXNet (Frontal Chest Radiograph Classifier)",
        "short_name": "CheXNet",
        "modality": "Chest X-ray",
        "task": "14-Pathology Multi-label Classification",
        "architecture": "DenseNet-121",
        "checkpoint_path": str(ML_ROOT / "chexnet" / "models" / "m-25012018-123527.pth.tar"),
        "base_accuracy": 0.8508,
        "classes": CHEXNET_CLASSES,
        "input_spec": {
            "resolution": "224 × 224",
            "channels": "3 (RGB / Grayscale Normalized)",
            "format": "PNG, JPG, DICOM (.zip)",
        },
        "adapter_class": XRayAdapter,
    },
    "ctscan": {
        "category": "ctscan",
        "id": "ct-clip-3d",
        "name": "CT-CLIP (3D Chest CT Pathology Classifier)",
        "short_name": "CT-CLIP",
        "modality": "Chest CT Scan",
        "task": "18-Finding Volumetric Chest CT Classification",
        "architecture": "CTViT + CT-CLIP 3D Transformer",
        "checkpoint_path": str(ML_ROOT / "CT-CLIP" / "models" / "CT-CLIP_v2.pt"),
        "base_accuracy": 0.8840,
        "classes": CT_PATHOLOGIES,
        "input_spec": {
            "resolution": "Isotropic 3D Volume / Axial Slices",
            "channels": "1 (HU Windowed Grayscale)",
            "format": "NIfTI (.nii, .nii.gz), NPZ, DICOM (.zip)",
        },
        "adapter_class": CTScanAdapter,
    },
    "mri": {
        "category": "mri",
        "id": "cmr-ai-vst",
        "name": "CMR-AI (Cardiac MRI Multi-Modality CVD Screener)",
        "short_name": "CMR-AI",
        "modality": "Cardiac MRI",
        "task": "11-Cardiovascular Disease Multi-class Diagnosis",
        "architecture": "Video Swin Transformer (SwinTransformer3D)",
        "checkpoint_path": str(ML_ROOT / "CMR-AI" / "checkpoints" / "swin_base_patch244_window877_kinetics600_22k.pth"),
        "base_accuracy": 0.8710,
        "classes": CMR_CVD_CLASSES,
        "input_spec": {
            "resolution": "224 × 224 Cine Frames (SAX / 4CH)",
            "channels": "Multi-view Temporal Sequences",
            "format": "NIfTI (.nii, .nii.gz) Cine Series (.zip)",
        },
        "adapter_class": MRIAdapter,
    },
}

# Alias mapping for flexible category resolution
CATEGORY_ALIASES: Dict[str, str] = {
    # X-Ray aliases
    "xray": "xray",
    "x-ray": "xray",
    "cxr": "xray",
    "chest x-ray": "xray",
    "chest xray": "xray",
    "cxr-pneumo-cnn": "xray",
    "pneumonia-cxr": "xray",
    "chexnet": "xray",
    "pneumonet": "xray",

    # CT Scan aliases
    "ctscan": "ctscan",
    "ct": "ctscan",
    "ct-scan": "ctscan",
    "chest ct": "ctscan",
    "chest ct scan": "ctscan",
    "organ-ct": "ctscan",
    "ct-clip": "ctscan",
    "ct_clip": "ctscan",
    "ct-clip-3d": "ctscan",
    "abdominal ct": "ctscan",

    # Cardiac MRI aliases
    "mri": "mri",
    "cardiac mri": "mri",
    "cardiac-mri": "mri",
    "cmr": "mri",
    "cmr-ai": "mri",
    "cmr_ai": "mri",
    "cmr-ai-vst": "mri",
    "cmr-mri": "mri",
}

# Initialized singleton adapter instances
_ADAPTER_INSTANCES: Dict[str, Any] = {}


def normalize_category(category_or_id: Optional[str]) -> str:
    """Resolves a category string or model ID to a canonical registry key ('xray', 'ctscan', 'mri')."""
    if not category_or_id:
        return "xray"
    norm = str(category_or_id).strip().lower()
    if norm in CATEGORY_ALIASES:
        return CATEGORY_ALIASES[norm]

    # Partial keyword match
    if "ct" in norm:
        return "ctscan"
    elif "mri" in norm or "cmr" in norm or "cardiac" in norm:
        return "mri"
    elif "xray" in norm or "x-ray" in norm or "cxr" in norm or "pneumo" in norm or "chex" in norm:
        return "xray"

    # Default fallback
    return "xray"


def get_model_spec(category_or_id: Optional[str]) -> Dict[str, Any]:
    """Retrieves metadata and specifications for the specified category (JSON serializable)."""
    canonical = normalize_category(category_or_id)
    raw_spec = MODEL_REGISTRY.get(canonical, MODEL_REGISTRY["xray"])
    return {k: v for k, v in raw_spec.items() if k != "adapter_class"}


def get_model_adapter(category_or_id: Optional[str]):
    """Returns the adapter instance corresponding to the normalized category."""
    canonical = normalize_category(category_or_id)
    if canonical not in _ADAPTER_INSTANCES:
        spec = MODEL_REGISTRY[canonical]
        adapter_cls = spec["adapter_class"]
        _ADAPTER_INSTANCES[canonical] = adapter_cls(spec["checkpoint_path"])
    return _ADAPTER_INSTANCES[canonical]


def list_registered_models() -> List[Dict[str, Any]]:
    """Returns a list of all registered models with their specs (JSON serializable)."""
    return [{k: v for k, v in spec.items() if k != "adapter_class"} for spec in MODEL_REGISTRY.values()]


class ModelRegistry:
    def __init__(self):
        self.registry = MODEL_REGISTRY

    def get_spec(self, category_or_id: Optional[str]) -> Dict[str, Any]:
        return get_model_spec(category_or_id)

    def get_adapter(self, category_or_id: Optional[str]):
        return get_model_adapter(category_or_id)

    def list_models(self) -> List[Dict[str, Any]]:
        return list_registered_models()


model_registry = ModelRegistry()
