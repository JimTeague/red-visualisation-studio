# Deploying RED Visualisation Studio on GitHub Pages

## 1. Create a repository
Create a new repository such as:
- `red-visualisation-studio`
- or `alluvium-red-visualisation-studio`

## 2. Upload this bundle
Upload all files from this folder to the repository root.

## 3. Enable Pages
In GitHub:
- open **Settings**
- open **Pages**
- under **Build and deployment**, choose one of:
  - **Deploy from a branch** and publish from the default branch root, or
  - **GitHub Actions** and use the included workflow

## 4. Publish
Wait for the Pages deployment to finish, then open the published URL.

## 5. Test with a RED package
Open a recent `.redviz.zip` package exported from RED and check:
- package opens successfully
- aerial texture loads
- Rock and Large Wood are separate controls
- water controls work
- photo alignment works
- high-resolution export works

## Suggested sharing approach
Share the viewer URL separately from project data.
Then email or otherwise provide the `.redviz.zip` package to the reviewer.
The reviewer opens the package locally in their browser.
