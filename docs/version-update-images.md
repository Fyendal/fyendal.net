# Version update images

Screenshots for the version update notice live in `apps/client/public/updates/`.
Place each release's images in its own folder and reference them from the
notice Markdown:

```md
![Alt text](/updates/2026-10-18/deck-grid.1280x720.webp "Optional caption")
```

- Folder and file names are lowercase words joined by hyphens.
- The file name ends with the image's intrinsic `<width>x<height>` and one of
  `.webp`, `.png`, `.jpg`, or `.avif`. Prefer WebP; keep each file under 500 KB.
- Alt text is required; images without it are not shown.
- Card art may use `https://content.fabrary.net/cards/<printing>.webp`.
- Deploy the client before publishing a notice that references new images, and
  remove a folder only after its notice has been replaced.

`decodeVersionUpdateImageSource` in `@fyendal/protocol` is the allowlist.
