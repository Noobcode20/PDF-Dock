# GitHub issue reporting setup

PDF Dock now sends all reports to GitHub Issues. Settings offers two paths:

- **Use my GitHub account:** Device Flow authorization; the reporter is the issue author. The user's token is encrypted with Electron `safeStorage` and is only used to create issues in `Noobcode20/PDF-Dock`.
- **No GitHub account:** a Cloudflare Worker creates the issue with a GitHub App installation token. The reporter does not need a GitHub login. The issue is authored by the PDF Dock GitHub App.

Neither path attaches PDFs, file paths, or document text. Both include the app version and platform.

## GitHub user-account flow

1. Create a GitHub OAuth App and enable Device Flow.
2. Set its homepage URL to the public PDF Dock repository URL. A callback URL is not used by Device Flow; set a valid placeholder if GitHub requires one.
3. Set `VITE_GITHUB_CLIENT_ID` in `.env.local` or the release build environment. It is a public client ID; no client secret is required for Device Flow.
4. Rebuild/package the app.

The OAuth App must allow the `public_repo` scope. The target repository must have Issues enabled, and a connected reporter must be able to create issues there.

Disconnecting in PDF Dock removes the encrypted token from that device. To revoke the OAuth grant itself, the reporter must also remove the app under GitHub Settings → Applications → Authorized OAuth Apps.

## No-account GitHub App Worker

GitHub's issue creation API requires authentication. A public client cannot create an issue anonymously, so the Worker holds a narrow GitHub App installation credential server-side and immediately writes each report as a GitHub issue. No report database is used.

1. Create a GitHub App owned by the repository owner, grant **Issues: Read and write**, and install it on `Noobcode20/PDF-Dock` only. Keep other permissions disabled.
2. Generate the GitHub App private key and note the App ID and installation ID. Keep the private key off client devices and out of the repository.
3. Create a Cloudflare KV namespace. Put its namespace ID into `github-issues-worker/wrangler.toml` in place of `REPLACE_WITH_KV_NAMESPACE_ID`.
4. From `github-issues-worker/`, configure secrets and deploy:

   ```sh
   npx wrangler secret put GITHUB_APP_ID
   npx wrangler secret put GITHUB_INSTALLATION_ID
   npx wrangler secret put GITHUB_APP_PRIVATE_KEY
   npx wrangler deploy
   ```

   For the private key, paste the complete PEM including its `BEGIN` and `END` lines. App ID and installation ID are not private, but are stored as Worker secrets for consistent setup.
   The Wrangler config declares these three secrets as required, so a deployment fails early if one is missing. When adding a secret in the Cloudflare dashboard, click **Deploy** to activate the version with that secret. `wrangler secret put` creates and deploys a version immediately.
5. Set `VITE_GITHUB_ISSUE_PROXY_URL` to the Worker HTTPS URL and rebuild/package the app.

To deploy Worker code from a terminal without Wrangler's broad OAuth login, create an account-owned Cloudflare API token scoped to this existing Worker with the **Editor** role, then run `./deploy.sh` from `github-issues-worker/`. The helper prompts for the account ID and token, hides the token as you type, and removes both from the process environment when deployment finishes. Do not paste the token into chat or commit it.

The Worker validates report type and lengths, uses a honeypot, and applies a best-effort limit of five reports per IP per hour using KV. KV counters can race under concurrent requests; use Cloudflare's dedicated rate-limiting or a Durable Object if stricter abuse control is required. The Worker hardcodes the issue destination as `Noobcode20/PDF-Dock` and the GitHub App installation should be limited to that repository. The public endpoint can still be abused, so monitor the issue queue and Worker usage.

## Exact remaining setup

- GitHub OAuth App client ID for the connected-account path.
- GitHub App ID, installation ID, private key, and Issues write permission for the no-account Worker.
- Cloudflare KV namespace ID and the deployed Worker URL.
- Then the matching `VITE_*` variables and a new app build.

