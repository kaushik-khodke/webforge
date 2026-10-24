from . import compat

try:
    from mmcv import digit_version
except ImportError:
    try:
        from mmengine.utils import digit_version
    except ImportError:
        def digit_version(v):
            return tuple(map(int, v.split('.')[:3]))

from .version import __version__

__all__ = ['__version__']
