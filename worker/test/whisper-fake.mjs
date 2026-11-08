// What whisper-cli -oj writes, for the tests that stand in for it.
/** whisper-cli's JSON in its own layout (tabs, one value per line). segments: [fromMs, toMs, text]. */
export function whisperJson(language, segments) {
  const items = segments.map(
    ([from, to, text]) =>
      `\t\t{\n\t\t\t"timestamps": {\n\t\t\t\t"from": "x",\n\t\t\t\t"to": "y"\n\t\t\t},\n\t\t\t"offsets": {\n\t\t\t\t"from": ${from},\n\t\t\t\t"to": ${to}\n\t\t\t},\n\t\t\t"text": "${text}"\n\t\t}`,
  );
  return `{\n\t"systeminfo": "AVX = 1 | AVX2 = 1",\n\t"params": {\n\t\t"model": "speech.bin",\n\t\t"language": "auto",\n\t\t"translate": false\n\t},\n\t"result": {\n\t\t"language": "${language}"\n\t},\n\t"transcription": [\n${items.join(",\n")}\n\t]\n}\n`;
}
