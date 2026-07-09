import { maybeUploadDue } from "../telemetry/auto-upload.js";

export function scheduleAutoUploadDue(opts: { sqlitePath: string; repoPath: string }): void {
  void maybeUploadDue({ sqlitePath: opts.sqlitePath, repoPath: opts.repoPath })
    .then((result) => {
      if (!result.ok && result.error) {
        console.error(`traceback-telemetry: auto-upload failed: ${result.error}`);
      }
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`traceback-telemetry: auto-upload crashed: ${message}`);
    });
}
