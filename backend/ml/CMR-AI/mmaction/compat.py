"""
OpenMMLab 2.x (mmcv-lite / mmengine) Compatibility Layer for CMR-AI
===================================================================
Provides backward-compatible aliases for mmcv.utils, mmcv.runner,
mmcv.parallel, mmcv.fileio, and mmcv.cnn when running on modern Python/PyTorch.
"""

import sys
import types
import warnings
import torch
import torch.nn as nn

try:
    import mmcv
    import mmengine
    from mmengine.config import Config, DictAction
    mmcv.Config = Config
    mmcv.DictAction = DictAction
except ImportError:
    pass

try:
    import mmengine.registry as reg
    import mmengine.logging as log
    import mmengine.utils as utils
    import mmengine.dist as dist
    import mmengine.runner as runner
    import mmengine.hooks as hooks
    import mmengine.fileio as fileio
    import mmengine.model.weight_init as weight_init
    import mmengine.model.utils as model_utils

    # 1. mmcv.utils shim
    if 'mmcv.utils' not in sys.modules or not hasattr(sys.modules.get('mmcv.utils', None), 'Registry'):
        u = types.ModuleType('mmcv.utils')
        u.Registry = reg.Registry
        u.build_from_cfg = reg.build_from_cfg
        u.print_log = log.print_log
        u.get_logger = log.MMLogger.get_current_instance
        u.get_root_logger = log.MMLogger.get_current_instance
        u._BatchNorm = (nn.BatchNorm1d, nn.BatchNorm2d, nn.BatchNorm3d)
        u._ConvNd = (nn.Conv1d, nn.Conv2d, nn.Conv3d)
        u.SyncBatchNorm = nn.SyncBatchNorm
        u.collect_env = lambda: {}
        u.get_git_hash = lambda digits=7: 'unknown'
        u.digit_version = utils.digit_version
        u.is_str = lambda s: isinstance(s, str)
        u.is_seq_of = lambda seq, expected_type, seq_type=None: isinstance(seq, (list, tuple))
        u.is_list_of = lambda seq, expected_type: isinstance(seq, list)
        u.is_tuple_of = lambda seq, expected_type: isinstance(seq, tuple)
        u.register_all_modules = lambda init_default_scope=False: None
        u.TORCH_VERSION = torch.__version__
        sys.modules['mmcv.utils'] = u
        if hasattr(mmcv, 'utils'):
            for k, v in u.__dict__.items():
                if not k.startswith('__'):
                    setattr(mmcv.utils, k, v)

    # Attach register_all_modules to mmaction.utils if loaded
    try:
        import mmaction.utils as mm_utils
        mm_utils.register_all_modules = lambda init_default_scope=False: None
    except Exception:
        pass

    # 2. mmcv.parallel shim
    if 'mmcv.parallel' not in sys.modules or not hasattr(sys.modules.get('mmcv.parallel', None), 'collate'):
        p = types.ModuleType('mmcv.parallel')
        p.MMDataParallel = torch.nn.DataParallel
        p.MMDistributedDataParallel = getattr(mmengine.model, 'MMDistributedDataParallel', torch.nn.parallel.DistributedDataParallel)

        class DataContainer:
            def __init__(self, data, stack=False, padding_value=0, cpu_only=False, pad_dims=2):
                self._data = data
                self._stack = stack
                self._padding_value = padding_value
                self._cpu_only = cpu_only
                self._pad_dims = pad_dims
            @property
            def data(self):
                return self._data
            @property
            def stack(self):
                return self._stack
            @property
            def padding_value(self):
                return self._padding_value
            @property
            def cpu_only(self):
                return self._cpu_only
            @property
            def pad_dims(self):
                return self._pad_dims
            def __repr__(self):
                return f'{self.__class__.__name__}({self._data})'

        p.DataContainer = DataContainer
        try:
            from mmengine.dataset import pseudo_collate as collate
        except ImportError:
            from torch.utils.data.dataloader import default_collate as collate
        p.collate = collate

        def scatter(inputs, target_gpus, dim=0):
            if isinstance(inputs, tuple):
                return [inputs]
            if isinstance(inputs, list):
                return [inputs]
            if isinstance(inputs, dict):
                return [inputs]
            return [inputs]
        p.scatter = scatter
        p.scatter_kwargs = lambda inputs, kwargs, target_gpus, dim=0: ([inputs], [kwargs])

        sys.modules['mmcv.parallel'] = p
        if hasattr(mmcv, 'parallel'):
            for k, v in p.__dict__.items():
                if not k.startswith('__'):
                    setattr(mmcv.parallel, k, v)

    # 3. mmcv.runner shim
    if 'mmcv.runner' not in sys.modules or not hasattr(sys.modules.get('mmcv.runner', None), 'load_checkpoint'):
        r = types.ModuleType('mmcv.runner')
        r.load_checkpoint = getattr(runner, 'load_checkpoint', None)
        r._load_checkpoint = getattr(runner, '_load_checkpoint', getattr(runner, 'load_checkpoint', None))
        r.get_dist_info = getattr(dist, 'get_dist_info', lambda: (0, 1))
        r.init_dist = getattr(dist, 'init_dist', lambda *args, **kwargs: None)
        r.set_random_seed = getattr(runner, 'set_random_seed', lambda *args, **kwargs: None)
        r.HOOKS = reg.HOOKS
        r.OPTIMIZERS = getattr(reg, 'OPTIMIZERS', reg.Registry('optimizers'))
        r.OPTIMIZER_BUILDERS = getattr(reg, 'OPTIMIZER_BUILDERS', reg.Registry('optimizer_builders'))
        r.RUNNERS = getattr(reg, 'RUNNERS', reg.Registry('runners'))
        r.Hook = getattr(hooks, 'Hook', object)
        r.OptimizerHook = getattr(hooks, 'OptimizerHook', getattr(hooks, 'Hook', object))
        r.DistSamplerSeedHook = getattr(hooks, 'DistSamplerSeedHook', getattr(hooks, 'Hook', object))
        r.DefaultOptimizerConstructor = getattr(runner, 'DefaultOptimizerConstructor', object)
        r.EpochBasedRunner = getattr(runner, 'EpochBasedRunner', object)
        r.IterBasedRunner = getattr(runner, 'IterBasedRunner', object)
        r.LrUpdaterHook = getattr(hooks, 'ParamSchedulerHook', getattr(hooks, 'Hook', object))
        r.CheckpointHook = getattr(hooks, 'CheckpointHook', getattr(hooks, 'Hook', object))
        r.IterTimerHook = getattr(hooks, 'IterTimerHook', getattr(hooks, 'Hook', object))
        r.TextLoggerHook = getattr(hooks, 'LoggerHook', getattr(hooks, 'Hook', object))
        r.build_optimizer = lambda model, cfg: torch.optim.Adam(model.parameters())
        r.build_optimizer_constructor = lambda *args, **kwargs: None
        r.build_runner = lambda *args, **kwargs: None
        r.wrap_fp16_model = lambda m: m
        r.auto_fp16 = lambda *args, **kwargs: (lambda fn: fn)
        r.force_fp32 = lambda *args, **kwargs: (lambda fn: fn)
        r.Fp16OptimizerHook = getattr(hooks, 'Hook', object)

        r.__path__ = []

        # fp16_utils submodule
        fp16_u = types.ModuleType('mmcv.runner.fp16_utils')
        fp16_u.wrap_fp16_model = lambda m: m
        fp16_u.auto_fp16 = lambda *args, **kwargs: (lambda fn: fn)
        fp16_u.force_fp32 = lambda *args, **kwargs: (lambda fn: fn)
        sys.modules['mmcv.runner.fp16_utils'] = fp16_u
        r.fp16_utils = fp16_u

        # hooks submodule
        hooks_u = types.ModuleType('mmcv.runner.hooks')
        hooks_u.__path__ = []
        hooks_u.Fp16OptimizerHook = getattr(hooks, 'Hook', object)
        hooks_u.Hook = getattr(hooks, 'Hook', object)
        hooks_u.OptimizerHook = getattr(hooks, 'Hook', object)
        sys.modules['mmcv.runner.hooks'] = hooks_u
        r.hooks = hooks_u

        # lr_updater inside hooks
        import math
        hooks_lr = types.ModuleType('mmcv.runner.hooks.lr_updater')
        hooks_lr.annealing_cos = lambda start, end, factor: end + 0.5 * (start - end) * (1 + math.cos(math.pi * factor))
        sys.modules['mmcv.runner.hooks.lr_updater'] = hooks_lr
        hooks_u.lr_updater = hooks_lr

        # utils submodule
        r_utils = types.ModuleType('mmcv.runner.utils')
        r_utils.get_host_info = lambda: 'localhost'
        sys.modules['mmcv.runner.utils'] = r_utils
        r.utils = r_utils

        sys.modules['mmcv.runner'] = r
        if hasattr(mmcv, 'runner'):
            for k, v in r.__dict__.items():
                if not k.startswith('__'):
                    setattr(mmcv.runner, k, v)

    # 4. mmcv.fileio shim
    try:
        import mmcv.fileio as fio
    except ImportError:
        fio = types.ModuleType('mmcv.fileio')
        sys.modules['mmcv.fileio'] = fio

    fio.FileClient = getattr(fileio, 'FileClient', None)
    fio.file_handlers = getattr(fileio, 'file_handlers', {})
    fio.load = getattr(fileio, 'load', None)
    fio.dump = getattr(fileio, 'dump', None)
    sys.modules['mmcv.fileio'] = fio

    fio_io = types.ModuleType('mmcv.fileio.io')
    fio_io.file_handlers = getattr(fileio, 'file_handlers', {})
    sys.modules['mmcv.fileio.io'] = fio_io
    fio.io = fio_io

    # 5. mmcv.cnn weight_init & utils shim
    try:
        import mmcv.cnn as mmcv_cnn
    except ImportError:
        mmcv_cnn = types.ModuleType('mmcv.cnn')
        sys.modules['mmcv.cnn'] = mmcv_cnn

    for name in [
        'constant_init', 'kaiming_init', 'normal_init', 'xavier_init',
        'bias_init_with_prob', 'caffe2_xavier_init', 'trunc_normal_init', 'uniform_init'
    ]:
        if hasattr(weight_init, name):
            setattr(mmcv_cnn, name, getattr(weight_init, name))
            if 'mmcv.cnn' in sys.modules:
                setattr(sys.modules['mmcv.cnn'], name, getattr(weight_init, name))
    if hasattr(model_utils, 'fuse_conv_bn'):
        setattr(mmcv_cnn, 'fuse_conv_bn', model_utils.fuse_conv_bn)
        if 'mmcv.cnn' in sys.modules:
            setattr(sys.modules['mmcv.cnn'], 'fuse_conv_bn', model_utils.fuse_conv_bn)

    try:
        from mmcv.cnn.bricks import (
            build_norm_layer, build_conv_layer, build_plugin_layer,
            build_activation_layer, build_padding_layer, build_upsample_layer
        )
        for fn in [
            'build_norm_layer', 'build_conv_layer', 'build_plugin_layer',
            'build_activation_layer', 'build_padding_layer', 'build_upsample_layer'
        ]:
            if not hasattr(mmcv_cnn, fn):
                setattr(mmcv_cnn, fn, locals()[fn])
                if 'mmcv.cnn' in sys.modules:
                    setattr(sys.modules['mmcv.cnn'], fn, locals()[fn])
    except Exception:
        pass

    for reg_name in [
        'MODELS', 'CONV_LAYERS', 'NORM_LAYERS', 'ACTIVATION_LAYERS',
        'PADDING_LAYERS', 'PLUGIN_LAYERS', 'UPSAMPLE_LAYERS'
    ]:
        if hasattr(reg, reg_name):
            target_reg = getattr(reg, reg_name)
        else:
            target_reg = reg.Registry(reg_name.lower())
        setattr(mmcv_cnn, reg_name, target_reg)
        if 'mmcv.cnn' in sys.modules:
            setattr(sys.modules['mmcv.cnn'], reg_name, target_reg)

    # 6. mmcv_custom shim
    mmcv_custom = types.ModuleType('mmcv_custom')
    mmcv_custom_runner = types.ModuleType('mmcv_custom.runner')
    mmcv_custom_runner.EpochBasedRunnerAmp = getattr(runner, 'EpochBasedRunner', object)
    mmcv_custom.runner = mmcv_custom_runner
    sys.modules['mmcv_custom'] = mmcv_custom
    sys.modules['mmcv_custom.runner'] = mmcv_custom_runner

except Exception as e:
    warnings.warn(f"Compatibility layer setup note: {e}")
