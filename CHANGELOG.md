# Changelog

All changes currently present in the workspace. If you expected earlier session data, the repository contains no `.git` or backup files here.

## 2026-01-02 — Assistant edits
- Updated `js/content.js`: quick-quote button positioning changed to `position: fixed`; selection handling improved; viewport clamping added.
- Updated `js/quill-editor.js`: preserved empty paragraphs by converting them to `<p>&#8203;</p>`; improved `bbcodeToHtml` and `quillToBBCode` conversions; removed `trim()` on textarea load and added plain-text-with-newlines handling.

Notes:
- No `.git` directory or changelog/backup files were found in the workspace, so earlier sessions' artifacts are not available locally.
- If you have exported session files, raw textarea samples, or a git remote, I can use those to reconstruct prior session changes.
 
## Brief Summary

- This project is an extension for the Altcointalks forum that improves the user experience with an enhanced editor UI, a theme manager, an emoji toolbar, and image upload / BBCode insertion tools.
- Recent changes (2026-01-02): Adjusted the "copy quote" button to appear precisely under the selection, and improved Quill↔BBCode conversion to preserve blank lines when editing older posts.

If you want, I can produce a detailed record of prior sessions if you provide a git repository or exported session files.
