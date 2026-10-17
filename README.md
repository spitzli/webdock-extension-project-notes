# Project Notes

Project-scoped notes and reminders for Webdock. Kind: `extension`.

- Create, edit and delete notes in a project overview panel.
- Optimistic revisions prevent overwriting someone else's edits.
- Reminders appear as **due** in the panel. No email or external notifications.
- Core PostgreSQL storage, RLS and BullMQ; no database or Redis credentials in the plugin.
- Pending reminders are retained in the note document. A declared 60-second reconciliation job repairs missed delivery, including exhausted retries.

## Current status

Working local authoring implementation, not a published or production-installable release. The production Webdock installer, full invocation transport and host UI integration remain release gates. No registry release or OCI image has been published.

The manifest's all-zero image digest is an authoring placeholder. Replace it with the actual built OCI digest before packing a real release. The SDK packages are not published to npm yet.

## Build and test

From the Webdock repository, build and pack `@webdock/plugin-sdk` and `@webdock/cli`. Then in this repository:

```sh
npm install --no-save --package-lock=false --ignore-scripts /path/to/webdock-plugin-sdk-0.1.0.tgz /path/to/webdock-cli-0.1.0.tgz
npm run build
npm test
./node_modules/.bin/webdock plugin validate
```

The Webdock checkout supplies `tools/plugins/project-notes-host.ts`. It requires its explicitly created local PostgreSQL RLS fixture and a disposable Redis port:

```sh
WEBDOCK_TEST_REDIS_PORT=<local-port> node --import tsx tools/plugins/project-notes-host.ts /path/to/webdock-extension-project-notes --smoke
```

Without `--smoke`, it prints a loopback URL for browser testing. The local host binds actual restricted database roles and Core APIs to fixture identities, runs this plugin in a separate process, and embeds `/ui/notes` in a sandboxed iframe. It is not a substitute for the production installer.

## Runtime contract

Port 8080; `/healthz`, `/readyz`, `/webdock/actions`, `/webdock/jobs`, `/ui/notes`. The local runtime needs `WEBDOCK_PLUGIN_HOST_URL` and a 32+ character `WEBDOCK_PLUGIN_RUNTIME_TOKEN`. Bind defaults to loopback; the Dockerfile explicitly sets `HOST=0.0.0.0` inside a container. The host supplies an invocation token per backend call. No host token enters the frame.

Actions: `notes.list`, `notes.save`, `notes.delete`.
Jobs: `notes.remind`, `notes.reconcile`.

Limits: 100 notes, title 100 characters, text 5000 characters, total project document 24 KiB, reminders at most seven days ahead. The smaller document cap keeps action/frame responses below 32 KiB. Save/delete require the document revision and an idempotency request ID. Editing or deleting a note invalidates old reminder versions.

The container recipe assumes resolvable SDK dependencies and an npm lockfile produced for the chosen release. Container-image publication and registry submission are intentionally separate from local compilation/testing.
