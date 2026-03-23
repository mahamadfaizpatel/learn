# LinuxPath — v4 Multi-Course Setup

## Folder structure

```
project/
├── index.html
├── style.css
├── app.js
└── resources/
    ├── index.json              ← course registry (edit to add courses)
    ├── linux/
    │   ├── meta.json           ← course metadata
    │   └── curriculum.json     ← your renamed curriculum_s1_s3.json
    └── python/                 ← example of a second course
        ├── meta.json
        └── curriculum.json
```

## Step 1 — Move your existing curriculum file

Rename and move your existing JSON:

```
curriculum_s1_s3.json  →  resources/linux/curriculum.json
```

## Step 2 — Serve over HTTP (required)

The app fetches JSON files at runtime, so it must be served:

```bash
python3 -m http.server
# open http://localhost:8000
```

## Adding a new course

1. Create a subfolder: `resources/my-course/`
2. Add `resources/my-course/meta.json`:

```json
{
  "id": "my-course",
  "title": "My Course Title",
  "description": "A short description shown on the course card.",
  "icon": "🐍",
  "accent": "#4fa3e3",
  "difficulty": "beginner",
  "sections_count": 3,
  "files": ["curriculum.json"],
  "complete_message": "Course complete!",
  "complete_sub": "Great work finishing this course."
}
```

3. Add your curriculum JSON at `resources/my-course/curriculum.json`  
   (same `{ "sections": [...] }` format as before)

4. Register it in `resources/index.json`:

```json
{
  "courses": ["linux", "my-course"]
}
```

That's it — reload the page and your new course card appears.

## Splitting large curricula into parts

The `files` array in meta.json accepts multiple files loaded and merged in order:

```json
"files": ["section1.json", "section2.json", "section3.json"]
```

Each file must be a standard `{ "sections": [...] }` object.

## meta.json fields

| Field            | Required | Description                                      |
|------------------|----------|--------------------------------------------------|
| id               | ✓        | Must match the folder name                       |
| title            | ✓        | Shown on the course card                         |
| description      | ✓        | Short description on the card                    |
| files            | ✓        | Array of curriculum JSON filenames (in order)    |
| icon             |          | Emoji shown on the card (default: 📚)            |
| accent           |          | Hex colour for the card CTA button               |
| difficulty       |          | `beginner` / `intermediate` / `advanced`         |
| sections_count   |          | Displayed as "N sections" on the card            |
| complete_message |          | Heading on the completion screen                 |
| complete_sub     |          | Subtext on the completion screen                 |
