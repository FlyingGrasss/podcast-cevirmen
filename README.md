# Podcast Çevirmen

A small TypeScript CLI that translates English podcast transcripts into Turkish
without moving subtitle timings. It reads and writes SRT, WebVTT, plain text and
a minimal JSON format, and works with any OpenAI-compatible chat completions
endpoint — or entirely offline in demo mode.

No framework, no runtime dependencies. Node's built-in type stripping runs the
TypeScript sources directly; `tsc` produces the `dist/` build.

## Requirements

- Node.js 26 or newer
- pnpm

## Install

```bash
pnpm install
```

## Usage

```bash
pnpm translate --input podcast.srt --output podcast.tr.srt --target tr
```

Options:

| Option | Description |
| --- | --- |
| `--input <path>` | Input file: `.srt`, `.vtt`, `.txt` or `.json` (required) |
| `--output <path>` | Output file: `.srt`, `.vtt`, `.txt` or `.json` (required) |
| `--target <lang>` | Target language. Only `tr` is supported; default `tr` |
| `--provider <name>` | `auto` (default), `openai` or `demo` |
| `--glossary <path>` | Glossary JSON file |
| `--split-long` | Split long Turkish cues at sentence boundaries |
| `-h`, `--help` | Print usage |

Input and output extensions are independent, so `podcast.txt → out.srt`,
`podcast.vtt → out.json`, and similar conversions work. Timings are carried in
integer milliseconds internally. Files are read as UTF-8.

## Formats

| Format | Reading | Writing |
| --- | --- | --- |
| SRT | Index, comma timestamps, multi-line text | Cue indices renumbered from 1; exact millisecond timings |
| WebVTT | `WEBVTT` header, optional cue ids, `.mmm` timestamps, MM:SS or HH:MM:SS | Cue ids preserved (suffixed if a cue is split); timestamps normalized to HH:MM:SS.mmm |
| TXT | Blank-line-separated paragraphs | Paragraphs separated by a blank line |
| JSON | `{"segments":[{"start":1.25,"end":3.5,"text":"..."}]}`; seconds | Same shape; seconds with millisecond precision |

SRT text lines and times are preserved exactly on an SRT → SRT round trip.
WebVTT notes, styles, regions and cue settings are ignored; cue text and ids are
kept. JSON uses seconds because it has no subtitle timestamp syntax.

Plain text has no timing data. For TXT input each paragraph gets deterministic
estimated timings (2.5 words/second, minimum 2 seconds, 300 ms gap) so it can be
written as SRT, VTT or JSON. These are estimates, not real alignment.

## Translation providers

### OpenAI-compatible endpoint

Set all three variables in your shell:

```bash
export OPENAI_BASE_URL="https://api.openai.com/v1"
export OPENAI_API_KEY="sk-..."
export OPENAI_MODEL="gpt-4o-mini"

pnpm translate --input podcast.srt --output podcast.tr.srt
```

PowerShell:

```powershell
$env:OPENAI_BASE_URL = "https://api.openai.com/v1"
$env:OPENAI_API_KEY = "sk-..."
$env:OPENAI_MODEL = "gpt-4o-mini"
```

The CLI sends `POST {OPENAI_BASE_URL}/chat/completions` with a bearer token. A
base URL already ending in `/chat/completions` is accepted unchanged. Any
provider that implements that request/response shape can be used. `.env` files
are **not** loaded automatically.

Translation behavior:

- 20 segments per request.
- The previous 3 translated segments are sent as context for the next batch.
- `temperature: 0.2`.
- System prompt: natural Turkish, spoken language, subtitle-length friendly
  (`doğal Türkçe, konuşma dili, altyazı uzunluğuna uygun`).
- Responses are expected as `[{"id":0,"text":"..."}]`; code fences and an
  object with `segments`/`translations` are tolerated.
- 429, 5xx and network failures are retried up to 3 times with exponential
  backoff (500 ms, 1 s, 2 s; `Retry-After` is honored). Other HTTP errors fail
  immediately.

### Demo mode (no API keys)

If `OPENAI_BASE_URL`, `OPENAI_API_KEY` or `OPENAI_MODEL` is missing, the tool
prints a warning and keeps the source text, prefixing every segment with
`[DEMO] `:

```text
1
00:00:00,000 --> 00:00:04,200
[DEMO] Welcome back to the podcast.
```

Timings are untouched. `--provider demo` forces this behavior. `--provider
openai` still falls back to demo mode when the environment is incomplete, as
required for keyless use.

Try it:

```bash
pnpm translate --input examples/sample.srt --output out.srt --glossary examples/glossary.json
```

In demo mode the source text stays English, so the glossary post-check will also
warn that the demo output still contains those terms. That is expected; the
warnings become meaningful once a real provider produces Turkish.

## Glossary

```json
{
  "machine learning": "makine öğrenmesi",
  "AI": "yapay zeka"
}
```

```bash
pnpm translate --input podcast.srt --output podcast.tr.srt --glossary glossary.json
```

The glossary is appended to the system prompt as translation instructions.
After translation, the tool warns when a source term still appears
untranslated in the Turkish output, for example:

```text
[warning] Cue 2: glossary term "machine learning" appears untranslated; expected "makine öğrenmesi".
```

Warnings are advisory; the output is still written. Matching is
case-insensitive and whole-word aware. Empty terms and non-string values are
rejected.

## Cue length and `--split-long`

An English source cue can become longer in Turkish. After translation the tool
warns when:

- a line exceeds 42 characters, or
- a cue has more than 2 lines.

`--split-long` splits an over-long cue at sentence boundaries and reflows the
pieces into lines of at most 42 characters. **Each resulting cue keeps the
original start and end timestamp.** The tool deliberately does not redistribute
time between the pieces, because the brief requires cue boundaries never to
move. This means split cues overlap in players; use the flag when readability
inside the existing timing window matters more than non-overlap.

## Whisper (not implemented)

Audio transcription is intentionally out of scope. There is no `--whisper`
implementation; passing it exits with a pointer to this workflow.

Use an external Whisper tool first, then translate the produced SRT:

```bash
# OpenAI Whisper CLI
whisper episode.mp3 --language en --model medium --output_format srt --output_dir .

# or whisper.cpp
./build/bin/whisper-cli -m models/ggml-medium.bin -l en -osrt -f episode.wav

pnpm translate --input episode.srt --output episode.tr.srt
```

## Development

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # node:test, no network
pnpm build       # tsc -> dist/
node dist/cli.js --help
```

Tests cover SRT/VTT/JSON/TXT round trips, long-cue splitting, glossary
warnings, demo mode, OpenAI request batching/context with an injected fake
fetch, the system prompt, retry classification and response parsing. No API
calls are made by the suite.

Exit codes: `0` on success (including warnings), `1` on invalid arguments,
parse/I/O errors or failed API requests.

## Limitations

- No audio decoding, transcription, alignment or diarization; Whisper must run
  first.
- Only Turkish (`tr`) is implemented.
- Context is limited to the previous 3 translated cues, and requests are
  batched by 20, so document-wide terminology and tone can drift.
- TXT timings are synthetic estimates.
- Split cues share the original timing window; timings are not redistributed.
- WebVTT `NOTE`/`STYLE`/`REGION` blocks and cue settings are not preserved.
- JSON keeps millisecond precision; sub-millisecond values are rounded.
- Glossary checks are exact whole-word matches, not fuzzy or morphological
  (Turkish suffixes on a source term will not be detected).
- Glossary warnings do not trigger an automatic retranslation.
- Speaker labels, karaoke word timings, styling and HTML tags are not handled
  specially.
