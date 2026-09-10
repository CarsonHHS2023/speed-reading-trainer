# Frontend GitHub Pages deployment

Production frontend URL:

`https://carsonhhs2023.github.io/speed-reading-trainer/`

## Production

`.github/workflows/pages.yml` publishes the current `main` branch to the root of the existing `gh-pages` branch after every push to `main`.

The production deployment uses `keep_files: true` so existing PR preview directories under `preview/` are preserved.

## Pull request previews

`.github/workflows/preview.yml` publishes each pull request to:

`https://carsonhhs2023.github.io/speed-reading-trainer/preview/pr-{number}/`

Preview publishing also uses `keep_files: true`, so a PR preview cannot erase the production root or other preserved Pages content.

## Backend

The static frontend calls the configured backend service from the browser. Publishing to GitHub Pages does not proxy API requests through GitHub Pages.
