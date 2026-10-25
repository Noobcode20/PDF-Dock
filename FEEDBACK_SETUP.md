# GitHub issue reporting setup

PDF Dock has two report delivery paths:

- **Connected GitHub account:** GitHub Device Flow signs the reporter in. PDF Dock stores the access token encrypted with Electron `safeStorage` on that device and creates the issue in `Noobcode20/PDF-Dock` as the reporter.
- **No GitHub account:** the deployed Cloudflare Worker creates the issue through the PDF Dock GitHub App. The reporter does not need a GitHub login.

Neither path attaches PDFs, file paths, or document text. Reports include only the entered title/details, optional reproduction context, app version, and platform.

## What downloads need

Every packaged release must be built with these public GitHub Actions repository variables set:

| Variable | Purpose |
| --- | --- |
| `VITE_GITHUB_CLIENT_ID` | OAuth App client ID with Device Flow enabled. |
| `VITE_GITHUB_ISSUE_PROXY_URL` | HTTPS URL of the deployed issue Worker. |

The beta release workflow reads these variables during packaging. They are public client configuration, not secrets. Updating either value requires a new app build and release. For local development, put the same values in `.env.local`.

The beta workflow uses GitHub's built-in `GITHUB_TOKEN` with `contents: write` to publish release artifacts; no personal access token is needed.

## GitHub account reporting

The GitHub OAuth App must enable Device Flow and allow the `public_repo` scope. The target repository must have Issues enabled, and connected reporters need permission to create issues there. Disconnecting in PDF Dock deletes the encrypted token from that device. To revoke the OAuth grant, also remove PDF Dock under GitHub Settings → Applications → Authorized OAuth Apps.

## No-account Worker

The production Worker is `pdf-dock-issue-intake`. Its GitHub App installation should be limited to `Noobcode20/PDF-Dock` with **Issues: Read and write** and no unrelated permissions. The Worker keeps the App ID, installation ID, and private key in Cloudflare secrets, and uses the existing `REPORT_LIMITS` KV namespace for a best-effort limit of five reports per IP per hour.

To update the deployed Worker from a terminal, run `./deploy.sh` in `github-issues-worker/`. It prompts for the account ID and a Cloudflare API token scoped to this Worker, runs an access preflight, and invokes Wrangler. Do not paste the API token into chat or commit it. GitHub App secrets remain in Cloudflare and must never be added to this repository, `.env.local`, GitHub Actions, or the app build.

The public endpoint uses a honeypot and input limits. KV counters can race during concurrent requests, so this is a best-effort abuse limit rather than a strict rate limit. Monitor the issue queue and Worker usage.

## First-time provisioning or recovery

If a new environment must recreate the Worker, use the namespace ID already recorded in `github-issues-worker/wrangler.toml`; do not replace it with a placeholder. In the Cloudflare dashboard, set `GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID`, and the complete unencrypted PEM key as Worker secrets, then deploy a new Worker version. A missing or malformed private key causes issue submission to fail even if Wrangler reports a successful deploy. Keep the private key only in the Cloudflare secret named `GITHUB_APP_PRIVATE_KEY`.

After deployment, confirm both Actions variables above are configured before tagging the next beta. The repository is public, so release artifacts are available to anyone who downloads them. A new release is required for an already installed app to receive the feature and embedded configuration.
