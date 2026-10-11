# Fonts

Self-hosted so the game makes no requests to other sites. Both are under the
SIL Open Font License 1.1 (OFL.txt).

| File | Font | What's in it |
|---|---|---|
| `cinzel-600.woff2`, `cinzel-700.woff2` | Cinzel SemiBold / Bold (The Cinzel Project Authors) | Latin: U+0020–007E, U+00A0–00FF, U+2000–206F |
| `ma-shan-zheng.woff2` | Ma Shan Zheng (The MaShanZheng Project Authors) | Only the characters listed in `ma-shan-zheng.txt` |

Ma Shan Zheng has simplified characters only, so traditional ones such as 龍
fall back to the system's Kai font.

**Adding Chinese text?** `npm run assets` fails if a character isn't in the
subset. Add it to `ma-shan-zheng.txt`, rebuild, and bump the `?v=` on the
font's `url()` in `style.css`:

```sh
pip install fonttools brotli
npm pack @expo-google-fonts/ma-shan-zheng && tar -xzf expo-google-fonts-ma-shan-zheng-*.tgz
pyftsubset package/400Regular/MaShanZheng_400Regular.ttf --text-file=site/fonts/ma-shan-zheng.txt \
  --layout-features='*' --flavor=woff2 --output-file=site/fonts/ma-shan-zheng.woff2
```

Cinzel was built the same way from `@expo-google-fonts/cinzel` with
`--unicodes='U+0020-007E,U+00A0-00FF,U+2000-206F'`.
