# Skywyrm dragon voice: render the Mandarin shouts in phrases.json, ring-
# announcer style (clear, bright, quick, emphatic). See README.md.
#   python3 make_voice.py [speaker] [out_dir]      (defaults: 82, ../../site/audio/voice/v2)
import json, os, re, subprocess, sys, tempfile
import numpy as np, soundfile as sf, sherpa_onnx, parselmouth
from parselmouth.praat import call

try:
    import imageio_ffmpeg
    FF = os.environ.get('FFMPEG') or imageio_ffmpeg.get_ffmpeg_exe()
except ImportError:
    FF = os.environ.get('FFMPEG', 'ffmpeg')
D = os.environ.get('KOKORO', 'kokoro-int8-multi-lang-v1_1') + '/'
SID = 82            # zm_ male voice: bright, the liveliest pitch, the clearest in tests
SPEED = 1.2         # quicker than normal speech
WIDEN = 1.2         # pitch swings 20% wider around the middle of the line...
LIFT = 1.0          # ...a semitone higher...
LAST = 1.2          # ...and the last syllable is held 20% longer
LUFS = -15.0


def tts():
    global _tts
    if '_tts' not in globals():
        cfg = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
            model=D + 'model.int8.onnx', voices=D + 'voices.bin', tokens=D + 'tokens.txt', data_dir=D + 'espeak-ng-data',
            dict_dir=D + 'dict', lexicon=D + 'lexicon-us-en.txt,' + D + 'lexicon-zh.txt'), num_threads=4),
            rule_fsts=D + 'date-zh.fst,' + D + 'phone-zh.fst,' + D + 'number-zh.fst')
        _tts = sherpa_onnx.OfflineTts(cfg)
    return _tts


def hype(x, sr):
    """Announcer delivery with Praat's PSOLA (it keeps the voice's formants,
    so a semitone up doesn't sound like a cartoon): a wider, higher pitch
    contour and a held last syllable."""
    snd = parselmouth.Sound(x.astype(np.float64), sampling_frequency=sr)
    man = call(snd, 'To Manipulation', 0.01, 75, 400)
    pt = call(man, 'Extract pitch tier')
    pts = [(call(pt, 'Get time from index', i + 1), call(pt, 'Get value at index', i + 1)) for i in range(call(pt, 'Get number of points'))]
    med = float(np.median([f for _, f in pts]))
    call(pt, 'Remove points between', 0, snd.duration)
    for t, f in pts:
        call(pt, 'Add point', t, med * 2 ** (LIFT / 12) * (f / med) ** WIDEN)
    call([pt, man], 'Replace pitch tier')
    if LAST != 1:
        # The last syllable starts at the deepest dip in loudness in the
        # back half of the line.
        it = snd.to_intensity(100)
        tv, iv = it.xs(), it.values[0]
        on = tv[iv > iv.max() - 25]
        a, b = on[0], on[-1]
        seg = (tv >= a + 0.55 * (b - a)) & (tv <= b - 0.08)
        cut = tv[seg][np.argmin(iv[seg])] if seg.any() else a + 0.7 * (b - a)
        dt = call(man, 'Extract duration tier')
        for t, k in [(cut - 0.01, 1.0), (cut + 0.03, LAST), (b, LAST), (b + 0.05, 1.0)]:
            call(dt, 'Add point', t, k)
        call([dt, man], 'Replace duration tier')
    return call(man, 'Get resynthesis (overlap-add)').values[0].astype(np.float32)


