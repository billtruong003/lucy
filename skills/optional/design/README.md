# Design taste-skills (nhóm 🟢 dùng-ngay)

8 Claude Code Agent Skills về *design / frontend taste*, import từ repo
**[leonxlnx/taste-skill](https://github.com/leonxlnx/taste-skill)** (License **MIT**,
© 2026 Leonxlnx). Mỗi skill giữ nguyên `SKILL.md` gốc (frontmatter `name`+`description`).

| slug (thư mục) | skill name (frontmatter) | nguồn repo |
|---|---|---|
| taste-skill | design-taste-frontend | skills/taste-skill |
| gpt-taste | gpt-taste | skills/gpt-tasteskill |
| output-skill | full-output-enforcement | skills/output-skill |
| minimalist-skill | minimalist-ui | skills/minimalist-skill |
| brutalist-skill | industrial-brutalist-ui | skills/brutalist-skill |
| soft-skill | high-end-visual-design | skills/soft-skill |
| redesign-skill | redesign-existing-projects | skills/redesign-skill |
| stitch-skill | stitch-design-taste | skills/stitch-skill |

Đã BỎ QUA (không phù hợp hạ tầng Lucy hiện tại):
`brandkit`, `imagegen-frontend-web`, `imagegen-frontend-mobile` (cần imagegen),
`image-to-code-skill` (cần ảnh input), `taste-skill-v1` (bản cũ).

Các skill được khai báo trong `skills/INDEX.md` mục `### 🎯 design (8)` và nạp
progressive-disclosure qua `agent-machine/src/skill-loader.ts` khi task khớp keyword
(design, frontend, ui, landing, redesign, brutalist, minimalist, motion, gsap...).

## License (MIT — leonxlnx/taste-skill)

```
MIT License

Copyright (c) 2026 Leonxlnx

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files, to deal in the Software
without restriction, including the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, subject to the
above copyright notice and this permission notice being included.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
```
Full text: https://github.com/leonxlnx/taste-skill/blob/main/LICENSE
