# Wyrm dragon voice

The Mandarin shouts in `docs/wyrm/audio/voice/` are rendered offline from
`phrases.json` (8 events × 3 phrases; captions in `docs/wyrm/js/voice.js`
must match).

- Voice: Kokoro v1.1-zh (Apache-2.0), speaker 60 (a low male voice),
  run with [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx).
- Processing (ffmpeg): −4 semitones, a sub-octave growl layer at half
  volume, bass boost, soft saturation, a short cavern echo, loudness
  normalised to −15 LUFS; mono 32 kHz MP3 at 72 kb/s (~14 KB each).

To re-render (e.g. after changing a phrase):

```sh
pip install sherpa-onnx soundfile numpy imageio-ffmpeg
curl -LO https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2
tar xjf kokoro-int8-multi-lang-v1_1.tar.bz2
python3 make_voice.py 60 ../../docs/wyrm/audio/voice
```

Then update `PHRASES` in `docs/wyrm/js/voice.js` and bump its `?v=` stamp.
