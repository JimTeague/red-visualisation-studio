# GitHub setup - recommended configuration

## Recommended repository

**Repository name:** `red-visualisation-studio`

**Description:**
> Browser-based 3D visualisation viewer for River Earthworks Designer (RED) packages. Project files are processed locally in the browser.

**Visibility:**
- Use **Public** if the viewer source can be public and you want the simplest GitHub Pages setup.
- If you use a private repository, confirm your GitHub organisation/plan allows Pages for that repository type.

Do **not** commit client `.redviz.zip` files or other project data to this repository.

## Create the repository

1. Sign in to GitHub.
2. Choose **New repository**.
3. Name it `red-visualisation-studio`.
4. Add the description above.
5. Do not initialise it with a generated README if you plan to upload this bundle as-is.
6. Create the repository.

## Upload this release

Simplest web-browser method:
1. Open the new repository.
2. Choose **Add file → Upload files**.
3. Extract the v6.1 ZIP locally first.
4. Drag the *contents* of the extracted folder into GitHub so `index.html` is at repository root.
5. Commit to `main`.

Important files that should appear at repository root include:
- `index.html`
- `app.js`
- `viewer.js`
- `viewer_canvas2d.js`
- `app.css`
- `viewer.css`
- `.nojekyll`
- `README.md`

The GitHub Actions workflow should be at:
`.github/workflows/deploy-pages.yml`

## Enable GitHub Pages

Recommended method for this bundle:
1. Open **Settings → Pages** in the repository.
2. Under **Build and deployment**, select **GitHub Actions** as the source.
3. Open the **Actions** tab.
4. The included **Deploy static site to GitHub Pages** workflow should run after the push to `main`.
5. Wait for the deployment to show success.
6. Open the Pages URL shown by GitHub.

## First live test

Use a RED `.redviz.zip` exported from the current RED build and confirm:
1. Package opens.
2. Aerial texture displays.
3. Rock and Large Wood are independent controls.
4. Water controls work.
5. Establishment vegetation works.
6. Photo alignment works.
7. 4K export works.

## Recommended external sharing language

> Open the RED Visualisation Studio link in a modern desktop browser, then choose **Open RED visualisation package** and select the `.redviz.zip` file supplied for the project. The package is processed locally in your browser and is not uploaded by the viewer.

## Custom Alluvium domain later

A custom subdomain such as `visualise.alluvium.com.au` would be cleaner for external use. Configure the custom domain in **Settings → Pages** and have the domain administrator create the required DNS record. Enable **Enforce HTTPS** once GitHub has provisioned the certificate.
