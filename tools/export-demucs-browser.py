#!/usr/bin/env python3
"""Derive a GPU-friendly HTDemucs core from the pinned MIT StemSplit export.

Removes unrolled inverse-STFT; src/neural-istft.js reconstructs its waveform.
All weights remain unchanged. Public .bin files are transport shards: concatenate
in manifest order to obtain one ordinary ONNX graph before creating a session.
Usage: .model-venv/bin/python tools/export-demucs-browser.py
Needs onnx==1.19.1; input model .model-cache/htdemucs-browser.onnx stays private.
"""
from pathlib import Path
import hashlib,json
import onnx
from onnx import helper
ROOT=Path(__file__).resolve().parent.parent
SOURCE=ROOT/'.model-cache/htdemucs-browser.onnx'
SOURCE_SHA='d05c269d0178d2a72ad484b10b11dd370193fc923201c3b27a99f848745db70a'
OUT=ROOT/'public/models';OUT.mkdir(exist_ok=True,parents=True)
sha=lambda b:hashlib.sha256(b).hexdigest()
source=SOURCE.read_bytes()
if sha(source)!=SOURCE_SHA:raise RuntimeError('Pinned source HTDemucs checksum mismatch')
model=onnx.load_from_string(source)
outputs={'spectra':{'name':'/Pad_2_output_0','shape':[1,4,2,2,2049,340]},'time':{'name':'/Add_4_output_0','shape':[1,4,2,343980]}}
# Original export has no intermediate value_info. Declare these verified shapes
# before Extractor so no whole-graph inference/weight folding is necessary.
for info in outputs.values():model.graph.value_info.append(helper.make_tensor_value_info(info['name'],onnx.TensorProto.FLOAT,info['shape']))
core=onnx.utils.Extractor(model).extract_model(['mix'],[v['name']for v in outputs.values()])
core.producer_name='Open Beatmap Studio (StemSplit HTDemucs core extraction)'
core.doc_string='MIT StemSplit/Meta HTDemucs unchanged learned core; inverse STFT reconstructed in JavaScript. Source SHA256 '+SOURCE_SHA
onnx.checker.check_model(core)
raw=core.SerializeToString();chunk_bytes=18*1024*1024;shards=[]
for i,first in enumerate(range(0,len(raw),chunk_bytes)):
 block=raw[first:first+chunk_bytes];filename=f'demucs-gpu.part{i+1:02}.bin';(OUT/filename).write_bytes(block);shards.append({'file':filename,'bytes':len(block),'sha256':sha(block)})
manifest={'id':'htdemucs-browser-core','name':'HTDemucs v4 browser core','license':'MIT','format':'onnx-byte-shards','source':{'repository':'https://github.com/StemSplit/demucs-onnx','weights':'https://huggingface.co/StemSplitio/htdemucs-onnx/resolve/d54ed9eb60e258ea82131c6ee14578628816456a/htdemucs_fp16weights.onnx','sha256':SOURCE_SHA},'modelBytes':len(raw),'modelSha256':sha(raw),'nodes':len(core.graph.node),'input':{'name':'mix','shape':[1,2,343980],'type':'float32'},'outputs':outputs,'sampleRate':44100,'segmentSamples':343980,'stems':['drums','bass','other','vocals'],'reconstruction':{'fftSize':4096,'hopLength':1024,'window':'hann-periodic','normalization':'ortho','crop':3584,'length':343980,'formula':'stems = time + inverseStft(spectra)'},'shards':shards}
(OUT/'demucs-gpu-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'modelBytes':len(raw),'modelSha256':sha(raw),'nodes':len(core.graph.node),'shards':len(shards),'output':str(OUT/'demucs-gpu-manifest.json')},indent=2))