# Announcer EQ: matched to the ANSI S3.5-1997 shouted-speech spectrum plus
# +8 dB of close-mic chest at 160 Hz and below (fading out by 400 Hz), both
# normalised to equal power over 100 Hz-10 kHz. It's the smoothed gap
# between that target and this voice after the rest of the chain (speaker
# 82, the settings above), in third octaves, with boosts capped at +10 dB in
# 630 Hz-5 kHz and +6 dB elsewhere, and cuts at -6 dB. It fills the
# vocoder's hole at 1.6-2 kHz and trims the 160-250 Hz boom and the hiss
# above 6 kHz. Change the speaker or the chain and it must be measured again.
ANNOUNCER_EQ = ("firequalizer=gain_entry='entry(50,0.0);entry(63,-1.8);entry(80,-6.0);entry(100,-6.0);entry(125,-6.0);"
                'entry(160,-6.0);entry(200,-6.0);entry(250,-6.0);entry(315,-6.0);entry(400,-3.1);entry(500,0.0);entry(630,3.5);'
                'entry(800,6.8);entry(1000,8.6);entry(1250,10.0);entry(1600,10.0);entry(2000,10.0);entry(2500,7.7);entry(3150,2.3);'
                "entry(4000,-0.9);entry(5000,-2.2);entry(6300,-4.8);entry(8000,-6.0);entry(10000,-6.0);entry(12500,-4.6)'")


def fx():
    # Clear and punchy: cut the rumble (and the TTS's DC offset) below
    # 120 Hz, notch the vocoder's steady 4.8 and 9.6 kHz whine, thin the boxy
    # mids, lift the consonants (presence at 3 kHz, air above 6 kHz),
    # compress and saturate lightly for punch, then the announcer EQ.
    return ('highpass=f=120:poles=2,highpass=f=120:poles=2,'
            'equalizer=f=4800:t=h:w=120:g=-30,equalizer=f=9600:t=h:w=200:g=-30,'
            'equalizer=f=320:t=q:w=1:g=-3,equalizer=f=3200:t=q:w=0.9:g=6,treble=g=2:f=6500,'
            'acompressor=threshold=-22dB:ratio=3:attack=4:release=90:knee=4:makeup=5,'
            'volume=3dB,asoftclip=type=tanh:oversample=4,lowpass=f=11500,' + ANNOUNCER_EQ + ','
            'silenceremove=start_periods=1:start_threshold=-45dB,apad=pad_dur=0.25')


def ff(args):
    return subprocess.run([FF, '-hide_banner', '-nostats', '-y'] + args, check=True, capture_output=True, text=True).stderr


def lufs(path):
    return float(re.findall(r'I:\s+(-?[\d.]+) LUFS', ff(['-i', path, '-af', 'ebur128', '-f', 'null', '-']))[-1])


def render(zh, dst, tmp):
    a = tts().generate(zh, sid=SID, speed=SPEED)
    raw, wet = f'{tmp}/raw.wav', f'{tmp}/fx.wav'
    sf.write(raw, hype(np.array(a.samples, dtype=np.float32), a.sample_rate), a.sample_rate, subtype='FLOAT')
    ff(['-i', raw, '-af', fx(), '-c:a', 'pcm_f32le', wet])
    # Loudness: a gain to the target and a limiter for the peaks, then the
    # gain again (a few times) for whatever the limiter took.
    gain = LUFS - lufs(wet)
    for _ in range(4):
        ff(['-i', wet, '-af', f'volume={gain:.2f}dB,alimiter=limit=0.8:attack=3:release=40:level=false', '-ac', '1', '-ar', '32000',
            '-c:a', 'libmp3lame', '-b:a', '72k', dst])
        gain += LUFS - lufs(dst)


if __name__ == '__main__':
    if len(sys.argv) > 1: SID = int(sys.argv[1])
    OUT = sys.argv[2] if len(sys.argv) > 2 else '../../site/audio/voice/v2'
    os.makedirs(OUT, exist_ok=True)
    P = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'phrases.json')))
    with tempfile.TemporaryDirectory() as tmp:
        for ev, rows in P.items():
            for i, (zh, py, en) in enumerate(rows):
                dst = f'{OUT}/{ev}-{i}.mp3'
                render(zh, dst, tmp)
                print(ev, i, zh, f'{lufs(dst):.1f} LUFS', os.path.getsize(dst), 'bytes', flush=True)
