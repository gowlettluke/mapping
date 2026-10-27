# Restore to a new repository

1. Extract the archive. The folder containing `index.html` is the site root.
2. Create a new GitHub repository and upload **the contents** of that folder, including `js/`, `vendor/` and `.github/workflows/check.yml`. Keep a second independent copy of this ZIP.
3. In the repository's Settings → Pages, select deployment from the main branch and root folder. A custom build action is not needed. `.nojekyll` tells Pages to serve the files directly.
4. Once the final HTTPS URL is known, register that exact app URL in your ArcGIS OAuth application's redirect list (for this repository's standard Pages address: `https://gowlettluke.github.io/mapping/`). The public client ID is configured in `CONFIG.arcgis.clientId` in `config.js` and is used automatically. If the old OAuth application is unavailable, create an application registration you control, enable the appropriate browser authorisation-code/PKCE flow and update that configuration value. Never add a client secret to a static site.
5. Open the live site, enter your organisation prefix, then sign in. Your organisation must grant access to the recorded registered warning/radar WMS portal items and any camera/district layers you want to use. Select the correct owner if several matches appear.
6. Run `docs/ACCEPTANCE.md` with a real current warning. Report discrepancies with the selected portal item, public layer schema and browser error message; omit credentials and signed image URLs.

Local demo: run `python3 -m http.server 8000` in the site root, then open `http://localhost:8000/demo.html`. Live localhost authentication needs a permitted localhost redirect in the ArcGIS application registration. Use a modern browser with Canvas and JavaScript modules; rich clipboard usually requires HTTPS or localhost.

Configuration is in `config.js`. Public service URLs, the public OAuth client ID and item titles can be updated there by the app administrator. The organisation prefix, tracking preference and theme are stored in this browser. Previously saved client-ID overrides are ignored. The client ID is a public application identifier; removing its form field does not make it secret or hide it from browser source/network inspection. ArcGIS's IdentityManager controls its sign-in lifecycle. Sign out on shared devices. The application itself has no backend or analytics and does not upload map imagery, report text or camera photos to a repository.

To create your own Git history locally:

```sh
git init
git add .
git commit -m "Restore reconstructed Queensland warning mapping app"
git branch -M main
```

Add your new repository as the remote and push according to GitHub's instructions. No deployment or remote repository creation was performed when this archive was prepared.
