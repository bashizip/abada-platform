# M6 task specifications — 1.2.x

The tasks of the release after 1.2.0. The roadmap lists them; this file holds
what each one means. New features only: nothing deferred from 1.2.0 lands here.

---

## N1 — Office and text files as agent input

**Goal.** An agent node reads the documents regulated organisations actually
exchange, not only scans: spreadsheets (payroll lists, employer declarations,
bank statements), Word documents (letters, contracts) and plain-text exports.
The S15 contract stays as it is: files declared in `files`, checked when the
work is locked, verified by sha256, never journaled or logged, typed errors
instead of silent cuts.

**Why.** S15 covers images and PDF, which the model providers read directly.
Most providers do not accept Office files on the chat API Abada uses (OpenAI's
Chat Completions takes only PDF as a file part), so supporting them means
converting first. Converting is also the better design: a model reads a
spreadsheet far more accurately as rows of text than as a picture, at a
fraction of the tokens, and a conversion that runs on the installation's own
servers keeps the sovereignty promise (only the extracted content reaches the
model).

**Formats.**

| Format | Content types | Sent to the model as |
| --- | --- | --- |
| Plain text | `text/plain`, `text/csv`, `application/json`, `text/markdown` | text, inside a `<document>` block, no conversion |
| Excel | `.xlsx` (and `.xls` if the converter supports it) | structured text: one block per sheet, header row and rows as CSV or JSON rows |
| Word | `.docx` (and `.doc`, `.odt` if the converter supports it) | text with headings and tables kept, or PDF where the provider reads PDF |
| OpenDocument | `.ods`, `.odt` | as Excel and Word |

Audio, video, archives and macros are out of scope.

**Where the conversion runs.** On the installation's infrastructure only,
never at the model provider. Two options to decide at the start of the task:

1. In the agent worker, with Java libraries (Apache POI for Excel and Word,
   a CSV writer): no new service, bounded memory per file.
2. A converter service in the Compose stack (LibreOffice headless) that the
   worker calls on the local network: broader format coverage, one more
   service to run and secure.

Either way: no macro or external link is evaluated, conversion has a time
limit and a size limit, and a file that fails to convert is a typed error.

**Limits.** Per file and per call, configurable by the operator: at most N
sheets, N rows per sheet, N characters of converted text (defaults to set in
the task). Over a limit is `AGENT_FILE_LIMIT`, never a truncated document sent
as if it were whole.

**Errors.**
- `AGENT_FILE_UNSUPPORTED`: the format is not one the installation converts.
- `AGENT_FILE_CONVERSION_FAILED`: the converter could not read the file
  (corrupt, encrypted, password-protected), or ran out of time.
- `AGENT_FILE_LIMIT`: as in S15, plus the conversion limits above.

**Evidence.** For a converted file, the step journal keeps two hashes: the
sha256 of the original file (as S15) and the sha256 of the converted content
the model read, with the converter's name and version. An auditor can prove
both what was uploaded and exactly what the agent saw. The converted content
itself follows the evidence payload policy (`none`, `redacted`, `full`); the
original bytes are never journaled.

**Engine.** `files` accepts the new content types; deployment unchanged. The
lock-time checks of S15 are unchanged. The provider capability table in the
worker gains a "sent as text" family that every provider accepts.

**Studio.** The *Files* section lists the new accepted types and says when a
file is converted before the model reads it; the agent-step inspector shows
both hashes.

**Acceptance tests.**
- A CSV and a JSON file reach a stub model as text.
- An `.xlsx` with two sheets reaches it as two structured blocks with exact
  cell values (numbers, dates, empty cells).
- A `.docx` with a table keeps the table's rows.
- An encrypted or corrupt file, and a file over each limit, fail with the
  typed code.
- No original bytes in the journal or the logs; both hashes in the evidence.
- A macro-enabled file runs no macro.
- End to end: an employer declaration spreadsheet uploaded in a human task is
  read by an agent, its totals pass `output_schema`, and the evidence shows
  both hashes.

**Documentation.** `process-files.md` (formats, where conversion runs,
limits), the APL reference for `files`, the user guide section *Let an agent
read a document*, and one example process reading a spreadsheet.
