# Skywyrm dragon voice

The Mandarin shouts in `site/audio/voice/v2/` are rendered offline from
`phrases.json` (8 events × 3 phrases; captions in `site/js/voice.js`
must match). The delivery is a pro-wrestling ring announcer: bright, quick
and emphatic, so the words are easy to make out over the music.

- Voice: Kokoro v1.1-zh (Apache-2.0), speaker 82 (a lively male voice),
  speed 1.2, run with [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx).
- Delivery (Praat's PSOLA via [parselmouth](https://github.com/YannickJadoul/Parselmouth),
  which keeps the formants): the pitch contour swings 20% wider around its
  middle and sits a semitone higher, and the last syllable is held 20%
  longer.
- Processing (ffmpeg): high-pass at 120 Hz (24 dB/octave; it also removes
  the TTS's DC offset), notches at 4.8 and 9.6 kHz (a steady whine from the
  TTS vocoder), −3 dB at 320 Hz, +6 dB at 3.2 kHz, +2 dB above 6.5 kHz,
  light compression (3:1) and tanh saturation for punch, then the
  announcer EQ, then a gain to −15 LUFS with a peak limiter (true peak
  under −1.5 dBTP); mono 32 kHz MP3 at 72 kb/s (~13 KB each).
- Announcer EQ: matched to ANSI S3.5 shouted-speech spectrum + close-mic
  chest; see make_voice.py. It's measured for this speaker and chain, so
  measure it again if either changes.

To re-render (e.g. after changing a phrase), from `notes/voice/`:

```sh
pip install sherpa-onnx soundfile numpy praat-parselmouth imageio-ffmpeg
curl -LO https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2
tar xjf kokoro-int8-multi-lang-v1_1.tar.bz2
python3 make_voice.py 82 ../../site/audio/voice/v3
```

The clips are fetched without a `?v=` stamp, so a re-render goes in a new
folder: point `CLIPS` in `site/js/voice.js` at it, delete the old folder
and run `npm run stamps:fix`. If you change the words, update `PHRASES` in
`voice.js` too, and add any new Chinese characters to the font subset
(`site/fonts/README.md`).

## How v2 was chosen (October 2026)

v1 used speaker 60 pitched down 4 semitones, with a sub-octave growl, a
bass boost and a cavern echo. Its energy sat almost all below 300 Hz (and
a large DC offset kept it at −19 LUFS), so the words were hard to make out.
Clarity was checked without listening by transcribing every clip with a
Mandarin speech recogniser (sherpa-onnx Paraformer) and counting wrong
syllables (tones ignored):

| | v1 | v2 |
|---|---|---|
| Syllables misheard | 14% | 1% |
| Spectral centroid | 142 Hz | 1085 Hz |
| Energy above 2 kHz | 0.2% | 15% |
| Energy below 120 Hz | 61% | 1% |
| Pitch (median) | 81 Hz | 165 Hz |
| Speaking rate | 3.3 syllables/s | 3.8 syllables/s |
| Loudness | −19 LUFS | −15 LUFS |

Speaker 82 was picked from the 45 male Kokoro voices (58–102) for the
widest pitch swing (about 18 semitones from low to high, against 10 for
speaker 60) with almost no misheard syllables; 76 (quicker) and 89
(higher) were close runners-up. An echo cost a few misheard syllables, so
v2 is dry.