Keep the GitHub App private key only in the Cloudflare Worker secret named `GITHUB_APP_PRIVATE_KEY`. Do not put it in this repository, a `.env` file, or an app build variable.

## GitHub Actions setup

The repository contains three workflows:

- `.github/workflows/quality.yml` runs on pushes and pull requests. It needs no secrets or repository variables; GitHub's Actions token is enough to check out the source.
- `.github/workflows/beta-release.yml` runs for tags matching `v0.1.0-beta.*`, builds macOS and Windows installers, and publishes the artifacts as a prerelease. Its `contents: write` workflow permission lets the built-in `GITHUB_TOKEN` create or update the release; no personal access token is needed. The build reads the two `VITE_*` repository variables below and embeds them into the packaged app.
- `.github/workflows/deploy-issue-worker.yml` deploys the Worker on pushes to `master` that change `github-issues-worker/**` (or this workflow), and can also be run manually from the Actions tab. It uses Cloudflare's official Wrangler Action v4.

Before enabling the deploy workflow, open repository **Settings → Secrets and variables → Actions** and add these repository variables:

| Variable | Value |
| --- | --- |
| `VITE_GITHUB_CLIENT_ID` | GitHub OAuth App client ID. Enable Device Flow. This value is public and is embedded in the app. |
| `VITE_GITHUB_ISSUE_PROXY_URL` | Deployed Worker URL, such as `https://pdf-dock-issue-intake.<account-subdomain>.workers.dev`. |

Add these repository Actions secrets:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID that owns the Worker. |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token for the target account. Do not use a Global API Key. |

Create the token from Cloudflare’s **Edit Cloudflare Workers** template, scope it to the account hosting this Worker, and do not add unrelated accounts or zones. That template includes the Workers and KV access needed by Wrangler; Cloudflare may adjust template permissions over time. Keep the GitHub App private key out of GitHub Actions: the Worker reads it from Cloudflare Worker secrets. The GitHub App ID, installation ID, and private key are provisioned once with `wrangler secret put` as described above. Create the KV namespace and replace the placeholder ID in `github-issues-worker/wrangler.toml` before the first deploy.

After the first successful Worker deployment, copy its HTTPS URL into `VITE_GITHUB_ISSUE_PROXY_URL`. Add or update both `VITE_*` variables before creating a beta tag; each release build compiles the values into the installer, so changing them requires a new build and release. Run the worker workflow manually after configuring the secret, variable, KV namespace, and Worker secrets. Confirm the deploy job succeeds before publishing an app build that offers no-account reports.

In repository **Settings → Actions → General**, ensure GitHub Actions is enabled and allowed to run this repository's workflows. A repository administrator must also ensure organization policies permit the official action reference and workflow permissions used here.

### First-time setup sequence

1. Create the GitHub OAuth App and GitHub App as described above; enable OAuth Device Flow and grant the GitHub App Issues read/write access for `Noobcode20/PDF-Dock` only.
2. Create the Cloudflare KV namespace and update its ID in `github-issues-worker/wrangler.toml`.
3. Create a Cloudflare API token and add it, along with the account ID, as Actions secrets named `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
4. Set the Worker secrets with Wrangler, then run **Actions → Deploy GitHub issue Worker → Run workflow**.
5. Add `VITE_GITHUB_CLIENT_ID` and the deployed Worker URL as `VITE_GITHUB_ISSUE_PROXY_URL` repository variables.
6. Push a beta tag matching `v0.1.0-beta.*` to build and publish installers with both reporting methods configured.

The values still needed from the project owner are the GitHub OAuth App client ID, Cloudflare account ID and API token, GitHub App ID/installation ID/private key, and the Cloudflare KV namespace ID. The Worker URL is available after its first successful deploy. The GitHub App private key must be entered as a Cloudflare Worker secret, never sent in chat or committed.
