/** MIT-derived HTDemucs reconstruction. Mirrors StemSplit RealISTFT's
 * normalized 4096-point inverse, periodic Hann, squared-window overlap-add,
 * center crop2048 plus Demucs crop1536. No musical/grid timing correction. */
import {fft} from './dsp.js';
export const DEMUCS_CORE_OUTPUTS={spectra:'/Pad_2_output_0',time:'/Add_4_output_0'};
export const DEMUCS_SPECTRA_SHAPE=[1,4,2,2,2049,340];
export const DEMUCS_TIME_SHAPE=[1,4,2,343980];
/** Input contiguous [channels,realimag,bins,frames], output [channels,length]. */
export function inverseStft(spectra,{channels,frames,fftSize=4096,hopLength=1024,length,crop=3584}){
 const bins=fftSize/2+1;
 if(!Number.isInteger(Math.log2(fftSize))||!(frames>0&&channels>0&&length>0)||spectra.length!==channels*2*bins*frames)
  throw new Error('Invalid neural inverse-STFT tensor dimensions.');
 if(crop<0||crop+length>(frames-1)*hopLength+fftSize)throw new Error('Inverse-STFT crop lies outside reconstruction.');
 const window=Float64Array.from({length:fftSize},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/fftSize));
 const envelope=new Float64Array(length);
 for(let frame=0;frame<frames;frame++){
  const start=frame*hopLength-crop,first=Math.max(0,-start),last=Math.min(fftSize,length-start);
  for(let i=first;i<last;i++)envelope[start+i]+=window[i]**2;
 }
 const output=new Float32Array(channels*length),real=new Float64Array(fftSize),imag=real.slice(),normalization=1/Math.sqrt(fftSize);
 for(let channel=0;channel<channels;channel++){
  const base=channel*2*bins*frames,offset=channel*length,sum=new Float64Array(length);
  for(let frame=0;frame<frames;frame++){
   for(let bin=0;bin<bins;bin++){
    const r=spectra[base+bin*frames+frame],im=(bin===0||bin===bins-1)?0:spectra[base+(bins+bin)*frames+frame];
    real[bin]=r;imag[bin]=-im; // FFT(conjugate(z)) gives real inverse samples.
    if(bin>0&&bin<bins-1){real[fftSize-bin]=r;imag[fftSize-bin]=im;}
   }
   // Existing audio FFT bit-reverses its real-input array only. Permute the
   // nonzero imaginary input too before its butterfly pass.
   for(let i=1,j=0;i<fftSize;i++){let bit=fftSize>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j)[imag[i],imag[j]]=[imag[j],imag[i]];}
   fft(real,imag);
   const start=frame*hopLength-crop,first=Math.max(0,-start),last=Math.min(fftSize,length-start);
   for(let i=first;i<last;i++)sum[start+i]+=real[i]*window[i]*normalization;
  }
  for(let i=0;i<length;i++)output[offset+i]=sum[i]/Math.max(1e-11,envelope[i]);
 }
 return output;
}
/** Fixed core graph: spectra[1,4,2,2,2049,340], time[1,4,2,343980]. */
export function reconstructNeuralStems(spectra,time){
 spectra=spectra.data??spectra;time=time.data??time;
 if(time.length!==4*2*343980)throw new Error('Invalid neural time-branch dimensions.');
 const result=inverseStft(spectra,{channels:8,frames:340,length:343980});
 for(let i=0;i<result.length;i++)result[i]+=time[i];
 return result;
}
