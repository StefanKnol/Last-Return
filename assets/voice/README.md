# Voice recordings go here

Put one audio file per line in this folder, named after the line: `leftLift.mp3`, `firstSpool.mp3`, and so on.
The full list, with the exact words and how to say them, is in [`docs/voice-lines.md`](../../docs/voice-lines.md).

`npm run build` packs every `.mp3`, `.wav`, `.ogg` or `.m4a` file here into `index.html`.
Lines without a file stay text only.
