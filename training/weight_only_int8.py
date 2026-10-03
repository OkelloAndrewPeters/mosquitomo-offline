import onnx, numpy as np, onnxruntime as ort, os, json
from onnx import numpy_helper, helper, TensorProto
from PIL import Image
def weight_only_int8(src, dst, min_elems=1024):
    m = onnx.load(src); g = m.graph
    inits = {i.name: i for i in g.initializer}
    users = {}
    for n in g.node:
        for k, inp in enumerate(n.input): users.setdefault(inp, []).append((n, k))
    new_inits, new_nodes, removed = [], [], set()
    for name, init in inits.items():
        w = numpy_helper.to_array(init)
        if w.dtype != np.float32 or w.size < min_elems or w.ndim < 2: continue
        us = users.get(name, [])
        if not us or not all(n.op_type in ('Conv', 'Gemm', 'MatMul') and k == 1 for n, k in us): continue
        axis = 0 if us[0][0].op_type == 'Conv' or (us[0][0].op_type == 'Gemm' and any(a.name == 'transB' and a.i == 1 for a in us[0][0].attribute)) else 1
        red = tuple(i for i in range(w.ndim) if i != axis)
        scale = np.abs(w).max(axis=red) / 127.0; scale[scale == 0] = 1e-8
        shape = [1] * w.ndim; shape[axis] = -1
        q = np.clip(np.round(w / scale.reshape(shape)), -127, 127).astype(np.int8)
        new_inits += [numpy_helper.from_array(q, name + '_q'), numpy_helper.from_array(scale.astype(np.float32), name + '_s'),
                      numpy_helper.from_array(np.zeros(scale.shape, np.int8), name + '_z')]
        new_nodes.append(helper.make_node('DequantizeLinear', [name + '_q', name + '_s', name + '_z'], [name], axis=axis, name=name + '_dq'))
        removed.add(name)
    keep = [i for i in g.initializer if i.name not in removed]
    del g.initializer[:]; g.initializer.extend(keep + new_inits)
    nodes = list(g.node); del g.node[:]; g.node.extend(new_nodes + nodes)
    onnx.checker.check_model(m); onnx.save(m, dst)
    return len(removed)
if __name__ == '__main__':
    n = weight_only_int8('sitenet_fp32.onnx', 'sitenet_w8.onnx'); print('quantized tensors', n)
