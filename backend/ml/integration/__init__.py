"""
Medical AI Model Adapters & Integration Package
================================================
Provides unified adapters for CheXNet (X-Ray), CT-CLIP (CT Scan), and CMR-AI (Cardiac MRI).
"""

from .model_registry import model_registry, get_model_adapter

__all__ = ["model_registry", "get_model_adapter"]
