# Background exports

The Export page builds the Complete Analysis ZIP, CSV, raw JSON and the Excel
request in a dedicated module Web Worker. The worker reads the saved result and
archive/source records directly from IndexedDB, avoiding synchronous cloning of
an annual result on the UI thread. A storage-message bridge supports older
localStorage records when IndexedDB does not contain them. Current project
settings remain separately identified from the frozen run snapshot.

The worker returns a Blob and small summary only. Object URLs replace large
data URLs. ZIP CRC computation uses the standard table-based CRC-32 algorithm;
ZIP member contents and names are unchanged. ZIP creation still stores entries
without compression and retains the classic ZIP size/file-count limits.

The page displays actual processing phases and archive file counts, rather than
an invented overall percentage. Progress rendering is throttled. Cancel export
terminates the worker; leaving the Export page also cancels it. Existing saved
results are never changed. Excel generation still runs on the backend; cancelling
the client worker does not promise to cancel a server-side workbook already in
progress. No blocking main-thread generation fallback is used if workers fail.

A saved result identity mismatch aborts export with a refresh instruction, so a
newer IndexedDB result cannot silently be downloaded under the old page's name.
Older records without an ID/timestamp retain their existing limited provenance.

Tests execute the actual worker entry through a Node worker-thread adapter,
including storage bridging, direct database access with a test IndexedDB adapter,
changed results, cancellation, errors, CSV values and standard CRC-32 vectors.
A representative 365-day/12-bus dataset produces a multi-megabyte ZIP while a
main-thread heartbeat continues. This is a worker responsiveness regression,
not a browser performance guarantee for every machine or arbitrarily large data.
Existing ZIP tests independently inspect archive members and contents.
