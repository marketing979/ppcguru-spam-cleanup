# PPC Guru Spam Index Cleanup MVP

This tool turns suspected hacked URLs into an auditable review queue, verifies live HTTP status, and submits explicitly approved exact/prefix requests through Google Search Console's Temporary Removals UI. Google does not expose Temporary Removals through the Search Console API, so the approved worker uses a dedicated local browser profile.

## Run the dashboard

Node.js 20+ is required. No package installation is needed.

```powershell
cd C:\Users\shrik\Documents\Codex\2026-08-28\files-pasted-by-the-user-yesterday\outputs\ppcguru-spam-cleanup
npm start
```

Open `http://127.0.0.1:4310`, paste one URL per line, and select **Check live HTTP status** when the computer can reach `ppcguru.ca`.

## Run the CLI

```powershell
npm run analyze -- --input sample\urls.txt --check-http --out ppcguru-report.json
```

Optional arguments are `--allowlist allowlist.txt`, `--legitimate-urls sitemap-urls.txt`, and `--config config/default.json`.

## Safety behavior

- External domains are rejected.
- Protected sections are never proposed for removal.
- Keywords alone never mark a URL ready.
- Readiness requires a score of at least 80 and an observed 404 or 410.
- Every prefix suggestion requires human approval.
- This release never submits a GSC removal.

Before real use, replace the starter protected prefixes in `config/default.json` with a complete list derived from PPC Guru's legitimate sitemap.

## Production workflow

1. Run `npm start` and analyze candidate URLs with live HTTP checks enabled.
2. Add ready entries to the persistent queue and manually approve each request.
3. Create the dedicated Google session once with `npm run gsc:login`.
4. Inspect eligible work with `npm run gsc:dry-run`.
5. Generate optional reviewed Nginx rules with `npm run rules`.
6. Execute a small approved batch from PowerShell:

```powershell
$env:GSC_EXECUTION_CONFIRMATION = "PPGURU_APPROVED"
npm run gsc:execute -- --limit=10
```

The worker uses `data/gsc-browser-profile`, keeps an audit trail in `data/registry.json`, stops on the first Search Console UI failure, and saves a diagnostic screenshot. Always test one request after a long pause because Google can change the interface.

The hosted dashboard can hold the queue while `run-worker.ps1` performs authenticated GSC work on Windows. Shared hosting does not need Chrome; keep the worker token private.
