import json, subprocess, sys, os, numpy as np, soundfile as sf, sherpa_onnx, imageio_ffmpeg
FF = imageio_ffmpeg.get_ffmpeg_exe()
D = 'kokoro-int8-multi-lang-v1_1/'
cfg = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
    model=D + 'model.int8.onnx', voices=D + 'voices.bin', tokens=D + 'tokens.txt', data_dir=D + 'espeak-ng-data',
    dict_dir=D + 'dict', lexicon=D + 'lexicon-us-en.txt,' + D + 'lexicon-zh.txt'), num_threads=4), rule_fsts=D + 'date-zh.fst,' + D + 'phone-zh.fst,' + D + 'number-zh.fst')
tts = sherpa_onnx.OfflineTts(cfg)
SID = int(sys.argv[1]); OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)
P = json.load(open('phrases.json'))
# Warrior-dragon voice: -4 semitones, a sub-octave growl layer, bass, soft saturation, cavern echo.
FX = ("[0:a]asplit=2[a][b];"
      "[a]asetrate=24000*0.8,aresample=24000,atempo=1.25[main];"
      "[b]asetrate=24000*0.5,aresample=24000,atempo=2.0,lowpass=f=900,volume=0.5[sub];"
      "[main][sub]amix=inputs=2:normalize=0:duration=longest,bass=g=6:f=110,equalizer=f=2500:t=q:w=1:g=3,lowpass=f=7500,"
      "asoftclip=type=tanh,aecho=0.8:0.55:55|110:0.22|0.12,loudnorm=I=-15:TP=-1.5:LRA=7,"
      "silenceremove=start_periods=1:start_threshold=-45dB,apad=pad_dur=0.25")
for ev, rows in P.items():
    for i, (zh, py, en) in enumerate(rows):
        a = tts.generate(zh, sid=SID, speed=0.88)
        raw = f'{OUT}/_{ev}{i}.wav'
        sf.write(raw, np.array(a.samples, dtype=np.float32), a.sample_rate)
        dst = f'{OUT}/{ev}-{i}.mp3'
        subprocess.run([FF, '-y', '-loglevel', 'error', '-i', raw, '-filter_complex', FX, '-ac', '1', '-ar', '32000', '-c:a', 'libmp3lame', '-b:a', '72k', dst], check=True)
        os.remove(raw)
        print(ev, i, zh, os.path.getsize(dst), 'bytes')
