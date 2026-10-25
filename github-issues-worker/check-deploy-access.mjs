const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const workerName = "pdf-dock-issue-intake";
const environment = "production";

if (!accountId || !apiToken) {
  console.error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required.");
  process.exit(1);
}

const paths = [
  `/accounts/${accountId}/workers/services/${workerName}/environments/${environment}/bindings`,
  `/accounts/${accountId}/workers/services/${workerName}/environments/${environment}/routes?show_zonename=true`,
  `/accounts/${accountId}/workers/domains/records?page=0&per_page=5&service=${workerName}&environment=${environment}`,
  `/accounts/${accountId}/workers/services/${workerName}/environments/${environment}/subdomain`,
  `/accounts/${accountId}/workers/services/${workerName}/environments/${environment}`,
  `/accounts/${accountId}/workers/scripts/${workerName}/schedules`,
];

let failed = false;
const failedPaths = [];
for (const path of paths) {
  let response;
  let body;
  try {
    response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    body = await response.json();
  } catch (error) {
    console.error(`Could not check ${path}: ${error.message}`);
    failed = true;
    failedPaths.push(path);
    continue;
  }

  if (response.ok && body?.success !== false) {
    console.log(`OK ${path}`);
    continue;
  }

  failed = true;
  failedPaths.push(path);
  const errors = Array.isArray(body?.errors)
    ? body.errors.map(({ code, message, documentation_url }) => ({ code, message, documentation_url }))
    : [];
  console.error(`${response.status} ${path}${errors.length ? ` ${JSON.stringify(errors)}` : ""}`);
}

if (failed) {
  const routeReadsFailed = failedPaths.some((path) => path.includes("/routes?") || path.includes("/workers/domains/records"));
  if (routeReadsFailed) {
    console.error("These Wrangler metadata lookups need Zone > Workers Routes > Read. Add it for the zone(s) used by the Worker; use all zones if you cannot identify them. Keep the Worker Editor policy.");
  }
  console.error("Deploy access preflight failed. The API token was not printed; fix the permissions above and retry.");
  process.exit(1);
}

console.log("Deploy access preflight passed.");
