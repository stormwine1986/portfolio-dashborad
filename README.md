# Portfolio Dashborad

## Private access

This dashboard now uses HTTP Basic Auth in the Worker.

Before deploying, set credentials with Wrangler:

```bash
wrangler secret put DASHBOARD_USERNAME
wrangler secret put DASHBOARD_PASSWORD
```

After that, redeploy the Worker. Visiting the site will prompt for a username and password, and `/api/assets-stats` is protected by the same credentials.
