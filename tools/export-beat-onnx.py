#!/usr/bin/env python3
"""Convert pinned MIT Beat This! small0; no training/audio needed for export.
Reproduce: uv pip install --python .model-venv/bin/python onnx==1.19.1 onnxruntime==1.23.2
.model-venv/bin/python tools/export-beat-onnx.py
"""
from pathlib import Path
import hashlib,json,time
import numpy as np
import torch
from beat_this.inference import load_model, LogMelSpect
ROOT=Path(__file__).resolve().parent.parent
CHECKPOINT=ROOT/'.model-cache/beat_this-small0.ckpt'
SHA='6074be2c4d490c5f6101fcc374a1ec72ae93456e23bb6019783b849f5dc7d47b'
assert hashlib.sha256(CHECKPOINT.read_bytes()).hexdigest()==SHA
OUT=ROOT/'public/models';OUT.mkdir(parents=True,exist_ok=True)
torch.set_num_threads(4)
model=load_model(str(CHECKPOINT),'cpu').eval()
# The rotary package's length cache must stay off when tracing dynamic shapes.
for module in model.modules():
 if hasattr(module,'cache_if_possible'):module.cache_if_possible=False
class Export(torch.nn.Module):
 def __init__(self):super().__init__();self.model=model
 def forward(self,spectrogram):
  p=self.model(spectrogram);return p['beat'],p['downbeat']
wrapper=Export().eval();sample=torch.randn(1,1500,128)
path=OUT/'beat-this-small0.onnx'
torch.onnx.export(wrapper,(sample,),str(path),opset_version=17,dynamo=False,input_names=['spectrogram'],output_names=['beat_logits','downbeat_logits'],dynamic_axes={'spectrogram':{1:'frames'},'beat_logits':{1:'frames'},'downbeat_logits':{1:'frames'}},do_constant_folding=True)
# Export actual torchaudio Slaney bank; avoids independently approximating it.
mel=LogMelSpect();bank=mel.spect_class.mel_scale.fb.cpu().numpy().astype('<f4');(OUT/'beat-this-mel.f32').write_bytes(bank.tobytes())
import onnxruntime as ort
session=ort.InferenceSession(str(path),providers=['CPUExecutionProvider']);checks=[]
for frames in [100,511,1500]:
 x=torch.randn(1,frames,128)
 with torch.inference_mode():expected=wrapper(x)
 got=session.run(None,{'spectrogram':x.numpy()});error=max(float(np.max(abs(a.numpy()-b)))for a,b in zip(expected,got));checks.append({'frames':frames,'maxAbsLogitError':error});assert error<.001,checks
manifest={'id':'beat-this-small0','name':'Beat This! small0','license':'MIT','source':'https://github.com/CPJKU/beat_this','checkpointSha256':SHA,'sampleRate':22050,'fftSize':1024,'hopLength':441,'melBins':128,'melFile':'beat-this-mel.f32','melShape':list(bank.shape),'window':'hann-periodic','centerPadding':'reflect','normalization':'frame_length','power':1,'logMultiplier':1000,'chunkFrames':1500,'borderFrames':6,'overlapMode':'keep_first','opset':17,'validation':checks,'files':{f.name:{'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()}for f in [path,OUT/'beat-this-mel.f32']}}
(OUT/'beat-this-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest,indent=2))
